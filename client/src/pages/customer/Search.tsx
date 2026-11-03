import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Search as SearchIcon, SlidersHorizontal, X } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { EmptyState, ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT, T, type Tr } from "@/lib/i18n";
import { kz, STORE_TYPE, DIETARY } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StoreCard, StoreCardSkeleton, readStoredZone, type Meta, type StoreCardData } from "@/pages/customer/Home";

interface Filters {
  q: string;
  type: string;
  cuisine: string;
  dietary: string[];
  zone: string;
  minRating: string;
  maxDeliveryTime: string;
  freeDelivery: boolean;
  openNow: boolean;
  chain: string;
  sort: string;
}

const EMPTY: Omit<Filters, "q" | "zone"> = {
  type: "", cuisine: "", dietary: [], minRating: "", maxDeliveryTime: "", freeDelivery: false, openNow: false, chain: "", sort: "recommended",
};

function fromUrl(): Filters {
  const sp = new URLSearchParams(window.location.search);
  return {
    q: sp.get("q") ?? "",
    type: sp.get("type") ?? "",
    cuisine: sp.get("cuisine") ?? "",
    dietary: (sp.get("dietary") ?? "").split(",").filter(Boolean),
    zone: sp.get("zone") ?? readStoredZone(),
    minRating: sp.get("minRating") ?? "",
    maxDeliveryTime: sp.get("maxDeliveryTime") ?? "",
    freeDelivery: sp.get("freeDelivery") === "1",
    openNow: sp.get("openNow") === "1",
    chain: sp.get("homeBusiness") === "1" ? "home" : sp.get("chain") ?? "",
    sort: sp.get("sort") ?? "recommended",
  };
}

function toParams(f: Filters): URLSearchParams {
  const sp = new URLSearchParams();
  if (f.q.trim()) sp.set("q", f.q.trim());
  if (f.type) sp.set("type", f.type);
  if (f.cuisine) sp.set("cuisine", f.cuisine);
  if (f.dietary.length) sp.set("dietary", f.dietary.join(","));
  if (f.zone) sp.set("zone", f.zone);
  if (f.minRating) sp.set("minRating", f.minRating);
  if (f.maxDeliveryTime) sp.set("maxDeliveryTime", f.maxDeliveryTime);
  if (f.freeDelivery) sp.set("freeDelivery", "1");
  if (f.openNow) sp.set("openNow", "1");
  if (f.chain === "home") sp.set("homeBusiness", "1");
  else if (f.chain) sp.set("chain", f.chain);
  if (f.sort && f.sort !== "recommended") sp.set("sort", f.sort);
  return sp;
}

const SORTS: Record<string, Tr> = {
  recommended: { pt: "Recomendados", en: "Recommended", fr: "Recommandés" },
  rating: { pt: "Melhor avaliação", en: "Top rated", fr: "Mieux notés" },
  delivery_time: { pt: "Entrega mais rápida", en: "Fastest delivery", fr: "Livraison rapide" },
  delivery_fee: { pt: "Menor taxa de entrega", en: "Lowest delivery fee", fr: "Frais les plus bas" },
  name: { pt: "Nome (A–Z)", en: "Name (A–Z)", fr: "Nom (A–Z)" },
};

function Chip({ active, onClick, children, label }: { active: boolean; onClick: () => void; children: ReactNode; label?: string }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} aria-label={label}
      className={cn("inline-flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors",
        active ? "border-primary bg-primary text-primary-foreground" : "border-neutral-200 bg-white text-neutral-700 hover:bg-neutral-50")}>
      {children}
    </button>
  );
}

