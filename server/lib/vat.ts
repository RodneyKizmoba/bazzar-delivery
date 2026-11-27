import { and, eq, gte, lt, ne, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { ledgerEntries, orders, rides, stores, type Store, type VatRegime } from "@shared/schema";

/**
 * IVA das lojas e da PedeJá (CIVA Angola).
 *
 * O regime de cada contribuinte depende da faturação TOTAL do ano anterior (Exclusão < 25 M Kz,
 * Simplificado 25–350 M, Geral ≥ 350 M). A app só vê as vendas feitas na PedeJá, por isso:
 *  - a loja declara o seu regime (pessoa singular ou empresa; o Kero ou o Maxi estão no Geral);
 *  - se as vendas NA PEDEJÁ, só por si, passarem um limite no ano, a app sobe o regime da loja e avisa
 *    (nunca o desce: as vendas fora da app também contam);
 *  - aos 20 M Kz a loja recebe um aviso para confirmar o regime com o contabilista.
 */
type Db = typeof db;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const RANK: Record<VatRegime, number> = { exclusion: 0, simplified: 1, general: 2 };
export const regimeAtLeast = (a: VatRegime, b: VatRegime) => (RANK[a] >= RANK[b] ? a : b);

/** Ano civil em hora de Luanda (UTC+1). */
export function luandaYear(at = new Date()) {
  const y = new Date(at.getTime() + 3_600_000).getUTCFullYear();
  return { year: y, start: new Date(Date.UTC(y, 0, 1) - 3_600_000), end: new Date(Date.UTC(y + 1, 0, 1) - 3_600_000) };
}

/** Regime que as vendas, só por si, obrigam. */
export function impliedRegime(sales: number): VatRegime {
  if (sales >= config.vatGeneralFrom) return "general";
  if (sales >= config.vatSimplifiedFrom) return "simplified";
  return "exclusion";
}

/** Vendas da loja na PedeJá este ano (artigos de encomendas entregues). */
export async function storeYearSales(q: Db | Tx, storeId: number, at = new Date()) {
  const { start, end } = luandaYear(at);
  const [r] = await q.select({ s: sql<number>`coalesce(sum(${orders.subtotal}), 0)::bigint` }).from(orders).where(and(
    eq(orders.storeId, storeId), ne(orders.kind, "parcel"), gte(orders.settledAt, start), lt(orders.settledAt, end),
  ));
  return Number(r?.s ?? 0);
}

/** Vendas deste ano de todas as lojas (para o admin). */
export async function allStoresYearSales(at = new Date()) {
  const { start, end } = luandaYear(at);
  const rows = await db.select({ id: orders.storeId, s: sql<number>`coalesce(sum(${orders.subtotal}), 0)::bigint` }).from(orders)
    .where(and(ne(orders.kind, "parcel"), gte(orders.settledAt, start), lt(orders.settledAt, end))).groupBy(orders.storeId);
  return new Map(rows.map((r) => [r.id, Number(r.s)]));
}

/** Depois de cada entrega: sobe o regime da loja se as vendas na PedeJá já passaram o limite. */
export async function maybeRaiseVatRegime(tx: Db | Tx, storeId: number) {
  const [s] = await tx.select({ vatRegime: stores.vatRegime }).from(stores).where(eq(stores.id, storeId));
  if (!s) return null;
  const implied = impliedRegime(await storeYearSales(tx, storeId));
  if (RANK[implied] <= RANK[s.vatRegime]) return null;
  await tx.update(stores).set({ vatRegime: implied, vatRegimeRaisedAt: new Date() }).where(eq(stores.id, storeId));
  return implied;
}

/** O que a loja vê no painel. */
export async function vatStatusFor(s: Pick<Store, "id" | "vatRegime" | "sellerType" | "businessNif" | "vatRegimeRaisedAt">) {
  const yearSales = await storeYearSales(db, s.id);
  const implied = impliedRegime(yearSales);
  const next = s.vatRegime === "exclusion" ? config.vatSimplifiedFrom : s.vatRegime === "simplified" ? config.vatGeneralFrom : null;
  return {
    sellerType: s.sellerType, vatRegime: s.vatRegime, businessNif: s.businessNif, raisedAt: s.vatRegimeRaisedAt,
    year: luandaYear().year, yearSales, minRegime: implied,
    thresholds: { alertAt: config.vatAlertAt, simplifiedFrom: config.vatSimplifiedFrom, generalFrom: config.vatGeneralFrom },
    nextThreshold: next,
    alert: s.vatRegime === "exclusion" && yearSales >= config.vatAlertAt,
    nifMissing: !s.businessNif,
  };
}

/** Receita estimada da PedeJá este ano (comissões, taxas ao cliente, margem das entregas, táxi, publicidade). */
export async function pedejaYearRevenue(at = new Date()) {
  const { start, end, year } = luandaYear(at);
  const revenue = await pedejaRevenue(start, end);
  return {
    year, revenue, regime: config.pedejaVatRegime, implied: impliedRegime(revenue),
    thresholds: { simplifiedFrom: config.vatSimplifiedFrom, generalFrom: config.vatGeneralFrom },
    vatPct: config.pedejaVatRegime === "general" ? config.vatGeneralRate : 0, vatIncluded: config.vatIncluded,
  };
}

/** Último dia útil (seg.–sex.) do mês a seguir ao período: prazo da declaração periódica e do pagamento do IVA. */
export function vatDueDate(month: string) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m + 1, 0)); // último dia do mês seguinte
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10); // feriados não contam aqui: confirmar no calendário da AGT
}

