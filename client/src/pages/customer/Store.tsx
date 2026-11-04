import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Heart, Star, Clock, Bike, ShoppingBag, Users, Search as SearchIcon, Info, Phone, MapPin } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { DietaryBadges, EmptyState, ErrorState, StoreImage } from "@/components/common";
import { ItemDialog, type ItemSelection, type MenuItemFull } from "@/components/ItemDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCart } from "@/context/CartContext";
import { post, put, del, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { dateTime, kz, DIETARY, STORE_TYPE } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { StoreCardData } from "@/pages/customer/Home";

interface StoreDetail {
  store: StoreCardData & { phone?: string; isApproved?: boolean };
  isFavorite: boolean;
  sections: { id: number; storeId: number; name: string; sortOrder: number }[];
  items: MenuItemFull[];
}
interface Review {
  id: number; rating: number; comment: string | null; reply: string | null;
  createdAt: string; repliedAt: string | null; author: string;
}

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={cn(size, n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-neutral-300")} aria-hidden />
      ))}
    </span>
  );
}

export default function StorePage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const { lang } = useLang();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const cart = useCart();

  const url = `/api/stores/${id}`;
  const q = useQuery<StoreDetail>({ queryKey: [url] });
  const reviews = useQuery<{ reviews: Review[] }>({ queryKey: [`/api/stores/${id}/reviews`], enabled: !!q.data });

  const [tab, setTab] = useState("menu");
  const [search, setSearch] = useState("");
  const [diet, setDiet] = useState<string[]>([]);
  const [selected, setSelected] = useState<MenuItemFull | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pending, setPending] = useState<ItemSelection | null>(null);
  const [activeSection, setActiveSection] = useState<string>("");
  const navRef = useRef<HTMLDivElement>(null);

  const loginNext = () => navigate(`/entrar?next=${encodeURIComponent(`/loja/${id}`)}`);

  const fav = useMutation({
    mutationFn: async (makeFav: boolean) => (makeFav ? put(`/api/favorites/${id}`) : del(`/api/favorites/${id}`)),
    onMutate: (makeFav) => {
      queryClient.setQueryData<StoreDetail>([url], (old) => (old ? { ...old, isFavorite: makeFav } : old));
    },
    onError: (err: Error, makeFav) => {
      queryClient.setQueryData<StoreDetail>([url], (old) => (old ? { ...old, isFavorite: !makeFav } : old));
      toast({ variant: "destructive", title: t(T.error), description: err.message });
    },
    onSuccess: (_d, makeFav) => {
      queryClient.invalidateQueries({ queryKey: ["/api/favorites"] });
      toast({ title: makeFav ? t({ pt: "Adicionado aos favoritos", en: "Added to favourites", fr: "Ajouté aux favoris" }) : t({ pt: "Removido dos favoritos", en: "Removed from favourites", fr: "Retiré des favoris" }) });
    },
  });

  const group = useMutation({
    mutationFn: () => post<{ token: string; participantId: number; secret: string }>("/api/groups", { storeId: Number(id) }),
    onSuccess: (r) => {
      try { localStorage.setItem(`pedeja.group.${r.token}`, JSON.stringify({ participantId: r.participantId, secret: r.secret })); } catch { /* ignore */ }
      navigate(`/grupo/${r.token}`);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });

  const data = q.data;
  const store = data?.store;

  // itens filtrados e agrupados por secção
  const groups = useMemo(() => {
    if (!data) return [];
    const term = search.trim().toLowerCase();
    const visible = data.items.filter((it) =>
      diet.every((d) => it.dietaryTags.includes(d))
      && (!term || it.name.toLowerCase().includes(term) || (it.description ?? "").toLowerCase().includes(term)));
    const out: { key: string; name: string; items: MenuItemFull[] }[] = [];
    const popular = visible.filter((i) => i.isPopular);
    if (popular.length && !term && !diet.length) out.push({ key: "popular", name: t({ pt: "Populares", en: "Popular", fr: "Populaires" }), items: popular });
    for (const s of [...data.sections].sort((a, b) => a.sortOrder - b.sortOrder)) {
      const items = visible.filter((i) => i.sectionId === s.id);
      if (items.length) out.push({ key: `s${s.id}`, name: s.name, items });
    }
    const known = new Set(data.sections.map((s) => s.id));
    const other = visible.filter((i) => i.sectionId == null || !known.has(i.sectionId));
    if (other.length) out.push({ key: "other", name: t({ pt: "Outros", en: "Other", fr: "Autres" }), items: other });
    return out;
  }, [data, search, diet, t]);

  // destaque da secção visível na navegação
  useEffect(() => {
    if (tab !== "menu" || !groups.length) return;
    const obs = new IntersectionObserver((entries) => {
      const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (vis) setActiveSection(vis.target.id.replace("sec-", ""));
    }, { rootMargin: "-120px 0px -60% 0px" });
    groups.forEach((g) => { const el = document.getElementById(`sec-${g.key}`); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [groups, tab]);

  useEffect(() => {
    const btn = navRef.current?.querySelector<HTMLElement>(`[data-sec="${activeSection}"]`);
    btn?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
  }, [activeSection]);

  const scrollTo = (key: string) => {
    const el = document.getElementById(`sec-${key}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 110, behavior: "smooth" });
  };

  const doAdd = (sel: ItemSelection) => {
    if (!store) return;
    cart.add(store.id, store.name, sel);
    setDialogOpen(false);
    toast({ title: t({ pt: "Adicionado ao carrinho", en: "Added to cart", fr: "Ajouté au panier" }), description: `${sel.quantity}× ${sel.name}` });
  };

  const onConfirm = (sel: ItemSelection) => {
    if (!store) return;
    if (!cart.canAddFrom(store.id)) { setPending(sel); setDialogOpen(false); return; }
    doAdd(sel);
  };

  const openItem = (it: MenuItemFull) => {
    if (!it.isAvailable) return;
    setSelected(it);
    setDialogOpen(true);
  };

  const startGroup = () => (user ? group.mutate() : loginNext());
  const toggleFav = () => (user ? fav.mutate(!data?.isFavorite) : loginNext());

  const cartHere = store && cart.storeId === store.id && cart.itemCount > 0;

  if (q.isLoading) {
    return (
      <CustomerShell hideHeader>
        <TopBar title="" back />
        <Skeleton className="h-44 w-full rounded-none" />
        <div className="space-y-3 p-4">
          <Skeleton className="h-6 w-2/3" /><Skeleton className="h-4 w-1/2" /><Skeleton className="h-16 w-full rounded-xl" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}
        </div>
      </CustomerShell>
    );
  }
  if (q.error || !data || !store) {
    return (
      <CustomerShell hideHeader>
        <TopBar title={t({ pt: "Loja", en: "Store", fr: "Magasin" })} back />
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      </CustomerShell>
    );
  }

  const favLabel = data.isFavorite ? t({ pt: "Remover dos favoritos", en: "Remove from favourites", fr: "Retirer des favoris" }) : t({ pt: "Adicionar aos favoritos", en: "Add to favourites", fr: "Ajouter aux favoris" });

  return (
    <CustomerShell hideHeader>
      <TopBar title={store.name} back right={
        <button onClick={toggleFav} aria-label={favLabel} aria-pressed={data.isFavorite} disabled={fav.isPending}
          className="flex h-10 w-10 items-center justify-center rounded-full hover:bg-neutral-100">
          <Heart className={cn("h-5 w-5", data.isFavorite ? "fill-red-500 text-red-500" : "text-neutral-700")} />
        </button>
      } />

      {/* Capa e cabeçalho */}
      <div className="relative">
        <StoreImage name={store.name} url={store.coverUrl} rounded="rounded-none" className="h-44 w-full text-4xl" />
        <div className="absolute -bottom-8 left-4">
          <StoreImage name={store.name} url={store.logoUrl} className="h-16 w-16 border-4 border-white text-lg shadow-md" rounded="rounded-2xl" />
        </div>
      </div>

      <div className="px-4 pt-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-extrabold tracking-tight text-neutral-900">{store.name}</h1>
            <p className="text-sm text-neutral-500">
              {STORE_TYPE[store.storeType] ? `${STORE_TYPE[store.storeType].icon} ` : ""}
              {store.cuisines.join(" · ") || (STORE_TYPE[store.storeType] ? t(STORE_TYPE[store.storeType]) : "")}
              {store.isHomeBusiness && <span className="ml-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900">🏠 {t({ pt: "Feito em casa", en: "Home-made", fr: "Fait maison" })}</span>}
              {store.isChain && <span className="ml-1.5 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-700">{t({ pt: "Rede", en: "Chain", fr: "Chaîne" })}</span>}
            </p>
          </div>
          <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", store.isOpenNow ? "bg-green-100 text-green-800" : "bg-neutral-200 text-neutral-700")}>
            {store.isOpenNow ? t(T.open) : t(T.closed)}
          </span>
        </div>

        {store.description && <p className="mt-2 text-sm text-neutral-600">{store.description}</p>}

        <div className="mt-3 grid grid-cols-3 divide-x rounded-2xl border bg-neutral-50/60 py-2.5 text-center text-sm">
          <button type="button" onClick={() => setTab("reviews")} className="flex flex-col items-center">
            <span className="flex items-center gap-1 font-semibold"><Star className="h-4 w-4 fill-amber-400 text-amber-400" aria-hidden />{store.ratingCount ? store.ratingAvg.toFixed(1) : "—"}</span>
            <span className="text-xs text-neutral-500">{store.ratingCount} {t({ pt: "avaliações", en: "reviews", fr: "avis" })}</span>
          </button>
          <div className="flex flex-col items-center">
            <span className="flex items-center gap-1 font-semibold"><Clock className="h-4 w-4" aria-hidden />{store.deliveryTimeMin} {t(T.minutes)}</span>
            <span className="text-xs text-neutral-500">{t({ pt: "entrega", en: "delivery", fr: "livraison" })}</span>
          </div>
          <div className="flex flex-col items-center">
            <span className={cn("flex items-center gap-1 font-semibold", store.deliveryFee === 0 && "text-green-700")}><Bike className="h-4 w-4" aria-hidden />{store.deliveryFee === 0 ? t(T.free) : kz(store.deliveryFee)}</span>
            <span className="text-xs text-neutral-500">{t(T.deliveryFee).toLowerCase()}</span>
          </div>
        </div>

        <div className="mt-3 space-y-1 text-xs text-neutral-600">
          {store.minOrder > 0 && <p className="flex items-center gap-1.5"><ShoppingBag className="h-3.5 w-3.5" aria-hidden />{t({ pt: "Pedido mínimo", en: "Minimum order", fr: "Commande minimum" })}: <b>{kz(store.minOrder)}</b></p>}
          {store.openingTime && store.closingTime && (
            <p className="flex items-center gap-1.5"><Clock className="h-3.5 w-3.5" aria-hidden />{t({ pt: "Horário", en: "Opening hours", fr: "Horaires" })}: <b>{store.openingTime.slice(0, 5) === store.closingTime.slice(0, 5) ? t({ pt: "24 horas", en: "24 hours", fr: "24 h/24" }) : `${store.openingTime.slice(0, 5)} – ${store.closingTime.slice(0, 5)}`}</b></p>
          )}
          {(store.street || store.zone) && <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" aria-hidden />{[store.street, store.zone].filter(Boolean).join(", ")}</p>}
          {store.phone && <p className="flex items-center gap-1.5"><Phone className="h-3.5 w-3.5" aria-hidden /><a href={`tel:${store.phone.replace(/\s/g, "")}`} className="underline">{store.phone}</a></p>}
        </div>

        {!!store.minNoticeMin && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900" role="status">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {(() => {
              const m = store.minNoticeMin!;
              const n = m % 1440 === 0 ? `${m / 1440} ${t({ pt: "dia(s)", en: "day(s)", fr: "jour(s)" })}` : m % 60 === 0 ? `${m / 60} h` : `${m} min`;
              return t({
                pt: `Trabalha por encomenda: agende a entrega com pelo menos ${n} de antecedência.`,
                en: `Pre-order only: schedule delivery at least ${n} ahead.`,
                fr: `Sur commande uniquement : programmez la livraison au moins ${n} à l'avance.`,
              });
            })()}
          </div>
        )}
        {!store.isOpenNow && !store.minNoticeMin && (
          <div className="mt-3 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {t({ pt: "Fechado agora — pode agendar a entrega no checkout.", en: "Closed now — you can schedule delivery at checkout.", fr: "Fermé pour le moment — vous pouvez programmer la livraison au paiement." })}
          </div>
        )}

        <Button variant="outline" className="mt-3 h-11 w-full rounded-full" onClick={startGroup} disabled={group.isPending}>
          <Users className="mr-2 h-4 w-4" />
          {group.isPending ? t(T.loading) : t({ pt: "Encomenda em grupo", en: "Group order", fr: "Commande groupée" })}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={setTab} className="mt-4">
        <div className="px-4">
          <TabsList className="grid w-full grid-cols-2 rounded-full">
            <TabsTrigger value="menu" className="rounded-full">{t({ pt: "Menu", en: "Menu", fr: "Menu" })}</TabsTrigger>
            <TabsTrigger value="reviews" className="rounded-full">{t({ pt: "Avaliações", en: "Reviews", fr: "Avis" })}{store.ratingCount ? ` (${store.ratingCount})` : ""}</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="menu" className="mt-0">
          {/* Navegação de secções fixa */}
          <div className="sticky top-[57px] z-10 border-b bg-white/95 backdrop-blur">
            <div className="space-y-2 px-4 pb-2 pt-3">
              <div className="relative">
                <label htmlFor="menu-search" className="sr-only">{t({ pt: "Pesquisar no menu", en: "Search menu", fr: "Rechercher dans le menu" })}</label>
                <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" aria-hidden />
                <Input id="menu-search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10 rounded-full bg-neutral-50 pl-9"
                  placeholder={t({ pt: `Pesquisar em ${store.name}`, en: `Search ${store.name}`, fr: `Rechercher chez ${store.name}` })} />
              </div>
              <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 scrollbar-hide">
                {Object.keys(DIETARY).map((tag) => {
                  const on = diet.includes(tag);
                  return (
                    <button key={tag} type="button" aria-pressed={on}
                      onClick={() => setDiet(on ? diet.filter((d) => d !== tag) : [...diet, tag])}
                      className={cn("shrink-0 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium", on ? "border-green-600 bg-green-600 text-white" : "border-neutral-200 text-neutral-700")}>
                      <span aria-hidden>{DIETARY[tag].icon}</span> {t(DIETARY[tag])}
                    </button>
                  );
                })}
              </div>
            </div>
            {groups.length > 1 && (
              <nav ref={navRef} aria-label={t({ pt: "Secções do menu", en: "Menu sections", fr: "Sections du menu" })}
                className="flex gap-1 overflow-x-auto px-3 scrollbar-hide">
                {groups.map((g) => (
                  <button key={g.key} data-sec={g.key} type="button" onClick={() => scrollTo(g.key)}
                    className={cn("shrink-0 whitespace-nowrap border-b-2 px-2.5 py-2 text-sm",
                      activeSection === g.key ? "border-primary font-semibold text-primary" : "border-transparent text-neutral-600")}>
                    {g.name}
                  </button>
                ))}
              </nav>
            )}
          </div>

          {groups.length === 0 ? (
            <EmptyState icon="🍽️"
              title={data.items.length ? t({ pt: "Nenhum produto encontrado", en: "No items found", fr: "Aucun produit trouvé" }) : t({ pt: "Menu ainda vazio", en: "Menu is empty", fr: "Menu vide" })}
              text={data.items.length ? t({ pt: "Experimente outra pesquisa ou retire filtros.", en: "Try another search or remove filters.", fr: "Essayez une autre recherche ou retirez des filtres." }) : undefined}
              action={(search || diet.length) ? <Button variant="outline" onClick={() => { setSearch(""); setDiet([]); }}>{t({ pt: "Limpar filtros", en: "Clear filters", fr: "Effacer les filtres" })}</Button> : undefined} />
          ) : (
            <div className={cn("px-4 pb-6", cartHere && "pb-24")}>
              {groups.map((g) => (
                <section key={g.key} id={`sec-${g.key}`} className="pt-5">
                  <h2 className="mb-2 text-lg font-bold text-neutral-900">{g.name}</h2>
                  <ul className="divide-y">
                    {g.items.map((it) => (
                      <li key={`${g.key}-${it.id}`}>
                        <button type="button" onClick={() => openItem(it)} disabled={!it.isAvailable}
                          className={cn("flex w-full gap-3 py-3.5 text-left", it.isAvailable ? "hover:bg-neutral-50/70" : "cursor-not-allowed opacity-55")}>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <h3 className="font-semibold text-neutral-900">{it.name}</h3>
                              {it.isPopular && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-[10px] font-semibold text-brand-800">🔥 {t({ pt: "Popular", en: "Popular", fr: "Populaire" })}</span>}
                              {!it.isAvailable && <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold text-neutral-700">{t({ pt: "Esgotado", en: "Sold out", fr: "Épuisé" })}</span>}
                            </div>
                            {it.description && <p className="mt-0.5 line-clamp-2 text-sm text-neutral-500">{it.description}</p>}
                            <p className="mt-1 font-semibold text-neutral-900">{kz(it.price)}</p>
                            <div className="mt-1"><DietaryBadges tags={it.dietaryTags} small /></div>
                          </div>
                          {it.imageUrl && <img src={it.imageUrl} alt="" loading="lazy" className="h-24 w-24 shrink-0 rounded-xl object-cover" />}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="reviews" className="px-4 pb-8">
          {reviews.isLoading ? (
            <div className="space-y-3 pt-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)}</div>
          ) : reviews.error ? (
            <ErrorState error={reviews.error} onRetry={() => reviews.refetch()} />
          ) : !reviews.data?.reviews.length ? (
            <EmptyState icon="⭐" title={t({ pt: "Ainda sem avaliações", en: "No reviews yet", fr: "Pas encore d'avis" })}
              text={t({ pt: "Seja o primeiro a avaliar depois da sua encomenda.", en: "Be the first to review after your order.", fr: "Soyez le premier à donner votre avis après votre commande." })} />
          ) : (
            <>
              <div className="flex items-center gap-3 rounded-2xl bg-neutral-50 p-4">
                <span className="text-4xl font-extrabold">{store.ratingAvg.toFixed(1)}</span>
                <div>
                  <Stars value={store.ratingAvg} size="h-5 w-5" />
                  <p className="text-xs text-neutral-500">{store.ratingCount} {t({ pt: "avaliações", en: "reviews", fr: "avis" })}</p>
                </div>
              </div>
              <ul className="mt-2 divide-y">
                {reviews.data.reviews.map((r) => (
                  <li key={r.id} className="py-4">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-800" aria-hidden>{r.author.charAt(0).toUpperCase()}</span>
                        <span className="font-medium">{r.author}</span>
                      </div>
                      <time className="text-xs text-neutral-500" dateTime={r.createdAt}>{dateTime(r.createdAt, lang)}</time>
                    </div>
                    <div className="mt-1.5"><Stars value={r.rating} /></div>
                    {r.comment && <p className="mt-1.5 text-sm text-neutral-700">{r.comment}</p>}
                    {r.reply && (
                      <div className="mt-2 rounded-xl border-l-4 border-primary bg-brand-50/60 px-3 py-2 text-sm">
                        <p className="text-xs font-semibold text-neutral-800">{t({ pt: "Resposta da loja", en: "Store reply", fr: "Réponse du magasin" })}</p>
                        <p className="text-neutral-700">{r.reply}</p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Barra do carrinho */}
      {cartHere && (
        <div className="fixed bottom-16 left-0 right-0 z-30">
          <div className="mx-auto max-w-md px-4 pb-3">
            <Button className="h-12 w-full justify-between rounded-full px-5 text-base shadow-lg" onClick={() => navigate("/carrinho")}>
              <span className="flex items-center gap-2">
                <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/25 px-1.5 text-sm">{cart.itemCount}</span>
                {t({ pt: "Ver carrinho", en: "View cart", fr: "Voir le panier" })}
                <span className="text-sm font-normal text-white/85">
                  · {t({ pt: `${cart.itemCount} ${cart.itemCount === 1 ? "item" : "itens"}`, en: `${cart.itemCount} item${cart.itemCount === 1 ? "" : "s"}`, fr: `${cart.itemCount} article${cart.itemCount === 1 ? "" : "s"}` })}
                </span>
              </span>
              <span className="font-semibold">{kz(cart.estimatedSubtotal)}</span>
            </Button>
          </div>
        </div>
      )}

      <ItemDialog item={selected} open={dialogOpen} onOpenChange={setDialogOpen} onConfirm={onConfirm} />

      <AlertDialog open={!!pending} onOpenChange={(o) => !o && setPending(null)}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Começar novo carrinho?", en: "Start a new cart?", fr: "Commencer un nouveau panier ?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t({
                pt: `O seu carrinho tem produtos de ${cart.storeName}. Se continuar, esses produtos serão removidos.`,
                en: `Your cart has items from ${cart.storeName}. If you continue, they will be removed.`,
                fr: `Votre panier contient des articles de ${cart.storeName}. Si vous continuez, ils seront supprimés.`,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { if (pending) { cart.clear(); doAdd(pending); } setPending(null); }}>
              {t({ pt: "Novo carrinho", en: "New cart", fr: "Nouveau panier" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomerShell>
  );
}
