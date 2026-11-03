import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, Bike, Users, StickyNote, AlertTriangle, Banknote } from "lucide-react";
import { Guard, Loading, ErrorState, EmptyState, StatusBadge } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime, time, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Separadores da área do parceiro (reutilizados nas outras páginas do parceiro). */
export function usePartnerTabs() {
  const t = useT();
  return [
    { href: "/parceiro", label: t({ pt: "Encomendas", en: "Orders", fr: "Commandes" }) },
    { href: "/parceiro/menu", label: t({ pt: "Menu", en: "Menu", fr: "Menu" }) },
    { href: "/parceiro/loja", label: t({ pt: "Loja", en: "Store", fr: "Magasin" }) },
    { href: "/parceiro/avaliacoes", label: t({ pt: "Avaliações", en: "Reviews", fr: "Avis" }) },
    { href: "/parceiro/estatisticas", label: t({ pt: "Estatísticas", en: "Statistics", fr: "Statistiques" }) },
  ];
}

export function usePartnerTitle() {
  const t = useT();
  return t({ pt: "Portal da loja", en: "Store portal", fr: "Portail du magasin" });
}

interface SelectedOption { groupId: number; groupName: string; optionId: number; name: string; priceDelta: number }
interface PartnerOrderItem {
  id: number; name: string; unitPrice: number; quantity: number;
  selectedOptions: SelectedOption[]; specialInstructions: string | null; addedBy: string | null;
}
export interface PartnerOrder {
  id: number; orderNumber: string; status: string; createdAt: string; scheduledFor: string | null;
  customerName: string; notes: string | null; subtotal: number; total: number; deliveryFee: number;
  paymentMethod: string; paymentStatus: string; driverId: number | null; groupOrderId: number | null;
  cancelReason: string | null; items: PartnerOrderItem[];
}

const ORDERS_ACTIVE = "/api/partner/orders?scope=active";
const ORDERS_HISTORY = "/api/partner/orders?scope=history";

function minutesSince(d: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(d).getTime()) / 60_000));
}

/** Bip curto com WebAudio, só depois de interacção do utilizador (política dos browsers). */
function useBeep() {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    const unlock = () => {
      if (ctxRef.current) return;
      try {
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        if (AC) ctxRef.current = new AC();
      } catch { /* sem áudio */ }
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);
  return () => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") void ctx.resume();
      const play = (start: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = "sine";
        osc.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + 0.25);
        osc.connect(gain).connect(ctx.destination);
        osc.start(ctx.currentTime + start);
        osc.stop(ctx.currentTime + start + 0.3);
      };
      play(0);
      play(0.35);
    } catch { /* ignore */ }
  };
}

export default function PartnerOrders() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <OrdersContent />
      </PanelShell>
    </Guard>
  );
}

