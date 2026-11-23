import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminPage } from "./AdminDashboard";
import { Loading, ErrorState } from "@/components/common";
import { LedgerList, type Account } from "@/components/Money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";

interface StoreRow { id: number; name: string; payoutMethod: string | null; payoutReference: string | null; commissionPct: number; customCommission: boolean; balance: number }
interface RiderRow { id: number; name: string; phone: string; balance: number; cashHeld: number }
interface Finance {
  days: number; defaultCommissionPct: number; riderCashLimit: number;
  totals: { orders: number; gmv: number; food: number; commission: number; priorityFees: number; discounts: number; riderPay: number; storePay: number; platformNet: number; deliveryFees: number; serviceFees: number; smallOrderFees: number; tips: number };
  stores: StoreRow[]; riders: RiderRow[];
}
type Party = { type: "store" | "driver"; id: number; name: string; kind: "payout" | "cash_deposit" | "adjustment" };

const PAYOUT: Record<string, string> = { multicaixa_express: "Multicaixa Express", unitel_money: "Unitel Money", bank_transfer: "IBAN" };

export default function AdminFinance() {
  return <AdminPage><Board /></AdminPage>;
}

function Board() {
  const t = useT();
  const { toast } = useToast();
  const [days, setDays] = useState(30);
  const key = `/api/admin/finance?days=${days}`;
  const q = useQuery<Finance>({ queryKey: [key] });
  const [act, setAct] = useState<Party | null>(null);
  const [view, setView] = useState<{ type: "store" | "driver"; id: number; name: string } | null>(null);
  const setCommission = useMutation({
    mutationFn: ({ id, pct }: { id: number; pct: number | null }) => patch(`/api/admin/stores/${id}`, { commissionPct: pct }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: [key] }); toast({ title: t({ pt: "Comissão actualizada", en: "Commission updated", fr: "Commission mise à jour" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const f = q.data!;
  const tt = f.totals;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-xl font-bold">{t({ pt: "Finanças", en: "Finance", fr: "Finances" })}</h1>
        {[7, 30, 90].map((d) => (
          <button key={d} type="button" onClick={() => setDays(d)} aria-pressed={days === d}
            className={cn("min-h-9 rounded-full border px-3 text-sm font-semibold", days === d ? "border-primary bg-brand-100 text-brand-900" : "bg-white")}>
            {t({ pt: `${d} dias`, en: `${d} days`, fr: `${d} jours` })}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t({ pt: "Vendas (entregues)", en: "Sales (delivered)", fr: "Ventes (livrées)" })} value={kz(tt.gmv)} sub={t({ pt: `${tt.orders} encomendas`, en: `${tt.orders} orders`, fr: `${tt.orders} commandes` })} />
        <Stat label={t({ pt: "Comissões", en: "Commission", fr: "Commissions" })} value={kz(tt.commission)} />
        <Stat label={t({ pt: "Taxas ao cliente − estafetas", en: "Customer fees − riders", fr: "Frais clients − livreurs" })} value={kz(tt.deliveryFees + tt.serviceFees + tt.smallOrderFees + tt.priorityFees - tt.discounts - (tt.riderPay - tt.tips))}
          sub={t({ pt: `serviço ${kz(tt.serviceFees)} · entrega ${kz(tt.deliveryFees)}`, en: `service ${kz(tt.serviceFees)} · delivery ${kz(tt.deliveryFees)}`, fr: `service ${kz(tt.serviceFees)} · livraison ${kz(tt.deliveryFees)}` })} />
        <Stat label={t({ pt: "Receita PedeJá", en: "PedeJá revenue", fr: "Revenu PedeJá" })} value={kz(tt.platformNet)} strong />
      </div>
      <p className="-mt-3 text-xs text-neutral-500">
        {t({ pt: `Comissão geral ${f.defaultCommissionPct}% sobre a comida. Estafetas receberam ${kz(tt.riderPay)} (com ${kz(tt.tips)} de gorjetas); lojas ${kz(tt.storePay)}.`, en: `Default commission ${f.defaultCommissionPct}% of food. Riders earned ${kz(tt.riderPay)} (incl. ${kz(tt.tips)} tips); stores ${kz(tt.storePay)}.`, fr: `Commission par défaut ${f.defaultCommissionPct} % des plats. Livreurs : ${kz(tt.riderPay)} (dont ${kz(tt.tips)} de pourboires) ; magasins ${kz(tt.storePay)}.` })}
      </p>

      <PayoutsBoard onChange={() => queryClient.invalidateQueries({ queryKey: [key] })} />

      <section>
        <h2 className="mb-2 text-lg font-bold">{t({ pt: "Lojas — a pagar", en: "Stores — to pay", fr: "Magasins — à payer" })}</h2>
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr><th className="p-2">{t({ pt: "Loja", en: "Store", fr: "Magasin" })}</th><th className="p-2">{t({ pt: "Comissão", en: "Commission", fr: "Commission" })}</th><th className="p-2">{t({ pt: "Recebe por", en: "Paid via", fr: "Payé par" })}</th><th className="p-2 text-right">{t({ pt: "Saldo", en: "Balance", fr: "Solde" })}</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {f.stores.map((s) => (
                <tr key={s.id} className="border-t">
                  <td className="p-2"><button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setView({ type: "store", id: s.id, name: s.name })}>{s.name}</button></td>
                  <td className="p-2"><CommissionEdit row={s} onSave={(pct) => setCommission.mutate({ id: s.id, pct })} /></td>
                  <td className="p-2 text-xs text-neutral-600">{s.payoutMethod ? `${PAYOUT[s.payoutMethod] ?? s.payoutMethod} ${s.payoutReference ?? ""}` : <span className="text-red-700">{t({ pt: "não indicado", en: "not set", fr: "non indiqué" })}</span>}</td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", s.balance > 0 ? "text-green-700" : s.balance < 0 ? "text-red-700" : "")}>{kz(s.balance)}</td>
                  <td className="p-2 text-right"><Button size="sm" variant="outline" disabled={s.balance <= 0} onClick={() => setAct({ type: "store", id: s.id, name: s.name, kind: "payout" })}>{t({ pt: "Registar pagamento", en: "Record payout", fr: "Enregistrer un paiement" })}</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-lg font-bold">{t({ pt: "Estafetas — numerário e ganhos", en: "Riders — cash and earnings", fr: "Livreurs — espèces et gains" })}</h2>
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr><th className="p-2">{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}</th><th className="p-2 text-right">{t({ pt: "Numerário em mão", en: "Cash in hand", fr: "Espèces en main" })}</th><th className="p-2 text-right">{t({ pt: "Saldo", en: "Balance", fr: "Solde" })}</th><th className="p-2" /></tr>
            </thead>
            <tbody>
              {f.riders.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="p-2"><button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => setView({ type: "driver", id: r.id, name: r.name })}>{r.name}</button> <a href={`tel:${r.phone}`} className="text-xs text-neutral-500">{r.phone}</a></td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", r.cashHeld >= f.riderCashLimit && "text-red-700")}>{kz(r.cashHeld)}{r.cashHeld >= f.riderCashLimit && " ⚠"}</td>
                  <td className={cn("p-2 text-right font-semibold tabular-nums", r.balance > 0 ? "text-green-700" : r.balance < 0 ? "text-red-700" : "")}>{kz(r.balance)}</td>
                  <td className="space-x-1 whitespace-nowrap p-2 text-right">
                    <Button size="sm" variant="outline" disabled={r.cashHeld <= 0} onClick={() => setAct({ type: "driver", id: r.id, name: r.name, kind: "cash_deposit" })}>{t({ pt: "Recebi numerário", en: "Cash received", fr: "Espèces reçues" })}</Button>
                    <Button size="sm" variant="outline" disabled={r.balance <= 0} onClick={() => setAct({ type: "driver", id: r.id, name: r.name, kind: "payout" })}>{t({ pt: "Pagar", en: "Pay", fr: "Payer" })}</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-neutral-500">{t({ pt: `Saldo positivo: a PedeJá deve ao estafeta; negativo: deve numerário dos clientes (descontado no pagamento de terça). Acima de ${kz(f.riderCashLimit)} em mão deixa de receber encomendas em numerário.`, en: `Positive: PedeJá owes the rider; negative: they owe customers' cash (taken off Tuesday's payout). Above ${kz(f.riderCashLimit)} in hand they stop getting cash orders.`, fr: `Positif : PedeJá doit au livreur ; négatif : il doit des espèces (déduites du paiement du mardi). Au-delà de ${kz(f.riderCashLimit)}, plus de commandes en espèces.` })}</p>
      </section>

      {act && <MoneyDialog party={act} onClose={() => setAct(null)} onDone={() => { setAct(null); queryClient.invalidateQueries({ queryKey: [key] }); }} />}
      {view && <Statement party={view} onClose={() => setView(null)} />}
    </div>
  );
}

interface PayoutRow { id: number; partyType: "store" | "driver"; name: string; kind: "weekly" | "instant"; status: string; amount: number; fee: number; method: string | null; account: string | null; createdAt: string }

/** Pagamentos a fazer por banco: semanais (terça) e levantamentos imediatos. */
function PayoutsBoard({ onChange }: { onChange: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const KEY = "/api/admin/payouts?status=pending";
  const q = useQuery<{ payouts: PayoutRow[]; nextPayday: string }>({ queryKey: [KEY] });
  const [paying, setPaying] = useState<PayoutRow | null>(null);
  const refresh = () => { queryClient.invalidateQueries({ queryKey: [KEY] }); onChange(); };
  const run = useMutation({
    mutationFn: () => post<{ created: number; missingAccount: { name: string; amount: number }[] }>("/api/admin/payouts/run-weekly"),
    onSuccess: (r) => {
      refresh();
      toast({ title: t({ pt: `${r.created} pagamentos criados`, en: `${r.created} payouts created`, fr: `${r.created} paiements créés` }),
        description: r.missingAccount.length ? t({ pt: `Sem conta para receber: ${r.missingAccount.map((m) => m.name).join(", ")}`, en: `No payout account: ${r.missingAccount.map((m) => m.name).join(", ")}`, fr: `Sans compte : ${r.missingAccount.map((m) => m.name).join(", ")}` }) : undefined });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const fail = useMutation({
    mutationFn: (id: number) => post(`/api/admin/payouts/${id}/failed`),
    onSuccess: refresh,
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const rows = q.data?.payouts ?? [];
  const total = rows.reduce((s, p) => s + p.amount, 0);
  const payday = q.data ? new Date(q.data.nextPayday).toLocaleDateString(lang === "en" ? "en-GB" : lang === "fr" ? "fr-FR" : "pt-PT", { weekday: "long", day: "numeric", month: "short", timeZone: "Africa/Luanda" }) : "";
  return (
    <section className="rounded-lg border-2 border-primary bg-white p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-lg font-bold">{t({ pt: "Transferências a fazer", en: "Transfers to make", fr: "Virements à faire" })} {rows.length > 0 && <span className="text-primary">· {kz(total)}</span>}</h2>
        <a href="/api/admin/payouts.csv" className="inline-flex h-9 items-center rounded-md border px-3 text-sm font-semibold hover:bg-neutral-50">{t({ pt: "Ficheiro para o banco (CSV)", en: "Bank file (CSV)", fr: "Fichier banque (CSV)" })}</a>
        <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate()}>{t({ pt: "Gerar pagamentos da semana", en: "Create this week's payouts", fr: "Créer les paiements de la semaine" })}</Button>
      </div>
      <p className="mt-1 text-xs text-neutral-500">{t({ pt: `Pagamento semanal automático: ${payday}, com os ganhos até domingo. Os levantamentos imediatos aparecem aqui logo que o estafeta pede.`, en: `Automatic weekly payout: ${payday}, covering earnings up to Sunday. Instant cash-outs appear here as soon as a rider asks.`, fr: `Paiement hebdo automatique : ${payday}, gains jusqu'à dimanche. Les retraits immédiats apparaissent ici dès la demande.` })}</p>
      {!rows.length ? <p className="mt-3 text-sm text-neutral-500">{t({ pt: "Nada pendente.", en: "Nothing pending.", fr: "Rien en attente." })}</p> : (
        <ul className="mt-3 divide-y text-sm">
          {rows.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <b>{p.name}</b> <span className="text-xs text-neutral-500">{p.partyType === "store" ? t({ pt: "loja", en: "store", fr: "magasin" }) : t({ pt: "estafeta", en: "rider", fr: "livreur" })} · {p.kind === "instant" ? t({ pt: "imediato", en: "instant", fr: "immédiat" }) : t({ pt: "semanal", en: "weekly", fr: "hebdo" })}</span>
                <span className="block text-xs text-neutral-600">{PAYOUT[p.method ?? ""] ?? p.method}: {p.account}</span>
              </span>
              <span className="font-bold tabular-nums">{kz(p.amount)}</span>
              <Button size="sm" onClick={() => setPaying(p)}>{t({ pt: "Marcar pago", en: "Mark paid", fr: "Marquer payé" })}</Button>
              <Button size="sm" variant="ghost" disabled={fail.isPending} onClick={() => fail.mutate(p.id)}>{t({ pt: "Falhou", en: "Failed", fr: "Échoué" })}</Button>
            </li>
          ))}
        </ul>
      )}
      {paying && <MarkPaidDialog p={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); refresh(); }} />}
    </section>
  );
}

function MarkPaidDialog({ p, onClose, onDone }: { p: PayoutRow; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [ref, setRef] = useState("");
  const save = useMutation({
    mutationFn: () => post(`/api/admin/payouts/${p.id}/paid`, { bankReference: ref.trim() }),
    onSuccess: () => { toast({ title: t({ pt: "Marcado como pago", en: "Marked paid", fr: "Marqué payé" }) }); onDone(); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t({ pt: `Transferência para ${p.name}`, en: `Transfer to ${p.name}`, fr: `Virement à ${p.name}` })}</DialogTitle>
          <DialogDescription>{kz(p.amount)} · {PAYOUT[p.method ?? ""] ?? p.method}: {p.account}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1"><Label htmlFor="pay-ref">{t({ pt: "Referência da transferência", en: "Transfer reference", fr: "Référence du virement" })}</Label><Input id="pay-ref" maxLength={80} value={ref} onChange={(e) => setRef(e.target.value)} /></div>
        <Button className="w-full" disabled={!ref.trim() || save.isPending} onClick={() => save.mutate()}>{t(T.save)}</Button>
      </DialogContent>
    </Dialog>
  );
}

function CommissionEdit({ row, onSave }: { row: StoreRow; onSave: (pct: number | null) => void }) {
  const t = useT();
  const [v, setV] = useState(String(row.commissionPct));
  const changed = Number(v) !== row.commissionPct;
  return (
    <div className="flex items-center gap-1">
      <Input aria-label={t({ pt: `Comissão de ${row.name} (%)`, en: `${row.name} commission (%)`, fr: `Commission de ${row.name} (%)` })} className="h-8 w-16" inputMode="decimal" value={v} onChange={(e) => setV(e.target.value.replace(",", "."))} />
      <span className="text-xs">%</span>
      {changed && Number.isFinite(Number(v)) && v !== "" && <Button size="sm" className="h-8" onClick={() => onSave(Number(v))}>OK</Button>}
      {row.customCommission && !changed && <button type="button" className="text-[11px] text-neutral-500 underline" onClick={() => onSave(null)}>{t({ pt: "usar geral", en: "use default", fr: "par défaut" })}</button>}
    </div>
  );
}

function MoneyDialog({ party, onClose, onDone }: { party: Party; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: () => post("/api/admin/ledger", { partyType: party.type, partyId: party.id, kind: party.kind, amount: Math.round(Number(amount)), reference: reference.trim() || null, note: note.trim() || null }),
    onSuccess: () => { toast({ title: t({ pt: "Registado", en: "Recorded", fr: "Enregistré" }) }); onDone(); },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  const title = party.kind === "cash_deposit"
    ? t({ pt: `Numerário recebido de ${party.name}`, en: `Cash received from ${party.name}`, fr: `Espèces reçues de ${party.name}` })
    : t({ pt: `Pagamento a ${party.name}`, en: `Payout to ${party.name}`, fr: `Paiement à ${party.name}` });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t({ pt: "Fica registado no extracto e não se apaga. Para corrigir, use um ajuste.", en: "This goes on the statement and can't be deleted. Use an adjustment to correct it.", fr: "Inscrit au relevé, non supprimable. Utilisez un ajustement pour corriger." })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1"><Label htmlFor="m-amount">{t({ pt: "Valor (Kz)", en: "Amount (Kz)", fr: "Montant (Kz)" })}</Label><Input id="m-amount" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} /></div>
          <div className="space-y-1"><Label htmlFor="m-ref">{t({ pt: "Referência (nº da transferência / recibo)", en: "Reference (transfer / receipt no.)", fr: "Référence (virement / reçu)" })}</Label><Input id="m-ref" maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} /></div>
          <div className="space-y-1"><Label htmlFor="m-note">{t({ pt: "Nota", en: "Note", fr: "Note" })}</Label><Input id="m-note" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></div>
          <Button className="w-full" disabled={!Number(amount) || save.isPending} onClick={() => save.mutate()}>{t(T.save)}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Statement({ party, onClose }: { party: { type: "store" | "driver"; id: number; name: string }; onClose: () => void }) {
  const t = useT();
  const q = useQuery<Account>({ queryKey: [`/api/admin/finance/${party.type}/${party.id}`] });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t({ pt: `Extracto — ${party.name}`, en: `Statement — ${party.name}`, fr: `Relevé — ${party.name}` })}</DialogTitle>
          <DialogDescription>{q.data ? `${t({ pt: "Saldo", en: "Balance", fr: "Solde" })}: ${kz(q.data.balance)}` : "…"}</DialogDescription>
        </DialogHeader>
        {q.data ? <LedgerList entries={q.data.entries} /> : <Loading />}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-lg border bg-white p-3", strong && "border-primary bg-brand-50")}>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-xl font-extrabold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-neutral-500">{sub}</p>}
    </div>
  );
}
