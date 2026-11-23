import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { PAYOUT_METHODS, VEHICLE_TYPES, dispatchOffers, driverPresence, orderItems, orders, stores, users } from "@shared/schema";
import { ah, badRequest, idParam, notFound, parse } from "../lib/http";
import { requireRole } from "../lib/auth";
import { changeStatus, claimDelivery, markArrived } from "../lib/orderFlow";
import { publishLocation } from "../lib/realtime";
import { acceptOffer, declineOffer, distanceKm, riderPayQuote, setPresence, touchPresence } from "../lib/dispatchEngine";
import { config } from "../config";
import { account } from "../lib/settlement";
import { available, instantCashout, payoutsOf } from "../lib/payouts";
import { currentBusyLevel, instantCashoutFee, nextPayday } from "../lib/fees";

export const driverRouter = Router();
driverRouter.use(requireRole("driver"));

const ACTIVE = ["accepted", "preparing", "ready", "picked_up"] as const;

function summary(o: typeof orders.$inferSelect, s: typeof stores.$inferSelect) {
  return {
    id: o.id,
    orderNumber: o.orderNumber,
    status: o.status,
    total: o.total,
    deliveryFee: o.deliveryFee,
    paymentMethod: o.paymentMethod,
    collectCash: o.paymentMethod === "cash" && o.paymentStatus !== "paid" ? o.total : 0,
    deliveryAddress: o.deliveryAddress,
    notes: o.notes,
    driverAtStoreAt: o.driverAtStoreAt,
    driverAtCustomerAt: o.driverAtCustomerAt,
    priority: o.priorityFee > 0,
    riderTip: o.riderTip,
    cutlery: o.cutlery,
    estimatedDeliveryAt: o.estimatedDeliveryAt,
    readyEstimateAt: o.readyEstimateAt,
    pinRequired: !!o.deliveryPin,
    // ganho do estafeta: fixado ao aceitar (base + distância + bónus, mínimo por hora) + espera + gorjeta
    payout: o.riderPay != null ? o.riderPay + o.riderWaitFee + o.riderTip : null,
    riderPayDetail: o.riderPayDetail,
    riderWaitFee: o.riderWaitFee,
    tripKm: s.latitude != null && s.longitude != null && o.deliveryAddress.latitude != null && o.deliveryAddress.longitude != null
      ? Math.round(distanceKm({ latitude: s.latitude, longitude: s.longitude }, { latitude: o.deliveryAddress.latitude, longitude: o.deliveryAddress.longitude! }) * 10) / 10
      : null,
    createdAt: o.createdAt,
    store: { id: s.id, name: s.name, street: s.street, zone: s.zone, phone: s.phone, latitude: s.latitude, longitude: s.longitude },
  };
}

// Entregas disponíveis: aceites pela loja, sem estafeta e sem oferta em aberto (essas vão para um estafeta de cada vez)
driverRouter.get("/available", ah(async (req, res) => {
  const rows = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(isNull(orders.driverId), eq(orders.fulfilment, "delivery"), inArray(orders.status, ["accepted", "preparing", "ready"]),
      sql`not exists (select 1 from dispatch_offers d where d.order_id = ${orders.id} and d.status = 'pending' and d.expires_at > now())`))
    .orderBy(desc(orders.priorityFee), asc(orders.createdAt)).limit(50);
  // quanto cada entrega me pagaria (a partir da minha posição e do meu veículo), antes de aceitar
  const busy = await currentBusyLevel(db);
  const list = [];
  for (const r of rows) {
    const pay = await riderPayQuote(db, r.o, req.user!.id, busy);
    list.push({ ...summary(r.o, r.s), payout: pay.total + r.o.riderTip, riderPayDetail: pay });
  }
  res.json({ orders: list });
}));

driverRouter.get("/current", ah(async (req, res) => {
  const [row] = await db.select({ o: orders, s: stores, customerName: users.fullName, customerPhone: users.phone })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId)).innerJoin(users, eq(users.id, orders.customerId))
    .where(and(eq(orders.driverId, req.user!.id), inArray(orders.status, [...ACTIVE]))).limit(1);
  if (!row) return res.json({ order: null });
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.o.id));
  res.json({ order: { ...summary(row.o, row.s), customer: { name: row.customerName, phone: row.customerPhone }, items } });
}));

