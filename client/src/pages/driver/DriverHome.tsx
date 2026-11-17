import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Phone, MapPin, Navigation, Store as StoreIcon, Banknote, StickyNote, Clock, Bell } from "lucide-react";
import { useBeep } from "@/hooks/useBeep";
import { Guard, Loading, ErrorState, EmptyState, StatusBadge } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { OrderMap } from "@/components/OrderMap";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiError, post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, time, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Separadores da área do estafeta (reutilizados em DriverHistory). */
export function useDriverTabs() {
  const t = useT();
  return [
    { href: "/estafeta", label: t({ pt: "Entregas", en: "Deliveries", fr: "Livraisons" }) },
    { href: "/estafeta/historico", label: t({ pt: "Histórico", en: "History", fr: "Historique" }) },
  ];
}
export function useDriverTitle() {
  const t = useT();
  return t({ pt: "App estafeta", en: "Rider app", fr: "Appli livreur" });
}

interface Addr { label: string; street: string; zone: string; city: string; reference?: string | null; latitude?: number | null; longitude?: number | null }
interface DStore { id: number; name: string; street: string; zone: string; phone: string; latitude: number | null; longitude: number | null }
export interface DriverOrder {
  id: number; orderNumber: string; status: string; total: number; deliveryFee: number; paymentMethod: string;
  collectCash: number; deliveryAddress: Addr; notes: string | null; priority?: boolean; riderTip?: number; cutlery?: boolean; estimatedDeliveryAt: string | null; createdAt: string;
  store: DStore;
}
interface CurrentOrder extends DriverOrder {
  customer: { name: string; phone: string };
  items: { id: number; name: string; quantity: number; selectedOptions: { groupName: string; name: string }[]; specialInstructions: string | null }[];
}

const CURRENT = "/api/driver/current";
const AVAILABLE = "/api/driver/available";

const pt = (lat?: number | null, lng?: number | null) => (lat != null && lng != null ? { latitude: lat, longitude: lng } : null);
type LL = { latitude: number; longitude: number };
/** Distância em linha recta (km); na estrada é normalmente ~1,3× mais. */
function km(a: LL, b: LL) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtKm = (d: number) => (d < 1 ? `${Math.round(d * 1000)} m` : `${d.toFixed(1).replace(".", ",")} km`);

export default function DriverHome() {
  const tabs = useDriverTabs();
  const title = useDriverTitle();
  return (
    <Guard roles={["driver"]}>
      <PanelShell title={title} tabs={tabs}>
        <div className="mx-auto max-w-xl"><DriverContent /></div>
      </PanelShell>
    </Guard>
  );
}

