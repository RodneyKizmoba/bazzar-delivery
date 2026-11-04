import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Pencil, Trash2 } from "lucide-react";
import { Loading, ErrorState, EmptyState } from "@/components/common";
import { FoodSticker, type Banner } from "@/components/PromoCarousel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { del, post, put, queryClient } from "@/lib/api";
import { useT, T, type Tr } from "@/lib/i18n";
import { FOOD_COLORS } from "@/lib/format";
import { AdminPage } from "./AdminDashboard";

type AdminBanner = Banner & { sortOrder: number; isActive: boolean };
const KEY = "/api/admin/banners";

const STICKERS: { id: Banner["sticker"]; label: Tr }[] = [
  { id: "burger", label: { pt: "Hambúrguer", en: "Burger", fr: "Burger" } },
  { id: "pizza", label: { pt: "Pizza", en: "Pizza", fr: "Pizza" } },
  { id: "cake", label: { pt: "Bolo", en: "Cake", fr: "Gâteau" } },
  { id: "none", label: { pt: "Nenhum", en: "None", fr: "Aucun" } },
];

const EMPTY = { title: "", subtitle: "", imageUrl: "", imageCredit: "", sticker: "burger" as Banner["sticker"], ctaLabel: "", linkUrl: "", bgColor: "#00CCBC", sortOrder: 0, isActive: true };

export default function AdminBanners() {
  return <AdminPage><BannersContent /></AdminPage>;
}

