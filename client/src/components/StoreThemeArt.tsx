import type { ReactNode } from "react";
import { themeFor, type StoreTheme } from "@shared/themes";
import { cn } from "@/lib/utils";

export { themeFor };

/** Céu PedeJá (verde-água → azul) com o mesmo desenho de ondas das lojas. */
export const SKY_THEME: StoreTheme = {
  id: "aqua", label: { pt: "PedeJá", en: "PedeJá", fr: "PedeJá" },
  c1: "#67C29F", c2: "#38BFC3", c3: "#2196D9", deep: "#0B4F7A",
};

/**
 * Fundo de ecrã inteiro, fixo atrás do conteúdo (o conteúdo fica em cartões brancos por cima).
 * As lojas usam a sua cor; o resto da app usa o céu PedeJá.
 */
export function PageBackdrop({ theme = SKY_THEME, seed = 0, layer = "base" }: { theme?: StoreTheme; seed?: number; layer?: "base" | "store" }) {
  const k = (seed % 5) * 6;
  return (
    <div aria-hidden className={cn("pointer-events-none fixed inset-y-0 left-1/2 w-full max-w-md -translate-x-1/2", layer === "store" ? "-z-10" : "-z-20")}
      style={{ background: layer === "store"
        // lojas: a cor fica forte de cima a baixo (não desvanece para branco)
        ? `linear-gradient(165deg, ${theme.c1} 0%, ${theme.c2} 55%, ${theme.c1} 100%)`
        : `linear-gradient(165deg, ${theme.c1} 0%, ${theme.c2} 50%, ${theme.c3} 100%)` }}>
      <svg viewBox="0 0 400 800" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path d={`M0 ${170 + k} C 120 ${90 - k}, 220 ${280 + k}, 400 ${160 - k} L400 0 L0 0 Z`} fill="#fff" opacity=".14" />
        <path d={`M0 ${430 - k} C 110 ${350 + k}, 250 ${540 - k}, 400 ${420 + k} L400 800 L0 800 Z`} fill="#fff" opacity=".16" />
        <path d={`M0 ${620 + k} C 140 ${560 - k}, 260 ${720 + k}, 400 ${640 - k} L400 800 L0 800 Z`} fill="#fff" opacity=".18" />
        <path d={`M${250 + k} 0 C ${190 + k} 200, ${330 - k} 420, ${260 + k} 800 L400 800 L400 0 Z`} fill={theme.deep} opacity=".07" />
        <path d={`M${320 - k} 0 C 280 260, ${380 - k} 520, 330 800`} fill="none" stroke="#fff" strokeWidth="2" opacity=".35" />
        <path d={`M${60 + k} 0 C 20 240, ${120 - k} 500, 50 800`} fill="none" stroke="#fff" strokeWidth="1.5" opacity=".22" />
      </svg>
    </div>
  );
}

/**
 * Fundo da loja: degradê claro com ondas suaves (desenhado em código, sem imagens → leve em dados móveis).
 * `seed` muda ligeiramente a forma das ondas para cada loja não parecer igual à outra.
 */
export function StoreThemeArt({ theme, seed = 0, className, children, muted }: {
  theme: StoreTheme; seed?: number; className?: string; children?: ReactNode; muted?: boolean;
}) {
  const k = (seed % 5) * 8; // pequena variação na curva
  return (
    <div className={cn("relative overflow-hidden", muted && "grayscale", className)}
      style={{ background: `linear-gradient(155deg, ${theme.c1} 0%, ${theme.c2} 55%, ${theme.c3} 100%)` }}>
      <svg aria-hidden viewBox="0 0 400 200" preserveAspectRatio="none" className="pointer-events-none absolute inset-0 h-full w-full">
        <path d={`M0 ${120 - k} C 90 ${60 + k}, 170 ${190 - k}, 260 ${110 + k} S 380 ${50 + k}, 400 ${80 - k} L400 200 L0 200 Z`} fill="#fff" opacity=".28" />
        <path d={`M0 ${160 - k / 2} C 110 ${110 + k}, 210 ${200 - k}, 300 ${140 + k / 2} S 390 ${120 - k}, 400 ${130} L400 200 L0 200 Z`} fill="#fff" opacity=".32" />
        <path d={`M${230 + k} 0 C ${190 + k} 60, ${300 - k} 110, ${250 + k} 200 L400 200 L400 0 Z`} fill={theme.deep} opacity=".08" />
        <path d={`M${300 - k} 0 C ${270} 70, ${360 - k} 120, ${330} 200`} fill="none" stroke="#fff" strokeWidth="2" opacity=".45" />
      </svg>
      {children && <div className="relative h-full">{children}</div>}
    </div>
  );
}
