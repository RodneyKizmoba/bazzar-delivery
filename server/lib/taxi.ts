import { and, eq, inArray, sql } from "drizzle-orm";
import { randomBytes, randomInt } from "crypto";
import { db, type DbOrTx } from "../db";
import { config } from "../config";
import {
  driverPresence as presenceTable, ledgerEntries, payments, rideOffers, rides, taxiDrivers, users,
  RIDE_ACTIVE, type PaymentMethod, type Ride, type RideCategory, type RidePlace,
} from "@shared/schema";
import { badRequest, conflict, forbidden, notFound } from "./http";
import { assertMethodAvailable } from "./payments";
import { distanceKm, setPresence } from "./dispatchEngine";
import { CATEGORY_ORDER, currentSurge, estMinutes, fareFor, routeKm, splitRide, waitFeeFor } from "./taxiFares";

/**
 * Táxi (estilo DiDi): o cliente pede uma viagem e o pedido vai ao motorista livre mais próximo
 * da categoria escolhida, um de cada vez (TAXI_OFFER_SECONDS para aceitar). Reaproveita a presença
 * (online + GPS) dos estafetas, mas os motoristas de táxi são contas à parte (user_type "taxi").
 *
 * Estados: searching → accepted (a caminho) → arrived (à espera) → in_progress (com o código do cliente) → completed.
 * Sem motorista ao fim de TAXI_MAX_ROUNDS ofertas ou TAXI_SEARCH_MAX_MIN: "no_driver" (o cliente pode tentar de novo).
 * Dinheiro: numerário (o motorista recebe e fica a dever à PedeJá) ou banco; comissão TAXI_COMMISSION_PCT;
 * os ganhos entram na mesma carteira e no mesmo pagamento semanal dos estafetas.
 */

const ACTIVE = [...RIDE_ACTIVE] as string[];
const DRIVER_ACTIVE = ["accepted", "arrived", "in_progress"];

function newRideNumber() {
  return `TX-${Date.now().toString(36).toUpperCase().slice(-5)}${randomBytes(2).toString("hex").toUpperCase()}`;
}

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------
export async function quoteRide(input: { pickup: RidePlace; dropoff: RidePlace; stops?: RidePlace[] }) {
  const stops = input.stops ?? [];
  const km = routeKm(input.pickup, input.dropoff, stops);
  if (km < 0.2) throw badRequest("A partida e o destino são o mesmo sítio.", "SAME_PLACE");
  if (km > 150) throw badRequest("Destino demasiado longe para uma viagem de táxi.", "TOO_FAR");
  const now = new Date();
  const options = [];
  for (const category of CATEGORY_ORDER) {
    const minutes = estMinutes(km, category);
    const surge = await currentSurge(db, category, now);
    const fare = fareFor({ category, km, minutes, surge, stops: stops.length });
    const nearby = await nearbyDrivers(category, input.pickup);
    options.push({ category, km, minutes: Math.round(minutes), fare: fare.total, detail: fare, driversNearby: nearby.count, pickupEtaMin: nearby.etaMin });
  }
  return { km, options, waitFreeMin: config.taxiWaitFreeMin, waitPerMin: config.taxiWaitPerMin };
}

