import type { IncomingMessage, Server } from "http";
import type { Duplex } from "stream";
import type { RequestHandler } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { stores, users, type Order } from "@shared/schema";

/**
 * Actualizações ao vivo (WebSocket em /ws), no mesmo servidor da API.
 *
 * Regras:
 *  - só aceita ligações com sessão iniciada e com Origin da própria app (evita que outro site use a sessão);
 *  - cada ligação entra só nos canais a que o utilizador tem direito, decididos pelo servidor
 *    (cliente: as suas encomendas; loja: a sua loja; estafeta: as suas entregas e a lista de disponíveis; admin: tudo);
 *  - os eventos só dizem "esta encomenda mudou" (id, estado, momento): os dados em si vêm sempre pela API,
 *    com as verificações de permissão de sempre — o WebSocket nunca é uma segunda porta para os dados;
 *  - os eventos saem depois de a alteração estar gravada (nunca mostram algo que não aconteceu);
 *  - se a ligação cair, a app volta a ligar e continua a consultar a API de vez em quando (redes móveis instáveis).
 */

type Channel = `user:${number}` | `store:${number}` | `driver:${number}` | "drivers" | "admin";
export type LiveEvent =
  | { type: "order"; id: number; status: string; at: string; step?: "assigned" | "at_store" | "at_customer" | "created" | "updated" }
  | { type: "location"; id: number; at: string }
  | { type: "hello"; channels: number };

const channels = new Map<string, Set<WebSocket>>();
const perUser = new Map<number, number>();
const MAX_SOCKETS_PER_USER = 6;
let wss: WebSocketServer | null = null;

function join(ws: WebSocket, ch: Channel) {
  let set = channels.get(ch);
  if (!set) channels.set(ch, (set = new Set()));
  set.add(ws);
}

function leaveAll(ws: WebSocket) {
  for (const [ch, set] of channels) {
    set.delete(ws);
    if (!set.size) channels.delete(ch);
  }
}

function originAllowed(req: IncomingMessage) {
  const origin = req.headers.origin;
  if (!origin) return false; // os navegadores enviam sempre Origin num WebSocket
  try {
    const o = new URL(origin);
    const host = (req.headers["x-forwarded-host"] as string | undefined) || req.headers.host;
    return o.host === host || config.appOrigins.includes(origin);
  } catch {
    return false;
  }
}

function reject(socket: Duplex, code: number, text: string) {
  socket.write(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

async function channelsFor(userId: number): Promise<Channel[] | null> {
  const [u] = await db.select().from(users).where(eq(users.id, userId));
  if (!u || !u.isActive) return null;
  const list: Channel[] = [`user:${u.id}`];
  if (u.userType === "admin") list.push("admin");
  if (u.userType === "driver") {
    list.push(`driver:${u.id}`);
    if (u.isApproved) list.push("drivers");
  }
  if (u.userType === "supplier") {
    const own = await db.select({ id: stores.id }).from(stores).where(eq(stores.ownerId, u.id));
    for (const s of own) list.push(`store:${s.id}`);
  }
  return list;
}

export function attachRealtime(server: Server, sessionMiddleware: RequestHandler) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 1024 });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const path = (req.url || "").split("?")[0];
    if (path !== "/ws") return; // outros upgrades (ex.: Vite em desenvolvimento) seguem o seu caminho
    if (!originAllowed(req)) return reject(socket, 403, "Forbidden");
    sessionMiddleware(req as any, {} as any, async () => {
      try {
        const userId = (req as any).session?.userId as number | undefined;
        if (!userId) return reject(socket, 401, "Unauthorized");
        if ((perUser.get(userId) ?? 0) >= MAX_SOCKETS_PER_USER) return reject(socket, 429, "Too Many Requests");
        const list = await channelsFor(userId);
        if (!list) return reject(socket, 401, "Unauthorized");
        wss!.handleUpgrade(req, socket, head, (ws) => {
          perUser.set(userId, (perUser.get(userId) ?? 0) + 1);
          for (const ch of list) join(ws, ch);
          (ws as any).isAlive = true;
          ws.on("pong", () => { (ws as any).isAlive = true; });
          ws.on("message", () => { /* os clientes só ouvem; mensagens recebidas são ignoradas */ });
          ws.on("close", () => {
            leaveAll(ws);
            const n = (perUser.get(userId) ?? 1) - 1;
            if (n <= 0) perUser.delete(userId); else perUser.set(userId, n);
          });
          send(ws, { type: "hello", channels: list.length });
        });
      } catch (e) {
        console.error("[ws]", e);
        reject(socket, 500, "Internal Server Error");
      }
    });
  });

  // batimento: fecha ligações mortas (telemóvel sem rede) a cada 25 s
  const beat = setInterval(() => {
    for (const ws of wss!.clients) {
      if (!(ws as any).isAlive) { ws.terminate(); continue; }
      (ws as any).isAlive = false;
      try { ws.ping(); } catch { /* fechada */ }
    }
  }, 25_000);
  wss.on("close", () => clearInterval(beat));
}

function send(ws: WebSocket, ev: LiveEvent) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(ev));
}

export function publish(chs: Channel[], ev: LiveEvent) {
  if (!wss) return;
  const sent = new Set<WebSocket>();
  for (const ch of chs) {
    for (const ws of channels.get(ch) ?? []) {
      if (sent.has(ws)) continue;
      sent.add(ws);
      send(ws, ev);
    }
  }
}

/** Avisa todos os envolvidos de que a encomenda mudou. Chamar só depois de gravar. */
export function publishOrder(order: Pick<Order, "id" | "status" | "customerId" | "storeId" | "driverId">, step?: Extract<LiveEvent, { type: "order" }>["step"]) {
  const chs: Channel[] = [`user:${order.customerId}`, `store:${order.storeId}`, "admin"];
  if (order.driverId) chs.push(`driver:${order.driverId}`);
  // a lista de entregas disponíveis muda quando uma encomenda entra, é atribuída ou sai dela
  if (["accepted", "preparing", "ready", "cancelled", "rejected"].includes(order.status) || step === "assigned") chs.push("drivers");
  publish(chs, { type: "order", id: order.id, status: order.status, at: new Date().toISOString(), step });
}

/** Nova posição do estafeta: só para o cliente da encomenda (e admin). */
export function publishLocation(order: Pick<Order, "id" | "customerId">) {
  publish([`user:${order.customerId}`, "admin"], { type: "location", id: order.id, at: new Date().toISOString() });
}

export function liveStats() {
  return { sockets: wss?.clients.size ?? 0, channels: channels.size };
}
