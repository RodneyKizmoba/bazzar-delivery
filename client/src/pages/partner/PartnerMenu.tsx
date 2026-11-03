import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Plus, Pencil, Trash2, Star, X } from "lucide-react";
import { Guard, Loading, ErrorState, EmptyState, DietaryBadges, StoreImage } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { del, patch, post, put, queryClient } from "@/lib/api";
import { useT, T, type Tr } from "@/lib/i18n";
import { kz, DIETARY, ALLERGEN } from "@/lib/format";
import { cn } from "@/lib/utils";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

const MENU = "/api/partner/menu";

interface Opt { id?: number; name: string; priceDelta: number; isAvailable: boolean }
interface Group { id?: number; name: string; minSelect: number; maxSelect: number; options: Opt[] }
interface Section { id: number; name: string; sortOrder: number }
interface Item {
  id: number; sectionId: number | null; name: string; description: string | null; price: number;
  imageUrl: string | null; dietaryTags: string[]; allergens: string[]; isAvailable: boolean; isPopular: boolean;
  optionGroups: Group[];
}

function useErr() {
  const t = useT();
  const { toast } = useToast();
  return (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message });
}

/** Botão com confirmação (AlertDialog). */
function ConfirmButton({ label, title, text, onConfirm, children, className }: {
  label: string; title: string; text?: string; onConfirm: () => void; children: React.ReactNode; className?: string;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" size="icon" aria-label={label} className={className} onClick={() => setOpen(true)}>{children}</Button>
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            {text && <AlertDialogDescription>{text}</AlertDialogDescription>}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={onConfirm}>{t(T.delete)}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default function PartnerMenu() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <MenuContent />
      </PanelShell>
    </Guard>
  );
}

