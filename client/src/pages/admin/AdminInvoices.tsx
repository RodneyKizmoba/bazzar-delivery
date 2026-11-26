import { useState } from "react";
import { Link, useRoute } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminPage } from "./AdminDashboard";
import { Loading, ErrorState } from "@/components/common";
import { InvoiceView, invoiceMonth, type Invoice, type InvoiceRow } from "@/components/InvoiceView";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT } from "@/lib/i18n";
import { kz } from "@/lib/format";

/** Mês anterior em hora de Luanda (AAAA-MM). */
function lastMonth() {
  const d = new Date(Date.now() + 3_600_000);
  const y = d.getUTCMonth() === 0 ? d.getUTCFullYear() - 1 : d.getUTCFullYear();
  const m = d.getUTCMonth() === 0 ? 12 : d.getUTCMonth();
  return `${y}-${String(m).padStart(2, "0")}`;
}

export default function AdminInvoices() {
  const [, params] = useRoute("/admin/notas/:id");
  return <AdminPage>{params?.id ? <One id={Number(params.id)} /> : <List />}</AdminPage>;
}

function List() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [month, setMonth] = useState(lastMonth());
  const key = [`/api/admin/invoices?month=${month}`];
  const q = useQuery<{ invoices: InvoiceRow[]; vatPct: number }>({ queryKey: key });
  const refresh = () => queryClient.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("/api/admin/invoices") });
  const gen = useMutation({
    mutationFn: () => post<{ created: InvoiceRow[] }>("/api/admin/invoices/generate", { month }),
    onSuccess: (r) => { refresh(); toast({ title: t({ pt: `${r.created.length} notas emitidas`, en: `${r.created.length} statements issued`, fr: `${r.created.length} relevés émis` }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  const agt = useMutation({
    mutationFn: (v: { id: number; agtInvoiceNumber: string }) => patch(`/api/admin/invoices/${v.id}`, { agtInvoiceNumber: v.agtInvoiceNumber || null }),
    onSuccess: () => { refresh(); toast({ title: t({ pt: "N.º AGT guardado", en: "AGT number saved", fr: "N° AGT enregistré" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  const rows = q.data?.invoices ?? [];
  const sum = (k: "commissionTotal" | "adsTotal" | "vatAmount" | "total") => rows.filter((r) => r.status === "issued").reduce((s, r) => s + r[k], 0);
  return (
    <section aria-labelledby="inv-h">
      <h1 id="inv-h" className="text-xl font-bold">{t({ pt: "Notas de comissões", en: "Commission statements", fr: "Relevés de commissions" })}</h1>
      <p className="mt-1 max-w-2xl text-sm text-neutral-600">{t({ pt: "Uma nota por loja e por mês: comissão de cada artigo vendido (comida, medicamentos, roupa…) e publicidade. A fatura fiscal emite-se no software certificado pela AGT; registe aqui o seu número.", en: "One statement per store per month: commission on each item sold and advertising. Issue the tax invoice in AGT-certified software and record its number here.", fr: "Un relevé par magasin et par mois. La facture fiscale s'émet dans un logiciel certifié AGT ; notez ici son numéro." })}</p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <div><Label htmlFor="inv-month">{t({ pt: "Mês", en: "Month", fr: "Mois" })}</Label><Input id="inv-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" /></div>
        <Button onClick={() => gen.mutate()} disabled={gen.isPending || !month}>{t({ pt: "Emitir notas do mês", en: "Issue month's statements", fr: "Émettre les relevés du mois" })}</Button>
        <span className="text-xs text-neutral-500">{t({ pt: `IVA nas notas: ${q.data?.vatPct ?? 0}%`, en: `VAT on statements: ${q.data?.vatPct ?? 0}%`, fr: `TVA : ${q.data?.vatPct ?? 0} %` })}</span>
      </div>
      {q.isLoading ? <Loading /> : q.error ? <ErrorState error={q.error} /> : (
        <>
          <p className="mt-4 text-sm">{t({ pt: "Total do mês", en: "Month total", fr: "Total du mois" })}: <b>{kz(sum("total"))}</b> ({t({ pt: "comissão", en: "commission", fr: "commission" })} {kz(sum("commissionTotal"))} · {t({ pt: "publicidade", en: "ads", fr: "publicité" })} {kz(sum("adsTotal"))} · IVA {kz(sum("vatAmount"))})</p>
          <div className="mt-2 overflow-x-auto rounded-2xl border bg-white">
            <table className="w-full text-sm">
              <caption className="sr-only">{t({ pt: "Notas emitidas", en: "Issued statements", fr: "Relevés émis" })}</caption>
              <thead><tr className="border-b text-left text-xs text-neutral-500">
                <th scope="col" className="p-2">N.º</th><th scope="col">{t({ pt: "Loja", en: "Store", fr: "Magasin" })}</th>
                <th scope="col" className="text-right">{t({ pt: "Vendas", en: "Sales", fr: "Ventes" })}</th><th scope="col" className="text-right">Total</th>
                <th scope="col" className="p-2">{t({ pt: "N.º fatura AGT", en: "AGT invoice no.", fr: "N° facture AGT" })}</th>
              </tr></thead>
              <tbody>
                {!rows.length && <tr><td colSpan={5} className="p-4 text-neutral-600">{t({ pt: `Sem notas de ${invoiceMonth(`${month}-01T00:00:00Z`, lang)}.`, en: "No statements for this month.", fr: "Aucun relevé ce mois-ci." })}</td></tr>}
                {rows.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="p-2"><Link href={`/admin/notas/${r.id}`} className="font-semibold text-teal-700 underline">{r.number}</Link>{r.status === "void" && <span className="ml-1 text-xs text-red-700">{t({ pt: "anulada", en: "void", fr: "annulée" })}</span>}</td>
                    <td>{r.storeName}</td>
                    <td className="text-right tabular-nums">{kz(r.salesTotal)}</td>
                    <td className="text-right font-semibold tabular-nums">{kz(r.total)}</td>
                    <td className="p-2"><AgtField row={r} onSave={(v) => agt.mutate({ id: r.id, agtInvoiceNumber: v })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

function AgtField({ row, onSave }: { row: InvoiceRow; onSave: (v: string) => void }) {
  const t = useT();
  const [v, setV] = useState(row.agtInvoiceNumber ?? "");
  return (
    <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); onSave(v.trim()); }}>
      <Input aria-label={t({ pt: `N.º fatura AGT de ${row.number}`, en: `AGT invoice no. for ${row.number}`, fr: `N° facture AGT de ${row.number}` })} value={v} onChange={(e) => setV(e.target.value)} className="h-8 w-40" placeholder="FT …" />
      <Button type="submit" size="sm" variant="outline" disabled={v.trim() === (row.agtInvoiceNumber ?? "")}>{t({ pt: "Guardar", en: "Save", fr: "Enregistrer" })}</Button>
    </form>
  );
}

function One({ id }: { id: number }) {
  const t = useT();
  const { toast } = useToast();
  const q = useQuery<{ invoice: Invoice }>({ queryKey: [`/api/admin/invoices/${id}`] });
  const voidIt = useMutation({
    mutationFn: () => post(`/api/admin/invoices/${id}/void`),
    onSuccess: () => { queryClient.invalidateQueries({ predicate: (x) => String(x.queryKey[0]).startsWith("/api/admin/invoices") }); toast({ title: t({ pt: "Nota anulada", en: "Statement voided", fr: "Relevé annulé" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const inv = q.data!.invoice;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between print:hidden">
        <Link href="/admin/notas" className="text-sm text-teal-700 underline">← {t({ pt: "Todas as notas", en: "All statements", fr: "Tous les relevés" })}</Link>
        {inv.status === "issued" && <Button variant="outline" size="sm" onClick={() => voidIt.mutate()} disabled={voidIt.isPending}>{t({ pt: "Anular nota", en: "Void statement", fr: "Annuler le relevé" })}</Button>}
      </div>
      <InvoiceView inv={inv} />
    </div>
  );
}