async function nearbyDrivers(category: RideCategory, at: RidePlace) {
  const rows = await db.execute(sql`
    select p.latitude, p.longitude from driver_presence p join users u on u.id = p.user_id join taxi_drivers td on td.user_id = u.id
    where u.user_type = 'taxi' and u.is_approved and u.is_active and p.is_online and td.category = ${category}
      and (p.location_at is null or p.location_at > now() - make_interval(mins => ${config.presenceStaleMin}))
      and not exists (select 1 from rides x where x.driver_id = u.id and x.status in ('accepted','arrived','in_progress'))`);
  const kms = (rows.rows as any[]).filter((r) => r.latitude != null).map((r) => distanceKm(r, at)).filter((k) => k <= config.taxiRadiusKm);
  const nearest = kms.length ? Math.min(...kms) : null;
  return { count: kms.length, etaMin: nearest != null ? Math.max(2, Math.round(estMinutes(nearest * 1.3, category))) : null };
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
export async function requestRide(customerId: number, input: { pickup: RidePlace; dropoff: RidePlace; stops: RidePlace[]; category: RideCategory; paymentMethod: PaymentMethod }) {
  assertMethodAvailable(input.paymentMethod);
  const [open] = await db.select({ id: rides.id }).from(rides).where(and(eq(rides.customerId, customerId), inArray(rides.status, ACTIVE as any)));
  if (open) throw conflict("Já tem uma viagem em curso.", "RIDE_IN_PROGRESS");
  const km = routeKm(input.pickup, input.dropoff, input.stops);
  if (km < 0.2) throw badRequest("A partida e o destino são o mesmo sítio.", "SAME_PLACE");
  if (km > 150) throw badRequest("Destino demasiado longe para uma viagem de táxi.", "TOO_FAR");
  const minutes = estMinutes(km, input.category);
  const fare = fareFor({ category: input.category, km, minutes, surge: await currentSurge(db, input.category), stops: input.stops.length });
  const [ride] = await db.insert(rides).values({
    rideNumber: newRideNumber(), customerId, category: input.category, status: "searching",
    pickup: input.pickup, dropoff: input.dropoff, stops: input.stops,
    estKm: km, estMin: minutes, fare: fare.total, fareDetail: fare, total: fare.total,
    paymentMethod: input.paymentMethod, pin: String(randomInt(0, 10000)).padStart(4, "0"),
    shareToken: randomBytes(16).toString("hex"),
  }).returning();
  await advanceRide(ride.id).catch((e) => console.error("[taxi]", e));
  return (await getRide(ride.id))!;
}

export async function getRide(id: number) {
  const [r] = await db.select().from(rides).where(eq(rides.id, id));
  return r ?? null;
}

/** Cliente cancela (grátis até X min depois de o motorista aceitar; depois pode ter taxa, se configurada). */
export async function cancelByCustomer(rideId: number, customerId: number, reason?: string | null) {
  const out = await db.transaction(async (tx) => {
    const [r] = await tx.select().from(rides).where(eq(rides.id, rideId)).for("update");
    if (!r || r.customerId !== customerId) throw notFound("Viagem não encontrada");
    if (!["searching", "accepted", "arrived", "no_driver"].includes(r.status)) throw conflict("Esta viagem já não pode ser cancelada.", "RIDE_NOT_CANCELLABLE");
    const now = new Date();
    const late = r.driverId && r.acceptedAt && (now.getTime() - r.acceptedAt.getTime()) / 60_000 > config.taxiFreeCancelMin;
    const cancelFee = late ? config.taxiCancelFee : 0;
    const [u] = await tx.update(rides).set({
      status: "cancelled", cancelledAt: now, cancelledBy: "customer", cancelReason: reason ?? null,
      cancelFee, total: cancelFee, updatedAt: now,
    }).where(eq(rides.id, rideId)).returning();
    await closeOffers(tx, rideId, null);
    if (cancelFee > 0 && r.driverId) await settleRide(tx, u); // a taxa de cancelamento vai para o motorista (menos a comissão)
    return u;
  });
  return out;
}

/** Sem motorista: voltar a procurar. */
export async function retrySearch(rideId: number, customerId: number) {
  const [r] = await db.update(rides).set({ status: "searching", dispatchRound: 0, searchStartedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(rides.id, rideId), eq(rides.customerId, customerId), eq(rides.status, "no_driver"))).returning();
  if (!r) throw conflict("Esta viagem já não está à espera de motorista.", "NOT_WAITING");
  await advanceRide(r.id);
  return getRide(r.id);
}

export async function rateRide(rideId: number, customerId: number, rating: number, comment?: string | null) {
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(rides).where(eq(rides.id, rideId)).for("update");
    if (!r || r.customerId !== customerId) throw notFound("Viagem não encontrada");
    if (r.status !== "completed") throw conflict("Só pode avaliar depois da viagem.", "RIDE_NOT_DONE");
    if (r.rating) throw conflict("Já avaliou esta viagem.", "ALREADY_REVIEWED");
    const [u] = await tx.update(rides).set({ rating, ratingComment: comment ?? null }).where(eq(rides.id, rideId)).returning();
    if (r.driverId) {
      await tx.update(taxiDrivers).set({
        ratingAvg: sql`(${taxiDrivers.ratingAvg} * ${taxiDrivers.ratingCount} + ${rating}) / (${taxiDrivers.ratingCount} + 1)`,
        ratingCount: sql`${taxiDrivers.ratingCount} + 1`,
      }).where(eq(taxiDrivers.userId, r.driverId));
    }
    return u;
  });
}

