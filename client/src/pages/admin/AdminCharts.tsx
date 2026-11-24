import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Loading, ErrorState } from "@/components/common";
import { useLang, useT, type Tr } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Gráficos do admin (Resumo). Cores validadas (daltonismo e contraste em fundo branco):
 * série 1 teal escuro da marca, 2 laranja, 3 violeta — sempre por esta ordem, nunca repintadas.
 */
const S1 = "#00a396", S2 = "#eb6834", S3 = "#6250d6";
const GRID = "#ececec", AXIS = "#737373";

interface Day { day: string; orders: number; delivered: number; cancelled: number; gmv: number; revenue: number; newCustomers: number; newRiders: number; newStores: number }
interface Totals { orders: number; delivered: number; gmv: number; revenue: number; avgBasket: number }
interface Charts {
  days: number; daily: Day[]; totals: Totals; previous: Totals;
  topStores: { id: number; name: string; orders: number; gmv: number }[];
  byHour: { hour: number; orders: number }[];
  payment: { key: string; n: number }[]; fulfilment: { key: string; n: number }[];
}

const PAY: Record<string, string> = { cash: "Numerário", multicaixa_express: "Multicaixa Express", unitel_money: "Unitel Money", card: "Cartão", bank_transfer: "Transferência" };
const FUL: Record<string, Tr> = {
  delivery: { pt: "Estafeta PedeJá", en: "PedeJá rider", fr: "Livreur PedeJá" },
  pickup: { pt: "Recolha na loja", en: "Pickup", fr: "Retrait" },
  store_delivery: { pt: "Estafetas da loja", en: "Store's riders", fr: "Livreurs du magasin" },
};

const trim = (x: number) => (Number.isInteger(x) ? String(x) : x.toFixed(1));
const short = (n: number) => (Math.abs(n) >= 1_000_000 ? `${trim(Math.round(n / 100_000) / 10)}M` : Math.abs(n) >= 1000 ? `${trim(Math.round(n / 100) / 10)}k` : String(n));

