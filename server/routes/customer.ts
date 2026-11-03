import { Router } from "express";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  addressSchema, addresses, createOrderSchema, favorites, modifyOrderSchema, orderEvents, orderItems, orders,
  quoteSchema, reviewSchema, reviews, stores, subscriptions, users, PAYMENT_METHODS,
} from "@shared/schema";
import { config } from "../config";
import { ah, badRequest, conflict, forbidden, idParam, notFound, parse } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { buildQuote, hasActivePlus, quoteToJson } from "../lib/pricing";
import { changeStatus, createOrder, modifyOrder } from "../lib/orderFlow";
import { chargeSubscription } from "../lib/payments";
import { storeCard } from "./catalog";

export const customerRouter = Router();

// ---------------------------------------------------------------------------
// Moradas
// ---------------------------------------------------------------------------
customerRouter.get("/addresses", requireAuth, ah(async (req, res) => {
  const rows = await db.select().from(addresses).where(eq(addresses.userId, req.user!.id))
    .orderBy(desc(addresses.isDefault), asc(addresses.id));
  res.json({ addresses: rows });
}));

customerRouter.post("/addresses", requireAuth, ah(async (req, res) => {
  const input = parse(addressSchema, req.body);
  const userId = req.user!.id;
  const address = await db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(addresses).where(eq(addresses.userId, userId));
    if (n >= 20) throw badRequest("Limite de 20 moradas atingido.");
    const makeDefault = input.isDefault || n === 0;
    if (makeDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, userId));
    const [a] = await tx.insert(addresses).values({ ...input, userId, isDefault: makeDefault }).returning();
    return a;
  });
  res.status(201).json({ address });
}));

async function ownAddress(userId: number, id: number) {
  const [a] = await db.select().from(addresses).where(eq(addresses.id, id));
  if (!a) throw notFound("Morada não encontrada");
  if (a.userId !== userId) throw forbidden();
  return a;
}

customerRouter.put("/addresses/:id", requireAuth, ah(async (req, res) => {
  const id = idParam(req);
  await ownAddress(req.user!.id, id);
  const input = parse(addressSchema.partial(), req.body);
  const address = await db.transaction(async (tx) => {
    if (input.isDefault) await tx.update(addresses).set({ isDefault: false }).where(eq(addresses.userId, req.user!.id));
    const [a] = await tx.update(addresses).set(input).where(eq(addresses.id, id)).returning();
    return a;
  });
  res.json({ address });
}));

