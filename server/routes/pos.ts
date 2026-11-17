import { Router } from "express";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { orders } from "@shared/schema";
import { ah, idParam, notFound, parse } from "../lib/http";
import { changeStatus } from "../lib/orderFlow";
import { posAuth, posOrderPayload } from "../lib/pos";

/**
 * API para o sistema de cozinha / POS da loja.
 * Autenticação: cabeçalho "Authorization: Bearer pj_live_…" (gerada em Portal da loja → Loja → Integração POS).
 *   GET  /api/pos/orders?status=active|all   encomendas (activas por defeito; "all" = últimas 24 h)
 *   GET  /api/pos/orders/:id                  uma encomenda
 *   POST /api/pos/orders/:id/status          { status: accepted|rejected|preparing|ready, note? }
 */
export const posRouter = Router();
posRouter.use(posAuth);

const ACTIVE = ["pending", "accepted", "preparing", "ready"] as const;

posRouter.get("/orders", ah(async (req, res) => {
  const store = req.posStore!;
  const all = req.query.status === "all";
  const rows = await db.select().from(orders).where(and(
    eq(orders.storeId, store.id),
    all ? gte(orders.createdAt, new Date(Date.now() - 86_400_000)) : inArray(orders.status, [...ACTIVE]),
  )).orderBy(desc(orders.priorityFee), desc(orders.createdAt)).limit(200);
  res.json({ orders: await Promise.all(rows.map(posOrderPayload)) });
}));

posRouter.get("/orders/:id", ah(async (req, res) => {
  const [o] = await db.select().from(orders).where(and(eq(orders.id, idParam(req)), eq(orders.storeId, req.posStore!.id)));
  if (!o) throw notFound("Encomenda não encontrada");
  res.json({ order: await posOrderPayload(o) });
}));

posRouter.post("/orders/:id/status", ah(async (req, res) => {
  const store = req.posStore!;
  const { status, note } = parse(z.object({
    status: z.enum(["accepted", "rejected", "preparing", "ready"]),
    note: z.string().trim().max(300).optional().nullable(),
  }), req.body);
  const [o] = await db.select({ id: orders.id }).from(orders).where(and(eq(orders.id, idParam(req)), eq(orders.storeId, store.id)));
  if (!o) throw notFound("Encomenda não encontrada");
  // a API age em nome do dono da loja (mesmas regras de transição do portal)
  const order = await changeStatus(o.id, status, { kind: "store", userId: store.ownerId ?? undefined }, note);
  res.json({ order: await posOrderPayload(order) });
}));