// ---- Online / offline e ofertas (despacho automático) ----
driverRouter.get("/presence", ah(async (req, res) => {
  const [p] = await db.select().from(driverPresence).where(eq(driverPresence.userId, req.user!.id));
  res.json({ presence: p ?? { userId: req.user!.id, isOnline: false }, autoDispatch: config.autoDispatch, offerSeconds: config.dispatchOfferSeconds });
}));

driverRouter.post("/presence", ah(async (req, res) => {
  const body = parse(z.object({
    online: z.boolean(),
    latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional(),
  }), req.body);
  if (!req.user!.isApproved) return res.status(403).json({ message: "A sua conta de estafeta ainda aguarda aprovação.", code: "NOT_APPROVED" });
  const pos = body.latitude != null && body.longitude != null ? { latitude: body.latitude, longitude: body.longitude } : null;
  res.json({ presence: await setPresence(req.user!.id, body.online, pos) });
}));

/** A oferta em aberto para mim (no máximo uma). */
driverRouter.get("/offers", ah(async (req, res) => {
  const [row] = await db.select({ d: dispatchOffers, o: orders, s: stores }).from(dispatchOffers)
    .innerJoin(orders, eq(orders.id, dispatchOffers.orderId)).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(dispatchOffers.driverId, req.user!.id), eq(dispatchOffers.status, "pending"), sql`${dispatchOffers.expiresAt} > now()`))
    .limit(1);
  if (!row) return res.json({ offer: null });
  res.json({ offer: {
    id: row.d.id, offerSeconds: config.dispatchOfferSeconds, expiresAt: row.d.expiresAt, secondsLeft: Math.max(0, Math.round((row.d.expiresAt.getTime() - Date.now()) / 1000)),
    distanceKm: row.d.distanceKm != null ? Math.round(row.d.distanceKm * 10) / 10 : null, payout: row.d.payout, payDetail: row.d.payDetail,
    order: summary(row.o, row.s),
  } });
}));

driverRouter.post("/offers/:id/accept", ah(async (req, res) => {
  const order = await acceptOffer(idParam(req), req.user!.id);
  res.json({ order });
}));

driverRouter.post("/offers/:id/decline", ah(async (req, res) => {
  await declineOffer(idParam(req), req.user!.id);
  res.json({ ok: true });
}));

driverRouter.post("/orders/:id/claim", ah(async (req, res) => {
  const order = await claimDelivery(idParam(req), req.user!.id);
  res.json({ order });
}));

driverRouter.post("/orders/:id/status", ah(async (req, res) => {
  const { status, pin } = parse(z.object({ status: z.enum(["picked_up", "delivered"]), pin: z.string().trim().regex(/^\d{4}$/, "O código tem 4 dígitos.").optional().nullable() }), req.body);
  const order = await changeStatus(idParam(req), status, { kind: "driver", userId: req.user!.id }, null, { pin });
  res.json({ order });
}));

/** "Cheguei": à loja (antes de recolher) ou ao cliente (depois de recolher). */
driverRouter.post("/orders/:id/arrived", ah(async (req, res) => {
  const { at } = parse(z.object({ at: z.enum(["store", "customer"]) }), req.body);
  const order = await markArrived(idParam(req), req.user!.id, at);
  res.json({ order });
}));

driverRouter.post("/location", ah(async (req, res) => {
  const { latitude, longitude } = parse(z.object({
    latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  }), req.body);
  await touchPresence(req.user!.id, { latitude, longitude });
  const updated = await db.update(orders)
    .set({ driverLatitude: latitude, driverLongitude: longitude, driverLocationAt: new Date() })
    .where(and(eq(orders.driverId, req.user!.id), inArray(orders.status, [...ACTIVE]))).returning({ id: orders.id, customerId: orders.customerId });
  for (const o of updated) publishLocation(o);
  res.json({ updatedOrders: updated.map((u) => u.id) });
}));

driverRouter.get("/history", ah(async (req, res) => {
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.driverId, req.user!.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since)))
    .orderBy(desc(orders.deliveredAt)).limit(200);
  const [tot] = await db.select({ n: sql<number>`count(*)::int`, fees: sql<number>`coalesce(sum(${orders.deliveryFee}),0)::int` })
    .from(orders).where(and(eq(orders.driverId, req.user!.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since)));
  res.json({ orders: rows.map((r) => summary(r.o, r.s)), last30Days: tot });
}));

