import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Flag, MapPin, ShieldAlert } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { ErrorState, Loading } from "@/components/common";
import { OrderMap } from "@/components/OrderMap";
import { useLang, useT } from "@/lib/i18n";
import { time } from "@/lib/format";
import { CATEGORY, RIDE_STATUS, type Place, type RideCategory, type RideStatus, type Vehicle } from "@/lib/taxi";

interface Shared {
  rideNumber: string; status: RideStatus; category: RideCategory; pickup: Place; dropoff: Place;
  driver: { firstName: string; vehicle: Vehicle; rating: number | null } | null;
  driverLocation: { latitude: number; longitude: number } | null;
  startedAt: string | null; completedAt: string | null; sos: boolean; sosPhone: string;
}

/** Link partilhado: família e amigos acompanham a viagem (sem telefones nem código). */
export default function RideShare() {
  const t = useT();
  const { lang } = useLang();
  const { token } = useParams<{ token: string }>();
  const q = useQuery<{ ride: Shared }>({ queryKey: [`/api/taxi/share/${token}`], refetchInterval: 8000 });
  const r = q.data?.ride;
  return (
    <CustomerShell hideNav>
      <div className="space-y-4 px-4 py-4">
        <h1 className="text-xl font-extrabold">{t({ pt: "Viagem partilhada", en: "Shared trip", fr: "Course partagée" })}</h1>
        {q.isLoading ? <Loading /> : q.error || !r ? <ErrorState error={q.error ?? new Error("—")} /> : (
          <>
            <div className="rounded-2xl bg-brand-50 p-4" aria-live="polite">
              <p className="text-xs font-semibold uppercase text-brand-800">{CATEGORY[r.category].icon} {t(CATEGORY[r.category])} · {r.rideNumber}</p>
              <p className="mt-1 text-2xl font-extrabold">{t(RIDE_STATUS[r.status])}</p>
              {r.startedAt && <p className="text-sm text-neutral-700">{t({ pt: "Começou às", en: "Started at", fr: "Commencée à" })} {time(r.startedAt, lang)}{r.completedAt && <> · {t({ pt: "terminou às", en: "ended at", fr: "terminée à" })} {time(r.completedAt, lang)}</>}</p>}
            </div>
            {r.sos && (
              <p role="alert" className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm font-semibold text-red-800">
                <ShieldAlert className="h-5 w-5" />{t({ pt: `Foi pedida ajuda nesta viagem. Em caso de perigo ligue ${r.sosPhone}.`, en: `Help was requested on this trip. If in danger call ${r.sosPhone}.`, fr: `Une aide a été demandée. En cas de danger appelez le ${r.sosPhone}.` })}
              </p>
            )}
            <OrderMap store={r.pickup} destination={r.dropoff} driver={r.driverLocation} ride={r.category === "moto" ? "moto" : "car"}
              labels={{ store: t({ pt: "Partida", en: "Pickup", fr: "Départ" }), destination: t({ pt: "Destino", en: "Destination", fr: "Destination" }), driver: r.driver?.firstName }} />
            <div className="space-y-1 text-sm">
              <p className="flex items-center gap-2"><MapPin className="h-4 w-4 text-primary" />{r.pickup.label}</p>
              <p className="flex items-center gap-2"><Flag className="h-4 w-4 text-green-700" />{r.dropoff.label}</p>
            </div>
            {r.driver && (
              <div className="rounded-xl border p-3 text-sm">
                <p className="font-bold">{t({ pt: "Motorista", en: "Driver", fr: "Chauffeur" })}: {r.driver.firstName}</p>
                <p>{r.driver.vehicle.make} {r.driver.vehicle.model} · {r.driver.vehicle.colour}</p>
                <p className="mt-1 inline-block rounded border-2 border-neutral-900 px-2 font-mono font-bold tracking-wider">{r.driver.vehicle.plate}</p>
              </div>
            )}
          </>
        )}
      </div>
    </CustomerShell>
  );
}
