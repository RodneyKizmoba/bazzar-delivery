import { useState, type FormEvent, type ReactNode } from "react";
import { HScroll } from "@/components/HScroll";
import { PromoCarousel } from "@/components/PromoCarousel";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, MapPin, Star, Clock, Bike, Crown, ChevronRight } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { ErrorState, StoreImage } from "@/components/common";
import { StoreThemeArt, themeFor } from "@/components/StoreThemeArt";
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
export function StoreCard({ store, compact, footer }: { store: StoreCardData; compact?: boolean; footer?: ReactNode }) {
  const t = useT();
  return (
    <div className={cn("group", compact ? "w-64 shrink-0 snap-start" : "w-full")}>
      <Link href={`/loja/${store.id}`} className="block rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-primary">
        <div className="relative overflow-hidden rounded-2xl">
          {store.coverUrl ? (
            <StoreImage name={store.name} url={store.coverUrl} rounded="rounded-2xl"
              className={cn("w-full text-3xl transition-transform duration-300 group-hover:scale-[1.02]", compact ? "h-32" : "h-40", !store.isOpenNow && "opacity-60 grayscale")} />
          ) : (
            <StoreThemeArt theme={themeFor(store)} seed={store.id} muted={!store.isOpenNow}
              className={cn("w-full rounded-2xl transition-transform duration-300 group-hover:scale-[1.02]", compact ? "h-32" : "h-40", !store.isOpenNow && "opacity-60")}>
              <CategoryArt kind={store.storeType} className={cn("absolute bottom-1 left-2 drop-shadow-md", compact ? "h-20 w-20" : "h-24 w-24")} />
            </StoreThemeArt>
          )}
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {!store.isOpenNow && (
              <span className="rounded-full bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold text-white">
                {t({ pt: "Fechado — agende", en: "Closed — schedule", fr: "Fermé — programmez" })}
              </span>
            )}
            {store.isHomeBusiness && (
              <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-900 shadow-sm">
                🏠 {t({ pt: "Feito em casa", en: "Home-made", fr: "Fait maison" })}
              </span>
            )}
            {!!store.minNoticeMin && (
              <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm">
                {t({ pt: "Por encomenda", en: "Pre-order", fr: "Sur commande" })}
              </span>
            )}
            {store.isChain && (
              <span className="rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-800 shadow-sm">
                {t({ pt: "Rede", en: "Chain", fr: "Chaîne" })}
              </span>
            )}
          </div>
          <span className="absolute bottom-2 right-2 flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-neutral-900 shadow">
            <Clock className="h-3.5 w-3.5" aria-hidden /> {store.deliveryTimeMin} {t(T.minutes)}
          </span>
        </div>
        <div className="mt-2 flex items-start gap-2.5 px-0.5">
          <StoreImage name={store.name} url={store.logoUrl} className="h-10 w-10 shrink-0 text-xs" rounded="rounded-xl" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className="truncate font-semibold text-neutral-900">{store.name}</h3>
              {store.ratingCount > 0 ? (
                <span className="flex shrink-0 items-center gap-0.5 text-sm font-medium text-neutral-800">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                  {store.ratingAvg.toFixed(1)} <span className="text-neutral-500 font-normal">({store.ratingCount})</span>
                </span>
              ) : (
                <span className="shrink-0 rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700">
                  {t({ pt: "Novo", en: "New", fr: "Nouveau" })}
                </span>
              )}
            </div>
            <p className="truncate text-xs text-neutral-500">
              {[STORE_TYPE[store.storeType] ? STORE_TYPE[store.storeType].icon : "", store.cuisines.slice(0, 3).join(" · ") || (STORE_TYPE[store.storeType] ? t(STORE_TYPE[store.storeType]) : "")].join(" ")}
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-neutral-600">
              <Bike className="h-3.5 w-3.5" aria-hidden />
              {store.deliveryFee === 0
                ? <span className="font-semibold text-green-700">{t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" })}</span>
                : <span>{kz(store.deliveryFee)}</span>}
              {store.minOrder > 0 && <span className="text-neutral-400">· {t({ pt: "mín.", en: "min.", fr: "min." })} {kz(store.minOrder)}</span>}
            </p>
          </div>
        </div>
      </Link>
      {footer}
    </div>
  );
}

export function StoreCardSkeleton({ compact }: { compact?: boolean }) {
  return (
    <div className={cn(compact ? "w-64 shrink-0" : "w-full")} aria-hidden>
      <Skeleton className={cn("w-full rounded-2xl", compact ? "h-32" : "h-40")} />
      <div className="mt-2 flex gap-2.5">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
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
    <section className="mx-3 mt-3 overflow-hidden rounded-3xl bg-white pb-3 pt-4 shadow-lg">
      <div className="mb-3 flex items-center justify-between px-4">
        <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
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
  { key: "burger", q: "Hambúrgueres", pt: "Hambúrgueres", en: "Burgers", fr: "Burgers" },
  { key: "pizza", q: "Pizza", pt: "Pizza", en: "Pizza", fr: "Pizza" },
  { key: "grill", q: "Grelhados", pt: "Grelhados", en: "Grill", fr: "Grillades" },
  { key: "angolan", q: "Angolana", pt: "Angolana", en: "Angolan", fr: "Angolaise" },
  { key: "sushi", q: "Sushi", pt: "Sushi", en: "Sushi", fr: "Sushi" },
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
      {/* Morada e pesquisa (Talabat: "Entregar em" no topo) */}
      <div className="px-4 pb-1 pt-3 text-white">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <span id="zone-label" className="block text-[11px] font-semibold uppercase tracking-wide text-white/85">{t({ pt: "Entregar em", en: "Deliver to", fr: "Livrer à" })}</span>
            <Select value={zone || "__all"} onValueChange={chooseZone}>
              <SelectTrigger aria-labelledby="zone-label" className="h-auto w-auto gap-1 border-0 bg-transparent p-0 text-lg font-extrabold text-white shadow-none focus:ring-0 focus:ring-offset-0 [&>svg]:opacity-100">
                <MapPin className="mr-0.5 h-4 w-4 shrink-0" aria-hidden />
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="__all">{t({ pt: "Toda Luanda", en: "All of Luanda", fr: "Tout Luanda" })}</SelectItem>
                {(meta.data?.zones ?? (zone ? [zone] : [])).map((zn) => <SelectItem key={zn} value={zn}>{zn}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <span className="shrink-0 text-sm text-white/90">{greet}{firstName ? `, ${firstName}` : ""} 👋</span>
        </div>

        <form onSubmit={submit} role="search" className="relative mt-3">
          <label htmlFor="home-search" className="sr-only">{t(T.search)}</label>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden />
          <Input id="home-search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
            placeholder={t({ pt: "Pratos, restaurantes, lojas…", en: "Dishes, restaurants, shops…", fr: "Plats, restaurants, magasins…" })}
            className="h-12 rounded-full border-0 bg-white pl-12 text-base shadow-md" />
        </form>
      </div>

      {/* Serviços (Talabat): tudo numa só app */}
      <ServiceGrid zq={zq} />

      {/* Publicidade */}
      <PromoCarousel onSky />

      {/* Voltar a pedir (Talabat) */}
      {user?.userType === "customer" && <OrderAgain />}

      {/* O que lhe apetece? (Deliveroo: mosaicos de cozinha) */}
      <Section title={t({ pt: "O que lhe apetece?", en: "What do you fancy?", fr: "Qu'est-ce qui vous tente ?" })}>
        <HScroll className="flex gap-2 px-3 pb-1" arrowSize="sm" label="Categorias">
          {CUISINE_TILES.map((c) => (
            <Link key={c.key} href={`/pesquisa?q=${encodeURIComponent(c.q)}${zq}`}
              className="group flex w-[5.25rem] shrink-0 flex-col items-center gap-1.5 rounded-2xl pb-1">
              <span className="flex h-[4.75rem] w-[4.75rem] items-center justify-center rounded-2xl transition-transform duration-200 group-hover:-translate-y-0.5 group-active:scale-95"
                style={{ backgroundColor: CATEGORY_TILE_BG[c.key] ?? "#F1F5F9" }}>
                <CategoryArt kind={c.key} className="h-[3.9rem] w-[3.9rem] drop-shadow-sm" />
              </span>
              <span className="line-clamp-2 text-center text-[13px] font-semibold leading-tight text-neutral-900">{t(c)}</span>
            </Link>
          ))}
        </HScroll>
      </Section>

      {/* PedeJá Plus */}
      <div className="px-3 pt-3">
        <Link href="/plus" className="flex items-center gap-3 rounded-2xl brand-grad p-4 shadow-md">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20"><Crown className="h-6 w-6" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">PedeJá Plus</p>
            <p className="text-sm opacity-90">
              {meta.data
                ? t({
                  pt: `Entregas grátis acima de ${kz(meta.data.plus.freeDeliveryMinOrder)} por ${kz(meta.data.plus.monthlyPrice)}/mês`,
                  en: `Free delivery over ${kz(meta.data.plus.freeDeliveryMinOrder)} for ${kz(meta.data.plus.monthlyPrice)}/month`,
                  fr: `Livraison gratuite dès ${kz(meta.data.plus.freeDeliveryMinOrder)} pour ${kz(meta.data.plus.monthlyPrice)}/mois`,
                })
                : t({ pt: "Entregas grátis e vantagens exclusivas", en: "Free delivery and exclusive perks", fr: "Livraison gratuite et avantages exclusifs" })}
            </p>
          </div>
          <ChevronRight className="h-5 w-5 shrink-0" aria-hidden />
        </Link>
      </div>

      {/* Populares */}
      {(popular.isLoading || (popular.data?.items.length ?? 0) > 0) && (
        <Section title={t({ pt: "Pratos populares", en: "Popular dishes", fr: "Plats populaires" })}>
          <HScroll snap className="flex gap-3 scroll-px-4 px-4 pb-2" label="Populares">
            {popular.isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-36 shrink-0 rounded-2xl" />)
              : popular.data!.items.map((it) => (
                <Link key={it.id} href={`/loja/${it.storeId}`} className="w-36 shrink-0 snap-start rounded-2xl border bg-white p-2 shadow-sm hover:shadow-md transition-shadow">
                  {it.imageUrl
                    ? <img src={it.imageUrl} alt="" loading="lazy" className="h-24 w-full rounded-xl object-cover" />
                    : <StoreImage name={it.name} className="h-24 w-full text-xl" rounded="rounded-xl" />}
                  <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight text-neutral-900">{it.name}</p>
                  <p className="truncate text-[11px] text-neutral-500">{it.storeName}</p>
                  <p className="text-sm font-semibold text-primary">{kz(it.price)}</p>
                </Link>
              ))}
          </HScroll>
        </Section>
      )}
      {popular.error && <ErrorState error={popular.error} onRetry={() => popular.refetch()} />}

      <Section title={t({ pt: "Perto de si", en: "Near you", fr: "Près de chez vous" })} href={`/pesquisa?sort=recommended${zq}`}>
        <StoreRow url={storesUrl({ zone: z, sort: "recommended" })} emptyText={empty} />
      </Section>
      <Section title={t({ pt: "Feito em casa 🏠", en: "Home-made 🏠", fr: "Fait maison 🏠" })} href={`/pesquisa?homeBusiness=1${zq}`}>
        <StoreRow url={storesUrl({ zone: z, homeBusiness: "1", sort: "rating" })}
          emptyText={t({ pt: "Ainda não há negócios caseiros na sua zona.", en: "No home businesses in your area yet.", fr: "Pas encore de commerces faits maison ici." })} />
      </Section>
      <Section title={t({ pt: "Supermercado e mais", en: "Grocery & more", fr: "Épicerie et plus" })} href={`/pesquisa?type=grocery${zq}`}>
        <NonRestaurantRow zone={z} types={nonRestaurantTypes} emptyText={empty} />
      </Section>

      {/* Todas as lojas (Deliveroo): lista vertical com filtros rápidos */}
      <AllStores zone={z} />
      <div className="h-6" />
    </CustomerShell>
  );
}

/** Mosaicos de serviços, ao estilo Talabat: comida em destaque, depois mercado, farmácia, envios, táxi… */
function ServiceGrid({ zq }: { zq: string }) {
  const t = useT();
  const soon = t({ pt: "Em breve", en: "Soon", fr: "Bientôt" });
  const tiles: { key: string; art: string; label: string; sub?: string; href?: string }[] = [
    { key: "food", art: "restaurant", label: t({ pt: "Comida", en: "Food", fr: "Repas" }), sub: t({ pt: "Restaurantes e take-away", en: "Restaurants & takeaway", fr: "Restaurants et à emporter" }), href: `/pesquisa?type=restaurant${zq}` },
    { key: "grocery", art: "grocery", label: t({ pt: "Mercado", en: "Grocery", fr: "Épicerie" }), sub: t({ pt: "Compras do dia-a-dia", en: "Everyday shopping", fr: "Courses du quotidien" }), href: `/pesquisa?type=grocery${zq}` },
    { key: "bakery", art: "bakery", label: t({ pt: "Bolos", en: "Cakes", fr: "Gâteaux" }), href: `/pesquisa?type=bakery${zq}` },
    { key: "pharmacy", art: "pharmacy", label: t({ pt: "Farmácia", en: "Pharmacy", fr: "Pharmacie" }), href: `/pesquisa?type=pharmacy${zq}` },
    { key: "flowers", art: "flowers", label: t({ pt: "Flores", en: "Flowers", fr: "Fleurs" }), href: `/pesquisa?type=flowers${zq}` },
    { key: "beauty", art: "beauty", label: t({ pt: "Beleza", en: "Beauty", fr: "Beauté" }), href: `/pesquisa?type=beauty${zq}` },
    { key: "retail", art: "retail", label: t({ pt: "Presentes", en: "Gifts", fr: "Cadeaux" }), href: `/pesquisa?type=retail${zq}` },
    { key: "parcel", art: "parcel", label: t({ pt: "Envios", en: "Send", fr: "Envois" }) },
    { key: "taxi", art: "taxi", label: t({ pt: "Táxi", en: "Taxi", fr: "Taxi" }) },
  ];
  const Tile = ({ tile, big }: { tile: (typeof tiles)[number]; big?: boolean }) => {
    const body = (
      <>
        {!tile.href && <span className="absolute right-1.5 top-1.5 rounded-full bg-neutral-900/80 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white">{soon}</span>}
        {big ? (
          <>
            <div className="min-w-0 self-start pt-1">
              <p className="text-base font-extrabold text-neutral-900">{tile.label}</p>
              {tile.sub && <p className="mt-0.5 text-[11px] leading-tight text-neutral-600">{tile.sub}</p>}
            </div>
            <CategoryArt kind={tile.art} className="absolute -bottom-1 -right-1 h-20 w-20 drop-shadow-sm" />
          </>
        ) : (
          <>
            <CategoryArt kind={tile.art} className="h-12 w-12 drop-shadow-sm" />
            <span className="text-center text-[12px] font-semibold leading-tight text-neutral-900">{tile.label}</span>
          </>
        )}
      </>
    );
    const cls = cn("relative flex overflow-hidden rounded-2xl transition-transform active:scale-95",
      big ? "h-28 items-start p-3" : "h-[5.5rem] flex-col items-center justify-center gap-1 px-1",
      !tile.href && "opacity-80");
    const style = { backgroundColor: CATEGORY_TILE_BG[tile.art] ?? "#F1F5F9" };
    return tile.href
      ? <Link href={tile.href} className={cn(cls, "hover:-translate-y-0.5")} style={style}>{body}</Link>
      : <div className={cls} style={style} aria-disabled title={soon}>{body}</div>;
  };
  return (
    <section aria-label={t({ pt: "Serviços", en: "Services", fr: "Services" })} className="mx-3 mt-3 rounded-3xl bg-white p-3 shadow-lg">
      <div className="grid grid-cols-2 gap-2">
        <Tile tile={tiles[0]} big /><Tile tile={tiles[1]} big />
      </div>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {tiles.slice(2).map((tile) => <Tile key={tile.key} tile={tile} />)}
      </div>
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
    <section className="mx-3 mt-3 rounded-3xl bg-white pb-4 pt-4 shadow-lg">
      <h2 className="px-4 text-lg font-bold text-neutral-900">{t({ pt: "Todas as lojas", en: "All stores", fr: "Tous les magasins" })}</h2>
      <HScroll className="mt-3 flex gap-2 px-4 pb-1" arrowSize="sm" label="Filtros">
        {FILTERS.map((f) => (
          <button key={f.key} type="button" aria-pressed={on.includes(f.key)} onClick={() => toggle(f.key)}
            className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              on.includes(f.key) ? "border-primary bg-primary text-white" : "border-neutral-200 bg-white text-neutral-800 hover:bg-neutral-50")}>
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