/** Ganhos do estafeta (valor das entregas + espera + gorjetas): hoje, 7 e 30 dias, e o detalhe dos últimos 7 dias. */
driverRouter.get("/earnings", ah(async (req, res) => {
  // meia-noite de hoje em Luanda (UTC+1)
  const shifted = new Date(Date.now() + 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(shifted.getTime() - 3_600_000);
  const mine = (since: Date) => and(eq(orders.driverId, req.user!.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since));
  const sum = async (since: Date) => {
    const [r] = await db.select({
      deliveries: sql<number>`count(*)::int`,
      fees: sql<number>`coalesce(sum(coalesce(${orders.riderPay}, ${orders.deliveryFee}) + ${orders.riderWaitFee}),0)::int`,
      tips: sql<number>`coalesce(sum(${orders.riderTip}),0)::int`,
    }).from(orders).where(mine(since));
    return { ...r, total: r.fees + r.tips };
  };
  const week = new Date(startOfDay.getTime() - 6 * 86_400_000);
  const days = await db.select({
    day: sql<string>`to_char((${orders.deliveredAt} at time zone 'Africa/Luanda')::date, 'YYYY-MM-DD')`,
    deliveries: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(coalesce(${orders.riderPay}, ${orders.deliveryFee}) + ${orders.riderWaitFee} + ${orders.riderTip}),0)::int`,
  }).from(orders).where(mine(week)).groupBy(sql`1`).orderBy(sql`1`);
  res.json({
    today: await sum(startOfDay),
    last7Days: await sum(week),
    last30Days: await sum(new Date(Date.now() - 30 * 86_400_000)),
    daily: days,
  });
}));

/** Carteira: saldo, o que entra no próximo pagamento (terça), levantamento imediato, conta e movimentos. */
driverRouter.get("/wallet", ah(async (req, res) => {
  const me = req.user!;
  const avail = await available("driver", me.id);
  res.json({
    ...(await account("driver", me.id)),
    available: avail,
    nextPayday: nextPayday(new Date()),
    instant: { min: config.instantCashoutMin, feePct: config.instantCashoutFeePct, feeMin: config.instantCashoutFeeMin, feeNow: avail.now ? instantCashoutFee(avail.now) : 0 },
    payouts: await payoutsOf("driver", me.id),
    payoutMethod: me.payoutMethod, payoutReference: me.payoutReference, vehicleType: me.vehicleType ?? "moto",
    cashLimit: config.riderCashLimit,
  });
}));

/** Conta para receber e veículo. */
driverRouter.put("/payout-account", ah(async (req, res) => {
  const b = parse(z.object({
    payoutMethod: z.enum(PAYOUT_METHODS), payoutReference: z.string().trim().min(9, "Indique o número ou IBAN").max(60),
    vehicleType: z.enum(VEHICLE_TYPES).optional(),
  }), req.body);
  const ref = b.payoutReference.replace(/[\s-]/g, "").toUpperCase();
  if (b.payoutMethod === "bank_transfer" && !/^(AO06)?\d{21}$/.test(ref)) {
    throw badRequest("IBAN inválido (AO06 seguido de 21 dígitos).", "BAD_IBAN");
  }
  if (b.payoutMethod !== "bank_transfer" && !/^(\+?244)?9\d{8}$/.test(ref)) {
    throw badRequest("Número de telefone inválido (9 dígitos, começa por 9).", "BAD_PHONE");
  }
  b.payoutReference = ref;
  const [u] = await db.update(users).set({ payoutMethod: b.payoutMethod, payoutReference: b.payoutReference, ...(b.vehicleType ? { vehicleType: b.vehicleType } : {}) })
    .where(eq(users.id, req.user!.id)).returning();
  res.json({ payoutMethod: u.payoutMethod, payoutReference: u.payoutReference, vehicleType: u.vehicleType });
}));

/** Levantamento imediato (com taxa). */
driverRouter.post("/cashout", ah(async (req, res) => {
  const p = await instantCashout(req.user!.id);
  res.status(201).json({ payout: p });
}));

driverRouter.get("/orders/:id", ah(async (req, res) => {
  const [row] = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, idParam(req)), eq(orders.driverId, req.user!.id)));
  if (!row) throw notFound("Entrega não encontrada");
  res.json({ order: summary(row.o, row.s) });
}));
