import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Carrinho de UMA loja de cada vez (como no Deliveroo).
 * Os preços aqui são apenas estimativas para mostrar; o total real vem sempre de POST /api/cart/quote.
 */
export interface CartLine {
  key: string; // identifica linhas iguais (item + opções + instruções)
  menuItemId: number;
  name: string;
  quantity: number;
  optionIds: number[];
  optionsLabel: string; // ex.: "Piri-piri · Batata frita"
  specialInstructions: string;
  unitPrice: number; // estimativa
}

export interface CartState {
  storeId: number | null;
  storeName: string;
  lines: CartLine[];
}

interface CartCtx extends CartState {
  itemCount: number;
  estimatedSubtotal: number;
  /** Devolve false se o carrinho tem itens de outra loja (a UI deve perguntar ao utilizador). */
  canAddFrom: (storeId: number) => boolean;
  add: (storeId: number, storeName: string, line: Omit<CartLine, "key">) => void;
  setQuantity: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  replaceLines: (storeId: number, storeName: string, lines: Omit<CartLine, "key">[]) => void;
}

const EMPTY: CartState = { storeId: null, storeName: "", lines: [] };
const STORAGE_KEY = "pedeai.cart.v2";
const Ctx = createContext<CartCtx | null>(null);

const keyOf = (l: Omit<CartLine, "key">) =>
  `${l.menuItemId}|${[...l.optionIds].sort((a, b) => a - b).join(",")}|${l.specialInstructions.trim()}`;

function load(): CartState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const v = JSON.parse(raw);
    if (v && Array.isArray(v.lines)) return v;
  } catch { /* ignore */ }
  return EMPTY;
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(load);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* ignore */ }
  }, [state]);

  const value = useMemo<CartCtx>(() => ({
    ...state,
    itemCount: state.lines.reduce((s, l) => s + l.quantity, 0),
    estimatedSubtotal: state.lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0),
    canAddFrom: (storeId) => state.storeId === null || state.storeId === storeId || state.lines.length === 0,
    add: (storeId, storeName, line) => setState((prev) => {
      const base = prev.storeId === storeId ? prev : { storeId, storeName, lines: [] };
      const key = keyOf(line);
      const existing = base.lines.find((l) => l.key === key);
      const lines = existing
        ? base.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, l.quantity + line.quantity) } : l))
        : [...base.lines, { ...line, key }];
      return { storeId, storeName, lines };
    }),
    setQuantity: (key, qty) => setState((prev) => {
      const lines = qty <= 0 ? prev.lines.filter((l) => l.key !== key) : prev.lines.map((l) => (l.key === key ? { ...l, quantity: Math.min(50, qty) } : l));
      return lines.length ? { ...prev, lines } : EMPTY;
    }),
    remove: (key) => setState((prev) => {
      const lines = prev.lines.filter((l) => l.key !== key);
      return lines.length ? { ...prev, lines } : EMPTY;
    }),
    clear: () => setState(EMPTY),
    replaceLines: (storeId, storeName, lines) => setState({ storeId, storeName, lines: lines.map((l) => ({ ...l, key: keyOf(l) })) }),
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart fora do CartProvider");
  return c;
}

/** Converte linhas do carrinho para o formato da API. */
export const toApiItems = (lines: CartLine[]) =>
  lines.map((l) => ({ menuItemId: l.menuItemId, quantity: l.quantity, optionIds: l.optionIds, specialInstructions: l.specialInstructions || null }));
