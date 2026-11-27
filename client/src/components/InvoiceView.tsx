import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { REGIME_LABEL } from "@/components/TaxCard";

export interface InvoiceLine { kind: "item" | "ads"; date: string; orderNumber?: string; description: string; quantity: number; amount: number; commissionPct?: number; commission: number }
export interface Invoice {
  id: number; number: string; storeId: number; periodStart: string; periodEnd: string; storeName: string; storeNif: string | null; storeAddress: string;
  lines: InvoiceLine[]; salesTotal: number; commissionTotal: number; adsTotal: number; netTotal: number; vatPct: number; vatAmount: number; total: number;
  status: "issued" | "void"; agtInvoiceNumber: string | null; issuedAt: string;
  storeVatRegime?: "exclusion" | "simplified" | "general" | null; pedejaVatRegime?: "exclusion" | "simplified" | "general" | null; vatIncluded?: boolean;
}
export type InvoiceRow = Omit<Invoice, "lines"> & { lineCount: number };

/** Mês da nota em hora de Luanda ("novembro de 2026"). */
export function invoiceMonth(periodStart: string, lang = "pt") {
  const d = new Date(new Date(periodStart).getTime() + 3_600_000);
  return d.toLocaleDateString(lang === "pt" ? "pt-AO" : lang, { month: "long", year: "numeric", timeZone: "UTC" });
}