function DriverContent() {
  const t = useT();
  const { toast } = useToast();
  const [sharing, setSharing] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const lastSent = useRef(0);
  const currentQ = useQuery<{ order: CurrentOrder | null }>({ queryKey: [CURRENT], refetchInterval: 5000 });
  const current = currentQ.data?.order ?? null;
  const hasCurrent = !!current;
  const hasCurrentRef = useRef(hasCurrent);
  hasCurrentRef.current = hasCurrent;

  // Partilha de localização: só com o interruptor ligado e uma entrega em curso.
  useEffect(() => {
    if (!sharing) return;
    if (!("geolocation" in navigator)) {
      setGeoError(t({ pt: "Este dispositivo não suporta geolocalização.", en: "This device doesn't support geolocation.", fr: "Cet appareil ne prend pas en charge la géolocalisation." }));
      return;
    }
    setGeoError(null);
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setMyPos(p);
        setGeoError(null);
        const now = Date.now();
        if (hasCurrentRef.current && now - lastSent.current >= 10_000) {
          lastSent.current = now;
          post("/api/driver/location", p).catch(() => { /* nova tentativa na próxima posição */ });
        }
      },
      (err) => {
        setGeoError(err.code === err.PERMISSION_DENIED
          ? t({ pt: "Permissão de localização negada. Active-a nas definições do navegador.", en: "Location permission denied. Enable it in your browser settings.", fr: "Autorisation de localisation refusée. Activez-la dans les paramètres du navigateur." })
          : err.code === err.POSITION_UNAVAILABLE
            ? t({ pt: "Localização indisponível. Verifique o GPS.", en: "Location unavailable. Check your GPS.", fr: "Position indisponible. Vérifiez le GPS." })
            : t({ pt: "Não foi possível obter a localização (tempo esgotado).", en: "Couldn't get location (timeout).", fr: "Impossible d'obtenir la position (délai dépassé)." }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [sharing]);

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="share-loc" className="text-base font-medium">{t({ pt: "Partilhar localização", en: "Share location", fr: "Partager la position" })}</Label>
          <Switch id="share-loc" checked={sharing} onCheckedChange={setSharing} />
        </div>
        <p className="mt-1 text-xs text-neutral-500">
          {sharing
            ? hasCurrent
              ? t({ pt: "O cliente vê a sua posição durante a entrega.", en: "The customer sees your position during the delivery.", fr: "Le client voit votre position pendant la livraison." })
              : t({ pt: "Mostramos as entregas mais perto de si primeiro. O cliente só vê a sua posição durante uma entrega.", en: "We show the nearest deliveries first. Customers only see your position during a delivery.", fr: "Les livraisons les plus proches apparaissent en premier. Le client ne voit votre position que pendant une livraison." })
            : t({ pt: "Desligado.", en: "Off.", fr: "Désactivé." })}
        </p>
        {geoError && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{geoError}</p>}
      </div>

      {currentQ.isLoading ? <Loading /> : currentQ.error ? (
        <ErrorState error={currentQ.error} onRetry={() => currentQ.refetch()} />
      ) : current ? (
        <CurrentDelivery order={current} myPos={myPos} />
      ) : (
        <AvailableList myPos={myPos} onClaimError={(e) => toast({ variant: "destructive", title: t(T.error), description: e.message })} />
      )}
    </div>
  );
}

function CurrentDelivery({ order, myPos }: { order: CurrentOrder; myPos: { latitude: number; longitude: number } | null }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const a = order.deliveryAddress;
  const dest = pt(a.latitude, a.longitude);
  const storePt = pt(order.store.latitude, order.store.longitude);
  const navTarget = order.status === "picked_up" ? dest : storePt ?? dest;
  // Rota completa no Google Maps (escolhe o caminho mais rápido com trânsito): até à loja e depois ao cliente
  const ll = (p: { latitude: number; longitude: number }) => `${p.latitude},${p.longitude}`;
  const mapsUrl = !navTarget ? null
    : order.status !== "picked_up" && storePt && dest
      ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ll(dest)}&waypoints=${ll(storePt)}${myPos ? `&origin=${ll(myPos)}` : ""}`
      : `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ll(navTarget)}${myPos ? `&origin=${ll(myPos)}` : ""}`;
  const legs = [
    myPos && storePt && order.status !== "picked_up" ? { label: t({ pt: "Até à loja", en: "To store", fr: "Jusqu'au magasin" }), km: km(myPos, storePt) } : null,
    storePt && dest ? { label: t({ pt: "Loja → cliente", en: "Store → customer", fr: "Magasin → client" }), km: km(storePt, dest) } : null,
  ].filter(Boolean) as { label: string; km: number }[];

  const setStatus = useMutation({
    mutationFn: (status: "picked_up" | "delivered") => post(`/api/driver/orders/${order.id}/status`, { status }),
    onSuccess: (_d, status) => {
      queryClient.invalidateQueries({ queryKey: [CURRENT] });
      queryClient.invalidateQueries({ queryKey: [AVAILABLE] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/history"] });
      setConfirm(false);
      toast({ title: status === "delivered" ? t({ pt: "Entrega concluída. Obrigado!", en: "Delivery completed. Thanks!", fr: "Livraison terminée. Merci !" }) : t({ pt: "Encomenda recolhida", en: "Order picked up", fr: "Commande récupérée" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });

  return (
    <article className="space-y-3 rounded-xl border-2 border-primary bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-neutral-500">{t({ pt: "Entrega em curso", en: "Current delivery", fr: "Livraison en cours" })}</p>
          <p className="font-mono text-lg font-bold">{order.orderNumber}</p>
        </div>
        <StatusBadge status={order.status} className="text-sm" />
      </div>

      {order.collectCash > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-100 p-3 text-brand-900" role="alert">
          <Banknote className="h-6 w-6 shrink-0" />
          <p className="text-lg font-bold">{t({ pt: `Cobrar ${kz(order.collectCash)} em numerário`, en: `Collect ${kz(order.collectCash)} in cash`, fr: `Encaisser ${kz(order.collectCash)} en espèces` })}</p>
        </div>
      )}

      <div className={cn("rounded-lg border p-3", order.status !== "picked_up" && "border-primary/40 bg-primary/5")}>
        <p className="flex items-center gap-1 text-xs font-semibold uppercase text-neutral-500"><StoreIcon className="h-3 w-3" />{t({ pt: "Recolha", en: "Pickup", fr: "Retrait" })}</p>
        <p className="font-semibold">{order.store.name}</p>
        <p className="text-sm text-neutral-600">{order.store.street}, {order.store.zone}</p>
        <a href={`tel:${order.store.phone}`} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-medium">
          <Phone className="h-4 w-4" />{t({ pt: "Ligar à loja", en: "Call store", fr: "Appeler le magasin" })}
        </a>
      </div>

      <div className={cn("rounded-lg border p-3", order.status === "picked_up" && "border-primary/40 bg-primary/5")}>
        <p className="flex items-center gap-1 text-xs font-semibold uppercase text-neutral-500"><MapPin className="h-3 w-3" />{t({ pt: "Entrega", en: "Drop-off", fr: "Livraison" })}</p>
        <p className="font-semibold">{order.customer.name}</p>
        <p className="text-sm text-neutral-700">{a.street}</p>
        <p className="text-sm text-neutral-600">{a.zone}, {a.city}</p>
        {a.reference && <p className="mt-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-900">{t({ pt: "Referência:", en: "Landmark:", fr: "Repère :" })} {a.reference}</p>}
        <a href={`tel:${order.customer.phone}`} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-medium">
          <Phone className="h-4 w-4" />{t({ pt: "Ligar ao cliente", en: "Call customer", fr: "Appeler le client" })}
        </a>
      </div>

      <div>
        <p className="mb-1 text-sm font-semibold">{t({ pt: "Artigos", en: "Items", fr: "Articles" })}</p>
        <ul className="space-y-0.5 text-sm">
          {order.items.map((i) => (
            <li key={i.id}>
              <span className="font-bold">{i.quantity}×</span> {i.name}
              {i.selectedOptions?.length > 0 && <span className="text-xs text-neutral-500"> ({i.selectedOptions.map((o) => o.name).join(", ")})</span>}
            </li>
          ))}
        </ul>
        {order.notes && <p className="mt-2 flex gap-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-900"><StickyNote className="mt-0.5 h-4 w-4 shrink-0" />{order.notes}</p>}
        {(order.priority || !!order.riderTip) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {order.priority && <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-white">⚡ {t({ pt: "Prioritária — entregar primeiro", en: "Priority — deliver first", fr: "Prioritaire — livrer d'abord" })}</span>}
            {!!order.riderTip && <span className="rounded-full bg-green-100 px-2.5 py-1 text-xs font-bold text-green-800">💚 {t({ pt: `Gorjeta para si: ${kz(order.riderTip)}`, en: `Your tip: ${kz(order.riderTip)}`, fr: `Votre pourboire : ${kz(order.riderTip)}` })}</span>}
          </div>
        )}
        <p className="mt-2 text-sm text-neutral-600">
          {t(T.total)}: <strong>{kz(order.total)}</strong> · {PAYMENT[order.paymentMethod] ? t(PAYMENT[order.paymentMethod]) : order.paymentMethod}
          {order.estimatedDeliveryAt && <> · {t({ pt: "Previsto", en: "ETA", fr: "Prévu" })} {time(order.estimatedDeliveryAt, lang)}</>}
        </p>
      </div>

      <OrderMap store={storePt} destination={dest} driver={myPos}
        labels={{ store: order.store.name, destination: order.customer.name, driver: t({ pt: "Você", en: "You", fr: "Vous" }) }} />
      {mapsUrl && (
        <a href={mapsUrl} target="_blank" rel="noopener noreferrer"
          className="flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-medium">
          <Navigation className="h-4 w-4" />
          {order.status === "picked_up"
            ? t({ pt: "Navegar até ao cliente (Google Maps)", en: "Navigate to customer (Google Maps)", fr: "Itinéraire vers le client (Google Maps)" })
            : t({ pt: "Rota completa: loja → cliente (Google Maps)", en: "Full route: store → customer (Google Maps)", fr: "Itinéraire complet : magasin → client (Google Maps)" })}
        </a>
      )}
      {!!legs.length && (
        <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
          {legs.map((l) => <span key={l.label} className="rounded-full bg-neutral-100 px-2.5 py-1">{l.label}: <strong>{fmtKm(l.km)}</strong></span>)}
        </div>
      )}

      {(order.status === "accepted" || order.status === "preparing") && (
        <p className="rounded-lg bg-sky-50 p-3 text-center font-medium text-sky-900">{t({ pt: "A loja está a preparar a encomenda", en: "The store is preparing the order", fr: "Le magasin prépare la commande" })}</p>
      )}
      {order.status === "ready" && (
        <Button size="lg" className="h-14 w-full text-base" disabled={setStatus.isPending} onClick={() => setStatus.mutate("picked_up")}>
          {t({ pt: "Recolhi a encomenda", en: "I've picked up the order", fr: "J'ai récupéré la commande" })}
        </Button>
      )}
      {order.status === "picked_up" && (
        <Button size="lg" className="h-14 w-full bg-green-700 text-base hover:bg-green-800" disabled={setStatus.isPending} onClick={() => setConfirm(true)}>
          {t({ pt: "Entreguei", en: "Delivered", fr: "Livrée" })}
        </Button>
      )}

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Confirmar entrega?", en: "Confirm delivery?", fr: "Confirmer la livraison ?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {order.collectCash > 0
                ? t({ pt: `Confirme que recebeu ${kz(order.collectCash)} em numerário do cliente.`, en: `Confirm you received ${kz(order.collectCash)} in cash from the customer.`, fr: `Confirmez avoir reçu ${kz(order.collectCash)} en espèces du client.` })
                : t({ pt: "Confirme que entregou a encomenda ao cliente.", en: "Confirm you handed the order to the customer.", fr: "Confirmez avoir remis la commande au client." })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-green-700 hover:bg-green-800" onClick={(e) => { e.preventDefault(); setStatus.mutate("delivered"); }}>
              {t(T.confirm)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}

function AvailableList({ onClaimError, myPos }: { onClaimError: (e: Error) => void; myPos: LL | null }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<{ orders: DriverOrder[] }>({ queryKey: [AVAILABLE], refetchInterval: 5000 });
  const claim = useMutation({
    mutationFn: (id: number) => post(`/api/driver/orders/${id}/claim`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [CURRENT] });
      queryClient.invalidateQueries({ queryKey: [AVAILABLE] });
      toast({ title: t({ pt: "Entrega aceite", en: "Delivery accepted", fr: "Livraison acceptée" }) });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && err.code === "NOT_AVAILABLE") {
        toast({ title: t({ pt: "Já não está disponível", en: "No longer available", fr: "Plus disponible" }), description: err.message });
        queryClient.invalidateQueries({ queryKey: [AVAILABLE] });
      } else if (err instanceof ApiError && err.code === "DRIVER_BUSY") {
        toast({ variant: "destructive", title: t({ pt: "Já tem uma entrega", en: "You already have a delivery", fr: "Vous avez déjà une livraison" }), description: err.message });
        queryClient.invalidateQueries({ queryKey: [CURRENT] });
      } else onClaimError(err);
    },
  });

  // aviso de nova entrega: bip, vibração e notificação do sistema (se autorizada)
  const beep = useBeep();
  const seen = useRef<Set<number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const ids = data.orders.map((o) => o.id);
    if (seen.current) {
      const fresh = data.orders.filter((o) => !seen.current!.has(o.id));
      if (fresh.length) {
        beep();
        try { navigator.vibrate?.([200, 100, 200]); } catch { /* sem vibração */ }
        try {
          if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
            new Notification(t({ pt: "Nova entrega disponível", en: "New delivery available", fr: "Nouvelle livraison disponible" }), {
              body: `${fresh[0].store.name} → ${fresh[0].deliveryAddress.zone} · ${kz(fresh[0].deliveryFee + (fresh[0].riderTip ?? 0))}`,
              tag: "pedeja-delivery",
            });
          }
        } catch { /* sem notificações */ }
      }
    }
    seen.current = new Set(ids);
  }, [data]);
  const [notif, setNotif] = useState(() => ("Notification" in window ? Notification.permission : "denied"));

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  // prioritárias primeiro, depois a loja mais perto de mim
  const list = [...data!.orders].map((o) => {
    const sp = pt(o.store.latitude, o.store.longitude);
    return { o, dist: myPos && sp ? km(myPos, sp) : null };
  }).sort((a, b) => Number(!!b.o.priority) - Number(!!a.o.priority) || (a.dist ?? 1e9) - (b.dist ?? 1e9));
  return (
    <section>
      <h1 className="mb-2 text-lg font-bold">{t({ pt: "Entregas disponíveis", en: "Available deliveries", fr: "Livraisons disponibles" })}</h1>
      {notif === "default" && (
        <button type="button" onClick={async () => setNotif(await Notification.requestPermission())}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-dashed border-primary bg-brand-50 p-3 text-left text-sm font-medium text-primary">
          <Bell className="h-4 w-4 shrink-0" />
          {t({ pt: "Activar avisos de novas entregas (mesmo com a app em segundo plano)", en: "Turn on new-delivery alerts (even in the background)", fr: "Activer les alertes de nouvelles livraisons (même en arrière-plan)" })}
        </button>
      )}
      {!list.length ? (
        <EmptyState icon="🛵" title={t({ pt: "Sem entregas de momento", en: "No deliveries right now", fr: "Aucune livraison pour le moment" })}
          text={t({ pt: "A lista actualiza automaticamente.", en: "The list refreshes automatically.", fr: "La liste se met à jour automatiquement." })} />
      ) : (
        <ul className="space-y-3">
          {list.map(({ o, dist }) => (
            <li key={o.id} className={cn("rounded-lg border bg-white p-3", o.priority && "border-2 border-primary")}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{o.store.name}</p>
                  <p className="text-sm text-neutral-600">{o.store.zone} → <strong>{o.deliveryAddress.zone}</strong></p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-green-700">{kz(o.deliveryFee)}</p>
                  <p className="text-[11px] text-neutral-500">{t({ pt: "ganho", en: "earning", fr: "gain" })}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                <StatusBadge status={o.status} />
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{time(o.createdAt, lang)}</span>
                {dist !== null && <span className="inline-flex items-center gap-1"><Navigation className="h-3 w-3" />{t({ pt: `loja a ${fmtKm(dist)}`, en: `store ${fmtKm(dist)} away`, fr: `magasin à ${fmtKm(dist)}` })}</span>}
                {o.priority && <span className="rounded-full bg-primary px-2 py-0.5 font-bold text-white">⚡ {t({ pt: "Prioritária", en: "Priority", fr: "Prioritaire" })}</span>}
                {!!o.riderTip && <span className="rounded-full bg-green-100 px-2 py-0.5 font-bold text-green-800">+{kz(o.riderTip)} {t({ pt: "gorjeta", en: "tip", fr: "pourboire" })}</span>}
                {o.collectCash > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 font-semibold text-brand-800">
                    <Banknote className="h-3 w-3" />{t({ pt: "Cobrar", en: "Collect", fr: "Encaisser" })} {kz(o.collectCash)}
                  </span>
                )}
              </div>
              <Button className="mt-3 h-11 w-full" disabled={claim.isPending} onClick={() => claim.mutate(o.id)}>
                {t({ pt: "Aceitar", en: "Accept", fr: "Accepter" })}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
