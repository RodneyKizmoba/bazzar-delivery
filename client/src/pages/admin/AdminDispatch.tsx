import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminPage } from "./AdminDashboard";
import { Loading, ErrorState, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, time } from "@/lib/format";
import { poll } from "@/lib/live";
import { cn } from "@/lib/utils";

interface Rider { id: number; name: string; phone: string; isOnline: boolean | null; latitude: number | null; longitude: number | null; locationAt: string | null; currentOrderId: number | null }
interface Waiting {
  id: number; orderNumber: string; status: string; storeName: string; readyEstimateAt: string | null; dispatchAt: string | null;
  dispatchRound: number; dispatchFailedAt: string | null; priority: boolean; offeredTo: number | null;
}
interface OfferRow { id: number; orderId: number; driverId: number; driverName: string; status: string; round: number; distanceKm: number | null; payout: number; offeredAt: string; respondedAt: string | null }

const KEY = "/api/admin/dispatch";

const OFFER_LABEL: Record<string, { pt: string; en: string; fr: string }> = {
  pending: { pt: "à espera", en: "waiting", fr: "en attente" },
  accepted: { pt: "aceite", en: "accepted", fr: "acceptée" },
  declined: { pt: "recusou", en: "declined", fr: "refusée" },
  expired: { pt: "sem resposta", en: "no answer", fr: "sans réponse" },
  cancelled: { pt: "cancelada", en: "cancelled", fr: "annulée" },
};

export default function AdminDispatch() {
  return <AdminPage><DispatchBoard /></AdminPage>;
}

