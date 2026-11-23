import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

export interface AdRow {
  id: number; storeId: number; storeName: string; startsAt: string; endsAt: string; days: number; price: number;
  status: "active" | "cancelled"; state: "running" | "scheduled" | "ended" | "cancelled"; impressions: number; clicks: number; ctr: number; refund: number;
}
export const AD_STATE: Record<AdRow["state"], { pt: string; en: string; fr: string }> = {
  running: { pt: "A decorrer", en: "Running", fr: "En cours" },
  scheduled: { pt: "Agendada", en: "Scheduled", fr: "Programmée" },
  ended: { pt: "Terminada", en: "Ended", fr: "Terminée" },
  cancelled: { pt: "Cancelada", en: "Cancelled", fr: "Annulée" },
};

export default function PartnerAds() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <div className="mx-auto max-w-2xl"><Content /></div>
      </PanelShell>
    </Guard>
  );
}

function Content() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const KEY = "/api/partner/ads";
  const q = useQuery<{ ads: AdRow[]; pricePerDay: number; days: number[]; maxSlots: number }>({ queryKey: [KEY] });
  const [days, setDays] = useState(7);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: [KEY] }); queryClient.invalidateQueries({ queryKey: ["/api/partner/finance"] }); };
  const buy = useMutation({
    mutationFn: () => post(KEY, { days }),
    onSuccess: () => { refresh(); toast({ title: t({ pt: "Destaque activado 🚀", en: "Boost activated 🚀", fr: "Mise en avant activée 🚀" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const cancel = useMutation({
    mutationFn: (id: number) => post(`${KEY}/${id}/cancel`),
    onSuccess: refresh,
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border-2 border-primary bg-white p-4">
        <h1 className="text-lg font-bold">🚀 {t({ pt: "Apareça em primeiro", en: "Show up first", fr: "Apparaissez en premier" })}</h1>
        <p className="mt-1 text-sm text-neutral-600">{t({ pt: `A sua loja aparece no topo das pesquisas e listas onde já apareceria (mesmos filtros e zonas), com a etiqueta "Patrocinado". No máximo ${d.maxSlots} lojas patrocinadas por lista, em rotação.`, en: `Your store appears at the top of searches and lists it already matches (same filters and zones), labelled "Sponsored". At most ${d.maxSlots} sponsored stores per list, rotated.`, fr: `Votre magasin apparaît en tête des recherches et listes où il figure déjà (mêmes filtres et zones), avec l'étiquette « Sponsorisé ». Au maximum ${d.maxSlots} par liste, en rotation.` })}</p>
        <div role="radiogroup" aria-label={t({ pt: "Duração", en: "Duration", fr: "Durée" })} className="mt-3 grid grid-cols-3 gap-2">
          {d.days.map((n) => (
            <button key={n} type="button" role="radio" aria-checked={days === n} onClick={() => setDays(n)}
              className={cn("rounded-xl border-2 p-2 text-center", days === n ? "border-primary bg-brand-50" : "border-neutral-200")}>
              <span className="block font-bold">{t({ pt: `${n} dias`, en: `${n} days`, fr: `${n} jours` })}</span>
              <span className="block text-sm">{kz(n * d.pricePerDay)}</span>
            </button>
          ))}
        </div>
        <Button className="mt-3 w-full" disabled={buy.isPending} onClick={() => buy.mutate()}>
          {t({ pt: `Activar ${days} dias por ${kz(days * d.pricePerDay)}`, en: `Activate ${days} days for ${kz(days * d.pricePerDay)}`, fr: `Activer ${days} jours pour ${kz(days * d.pricePerDay)}` })}
        </Button>
        <p className="mt-1 text-xs text-neutral-500">{t({ pt: "O valor é descontado do seu saldo (sai do próximo pagamento). Se já tiver uma campanha, a nova começa quando a actual acabar. Cancelar devolve os dias por usar.", en: "Charged to your balance (taken from your next payout). A new boost starts when the current one ends. Cancelling refunds unused days.", fr: "Déduit de votre solde (prochain paiement). Une nouvelle campagne commence à la fin de l'actuelle. Annuler rembourse les jours non utilisés." })}</p>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-2 font-bold">{t({ pt: "As minhas campanhas", en: "My boosts", fr: "Mes campagnes" })}</h2>
        {!d.ads.length ? <p className="text-sm text-neutral-500">{t({ pt: "Ainda não fez nenhuma.", en: "None yet.", fr: "Aucune pour l'instant." })}</p> : (
          <ul className="divide-y">
            {d.ads.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <b>{t(AD_STATE[a.state])}</b> · {dateTime(a.startsAt, lang)} → {dateTime(a.endsAt, lang)}
                  <span className="block text-xs text-neutral-600">{t({ pt: `${a.impressions} vezes mostrada · ${a.clicks} cliques (${a.ctr}%)`, en: `${a.impressions} views · ${a.clicks} clicks (${a.ctr}%)`, fr: `${a.impressions} affichages · ${a.clicks} clics (${a.ctr} %)` })}{a.refund ? ` · ${t({ pt: "devolvido", en: "refunded", fr: "remboursé" })} ${kz(a.refund)}` : ""}</span>
                </span>
                <span className="font-semibold">{kz(a.price)}</span>
                {(a.state === "running" || a.state === "scheduled") && (
                  <Button size="sm" variant="ghost" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>{t(T.cancel)}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
