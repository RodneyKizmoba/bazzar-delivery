import { and, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { config } from "../config";
import { ledgerEntries, sponsorships, stores } from "@shared/schema";
import { badRequest, conflict, notFound } from "./http";

/**
 * Publicidade: a loja paga para aparecer em primeiro nas pesquisas e listas, com a etiqueta "Patrocinado".
 *  - Compra 7, 14 ou 30 dias a AD_PRICE_PER_DAY; o valor é descontado do saldo da loja (sai do próximo pagamento).
 *  - Uma nova compra começa quando a anterior acaba (prolonga).
 *  - Em cada lista mostram-se no máximo AD_MAX_SLOTS lojas patrocinadas que cumpram os filtros, em ordem aleatória.
 *  - Contamos impressões (vezes mostrada) e cliques; cancelar devolve os dias por usar.
 */
export const AD_DAYS = [7, 14, 30] as const;
const DAY = 86_400_000;

export async function activeSponsoredStoreIds(ids: number[], now = new Date()) {
  if (!ids.length) return new Set<number>();
  const rows = await db.select({ storeId: sponsorships.storeId }).from(sponsorships).where(and(
    eq(sponsorships.status, "active"), lte(sponsorships.startsAt, now), gt(sponsorships.endsAt, now), inArray(sponsorships.storeId, ids),
  ));
  return new Set(rows.map((r) => r.storeId));
}

/** Põe as lojas patrocinadas (que já cumprem os filtros) à frente da lista e conta a impressão. */
export async function withSponsoredFirst<T extends { id: number }>(list: T[]): Promise<(T & { sponsored: boolean })[]> {
  const active = await activeSponsoredStoreIds(list.map((s) => s.id));
  if (!active.size) return list.map((s) => ({ ...s, sponsored: false }));
  const picked = list.filter((s) => active.has(s.id)).sort(() => Math.random() - 0.5).slice(0, config.adMaxSlots);
  const pickedIds = new Set(picked.map((s) => s.id));
  await db.update(sponsorships).set({ impressions: sql`${sponsorships.impressions} + 1` }).where(and(
    eq(sponsorships.status, "active"), lte(sponsorships.startsAt, new Date()), gt(sponsorships.endsAt, new Date()), inArray(sponsorships.storeId, [...pickedIds]),
  ));
  return [...picked.map((s) => ({ ...s, sponsored: true })), ...list.filter((s) => !pickedIds.has(s.id)).map((s) => ({ ...s, sponsored: false }))];
}

export async function recordAdClick(storeId: number) {
  const now = new Date();
  await db.update(sponsorships).set({ clicks: sql`${sponsorships.clicks} + 1` }).where(and(
    eq(sponsorships.storeId, storeId), eq(sponsorships.status, "active"), lte(sponsorships.startsAt, now), gt(sponsorships.endsAt, now),
  ));
}

/** Comprar (loja) ou oferecer (admin, free) dias de destaque. */
export async function buyAd(storeId: number, days: number, by: number, free = false) {
  if (!(AD_DAYS as readonly number[]).includes(days)) throw badRequest("Escolha 7, 14 ou 30 dias.", "BAD_AD_DAYS");
  return db.transaction(async (tx) => {
    const [store] = await tx.select({ id: stores.id, approved: stores.isApproved, name: stores.name }).from(stores).where(eq(stores.id, storeId)).for("update");
    if (!store) throw notFound("Loja não encontrada");
    if (!store.approved) throw conflict("A loja ainda não foi aprovada.", "STORE_NOT_APPROVED");
    const now = new Date();
    const [last] = await tx.select({ endsAt: sponsorships.endsAt }).from(sponsorships)
      .where(and(eq(sponsorships.storeId, storeId), eq(sponsorships.status, "active"), gt(sponsorships.endsAt, now)))
      .orderBy(desc(sponsorships.endsAt)).limit(1);
    const startsAt = last ? last.endsAt : now; // prolonga a campanha em curso
    const price = free ? 0 : days * config.adPricePerDay;
    const [ad] = await tx.insert(sponsorships).values({ storeId, startsAt, endsAt: new Date(startsAt.getTime() + days * DAY), days, price, createdBy: by }).returning();
    if (price) {
      await tx.insert(ledgerEntries).values({ partyType: "store", partyId: storeId, kind: "ads", amount: -price, note: `Destaque "Patrocinado" ${days} dias (#${ad.id})`, createdBy: by });
    }
    return ad;
  });
}

/** Cancelar: devolve os dias completos que faltam. */
export async function cancelAd(id: number, by: number, storeId?: number) {
  return db.transaction(async (tx) => {
    const [ad] = await tx.select().from(sponsorships).where(eq(sponsorships.id, id)).for("update");
    if (!ad || (storeId && ad.storeId !== storeId)) throw notFound("Campanha não encontrada");
    if (ad.status !== "active" || ad.endsAt <= new Date()) throw conflict("Esta campanha já terminou.", "AD_CLOSED");
    const now = new Date();
    const unusedDays = Math.floor((ad.endsAt.getTime() - Math.max(now.getTime(), ad.startsAt.getTime())) / DAY);
    const refund = ad.price ? Math.round((ad.price / ad.days) * unusedDays) : 0;
    const [u] = await tx.update(sponsorships).set({ status: "cancelled", cancelledAt: now, refund }).where(eq(sponsorships.id, id)).returning();
    if (refund) {
      await tx.insert(ledgerEntries).values({ partyType: "store", partyId: ad.storeId, kind: "ads", amount: refund, note: `Destaque #${ad.id} cancelado: ${unusedDays} dias devolvidos`, createdBy: by });
    }
    return u;
  });
}

export async function adsOf(storeId?: number) {
  const rows = await db.select({ a: sponsorships, name: stores.name }).from(sponsorships).innerJoin(stores, eq(stores.id, sponsorships.storeId))
    .where(storeId ? eq(sponsorships.storeId, storeId) : sql`true`).orderBy(desc(sponsorships.id)).limit(200);
  const now = Date.now();
  return rows.map((r) => ({
    ...r.a, storeName: r.name,
    state: r.a.status === "cancelled" ? "cancelled" : r.a.endsAt.getTime() <= now ? "ended" : r.a.startsAt.getTime() > now ? "scheduled" : "running",
    ctr: r.a.impressions ? Math.round((r.a.clicks / r.a.impressions) * 1000) / 10 : 0,
  }));
}
