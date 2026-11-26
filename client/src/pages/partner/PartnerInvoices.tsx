import { Link, useRoute } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { InvoiceView, invoiceMonth, type Invoice, type InvoiceRow } from "@/components/InvoiceView";
import { useLang, useT } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

export default function PartnerInvoices() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  const [, params] = useRoute("/parceiro/notas/:id");
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        {params?.id ? <One id={Number(params.id)} /> : <List />}
      </PanelShell>
    </Guard>
  );
}

function List() {
  const t = useT();
  const { lang } = useLang();
  const q = useQuery<{ invoices: InvoiceRow[] }>({ queryKey: ["/api/partner/invoices"] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  const rows = q.data!.invoices;
  return (
    <section className="mx-auto max-w-2xl" aria-labelledby="notas-h">
      <h1 id="notas-h" className="text-xl font-bold">{t({ pt: "Notas de comissões", en: "Commission statements", fr: "Relevés de commissions" })}</h1>
      <p className="mt-1 text-sm text-neutral-600">{t({ pt: "Todos os meses, uma nota com a comissão PedeJá de cada artigo vendido e a publicidade.", en: "Every month, a statement with PedeJá's commission on each item sold and advertising.", fr: "Chaque mois, un relevé de la commission sur chaque article vendu et de la publicité." })}</p>
      {!rows.length ? <p className="mt-6 rounded-xl bg-neutral-50 p-4 text-sm text-neutral-600">{t({ pt: "Ainda não há notas. A primeira sai no início do próximo mês.", en: "No statements yet. The first comes early next month.", fr: "Pas encore de relevé. Le premier arrive le mois prochain." })}</p> : (
        <ul className="mt-4 divide-y rounded-2xl border bg-white">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={`/parceiro/notas/${r.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-neutral-50">
                <span><span className="block font-semibold">{r.number}{r.status === "void" && <span className="ml-2 text-xs text-red-700">{t({ pt: "anulada", en: "void", fr: "annulée" })}</span>}</span>
                  <span className="block text-sm capitalize text-neutral-600">{invoiceMonth(r.periodStart, lang)} · {r.lineCount} {t({ pt: "linhas", en: "lines", fr: "lignes" })}</span></span>
                <span className="text-right tabular-nums"><span className="block font-bold">{kz(r.total)}</span><span className="block text-xs text-neutral-500">{t({ pt: "vendas", en: "sales", fr: "ventes" })} {kz(r.salesTotal)}</span></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function One({ id }: { id: number }) {
  const t = useT();
  const q = useQuery<{ invoice: Invoice }>({ queryKey: [`/api/partner/invoices/${id}`] });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} />;
  return (
    <div>
      <Link href="/parceiro/notas" className="mb-3 inline-block text-sm text-teal-700 underline print:hidden">← {t({ pt: "Todas as notas", en: "All statements", fr: "Tous les relevés" })}</Link>
      <InvoiceView inv={q.data!.invoice} />
    </div>
  );
}