/** SOS: fica registado para a equipa PedeJá; a app liga logo para a polícia (113). */
export async function raiseSos(rideId: number, userId: number) {
  const r = await getRide(rideId);
  if (!r || (r.customerId !== userId && r.driverId !== userId)) throw notFound("Viagem não encontrada");
  const by = r.customerId === userId ? "customer" : "driver";
  const [u] = await db.update(rides).set({ sosAt: new Date(), sosBy: by, updatedAt: new Date() }).where(eq(rides.id, rideId)).returning();
  console.warn(`[taxi] SOS na viagem ${r.rideNumber} (${by})`);
  return u;
}

// ---------------------------------------------------------------------------
// Despacho: um motorista de cada vez, o mais perto primeiro
// ---------------------------------------------------------------------------
async function closeOffers(tx: DbOrTx, rideId: number, acceptedBy: number | null) {
  const now = new Date();
  const open = await tx.select().from(rideOffers).where(and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, "pending")));
  for (const p of open) {
    await tx.update(rideOffers).set({ status: p.driverId === acceptedBy ? "accepted" : "cancelled", respondedAt: now }).where(eq(rideOffers.id, p.id));
  }
}

async function candidates(r: Ride) {
  const rows = await db.execute(sql`
    select u.id, p.latitude, p.longitude,
      extract(epoch from (now() - greatest(coalesce(p.online_since, now()),
        coalesce((select max(x.completed_at) from rides x where x.driver_id = u.id), 'epoch'::timestamp)))) / 60 as idle_min
    from users u join driver_presence p on p.user_id = u.id join taxi_drivers td on td.user_id = u.id
    where u.user_type = 'taxi' and u.is_approved and u.is_active and p.is_online and td.category = ${r.category}
      and (p.location_at is null or p.location_at > now() - make_interval(mins => ${config.presenceStaleMin}))
      and not exists (select 1 from rides x where x.driver_id = u.id and x.status in ('accepted','arrived','in_progress'))
      and not exists (select 1 from ride_offers o where o.driver_id = u.id and o.status = 'pending')
      and not exists (select 1 from ride_offers o where o.driver_id = u.id and o.ride_id = ${r.id})
      and (${r.paymentMethod !== "cash"} or coalesce((select -sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id
             and l.kind in ('cash_collected','cash_deposit')), 0) < ${config.riderCashLimit})`);
  return (rows.rows as any[]).map((c) => ({
    id: c.id as number,
    km: c.latitude != null && c.longitude != null ? distanceKm({ latitude: c.latitude, longitude: c.longitude }, r.pickup) : null,
    idleMin: Math.max(0, Number(c.idle_min) || 0),
  })).filter((c) => c.km === null || c.km <= config.taxiRadiusKm)
    // mais perto primeiro; quem espera há mais tempo ganha uma pequena vantagem
    .sort((a, b) => ((a.km ?? config.taxiRadiusKm) - Math.min(a.idleMin, 20) * 0.05) - ((b.km ?? config.taxiRadiusKm) - Math.min(b.idleMin, 20) * 0.05));
}

