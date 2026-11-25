import { Router } from "express";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { config } from "../config";
import { PAYOUT_METHODS, driverPresence, rideOffers, rideQuoteSchema, rideRequestSchema, rides, taxiDrivers, users } from "@shared/schema";
import { ah, badRequest, idParam, notFound, parse } from "../lib/http";
import { requireAuth, requireRole } from "../lib/auth";
import { touchPresence } from "../lib/dispatchEngine";
import { account } from "../lib/settlement";
import { available, instantCashout, payoutsOf } from "../lib/payouts";
import { instantCashoutFee, nextPayday } from "../lib/fees";
import {
  acceptRideOffer, assertCustomer, cancelByCustomer, completeRide, customerView, declineRideOffer, driverArrived, driverCancel,
  driverPresence as setTaxiPresence, driverView, getRide, quoteRide, raiseSos, rateRide, requestRide, retrySearch, shareView,
  startRide, updateDriverLocation,
} from "../lib/taxi";

export const taxiRouter = Router();

const ACTIVE = ["searching", "accepted", "arrived", "in_progress"] as const;
const DRIVER_ACTIVE = ["accepted", "arrived", "in_progress"] as const;

// ---------------------------------------------------------------------------
// Público: link partilhado da viagem
// ---------------------------------------------------------------------------
taxiRouter.get("/share/:token", ah(async (req, res) => {
  res.json({ ride: await shareView(String(req.params.token)) });
}));

// ---------------------------------------------------------------------------
// Passageiro
// ---------------------------------------------------------------------------
taxiRouter.post("/quote", ah(async (req, res) => {
  res.json(await quoteRide(parse(rideQuoteSchema, req.body)));
}));

const customer = Router();
customer.use(requireAuth, (req, _res, next) => { try { assertCustomer(req.user!.userType); next(); } catch (e) { next(e); } });

customer.post("/rides", ah(async (req, res) => {
  const ride = await requestRide(req.user!.id, parse(rideRequestSchema, req.body));
  res.status(201).json({ ride: await customerView(ride) });
}));

customer.get("/rides/current", ah(async (req, res) => {
  const [r] = await db.select().from(rides)
    .where(and(eq(rides.customerId, req.user!.id), sql`(${rides.status} in ('searching','accepted','arrived','in_progress','no_driver')
      or (${rides.status} = 'completed' and ${rides.rating} is null and ${rides.completedAt} > now() - interval '2 hours'))`))
    .orderBy(desc(rides.id)).limit(1);
  res.json({ ride: r ? await customerView(r) : null });
}));

customer.get("/rides", ah(async (req, res) => {
  const rows = await db.select().from(rides).where(eq(rides.customerId, req.user!.id)).orderBy(desc(rides.id)).limit(30);
  res.json({ rides: rows.map((r) => ({
    id: r.id, rideNumber: r.rideNumber, status: r.status, category: r.category, pickup: r.pickup, dropoff: r.dropoff,
    total: r.total, createdAt: r.createdAt, completedAt: r.completedAt,
  })) });
}));

async function ownRide(id: number, userId: number) {
  const r = await getRide(id);
  if (!r || r.customerId !== userId) throw notFound("Viagem não encontrada");
  return r;
}

customer.get("/rides/:id", ah(async (req, res) => {
  res.json({ ride: await customerView(await ownRide(idParam(req), req.user!.id)) });
}));

customer.post("/rides/:id/cancel", ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional().nullable() }), req.body ?? {});
  res.json({ ride: await customerView(await cancelByCustomer(idParam(req), req.user!.id, reason)) });
}));

customer.post("/rides/:id/retry", ah(async (req, res) => {
  res.json({ ride: await customerView((await retrySearch(idParam(req), req.user!.id))!) });
}));