customerRouter.delete("/addresses/:id", requireAuth, ah(async (req, res) => {
  const id = idParam(req);
  const a = await ownAddress(req.user!.id, id);
  await db.delete(addresses).where(eq(addresses.id, id));
  if (a.isDefault) {
    const [next] = await db.select().from(addresses).where(eq(addresses.userId, req.user!.id)).limit(1);
    if (next) await db.update(addresses).set({ isDefault: true }).where(eq(addresses.id, next.id));
  }
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Favoritos
// ---------------------------------------------------------------------------
customerRouter.get("/favorites", requireAuth, ah(async (req, res) => {
  const rows = await db.select({ store: stores }).from(favorites).innerJoin(stores, eq(stores.id, favorites.storeId))
    .where(and(eq(favorites.userId, req.user!.id), eq(stores.isApproved, true))).orderBy(desc(favorites.createdAt));
  res.json({ stores: rows.map((r) => storeCard(r.store)) });
}));

customerRouter.put("/favorites/:storeId", requireAuth, ah(async (req, res) => {
  const storeId = idParam(req, "storeId");
  const [s] = await db.select({ id: stores.id }).from(stores).where(and(eq(stores.id, storeId), eq(stores.isApproved, true)));
  if (!s) throw notFound("Loja não encontrada");
  await db.insert(favorites).values({ userId: req.user!.id, storeId }).onConflictDoNothing();
  res.json({ isFavorite: true });
}));

customerRouter.delete("/favorites/:storeId", requireAuth, ah(async (req, res) => {
  const storeId = idParam(req, "storeId");
  await db.delete(favorites).where(and(eq(favorites.userId, req.user!.id), eq(favorites.storeId, storeId)));
  res.json({ isFavorite: false });
}));

// ---------------------------------------------------------------------------
// Orçamento do carrinho (preços calculados no servidor)
// ---------------------------------------------------------------------------
customerRouter.post("/cart/quote", ah(async (req, res) => {
  const input = parse(quoteSchema, req.body);
  const quote = await buildQuote(db, {
    storeId: input.storeId, lines: input.items, user: req.user ?? null, promoCode: input.promoCode, usePoints: input.usePoints,
  });
  res.json({ quote: quoteToJson(quote) });
}));

// ---------------------------------------------------------------------------
// Encomendas
// ---------------------------------------------------------------------------
customerRouter.post("/orders", requireAuth, ah(async (req, res) => {
  if (req.user!.userType !== "customer" && req.user!.userType !== "admin") {
    throw forbidden("Só contas de cliente podem fazer encomendas.");
  }
  const input = parse(createOrderSchema, req.body);
  if (input.groupToken) throw badRequest("Use o endpoint da encomenda em grupo para finalizar.");
  const order = await createOrder({
    user: req.user!,
    storeId: input.storeId,
    lines: input.items,
    addressId: input.addressId,
    paymentMethod: input.paymentMethod,
    notes: input.notes,
    scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
    promoCode: input.promoCode,
    usePoints: input.usePoints,
  });
  res.status(201).json({ order });
}));

customerRouter.get("/orders", requireAuth, ah(async (req, res) => {
  const rows = await db.select({ order: orders, storeName: stores.name, storeLogo: stores.logoUrl })
    .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
    .where(eq(orders.customerId, req.user!.id)).orderBy(desc(orders.createdAt)).limit(100);
  const ids = rows.map((r) => r.order.id);
  const reviewed = ids.length ? await db.select({ orderId: reviews.orderId }).from(reviews).where(inArray(reviews.orderId, ids)) : [];
  const reviewedSet = new Set(reviewed.map((r) => r.orderId));
  res.json({
    orders: rows.map((r) => ({ ...r.order, storeName: r.storeName, storeLogo: r.storeLogo, hasReview: reviewedSet.has(r.order.id) })),
  });
}));

/** Detalhe da encomenda: cliente dono, loja dona, estafeta atribuído ou admin. */
export async function loadOrderForViewer(orderId: number, viewer: Express.Request["user"]) {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw notFound("Encomenda não encontrada");
  const [store] = await db.select().from(stores).where(eq(stores.id, order.storeId));
  const u = viewer!;
  const allowed = u.userType === "admin" || order.customerId === u.id || order.driverId === u.id || store?.ownerId === u.id;
  if (!allowed) throw forbidden("Não pode ver esta encomenda.");
  return { order, store };
}

customerRouter.get("/orders/:id", requireAuth, ah(async (req, res) => {
  const { order, store } = await loadOrderForViewer(idParam(req), req.user);
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id)).orderBy(asc(orderEvents.createdAt));
  const [review] = await db.select().from(reviews).where(eq(reviews.orderId, order.id));
  let driver = null;
  if (order.driverId) {
    const [d] = await db.select({ id: users.id, fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, order.driverId));
    driver = d ?? null;
  }
  const [customer] = await db.select({ fullName: users.fullName, phone: users.phone }).from(users).where(eq(users.id, order.customerId));
  res.json({
    order: {
      ...order,
      canCancel: (config.cancellableStatuses as readonly string[]).includes(order.status),
      canModify: (config.modifiableStatuses as readonly string[]).includes(order.status),
      canReview: order.status === "delivered" && !review && order.customerId === req.user!.id,
    },
    items,
    events,
    review: review ?? null,
    driver,
    customer: req.user!.id === order.customerId ? null : customer,
    store: { id: store.id, name: store.name, phone: store.phone, street: store.street, zone: store.zone, latitude: store.latitude, longitude: store.longitude, logoUrl: store.logoUrl },
  });
}));

// leve, para polling a cada poucos segundos
customerRouter.get("/orders/:id/tracking", requireAuth, ah(async (req, res) => {
  const { order, store } = await loadOrderForViewer(idParam(req), req.user);
  res.json({
    status: order.status,
    updatedAt: order.updatedAt,
    estimatedDeliveryAt: order.estimatedDeliveryAt,
    scheduledFor: order.scheduledFor,
    driverLocation: order.driverLatitude != null && order.driverLongitude != null
      ? { latitude: order.driverLatitude, longitude: order.driverLongitude, at: order.driverLocationAt }
      : null,
    storeLocation: store.latitude != null ? { latitude: store.latitude, longitude: store.longitude } : null,
    destination: order.deliveryAddress.latitude != null
      ? { latitude: order.deliveryAddress.latitude, longitude: order.deliveryAddress.longitude }
      : null,
  });
}));

customerRouter.post("/orders/:id/cancel", requireAuth, ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(300).optional().nullable() }), req.body ?? {});
  const order = await changeStatus(idParam(req), "cancelled", { kind: "customer", userId: req.user!.id }, reason || "Cancelada pelo cliente");
  res.json({ order });
}));

