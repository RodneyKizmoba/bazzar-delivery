import { useState, type FormEvent, type ReactNode } from "react";
import { HScroll } from "@/components/HScroll";
import { PromoCarousel } from "@/components/PromoCarousel";
import { CarouselImage, PhotoCarousel } from "@/components/PhotoCarousel";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, MapPin, Star, Crown, ChevronRight } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { ErrorState, StoreImage } from "@/components/common";
import { CategoryArt, CATEGORY_TILE_BG } from "@/components/CategoryArt";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useT, T } from "@/lib/i18n";
import { kz, STORE_TYPE } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tipos e componentes partilhados (também usados por Search e Favorites)
// ---------------------------------------------------------------------------

export interface StoreCardData {
  id: number;
  name: string;
  storeType: string;
  description: string | null;
  cuisines: string[];
  isChain: boolean;
  isHomeBusiness?: boolean;
  minNoticeMin?: number;
  zone: string;
  street?: string;
  logoUrl: string | null;
  coverUrl: string | null;
  deliveryFee: number;
  minOrder: number;
  deliveryTimeMin: number;
  ratingAvg: number;
  ratingCount: number;
  openingTime?: string;
  closingTime?: string;
  isOpenNow: boolean;
  theme?: string | null;
  matchingItems?: { id: number; name: string; price: number }[];
  sponsored?: boolean;
  offersPickup?: boolean;
  ownDelivery?: boolean;
}

/** Conta o clique numa loja patrocinada (sem atrasar a navegação). */
function adClick(store: StoreCardData) {
  if (!store.sponsored) return;
  try {
    fetch("/api/ads/click", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ storeId: store.id }), keepalive: true, credentials: "include" }).catch(() => {});
  } catch { /* ignorar */ }
}

function SponsoredTag() {
  const t = useT();
  return <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-600">{t({ pt: "Patrocinado", en: "Sponsored", fr: "Sponsorisé" })}</span>;
}

export interface Meta {
  storeTypes: string[];
  dietaryTags: string[];
  zones: string[];
  cuisines: string[];
  plus: { monthlyPrice: number; freeDeliveryMinOrder: number };
  points: { pointValueKz: number; kzPerPointEarned: number; maxDiscountPct: number };
}

const ZONE_KEY = "pedeja.zone";

/** Zona guardada no dispositivo (para visitantes). */
export function readStoredZone(): string {
  try { return localStorage.getItem(ZONE_KEY) ?? ""; } catch { return ""; }
}
function storeZone(z: string) {
  try { if (z) localStorage.setItem(ZONE_KEY, z); else localStorage.removeItem(ZONE_KEY); } catch { /* ignore */ }
}

/** Cartão de loja (estilo Deliveroo). `compact` = largura fixa para carrosséis horizontais. */
/** Nota ao estilo Deliveroo: estrela teal, nota e palavra ("Excelente"). */
export function RatingText({ avg, count, className }: { avg: number; count: number; className?: string }) {
  const t = useT();
  if (!count) return <span className={cn("rounded-full bg-brand-100 px-2 py-0.5 text-[11px] font-semibold text-primary", className)}>{t({ pt: "Novo", en: "New", fr: "Nouveau" })}</span>;
  const word = avg >= 4.5 ? t({ pt: "Excelente", en: "Excellent", fr: "Excellent" }) : avg >= 4 ? t({ pt: "Muito bom", en: "Very good", fr: "Très bien" }) : avg >= 3.5 ? t({ pt: "Bom", en: "Good", fr: "Bien" }) : "";
  return (
    <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium text-primary", className)}>
      <Star className="h-3.5 w-3.5 fill-current" aria-hidden />{avg.toFixed(1)} {word} <span className="font-normal text-neutral-500">({count > 500 ? "500+" : count})</span>
    </span>
  );
}

/** Imagem da loja: foto real; sem foto, um mosaico cinzento com o desenho do tipo de loja. */
function StorePhoto({ store, className, rounded = "rounded-xl" }: { store: StoreCardData; className?: string; rounded?: string }) {
  return store.coverUrl
    ? <StoreImage name={store.name} url={store.coverUrl} rounded={rounded} className={cn("object-cover", !store.isOpenNow && "opacity-60 grayscale", className)} />
    : (
      <div className={cn("relative flex items-center justify-center bg-neutral-100", rounded, !store.isOpenNow && "opacity-60", className)}>
        <CategoryArt kind={store.storeType} className="h-3/4 w-3/4" />
      </div>
    );
}

const timeRange = (min: number) => `${min}–${min + 15} min`;

