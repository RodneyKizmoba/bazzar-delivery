import type { ReactNode } from "react";
import { themeFor, type StoreTheme } from "@shared/themes";
import { cn } from "@/lib/utils";

export { themeFor };

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