function StoreHeader() {
  const t = useT();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<{ store: any }>({ queryKey: ["/api/partner/store"] });
  const toggle = useMutation({
    mutationFn: (isOpen: boolean) => patch("/api/partner/store", { isOpen }),
    onSuccess: (_d, isOpen) => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/store"] });
      toast({ title: isOpen ? t({ pt: "Loja aberta", en: "Store open", fr: "Magasin ouvert" }) : t({ pt: "Loja fechada", en: "Store closed", fr: "Magasin fermé" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const store = data!.store;
  return (
    <div className="mb-4 space-y-3">
      {!store.isApproved && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">{t({ pt: "A sua loja aguarda aprovação", en: "Your store is awaiting approval", fr: "Votre magasin attend l'approbation" })}</p>
            <p>{t({ pt: "Pode preparar o menu entretanto. A loja só aparece aos clientes depois de aprovada.", en: "You can set up your menu meanwhile. Customers will see the store once approved.", fr: "Vous pouvez préparer le menu. Le magasin sera visible après approbation." })}</p>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-3">
        <div>
          <h1 className="text-lg font-bold">{store.name}</h1>
          <p className="text-sm text-neutral-500">{store.openingTime}–{store.closingTime} · {store.zone}</p>
        </div>
        <div className="flex items-center gap-2">
          <Label htmlFor="store-open" className={cn("font-semibold", store.isOpen ? "text-green-700" : "text-neutral-500")}>
            {store.isOpen ? t({ pt: "Aberta a receber encomendas", en: "Open for orders", fr: "Ouvert aux commandes" }) : t({ pt: "Fechada", en: "Closed", fr: "Fermé" })}
          </Label>
          <Switch id="store-open" checked={store.isOpen} disabled={toggle.isPending} onCheckedChange={(v) => toggle.mutate(v)} />
        </div>
      </div>
    </div>
  );
}

function OrdersContent() {
  const t = useT();
  const [tab, setTab] = useState("active");
  return (
    <>
      <StoreHeader />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="active">{t({ pt: "Em curso", en: "Active", fr: "En cours" })}</TabsTrigger>
          <TabsTrigger value="history">{t({ pt: "Histórico", en: "History", fr: "Historique" })}</TabsTrigger>
        </TabsList>
        <TabsContent value="active"><ActiveBoard /></TabsContent>
        <TabsContent value="history">{tab === "history" && <History />}</TabsContent>
      </Tabs>
    </>
  );
}

function ActiveBoard() {
  const t = useT();
  const { toast } = useToast();
  const beep = useBeep();
  const { data, isLoading, error, refetch } = useQuery<{ orders: PartnerOrder[] }>({
    queryKey: [ORDERS_ACTIVE], refetchInterval: 5000,
  });
  const seen = useRef<Set<number> | null>(null);
  const [, forceTick] = useState(0);

  // actualizar "há X min" a cada 30 s
  useEffect(() => {
    const id = setInterval(() => forceTick((n) => n + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!data) return;
    const pendingIds = data.orders.filter((o) => o.status === "pending").map((o) => o.id);
    if (seen.current === null) {
      seen.current = new Set(pendingIds);
      return;
    }
    const fresh = data.orders.filter((o) => o.status === "pending" && !seen.current!.has(o.id));
    pendingIds.forEach((id) => seen.current!.add(id));
    if (fresh.length) {
      beep();
      toast({
        title: t({ pt: "Nova encomenda!", en: "New order!", fr: "Nouvelle commande !" }),
        description: fresh.map((o) => `${o.orderNumber} · ${kz(o.total)}`).join(", "),
      });
    }
  }, [data]);

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const orders = data!.orders;
  if (!orders.length) {
    return <EmptyState icon="🧾" title={t({ pt: "Sem encomendas em curso", en: "No active orders", fr: "Aucune commande en cours" })}
      text={t({ pt: "As novas encomendas aparecem aqui automaticamente, com aviso sonoro.", en: "New orders appear here automatically, with a sound alert.", fr: "Les nouvelles commandes apparaissent ici automatiquement, avec une alerte sonore." })} />;
  }
  const cols = [
    { key: "new", title: t({ pt: "Novas", en: "New", fr: "Nouvelles" }), list: orders.filter((o) => o.status === "pending"), accent: "border-t-amber-500" },
    { key: "scheduled", title: t({ pt: "Agendadas", en: "Scheduled", fr: "Programmées" }), list: orders.filter((o) => o.status === "scheduled"), accent: "border-t-indigo-500" },
    { key: "prep", title: t({ pt: "Em preparação", en: "In preparation", fr: "En préparation" }), list: orders.filter((o) => o.status === "accepted" || o.status === "preparing"), accent: "border-t-sky-500" },
    { key: "ready", title: t({ pt: "Prontas / a aguardar estafeta", en: "Ready / awaiting rider", fr: "Prêtes / en attente du livreur" }), list: orders.filter((o) => o.status === "ready" || o.status === "picked_up"), accent: "border-t-violet-500" },
  ];
  return (
    <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {cols.map((c) => (
        <section key={c.key} aria-label={c.title} className={cn("rounded-lg border border-t-4 bg-neutral-100/60 p-2", c.accent)}>
          <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
            {c.title} <span className="rounded-full bg-white px-2 text-xs">{c.list.length}</span>
          </h2>
          <div className="space-y-2">
            {c.list.length === 0 && <p className="px-1 py-4 text-center text-xs text-neutral-500">—</p>}
            {c.list.map((o) => <OrderCard key={o.id} order={o} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function OrderCard({ order }: { order: PartnerOrder }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const mins = minutesSince(order.createdAt);

  const setStatus = useMutation({
    mutationFn: (v: { status: string; note?: string }) => post(`/api/partner/orders/${order.id}/status`, v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [ORDERS_ACTIVE] });
      queryClient.invalidateQueries({ queryKey: [ORDERS_HISTORY] });
      setRejectOpen(false);
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });

  const isCash = order.paymentMethod === "cash";
  return (
    <article className={cn("rounded-lg border bg-white p-3 shadow-sm", order.status === "pending" && "ring-2 ring-amber-400")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-bold">{order.orderNumber}</p>
          <p className="text-xs text-neutral-500">{order.customerName}</p>
        </div>
        <div className="text-right">
          <StatusBadge status={order.status} />
          <p className={cn("mt-1 flex items-center justify-end gap-1 text-xs", mins >= 15 && order.status === "pending" ? "font-semibold text-red-600" : "text-neutral-500")}>
            <Clock className="h-3 w-3" />
            {t({ pt: `há ${mins} min`, en: `${mins} min ago`, fr: `il y a ${mins} min` })}
          </p>
        </div>
      </div>

      {order.status === "scheduled" && order.scheduledFor && (
        <p className="mt-2 rounded bg-indigo-50 px-2 py-1 text-xs font-medium text-indigo-800">
          {t({ pt: "Para", en: "For", fr: "Pour" })} {dateTime(order.scheduledFor, lang)}
        </p>
      )}
      {order.groupOrderId && (
        <p className="mt-2 flex items-center gap-1 text-xs text-neutral-600"><Users className="h-3 w-3" />{t({ pt: "Encomenda de grupo", en: "Group order", fr: "Commande de groupe" })}</p>
      )}

      <ul className="mt-2 space-y-1.5 border-t pt-2 text-sm">
        {order.items.map((it) => (
          <li key={it.id}>
            <div className="flex gap-2">
              <span className="font-bold">{it.quantity}×</span>
              <span className="flex-1">{it.name}</span>
            </div>
            {it.selectedOptions?.length > 0 && (
              <p className="ml-6 text-xs text-neutral-600">{it.selectedOptions.map((o) => `${o.groupName}: ${o.name}`).join(" · ")}</p>
            )}
            {it.specialInstructions && (
              <p className="ml-6 mt-0.5 rounded bg-yellow-100 px-1.5 py-0.5 text-xs font-semibold text-yellow-900">⚠ {it.specialInstructions}</p>
            )}
            {it.addedBy && <p className="ml-6 text-[11px] text-neutral-500">{t({ pt: "Pedido por", en: "Added by", fr: "Ajouté par" })} {it.addedBy}</p>}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-2 flex gap-1 rounded bg-yellow-50 px-2 py-1 text-xs text-yellow-900"><StickyNote className="mt-0.5 h-3 w-3 shrink-0" />{order.notes}</p>
      )}

      <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
        <span className="font-semibold">{kz(order.total)}</span>
        <span className={cn("flex items-center gap-1 text-xs", isCash ? "font-semibold text-teal-700" : "text-neutral-600")}>
          {isCash && <Banknote className="h-3 w-3" />}
          {isCash ? t({ pt: "Cobrar na entrega", en: "Collect on delivery", fr: "À encaisser à la livraison" }) : (PAYMENT[order.paymentMethod] ? t(PAYMENT[order.paymentMethod]) : order.paymentMethod)}
        </span>
      </div>
      {["accepted", "preparing", "ready", "picked_up"].includes(order.status) && (
        <p className="mt-1 flex items-center gap-1 text-xs text-neutral-600">
          <Bike className="h-3 w-3" />
          {order.driverId
            ? order.status === "picked_up" ? t({ pt: "Recolhida pelo estafeta", en: "Picked up by rider", fr: "Récupérée par le livreur" }) : t({ pt: "Estafeta atribuído", en: "Rider assigned", fr: "Livreur assigné" })
            : t({ pt: "À espera de estafeta", en: "Waiting for a rider", fr: "En attente d'un livreur" })}
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {order.status === "pending" && (
          <>
            <Button className="flex-1" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "accepted" })}>
              {t({ pt: "Aceitar", en: "Accept", fr: "Accepter" })}
            </Button>
            <Button variant="outline" className="flex-1 text-red-700" disabled={setStatus.isPending} onClick={() => setRejectOpen(true)}>
              {t({ pt: "Recusar", en: "Reject", fr: "Refuser" })}
            </Button>
          </>
        )}
        {order.status === "accepted" && (
          <Button className="flex-1" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "preparing" })}>
            {t({ pt: "Começar a preparar", en: "Start preparing", fr: "Commencer la préparation" })}
          </Button>
        )}
        {order.status === "preparing" && (
          <Button className="flex-1 bg-green-700 hover:bg-green-800" disabled={setStatus.isPending} onClick={() => setStatus.mutate({ status: "ready" })}>
            {t({ pt: "Pronta", en: "Ready", fr: "Prête" })}
          </Button>
        )}
      </div>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t({ pt: "Recusar encomenda", en: "Reject order", fr: "Refuser la commande" })} {order.orderNumber}</DialogTitle>
            <DialogDescription>{t({ pt: "O cliente será notificado e reembolsado, se já tiver pago.", en: "The customer will be notified and refunded if already paid.", fr: "Le client sera notifié et remboursé s'il a déjà payé." })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor={`reason-${order.id}`}>{t({ pt: "Motivo", en: "Reason", fr: "Motif" })}</Label>
            <Textarea id={`reason-${order.id}`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)}
              placeholder={t({ pt: "Ex.: produto esgotado, cozinha cheia…", en: "E.g. out of stock, kitchen full…", fr: "Ex. : rupture de stock, cuisine pleine…" })} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)}>{t(T.cancel)}</Button>
            <Button variant="destructive" disabled={!reason.trim() || setStatus.isPending}
              onClick={() => setStatus.mutate({ status: "rejected", note: reason.trim() })}>
              {t({ pt: "Recusar", en: "Reject", fr: "Refuser" })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </article>
  );
}

function History() {
  const t = useT();
  const { lang } = useLang();
  const { data, isLoading, error, refetch } = useQuery<{ orders: PartnerOrder[] }>({ queryKey: [ORDERS_HISTORY] });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const orders = data!.orders;
  if (!orders.length) return <EmptyState icon="📭" title={t({ pt: "Ainda sem histórico", en: "No history yet", fr: "Pas encore d'historique" })} />;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border bg-white">
      <table className="w-full min-w-[560px] text-sm">
        <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
          <tr>
            <th className="p-2">{t({ pt: "Encomenda", en: "Order", fr: "Commande" })}</th>
            <th className="p-2">{t({ pt: "Data", en: "Date", fr: "Date" })}</th>
            <th className="p-2">{t({ pt: "Cliente", en: "Customer", fr: "Client" })}</th>
            <th className="p-2">{t({ pt: "Artigos", en: "Items", fr: "Articles" })}</th>
            <th className="p-2">{t({ pt: "Estado", en: "Status", fr: "Statut" })}</th>
            <th className="p-2 text-right">{t(T.total)}</th>
          </tr>
        </thead>
        <tbody>
          {orders.map((o) => (
            <tr key={o.id} className="border-t align-top">
              <td className="p-2 font-mono text-xs">{o.orderNumber}</td>
              <td className="p-2 whitespace-nowrap">{dateTime(o.createdAt, lang)}</td>
              <td className="p-2">{o.customerName}</td>
              <td className="p-2 text-xs text-neutral-600">{o.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}</td>
              <td className="p-2">
                <StatusBadge status={o.status} />
                {o.cancelReason && <p className="mt-1 text-xs text-neutral-500">{o.cancelReason}</p>}
              </td>
              <td className="p-2 text-right whitespace-nowrap">{kz(o.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="p-2 text-xs text-neutral-400">{t({ pt: "Últimas 200 encomendas", en: "Last 200 orders", fr: "200 dernières commandes" })} · {time(new Date(), lang)}</p>
    </div>
  );
}
