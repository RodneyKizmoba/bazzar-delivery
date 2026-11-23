import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/**
 * Homepage-only photo carousel. It deliberately stays separate from HScroll:
 * the existing HScroll rows retain their own controls and interaction model.
 */
export function PhotoCarousel({ children, label, className }: {
  children: ReactNode;
  label: string;
  className?: string;
}) {
  const t = useT();
  const viewportRef = useRef<HTMLDivElement>(null);
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [playing, setPlaying] = useState(true);
  const isPaused = reducedMotion || hovered || focused || manuallyPaused || !playing;

  useEffect(() => () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
  }, []);

  const pauseForManualUse = useCallback(() => {
    setManuallyPaused(true);
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => setManuallyPaused(false), 5000);
  }, []);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const stepSize = useCallback(() => {
    const viewport = viewportRef.current;
    const first = viewport?.firstElementChild as HTMLElement | null;
    if (!viewport || !first) return 180;
    const gap = Number.parseFloat(getComputedStyle(viewport).columnGap) || 0;
    return first.getBoundingClientRect().width + gap;
  }, []);

  const move = useCallback((direction: -1 | 1, manual: boolean) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    if (manual) pauseForManualUse();
    const max = viewport.scrollWidth - viewport.clientWidth;
    if (max <= 2) return;
    if (direction > 0 && viewport.scrollLeft >= max - 4) {
      viewport.scrollTo({ left: 0, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    if (direction < 0 && viewport.scrollLeft <= 4) {
      viewport.scrollTo({ left: max, behavior: reducedMotion ? "auto" : "smooth" });
      return;
    }
    viewport.scrollBy({ left: direction * stepSize(), behavior: reducedMotion ? "auto" : "smooth" });
  }, [reducedMotion, stepSize, pauseForManualUse]);

  useEffect(() => {
    if (isPaused) return;
    const timer = window.setInterval(() => {
      const viewport = viewportRef.current;
      if (!viewport || viewport.scrollWidth - viewport.clientWidth <= 2) return;
      const max = viewport.scrollWidth - viewport.clientWidth;
      if (viewport.scrollLeft >= max - 4) {
        viewport.scrollTo({ left: 0, behavior: "auto" });
      } else {
        viewport.scrollBy({ left: stepSize(), behavior: "smooth" });
      }
    }, 4200);
    return () => window.clearInterval(timer);
  }, [isPaused, stepSize]);

  const isExplicitlyPaused = !playing;
  const togglePlayback = () => {
    if (isExplicitlyPaused) {
      setPlaying(true);
      setManuallyPaused(false);
    } else {
      setPlaying(false);
      setManuallyPaused(false);
    }
  };

  return (
    <div
      className="relative"
      role="region"
      aria-label={label}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setHovered(true); }}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        // Touch/click focus must not leave autoplay paused after an interaction.
        setFocused(event.target.matches(":focus-visible"));
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
      onTouchStart={pauseForManualUse}
      onWheel={(event) => { if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) pauseForManualUse(); }}
    >
      <div className="mb-2 flex justify-end px-1">
        <button
          type="button"
          onClick={togglePlayback}
          aria-label={!isExplicitlyPaused
            ? t({ pt: "Pausar carrossel", en: "Pause carousel", fr: "Mettre le carrousel en pause" })
            : t({ pt: "Reproduzir carrossel", en: "Play carousel", fr: "Lire le carrousel" })}
          aria-pressed={!isExplicitlyPaused}
          className="inline-flex h-8 items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-3 text-xs font-semibold text-neutral-700 shadow-sm transition-colors hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          {!isExplicitlyPaused ? <Pause className="h-3.5 w-3.5" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
          <span>{!isExplicitlyPaused
            ? t({ pt: "Pausar", en: "Pause", fr: "Pause" })
            : t({ pt: "Reproduzir", en: "Play", fr: "Lire" })}</span>
        </button>
      </div>
      <div
        ref={viewportRef}
        className={cn("flex gap-2 overflow-x-auto overscroll-x-contain scrollbar-hide", className)}
        onPointerDown={pauseForManualUse}
        onScroll={() => {
          // Keep this handler intentionally passive: auto and manual scrolling share the same viewport.
        }}
      >
        {children}
      </div>
      <button
        type="button"
        onClick={() => move(-1, true)}
        aria-label={t({ pt: "Ver anteriores", en: "Previous", fr: "Précédent" })}
        className="absolute left-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/95 text-neutral-800 shadow-md transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ChevronLeft className="h-5 w-5" aria-hidden />
      </button>
      <button
        type="button"
        onClick={() => move(1, true)}
        aria-label={t({ pt: "Ver mais", en: "Next", fr: "Suivant" })}
        className="absolute right-1 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/70 bg-white/95 text-neutral-800 shadow-md transition-transform hover:scale-105 active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <ChevronRight className="h-5 w-5" aria-hidden />
      </button>
    </div>
  );
}

export function CarouselImage({ src, alt, className, fallbackClassName, fallbackLabel }: {
  src: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
  fallbackLabel: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return <span className={cn("flex items-center justify-center text-center text-xs font-semibold text-neutral-600", fallbackClassName)}>{fallbackLabel}</span>;
  }
  return <img src={src} alt={alt} loading="lazy" className={className} onError={() => setFailed(true)} />;
}
