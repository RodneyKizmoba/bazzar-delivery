import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Crosshair, Flag, Loader2, MapPin, Phone, Search as SearchIcon, Share2, ShieldAlert, Star, X } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { ErrorState, Guard, Loading } from "@/components/common";
import { OrderMap, PinPicker } from "@/components/OrderMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { ApiError, post, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { dateTime, kz, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CATEGORY, RIDE_STATUS, type FareDetail, type Place, type RideCategory, type RideStatus, type Vehicle } from "@/lib/taxi";
import { PaymentPicker, firstAvailableMethod, useAddresses, useMeta } from "./_orderingKit";

/**
 * Táxi (estilo DiDi): escolher partida e destino, ver o preço de cada categoria ANTES de pedir,
 * e acompanhar o motorista no mapa. O passageiro dá o código de 4 dígitos ao entrar no carro.
 */

const CURRENT = "/api/taxi/rides/current";
const CASH_LABEL: Tr = { pt: "Numerário ao motorista", en: "Cash to the driver", fr: "Espèces au chauffeur" };

interface QuoteOption { category: RideCategory; km: number; minutes: number; fare: number; detail: FareDetail; driversNearby: number; pickupEtaMin: number | null }
interface QuoteRes { km: number; options: QuoteOption[]; waitFreeMin: number; waitPerMin: number }
interface DriverCard { name: string; firstName: string; phone: string; vehicle: Vehicle; rating: number | null; ratingCount: number }
interface RideView {
  id: number; rideNumber: string; status: RideStatus; category: RideCategory; pickup: Place; dropoff: Place;
  estKm: number; estMin: number; fare: number; fareDetail: FareDetail; waitFee: number; cancelFee: number; tip: number; total: number;
  paymentMethod: string; paymentStatus: string; pin: string | null; shareToken: string; rating: number | null; sos: boolean;
  driver: DriverCard | null; driverLocation: { latitude: number; longitude: number } | null;
  waitFreeMin: number; waitPerMin: number; sosPhone: string;
  acceptedAt: string | null; arrivedAt: string | null; startedAt: string | null; completedAt: string | null; createdAt: string;
}

export default function TaxiPage() {
  const t = useT();
  return (
    <CustomerShell>
      <TopBar title={t({ pt: "Táxi", en: "Taxi", fr: "Taxi" })} back="/" />
      <Guard roles={["customer"]}><TaxiContent /></Guard>
    </CustomerShell>
  );
}

function TaxiContent() {
  const q = useQuery<{ ride: RideView | null }>({
    queryKey: [CURRENT],
    refetchInterval: (query) => (query.state.data?.ride && query.state.data.ride.status !== "completed" ? 4000 : false), // sem eventos ao vivo para o táxi
  });
  const [dismissed, setDismissed] = useState<number | null>(() => { try { return Number(sessionStorage.getItem(DISMISS_KEY)) || null; } catch { return null; } });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const ride = q.data?.ride;
  // viagem terminada sem avaliação: pode saltar a avaliação e pedir outra
  if (ride && !(ride.status === "completed" && dismissed === ride.id)) {
    return <RideTracker ride={ride} onDismiss={() => { try { sessionStorage.setItem(DISMISS_KEY, String(ride.id)); } catch { /* sem armazenamento */ } setDismissed(ride.id); }} />;
  }
  return <RequestForm />;
}
const DISMISS_KEY = "pedeja.taxi.dismissed";

// ---------------------------------------------------------------------------
// Pedir uma viagem
// ---------------------------------------------------------------------------
type Field = "pickup" | "dropoff";

