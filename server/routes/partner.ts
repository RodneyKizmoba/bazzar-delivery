import { Router, type Request } from "express";
import { and, asc, desc, eq, gte, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  menuItemInputSchema, menuItems, menuSections, optionGroups, options, orderItems, orders, reviews, storeUpdateSchema,
  stores, users, type Store,
} from "@shared/schema";
import { ah, forbidden, idParam, notFound, parse } from "../lib/http";
import { requireRole } from "../lib/auth";
import { changeStatus, confirmScheduled } from "../lib/orderFlow";
import { assertSafeWebhookUrl, newApiKey, newWebhookSecret, sendPosWebhook, withoutSecrets } from "../lib/pos";

export const partnerRouter = Router();
partnerRouter.use(requireRole("supplier"));

async function myStore(req: Request): Promise<Store> {
  const [s] = await db.select().from(stores).where(eq(stores.ownerId, req.user!.id)).orderBy(asc(stores.id)).limit(1);
  if (!s) throw notFound("Ainda não tem uma loja associada à sua conta.");
  return s;
}

partnerRouter.get("/store", ah(async (req, res) => {
  res.json({ store: withoutSecrets(await myStore(req)) });
}));

partnerRouter.patch("/store", ah(async (req, res) => {
  const s = await myStore(req);
  const input = parse(storeUpdateSchema, req.body);
  const [updated] = await db.update(stores).set(input).where(eq(stores.id, s.id)).returning();
  res.json({ store: withoutSecrets(updated) });
}));

// ---------------------------------------------------------------------------
// Encomendas da loja
// ---------------------------------------------------------------------------
partnerRouter.get("/orders", ah(async (req, res) => {
  const s = await myStore(req);
  const scope = req.query.scope === "history" ? "history" : "active";
  const finals = ["delivered", "cancelled", "rejected"] as const;
  const where = scope === "active"
    ? and(eq(orders.storeId, s.id), notInArray(orders.status, [...finals]))
    : and(eq(orders.storeId, s.id), inArray(orders.status, [...finals]));
  const rows = await db.select({ order: orders, customerName: users.fullName }).from(orders)
    .innerJoin(users, eq(users.id, orders.customerId))
    .where(where).orderBy(scope === "active" ? asc(orders.createdAt) : desc(orders.createdAt)).limit(200);
  const ids = rows.map((r) => r.order.id);
  const items = ids.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [];
  res.json({
    orders: rows.map((r) => ({
      ...r.order,
      customerName: r.customerName.split(" ")[0],
      items: items.filter((i) => i.orderId === r.order.id),
    })),
  });
}));

partnerRouter.post("/orders/:id/confirm", ah(async (req, res) => {
  const order = await confirmScheduled(idParam(req), req.user!.id);
  res.json({ order });
}));

partnerRouter.post("/orders/:id/status", ah(async (req, res) => {
  const { status, note } = parse(z.object({
    status: z.enum(["accepted", "rejected", "preparing", "ready"]),
    note: z.string().trim().max(300).optional().nullable(),
  }), req.body);
  const order = await changeStatus(idParam(req), status, { kind: "store", userId: req.user!.id }, note);
  res.json({ order });
}));

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------
partnerRouter.get("/menu", ah(async (req, res) => {
  const s = await myStore(req);
  const sections = await db.select().from(menuSections).where(eq(menuSections.storeId, s.id)).orderBy(asc(menuSections.sortOrder));
  const items = await db.select().from(menuItems).where(eq(menuItems.storeId, s.id)).orderBy(asc(menuItems.id));
  const ids = items.map((i) => i.id);
  const groups = ids.length ? await db.select().from(optionGroups).where(inArray(optionGroups.menuItemId, ids)).orderBy(asc(optionGroups.sortOrder)) : [];
  const gids = groups.map((g) => g.id);
  const opts = gids.length ? await db.select().from(options).where(inArray(options.groupId, gids)).orderBy(asc(options.id)) : [];
  res.json({
    sections,
    items: items.map((i) => ({
      ...i,
      optionGroups: groups.filter((g) => g.menuItemId === i.id).map((g) => ({ ...g, options: opts.filter((o) => o.groupId === g.id) })),
    })),
  });
}));

const sectionSchema = z.object({ name: z.string().trim().min(1).max(60), sortOrder: z.number().int().min(0).max(1000).default(0) });

partnerRouter.post("/sections", ah(async (req, res) => {
  const s = await myStore(req);
  const input = parse(sectionSchema, req.body);
  const [section] = await db.insert(menuSections).values({ ...input, storeId: s.id }).returning();
  res.status(201).json({ section });
}));

partnerRouter.put("/sections/:id", ah(async (req, res) => {
  const s = await myStore(req);
  const input = parse(sectionSchema.partial(), req.body);
  const [section] = await db.update(menuSections).set(input)
    .where(and(eq(menuSections.id, idParam(req)), eq(menuSections.storeId, s.id))).returning();
  if (!section) throw notFound("Secção não encontrada");
  res.json({ section });
}));

