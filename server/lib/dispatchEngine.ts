import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { dispatchOffers, driverPresence, orders, stores, users, type Order, type RiderPayDetail, type VehicleType } from "@shared/schema";
import { currentBusyLevel, hasLL, riderPayFor, roadKm } from "./fees";
import { conflict, notFound } from "./http";
import { publishDispatchFailed, publishOffer } from "./realtime";
import { claimDelivery } from "./orderFlow";

/**
 * Motor de despacho (fase 2).
 *
 * Cada entrega aceite pela loja é oferecida a UM estafeta de cada vez — o melhor disponível:
 * online, sem entrega em curso, com GPS recente, perto da loja e há mais tempo à espera.
 * Tem DISPATCH_OFFER_SECONDS (30 s) para aceitar; se recusar ou não responder, passa ao seguinte.
 * Ao fim de DISPATCH_MAX_ROUNDS tentativas (ou sem ninguém disponível durante esse tempo) a entrega
 * fica na lista aberta para todos e o admin recebe um alerta.
 *
 * Tempo inteligente: a oferta só sai quando o estafeta escolhido chegaria à loja mais ou menos quando
 * a comida fica pronta (pronto às = aceite + tempo de preparação escolhido pela loja).
 *
 * Desenho genérico "recolha → entrega": usa só a loja (ponto de recolha), o destino e o ganho,
 * para poder servir também Envios e Táxi.
 */

export const ACTIVE_STATUSES = ["accepted", "preparing", "ready", "picked_up"] as const;
const DISPATCHABLE = ["accepted", "preparing", "ready"] as const;

type LL = { latitude: number; longitude: number };
export function distanceKm(a: LL, b: LL) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
/** Minutos de viagem estimados (linha recta × 1,3 para a estrada). */
export function travelMinutes(km: number) {
  return (km * 1.3 / config.riderSpeedKmh) * 60;
}
/**
 * Quanto esta entrega paga a este estafeta (sem a gorjeta e a espera): base + km até à loja + km até ao cliente,
 * ajustado pelo veículo, hora e movimento, com mínimo por hora. Usa a última posição GPS do estafeta.
 */
export async function riderPayQuote(tx: any, order: Order, driverId: number, busy?: 0 | 1 | 2): Promise<RiderPayDetail> {
  const [row] = await tx.select({ v: users.vehicleType, lat: driverPresence.latitude, lng: driverPresence.longitude, sl: stores.latitude, sg: stores.longitude })
    .from(users).leftJoin(driverPresence, eq(driverPresence.userId, users.id)).innerJoin(stores, eq(stores.id, order.storeId))
    .where(eq(users.id, driverId));
  const store = row ? pickupPointOf(order, { latitude: row.sl, longitude: row.sg }) : null;
  const me = row ? { latitude: row.lat, longitude: row.lng } : null;
  const pay = riderPayFor({
    pickupKm: hasLL(me) && hasLL(store) ? roadKm(me, store) : null,
    dropKm: order.deliveryKm ?? (hasLL(store) && hasLL(order.deliveryAddress) ? roadKm(store, order.deliveryAddress) : null),
    vehicle: (row?.v as VehicleType | null) ?? "moto", at: new Date(), busy: busy ?? await currentBusyLevel(tx),
    rate: order.parcel?.size === "large" ? "car" : "moto",
  });
  // Envios: o estafeta recebe parte do extra de tamanho (pacote médio/grande)
  const parcelBonus = order.parcel ? Math.round((order.parcel.sizeFee * config.parcelRiderSharePct) / 100) : 0;
  return parcelBonus ? { ...pay, parcelBonus, total: pay.total + parcelBonus } : pay;
}

/** Quando começar a procurar estafeta, a partir da hora em que a comida fica pronta. */
export function dispatchTimes(now: Date, readyAt: Date, priority: boolean) {
  const farthest = travelMinutes(config.dispatchRadiusKm) + config.dispatchLeadMin;
  const dispatchAt = priority ? now : new Date(Math.max(now.getTime(), readyAt.getTime() - farthest * 60_000));
  return { readyEstimateAt: readyAt, dispatchAt };
}

type Candidate = { id: number; km: number | null; idleMin: number };

