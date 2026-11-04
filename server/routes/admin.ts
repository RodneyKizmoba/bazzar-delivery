import { Router } from "express";
import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { bannerInputSchema, banners, orders, promoCodes, promoInputSchema, stores, subscriptions, users, ORDER_STATUSES } from "@shared/schema";
import { ah, badRequest, conflict, idParam, notFound, parse } from "../lib/http";
import { publicUser, requireRole } from "../lib/auth";
import { changeStatus } from "../lib/orderFlow";

export const adminRouter = Router();
adminRouter.use(requireRole("admin"));

adminRouter.get("/stats", ah(async (_req, res) => {
  const since = new Date(Date.now() - 86_400_000);
  const [o] = await db.select({
    total: sql<number>`count(*)::int`,
    delivered: sql<number>`count(*) filter (where ${orders.status} = 'delivered')::int`,
    active: sql<number>`count(*) filter (where ${orders.status} in ('pending','accepted','preparing','ready','picked_up'))::int`,
    gmv: sql<number>`coalesce(sum(${orders.total}) filter (where ${orders.status} = 'delivered'), 0)::int`,
  }).from(orders).where(gte(orders.createdAt, since));
  const [pending] = await db.select({
    stores: sql<number>`(select count(*) from stores where not is_approved)::int`,
    drivers: sql<number>`(select count(*) from users where user_type = 'driver' and not is_approved)::int`,
    unassigned: sql<number>`(select count(*) from orders where driver_id is null and status in ('accepted','preparing','ready'))::int`,
  }).from(sql`(select 1) x`);
  const [u] = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  const [plus] = await db.select({ n: sql<number>`count(*)::int` }).from(subscriptions)
    .where(and(eq(subscriptions.status, "active"), gte(subscriptions.endsAt, new Date())));
  res.json({ last24h: o, pending, users: u.n, plusMembers: plus.n });
}));

// ---------------------------------------------------------------------------
// Encomendas
// ---------------------------------------------------------------------------
adminRouter.get("/orders", ah(async (req, res) => {
  const status = typeof req.query.status === "string" && (ORDER_STATUSES as readonly string[]).includes(req.query.status) ? req.query.status : null;
  const conds: SQL[] = [];
  if (status) conds.push(eq(orders.status, status as any));
  if (req.query.unassigned === "1") conds.push(sql`${orders.driverId} is null and ${orders.status} in ('accepted','preparing','ready')`);
  const rows = await db.select({ o: orders, storeName: stores.name, customerName: users.fullName }).from(orders)
    .innerJoin(stores, eq(stores.id, orders.storeId)).innerJoin(users, eq(users.id, orders.customerId))
    .where(conds.length ? and(...conds) : undefined).orderBy(desc(orders.createdAt)).limit(200);
  res.json({ orders: rows.map((r) => ({ ...r.o, storeName: r.storeName, customerName: r.customerName })) });
}));

adminRouter.post("/orders/:id/status", ah(async (req, res) => {
  const { status, note } = parse(z.object({ status: z.enum(ORDER_STATUSES), note: z.string().trim().max(300).optional().nullable() }), req.body);
  const order = await changeStatus(idParam(req), status, { kind: "admin", userId: req.user!.id }, note);
  res.json({ order });
}));

adminRouter.post("/orders/:id/assign-driver", ah(async (req, res) => {
  const { driverId } = parse(z.object({ driverId: z.number().int().positive().nullable() }), req.body);
  const id = idParam(req);
  if (driverId) {
    const [d] = await db.select().from(users).where(eq(users.id, driverId));
    if (!d || d.userType !== "driver" || !d.isApproved || !d.isActive) throw badRequest("Estafeta inválido.");
  }
  const o = await db.transaction(async (tx) => {
    if (driverId) {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, driverId)).for("update");
      const [busy] = await tx.select({ id: orders.id }).from(orders).where(and(
        eq(orders.driverId, driverId), ne(orders.id, id), inArray(orders.status, ["accepted", "preparing", "ready", "picked_up"]),
      ));
      if (busy) throw conflict("Este estafeta já tem uma entrega em curso.", "DRIVER_BUSY");
    }
    const [row] = await tx.update(orders).set({ driverId, updatedAt: new Date() })
      .where(and(eq(orders.id, id), inArray(orders.status, ["accepted", "preparing", "ready", "picked_up"]))).returning();
    if (!row) throw conflict("Só é possível atribuir estafeta a encomendas aceites e não terminadas.");
    return row;
  });
  res.json({ order: o });
}));

// ---------------------------------------------------------------------------
// Lojas e utilizadores
// ---------------------------------------------------------------------------
adminRouter.get("/stores", ah(async (req, res) => {
  const pendingOnly = req.query.pending === "1";
  const rows = await db.select({ s: stores, ownerName: users.fullName, ownerPhone: users.phone }).from(stores)
    .leftJoin(users, eq(users.id, stores.ownerId))
    .where(pendingOnly ? eq(stores.isApproved, false) : undefined).orderBy(desc(stores.createdAt)).limit(500);
  res.json({ stores: rows.map((r) => ({ ...r.s, ownerName: r.ownerName, ownerPhone: r.ownerPhone })) });
}));