export async function advanceRide(rideId: number, now = new Date()) {
  let offered: number | null = null;
  await db.transaction(async (tx) => {
    const [r] = await tx.select().from(rides).where(eq(rides.id, rideId)).for("update");
    if (!r) return;
    const pending = await tx.select().from(rideOffers).where(and(eq(rideOffers.rideId, rideId), eq(rideOffers.status, "pending")));
    const searching = r.status === "searching" && !r.driverId;
    for (const p of pending) {
      if (!searching || p.expiresAt <= now) {
        await tx.update(rideOffers).set({ status: searching ? "expired" : "cancelled", respondedAt: now }).where(eq(rideOffers.id, p.id));
      } else return; // ainda à espera da resposta deste motorista
    }
    if (!searching) return;
    const giveUp = async () => {
      await tx.update(rides).set({ status: "no_driver", updatedAt: now }).where(eq(rides.id, rideId));
    };
    const searchingMin = (now.getTime() - r.searchStartedAt.getTime()) / 60_000;
    if (r.dispatchRound >= config.taxiMaxRounds || searchingMin > config.taxiSearchMaxMin) return giveUp();
    const best = (await candidates(r))[0];
    if (!best) return; // ninguém livre agora: tenta na próxima volta (até TAXI_SEARCH_MAX_MIN)
    await tx.insert(rideOffers).values({
      rideId, driverId: best.id, round: r.dispatchRound + 1, pickupKm: best.km, offeredAt: now,
      expiresAt: new Date(now.getTime() + config.taxiOfferSeconds * 1000),
    });
    await tx.update(rides).set({ dispatchRound: r.dispatchRound + 1 }).where(eq(rides.id, rideId));
    offered = best.id;
  });
  return offered;
}

let running = false;
export async function rideTick(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    const due = await db.execute(sql`select id from rides where status = 'searching' union select ride_id from ride_offers where status = 'pending' limit 300`);
    let n = 0;
    for (const r of due.rows as { id: number }[]) {
      try { await advanceRide(r.id, now); n++; } catch (e) { console.error("[taxi]", r.id, e); }
    }
    return n;
  } finally { running = false; }
}

export function startRideDispatcher() {
  if (!config.autoDispatch) return;
  setInterval(() => { rideTick().catch((e) => console.error("[taxi]", e)); }, config.dispatchTickMs);
}

// ---------------------------------------------------------------------------
// Motorista
// ---------------------------------------------------------------------------
export async function driverPresence(driverId: number, online: boolean, pos?: { latitude: number; longitude: number } | null) {
  const p = await setPresence(driverId, online, pos);
  if (!online) {
    const open = await db.select().from(rideOffers).where(and(eq(rideOffers.driverId, driverId), eq(rideOffers.status, "pending")));
    for (const o of open) await declineRideOffer(o.id, driverId).catch(() => {});
  }
  return p;
}

export async function acceptRideOffer(offerId: number, driverId: number) {
  const now = new Date();
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(rideOffers).where(eq(rideOffers.id, offerId)).for("update");
    if (!o || o.driverId !== driverId) throw notFound("Pedido não encontrado");
    if (o.status !== "pending" || o.expiresAt <= now) throw conflict("Este pedido já expirou.", "OFFER_EXPIRED");
    const [r] = await tx.select().from(rides).where(eq(rides.id, o.rideId)).for("update");
    if (!r || r.status !== "searching" || r.driverId) throw conflict("Esta viagem já não está disponível.", "RIDE_TAKEN");
    const [busy] = await tx.select({ id: rides.id }).from(rides).where(and(eq(rides.driverId, driverId), inArray(rides.status, DRIVER_ACTIVE as any)));
    if (busy) throw conflict("Já tem uma viagem em curso.", "RIDE_IN_PROGRESS");
    // a última posição do motorista: o passageiro vê logo o carro no mapa
    const [pos] = await tx.select({ lat: presenceTable.latitude, lng: presenceTable.longitude, at: presenceTable.locationAt }).from(presenceTable).where(eq(presenceTable.userId, driverId));
    await tx.update(rides).set({
      driverId, status: "accepted", acceptedAt: now, updatedAt: now,
      ...(pos?.lat != null ? { driverLatitude: pos.lat, driverLongitude: pos.lng, driverLocationAt: pos.at ?? now } : {}),
    }).where(eq(rides.id, r.id));
    await closeOffers(tx, r.id, driverId);
  });
  const [o] = await db.select({ rideId: rideOffers.rideId }).from(rideOffers).where(eq(rideOffers.id, offerId));
  return getRide(o.rideId);
}

