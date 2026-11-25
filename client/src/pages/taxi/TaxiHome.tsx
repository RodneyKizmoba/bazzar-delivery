import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Banknote, Flag, MapPin, Navigation, Phone, ShieldAlert } from "lucide-react";
import { useBeep } from "@/hooks/useBeep";
import { EmptyState, ErrorState, Guard, Loading } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { OrderMap } from "@/components/OrderMap";
import { ChangePassword } from "@/components/ChangePassword";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY, RIDE_STATUS, directionsUrl, fmtKm, km, type Place, type RideCategory, type RideStatus, type Vehicle } from "@/lib/taxi";
import { Wallet } from "@/pages/driver/DriverHistory";

/**
 * App do motorista de táxi (estilo DiDi): ligar/desligar, receber um pedido de cada vez (aceitar ou recusar
 * a tempo), ir buscar o passageiro, começar a viagem com o código dele e terminar. Ganhos na carteira.
 */

export function useTaxiTabs() {
  const t = useT();
  return [
    { href: "/taxista", label: t({ pt: "Viagens", en: "Trips", fr: "Courses" }) },
    { href: "/taxista/carteira", label: t({ pt: "Ganhos e carteira", en: "Earnings & wallet", fr: "Gains et portefeuille" }) },
  ];
}

export default function TaxiHome() {
  const t = useT();
  return (
    <Guard roles={["taxi"]}>
      <PanelShell title={t({ pt: "App motorista", en: "Driver app", fr: "Appli chauffeur" })} tabs={useTaxiTabs()}>
        <div className="mx-auto max-w-xl"><TaxiContent /></div>
      </PanelShell>
    </Guard>
  );
}

export function TaxiWalletPage() {
  const t = useT();
  return (
    <Guard roles={["taxi"]}>
      <PanelShell title={t({ pt: "App motorista", en: "Driver app", fr: "Appli chauffeur" })} tabs={useTaxiTabs()}>
        <div className="mx-auto max-w-xl space-y-4"><Earnings /><Wallet base="/api/taxi/driver" taxi /><MyVehicle /><ChangePassword /></div>
      </PanelShell>
    </Guard>
  );
}

interface DriverRide {
  id: number; rideNumber: string; status: RideStatus; category: RideCategory; pickup: Place; dropoff: Place; stops: Place[];
  estKm: number; estMin: number; fare: number; waitFee: number; tip: number; total: number; paymentMethod: string;
  collectCash: number; earning: number; commissionPct: number;
  customer: { name?: string; firstName: string; phone?: string }; pinAttemptsLeft: number;
  waitFreeMin: number; waitPerMin: number; sosPhone: string;
  acceptedAt: string | null; arrivedAt: string | null; startedAt: string | null; completedAt: string | null;
}
interface Offer { id: number; expiresAt: string; offerSeconds: number; pickupKm: number | null; ride: DriverRide }

const PRESENCE = "/api/taxi/driver/presence";
const OFFERS = "/api/taxi/driver/offers";
const CURRENT = "/api/taxi/driver/current";

