import { and, asc, desc, eq, gte, inArray, isNull, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { ledgerEntries, orderItems, orders, stores, storeInvoices, type InvoiceLine, type StoreInvoice } from "@shared/schema";
import { badRequest, conflict, notFound } from "./http";

/**
 * Notas de comissões mensais (o que a PedeJá cobra a cada loja).
 *
 * Uma nota por loja e por mês, com uma linha por artigo vendido (valor, % e comissão) e uma por campanha
 * "Patrocinado". A comissão já foi descontada no saldo da loja em cada entrega; a nota documenta-a.
 * IVA: só se a PedeJá estiver no Regime Geral (PEDEJA_VAT_REGIME=general). Por defeito vem incluído na comissão
 * (a loja paga a % anunciada e a nota mostra o IVA contido); com VAT_INCLUDED=0 é somado e sai do saldo da loja.
 * A fatura fiscal sai do software certificado pela AGT; o seu número fica em agtInvoiceNumber.
 */

/** Mês "AAAA-MM" em hora de Luanda (UTC+1): [início, fim). */
export function monthRange(month: string) {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) throw badRequest("Mês inválido (AAAA-MM).", "BAD_MONTH");
  const y = Number(m[1]), mo = Number(m[2]);
  const start = new Date(Date.UTC(y, mo - 1, 1) - 3_600_000);
  const end = new Date(Date.UTC(y, mo, 1) - 3_600_000);
  return { start, end, year: y };
}

const dayLuanda = (d: Date) => new Date(d.getTime() + 3_600_000).toISOString().slice(0, 10);

/** Linhas e totais de uma loja num mês (só o que ainda não foi faturado). */
async function collect(storeId: number, start: Date, end: Date) {
  const os = await db.select().from(orders).where(and(
    eq(orders.storeId, storeId), ne(orders.kind, "parcel"), isNull(orders.invoiceId),
    gte(orders.settledAt, start), lt(orders.settledAt, end),
  )).orderBy(asc(orders.settledAt));
  const items = os.length ? await db.select().from(orderItems).where(inArray(orderItems.orderId, os.map((o) => o.id))).orderBy(asc(orderItems.id)) : [];
  const lines: InvoiceLine[] = [];
  let salesTotal = 0, commissionTotal = 0;
  for (const o of os) {
    const its = items.filter((i) => i.orderId === o.id);
    const date = dayLuanda(o.settledAt!);
    const withCommission = its.length && its.every((i) => i.commissionAmount != null);
    if (withCommission) {
      for (const i of its) {
        const amount = i.unitPrice * i.quantity;
        lines.push({ kind: "item", date, orderNumber: o.orderNumber, description: i.name, quantity: i.quantity, amount, commissionPct: i.commissionPct ?? 0, commission: i.commissionAmount ?? 0 });
        salesTotal += amount; commissionTotal += i.commissionAmount ?? 0;
      }
    } else {
      // encomendas acertadas antes da comissão por artigo: uma linha com o total
      lines.push({ kind: "item", date, orderNumber: o.orderNumber, description: `Encomenda (${its.length} artigos)`, quantity: 1, amount: o.subtotal, commissionPct: o.commissionPct ?? 0, commission: o.commissionAmount ?? 0 });
      salesTotal += o.subtotal; commissionTotal += o.commissionAmount ?? 0;
    }
  }
  const ads = await db.select().from(ledgerEntries).where(and(
    eq(ledgerEntries.partyType, "store"), eq(ledgerEntries.partyId, storeId), eq(ledgerEntries.kind, "ads"), isNull(ledgerEntries.invoiceId),
    gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end),
  )).orderBy(asc(ledgerEntries.id));
  let adsTotal = 0;
  for (const a of ads) {
    lines.push({ kind: "ads", date: dayLuanda(a.createdAt), description: a.note ?? "Publicidade", quantity: 1, amount: -a.amount, commission: -a.amount });
    adsTotal += -a.amount;
  }
  return { orderIds: os.map((o) => o.id), adIds: ads.map((a) => a.id), lines, salesTotal, commissionTotal, adsTotal };
}