export async function declineRideOffer(offerId: number, driverId: number) {
  const [o] = await db.update(rideOffers).set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(rideOffers.id, offerId), eq(rideOffers.driverId, driverId), eq(rideOffers.status, "pending"))).returning();
  if (!o) throw notFound("Pedido não encontrado");
  await advanceRide(o.rideId); // passa já ao seguinte
  return o;
}

async function myRide(tx: DbOrTx, rideId: number, driverId: number) {
  const [r] = await tx.select().from(rides).where(eq(rides.id, rideId)).for("update");
  if (!r || r.driverId !== driverId) throw notFound("Viagem não encontrada");
  return r;
}

export async function driverArrived(rideId: number, driverId: number) {
  return db.transaction(async (tx) => {
    const r = await myRide(tx, rideId, driverId);
    if (r.status !== "accepted") throw conflict("Só pode marcar a chegada antes de começar a viagem.", "BAD_STATUS");
    const now = new Date();
    const [u] = await tx.update(rides).set({ status: "arrived", arrivedAt: now, updatedAt: now }).where(eq(rides.id, rideId)).returning();
    return u;
  });
}

/** Começar a viagem: só com o código de 4 dígitos que o passageiro vê na app (confirma que é a pessoa certa). */
export async function startRide(rideId: number, driverId: number, pin?: string | null) {
  const r0 = await getRide(rideId);
  if (!r0 || r0.driverId !== driverId) throw notFound("Viagem não encontrada");
  if (r0.status !== "arrived" && r0.status !== "accepted") throw conflict("Esta viagem não pode começar agora.", "BAD_STATUS");
  if (r0.pinAttempts >= config.pinMaxAttempts) throw conflict("Demasiadas tentativas com o código errado. Ligue ao suporte PedeJá.", "PIN_LOCKED");
  if (!pin) throw badRequest("Peça ao passageiro o código de 4 dígitos.", "PIN_REQUIRED");
  if (pin.trim() !== r0.pin) {
    await db.update(rides).set({ pinAttempts: sql`${rides.pinAttempts} + 1` }).where(eq(rides.id, rideId));
    const left = config.pinMaxAttempts - r0.pinAttempts - 1;
    throw badRequest(left > 0 ? `Código errado. Restam ${left} tentativas.` : "Código errado. Ligue ao suporte PedeJá.", "BAD_PIN");
  }
  return db.transaction(async (tx) => {
    const r = await myRide(tx, rideId, driverId);
    if (r.status !== "arrived" && r.status !== "accepted") throw conflict("Esta viagem não pode começar agora.", "BAD_STATUS");
    const now = new Date();
    const waitMin = r.arrivedAt ? (now.getTime() - r.arrivedAt.getTime()) / 60_000 : 0;
    const waitFee = waitFeeFor(waitMin, r.category);
    const [u] = await tx.update(rides).set({
      status: "in_progress", startedAt: now, arrivedAt: r.arrivedAt ?? now, waitFee, total: r.fare + waitFee + r.tip, updatedAt: now,
    }).where(eq(rides.id, rideId)).returning();
    return u;
  });
}

/** Fim da viagem: fecha o preço (combinado + espera), recebe o pagamento e faz as contas. */
export async function completeRide(rideId: number, driverId: number) {
  return db.transaction(async (tx) => {
    const r = await myRide(tx, rideId, driverId);
    if (r.status !== "in_progress") throw conflict("A viagem ainda não começou.", "BAD_STATUS");
    const now = new Date();
    const total = r.fare + r.waitFee + r.tip;
    // numerário: o motorista recebe agora; banco: cobrado no fim (sandbox: pago logo)
    let paymentStatus = "paid";
    if (r.paymentMethod === "cash") {
      await tx.insert(payments).values({ rideId, userId: r.customerId, amount: total, method: "cash", provider: "cash", status: "paid" });
    } else if (config.paymentsMode === "sandbox") {
      await tx.insert(payments).values({ rideId, userId: r.customerId, amount: total, method: r.paymentMethod, provider: "sandbox", status: "paid",
        providerReference: `SANDBOX-${randomBytes(6).toString("hex").toUpperCase()}` });
    } else {
      paymentStatus = "pending"; // gateway real: a cobrança é confirmada pelo fornecedor
      await tx.insert(payments).values({ rideId, userId: r.customerId, amount: total, method: r.paymentMethod, provider: "gateway", status: "pending" });
    }
    const [u] = await tx.update(rides).set({ status: "completed", completedAt: now, total, paymentStatus, updatedAt: now }).where(eq(rides.id, rideId)).returning();
    await settleRide(tx, u);
    return u;
  });
}

