import { Router } from "express";
import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { bannerInputSchema, banners, orders, promoCodes, promoInputSchema, stores, subscriptions, users, ORDER_STATUSES } from "@shared/schema";
import { ah, badRequest, conflict, idParam, notFound, parse } from "../lib/http";
import { publicUser, requireRole } from "../lib/auth";
import { changeStatus } from "../lib/orderFlow";
import { STORE_THEME_IDS } from "@shared/themes";
import { withoutSecrets } from "../lib/pos";
import { closeOffersOnClaim, redispatch } from "../lib/dispatchEngine";
import { account } from "../lib/settlement";
import { config } from "../config";
import { ledgerEntries } from "@shared/schema";
import { publishOffer, publishOrder } from "../lib/realtime";

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

// ---------------------------------------------------------------------------
// Finanças: receita PedeJá, saldos de lojas e estafetas, pagamentos
// ---------------------------------------------------------------------------
adminRouter.get("/finance", ah(async (req, res) => {
  const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const [t] = await db.select({
    orders: sql<number>`count(*)::int`,
    gmv: sql<number>`coalesce(sum(${orders.total}),0)::int`,
    food: sql<number>`coalesce(sum(${orders.subtotal}),0)::int`,
    commission: sql<number>`coalesce(sum(${orders.commissionAmount}),0)::int`,
    priorityFees: sql<number>`coalesce(sum(${orders.priorityFee}),0)::int`,
    discounts: sql<number>`coalesce(sum(${orders.discount}),0)::int`,
    riderPay: sql<number>`coalesce(sum(${orders.riderEarning}),0)::int`,
    storePay: sql<number>`coalesce(sum(${orders.storeEarning}),0)::int`,
  }).from(orders).where(and(eq(orders.status, "delivered"), gte(orders.deliveredAt, since)));
  const storeRows = await db.execute(sql`
    select s.id, s.name, s.payout_method as "payoutMethod", s.payout_reference as "payoutReference",
      coalesce(s.commission_pct, ${config.commissionPct})::float as "commissionPct", s.commission_pct is not null as "customCommission",
      coalesce((select sum(l.amount) from ledger_entries l where l.party_type = 'store' and l.party_id = s.id), 0)::int as balance
    from stores s where s.is_approved order by balance desc, s.name`);
  const riderRows = await db.execute(sql`
    select u.id, u.full_name as name, u.phone,
      coalesce((select sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id), 0)::int as balance,
      greatest(0, coalesce((select -sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id
        and l.kind in ('cash_collected','cash_deposit')), 0))::int as "cashHeld"
    from users u where u.user_type = 'driver' and u.is_approved order by "cashHeld" desc, u.full_name`);
  res.json({
    days, totals: { ...t, platformNet: t.commission + t.priorityFees - t.discounts },
    defaultCommissionPct: config.commissionPct, riderCashLimit: config.riderCashLimit,
    stores: storeRows.rows, riders: riderRows.rows,
  });
}));

adminRouter.get("/finance/:type/:id", ah(async (req, res) => {
  const type = req.params.type === "store" ? "store" : req.params.type === "driver" ? "driver" : null;
  if (!type) throw notFound();
  res.json(await account(type, idParam(req), 200));
}));

/** Registar um pagamento à loja/estafeta, numerário entregue pelo estafeta, ou um ajuste. */
adminRouter.post("/ledger", ah(async (req, res) => {
  const b = parse(z.object({
    partyType: z.enum(["store", "driver"]), partyId: z.number().int().positive(),
    kind: z.enum(["payout", "cash_deposit", "adjustment"]),
    amount: z.number().int().refine((n) => n !== 0, "Valor não pode ser 0").refine((n) => Math.abs(n) <= 100_000_000, "Valor demasiado alto"),
    note: z.string().trim().max(300).optional().nullable(), reference: z.string().trim().max(80).optional().nullable(),
  }), req.body);
  if (b.kind === "cash_deposit" && b.partyType !== "driver") throw badRequest("Só estafetas entregam numerário.");
  if (b.kind !== "adjustment" && b.amount < 0) throw badRequest("Indique um valor positivo.");
  if (b.partyType === "store") {
    const [s] = await db.select({ id: stores.id }).from(stores).where(eq(stores.id, b.partyId));
    if (!s) throw notFound("Loja não encontrada");
  } else {
    const [u] = await db.select({ t: users.userType }).from(users).where(eq(users.id, b.partyId));
    if (!u || u.t !== "driver") throw notFound("Estafeta não encontrado");
  }
  // pagamento: a PedeJá pagou-lhes (saldo desce); numerário entregue: o estafeta pagou à PedeJá (dívida desce)
  const amount = b.kind === "payout" ? -b.amount : b.amount;
  const [entry] = await db.insert(ledgerEntries).values({
    partyType: b.partyType, partyId: b.partyId, kind: b.kind, amount, note: b.note || null, reference: b.reference || null, createdBy: req.user!.id,
  }).returning();
  res.status(201).json({ entry, ...(await account(b.partyType, b.partyId, 20)) });
}));

