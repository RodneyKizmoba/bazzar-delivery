import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import {
  menuItems, optionGroups, options, orders, promoCodes, stores, subscriptions,
  type CartLine, type MenuItem, type PromoCode, type SelectedOption, type Store, type User,
} from "@shared/schema";
import { config } from "../config";
import { badRequest, conflict, notFound } from "./http";

export interface PricedLine {
  menuItem: MenuItem;
  quantity: number;
  unitPrice: number;
  selectedOptions: SelectedOption[];
  specialInstructions: string | null;
  lineTotal: number;
}

export interface Quote {
  store: Store;
  lines: PricedLine[];
  subtotal: number;
  deliveryFee: number;
  baseDeliveryFee: number;
  discount: number;
  pointsRedeemed: number;
  pointsDiscount: number;
  total: number;
  promo: PromoCode | null;
  isPlus: boolean;
  plusSavings: number;
}

// ---------------------------------------------------------------------------
// Horários (Luanda = UTC+1, sem horário de verão)
// ---------------------------------------------------------------------------
export function luandaMinutes(d: Date): number {
  const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
  return (utcMin + 60) % (24 * 60);
}
function hhmmToMin(s: string) {
  const [h, m] = s.split(":").map(Number);
  return h * 60 + m;
}
export function isWithinOpeningHours(store: Store, at: Date): boolean {
  const t = luandaMinutes(at);
  const open = hhmmToMin(store.openingTime);
  const close = hhmmToMin(store.closingTime);
  if (open === close) return true; // 24h
  return open < close ? t >= open && t < close : t >= open || t < close; // atravessa a meia-noite
}

export async function hasActivePlus(db: DbOrTx, userId: number): Promise<boolean> {
  const [s] = await db.select({ id: subscriptions.id }).from(subscriptions)
    .where(and(eq(subscriptions.userId, userId), eq(subscriptions.status, "active"), gt(subscriptions.endsAt, new Date())))
    .limit(1);
  return !!s;
}

export function validateSchedule(scheduledFor: Date | null): void {
  if (!scheduledFor) return;
  const now = Date.now();
  const min = now + config.scheduleMinLeadMin * 60_000;
  const max = now + config.scheduleMaxAheadHours * 3_600_000;
  if (scheduledFor.getTime() < min) {
    throw badRequest(`A entrega agendada tem de ser pelo menos ${config.scheduleMinLeadMin} minutos a partir de agora.`, "SCHEDULE_TOO_SOON");
  }
  if (scheduledFor.getTime() > max) {
    throw badRequest(`Só é possível agendar até ${config.scheduleMaxAheadHours} horas de antecedência.`, "SCHEDULE_TOO_FAR");
  }
}

export function assertStoreCanTakeOrder(store: Store, scheduledFor: Date | null) {
  if (!store.isApproved) throw notFound("Loja não encontrada");
  if (!scheduledFor && !store.isOpen) throw conflict("Esta loja está fechada de momento. Pode agendar a entrega para mais tarde.", "STORE_CLOSED");
  const at = scheduledFor ?? new Date();
  if (!isWithinOpeningHours(store, at)) {
    throw conflict(
      scheduledFor
        ? `A loja não está aberta à hora escolhida (${store.openingTime}–${store.closingTime}).`
        : `A loja só aceita encomendas entre ${store.openingTime} e ${store.closingTime}. Pode agendar a entrega.`,
      "OUTSIDE_HOURS",
    );
  }
}

/** Valida e calcula o preço de cada linha a partir da base de dados (nunca confiar no cliente). */
export async function priceLines(db: DbOrTx, storeId: number, lines: CartLine[]): Promise<PricedLine[]> {
  if (lines.length === 0) throw badRequest("O carrinho está vazio.", "EMPTY_CART");
  const itemIds = Array.from(new Set(lines.map((l) => l.menuItemId)));
  const items = await db.select().from(menuItems).where(inArray(menuItems.id, itemIds));
  const itemMap = new Map(items.map((i) => [i.id, i]));

  const groups = itemIds.length ? await db.select().from(optionGroups).where(inArray(optionGroups.menuItemId, itemIds)) : [];
  const groupIds = groups.map((g) => g.id);
  const opts = groupIds.length ? await db.select().from(options).where(inArray(options.groupId, groupIds)) : [];

  return lines.map((line) => {
    const item = itemMap.get(line.menuItemId);
    if (!item || item.storeId !== storeId) throw badRequest("Um dos produtos não pertence a esta loja.", "ITEM_NOT_IN_STORE");
    if (!item.isAvailable) throw conflict(`"${item.name}" está esgotado de momento.`, "ITEM_UNAVAILABLE");

    const itemGroups = groups.filter((g) => g.menuItemId === item.id);
    const chosen = Array.from(new Set(line.optionIds));
    const selected: SelectedOption[] = [];
    for (const optId of chosen) {
      const opt = opts.find((o) => o.id === optId);
      const group = opt && itemGroups.find((g) => g.id === opt.groupId);
      if (!opt || !group) throw badRequest(`Opção inválida para "${item.name}".`, "INVALID_OPTION");
      if (!opt.isAvailable) throw conflict(`A opção "${opt.name}" não está disponível.`, "OPTION_UNAVAILABLE");
      selected.push({ groupId: group.id, groupName: group.name, optionId: opt.id, name: opt.name, priceDelta: opt.priceDelta });
    }
    for (const g of itemGroups) {
      const count = selected.filter((s) => s.groupId === g.id).length;
      if (count < g.minSelect) throw badRequest(`Escolha pelo menos ${g.minSelect} em "${g.name}" (${item.name}).`, "OPTION_REQUIRED");
      if (count > g.maxSelect) throw badRequest(`Pode escolher no máximo ${g.maxSelect} em "${g.name}" (${item.name}).`, "OPTION_TOO_MANY");
    }
    const unitPrice = Math.max(0, item.price + selected.reduce((s, o) => s + o.priceDelta, 0));
    return {
      menuItem: item,
      quantity: line.quantity,
      unitPrice,
      selectedOptions: selected,
      specialInstructions: line.specialInstructions || null,
      lineTotal: unitPrice * line.quantity,
    };
  });
}