/** Motorista desiste antes de começar: a viagem volta a procurar outro motorista. */
export async function driverCancel(rideId: number, driverId: number, reason?: string | null) {
  await db.transaction(async (tx) => {
    const r = await myRide(tx, rideId, driverId);
    if (r.status !== "accepted" && r.status !== "arrived") throw conflict("Já não pode desistir desta viagem.", "BAD_STATUS");
    const now = new Date();
    await tx.update(rides).set({
      status: "searching", driverId: null, acceptedAt: null, arrivedAt: null, searchStartedAt: now, updatedAt: now,
      cancelReason: reason ? `Motorista desistiu: ${reason}` : "Motorista desistiu",
    }).where(eq(rides.id, rideId));
  });
  await advanceRide(rideId);
  return getRide(rideId);
}

/** Contas da viagem (idempotente): ganho do motorista e, em numerário, o que ele recebeu do cliente. */
export async function settleRide(tx: DbOrTx, r: Ride) {
  if (r.settledAt || !r.driverId) return;
  const cancelled = r.status === "cancelled";
  const s = splitRide({ fare: cancelled ? 0 : r.fare, waitFee: cancelled ? 0 : r.waitFee, tip: cancelled ? 0 : r.tip, cancelFee: r.cancelFee });
  await tx.update(rides).set({ commissionPct: config.taxiCommissionPct, commissionAmount: s.commission, driverEarning: s.driverEarning, settledAt: new Date() })
    .where(eq(rides.id, r.id));
  const rows: (typeof ledgerEntries.$inferInsert)[] = [{
    partyType: "driver", partyId: r.driverId, rideId: r.id, kind: "order_earning", amount: s.driverEarning,
    note: cancelled
      ? `${r.rideNumber}: taxa de cancelamento ${r.cancelFee} Kz − comissão ${config.taxiCommissionPct}%`
      : `${r.rideNumber}: viagem ${r.fare} Kz${r.waitFee ? ` + espera ${r.waitFee} Kz` : ""} − comissão ${config.taxiCommissionPct}% (${s.commission} Kz)${r.tip ? ` + gorjeta ${r.tip} Kz` : ""}`,
  }];
  if (!cancelled && r.paymentMethod === "cash") {
    rows.push({ partyType: "driver", partyId: r.driverId, rideId: r.id, kind: "cash_collected", amount: -r.total, note: `${r.rideNumber}: numerário recebido do passageiro` });
  }
  await tx.insert(ledgerEntries).values(rows).onConflictDoNothing();
}

export async function updateDriverLocation(driverId: number, pos: { latitude: number; longitude: number }) {
  await db.update(rides).set({ driverLatitude: pos.latitude, driverLongitude: pos.longitude, driverLocationAt: new Date() })
    .where(and(eq(rides.driverId, driverId), inArray(rides.status, DRIVER_ACTIVE as any)));
}

// ---------------------------------------------------------------------------
// O que cada um vê
// ---------------------------------------------------------------------------
export async function driverCard(driverId: number | null) {
  if (!driverId) return null;
  const [d] = await db.select({ name: users.fullName, phone: users.phone, td: taxiDrivers }).from(users)
    .innerJoin(taxiDrivers, eq(taxiDrivers.userId, users.id)).where(eq(users.id, driverId));
  if (!d) return null;
  return {
    name: d.name, firstName: d.name.split(" ")[0], phone: d.phone,
    vehicle: { make: d.td.make, model: d.td.model, colour: d.td.colour, plate: d.td.plate, category: d.td.category },
    rating: d.td.ratingCount ? Math.round(d.td.ratingAvg * 10) / 10 : null, ratingCount: d.td.ratingCount,
  };
}

