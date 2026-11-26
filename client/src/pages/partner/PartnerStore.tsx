import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, X } from "lucide-react";
import { Guard, Loading, ErrorState, StoreImage } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { del, patch, post, put, queryClient } from "@/lib/api";
import { useT, T, type Tr } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";
import { PinPicker } from "@/components/OrderMap";
import { ChangePassword } from "@/components/ChangePassword";
import { useStoreVocab } from "@/lib/storeVocab";
import { PlanPicker } from "@/components/PlanPicker";

export default function PartnerStore() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <PlanPicker />
        <StoreForm />
        <PosIntegration />
        <div className="mx-auto mt-6 max-w-3xl"><ChangePassword /></div>
      </PanelShell>
    </Guard>
  );
}

interface Form {
  name: string; description: string; cuisines: string[]; phone: string; street: string; zone: string;
  zonesServed: string[]; logoUrl: string; coverUrl: string; openingTime: string; closingTime: string;
  isOpen: boolean; deliveryFee: string; minOrder: string; prepTimeMin: string; deliveryTimeMin: string;
  minNoticeHours: string; maxOrdersPerDay: string; payoutMethod: string; payoutReference: string; theme: string;
  pin: { latitude: number; longitude: number } | null;
  offersPickup: boolean; ownDelivery: boolean;
}