/** Centro de despacho: estafetas online, entregas à espera e últimas ofertas. */
adminRouter.get("/dispatch", ah(async (_req, res) => {
  const riders = await db.execute(sql`
    select u.id, u.full_name as "name", u.phone, p.is_online as "isOnline", p.latitude, p.longitude, p.location_at as "locationAt",
      (select o.id from orders o where o.driver_id = u.id and o.status in ('accepted','preparing','ready','picked_up') limit 1) as "currentOrderId"
    from users u left join driver_presence p on p.user_id = u.id
    where u.user_type = 'driver' and u.is_approved and u.is_active
    order by p.is_online desc nulls last, u.full_name`);
  const waiting = await db.execute(sql`
    select o.id, o.order_number as "orderNumber", o.status, s.name as "storeName", o.ready_estimate_at as "readyEstimateAt",
      o.dispatch_at as "dispatchAt", o.dispatch_round as "dispatchRound", o.dispatch_failed_at as "dispatchFailedAt", o.priority_fee > 0 as priority,
      (select d.driver_id from dispatch_offers d where d.order_id = o.id and d.status = 'pending' limit 1) as "offeredTo"
    from orders o join stores s on s.id = o.store_id
    where o.driver_id is null and o.status in ('accepted','preparing','ready')
    order by o.dispatch_failed_at nulls last, o.created_at`);
  const offers = await db.execute(sql`
    select d.id, d.order_id as "orderId", d.driver_id as "driverId", u.full_name as "driverName", d.status, d.round,
      d.distance_km as "distanceKm", d.payout, d.offered_at as "offeredAt", d.responded_at as "respondedAt"
    from dispatch_offers d join users u on u.id = d.driver_id order by d.id desc limit 50`);
  // SQL directo devolve "timestamp" sem fuso: marcar como UTC para o browser mostrar a hora de Luanda certa
  const utc = (rows: any[]) => rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) =>
    [k, typeof v === "string" && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?$/.test(v) ? v.replace(" ", "T") + "Z" : v])));
  res.json({ riders: utc(riders.rows), waiting: utc(waiting.rows), offers: utc(offers.rows) });
}));

adminRouter.post("/orders/:id/redispatch", ah(async (req, res) => {
  const order = await redispatch(idParam(req));
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
    const now = new Date();
    const [row] = await tx.update(orders).set(driverId
      ? { driverId, driverAssignedAt: now, driverAtStoreAt: null, updatedAt: now }
      // sem estafeta: o despacho automático volta a procurar
      : { driverId: null, driverAssignedAt: null, driverAtStoreAt: null, dispatchRound: 0, dispatchFailedAt: null, dispatchAt: now, updatedAt: now })
      .where(and(eq(orders.id, id), inArray(orders.status, ["accepted", "preparing", "ready", "picked_up"]))).returning();
    if (!row) throw conflict("Só é possível atribuir estafeta a encomendas aceites e não terminadas.");
    const gone = await closeOffersOnClaim(tx, id, driverId ?? -1);
    await tx.execute(sql`insert into order_events (order_id, status, actor_id, note) values (${id}, ${row.status}, ${req.user!.id}, ${driverId ? "Admin atribuiu estafeta" : "Admin retirou o estafeta"})`);
    return { row, gone };
  });
  for (const g of o.gone) publishOffer(g.driverId, id, g.offerId, "gone");
  publishOrder(o.row, "assigned");
  res.json({ order: o.row });
}));

// ---------------------------------------------------------------------------
// Lojas e utilizadores
// ---------------------------------------------------------------------------
adminRouter.get("/stores", ah(async (req, res) => {
  const pendingOnly = req.query.pending === "1";
  const rows = await db.select({ s: stores, ownerName: users.fullName, ownerPhone: users.phone }).from(stores)
    .leftJoin(users, eq(users.id, stores.ownerId))
    .where(pendingOnly ? eq(stores.isApproved, false) : undefined).orderBy(desc(stores.createdAt)).limit(500);
  res.json({ stores: rows.map((r) => ({ ...withoutSecrets(r.s), ownerName: r.ownerName, ownerPhone: r.ownerPhone })) });
}));

adminRouter.patch("/stores/:id", ah(async (req, res) => {
  const input = parse(z.object({
    isApproved: z.boolean().optional(), isChain: z.boolean().optional(), isOpen: z.boolean().optional(), isHomeBusiness: z.boolean().optional(),
    deliveryFee: z.number().int().min(0).optional(), commissionPct: z.number().min(0).max(50).nullable().optional(), theme: z.enum(STORE_THEME_IDS).nullable().optional(), zonesServed: z.array(z.string().trim().min(2).max(60)).optional(),
  }), req.body);
  const [s] = await db.update(stores).set(input).where(eq(stores.id, idParam(req))).returning();
  if (!s) throw notFound("Loja não encontrada");
  res.json({ store: withoutSecrets(s) });
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
