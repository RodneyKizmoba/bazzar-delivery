import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Fila horizontal que se desliza para a esquerda e para a direita:
 * - telemóvel: deslizar com o dedo (com encaixe opcional em cada cartão);
 * - computador: setas ◀ ▶ e arrastar com o rato;
 * - as setas só aparecem quando há mais conteúdo desse lado, e uma sombra suave na borda indica que a fila continua.
 */
export function HScroll({ children, className, snap, label, fade = true, arrowSize = "md" }: {
  children: ReactNode;
  className?: string;
  snap?: boolean;
  label?: string;
  fade?: boolean;
  arrowSize?: "sm" | "md";
}) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  const [can, setCan] = useState({ l: false, r: false });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const [dragging, setDragging] = useState(false);

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCan({ l: el.scrollLeft > 4, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true });
    return () => { ro.disconnect(); mo.disconnect(); };
  }, [update]);

  const by = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * Math.max(160, el.clientWidth * 0.8), behavior: "smooth" });
  };

  const btn = arrowSize === "sm" ? "h-7 w-7" : "h-9 w-9";
  return (
    <div className="relative" role={label ? "region" : undefined} aria-label={label}>
      <div
        ref={ref}
        onScroll={update}
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || !ref.current) return;
          drag.current = { x: e.clientX, left: ref.current.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d || !ref.current) return;
          const dx = e.clientX - d.x;
          if (!d.moved && Math.abs(dx) > 6) { d.moved = true; setDragging(true); }
          if (d.moved) ref.current.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => { setTimeout(() => { drag.current = null; setDragging(false); }, 0); }}
        onPointerLeave={() => { if (drag.current) { drag.current = null; setDragging(false); } }}
        onClickCapture={(e) => { if (drag.current?.moved) { e.preventDefault(); e.stopPropagation(); } }}
        onDragStart={(e) => e.preventDefault()}
        className={cn(
          "overflow-x-auto overscroll-x-contain scrollbar-hide",
          snap && !dragging && "snap-x snap-mandatory",
          dragging ? "cursor-grabbing select-none" : "cursor-grab md:cursor-auto",
          className,
        )}
      >
        {children}
      </div>

      {fade && can.l && <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-white to-transparent" />}
      {fade && can.r && <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-white to-transparent" />}

      {can.l && (
        <button type="button" onClick={() => by(-1)} aria-label={t({ pt: "Ver anteriores", en: "Previous", fr: "Précédent" })}
          className={cn("absolute left-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border bg-white/95 text-neutral-800 shadow-md transition hover:scale-105 active:scale-95", btn)}>
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {can.r && (
        <button type="button" onClick={() => by(1)} aria-label={t({ pt: "Ver mais", en: "Next", fr: "Suivant" })}
          className={cn("absolute right-1 top-1/2 z-10 flex -translate-y-1/2 items-center justify-center rounded-full border bg-white/95 text-neutral-800 shadow-md transition hover:scale-105 active:scale-95", btn)}>
          <ChevronRight className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