function MenuContent() {
  const t = useT();
  const onErr = useErr();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useQuery<{ sections: Section[]; items: Item[] }>({ queryKey: [MENU] });
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [newSection, setNewSection] = useState("");
  const [renaming, setRenaming] = useState<{ id: number; name: string } | null>(null);
  const inv = () => queryClient.invalidateQueries({ queryKey: [MENU] });

  const addSection = useMutation({
    mutationFn: (name: string) => post("/api/partner/sections", { name, sortOrder: data?.sections.length ?? 0 }),
    onSuccess: () => { setNewSection(""); inv(); },
    onError: onErr,
  });
  const renameSection = useMutation({
    mutationFn: (v: { id: number; name: string }) => put(`/api/partner/sections/${v.id}`, { name: v.name }),
    onSuccess: () => { setRenaming(null); inv(); },
    onError: onErr,
  });
  const deleteSection = useMutation({
    mutationFn: (id: number) => del(`/api/partner/sections/${id}`),
    onSuccess: inv,
    onError: onErr,
  });
  const availability = useMutation({
    mutationFn: (v: { id: number; isAvailable: boolean }) => patch(`/api/partner/items/${v.id}/availability`, { isAvailable: v.isAvailable }),
    onSuccess: inv,
    onError: onErr,
  });
  const deleteItem = useMutation({
    mutationFn: (id: number) => del<{ archived?: boolean; message?: string } | undefined>(`/api/partner/items/${id}`),
    onSuccess: (res) => {
      inv();
      if (res?.archived) toast({ title: t({ pt: "Produto arquivado", en: "Item archived", fr: "Produit archivé" }), description: res.message });
      else toast({ title: t({ pt: "Produto apagado", en: "Item deleted", fr: "Produit supprimé" }) });
    },
    onError: onErr,
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const { sections, items } = data!;
  const groups: { section: Section | null; items: Item[] }[] = [
    ...sections.map((s) => ({ section: s, items: items.filter((i) => i.sectionId === s.id) })),
  ];
  const orphan = items.filter((i) => !i.sectionId || !sections.some((s) => s.id === i.sectionId));
  if (orphan.length) groups.push({ section: null, items: orphan });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold">{t({ pt: "Menu", en: "Menu", fr: "Menu" })}</h1>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" />{t({ pt: "Novo produto", en: "New item", fr: "Nouveau produit" })}</Button>
      </div>

      <form className="flex flex-wrap items-end gap-2 rounded-lg border bg-white p-3"
        onSubmit={(e) => { e.preventDefault(); if (newSection.trim()) addSection.mutate(newSection.trim()); }}>
        <div className="flex-1 min-w-[200px] space-y-1">
          <Label htmlFor="new-section">{t({ pt: "Nova secção", en: "New section", fr: "Nouvelle section" })}</Label>
          <Input id="new-section" value={newSection} maxLength={60} onChange={(e) => setNewSection(e.target.value)}
            placeholder={t({ pt: "Ex.: Grelhados, Bebidas…", en: "E.g. Grills, Drinks…", fr: "Ex. : Grillades, Boissons…" })} />
        </div>
        <Button type="submit" variant="outline" disabled={!newSection.trim() || addSection.isPending}>{t(T.add)}</Button>
      </form>

      {!items.length && !sections.length && (
        <EmptyState icon="🍽️" title={t({ pt: "O seu menu está vazio", en: "Your menu is empty", fr: "Votre menu est vide" })}
          text={t({ pt: "Crie secções e adicione produtos para começar a vender.", en: "Create sections and add items to start selling.", fr: "Créez des sections et ajoutez des produits pour commencer à vendre." })} />
      )}

      {groups.map(({ section, items: list }) => (
        <section key={section?.id ?? "none"} className="rounded-lg border bg-white">
          <header className="flex items-center justify-between gap-2 border-b p-3">
            {section && renaming?.id === section.id ? (
              <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); if (renaming.name.trim()) renameSection.mutate({ id: section.id, name: renaming.name.trim() }); }}>
                <Input aria-label={t({ pt: "Nome da secção", en: "Section name", fr: "Nom de la section" })} value={renaming.name} maxLength={60} autoFocus
                  onChange={(e) => setRenaming({ id: section.id, name: e.target.value })} />
                <Button type="submit" size="sm" disabled={renameSection.isPending}>{t(T.save)}</Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setRenaming(null)}>{t(T.cancel)}</Button>
              </form>
            ) : (
              <>
                <h2 className="font-semibold">
                  {section ? section.name : t({ pt: "Sem secção", en: "No section", fr: "Sans section" })}
                  <span className="ml-2 text-xs font-normal text-neutral-500">({list.length})</span>
                </h2>
                {section && (
                  <div className="flex">
                    <Button variant="ghost" size="icon" aria-label={t({ pt: "Renomear secção", en: "Rename section", fr: "Renommer la section" })}
                      onClick={() => setRenaming({ id: section.id, name: section.name })}><Pencil /></Button>
                    <ConfirmButton label={t({ pt: "Apagar secção", en: "Delete section", fr: "Supprimer la section" })}
                      title={t({ pt: `Apagar a secção "${section.name}"?`, en: `Delete section "${section.name}"?`, fr: `Supprimer la section « ${section.name} » ?` })}
                      text={t({ pt: "Os produtos não são apagados; ficam sem secção.", en: "Items are not deleted; they become unsectioned.", fr: "Les produits ne sont pas supprimés ; ils restent sans section." })}
                      onConfirm={() => deleteSection.mutate(section.id)}><Trash2 className="text-red-600" /></ConfirmButton>
                  </div>
                )}
              </>
            )}
          </header>
          {list.length === 0 ? (
            <p className="p-4 text-sm text-neutral-500">{t({ pt: "Sem produtos nesta secção.", en: "No items in this section.", fr: "Aucun produit dans cette section." })}</p>
          ) : (
            <ul className="divide-y">
              {list.map((it) => (
                <li key={it.id} className={cn("flex items-center gap-3 p-3", !it.isAvailable && "opacity-60")}>
                  <StoreImage name={it.name} url={it.imageUrl} className="h-12 w-12 shrink-0 text-sm" />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 font-medium">
                      <span className="truncate">{it.name}</span>
                      {it.isPopular && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" aria-label={t({ pt: "Popular", en: "Popular", fr: "Populaire" })} />}
                    </p>
                    <p className="text-sm text-neutral-600">{kz(it.price)}
                      {it.optionGroups.length > 0 && <span className="ml-2 text-xs text-neutral-500">· {it.optionGroups.length} {t({ pt: "grupos de opções", en: "option groups", fr: "groupes d'options" })}</span>}
                    </p>
                    <DietaryBadges tags={it.dietaryTags} small />
                  </div>
                  <div className="flex items-center gap-1">
                    <Switch checked={it.isAvailable} aria-label={t({ pt: "Disponível", en: "Available", fr: "Disponible" })}
                      onCheckedChange={(v) => availability.mutate({ id: it.id, isAvailable: v })} />
                    <Button variant="ghost" size="icon" aria-label={t(T.edit)} onClick={() => setEditing(it)}><Pencil /></Button>
                    <ConfirmButton label={t(T.delete)}
                      title={t({ pt: `Apagar "${it.name}"?`, en: `Delete "${it.name}"?`, fr: `Supprimer « ${it.name} » ?` })}
                      text={t({ pt: "Se o produto já tiver encomendas, fica apenas indisponível.", en: "If the item already has orders, it will only be made unavailable.", fr: "Si le produit a déjà des commandes, il sera seulement rendu indisponible." })}
                      onConfirm={() => deleteItem.mutate(it.id)}><Trash2 className="text-red-600" /></ConfirmButton>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}

      {editing && (
        <ItemEditor item={editing === "new" ? null : editing} sections={sections} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

/** Texto que o cliente vê para um grupo. */
function groupRule(g: Group): Tr {
  const { minSelect: mn, maxSelect: mx } = g;
  if (mn > 0 && mn === mx) return { pt: `Obrigatório escolher ${mn}`, en: `Required: choose ${mn}`, fr: `Obligatoire : choisir ${mn}` };
  if (mn > 0) return { pt: `Obrigatório: escolha entre ${mn} e ${mx}`, en: `Required: choose ${mn} to ${mx}`, fr: `Obligatoire : choisir de ${mn} à ${mx}` };
  if (mx === 1) return { pt: "Opcional: escolha até 1", en: "Optional: choose up to 1", fr: "Facultatif : jusqu'à 1" };
  return { pt: `Opcional: escolha até ${mx}`, en: `Optional: choose up to ${mx}`, fr: `Facultatif : jusqu'à ${mx}` };
}

function groupError(g: Group): Tr | null {
  if (!g.name.trim()) return { pt: "O grupo precisa de nome.", en: "Group needs a name.", fr: "Le groupe doit avoir un nom." };
  if (!g.options.length) return { pt: "Adicione pelo menos uma opção.", en: "Add at least one option.", fr: "Ajoutez au moins une option." };
  if (g.options.some((o) => !o.name.trim())) return { pt: "Todas as opções precisam de nome.", en: "All options need a name.", fr: "Toutes les options doivent avoir un nom." };
  if (g.maxSelect < 1) return { pt: "O máximo tem de ser pelo menos 1.", en: "Maximum must be at least 1.", fr: "Le maximum doit être au moins 1." };
  if (g.minSelect > g.maxSelect) return { pt: "O mínimo não pode ser maior que o máximo.", en: "Minimum cannot exceed maximum.", fr: "Le minimum ne peut pas dépasser le maximum." };
  if (g.maxSelect > g.options.length) return { pt: "O máximo não pode ser maior que o número de opções.", en: "Maximum cannot exceed the number of options.", fr: "Le maximum ne peut pas dépasser le nombre d'options." };
  return null;
}

const toInt = (v: string) => (v === "" ? 0 : Math.trunc(Number(v)) || 0);

function ItemEditor({ item, sections, onClose }: { item: Item | null; sections: Section[]; onClose: () => void }) {
  const t = useT();
  const onErr = useErr();
  const { toast } = useToast();
  const [name, setName] = useState(item?.name ?? "");
  const [description, setDescription] = useState(item?.description ?? "");
  const [price, setPrice] = useState(item ? String(item.price) : "");
  const [sectionId, setSectionId] = useState<string>(item?.sectionId ? String(item.sectionId) : sections[0] ? String(sections[0].id) : "none");
  const [imageUrl, setImageUrl] = useState(item?.imageUrl ?? "");
  const [dietary, setDietary] = useState<string[]>(item?.dietaryTags ?? []);
  const [allergens, setAllergens] = useState<string[]>(item?.allergens ?? []);
  const [isPopular, setPopular] = useState(item?.isPopular ?? false);
  const [isAvailable, setAvailable] = useState(item?.isAvailable ?? true);
  const [groups, setGroups] = useState<Group[]>(
    item?.optionGroups.map((g) => ({ name: g.name, minSelect: g.minSelect, maxSelect: g.maxSelect, options: g.options.map((o) => ({ name: o.name, priceDelta: o.priceDelta, isAvailable: o.isAvailable })) })) ?? [],
  );

  const updGroup = (i: number, g: Partial<Group>) => setGroups((gs) => gs.map((x, k) => (k === i ? { ...x, ...g } : x)));
  const updOpt = (gi: number, oi: number, o: Partial<Opt>) =>
    setGroups((gs) => gs.map((x, k) => (k === gi ? { ...x, options: x.options.map((y, j) => (j === oi ? { ...y, ...o } : y)) } : x)));
  const toggle = (list: string[], set: (v: string[]) => void, v: string) => set(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  const priceNum = Number(price);
  const urlOk = !imageUrl.trim() || /^https?:\/\/\S+$/i.test(imageUrl.trim());
  const firstGroupErr = groups.map(groupError).find(Boolean) ?? null;
  const formErr: Tr | null = !name.trim() ? { pt: "Indique o nome.", en: "Enter a name.", fr: "Indiquez le nom." }
    : price === "" || !Number.isInteger(priceNum) || priceNum < 0 ? { pt: "Preço inválido (Kz, número inteiro).", en: "Invalid price (Kz, whole number).", fr: "Prix invalide (Kz, nombre entier)." }
    : !urlOk ? { pt: "URL da imagem inválido.", en: "Invalid image URL.", fr: "URL d'image invalide." }
    : firstGroupErr;

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        sectionId: sectionId === "none" ? null : Number(sectionId),
        name: name.trim(),
        description: description.trim() || null,
        price: priceNum,
        imageUrl: imageUrl.trim() || null,
        dietaryTags: dietary,
        allergens,
        isAvailable,
        isPopular,
        optionGroups: groups.map((g) => ({
          name: g.name.trim(), minSelect: g.minSelect, maxSelect: g.maxSelect,
          options: g.options.map((o) => ({ name: o.name.trim(), priceDelta: o.priceDelta, isAvailable: o.isAvailable })),
        })),
      };
      return item ? put(`/api/partner/items/${item.id}`, payload) : post("/api/partner/items", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [MENU] });
      toast({ title: t({ pt: "Produto guardado", en: "Item saved", fr: "Produit enregistré" }) });
      onClose();
    },
    onError: onErr,
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{item ? t({ pt: "Editar produto", en: "Edit item", fr: "Modifier le produit" }) : t({ pt: "Novo produto", en: "New item", fr: "Nouveau produit" })}</DialogTitle>
          <DialogDescription>{t({ pt: "Preços em Kwanza (números inteiros).", en: "Prices in Kwanza (whole numbers).", fr: "Prix en Kwanza (nombres entiers)." })}</DialogDescription>
        </DialogHeader>

        <form id="item-form" className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (!formErr) save.mutate(); }}>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="it-name">{t({ pt: "Nome", en: "Name", fr: "Nom" })}</Label>
              <Input id="it-name" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} required />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="it-desc">{t({ pt: "Descrição", en: "Description", fr: "Description" })}</Label>
              <Textarea id="it-desc" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="it-price">{t({ pt: "Preço (Kz)", en: "Price (Kz)", fr: "Prix (Kz)" })}</Label>
              <Input id="it-price" type="number" inputMode="numeric" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="it-section">{t({ pt: "Secção", en: "Section", fr: "Section" })}</Label>
              <Select value={sectionId} onValueChange={setSectionId}>
                <SelectTrigger id="it-section"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">{t({ pt: "Sem secção", en: "No section", fr: "Sans section" })}</SelectItem>
                  {sections.map((s) => <SelectItem key={s.id} value={String(s.id)}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="it-img">{t({ pt: "URL da imagem (opcional)", en: "Image URL (optional)", fr: "URL de l'image (facultatif)" })}</Label>
              <Input id="it-img" type="url" value={imageUrl} maxLength={500} placeholder="https://…" onChange={(e) => setImageUrl(e.target.value)} />
            </div>
          </div>

          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t({ pt: "Etiquetas alimentares", en: "Dietary tags", fr: "Étiquettes alimentaires" })}</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(DIETARY).map(([k, v]) => (
                <button type="button" key={k} aria-pressed={dietary.includes(k)} onClick={() => toggle(dietary, setDietary, k)}
                  className={cn("min-h-9 rounded-full border px-3 text-sm", dietary.includes(k) ? "border-green-600 bg-green-50 text-green-800" : "bg-white text-neutral-700")}>
                  {v.icon} {t(v)}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-1 text-sm font-medium">{t({ pt: "Alergénios", en: "Allergens", fr: "Allergènes" })}</legend>
            <div className="flex flex-wrap gap-2">
              {Object.entries(ALLERGEN).map(([k, v]) => (
                <button type="button" key={k} aria-pressed={allergens.includes(k)} onClick={() => toggle(allergens, setAllergens, k)}
                  className={cn("min-h-9 rounded-full border px-3 text-sm", allergens.includes(k) ? "border-red-500 bg-red-50 text-red-800" : "bg-white text-neutral-700")}>
                  {t(v)}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-wrap gap-6">
            <div className="flex items-center gap-2">
              <Switch id="it-popular" checked={isPopular} onCheckedChange={setPopular} />
              <Label htmlFor="it-popular">{t({ pt: "Popular", en: "Popular", fr: "Populaire" })}</Label>
            </div>
            <div className="flex items-center gap-2">
              <Switch id="it-avail" checked={isAvailable} onCheckedChange={setAvailable} />
              <Label htmlFor="it-avail">{t({ pt: "Disponível", en: "Available", fr: "Disponible" })}</Label>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">{t({ pt: "Personalização (grupos de opções)", en: "Customisation (option groups)", fr: "Personnalisation (groupes d'options)" })}</h3>
              <Button type="button" size="sm" variant="outline" disabled={groups.length >= 10}
                onClick={() => setGroups((gs) => [...gs, { name: "", minSelect: 0, maxSelect: 1, options: [{ name: "", priceDelta: 0, isAvailable: true }] }])}>
                <Plus className="h-4 w-4" />{t({ pt: "Grupo", en: "Group", fr: "Groupe" })}
              </Button>
            </div>
            {groups.length === 0 && (
              <p className="text-sm text-neutral-500">{t({ pt: "Ex.: Tamanho, Molho, Retirar ingredientes, Acompanhamento.", en: "E.g. Size, Sauce, Remove ingredients, Side.", fr: "Ex. : Taille, Sauce, Retirer des ingrédients, Accompagnement." })}</p>
            )}
            {groups.map((g, gi) => {
              const err = groupError(g);
              return (
                <div key={gi} className="rounded-lg border bg-neutral-50 p-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_80px_80px_auto] sm:items-end">
                    <div className="space-y-1">
                      <Label htmlFor={`g-${gi}-name`}>{t({ pt: "Nome do grupo", en: "Group name", fr: "Nom du groupe" })}</Label>
                      <Input id={`g-${gi}-name`} value={g.name} maxLength={60} onChange={(e) => updGroup(gi, { name: e.target.value })} />
                    </div>
                    <Button type="button" variant="ghost" size="icon" className="self-end sm:order-last" aria-label={t({ pt: "Remover grupo", en: "Remove group", fr: "Supprimer le groupe" })}
                      onClick={() => setGroups((gs) => gs.filter((_, k) => k !== gi))}><Trash2 className="text-red-600" /></Button>
                    <div className="space-y-1">
                      <Label htmlFor={`g-${gi}-min`}>{t({ pt: "Mín.", en: "Min", fr: "Min" })}</Label>
                      <Input id={`g-${gi}-min`} type="number" min={0} max={20} value={g.minSelect} onChange={(e) => updGroup(gi, { minSelect: Math.max(0, toInt(e.target.value)) })} />
                    </div>
                    <div className="space-y-1">
                      <Label htmlFor={`g-${gi}-max`}>{t({ pt: "Máx.", en: "Max", fr: "Max" })}</Label>
                      <Input id={`g-${gi}-max`} type="number" min={1} max={20} value={g.maxSelect} onChange={(e) => updGroup(gi, { maxSelect: Math.max(0, toInt(e.target.value)) })} />
                    </div>
                  </div>
                  <p className="mt-2 text-xs text-neutral-600">{t({ pt: "Cliente vê:", en: "Customer sees:", fr: "Le client voit :" })} <strong>{t(groupRule(g))}</strong></p>
                  {err && <p className="mt-1 text-xs font-medium text-red-600" role="alert">{t(err)}</p>}

                  <ul className="mt-2 space-y-2">
                    {g.options.map((o, oi) => (
                      <li key={oi} className="grid grid-cols-[1fr_110px_auto_auto] items-center gap-2">
                        <Input aria-label={t({ pt: "Nome da opção", en: "Option name", fr: "Nom de l'option" })} placeholder={t({ pt: "Opção", en: "Option", fr: "Option" })}
                          value={o.name} maxLength={60} onChange={(e) => updOpt(gi, oi, { name: e.target.value })} />
                        <Input aria-label={t({ pt: "Preço adicional (Kz)", en: "Extra price (Kz)", fr: "Supplément (Kz)" })} type="number" step={1}
                          value={o.priceDelta} onChange={(e) => updOpt(gi, oi, { priceDelta: toInt(e.target.value) })} />
                        <Switch checked={o.isAvailable} aria-label={t({ pt: "Opção disponível", en: "Option available", fr: "Option disponible" })}
                          onCheckedChange={(v) => updOpt(gi, oi, { isAvailable: v })} />
                        <Button type="button" variant="ghost" size="icon" aria-label={t({ pt: "Remover opção", en: "Remove option", fr: "Supprimer l'option" })}
                          onClick={() => updGroup(gi, { options: g.options.filter((_, j) => j !== oi) })}><X /></Button>
                      </li>
                    ))}
                  </ul>
                  <Button type="button" variant="link" size="sm" className="px-0" disabled={g.options.length >= 30}
                    onClick={() => updGroup(gi, { options: [...g.options, { name: "", priceDelta: 0, isAvailable: true }] })}>
                    + {t({ pt: "Adicionar opção", en: "Add option", fr: "Ajouter une option" })}
                  </Button>
                  <p className="text-[11px] text-neutral-500">{t({ pt: "Preço adicional: 0 = sem custo extra.", en: "Extra price: 0 = no extra cost.", fr: "Supplément : 0 = sans coût." })}</p>
                </div>
              );
            })}
          </div>
        </form>

        <DialogFooter className="gap-2">
          {formErr && <p className="mr-auto text-sm text-red-600" role="alert">{t(formErr)}</p>}
          <Button variant="outline" onClick={onClose}>{t(T.cancel)}</Button>
          <Button type="submit" form="item-form" disabled={!!formErr || save.isPending}>{t(T.save)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