/** Nota de comissões, pronta a imprimir (ou guardar em PDF pelo navegador). */
export function InvoiceView({ inv }: { inv: Invoice }) {
  const t = useT();
  const items = inv.lines.filter((l) => l.kind === "item");
  const ads = inv.lines.filter((l) => l.kind === "ads");
  return (
    <article className="mx-auto max-w-3xl rounded-2xl border bg-white p-6 print:border-0 print:p-0" aria-labelledby="inv-h">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-2xl font-extrabold text-teal-600">PedeJá</p>
          <h1 id="inv-h" className="mt-1 text-lg font-bold">{t({ pt: "Nota de comissões", en: "Commission statement", fr: "Relevé de commissions" })} {inv.number}</h1>
          <p className="text-sm text-neutral-600">{t({ pt: "Período", en: "Period", fr: "Période" })}: {invoiceMonth(inv.periodStart)}</p>
          {inv.status === "void" && <p className="mt-1 inline-block rounded bg-red-100 px-2 py-0.5 text-sm font-semibold text-red-800">{t({ pt: "ANULADA", en: "VOID", fr: "ANNULÉE" })}</p>}
        </div>
        <Button variant="outline" size="sm" className="print:hidden" onClick={() => window.print()}><Printer className="mr-1 h-4 w-4" aria-hidden />{t({ pt: "Imprimir / PDF", en: "Print / PDF", fr: "Imprimer / PDF" })}</Button>
      </div>
      <div className="mt-4 rounded-xl bg-neutral-50 p-3 text-sm">
        <p className="font-semibold">{inv.storeName}</p>
        <p>{inv.storeAddress}</p>
        <p>NIF: {inv.storeNif || "—"}</p>
        {inv.storeVatRegime && <p>IVA — {t(REGIME_LABEL[inv.storeVatRegime])}</p>}
      </div>
      <table className="mt-4 w-full text-sm">
        <caption className="sr-only">{t({ pt: "Artigos vendidos e comissão", en: "Items sold and commission", fr: "Articles vendus et commission" })}</caption>
        <thead><tr className="border-b text-left text-xs text-neutral-500">
          <th scope="col" className="py-1">{t({ pt: "Data", en: "Date", fr: "Date" })}</th>
          <th scope="col">{t({ pt: "Encomenda", en: "Order", fr: "Commande" })}</th>
          <th scope="col">{t({ pt: "Artigo", en: "Item", fr: "Article" })}</th>
          <th scope="col" className="text-right">{t({ pt: "Qtd.", en: "Qty", fr: "Qté" })}</th>
          <th scope="col" className="text-right">{t({ pt: "Valor", en: "Amount", fr: "Montant" })}</th>
          <th scope="col" className="text-right">%</th>
          <th scope="col" className="text-right">{t({ pt: "Comissão", en: "Commission", fr: "Commission" })}</th>
        </tr></thead>
        <tbody>
          {items.map((l, i) => (
            <tr key={i} className="border-b last:border-0">
              <td className="py-1 tabular-nums">{l.date}</td><td className="tabular-nums">{l.orderNumber}</td><td>{l.description}</td>
              <td className="text-right tabular-nums">{l.quantity}</td><td className="text-right tabular-nums">{kz(l.amount)}</td>
              <td className="text-right tabular-nums">{l.commissionPct}%</td><td className="text-right tabular-nums">{kz(l.commission)}</td>
            </tr>
          ))}
          {ads.map((l, i) => (
            <tr key={`a${i}`} className="border-b last:border-0">
              <td className="py-1 tabular-nums">{l.date}</td><td>—</td><td>{l.description}</td><td className="text-right">1</td>
              <td className="text-right tabular-nums">{kz(l.amount)}</td><td className="text-right">—</td><td className="text-right tabular-nums">{kz(l.commission)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="ml-auto mt-4 grid max-w-xs grid-cols-2 gap-y-1 text-sm">
        <dt>{t({ pt: "Vendas (artigos)", en: "Sales (items)", fr: "Ventes (articles)" })}</dt><dd className="text-right tabular-nums">{kz(inv.salesTotal)}</dd>
        <dt>{t({ pt: "Comissão", en: "Commission", fr: "Commission" })}</dt><dd className="text-right tabular-nums">{kz(inv.commissionTotal)}</dd>
        <dt>{t({ pt: "Publicidade", en: "Advertising", fr: "Publicité" })}</dt><dd className="text-right tabular-nums">{kz(inv.adsTotal)}</dd>
        {inv.vatPct > 0 && !inv.vatIncluded && <><dt>{t({ pt: `IVA ${inv.vatPct}%`, en: `VAT ${inv.vatPct}%`, fr: `TVA ${inv.vatPct} %` })}</dt><dd className="text-right tabular-nums">{kz(inv.vatAmount)}</dd></>}
        <dt className="border-t pt-1 font-bold">{t({ pt: "Total", en: "Total", fr: "Total" })}</dt><dd className="border-t pt-1 text-right font-bold tabular-nums">{kz(inv.total)}</dd>
        {inv.vatPct > 0 && inv.vatIncluded && <><dt className="text-xs text-neutral-500">{t({ pt: `IVA ${inv.vatPct}% incluído`, en: `incl. VAT ${inv.vatPct}%`, fr: `dont TVA ${inv.vatPct} %` })}</dt><dd className="text-right text-xs tabular-nums text-neutral-500">{kz(inv.vatAmount)}</dd></>}
      </dl>
      {inv.vatPct === 0 && inv.pedejaVatRegime && inv.pedejaVatRegime !== "general" && (
        <p className="mt-2 text-right text-xs text-neutral-600">PedeJá: IVA — {t(REGIME_LABEL[inv.pedejaVatRegime])}</p>
      )}
      <p className="mt-4 text-xs text-neutral-500">{t({
        pt: `A comissão e a publicidade já foram descontadas no seu saldo, em cada entrega.${inv.vatAmount && !inv.vatIncluded ? " O IVA foi descontado ao emitir esta nota." : inv.vatAmount ? " O IVA está incluído na comissão: não paga nada a mais." : ""} Este documento não é a fatura fiscal: essa é emitida em software certificado pela AGT${inv.agtInvoiceNumber ? ` (n.º ${inv.agtInvoiceNumber})` : ""}.`,
        en: `Commission and advertising were already deducted from your balance on each delivery.${inv.vatAmount ? " VAT was deducted when this statement was issued." : ""} This is not the tax invoice: that is issued in AGT-certified software${inv.agtInvoiceNumber ? ` (no. ${inv.agtInvoiceNumber})` : ""}.`,
        fr: `Commission et publicité déjà déduites de votre solde à chaque livraison.${inv.vatAmount ? " TVA déduite à l'émission." : ""} Ce n'est pas la facture fiscale (logiciel certifié AGT${inv.agtInvoiceNumber ? `, n° ${inv.agtInvoiceNumber}` : ""}).`,
      })}</p>
    </article>
  );
}
