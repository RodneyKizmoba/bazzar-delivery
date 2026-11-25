import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Crosshair, Flag, Loader2, MapPin, Package } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { ErrorState, Guard, Loading } from "@/components/common";
import { PinPicker } from "@/components/OrderMap";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { post, queryClient } from "@/lib/api";
import { useT, T, type Tr } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Place } from "@/lib/taxi";
import { PlaceRow, PlaceSearch, type Field } from "./Taxi";
import { PaymentPicker, firstAvailableMethod, useAddresses, useMeta } from "./_orderingKit";

/**
 * Envios: mandar um pacote de A (quem envia) para B (quem recebe). O preço é a taxa de entrega
 * por distância + um extra por tamanho. Quem recebe dá o código ao estafeta na entrega.
 */

type Size = "small" | "medium" | "large";
const SIZES: { id: Size; icon: string; label: Tr; sub: Tr }[] = [
  { id: "small", icon: "✉️", label: { pt: "Pequeno", en: "Small", fr: "Petit" }, sub: { pt: "Cabe numa mochila · até 5 kg (documentos, chaves, roupa)", en: "Fits a backpack · up to 5 kg (documents, keys, clothes)", fr: "Tient dans un sac · jusqu'à 5 kg" } },
  { id: "medium", icon: "📦", label: { pt: "Médio", en: "Medium", fr: "Moyen" }, sub: { pt: "Caixa de sapatos a caixa média · até 15 kg", en: "Shoebox to medium box · up to 15 kg", fr: "Boîte moyenne · jusqu'à 15 kg" } },
  { id: "large", icon: "🧳", label: { pt: "Grande", en: "Large", fr: "Grand" }, sub: { pt: "Caixa grande · até 30 kg · vai de carro", en: "Large box · up to 30 kg · goes by car", fr: "Grand carton · jusqu'à 30 kg · en voiture" } },
];
const CASH_LABEL: Tr = { pt: "Numerário ao estafeta, na recolha", en: "Cash to the rider at pickup", fr: "Espèces au livreur, au départ" };

interface Quote { km: number; deliveryFee: number; sizeFee: number; total: number; etaMin: number; largeNeedsCar: boolean }

export default function EnviosPage() {
  const t = useT();
  return (
    <CustomerShell>
      <TopBar title={t({ pt: "Envios", en: "Send a parcel", fr: "Envois" })} back="/" />
      <Guard roles={["customer"]}><EnviosForm /></Guard>
    </CustomerShell>
  );
}