/**
 * IVA da PedeJá num mês, sobre o que ela RETÉM (não sobre o valor da comida ou da corrida, que é do parceiro):
 * Geral 14% (incluído nas comissões e taxas), Simplificado 7% sobre o recebido, Exclusão 0.
 */
export async function pedejaMonthVat(month: string) {
  const [y, m] = month.split("-").map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1) - 3_600_000), end = new Date(Date.UTC(y, m, 1) - 3_600_000);
  const revenue = await pedejaRevenue(start, end);
  const regime = config.pedejaVatRegime;
  const vat = regime === "general"
    ? (config.vatIncluded ? Math.round((revenue * config.vatGeneralRate) / (100 + config.vatGeneralRate)) : Math.round((revenue * config.vatGeneralRate) / 100))
    : regime === "simplified" ? Math.round((revenue * config.vatSimplifiedRate) / 100) : 0;
  return { month, revenue, regime, vat, rate: regime === "general" ? config.vatGeneralRate : regime === "simplified" ? config.vatSimplifiedRate : 0, dueDate: vatDueDate(month) };
}

async function pedejaRevenue(start: Date, end: Date) {
  const [o] = await db.select({
    s: sql<number>`coalesce(sum(coalesce(${orders.commissionAmount}, 0) + ${orders.serviceFee} + ${orders.smallOrderFee} + ${orders.priorityFee} - ${orders.discount}
      + case when ${orders.driverId} is not null then ${orders.deliveryFee} - coalesce(${orders.riderPay}, 0) else 0 end), 0)::bigint`,
  }).from(orders).where(and(gte(orders.settledAt, start), lt(orders.settledAt, end)));
  const [r] = await db.select({ s: sql<number>`coalesce(sum(coalesce(${rides.commissionAmount}, 0)), 0)::bigint` }).from(rides)
    .where(and(gte(rides.settledAt, start), lt(rides.settledAt, end)));
  const [a] = await db.select({ s: sql<number>`coalesce(sum(-${ledgerEntries.amount}), 0)::bigint` }).from(ledgerEntries)
    .where(and(eq(ledgerEntries.kind, "ads"), gte(ledgerEntries.createdAt, start), lt(ledgerEntries.createdAt, end)));
  return Number(o?.s ?? 0) + Number(r?.s ?? 0) + Number(a?.s ?? 0);
}
