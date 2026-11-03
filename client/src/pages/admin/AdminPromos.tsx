import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loading, ErrorState, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPage } from "./AdminDashboard";

interface Promo {
  id: number; code: string; description: string | null; discountType: "percent" | "fixed" | "free_delivery"; value: number;
  minOrder: number; maxDiscount: number | null; storeId: number | null; plusOnly: boolean; firstOrderOnly: boolean;
  maxUses: number | null; maxUsesPerUser: number; usedCount: number; expiresAt: string | null; isActive: boolean;
}

const TYPE: Record<Promo["discountType"], Tr> = {
  percent: { pt: "Percentagem", en: "Percentage", fr: "Pourcentage" },
  fixed: { pt: "Valor fixo", en: "Fixed amount", fr: "Montant fixe" },
  free_delivery: { pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" },
};

const PROMOS = "/api/admin/promos";

export default function AdminPromos() {
  return <AdminPage><PromosContent /></AdminPage>;
}

function PromosContent() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<{ promos: Promo[] }>({ queryKey: [PROMOS] });
  const toggle = useMutation({
    mutationFn: (v: { id: number; isActive: boolean }) => patch(`/api/admin/promos/${v.id}`, { isActive: v.isActive }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [PROMOS] }),
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  const valueText = (p: Promo) => p.discountType === "percent" ? `${p.value}%` : p.discountType === "fixed" ? kz(p.value) : t(T.free);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
      <section className="space-y-3">
        <h1 className="text-xl font-bold">{t({ pt: "Códigos promocionais", en: "Promo codes", fr: "Codes promo" })}</h1>
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !data!.promos.length ? (
          <EmptyState icon="🏷️" title={t({ pt: "Ainda sem códigos", en: "No codes yet", fr: "Pas encore de codes" })} />
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
                <tr>
                  <th className="p-2">{t({ pt: "Código", en: "Code", fr: "Code" })}</th>
                  <th className="p-2">{t({ pt: "Tipo", en: "Type", fr: "Type" })}</th>
                  <th className="p-2">{t({ pt: "Valor", en: "Value", fr: "Valeur" })}</th>
                  <th className="p-2">{t({ pt: "Condições", en: "Conditions", fr: "Conditions" })}</th>
                  <th className="p-2">{t({ pt: "Usos", en: "Uses", fr: "Utilisations" })}</th>
                  <th className="p-2">{t({ pt: "Activo", en: "Active", fr: "Actif" })}</th>
                </tr>
              </thead>
              <tbody>
                {data!.promos.map((p) => {
                  const expired = p.expiresAt && new Date(p.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={p.id} className={cn("border-t align-top", !p.isActive && "text-neutral-400")}>
                      <td className="p-2"><p className="font-mono font-semibold">{p.code}</p>{p.description && <p className="text-xs text-neutral-500">{p.description}</p>}</td>
                      <td className="p-2">{t(TYPE[p.discountType])}</td>
                      <td className="p-2 whitespace-nowrap">{valueText(p)}{p.maxDiscount != null && p.discountType === "percent" && <p className="text-xs text-neutral-500">máx. {kz(p.maxDiscount)}</p>}</td>
                      <td className="p-2 text-xs">
                        {p.minOrder > 0 && <p>{t({ pt: "Mín.", en: "Min.", fr: "Min." })} {kz(p.minOrder)}</p>}
                        {p.plusOnly && <p>Plus</p>}
                        {p.firstOrderOnly && <p>{t({ pt: "1.ª encomenda", en: "First order", fr: "1re commande" })}</p>}
                        {p.storeId && <p>{t({ pt: "Loja", en: "Store", fr: "Magasin" })} #{p.storeId}</p>}
                        {p.expiresAt && <p className={cn(expired && "font-semibold text-red-600")}>{expired ? t({ pt: "Expirou", en: "Expired", fr: "Expiré" }) : t({ pt: "Expira", en: "Expires", fr: "Expire" })} {dateTime(p.expiresAt, lang)}</p>}
                      </td>
                      <td className="p-2 whitespace-nowrap">{p.usedCount}{p.maxUses != null && ` / ${p.maxUses}`}<p className="text-xs text-neutral-500">{p.maxUsesPerUser}/{t({ pt: "cliente", en: "customer", fr: "client" })}</p></td>
                      <td className="p-2">
                        <Switch checked={p.isActive} aria-label={`${t({ pt: "Activo", en: "Active", fr: "Actif" })} ${p.code}`} disabled={toggle.isPending}
                          onCheckedChange={(v) => toggle.mutate({ id: p.id, isActive: v })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <CreatePromo />
    </div>
  );
}

const optInt = (s: string) => (s.trim() === "" ? null : Number(s));
const validInt = (s: string, min: number) => s.trim() === "" || (Number.isInteger(Number(s)) && Number(s) >= min);

function CreatePromo() {
  const t = useT();
  const { toast } = useToast();
  const empty = {
    code: "", description: "", discountType: "percent" as Promo["discountType"], value: "", minOrder: "0", maxDiscount: "",
    storeId: "", plusOnly: false, firstOrderOnly: false, maxUses: "", maxUsesPerUser: "1", expiresAt: "", isActive: true,
  };
  const [f, setF] = useState(empty);
  const set = <K extends keyof typeof empty>(k: K, v: (typeof empty)[K]) => setF((p) => ({ ...p, [k]: v }));
  const code = f.code.trim().toUpperCase();

  const err: Tr | null =
    !/^[A-Z0-9_-]{3,30}$/.test(code) ? { pt: "Código: 3–30 caracteres (A–Z, 0–9, _ ou -).", en: "Code: 3–30 chars (A–Z, 0–9, _ or -).", fr: "Code : 3–30 caractères (A–Z, 0–9, _ ou -)." }
    : f.discountType !== "free_delivery" && (f.value.trim() === "" || !validInt(f.value, 1)) ? { pt: "Indique o valor do desconto.", en: "Enter the discount value.", fr: "Indiquez la valeur de la remise." }
    : f.discountType === "percent" && Number(f.value) > 100 ? { pt: "A percentagem não pode passar de 100.", en: "Percentage can't exceed 100.", fr: "Le pourcentage ne peut dépasser 100." }
    : !validInt(f.minOrder, 0) || !validInt(f.maxDiscount, 0) || !validInt(f.storeId, 1) || !validInt(f.maxUses, 1) || f.maxUsesPerUser.trim() === "" || !validInt(f.maxUsesPerUser, 1)
      ? { pt: "Verifique os campos numéricos.", en: "Check the numeric fields.", fr: "Vérifiez les champs numériques." }
    : f.expiresAt && isNaN(new Date(f.expiresAt).getTime()) ? { pt: "Data de expiração inválida.", en: "Invalid expiry date.", fr: "Date d'expiration invalide." }
    : null;

  const m = useMutation({
    mutationFn: () => post(PROMOS, {
      code,
      description: f.description.trim() || null,
      discountType: f.discountType,
      value: f.discountType === "free_delivery" ? 0 : Number(f.value),
      minOrder: Number(f.minOrder || 0),
      maxDiscount: f.discountType === "percent" ? optInt(f.maxDiscount) : null,
      storeId: optInt(f.storeId),
      plusOnly: f.plusOnly,
      firstOrderOnly: f.firstOrderOnly,
      maxUses: optInt(f.maxUses),
      maxUsesPerUser: Number(f.maxUsesPerUser),
      expiresAt: f.expiresAt ? new Date(f.expiresAt).toISOString() : null,
      isActive: f.isActive,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [PROMOS] });
      toast({ title: t({ pt: "Código criado", en: "Code created", fr: "Code créé" }), description: code });
      setF(empty);
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });

  return (
    <section className="h-fit rounded-lg border bg-white p-4">
      <h2 className="mb-3 font-semibold">{t({ pt: "Novo código", en: "New code", fr: "Nouveau code" })}</h2>
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); if (!err) m.mutate(); }}>
        <div className="space-y-1">
          <Label htmlFor="p-code">{t({ pt: "Código", en: "Code", fr: "Code" })}</Label>
          <Input id="p-code" value={f.code} maxLength={30} className="font-mono uppercase" onChange={(e) => set("code", e.target.value.toUpperCase())} placeholder="BEMVINDO10" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="p-desc">{t({ pt: "Descrição", en: "Description", fr: "Description" })}</Label>
          <Input id="p-desc" value={f.description} maxLength={200} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label htmlFor="p-type">{t({ pt: "Tipo", en: "Type", fr: "Type" })}</Label>
            <Select value={f.discountType} onValueChange={(v) => set("discountType", v as Promo["discountType"])}>
              <SelectTrigger id="p-type"><SelectValue /></SelectTrigger>
              <SelectContent>{(Object.keys(TYPE) as Promo["discountType"][]).map((k) => <SelectItem key={k} value={k}>{t(TYPE[k])}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {f.discountType !== "free_delivery" && (
            <div className="space-y-1">
              <Label htmlFor="p-value">{f.discountType === "percent" ? t({ pt: "Valor (%)", en: "Value (%)", fr: "Valeur (%)" }) : t({ pt: "Valor (Kz)", en: "Value (Kz)", fr: "Valeur (Kz)" })}</Label>
              <Input id="p-value" type="number" min={1} max={f.discountType === "percent" ? 100 : undefined} value={f.value} onChange={(e) => set("value", e.target.value)} />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="p-min">{t({ pt: "Pedido mínimo (Kz)", en: "Minimum order (Kz)", fr: "Commande min. (Kz)" })}</Label>
            <Input id="p-min" type="number" min={0} value={f.minOrder} onChange={(e) => set("minOrder", e.target.value)} />
          </div>
          {f.discountType === "percent" && (
            <div className="space-y-1">
              <Label htmlFor="p-maxd">{t({ pt: "Desconto máx. (Kz)", en: "Max discount (Kz)", fr: "Remise max. (Kz)" })}</Label>
              <Input id="p-maxd" type="number" min={0} value={f.maxDiscount} onChange={(e) => set("maxDiscount", e.target.value)} placeholder="—" />
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor="p-maxu">{t({ pt: "Usos totais", en: "Total uses", fr: "Utilisations totales" })}</Label>
            <Input id="p-maxu" type="number" min={1} value={f.maxUses} onChange={(e) => set("maxUses", e.target.value)} placeholder="∞" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-maxpu">{t({ pt: "Usos por cliente", en: "Uses per customer", fr: "Par client" })}</Label>
            <Input id="p-maxpu" type="number" min={1} value={f.maxUsesPerUser} onChange={(e) => set("maxUsesPerUser", e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-store">{t({ pt: "ID da loja (opcional)", en: "Store ID (optional)", fr: "ID magasin (facultatif)" })}</Label>
            <Input id="p-store" type="number" min={1} value={f.storeId} onChange={(e) => set("storeId", e.target.value)} placeholder={t({ pt: "Todas", en: "All", fr: "Tous" })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="p-exp">{t({ pt: "Expira em", en: "Expires at", fr: "Expire le" })}</Label>
            <Input id="p-exp" type="datetime-local" value={f.expiresAt} onChange={(e) => set("expiresAt", e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2"><Switch id="p-plus" checked={f.plusOnly} onCheckedChange={(v) => set("plusOnly", v)} /><Label htmlFor="p-plus">{t({ pt: "Só membros Plus", en: "Plus members only", fr: "Membres Plus uniquement" })}</Label></div>
          <div className="flex items-center gap-2"><Switch id="p-first" checked={f.firstOrderOnly} onCheckedChange={(v) => set("firstOrderOnly", v)} /><Label htmlFor="p-first">{t({ pt: "Só na primeira encomenda", en: "First order only", fr: "Première commande uniquement" })}</Label></div>
          <div className="flex items-center gap-2"><Switch id="p-active" checked={f.isActive} onCheckedChange={(v) => set("isActive", v)} /><Label htmlFor="p-active">{t({ pt: "Activo", en: "Active", fr: "Actif" })}</Label></div>
        </div>
        {err && f.code && <p className="text-sm text-red-600" role="alert">{t(err)}</p>}
        <Button type="submit" className="w-full" disabled={!!err || m.isPending}>{t({ pt: "Criar código", en: "Create code", fr: "Créer le code" })}</Button>
      </form>
    </section>
  );
}
