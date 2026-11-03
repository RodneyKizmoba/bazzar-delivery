import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, ChevronRight, Loader2, Receipt, RotateCcw, Star } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, Loading, PageTitle, StatusBadge, StoreImage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useCart, type CartLine } from "@/context/CartContext";
import { get } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { FINAL_STATUSES, type SelectedOption, type StoreDetail } from "./_orderingKit";

export interface OrderListItem {
  id: number; orderNumber: string; storeId: number; storeName: string; storeLogo: string | null;
  status: string; total: number; createdAt: string; scheduledFor: string | null; hasReview: boolean;
  estimatedDeliveryAt: string | null;
}

interface OrderItemRow { menuItemId: number; name: string; quantity: number; unitPrice: number; selectedOptions: SelectedOption[]; specialInstructions: string | null }

/** Reconstrói as linhas do carrinho a partir de uma encomenda anterior, com o menu actual da loja. */
export async function rebuildCartFromOrder(orderId: number, storeId: number) {
  const [{ items }, store] = await Promise.all([
    get<{ items: OrderItemRow[] }>(`/api/orders/${orderId}`),
    get<StoreDetail>(`/api/stores/${storeId}`),
  ]);
  const lines: Omit<CartLine, "key">[] = [];
  const skipped: string[] = [];
  for (const it of items) {
    const mi = store.items.find((m) => m.id === it.menuItemId);
    if (!mi || !mi.isAvailable) { skipped.push(it.name); continue; }
    const allOpts = mi.optionGroups.flatMap((g) => g.options);
    const opts = it.selectedOptions.map((s) => allOpts.find((o) => o.id === s.optionId));
    if (opts.some((o) => !o || !o.isAvailable)) { skipped.push(it.name); continue; }
    const chosen = opts.filter((o): o is NonNullable<typeof o> => !!o);
    lines.push({
      menuItemId: mi.id, name: mi.name, quantity: it.quantity,
      optionIds: chosen.map((o) => o.id),
      optionsLabel: chosen.map((o) => o.name).join(" · "),
      specialInstructions: it.specialInstructions ?? "",
      unitPrice: Math.max(0, mi.price + chosen.reduce((s, o) => s + o.priceDelta, 0)),
    });
  }
  return { lines, skipped, storeName: store.store.name };
}

