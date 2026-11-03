import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export type Lang = "pt" | "en" | "fr";
export type Tr = { pt: string; en: string; fr: string };

interface Ctx { lang: Lang; setLang: (l: Lang) => void }
const LangContext = createContext<Ctx>({ lang: "pt", setLang: () => {} });

function initial(): Lang {
  try {
    const saved = localStorage.getItem("lang");
    if (saved === "pt" || saved === "en" || saved === "fr") return saved;
  } catch { /* sem storage */ }
  return "pt";
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("lang", l); } catch { /* ignore */ }
  }, []);
  useEffect(() => { document.documentElement.lang = lang === "pt" ? "pt-AO" : lang; }, [lang]);
  return <LangContext.Provider value={{ lang, setLang }}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/**
 * Tradução inline. Uso:
 *   const t = useT();
 *   t({ pt: "Carrinho", en: "Cart", fr: "Panier" })
 */
export function useT() {
  const { lang } = useLang();
  return useCallback((s: Tr) => s[lang] ?? s.pt, [lang]);
}

/** Textos comuns reutilizados em várias páginas. */
export const T = {
  back: { pt: "Voltar", en: "Back", fr: "Retour" },
  save: { pt: "Guardar", en: "Save", fr: "Enregistrer" },
  cancel: { pt: "Cancelar", en: "Cancel", fr: "Annuler" },
  confirm: { pt: "Confirmar", en: "Confirm", fr: "Confirmer" },
  loading: { pt: "A carregar…", en: "Loading…", fr: "Chargement…" },
  error: { pt: "Ocorreu um erro", en: "Something went wrong", fr: "Une erreur est survenue" },
  retry: { pt: "Tentar de novo", en: "Try again", fr: "Réessayer" },
  add: { pt: "Adicionar", en: "Add", fr: "Ajouter" },
  remove: { pt: "Remover", en: "Remove", fr: "Supprimer" },
  edit: { pt: "Editar", en: "Edit", fr: "Modifier" },
  delete: { pt: "Apagar", en: "Delete", fr: "Supprimer" },
  search: { pt: "Pesquisar", en: "Search", fr: "Rechercher" },
  login: { pt: "Entrar", en: "Log in", fr: "Se connecter" },
  logout: { pt: "Sair", en: "Log out", fr: "Se déconnecter" },
  register: { pt: "Criar conta", en: "Sign up", fr: "Créer un compte" },
  total: { pt: "Total", en: "Total", fr: "Total" },
  subtotal: { pt: "Subtotal", en: "Subtotal", fr: "Sous-total" },
  deliveryFee: { pt: "Taxa de entrega", en: "Delivery fee", fr: "Frais de livraison" },
  discount: { pt: "Desconto", en: "Discount", fr: "Réduction" },
  free: { pt: "Grátis", en: "Free", fr: "Gratuit" },
  minutes: { pt: "min", en: "min", fr: "min" },
  closed: { pt: "Fechado", en: "Closed", fr: "Fermé" },
  open: { pt: "Aberto", en: "Open", fr: "Ouvert" },
} satisfies Record<string, Tr>;
