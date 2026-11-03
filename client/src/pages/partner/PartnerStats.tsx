import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { useT, type Tr } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

interface Stats {
  today: { orders: number; revenue: number };
  last30Days: { orders: number; revenue: number; avgTicket: number; cancelledOrRejected: number };
  rating: { avg: number; count: number };
  topItems: { name: string; qty: number }[];
}

export default function PartnerStats() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <StatsContent />
      </PanelShell>
    </Guard>
  );
}

function Tile({ label, value, hint }: { label: Tr; value: string; hint?: string }) {
  const t = useT();
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t(label)}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

function StatsContent() {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<Stats>({ queryKey: ["/api/partner/stats"], refetchInterval: 60_000 });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const s = data!;
  const max = Math.max(1, ...s.topItems.map((i) => i.qty));
  const m = s.last30Days;
  const cancelRate = m.orders + m.cancelledOrRejected > 0 ? Math.round((m.cancelledOrRejected / (m.orders + m.cancelledOrRejected)) * 100) : 0;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t({ pt: "Estatísticas", en: "Statistics", fr: "Statistiques" })}</h1>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t({ pt: "Hoje", en: "Today", fr: "Aujourd'hui" })}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={{ pt: "Encomendas entregues", en: "Delivered orders", fr: "Commandes livrées" }} value={String(s.today.orders)} />
          <Tile label={{ pt: "Vendas", en: "Sales", fr: "Ventes" }} value={kz(s.today.revenue)} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t({ pt: "Últimos 30 dias", en: "Last 30 days", fr: "30 derniers jours" })}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={{ pt: "Encomendas entregues", en: "Delivered orders", fr: "Commandes livrées" }} value={String(m.orders)} />
          <Tile label={{ pt: "Vendas", en: "Sales", fr: "Ventes" }} value={kz(m.revenue)} />
          <Tile label={{ pt: "Ticket médio", en: "Average ticket", fr: "Panier moyen" }} value={kz(m.avgTicket)} />
          <Tile label={{ pt: "Canceladas / recusadas", en: "Cancelled / rejected", fr: "Annulées / refusées" }} value={String(m.cancelledOrRejected)} hint={`${cancelRate}%`} />
          <Tile label={{ pt: "Avaliação", en: "Rating", fr: "Note" }} value={s.rating.count ? `${s.rating.avg.toFixed(1)} ★` : "—"}
            hint={t({ pt: `${s.rating.count} avaliações`, en: `${s.rating.count} reviews`, fr: `${s.rating.count} avis` })} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">{t({ pt: "Vendas = subtotal dos produtos (sem taxa de entrega).", en: "Sales = item subtotal (excluding delivery fee).", fr: "Ventes = sous-total des produits (hors livraison)." })}</p>
      </section>
      <section className="rounded-lg border bg-white p-4">
        <h2 className="mb-3 font-semibold">{t({ pt: "Produtos mais vendidos (30 dias)", en: "Top-selling items (30 days)", fr: "Produits les plus vendus (30 jours)" })}</h2>
        {s.topItems.length === 0 ? (
          <p className="text-sm text-neutral-500">{t({ pt: "Ainda sem vendas neste período.", en: "No sales in this period yet.", fr: "Pas encore de ventes sur cette période." })}</p>
        ) : (
          <ul className="space-y-2">
            {s.topItems.map((it) => (
              <li key={it.name} className="grid grid-cols-[minmax(0,10rem)_1fr_auto] items-center gap-3 text-sm">
                <span className="truncate" title={it.name}>{it.name}</span>
                <div className="h-3 rounded-full bg-neutral-100" aria-hidden>
                  <div className="h-3 rounded-full bg-primary" style={{ width: `${(it.qty / max) * 100}%` }} />
                </div>
                <span className="tabular-nums font-medium">{it.qty}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
