import { Router } from "express";
import { and, desc, eq, gte, ilike, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { ADMIN_PERMS, bannerInputSchema, banners, orders, promoCodes, promoInputSchema, rides, stores, subscriptions, taxiDrivers, users, ORDER_STATUSES, RIDE_STATUSES, STORE_PLANS } from "@shared/schema";
import { ah, badRequest, conflict, HttpError, idParam, notFound, parse } from "../lib/http";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { adminAudit, type AdminPerm } from "@shared/schema";
import { hasAdminPerm, isOwner, publicUser, requireAdminPerm, requireRole } from "../lib/auth";
import { adminNetworkGate, auditAdminWrites, require2faSetup } from "../lib/adminSecurity";
import { changeStatus } from "../lib/orderFlow";
import { STORE_THEME_IDS } from "@shared/themes";
import { withoutSecrets } from "../lib/pos";
import { closeOffersOnClaim, redispatch, riderPayQuote } from "../lib/dispatchEngine";
import { account } from "../lib/settlement";
import { markPayout, runWeeklyPayouts } from "../lib/payouts";
import { adsOf, buyAd, cancelAd } from "../lib/ads";
import { generateInvoices, getInvoice, listInvoices, setAgtNumber, voidInvoice } from "../lib/invoices";
import { commissionRateFor } from "../lib/commission";
import { nextPayday } from "../lib/fees";
import { config } from "../config";
import { ledgerEntries } from "@shared/schema";
import { publishOffer, publishOrder } from "../lib/realtime";

export const adminRouter = Router();
// 1) endereço e ligação (antes do login, para não revelar nada fora do endereço do admin)
adminRouter.use(adminNetworkGate);
adminRouter.use(requireRole("admin"));
// 2) verificação em dois passos activada  3) tudo o que se altera fica registado
adminRouter.use(require2faSetup);
adminRouter.use(auditAdminWrites);

// Equipa: cada área do portal só para quem tem essa permissão (o dono tem todas)
const AREAS: [RegExp, AdminPerm | "owner" | null][] = [
  [/^\/stats$/, null], // resumo: toda a equipa
  [/^\/charts/, "finance"],
  [/^\/(orders|dispatch|rides)(\/|$)/, "orders"],
  [/^\/(finance|ledger|payouts|invoices)(\/|\.|$)/, "finance"],
  [/^\/(stores|users|drivers)(\/|$)/, "people"],
  [/^\/(promos|banners|ads)(\/|$)/, "marketing"],
  [/^\/staff(\/|$)/, "owner"],
  [/^\/audit(\/|$)/, "owner"],
];
adminRouter.use((req, res, next) => {
  const u = req.user!;
  // a lista de lojas também serve ao marketing (oferecer destaques)
  if (req.method === "GET" && req.path === "/stores" && hasAdminPerm(u, "marketing")) return next();
  const area = AREAS.find(([re]) => re.test(req.path));
  if (!area) return requireAdminPerm("owner")(req, res, next); // área nova: só o dono, até ser classificada
  if (area[1] === null) return next();
  return requireAdminPerm(area[1])(req, res, next);
});

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
// Gráficos: vendas, receita PedeJá, encomendas, crescimento (dias de Luanda)
// ---------------------------------------------------------------------------
// receita PedeJá numa encomenda entregue: comissão + taxas do cliente − descontos − pagamento ao estafeta
const REVENUE = sql`(coalesce(o.commission_amount,0) + o.service_fee + o.small_order_fee + o.priority_fee - o.discount
  + case when o.fulfilment = 'delivery' then o.delivery_fee - (coalesce(o.rider_earning,0) - o.rider_tip) else 0 end)`;
const LU = sql`interval '1 hour'`; // Luanda = UTC+1 (sem horário de verão)

adminRouter.get("/charts", ah(async (req, res) => {
  const days = [7, 30, 90].includes(Number(req.query.days)) ? Number(req.query.days) : 30;
  const daily = await db.execute(sql`
    with d as (select generate_series((now() + ${LU})::date - ${days - 1}::int, (now() + ${LU})::date, interval '1 day')::date as day)
    select to_char(d.day, 'YYYY-MM-DD') as day,
      coalesce(x.orders, 0)::int as orders, coalesce(x.delivered, 0)::int as delivered, coalesce(x.cancelled, 0)::int as cancelled,
      coalesce(x.gmv, 0)::int as gmv, coalesce(x.revenue, 0)::int as revenue,
      coalesce(c.n, 0)::int as "newCustomers", coalesce(r.n, 0)::int as "newRiders", coalesce(s.n, 0)::int as "newStores"
    from d
    left join (
      select (o.created_at + ${LU})::date as day, count(*) as orders,
        count(*) filter (where o.status = 'delivered') as delivered,
        count(*) filter (where o.status in ('cancelled','rejected')) as cancelled,
        sum(o.total) filter (where o.status = 'delivered') as gmv,
        sum(${REVENUE}) filter (where o.status = 'delivered' and o.settled_at is not null) as revenue
      from orders o where o.created_at >= now() - ${days} * interval '1 day' - interval '1 day' group by 1
    ) x on x.day = d.day
    left join (select (created_at + ${LU})::date as day, count(*) as n from users where user_type = 'customer' group by 1) c on c.day = d.day
    left join (select (created_at + ${LU})::date as day, count(*) as n from users where user_type = 'driver' group by 1) r on r.day = d.day
    left join (select (created_at + ${LU})::date as day, count(*) as n from stores group by 1) s on s.day = d.day
    order by d.day`);
  const period = (offset: number) => sql`o.created_at >= now() - ${days * (offset + 1)} * interval '1 day' and o.created_at < now() - ${days * offset} * interval '1 day'`;
  const totalsQ = (offset: number) => db.execute(sql`
    select count(*)::int as orders, count(*) filter (where o.status = 'delivered')::int as delivered,
      coalesce(sum(o.total) filter (where o.status = 'delivered'), 0)::int as gmv,
      coalesce(sum(${REVENUE}) filter (where o.status = 'delivered' and o.settled_at is not null), 0)::int as revenue,
      coalesce(round(avg(o.subtotal) filter (where o.status = 'delivered')), 0)::int as "avgBasket"
    from orders o where ${period(offset)}`);
  const [cur, prev] = await Promise.all([totalsQ(0), totalsQ(1)]);
  const topStores = await db.execute(sql`
    select s.id, s.name, s.store_type as "storeType", count(*)::int as orders, coalesce(sum(o.total), 0)::int as gmv
    from orders o join stores s on s.id = o.store_id
    where o.status = 'delivered' and ${period(0)} group by s.id order by gmv desc limit 8`);
  const byHour = await db.execute(sql`
    select h as hour, coalesce(x.n, 0)::int as orders from generate_series(0, 23) h
    left join (select extract(hour from o.created_at + ${LU})::int as hr, count(*) as n from orders o where ${period(0)} group by 1) x on x.hr = h
    order by h`);
  const split = await db.execute(sql`
    select 'payment' as kind, o.payment_method as key, count(*)::int as n from orders o where ${period(0)} group by 2
    union all
    select 'fulfilment', o.fulfilment, count(*)::int from orders o where ${period(0)} group by 2`);
  res.json({
    days, daily: daily.rows, totals: cur.rows[0], previous: prev.rows[0],
    topStores: topStores.rows, byHour: byHour.rows,
    payment: (split.rows as any[]).filter((r) => r.kind === "payment").map((r) => ({ key: r.key, n: r.n })),
    fulfilment: (split.rows as any[]).filter((r) => r.kind === "fulfilment").map((r) => ({ key: r.key, n: r.n })),
  });
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
    deliveryFees: sql<number>`coalesce(sum(${orders.deliveryFee}),0)::int`,
    serviceFees: sql<number>`coalesce(sum(${orders.serviceFee}),0)::int`,
    smallOrderFees: sql<number>`coalesce(sum(${orders.smallOrderFee}),0)::int`,
    tips: sql<number>`coalesce(sum(${orders.riderTip}),0)::int`,
    priorityFees: sql<number>`coalesce(sum(${orders.priorityFee}),0)::int`,
    discounts: sql<number>`coalesce(sum(${orders.discount}),0)::int`,
    riderPay: sql<number>`coalesce(sum(${orders.riderEarning}),0)::int`,
    storePay: sql<number>`coalesce(sum(${orders.storeEarning}),0)::int`,
  }).from(orders).where(and(eq(orders.status, "delivered"), gte(orders.deliveredAt, since)));
  const storeRows = await db.execute(sql`
    select s.id, s.name, s.payout_method as "payoutMethod", s.payout_reference as "payoutReference",
      s.commission_pct::float as "commissionPct", s.commission_pct is not null as "customCommission",
      s.store_type as "storeType", s.plan, s.counter_price as "counterPrice", s.commission_free_until as "commissionFreeUntil",
      coalesce((select sum(l.amount) from ledger_entries l where l.party_type = 'store' and l.party_id = s.id), 0)::int as balance
    from stores s where s.is_approved order by balance desc, s.name`);
  const riderRows = await db.execute(sql`
    select u.id, u.full_name as name, u.phone,
      coalesce((select sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id), 0)::int as balance,
      greatest(0, coalesce((select -sum(l.amount) from ledger_entries l where l.party_type = 'driver' and l.party_id = u.id
        and l.kind in ('cash_collected','cash_deposit')), 0))::int as "cashHeld"
    from users u where u.user_type = 'driver' and u.is_approved order by "cashHeld" desc, u.full_name`);
  res.json({
    // receita PedeJá = comissão + taxas do cliente (entrega, serviço, pequena, prioridade) − descontos − pagamento aos estafetas (sem gorjetas)
    days, totals: { ...t, platformNet: t.commission + t.deliveryFees + t.serviceFees + t.smallOrderFees + t.priorityFees - t.discounts - (t.riderPay - t.tips) },
    defaultCommissionPct: config.commissionPct, riderCashLimit: config.riderCashLimit,
    // comissão efectiva de cada loja: tipo de negócio + plano (ou a negociada), com o compromisso de preço e o 1.º mês
    stores: (storeRows.rows as any[]).map(({ storeType, plan, counterPrice, commissionFreeUntil, ...r }) => ({
      ...r, plan, commissionPct: commissionRateFor({ storeType, plan, counterPrice, commissionPct: r.commissionPct, commissionFreeUntil: commissionFreeUntil ? new Date(commissionFreeUntil) : null }, "delivery"),
    })),
    riders: riderRows.rows,
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

// ---------------------------------------------------------------------------
// Pagamentos (semanais à terça + levantamentos imediatos): o admin transfere e marca como pago
// ---------------------------------------------------------------------------
async function payoutRows(status?: string) {
  const r = await db.execute(sql`
    select p.id, p.party_type as "partyType", p.party_id as "partyId", p.kind, p.status, p.amount, p.fee, p.method, p.account,
      p.period_end as "periodEnd", p.bank_reference as "bankReference", p.created_at as "createdAt", p.paid_at as "paidAt",
      coalesce(s.name, u.full_name) as name
    from payouts p
      left join stores s on p.party_type = 'store' and s.id = p.party_id
      left join users u on p.party_type = 'driver' and u.id = p.party_id
    where ${status ? sql`p.status = ${status}` : sql`true`}
    order by p.status = 'pending' desc, p.id desc limit 300`);
  return r.rows.map((x: any) => Object.fromEntries(Object.entries(x).map(([k, v]) =>
    [k, typeof v === "string" && /^\d{4}-\d\d-\d\d[ T]\d\d:\d\d:\d\d(\.\d+)?$/.test(v) ? v.replace(" ", "T") + "Z" : v])));
}

adminRouter.get("/payouts", ah(async (req, res) => {
  const status = typeof req.query.status === "string" && ["pending", "paid", "failed"].includes(req.query.status) ? req.query.status : undefined;
  res.json({ payouts: await payoutRows(status), nextPayday: nextPayday(new Date()), weekday: config.payoutWeekday });
}));

/** Ficheiro para o banco: transferências pendentes. */
adminRouter.get("/payouts.csv", ah(async (_req, res) => {
  const rows = await payoutRows("pending");
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["id", "tipo", "nome", "metodo", "conta", "valor_kz", "taxa_kz", "criado"].join(",")]
    .concat(rows.map((p: any) => [p.id, p.partyType === "store" ? "loja" : "estafeta", p.name, p.method, p.account, p.amount, p.fee, p.createdAt].map(esc).join(",")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pedeja-pagamentos-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send("\uFEFF" + lines.join("\n"));
}));

adminRouter.post("/payouts/run-weekly", ah(async (req, res) => {
  // só com ALLOW_TEST_CLOCK=1 (testes) se pode simular outra data; em uso real é sempre "agora"
  const asOf = process.env.ALLOW_TEST_CLOCK === "1" && typeof req.body?.asOf === "string" ? new Date(req.body.asOf) : new Date();
  if (Number.isNaN(asOf.getTime())) throw badRequest("Data inválida.");
  const r = await runWeeklyPayouts(asOf);
  res.json({ periodEnd: r.periodEnd, created: r.created.length, missingAccount: r.missingAccount });
}));

adminRouter.post("/payouts/:id/:action", ah(async (req, res) => {
  const action = req.params.action;
  if (action !== "paid" && action !== "failed") throw notFound();
  const { bankReference } = parse(z.object({ bankReference: z.string().trim().max(80).optional().nullable() }), req.body);
  if (action === "paid" && !bankReference) throw badRequest("Indique a referência da transferência.", "REFERENCE_REQUIRED");
  res.json({ payout: await markPayout(idParam(req), action, bankReference || null) });
}));

// Publicidade: todas as campanhas, oferecer dias e cancelar
adminRouter.get("/ads", ah(async (_req, res) => {
  res.json({ ads: await adsOf(), pricePerDay: config.adPricePerDay, maxSlots: config.adMaxSlots });
}));
adminRouter.post("/ads", ah(async (req, res) => {
  const b = parse(z.object({ storeId: z.number().int().positive(), days: z.number().int(), free: z.boolean().default(true) }), req.body);
  res.status(201).json({ ad: await buyAd(b.storeId, b.days, req.user!.id, b.free) });
}));
adminRouter.post("/ads/:id/cancel", ah(async (req, res) => {
  res.json({ ad: await cancelAd(idParam(req), req.user!.id) });
}));

// ---------------------------------------------------------------------------
// Equipa (só o dono): contas de admin com acesso limitado
// ---------------------------------------------------------------------------
const staffOut = (u: typeof users.$inferSelect) => ({
  id: u.id, username: u.username, fullName: u.fullName, phone: u.phone, isActive: u.isActive, adminPerms: u.adminPerms, isOwner: !u.adminPerms,
  createdAt: u.createdAt, lastLoginAt: u.lastLoginAt, twoFactor: !!u.totpEnabledAt,
});

/** Registo de actividade da equipa (só o dono). */
adminRouter.get("/audit", ah(async (req, res) => {
  const userId = Number(req.query.userId) || null;
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const rows = await db.select().from(adminAudit)
    .where(and(userId ? eq(adminAudit.userId, userId) : sql`true`, q ? sql`(${adminAudit.action} ilike ${"%" + q + "%"} or ${adminAudit.username} ilike ${"%" + q + "%"})` : sql`true`))
    .orderBy(desc(adminAudit.id)).limit(300);
  res.json({ entries: rows });
}));
const permsSchema = z.array(z.enum(ADMIN_PERMS)).min(1, "Escolha pelo menos uma área.").max(ADMIN_PERMS.length);

adminRouter.get("/staff", ah(async (_req, res) => {
  const rows = await db.select().from(users).where(eq(users.userType, "admin")).orderBy(users.createdAt);
  res.json({ staff: rows.map(staffOut), perms: ADMIN_PERMS });
}));

adminRouter.post("/staff", ah(async (req, res) => {
  const b = parse(z.object({
    fullName: z.string().trim().min(2).max(80),
    username: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,30}$/, "Utilizador: 3–30 letras minúsculas, números, . _ -"),
    phone: z.string().trim().regex(/^\+?\d{9,15}$/, "Telefone inválido"),
    password: z.string().min(12, "A palavra-passe da equipa tem pelo menos 12 caracteres").max(128),
    perms: permsSchema,
  }), req.body);
  const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.username, b.username));
  if (exists) throw conflict("Esse nome de utilizador já existe.", "USERNAME_TAKEN");
  const [u] = await db.insert(users).values({
    username: b.username, passwordHash: await bcrypt.hash(b.password, 12), fullName: b.fullName, phone: b.phone,
    userType: "admin", adminPerms: [...new Set(b.perms)], referralCode: "STAFF" + randomBytes(4).toString("hex").toUpperCase(),
  }).returning();
  res.status(201).json({ member: staffOut(u) });
}));

adminRouter.patch("/staff/:id", ah(async (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw badRequest("Não pode alterar a sua própria conta aqui.");
  const b = parse(z.object({
    perms: permsSchema.optional(), isActive: z.boolean().optional(), reset2fa: z.literal(true).optional(),
    password: z.string().min(12, "A palavra-passe da equipa tem pelo menos 12 caracteres").max(128).optional(),
  }), req.body);
  const [t] = await db.select().from(users).where(eq(users.id, id));
  if (!t || t.userType !== "admin") throw notFound("Membro da equipa não encontrado");
  if (!t.adminPerms) throw badRequest("A conta do dono não pode ser alterada aqui.", "OWNER_ACCOUNT");
  const [u] = await db.update(users).set({
    ...(b.perms ? { adminPerms: [...new Set(b.perms)] } : {}),
    ...(b.isActive !== undefined ? { isActive: b.isActive } : {}),
    ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 12) } : {}),
    // telemóvel perdido: volta a configurar a verificação em dois passos no próximo login
    ...(b.reset2fa ? { totpSecret: null, totpEnabledAt: null, totpRecovery: null, totpLastStep: null } : {}),
  }).where(eq(users.id, id)).returning();
  // desactivado ou palavra-passe nova: termina as sessões abertas dessa pessoa
  if (b.isActive === false || b.password || b.reset2fa) await db.execute(sql`delete from sessions where (sess->>'userId')::int = ${id}`).catch(() => {});
  res.json({ member: staffOut(u) });
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
    where o.driver_id is null and o.fulfilment = 'delivery' and o.status in ('accepted','preparing','ready')
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
      .where(and(eq(orders.id, id), eq(orders.fulfilment, "delivery"), inArray(orders.status, ["accepted", "preparing", "ready", "picked_up"]))).returning();
    if (!row) throw conflict("Só é possível atribuir estafeta a entregas PedeJá aceites e não terminadas.");
    if (driverId) {
      const pay = await riderPayQuote(tx, row, driverId);
      Object.assign(row, (await tx.update(orders).set({ riderPay: pay.total, riderPayDetail: pay }).where(eq(orders.id, id)).returning())[0]);
    }
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
    .where(and(eq(stores.isSystem, false), pendingOnly ? eq(stores.isApproved, false) : undefined)).orderBy(desc(stores.createdAt)).limit(500);
  res.json({ stores: rows.map((r) => ({ ...withoutSecrets(r.s), ownerName: r.ownerName, ownerPhone: r.ownerPhone, effectiveCommissionPct: commissionRateFor(r.s, "delivery") })) });
}));

