import type { Lang, Tr } from "./i18n";

const locale = (l: Lang) => (l === "pt" ? "pt-AO" : l === "fr" ? "fr-FR" : "en-GB");

/** 4500 → "4 500 Kz" */
export function kz(value: number | null | undefined): string {
  const n = Math.round(value ?? 0);
  return `${n.toLocaleString("pt-AO").replace(/ /g, " ")} Kz`;
}

export function dateTime(d: string | Date | null | undefined, lang: Lang = "pt"): string {
  if (!d) return "";
  return new Date(d).toLocaleString(locale(lang), {
    timeZone: "Africa/Luanda", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

export function time(d: string | Date | null | undefined, lang: Lang = "pt"): string {
  if (!d) return "";
  return new Date(d).toLocaleTimeString(locale(lang), { timeZone: "Africa/Luanda", hour: "2-digit", minute: "2-digit" });
}

export const ORDER_STATUS: Record<string, Tr> = {
  scheduled: { pt: "Agendada", en: "Scheduled", fr: "Programmée" },
  pending: { pt: "A aguardar a loja", en: "Waiting for the store", fr: "En attente du magasin" },
  accepted: { pt: "Aceite", en: "Accepted", fr: "Acceptée" },
  preparing: { pt: "Em preparação", en: "Being prepared", fr: "En préparation" },
  ready: { pt: "Pronta para recolha", en: "Ready for pickup", fr: "Prête" },
  picked_up: { pt: "A caminho", en: "On the way", fr: "En route" },
  delivered: { pt: "Entregue", en: "Delivered", fr: "Livrée" },
  cancelled: { pt: "Cancelada", en: "Cancelled", fr: "Annulée" },
  rejected: { pt: "Recusada pela loja", en: "Rejected by store", fr: "Refusée" },
};

export const STATUS_COLOR: Record<string, string> = {
  scheduled: "bg-indigo-100 text-indigo-800",
  pending: "bg-amber-100 text-amber-800",
  accepted: "bg-sky-100 text-sky-800",
  preparing: "bg-sky-100 text-sky-800",
  ready: "bg-violet-100 text-violet-800",
  picked_up: "bg-orange-100 text-orange-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-neutral-200 text-neutral-700",
  rejected: "bg-red-100 text-red-800",
};

export const STORE_TYPE: Record<string, Tr & { icon: string }> = {
  restaurant: { pt: "Restaurantes", en: "Restaurants", fr: "Restaurants", icon: "🍽️" },
  bakery: { pt: "Pastelaria e bolos", en: "Bakery & cakes", fr: "Pâtisserie", icon: "🎂" },
  grocery: { pt: "Supermercado", en: "Grocery", fr: "Épicerie", icon: "🛒" },
  pharmacy: { pt: "Farmácia", en: "Pharmacy", fr: "Pharmacie", icon: "💊" },
  beauty: { pt: "Beleza", en: "Beauty", fr: "Beauté", icon: "💄" },
  flowers: { pt: "Flores", en: "Flowers", fr: "Fleurs", icon: "💐" },
  retail: { pt: "Casa e presentes", en: "Home & gifts", fr: "Maison et cadeaux", icon: "🎁" },
};

export const DIETARY: Record<string, Tr & { icon: string }> = {
  vegan: { pt: "Vegano", en: "Vegan", fr: "Végan", icon: "🌱" },
  vegetarian: { pt: "Vegetariano", en: "Vegetarian", fr: "Végétarien", icon: "🥕" },
  gluten_free: { pt: "Sem glúten", en: "Gluten-free", fr: "Sans gluten", icon: "🌾" },
  halal: { pt: "Halal", en: "Halal", fr: "Halal", icon: "☪️" },
  lactose_free: { pt: "Sem lactose", en: "Lactose-free", fr: "Sans lactose", icon: "🥛" },
  spicy: { pt: "Picante", en: "Spicy", fr: "Épicé", icon: "🌶️" },
};

export const ALLERGEN: Record<string, Tr> = {
  gluten: { pt: "Glúten", en: "Gluten", fr: "Gluten" },
  dairy: { pt: "Lacticínios", en: "Dairy", fr: "Lait" },
  eggs: { pt: "Ovos", en: "Eggs", fr: "Œufs" },
  nuts: { pt: "Frutos secos", en: "Tree nuts", fr: "Fruits à coque" },
  peanuts: { pt: "Amendoim", en: "Peanuts", fr: "Arachides" },
  seafood: { pt: "Marisco", en: "Shellfish", fr: "Fruits de mer" },
  fish: { pt: "Peixe", en: "Fish", fr: "Poisson" },
  soy: { pt: "Soja", en: "Soy", fr: "Soja" },
};

export const PAYMENT: Record<string, Tr> = {
  cash: { pt: "Numerário na entrega", en: "Cash on delivery", fr: "Espèces à la livraison" },
  multicaixa_express: { pt: "Multicaixa Express", en: "Multicaixa Express", fr: "Multicaixa Express" },
  unitel_money: { pt: "Unitel Money", en: "Unitel Money", fr: "Unitel Money" },
  card: { pt: "Cartão de crédito/débito", en: "Credit/debit card", fr: "Carte bancaire" },
  bank_transfer: { pt: "Transferência bancária", en: "Bank transfer", fr: "Virement bancaire" },
};

/** Iniciais para avatar/logótipo quando não há imagem. */
export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

/** Cor estável a partir de um texto (para capas sem imagem). */
export function colorFor(text: string): string {
  const palette = ["#3F7A72", "#C2410C", "#B45309", "#15803D", "#0E7490", "#7C3AED", "#BE185D", "#1D4ED8", "#A16207"];
  let h = 0;
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}
