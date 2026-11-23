import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { ledgerEntries, payouts, stores, users, type Payout } from "@shared/schema";
import { badRequest, conflict, notFound } from "./http";
import { instantCashoutFee, weekStartLuanda } from "./fees";

/**
 * Pagamentos a estafetas e lojas (tudo por banco: Multicaixa Express, Unitel Money ou IBAN).
 *
 *  - Semanal: à terça (PAYOUT_WEEKDAY) gera um pagamento por pessoa com tudo o que ganhou até domingo.
 *    O admin faz as transferências (ficheiro CSV para o banco) e marca cada uma como paga com a referência.
 *  - Levantamento imediato (estafetas): leva já o saldo disponível, com uma taxa pequena.
 *  - Cada pagamento tira o valor do saldo no momento em que é criado; se a transferência falhar, volta ao saldo.
 * Quando houver gateway com transferências automáticas, basta ligar aqui o envio.
 */

type Party = "store" | "driver";

export async function payoutAccount(party: Party, id: number) {
  if (party === "store") {
    const [s] = await db.select({ name: stores.name, method: stores.payoutMethod, account: stores.payoutReference }).from(stores).where(eq(stores.id, id));
    return s ?? null;
  }
  const [u] = await db.select({ name: users.fullName, method: users.payoutMethod, account: users.payoutReference }).from(users).where(eq(users.id, id));
  return u ?? null;
}

async function balanceOf(party: Party, id: number, before?: Date) {
  const [r] = await db.select({
    total: sql<number>`coalesce(sum(${ledgerEntries.amount}), 0)::int`,
    upTo: before
      ? sql<number>`coalesce(sum(${ledgerEntries.amount}) filter (where ${ledgerEntries.kind} = 'payout' or ${ledgerEntries.createdAt} < ${before}), 0)::int`
      : sql<number>`0`,
  }).from(ledgerEntries).where(and(eq(ledgerEntries.partyType, party), eq(ledgerEntries.partyId, id)));
  return { total: r.total, upTo: r.upTo };
}

/** Disponível para levantar já / para o pagamento semanal (ganhos até domingo, menos o que já foi pago). */
export async function available(party: Party, id: number, now = new Date()) {
  const b = await balanceOf(party, id, weekStartLuanda(now));
  return { now: Math.max(0, b.total), weekly: Math.max(0, Math.min(b.total, b.upTo)) };
}

async function createPayout(party: Party, id: number, kind: "weekly" | "instant", amount: number, fee: number, periodEnd: Date | null, method: string, account: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(payouts).values({ partyType: party, partyId: id, kind, amount, fee, method, account, periodEnd })
      .onConflictDoNothing().returning();
    if (!p) return null; // já existe (pagamento semanal desta semana)
    await tx.insert(ledgerEntries).values({
      partyType: party, partyId: id, kind: "payout", amount: -(amount + fee),
      note: kind === "weekly" ? `Pagamento semanal #${p.id}` : `Levantamento imediato #${p.id}${fee ? ` (taxa ${fee} Kz)` : ""}`,
    });
    return p;
  });
}

/** Gera os pagamentos semanais (idempotente: uma vez por semana e pessoa). */
export async function runWeeklyPayouts(now = new Date()) {
  const cutoff = weekStartLuanda(now);
  const parties = await db.execute(sql`
    select party_type as "party", party_id as "id" from ledger_entries group by party_type, party_id having sum(amount) > 0`);
  const created: Payout[] = [];
  const missingAccount: { party: Party; id: number; name: string; amount: number }[] = [];
  for (const r of parties.rows as { party: Party; id: number }[]) {
    const due = (await available(r.party, r.id, now)).weekly;
    if (due <= 0) continue;
    const acc = await payoutAccount(r.party, r.id);
    if (!acc?.method || !acc.account) { missingAccount.push({ party: r.party, id: r.id, name: acc?.name ?? "?", amount: due }); continue; }
    const p = await createPayout(r.party, r.id, "weekly", due, 0, cutoff, acc.method, acc.account);
    if (p) created.push(p);
  }
  return { periodEnd: cutoff, created, missingAccount };
}

/** Levantamento imediato do estafeta (com taxa). */
export async function instantCashout(driverId: number) {
  const acc = await payoutAccount("driver", driverId);
  if (!acc?.method || !acc.account) throw badRequest("Indique primeiro a conta onde quer receber (Multicaixa Express, Unitel Money ou IBAN).", "NO_PAYOUT_ACCOUNT");
  const [open] = await db.select({ id: payouts.id }).from(payouts)
    .where(and(eq(payouts.partyType, "driver"), eq(payouts.partyId, driverId), eq(payouts.kind, "instant"), eq(payouts.status, "pending")));
  if (open) throw conflict("Já tem um levantamento a ser processado.", "CASHOUT_PENDING");
  const bal = (await available("driver", driverId)).now;
  if (bal < config.instantCashoutMin) throw badRequest(`O levantamento imediato precisa de pelo menos ${config.instantCashoutMin} Kz disponíveis.`, "CASHOUT_TOO_SMALL");
  const fee = instantCashoutFee(bal);
  const p = await createPayout("driver", driverId, "instant", bal - fee, fee, null, acc.method, acc.account);
  return p!;
}

export async function markPayout(id: number, status: "paid" | "failed", bankReference: string | null) {
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(payouts).where(eq(payouts.id, id)).for("update");
    if (!p) throw notFound("Pagamento não encontrado");
    if (p.status !== "pending") throw conflict("Este pagamento já foi fechado.", "PAYOUT_CLOSED");
    const [u] = await tx.update(payouts).set({ status, bankReference, paidAt: status === "paid" ? new Date() : null }).where(eq(payouts.id, id)).returning();
    if (status === "failed") {
      await tx.insert(ledgerEntries).values({ partyType: p.partyType, partyId: p.partyId, kind: "adjustment", amount: p.amount + p.fee, note: `Pagamento #${p.id} não concluído: valor devolvido ao saldo` });
    }
    return u;
  });
}

export async function payoutsOf(party: Party, id: number, limit = 20) {
  return db.select().from(payouts).where(and(eq(payouts.partyType, party), eq(payouts.partyId, id))).orderBy(desc(payouts.id)).limit(limit);
}

/** Corre de hora a hora: no dia de pagamento (terça, depois das 06:00 de Luanda) gera os pagamentos semanais. */
export function startPayoutScheduler() {
  if (process.env.AUTO_PAYOUTS === "0") return;
  const tick = () => {
    const lu = new Date(Date.now() + 3_600_000);
    if (lu.getUTCDay() === config.payoutWeekday && lu.getUTCHours() >= 6) {
      runWeeklyPayouts().catch((e) => console.error("[payouts]", e));
    }
  };
  setInterval(tick, 3_600_000);
  setTimeout(tick, 30_000);
}
