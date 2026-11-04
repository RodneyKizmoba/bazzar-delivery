import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Banner {
  id: number;
  title: string;
  subtitle: string | null;
  imageUrl: string | null;
  imageCredit: string | null;
  sticker: "burger" | "pizza" | "cake" | "none";
  ctaLabel: string | null;
  linkUrl: string | null;
  bgColor: string;
}

/** Autocolantes de comida desenhados (sem direitos de terceiros). */
export function FoodSticker({ kind, className }: { kind: Banner["sticker"]; className?: string }) {
  if (kind === "none") return null;
  return (
    <svg viewBox="0 0 120 120" className={className} aria-hidden>
      <circle cx="60" cy="60" r="56" fill="#fff" />
      <circle cx="60" cy="60" r="56" fill="none" stroke="#2E3333" strokeWidth="3" strokeDasharray="6 5" opacity=".25" />
      {kind === "burger" && (
        <g transform="translate(18 26)">
          <path d="M2 30 C2 4 82 4 82 30 Z" fill="#FF9F2E" stroke="#C25F00" strokeWidth="2" />
          <g fill="#FFF3D6"><ellipse cx="24" cy="16" rx="3" ry="1.7" /><ellipse cx="42" cy="11" rx="3" ry="1.7" /><ellipse cx="60" cy="15" rx="3" ry="1.7" /><ellipse cx="34" cy="22" rx="3" ry="1.7" /><ellipse cx="52" cy="22" rx="3" ry="1.7" /></g>
          <path d="M-2 31 Q8 40 18 31 Q28 40 38 31 Q48 40 58 31 Q68 40 78 31 Q84 37 86 31 L86 36 L-2 36 Z" fill="#89D900" />
          <rect x="0" y="35" width="84" height="7" rx="2" fill="#FFD54F" />
          <rect x="1" y="41" width="82" height="13" rx="6.5" fill="#5D4037" />
          <rect x="3" y="53" width="78" height="5" rx="2" fill="#FF5252" />
          <path d="M3 58 L81 58 C81 72 3 72 3 58 Z" fill="#FF9F2E" stroke="#C25F00" strokeWidth="2" />
        </g>
      )}
      {kind === "pizza" && (
        <g transform="translate(60 60) rotate(-20)">
          <path d="M0 -44 L34 30 Q0 44 -34 30 Z" fill="#FFD54F" stroke="#E09B00" strokeWidth="2" />
          <path d="M-34 30 Q0 44 34 30 L38 38 Q0 54 -38 38 Z" fill="#E8A044" stroke="#B9731C" strokeWidth="2" />
          <g fill="#D7263D"><circle cx="-6" cy="-10" r="7" /><circle cx="10" cy="10" r="7" /><circle cx="-14" cy="18" r="6.5" /><circle cx="2" cy="-28" r="5" /></g>
          <g fill="#89D900"><ellipse cx="12" cy="-6" rx="4" ry="2.4" transform="rotate(30 12 -6)" /><ellipse cx="-4" cy="24" rx="4" ry="2.4" /></g>
        </g>
      )}
      {kind === "cake" && (
        <g transform="translate(22 20)">
          <rect x="34" y="0" width="5" height="16" rx="2" fill="#00CCBC" />
          <path d="M36.5 -6 C40 -1 40 2 36.5 4 C33 2 33 -1 36.5 -6 Z" fill="#FF7B00" />
          <rect x="6" y="18" width="64" height="26" rx="6" fill="#FFF3D6" stroke="#5D4037" strokeWidth="2" />
          <path d="M6 26 Q14 34 22 26 Q30 34 38 26 Q46 34 54 26 Q62 34 70 26 L70 22 L6 22 Z" fill="#920054" />
          <rect x="0" y="44" width="76" height="32" rx="7" fill="#FFD54F" stroke="#5D4037" strokeWidth="2" />
          <path d="M0 54 Q9.5 64 19 54 Q28.5 64 38 54 Q47.5 64 57 54 Q66.5 64 76 54" fill="none" stroke="#920054" strokeWidth="4" />
          <g fill="#FF5252"><circle cx="16" cy="18" r="4" /><circle cx="60" cy="18" r="4" /></g>
        </g>
      )}
    </svg>
  );
}