function StoreForm() {
  const t = useT();
  const { toast } = useToast();
  const storeQ = useQuery<{ store: any }>({ queryKey: ["/api/partner/store"] });
  const metaQ = useQuery<{ zones: string[] }>({ queryKey: ["/api/meta"] });
  const [f, setF] = useState<Form | null>(null);
  const [cuisineInput, setCuisineInput] = useState("");
  const vocab = useStoreVocab();
  const [locating, setLocating] = useState(false);
  const rates = useQuery<{ delivery: number; pickup: number; storeDelivery: number }>({ queryKey: ["/api/partner/commissions"] }).data;
  const useHere = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => { setF((x) => (x ? { ...x, pin: { latitude: p.coords.latitude, longitude: p.coords.longitude } } : x)); setLocating(false); },
      () => { setLocating(false); toast({ variant: "destructive", title: t({ pt: "Não foi possível obter a localização", en: "Couldn't get your location", fr: "Position introuvable" }) }); },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  };

  useEffect(() => {
    const s = storeQ.data?.store;
    if (s && !f) {
      setF({
        name: s.name ?? "", description: s.description ?? "", cuisines: s.cuisines ?? [], phone: s.phone ?? "",
        street: s.street ?? "", zone: s.zone ?? "", zonesServed: s.zonesServed ?? [], logoUrl: s.logoUrl ?? "",
        coverUrl: s.coverUrl ?? "", openingTime: s.openingTime ?? "10:00", closingTime: s.closingTime ?? "22:00",
        isOpen: !!s.isOpen, deliveryFee: String(s.deliveryFee ?? 0), minOrder: String(s.minOrder ?? 0),
        prepTimeMin: String(s.prepTimeMin ?? 20), deliveryTimeMin: String(s.deliveryTimeMin ?? 35),
        minNoticeHours: String(Math.round((s.minNoticeMin ?? 0) / 60)), maxOrdersPerDay: s.maxOrdersPerDay ? String(s.maxOrdersPerDay) : "",
        payoutMethod: s.payoutMethod ?? "", payoutReference: s.payoutReference ?? "", theme: s.theme ?? "",
        pin: s.latitude != null && s.longitude != null ? { latitude: s.latitude, longitude: s.longitude } : null,
        offersPickup: !!s.offersPickup, ownDelivery: !!s.ownDelivery,
      });
    }
  }, [storeQ.data]);

  const save = useMutation({
    mutationFn: (payload: object) => patch<{ store: any }>("/api/partner/store", payload),
    onSuccess: (res) => {
      queryClient.setQueryData(["/api/partner/store"], res);
      queryClient.invalidateQueries({ queryKey: ["/api/partner/store"] });
      toast({ title: t({ pt: "Alterações guardadas", en: "Changes saved", fr: "Modifications enregistrées" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });

  if (storeQ.isLoading || (!f && !storeQ.error)) return <Loading />;
  if (storeQ.error) return <ErrorState error={storeQ.error} onRetry={() => storeQ.refetch()} />;
  const form = f!;
  const store = storeQ.data!.store;
  const zones = metaQ.data?.zones ?? [];
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((p) => (p ? { ...p, [k]: v } : p));

  const isUrl = (s: string) => !s.trim() || /^https?:\/\/\S+$/i.test(s.trim()) || /^\/(?!\/)\S*$/.test(s.trim());
  const isInt = (s: string, min: number, max: number) => s !== "" && Number.isInteger(Number(s)) && Number(s) >= min && Number(s) <= max;
  const err: Tr | null =
    form.name.trim().length < 2 ? { pt: "Nome demasiado curto.", en: "Name too short.", fr: "Nom trop court." }
    : form.phone.trim().length < 9 ? { pt: "Telemóvel inválido.", en: "Invalid phone.", fr: "Téléphone invalide." }
    : form.street.trim().length < 3 ? { pt: "Morada inválida.", en: "Invalid address.", fr: "Adresse invalide." }
    : form.zone.trim().length < 2 ? { pt: "Escolha a zona.", en: "Choose the zone.", fr: "Choisissez la zone." }
    : !isUrl(form.logoUrl) || !isUrl(form.coverUrl) ? { pt: "URL de imagem inválido.", en: "Invalid image URL.", fr: "URL d'image invalide." }
    : !/^\d{2}:\d{2}$/.test(form.openingTime) || !/^\d{2}:\d{2}$/.test(form.closingTime) ? { pt: "Horário inválido.", en: "Invalid hours.", fr: "Horaires invalides." }
    : !isInt(form.deliveryFee, 0, 100000) ? { pt: "Taxa de entrega inválida.", en: "Invalid delivery fee.", fr: "Frais de livraison invalides." }
    : !isInt(form.minOrder, 0, 1000000) ? { pt: "Pedido mínimo inválido.", en: "Invalid minimum order.", fr: "Minimum de commande invalide." }
    : !isInt(form.prepTimeMin, 1, 240) ? { pt: "Tempo de preparação entre 1 e 240 min.", en: "Prep time between 1 and 240 min.", fr: "Préparation entre 1 et 240 min." }
    : !isInt(form.deliveryTimeMin, 5, 300) ? { pt: "Tempo de entrega entre 5 e 300 min.", en: "Delivery time between 5 and 300 min.", fr: "Livraison entre 5 et 300 min." }
    : !isInt(form.minNoticeHours, 0, 168) ? { pt: "Antecedência entre 0 e 168 horas.", en: "Notice between 0 and 168 hours.", fr: "Délai entre 0 et 168 heures." }
    : form.maxOrdersPerDay !== "" && !isInt(form.maxOrdersPerDay, 1, 10000) ? { pt: "Limite diário inválido.", en: "Invalid daily limit.", fr: "Limite quotidienne invalide." }
    : form.payoutMethod && form.payoutReference.trim().length < 9 ? { pt: "Indique o número/IBAN para receber.", en: "Enter the number/IBAN for payouts.", fr: "Indiquez le numéro/IBAN." }
    : null;

  const addCuisine = () => {
    const parts = cuisineInput.split(",").map((s) => s.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...form.cuisines];
    for (const p of parts) if (!next.some((c) => c.toLowerCase() === p.toLowerCase()) && next.length < 10) next.push(p.slice(0, 40));
    set("cuisines", next);
    setCuisineInput("");
  };

  const submit = () => {
    if (err) return;
    save.mutate({
      name: form.name.trim(), description: form.description.trim() || null, cuisines: form.cuisines,
      phone: form.phone.trim(), street: form.street.trim(), zone: form.zone.trim(), zonesServed: form.zonesServed,
      logoUrl: form.logoUrl.trim() || null, coverUrl: form.coverUrl.trim() || null,
      openingTime: form.openingTime, closingTime: form.closingTime, isOpen: form.isOpen,
      deliveryFee: Number(form.deliveryFee), minOrder: Number(form.minOrder),
      prepTimeMin: Number(form.prepTimeMin), deliveryTimeMin: Number(form.deliveryTimeMin),
      minNoticeMin: Number(form.minNoticeHours) * 60, maxOrdersPerDay: form.maxOrdersPerDay === "" ? null : Number(form.maxOrdersPerDay),
      payoutMethod: form.payoutMethod || null, payoutReference: form.payoutReference.trim() || null,
      theme: form.theme || null,
      latitude: form.pin?.latitude ?? null, longitude: form.pin?.longitude ?? null,
      offersPickup: form.offersPickup, ownDelivery: form.ownDelivery,
    });
  };

  const zoneOptions = zones.includes(form.zone) || !form.zone ? zones : [form.zone, ...zones];

  return (
    <form className="mx-auto max-w-3xl space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t({ pt: "Definições da loja", en: "Store settings", fr: "Paramètres du magasin" })}</h1>
        <Link href={`/loja/${store.id}`} className="inline-flex items-center gap-1 text-sm font-medium text-primary underline-offset-4 hover:underline">
          {t({ pt: "Ver loja como cliente", en: "View store as customer", fr: "Voir comme client" })} <ExternalLink className="h-4 w-4" />
        </Link>
      </div>

      <Card title={{ pt: "Informação", en: "Information", fr: "Informations" }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-name" label={{ pt: "Nome", en: "Name", fr: "Nom" }} className="sm:col-span-2">
            <Input id="st-name" value={form.name} maxLength={100} onChange={(e) => set("name", e.target.value)} />
          </Field>
          <Field id="st-desc" label={{ pt: "Descrição", en: "Description", fr: "Description" }} className="sm:col-span-2">
            <Textarea id="st-desc" value={form.description} maxLength={500} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field id="st-cuisine" label={vocab.categories} className="sm:col-span-2">
            <div className="flex gap-2">
              <Input id="st-cuisine" value={cuisineInput} onChange={(e) => setCuisineInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addCuisine(); } }}
                placeholder={t(vocab.categoriesExample)} />
              <Button type="button" variant="outline" onClick={addCuisine}>{t(T.add)}</Button>
            </div>
            {form.cuisines.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {form.cuisines.map((c) => (
                  <span key={c} className="inline-flex items-center gap-1 rounded-full bg-neutral-100 py-1 pl-3 pr-1 text-sm">
                    {c}
                    <button type="button" className="rounded-full p-1 hover:bg-neutral-200" aria-label={`${t(T.remove)} ${c}`}
                      onClick={() => set("cuisines", form.cuisines.filter((x) => x !== c))}><X className="h-3 w-3" /></button>
                  </span>
                ))}
              </div>
            )}
          </Field>
          <Field id="st-phone" label={{ pt: "Telemóvel", en: "Phone", fr: "Téléphone" }}>
            <Input id="st-phone" type="tel" value={form.phone} maxLength={20} onChange={(e) => set("phone", e.target.value)} />
          </Field>
          <Field id="st-zone" label={{ pt: "Zona", en: "Zone", fr: "Zone" }}>
            <Select value={form.zone || undefined} onValueChange={(v) => set("zone", v)}>
              <SelectTrigger id="st-zone"><SelectValue placeholder={t({ pt: "Escolher", en: "Choose", fr: "Choisir" })} /></SelectTrigger>
              <SelectContent>{zoneOptions.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field id="st-street" label={{ pt: "Morada", en: "Address", fr: "Adresse" }} className="sm:col-span-2">
            <Input id="st-street" value={form.street} maxLength={200} onChange={(e) => set("street", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={{ pt: "Localização no mapa", en: "Location on the map", fr: "Position sur la carte" }}>
        <p className="mb-2 text-sm text-neutral-600">
          {t({ pt: "Os estafetas usam este pino para chegar à loja, e mandamos cada entrega ao estafeta mais perto. Toque no mapa ou arraste o pino.", en: "Riders use this pin to reach the store, and each delivery goes to the nearest rider. Tap the map or drag the pin.", fr: "Les livreurs utilisent ce repère pour venir au magasin, et chaque livraison va au livreur le plus proche. Touchez la carte ou déplacez le repère." })}
        </p>
        <PinPicker value={form.pin} onChange={(p) => set("pin", p)} emoji="🏪" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" disabled={locating} onClick={useHere}>
            📍 {locating ? t({ pt: "A localizar…", en: "Locating…", fr: "Localisation…" }) : t({ pt: "Estou na loja: usar a minha localização", en: "I'm at the store: use my location", fr: "Je suis au magasin : utiliser ma position" })}
          </Button>
          {!form.pin && <span className="text-xs font-semibold text-red-700">{t({ pt: "Sem localização: os estafetas não a encontram no mapa.", en: "No location: riders can't find it on the map.", fr: "Pas de position : les livreurs ne la trouvent pas." })}</span>}
        </div>
      </Card>

      <Card title={{ pt: "Formas de entrega", en: "How orders reach customers", fr: "Modes de livraison" }}>
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <Label htmlFor="own-delivery" className="cursor-pointer">
              <span className="block font-semibold">🛵 {t({ pt: "Entrego com os meus estafetas", en: "I deliver with my own riders", fr: "Je livre avec mes livreurs" })}</span>
              <span className="block text-xs font-normal text-neutral-600">{rates
                ? t({ pt: `Comissão ${rates.storeDelivery}% (em vez de ${rates.delivery}%). A taxa de entrega e as gorjetas ficam para si; marca "Saiu" e "Entregue" com o código do cliente.`, en: `Commission ${rates.storeDelivery}% (instead of ${rates.delivery}%). You keep the delivery fee and tips; you mark "Out" and "Delivered" with the customer's code.`, fr: `Commission ${rates.storeDelivery} % (au lieu de ${rates.delivery} %). Frais de livraison et pourboires pour vous ; marquez « Partie » et « Livrée » avec le code du client.` })
                : ""}</span>
            </Label>
            <Switch id="own-delivery" checked={form.ownDelivery} onCheckedChange={(v) => set("ownDelivery", v)} />
          </div>
          <div className="flex items-start justify-between gap-3">
            <Label htmlFor="offers-pickup" className="cursor-pointer">
              <span className="block font-semibold">🛍️ {t({ pt: "Os clientes podem levantar na loja", en: "Customers can pick up at the store", fr: "Retrait en magasin possible" })}</span>
              <span className="block text-xs font-normal text-neutral-600">{rates
                ? t({ pt: `Comissão ${rates.pickup}% nessas encomendas. Sem estafeta: o cliente mostra o código ao balcão.`, en: `Commission ${rates.pickup}% on those orders. No rider: the customer shows a code at the counter.`, fr: `Commission ${rates.pickup} % sur ces commandes. Sans livreur : le client montre un code au comptoir.` })
                : ""}</span>
            </Label>
            <Switch id="offers-pickup" checked={form.offersPickup} onCheckedChange={(v) => set("offersPickup", v)} />
          </div>
          {!form.ownDelivery && rates && <p className="text-xs text-neutral-500">{t({ pt: `Por defeito as entregas são feitas por estafetas PedeJá (comissão ${rates.delivery}%).`, en: `By default PedeJá riders deliver (commission ${rates.delivery}%).`, fr: `Par défaut, les livreurs PedeJá livrent (commission ${rates.delivery} %).` })}</p>}
        </div>
      </Card>

      <Card title={{ pt: "Zonas de entrega", en: "Delivery zones", fr: "Zones de livraison" }}>
        <p className="mb-2 text-sm text-neutral-600">
          {form.zonesServed.length === 0
            ? t({ pt: "Nenhuma seleccionada: entrega em toda Luanda.", en: "None selected: delivers across all of Luanda.", fr: "Aucune sélection : livraison dans tout Luanda." })
            : t({ pt: `Entrega em ${form.zonesServed.length} zonas.`, en: `Delivers to ${form.zonesServed.length} zones.`, fr: `Livraison dans ${form.zonesServed.length} zones.` })}
        </p>
        {metaQ.isLoading ? <Loading /> : (
          <div className="flex flex-wrap gap-2">
            {zones.map((z) => {
              const on = form.zonesServed.includes(z);
              return (
                <button type="button" key={z} aria-pressed={on}
                  onClick={() => set("zonesServed", on ? form.zonesServed.filter((x) => x !== z) : [...form.zonesServed, z])}
                  className={cn("min-h-9 rounded-full border px-3 text-sm", on ? "border-primary bg-primary/10 font-medium text-primary" : "bg-white text-neutral-700")}>
                  {z}
                </button>
              );
            })}
            {form.zonesServed.length > 0 && (
              <Button type="button" variant="ghost" size="sm" onClick={() => set("zonesServed", [])}>
                {t({ pt: "Toda Luanda", en: "All of Luanda", fr: "Tout Luanda" })}
              </Button>
            )}
          </div>
        )}
      </Card>

      <Card title={{ pt: "Imagens", en: "Images", fr: "Images" }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-logo" label={{ pt: "URL do logótipo", en: "Logo URL", fr: "URL du logo" }}>
            <Input id="st-logo" type="text" inputMode="url" placeholder="https://… ou /caminho/local" value={form.logoUrl} onChange={(e) => set("logoUrl", e.target.value)} />
          </Field>
          <Field id="st-cover" label={{ pt: "URL da capa", en: "Cover URL", fr: "URL de couverture" }}>
            <Input id="st-cover" type="text" inputMode="url" placeholder="https://… ou /caminho/local" value={form.coverUrl} onChange={(e) => set("coverUrl", e.target.value)} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <StoreImage name={form.name || "?"} url={isUrl(form.logoUrl) ? form.logoUrl.trim() || null : null} className="h-14 w-14" rounded="rounded-full" />
          <StoreImage name={form.name || "?"} url={isUrl(form.coverUrl) ? form.coverUrl.trim() || null : null} className="h-14 w-40 text-lg" />
        </div>
      </Card>

      <Card title={{ pt: "Horário e entrega", en: "Hours & delivery", fr: "Horaires et livraison" }}>
        <div className="mb-3 flex items-center gap-2">
          <Switch id="st-open" checked={form.isOpen} onCheckedChange={(v) => set("isOpen", v)} />
          <Label htmlFor="st-open">{form.isOpen ? t(T.open) : t(T.closed)}</Label>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="st-opening" label={{ pt: "Abre às", en: "Opens at", fr: "Ouvre à" }}>
            <Input id="st-opening" type="time" value={form.openingTime} onChange={(e) => set("openingTime", e.target.value)} />
          </Field>
          <Field id="st-closing" label={{ pt: "Fecha às", en: "Closes at", fr: "Ferme à" }}>
            <Input id="st-closing" type="time" value={form.closingTime} onChange={(e) => set("closingTime", e.target.value)} />
          </Field>
          <Field id="st-fee" label={{ pt: "Taxa de entrega (Kz)", en: "Delivery fee (Kz)", fr: "Frais de livraison (Kz)" }}>
            <Input id="st-fee" type="number" min={0} step={1} value={form.deliveryFee} onChange={(e) => set("deliveryFee", e.target.value)} />
          </Field>
          <Field id="st-min" label={{ pt: "Pedido mínimo (Kz)", en: "Minimum order (Kz)", fr: "Commande minimum (Kz)" }}>
            <Input id="st-min" type="number" min={0} step={1} value={form.minOrder} onChange={(e) => set("minOrder", e.target.value)} />
          </Field>
          <Field id="st-prep" label={{ pt: "Tempo de preparação (min)", en: "Prep time (min)", fr: "Temps de préparation (min)" }}>
            <Input id="st-prep" type="number" min={1} max={240} value={form.prepTimeMin} onChange={(e) => set("prepTimeMin", e.target.value)} />
          </Field>
          <Field id="st-dt" label={{ pt: "Tempo total de entrega estimado (min)", en: "Estimated total delivery time (min)", fr: "Délai total de livraison estimé (min)" }}>
            <Input id="st-dt" type="number" min={5} max={300} value={form.deliveryTimeMin} onChange={(e) => set("deliveryTimeMin", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={{ pt: "Encomendas antecipadas e capacidade", en: "Pre-orders & capacity", fr: "Commandes anticipées et capacité" }}>
        <p className="mb-3 text-sm text-neutral-600">{t({
          pt: "Ideal para negócios caseiros e bolos por encomenda: os clientes só podem agendar com a antecedência que escolher, e não recebe mais encomendas por dia do que consegue fazer.",
          en: "Ideal for home businesses and made-to-order cakes: customers must book with the notice you set, and you never get more orders per day than you can make.",
          fr: "Idéal pour les activités à domicile : les clients réservent avec le délai choisi et vous ne recevez pas plus de commandes que vous ne pouvez en préparer.",
        })}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="st-notice" label={{ pt: "Antecedência mínima (horas, 0 = aceita para já)", en: "Minimum notice (hours, 0 = on demand)", fr: "Délai minimum (heures, 0 = immédiat)" }}>
            <Input id="st-notice" type="number" min={0} max={168} value={form.minNoticeHours} onChange={(e) => set("minNoticeHours", e.target.value)} />
          </Field>
          <Field id="st-cap" label={{ pt: "Máximo de encomendas por dia (vazio = sem limite)", en: "Max orders per day (empty = no limit)", fr: "Commandes max par jour (vide = illimité)" }}>
            <Input id="st-cap" type="number" min={1} value={form.maxOrdersPerDay} onChange={(e) => set("maxOrdersPerDay", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card title={{ pt: "Como recebe os pagamentos", en: "How you get paid", fr: "Comment vous êtes payé" }}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="st-payout" label={{ pt: "Método", en: "Method", fr: "Méthode" }}>
            <select id="st-payout" className="h-10 w-full rounded-md border bg-white px-3 text-sm" value={form.payoutMethod} onChange={(e) => set("payoutMethod", e.target.value)}>
              <option value="">{t({ pt: "— escolher —", en: "— choose —", fr: "— choisir —" })}</option>
              <option value="multicaixa_express">Multicaixa Express</option>
              <option value="unitel_money">Unitel Money</option>
              <option value="bank_transfer">{t({ pt: "Transferência bancária (IBAN)", en: "Bank transfer (IBAN)", fr: "Virement (IBAN)" })}</option>
            </select>
          </Field>
          <Field id="st-payref" label={{ pt: "Número de telemóvel ou IBAN", en: "Phone number or IBAN", fr: "Numéro ou IBAN" }}>
            <Input id="st-payref" value={form.payoutReference} onChange={(e) => set("payoutReference", e.target.value)} placeholder="+244 9XX XXX XXX / AO06…" />
          </Field>
        </div>
      </Card>

      <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t bg-neutral-50/95 py-3 backdrop-blur">
        {err && <p className="mr-auto text-sm text-red-600" role="alert">{t(err)}</p>}
        <Button type="submit" disabled={!!err || save.isPending}>{t(T.save)}</Button>
      </div>
    </form>
  );
}

/** Integração com o sistema de cozinha / POS: chave de API e webhook assinado. */
function PosIntegration() {
  const t = useT();
  const vocab = useStoreVocab();
  const { toast } = useToast();
  const q = useQuery<{ keyActive: boolean; keyHint: string | null; webhookUrl: string | null }>({ queryKey: ["/api/partner/integration"] });
  const [shown, setShown] = useState<{ label: string; value: string } | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => { if (q.data) setUrl(q.data.webhookUrl ?? ""); }, [q.data?.webhookUrl]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/partner/integration"] });
  const fail = (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message });
  const genKey = useMutation({
    mutationFn: () => post<{ key: string }>("/api/partner/integration/key"),
    onSuccess: (d) => { setShown({ label: t({ pt: "Chave de API", en: "API key", fr: "Clé API" }), value: d.key }); refresh(); },
    onError: fail,
  });
  const revoke = useMutation({ mutationFn: () => del("/api/partner/integration/key"), onSuccess: () => { setShown(null); refresh(); }, onError: fail });
  const saveHook = useMutation({
    mutationFn: () => put<{ webhookUrl: string | null; secret?: string }>("/api/partner/integration/webhook", { url: url.trim() || null }),
    onSuccess: (d) => {
      if (d.secret) setShown({ label: t({ pt: "Segredo do webhook", en: "Webhook secret", fr: "Secret du webhook" }), value: d.secret });
      toast({ title: t({ pt: "Webhook guardado", en: "Webhook saved", fr: "Webhook enregistré" }) });
      refresh();
    },
    onError: fail,
  });
  const test = useMutation({
    mutationFn: () => post<{ delivered: boolean; status: number | null }>("/api/partner/integration/webhook/test"),
    onSuccess: (d) => toast(d.delivered
      ? { title: t({ pt: "Teste entregue ✓", en: "Test delivered ✓", fr: "Test livré ✓" }), description: `HTTP ${d.status}` }
      : { variant: "destructive", title: t({ pt: "O sistema não respondeu", en: "The system didn't respond", fr: "Le système n'a pas répondu" }), description: d.status ? `HTTP ${d.status}` : undefined }),
    onError: fail,
  });
  if (!q.data) return null;
  return (
    <div className="mx-auto mt-4 max-w-3xl">
      <Card title={vocab.integration}>
        <div className="space-y-4">
        <p className="text-sm text-neutral-600">
          {t({
            pt: "Ligue o seu sistema de caixa ou ecrã de cozinha: ele recebe as encomendas automaticamente e pode marcá-las como aceites, em preparação ou prontas. Também pode imprimir o talão de cada encomenda no separador Encomendas.",
            en: "Connect your till or kitchen screen: it receives orders automatically and can mark them accepted, preparing or ready. You can also print each order's ticket from the Orders tab.",
            fr: "Connectez votre caisse ou écran de cuisine : il reçoit les commandes automatiquement et peut les marquer acceptées, en préparation ou prêtes. Vous pouvez aussi imprimer le ticket depuis l'onglet Commandes.",
          })}
        </p>
        {shown && (
          <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3" role="alert">
            <p className="text-sm font-semibold">{shown.label} — {t({ pt: "copie agora, não será mostrada outra vez", en: "copy it now, it won't be shown again", fr: "copiez-la maintenant, elle ne sera plus affichée" })}</p>
            <div className="mt-2 flex gap-2">
              <Input readOnly value={shown.value} className="font-mono text-xs" onFocus={(e) => e.currentTarget.select()} />
              <Button type="button" variant="outline" onClick={() => { void navigator.clipboard?.writeText(shown.value); toast({ title: t({ pt: "Copiado", en: "Copied", fr: "Copié" }) }); }}>
                {t({ pt: "Copiar", en: "Copy", fr: "Copier" })}
              </Button>
            </div>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-semibold">1. {t({ pt: "Chave de API", en: "API key", fr: "Clé API" })}</p>
          <p className="text-sm text-neutral-600">
            {q.data.keyActive
              ? <>{t({ pt: "Activa", en: "Active", fr: "Active" })}: <span className="font-mono">{q.data.keyHint}</span></>
              : t({ pt: "Ainda não criou uma chave.", en: "No key yet.", fr: "Pas encore de clé." })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={genKey.isPending} onClick={() => genKey.mutate()}>
              {q.data.keyActive ? t({ pt: "Gerar nova chave", en: "Generate new key", fr: "Nouvelle clé" }) : t({ pt: "Criar chave", en: "Create key", fr: "Créer une clé" })}
            </Button>
            {q.data.keyActive && (
              <Button type="button" variant="ghost" className="text-red-700" disabled={revoke.isPending} onClick={() => revoke.mutate()}>
                {t({ pt: "Desactivar", en: "Revoke", fr: "Révoquer" })}
              </Button>
            )}
          </div>
          <p className="text-xs text-neutral-500">
            {t({ pt: "O seu fornecedor de POS usa:", en: "Your POS provider uses:", fr: "Votre fournisseur de caisse utilise :" })}{" "}
            <code className="rounded bg-neutral-100 px-1">GET /api/pos/orders</code>, <code className="rounded bg-neutral-100 px-1">POST /api/pos/orders/:id/status</code>{" "}
            {t({ pt: "com o cabeçalho", en: "with the header", fr: "avec l'en-tête" })} <code className="rounded bg-neutral-100 px-1">Authorization: Bearer &lt;chave&gt;</code>.
          </p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="pos-webhook" className="text-sm font-semibold">2. {t({ pt: "Webhook (opcional)", en: "Webhook (optional)", fr: "Webhook (facultatif)" })}</Label>
          <p className="text-xs text-neutral-500">
            {t({
              pt: "Avisamos este endereço (https) a cada encomenda nova ou mudança de estado. Cada aviso vem assinado (cabeçalho X-PedeJa-Signature, HMAC-SHA256) para o seu sistema confirmar que vem da PedeJá.",
              en: "We notify this https address on every new order or status change. Each call is signed (X-PedeJa-Signature header, HMAC-SHA256) so your system can verify it came from PedeJá.",
              fr: "Nous notifions cette adresse https à chaque nouvelle commande ou changement de statut. Chaque appel est signé (en-tête X-PedeJa-Signature, HMAC-SHA256).",
            })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input id="pos-webhook" type="url" inputMode="url" placeholder="https://pos.exemplo.ao/pedeja" value={url} onChange={(e) => setUrl(e.target.value)} className="min-w-0 flex-1" />
            <Button type="button" variant="outline" disabled={saveHook.isPending} onClick={() => saveHook.mutate()}>{t({ pt: "Guardar", en: "Save", fr: "Enregistrer" })}</Button>
            {q.data.webhookUrl && <Button type="button" variant="ghost" disabled={test.isPending} onClick={() => test.mutate()}>{t({ pt: "Enviar teste", en: "Send test", fr: "Envoyer un test" })}</Button>}
          </div>
        </div>
        </div>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: Tr; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="rounded-lg border bg-white p-4">
      <h2 className="mb-3 font-semibold">{t(title)}</h2>
      {children}
    </section>
  );
}

function Field({ id, label, children, className }: { id: string; label: Tr; children: React.ReactNode; className?: string }) {
  const t = useT();
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>{t(label)}</Label>
      {children}
    </div>
  );
}