function OrderCard({ o, onRepeat, repeating }: { o: OrderListItem; onRepeat: (o: OrderListItem) => void; repeating: boolean }) {
  const t = useT();
  const { lang } = useLang();
  const active = !FINAL_STATUSES.includes(o.status);
  return (
    <article className="rounded-2xl border bg-white p-4 shadow-sm">
      <Link href={`/encomendas/${o.id}`} className="flex items-start gap-3">
        <StoreImage name={o.storeName} url={o.storeLogo} className="h-12 w-12 shrink-0 text-sm" rounded="rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-semibold">{o.storeName}</p>
            <p className="whitespace-nowrap font-semibold">{kz(o.total)}</p>
          </div>
          <p className="text-xs text-neutral-500">#{o.orderNumber} · {dateTime(o.createdAt, lang)}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge status={o.status} />
            {o.scheduledFor && (
              <span className="inline-flex items-center gap-1 text-xs text-indigo-700">
                <CalendarClock className="h-3.5 w-3.5" /> {dateTime(o.scheduledFor, lang)}
              </span>
            )}
          </div>
        </div>
      </Link>
      <div className="mt-3 flex flex-wrap gap-2">
        {active ? (
          <Link href={`/encomendas/${o.id}`} className="flex-1">
            <Button className="w-full">{t({ pt: "Acompanhar", en: "Track", fr: "Suivre" })}<ChevronRight className="ml-1 h-4 w-4" /></Button>
          </Link>
        ) : (
          <>
            {o.status === "delivered" && !o.hasReview && (
              <Link href={`/encomendas/${o.id}#avaliar`} className="flex-1">
                <Button variant="outline" className="w-full"><Star className="mr-1.5 h-4 w-4" />{t({ pt: "Avaliar", en: "Rate", fr: "Noter" })}</Button>
              </Link>
            )}
            {o.status === "delivered" && (
              <Button variant="outline" className="flex-1" disabled={repeating} onClick={() => onRepeat(o)}>
                {repeating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                {t({ pt: "Repetir encomenda", en: "Reorder", fr: "Recommander" })}
              </Button>
            )}
            {o.status !== "delivered" && (
              <Link href={`/encomendas/${o.id}`} className="flex-1">
                <Button variant="ghost" className="w-full">{t({ pt: "Ver detalhes", en: "View details", fr: "Voir détails" })}</Button>
              </Link>
            )}
          </>
        )}
      </div>
    </article>
  );
}

function OrdersInner() {
  const t = useT();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const cart = useCart();
  const q = useQuery<{ orders: OrderListItem[] }>({ queryKey: ["/api/orders"], refetchInterval: 15_000 });
  const [repeatingId, setRepeatingId] = useState<number | null>(null);
  const [confirmReplace, setConfirmReplace] = useState<OrderListItem | null>(null);

  const doRepeat = async (o: OrderListItem) => {
    setRepeatingId(o.id);
    try {
      const { lines, skipped, storeName } = await rebuildCartFromOrder(o.id, o.storeId);
      if (!lines.length) {
        toast({ variant: "destructive", title: t({ pt: "Não foi possível repetir", en: "Couldn't reorder", fr: "Impossible de recommander" }), description: t({ pt: "Os produtos desta encomenda já não estão disponíveis.", en: "The items from this order are no longer available.", fr: "Les articles ne sont plus disponibles." }) });
        return;
      }
      cart.replaceLines(o.storeId, storeName, lines);
      if (skipped.length) {
        toast({ title: t({ pt: "Alguns itens não estão disponíveis", en: "Some items are unavailable", fr: "Certains articles sont indisponibles" }), description: skipped.join(", ") });
      }
      navigate("/carrinho");
    } catch (e) {
      toast({ variant: "destructive", title: t({ pt: "Erro", en: "Error", fr: "Erreur" }), description: (e as Error).message });
    } finally {
      setRepeatingId(null);
    }
  };

  const repeat = (o: OrderListItem) => {
    if (cart.lines.length && cart.storeId !== null) setConfirmReplace(o);
    else doRepeat(o);
  };

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const all = q.data?.orders ?? [];
  const current = all.filter((o) => !FINAL_STATUSES.includes(o.status));
  const past = all.filter((o) => FINAL_STATUSES.includes(o.status));

  const list = (items: OrderListItem[], empty: React.ReactNode) =>
    items.length ? (
      <div className="space-y-3">{items.map((o) => <OrderCard key={o.id} o={o} onRepeat={repeat} repeating={repeatingId === o.id} />)}</div>
    ) : empty;

  return (
    <>
      <Tabs defaultValue={current.length ? "current" : "past"} className="px-4">
        <TabsList className="grid w-full grid-cols-2 rounded-full">
          <TabsTrigger value="current" className="rounded-full">
            {t({ pt: "Em curso", en: "Active", fr: "En cours" })}{current.length > 0 && <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[10px] text-white">{current.length}</span>}
          </TabsTrigger>
          <TabsTrigger value="past" className="rounded-full">{t({ pt: "Anteriores", en: "Past", fr: "Précédentes" })}</TabsTrigger>
        </TabsList>
        <TabsContent value="current" className="mt-4">
          {list(current, <EmptyState icon="🛵" title={t({ pt: "Nenhuma encomenda em curso", en: "No active orders", fr: "Aucune commande en cours" })}
            text={t({ pt: "Quando fizer uma encomenda, pode acompanhá-la aqui.", en: "When you place an order, you can track it here.", fr: "Suivez vos commandes ici." })}
            action={<Link href="/"><Button>{t({ pt: "Explorar lojas", en: "Explore stores", fr: "Explorer" })}</Button></Link>} />)}
        </TabsContent>
        <TabsContent value="past" className="mt-4">
          {list(past, <EmptyState icon={<Receipt className="h-10 w-10 text-neutral-300" />} title={t({ pt: "Ainda sem encomendas anteriores", en: "No past orders yet", fr: "Pas encore de commandes" })} />)}
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmReplace} onOpenChange={(o) => !o && setConfirmReplace(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Substituir o carrinho?", en: "Replace your basket?", fr: "Remplacer le panier ?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t({ pt: `O seu carrinho actual (${cart.storeName}) vai ser substituído pelos itens desta encomenda.`, en: `Your current basket (${cart.storeName}) will be replaced with this order's items.`, fr: `Votre panier actuel (${cart.storeName}) sera remplacé.` })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Manter", en: "Keep", fr: "Garder" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { const o = confirmReplace!; setConfirmReplace(null); doRepeat(o); }}>
              {t({ pt: "Substituir", en: "Replace", fr: "Remplacer" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function Orders() {
  return (
    <CustomerShell>
      <PageTitle title={{ pt: "As minhas encomendas", en: "My orders", fr: "Mes commandes" }} />
      <div className="pb-6">
        <Guard roles={["customer"]}><OrdersInner /></Guard>
      </div>
    </CustomerShell>
  );
}