partnerRouter.delete("/sections/:id", ah(async (req, res) => {
  const s = await myStore(req);
  await db.delete(menuSections).where(and(eq(menuSections.id, idParam(req)), eq(menuSections.storeId, s.id)));
  res.status(204).end();
}));

async function assertSection(storeId: number, sectionId: number | null | undefined) {
  if (!sectionId) return;
  const [sec] = await db.select().from(menuSections).where(and(eq(menuSections.id, sectionId), eq(menuSections.storeId, storeId)));
  if (!sec) throw forbidden("Secção inválida.");
}

async function writeOptionGroups(tx: any, menuItemId: number, groups: z.infer<typeof menuItemInputSchema>["optionGroups"]) {
  await tx.delete(optionGroups).where(eq(optionGroups.menuItemId, menuItemId));
  for (const [idx, g] of groups.entries()) {
    const [grp] = await tx.insert(optionGroups).values({
      menuItemId, name: g.name, minSelect: g.minSelect, maxSelect: Math.min(g.maxSelect, g.options.length), sortOrder: idx,
    }).returning();
    await tx.insert(options).values(g.options.map((o) => ({ groupId: grp.id, name: o.name, priceDelta: o.priceDelta, isAvailable: o.isAvailable })));
  }
}

partnerRouter.post("/items", ah(async (req, res) => {
  const s = await myStore(req);
  const input = parse(menuItemInputSchema, req.body);
  await assertSection(s.id, input.sectionId);
  const item = await db.transaction(async (tx) => {
    const { optionGroups: groups, ...data } = input;
    const [it] = await tx.insert(menuItems).values({ ...data, sectionId: data.sectionId ?? null, storeId: s.id }).returning();
    await writeOptionGroups(tx, it.id, groups);
    return it;
  });
  res.status(201).json({ item });
}));

async function ownItem(storeId: number, id: number) {
  const [it] = await db.select().from(menuItems).where(eq(menuItems.id, id));
  if (!it || it.storeId !== storeId) throw notFound("Produto não encontrado");
  return it;
}

partnerRouter.put("/items/:id", ah(async (req, res) => {
  const s = await myStore(req);
  const id = idParam(req);
  await ownItem(s.id, id);
  const input = parse(menuItemInputSchema, req.body);
  await assertSection(s.id, input.sectionId);
  const item = await db.transaction(async (tx) => {
    const { optionGroups: groups, ...data } = input;
    // Nota: apagar opções não afecta encomendas antigas (as opções escolhidas ficam copiadas em order_items)
    const [it] = await tx.update(menuItems).set({ ...data, sectionId: data.sectionId ?? null }).where(eq(menuItems.id, id)).returning();
    await writeOptionGroups(tx, id, groups);
    return it;
  });
  res.json({ item });
}));

partnerRouter.patch("/items/:id/availability", ah(async (req, res) => {
  const s = await myStore(req);
  const id = idParam(req);
  await ownItem(s.id, id);
  const { isAvailable } = parse(z.object({ isAvailable: z.boolean() }), req.body);
  const [item] = await db.update(menuItems).set({ isAvailable }).where(eq(menuItems.id, id)).returning();
  res.json({ item });
}));

partnerRouter.delete("/items/:id", ah(async (req, res) => {
  const s = await myStore(req);
  const id = idParam(req);
  await ownItem(s.id, id);
  const [used] = await db.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.menuItemId, id)).limit(1);
  if (used) {
    // já aparece em encomendas: esconder em vez de apagar, para manter o histórico
    await db.update(menuItems).set({ isAvailable: false }).where(eq(menuItems.id, id));
    return res.json({ archived: true, message: "O produto já tem encomendas; foi marcado como indisponível." });
  }
  await db.delete(menuItems).where(eq(menuItems.id, id));
  res.status(204).end();
}));

// ---------------------------------------------------------------------------
// Avaliações e estatísticas
// ---------------------------------------------------------------------------
partnerRouter.get("/reviews", ah(async (req, res) => {
  const s = await myStore(req);
  const rows = await db.select({ review: reviews, author: users.fullName, orderNumber: orders.orderNumber })
    .from(reviews).innerJoin(users, eq(users.id, reviews.userId)).innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(eq(reviews.storeId, s.id)).orderBy(desc(reviews.createdAt)).limit(200);
  res.json({ reviews: rows.map((r) => ({ ...r.review, author: r.author.split(" ")[0], orderNumber: r.orderNumber })) });
}));

partnerRouter.post("/reviews/:id/reply", ah(async (req, res) => {
  const s = await myStore(req);
  const { reply } = parse(z.object({ reply: z.string().trim().min(1).max(1000) }), req.body);
  const [r] = await db.update(reviews).set({ reply, repliedAt: new Date() })
    .where(and(eq(reviews.id, idParam(req)), eq(reviews.storeId, s.id))).returning();
  if (!r) throw notFound("Avaliação não encontrada");
  res.json({ review: r });
}));

