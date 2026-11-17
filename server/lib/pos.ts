import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { lookup } from "dns/promises";
import { isIP } from "net";
import type { NextFunction, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { orderItems, orders, stores, users, type Order, type Store } from "@shared/schema";
import { HttpError } from "./http";

/**
 * Integração com sistemas de cozinha / POS das lojas:
 *  - chave de API por loja (guardada só como hash) para ler encomendas e mudar o estado;
 *  - webhook HTTPS opcional, assinado com HMAC-SHA256, avisa o POS de cada encomenda nova ou mudança de estado.
 */

/** Retira os segredos da integração antes de enviar a loja para o navegador. */
export function withoutSecrets<T extends Partial<Store>>(s: T) {
  const { posKeyHash, posWebhookSecret, ...rest } = s;
  return { ...rest, posKeyActive: !!posKeyHash, posWebhookActive: !!(rest.posWebhookUrl && posWebhookSecret) };
}

export const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");

export function newApiKey() {
  const key = `pj_live_${randomBytes(24).toString("hex")}`;
  return { key, hash: hashKey(key), hint: `${key.slice(0, 12)}…${key.slice(-4)}` };
}

export const newWebhookSecret = () => `whsec_${randomBytes(24).toString("hex")}`;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { posStore?: Store } }
}

/** Autenticação por "Authorization: Bearer pj_live_…". */
export async function posAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const m = (req.get("authorization") || "").match(/^Bearer\s+(pj_live_[a-f0-9]{48})$/i);
    if (!m) throw new HttpError(401, "Chave de API em falta ou inválida", "POS_UNAUTHORIZED");
    const h = hashKey(m[1]);
    const [store] = await db.select().from(stores).where(eq(stores.posKeyHash, h));
    if (!store || !store.posKeyHash || !timingSafeEqual(Buffer.from(store.posKeyHash), Buffer.from(h))) {
      throw new HttpError(401, "Chave de API em falta ou inválida", "POS_UNAUTHORIZED");
    }
    req.posStore = store;
    next();
  } catch (e) { next(e); }
}

/** Encomenda no formato enviado ao POS (sem dados de pagamento sensíveis). */
export async function posOrderPayload(order: Order) {
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const [cust] = await db.select({ fullName: users.fullName }).from(users).where(eq(users.id, order.customerId));
  return {
    id: order.id,
    number: order.orderNumber,
    status: order.status,
    createdAt: order.createdAt,
    scheduledFor: order.scheduledFor,
    customerFirstName: (cust?.fullName ?? "").split(" ")[0],
    notes: order.notes,
    cutlery: order.cutlery,
    priority: order.priorityFee > 0,
    paymentMethod: order.paymentMethod,
    items: items.map((it) => ({ name: it.name, quantity: it.quantity, unitPrice: it.unitPrice, options: it.selectedOptions, notes: it.specialInstructions })),
    subtotal: order.subtotal,
    total: order.total,
  };
}

const PRIVATE_V4 = [/^10\./, /^127\./, /^169\.254\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];
function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 6) {
    const v = ip.toLowerCase();
    if (v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80")) return true;
    const mapped = v.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]) : false;
  }
  return PRIVATE_V4.some((re) => re.test(ip));
}

/** Só aceita https:// para servidores públicos (evita que o webhook seja usado para aceder à rede interna). */
export async function assertSafeWebhookUrl(raw: string) {
  let u: URL;
  try { u = new URL(raw); } catch { throw new HttpError(400, "Endereço do webhook inválido", "WEBHOOK_URL_INVALID"); }
  if (u.protocol !== "https:") throw new HttpError(400, "O webhook tem de usar https://", "WEBHOOK_URL_INVALID");
  if (u.username || u.password) throw new HttpError(400, "O endereço não pode ter utilizador/palavra-passe", "WEBHOOK_URL_INVALID");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (/^localhost$|\.local$|\.internal$/i.test(host)) throw new HttpError(400, "O webhook tem de ser um servidor público", "WEBHOOK_URL_PRIVATE");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, "Não foi possível encontrar esse servidor", "WEBHOOK_URL_UNRESOLVED");
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new HttpError(400, "O webhook tem de ser um servidor público", "WEBHOOK_URL_PRIVATE");
  return u.toString();
}

export function signBody(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

/** Envia o webhook (fora da transacção, nunca bloqueia a encomenda). Devolve o código HTTP ou null. */
export async function sendPosWebhook(storeId: number, event: "order.created" | "order.status_changed" | "test", orderId?: number): Promise<number | null> {
  try {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId));
    if (!store?.posWebhookUrl || !store.posWebhookSecret) return null;
    const url = await assertSafeWebhookUrl(store.posWebhookUrl);
    let order: unknown = null;
    if (orderId) {
      const [o] = await db.select().from(orders).where(eq(orders.id, orderId));
      if (o) order = await posOrderPayload(o);
    }
    const body = JSON.stringify({ event, sentAt: new Date().toISOString(), storeId, order });
    const ts = Math.floor(Date.now() / 1000).toString();
    const r = await fetch(url, {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: {
        "content-type": "application/json",
        "user-agent": "PedeJa-Webhook/1.0",
        "x-pedeja-event": event,
        "x-pedeja-timestamp": ts,
        "x-pedeja-signature": `sha256=${signBody(store.posWebhookSecret, ts, body)}`,
      },
      body,
    });
    return r.status;
  } catch (e: any) {
    console.warn(`[pos] webhook da loja ${storeId} falhou:`, e?.message ?? e);
    return null;
  }
}