/** Onde o estafeta recolhe: a loja, ou (Envios) a morada de quem envia. */
export function pickupPointOf(o: Pick<Order, "pickupAddress">, store: { latitude: number | null; longitude: number | null } | null | undefined) {
  return o.pickupAddress ? { latitude: o.pickupAddress.latitude, longitude: o.pickupAddress.longitude } : store ?? { latitude: null, longitude: null };
}
/** Envios: pacote grande só de carro; médio não vai de bicicleta. */
export function vehiclesFor(o: Pick<Order, "parcel">): string[] | null {
  if (!o.parcel) return null;
  if (o.parcel.size === "large") return ["car"];
  if (o.parcel.size === "medium") return ["moto", "car"];
  return null;
}

async function candidatesFor(orderId: number, store: { latitude: number | null; longitude: number | null }, isCash: boolean, vehicles: string[] | null = null): Promise<Candidate[]> {
  const staleMin = config.presenceStaleMin;
  const rows = await db.execute(sql`
    select u.id, p.latitude, p.longitude,
      extract(epoch from (now() - greatest(
        coalesce(p.online_since, now()),
        coalesce((select max(o.delivered_at) from orders o where o.driver_id = u.id), 'epoch'::timestamp)
      ))) / 60 as idle_min
    from users u join driver_presence p on p.user_id = u.id
    where u.user_type = 'driver' and u.is_approved and u.is_active and p.is_online
      and (p.location_at is null or p.location_at > now() - make_interval(mins => ${staleMin}))
      and not exists (select 1 from orders o where o.driver_id = u.id and o.status in ('accepted','preparing','ready','picked_up'))
      and not exists (select 1 from dispatch_offers d where d.driver_id = u.id and d.status = 'pending')
      and not exists (select 1 from dispatch_offers d where d.driver_id = u.id and d.order_id = ${orderId})
      and (${!isCash} or coalesce((select -sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id
             and l.kind in ('cash_collected','cash_deposit')), 0) < ${config.riderCashLimit})
      ${vehicles ? sql`and coalesce(u.vehicle_type::text, 'moto') in (${sql.join(vehicles.map((v) => sql`${v}`), sql`, `)})` : sql``}
  `);
  const list: Candidate[] = (rows.rows as any[]).map((r) => {
    const km = r.latitude != null && r.longitude != null && store.latitude != null && store.longitude != null
      ? distanceKm({ latitude: r.latitude, longitude: r.longitude }, { latitude: store.latitude, longitude: store.longitude })
      : null;
    return { id: r.id, km, idleMin: Math.max(0, Number(r.idle_min) || 0) };
  }).filter((c) => c.km === null || c.km <= config.dispatchRadiusKm);
  // mais perto primeiro; quem espera há mais tempo ganha até 3 km de vantagem (justo para todos)
  const score = (c: Candidate) => (c.km ?? config.dispatchRadiusKm) - Math.min(c.idleMin, 30) * 0.1;
  return list.sort((a, b) => score(a) - score(b) || b.idleMin - a.idleMin);
}

type Outcome = { offered?: { offerId: number; driverId: number }; gone: { offerId: number; driverId: number }[]; failed?: boolean };