function BannerCard({ b }: { b: Banner }) {
  const [imgOk, setImgOk] = useState(true);
  const inner = (
    <div className="relative h-44 w-full overflow-hidden rounded-2xl text-white shadow-md" style={{ backgroundColor: b.bgColor }}>
      {b.imageUrl && imgOk && (
        <img src={b.imageUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setImgOk(false)}
          className="absolute inset-0 h-full w-full object-cover" />
      )}
      {/* escurecer à esquerda para o texto ler-se sobre qualquer foto */}
      <div className="absolute inset-0" style={{ background: `linear-gradient(90deg, ${b.bgColor}F2 0%, ${b.bgColor}B3 45%, ${b.bgColor}00 75%)` }} />
      <div className="absolute inset-0 bg-gradient-to-r from-black/30 via-black/10 to-transparent" />
      <div className="relative flex h-full max-w-[64%] flex-col justify-center gap-1 p-4">
        <p className="text-xl font-extrabold leading-tight drop-shadow-sm">{b.title}</p>
        {b.subtitle && <p className="text-sm leading-snug text-white/95">{b.subtitle}</p>}
        {b.ctaLabel && (
          <span className="mt-2 inline-flex w-fit items-center gap-1 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-on-brand">
            {b.ctaLabel} <ChevronRight className="h-3.5 w-3.5" />
          </span>
        )}
      </div>
      <FoodSticker kind={b.sticker} className="absolute -bottom-3 right-3 h-24 w-24 rotate-[-8deg] drop-shadow-lg" />
      {b.imageCredit && imgOk && b.imageUrl && (
        <span className="absolute right-2 top-2 max-w-[70%] truncate rounded bg-black/45 px-1.5 py-0.5 text-[9px] text-white/90">{b.imageCredit}</span>
      )}
    </div>
  );
  if (!b.linkUrl) return inner;
  return b.linkUrl.startsWith("/")
    ? <Link href={b.linkUrl} aria-label={b.title}>{inner}</Link>
    : <a href={b.linkUrl} target="_blank" rel="noreferrer" aria-label={b.title}>{inner}</a>;
}

/** Carrossel de publicidade (geridos em Admin → Publicidade). Desliza sozinho a cada 6 s. */
export function PromoCarousel() {
  const { data } = useQuery<{ banners: Banner[] }>({ queryKey: ["/api/banners"], staleTime: 5 * 60_000 });
  const list = data?.banners ?? [];
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (list.length < 2) return;
    const id = setInterval(() => {
      const el = ref.current;
      if (!el || document.hidden) return;
      const next = (active + 1) % list.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: "smooth" });
    }, 6000);
    return () => clearInterval(id);
  }, [list.length, active]);

  if (!list.length) return null;
  return (
    <div className="px-4 pt-4">
      <div ref={ref} className="flex snap-x snap-mandatory overflow-x-auto scrollbar-hide"
        onScroll={(e) => { const el = e.currentTarget; setActive(Math.round(el.scrollLeft / el.clientWidth)); }}>
        {list.map((b) => <div key={b.id} className="w-full shrink-0 snap-center">{<BannerCard b={b} />}</div>)}
      </div>
      {list.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {list.map((b, i) => (
            <button key={b.id} type="button" aria-label={`Anúncio ${i + 1}`}
              onClick={() => ref.current?.scrollTo({ left: i * ref.current.clientWidth, behavior: "smooth" })}
              className={cn("h-1.5 rounded-full transition-all", i === active ? "w-5 bg-primary" : "w-1.5 bg-neutral-300")} />
          ))}
        </div>
      )}
    </div>
  );
}