export function AdminCharts() {
  const t = useT();
  const { lang } = useLang();
  const [days, setDays] = useState(30);
  const q = useQuery<Charts>({ queryKey: [`/api/admin/charts?days=${days}`] });
  const locale = lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT";
  const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString(locale, { day: "numeric", month: "short" });

  return (
    <section className="space-y-4" aria-labelledby="charts-title">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="charts-title" className="mr-auto text-lg font-bold">{t({ pt: "Desempenho", en: "Performance", fr: "Performance" })}</h2>
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}
            className={cn("min-h-9 rounded-full border px-3 text-sm font-semibold", days === d ? "border-primary bg-brand-100 text-brand-900" : "bg-white")}>
            {t({ pt: `${d} dias`, en: `${d} days`, fr: `${d} jours` })}
          </button>
        ))}
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : (() => {
        const c = q.data!;
        const daily = c.daily.map((d) => ({ ...d, label: dayLabel(d.day) }));
        return (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi label={t({ pt: "Vendas", en: "Sales", fr: "Ventes" })} value={kz(c.totals.gmv)} cur={c.totals.gmv} prev={c.previous.gmv} />
              <Kpi label={t({ pt: "Receita PedeJá", en: "PedeJá revenue", fr: "Revenu PedeJá" })} value={kz(c.totals.revenue)} cur={c.totals.revenue} prev={c.previous.revenue} />
              <Kpi label={t({ pt: "Entregues", en: "Delivered", fr: "Livrées" })} value={String(c.totals.delivered)} cur={c.totals.delivered} prev={c.previous.delivered} />
              <Kpi label={t({ pt: "Cesto médio", en: "Average basket", fr: "Panier moyen" })} value={kz(c.totals.avgBasket)} cur={c.totals.avgBasket} prev={c.previous.avgBasket} />
            </div>
            <p className="-mt-2 text-xs text-neutral-500">{t({ pt: `Comparado com os ${c.days} dias anteriores.`, en: `Compared with the previous ${c.days} days.`, fr: `Par rapport aux ${c.days} jours précédents.` })}</p>

            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title={t({ pt: "Vendas por dia (Kz)", en: "Sales per day (Kz)", fr: "Ventes par jour (Kz)" })}>
                <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip cursor={{ fill: "#f5f5f5" }} formatter={(v: number) => [kz(v), t({ pt: "Vendas", en: "Sales", fr: "Ventes" })]} />
                  <Bar dataKey="gmv" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ChartCard>

              <ChartCard title={t({ pt: "Receita PedeJá por dia (Kz)", en: "PedeJá revenue per day (Kz)", fr: "Revenu PedeJá par jour (Kz)" })}>
                <BarChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={40} />
                  <Tooltip cursor={{ fill: "#f5f5f5" }} formatter={(v: number) => [kz(v), t({ pt: "Receita", en: "Revenue", fr: "Revenu" })]} />
                  <Bar dataKey="revenue" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                </BarChart>
              </ChartCard>

              <ChartCard title={t({ pt: "Encomendas por dia", en: "Orders per day", fr: "Commandes par jour" })}
                legend={[{ color: S1, label: t({ pt: "Entregues", en: "Delivered", fr: "Livrées" }) }, { color: S2, label: t({ pt: "Canceladas / recusadas", en: "Cancelled / rejected", fr: "Annulées / refusées" }) }]}>
                <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Line dataKey="delivered" name={t({ pt: "Entregues", en: "Delivered", fr: "Livrées" })} stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line dataKey="cancelled" name={t({ pt: "Canceladas", en: "Cancelled", fr: "Annulées" })} stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ChartCard>

              <ChartCard title={t({ pt: "Horas de mais movimento (hora de Luanda)", en: "Busiest hours (Luanda time)", fr: "Heures de pointe (heure de Luanda)" })}>
                <BarChart data={c.byHour} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={2}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="hour" tickFormatter={(h: number) => `${h}h`} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval={2} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip cursor={{ fill: "#f5f5f5" }} labelFormatter={(h: number) => `${h}:00–${h}:59`} formatter={(v: number) => [v, t({ pt: "Encomendas", en: "Orders", fr: "Commandes" })]} />
                  <Bar dataKey="orders" fill={S1} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ChartCard>

              <ChartCard title={t({ pt: "Novos registos por dia", en: "New sign-ups per day", fr: "Nouvelles inscriptions par jour" })}
                legend={[{ color: S1, label: t({ pt: "Clientes", en: "Customers", fr: "Clients" }) }, { color: S2, label: t({ pt: "Estafetas", en: "Riders", fr: "Livreurs" }) }, { color: S3, label: t({ pt: "Lojas", en: "Stores", fr: "Magasins" }) }]}>
                <LineChart data={daily} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid vertical={false} stroke={GRID} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={{ stroke: GRID }} interval="preserveStartEnd" minTickGap={16} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: AXIS }} tickLine={false} axisLine={false} width={32} />
                  <Tooltip />
                  <Line dataKey="newCustomers" name={t({ pt: "Clientes", en: "Customers", fr: "Clients" })} stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line dataKey="newRiders" name={t({ pt: "Estafetas", en: "Riders", fr: "Livreurs" })} stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  <Line dataKey="newStores" name={t({ pt: "Lojas", en: "Stores", fr: "Magasins" })} stroke={S3} strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                </LineChart>
              </ChartCard>

              <div className="rounded-lg border bg-white p-4">
                <h3 className="mb-3 text-sm font-bold">{t({ pt: "Lojas que mais vendem", en: "Top-selling stores", fr: "Meilleurs magasins" })}</h3>
                {!c.topStores.length ? <p className="text-sm text-neutral-500">{t({ pt: "Sem vendas neste período.", en: "No sales in this period.", fr: "Aucune vente sur cette période." })}</p>
                  : <HBars rows={c.topStores.map((s) => ({ label: s.name, value: s.gmv, text: `${kz(s.gmv)} · ${s.orders}` }))} />}
              </div>

              <div className="rounded-lg border bg-white p-4">
                <h3 className="mb-3 text-sm font-bold">{t({ pt: "Como pagam", en: "How customers pay", fr: "Moyens de paiement" })}</h3>
                <HBars rows={c.payment.sort((a, b) => b.n - a.n).map((p) => ({ label: PAY[p.key] ?? p.key, value: p.n, text: pct(p.n, c.payment) }))} />
                <h3 className="mb-3 mt-5 text-sm font-bold">{t({ pt: "Como chegam ao cliente", en: "How orders reach customers", fr: "Mode de livraison" })}</h3>
                <HBars rows={c.fulfilment.sort((a, b) => b.n - a.n).map((p) => ({ label: FUL[p.key] ? t(FUL[p.key]) : p.key, value: p.n, text: pct(p.n, c.fulfilment) }))} />
              </div>
            </div>

            <details className="rounded-lg border bg-white p-3">
              <summary className="cursor-pointer text-sm font-semibold text-brand-800">{t({ pt: "Ver os números em tabela", en: "See the numbers as a table", fr: "Voir les chiffres en tableau" })}</summary>
              <div className="mt-2 max-h-80 overflow-auto">
                <table className="w-full text-sm tabular-nums">
                  <thead className="sticky top-0 bg-white text-left text-xs text-neutral-500">
                    <tr><th className="p-1.5">{t({ pt: "Dia", en: "Day", fr: "Jour" })}</th><th className="p-1.5 text-right">{t({ pt: "Encomendas", en: "Orders", fr: "Commandes" })}</th><th className="p-1.5 text-right">{t({ pt: "Entregues", en: "Delivered", fr: "Livrées" })}</th><th className="p-1.5 text-right">{t({ pt: "Vendas", en: "Sales", fr: "Ventes" })}</th><th className="p-1.5 text-right">{t({ pt: "Receita", en: "Revenue", fr: "Revenu" })}</th><th className="p-1.5 text-right">{t({ pt: "Novos clientes", en: "New customers", fr: "Nouveaux clients" })}</th></tr>
                  </thead>
                  <tbody>
                    {[...daily].reverse().map((d) => (
                      <tr key={d.day} className="border-t">
                        <td className="p-1.5">{d.label}</td><td className="p-1.5 text-right">{d.orders}</td><td className="p-1.5 text-right">{d.delivered}</td>
                        <td className="p-1.5 text-right">{kz(d.gmv)}</td><td className="p-1.5 text-right">{kz(d.revenue)}</td><td className="p-1.5 text-right">{d.newCustomers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        );
      })()}
    </section>
  );
}