function RequestForm() {
  const t = useT();
  const { toast } = useToast();
  const meta = useMeta();
  const addresses = useAddresses();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [editing, setEditing] = useState<Field>("dropoff");
  const [category, setCategory] = useState<RideCategory>("economy");
  const [payment, setPayment] = useState<string>("");
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string | null>(null);

  // por defeito: numerário (se ligado), senão o primeiro método por banco
  useEffect(() => {
    if (payment || !meta.data) return;
    const cash = meta.data.paymentMethods?.find((m) => m.id === "cash" && m.available);
    setPayment(cash ? "cash" : firstAvailableMethod(meta.data.paymentMethods));
  }, [meta.data]);

  const myLocation = () => {
    if (!("geolocation" in navigator)) return setGeoError(t({ pt: "Este dispositivo não tem localização.", en: "This device has no location.", fr: "Pas de localisation sur cet appareil." }));
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false); setGeoError(null);
        // texto neutro: o motorista também o lê
        setPickup({ label: t({ pt: "Localização actual (GPS)", en: "Current location (GPS)", fr: "Position actuelle (GPS)" }), latitude: p.coords.latitude, longitude: p.coords.longitude });
        setEditing("dropoff");
      },
      () => { setLocating(false); setGeoError(t({ pt: "Não foi possível obter a sua localização. Escolha a partida no mapa.", en: "Couldn't get your location. Pick the start on the map.", fr: "Position introuvable. Choisissez le départ sur la carte." })); setEditing("pickup"); },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    );
  };
  useEffect(() => { myLocation(); }, []);

  const setField = (p: Place) => {
    if (editing === "pickup") { setPickup(p); if (!dropoff) setEditing("dropoff"); } else setDropoff(p);
  };

  const body = pickup && dropoff ? { pickup, dropoff, stops: [] } : null;
  const quote = useQuery<QuoteRes>({
    queryKey: ["taxi-quote", body && [pickup!.latitude, pickup!.longitude, dropoff!.latitude, dropoff!.longitude].map((n) => n.toFixed(5)).join(",")],
    queryFn: () => post<QuoteRes>("/api/taxi/quote", body),
    enabled: !!body, staleTime: 60_000, retry: false,
  });
  const chosen = quote.data?.options.find((o) => o.category === category) ?? null;

  const request = useMutation({
    mutationFn: () => post<{ ride: RideView }>("/api/taxi/rides", { pickup, dropoff, stops: [], category, paymentMethod: payment }),
    onSuccess: (d) => { queryClient.setQueryData([CURRENT], d); queryClient.invalidateQueries({ queryKey: ["/api/taxi/rides"] }); },
    onError: (e: Error) => {
      if (e instanceof ApiError && e.code === "RIDE_IN_PROGRESS") queryClient.invalidateQueries({ queryKey: [CURRENT] });
      toast({ variant: "destructive", title: t(T.error), description: e.message });
    },
  });

  const saved = (addresses.data?.addresses ?? []).filter((a) => a.latitude != null && a.longitude != null);

  return (
    <div className="space-y-4 px-4 pb-6 pt-3">
      <section aria-label={t({ pt: "Percurso", en: "Route", fr: "Trajet" })} className="space-y-2">
        <PlaceRow icon={<MapPin className="h-4 w-4 text-primary" />} label={t({ pt: "Partida", en: "Pickup", fr: "Départ" })}
          value={pickup?.label} active={editing === "pickup"} onClick={() => setEditing("pickup")}
          placeholder={t({ pt: "Onde está?", en: "Where are you?", fr: "Où êtes-vous ?" })}
          action={<Button type="button" size="sm" variant="ghost" onClick={myLocation} disabled={locating} aria-label={t({ pt: "Usar a minha localização", en: "Use my location", fr: "Utiliser ma position" })}>
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          </Button>} />
        <PlaceRow icon={<Flag className="h-4 w-4 text-green-700" />} label={t({ pt: "Destino", en: "Destination", fr: "Destination" })}
          value={dropoff?.label} active={editing === "dropoff"} onClick={() => setEditing("dropoff")}
          placeholder={t({ pt: "Para onde vai?", en: "Where to?", fr: "Où allez-vous ?" })} />
        {geoError && <p role="alert" className="rounded-lg bg-amber-50 p-2 text-xs text-amber-900">{geoError}</p>}
      </section>

      <PlaceSearch onPick={setField} field={editing} />

      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2" aria-label={t({ pt: "Moradas guardadas", en: "Saved addresses", fr: "Adresses enregistrées" })}>
          {saved.map((a) => (
            <button key={a.id} type="button" onClick={() => setField({ label: `${a.label} · ${a.street}`, latitude: a.latitude!, longitude: a.longitude!, zone: a.zone })}
              className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50">
              {a.label === "Casa" ? "🏠" : a.label === "Trabalho" ? "💼" : "📍"} {a.label}
            </button>
          ))}
        </div>
      )}

      <div>
        <p className="mb-1 text-xs text-neutral-600">
          {editing === "pickup"
            ? t({ pt: "Toque no mapa ou arraste o pino para marcar a PARTIDA.", en: "Tap the map or drag the pin to set the PICKUP.", fr: "Touchez la carte pour le DÉPART." })
            : t({ pt: "Toque no mapa ou arraste o pino para marcar o DESTINO.", en: "Tap the map or drag the pin to set the DESTINATION.", fr: "Touchez la carte pour la DESTINATION." })}
        </p>
        <PinPicker key={editing} value={editing === "pickup" ? pickup : dropoff ?? pickup} emoji={editing === "pickup" ? "📍" : "🏁"}
          onChange={(p) => setField({ ...p, label: t({ pt: "Ponto no mapa", en: "Point on map", fr: "Point sur la carte" }) + ` (${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)})` })} />
      </div>

      {body && (
        <section aria-label={t({ pt: "Escolha o tipo de viagem", en: "Choose your ride", fr: "Choisissez votre course" })} className="space-y-2">
          <h2 className="text-base font-bold">{t({ pt: "Escolha o tipo de viagem", en: "Choose your ride", fr: "Choisissez votre course" })}</h2>
          {quote.isLoading ? <Loading /> : quote.error ? <ErrorState error={quote.error} onRetry={() => quote.refetch()} /> : (
            <div role="radiogroup" className="space-y-2">
              {quote.data!.options.map((o) => {
                const c = CATEGORY[o.category];
                const on = o.category === category;
                return (
                  <button key={o.category} type="button" role="radio" aria-checked={on} onClick={() => setCategory(o.category)}
                    className={cn("flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left", on ? "border-primary bg-brand-50" : "border-neutral-200")}>
                    <span className="text-3xl" aria-hidden>{c.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold">{t(c)}</span>
                      <span className="block text-xs text-neutral-600">{t(c.sub)}</span>
                      <span className="block text-xs text-neutral-600">
                        ~{o.minutes} min · {o.km.toFixed(1).replace(".", ",")} km
                        {" · "}{o.driversNearby > 0 && o.pickupEtaMin != null
                          ? t({ pt: `motorista a ~${o.pickupEtaMin} min`, en: `driver ~${o.pickupEtaMin} min away`, fr: `chauffeur à ~${o.pickupEtaMin} min` })
                          : <span className="text-amber-800">{t({ pt: "poucos motoristas perto", en: "few drivers nearby", fr: "peu de chauffeurs" })}</span>}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className="block text-lg font-extrabold tabular-nums">{kz(o.fare)}</span>
                      {o.detail.surge > 1 && <span className="block text-[10px] font-semibold text-amber-800">{t({ pt: "procura alta", en: "high demand", fr: "forte demande" })} ×{o.detail.surge.toFixed(1)}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {chosen && <FareNote d={chosen.detail} waitFreeMin={quote.data!.waitFreeMin} waitPerMin={quote.data!.waitPerMin} />}
        </section>
      )}

      {body && chosen && (
        <section className="space-y-2">
          <h2 className="text-base font-bold">{t({ pt: "Pagamento", en: "Payment", fr: "Paiement" })}</h2>
          <PaymentPicker value={payment} onChange={setPayment} cashLabel={CASH_LABEL} />
          <Button className="h-14 w-full text-base font-bold" disabled={request.isPending || !payment} onClick={() => request.mutate()}>
            {request.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <span className="mr-2" aria-hidden>{CATEGORY[category].icon}</span>}
            {t({ pt: `Pedir ${t(CATEGORY[category])} · ${kz(chosen.fare)}`, en: `Request ${t(CATEGORY[category])} · ${kz(chosen.fare)}`, fr: `Commander ${t(CATEGORY[category])} · ${kz(chosen.fare)}` })}
          </Button>
        </section>
      )}

      <RecentRides />
    </div>
  );
}

function PlaceRow({ icon, label, value, placeholder, active, onClick, action }: {
  icon: React.ReactNode; label: string; value?: string; placeholder: string; active: boolean; onClick: () => void; action?: React.ReactNode;
}) {
  return (
    <div className={cn("flex items-center gap-2 rounded-xl border-2 bg-white pl-3", active ? "border-primary" : "border-neutral-200")}>
      {icon}
      <button type="button" onClick={onClick} aria-pressed={active} className="min-w-0 flex-1 py-2.5 text-left">
        <span className="block text-[11px] font-semibold uppercase text-neutral-500">{label}</span>
        <span className={cn("block truncate text-sm", value ? "font-medium text-neutral-900" : "text-neutral-500")}>{value || placeholder}</span>
      </button>
      {action}
    </div>
  );
}

/** Procurar um sítio pelo nome (OpenStreetMap / Nominatim, grátis; só quando o cliente carrega em Procurar). */
function PlaceSearch({ onPick, field }: { onPick: (p: Place) => void; field: Field }) {
  const t = useT();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ label: string; latitude: number; longitude: number; zone?: string }[] | null>(null);
  const [busy, setBusy] = useState(false);
  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 3) return;
    setBusy(true);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&countrycodes=ao&accept-language=pt&q=${encodeURIComponent(q.trim() + ", Luanda")}`;
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      const data = (await res.json()) as any[];
      setResults(data.map((r) => ({
        label: String(r.name || r.display_name).slice(0, 120), latitude: Number(r.lat), longitude: Number(r.lon),
        zone: r.address?.suburb || r.address?.city_district || r.address?.neighbourhood || undefined,
      })));
    } catch {
      setResults([]);
    } finally { setBusy(false); }
  };
  return (
    <div>
      <form onSubmit={search} className="flex gap-2" role="search">
        <label htmlFor="taxi-search" className="sr-only">{t({ pt: "Procurar um sítio", en: "Search a place", fr: "Rechercher un lieu" })}</label>
        <Input id="taxi-search" value={q} onChange={(e) => setQ(e.target.value)} className="h-11 rounded-xl"
          placeholder={field === "pickup" ? t({ pt: "Procurar partida (ex.: Belas Shopping)", en: "Search pickup (e.g. Belas Shopping)", fr: "Chercher le départ" }) : t({ pt: "Procurar destino (ex.: Marginal, Kilamba)", en: "Search destination (e.g. Marginal)", fr: "Chercher la destination" })} />
        <Button type="submit" variant="outline" className="h-11" disabled={busy} aria-label={t({ pt: "Procurar", en: "Search", fr: "Rechercher" })}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <SearchIcon className="h-4 w-4" />}
        </Button>
      </form>
      {results && (
        <ul className="mt-2 divide-y rounded-xl border">
          {results.length === 0 && <li className="p-3 text-sm text-neutral-600">{t({ pt: "Nada encontrado. Marque o sítio no mapa.", en: "Nothing found. Mark the spot on the map.", fr: "Rien trouvé. Marquez le lieu sur la carte." })}</li>}
          {results.map((r, i) => (
            <li key={i}>
              <button type="button" className="flex w-full items-start gap-2 p-3 text-left text-sm hover:bg-neutral-50"
                onClick={() => { onPick(r); setResults(null); setQ(""); }}>
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                <span><span className="font-medium">{r.label}</span>{r.zone && <span className="block text-xs text-neutral-500">{r.zone}</span>}</span>
              </button>
            </li>
          ))}
          <li className="p-2 text-[10px] text-neutral-500">© OpenStreetMap</li>
        </ul>
      )}
    </div>
  );
}

function FareNote({ d, waitFreeMin, waitPerMin }: { d: FareDetail; waitFreeMin: number; waitPerMin: number }) {
  const t = useT();
  const row = (label: string, v: number) => <div className="flex justify-between"><span>{label}</span><span className="tabular-nums">{kz(v)}</span></div>;
  return (
    <details className="rounded-xl bg-neutral-50 p-3 text-xs text-neutral-700">
      <summary className="cursor-pointer font-semibold">{t({ pt: "Preço fixo combinado antes da viagem — como é calculado", en: "Fixed price agreed before the trip — how it's worked out", fr: "Prix fixe convenu avant la course — calcul" })}</summary>
      <div className="mt-2 space-y-0.5">
        {row(t({ pt: `Tarifa mínima (inclui ${String(d.includedKm).replace(".", ",")} km e ${String(d.includedMin).replace(".", ",")} min)`, en: `Minimum fare (includes ${d.includedKm} km and ${d.includedMin} min)`, fr: `Tarif minimum (inclut ${d.includedKm} km et ${d.includedMin} min)` }), d.minFare)}
        {!!d.distance && row(t({ pt: `Distância (${d.perKm} Kz/km)`, en: `Distance (${d.perKm} Kz/km)`, fr: `Distance (${d.perKm} Kz/km)` }), d.distance)}
        {!!d.time && row(t({ pt: `Tempo (${d.perMin} Kz/min)`, en: `Time (${d.perMin} Kz/min)`, fr: `Temps (${d.perMin} Kz/min)` }), d.time)}
        {!!d.surgeAmount && row(t({ pt: `Tarifa dinâmica ×${d.surge.toFixed(1)}`, en: `Dynamic pricing ×${d.surge.toFixed(1)}`, fr: `Tarif dynamique ×${d.surge.toFixed(1)}` }), d.surgeAmount)}
        {!!d.pickupFee && row(t({ pt: "Taxa de recolha", en: "Pickup fee", fr: "Frais de prise en charge" }), d.pickupFee)}
        {!!d.stopFee && row(t({ pt: "Paragens adicionais", en: "Extra stops", fr: "Arrêts supplémentaires" }), d.stopFee)}
        {!!d.rounding && row(t({ pt: "Arredondamento (múltiplos de 50 Kz)", en: "Rounding (to 50 Kz)", fr: "Arrondi (50 Kz)" }), d.rounding)}
        <p className="pt-1 text-neutral-600">{t({ pt: `Espera na partida: ${waitFreeMin} min grátis, depois ${waitPerMin} Kz/min.`, en: `Waiting at pickup: ${waitFreeMin} min free, then ${waitPerMin} Kz/min.`, fr: `Attente au départ : ${waitFreeMin} min gratuites, puis ${waitPerMin} Kz/min.` })}</p>
      </div>
    </details>
  );
}

function RecentRides() {
  const t = useT();
  const { lang } = useLang();
  const q = useQuery<{ rides: { id: number; rideNumber: string; status: RideStatus; category: RideCategory; pickup: Place; dropoff: Place; total: number; createdAt: string }[] }>({ queryKey: ["/api/taxi/rides"] });
  const list = (q.data?.rides ?? []).slice(0, 5);
  if (!list.length) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-base font-bold">{t({ pt: "Últimas viagens", en: "Recent trips", fr: "Dernières courses" })}</h2>
      <ul className="divide-y rounded-xl border">
        {list.map((r) => (
          <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
            <span className="text-xl" aria-hidden>{CATEGORY[r.category].icon}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{r.dropoff.zone || r.dropoff.label}</span>
              <span className="block text-xs text-neutral-500">{dateTime(r.createdAt, lang)} · {t(RIDE_STATUS[r.status])}</span>
            </span>
            <span className="font-semibold tabular-nums">{r.status === "completed" || r.total > 0 ? kz(r.total) : "—"}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Acompanhar a viagem
// ---------------------------------------------------------------------------
function RideTracker({ ride, onDismiss }: { ride: RideView; onDismiss: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: [CURRENT] });
    queryClient.invalidateQueries({ queryKey: ["/api/taxi/rides"] });
  };
  const fail = (e: Error) => { refresh(); toast({ variant: "destructive", title: t(T.error), description: e.message }); };
  const cancel = useMutation({ mutationFn: () => post(`/api/taxi/rides/${ride.id}/cancel`, {}), onSuccess: () => { refresh(); toast({ title: t({ pt: "Viagem cancelada", en: "Trip cancelled", fr: "Course annulée" }) }); }, onError: fail });
  const retry = useMutation({ mutationFn: () => post(`/api/taxi/rides/${ride.id}/retry`), onSuccess: refresh, onError: fail });
  const [askCancel, setAskCancel] = useState(false);
  const live = ["searching", "accepted", "arrived", "in_progress"].includes(ride.status);
  const vehicleKind = ride.category === "moto" ? "moto" : "car";

  return (
    <div className="space-y-4 px-4 pb-6 pt-3">
      <div className="rounded-2xl bg-brand-50 p-4" aria-live="polite">
        <p className="text-xs font-semibold uppercase text-brand-800">{CATEGORY[ride.category].icon} {t(CATEGORY[ride.category])} · {ride.rideNumber}</p>
        <h2 className="mt-1 text-2xl font-extrabold text-neutral-900">{t(RIDE_STATUS[ride.status])}</h2>
        {ride.status === "searching" && (
          <p className="mt-1 flex items-center gap-2 text-sm text-neutral-700"><Loader2 className="h-4 w-4 animate-spin" />
            {t({ pt: "Estamos a pedir ao motorista mais perto…", en: "Asking the nearest driver…", fr: "Nous contactons le chauffeur le plus proche…" })}</p>
        )}
        {ride.status === "arrived" && (
          <p className="mt-1 text-sm text-neutral-700">{t({ pt: `Vá ter com o motorista. Os primeiros ${ride.waitFreeMin} min de espera são grátis; depois ${ride.waitPerMin} Kz/min.`, en: `Go meet your driver. The first ${ride.waitFreeMin} min of waiting are free; then ${ride.waitPerMin} Kz/min.`, fr: `Rejoignez le chauffeur. ${ride.waitFreeMin} min d'attente gratuites, puis ${ride.waitPerMin} Kz/min.` })}</p>
        )}
        {ride.status === "no_driver" && (
          <p className="mt-1 text-sm text-neutral-700">{t({ pt: "Neste momento não há motoristas livres perto de si. Tente de novo dentro de alguns minutos.", en: "No free drivers near you right now. Try again in a few minutes.", fr: "Aucun chauffeur libre près de vous. Réessayez dans quelques minutes." })}</p>
        )}
      </div>

      <OrderMap store={ride.pickup} destination={ride.dropoff} driver={live ? ride.driverLocation : null} ride={vehicleKind}
        lineTo={ride.status === "accepted" ? "store" : "destination"}
        labels={{ store: t({ pt: "Partida", en: "Pickup", fr: "Départ" }), destination: t({ pt: "Destino", en: "Destination", fr: "Destination" }), driver: ride.driver?.firstName }} />

      <div className="space-y-1 text-sm">
        <p className="flex items-start gap-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{ride.pickup.label}</p>
        <p className="flex items-start gap-2"><Flag className="mt-0.5 h-4 w-4 shrink-0 text-green-700" />{ride.dropoff.label}</p>
      </div>

      {ride.pin && ride.driver && (
        <div className="rounded-2xl border-2 border-primary p-4 text-center">
          <p className="text-sm font-semibold text-neutral-700">{t({ pt: "Diga este código ao motorista quando entrar", en: "Tell your driver this code when you get in", fr: "Donnez ce code au chauffeur en montant" })}</p>
          <p className="mt-1 text-4xl font-extrabold tracking-[0.3em] text-neutral-900" aria-label={ride.pin.split("").join(" ")}>{ride.pin}</p>
          <p className="mt-1 text-xs text-neutral-500">{t({ pt: "Confirme também a matrícula antes de entrar.", en: "Check the number plate before getting in.", fr: "Vérifiez aussi la plaque avant de monter." })}</p>
        </div>
      )}

      {ride.driver && live && <DriverInfo d={ride.driver} />}

      <div className="flex items-center justify-between rounded-xl border p-3 text-sm">
        <span>{t(PAYMENT[ride.paymentMethod] && ride.paymentMethod !== "cash" ? PAYMENT[ride.paymentMethod] : CASH_LABEL)}</span>
        <span className="text-lg font-extrabold tabular-nums">{kz(ride.status === "completed" ? ride.total : ride.fare + ride.waitFee)}</span>
      </div>

      {live && ride.status !== "searching" && <SafetyBar ride={ride} />}

      {ride.status === "no_driver" && (
        <Button className="h-12 w-full" onClick={() => retry.mutate()} disabled={retry.isPending}>{t({ pt: "Procurar de novo", en: "Search again", fr: "Rechercher à nouveau" })}</Button>
      )}
      {["searching", "accepted", "arrived", "no_driver"].includes(ride.status) && (
        <Button variant="outline" className="h-12 w-full text-red-700" onClick={() => setAskCancel(true)} disabled={cancel.isPending}>
          <X className="mr-1 h-4 w-4" />{t({ pt: "Cancelar viagem", en: "Cancel trip", fr: "Annuler la course" })}
        </Button>
      )}
      <AlertDialog open={askCancel} onOpenChange={setAskCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Cancelar esta viagem?", en: "Cancel this trip?", fr: "Annuler cette course ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{ride.driver
              ? t({ pt: "O motorista já vem a caminho.", en: "Your driver is already on the way.", fr: "Le chauffeur est déjà en route." })
              : t({ pt: "Ainda não há motorista: é grátis.", en: "No driver yet: it's free.", fr: "Pas encore de chauffeur : c'est gratuit." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Manter", en: "Keep", fr: "Garder" })}</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancel.mutate()}>{t({ pt: "Cancelar viagem", en: "Cancel trip", fr: "Annuler" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {ride.status === "completed" && <TripDone ride={ride} onDismiss={onDismiss} />}
    </div>
  );
}

function DriverInfo({ d }: { d: DriverCard }) {
  const t = useT();
  return (
    <div className="flex items-center gap-3 rounded-xl border p-3">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-neutral-100 text-2xl" aria-hidden>{d.vehicle.category === "moto" ? "🏍️" : "🚕"}</div>
      <div className="min-w-0 flex-1">
        <p className="font-bold">{d.name} {d.rating != null && <span className="ml-1 inline-flex items-center gap-0.5 text-xs font-semibold text-neutral-700"><Star className="h-3 w-3 fill-amber-400 text-amber-400" />{d.rating.toFixed(1)}</span>}</p>
        <p className="text-sm text-neutral-700">{d.vehicle.make} {d.vehicle.model} · {d.vehicle.colour}</p>
        <p className="mt-0.5 inline-block rounded border-2 border-neutral-900 bg-white px-2 font-mono text-sm font-bold tracking-wider">{d.vehicle.plate}</p>
      </div>
      <a href={`tel:${d.phone.replace(/\s/g, "")}`} className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-on-brand" aria-label={t({ pt: `Ligar a ${d.firstName}`, en: `Call ${d.firstName}`, fr: `Appeler ${d.firstName}` })}>
        <Phone className="h-5 w-5" />
      </a>
    </div>
  );
}

/** Partilhar a viagem e SOS (como na DiDi). */
function SafetyBar({ ride }: { ride: RideView }) {
  const t = useT();
  const { toast } = useToast();
  const [ask, setAsk] = useState(false);
  const share = async () => {
    const url = `${window.location.origin}/viagem/${ride.shareToken}`;
    const text = t({ pt: "Acompanhe a minha viagem PedeJá", en: "Follow my PedeJá trip", fr: "Suivez ma course PedeJá" });
    try {
      if (navigator.share) await navigator.share({ title: "PedeJá", text, url });
      else { await navigator.clipboard.writeText(url); toast({ title: t({ pt: "Link copiado", en: "Link copied", fr: "Lien copié" }), description: url }); }
    } catch { /* cancelado pelo utilizador */ }
  };
  const sos = useMutation({
    mutationFn: () => post<{ sosPhone: string }>(`/api/taxi/rides/${ride.id}/sos`),
    onSettled: (d) => { window.location.href = `tel:${d?.sosPhone ?? ride.sosPhone}`; },
  });
  return (
    <div className="grid grid-cols-2 gap-2">
      <Button variant="outline" className="h-12" onClick={share}><Share2 className="mr-1 h-4 w-4" />{t({ pt: "Partilhar viagem", en: "Share trip", fr: "Partager" })}</Button>
      <Button variant="outline" className="h-12 border-red-300 font-bold text-red-700" onClick={() => setAsk(true)}><ShieldAlert className="mr-1 h-4 w-4" />SOS</Button>
      <AlertDialog open={ask} onOpenChange={setAsk}>
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
    </div>
  );
}

function TripDone({ ride, onDismiss }: { ride: RideView; onDismiss: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [stars, setStars] = useState(0);
  const rate = useMutation({
    mutationFn: () => post(`/api/taxi/rides/${ride.id}/rate`, { rating: stars }),
    onSuccess: () => { toast({ title: t({ pt: "Obrigado pela avaliação!", en: "Thanks for rating!", fr: "Merci pour votre avis !" }) }); queryClient.invalidateQueries({ queryKey: [CURRENT] }); queryClient.invalidateQueries({ queryKey: ["/api/taxi/rides"] }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const labels = useMemo(() => [1, 2, 3, 4, 5].map((n) => t({ pt: `${n} estrela${n > 1 ? "s" : ""}`, en: `${n} star${n > 1 ? "s" : ""}`, fr: `${n} étoile${n > 1 ? "s" : ""}` })), [t]);
  return (
    <section className="space-y-3 rounded-2xl border p-4">
      <div className="space-y-0.5 text-sm">
        <div className="flex justify-between"><span>{t({ pt: "Viagem (preço combinado)", en: "Trip (agreed price)", fr: "Course (prix convenu)" })}</span><span className="tabular-nums">{kz(ride.fare)}</span></div>
        {!!ride.waitFee && <div className="flex justify-between"><span>{t({ pt: "Espera na partida", en: "Waiting at pickup", fr: "Attente au départ" })}</span><span className="tabular-nums">{kz(ride.waitFee)}</span></div>}
        <div className="flex justify-between border-t pt-1 font-bold"><span>{t({ pt: "Total", en: "Total", fr: "Total" })}</span><span className="tabular-nums">{kz(ride.total)}</span></div>
      </div>
      {!ride.rating && (
        <div className="space-y-2">
          <p className="font-semibold">{t({ pt: `Como foi a viagem com ${ride.driver?.firstName ?? "o motorista"}?`, en: `How was your trip with ${ride.driver?.firstName ?? "your driver"}?`, fr: `Comment était la course avec ${ride.driver?.firstName ?? "le chauffeur"} ?` })}</p>
          <div className="flex gap-1" role="radiogroup" aria-label={t({ pt: "Avaliação", en: "Rating", fr: "Note" })}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={stars === n} aria-label={labels[n - 1]} onClick={() => setStars(n)} className="p-1">
                <Star className={cn("h-8 w-8", n <= stars ? "fill-amber-400 text-amber-400" : "text-neutral-300")} />
              </button>
            ))}
          </div>
          <Button className="w-full" disabled={!stars || rate.isPending} onClick={() => rate.mutate()}>{t({ pt: "Enviar avaliação", en: "Send rating", fr: "Envoyer" })}</Button>
        </div>
      )}
      <Button variant="ghost" className="w-full" onClick={onDismiss}>{t({ pt: "Pedir outra viagem", en: "Book another trip", fr: "Nouvelle course" })}</Button>
    </section>
  );
}
