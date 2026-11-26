import { config } from "../config";
import type { Fulfilment, Store, StorePlan } from "@shared/schema";

/**
 * Comissão PedeJá sobre cada artigo vendido (comida, medicamentos, roupa, bijuteria…).
 *
 *  1. Taxa do plano Padrão para o tipo de negócio (COMMISSION_BY_TYPE): restaurante 20%, farmácia 12%, mercearia 15%, roupa 18%…
 *  2. Plano da loja: Básico −5 pontos (só aparece em pesquisa pelo nome), Destaque +5 (topo das listas).
 *  3. Recolha na loja (9%) e entrega pelos estafetas da loja (10%) têm taxa própria, como na Uber Eats / Just Eat.
 *  4. Uma comissão negociada pelo admin (stores.commissionPct) substitui 1–3.
 *  5. "Mesmo preço que no balcão": menos 2 pontos.
 *  6. 1.º mês depois da aprovação: 0%.
 * A comissão de uma encomenda é a soma da comissão de cada artigo; cada linha aparece na nota de comissões da loja.
 */
type StoreForCommission = Pick<Store, "storeType" | "plan" | "commissionPct" | "counterPrice" | "commissionFreeUntil">;

export function planOffset(plan: StorePlan | null | undefined) {
  return plan === "basic" ? config.planBasicOffset : plan === "featured" ? config.planFeaturedOffset : 0;
}

export function baseRateForType(storeType: string) {
  return config.commissionByType[storeType] ?? config.commissionPct;
}

export function commissionRateFor(store: StoreForCommission, fulfilment: Fulfilment, at: Date = new Date()) {
  if (store.commissionFreeUntil && at < store.commissionFreeUntil) return 0;
  let pct: number;
  if (fulfilment === "pickup") pct = config.commissionPickupPct;
  else if (fulfilment === "store_delivery") pct = config.commissionSelfDeliveryPct;
  else pct = store.commissionPct ?? baseRateForType(store.storeType) + planOffset(store.plan);
  if (store.counterPrice) pct -= config.counterPricePts;
  return Math.max(0, Math.round(pct * 100) / 100);
}

/** Comissão de cada artigo (arredondada ao Kz) e o total da encomenda. */
export function itemCommissions<T extends { unitPrice: number; quantity: number }>(items: T[], pct: number) {
  const lines = items.map((it) => ({ ...it, commissionPct: pct, commissionAmount: Math.round((it.unitPrice * it.quantity * pct) / 100) }));
  return { lines, total: lines.reduce((s, l) => s + l.commissionAmount, 0) };
}

/** O que a loja vê ao escolher o plano (taxas do seu tipo de negócio). */
export function planOptionsFor(store: Pick<Store, "storeType" | "counterPrice">) {
  const base = baseRateForType(store.storeType);
  const less = store.counterPrice ? config.counterPricePts : 0;
  return {
    basic: Math.max(0, base + config.planBasicOffset - less),
    standard: Math.max(0, base - less),
    featured: Math.max(0, base + config.planFeaturedOffset - less),
    pickup: Math.max(0, config.commissionPickupPct - less),
    selfDelivery: Math.max(0, config.commissionSelfDeliveryPct - less),
    counterPricePts: config.counterPricePts,
    freeDays: config.commissionFreeDays,
  };
}