const pct = (n: number, all: { n: number }[]) => {
  const total = all.reduce((s, x) => s + x.n, 0);
  return `${n} · ${total ? Math.round((n / total) * 100) : 0}%`;
};

function Kpi({ label, value, cur, prev }: { label: string; value: string; cur: number; prev: number }) {
  const t = useT();
  const change = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null;
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-0.5 text-xs text-neutral-600">
        {change === null ? t({ pt: "sem período anterior", en: "no earlier period", fr: "pas de période précédente" })
          : <>{change >= 0 ? "▲" : "▼"} {Math.abs(change)}% <span className="text-neutral-500">{t({ pt: "vs. antes", en: "vs. before", fr: "vs. avant" })}</span></>}
      </p>
    </div>
  );
}

function ChartCard({ title, legend, children }: { title: string; legend?: { color: string; label: string }[]; children: React.ReactElement }) {
  return (
    <figure className="rounded-lg border bg-white p-4">
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="mr-auto text-sm font-bold">{title}</span>
        {legend?.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1.5 text-xs text-neutral-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: l.color }} aria-hidden />{l.label}
          </span>
        ))}
      </figcaption>
      <div className="h-56"><ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer></div>
    </figure>
  );
}

/** Barras horizontais simples (um só valor por linha), com o número escrito ao lado. */
function HBars({ rows }: { rows: { label: string; value: number; text: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex justify-between gap-2"><span className="truncate">{r.label}</span><span className="shrink-0 tabular-nums text-neutral-700">{r.text}</span></div>
          <div className="mt-1 h-2 rounded-full bg-neutral-100"><div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: S1 }} /></div>
        </li>
      ))}
    </ul>
  );
}