customerRouter.patch("/orders/:id", requireAuth, ah(async (req, res) => {
  const input = parse(modifyOrderSchema, req.body);
  const order = await modifyOrder(idParam(req), req.user!, {
    lines: input.items,
    addressId: input.addressId,
    notes: input.notes,
    scheduledFor: input.scheduledFor === undefined ? undefined : input.scheduledFor ? new Date(input.scheduledFor) : null,
  });
  res.json({ order });
}));

customerRouter.post("/orders/:id/review", requireAuth, ah(async (req, res) => {
  const id = idParam(req);
  const input = parse(reviewSchema, req.body);
  const review = await db.transaction(async (tx) => {
    const [order] = await tx.select().from(orders).where(eq(orders.id, id));
    if (!order) throw notFound("Encomenda não encontrada");
    if (order.customerId !== req.user!.id) throw forbidden();
    if (order.status !== "delivered") throw conflict("Só pode avaliar encomendas entregues.", "NOT_DELIVERED");
    const [exists] = await tx.select({ id: reviews.id }).from(reviews).where(eq(reviews.orderId, id));
    if (exists) throw conflict("Já avaliou esta encomenda.", "ALREADY_REVIEWED");
    const [r] = await tx.insert(reviews).values({
      orderId: id, storeId: order.storeId, userId: req.user!.id,
      rating: input.rating, driverRating: order.driverId ? input.driverRating ?? null : null, comment: input.comment || null,
    }).returning();
    await tx.execute(sql`
      update stores set
        rating_avg = (select coalesce(avg(rating), 0) from reviews where store_id = ${order.storeId} and is_published),
        rating_count = (select count(*) from reviews where store_id = ${order.storeId} and is_published)
      where id = ${order.storeId}`);
    return r;
  });
  res.status(201).json({ review });
}));

// ---------------------------------------------------------------------------
// PedeAí Plus
// ---------------------------------------------------------------------------
customerRouter.get("/plus", requireAuth, ah(async (req, res) => {
  const [sub] = await db.select().from(subscriptions).where(eq(subscriptions.userId, req.user!.id))
    .orderBy(desc(subscriptions.createdAt)).limit(1);
  const active = await hasActivePlus(db, req.user!.id);
  let saved = 0;
  if (sub?.startsAt) {
    const [row] = await db.select({ saved: sql<number>`coalesce(sum(${stores.deliveryFee}), 0)::int` })
      .from(orders).innerJoin(stores, eq(stores.id, orders.storeId))
      .where(and(eq(orders.customerId, req.user!.id), eq(orders.status, "delivered"), eq(orders.deliveryFee, 0), sql`${orders.createdAt} >= ${sub.startsAt}`));
    saved = row?.saved ?? 0;
  }
  res.json({
    active,
    subscription: sub ?? null,
    monthlyPrice: config.plusMonthlyPrice,
    freeDeliveryMinOrder: config.plusFreeDeliveryMinOrder,
    estimatedSavings: saved,
  });
}));

customerRouter.post("/plus/subscribe", requireAuth, ah(async (req, res) => {
  const { paymentMethod } = parse(z.object({ paymentMethod: z.enum(PAYMENT_METHODS) }), req.body);
  const sub = await db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, req.user!.id)).for("update");
    if (await hasActivePlus(tx, req.user!.id)) throw conflict("Já é membro PedeAí Plus.", "ALREADY_PLUS");
    const [s] = await tx.insert(subscriptions).values({ userId: req.user!.id, status: "pending_payment" }).returning();
    await chargeSubscription(tx, req.user!.id, s.id, paymentMethod);
    const now = new Date();
    const ends = new Date(now); ends.setMonth(ends.getMonth() + 1);
    const [active] = await tx.update(subscriptions).set({ status: "active", startsAt: now, endsAt: ends, activatedBy: "payment" })
      .where(eq(subscriptions.id, s.id)).returning();
    return active;
  });
  res.status(201).json({ subscription: sub });
}));

customerRouter.post("/plus/cancel", requireAuth, ah(async (req, res) => {
  // mantém os benefícios até ao fim do período pago; só desliga a renovação
  const [sub] = await db.update(subscriptions).set({ autoRenew: false })
    .where(and(eq(subscriptions.userId, req.user!.id), eq(subscriptions.status, "active"))).returning();
  if (!sub) throw notFound("Não tem uma subscrição activa.");
  res.json({ subscription: sub });
}));