async function validatePromo(db: DbOrTx, code: string, user: User | null, store: Store, subtotal: number, isPlus: boolean): Promise<PromoCode> {
  const [promo] = await db.select().from(promoCodes).where(eq(promoCodes.code, code.toUpperCase()));
  if (!promo || !promo.isActive) throw badRequest("Código promocional inválido.", "PROMO_INVALID");
  if (promo.expiresAt && promo.expiresAt < new Date()) throw badRequest("Este código promocional expirou.", "PROMO_EXPIRED");
  if (promo.maxUses != null && promo.usedCount >= promo.maxUses) throw badRequest("Este código já atingiu o limite de utilizações.", "PROMO_EXHAUSTED");
  if (promo.storeId && promo.storeId !== store.id) throw badRequest("Este código não é válido nesta loja.", "PROMO_WRONG_STORE");
  if (promo.plusOnly && !isPlus) throw badRequest("Este código é exclusivo para membros Bazzar Plus.", "PROMO_PLUS_ONLY");
  if (subtotal < promo.minOrder) throw badRequest(`Este código exige um mínimo de ${promo.minOrder} Kz.`, "PROMO_MIN_ORDER");
  if (user) {
    const [{ used }] = await db.select({ used: sql<number>`count(*)::int` }).from(orders)
      .where(and(eq(orders.customerId, user.id), eq(orders.promoCode, promo.code), ne(orders.status, "cancelled"), ne(orders.status, "rejected")));
    if (used >= promo.maxUsesPerUser) throw badRequest("Já utilizou este código.", "PROMO_ALREADY_USED");
    if (promo.firstOrderOnly) {
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(orders)
        .where(and(eq(orders.customerId, user.id), ne(orders.status, "cancelled"), ne(orders.status, "rejected")));
      if (n > 0) throw badRequest("Este código é só para a primeira encomenda.", "PROMO_FIRST_ORDER");
    }
  }
  return promo;
}

export async function buildQuote(
  db: DbOrTx,
  opts: { storeId: number; lines: CartLine[]; user: User | null; promoCode?: string | null; usePoints?: number },
): Promise<Quote> {
  const [store] = await db.select().from(stores).where(eq(stores.id, opts.storeId));
  if (!store || !store.isApproved) throw notFound("Loja não encontrada");

  const lines = await priceLines(db, store.id, opts.lines);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  if (subtotal < store.minOrder) {
    throw badRequest(`O valor mínimo de encomenda nesta loja é ${store.minOrder} Kz.`, "BELOW_MIN_ORDER");
  }

  const isPlus = opts.user ? await hasActivePlus(db, opts.user.id) : false;
  const baseDeliveryFee = store.deliveryFee;
  let deliveryFee = baseDeliveryFee;
  let plusSavings = 0;
  if (isPlus && subtotal >= config.plusFreeDeliveryMinOrder) {
    plusSavings = deliveryFee;
    deliveryFee = 0;
  }

  let discount = 0;
  let promo: PromoCode | null = null;
  if (opts.promoCode) {
    promo = await validatePromo(db, opts.promoCode, opts.user, store, subtotal, isPlus);
    if (promo.discountType === "percent") {
      discount = Math.floor((subtotal * Math.min(promo.value, 100)) / 100);
      if (promo.maxDiscount != null) discount = Math.min(discount, promo.maxDiscount);
    } else if (promo.discountType === "fixed") {
      discount = Math.min(promo.value, subtotal);
    } else {
      discount = deliveryFee;
    }
  }

  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  const wanted = Math.max(0, opts.usePoints || 0);
  if (wanted > 0) {
    if (!opts.user) throw badRequest("Inicie sessão para usar pontos.", "AUTH_REQUIRED");
    const available = Math.min(wanted, opts.user.loyaltyPoints);
    const remaining = subtotal + deliveryFee - discount;
    const cap = Math.floor((remaining * config.maxPointsDiscountPct) / 100);
    pointsRedeemed = Math.min(available, Math.floor(cap / config.pointValueKz));
    pointsDiscount = pointsRedeemed * config.pointValueKz;
  }

  const total = Math.max(0, subtotal + deliveryFee - discount - pointsDiscount);
  return { store, lines, subtotal, deliveryFee, baseDeliveryFee, discount, pointsRedeemed, pointsDiscount, total, promo, isPlus, plusSavings };
}

export function quoteToJson(q: Quote) {
  return {
    storeId: q.store.id,
    storeName: q.store.name,
    lines: q.lines.map((l) => ({
      menuItemId: l.menuItem.id,
      name: l.menuItem.name,
      quantity: l.quantity,
      unitPrice: l.unitPrice,
      lineTotal: l.lineTotal,
      selectedOptions: l.selectedOptions,
      specialInstructions: l.specialInstructions,
    })),
    subtotal: q.subtotal,
    deliveryFee: q.deliveryFee,
    baseDeliveryFee: q.baseDeliveryFee,
    discount: q.discount,
    pointsRedeemed: q.pointsRedeemed,
    pointsDiscount: q.pointsDiscount,
    total: q.total,
    promoCode: q.promo?.code ?? null,
    isPlus: q.isPlus,
    plusSavings: q.plusSavings,
    plusFreeDeliveryMinOrder: config.plusFreeDeliveryMinOrder,
  };
}
