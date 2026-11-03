import { Router, type Request } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import { randomBytes, timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "../db";
import {
  cartLineSchema, groupItems, groupOrders, groupParticipants, menuItems, stores, PAYMENT_METHODS,
  type GroupOrder,
} from "@shared/schema";
import { ah, badRequest, conflict, forbidden, HttpError, notFound, parse } from "../lib/http";
import { requireAuth } from "../lib/auth";
import { priceLines } from "../lib/pricing";
import { createOrder } from "../lib/orderFlow";
import { storeCard } from "./catalog";

export const groupRouter = Router();

const GROUP_TTL_HOURS = 6;

function token(bytes = 12) { return randomBytes(bytes).toString("base64url"); }

function safeEq(a: string, b: string) {
  const ab = Buffer.from(a), bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

async function loadGroup(tok: string): Promise<GroupOrder> {
  if (!/^[A-Za-z0-9_-]{8,40}$/.test(tok)) throw notFound("Encomenda de grupo não encontrada");
  const [g] = await db.select().from(groupOrders).where(eq(groupOrders.token, tok));
  if (!g) throw notFound("Encomenda de grupo não encontrada");
  if (g.status === "open" && g.expiresAt < new Date()) {
    await db.update(groupOrders).set({ status: "cancelled" }).where(eq(groupOrders.id, g.id));
    g.status = "cancelled";
  }
  return g;
}

async function participantFromReq(req: Request, groupId: number) {
  const secret = String(req.header("x-group-secret") || "");
  const pid = Number(req.header("x-group-participant") || 0);
  if (!secret || !pid) throw new HttpError(401, "Junte-se ao grupo primeiro.", "NOT_PARTICIPANT");
  const [p] = await db.select().from(groupParticipants).where(and(eq(groupParticipants.id, pid), eq(groupParticipants.groupOrderId, groupId)));
  if (!p || !safeEq(p.secret, secret)) throw new HttpError(401, "Junte-se ao grupo primeiro.", "NOT_PARTICIPANT");
  return p;
}

async function groupView(g: GroupOrder) {
  const [store] = await db.select().from(stores).where(eq(stores.id, g.storeId));
  const parts = await db.select({ id: groupParticipants.id, name: groupParticipants.name, isHost: groupParticipants.isHost })
    .from(groupParticipants).where(eq(groupParticipants.groupOrderId, g.id)).orderBy(asc(groupParticipants.id));
  const items = await db.select().from(groupItems).where(eq(groupItems.groupOrderId, g.id)).orderBy(asc(groupItems.id));

  // preços actuais de cada linha (os itens esgotados aparecem com aviso)
  const priced = await Promise.all(items.map(async (it) => {
    try {
      const [line] = await priceLines(db, g.storeId, [{ menuItemId: it.menuItemId, quantity: it.quantity, optionIds: it.optionIds, specialInstructions: it.specialInstructions }]);
      return { ...it, name: line.menuItem.name, unitPrice: line.unitPrice, lineTotal: line.lineTotal, selectedOptions: line.selectedOptions, problem: null as string | null };
    } catch (e: any) {
      const [mi] = await db.select({ name: menuItems.name }).from(menuItems).where(eq(menuItems.id, it.menuItemId));
      return { ...it, name: mi?.name ?? "Produto", unitPrice: 0, lineTotal: 0, selectedOptions: [], problem: e.message as string };
    }
  }));
  return {
    group: { token: g.token, status: g.status, expiresAt: g.expiresAt, orderId: g.orderId, hostId: g.hostId },
    store: storeCard(store),
    participants: parts.map((p) => ({
      ...p,
      items: priced.filter((i) => i.participantId === p.id),
      subtotal: priced.filter((i) => i.participantId === p.id).reduce((s, i) => s + i.lineTotal, 0),
    })),
    subtotal: priced.reduce((s, i) => s + i.lineTotal, 0),
    itemCount: priced.reduce((s, i) => s + i.quantity, 0),
  };
}

// Criar grupo (anfitrião precisa de sessão iniciada; é ele quem paga)
groupRouter.post("/", requireAuth, ah(async (req, res) => {
  const { storeId } = parse(z.object({ storeId: z.number().int().positive() }), req.body);
  const [store] = await db.select().from(stores).where(and(eq(stores.id, storeId), eq(stores.isApproved, true)));
  if (!store) throw notFound("Loja não encontrada");
  const secret = token(24);
  const result = await db.transaction(async (tx) => {
    const [g] = await tx.insert(groupOrders).values({
      token: token(), hostId: req.user!.id, storeId,
      expiresAt: new Date(Date.now() + GROUP_TTL_HOURS * 3_600_000),
    }).returning();
    const [p] = await tx.insert(groupParticipants).values({
      groupOrderId: g.id, name: req.user!.fullName.split(" ")[0], secret, userId: req.user!.id, isHost: true,
    }).returning();
    return { g, p };
  });
  res.status(201).json({ token: result.g.token, participantId: result.p.id, secret });
}));

groupRouter.get("/:token", ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  res.json(await groupView(g));
}));

