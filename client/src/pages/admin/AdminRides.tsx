import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ShieldAlert } from "lucide-react";
import { ErrorState, Loading, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import { poll } from "@/lib/live";
import { CATEGORY, RIDE_STATUS, type Place, type RideCategory, type RideStatus } from "@/lib/taxi";
import { AdminPage } from "./AdminDashboard";

interface Person { id: number; name: string; phone: string }
interface AdminRide {
  id: number; rideNumber: string; status: RideStatus; category: RideCategory; pickup: Place; dropoff: Place;
  fare: number; waitFee: number; total: number; paymentMethod: string; commissionAmount: number | null; driverEarning: number | null;
  rating: number | null; sosAt: string | null; sosBy: string | null; createdAt: string; completedAt: string | null;
  customer: Person | null; driver: Person | null;
}
interface Res { summary: { rides: number; gross: number; commission: number; active: number; noDriver: number; sos: number }; commissionPct: number; rides: AdminRide[] }

const FILTERS: { id: string; label: { pt: string; en: string; fr: string } }[] = [
  { id: "", label: { pt: "Todas", en: "All", fr: "Toutes" } },
  { id: "searching", label: { pt: "À procura", en: "Searching", fr: "Recherche" } },
  { id: "in_progress", label: { pt: "Em viagem", en: "On trip", fr: "En course" } },
  { id: "completed", label: { pt: "Concluídas", en: "Completed", fr: "Terminées" } },
  { id: "no_driver", label: { pt: "Sem motorista", en: "No driver", fr: "Sans chauffeur" } },
  { id: "sos", label: { pt: "SOS", en: "SOS", fr: "SOS" } },
];

export default function AdminRides() {
  return <AdminPage><RidesContent /></AdminPage>;
}

function RidesContent() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const url = filter === "sos" ? "/api/admin/rides?sos=1" : filter ? `/api/admin/rides?status=${filter}` : "/api/admin/rides";
  const q = useQuery<Res>({ queryKey: [url], refetchInterval: poll(10_000, 30_000) });
  const cancel = useMutation({
    mutationFn: (id: number) => post(`/api/admin/rides/${id}/cancel`, {}),
    onSuccess: () => { queryClient.invalidateQueries({ predicate: (qq) => String(qq.queryKey[0]).startsWith("/api/admin/rides") }); toast({ title: t({ pt: "Viagem cancelada", en: "Trip cancelled", fr: "Course annulée" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const s = q.data?.summary;
  const tile = (label: string, value: string, alert?: boolean) => (
    <div className={cn("rounded-xl border bg-white p-3", alert && "border-red-300 bg-red-50")}><p className="text-xs text-neutral-600">{label}</p><p className="text-xl font-extrabold tabular-nums">{value}</p></div>
  );
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">{t({ pt: "Táxi — viagens", en: "Taxi — trips", fr: "Taxi — courses" })}</h1>
      {s && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-6">
          {tile(t({ pt: "Concluídas (30 dias)", en: "Completed (30 days)", fr: "Terminées (30 j)" }), String(s.rides))}
          {tile(t({ pt: "Valor das viagens", en: "Trip value", fr: "Valeur des courses" }), kz(s.gross))}
          {tile(t({ pt: `Comissão PedeJá (${q.data!.commissionPct}%)`, en: `PedeJá commission (${q.data!.commissionPct}%)`, fr: `Commission (${q.data!.commissionPct} %)` }), kz(s.commission))}
          {tile(t({ pt: "Em curso agora", en: "Active now", fr: "En cours" }), String(s.active))}
          {tile(t({ pt: "Sem motorista", en: "No driver", fr: "Sans chauffeur" }), String(s.noDriver))}
          {tile("SOS", String(s.sos), s.sos > 0)}
        </div>
      )}
      <div className="flex flex-wrap gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button key={f.id} role="tab" aria-selected={filter === f.id} onClick={() => setFilter(f.id)}
            className={cn("rounded-full border px-3 py-1 text-sm", filter === f.id ? "border-primary bg-brand-50 font-semibold text-primary" : "bg-white")}>{t(f.label)}</button>
        ))}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : !q.data!.rides.length ? (
        <EmptyState icon="🚕" title={t({ pt: "Sem viagens", en: "No trips", fr: "Aucune course" })} />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-600">
              <tr><th className="p-2">{t({ pt: "Viagem", en: "Trip", fr: "Course" })}</th><th className="p-2">{t({ pt: "Percurso", en: "Route", fr: "Trajet" })}</th>
                <th className="p-2">{t({ pt: "Passageiro / motorista", en: "Passenger / driver", fr: "Passager / chauffeur" })}</th>
                <th className="p-2 text-right">{t({ pt: "Valor", en: "Amount", fr: "Montant" })}</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {q.data!.rides.map((r) => (
                <tr key={r.id} className={cn("border-t align-top", r.sosAt && "bg-red-50")}>
                  <td className="p-2">
                    <p className="font-medium">{CATEGORY[r.category].icon} {r.rideNumber}</p>
                    <p className="text-xs">{t(RIDE_STATUS[r.status])}</p>
                    <p className="text-xs text-neutral-500">{dateTime(r.createdAt, lang)}</p>
                    {r.sosAt && <p className="mt-1 flex items-center gap-1 text-xs font-bold text-red-700"><ShieldAlert className="h-3 w-3" />SOS ({r.sosBy}) {dateTime(r.sosAt, lang)}</p>}
                  </td>
                  <td className="p-2 text-xs">{r.pickup.zone || r.pickup.label}<br />→ {r.dropoff.zone || r.dropoff.label}</td>
                  <td className="p-2 text-xs">
                    {r.customer && <p>{r.customer.name} · <a className="underline" href={`tel:${r.customer.phone}`}>{r.customer.phone}</a></p>}
                    {r.driver ? <p>🚕 {r.driver.name} · <a className="underline" href={`tel:${r.driver.phone}`}>{r.driver.phone}</a></p> : <p className="text-neutral-500">—</p>}
                  </td>
                  <td className="p-2 text-right tabular-nums">
                    <p className="font-semibold">{kz(r.status === "completed" ? r.total : r.fare)}</p>
                    {r.commissionAmount != null && <p className="text-xs text-neutral-500">{t({ pt: "comissão", en: "commission", fr: "commission" })} {kz(r.commissionAmount)}</p>}
                    {r.rating && <p className="text-xs">{"★".repeat(r.rating)}</p>}
                  </td>
                  <td className="p-2 text-right">
                    {["searching", "accepted", "arrived", "no_driver"].includes(r.status) && (
                      <Button size="sm" variant="outline" className="text-red-700" disabled={cancel.isPending} onClick={() => cancel.mutate(r.id)}>{t({ pt: "Cancelar", en: "Cancel", fr: "Annuler" })}</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
