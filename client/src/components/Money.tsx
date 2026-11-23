import { useLang, useT, type Tr } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface LedgerEntry {
  id: number; kind: "order_earning" | "cash_collected" | "payout" | "cash_deposit" | "adjustment";
  amount: number; note: string | null; reference: string | null; orderId: number | null; createdAt: string;
}
export interface Account { balance: number; earned: number; paidOut: number; cashHeld: number; entries: LedgerEntry[] }

const KIND: Record<LedgerEntry["kind"], Tr> = {
  order_earning: { pt: "Entrega concluída", en: "Completed order", fr: "Commande livrée" },
  cash_collected: { pt: "Numerário recebido do cliente", en: "Cash taken from customer", fr: "Espèces reçues du client" },
  payout: { pt: "Pagamento da PedeJá", en: "Payout from PedeJá", fr: "Paiement de PedeJá" },
  cash_deposit: { pt: "Numerário entregue à PedeJá", en: "Cash handed to PedeJá", fr: "Espèces remises à PedeJá" },
  adjustment: { pt: "Ajuste", en: "Adjustment", fr: "Ajustement" },
};

/** Lista de movimentos: + a PedeJá deve-lhe, − deve à PedeJá. */
export function LedgerList({ entries, empty }: { entries: LedgerEntry[]; empty?: string }) {
  const t = useT();
  const { lang } = useLang();
  if (!entries.length) return <p className="py-3 text-sm text-neutral-500">{empty ?? t({ pt: "Ainda sem movimentos.", en: "No activity yet.", fr: "Aucun mouvement." })}</p>;
  return (
    <ul className="divide-y">
      {entries.map((e) => (
        <li key={e.id} className="flex items-start justify-between gap-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium">{t(KIND[e.kind])}</p>
            <p className="truncate text-xs text-neutral-500">{e.note}{e.reference ? ` · ${e.reference}` : ""}</p>
            <p className="text-[11px] text-neutral-400">{dateTime(e.createdAt, lang)}</p>
          </div>
          <span className={cn("shrink-0 font-semibold tabular-nums", e.amount >= 0 ? "text-green-700" : "text-red-700")}>
            {e.amount >= 0 ? "+" : "−"}{kz(Math.abs(e.amount))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Saldo em linguagem simples. */
export function BalanceLine({ balance }: { balance: number }) {
  const t = useT();
  return balance >= 0
    ? <p className="text-sm text-neutral-600">{t({ pt: "A PedeJá deve-lhe", en: "PedeJá owes you", fr: "PedeJá vous doit" })} <b className="text-2xl text-green-700">{kz(balance)}</b></p>
    : <p className="text-sm text-neutral-600">{t({ pt: "Deve à PedeJá", en: "You owe PedeJá", fr: "Vous devez à PedeJá" })} <b className="text-2xl text-red-700">{kz(-balance)}</b></p>;
}
