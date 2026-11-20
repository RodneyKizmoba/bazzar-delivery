import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { orderItems, orders, stores, users } from "@shared/schema";
import { ah, idParam, notFound, parse } from "../lib/http";
import { requireRole } from "../lib/auth";
import { changeStatus, claimDelivery, markArrived } from "../lib/orderFlow";
import { publishLocation } from "../lib/realtime";

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
    createdAt: o.createdAt,
    store: { id: s.id, name: s.name, street: s.street, zone: s.zone, phone: s.phone, latitude: s.latitude, longitude: s.longitude },
  };
}

// Entregas disponíveis: aceites pela loja e ainda sem estafeta
driverRouter.get("/available", ah(async (_req, res) => {
  const rows = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(isNull(orders.driverId), inArray(orders.status, ["accepted", "preparing", "ready"])))
    .orderBy(desc(orders.priorityFee), asc(orders.createdAt)).limit(50);
  res.json({ orders: rows.map((r) => summary(r.o, r.s)) });
}));

driverRouter.get("/current", ah(async (req, res) => {
  const [row] = await db.select({ o: orders, s: stores, customerName: users.fullName, customerPhone: users.phone })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId)).innerJoin(users, eq(users.id, orders.customerId))
    .where(and(eq(orders.driverId, req.user!.id), inArray(orders.status, [...ACTIVE]))).limit(1);
  if (!row) return res.json({ order: null });
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, row.o.id));
  res.json({ order: { ...summary(row.o, row.s), customer: { name: row.customerName, phone: row.customerPhone }, items } });
}));

driverRouter.post("/orders/:id/claim", ah(async (req, res) => {
  const order = await claimDelivery(idParam(req), req.user!.id);
  res.json({ order });
}));

driverRouter.post("/orders/:id/status", ah(async (req, res) => {
  const { status } = parse(z.object({ status: z.enum(["picked_up", "delivered"]) }), req.body);
  const order = await changeStatus(idParam(req), status, { kind: "driver", userId: req.user!.id });
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

/** Ganhos do estafeta (taxa de entrega + gorjetas): hoje, 7 e 30 dias, e o detalhe dos últimos 7 dias. */
driverRouter.get("/earnings", ah(async (req, res) => {
  // meia-noite de hoje em Luanda (UTC+1)
  const shifted = new Date(Date.now() + 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(shifted.getTime() - 3_600_000);
  const mine = (since: Date) => and(eq(orders.driverId, req.user!.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since));
  const sum = async (since: Date) => {
    const [r] = await db.select({
      deliveries: sql<number>`count(*)::int`,
      fees: sql<number>`coalesce(sum(${orders.deliveryFee}),0)::int`,
      tips: sql<number>`coalesce(sum(${orders.riderTip}),0)::int`,
    }).from(orders).where(mine(since));
    return { ...r, total: r.fees + r.tips };
  };
  const week = new Date(startOfDay.getTime() - 6 * 86_400_000);
  const days = await db.select({
    day: sql<string>`to_char((${orders.deliveredAt} at time zone 'Africa/Luanda')::date, 'YYYY-MM-DD')`,
    deliveries: sql<number>`count(*)::int`,
    total: sql<number>`coalesce(sum(${orders.deliveryFee} + ${orders.riderTip}),0)::int`,
  }).from(orders).where(mine(week)).groupBy(sql`1`).orderBy(sql`1`);
  res.json({
    today: await sum(startOfDay),
    last7Days: await sum(week),
    last30Days: await sum(new Date(Date.now() - 30 * 86_400_000)),
    daily: days,
  });
}));

driverRouter.get("/orders/:id", ah(async (req, res) => {
  const [row] = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, idParam(req)), eq(orders.driverId, req.user!.id)));
  if (!row) throw notFound("Entrega não encontrada");
  res.json({ order: summary(row.o, row.s) });
}));
