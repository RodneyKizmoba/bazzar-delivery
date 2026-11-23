import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { BalanceLine, LedgerList, type Account } from "@/components/Money";
import { useT } from "@/lib/i18n";
import { kz } from "@/lib/format";
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
  const q = useQuery<Account & { commissionPct: number; payoutMethod: string | null; payoutReference: string | null }>({ queryKey: ["/api/partner/finance"] });
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
        <p className="mt-3 text-xs text-neutral-600">
          {t({ pt: `Por cada encomenda entregue recebe o valor da comida menos a comissão PedeJá de ${d.commissionPct}%. A taxa de entrega e as gorjetas são do estafeta.`, en: `For each delivered order you get the food value minus PedeJá's ${d.commissionPct}% commission. Delivery fee and tips go to the rider.`, fr: `Pour chaque commande livrée, vous recevez la valeur des plats moins la commission PedeJá de ${d.commissionPct} %. Les frais de livraison et pourboires vont au livreur.` })}
        </p>
        <p className="mt-2 text-xs text-neutral-600">
          {d.payoutMethod
            ? t({ pt: `Recebe por ${PAYOUT[d.payoutMethod] ?? d.payoutMethod}: ${d.payoutReference ?? ""}`, en: `Paid via ${PAYOUT[d.payoutMethod] ?? d.payoutMethod}: ${d.payoutReference ?? ""}`, fr: `Payé par ${PAYOUT[d.payoutMethod] ?? d.payoutMethod} : ${d.payoutReference ?? ""}` })
            : <span className="font-semibold text-red-700">{t({ pt: "Ainda não indicou como quer receber.", en: "You haven't said how you want to be paid.", fr: "Vous n'avez pas indiqué comment être payé." })} </span>}
          {" "}<Link href="/parceiro/loja" className="font-semibold text-brand-800 underline">{t({ pt: "Alterar", en: "Change", fr: "Modifier" })}</Link>
        </p>
      </section>
      <section className="rounded-xl border bg-white p-4">
        <h2 className="mb-1 font-bold">{t({ pt: "Movimentos", en: "Activity", fr: "Mouvements" })}</h2>
        <LedgerList entries={d.entries} />
      </section>
    </div>
  );
}
