import { Router } from "express";
import { and, asc, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { orderItems, orders, stores, users } from "@shared/schema";
import { ah, idParam, notFound, parse } from "../lib/http";
import { requireRole } from "../lib/auth";
import { changeStatus, claimDelivery } from "../lib/orderFlow";

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
    estimatedDeliveryAt: o.estimatedDeliveryAt,
    createdAt: o.createdAt,
    store: { id: s.id, name: s.name, street: s.street, zone: s.zone, phone: s.phone, latitude: s.latitude, longitude: s.longitude },
  };
}

// Entregas disponíveis: aceites pela loja e ainda sem estafeta
driverRouter.get("/available", ah(async (_req, res) => {
  const rows = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(isNull(orders.driverId), inArray(orders.status, ["accepted", "preparing", "ready"])))
    .orderBy(asc(orders.createdAt)).limit(50);
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

driverRouter.post("/location", ah(async (req, res) => {
  const { latitude, longitude } = parse(z.object({
    latitude: z.number().min(-90).max(90), longitude: z.number().min(-180).max(180),
  }), req.body);
  const updated = await db.update(orders)
    .set({ driverLatitude: latitude, driverLongitude: longitude, driverLocationAt: new Date() })
    .where(and(eq(orders.driverId, req.user!.id), inArray(orders.status, [...ACTIVE]))).returning({ id: orders.id });
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

driverRouter.get("/orders/:id", ah(async (req, res) => {
  const [row] = await db.select({ o: orders, s: stores }).from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(and(eq(orders.id, idParam(req)), eq(orders.driverId, req.user!.id)));
  if (!row) throw notFound("Entrega não encontrada");
  res.json({ order: summary(row.o, row.s) });
}));