function TaxiContent() {
  const t = useT();
  const { toast } = useToast();
  const [myPos, setMyPos] = useState<{ latitude: number; longitude: number } | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const lastSent = useRef(0);
  const presence = useQuery<{ presence: { isOnline: boolean } }>({ queryKey: [PRESENCE] });
  const online = !!presence.data?.presence.isOnline;
  const current = useQuery<{ ride: DriverRide | null }>({ queryKey: [CURRENT], refetchInterval: 5000 });
  const ride = current.data?.ride ?? null;
  const busyRef = useRef(!!ride);
  busyRef.current = !!ride;

  const geoMsg = t({ pt: "Não foi possível obter a localização. Active o GPS e a permissão do navegador.", en: "Couldn't get your location. Turn on GPS and browser permission.", fr: "Position introuvable. Activez le GPS et l'autorisation." });
  const toggle = useMutation({
    mutationFn: async (on: boolean) => {
      let pos: { latitude: number; longitude: number } | null = null;
      if (on && "geolocation" in navigator) {
        pos = await new Promise((resolve) => navigator.geolocation.getCurrentPosition(
          (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
          () => { setGeoError(geoMsg); resolve(null); },
          { enableHighAccuracy: true, timeout: 15_000, maximumAge: 10_000 },
        ));
        if (pos) setMyPos(pos);
      }
      return post(PRESENCE, { online: on, ...(pos ?? {}) });
    },
    onSuccess: (_d, on) => {
      queryClient.invalidateQueries({ queryKey: [PRESENCE] });
      queryClient.invalidateQueries({ queryKey: [OFFERS] });
      toast({ title: on ? t({ pt: "Está online — vai receber pedidos de viagem", en: "You're online — trip requests will come to you", fr: "En ligne — vous recevrez des courses" }) : t({ pt: "Está offline", en: "You're offline", fr: "Hors ligne" }) });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });

  // GPS: a cada 5 s numa viagem (o passageiro vê-o no mapa), a cada 15 s à espera de pedidos
  const tracking = online || !!ride;
  useEffect(() => {
    if (!tracking || !("geolocation" in navigator)) return;
    const id = navigator.geolocation.watchPosition((p) => {
      const pos = { latitude: p.coords.latitude, longitude: p.coords.longitude };
      setMyPos(pos); setGeoError(null);
      const now = Date.now();
      if (now - lastSent.current >= (busyRef.current ? 5_000 : 15_000)) {
        lastSent.current = now;
        post("/api/taxi/driver/location", pos).catch(() => {});
      }
    }, () => setGeoError(geoMsg), { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [tracking]);

  return (
    <div className="space-y-4">
      <div className={cn("rounded-xl border p-3", online ? "border-primary bg-brand-50" : "bg-white")}>
        <div className="flex items-center justify-between gap-3">
          <div>
            <Label htmlFor="taxi-online" className="text-base font-bold">{online ? t({ pt: "Online", en: "Online", fr: "En ligne" }) : t({ pt: "Offline", en: "Offline", fr: "Hors ligne" })}</Label>
            <p className="text-xs text-neutral-600">{online
              ? t({ pt: "Recebe pedidos de passageiros perto de si.", en: "You get trip requests near you.", fr: "Vous recevez des courses proches." })
              : t({ pt: "Ligue para começar a receber viagens.", en: "Switch on to start getting trips.", fr: "Activez pour recevoir des courses." })}</p>
          </div>
          <Switch id="taxi-online" checked={online} disabled={toggle.isPending || presence.isLoading} onCheckedChange={(v) => toggle.mutate(v)} />
        </div>
        {tracking && <p className="mt-2 flex items-center gap-1 text-xs text-neutral-600"><Navigation className="h-3 w-3" />{myPos ? `GPS: ${myPos.latitude.toFixed(4)}, ${myPos.longitude.toFixed(4)}` : t({ pt: "A procurar sinal GPS…", en: "Looking for GPS…", fr: "Recherche GPS…" })}</p>}
        {geoError && <p role="alert" className="mt-2 rounded bg-red-50 p-2 text-sm text-red-700">{geoError}</p>}
      </div>

      {current.isLoading ? <Loading /> : current.error ? <ErrorState error={current.error} onRetry={() => current.refetch()} />
        : ride ? <CurrentRide ride={ride} myPos={myPos} />
        : online ? <OfferCard myPos={myPos} />
        : <EmptyState icon="🚕" title={t({ pt: "Sem viagem em curso", en: "No trip in progress", fr: "Aucune course" })} text={t({ pt: "Fique online para receber pedidos.", en: "Go online to get requests.", fr: "Passez en ligne pour recevoir des courses." })} />}
    </div>
  );
}

function OfferCard({ myPos }: { myPos: { latitude: number; longitude: number } | null }) {
  const t = useT();
  const { toast } = useToast();
  const beep = useBeep();
  const { data } = useQuery<{ offer: Offer | null }>({ queryKey: [OFFERS], refetchInterval: 3000 }); // sem eventos ao vivo para o táxi: verifica a cada 3 s
  const offer = data?.offer ?? null;
  const [left, setLeft] = useState(0);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    if (!offer) return;
    if (seen.current !== offer.id) {
      seen.current = offer.id;
      beep();
      try { navigator.vibrate?.([300, 100, 300, 100, 300]); } catch { /* sem vibração */ }
    }
    const end = new Date(offer.expiresAt).getTime();
    const tick = () => { const s = Math.max(0, Math.round((end - Date.now()) / 1000)); setLeft(s); if (s === 0) queryClient.invalidateQueries({ queryKey: [OFFERS] }); };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [offer?.id]);
  const done = () => { queryClient.invalidateQueries({ queryKey: [OFFERS] }); queryClient.invalidateQueries({ queryKey: [CURRENT] }); };
  const accept = useMutation({
    mutationFn: (id: number) => post(`/api/taxi/driver/offers/${id}/accept`),
    onSuccess: () => { done(); toast({ title: t({ pt: "Viagem aceite — vá buscar o passageiro", en: "Trip accepted — go pick up your passenger", fr: "Course acceptée — allez chercher le passager" }) }); },
    onError: (e: Error) => { done(); toast({ variant: "destructive", title: t(T.error), description: e.message }); },
  });
  const decline = useMutation({ mutationFn: (id: number) => post(`/api/taxi/driver/offers/${id}/decline`), onSettled: done });

  if (!offer || left <= 0) {
    return <EmptyState icon="📡" title={t({ pt: "À espera de pedidos…", en: "Waiting for requests…", fr: "En attente de courses…" })} text={t({ pt: "Os pedidos vão primeiro para o motorista mais perto.", en: "Requests go to the nearest driver first.", fr: "Les courses vont d'abord au chauffeur le plus proche." })} />;
  }
  const r = offer.ride;
  const toPickup = myPos ? km(myPos, r.pickup) : offer.pickupKm;
  return (
    <section aria-live="assertive" className="overflow-hidden rounded-2xl border-2 border-primary bg-white shadow-lg">
      <div className="h-1.5 bg-neutral-100"><div className="h-full bg-primary transition-all" style={{ width: `${Math.min(100, (left / offer.offerSeconds) * 100)}%` }} /></div>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-xs font-semibold uppercase text-primary">{CATEGORY[r.category].icon} {t({ pt: "Novo pedido de viagem", en: "New trip request", fr: "Nouvelle course" })}</p>
            <p className="text-3xl font-extrabold">{kz(r.earning)}</p>
            <p className="text-xs text-neutral-600">{t({ pt: `ganho seu · passageiro paga ${kz(r.fare)} (comissão ${r.commissionPct}%)`, en: `your earning · passenger pays ${kz(r.fare)} (${r.commissionPct}% commission)`, fr: `votre gain · le passager paie ${kz(r.fare)} (commission ${r.commissionPct} %)` })}</p>
          </div>
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-brand-100 text-xl font-extrabold text-brand-900" aria-label={`${left} s`}>{left}</div>
        </div>
        <div className="space-y-1 text-sm">
          <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span><b>{r.pickup.zone || r.pickup.label}</b>{toPickup != null && <span className="text-neutral-600"> · {fmtKm(toPickup)} {t({ pt: "até à recolha", en: "to pickup", fr: "jusqu'au départ" })}</span>}</span></p>
          <p className="flex items-start gap-1.5"><Flag className="mt-0.5 h-4 w-4 shrink-0 text-green-700" /><span><b>{r.dropoff.zone || r.dropoff.label}</b><span className="text-neutral-600"> · {fmtKm(r.estKm)} · ~{r.estMin} min</span></span></p>
          {r.collectCash > 0 && <p className="flex items-center gap-1.5 font-semibold text-brand-800"><Banknote className="h-4 w-4" />{t({ pt: "Numerário", en: "Cash", fr: "Espèces" })}: {kz(r.collectCash)}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" className="h-12 flex-1" disabled={accept.isPending || decline.isPending} onClick={() => decline.mutate(offer.id)}>{t({ pt: "Recusar", en: "Decline", fr: "Refuser" })}</Button>
          <Button className="h-12 flex-[2] text-base font-bold" disabled={accept.isPending || decline.isPending} onClick={() => accept.mutate(offer.id)}>{t({ pt: "Aceitar viagem", en: "Accept trip", fr: "Accepter" })}</Button>
        </div>
      </div>
    </section>
  );
}

function WaitMeter({ since, freeMin, perMin }: { since: string; freeMin: number; perMin: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const min = (now - new Date(since).getTime()) / 60_000;
  const mm = Math.floor(min), ss = Math.floor((min - mm) * 60);
  const paid = Math.max(0, min - freeMin);
  return (
    <p className="rounded-lg bg-brand-50 p-2 text-xs text-brand-900">
      ⏱ {t({ pt: `À espera há ${mm}:${String(ss).padStart(2, "0")}`, en: `Waiting ${mm}:${String(ss).padStart(2, "0")}`, fr: `Attente ${mm}:${String(ss).padStart(2, "0")}` })}
      {" · "}{paid > 0 ? <b>{t({ pt: `espera paga: ~${kz(Math.round((paid * perMin) / 10) * 10)}`, en: `paid wait: ~${kz(Math.round((paid * perMin) / 10) * 10)}`, fr: `attente payée : ~${kz(Math.round((paid * perMin) / 10) * 10)}` })}</b>
        : t({ pt: `grátis até aos ${freeMin} min, depois ${perMin} Kz/min`, en: `free for ${freeMin} min, then ${perMin} Kz/min`, fr: `gratuit ${freeMin} min, puis ${perMin} Kz/min` })}
    </p>
  );
}

function CurrentRide({ ride, myPos }: { ride: DriverRide; myPos: { latitude: number; longitude: number } | null }) {
  const t = useT();
  const { toast } = useToast();
  const [pin, setPin] = useState("");
  const [pinErr, setPinErr] = useState<string | null>(null);
  const [askCancel, setAskCancel] = useState(false);
  const [askSos, setAskSos] = useState(false);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: [CURRENT] }); queryClient.invalidateQueries({ queryKey: ["/api/taxi/driver/history"] }); queryClient.invalidateQueries({ queryKey: ["/api/taxi/driver/wallet"] }); };
  const act = (path: string, body?: unknown) => post(`/api/taxi/driver/rides/${ride.id}/${path}`, body ?? {});
  const fail = (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message });
  const arrived = useMutation({ mutationFn: () => act("arrived"), onSuccess: refresh, onError: fail });
  const start = useMutation({ mutationFn: () => act("start", { pin }), onSuccess: () => { setPin(""); refresh(); }, onError: (e: Error) => setPinErr(e.message) });
  const complete = useMutation({
    mutationFn: () => act("complete"),
    onSuccess: (d: any) => {
      const r = d.ride as DriverRide;
      toast({ title: t({ pt: "Viagem concluída", en: "Trip completed", fr: "Course terminée" }), description: r.collectCash ? t({ pt: `Receba ${kz(r.collectCash)} em numerário.`, en: `Collect ${kz(r.collectCash)} in cash.`, fr: `Encaissez ${kz(r.collectCash)} en espèces.` }) : t({ pt: `Ganhou ${kz(r.earning)}.`, en: `You earned ${kz(r.earning)}.`, fr: `Vous avez gagné ${kz(r.earning)}.` }) });
      refresh();
    },
    onError: fail,
  });
  const cancel = useMutation({ mutationFn: () => act("cancel"), onSuccess: refresh, onError: fail });
  const sos = useMutation({ mutationFn: () => act("sos"), onSettled: () => { window.location.href = `tel:${ride.sosPhone}`; } });

  const target = ride.status === "in_progress" ? ride.dropoff : ride.pickup;
  return (
    <section className="space-y-3 rounded-2xl border bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase text-primary">{CATEGORY[ride.category].icon} {ride.rideNumber}</p>
          <h2 className="text-xl font-extrabold">{ride.status === "accepted" ? t({ pt: "Vá buscar o passageiro", en: "Go pick up your passenger", fr: "Allez chercher le passager" }) : t(RIDE_STATUS[ride.status])}</h2>
        </div>
        <p className="text-right"><span className="block text-2xl font-extrabold">{kz(ride.earning)}</span><span className="text-xs text-neutral-600">{t({ pt: "ganho seu", en: "your earning", fr: "votre gain" })}</span></p>
      </div>

      <OrderMap store={ride.pickup} destination={ride.dropoff} driver={myPos} ride={ride.category === "moto" ? "moto" : "car"}
        lineTo={ride.status === "in_progress" ? "destination" : "store"}
        labels={{ store: t({ pt: "Recolha", en: "Pickup", fr: "Départ" }), destination: t({ pt: "Destino", en: "Destination", fr: "Destination" }) }} />

      <div className="space-y-1 text-sm">
        <p className="flex items-start gap-1.5"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{ride.pickup.label}</p>
        <p className="flex items-start gap-1.5"><Flag className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />{ride.dropoff.label} · {fmtKm(ride.estKm)}</p>
      </div>

      <div className="flex items-center justify-between gap-2 rounded-xl bg-neutral-50 p-3">
        <div><p className="font-bold">{ride.customer.name || ride.customer.firstName}</p>
          {ride.collectCash > 0 && <p className="text-sm font-semibold text-brand-800">💵 {t({ pt: `Receber em numerário: ${kz(ride.collectCash)}`, en: `Collect in cash: ${kz(ride.collectCash)}`, fr: `À encaisser : ${kz(ride.collectCash)}` })}</p>}
          {ride.collectCash === 0 && <p className="text-xs text-neutral-600">{t({ pt: "Pago pela app — não receba dinheiro.", en: "Paid in the app — don't take cash.", fr: "Payé dans l'app — pas d'espèces." })}</p>}
        </div>
        {ride.customer.phone && <a href={`tel:${ride.customer.phone.replace(/\s/g, "")}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-brand" aria-label={t({ pt: "Ligar ao passageiro", en: "Call passenger", fr: "Appeler le passager" })}><Phone className="h-5 w-5" /></a>}
      </div>

      <a href={directionsUrl(target)} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold">
        <Navigation className="h-4 w-4" />{ride.status === "in_progress" ? t({ pt: "Navegar até ao destino", en: "Navigate to destination", fr: "Naviguer vers la destination" }) : t({ pt: "Navegar até à recolha", en: "Navigate to pickup", fr: "Naviguer vers le départ" })}
      </a>

      {ride.status === "accepted" && <Button className="h-12 w-full text-base font-bold" disabled={arrived.isPending} onClick={() => arrived.mutate()}>{t({ pt: "Cheguei à recolha", en: "I've arrived", fr: "Je suis arrivé" })}</Button>}

      {ride.status === "arrived" && (
        <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); setPinErr(null); start.mutate(); }}>
          {ride.arrivedAt && <WaitMeter since={ride.arrivedAt} freeMin={ride.waitFreeMin} perMin={ride.waitPerMin} />}
          <Label htmlFor="ride-pin">{t({ pt: "Código do passageiro (4 dígitos)", en: "Passenger's code (4 digits)", fr: "Code du passager (4 chiffres)" })}</Label>
          <div className="flex gap-2">
            <Input id="ride-pin" inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, "")); setPinErr(null); }}
              className="h-12 text-center text-2xl font-bold tracking-[0.4em]" aria-invalid={!!pinErr} aria-describedby={pinErr ? "ride-pin-err" : undefined} />
            <Button type="submit" className="h-12 px-5 font-bold" disabled={pin.length !== 4 || start.isPending}>{t({ pt: "Iniciar viagem", en: "Start trip", fr: "Démarrer" })}</Button>
          </div>
          {pinErr && <p id="ride-pin-err" role="alert" className="text-sm text-red-700">{pinErr}</p>}
          <p className="text-xs text-neutral-500">{t({ pt: "Peça o código ao passageiro: confirma que leva a pessoa certa.", en: "Ask the passenger for the code: it confirms you have the right person.", fr: "Demandez le code au passager : il confirme la bonne personne." })}</p>
        </form>
      )}

      {ride.status === "in_progress" && <Button className="h-12 w-full text-base font-bold" disabled={complete.isPending} onClick={() => complete.mutate()}>{t({ pt: "Terminar viagem", en: "End trip", fr: "Terminer la course" })}</Button>}

      <div className="grid grid-cols-2 gap-2">
        {(ride.status === "accepted" || ride.status === "arrived") && (
          <Button variant="outline" className="text-red-700" onClick={() => setAskCancel(true)}>{t({ pt: "Desistir", en: "Cancel", fr: "Annuler" })}</Button>
        )}
        <Button variant="outline" className={cn("border-red-300 font-bold text-red-700", ride.status === "in_progress" && "col-span-2")} onClick={() => setAskSos(true)}><ShieldAlert className="mr-1 h-4 w-4" />SOS</Button>
      </div>

      <AlertDialog open={askCancel} onOpenChange={setAskCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Desistir desta viagem?", en: "Drop this trip?", fr: "Abandonner cette course ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{t({ pt: "O pedido passa a outro motorista. Desistir muitas vezes baixa a sua prioridade.", en: "The request goes to another driver. Dropping trips often lowers your priority.", fr: "La course passe à un autre chauffeur." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Continuar viagem", en: "Keep trip", fr: "Garder" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancel.mutate()}>{t({ pt: "Desistir", en: "Drop", fr: "Abandonner" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={askSos} onOpenChange={setAskSos}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Pedir ajuda?", en: "Get help?", fr: "Demander de l'aide ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{t({ pt: `Vamos avisar a equipa PedeJá e ligar para a polícia (${ride.sosPhone}).`, en: `We'll alert the PedeJá team and call the police (${ride.sosPhone}).`, fr: `Nous alertons l'équipe PedeJá et appelons la police (${ride.sosPhone}).` })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Voltar", en: "Back", fr: "Retour" })}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => sos.mutate()}>{t({ pt: `Ligar ${ride.sosPhone}`, en: `Call ${ride.sosPhone}`, fr: `Appeler ${ride.sosPhone}` })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

interface History {
  today: { rides: number; total: number }; last7Days: { rides: number; total: number }; last30Days: { rides: number; total: number };
  rides: { id: number; rideNumber: string; status: RideStatus; pickup: Place; dropoff: Place; total: number; earning: number | null; paymentMethod: string; rating: number | null; completedAt: string | null; cancelledAt: string | null }[];
}

function Earnings() {
  const t = useT();
  const { lang } = useLang();
  const q = useQuery<History>({ queryKey: ["/api/taxi/driver/history"], refetchInterval: 60_000 });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const h = q.data!;
  const box = (label: string, s: { rides: number; total: number }) => (
    <div className="rounded-lg bg-neutral-50 p-2 text-center"><p className="text-xs text-neutral-600">{label}</p><p className="text-lg font-extrabold tabular-nums">{kz(s.total)}</p><p className="text-[11px] text-neutral-500">{s.rides} {s.rides === 1 ? t({ pt: "viagem", en: "trip", fr: "course" }) : t({ pt: "viagens", en: "trips", fr: "courses" })}</p></div>
  );
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">{t({ pt: "Ganhos", en: "Earnings", fr: "Gains" })}</h2>
      <div className="grid grid-cols-3 gap-2">
        {box(t({ pt: "Hoje", en: "Today", fr: "Aujourd'hui" }), h.today)}
        {box(t({ pt: "7 dias", en: "7 days", fr: "7 jours" }), h.last7Days)}
        {box(t({ pt: "30 dias", en: "30 days", fr: "30 jours" }), h.last30Days)}
      </div>
      {h.rides.length > 0 && (
        <ul className="divide-y text-sm">
          {h.rides.slice(0, 20).map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0"><span className="block truncate font-medium">{r.pickup.zone || r.pickup.label} → {r.dropoff.zone || r.dropoff.label}</span>
                <span className="text-xs text-neutral-500">{dateTime(r.completedAt ?? r.cancelledAt, lang)} · {t(RIDE_STATUS[r.status])}{r.rating ? ` · ${"★".repeat(r.rating)}` : ""}</span></span>
              <span className="shrink-0 font-semibold tabular-nums">{r.earning != null ? kz(r.earning) : "—"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function MyVehicle() {
  const t = useT();
  const q = useQuery<{ vehicle: (Vehicle & { year: number | null; licenceNumber: string; ratingAvg: number; ratingCount: number }) | null; commissionPct: number }>({ queryKey: ["/api/taxi/driver/me"] });
  const v = q.data?.vehicle;
  if (!v) return null;
  return (
    <section className="space-y-1 rounded-xl border bg-white p-4 text-sm">
      <h2 className="text-lg font-bold">{t({ pt: "A minha viatura", en: "My vehicle", fr: "Mon véhicule" })}</h2>
      <p>{CATEGORY[v.category].icon} {t(CATEGORY[v.category])} · {v.make} {v.model}{v.year ? ` (${v.year})` : ""} · {v.colour}</p>
      <p>{t({ pt: "Matrícula", en: "Plate", fr: "Plaque" })}: <b className="font-mono">{v.plate}</b> · {t({ pt: "Carta", en: "Licence", fr: "Permis" })}: {v.licenceNumber}</p>
      <p>{t({ pt: "Avaliação", en: "Rating", fr: "Note" })}: {v.ratingCount ? `★ ${v.ratingAvg.toFixed(1)} (${v.ratingCount})` : "—"} · {t({ pt: `Comissão PedeJá: ${q.data!.commissionPct}%`, en: `PedeJá commission: ${q.data!.commissionPct}%`, fr: `Commission PedeJá : ${q.data!.commissionPct} %` })}</p>
      <p className="text-xs text-neutral-500">{t({ pt: "Para mudar de viatura fale com a equipa PedeJá (os documentos têm de ser verificados).", en: "To change vehicle, contact the PedeJá team (documents must be checked).", fr: "Pour changer de véhicule, contactez l'équipe PedeJá." })}</p>
    </section>
  );
}