export default function Search() {
  const t = useT();
  const [f, setF] = useState<Filters>(fromUrl);
  const [text, setText] = useState(f.q);
  const [sheetOpen, setSheetOpen] = useState(false);

  const meta = useQuery<Meta>({ queryKey: ["/api/meta"], staleTime: 5 * 60_000 });

  // pesquisa com debounce
  useEffect(() => {
    const id = setTimeout(() => setF((prev) => (prev.q === text ? prev : { ...prev, q: text })), 350);
    return () => clearTimeout(id);
  }, [text]);

  const params = useMemo(() => toParams(f), [f]);
  const qs = params.toString();

  // manter URL sincronizado
  useEffect(() => {
    const url = `/pesquisa${qs ? `?${qs}` : ""}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, "", url);
  }, [qs]);

  const results = useQuery<{ stores: StoreCardData[] }>({ queryKey: [`/api/stores${qs ? `?${qs}` : ""}`] });

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setF((prev) => ({ ...prev, [k]: v }));
  const toggleDiet = (tag: string) => set("dietary", f.dietary.includes(tag) ? f.dietary.filter((d) => d !== tag) : [...f.dietary, tag]);

  const activeCount = [f.type, f.cuisine, f.minRating, f.maxDeliveryTime, f.chain].filter(Boolean).length
    + f.dietary.length + Number(f.freeDelivery) + Number(f.openNow) + Number(f.sort !== "recommended");

  const clearFilters = () => { setF((prev) => ({ ...prev, ...EMPTY })); };
  const clearAll = () => { setText(""); setF((prev) => ({ ...prev, ...EMPTY, q: "" })); };

  const stores = results.data?.stores ?? [];
  const types = meta.data?.storeTypes ?? Object.keys(STORE_TYPE);
  const dietTags = meta.data?.dietaryTags ?? Object.keys(DIETARY);
  const any = t({ pt: "Qualquer", en: "Any", fr: "Tous" });

  return (
    <CustomerShell>
      <div className="sticky top-[53px] z-20 border-b bg-white/95 px-4 pb-3 pt-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <div className="relative flex-1" role="search">
            <label htmlFor="search-q" className="sr-only">{t(T.search)}</label>
            <SearchIcon className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-neutral-400" aria-hidden />
            <Input id="search-q" autoFocus={!f.type} value={text} onChange={(e) => setText(e.target.value)} enterKeyHint="search"
              placeholder={t({ pt: "Pesquisar lojas ou pratos", en: "Search stores or dishes", fr: "Rechercher magasins ou plats" })}
              className="h-11 rounded-full bg-neutral-50 pl-11 pr-10" />
            {text && (
              <button type="button" onClick={() => setText("")} aria-label={t({ pt: "Limpar pesquisa", en: "Clear search", fr: "Effacer" })}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full hover:bg-neutral-200">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button variant="outline" className="relative h-11 rounded-full px-3" onClick={() => setSheetOpen(true)}
            aria-label={t({ pt: "Filtros", en: "Filters", fr: "Filtres" })}>
            <SlidersHorizontal className="h-5 w-5" />
            {activeCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] text-white">{activeCount}</span>
            )}
          </Button>
        </div>

        {/* chips rápidos */}
        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 scrollbar-hide">
          {types.map((ty) => STORE_TYPE[ty] && (
            <Chip key={ty} active={f.type === ty} onClick={() => set("type", f.type === ty ? "" : ty)}>
              <span aria-hidden>{STORE_TYPE[ty].icon}</span> {t(STORE_TYPE[ty])}
            </Chip>
          ))}
          <Chip active={f.openNow} onClick={() => set("openNow", !f.openNow)}>{t({ pt: "Aberto agora", en: "Open now", fr: "Ouvert" })}</Chip>
          <Chip active={f.freeDelivery} onClick={() => set("freeDelivery", !f.freeDelivery)}>{t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" })}</Chip>
          <Chip active={f.minRating === "4.5"} onClick={() => set("minRating", f.minRating === "4.5" ? "" : "4.5")}>★ 4.5+</Chip>
          <Chip active={f.maxDeliveryTime === "30"} onClick={() => set("maxDeliveryTime", f.maxDeliveryTime === "30" ? "" : "30")}>≤ 30 min</Chip>
        </div>
      </div>

      <div className="px-4 pt-3">
        <div className="mb-3 flex items-center justify-between gap-2 text-sm">
          <p className="text-neutral-600" aria-live="polite">
            {results.isLoading ? t(T.loading) : t({
              pt: `${stores.length} ${stores.length === 1 ? "resultado" : "resultados"}`,
              en: `${stores.length} ${stores.length === 1 ? "result" : "results"}`,
              fr: `${stores.length} résultat${stores.length === 1 ? "" : "s"}`,
            })}
            {f.zone && <span className="text-neutral-400"> · {f.zone}</span>}
          </p>
          {activeCount > 0 && (
            <button type="button" onClick={clearFilters} className="font-medium text-primary hover:underline">
              {t({ pt: "Limpar filtros", en: "Clear filters", fr: "Effacer les filtres" })}
            </button>
          )}
        </div>

        {results.isLoading ? (
          <div className="space-y-6">{[0, 1, 2].map((i) => <StoreCardSkeleton key={i} />)}</div>
        ) : results.error ? (
          <ErrorState error={results.error} onRetry={() => results.refetch()} />
        ) : stores.length === 0 ? (
          <EmptyState icon="🔍"
            title={t({ pt: "Nenhum resultado", en: "No results", fr: "Aucun résultat" })}
            text={t({ pt: "Tente outra pesquisa ou remova alguns filtros.", en: "Try a different search or remove some filters.", fr: "Essayez une autre recherche ou retirez des filtres." })}
            action={(activeCount > 0 || f.q || f.zone) ? (
              <div className="flex flex-wrap justify-center gap-2">
                {(activeCount > 0 || f.q) && <Button variant="outline" onClick={clearAll}>{t({ pt: "Limpar filtros", en: "Clear filters", fr: "Effacer les filtres" })}</Button>}
                {f.zone && <Button variant="ghost" onClick={() => set("zone", "")}>{t({ pt: "Ver toda Luanda", en: "Show all Luanda", fr: "Tout Luanda" })}</Button>}
              </div>
            ) : undefined} />
        ) : (
          <ul className="space-y-6 pb-6">
            {stores.map((s) => (
              <li key={s.id}>
                <StoreCard store={s} footer={!!s.matchingItems?.length && (
                  <Link href={`/loja/${s.id}`} className="mt-2 block rounded-xl bg-teal-50 px-3 py-2 text-sm">
                    <span className="font-medium text-neutral-800">{t({ pt: "Encontrámos:", en: "We found:", fr: "Nous avons trouvé :" })}</span>
                    <ul className="mt-1 space-y-0.5">
                      {s.matchingItems.map((m) => (
                        <li key={m.id} className="flex justify-between gap-3 text-neutral-700">
                          <span className="truncate">{m.name}</span>
                          <span className="shrink-0 font-medium">{kz(m.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </Link>
                )} />
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Painel de filtros */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" className="mx-auto max-h-[88vh] max-w-md overflow-y-auto rounded-t-3xl">
          <SheetHeader className="text-left">
            <SheetTitle>{t({ pt: "Filtros", en: "Filters", fr: "Filtres" })}</SheetTitle>
          </SheetHeader>

          <div className="mt-4 space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="f-sort">{t({ pt: "Ordenar por", en: "Sort by", fr: "Trier par" })}</Label>
              <Select value={f.sort} onValueChange={(v) => set("sort", v)}>
                <SelectTrigger id="f-sort"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(SORTS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="f-type">{t({ pt: "Tipo de loja", en: "Store type", fr: "Type" })}</Label>
                <Select value={f.type || "__any"} onValueChange={(v) => set("type", v === "__any" ? "" : v)}>
                  <SelectTrigger id="f-type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__any">{any}</SelectItem>
                    {types.map((ty) => STORE_TYPE[ty] && <SelectItem key={ty} value={ty}>{STORE_TYPE[ty].icon} {t(STORE_TYPE[ty])}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="f-cuisine">{t({ pt: "Cozinha", en: "Cuisine", fr: "Cuisine" })}</Label>
                <Select value={f.cuisine || "__any"} onValueChange={(v) => set("cuisine", v === "__any" ? "" : v)}>
                  <SelectTrigger id="f-cuisine"><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="__any">{any}</SelectItem>
                    {(meta.data?.cuisines ?? []).map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="f-zone">{t({ pt: "Entregar em", en: "Deliver to", fr: "Livrer à" })}</Label>
              <Select value={f.zone || "__any"} onValueChange={(v) => set("zone", v === "__any" ? "" : v)}>
                <SelectTrigger id="f-zone"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="__any">{t({ pt: "Toda Luanda", en: "All of Luanda", fr: "Tout Luanda" })}</SelectItem>
                  {(meta.data?.zones ?? []).map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t({ pt: "Preferências alimentares", en: "Dietary", fr: "Régimes" })}</legend>
              <div className="flex flex-wrap gap-2">
                {dietTags.map((tag) => DIETARY[tag] && (
                  <Chip key={tag} active={f.dietary.includes(tag)} onClick={() => toggleDiet(tag)}>
                    <span aria-hidden>{DIETARY[tag].icon}</span> {t(DIETARY[tag])}
                  </Chip>
                ))}
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t({ pt: "Avaliação mínima", en: "Minimum rating", fr: "Note minimale" })}</legend>
              <div className="flex gap-2">
                <Chip active={!f.minRating} onClick={() => set("minRating", "")}>{any}</Chip>
                <Chip active={f.minRating === "4"} onClick={() => set("minRating", "4")}>★ 4+</Chip>
                <Chip active={f.minRating === "4.5"} onClick={() => set("minRating", "4.5")}>★ 4.5+</Chip>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t({ pt: "Tempo de entrega", en: "Delivery time", fr: "Délai de livraison" })}</legend>
              <div className="flex gap-2">
                <Chip active={!f.maxDeliveryTime} onClick={() => set("maxDeliveryTime", "")}>{any}</Chip>
                <Chip active={f.maxDeliveryTime === "30"} onClick={() => set("maxDeliveryTime", "30")}>≤ 30 min</Chip>
                <Chip active={f.maxDeliveryTime === "45"} onClick={() => set("maxDeliveryTime", "45")}>≤ 45 min</Chip>
              </div>
            </fieldset>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">{t({ pt: "Tipo de negócio", en: "Business type", fr: "Type d'enseigne" })}</legend>
              <div className="flex flex-wrap gap-2">
                <Chip active={!f.chain} onClick={() => set("chain", "")}>{t({ pt: "Todos", en: "All", fr: "Tous" })}</Chip>
                <Chip active={f.chain === "chain"} onClick={() => set("chain", "chain")}>{t({ pt: "Redes", en: "Chains", fr: "Chaînes" })}</Chip>
                <Chip active={f.chain === "independent"} onClick={() => set("chain", "independent")}>{t({ pt: "Independentes", en: "Independent", fr: "Indépendants" })}</Chip>
                <Chip active={f.chain === "home"} onClick={() => set("chain", "home")}>🏠 {t({ pt: "Feito em casa", en: "Home-made", fr: "Fait maison" })}</Chip>
              </div>
            </fieldset>

            <div className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <Label htmlFor="f-free">{t({ pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" })}</Label>
                <Switch id="f-free" checked={f.freeDelivery} onCheckedChange={(v) => set("freeDelivery", v)} />
              </div>
              <div className="flex items-center justify-between">
                <Label htmlFor="f-open">{t({ pt: "Aberto agora", en: "Open now", fr: "Ouvert maintenant" })}</Label>
                <Switch id="f-open" checked={f.openNow} onCheckedChange={(v) => set("openNow", v)} />
              </div>
            </div>
          </div>

          <SheetFooter className="mt-6 flex-row gap-2 sm:justify-between">
            <Button variant="outline" className="flex-1" onClick={clearFilters}>{t({ pt: "Limpar filtros", en: "Clear filters", fr: "Effacer" })}</Button>
            <Button className="flex-1" onClick={() => setSheetOpen(false)}>
              {results.isFetching ? t(T.loading) : t({ pt: `Ver ${stores.length} resultados`, en: `Show ${stores.length} results`, fr: `Voir ${stores.length} résultats` })}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </CustomerShell>
  );
}