adminRouter.patch("/stores/:id", ah(async (req, res) => {
  const input = parse(z.object({
    isApproved: z.boolean().optional(), isChain: z.boolean().optional(), isOpen: z.boolean().optional(), isHomeBusiness: z.boolean().optional(),
    deliveryFee: z.number().int().min(0).optional(), zonesServed: z.array(z.string().trim().min(2).max(60)).optional(),
  }), req.body);
  const [s] = await db.update(stores).set(input).where(eq(stores.id, idParam(req))).returning();
  if (!s) throw notFound("Loja não encontrada");
  res.json({ store: s });
}));

adminRouter.get("/users", ah(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const conds: SQL[] = [];
  if (q) conds.push(or(ilike(users.username, `%${q}%`), ilike(users.fullName, `%${q}%`), ilike(users.phone, `%${q}%`))!);
  if (["customer", "supplier", "driver", "admin"].includes(type)) conds.push(eq(users.userType, type as any));
  if (req.query.pending === "1") conds.push(eq(users.isApproved, false));
  const rows = await db.select().from(users).where(conds.length ? and(...conds) : undefined).orderBy(desc(users.createdAt)).limit(300);
  res.json({ users: rows.map((u) => ({ ...publicUser(u), isActive: u.isActive, createdAt: u.createdAt })) });
}));

adminRouter.patch("/users/:id", ah(async (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw badRequest("Não pode alterar a sua própria conta aqui.");
  const input = parse(z.object({ isApproved: z.boolean().optional(), isActive: z.boolean().optional() }), req.body);
  const [u] = await db.update(users).set(input).where(eq(users.id, id)).returning();
  if (!u) throw notFound("Utilizador não encontrado");
  res.json({ user: { ...publicUser(u), isActive: u.isActive } });
}));

adminRouter.get("/drivers", ah(async (_req, res) => {
  const rows = await db.select({
    id: users.id, fullName: users.fullName, phone: users.phone, isApproved: users.isApproved, isActive: users.isActive,
    activeOrder: sql<number | null>`(select id from orders where driver_id = ${users.id} and status in ('accepted','preparing','ready','picked_up') limit 1)`,
  }).from(users).where(eq(users.userType, "driver")).orderBy(users.fullName);
  res.json({ drivers: rows });
}));

// Plus activado manualmente (ex.: pago em numerário/transferência no escritório)
adminRouter.post("/users/:id/plus", ah(async (req, res) => {
  const id = idParam(req);
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!target) throw notFound("Utilizador não encontrado");
  const { months } = parse(z.object({ months: z.number().int().min(1).max(12).default(1) }), req.body ?? {});
  const now = new Date();
  const ends = new Date(now); ends.setMonth(ends.getMonth() + months);
  await db.update(subscriptions).set({ status: "cancelled" }).where(and(eq(subscriptions.userId, id), eq(subscriptions.status, "active")));
  const [sub] = await db.insert(subscriptions).values({ userId: id, status: "active", startsAt: now, endsAt: ends, activatedBy: "admin" }).returning();
  res.status(201).json({ subscription: sub });
}));

// ---------------------------------------------------------------------------
// Códigos promocionais
// ---------------------------------------------------------------------------
adminRouter.get("/promos", ah(async (_req, res) => {
  res.json({ promos: await db.select().from(promoCodes).orderBy(desc(promoCodes.createdAt)) });
}));

adminRouter.post("/promos", ah(async (req, res) => {
  const input = parse(promoInputSchema, req.body);
  const [exists] = await db.select({ id: promoCodes.id }).from(promoCodes).where(eq(promoCodes.code, input.code));
  if (exists) throw conflict("Já existe um código com esse nome.");
  const [p] = await db.insert(promoCodes).values({ ...input, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }).returning();
  res.status(201).json({ promo: p });
}));

adminRouter.patch("/promos/:id", ah(async (req, res) => {
  const { isActive } = parse(z.object({ isActive: z.boolean() }), req.body);
  const [p] = await db.update(promoCodes).set({ isActive }).where(eq(promoCodes.id, idParam(req))).returning();
  if (!p) throw notFound("Código não encontrado");
  res.json({ promo: p });
}));

// ---------------------------------------------------------------------------
// Publicidade (carrossel da página inicial)
// ---------------------------------------------------------------------------
adminRouter.get("/banners", ah(async (_req, res) => {
  res.json({ banners: await db.select().from(banners).orderBy(banners.sortOrder, banners.id) });
}));

adminRouter.post("/banners", ah(async (req, res) => {
  const input = parse(bannerInputSchema, req.body);
  const [b] = await db.insert(banners).values(input).returning();
  res.status(201).json({ banner: b });
}));

adminRouter.put("/banners/:id", ah(async (req, res) => {
  const input = parse(bannerInputSchema, req.body);
  const [b] = await db.update(banners).set(input).where(eq(banners.id, idParam(req))).returning();
  if (!b) throw notFound("Anúncio não encontrado");
  res.json({ banner: b });
}));

adminRouter.delete("/banners/:id", ah(async (req, res) => {
  await db.delete(banners).where(eq(banners.id, idParam(req)));
  res.status(204).end();
}));