/** Avança o despacho de uma encomenda: expira/cancela ofertas velhas e, se for a hora, oferece ao próximo. */
export async function advanceOrder(orderId: number, now = new Date()): Promise<Outcome> {
  const out: Outcome = { gone: [] };
  await db.transaction(async (tx) => {
    const [o] = await tx.select().from(orders).where(eq(orders.id, orderId)).for("update");
    if (!o) return;
    const pending = await tx.select().from(dispatchOffers)
      .where(and(eq(dispatchOffers.orderId, orderId), eq(dispatchOffers.status, "pending")));
    const eligible = !o.driverId && o.fulfilment === "delivery" && (DISPATCHABLE as readonly string[]).includes(o.status) && !o.dispatchFailedAt;
    for (const p of pending) {
      if (!eligible || p.expiresAt <= now) {
        await tx.update(dispatchOffers).set({ status: eligible ? "expired" : "cancelled", respondedAt: now }).where(eq(dispatchOffers.id, p.id));
        out.gone.push({ offerId: p.id, driverId: p.driverId });
      } else return; // ainda há uma oferta em aberto: esperar pela resposta
    }
    if (!eligible || !config.autoDispatch) return;
    if (o.dispatchAt && now < o.dispatchAt) return;

    const giveUp = async () => {
      await tx.update(orders).set({ dispatchFailedAt: now, updatedAt: now }).where(eq(orders.id, orderId));
      await tx.execute(sql`insert into order_events (order_id, status, note) values (${orderId}, ${o.status}, 'Despacho automático sem estafeta: lista aberta e admin avisado')`);
      out.failed = true;
    };
    if (o.dispatchRound >= config.dispatchMaxRounds) return giveUp();

    const [store] = await tx.select({ latitude: stores.latitude, longitude: stores.longitude }).from(stores).where(eq(stores.id, o.storeId));
    const cands = await candidatesFor(orderId, pickupPointOf(o, store), o.paymentMethod === "cash", vehiclesFor(o));
    const best = cands[0];
    if (!best) {
      const since = (o.dispatchAt ?? o.updatedAt).getTime();
      if (now.getTime() - since > config.dispatchMaxRounds * config.dispatchOfferSeconds * 1000 && (!o.readyEstimateAt || o.readyEstimateAt <= now)) {
        return giveUp();
      }
      return;
    }
    // tempo inteligente: não chamar o estafeta cedo demais (esperaria na loja)
    if (o.readyEstimateAt && o.status !== "ready" && o.priorityFee === 0) {
      const travel = travelMinutes(best.km ?? config.dispatchRadiusKm / 2);
      const leaveAt = o.readyEstimateAt.getTime() - (travel + config.dispatchLeadMin) * 60_000;
      if (now.getTime() < leaveAt) return;
    }
    const pay = await riderPayQuote(tx, o, best.id);
    const [offer] = await tx.insert(dispatchOffers).values({
      orderId, driverId: best.id, status: "pending", round: o.dispatchRound + 1,
      distanceKm: best.km, payout: pay.total + o.riderTip, payDetail: pay, offeredAt: now,
      expiresAt: new Date(now.getTime() + config.dispatchOfferSeconds * 1000),
    }).returning();
    await tx.update(orders).set({ dispatchRound: o.dispatchRound + 1 }).where(eq(orders.id, orderId));
    out.offered = { offerId: offer.id, driverId: best.id };
  });
  for (const g of out.gone) publishOffer(g.driverId, orderId, g.offerId, "gone");
  if (out.offered) publishOffer(out.offered.driverId, orderId, out.offered.offerId, "new");
  if (out.failed) publishDispatchFailed(orderId);
  return out;
}

let running = false;
/** Uma volta do motor: todas as encomendas à espera de estafeta e todas as ofertas a expirar. */
export async function dispatchTick(now = new Date()) {
  if (running) return 0;
  running = true;
  try {
    const due = await db.execute(sql`
      select id from orders
      where driver_id is null and status in ('accepted','preparing','ready') and dispatch_failed_at is null and fulfilment = 'delivery'
        and (dispatch_at is null or dispatch_at <= ${now})
      union
      select d.order_id from dispatch_offers d where d.status = 'pending'
      limit 300`);
    let n = 0;
    for (const r of due.rows as { id: number }[]) {
      try { await advanceOrder(r.id, now); n++; } catch (e) { console.error("[dispatch]", r.id, e); }
    }
    return n;
  } finally { running = false; }
}

export function startDispatcher() {
  if (!config.autoDispatch) { console.log("[dispatch] despacho automático desligado (AUTO_DISPATCH=0)"); return; }
  setInterval(() => { dispatchTick().catch((e) => console.error("[dispatch]", e)); }, config.dispatchTickMs);
}

/** Pode este estafeta ficar com a encomenda? Bloqueia quando está reservada (oferta em aberto) para outro. */
export async function assertNotReservedForOther(tx: any, orderId: number, driverId: number) {
  const [other] = await tx.select({ id: dispatchOffers.id }).from(dispatchOffers).where(and(
    eq(dispatchOffers.orderId, orderId), eq(dispatchOffers.status, "pending"),
    sql`${dispatchOffers.driverId} <> ${driverId}`, sql`${dispatchOffers.expiresAt} > now()`,
  ));
  if (other) throw conflict("Esta entrega está reservada para outro estafeta durante alguns segundos.", "OFFERED_TO_OTHER");
}

