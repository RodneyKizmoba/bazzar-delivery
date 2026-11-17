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

interface EarnSum { deliveries: number; fees: number; tips: number; total: number }
interface Earnings { today: EarnSum; last7Days: EarnSum; last30Days: EarnSum; daily: { day: string; deliveries: number; total: number }[] }

function HistoryContent() {
  const t = useT();
  const { lang } = useLang();
  const { data, isLoading, error, refetch } = useQuery<{ orders: (DriverOrder & { deliveredAt?: string })[]; last30Days: { n: number; fees: number } }>({
    queryKey: ["/api/driver/history"],
  });
  const earn = useQuery<Earnings>({ queryKey: ["/api/driver/earnings"], refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { orders } = data!;
  const e = earn.data;
  const max = Math.max(1, ...(e?.daily ?? []).map((d) => d.total));
  // últimos 7 dias, incluindo os dias sem entregas
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(Date.now() + 3_600_000 - (6 - i) * 86_400_000);
    const key = d.toISOString().slice(0, 10);
    const row = e?.daily.find((x) => x.day === key);
    return { key, label: d.toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { weekday: "short", timeZone: "UTC" }), total: row?.total ?? 0, deliveries: row?.deliveries ?? 0 };
  });
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{t({ pt: "Os meus ganhos", en: "My earnings", fr: "Mes gains" })}</h1>
      {e && (
        <>
          <div className="rounded-2xl brand-grad p-5 shadow-md">
            <p className="text-sm opacity-90">{t({ pt: "Hoje", en: "Today", fr: "Aujourd'hui" })}</p>
            <p className="text-4xl font-extrabold tracking-tight">{kz(e.today.total)}</p>
            <p className="mt-1 text-sm opacity-90">
              {e.today.deliveries} {t({ pt: "entregas", en: "deliveries", fr: "livraisons" })} · {t({ pt: "gorjetas", en: "tips", fr: "pourboires" })} {kz(e.today.tips)}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {[{ k: "7", v: e.last7Days, l: t({ pt: "Últimos 7 dias", en: "Last 7 days", fr: "7 derniers jours" }) },
              { k: "30", v: e.last30Days, l: t({ pt: "Últimos 30 dias", en: "Last 30 days", fr: "30 derniers jours" }) }].map((x) => (
              <div key={x.k} className="rounded-xl border bg-white p-4">
                <p className="text-xs uppercase text-neutral-500">{x.l}</p>
                <p className="text-2xl font-bold text-green-700">{kz(x.v.total)}</p>
                <p className="text-xs text-neutral-500">{x.v.deliveries} {t({ pt: "entregas", en: "deliveries", fr: "livraisons" })} · {t({ pt: "taxas", en: "fees", fr: "frais" })} {kz(x.v.fees)} · {t({ pt: "gorjetas", en: "tips", fr: "pourboires" })} {kz(x.v.tips)}</p>
              </div>
            ))}
          </div>
          <div className="rounded-xl border bg-white p-4" aria-label={t({ pt: "Ganhos por dia", en: "Earnings per day", fr: "Gains par jour" })}>
            <p className="mb-3 text-sm font-semibold">{t({ pt: "Ganhos por dia", en: "Earnings per day", fr: "Gains par jour" })}</p>
            <div className="flex h-32 items-end gap-2">
              {days.map((d) => (
                <div key={d.key} className="flex flex-1 flex-col items-center gap-1" title={`${kz(d.total)} · ${d.deliveries}`}>
                  <span className="text-[10px] font-semibold text-neutral-600">{d.total ? Math.round(d.total / 100) / 10 + "k" : ""}</span>
                  <div className="w-full rounded-t-md bg-primary/85" style={{ height: `${Math.max(3, (d.total / max) * 88)}px`, opacity: d.total ? 1 : 0.2 }} />
                  <span className="text-[11px] capitalize text-neutral-500">{d.label}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      <h2 className="pt-2 text-base font-bold">{t({ pt: "Entregas (30 dias)", en: "Deliveries (30 days)", fr: "Livraisons (30 jours)" })}</h2>
      {!orders.length ? (
        <EmptyState icon="📦" title={t({ pt: "Sem entregas neste período", en: "No deliveries in this period", fr: "Aucune livraison sur cette période" })} />
      ) : (
        <ul className="divide-y rounded-lg border bg-white">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate font-medium">{o.store.name} → {o.deliveryAddress.zone}</p>
                <p className="text-xs text-neutral-500"><span className="font-mono">{o.orderNumber}</span> · {dateTime(o.createdAt, lang)}</p>
                {o.paymentMethod === "cash" && <p className="text-xs text-brand-700">{t({ pt: "Numerário", en: "Cash", fr: "Espèces" })}: {kz(o.total)}</p>}
              </div>
              <p className="shrink-0 text-right font-semibold text-green-700">+{kz(o.deliveryFee + (o.riderTip ?? 0))}{!!o.riderTip && <span className="block text-[11px] font-normal text-neutral-500">{t({ pt: "inclui gorjeta", en: "incl. tip", fr: "pourboire inclus" })} {kz(o.riderTip)}</span>}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