/** Vista do passageiro (inclui o código para dar ao motorista). */
export async function customerView(r: Ride) {
  const driver = await driverCard(r.driverId);
  return {
    id: r.id, rideNumber: r.rideNumber, status: r.status, category: r.category,
    pickup: r.pickup, dropoff: r.dropoff, stops: r.stops, estKm: r.estKm, estMin: Math.round(r.estMin),
    fare: r.fare, fareDetail: r.fareDetail, waitFee: r.waitFee, cancelFee: r.cancelFee, tip: r.tip, total: r.total,
    paymentMethod: r.paymentMethod, paymentStatus: r.paymentStatus,
    pin: ["searching", "accepted", "arrived"].includes(r.status) ? r.pin : null,
    shareToken: r.shareToken, rating: r.rating, sos: !!r.sosAt,
    driver, driverLocation: r.driverLatitude != null ? { latitude: r.driverLatitude, longitude: r.driverLongitude!, at: r.driverLocationAt } : null,
    waitFreeMin: config.taxiWaitFreeMin, waitPerMin: config.taxiWaitPerMin, sosPhone: config.sosPhone,
    acceptedAt: r.acceptedAt, arrivedAt: r.arrivedAt, startedAt: r.startedAt, completedAt: r.completedAt, cancelledAt: r.cancelledAt,
    cancelledBy: r.cancelledBy, createdAt: r.createdAt,
  };
}

/** Vista do motorista (sem o código; com o que vai ganhar e o que cobrar). */
export async function driverView(r: Ride) {
  const [c] = await db.select({ name: users.fullName, phone: users.phone }).from(users).where(eq(users.id, r.customerId));
  const est = splitRide({ fare: r.fare, waitFee: r.waitFee, tip: r.tip });
  return {
    id: r.id, rideNumber: r.rideNumber, status: r.status, category: r.category,
    pickup: r.pickup, dropoff: r.dropoff, stops: r.stops, estKm: r.estKm, estMin: Math.round(r.estMin),
    fare: r.fare, waitFee: r.waitFee, tip: r.tip, total: r.total, paymentMethod: r.paymentMethod,
    collectCash: r.paymentMethod === "cash" ? r.fare + r.waitFee + r.tip : 0,
    earning: r.driverEarning ?? est.driverEarning, commissionPct: config.taxiCommissionPct,
    customer: { name: c?.name ?? "", firstName: (c?.name ?? "").split(" ")[0], phone: c?.phone ?? "" },
    pinAttemptsLeft: Math.max(0, config.pinMaxAttempts - r.pinAttempts),
    waitFreeMin: config.taxiWaitFreeMin, waitPerMin: config.taxiWaitPerMin, sosPhone: config.sosPhone,
    acceptedAt: r.acceptedAt, arrivedAt: r.arrivedAt, startedAt: r.startedAt, completedAt: r.completedAt, createdAt: r.createdAt,
  };
}

/** Link partilhado (família/amigos): sem telefones nem código. */
export async function shareView(token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw notFound("Viagem não encontrada");
  const [r] = await db.select().from(rides).where(eq(rides.shareToken, token));
  if (!r) throw notFound("Viagem não encontrada");
  const d = await driverCard(r.driverId);
  const live = ACTIVE.includes(r.status);
  return {
    rideNumber: r.rideNumber, status: r.status, category: r.category,
    pickup: { label: r.pickup.zone || r.pickup.label, latitude: r.pickup.latitude, longitude: r.pickup.longitude },
    dropoff: { label: r.dropoff.zone || r.dropoff.label, latitude: r.dropoff.latitude, longitude: r.dropoff.longitude },
    driver: d ? { firstName: d.firstName, vehicle: d.vehicle, rating: d.rating } : null,
    driverLocation: live && r.driverLatitude != null ? { latitude: r.driverLatitude, longitude: r.driverLongitude! } : null,
    startedAt: r.startedAt, completedAt: r.completedAt, sos: !!r.sosAt, sosPhone: config.sosPhone,
  };
}

export function assertCustomer(userType: string) {
  if (userType !== "customer") throw forbidden("Peça viagens com uma conta de cliente.");
}