/** Depois de atribuída: a oferta deste estafeta fica aceite e as outras em aberto canceladas. */
export async function closeOffersOnClaim(tx: any, orderId: number, driverId: number) {
  const now = new Date();
  const open = await tx.select().from(dispatchOffers).where(and(eq(dispatchOffers.orderId, orderId), eq(dispatchOffers.status, "pending")));
  for (const p of open) {
    await tx.update(dispatchOffers).set({ status: p.driverId === driverId ? "accepted" : "cancelled", respondedAt: now }).where(eq(dispatchOffers.id, p.id));
  }
  return open.filter((p: any) => p.driverId !== driverId).map((p: any) => ({ offerId: p.id as number, driverId: p.driverId as number }));
}

export async function acceptOffer(offerId: number, driverId: number) {
  const [offer] = await db.select().from(dispatchOffers).where(eq(dispatchOffers.id, offerId));
  if (!offer || offer.driverId !== driverId) throw notFound("Oferta não encontrada");
  if (offer.status !== "pending" || offer.expiresAt <= new Date()) throw conflict("Esta oferta já expirou.", "OFFER_EXPIRED");
  return claimDelivery(offer.orderId, driverId);
}

export async function declineOffer(offerId: number, driverId: number) {
  const now = new Date();
  const [offer] = await db.update(dispatchOffers).set({ status: "declined", respondedAt: now })
    .where(and(eq(dispatchOffers.id, offerId), eq(dispatchOffers.driverId, driverId), eq(dispatchOffers.status, "pending")))
    .returning();
  if (!offer) throw notFound("Oferta não encontrada");
  await advanceOrder(offer.orderId, now); // passa já ao seguinte
  return offer;
}

/** Ligar/desligar: desligar recusa a oferta em aberto (passa ao seguinte). */
export async function setPresence(driverId: number, online: boolean, pos?: LL | null) {
  const now = new Date();
  const loc = pos ? { latitude: pos.latitude, longitude: pos.longitude, locationAt: now } : {};
  const [prev] = await db.select().from(driverPresence).where(eq(driverPresence.userId, driverId));
  const onlineSince = online ? (prev?.isOnline ? prev.onlineSince : now) : null;
  await db.insert(driverPresence).values({ userId: driverId, isOnline: online, onlineSince, updatedAt: now, ...loc })
    .onConflictDoUpdate({ target: driverPresence.userId, set: { isOnline: online, onlineSince, updatedAt: now, ...loc } });
  if (!online) {
    const open = await db.select().from(dispatchOffers).where(and(eq(dispatchOffers.driverId, driverId), eq(dispatchOffers.status, "pending")));
    for (const p of open) await declineOffer(p.id, driverId).catch(() => {});
  }
  const [cur] = await db.select().from(driverPresence).where(eq(driverPresence.userId, driverId));
  return cur;
}

/** Guarda a última posição do estafeta (para escolher o mais perto). */
export async function touchPresence(driverId: number, pos: LL) {
  const now = new Date();
  await db.insert(driverPresence).values({ userId: driverId, isOnline: false, latitude: pos.latitude, longitude: pos.longitude, locationAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: driverPresence.userId, set: { latitude: pos.latitude, longitude: pos.longitude, locationAt: now, updatedAt: now } });
}

/** Admin: voltar a tentar o despacho automático de uma encomenda. */
export async function redispatch(orderId: number) {
  const [o] = await db.update(orders).set({ dispatchFailedAt: null, dispatchRound: 0, dispatchAt: new Date() })
    .where(and(eq(orders.id, orderId), sql`${orders.driverId} is null`, eq(orders.fulfilment, "delivery"), inArray(orders.status, [...DISPATCHABLE]))).returning();
  if (!o) throw conflict("Esta encomenda já não está à espera de estafeta.", "NOT_WAITING");
  await advanceOrder(orderId);
  return o;
}

