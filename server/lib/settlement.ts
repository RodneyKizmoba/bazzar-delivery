import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, type DbOrTx } from "../db";
import { config } from "../config";
import { ledgerEntries, orders, stores, type Order } from "@shared/schema";

/**
 * Acerto de contas (fase 3).
 *
 * Em cada entrega:
 *  - loja: recebe o valor da comida menos a comissão PedeJá (comissão da loja, ou COMMISSION_PCT);
 *  - estafeta: recebe a taxa de entrega + 100% da gorjeta;
 *  - PedeJá: fica com a comissão + taxa de prioridade, e paga os descontos (códigos promocionais e pontos);
 *  - numerário: o estafeta recebeu o total do cliente, por isso fica a dever esse valor à PedeJá
 *    (o "dinheiro em mão", que entrega depois).
 *
 * O livro de contas (ledger_entries) diz, para cada loja e estafeta: + a PedeJá deve-lhe, − ele deve à PedeJá.
 * Pagamentos e entregas de numerário são registados pelo admin; nada se apaga, corrige-se com um "ajuste".
 */

export function splitOrder(o: Pick<Order, "subtotal" | "deliveryFee" | "riderTip" | "priorityFee" | "discount" | "total">, pct: number) {
  const commission = Math.round((o.subtotal * pct) / 100);
  const storeEarning = o.subtotal - commission;
  const riderEarning = o.deliveryFee + o.riderTip;
  const platform = commission + o.priorityFee - o.discount;
  return { commission, storeEarning, riderEarning, platform };
}

/** Chamado dentro da transacção que marca a encomenda como entregue. Idempotente. */
export async function settleDeliveredOrder(tx: DbOrTx, order: Order) {
  if (order.settledAt) return;
  const [store] = await tx.select({ commissionPct: stores.commissionPct }).from(stores).where(eq(stores.id, order.storeId));
  const pct = store?.commissionPct ?? config.commissionPct;
  const s = splitOrder(order, pct);
  await tx.update(orders).set({
    commissionPct: pct, commissionAmount: s.commission, storeEarning: s.storeEarning,
    riderEarning: order.driverId ? s.riderEarning : 0, settledAt: new Date(),
  }).where(eq(orders.id, order.id));
  const rows: (typeof ledgerEntries.$inferInsert)[] = [
    { partyType: "store", partyId: order.storeId, orderId: order.id, kind: "order_earning", amount: s.storeEarning,
      note: `${order.orderNumber}: comida ${order.subtotal} Kz − comissão ${pct}% (${s.commission} Kz)` },
  ];
  if (order.driverId) {
    rows.push({ partyType: "driver", partyId: order.driverId, orderId: order.id, kind: "order_earning", amount: s.riderEarning,
      note: `${order.orderNumber}: entrega ${order.deliveryFee} Kz${order.riderTip ? ` + gorjeta ${order.riderTip} Kz` : ""}` });
    if (order.paymentMethod === "cash") {
      rows.push({ partyType: "driver", partyId: order.driverId, orderId: order.id, kind: "cash_collected", amount: -order.total,
        note: `${order.orderNumber}: numerário recebido do cliente` });
    }
  }
  await tx.insert(ledgerEntries).values(rows).onConflictDoNothing();
}

/** Numerário que o estafeta tem em mão (recebeu e ainda não entregou à PedeJá). */
export async function cashHeld(tx: DbOrTx, driverId: number) {
  const [r] = await tx.select({ v: sql<number>`coalesce(-sum(${ledgerEntries.amount}), 0)::int` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.partyType, "driver"), eq(ledgerEntries.partyId, driverId), inArray(ledgerEntries.kind, ["cash_collected", "cash_deposit"])));
  return Math.max(0, r?.v ?? 0);
}

export async function account(partyType: "store" | "driver", partyId: number, limit = 100) {
  const [b] = await db.select({
    balance: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
    earned: sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.kind} = 'order_earning'), 0)::int`,
    paidOut: sql<number>`coalesce(-sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.kind} = 'payout'), 0)::int`,
  }).from(ledgerEntries).where(and(eq(ledgerEntries.partyType, partyType), eq(ledgerEntries.partyId, partyId)));
  const entries = await db.select().from(ledgerEntries)
    .where(and(eq(ledgerEntries.partyType, partyType), eq(ledgerEntries.partyId, partyId)))
    .orderBy(desc(ledgerEntries.id)).limit(limit);
  return {
    balance: b.balance, earned: b.earned, paidOut: b.paidOut,
    cashHeld: partyType === "driver" ? await cashHeld(db, partyId) : 0,
    entries,
  };
}