function BannersContent() {
  const t = useT();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<{ banners: AdminBanner[] }>({ queryKey: [KEY] });
  const [form, setForm] = useState<typeof EMPTY & { id?: number }>(EMPTY);
  const set = <K extends keyof typeof EMPTY>(k: K, v: (typeof EMPTY)[K]) => setForm((f) => ({ ...f, [k]: v }));

  const refresh = () => { queryClient.invalidateQueries({ queryKey: [KEY] }); queryClient.invalidateQueries({ queryKey: ["/api/banners"] }); };
  const onError = (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message });

  const save = useMutation({
    mutationFn: () => {
      const body = {
        title: form.title.trim(), subtitle: form.subtitle.trim() || null, imageUrl: form.imageUrl.trim() || null,
        imageCredit: form.imageCredit.trim() || null, sticker: form.sticker, ctaLabel: form.ctaLabel.trim() || null,
        linkUrl: form.linkUrl.trim() || null, bgColor: form.bgColor, sortOrder: Number(form.sortOrder) || 0, isActive: form.isActive,
      };
      return form.id ? put(`${KEY}/${form.id}`, body) : post(KEY, body);
    },
    onSuccess: () => { refresh(); setForm(EMPTY); toast({ title: t({ pt: "Anúncio guardado", en: "Ad saved", fr: "Annonce enregistrée" }) }); },
    onError,
  });
  const toggle = useMutation({
    mutationFn: (b: AdminBanner) => put(`${KEY}/${b.id}`, { ...b, isActive: !b.isActive }),
    onSuccess: refresh, onError,
  });
  const remove = useMutation({ mutationFn: (id: number) => del(`${KEY}/${id}`), onSuccess: refresh, onError });

  const swatches = ["#00CCBC", "#2E3333", ...Object.values(FOOD_COLORS)];

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_400px]">
      <section className="space-y-3">
        <h1 className="text-xl font-bold">{t({ pt: "Publicidade na página inicial", en: "Home page ads", fr: "Annonces de l'accueil" })}</h1>
        <p className="text-sm text-neutral-600">{t({
          pt: "Use só fotos que pode usar comercialmente (domínio público, CC BY, ou compradas) e escreva o crédito exigido pela licença.",
          en: "Only use photos you may use commercially (public domain, CC BY, or purchased) and add the credit the licence requires.",
          fr: "N'utilisez que des photos autorisées à des fins commerciales et indiquez le crédit exigé par la licence.",
        })}</p>
        {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !data!.banners.length ? (
          <EmptyState icon="📣" title={t({ pt: "Ainda sem anúncios", en: "No ads yet", fr: "Pas encore d'annonces" })} />
        ) : (
          <ul className="space-y-2">
            {data!.banners.map((b) => (
              <li key={b.id} className="flex items-center gap-3 rounded-xl border bg-white p-3">
                <div className="relative h-14 w-24 shrink-0 overflow-hidden rounded-lg" style={{ backgroundColor: b.bgColor }}>
                  {b.imageUrl && <img src={b.imageUrl} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />}
                  <FoodSticker kind={b.sticker} className="absolute -bottom-1 -right-1 h-9 w-9" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{b.title}</p>
                  <p className="truncate text-xs text-neutral-500">{b.linkUrl ?? "—"} · {t({ pt: "ordem", en: "order", fr: "ordre" })} {b.sortOrder}</p>
                  {b.imageCredit && <p className="truncate text-[11px] text-neutral-400">{b.imageCredit}</p>}
                </div>
                <Switch checked={b.isActive} onCheckedChange={() => toggle.mutate(b)} aria-label={t({ pt: "Activo", en: "Active", fr: "Actif" })} />
                <Button size="icon" variant="ghost" aria-label={t(T.edit)} onClick={() => setForm({
                  id: b.id, title: b.title, subtitle: b.subtitle ?? "", imageUrl: b.imageUrl ?? "", imageCredit: b.imageCredit ?? "",
                  sticker: b.sticker, ctaLabel: b.ctaLabel ?? "", linkUrl: b.linkUrl ?? "", bgColor: b.bgColor, sortOrder: b.sortOrder, isActive: b.isActive,
                })}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" className="text-red-600" aria-label={t(T.delete)}
                  onClick={() => { if (window.confirm(t({ pt: "Apagar este anúncio?", en: "Delete this ad?", fr: "Supprimer cette annonce ?" }))) remove.mutate(b.id); }}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="space-y-3 rounded-xl border bg-white p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <h2 className="font-semibold">{form.id ? t({ pt: "Editar anúncio", en: "Edit ad", fr: "Modifier l'annonce" }) : t({ pt: "Novo anúncio", en: "New ad", fr: "Nouvelle annonce" })}</h2>
        <F id="b-title" label={{ pt: "Título", en: "Title", fr: "Titre" }}><Input id="b-title" maxLength={60} required value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="Até a Palanca pede já!" /></F>
        <F id="b-sub" label={{ pt: "Texto", en: "Text", fr: "Texte" }}><Input id="b-sub" maxLength={120} value={form.subtitle} onChange={(e) => set("subtitle", e.target.value)} /></F>
        <F id="b-img" label={{ pt: "Foto (link https)", en: "Photo (https link)", fr: "Photo (lien https)" }}><Input id="b-img" value={form.imageUrl} onChange={(e) => set("imageUrl", e.target.value)} placeholder="https://…" /></F>
        <F id="b-credit" label={{ pt: "Crédito da foto", en: "Photo credit", fr: "Crédit photo" }}><Input id="b-credit" value={form.imageCredit} onChange={(e) => set("imageCredit", e.target.value)} placeholder="Foto: Nome, CC BY 2.0" /></F>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t({ pt: "Comida (autocolante)", en: "Food sticker", fr: "Autocollant" })}</legend>
          <div className="flex gap-2">
            {STICKERS.map((s) => (
              <button key={s.id} type="button" onClick={() => set("sticker", s.id)}
                className={`flex flex-col items-center rounded-lg border-2 p-1.5 text-[11px] ${form.sticker === s.id ? "border-primary" : "border-neutral-200"}`}>
                {s.id === "none" ? <span className="flex h-10 w-10 items-center justify-center text-neutral-400">—</span> : <FoodSticker kind={s.id} className="h-10 w-10" />}
                {t(s.label)}
              </button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <F id="b-cta" label={{ pt: "Botão", en: "Button", fr: "Bouton" }}><Input id="b-cta" maxLength={30} value={form.ctaLabel} onChange={(e) => set("ctaLabel", e.target.value)} /></F>
          <F id="b-link" label={{ pt: "Link", en: "Link", fr: "Lien" }}><Input id="b-link" value={form.linkUrl} onChange={(e) => set("linkUrl", e.target.value)} placeholder="/pesquisa?q=pizza" /></F>
        </div>
        <fieldset className="space-y-1.5">
          <legend className="text-sm font-medium">{t({ pt: "Cor de fundo", en: "Background colour", fr: "Couleur de fond" })}</legend>
          <div className="flex flex-wrap gap-1.5">
            {swatches.map((c) => (
              <button key={c} type="button" aria-label={c} onClick={() => set("bgColor", c)}
                className={`h-7 w-7 rounded-full border-2 ${form.bgColor === c ? "border-neutral-900" : "border-white shadow"}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </fieldset>
        <div className="flex items-center justify-between gap-3">
          <F id="b-order" label={{ pt: "Ordem", en: "Order", fr: "Ordre" }}><Input id="b-order" type="number" min={0} className="w-24" value={form.sortOrder} onChange={(e) => set("sortOrder", Number(e.target.value))} /></F>
          <div className="flex items-center gap-2 pt-5"><Switch id="b-active" checked={form.isActive} onCheckedChange={(v) => set("isActive", v)} /><Label htmlFor="b-active">{t({ pt: "Activo", en: "Active", fr: "Actif" })}</Label></div>
        </div>
        <div className="flex gap-2">
          <Button type="submit" className="flex-1" disabled={save.isPending || form.title.trim().length < 2}>{t(T.save)}</Button>
          {form.id && <Button type="button" variant="outline" onClick={() => setForm(EMPTY)}>{t(T.cancel)}</Button>}
        </div>
      </form>
    </div>
  );
}

function F({ id, label, children }: { id: string; label: Tr; children: React.ReactNode }) {
  const t = useT();
  return <div className="space-y-1"><Label htmlFor={id}>{t(label)}</Label>{children}</div>;
}
