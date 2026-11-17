/**
 * Cores das lojas: cada negócio escolhe um degradê claro com ondas para a sua página.
 * Paleta fechada (todas testadas para texto escuro legível); os botões e o pagamento continuam na cor PedeJá.
 */
export const STORE_THEME_IDS = [
  "peach", "coral", "sunset", "rose", "berry", "candy",
  "lilac", "violet", "blue", "aqua", "mint", "lemon",
] as const;
export type StoreThemeId = (typeof STORE_THEME_IDS)[number];

export interface StoreTheme {
  id: StoreThemeId;
  label: { pt: string; en: string; fr: string };
  /** do mais forte (c1) ao mais claro (c3) */
  c1: string; c2: string; c3: string;
  /** tom escuro para pormenores (ondas, ícones) */
  deep: string;
}

export const STORE_THEMES: Record<StoreThemeId, StoreTheme> = {
  peach:  { id: "peach",  label: { pt: "Pêssego", en: "Peach", fr: "Pêche" },          c1: "#FFB48A", c2: "#FFD7BD", c3: "#FFF3EA", deep: "#C2552B" },
  coral:  { id: "coral",  label: { pt: "Coral", en: "Coral", fr: "Corail" },            c1: "#FF8F87", c2: "#FFC4BC", c3: "#FFF0EE", deep: "#C23B33" },
  sunset: { id: "sunset", label: { pt: "Pôr do sol", en: "Sunset", fr: "Coucher de soleil" }, c1: "#FF9A76", c2: "#FFB3C1", c3: "#FFF0F3", deep: "#C2416B" },
  rose:   { id: "rose",   label: { pt: "Rosa", en: "Rose", fr: "Rose" },                c1: "#FF6F98", c2: "#FFB8CB", c3: "#FFF0F5", deep: "#B81952" },
  berry:  { id: "berry",  label: { pt: "Frutos silvestres", en: "Berry", fr: "Baies" }, c1: "#E07BF2", c2: "#F2BDF8", c3: "#FCF0FE", deep: "#8E2AA3" },
  candy:  { id: "candy",  label: { pt: "Algodão doce", en: "Candy", fr: "Barbe à papa" }, c1: "#F4A3D7", c2: "#D9C5F7", c3: "#DDF6FA", deep: "#9B3D86" },
  lilac:  { id: "lilac",  label: { pt: "Lilás", en: "Lilac", fr: "Lilas" },             c1: "#C29BFF", c2: "#DFCBFF", c3: "#F6F0FF", deep: "#6B3FC4" },
  violet: { id: "violet", label: { pt: "Violeta", en: "Violet", fr: "Violet" },         c1: "#9C84FF", c2: "#C8BAFF", c3: "#F1EEFF", deep: "#4F35C2" },
  blue:   { id: "blue",   label: { pt: "Azul", en: "Blue", fr: "Bleu" },                c1: "#7DA4FF", c2: "#B9CDFF", c3: "#EEF3FF", deep: "#2F55C2" },
  aqua:   { id: "aqua",   label: { pt: "Água", en: "Aqua", fr: "Aqua" },                c1: "#5ED6F2", c2: "#A9EAF8", c3: "#EAFAFE", deep: "#0E7A93" },
  mint:   { id: "mint",   label: { pt: "Menta", en: "Mint", fr: "Menthe" },             c1: "#6FE0B3", c2: "#B4F1D7", c3: "#ECFCF5", deep: "#0F7A52" },
  lemon:  { id: "lemon",  label: { pt: "Limão", en: "Lemon", fr: "Citron" },            c1: "#FFD45C", c2: "#FFE8A6", c3: "#FFFAEA", deep: "#A36A00" },
};

/** Cor por defeito conforme o tipo de loja (varia entre lojas do mesmo tipo para não ficarem todas iguais). */
const DEFAULTS: Record<string, StoreThemeId[]> = {
  restaurant: ["coral", "sunset", "peach", "rose", "lemon"],
  bakery: ["peach", "candy", "rose", "lemon"],
  grocery: ["mint", "lemon", "aqua"],
  pharmacy: ["aqua", "mint", "blue"],
  beauty: ["berry", "lilac", "candy"],
  flowers: ["rose", "candy", "berry"],
  retail: ["blue", "violet", "lilac"],
};

export function isStoreThemeId(v: unknown): v is StoreThemeId {
  return typeof v === "string" && (STORE_THEME_IDS as readonly string[]).includes(v);
}

export function themeFor(store: { id: number; storeType: string; theme?: string | null }): StoreTheme {
  if (isStoreThemeId(store.theme)) return STORE_THEMES[store.theme];
  const list = DEFAULTS[store.storeType] ?? DEFAULTS.restaurant;
  return STORE_THEMES[list[Math.abs(store.id) % list.length]];
}
