import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { post, put, queryClient } from "@/lib/api";
import { Guard, Loading, ErrorState, EmptyState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useDriverTabs, useDriverTitle, type DriverOrder } from "./DriverHome";
import { BalanceLine, LedgerList, type Account } from "@/components/Money";

export default function DriverHistory() {
  const tabs = useDriverTabs();
  const title = useDriverTitle();
  return (
    <Guard roles={["driver"]}>
      <PanelShell title={title} tabs={tabs}>
        <div className="mx-auto max-w-xl space-y-4"><Wallet /><HistoryContent /></div>
      </PanelShell>
    </Guard>
  );
}

interface PayoutRow { id: number; kind: "weekly" | "instant"; status: "pending" | "paid" | "failed"; amount: number; fee: number; account: string | null; createdAt: string; paidAt: string | null; bankReference: string | null }
interface WalletData extends Account {
  available: { now: number; weekly: number }; nextPayday: string;
  instant: { min: number; feePct: number; feeMin: number; feeNow: number };
  payouts: PayoutRow[]; payoutMethod: string | null; payoutReference: string | null; vehicleType: string;
}
const METHOD: Record<string, string> = { multicaixa_express: "Multicaixa Express", unitel_money: "Unitel Money", bank_transfer: "IBAN" };

/** Carteira: saldo, pagamento semanal (terça), levantamento imediato com taxa, conta para receber e veículo. */
function Wallet() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const { data } = useQuery<WalletData>({ queryKey: ["/api/driver/wallet"] });
  const [editing, setEditing] = useState(false);
  const cashout = useMutation({
    mutationFn: () => post("/api/driver/cashout"),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/driver/wallet"] }); toast({ title: t({ pt: "Pedido de levantamento enviado", en: "Cash-out requested", fr: "Retrait demandé" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  if (!data) return null;
  const payday = new Date(data.nextPayday).toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Luanda" });
  const pendingInstant = data.payouts.some((p) => p.kind === "instant" && p.status === "pending");
  const canCashout = data.available.now >= data.instant.min && !pendingInstant && !!data.payoutMethod;
  return (
    <section className="space-y-3 rounded-xl border bg-white p-4">
      <h2 className="text-lg font-bold">{t({ pt: "Carteira", en: "Wallet", fr: "Portefeuille" })}</h2>
      <BalanceLine balance={data.balance} />
      <p className="text-sm text-neutral-700">
        📅 {t({ pt: `Próximo pagamento: ${payday}`, en: `Next payout: ${payday}`, fr: `Prochain paiement : ${payday}` })}
        {data.available.weekly > 0 && <b> · {kz(data.available.weekly)}</b>}
        <span className="block text-xs text-neutral-500">{t({ pt: "Pagamos todas as terças o que ganhou de segunda a domingo da semana anterior.", en: "Every Tuesday we pay what you earned Monday to Sunday the week before.", fr: "Chaque mardi, nous payons vos gains du lundi au dimanche de la semaine précédente." })}</span>
      </p>

      <div className="rounded-lg bg-brand-50 p-3">
        <p className="text-sm font-semibold">⚡ {t({ pt: "Levantar já", en: "Cash out now", fr: "Retirer maintenant" })}</p>
        <p className="text-xs text-neutral-600">{t({ pt: `Recebe agora o saldo disponível, com uma taxa de ${data.instant.feePct}% (mínimo ${kz(data.instant.feeMin)}). Mínimo ${kz(data.instant.min)}.`, en: `Get your available balance now for a ${data.instant.feePct}% fee (min ${kz(data.instant.feeMin)}). Minimum ${kz(data.instant.min)}.`, fr: `Recevez votre solde maintenant, frais ${data.instant.feePct} % (min ${kz(data.instant.feeMin)}). Minimum ${kz(data.instant.min)}.` })}</p>
        <Button className="mt-2 w-full" disabled={!canCashout || cashout.isPending} onClick={() => cashout.mutate()}>
          {pendingInstant ? t({ pt: "Levantamento a ser processado…", en: "Cash-out in progress…", fr: "Retrait en cours…" })
            : data.available.now >= data.instant.min
              ? t({ pt: `Levantar ${kz(data.available.now - data.instant.feeNow)} (taxa ${kz(data.instant.feeNow)})`, en: `Cash out ${kz(data.available.now - data.instant.feeNow)} (fee ${kz(data.instant.feeNow)})`, fr: `Retirer ${kz(data.available.now - data.instant.feeNow)} (frais ${kz(data.instant.feeNow)})` })
              : t({ pt: `Disponível a partir de ${kz(data.instant.min)}`, en: `Available from ${kz(data.instant.min)}`, fr: `Disponible dès ${kz(data.instant.min)}` })}
        </Button>
      </div>

      {editing || !data.payoutMethod ? (
        <PayoutAccountForm current={data} onDone={() => setEditing(false)} />
      ) : (
        <p className="flex items-center justify-between gap-2 text-sm">
          <span>🏦 {METHOD[data.payoutMethod] ?? data.payoutMethod}: <b>{data.payoutReference}</b> · {t(VEHICLE[data.vehicleType] ?? VEHICLE.moto)}</span>
          <button type="button" className="text-xs font-semibold text-brand-800 underline" onClick={() => setEditing(true)}>{t({ pt: "Alterar", en: "Change", fr: "Modifier" })}</button>
        </p>
      )}

      {data.payouts.length > 0 && (
        <details>
          <summary className="cursor-pointer text-sm font-semibold text-brand-800">{t({ pt: "Pagamentos recebidos", en: "Payouts", fr: "Paiements" })}</summary>
          <ul className="divide-y text-sm">
            {data.payouts.map((p) => (
              <li key={p.id} className="flex justify-between py-2">
                <span>{p.kind === "weekly" ? t({ pt: "Semanal", en: "Weekly", fr: "Hebdo" }) : t({ pt: "Imediato", en: "Instant", fr: "Immédiat" })} · {dateTime(p.createdAt, lang)}
                  <span className={cn("ml-1 text-xs font-semibold", p.status === "paid" ? "text-green-700" : p.status === "failed" ? "text-red-700" : "text-amber-700")}>
                    {p.status === "paid" ? t({ pt: "pago", en: "paid", fr: "payé" }) : p.status === "failed" ? t({ pt: "falhou (valor devolvido)", en: "failed (refunded to balance)", fr: "échoué (recrédité)" }) : t({ pt: "a processar", en: "processing", fr: "en cours" })}
                  </span></span>
                <span className="font-semibold tabular-nums">{kz(p.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      <details>
        <summary className="cursor-pointer text-sm font-semibold text-brand-800">{t({ pt: "Ver movimentos", en: "See activity", fr: "Voir les mouvements" })}</summary>
        <LedgerList entries={data.entries} />
      </details>
    </section>
  );
}

const VEHICLE: Record<string, Tr> = {
  moto: { pt: "Mota", en: "Motorbike", fr: "Moto" }, car: { pt: "Carro", en: "Car", fr: "Voiture" },
  ebike: { pt: "Bicicleta eléctrica", en: "E-bike", fr: "Vélo électrique" }, bike: { pt: "Bicicleta", en: "Bicycle", fr: "Vélo" },
};

function PayoutAccountForm({ current, onDone }: { current: WalletData; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [method, setMethod] = useState(current.payoutMethod ?? "multicaixa_express");
  const [ref, setRef] = useState(current.payoutReference ?? "");
  const [vehicle, setVehicle] = useState(current.vehicleType ?? "moto");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => put("/api/driver/payout-account", { payoutMethod: method, payoutReference: ref, vehicleType: vehicle }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/driver/wallet"] }); toast({ title: t({ pt: "Guardado", en: "Saved", fr: "Enregistré" }) }); onDone(); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <form className="space-y-2 rounded-lg border p-3" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
      <p className="text-sm font-semibold">{t({ pt: "Onde quer receber", en: "Where to get paid", fr: "Où être payé" })}</p>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <Label htmlFor="po-method" className="text-xs">{t({ pt: "Método", en: "Method", fr: "Moyen" })}</Label>
          <select id="po-method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-10 w-full rounded-md border bg-white px-2 text-sm">
            {Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div>
          <Label htmlFor="po-vehicle" className="text-xs">{t({ pt: "Veículo", en: "Vehicle", fr: "Véhicule" })}</Label>
          <select id="po-vehicle" value={vehicle} onChange={(e) => setVehicle(e.target.value)} className="h-10 w-full rounded-md border bg-white px-2 text-sm">
            {Object.entries(VEHICLE).map(([k, v]) => <option key={k} value={k}>{t(v)}</option>)}
          </select>
        </div>
      </div>
      <div>
        <Label htmlFor="po-ref" className="text-xs">{method === "bank_transfer" ? "IBAN" : t({ pt: "Número de telefone", en: "Phone number", fr: "Numéro de téléphone" })}</Label>
        <Input id="po-ref" value={ref} onChange={(e) => setRef(e.target.value)} inputMode={method === "bank_transfer" ? "text" : "tel"}
          placeholder={method === "bank_transfer" ? "AO06 0000 0000 0000 0000 0000 0" : "9XX XXX XXX"} aria-invalid={!!err} aria-describedby={err ? "po-err" : undefined} />
      </div>
      {err && <p id="po-err" role="alert" className="text-sm text-red-700">{err}</p>}
      <Button type="submit" size="sm" disabled={save.isPending || ref.trim().length < 9}>{t(T.save)}</Button>
    </form>
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
