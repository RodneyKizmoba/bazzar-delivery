import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Phone, MapPin, Navigation, Store as StoreIcon, Banknote, StickyNote, Clock } from "lucide-react";
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
  collectCash: number; deliveryAddress: Addr; notes: string | null; estimatedDeliveryAt: string | null; createdAt: string;
  store: DStore;
}
interface CurrentOrder extends DriverOrder {
  customer: { name: string; phone: string };
  items: { id: number; name: string; quantity: number; selectedOptions: { groupName: string; name: string }[]; specialInstructions: string | null }[];
}

const CURRENT = "/api/driver/current";
const AVAILABLE = "/api/driver/available";

const pt = (lat?: number | null, lng?: number | null) => (lat != null && lng != null ? { latitude: lat, longitude: lng } : null);

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

  // Partilha de localização: só com o interruptor ligado e uma entrega em curso.
  useEffect(() => {
    if (!sharing || !hasCurrent) return;
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
        if (now - lastSent.current >= 10_000) {
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
  }, [sharing, hasCurrent]);

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
              : t({ pt: "A localização será enviada quando tiver uma entrega em curso.", en: "Location will be sent once you have an active delivery.", fr: "La position sera envoyée dès que vous aurez une livraison en cours." })
            : t({ pt: "Desligado.", en: "Off.", fr: "Désactivé." })}
        </p>
        {geoError && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{geoError}</p>}
      </div>

      {currentQ.isLoading ? <Loading /> : currentQ.error ? (
        <ErrorState error={currentQ.error} onRetry={() => currentQ.refetch()} />
      ) : current ? (
        <CurrentDelivery order={current} myPos={myPos} />
      ) : (
        <AvailableList onClaimError={(e) => toast({ variant: "destructive", title: t(T.error), description: e.message })} />
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
  const mapsUrl = navTarget ? `https://www.google.com/maps/dir/?api=1&destination=${navTarget.latitude},${navTarget.longitude}` : null;

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
        <div className="flex items-center gap-2 rounded-lg bg-orange-100 p-3 text-orange-900" role="alert">
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
            : t({ pt: "Navegar até à loja (Google Maps)", en: "Navigate to store (Google Maps)", fr: "Itinéraire vers le magasin (Google Maps)" })}
        </a>
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

function AvailableList({ onClaimError }: { onClaimError: (e: Error) => void }) {
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

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const list = data!.orders;
  return (
    <section>
      <h1 className="mb-2 text-lg font-bold">{t({ pt: "Entregas disponíveis", en: "Available deliveries", fr: "Livraisons disponibles" })}</h1>
      {!list.length ? (
        <EmptyState icon="🛵" title={t({ pt: "Sem entregas de momento", en: "No deliveries right now", fr: "Aucune livraison pour le moment" })}
          text={t({ pt: "A lista actualiza automaticamente.", en: "The list refreshes automatically.", fr: "La liste se met à jour automatiquement." })} />
      ) : (
        <ul className="space-y-3">
          {list.map((o) => (
            <li key={o.id} className="rounded-lg border bg-white p-3">
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
                {o.collectCash > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-800">
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
