import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState, EmptyState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { useLang, useT } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { useDriverTabs, useDriverTitle, type DriverOrder } from "./DriverHome";

export default function DriverHistory() {
  const tabs = useDriverTabs();
  const title = useDriverTitle();
  return (
    <Guard roles={["driver"]}>
      <PanelShell title={title} tabs={tabs}>
        <div className="mx-auto max-w-xl"><HistoryContent /></div>
      </PanelShell>
    </Guard>
  );
}

function HistoryContent() {
  const t = useT();
  const { lang } = useLang();
  const { data, isLoading, error, refetch } = useQuery<{ orders: (DriverOrder & { deliveredAt?: string })[]; last30Days: { n: number; fees: number } }>({
    queryKey: ["/api/driver/history"],
  });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { orders, last30Days } = data!;
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{t({ pt: "Últimos 30 dias", en: "Last 30 days", fr: "30 derniers jours" })}</h1>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">{t({ pt: "Entregas", en: "Deliveries", fr: "Livraisons" })}</p>
          <p className="text-2xl font-bold">{last30Days.n}</p>
        </div>
        <div className="rounded-lg border bg-white p-4">
          <p className="text-xs uppercase text-neutral-500">{t({ pt: "Taxas de entrega", en: "Delivery fees", fr: "Frais de livraison" })}</p>
          <p className="text-2xl font-bold text-green-700">{kz(last30Days.fees)}</p>
        </div>
      </div>
      {!orders.length ? (
        <EmptyState icon="📦" title={t({ pt: "Sem entregas neste período", en: "No deliveries in this period", fr: "Aucune livraison sur cette période" })} />
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{o.store.name} → {o.deliveryAddress.zone}</p>
                <p className="text-xs text-neutral-500"><span className="font-mono">{o.orderNumber}</span> · {dateTime(o.createdAt, lang)}</p>
                {o.paymentMethod === "cash" && <p className="text-xs text-teal-700">{t({ pt: "Numerário", en: "Cash", fr: "Espèces" })}: {kz(o.total)}</p>}
              </div>
              <p className="shrink-0 font-semibold text-green-700">+{kz(o.deliveryFee)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
