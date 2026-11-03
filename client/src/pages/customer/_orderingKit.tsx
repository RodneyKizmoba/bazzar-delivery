/**
 * Peças partilhadas pelas páginas de cliente de encomenda (carrinho, checkout, grupo, detalhe, moradas).
 * Não é uma rota — é um módulo local das páginas de cliente.
 */
import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, keepPreviousData } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Clock, LocateFixed, Loader2, MapPin, Plus, Tag, X, Zap, CalendarClock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loading, ErrorState } from "@/components/common";
import { useToast } from "@/hooks/use-toast";
import { ApiError, post, put, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { kz, time, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------
export interface PaymentMethodInfo { id: string; available: boolean; sandbox: boolean; reason?: string }
export interface Meta {
  zones: string[];
  dietaryTags: string[];
  paymentMethods: PaymentMethodInfo[];
  paymentsMode: string;
  plus: { monthlyPrice: number; freeDeliveryMinOrder: number };
  schedule: { minLeadMin: number; maxAheadHours: number };
  points: { pointValueKz: number; kzPerPointEarned: number; maxDiscountPct: number };
}

export interface Address {
  id: number; label: string; street: string; zone: string; city: string;
  reference: string | null; latitude: number | null; longitude: number | null; isDefault: boolean;
}

export interface SelectedOption { groupId: number; groupName: string; optionId: number; name: string; priceDelta: number }

export interface Quote {
  storeId: number; storeName: string;
  lines: { menuItemId: number; name: string; quantity: number; unitPrice: number; lineTotal: number; selectedOptions: SelectedOption[]; specialInstructions: string | null }[];
  subtotal: number; deliveryFee: number; baseDeliveryFee: number; discount: number;
  pointsRedeemed: number; pointsDiscount: number; total: number; promoCode: string | null;
  isPlus: boolean; plusSavings: number; plusFreeDeliveryMinOrder: number;
}

export interface QuoteBody {
  storeId: number;
  items: { menuItemId: number; quantity: number; optionIds: number[]; specialInstructions?: string | null }[];
  promoCode?: string | null;
  usePoints?: number;
}

export interface StoreSummary {
  id: number; name: string; logoUrl: string | null; phone?: string; zone: string; street: string;
  zonesServed: string[]; isOpenNow: boolean; openingTime: string; closingTime: string;
  deliveryFee: number; minOrder: number; deliveryTimeMin: number; latitude: number | null; longitude: number | null;
}

export const FINAL_STATUSES = ["delivered", "cancelled", "rejected"];

export const errCode = (e: unknown) => (e instanceof ApiError ? e.code : undefined);

export function useMeta() {
  return useQuery<Meta>({ queryKey: ["/api/meta"], staleTime: 5 * 60_000 });
}

export function useDebounced<V>(value: V, ms = 400): V {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** Orçamento real do servidor, com debounce. `body` null = sem pedido. */
export function useQuote(body: QuoteBody | null, ms = 400) {
  const key = body && body.items.length ? JSON.stringify(body) : null;
  const debounced = useDebounced(key, ms);
  const q = useQuery<Quote, Error>({
    queryKey: ["cart-quote", debounced],
    queryFn: async () => (await post<{ quote: Quote }>("/api/cart/quote", JSON.parse(debounced!))).quote,
    enabled: !!debounced,
    retry: false,
    staleTime: 15_000,
    placeholderData: keepPreviousData,
  });
  return { ...q, isUpdating: q.isFetching || key !== debounced };
}

// ---------------------------------------------------------------------------
// Preferências de checkout (promo / pontos) partilhadas entre carrinho e checkout
// ---------------------------------------------------------------------------
const PREFS_KEY = "bazzar.checkout";
export interface CheckoutPrefs { promoCode: string | null; usePoints: boolean }
export function readCheckoutPrefs(): CheckoutPrefs {
  try {
    const v = JSON.parse(sessionStorage.getItem(PREFS_KEY) || "{}");
    return { promoCode: typeof v.promoCode === "string" && v.promoCode ? v.promoCode : null, usePoints: v.usePoints === true || (typeof v.usePoints === "number" && v.usePoints > 0) };
  } catch { return { promoCode: null, usePoints: false }; }
}
export function writeCheckoutPrefs(p: CheckoutPrefs) {
  try { sessionStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}
export function clearCheckoutPrefs() {
  try { sessionStorage.removeItem(PREFS_KEY); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Horários (Luanda = UTC+1, sem horário de verão)
// ---------------------------------------------------------------------------
const H = 3_600_000;
const SLOT = 15 * 60_000;
const luandaDayKey = (d: Date) => new Date(d.getTime() + H).toISOString().slice(0, 10);
const luandaMinutes = (d: Date) => { const s = new Date(d.getTime() + H); return s.getUTCHours() * 60 + s.getUTCMinutes(); };
const hhmm = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + (m || 0); };

export function isWithinHours(hours: { openingTime: string; closingTime: string } | undefined, at: Date) {
  if (!hours) return true;
  const t = luandaMinutes(at), o = hhmm(hours.openingTime), c = hhmm(hours.closingTime);
  if (o === c) return true;
  return o < c ? t >= o && t < c : t >= o || t < c;
}

/** Slots de 15 min entre agora+minLead e agora+maxAhead, agrupados por dia de Luanda. */
export function buildSlots(minLeadMin: number, maxAheadHours: number, hours?: { openingTime: string; closingTime: string }, now = new Date()) {
  const start = Math.ceil((now.getTime() + (minLeadMin + 2) * 60_000) / SLOT) * SLOT;
  const end = now.getTime() + maxAheadHours * H;
  const days: { key: string; slots: Date[] }[] = [];
  for (let ts = start; ts <= end; ts += SLOT) {
    const d = new Date(ts);
    if (!isWithinHours(hours, d)) continue;
    const key = luandaDayKey(d);
    let day = days.find((x) => x.key === key);
    if (!day) { day = { key, slots: [] }; days.push(day); }
    day.slots.push(d);
  }
  return days;
}

function useMinuteTick() {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setN(Date.now()), 60_000); return () => clearInterval(id); }, []);
  return n;
}

export type WhenMode = "now" | "schedule";

/** Escolha "Agora" / "Agendar" com dia e hora (hora de Luanda). value = ISO ou null. */
export function WhenPicker({ mode, onModeChange, value, onChange, hours, allowNow = true, nowNote }: {
  mode: WhenMode; onModeChange: (m: WhenMode) => void;
  value: string | null; onChange: (iso: string | null) => void;
  hours?: { openingTime: string; closingTime: string };
  allowNow?: boolean; nowNote?: string;
}) {
  const t = useT();
  const { lang } = useLang();
  const meta = useMeta();
  const tick = useMinuteTick();
  const days = useMemo(
    () => (meta.data ? buildSlots(meta.data.schedule.minLeadMin, meta.data.schedule.maxAheadHours, hours, new Date(tick)) : []),
    [meta.data, hours?.openingTime, hours?.closingTime, tick],
  );
  const todayKey = luandaDayKey(new Date(tick));
  const tomorrowKey = luandaDayKey(new Date(tick + 24 * H));
  const [dayKey, setDayKey] = useState<string | null>(null);
  const currentDay = days.find((d) => d.key === dayKey) ?? days.find((d) => value && d.slots.some((s) => s.toISOString() === value)) ?? days[0];

  // garantir um slot válido quando se agenda
  useEffect(() => {
    if (mode !== "schedule" || !days.length) return;
    const all = days.flatMap((d) => d.slots.map((s) => s.toISOString()));
    if (!value || !all.includes(value)) onChange((currentDay ?? days[0]).slots[0].toISOString());
  }, [mode, days, value]);

  useEffect(() => { if (!allowNow && mode === "now") onModeChange("schedule"); }, [allowNow, mode]);

  const dayLabel = (key: string) =>
    key === todayKey ? t({ pt: "Hoje", en: "Today", fr: "Aujourd'hui" })
      : key === tomorrowKey ? t({ pt: "Amanhã", en: "Tomorrow", fr: "Demain" })
        : new Date(`${key}T12:00:00Z`).toLocaleDateString(lang === "pt" ? "pt-AO" : lang, { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });

  const optionCls = (active: boolean, disabled?: boolean) => cn(
    "flex flex-1 items-center gap-2 rounded-xl border-2 px-3 py-3 text-left text-sm transition",
    active ? "border-primary bg-orange-50" : "border-neutral-200 hover:border-neutral-300",
    disabled && "opacity-50 cursor-not-allowed",
  );

  return (
    <div className="space-y-3">
      <div className="flex gap-2" role="radiogroup" aria-label={t({ pt: "Quando", en: "When", fr: "Quand" })}>
        <button type="button" role="radio" aria-checked={mode === "now"} disabled={!allowNow} className={optionCls(mode === "now", !allowNow)}
          onClick={() => { onModeChange("now"); onChange(null); }}>
          <Zap className="h-4 w-4 text-primary" />
          <span>
            <span className="block font-semibold">{t({ pt: "Agora", en: "Now", fr: "Maintenant" })}</span>
            <span className="block text-xs text-neutral-500">{nowNote ?? t({ pt: "O mais rápido possível", en: "As soon as possible", fr: "Dès que possible" })}</span>
          </span>
        </button>
        <button type="button" role="radio" aria-checked={mode === "schedule"} className={optionCls(mode === "schedule")}
          onClick={() => onModeChange("schedule")}>
          <CalendarClock className="h-4 w-4 text-primary" />
          <span>
            <span className="block font-semibold">{t({ pt: "Agendar", en: "Schedule", fr: "Programmer" })}</span>
            <span className="block text-xs text-neutral-500">{t({ pt: "Escolha dia e hora", en: "Pick day and time", fr: "Choisir jour et heure" })}</span>
          </span>
        </button>
      </div>

      {mode === "schedule" && (
        meta.isLoading ? <Loading /> : !days.length ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            {t({ pt: "Não há horários disponíveis para agendar nesta loja.", en: "No schedule slots available for this store.", fr: "Aucun créneau disponible pour ce magasin." })}
          </p>
        ) : (
          <div className="space-y-3 rounded-xl bg-neutral-50 p-3">
            <div className="flex flex-wrap gap-2">
              {days.map((d) => (
                <button key={d.key} type="button"
                  className={cn("rounded-full border px-4 py-2 text-sm font-medium min-h-[40px]", currentDay?.key === d.key ? "border-neutral-900 bg-neutral-900 text-white" : "bg-white")}
                  onClick={() => { setDayKey(d.key); onChange(d.slots[0].toISOString()); }}>
                  {dayLabel(d.key)}
                </button>
              ))}
            </div>
            {currentDay && (
              <div className="space-y-1.5">
                <Label>{t({ pt: "Hora de entrega (hora de Luanda)", en: "Delivery time (Luanda time)", fr: "Heure de livraison (heure de Luanda)" })}</Label>
                <Select value={value ?? undefined} onValueChange={(v) => onChange(v)}>
                  <SelectTrigger className="bg-white" aria-label={t({ pt: "Hora", en: "Time", fr: "Heure" })}><SelectValue /></SelectTrigger>
                  <SelectContent className="max-h-72">
                    {currentDay.slots.map((s) => (
                      <SelectItem key={s.toISOString()} value={s.toISOString()}>
                        {time(s, lang)} – {time(new Date(s.getTime() + SLOT), lang)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagamento
// ---------------------------------------------------------------------------
export const PAYMENT_ICON: Record<string, string> = { cash: "💵", multicaixa_express: "📱", unitel_money: "📲", card: "💳", bank_transfer: "🏦" };

export function SandboxBadge() {
  const t = useT();
  return <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-800">{t({ pt: "modo de teste", en: "test mode", fr: "mode test" })}</span>;
}

export function PaymentPicker({ value, onChange, excludeCash }: { value: string; onChange: (v: string) => void; excludeCash?: boolean }) {
  const t = useT();
  const meta = useMeta();
  if (meta.isLoading) return <Loading />;
  if (meta.error) return <ErrorState error={meta.error} onRetry={() => meta.refetch()} />;
  const methods = (meta.data?.paymentMethods ?? []).filter((m) => !excludeCash || m.id !== "cash");
  return (
    <RadioGroup value={value} onValueChange={onChange} className="gap-2">
      {methods.map((m) => {
        const id = `pm-${m.id}`;
        return (
          <label key={m.id} htmlFor={id}
            className={cn("flex min-h-[52px] items-center gap-3 rounded-xl border-2 px-3 py-2.5",
              value === m.id ? "border-primary bg-orange-50" : "border-neutral-200",
              m.available ? "cursor-pointer" : "cursor-not-allowed opacity-55")}>
            <RadioGroupItem id={id} value={m.id} disabled={!m.available} />
            <span className="text-lg" aria-hidden>{PAYMENT_ICON[m.id] ?? "💳"}</span>
            <span className="flex-1 text-sm font-medium">{PAYMENT[m.id] ? t(PAYMENT[m.id]) : m.id}</span>
            {!m.available && <span className="text-xs text-neutral-500">{t({ pt: "Brevemente", en: "Coming soon", fr: "Bientôt" })}</span>}
            {m.available && m.sandbox && <SandboxBadge />}
          </label>
        );
      })}
    </RadioGroup>
  );
}

// ---------------------------------------------------------------------------
// Moradas
// ---------------------------------------------------------------------------
export function useAddresses(enabled = true) {
  return useQuery<{ addresses: Address[] }>({ queryKey: ["/api/addresses"], enabled });
}

const LABEL_PRESETS: Tr[] = [
  { pt: "Casa", en: "Home", fr: "Maison" },
  { pt: "Trabalho", en: "Work", fr: "Travail" },
  { pt: "Outro", en: "Other", fr: "Autre" },
];

/** Formulário de morada (criar ou editar). */
export function AddressForm({ address, onDone, onCancel, submitLabel }: {
  address?: Address | null; onDone: (a: Address) => void; onCancel?: () => void; submitLabel?: string;
}) {
  const t = useT();
  const { toast } = useToast();
  const meta = useMeta();
  const uid = useId();
  const [label, setLabel] = useState(address?.label ?? t(LABEL_PRESETS[0]));
  const [street, setStreet] = useState(address?.street ?? "");
  const [zone, setZone] = useState(address?.zone ?? "");
  const [reference, setReference] = useState(address?.reference ?? "");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(
    address?.latitude != null && address?.longitude != null ? { latitude: address.latitude, longitude: address.longitude } : null,
  );
  const [locating, setLocating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        label: label.trim(), street: street.trim(), zone, city: "Luanda", reference: reference.trim() || null,
        latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null,
      };
      return address
        ? (await put<{ address: Address }>(`/api/addresses/${address.id}`, body)).address
        : (await post<{ address: Address }>("/api/addresses", body)).address;
    },
    onSuccess: (a) => {
      queryClient.invalidateQueries({ queryKey: ["/api/addresses"] });
      toast({ title: address ? t({ pt: "Morada actualizada", en: "Address updated", fr: "Adresse mise à jour" }) : t({ pt: "Morada adicionada", en: "Address added", fr: "Adresse ajoutée" }) });
      onDone(a);
    },
    onError: (e: Error) => setFormError(e.message),
  });

  const locate = () => {
    if (!("geolocation" in navigator)) {
      toast({ variant: "destructive", title: t({ pt: "Localização indisponível", en: "Location unavailable", fr: "Localisation indisponible" }) });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => { setCoords({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }); setLocating(false); },
      (err) => {
        setLocating(false);
        toast({ variant: "destructive", title: t({ pt: "Não foi possível obter a localização", en: "Couldn't get your location", fr: "Impossible d'obtenir la position" }), description: err.message });
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    if (!label.trim()) return setFormError(t({ pt: "Indique um nome para a morada.", en: "Give the address a name.", fr: "Donnez un nom à l'adresse." }));
    if (street.trim().length < 3) return setFormError(t({ pt: "Indique a rua / edifício.", en: "Enter the street / building.", fr: "Indiquez la rue / le bâtiment." }));
    if (!zone) return setFormError(t({ pt: "Escolha o bairro / zona.", en: "Choose the area.", fr: "Choisissez le quartier." }));
    save.mutate();
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-label`}>{t({ pt: "Nome", en: "Name", fr: "Nom" })}</Label>
        <div className="flex flex-wrap gap-1.5">
          {LABEL_PRESETS.map((p) => (
            <button key={p.pt} type="button" onClick={() => setLabel(t(p))}
              className={cn("rounded-full border px-3 py-1.5 text-xs font-medium", label === t(p) ? "border-primary bg-orange-50 text-primary" : "bg-white")}>
              {t(p)}
            </button>
          ))}
        </div>
        <Input id={`${uid}-label`} value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-street`}>{t({ pt: "Rua, número, edifício", en: "Street, number, building", fr: "Rue, numéro, bâtiment" })}</Label>
        <Input id={`${uid}-street`} value={street} maxLength={200} onChange={(e) => setStreet(e.target.value)}
          placeholder={t({ pt: "Ex.: Rua Rainha Ginga 24, 3.º andar", en: "E.g. Rua Rainha Ginga 24, 3rd floor", fr: "Ex. : Rua Rainha Ginga 24, 3e étage" })} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-zone`}>{t({ pt: "Bairro / zona", en: "Area", fr: "Quartier" })}</Label>
        <Select value={zone || undefined} onValueChange={setZone}>
          <SelectTrigger id={`${uid}-zone`}><SelectValue placeholder={t({ pt: "Escolher…", en: "Choose…", fr: "Choisir…" })} /></SelectTrigger>
          <SelectContent className="max-h-72">
            {(meta.data?.zones ?? []).map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-ref`}>{t({ pt: "Ponto de referência (opcional)", en: "Landmark (optional)", fr: "Point de repère (facultatif)" })}</Label>
        <Input id={`${uid}-ref`} value={reference} maxLength={200} onChange={(e) => setReference(e.target.value)}
          placeholder={t({ pt: "Ex.: ao lado da farmácia, portão azul", en: "E.g. next to the pharmacy, blue gate", fr: "Ex. : à côté de la pharmacie, portail bleu" })} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={locate} disabled={locating}>
          {locating ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-1.5 h-4 w-4" />}
          {t({ pt: "Usar a minha localização", en: "Use my location", fr: "Utiliser ma position" })}
        </Button>
        {coords && (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-1 text-xs text-green-800">
            <MapPin className="h-3 w-3" /> {t({ pt: "Localização guardada", en: "Location saved", fr: "Position enregistrée" })}
            <button type="button" aria-label={t(T.remove)} onClick={() => setCoords(null)}><X className="h-3 w-3" /></button>
          </span>
        )}
      </div>
      {formError && <p className="text-sm text-red-600" role="alert">{formError}</p>}
      <div className="flex gap-2 pt-1">
        {onCancel && <Button type="button" variant="ghost" onClick={onCancel}>{t(T.cancel)}</Button>}
        <Button type="submit" className="flex-1" disabled={save.isPending}>
          {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
          {submitLabel ?? t(T.save)}
        </Button>
      </div>
    </form>
  );
}

/** Lista de moradas para escolher + adicionar nova inline. */
export function AddressPicker({ value, onChange, zonesServed }: { value: number | null; onChange: (id: number) => void; zonesServed?: string[] }) {
  const t = useT();
  const q = useAddresses();
  const [adding, setAdding] = useState(false);
  const list = q.data?.addresses ?? [];

  useEffect(() => {
    if (!q.data) return;
    if (!list.length) setAdding(true);
    else if (value == null || !list.some((a) => a.id === value)) onChange((list.find((a) => a.isDefault) ?? list[0]).id);
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;

  const served = (zone: string) => !zonesServed?.length || zonesServed.some((z) => z.toLowerCase() === zone.toLowerCase());

  return (
    <div className="space-y-2">
      {list.length > 0 && (
        <RadioGroup value={value != null ? String(value) : undefined} onValueChange={(v) => onChange(Number(v))} className="gap-2">
          {list.map((a) => {
            const id = `addr-${a.id}`;
            const ok = served(a.zone);
            return (
              <label key={a.id} htmlFor={id}
                className={cn("flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-3", value === a.id ? "border-primary bg-orange-50" : "border-neutral-200")}>
                <RadioGroupItem id={id} value={String(a.id)} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    {a.label}
                    {a.isDefault && <span className="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600">{t({ pt: "Predefinida", en: "Default", fr: "Par défaut" })}</span>}
                  </span>
                  <span className="block truncate text-sm text-neutral-600">{a.street}, {a.zone}</span>
                  {a.reference && <span className="block truncate text-xs text-neutral-500">{a.reference}</span>}
                  {!ok && (
                    <span className="mt-1 flex items-center gap-1 text-xs font-medium text-red-600">
                      <AlertTriangle className="h-3 w-3" /> {t({ pt: "A loja não entrega nesta zona", en: "The store doesn't deliver to this area", fr: "Le magasin ne livre pas ce quartier" })}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </RadioGroup>
      )}
      {adding ? (
        <div className="rounded-xl border bg-neutral-50 p-3">
          <p className="mb-2 text-sm font-semibold">{t({ pt: "Nova morada", en: "New address", fr: "Nouvelle adresse" })}</p>
          <AddressForm onDone={(a) => { setAdding(false); onChange(a.id); }} onCancel={list.length ? () => setAdding(false) : undefined}
            submitLabel={t({ pt: "Guardar morada", en: "Save address", fr: "Enregistrer l'adresse" })} />
        </div>
      ) : (
        <Button type="button" variant="outline" className="w-full border-dashed" onClick={() => setAdding(true)}>
          <Plus className="mr-1.5 h-4 w-4" /> {t({ pt: "Adicionar morada", en: "Add address", fr: "Ajouter une adresse" })}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Preços
// ---------------------------------------------------------------------------
export function PriceRow({ label, value, strong, muted, children }: { label: ReactNode; value: ReactNode; strong?: boolean; muted?: boolean; children?: ReactNode }) {
  return (
    <div className={cn("flex items-start justify-between gap-3 text-sm", strong && "text-base font-bold text-neutral-900", muted && "text-neutral-500")}>
      <span>{label}{children}</span>
      <span className="text-right whitespace-nowrap">{value}</span>
    </div>
  );
}

export function QuoteBreakdown({ quote }: { quote: Pick<Quote, "subtotal" | "deliveryFee" | "baseDeliveryFee" | "discount" | "pointsRedeemed" | "pointsDiscount" | "total" | "promoCode" | "plusSavings"> }) {
  const t = useT();
  return (
    <div className="space-y-2">
      <PriceRow label={t(T.subtotal)} value={kz(quote.subtotal)} />
      <PriceRow label={t(T.deliveryFee)} value={
        quote.plusSavings > 0 ? (
          <span className="flex flex-col items-end">
            <span><span className="mr-1.5 text-neutral-400 line-through">{kz(quote.baseDeliveryFee)}</span><span className="font-semibold text-green-700">{t(T.free)}</span></span>
            <span className="text-[11px] font-semibold text-violet-700">{t({ pt: "Grátis com Plus", en: "Free with Plus", fr: "Gratuit avec Plus" })}</span>
          </span>
        ) : quote.deliveryFee === 0 ? <span className="font-semibold text-green-700">{t(T.free)}</span> : kz(quote.deliveryFee)
      } />
      {quote.discount > 0 && (
        <PriceRow label={<>{t(T.discount)}{quote.promoCode && <span className="ml-1 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-800">{quote.promoCode}</span>}</>}
          value={<span className="text-green-700">−{kz(quote.discount)}</span>} />
      )}
      {quote.pointsDiscount > 0 && (
        <PriceRow label={t({ pt: `Pontos (${quote.pointsRedeemed})`, en: `Points (${quote.pointsRedeemed})`, fr: `Points (${quote.pointsRedeemed})` })}
          value={<span className="text-green-700">−{kz(quote.pointsDiscount)}</span>} />
      )}
      <div className="border-t pt-2">
        <PriceRow strong label={t(T.total)} value={kz(quote.total)} />
      </div>
    </div>
  );
}

/** Campo de código promocional. onApply deve lançar erro se o código for inválido. */
export function PromoInput({ applied, onApply, onRemove, externalError }: {
  applied: string | null; onApply: (code: string) => Promise<void>; onRemove: () => void; externalError?: string | null;
}) {
  const t = useT();
  const uid = useId();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const shownError = error ?? externalError ?? null;

  if (applied) {
    return (
      <div className="flex items-center justify-between rounded-xl border border-green-200 bg-green-50 px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm text-green-800">
          <Tag className="h-4 w-4" /> <span className="font-semibold">{applied}</span> {t({ pt: "aplicado", en: "applied", fr: "appliqué" })}
        </span>
        <Button variant="ghost" size="sm" onClick={() => { onRemove(); setError(null); }}>{t(T.remove)}</Button>
      </div>
    );
  }
  const apply = async () => {
    const c = code.trim().toUpperCase();
    if (!c) return;
    setBusy(true); setError(null);
    try { await onApply(c); setCode(""); } catch (e) { setError(e instanceof Error ? e.message : t(T.error)); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${uid}-promo`} className="sr-only">{t({ pt: "Código promocional", en: "Promo code", fr: "Code promo" })}</Label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Tag className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-400" />
          <Input id={`${uid}-promo`} value={code} maxLength={30} className="pl-9 uppercase"
            placeholder={t({ pt: "Código promocional", en: "Promo code", fr: "Code promo" })}
            onChange={(e) => { setCode(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } }}
            aria-invalid={!!shownError} aria-describedby={shownError ? `${uid}-err` : undefined} />
        </div>
        <Button type="button" variant="outline" onClick={apply} disabled={busy || !code.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : t({ pt: "Aplicar", en: "Apply", fr: "Appliquer" })}
        </Button>
      </div>
      {shownError && <p id={`${uid}-err`} className="text-xs text-red-600" role="alert">{shownError}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Erros ao fazer a encomenda (com orientação)
// ---------------------------------------------------------------------------
export function OrderErrorAlert({ error, onSchedule, onPickCash, onDismiss }: {
  error: unknown; onSchedule?: () => void; onPickCash?: () => void; onDismiss?: () => void;
}) {
  const t = useT();
  if (!error) return null;
  const code = errCode(error);
  const msg = error instanceof Error ? error.message : t(T.error);
  let title: Tr = { pt: "Não foi possível fazer a encomenda", en: "Couldn't place the order", fr: "Impossible de passer la commande" };
  let hint: Tr | null = null;
  let action: ReactNode = null;
  switch (code) {
    case "STORE_CLOSED":
    case "OUTSIDE_HOURS":
      title = { pt: "A loja não está a aceitar encomendas agora", en: "The store isn't taking orders now", fr: "Le magasin n'accepte pas de commandes maintenant" };
      hint = { pt: "Agende a entrega para uma hora em que a loja esteja aberta.", en: "Schedule the delivery for a time when the store is open.", fr: "Programmez la livraison à une heure d'ouverture." };
      if (onSchedule) action = <Button size="sm" variant="outline" onClick={onSchedule}><Clock className="mr-1.5 h-4 w-4" />{t({ pt: "Agendar entrega", en: "Schedule delivery", fr: "Programmer" })}</Button>;
      break;
    case "ZONE_NOT_SERVED":
      title = { pt: "Fora da zona de entrega", en: "Outside the delivery area", fr: "Hors zone de livraison" };
      hint = { pt: "Escolha outra morada ou outra loja que entregue na sua zona.", en: "Choose another address or a store that delivers to your area.", fr: "Choisissez une autre adresse ou un autre magasin." };
      break;
    case "SCHEDULE_TOO_SOON":
    case "SCHEDULE_TOO_FAR":
      title = { pt: "Hora de entrega inválida", en: "Invalid delivery time", fr: "Heure de livraison invalide" };
      hint = { pt: "Escolha outra hora na lista.", en: "Pick another time from the list.", fr: "Choisissez une autre heure." };
      break;
    case "PAYMENT_METHOD_UNAVAILABLE":
    case "PAYMENT_GATEWAY_MISSING":
      title = { pt: "Método de pagamento indisponível", en: "Payment method unavailable", fr: "Moyen de paiement indisponible" };
      hint = { pt: "Os pagamentos online chegam brevemente. Pode pagar em numerário na entrega.", en: "Online payments are coming soon. You can pay cash on delivery.", fr: "Les paiements en ligne arrivent bientôt. Vous pouvez payer en espèces." };
      if (onPickCash) action = <Button size="sm" variant="outline" onClick={onPickCash}>{t({ pt: "Pagar em numerário", en: "Pay cash", fr: "Payer en espèces" })}</Button>;
      break;
    case "BELOW_MIN_ORDER":
    case "ITEM_UNAVAILABLE":
    case "OPTION_UNAVAILABLE":
    case "EMPTY_CART":
      hint = { pt: "Reveja o carrinho antes de continuar.", en: "Review your basket before continuing.", fr: "Vérifiez votre panier." };
      action = <Link href="/carrinho"><Button size="sm" variant="outline">{t({ pt: "Ver carrinho", en: "View basket", fr: "Voir le panier" })}</Button></Link>;
      break;
  }
  return (
    <Alert variant="destructive" className="rounded-xl bg-red-50" role="alert">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="pr-6">{t(title)}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{msg}</p>
        {hint && <p className="text-neutral-700">{t(hint)}</p>}
        {action && <div className="pt-1">{action}</div>}
      </AlertDescription>
      {onDismiss && (
        <button className="absolute right-2 top-2 rounded p-1 hover:bg-red-100" aria-label={t({ pt: "Fechar", en: "Close", fr: "Fermer" })} onClick={onDismiss}>
          <X className="h-4 w-4" />
        </button>
      )}
    </Alert>
  );
}

/** Secção de cartão com título (checkout, detalhe). */
export function Section({ title, icon, children, className, right }: { title: string; icon?: ReactNode; children: ReactNode; className?: string; right?: ReactNode }) {
  return (
    <section className={cn("rounded-2xl border bg-white p-4 shadow-sm", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-bold text-neutral-900">{icon}{title}</h2>
        {right}
      </div>
      {children}
    </section>
  );
}

/** Pede `/api/stores/:id` (resumo da loja + menu). */
export interface StoreDetail {
  store: StoreSummary & Record<string, unknown>;
  isFavorite: boolean;
  sections: { id: number; name: string; sortOrder: number }[];
  items: import("@/components/ItemDialog").MenuItemFull[];
}