function EnviosForm() {
  const t = useT();
  const { toast } = useToast();
  const { user } = useAuth();
  const [, go] = useLocation();
  const meta = useMeta();
  const addresses = useAddresses();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [editing, setEditing] = useState<Field>("pickup");
  const [locating, setLocating] = useState(false);
  const [f, setF] = useState({
    senderName: user?.fullName ?? "", senderPhone: user?.phone ?? "", pickupRef: "",
    recipientName: "", recipientPhone: "", dropoffRef: "", description: "",
  });
  const [size, setSize] = useState<Size>("small");
  const [fragile, setFragile] = useState(false);
  const [payment, setPayment] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const upd = (k: keyof typeof f) => (e: { target: { value: string } }) => { setF((x) => ({ ...x, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: "" })); };

  useEffect(() => {
    if (payment || !meta.data) return;
    const cash = meta.data.paymentMethods?.find((m) => m.id === "cash" && m.available);
    setPayment(cash ? "cash" : firstAvailableMethod(meta.data.paymentMethods));
  }, [meta.data]);

  const myLocation = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition((p) => {
      setLocating(false);
      setPickup({ label: t({ pt: "Localização actual (GPS)", en: "Current location (GPS)", fr: "Position actuelle (GPS)" }), latitude: p.coords.latitude, longitude: p.coords.longitude });
      setEditing("dropoff");
    }, () => setLocating(false), { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 });
  };
  useEffect(() => { myLocation(); }, []);

  const setField = (p: Place) => { if (editing === "pickup") { setPickup(p); if (!dropoff) setEditing("dropoff"); } else setDropoff(p); };
  const saved = (addresses.data?.addresses ?? []).filter((a) => a.latitude != null && a.longitude != null);

  const body = pickup && dropoff ? { pickup: { ...pickup, street: pickup.label, zone: pickup.zone ?? "" }, dropoff: { ...dropoff, street: dropoff.label, zone: dropoff.zone ?? "" }, size } : null;
  const quote = useQuery<Quote>({
    queryKey: ["parcel-quote", body && [pickup!.latitude, pickup!.longitude, dropoff!.latitude, dropoff!.longitude].map((n) => n.toFixed(5)).join(","), size],
    queryFn: () => post<Quote>("/api/parcels/quote", body), enabled: !!body, staleTime: 60_000, retry: false,
  });

  const phoneOk = (v: string) => /^(\+?244)?\s?9\d{2}\s?\d{3}\s?\d{3}$/.test(v.trim());
  const validate = () => {
    const e: Record<string, string> = {};
    const req = t({ pt: "Obrigatório", en: "Required", fr: "Obligatoire" });
    const badPhone = t({ pt: "Telefone inválido (9 dígitos, começa por 9)", en: "Invalid phone (9 digits, starts with 9)", fr: "Téléphone invalide" });
    if (f.senderName.trim().length < 2) e.senderName = req;
    if (!phoneOk(f.senderPhone)) e.senderPhone = badPhone;
    if (f.recipientName.trim().length < 2) e.recipientName = req;
    if (!phoneOk(f.recipientPhone)) e.recipientPhone = badPhone;
    if (f.description.trim().length < 2) e.description = t({ pt: "Diga o que vai no pacote", en: "Say what's in the parcel", fr: "Indiquez le contenu" });
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const send = useMutation({
    mutationFn: () => post<{ order: { id: number } }>("/api/parcels", {
      pickup: { ...body!.pickup, reference: f.pickupRef || null }, dropoff: { ...body!.dropoff, reference: f.dropoffRef || null }, size,
      senderName: f.senderName.trim(), senderPhone: f.senderPhone.trim(), recipientName: f.recipientName.trim(), recipientPhone: f.recipientPhone.trim(),
      description: f.description.trim(), fragile, paymentMethod: payment, riderTip: 0,
    }),
    onSuccess: (d) => { queryClient.invalidateQueries({ queryKey: ["/api/orders"] }); go(`/encomendas/${d.order.id}`); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });

  const err = (k: string) => errors[k] || undefined;
  const field = (id: keyof typeof f, label: string, props: Record<string, unknown> = {}) => (
    <div className="space-y-1">
      <Label htmlFor={`env-${id}`}>{label}</Label>
      <Input id={`env-${id}`} value={f[id]} onChange={upd(id)} aria-invalid={!!err(id)} aria-describedby={err(id) ? `env-${id}-err` : undefined}
        className={cn("h-11 rounded-xl", err(id) && "border-red-500")} {...props} />
      {err(id) && <p id={`env-${id}-err`} className="text-xs text-red-700">{err(id)}</p>}
    </div>
  );

  return (
    <form className="space-y-5 px-4 pb-8 pt-3" onSubmit={(e) => { e.preventDefault(); if (validate()) send.mutate(); }} noValidate>
      <div className="rounded-2xl bg-brand-50 p-4">
        <p className="flex items-center gap-2 text-lg font-extrabold"><Package className="h-5 w-5 text-primary" />{t({ pt: "Mande um pacote em Luanda", en: "Send a parcel across Luanda", fr: "Envoyez un colis à Luanda" })}</p>
        <p className="text-sm text-neutral-700">{t({ pt: "Um estafeta vai buscar e leva directamente. Quem recebe dá o código de entrega.", en: "A rider collects it and takes it straight there. The recipient gives the delivery code.", fr: "Un livreur le récupère et le livre directement." })}</p>
      </div>

      <section className="space-y-2" aria-label={t({ pt: "Recolha e entrega", en: "Pickup and drop-off", fr: "Départ et livraison" })}>
        <PlaceRow icon={<MapPin className="h-4 w-4 text-primary" />} label={t({ pt: "Recolha (onde está o pacote)", en: "Pickup (where the parcel is)", fr: "Départ (où est le colis)" })}
          value={pickup?.label} active={editing === "pickup"} onClick={() => setEditing("pickup")} placeholder={t({ pt: "Escolha a recolha", en: "Choose pickup", fr: "Choisir le départ" })}
          action={<Button type="button" size="sm" variant="ghost" onClick={myLocation} disabled={locating} aria-label={t({ pt: "Usar a minha localização", en: "Use my location", fr: "Utiliser ma position" })}>
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}</Button>} />
        <PlaceRow icon={<Flag className="h-4 w-4 text-green-700" />} label={t({ pt: "Entrega (para onde vai)", en: "Drop-off (where it goes)", fr: "Livraison (destination)" })}
          value={dropoff?.label} active={editing === "dropoff"} onClick={() => setEditing("dropoff")} placeholder={t({ pt: "Escolha a entrega", en: "Choose drop-off", fr: "Choisir la livraison" })} />
      </section>
      <PlaceSearch onPick={setField} field={editing} />
      {saved.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {saved.map((a) => (
            <button key={a.id} type="button" onClick={() => setField({ label: `${a.label} · ${a.street}`, latitude: a.latitude!, longitude: a.longitude!, zone: a.zone })}
              className="rounded-full border px-3 py-1.5 text-xs font-medium hover:bg-neutral-50">{a.label === "Casa" ? "🏠" : a.label === "Trabalho" ? "💼" : "📍"} {a.label}</button>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 text-xs text-neutral-600">{editing === "pickup"
          ? t({ pt: "Toque no mapa para marcar a RECOLHA.", en: "Tap the map to set the PICKUP.", fr: "Touchez la carte pour le DÉPART." })
          : t({ pt: "Toque no mapa para marcar a ENTREGA.", en: "Tap the map to set the DROP-OFF.", fr: "Touchez la carte pour la LIVRAISON." })}</p>
        <PinPicker key={editing} value={editing === "pickup" ? pickup : dropoff ?? pickup} emoji={editing === "pickup" ? "📦" : "🏁"}
          onChange={(p) => setField({ ...p, label: t({ pt: "Ponto no mapa", en: "Point on map", fr: "Point sur la carte" }) + ` (${p.latitude.toFixed(4)}, ${p.longitude.toFixed(4)})` })} />
      </div>

      <fieldset className="space-y-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-bold">{t({ pt: "Quem envia", en: "Sender", fr: "Expéditeur" })}</legend>
        <div className="grid grid-cols-2 gap-2">
          {field("senderName", t({ pt: "Nome", en: "Name", fr: "Nom" }), { autoComplete: "name" })}
          {field("senderPhone", t({ pt: "Telefone", en: "Phone", fr: "Téléphone" }), { inputMode: "tel", autoComplete: "tel" })}
        </div>
        {field("pickupRef", t({ pt: "Ponto de referência (opcional)", en: "Landmark (optional)", fr: "Repère (facultatif)" }), { placeholder: t({ pt: "Ex.: portão azul, ao lado da farmácia", en: "E.g. blue gate, next to the pharmacy", fr: "Ex. : portail bleu" }) })}
      </fieldset>

      <fieldset className="space-y-3 rounded-xl border p-3">
        <legend className="px-1 text-sm font-bold">{t({ pt: "Quem recebe", en: "Recipient", fr: "Destinataire" })}</legend>
        <div className="grid grid-cols-2 gap-2">
          {field("recipientName", t({ pt: "Nome", en: "Name", fr: "Nom" }))}
          {field("recipientPhone", t({ pt: "Telefone", en: "Phone", fr: "Téléphone" }), { inputMode: "tel" })}
        </div>
        {field("dropoffRef", t({ pt: "Ponto de referência (opcional)", en: "Landmark (optional)", fr: "Repère (facultatif)" }))}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-sm font-bold">{t({ pt: "Tamanho do pacote", en: "Parcel size", fr: "Taille du colis" })}</legend>
        <div role="radiogroup" className="space-y-2">
          {SIZES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={size === s.id} onClick={() => setSize(s.id)}
              className={cn("flex w-full items-center gap-3 rounded-xl border-2 p-3 text-left", size === s.id ? "border-primary bg-brand-50" : "border-neutral-200")}>
              <span className="text-2xl" aria-hidden>{s.icon}</span>
              <span className="flex-1"><span className="block font-bold">{t(s.label)}</span><span className="block text-xs text-neutral-600">{t(s.sub)}</span></span>
            </button>
          ))}
        </div>
        {field("description", t({ pt: "O que vai no pacote?", en: "What's in the parcel?", fr: "Contenu du colis ?" }), { placeholder: t({ pt: "Ex.: documentos, um vestido, uma caixa de bolos", en: "E.g. documents, a dress, a cake box", fr: "Ex. : documents, une robe" }) })}
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={fragile} onCheckedChange={(v) => setFragile(!!v)} />{t({ pt: "Frágil — manusear com cuidado", en: "Fragile — handle with care", fr: "Fragile — manipuler avec soin" })}</label>
        <p className="text-xs text-neutral-500">{t({ pt: "Não aceitamos dinheiro, armas, drogas, animais nem produtos perigosos.", en: "We don't carry cash, weapons, drugs, animals or dangerous goods.", fr: "Pas d'argent liquide, d'armes, de drogues, d'animaux ni de produits dangereux." })}</p>
      </fieldset>

      {body && (
        <section className="space-y-2 rounded-xl border p-3">
          {quote.isLoading ? <Loading /> : quote.error ? <ErrorState error={quote.error} onRetry={() => quote.refetch()} /> : quote.data && (
            <div className="space-y-1 text-sm">
              <div className="flex justify-between"><span>{t({ pt: "Envio", en: "Delivery", fr: "Livraison" })} ({quote.data.km.toFixed(1).replace(".", ",")} km)</span><span className="tabular-nums">{kz(quote.data.deliveryFee)}</span></div>
              {!!quote.data.sizeFee && <div className="flex justify-between"><span>{t({ pt: "Extra de tamanho", en: "Size extra", fr: "Supplément taille" })}</span><span className="tabular-nums">{kz(quote.data.sizeFee)}</span></div>}
              <div className="flex justify-between border-t pt-1 text-base font-extrabold"><span>{t(T.total)}</span><span className="tabular-nums">{kz(quote.data.total)}</span></div>
              <p className="text-xs text-neutral-600">{t({ pt: `Chega em cerca de ${quote.data.etaMin} min.`, en: `Arrives in about ${quote.data.etaMin} min.`, fr: `Arrive dans environ ${quote.data.etaMin} min.` })}</p>
            </div>
          )}
        </section>
      )}

      {body && quote.data && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold">{t({ pt: "Pagamento", en: "Payment", fr: "Paiement" })}</h2>
          <PaymentPicker value={payment} onChange={setPayment} cashLabel={CASH_LABEL} />
          <Button type="submit" className="h-14 w-full text-base font-bold" disabled={send.isPending || !payment}>
            {send.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Package className="mr-2 h-5 w-5" />}
            {t({ pt: `Pedir estafeta · ${kz(quote.data.total)}`, en: `Book a rider · ${kz(quote.data.total)}`, fr: `Réserver · ${kz(quote.data.total)}` })}
          </Button>
        </section>
      )}
    </form>
  );
}