// Juntar-se com o link (não precisa de conta)
groupRouter.post("/:token/join", ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  if (g.status !== "open") throw conflict("Este grupo já não aceita participantes.", "GROUP_CLOSED");
  const { name } = parse(z.object({ name: z.string().trim().min(1).max(40) }), req.body);
  const parts = await db.select({ id: groupParticipants.id }).from(groupParticipants).where(eq(groupParticipants.groupOrderId, g.id));
  if (parts.length >= 30) throw conflict("O grupo está cheio (máx. 30 pessoas).");
  const secret = token(24);
  const [p] = await db.insert(groupParticipants).values({ groupOrderId: g.id, name, secret, userId: req.user?.id ?? null }).returning();
  res.status(201).json({ participantId: p.id, secret, name: p.name });
}));

groupRouter.post("/:token/items", ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  if (g.status !== "open") throw conflict("O cesto do grupo está fechado.", "GROUP_CLOSED");
  const p = await participantFromReq(req, g.id);
  const line = parse(cartLineSchema, req.body);
  await priceLines(db, g.storeId, [line]); // valida produto e opções
  const [item] = await db.insert(groupItems).values({
    groupOrderId: g.id, participantId: p.id, menuItemId: line.menuItemId, quantity: line.quantity,
    optionIds: line.optionIds, specialInstructions: line.specialInstructions || null,
  }).returning();
  res.status(201).json({ item });
}));

groupRouter.delete("/:token/items/:itemId", ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  if (g.status !== "open") throw conflict("O cesto do grupo está fechado.", "GROUP_CLOSED");
  const p = await participantFromReq(req, g.id);
  const itemId = Number(req.params.itemId);
  if (!Number.isInteger(itemId) || itemId <= 0) throw badRequest("ID inválido", "INVALID_ID");
  const [it] = await db.select().from(groupItems).where(and(eq(groupItems.id, itemId), eq(groupItems.groupOrderId, g.id)));
  if (!it) throw notFound("Item não encontrado");
  if (it.participantId !== p.id && !p.isHost) throw forbidden("Só pode remover os seus próprios itens.");
  await db.delete(groupItems).where(eq(groupItems.id, itemId));
  res.status(204).end();
}));

function assertHost(req: Request, g: GroupOrder) {
  if (!req.user || req.user.id !== g.hostId) throw forbidden("Só o anfitrião pode fazer isto.");
}

groupRouter.post("/:token/lock", requireAuth, ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  assertHost(req, g);
  const { locked } = parse(z.object({ locked: z.boolean() }), req.body);
  if (g.status !== "open" && g.status !== "locked") throw conflict("Este grupo já foi finalizado.");
  await db.update(groupOrders).set({ status: locked ? "locked" : "open" }).where(eq(groupOrders.id, g.id));
  res.json({ status: locked ? "locked" : "open" });
}));

groupRouter.post("/:token/cancel", requireAuth, ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  assertHost(req, g);
  if (g.status === "ordered") throw conflict("A encomenda já foi feita; cancele-a na página da encomenda.");
  await db.update(groupOrders).set({ status: "cancelled" }).where(eq(groupOrders.id, g.id));
  res.json({ status: "cancelled" });
}));

const checkoutSchema = z.object({
  addressId: z.number().int().positive(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  notes: z.string().trim().max(500).optional().nullable(),
  scheduledFor: z.string().datetime().optional().nullable(),
  promoCode: z.string().trim().max(30).optional().nullable(),
  usePoints: z.number().int().min(0).optional().default(0),
});

groupRouter.post("/:token/checkout", requireAuth, ah(async (req, res) => {
  const g = await loadGroup(req.params.token);
  assertHost(req, g);
  if (g.status !== "open" && g.status !== "locked") throw conflict("Este grupo já foi finalizado ou cancelado.", "GROUP_CLOSED");
  const input = parse(checkoutSchema, req.body);

  // fechar o cesto antes de criar a encomenda (ninguém adiciona durante o checkout)
  // passagem atómica para "checking_out": um segundo pedido simultâneo não encontra o grupo disponível
  const [locked] = await db.update(groupOrders).set({ status: "checking_out" })
    .where(and(eq(groupOrders.id, g.id), inArray(groupOrders.status, ["open", "locked"]))).returning();
  if (!locked) throw conflict("Esta encomenda de grupo já está a ser finalizada.", "GROUP_CHECKOUT_IN_PROGRESS");
  const rows = await db.select({ it: groupItems, name: groupParticipants.name }).from(groupItems)
    .innerJoin(groupParticipants, eq(groupParticipants.id, groupItems.participantId))
    .where(eq(groupItems.groupOrderId, g.id)).orderBy(asc(groupItems.id));
  if (!rows.length) {
    await db.update(groupOrders).set({ status: "open" }).where(eq(groupOrders.id, g.id));
    throw badRequest("O cesto do grupo está vazio.", "EMPTY_CART");
  }
  try {
    const order = await createOrder({
      user: req.user!,
      storeId: locked.storeId,
      lines: rows.map((r) => ({
        menuItemId: r.it.menuItemId, quantity: r.it.quantity, optionIds: r.it.optionIds,
        specialInstructions: r.it.specialInstructions, addedBy: r.name,
      })),
      addressId: input.addressId,
      paymentMethod: input.paymentMethod,
      notes: input.notes,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : null,
      promoCode: input.promoCode,
      usePoints: input.usePoints,
      groupOrderId: g.id,
    });
    await db.update(groupOrders).set({ status: "ordered", orderId: order.id }).where(eq(groupOrders.id, g.id));
    res.status(201).json({ order });
  } catch (e) {
    await db.update(groupOrders).set({ status: g.status }).where(eq(groupOrders.id, g.id));
    throw e;
  }
}));