adminRouter.patch("/stores/:id", ah(async (req, res) => {
  const input = parse(z.object({
    isApproved: z.boolean().optional(), isChain: z.boolean().optional(), isOpen: z.boolean().optional(), isHomeBusiness: z.boolean().optional(),
    deliveryFee: z.number().int().min(0).optional(), commissionPct: z.number().min(0).max(50).nullable().optional(), theme: z.enum(STORE_THEME_IDS).nullable().optional(), zonesServed: z.array(z.string().trim().min(2).max(60)).optional(),
    plan: z.enum(STORE_PLANS).optional(), counterPrice: z.boolean().optional(),
  }), req.body);
  const [before] = await db.select({ isApproved: stores.isApproved, freeUntil: stores.commissionFreeUntil }).from(stores).where(eq(stores.id, idParam(req)));
  if (!before) throw notFound("Loja não encontrada");
  // 1.º mês sem comissão: começa quando a loja é aprovada pela primeira vez
  const extra = input.isApproved && !before.isApproved && !before.freeUntil && config.commissionFreeDays > 0
    ? { commissionFreeUntil: new Date(Date.now() + config.commissionFreeDays * 86_400_000) } : {};
  const [s] = await db.update(stores).set({ ...input, ...extra }).where(eq(stores.id, idParam(req))).returning();
  if (!s) throw notFound("Loja não encontrada");
  res.json({ store: withoutSecrets(s) });
}));

