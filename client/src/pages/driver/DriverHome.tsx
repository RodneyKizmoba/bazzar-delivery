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
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { kz, time, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { poll } from "@/lib/live";

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
  collectCash: number; deliveryAddress: Addr; notes: string | null; priority?: boolean; riderTip?: number; cutlery?: boolean;
  driverAtStoreAt?: string | null; driverAtCustomerAt?: string | null; estimatedDeliveryAt: string | null; createdAt: string;
  readyEstimateAt?: string | null; payout?: number | null; tripKm?: number | null; pinRequired?: boolean;
  riderPayDetail?: PayDetail | null; riderWaitFee?: number;
  store: DStore;
  // Envios: "store" é o ponto de recolha (quem envia)
  kind?: "food" | "parcel";
  parcel?: { size: "small" | "medium" | "large"; description: string; recipientName: string; recipientPhone: string; fragile: boolean } | null;
}

const PARCEL_SIZE = {
  small: { pt: "Pequeno", en: "Small", fr: "Petit" },
  medium: { pt: "Médio", en: "Medium", fr: "Moyen" },
  large: { pt: "Grande", en: "Large", fr: "Grand" },
} as const;

/** Envios: o que vai no pacote; o numerário paga-o quem envia, na recolha. */
function ParcelBox({ o }: { o: DriverOrder }) {
  const t = useT();
  if (!o.parcel) return null;
  return (
    <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <p className="font-bold">📦 {t({ pt: "Envio", en: "Parcel", fr: "Colis" })} · {t(PARCEL_SIZE[o.parcel.size])}{o.parcel.fragile && <> · ⚠️ {t({ pt: "Frágil", en: "Fragile", fr: "Fragile" })}</>}</p>
      <p>{o.parcel.description}</p>
      {o.collectCash > 0 && <p className="mt-1 font-semibold">💵 {t({ pt: `Cobre ${kz(o.collectCash)} a quem envia, na recolha.`, en: `Collect ${kz(o.collectCash)} from the sender at pickup.`, fr: `Encaissez ${kz(o.collectCash)} auprès de l'expéditeur.` })}</p>}
      <p className="mt-1 text-xs">{t({ pt: "Na entrega, peça o código a quem recebe.", en: "At drop-off, ask the recipient for the code.", fr: "À la livraison, demandez le code au destinataire." })}</p>
    </div>
  );
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

export interface PayDetail {
  vehicle: "moto" | "car" | "ebike" | "bike"; pickupKm: number; dropKm: number; estMinutes: number;
  base: number; distance: number; timeBonus: number; busyBonus: number; floorTopUp: number; total: number;
  band: "night" | "peak" | "normal"; busyLevel: number;
}
const VEHICLE_LABEL: Record<PayDetail["vehicle"], Tr> = {
  moto: { pt: "Mota", en: "Motorbike", fr: "Moto" }, car: { pt: "Carro", en: "Car", fr: "Voiture" },
  ebike: { pt: "Bicicleta eléctrica", en: "E-bike", fr: "Vélo électrique" }, bike: { pt: "Bicicleta", en: "Bicycle", fr: "Vélo" },
};

/** Como se chega ao valor desta entrega (antes de aceitar). */
function PayBreakdown({ d, tip = 0, wait = 0 }: { d: PayDetail; tip?: number; wait?: number }) {
  const t = useT();
  const row = (label: string, v: number) => (
    <div className="flex justify-between gap-2"><span>{label}</span><span className="tabular-nums">{kz(v)}</span></div>
  );
  return (
    <div className="space-y-0.5 rounded-lg bg-neutral-50 p-2 text-xs text-neutral-700">
      {row(t({ pt: "Base", en: "Base", fr: "Base" }), d.base)}
      {(() => { const a = d.pickupKm.toFixed(1), b = d.dropKm.toFixed(1), c = (x: string) => x.replace(".", ",");
        return row(t({ pt: `Distância (${c(a)} + ${c(b)} km)`, en: `Distance (${a} + ${b} km)`, fr: `Distance (${c(a)} + ${c(b)} km)` }), d.distance); })()}
      {!!d.timeBonus && row(d.band === "night" ? t({ pt: "Bónus noite", en: "Night bonus", fr: "Bonus nuit" }) : t({ pt: "Bónus hora de ponta", en: "Peak bonus", fr: "Bonus heure de pointe" }), d.timeBonus)}
      {!!d.busyBonus && row(t({ pt: "Bónus movimento", en: "Busy bonus", fr: "Bonus affluence" }), d.busyBonus)}
      {!!d.floorTopUp && row(t({ pt: "Garantia mínima por hora", en: "Hourly minimum top-up", fr: "Complément minimum horaire" }), d.floorTopUp)}
      {!!wait && row(t({ pt: "Espera na loja", en: "Wait at store", fr: "Attente au magasin" }), wait)}
      {!!tip && row(t({ pt: "Gorjeta (100% sua)", en: "Tip (100% yours)", fr: "Pourboire (100 % pour vous)" }), tip)}
      <p className="pt-1 text-[11px] text-neutral-500">{t(VEHICLE_LABEL[d.vehicle])} · ~{d.estMinutes} min</p>
    </div>
  );
}

/** Na loja: a espera é paga depois dos primeiros 5 minutos (ao segundo, até 30 min). */
function WaitMeter({ since }: { since: string }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const min = (now - new Date(since).getTime()) / 60_000;
  const paidMin = Math.min(30, Math.max(0, min - 5));
  const mm = Math.floor(min), ss = Math.floor((min - mm) * 60);
  return (
    <p className="rounded-lg bg-brand-50 p-2 text-xs text-brand-900" aria-live="off">
      ⏱ {t({ pt: `À espera há ${mm}:${String(ss).padStart(2, "0")}`, en: `Waiting ${mm}:${String(ss).padStart(2, "0")}`, fr: `Attente ${mm}:${String(ss).padStart(2, "0")}` })}
      {" · "}{paidMin > 0
        ? <b>{t({ pt: `espera paga: ~${kz(Math.round(paidMin * 30))}`, en: `paid wait: ~${kz(Math.round(paidMin * 30))}`, fr: `attente payée : ~${kz(Math.round(paidMin * 30))}` })}</b>
        : t({ pt: "a espera é paga a partir dos 5 min", en: "wait is paid after 5 min", fr: "attente payée après 5 min" })}
    </p>
  );
}

interface Offer {
  offerSeconds?: number; id: number; expiresAt: string; secondsLeft: number; distanceKm: number | null; payout: number; payDetail?: PayDetail | null;
  order: DriverOrder;
}
interface Presence { isOnline: boolean; latitude?: number | null; longitude?: number | null; locationAt?: string | null }
const PRESENCE = "/api/driver/presence";
const OFFERS = "/api/driver/offers";

function DriverContent() {
  const t = useT();
  const { toast } = useToast();
  const [geoError, setGeoError] = useState<string | null>(null);
  const [myPos, setMyPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const lastSent = useRef(0);
  const presenceQ = useQuery<{ presence: Presence; autoDispatch: boolean; offerSeconds: number }>({ queryKey: [PRESENCE] });
  const online = !!presenceQ.data?.presence.isOnline;
  const currentQ = useQuery<{ order: CurrentOrder | null }>({ queryKey: [CURRENT], refetchInterval: poll(5000) });
  const current = currentQ.data?.order ?? null;
  const hasCurrent = !!current;
  const hasCurrentRef = useRef(hasCurrent);
  hasCurrentRef.current = hasCurrent;

  const geoMsg = (err: GeolocationPositionError) => err.code === err.PERMISSION_DENIED
    ? t({ pt: "Permissão de localização negada. Active-a nas definições do navegador.", en: "Location permission denied. Enable it in your browser settings.", fr: "Autorisation de localisation refusée. Activez-la dans les paramètres du navigateur." })
    : err.code === err.POSITION_UNAVAILABLE
      ? t({ pt: "Localização indisponível. Verifique o GPS.", en: "Location unavailable. Check your GPS.", fr: "Position indisponible. Vérifiez le GPS." })
      : t({ pt: "Não foi possível obter a localização (tempo esgotado).", en: "Couldn't get location (timeout).", fr: "Impossible d'obtenir la position (délai dépassé)." });

  const goOnline = useMutation({
    mutationFn: async (on: boolean) => {
      let pos: { latitude: number; longitude: number } | null = null;
      if (on && "geolocation" in navigator) {
        pos = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
          (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
          (err) => { setGeoError(geoMsg(err)); resolve(null); },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
        ));
        if (pos) setMyPos(pos);
      }
      return post(PRESENCE, { online: on, ...(pos ?? {}) });
    },
    onSuccess: (_d, on) => {
      queryClient.invalidateQueries({ queryKey: [PRESENCE] });
      queryClient.invalidateQueries({ queryKey: [OFFERS] });
      toast({ title: on ? t({ pt: "Está online — vai receber entregas", en: "You're online — deliveries will come to you", fr: "Vous êtes en ligne — vous recevrez des livraisons" }) : t({ pt: "Está offline", en: "You're offline", fr: "Vous êtes hors ligne" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });

  // GPS: ligado enquanto está online ou com uma entrega em curso.
  // Envia a posição a cada 5 s durante a entrega (o cliente vê-o no mapa) e a cada 15 s à espera (para receber as entregas mais perto).
  const tracking = online || hasCurrent;
  useEffect(() => {
    if (!tracking) return;
    if (!("geolocation" in navigator)) {
      setGeoError(t({ pt: "Este dispositivo não suporta geolocalização.", en: "This device doesn't support geolocation.", fr: "Cet appareil ne prend pas en charge la géolocalisation." }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setMyPos(p);
        setGeoError(null);
        const now = Date.now();
        if (now - lastSent.current >= (hasCurrentRef.current ? 5_000 : 15_000)) {
          lastSent.current = now;
          post("/api/driver/location", p).catch(() => { /* nova tentativa na próxima posição */ });
        }
      },
      (err) => setGeoError(geoMsg(err)),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border p-3", online ? "border-primary bg-brand-50" : "bg-white")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="rider-online" className="text-base font-bold">
              {online ? t({ pt: "Online", en: "Online", fr: "En ligne" }) : t({ pt: "Offline", en: "Offline", fr: "Hors ligne" })}
            </Label>
            <p className="text-xs text-neutral-600">
              {online
                ? t({ pt: "Recebe entregas perto de si. O GPS está ligado.", en: "You get deliveries near you. GPS is on.", fr: "Vous recevez des livraisons proches. GPS activé." })
                : t({ pt: "Ligue para começar a receber entregas.", en: "Switch on to start getting deliveries.", fr: "Activez pour recevoir des livraisons." })}
            </p>
          </div>
          <Switch id="rider-online" checked={online} disabled={goOnline.isPending || presenceQ.isLoading} onCheckedChange={(v) => goOnline.mutate(v)} />
        </div>
        {tracking && (
          <p className="mt-2 flex items-center gap-1 text-xs text-neutral-600">
            <Navigation className="h-3 w-3" />
            {myPos
              ? t({ pt: `GPS: ${myPos.latitude.toFixed(4)}, ${myPos.longitude.toFixed(4)}`, en: `GPS: ${myPos.latitude.toFixed(4)}, ${myPos.longitude.toFixed(4)}`, fr: `GPS : ${myPos.latitude.toFixed(4)}, ${myPos.longitude.toFixed(4)}` })
              : t({ pt: "A procurar sinal GPS…", en: "Looking for GPS signal…", fr: "Recherche du signal GPS…" })}
            {hasCurrent && <> · {t({ pt: "o cliente vê-o no mapa", en: "the customer sees you on the map", fr: "le client vous voit sur la carte" })}</>}
          </p>
        )}
        {geoError && <p className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700" role="alert">{geoError}</p>}
      </div>

      {currentQ.isLoading ? <Loading /> : currentQ.error ? (
        <ErrorState error={currentQ.error} onRetry={() => currentQ.refetch()} />
      ) : current ? (
        <CurrentDelivery order={current} myPos={myPos} />
      ) : (
        <>
          {online && <OfferCard myPos={myPos} />}
          <AvailableList myPos={myPos} onClaimError={(e) => toast({ variant: "destructive", title: t(T.error), description: e.message })} />
        </>
      )}
    </div>
  );
}

/** Oferta de entrega só para mim, com contagem decrescente (Deliveroo: aceitar ou recusar em 30 s). */
function OfferCard({ myPos }: { myPos: LL | null }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const beep = useBeep();
  const { data } = useQuery<{ offer: Offer | null }>({ queryKey: [OFFERS], refetchInterval: poll(5000, 30_000) });
  const offer = data?.offer ?? null;
  const [left, setLeft] = useState(0);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!offer) return;
    if (seen.current !== offer.id) {
      seen.current = offer.id;
      beep();
      try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch { /* sem vibração */ }
      try {
        if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
          new Notification(t({ pt: "Nova entrega para si", en: "New delivery for you", fr: "Nouvelle livraison pour vous" }), {
            body: `${offer.order.store.name} → ${offer.order.deliveryAddress.zone} · ${kz(offer.payout)}`, tag: "pedeja-offer",
          });
        }
      } catch { /* sem notificações */ }
    }
    const end = new Date(offer.expiresAt).getTime();
    const tick = () => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) queryClient.invalidateQueries({ queryKey: [OFFERS] });
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [offer?.id]);

  const done = () => {
    queryClient.invalidateQueries({ queryKey: [OFFERS] });
    queryClient.invalidateQueries({ queryKey: [CURRENT] });
    queryClient.invalidateQueries({ queryKey: [AVAILABLE] });
  };
  const accept = useMutation({
    mutationFn: (id: number) => post(`/api/driver/offers/${id}/accept`),
    onSuccess: () => { done(); toast({ title: t({ pt: "Entrega aceite — boa viagem!", en: "Delivery accepted — ride safe!", fr: "Livraison acceptée — bonne route !" }) }); },
    onError: (err: Error) => { done(); toast({ variant: "destructive", title: t(T.error), description: err.message }); },
  });
  const decline = useMutation({
    mutationFn: (id: number) => post(`/api/driver/offers/${id}/decline`),
    onSuccess: done,
    onError: done,
  });

  if (!offer || left <= 0) return null;
  const o = offer.order;
  const sp = pt(o.store.latitude, o.store.longitude);
  const toStore = myPos && sp ? km(myPos, sp) : offer.distanceKm;
  const total = offer.offerSeconds ?? 30;
  return (
    <section aria-live="assertive" className="overflow-hidden rounded-2xl border-2 border-primary bg-white shadow-lg">
      <div className="h-1.5 bg-neutral-100"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (left / total) * 100)}%` }} /></div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">{t({ pt: "Nova entrega para si", en: "New delivery for you", fr: "Nouvelle livraison pour vous" })}</p>
            <p className="text-3xl font-extrabold text-neutral-900">{kz(offer.payout)}</p>
            {!!o.riderTip && <p className="text-xs font-semibold text-green-700">{t({ pt: `inclui ${kz(o.riderTip)} de gorjeta`, en: `includes ${kz(o.riderTip)} tip`, fr: `dont ${kz(o.riderTip)} de pourboire` })}</p>}
            {offer.payDetail && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs font-semibold text-brand-800">{t({ pt: "Como é calculado", en: "How it's worked out", fr: "Comment c'est calculé" })}</summary>
                <PayBreakdown d={offer.payDetail} tip={o.riderTip ?? 0} />
              </details>
            )}
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xl font-extrabold text-brand-900" aria-label={t({ pt: `${left} segundos`, en: `${left} seconds`, fr: `${left} secondes` })}>{left}</div>
        </div>
        <div className="space-y-1 text-sm">
          <p className="flex items-center gap-1.5"><StoreIcon className="h-4 w-4 text-primary" /><strong>{o.store.name}</strong>
            {toStore != null && <span className="text-neutral-600">· {fmtKm(toStore)} {o.parcel ? t({ pt: "até à recolha", en: "to pickup", fr: "jusqu'au départ" }) : t({ pt: "até à loja", en: "to store", fr: "jusqu'au magasin" })}</span>}</p>
          <p className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-green-700" />{o.deliveryAddress.zone}
            {o.tripKm != null && <span className="text-neutral-600">· {fmtKm(o.tripKm)} {t({ pt: "de entrega", en: "delivery leg", fr: "de livraison" })}</span>}</p>
          {o.parcel && <p className="font-semibold text-amber-800">📦 {t({ pt: "Envio", en: "Parcel", fr: "Colis" })} · {t(PARCEL_SIZE[o.parcel.size])}{o.parcel.fragile ? ` · ${t({ pt: "Frágil", en: "Fragile", fr: "Fragile" })}` : ""}</p>}
          {o.readyEstimateAt && !o.parcel && <p className="flex items-center gap-1.5 text-neutral-600"><Clock className="h-4 w-4" />{t({ pt: "Comida pronta às", en: "Food ready at", fr: "Repas prêt à" })} {time(o.readyEstimateAt, lang)}</p>}
          {o.collectCash > 0 && <p className="flex items-center gap-1.5 font-semibold text-brand-800"><Banknote className="h-4 w-4" />{t({ pt: "Cobrar", en: "Collect", fr: "Encaisser" })} {kz(o.collectCash)}</p>}
          {o.priority && <p className="font-semibold text-primary">⚡ {t({ pt: "Prioritária", en: "Priority", fr: "Prioritaire" })}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-12 flex-1" disabled={decline.isPending || accept.isPending} onClick={() => decline.mutate(offer.id)}>
            {t({ pt: "Recusar", en: "Decline", fr: "Refuser" })}
          </Button>
          <Button className="h-12 flex-[2] text-base font-bold" disabled={accept.isPending || decline.isPending} onClick={() => accept.mutate(offer.id)}>
            {t({ pt: "Aceitar entrega", en: "Accept delivery", fr: "Accepter" })}
          </Button>
        </div>
      </div>
    </section>
  );
}

function CurrentDelivery({ order, myPos }: { order: CurrentOrder; myPos: { latitude: number; longitude: number } | null }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const [pin, setPin] = useState("");
  const [pinError, setPinError] = useState<string | null>(null);
  const a = order.deliveryAddress;
  const dest = pt(a.latitude, a.longitude);
  const storePt = pt(order.store.latitude, order.store.longitude);
  const isParcel = !!order.parcel;
  const navTarget = order.status === "picked_up" ? dest : storePt ?? dest;
  // Rota completa no Google Maps (escolhe o caminho mais rápido com trânsito): até à loja e depois ao cliente
  const ll = (p: { latitude: number; longitude: number }) => `${p.latitude},${p.longitude}`;
  const mapsUrl = !navTarget ? null
    : order.status !== "picked_up" && storePt && dest
      ? `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ll(dest)}&waypoints=${ll(storePt)}${myPos ? `&origin=${ll(myPos)}` : ""}`
      : `https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=${ll(navTarget)}${myPos ? `&origin=${ll(myPos)}` : ""}`;
  const legs = [
    myPos && storePt && order.status !== "picked_up" ? { label: isParcel ? t({ pt: "Até à recolha", en: "To pickup", fr: "Jusqu'au départ" }) : t({ pt: "Até à loja", en: "To store", fr: "Jusqu'au magasin" }), km: km(myPos, storePt) } : null,
    storePt && dest ? { label: isParcel ? t({ pt: "Recolha → entrega", en: "Pickup → drop-off", fr: "Départ → livraison" }) : t({ pt: "Loja → cliente", en: "Store → customer", fr: "Magasin → client" }), km: km(storePt, dest) } : null,
  ].filter(Boolean) as { label: string; km: number }[];

  const setStatus = useMutation({
    mutationFn: (status: "picked_up" | "delivered") => post(`/api/driver/orders/${order.id}/status`, status === "delivered" && order.pinRequired ? { status, pin } : { status }),
    onSuccess: (_d, status) => {
      queryClient.invalidateQueries({ queryKey: [CURRENT] });
      queryClient.invalidateQueries({ queryKey: [AVAILABLE] });
      queryClient.invalidateQueries({ queryKey: ["/api/driver/history"] });
      setConfirm(false);
      toast({ title: status === "delivered" ? t({ pt: "Entrega concluída. Obrigado!", en: "Delivery completed. Thanks!", fr: "Livraison terminée. Merci !" }) : t({ pt: "Encomenda recolhida", en: "Order picked up", fr: "Commande récupérée" }) });
    },
    onError: (err: Error) => {
      if (err instanceof ApiError && ["BAD_PIN", "PIN_REQUIRED", "PIN_LOCKED"].includes(err.code ?? "")) { setPinError(err.message); setPin(""); }
      else toast({ variant: "destructive", title: t(T.error), description: err.message });
    },
  });
  // "Cheguei": avisa a loja / o cliente na hora (via actualizações ao vivo)
  const arrived = useMutation({
    mutationFn: (at: "store" | "customer") => post(`/api/driver/orders/${order.id}/arrived`, { at }),
    onSuccess: (_d, at) => {
      queryClient.invalidateQueries({ queryKey: [CURRENT] });
      toast({ title: at === "store"
        ? t({ pt: "A loja sabe que chegou", en: "The store knows you've arrived", fr: "Le magasin sait que vous êtes là" })
        : t({ pt: "O cliente foi avisado de que está à porta", en: "The customer knows you're outside", fr: "Le client sait que vous êtes devant" }) });
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
        <div className="text-right">
          <StatusBadge status={order.status} className="text-sm" />
          {order.payout != null && <p className="mt-1 text-sm font-bold text-green-700">{t({ pt: "Ganho", en: "Earning", fr: "Gain" })} {kz(order.payout)}</p>}
        </div>
      </div>
      {order.riderPayDetail && (
        <details>
          <summary className="cursor-pointer text-xs font-semibold text-brand-800">{t({ pt: "Ver o cálculo do ganho", en: "See how your earning is worked out", fr: "Voir le calcul du gain" })}</summary>
          <PayBreakdown d={order.riderPayDetail} tip={order.riderTip ?? 0} wait={order.riderWaitFee ?? 0} />
        </details>
      )}
      {order.driverAtStoreAt && order.status !== "picked_up" && <WaitMeter since={order.driverAtStoreAt} />}

      {order.collectCash > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-brand-100 p-3 text-brand-900" role="alert">
          <Banknote className="h-6 w-6 shrink-0" />
          <p className="text-lg font-bold">{t({ pt: `Cobrar ${kz(order.collectCash)} em numerário`, en: `Collect ${kz(order.collectCash)} in cash`, fr: `Encaisser ${kz(order.collectCash)} en espèces` })}</p>
        </div>
      )}

      <div className={cn("rounded-lg border p-3", order.status !== "picked_up" && "border-primary/40 bg-primary/5")}>
        <p className="flex items-center gap-1 text-xs font-semibold uppercase text-neutral-500"><StoreIcon className="h-3 w-3" />{t({ pt: "Recolha", en: "Pickup", fr: "Retrait" })}</p>
        <p className="font-semibold">{order.store.name}</p>
        <p className="text-sm text-neutral-600">{[order.store.street, order.store.zone].filter(Boolean).join(", ")}</p>
        <a href={`tel:${order.store.phone}`} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-medium">
          <Phone className="h-4 w-4" />{isParcel ? t({ pt: "Ligar a quem envia", en: "Call sender", fr: "Appeler l'expéditeur" }) : t({ pt: "Ligar à loja", en: "Call store", fr: "Appeler le magasin" })}
        </a>
      </div>

      <div className={cn("rounded-lg border p-3", order.status === "picked_up" && "border-primary/40 bg-primary/5")}>
        <p className="flex items-center gap-1 text-xs font-semibold uppercase text-neutral-500"><MapPin className="h-3 w-3" />{t({ pt: "Entrega", en: "Drop-off", fr: "Livraison" })}</p>
        <p className="font-semibold">{order.customer.name}</p>
        <p className="text-sm text-neutral-700">{a.street}</p>
        <p className="text-sm text-neutral-600">{a.zone}, {a.city}</p>
        {a.reference && <p className="mt-1 rounded bg-yellow-50 px-2 py-1 text-sm text-yellow-900">{t({ pt: "Referência:", en: "Landmark:", fr: "Repère :" })} {a.reference}</p>}
        <a href={`tel:${order.customer.phone}`} className="mt-2 inline-flex min-h-10 items-center gap-1 rounded-md border px-3 text-sm font-medium">
          <Phone className="h-4 w-4" />{isParcel ? t({ pt: "Ligar a quem recebe", en: "Call recipient", fr: "Appeler le destinataire" }) : t({ pt: "Ligar ao cliente", en: "Call customer", fr: "Appeler le client" })}
        </a>
      </div>

      <ParcelBox o={order} />
      <div>
        {!order.parcel && <p className="mb-1 text-sm font-semibold">{t({ pt: "Artigos", en: "Items", fr: "Articles" })}</p>}
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
            {order.priority && <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-bold text-on-brand">⚡ {t({ pt: "Prioritária — entregar primeiro", en: "Priority — deliver first", fr: "Prioritaire — livrer d'abord" })}</span>}
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
            : isParcel ? t({ pt: "Rota completa: recolha → entrega (Google Maps)", en: "Full route: pickup → drop-off (Google Maps)", fr: "Itinéraire complet : départ → livraison (Google Maps)" })
            : t({ pt: "Rota completa: loja → cliente (Google Maps)", en: "Full route: store → customer (Google Maps)", fr: "Itinéraire complet : magasin → client (Google Maps)" })}
        </a>
      )}
      {!!legs.length && (
        <div className="flex flex-wrap gap-2 text-xs text-neutral-600">
          {legs.map((l) => <span key={l.label} className="rounded-full bg-neutral-100 px-2.5 py-1">{l.label}: <strong>{fmtKm(l.km)}</strong></span>)}
        </div>
      )}

      {order.status !== "picked_up" && !order.driverAtStoreAt && (
        <Button size="lg" variant="outline" className="h-12 w-full border-2 border-primary text-base font-bold" disabled={arrived.isPending} onClick={() => arrived.mutate("store")}>
          📍 {isParcel ? t({ pt: "Cheguei à recolha", en: "I'm at the pickup", fr: "Je suis au départ" }) : t({ pt: "Cheguei à loja", en: "I'm at the store", fr: "Je suis au magasin" })}
        </Button>
      )}
      {order.status === "picked_up" && !order.driverAtCustomerAt && (
        <Button size="lg" variant="outline" className="h-12 w-full border-2 border-primary text-base font-bold" disabled={arrived.isPending} onClick={() => arrived.mutate("customer")}>
          🏠 {t({ pt: "Cheguei ao cliente", en: "I'm at the customer", fr: "Je suis chez le client" })}
        </Button>
      )}
      {(order.status === "accepted" || order.status === "preparing") && (
        <p className="rounded-lg bg-sky-50 p-3 text-center font-medium text-sky-900">{t({ pt: "A loja está a preparar a encomenda", en: "The store is preparing the order", fr: "Le magasin prépare la commande" })}</p>
      )}
      {order.status === "ready" && (
        <Button size="lg" className="h-14 w-full text-base" disabled={setStatus.isPending} onClick={() => setStatus.mutate("picked_up")}>
          {isParcel ? t({ pt: "Recolhi o pacote", en: "I've picked up the parcel", fr: "J'ai récupéré le colis" }) : t({ pt: "Recolhi a encomenda", en: "I've picked up the order", fr: "J'ai récupéré la commande" })}
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
              {order.collectCash > 0 && order.parcel
                ? t({ pt: `Confirme que recebeu ${kz(order.collectCash)} em numerário de quem enviou e que entregou o pacote.`, en: `Confirm you got ${kz(order.collectCash)} in cash from the sender and handed over the parcel.`, fr: `Confirmez avoir reçu ${kz(order.collectCash)} de l'expéditeur et remis le colis.` })
                : order.collectCash > 0
                ? t({ pt: `Confirme que recebeu ${kz(order.collectCash)} em numerário do cliente.`, en: `Confirm you received ${kz(order.collectCash)} in cash from the customer.`, fr: `Confirmez avoir reçu ${kz(order.collectCash)} en espèces du client.` })
                : t({ pt: "Confirme que entregou a encomenda ao cliente.", en: "Confirm you handed the order to the customer.", fr: "Confirmez avoir remis la commande au client." })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {order.pinRequired && (
            <div className="space-y-2">
              <label htmlFor="delivery-pin" className="block text-sm font-semibold">
                🔒 {t({ pt: "Código de entrega (peça ao cliente)", en: "Delivery code (ask the customer)", fr: "Code de livraison (demandez au client)" })}
              </label>
              <input id="delivery-pin" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin}
                onChange={(e) => { setPin(e.target.value.replace(/\D/g, "").slice(0, 4)); setPinError(null); }}
                className="h-14 w-full rounded-lg border-2 border-primary text-center font-mono text-3xl tracking-[0.6em] outline-none focus:ring-2 focus:ring-primary"
                placeholder="••••" aria-invalid={!!pinError} aria-describedby={pinError ? "pin-err" : undefined} />
              {pinError && <p id="pin-err" role="alert" className="rounded bg-red-50 p-2 text-sm text-red-700">{pinError}</p>}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => { setPin(""); setPinError(null); }}>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-green-700 hover:bg-green-800" disabled={setStatus.isPending || (!!order.pinRequired && pin.length !== 4)}
              onClick={(e) => { e.preventDefault(); setStatus.mutate("delivered"); }}>
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
  const { data, isLoading, error, refetch } = useQuery<{ orders: DriverOrder[] }>({ queryKey: [AVAILABLE], refetchInterval: poll(5000) });
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
                  <p className="text-lg font-bold text-green-700">{kz(o.payout ?? o.deliveryFee)}</p>
                  <p className="text-[11px] text-neutral-500">{t({ pt: "ganho", en: "earning", fr: "gain" })}{o.riderPayDetail && <> · ~{o.riderPayDetail.estMinutes} min</>}</p>
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-neutral-600">
                <StatusBadge status={o.status} />
                <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{o.readyEstimateAt
                  ? t({ pt: `pronta às ${time(o.readyEstimateAt, lang)}`, en: `ready at ${time(o.readyEstimateAt, lang)}`, fr: `prête à ${time(o.readyEstimateAt, lang)}` })
                  : time(o.createdAt, lang)}</span>
                {dist !== null && <span className="inline-flex items-center gap-1"><Navigation className="h-3 w-3" />{t({ pt: `loja a ${fmtKm(dist)}`, en: `store ${fmtKm(dist)} away`, fr: `magasin à ${fmtKm(dist)}` })}</span>}
                {o.priority && <span className="rounded-full bg-primary px-2 py-0.5 font-bold text-on-brand">⚡ {t({ pt: "Prioritária", en: "Priority", fr: "Prioritaire" })}</span>}
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