/** Emite as notas do mês para todas as lojas com movimento ainda não faturado. Pode correr várias vezes. */
export async function generateInvoices(month: string, by: number | null) {
  const { start, end, year } = monthRange(month);
  // só meses terminados (o servidor de testes, com ALLOW_TEST_CLOCK=1, aceita o mês em curso)
  if (end > new Date() && process.env.ALLOW_TEST_CLOCK !== "1") throw badRequest("Só se faturam meses já terminados.", "MONTH_NOT_CLOSED");
  const ss = await db.select().from(stores).where(eq(stores.isSystem, false)).orderBy(asc(stores.id));
  const created: StoreInvoice[] = [];
  for (const s of ss) {
    const c = await collect(s.id, start, end);
    if (!c.lines.length) continue;
    const inv = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(771001)`); // numeração sequencial sem saltos
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(storeInvoices).where(sql`${storeInvoices.number} like ${`FC ${year}/%`}`);
      const number = `FC ${year}/${String(n + 1).padStart(6, "0")}`;
      const netTotal = c.commissionTotal + c.adsTotal;
      // IVA só se a PedeJá estiver no Regime Geral; por defeito vem INCLUÍDO na comissão (a loja paga a % anunciada)
      const vatPct = config.pedejaVatRegime === "general" ? config.vatGeneralRate : 0;
      const vatIncluded = config.vatIncluded;
      const vatAmount = vatIncluded ? Math.round((netTotal * vatPct) / (100 + vatPct)) : Math.round((netTotal * vatPct) / 100);
      const chargedVat = vatIncluded ? 0 : vatAmount; // só o IVA não incluído sai do saldo da loja
      const [row] = await tx.insert(storeInvoices).values({
        number, storeId: s.id, periodStart: start, periodEnd: end,
        storeName: s.name, storeNif: s.businessNif, storeAddress: `${s.street}, ${s.zone}`,
        storeVatRegime: s.vatRegime, pedejaVatRegime: config.pedejaVatRegime, vatIncluded,
        lines: c.lines, salesTotal: c.salesTotal, commissionTotal: c.commissionTotal, adsTotal: c.adsTotal,
        netTotal, vatPct, vatAmount, total: netTotal + chargedVat, issuedBy: by,
      }).returning();
      if (c.orderIds.length) await tx.update(orders).set({ invoiceId: row.id }).where(inArray(orders.id, c.orderIds));
      if (c.adIds.length) await tx.update(ledgerEntries).set({ invoiceId: row.id }).where(inArray(ledgerEntries.id, c.adIds));
      // a comissão e a publicidade já saíram do saldo; o IVA (se houver) sai agora
      if (chargedVat > 0) {
        await tx.insert(ledgerEntries).values({ partyType: "store", partyId: s.id, kind: "invoice_vat", amount: -vatAmount, invoiceId: row.id, note: `${number}: IVA ${vatPct}% sobre ${netTotal} Kz`, createdBy: by });
      }
      return row;
    });
    created.push(inv);
  }
  return created;
}

export async function listInvoices(filter: { storeId?: number; month?: string }) {
  const conds = [];
  if (filter.storeId) conds.push(eq(storeInvoices.storeId, filter.storeId));
  if (filter.month) { const r = monthRange(filter.month); conds.push(eq(storeInvoices.periodStart, r.start)); }
  const rows = await db.select().from(storeInvoices).where(conds.length ? and(...conds) : undefined).orderBy(desc(storeInvoices.id)).limit(500);
  return rows.map(({ lines, ...r }) => ({ ...r, lineCount: lines.length }));
}

export async function getInvoice(id: number, storeId?: number) {
  const [inv] = await db.select().from(storeInvoices).where(and(eq(storeInvoices.id, id), storeId ? eq(storeInvoices.storeId, storeId) : undefined));
  if (!inv) throw notFound("Nota não encontrada");
  return inv;
}

/** Anula uma nota: as encomendas e a publicidade voltam a poder ser faturadas; o IVA volta ao saldo da loja. */
export async function voidInvoice(id: number, by: number | null) {
  return db.transaction(async (tx) => {
    const [inv] = await tx.select().from(storeInvoices).where(eq(storeInvoices.id, id)).for("update");
    if (!inv) throw notFound("Nota não encontrada");
    if (inv.status === "void") throw conflict("Esta nota já está anulada.", "ALREADY_VOID");
    await tx.update(orders).set({ invoiceId: null }).where(eq(orders.invoiceId, id));
    await tx.update(ledgerEntries).set({ invoiceId: null }).where(and(eq(ledgerEntries.invoiceId, id), eq(ledgerEntries.kind, "ads")));
    if (!inv.vatIncluded && inv.vatAmount > 0) {
      await tx.insert(ledgerEntries).values({ partyType: "store", partyId: inv.storeId, kind: "adjustment", amount: inv.vatAmount, note: `${inv.number} anulada: IVA devolvido`, createdBy: by });
    }
    const [u] = await tx.update(storeInvoices).set({ status: "void", voidedAt: new Date() }).where(eq(storeInvoices.id, id)).returning();
    return u;
  });
}

export async function setAgtNumber(id: number, agtInvoiceNumber: string | null) {
  const [u] = await db.update(storeInvoices).set({ agtInvoiceNumber }).where(eq(storeInvoices.id, id)).returning();
  if (!u) throw notFound("Nota não encontrada");
  return u;
}
