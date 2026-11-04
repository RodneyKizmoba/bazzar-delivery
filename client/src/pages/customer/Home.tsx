import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, MapPin, Star, Clock, Bike, Crown, ChevronRight } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { ErrorState, StoreImage } from "@/components/common";
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

const ZONE_KEY = "pedeai.zone";

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
          <StoreImage name={store.name} url={store.coverUrl} rounded="rounded-2xl"
            className={cn("w-full text-3xl transition-transform duration-300 group-hover:scale-[1.02]", compact ? "h-32" : "h-40", !store.isOpenNow && "opacity-70")} />
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
    <section className="mt-7">
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
    <div className="flex snap-x gap-4 overflow-x-auto px-4 pb-2 scrollbar-hide">
      {stores.slice(0, 10).map((s) => <StoreCard key={s.id} store={s} compact />)}
    </div>
  );
}

interface PopularItem { id: number; name: string; price: number; imageUrl: string | null; storeId: number; storeName: string; dietaryTags: string[] }

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
    <CustomerShell>
      {/* Cabeçalho com saudação, zona e pesquisa */}
      <div className="bg-gradient-to-b from-brand-50 to-white px-4 pb-4 pt-4">
        <p className="text-sm text-neutral-600">{greet}{firstName ? `, ${firstName}` : ""} 👋</p>
        <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-neutral-900">
          {t({ pt: "O que lhe apetece hoje?", en: "What are you craving today?", fr: "Qu'est-ce qui vous ferait plaisir ?" })}
        </h1>

        <div className="mt-3 flex items-center gap-2">
          <MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden />
          <span id="zone-label" className="text-xs font-medium text-neutral-600">{t({ pt: "Entregar em", en: "Deliver to", fr: "Livrer à" })}</span>
          <Select value={zone || "__all"} onValueChange={chooseZone}>
            <SelectTrigger aria-labelledby="zone-label" className="h-8 w-auto min-w-[9rem] rounded-full border-neutral-200 bg-white text-sm font-semibold">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72">
              <SelectItem value="__all">{t({ pt: "Toda Luanda", en: "All of Luanda", fr: "Tout Luanda" })}</SelectItem>
              {(meta.data?.zones ?? (zone ? [zone] : [])).map((zn) => <SelectItem key={zn} value={zn}>{zn}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <form onSubmit={submit} role="search" className="relative mt-3">
          <label htmlFor="home-search" className="sr-only">{t(T.search)}</label>
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden />
          <Input id="home-search" value={q} onChange={(e) => setQ(e.target.value)} enterKeyHint="search"
            placeholder={t({ pt: "Restaurantes, pratos, farmácias…", en: "Restaurants, dishes, pharmacies…", fr: "Restaurants, plats, pharmacies…" })}
            className="h-12 rounded-full border-neutral-200 bg-white pl-12 text-base shadow-sm" />
        </form>
      </div>

      {/* Tipos de loja */}
      <div className="flex gap-3 overflow-x-auto px-4 py-1 scrollbar-hide">
        {(meta.data?.storeTypes ?? Object.keys(STORE_TYPE)).map((type) => STORE_TYPE[type] && (
          <Link key={type} href={`/pesquisa?type=${type}${zq}`}
            className="flex min-w-[4.75rem] flex-col items-center gap-1.5 rounded-2xl px-1 py-2 hover:bg-neutral-50">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl text-2xl" style={{ backgroundColor: `${STORE_TYPE[type].color}2E` }} aria-hidden>{STORE_TYPE[type].icon}</span>
            <span className="text-center text-xs font-medium leading-tight text-neutral-700">{t(STORE_TYPE[type])}</span>
          </Link>
        ))}
      </div>

      {/* PedeAí Plus */}
      <div className="px-4 pt-4">
        <Link href="/plus" className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-primary to-pop p-4 text-on-brand shadow-md">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/20"><Crown className="h-6 w-6" aria-hidden /></span>
          <div className="min-w-0 flex-1">
            <p className="font-bold">PedeAí Plus</p>
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
        <Section title={t({ pt: "Populares", en: "Popular", fr: "Populaires" })}>
          <div className="flex gap-3 overflow-x-auto px-4 pb-2 scrollbar-hide">
            {popular.isLoading
              ? [0, 1, 2].map((i) => <Skeleton key={i} className="h-40 w-36 shrink-0 rounded-2xl" />)
              : popular.data!.items.map((it) => (
                <Link key={it.id} href={`/loja/${it.storeId}`} className="w-36 shrink-0 rounded-2xl border bg-white p-2 shadow-sm hover:shadow-md transition-shadow">
                  {it.imageUrl
                    ? <img src={it.imageUrl} alt="" loading="lazy" className="h-24 w-full rounded-xl object-cover" />
                    : <StoreImage name={it.name} className="h-24 w-full text-xl" rounded="rounded-xl" />}
                  <p className="mt-1.5 line-clamp-2 text-sm font-semibold leading-tight text-neutral-900">{it.name}</p>
                  <p className="truncate text-[11px] text-neutral-500">{it.storeName}</p>
                  <p className="text-sm font-semibold text-primary">{kz(it.price)}</p>
                </Link>
              ))}
          </div>
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
      <Section title={t({ pt: "Mais bem avaliados", en: "Top rated", fr: "Les mieux notés" })} href={`/pesquisa?sort=rating${zq}`}>
        <StoreRow url={storesUrl({ zone: z, sort: "rating" })} emptyText={empty} />
      </Section>
      <Section title={t({ pt: "Entrega mais rápida", en: "Fastest delivery", fr: "Livraison la plus rapide" })} href={`/pesquisa?sort=delivery_time${zq}`}>
        <StoreRow url={storesUrl({ zone: z, sort: "delivery_time" })} emptyText={empty} />
      </Section>
      <Section title={t({ pt: "Supermercado e mais", en: "Grocery & more", fr: "Épicerie et plus" })} href={`/pesquisa?type=grocery${zq}`}>
        <NonRestaurantRow zone={z} types={nonRestaurantTypes} emptyText={empty} />
      </Section>
      <div className="h-6" />
    </CustomerShell>
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
    <div className="flex snap-x gap-4 overflow-x-auto px-4 pb-2 scrollbar-hide">
      {list.slice(0, 10).map((s) => <StoreCard key={s.id} store={s} compact />)}
    </div>
  );
}