function DispatchBoard() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const q = useQuery<{ riders: Rider[]; waiting: Waiting[]; offers: OfferRow[] }>({ queryKey: [KEY], refetchInterval: poll(5000, 15_000) });
  const retry = useMutation({
    mutationFn: (id: number) => post(`/api/admin/orders/${id}/redispatch`),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [KEY] }); toast({ title: t({ pt: "A procurar estafeta outra vez", en: "Looking for a rider again", fr: "Nouvelle recherche de livreur" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const { riders, waiting, offers } = q.data!;
  const name = (id: number | null) => riders.find((r) => r.id === id)?.name ?? `#${id}`;
  const online = riders.filter((r) => r.isOnline);
  const failed = waiting.filter((w) => w.dispatchFailedAt);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-3">
        <Stat label={t({ pt: "Estafetas online", en: "Riders online", fr: "Livreurs en ligne" })} value={online.length} />
        <Stat label={t({ pt: "Livres agora", en: "Free now", fr: "Libres" })} value={online.filter((r) => !r.currentOrderId).length} />
        <Stat label={t({ pt: "Sem estafeta", en: "Without rider", fr: "Sans livreur" })} value={waiting.length} alert={failed.length > 0} />
      </div>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t({ pt: "Entregas à espera de estafeta", en: "Deliveries waiting for a rider", fr: "Livraisons en attente de livreur" })}</h2>
        {!waiting.length ? <EmptyState icon="✅" title={t({ pt: "Todas as entregas têm estafeta", en: "Every delivery has a rider", fr: "Toutes les livraisons ont un livreur" })} /> : (
          <ul className="space-y-2">
            {waiting.map((w) => (
              <li key={w.id} className={cn("flex flex-wrap items-center gap-3 rounded-lg border bg-white p-3", w.dispatchFailedAt && "border-2 border-red-500 bg-red-50")}>
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-bold">{w.orderNumber} {w.priority && <span className="text-primary">⚡</span>}</p>
                  <p className="text-sm text-neutral-600">{w.storeName}{w.readyEstimateAt && <> · {t({ pt: "pronta às", en: "ready at", fr: "prête à" })} {time(w.readyEstimateAt, lang)}</>}</p>
                  <p className="text-xs font-semibold">
                    {w.dispatchFailedAt
                      ? <span className="text-red-700">⚠ {t({ pt: `Ninguém aceitou (${w.dispatchRound} tentativas) — está na lista aberta. Atribua em Encomendas ou tente de novo.`, en: `Nobody accepted (${w.dispatchRound} tries) — it's on the open list. Assign in Orders or try again.`, fr: `Personne n'a accepté (${w.dispatchRound} essais) — liste ouverte. Assignez dans Commandes ou réessayez.` })}</span>
                      : w.offeredTo
                        ? <span className="text-primary">{t({ pt: `Oferecida a ${name(w.offeredTo)} (tentativa ${w.dispatchRound})`, en: `Offered to ${name(w.offeredTo)} (try ${w.dispatchRound})`, fr: `Proposée à ${name(w.offeredTo)} (essai ${w.dispatchRound})` })}</span>
                        : w.dispatchAt && new Date(w.dispatchAt) > new Date()
                          ? <span className="text-neutral-600">{t({ pt: `Procura estafeta a partir das ${time(w.dispatchAt, lang)}`, en: `Looks for a rider from ${time(w.dispatchAt, lang)}`, fr: `Recherche un livreur à partir de ${time(w.dispatchAt, lang)}` })}</span>
                          : <span className="text-neutral-600">{t({ pt: "A procurar o melhor estafeta…", en: "Finding the best rider…", fr: "Recherche du meilleur livreur…" })}</span>}
                  </p>
                </div>
                {w.dispatchFailedAt && (
                  <Button size="sm" disabled={retry.isPending} onClick={() => retry.mutate(w.id)}>{t({ pt: "Tentar de novo", en: "Try again", fr: "Réessayer" })}</Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t({ pt: "Estafetas", en: "Riders", fr: "Livreurs" })}</h2>
        <ul className="divide-y rounded-lg border bg-white">
          {riders.map((r) => (
            <li key={r.id} className="flex items-center gap-3 p-3 text-sm">
              <span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", r.isOnline ? (r.currentOrderId ? "bg-amber-500" : "bg-green-500") : "bg-neutral-300")} aria-hidden />
              <span className="flex-1 font-medium">{r.name}</span>
              <span className="text-xs text-neutral-500">
                {!r.isOnline ? t({ pt: "offline", en: "offline", fr: "hors ligne" })
                  : r.currentOrderId ? t({ pt: `em entrega #${r.currentOrderId}`, en: `on delivery #${r.currentOrderId}`, fr: `en livraison #${r.currentOrderId}` })
                    : t({ pt: "livre", en: "free", fr: "libre" })}
                {r.locationAt && <> · GPS {time(r.locationAt, lang)}</>}
              </span>
              <a href={`tel:${r.phone}`} className="text-xs font-semibold text-brand-800 underline">{r.phone}</a>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t({ pt: "Últimas ofertas", en: "Latest offers", fr: "Dernières offres" })}</h2>
        {!offers.length ? <p className="text-sm text-neutral-500">{t({ pt: "Ainda não há ofertas.", en: "No offers yet.", fr: "Pas encore d'offres." })}</p> : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr><th className="p-2">{t({ pt: "Hora", en: "Time", fr: "Heure" })}</th><th className="p-2">{t({ pt: "Encomenda", en: "Order", fr: "Commande" })}</th><th className="p-2">{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}</th><th className="p-2">km</th><th className="p-2">{t({ pt: "Ganho", en: "Payout", fr: "Gain" })}</th><th className="p-2">{t({ pt: "Resposta", en: "Answer", fr: "Réponse" })}</th></tr>
              </thead>
              <tbody>
                {offers.map((o) => (
                  <tr key={o.id} className="border-t">
                    <td className="p-2">{time(o.offeredAt, lang)}</td>
                    <td className="p-2">#{o.orderId} · {o.round}</td>
                    <td className="p-2">{o.driverName}</td>
                    <td className="p-2">{o.distanceKm != null ? o.distanceKm.toFixed(1) : "—"}</td>
                    <td className="p-2">{kz(o.payout)}</td>
                    <td className={cn("p-2 font-medium", o.status === "accepted" ? "text-green-700" : o.status === "pending" ? "text-primary" : "text-neutral-500")}>{t(OFFER_LABEL[o.status] ?? { pt: o.status, en: o.status, fr: o.status })}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, alert }: { label: string; value: number; alert?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-white p-3", alert && "border-red-500 bg-red-50")}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className={cn("text-2xl font-extrabold", alert && "text-red-700")}>{value}</p>
    </div>
  );
}