partnerRouter.get("/stats", ah(async (req, res) => {
  const s = await myStore(req);
  const since = new Date(Date.now() - 30 * 86_400_000);
  // meia-noite de hoje em Luanda (UTC+1)
  const shifted = new Date(Date.now() + 3_600_000);
  shifted.setUTCHours(0, 0, 0, 0);
  const startOfDay = new Date(shifted.getTime() - 3_600_000);
  const [today] = await db.select({
    orders: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.subtotal}), 0)::int`,
  }).from(orders).where(and(eq(orders.storeId, s.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, startOfDay)));
  const [month] = await db.select({
    orders: sql<number>`count(*)::int`,
    revenue: sql<number>`coalesce(sum(${orders.subtotal}), 0)::int`,
    avgTicket: sql<number>`coalesce(avg(${orders.subtotal}), 0)::int`,
  }).from(orders).where(and(eq(orders.storeId, s.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since)));
  const [cancel] = await db.select({ n: sql<number>`count(*)::int` }).from(orders)
    .where(and(eq(orders.storeId, s.id), inArray(orders.status, ["cancelled", "rejected"]), gte(orders.createdAt, since)));
  const top = await db.select({ name: orderItems.name, qty: sql<number>`sum(${orderItems.quantity})::int` })
    .from(orderItems).innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(eq(orders.storeId, s.id), eq(orders.status, "delivered"), gte(orders.deliveredAt, since)))
    .groupBy(orderItems.name).orderBy(desc(sql`sum(${orderItems.quantity})`)).limit(5);
  res.json({
    today, last30Days: { ...month, cancelledOrRejected: cancel.n },
    rating: { avg: Math.round(s.ratingAvg * 10) / 10, count: s.ratingCount },
    topItems: top,
  });
}));


// ---------------------------------------------------------------------------
// Relatórios (CSV para Excel) e integração com cozinha/POS
// ---------------------------------------------------------------------------
const csvCell = (v: unknown) => {
  const t = v === null || v === undefined ? "" : String(v);
  // evita fórmulas no Excel (=, +, -, @) e escapa aspas
  const safe = /^[=+\-@]/.test(t) ? `'${t}` : t;
  return /[";\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

partnerRouter.get("/reports/orders.csv", ah(async (req, res) => {
  const s = await myStore(req);
  const days = Math.min(366, Math.max(1, Number(req.query.days) || 30));
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.select().from(orders).where(and(eq(orders.storeId, s.id), gte(orders.createdAt, since))).orderBy(desc(orders.createdAt));
  const header = ["Número", "Data", "Estado", "Subtotal (Kz)", "Taxa de entrega (Kz)", "Desconto (Kz)", "Total (Kz)", "Pagamento", "Prioritária", "Talheres"];
  const lines = rows.map((o) => [
    o.orderNumber, o.createdAt.toISOString(), o.status, o.subtotal, o.deliveryFee, o.discount, o.total, o.paymentMethod,
    o.priorityFee > 0 ? "sim" : "não", o.cutlery ? "sim" : "não",
  ].map(csvCell).join(";"));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pedeja-encomendas-${days}d.csv"`);
  res.send("\uFEFF" + [header.join(";"), ...lines].join("\r\n"));
}));

partnerRouter.get("/integration", ah(async (req, res) => {
  const s = await myStore(req);
  res.json({ keyActive: !!s.posKeyHash, keyHint: s.posKeyHint, webhookUrl: s.posWebhookUrl });
}));

/** Gera (ou substitui) a chave de API. A chave completa só é mostrada uma vez. */
partnerRouter.post("/integration/key", ah(async (req, res) => {
  const s = await myStore(req);
  const k = newApiKey();
  await db.update(stores).set({ posKeyHash: k.hash, posKeyHint: k.hint }).where(eq(stores.id, s.id));
  res.status(201).json({ key: k.key, keyHint: k.hint });
}));

partnerRouter.delete("/integration/key", ah(async (req, res) => {
  const s = await myStore(req);
  await db.update(stores).set({ posKeyHash: null, posKeyHint: null }).where(eq(stores.id, s.id));
  res.json({ ok: true });
}));

/** Define o webhook. O segredo de assinatura só é mostrado quando é criado. */
partnerRouter.put("/integration/webhook", ah(async (req, res) => {
  const s = await myStore(req);
  const { url } = parse(z.object({ url: z.string().trim().max(500).nullable() }), req.body);
  if (!url) {
    await db.update(stores).set({ posWebhookUrl: null, posWebhookSecret: null }).where(eq(stores.id, s.id));
    return res.json({ webhookUrl: null });
  }
  const safe = await assertSafeWebhookUrl(url);
  const secret = s.posWebhookSecret ?? newWebhookSecret();
  await db.update(stores).set({ posWebhookUrl: safe, posWebhookSecret: secret }).where(eq(stores.id, s.id));
  res.json({ webhookUrl: safe, secret: s.posWebhookSecret ? undefined : secret });
}));

partnerRouter.post("/integration/webhook/test", ah(async (req, res) => {
  const s = await myStore(req);
  if (!s.posWebhookUrl) throw notFound("Ainda não definiu o webhook.");
  const status = await sendPosWebhook(s.id, "test");
  res.json({ delivered: status !== null && status >= 200 && status < 300, status });
}));
