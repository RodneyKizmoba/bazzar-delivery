import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { BalanceLine, LedgerList, type Account } from "@/components/Money";
import { useLang, useT } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

const PAYOUT: Record<string, string> = { multicaixa_express: "Multicaixa Express", unitel_money: "Unitel Money", bank_transfer: "IBAN" };

export default function PartnerPayouts() {
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
  const q = useQuery<Account & {
    commissionPct: number; payoutMethod: string | null; payoutReference: string | null;
    available: { now: number; weekly: number }; nextPayday: string;
    payouts: { id: number; status: string; amount: number; createdAt: string; bankReference: string | null }[];
  }>({ queryKey: ["/api/partner/finance"] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data!;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-white p-4">
        <h1 className="text-lg font-bold">{t({ pt: "Saldo", en: "Balance", fr: "Solde" })}</h1>
        <BalanceLine balance={d.balance} />
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{t({ pt: "Ganho total", en: "Total earned", fr: "Total gagné" })}</p><p className="font-bold">{kz(d.earned)}</p></div>
          <div className="rounded-lg bg-neutral-50 p-3"><p className="text-xs text-neutral-500">{t({ pt: "Já pago", en: "Paid out", fr: "Déjà payé" })}</p><p className="font-bold">{kz(d.paidOut)}</p></div>
        </div>
        <p className="mt-3 text-sm text-neutral-700">📅 {t({ pt: "Próximo pagamento", en: "Next payout", fr: "Prochain paiement" })}: <b>{new Date(d.nextPayday).toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Luanda" })}</b>
          {d.available.weekly > 0 && <> · {kz(d.available.weekly)}</>}
          <span className="block text-xs text-neutral-500">{t({ pt: "Todas as terças pagamos por banco o que vendeu de segunda a domingo da semana anterior.", en: "Every Tuesday we pay by bank what you sold Monday to Sunday the week before.", fr: "Chaque mardi, nous virons vos ventes du lundi au dimanche de la semaine précédente." })}</span>
        </p>
        <p className="mt-3 text-xs text-neutral-600">
          {t({ pt: `Por cada encomenda entregue recebe o valor da comida menos a comissão PedeJá de ${d.commissionPct}%. A entrega, a taxa de serviço e as gorjetas não lhe são descontadas.`, en: `For each delivered order you get the food value minus PedeJá's ${d.commissionPct}% commission. Delivery fee and tips go to the rider.`, fr: `Pour chaque commande livrée, vous recevez la valeur des plats moins la commission PedeJá de ${d.commissionPct} %. Les frais de livraison et pourboires vont au livreur.` })}
        </p>
        <p className="mt-2 text-xs text-neutral-600">
          {d.payoutMethod
            ? t({ pt: `Recebe por ${PAYOUT[d.payoutMethod] ?? d.payoutMethod}: ${d.payoutReference ?? ""}`, en: `Paid via ${PAYOUT[d.payoutMethod] ?? d.payoutMethod}: ${d.payoutReference ?? ""}`, fr: `Payé par ${PAYOUT[d.payoutMethod] ?? d.payoutMethod} : ${d.payoutReference ?? ""}` })
            : <span className="font-semibold text-red-700">{t({ pt: "Ainda não indicou como quer receber.", en: "You haven't said how you want to be paid.", fr: "Vous n'avez pas indiqué comment être payé." })} </span>}
          {" "}<Link href="/parceiro/loja" className="font-semibold text-brand-800 underline">{t({ pt: "Alterar", en: "Change", fr: "Modifier" })}</Link>
        </p>
      </section>
      {d.payouts.length > 0 && (
        <section className="rounded-xl border bg-white p-4">
          <h2 className="mb-1 font-bold">{t({ pt: "Pagamentos", en: "Payouts", fr: "Paiements" })}</h2>
          <ul className="divide-y text-sm">
            {d.payouts.map((p) => (
              <li key={p.id} className="flex justify-between py-2">
                <span>{dateTime(p.createdAt, lang)} <span className={p.status === "paid" ? "text-green-700" : p.status === "failed" ? "text-red-700" : "text-amber-700"}>· {p.status === "paid" ? t({ pt: "pago", en: "paid", fr: "payé" }) : p.status === "failed" ? t({ pt: "falhou", en: "failed", fr: "échoué" }) : t({ pt: "a processar", en: "processing", fr: "en cours" })}</span>{p.bankReference && <span className="text-xs text-neutral-500"> · {p.bankReference}</span>}</span>
                <b className="tabular-nums">{kz(p.amount)}</b>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 font-bold">{t({ pt: "Movimentos", en: "Activity", fr: "Mouvements" })}</h2>
        <LedgerList entries={d.entries} />
      </section>
    </div>
  );
}