customer.post("/rides/:id/rate", ah(async (req, res) => {
  const b = parse(z.object({ rating: z.number().int().min(1).max(5), comment: z.string().trim().max(500).optional().nullable() }), req.body);
  res.json({ ride: await customerView(await rateRide(idParam(req), req.user!.id, b.rating, b.comment)) });
}));

customer.post("/rides/:id/sos", ah(async (req, res) => {
  await raiseSos(idParam(req), req.user!.id);
  res.json({ ok: true, sosPhone: config.sosPhone });
}));

// ---------------------------------------------------------------------------
// Motorista de táxi
// ---------------------------------------------------------------------------
const driver = Router();
driver.use(requireRole("taxi"));

driver.get("/me", ah(async (req, res) => {
  const [td] = await db.select().from(taxiDrivers).where(eq(taxiDrivers.userId, req.user!.id));
  res.json({ vehicle: td ?? null, commissionPct: config.taxiCommissionPct });
}));

driver.get("/presence", ah(async (req, res) => {
  const [p] = await db.select().from(driverPresence).where(eq(driverPresence.userId, req.user!.id));
  res.json({ presence: p ?? { userId: req.user!.id, isOnline: false }, offerSeconds: config.taxiOfferSeconds });
}));

driver.post("/presence", ah(async (req, res) => {
  const b = parse(z.object({ online: z.boolean(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }), req.body);
  const pos = b.latitude != null && b.longitude != null ? { latitude: b.latitude, longitude: b.longitude } : null;
  res.json({ presence: await setTaxiPresence(req.user!.id, b.online, pos) });
}));

driver.post("/location", ah(async (req, res) => {
  const pos = parse(z.object({ latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180) }), req.body);
  await touchPresence(req.user!.id, pos);
  await updateDriverLocation(req.user!.id, pos);
  res.json({ ok: true });
}));

/** O pedido de viagem em aberto para mim (no máximo um). */
driver.get("/offers", ah(async (req, res) => {
  const [row] = await db.select({ o: rideOffers, r: rides }).from(rideOffers).innerJoin(rides, eq(rides.id, rideOffers.rideId))
    .where(and(eq(rideOffers.driverId, req.user!.id), eq(rideOffers.status, "pending"), sql`${rideOffers.expiresAt} > now()`)).limit(1);
  if (!row) return res.json({ offer: null });
  const v = await driverView(row.r);
  res.json({ offer: {
    id: row.o.id, expiresAt: row.o.expiresAt, offerSeconds: config.taxiOfferSeconds,
    pickupKm: row.o.pickupKm != null ? Math.round(row.o.pickupKm * 10) / 10 : null,
    ride: { ...v, customer: { firstName: v.customer.firstName } }, // telefone só depois de aceitar
  } });
}));

driver.post("/offers/:id/accept", ah(async (req, res) => {
  const r = await acceptRideOffer(idParam(req), req.user!.id);
  res.json({ ride: r ? await driverView(r) : null });
}));

driver.post("/offers/:id/decline", ah(async (req, res) => {
  await declineRideOffer(idParam(req), req.user!.id);
  res.json({ ok: true });
}));

driver.get("/current", ah(async (req, res) => {
  const [r] = await db.select().from(rides).where(and(eq(rides.driverId, req.user!.id), inArray(rides.status, [...DRIVER_ACTIVE]))).limit(1);
  res.json({ ride: r ? await driverView(r) : null });
}));

driver.post("/rides/:id/arrived", ah(async (req, res) => {
  res.json({ ride: await driverView(await driverArrived(idParam(req), req.user!.id)) });
}));

driver.post("/rides/:id/start", ah(async (req, res) => {
  const { pin } = parse(z.object({ pin: z.string().trim().regex(/^\d{4}$/, "O código tem 4 dígitos.").optional().nullable() }), req.body ?? {});
  res.json({ ride: await driverView(await startRide(idParam(req), req.user!.id, pin)) });
}));

