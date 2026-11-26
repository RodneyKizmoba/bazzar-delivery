import { useMutation, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { patch, queryClient } from "@/lib/api";
import { useT, type Tr } from "@/lib/i18n";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

type Plan = "basic" | "standard" | "featured";
interface Rates {
  delivery: number; pickup: number; storeDelivery: number; plan: Plan; counterPrice: boolean; commissionFreeUntil: string | null; custom: boolean;
  options: { basic: number; standard: number; featured: number; pickup: number; selfDelivery: number; counterPricePts: number; freeDays: number };
}

const PLANS: { id: Plan; name: Tr; perks: Tr }[] = [
  { id: "basic", name: { pt: "Básico", en: "Basic", fr: "Basique" }, perks: { pt: "Só aparece quando o cliente procura a sua loja pelo nome.", en: "Only shown when customers search your store by name.", fr: "Visible seulement quand le client cherche votre magasin par son nom." } },
  { id: "standard", name: { pt: "Padrão", en: "Standard", fr: "Standard" }, perks: { pt: "Aparece nas listas e categorias, e nas ofertas PedeJá Plus.", en: "Shown in lists and categories, and in PedeJá Plus offers.", fr: "Visible dans les listes, catégories et offres PedeJá Plus." } },
  { id: "featured", name: { pt: "Destaque", en: "Featured", fr: "Vedette" }, perks: { pt: "Primeiro nas listas, antes das outras lojas abertas.", en: "First in lists, ahead of other open stores.", fr: "En tête des listes, avant les autres magasins ouverts." } },
];

/** Plano da loja (modelo Uber Eats): quanto maior a comissão, mais visibilidade; + compromisso "mesmo preço que no balcão". */
export function PlanPicker() {
  const t = useT();
  const { toast } = useToast();
  const q = useQuery<Rates>({ queryKey: ["/api/partner/commissions"] });
  const save = useMutation({
    mutationFn: (body: { plan?: Plan; counterPrice?: boolean }) => patch("/api/partner/plan", body),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/partner/commissions"] }); queryClient.invalidateQueries({ queryKey: ["/api/partner/finance"] }); toast({ title: t({ pt: "Plano actualizado", en: "Plan updated", fr: "Formule mise à jour" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  const r = q.data;
  if (!r) return null;
  const free = r.commissionFreeUntil && new Date(r.commissionFreeUntil) > new Date();
  return (
    <section aria-labelledby="plan-h" className="mx-auto mb-6 max-w-3xl rounded-2xl border bg-white p-4">
      <h2 id="plan-h" className="text-lg font-bold">{t({ pt: "Plano e comissão", en: "Plan and commission", fr: "Formule et commission" })}</h2>
      <p className="mt-1 text-sm text-neutral-600">{t({ pt: "A comissão PedeJá é cobrada sobre cada artigo vendido. Pode mudar de plano quando quiser; vale para as encomendas seguintes.", en: "PedeJá's commission is charged on every item sold. Change plan any time; it applies to the next orders.", fr: "La commission PedeJá s'applique à chaque article vendu. Changez de formule quand vous voulez." })}</p>
      {free && <p className="mt-2 rounded-lg bg-emerald-50 p-2 text-sm text-emerald-800">{t({ pt: `1.º mês sem comissão: até ${dateTime(r.commissionFreeUntil!)}.`, en: `First month free of commission: until ${dateTime(r.commissionFreeUntil!)}.`, fr: `Premier mois sans commission : jusqu'au ${dateTime(r.commissionFreeUntil!)}.` })}</p>}
      {r.custom && <p className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t({ pt: `Tem uma comissão negociada com a PedeJá: ${r.delivery}% nas entregas com estafeta PedeJá.`, en: `You have a negotiated commission: ${r.delivery}% on PedeJá-rider deliveries.`, fr: `Commission négociée : ${r.delivery} % sur les livraisons PedeJá.` })}</p>}
      <div role="radiogroup" aria-label={t({ pt: "Plano", en: "Plan", fr: "Formule" })} className="mt-3 grid gap-2 sm:grid-cols-3">
        {PLANS.map((p) => {
          const on = r.plan === p.id;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} disabled={save.isPending}
              onClick={() => !on && save.mutate({ plan: p.id })}
              className={cn("rounded-xl border p-3 text-left transition", on ? "border-teal-500 ring-2 ring-teal-500" : "hover:border-neutral-400")}>
              <span className="flex items-center justify-between font-semibold">{t(p.name)}{on && <Check className="h-4 w-4 text-teal-600" aria-hidden />}</span>
              <span className="mt-1 block text-2xl font-bold tabular-nums">{r.options[p.id]}%</span>
              <span className="mt-1 block text-xs text-neutral-600">{t(p.perks)}</span>
            </button>
          );
        })}
      </div>
      <p className="mt-2 text-xs text-neutral-500">{t({ pt: `Comissão nas entregas com estafeta PedeJá. Recolha na loja: ${r.options.pickup}%. Entrega com os seus estafetas: ${r.options.selfDelivery}%.`, en: `Commission on PedeJá-rider deliveries. Pickup: ${r.options.pickup}%. Your own riders: ${r.options.selfDelivery}%.`, fr: `Commission sur les livraisons PedeJá. Retrait : ${r.options.pickup} %. Vos livreurs : ${r.options.selfDelivery} %.` })}</p>
      <label className="mt-3 flex items-start justify-between gap-3 rounded-xl bg-neutral-50 p-3">
        <span>
          <span className="block text-sm font-semibold">{t({ pt: `Mesmo preço que no balcão (−${r.options.counterPricePts} pontos)`, en: `Same price as in store (−${r.options.counterPricePts} points)`, fr: `Même prix qu'en boutique (−${r.options.counterPricePts} points)` })}</span>
          <span className="block text-xs text-neutral-600">{t({ pt: "Compromete-se a não subir os preços na app. Os clientes confiam mais e paga menos comissão.", en: "You promise not to raise prices in the app. Customers trust you more and you pay less commission.", fr: "Vous vous engagez à ne pas augmenter les prix dans l'app. Moins de commission." })}</span>
        </span>
        <Switch checked={r.counterPrice} disabled={save.isPending} onCheckedChange={(v) => save.mutate({ counterPrice: v })}
          aria-label={t({ pt: "Mesmo preço que no balcão", en: "Same price as in store", fr: "Même prix qu'en boutique" })} />
      </label>
    </section>
  );
}