// ---------------------------------------------------------------------------
// Notas de comissões (mensais, por loja)
// ---------------------------------------------------------------------------
adminRouter.get("/invoices", ah(async (req, res) => {
  const month = typeof req.query.month === "string" && req.query.month ? req.query.month : undefined;
  const storeId = req.query.storeId ? Number(req.query.storeId) : undefined;
  res.json({ invoices: await listInvoices({ month, storeId }), vatPct: config.invoiceVatPct });
}));
adminRouter.post("/invoices/generate", ah(async (req, res) => {
  const { month } = parse(z.object({ month: z.string() }), req.body);
  const created = await generateInvoices(month, req.user!.id);
  res.status(201).json({ created: created.map(({ lines, ...r }) => r) });
}));
adminRouter.get("/invoices/:id", ah(async (req, res) => {
  res.json({ invoice: await getInvoice(idParam(req)) });
}));
adminRouter.patch("/invoices/:id", ah(async (req, res) => {
  const { agtInvoiceNumber } = parse(z.object({ agtInvoiceNumber: z.string().trim().max(60).nullable() }), req.body);
  res.json({ invoice: await setAgtNumber(idParam(req), agtInvoiceNumber || null) });
}));
adminRouter.post("/invoices/:id/void", ah(async (req, res) => {
  res.json({ invoice: await voidInvoice(idParam(req), req.user!.id) });
}));