export function StoreCard({ store, compact, footer }: { store: StoreCardData; compact?: boolean; footer?: ReactNode }) {
  const t = useT();
  return (
    <div className={cn("group", compact ? "w-72 shrink-0 snap-start" : "w-full")}>
      <Link href={`/loja/${store.id}`} onClick={() => adClick(store)} className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <div className="relative overflow-hidden rounded-xl">
          <StorePhoto store={store} className={cn("w-full transition-transform duration-300 group-hover:scale-[1.02]", compact ? "h-36" : "h-44")} />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {!store.isOpenNow && (
              <span className="rounded-md bg-neutral-900/85 px-2 py-1 text-[11px] font-semibold text-white">
                {t({ pt: "Fechado — agende", en: "Closed — schedule", fr: "Fermé — programmez" })}
              </span>
            )}
            {store.deliveryFee === 0 && store.isOpenNow && (
              <span className="rounded-md bg-primary px-2 py-1 text-[11px] font-bold text-on-brand">{t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" })}</span>
            )}
            {store.isHomeBusiness && (
              <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm">🏠 {t({ pt: "Feito em casa", en: "Home-made", fr: "Fait maison" })}</span>
            )}
            {!!store.minNoticeMin && (
              <span className="rounded-md bg-white px-2 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm">{t({ pt: "Por encomenda", en: "Pre-order", fr: "Sur commande" })}</span>
            )}
          </div>
          <span className="absolute bottom-2 right-2 rounded-full bg-white px-2.5 py-1 text-xs font-bold text-neutral-900 shadow">
            {timeRange(store.deliveryTimeMin)}
          </span>
        </div>
        <div className="mt-2 px-0.5">
          <h3 className="flex items-center gap-1.5 truncate text-base font-bold text-neutral-900"><span className="truncate">{store.name}</span>{store.sponsored && <SponsoredTag />}</h3>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-neutral-500">
            <RatingText avg={store.ratingAvg} count={store.ratingCount} />
            <span aria-hidden>·</span>
            <span className="truncate">{store.cuisines.slice(0, 2).join(" · ") || (STORE_TYPE[store.storeType] ? t(STORE_TYPE[store.storeType]) : "")}</span>
          </p>
          <p className="text-[13px] text-neutral-500">
            {store.deliveryFee === 0
              ? <span className="font-semibold text-primary">{t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" })}</span>
              : <>{kz(store.deliveryFee)} {t({ pt: "entrega", en: "delivery", fr: "livraison" })}</>}
            {store.minOrder > 0 && <> · {t({ pt: "mín.", en: "min.", fr: "min." })} {kz(store.minOrder)}</>}
            {store.offersPickup && <> · {t({ pt: "recolha", en: "pickup", fr: "retrait" })}</>}
          </p>
        </div>
      </Link>
      {footer}
    </div>
  );
}

/** Linha de loja (Deliveroo "Popular near you"): foto à esquerda, dados ao centro, nota à direita. */
export function StoreListRow({ store }: { store: StoreCardData }) {
  const t = useT();
  return (
    <Link href={`/loja/${store.id}`} onClick={() => adClick(store)} className="flex items-center gap-3 rounded-xl py-2.5 hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
      <StorePhoto store={store} className="h-[72px] w-[72px] shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-bold text-neutral-900"><span className="truncate">{store.name}</span>{store.sponsored && <SponsoredTag />}</p>
        <p className="truncate text-[13px] text-neutral-500">{store.cuisines.slice(0, 2).join(" · ") || (STORE_TYPE[store.storeType] ? t(STORE_TYPE[store.storeType]) : "")}</p>
        <p className="text-[13px] text-neutral-500">
          {timeRange(store.deliveryTimeMin)} · {store.deliveryFee === 0 ? <span className="font-semibold text-primary">{t({ pt: "grátis", en: "free", fr: "gratuit" })}</span> : kz(store.deliveryFee)}
          {!store.isOpenNow && <span className="ml-1 font-semibold text-neutral-700">· {t({ pt: "Fechado", en: "Closed", fr: "Fermé" })}</span>}
        </p>
      </div>
      {store.ratingCount > 0
        ? <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-primary px-2 py-1 text-xs font-bold text-on-brand"><Star className="h-3 w-3 fill-current" aria-hidden />{store.ratingAvg.toFixed(1)}</span>
        : <span className="shrink-0 rounded-full bg-brand-100 px-2 py-1 text-[11px] font-semibold text-primary">{t({ pt: "Novo", en: "New", fr: "Nouveau" })}</span>}
    </Link>
  );
}

export function StoreCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cn(compact ? "w-72 shrink-0" : "w-full")} aria-hidden>
      <Skeleton className={cn("w-full rounded-xl", compact ? "h-36" : "h-44")} />
      <div className="mt-2 space-y-1.5">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página inicial
// ---------------------------------------------------------------------------

function storesUrl(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
  return `/api/stores?${sp.toString()}`;
}

function Section({ title, href, children }: { title: string; href?: string; children: ReactNode }) {
  const t = useT();
  return (
    <section className="mt-7">
      <div className="mb-3 flex items-center justify-between px-4">
        <h2 className="text-xl font-bold text-neutral-900">{title}</h2>
        {href && (
          <Link href={href} className="flex items-center text-sm font-medium text-primary">
            {t({ pt: "Ver tudo", en: "See all", fr: "Tout voir" })} <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function StoreRow({ url, emptyText }: { url: string; emptyText: string }) {
  const q = useQuery<{ stores: StoreCardData[] }>({ queryKey: [url] });
  if (q.isLoading) {
    return <div className="flex gap-4 overflow-hidden px-4">{[0, 1].map((i) => <StoreCardSkeleton key={i} compact />)}</div>;
  }
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const stores = q.data?.stores ?? [];
  if (!stores.length) return <p className="px-4 text-sm text-neutral-500">{emptyText}</p>;
  return (
    <HScroll snap className="flex gap-4 scroll-px-4 px-4 pb-2" label="Lojas">
      {stores.slice(0, 10).map((s) => <div key={s.id} className="snap-start"><StoreCard store={s} compact /></div>)}
    </HScroll>
  );
}

interface PopularItem { id: number; name: string; price: number; imageUrl: string | null; storeId: number; storeName: string; dietaryTags: string[] }

/** Atalhos de cozinha (como no Deliveroo): pesquisam pelo tipo de comida. */
const CUISINE_TILES = [
  { key: "burger", image: "burger.jpg", q: "Hambúrgueres", pt: "Hambúrgueres", en: "Burgers", fr: "Burgers" },
  { key: "pizza", image: "pizza.jpg", q: "Pizza", pt: "Pizza", en: "Pizza", fr: "Pizza" },
  { key: "grill", image: "chicken.jpg", q: "Grelhados", pt: "Grelhados", en: "Grill", fr: "Grillades" },
  { key: "angolan", image: "angola-mufete.jpg", q: "Angolana", pt: "Angolana", en: "Angolan", fr: "Angolaise" },
  { key: "sushi", image: "sushi.jpg", q: "Sushi", pt: "Sushi", en: "Sushi", fr: "Sushi" },
];

export default function Home() {
  const t = useT();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const meta = useQuery<Meta>({ queryKey: ["/api/meta"], staleTime: 5 * 60_000 });
  const addresses = useQuery<{ addresses: { id: number; zone: string; isDefault: boolean }[] }>({
    queryKey: ["/api/addresses"], enabled: !!user && user.userType === "customer",
  });
  const popular = useQuery<{ items: PopularItem[] }>({ queryKey: ["/api/popular-items"] });

  const addrZone = addresses.data?.addresses.find((a) => a.isDefault)?.zone ?? addresses.data?.addresses[0]?.zone;
  const zone = picked ?? (user ? addrZone ?? readStoredZone() : readStoredZone());

  const chooseZone = (z: string) => {
    const v = z === "__all" ? "" : z;
    setPicked(v);
    storeZone(v);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const sp = new URLSearchParams();
    if (q.trim()) sp.set("q", q.trim());
    if (zone) sp.set("zone", zone);
    navigate(`/pesquisa?${sp.toString()}`);
  };

  const firstName = user?.fullName.split(" ")[0];
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Luanda" }).format(new Date()));
  const greet = hour < 12
    ? t({ pt: "Bom dia", en: "Good morning", fr: "Bonjour" })
    : hour < 19 ? t({ pt: "Boa tarde", en: "Good afternoon", fr: "Bon après-midi" }) : t({ pt: "Boa noite", en: "Good evening", fr: "Bonsoir" });

  const z = zone || undefined;
  const zq = zone ? `&zone=${encodeURIComponent(zone)}` : "";
  const nonRestaurantTypes = (meta.data?.storeTypes ?? Object.keys(STORE_TYPE)).filter((s) => s !== "restaurant");
  const empty = t({ pt: "Ainda não há lojas nesta zona.", en: "No stores in this area yet.", fr: "Pas encore de magasins dans cette zone." });

  return (
    <CustomerShell bare>
      {/* Deliveroo: "Agora · Localização ▾" e a pesquisa cinzenta */}
      <div className="bg-brand-500 px-4 pb-4 pt-1">
        <div className="flex items-end justify-between gap-2">
          <div className="min-w-0">
            <span id="zone-label" className="block text-xs font-medium text-neutral-900/80">{t({ pt: "Agora · entregar em", en: "Now · deliver to", fr: "Maintenant · livrer à" })}</span>
            <Select value={zone || "__all"} onValueChange={chooseZone}>
              <SelectTrigger aria-labelledby="zone-label" className="h-auto w-auto gap-1 border-0 bg-transparent p-0 text-lg font-bold text-neutral-900 shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:text-neutral-900 [&>svg]:opacity-100">
                <MapPin className="mr-0.5 h-4 w-4 shrink-0 text-neutral-900" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">{t({ pt: "Toda Luanda", en: "All of Luanda", fr: "Tout Luanda" })}</SelectItem>
                {(meta.data?.zones ?? (zone ? [zone] : [])).map((zn) => <SelectItem key={zn} value={zn}>{zn}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="shrink-0 pb-0.5 text-sm font-medium text-neutral-900/80">{greet}{firstName ? `, ${firstName}` : ""}</span>
        </div>

        <form onSubmit={submit} role="search" className="relative mt-3">
          <label htmlFor="home-search" className="sr-only">{t(T.search)}</label>
          <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-500" aria-hidden />
          <Input id="home-search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
            placeholder={t({ pt: "Restaurantes, pratos, lojas…", en: "Restaurants, dishes, shops…", fr: "Restaurants, plats, magasins…" })}
            className="h-12 rounded-xl border-0 bg-white pl-11 text-base shadow-sm focus-visible:ring-2 focus-visible:ring-neutral-900" />
        </form>
      </div>

      {/* Serviços: Restaurantes, Mercado, Farmácia, Táxi… (Envios em breve) */}
      <ServiceGrid zq={zq} />

      {/* Publicidade */}
      <PromoCarousel />

      {/* Voltar a pedir */}
      {user?.userType === "customer" && <OrderAgain />}

      {/* Destaques: cartões grandes */}
      <Section title={t({ pt: "Em destaque", en: "Featured", fr: "À la une" })} href={`/pesquisa?sort=rating${zq}`}>
        <StoreRow url={storesUrl({ zone: z, sort: "rating" })} emptyText={empty} />
      </Section>

      {/* Populares perto de si: lista com foto à esquerda */}
      <Section title={t({ pt: "Populares perto de si", en: "Popular near you", fr: "Populaires près de chez vous" })} href={`/pesquisa?sort=recommended${zq}`}>
        <StoreList url={storesUrl({ zone: z, sort: "recommended" })} emptyText={empty} />
      </Section>

      {/* O que lhe apetece? (Deliveroo: mosaicos de cozinha) */}
      <Section title={t({ pt: "O que lhe apetece?", en: "What do you fancy?", fr: "Qu'est-ce qui vous tente ?" })}>
        <PhotoCarousel label={t({ pt: "Categorias de cozinha", en: "Cuisine categories", fr: "Catégories de cuisine" })} className="px-3 pb-1">
          {CUISINE_TILES.map((c) => (
            <Link key={c.key} href={`/pesquisa?q=${encodeURIComponent(c.q)}${zq}`}
              className="group flex w-[5.25rem] shrink-0 snap-start flex-col items-center gap-1.5 rounded-2xl pb-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
              <span className="relative flex h-[4.75rem] w-[4.75rem] items-center justify-center overflow-hidden rounded-2xl bg-neutral-100 transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95"
                style={{ backgroundColor: CATEGORY_TILE_BG[c.key] ?? "#F1F5F9" }}>
                <CarouselImage src={`/photos/catalog/${c.image}`} alt="" fallbackLabel={t({ pt: "Foto indisponível", en: "Photo unavailable", fr: "Photo indisponible" })}
                  fallbackClassName="h-full w-full px-1" className="h-full w-full object-cover" />
              </span>
              <span className="line-clamp-2 text-center text-[13px] font-semibold leading-tight text-neutral-900">{t(c)}</span>
            </Link>
          ))}
        </PhotoCarousel>
      </Section>

      {/* PedeJá Plus */}
      <div className="px-4 pt-7">
        <Link href="/plus" className="flex items-center gap-3 rounded-xl bg-brand-500 p-4 shadow-sm">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-primary"><Crown className="h-6 w-6" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold text-neutral-900">PedeJá Plus</p>
            <p className="text-sm text-neutral-900">
              {meta.data
                ? t({
                  pt: `Entregas grátis acima de ${kz(meta.data.plus.freeDeliveryMinOrder)} por ${kz(meta.data.plus.monthlyPrice)}/mês`,
                  en: `Free delivery over ${kz(meta.data.plus.freeDeliveryMinOrder)} for ${kz(meta.data.plus.monthlyPrice)}/month`,
                  fr: `Livraison gratuite dès ${kz(meta.data.plus.freeDeliveryMinOrder)} pour ${kz(meta.data.plus.monthlyPrice)}/mois`,
                })
                : t({ pt: "Entregas grátis e vantagens exclusivas", en: "Free delivery and exclusive perks", fr: "Livraison gratuite et avantages exclusifs" })}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0 text-neutral-900" aria-hidden />
        </Link>
      </div>

      {/* Pratos populares */}
      {(popular.isLoading || (popular.data?.items.length ?? 0) > 0) && (
        <Section title={t({ pt: "Pratos populares", en: "Popular dishes", fr: "Plats populaires" })}>
          <HScroll snap className="flex gap-3 scroll-px-4 px-4 pb-2" label="Populares">
            {popular.isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-44 w-36 shrink-0 rounded-xl" />)
              : popular.data!.items.map((it) => (
                <Link key={it.id} href={`/loja/${it.storeId}`} className="w-36 shrink-0 snap-start">
                  {it.imageUrl
                    ? <img src={it.imageUrl} alt="" loading="lazy" className="h-28 w-full rounded-xl bg-neutral-100 object-cover" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                    : <StoreImage name={it.name} className="h-28 w-full text-xl" rounded="rounded-xl" />}
                  <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight text-neutral-900">{it.name}</p>
                  <p className="truncate text-xs text-neutral-500">{it.storeName}</p>
                  <p className="text-sm font-semibold text-neutral-900">{kz(it.price)}</p>
                </Link>
              ))}
          </HScroll>
        </Section>
      )}
      {popular.error && <ErrorState error={popular.error} onRetry={() => popular.refetch()} />}

      <Section title={t({ pt: "Feito em casa 🏠", en: "Home-made 🏠", fr: "Fait maison 🏠" })} href={`/pesquisa?homeBusiness=1${zq}`}>
        <StoreRow url={storesUrl({ zone: z, homeBusiness: "1", sort: "rating" })}
          emptyText={t({ pt: "Ainda não há negócios caseiros na sua zona.", en: "No home businesses in your area yet.", fr: "Pas encore de commerces faits maison ici." })} />
      </Section>
      <Section title={t({ pt: "Supermercado e mais", en: "Grocery & more", fr: "Épicerie et plus" })} href={`/pesquisa?type=grocery${zq}`}>
        <NonRestaurantRow zone={z} types={nonRestaurantTypes} emptyText={empty} />
      </Section>

      {/* Todas as lojas, com filtros rápidos */}
      <AllStores zone={z} />
      <div className="h-6" />
    </CustomerShell>
  );
}

/** Lista vertical (até 5) com "Ver tudo". */
function StoreList({ url, emptyText }: { url: string; emptyText: string }) {
  const q = useQuery<{ stores: StoreCardData[] }>({ queryKey: [url] });
  if (q.isLoading) return <div className="space-y-3 px-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-[72px] w-full rounded-xl" />)}</div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const stores = q.data?.stores ?? [];
  if (!stores.length) return <p className="px-4 text-sm text-neutral-500">{emptyText}</p>;
  return <div className="divide-y px-4">{stores.slice(0, 5).map((s) => <StoreListRow key={s.id} store={s} />)}</div>;
}

/** Serviços numa fila de mosaicos cinzentos (Deliveroo: Restaurantes · Mercearia · Lojas). */
function ServiceRow({ zq }: { zq: string }) {
  const t = useT();
  const soon = t({ pt: "Em breve", en: "Soon", fr: "Bientôt" });
  const tiles: { key: string; art: string; label: string; href?: string }[] = [
    { key: "food", art: "restaurant", label: t({ pt: "Restaurantes", en: "Restaurants", fr: "Restaurants" }), href: `/pesquisa?type=restaurant${zq}` },
    { key: "grocery", art: "grocery", label: t({ pt: "Mercado", en: "Grocery", fr: "Épicerie" }), href: `/pesquisa?type=grocery${zq}` },
    { key: "pharmacy", art: "pharmacy", label: t({ pt: "Farmácia", en: "Pharmacy", fr: "Pharmacie" }), href: `/pesquisa?type=pharmacy${zq}` },
    { key: "bakery", art: "bakery", label: t({ pt: "Bolos", en: "Cakes", fr: "Gâteaux" }), href: `/pesquisa?type=bakery${zq}` },
    { key: "flowers", art: "flowers", label: t({ pt: "Flores", en: "Flowers", fr: "Fleurs" }), href: `/pesquisa?type=flowers${zq}` },
    { key: "beauty", art: "beauty", label: t({ pt: "Beleza", en: "Beauty", fr: "Beauté" }), href: `/pesquisa?type=beauty${zq}` },
    { key: "retail", art: "retail", label: t({ pt: "Presentes", en: "Gifts", fr: "Cadeaux" }), href: `/pesquisa?type=retail${zq}` },
    { key: "vintage", art: "vintage", label: "Desapega", href: `/pesquisa?type=vintage${zq}` },
    { key: "jewelry", art: "jewelry", label: t({ pt: "Bijuteria", en: "Jewellery", fr: "Bijoux" }), href: `/pesquisa?type=jewelry${zq}` },
    { key: "other", art: "other", label: t({ pt: "Mais lojas", en: "More shops", fr: "Plus de boutiques" }), href: `/pesquisa?type=other${zq}` },
    { key: "parcel", art: "parcel", label: t({ pt: "Envios", en: "Send", fr: "Envois" }) },
    { key: "taxi", art: "taxi", label: t({ pt: "Táxi", en: "Taxi", fr: "Taxi" }), href: "/taxi" },
  ];
  return (
    <HScroll className="mt-4 flex gap-2 px-4 pb-1" arrowSize="sm" label={t({ pt: "Serviços", en: "Services", fr: "Services" })}>
      {tiles.map((tile) => {
        const body = (
          <>
            <span className="relative flex h-[4.5rem] w-[4.5rem] items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-100">
              <CategoryArt kind={tile.art} className="h-14 w-14" />
              {!tile.href && <span className="absolute -top-1.5 right-0 rounded-full bg-neutral-900 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{soon}</span>}
            </span>
            <span className="text-center text-[13px] font-medium leading-tight text-neutral-900">{tile.label}</span>
          </>
        );
        const cls = "flex w-[4.75rem] shrink-0 flex-col items-center gap-1.5";
        return tile.href
          ? <Link key={tile.key} href={tile.href} className={cn(cls, "active:scale-95")}>{body}</Link>
          : <div key={tile.key} className={cn(cls, "opacity-70")} aria-disabled title={soon}>{body}</div>;
      })}
    </HScroll>
  );
}
/** Mosaicos de serviços, ao estilo Talabat: comida em destaque, depois mercado, farmácia, envios, táxi… */
function ServiceGrid({ zq }: { zq: string }) {
  const t = useT();
  const soon = t({ pt: "Em breve", en: "Soon", fr: "Bientôt" });
  const tiles: { key: string; art: string; image?: string; label: string; sub?: string; href?: string }[] = [
    { key: "food", art: "restaurant", image: "angola-mufete.jpg", label: t({ pt: "Comida", en: "Food", fr: "Repas" }), sub: t({ pt: "Restaurantes e take-away", en: "Restaurants & takeaway", fr: "Restaurants et à emporter" }), href: `/pesquisa?type=restaurant${zq}` },
    { key: "grocery", art: "grocery", image: "angola-market.jpg", label: t({ pt: "Mercado", en: "Grocery", fr: "Épicerie" }), sub: t({ pt: "Compras do dia-a-dia", en: "Everyday shopping", fr: "Courses du quotidien" }), href: `/pesquisa?type=grocery${zq}` },
    { key: "bakery", art: "bakery", image: "cake.jpg", label: t({ pt: "Bolos", en: "Cakes", fr: "Gâteaux" }), href: `/pesquisa?type=bakery${zq}` },
    { key: "pharmacy", art: "pharmacy", image: "service-medication.jpg", label: t({ pt: "Farmácia", en: "Pharmacy", fr: "Pharmacie" }), href: `/pesquisa?type=pharmacy${zq}` },
    { key: "flowers", art: "flowers", image: "roses.jpg", label: t({ pt: "Flores", en: "Flowers", fr: "Fleurs" }), href: `/pesquisa?type=flowers${zq}` },
    { key: "beauty", art: "beauty", image: "service-cosmetics.jpg", label: t({ pt: "Beleza", en: "Beauty", fr: "Beauté" }), href: `/pesquisa?type=beauty${zq}` },
    { key: "retail", art: "retail", image: "service-gifts.jpg", label: t({ pt: "Presentes", en: "Gifts", fr: "Cadeaux" }), href: `/pesquisa?type=retail${zq}` },
    { key: "vintage", art: "vintage", label: "Desapega", sub: t({ pt: "Roupa nova, vintage e em segunda mão", en: "New, vintage & second-hand clothes", fr: "Vêtements neufs, vintage et seconde main" }), href: `/pesquisa?type=vintage${zq}` },
    { key: "jewelry", art: "jewelry", label: t({ pt: "Bijuteria", en: "Jewellery", fr: "Bijoux" }), sub: t({ pt: "Colares, brincos e acessórios", en: "Necklaces, earrings & accessories", fr: "Colliers, boucles et accessoires" }), href: `/pesquisa?type=jewelry${zq}` },
    { key: "other", art: "other", label: t({ pt: "Mais lojas", en: "More shops", fr: "Plus de boutiques" }), sub: t({ pt: "Todos os outros negócios", en: "Every other business", fr: "Tous les autres commerces" }), href: `/pesquisa?type=other${zq}` },
    { key: "parcel", art: "parcel", image: "parcel.jpg", label: t({ pt: "Envios", en: "Send", fr: "Envois" }) },
    { key: "taxi", art: "taxi", image: "taxi.jpg", label: t({ pt: "Táxi", en: "Taxi", fr: "Taxi" }), sub: t({ pt: "Mota, carro e XL", en: "Moto, car & XL", fr: "Moto, voiture et XL" }), href: "/taxi" },
  ];
  const Tile = ({ tile }: { tile: (typeof tiles)[number] }) => {
    const body = (
      <>
        {tile.image && <CarouselImage src={`/photos/catalog/${tile.image}`} alt="" fallbackLabel={t({ pt: "Foto indisponível", en: "Photo unavailable", fr: "Photo indisponible" })}
          fallbackClassName="absolute inset-0" className={cn("absolute inset-0 h-full w-full object-cover", tile.key === "grocery" && "object-bottom")} />}
        {!tile.image && <CategoryArt kind={tile.art} className="absolute -right-1 top-1 h-[5.5rem] w-[5.5rem]" />}
        {tile.image
          ? <span aria-hidden className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/10 to-black/10" />
          : <span aria-hidden className="absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 to-transparent" />}
        {!tile.href && <span className="absolute right-2 top-2 rounded-full bg-neutral-900/85 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-white">{soon}</span>}
        <span className="relative z-[1] mt-auto block w-full text-left text-white">
          <span className="block text-sm font-extrabold leading-tight">{tile.label}</span>
          {tile.sub && <span className="mt-0.5 block text-[10px] leading-tight text-white/90">{tile.sub}</span>}
        </span>
      </>
    );
    const cls = cn("relative flex h-[7.5rem] shrink-0 snap-start flex-col overflow-hidden rounded-2xl p-3 shadow-sm transition-transform active:scale-[0.98]",
      tile.sub ? "w-[11.5rem] sm:w-[13rem]" : "w-[8.25rem] sm:w-[9rem]",
      !tile.href && "cursor-not-allowed");
    const style = { backgroundColor: CATEGORY_TILE_BG[tile.art] ?? "#F1F5F9" };
    return tile.href
      ? <Link href={tile.href} className={cn(cls, "hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary")} style={style}>{body}</Link>
      : <div className={cn(cls, "opacity-85")} style={style} aria-disabled="true" title={soon}>{body}</div>;
  };
  return (
    <section aria-label={t({ pt: "Serviços", en: "Services", fr: "Services" })} className="mx-3 mt-3 rounded-3xl bg-white p-3 shadow-lg">
      <PhotoCarousel label={t({ pt: "Serviços disponíveis", en: "Available services", fr: "Services disponibles" })} className="pb-1">
        {tiles.map((tile) => <Tile key={tile.key} tile={tile} />)}
      </PhotoCarousel>
      <p className="mt-2 text-[10px] leading-relaxed text-neutral-600">
        {t({ pt: "Fotos de Angola", en: "Photos from Angola", fr: "Photos d’Angola" })}:{" "}
        <a href="https://commons.wikimedia.org/wiki/File:Mufete_-_traditional_food_of_Angola.jpg" target="_blank" rel="noreferrer" className="underline">Mufete — Jk-1987</a>
        {" · "}
        <a href="https://commons.wikimedia.org/wiki/File:Ch%E1%BB%A3_qu%C3%AA_-_Lubango.jpg" target="_blank" rel="noreferrer" className="underline">Lubango — Rubytuyen1986</a>
        {" · "}
        <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noreferrer" className="underline">CC BY-SA 4.0</a>
        {" · "}{t({ pt: "recorte de apresentação", en: "cropped for display", fr: "recadrées pour l’affichage" })}
      </p>
    </section>
  );
}

/** "Voltar a pedir": lojas das últimas encomendas (Talabat). */
function OrderAgain() {
  const t = useT();
  const q = useQuery<{ orders: { id: number; storeId: number; storeName: string; storeLogo: string | null }[] }>({ queryKey: ["/api/orders"] });
  const seen = new Set<number>();
  const list = (q.data?.orders ?? []).filter((o) => (seen.has(o.storeId) ? false : (seen.add(o.storeId), true))).slice(0, 10);
  if (!list.length) return null;
  return (
    <Section title={t({ pt: "Voltar a pedir", en: "Order again", fr: "Commander à nouveau" })} href="/encomendas">
      <HScroll className="flex gap-3 px-4 pb-1" arrowSize="sm" label="Voltar a pedir">
        {list.map((o) => (
          <Link key={o.storeId} href={`/loja/${o.storeId}`} className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5">
            <StoreImage name={o.storeName} url={o.storeLogo} className="h-16 w-16 text-sm shadow-sm ring-2 ring-white" rounded="rounded-full" />
            <span className="line-clamp-2 text-center text-[11px] font-medium leading-tight text-neutral-800">{o.storeName}</span>
          </Link>
        ))}
      </HScroll>
    </Section>
  );
}

/** Lista "Todas as lojas" com filtros rápidos (Deliveroo). */
function AllStores({ zone }: { zone?: string }) {
  const t = useT();
  const FILTERS = [
    { key: "freeDelivery", label: t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" }), params: { freeDelivery: "1" } },
    { key: "openNow", label: t({ pt: "Aberto agora", en: "Open now", fr: "Ouvert" }), params: { openNow: "1" } },
    { key: "fast", label: t({ pt: "Mais rápido", en: "Fastest", fr: "Plus rapide" }), params: { sort: "delivery_time" } },
    { key: "rating", label: t({ pt: "Avaliação 4+", en: "Rating 4+", fr: "Note 4+" }), params: { minRating: "4" } },
    { key: "home", label: t({ pt: "Feito em casa", en: "Home-made", fr: "Fait maison" }), params: { homeBusiness: "1" } },
  ] as const;
  const [on, setOn] = useState<string[]>([]);
  const params: Record<string, string | undefined> = { zone, sort: "recommended", limit: "50" };
  for (const f of FILTERS) if (on.includes(f.key)) Object.assign(params, f.params);
  const q = useQuery<{ stores: StoreCardData[] }>({ queryKey: [storesUrl(params)] });
  const toggle = (k: string) => setOn((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <section className="mt-7 pb-4">
      <h2 className="px-4 text-xl font-bold text-neutral-900">{t({ pt: "Todas as lojas", en: "All stores", fr: "Tous les magasins" })}</h2>
      <HScroll className="mt-3 flex gap-2 px-4 pb-1" arrowSize="sm" label="Filtros">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={on.includes(f.key)} onClick={() => toggle(f.key)}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              on.includes(f.key) ? "border-primary bg-brand-100 text-primary" : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50")}>
            {f.label}
          </button>
        ))}
      </HScroll>
      <div className="mt-3 space-y-5 px-4">
        {q.isLoading && [0, 1].map((i) => <StoreCardSkeleton key={i} />)}
        {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
        {q.data && !q.data.stores.length && (
          <p className="py-4 text-center text-sm text-neutral-500">{t({ pt: "Nenhuma loja com estes filtros.", en: "No stores match these filters.", fr: "Aucun magasin ne correspond." })}</p>
        )}
        {q.data?.stores.map((s) => <StoreCard key={s.id} store={s} />)}
      </div>
    </section>
  );
}

/** Supermercado primeiro, depois as outras lojas que não são restaurantes. */
function NonRestaurantRow({ zone, types, emptyText }: { zone?: string; types: string[]; emptyText: string }) {
  // Uma query sem filtro de tipo; filtramos no cliente para incluir todas as lojas não-restaurante.
  const q = useQuery<{ stores: StoreCardData[] }>({ queryKey: [storesUrl({ zone, sort: "recommended", limit: "100" })] });
  if (q.isLoading) return <div className="flex gap-4 overflow-hidden px-4">{[0, 1].map((i) => <StoreCardSkeleton key={i} compact />)}</div>;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = (q.data?.stores ?? [])
    .filter((s) => types.includes(s.storeType))
    .sort((a, b) => Number(b.storeType === "grocery") - Number(a.storeType === "grocery"));
  if (!list.length) return <p className="px-4 text-sm text-neutral-500">{emptyText}</p>;
  return (
    <HScroll snap className="flex gap-4 scroll-px-4 px-4 pb-2" label="Lojas">
      {list.slice(0, 10).map((s) => <div key={s.id} className="snap-start"><StoreCard store={s} compact /></div>)}
    </HScroll>
  );
}
