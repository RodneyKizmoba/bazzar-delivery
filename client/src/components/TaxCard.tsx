import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { patch, queryClient } from "@/lib/api";
import { useT, type Tr } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { cn } from "@/lib/utils";

type Regime = "exclusion" | "simplified" | "general";
interface TaxStatus {
  sellerType: "individual" | "company"; vatRegime: Regime; businessNif: string | null; raisedAt: string | null;
  year: number; yearSales: number; minRegime: Regime; nextThreshold: number | null; alert: boolean; nifMissing: boolean;
  thresholds: { alertAt: number; simplifiedFrom: number; generalFrom: number };
}
export const REGIME_LABEL: Record<Regime, Tr> = {
  exclusion: { pt: "Regime de Exclusão", en: "Exclusion regime", fr: "Régime d'exclusion" },
  simplified: { pt: "Regime Simplificado", en: "Simplified regime", fr: "Régime simplifié" },
  general: { pt: "Regime Geral", en: "General regime", fr: "Régime général" },
};
const RANK: Record<Regime, number> = { exclusion: 0, simplified: 1, general: 2 };

/** IVA da loja: tipo de vendedor, NIF, regime e vendas do ano na PedeJá (com aviso antes do limite). */
export function TaxCard() {
  const t = useT();
  const { toast } = useToast();
  const q = useQuery<TaxStatus>({ queryKey: ["/api/partner/tax"] });
  const [nif, setNif] = useState("");
  useEffect(() => { setNif(q.data?.businessNif ?? ""); }, [q.data?.businessNif]);
  const save = useMutation({
    mutationFn: (body: Partial<{ sellerType: TaxStatus["sellerType"]; vatRegime: Regime; businessNif: string | null }>) => patch<TaxStatus>("/api/partner/tax", body),
    onSuccess: (d) => { queryClient.setQueryData(["/api/partner/tax"], d); toast({ title: t({ pt: "Dados fiscais guardados", en: "Tax details saved", fr: "Données fiscales enregistrées" }) }); },
    onError: (e: Error) => toast({ variant: "destructive", title: e.message }),
  });
  const d = q.data;
  if (!d) return null;
  const top = d.thresholds.simplifiedFrom;
  const pct = Math.min(100, Math.round((d.yearSales / top) * 100));
  return (
    <section aria-labelledby="tax-h" className="mx-auto mb-6 max-w-3xl rounded-2xl border bg-white p-4">
      <h2 id="tax-h" className="text-lg font-bold">{t({ pt: "IVA e dados fiscais", en: "VAT and tax details", fr: "TVA et données fiscales" })}</h2>
      <p className="mt-1 text-sm text-neutral-600">{t({ pt: "O regime de IVA depende de tudo o que vende no ano, dentro e fora da PedeJá. Confirme-o com o seu contabilista.", en: "Your VAT regime depends on everything you sell in the year, on and off PedeJá. Check it with your accountant.", fr: "Votre régime de TVA dépend de toutes vos ventes de l'année, sur PedeJá et ailleurs." })}</p>

      {d.raisedAt && <p role="status" className="mt-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t({ pt: `As suas vendas na PedeJá passaram o limite do IVA: o seu regime passou a ${t(REGIME_LABEL[d.vatRegime])} em ${dateTime(d.raisedAt)}.`, en: `Your PedeJá sales crossed the VAT threshold: your regime became ${t(REGIME_LABEL[d.vatRegime])} on ${dateTime(d.raisedAt)}.`, fr: `Vos ventes ont dépassé le seuil : régime ${t(REGIME_LABEL[d.vatRegime])} depuis le ${dateTime(d.raisedAt)}.` })}</p>}
      {d.alert && !d.raisedAt && <p role="status" className="mt-2 flex gap-2 rounded-lg bg-amber-50 p-2 text-sm text-amber-900"><AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />{t({ pt: `Já vendeu ${kz(d.yearSales)} na PedeJá este ano. A partir de ${kz(top)} por ano (somando as vendas fora da app) passa ao Regime Simplificado do IVA.`, en: `You've sold ${kz(d.yearSales)} on PedeJá this year. From ${kz(top)} a year (including sales outside the app) you move to the Simplified VAT regime.`, fr: `Déjà ${kz(d.yearSales)} vendus cette année. À partir de ${kz(top)} par an, régime simplifié.` })}</p>}

      <div className="mt-3">
        <p className="text-sm font-semibold">{t({ pt: `Vendas na PedeJá em ${d.year}`, en: `Sales on PedeJá in ${d.year}`, fr: `Ventes sur PedeJá en ${d.year}` })}: {kz(d.yearSales)}</p>
        {d.vatRegime === "exclusion" && (
          <div className="mt-1 h-2 rounded-full bg-neutral-100" role="img" aria-label={t({ pt: `${pct}% do limite de ${kz(top)}`, en: `${pct}% of the ${kz(top)} threshold`, fr: `${pct} % du seuil de ${kz(top)}` })}>
            <div className={cn("h-2 rounded-full", d.alert ? "bg-amber-500" : "bg-teal-500")} style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>

      <fieldset className="mt-4">
        <legend className="text-sm font-semibold">{t({ pt: "Quem vende", en: "Who sells", fr: "Qui vend" })}</legend>
        <div className="mt-1 flex flex-wrap gap-2">
          {(["individual", "company"] as const).map((v) => (
            <label key={v} className={cn("flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm", d.sellerType === v && "border-teal-500 ring-1 ring-teal-500")}>
              <input type="radio" name="sellerType" checked={d.sellerType === v} disabled={save.isPending}
                onChange={() => save.mutate({ sellerType: v, ...(v === "company" && nif ? { businessNif: nif } : {}) })} />
              {v === "individual" ? t({ pt: "Pessoa singular (negócio próprio, em casa)", en: "Individual (own or home business)", fr: "Particulier (activité à domicile)" }) : t({ pt: "Empresa", en: "Company", fr: "Entreprise" })}
            </label>
          ))}
        </div>
      </fieldset>

      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ businessNif: nif.trim() || null }); }}>
        <div>
          <Label htmlFor="tax-nif">NIF{d.sellerType === "company" ? " *" : ""}</Label>
          <Input id="tax-nif" value={nif} onChange={(e) => setNif(e.target.value.toUpperCase())} className="w-52" inputMode="text" autoComplete="off"
            aria-describedby="tax-nif-hint" required={d.sellerType === "company"} />
        </div>
        <Button type="submit" variant="outline" disabled={save.isPending || nif.trim() === (d.businessNif ?? "")}>{t({ pt: "Guardar NIF", en: "Save NIF", fr: "Enregistrer le NIF" })}</Button>
        <p id="tax-nif-hint" className="w-full text-xs text-neutral-500">{t({ pt: "Pessoa singular: o NIF é o n.º do Bilhete de Identidade. Aparece nas notas de comissões.", en: "Individuals: your NIF is your ID card number. It appears on commission statements.", fr: "Particulier : NIF = n° de carte d'identité." })}</p>
      </form>

      <div className="mt-3">
        <Label htmlFor="tax-regime">{t({ pt: "Regime de IVA", en: "VAT regime", fr: "Régime de TVA" })}</Label>
        <select id="tax-regime" className="mt-1 block h-9 rounded-md border px-2 text-sm" value={d.vatRegime} disabled={save.isPending}
          onChange={(e) => save.mutate({ vatRegime: e.target.value as Regime })}>
          {(["exclusion", "simplified", "general"] as const).map((r) => (
            <option key={r} value={r} disabled={RANK[r] < RANK[d.minRegime]}>{t(REGIME_LABEL[r])}</option>
          ))}
        </select>
        <p className="mt-1 text-xs text-neutral-500">{t({ pt: `Exclusão: menos de ${kz(d.thresholds.simplifiedFrom)} por ano. Simplificado: até ${kz(d.thresholds.generalFrom)}. Geral: acima (empresas como cadeias de supermercados).`, en: `Exclusion: under ${kz(d.thresholds.simplifiedFrom)} a year. Simplified: up to ${kz(d.thresholds.generalFrom)}. General: above.`, fr: `Exclusion : moins de ${kz(d.thresholds.simplifiedFrom)}/an. Simplifié : jusqu'à ${kz(d.thresholds.generalFrom)}. Général : au-delà.` })}</p>
      </div>
    </section>
  );
}