adminRouter.get("/users", ah(async (req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim().slice(0, 60) : "";
  const type = typeof req.query.type === "string" ? req.query.type : "";
  const conds: SQL[] = [];
  if (q) conds.push(or(ilike(users.username, `%${q}%`), ilike(users.fullName, `%${q}%`), ilike(users.phone, `%${q}%`))!);
  if (["customer", "supplier", "driver", "admin", "taxi"].includes(type)) conds.push(eq(users.userType, type as any));
  if (req.query.pending === "1") conds.push(eq(users.isApproved, false));
  const rows = await db.select().from(users).where(conds.length ? and(...conds) : undefined).orderBy(desc(users.createdAt)).limit(300);
  // motoristas de táxi: viatura e carta, para verificar antes de aprovar
  const taxiIds = rows.filter((u) => u.userType === "taxi").map((u) => u.id);
  const cars = taxiIds.length ? await db.select().from(taxiDrivers).where(inArray(taxiDrivers.userId, taxiIds)) : [];
  const carOf = new Map(cars.map((c) => [c.userId, c]));
  res.json({ users: rows.map((u) => ({ ...publicUser(u), isActive: u.isActive, createdAt: u.createdAt, taxi: carOf.get(u.id) ?? null })) });
}));

adminRouter.patch("/users/:id", ah(async (req, res) => {
  const id = idParam(req);
  if (id === req.user!.id) throw badRequest("Não pode alterar a sua própria conta aqui.");
  const input = parse(z.object({ isApproved: z.boolean().optional(), isActive: z.boolean().optional() }), req.body);
  const [target] = await db.select({ t: users.userType }).from(users).where(eq(users.id, id));
  if (target?.t === "admin" && !isOwner(req.user!)) throw new HttpError(403, "Só o dono pode alterar contas da equipa.", "OWNER_ONLY");
  const [u] = await db.update(users).set(input).where(eq(users.id, id)).returning();
  if (!u) throw notFound("Utilizador não encontrado");
  res.json({ user: { ...publicUser(u), isActive: u.isActive } });
}));