driver.post("/rides/:id/complete", ah(async (req, res) => {
  res.json({ ride: await driverView(await completeRide(idParam(req), req.user!.id)) });
}));

driver.post("/rides/:id/cancel", ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional().nullable() }), req.body ?? {});
  await driverCancel(idParam(req), req.user!.id, reason);
  res.json({ ok: true });
}));

driver.post("/rides/:id/sos", ah(async (req, res) => {
  await raiseSos(idParam(req), req.user!.id);
  res.json({ ok: true, sosPhone: config.sosPhone });
}));

/** Viagens feitas e ganhos (hoje, 7 e 30 dias). */
driver.get("/history", ah(async (req, res) => {
  const shifted = new Date(Date.now() + 3_600_000); shifted.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(shifted.getTime() - 3_600_000);
  const sum = async (since: Date) => {
    const [r] = await db.select({ rides: sql<number>`count(*)::int`, total: sql<number>`coalesce(sum(${rides.driverEarning}),0)::int` })
      .from(rides).where(and(eq(rides.driverId, req.user!.id), eq(rides.status, "completed"), gte(rides.completedAt, since)));
    return r;
  };
  const rows = await db.select().from(rides).where(and(eq(rides.driverId, req.user!.id), inArray(rides.status, ["completed", "cancelled"])))
    .orderBy(desc(rides.id)).limit(50);
  res.json({
    today: await sum(startOfDay), last7Days: await sum(new Date(startOfDay.getTime() - 6 * 86_400_000)), last30Days: await sum(new Date(Date.now() - 30 * 86_400_000)),
    rides: rows.map((r) => ({ id: r.id, rideNumber: r.rideNumber, status: r.status, pickup: r.pickup, dropoff: r.dropoff, total: r.total,
      earning: r.driverEarning, paymentMethod: r.paymentMethod, rating: r.rating, completedAt: r.completedAt, cancelledAt: r.cancelledAt })),
  });
}));

// Carteira: a mesma dos estafetas (saldo, pagamento semanal à terça, levantamento imediato)
driver.get("/wallet", ah(async (req, res) => {
  const me = req.user!;
  const avail = await available("driver", me.id);
  res.json({
    ...(await account("driver", me.id)), available: avail, nextPayday: nextPayday(new Date()),
    instant: { min: config.instantCashoutMin, feePct: config.instantCashoutFeePct, feeMin: config.instantCashoutFeeMin, feeNow: avail.now ? instantCashoutFee(avail.now) : 0 },
    payouts: await payoutsOf("driver", me.id), payoutMethod: me.payoutMethod, payoutReference: me.payoutReference,
    cashLimit: config.riderCashLimit,
  });
}));

driver.put("/payout-account", ah(async (req, res) => {
  const b = parse(z.object({ payoutMethod: z.enum(PAYOUT_METHODS), payoutReference: z.string().trim().min(9, "Indique o número ou IBAN").max(60) }), req.body);
  const ref = b.payoutReference.replace(/[\s-]/g, "").toUpperCase();
  if (b.payoutMethod === "bank_transfer" && !/^(AO06)?\d{21}$/.test(ref)) throw badRequest("IBAN inválido (AO06 seguido de 21 dígitos).", "BAD_IBAN");
  if (b.payoutMethod !== "bank_transfer" && !/^(\+?244)?9\d{8}$/.test(ref)) throw badRequest("Número de telefone inválido (9 dígitos, começa por 9).", "BAD_PHONE");
  const [u] = await db.update(users).set({ payoutMethod: b.payoutMethod, payoutReference: ref }).where(eq(users.id, req.user!.id)).returning();
  res.json({ payoutMethod: u.payoutMethod, payoutReference: u.payoutReference });
}));

driver.post("/cashout", ah(async (req, res) => {
  res.status(201).json({ payout: await instantCashout(req.user!.id) });
}));

taxiRouter.use("/driver", driver);
taxiRouter.use("/", customer);