// ---------------------------------------------------------------------------
// Táxi: viagens (área "orders")
// ---------------------------------------------------------------------------
adminRouter.get("/rides", ah(async (req, res) => {
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const conds: SQL[] = [];
  if ((RIDE_STATUSES as readonly string[]).includes(status)) conds.push(eq(rides.status, status as any));
  if (req.query.sos === "1") conds.push(sql`${rides.sosAt} is not null`);
  const rows = await db.select().from(rides).where(conds.length ? and(...conds) : undefined).orderBy(desc(rides.id)).limit(200);
  const ids = Array.from(new Set(rows.flatMap((r) => [r.customerId, r.driverId]).filter((x): x is number => !!x)));
  const people = ids.length ? await db.select({ id: users.id, name: users.fullName, phone: users.phone }).from(users).where(inArray(users.id, ids)) : [];
  const who = new Map(people.map((p) => [p.id, p]));
  const [sum] = await db.select({
    rides: sql<number>`count(*) filter (where ${rides.status} = 'completed')::int`,
    gross: sql<number>`coalesce(sum(${rides.total}) filter (where ${rides.status} = 'completed'), 0)::int`,
    commission: sql<number>`coalesce(sum(${rides.commissionAmount}), 0)::int`,
    active: sql<number>`count(*) filter (where ${rides.status} in ('searching','accepted','arrived','in_progress'))::int`,
    noDriver: sql<number>`count(*) filter (where ${rides.status} = 'no_driver')::int`,
    sos: sql<number>`count(*) filter (where ${rides.sosAt} is not null and ${rides.status} in ('searching','accepted','arrived','in_progress'))::int`,
  }).from(rides).where(gte(rides.createdAt, new Date(Date.now() - 30 * 86_400_000)));
  res.json({
    summary: sum, commissionPct: config.taxiCommissionPct,
    rides: rows.map((r) => ({
      id: r.id, rideNumber: r.rideNumber, status: r.status, category: r.category, pickup: r.pickup, dropoff: r.dropoff,
      fare: r.fare, waitFee: r.waitFee, total: r.total, paymentMethod: r.paymentMethod, commissionAmount: r.commissionAmount,
      driverEarning: r.driverEarning, rating: r.rating, sosAt: r.sosAt, sosBy: r.sosBy, createdAt: r.createdAt, completedAt: r.completedAt,
      customer: who.get(r.customerId) ?? null, driver: r.driverId ? who.get(r.driverId) ?? null : null,
    })),
  });
}));

adminRouter.post("/rides/:id/cancel", ah(async (req, res) => {
  const { reason } = parse(z.object({ reason: z.string().trim().max(200).optional().nullable() }), req.body ?? {});
  const now = new Date();
  const [r] = await db.update(rides).set({ status: "cancelled", cancelledAt: now, cancelledBy: "admin", cancelReason: reason ?? "Cancelada pela PedeJá", total: 0, updatedAt: now })
    .where(and(eq(rides.id, idParam(req)), inArray(rides.status, ["searching", "accepted", "arrived", "no_driver"]))).returning();
  if (!r) throw conflict("Esta viagem já não pode ser cancelada.", "RIDE_NOT_CANCELLABLE");
  await db.execute(sql`update ride_offers set status = 'cancelled', responded_at = now() where ride_id = ${r.id} and status = 'pending'`);
  res.json({ ride: { id: r.id, status: r.status } });
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
