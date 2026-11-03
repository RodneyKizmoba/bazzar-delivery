import { useEffect, useMemo, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DietaryBadges } from "@/components/common";
import { useT } from "@/lib/i18n";
import { ALLERGEN, kz } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface MenuOption { id: number; name: string; priceDelta: number; isAvailable: boolean }
export interface MenuOptionGroup { id: number; name: string; minSelect: number; maxSelect: number; options: MenuOption[] }
export interface MenuItemFull {
  id: number; storeId: number; sectionId: number | null; name: string; description: string | null; price: number;
  imageUrl: string | null; dietaryTags: string[]; allergens: string[]; isAvailable: boolean; isPopular: boolean;
  optionGroups: MenuOptionGroup[];
}

export interface ItemSelection {
  menuItemId: number;
  name: string;
  quantity: number;
  optionIds: number[];
  optionsLabel: string;
  specialInstructions: string;
  unitPrice: number;
}

/**
 * Diálogo de personalização de um produto (opções obrigatórias/opcionais, extras, retirar ingredientes,
 * instruções especiais e quantidade). Usado na página da loja e na encomenda em grupo.
 */
export function ItemDialog({ item, open, onOpenChange, onConfirm, confirmLabel, busy }: {
  item: MenuItemFull | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onConfirm: (sel: ItemSelection) => void;
  confirmLabel?: string;
  busy?: boolean;
}) {
  const t = useT();
  const [qty, setQty] = useState(1);
  const [chosen, setChosen] = useState<Record<number, number[]>>({});
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (!item) return;
    setQty(1);
    setNotes("");
    // pré-seleccionar a primeira opção disponível dos grupos obrigatórios de escolha única
    const init: Record<number, number[]> = {};
    for (const g of item.optionGroups) {
      const first = g.options.find((o) => o.isAvailable);
      init[g.id] = g.minSelect === 1 && g.maxSelect === 1 && first ? [first.id] : [];
    }
    setChosen(init);
  }, [item?.id, open]);

  const unitPrice = useMemo(() => {
    if (!item) return 0;
    const extra = item.optionGroups.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id))).reduce((s, o) => s + o.priceDelta, 0);
    return Math.max(0, item.price + extra);
  }, [item, chosen]);

  if (!item) return null;

  const problems = item.optionGroups.filter((g) => (chosen[g.id]?.length ?? 0) < g.minSelect);

  const toggle = (gId: number, oId: number, max: number) => {
    setChosen((prev) => {
      const cur = prev[gId] ?? [];
      if (max === 1) return { ...prev, [gId]: [oId] };
      if (cur.includes(oId)) return { ...prev, [gId]: cur.filter((x) => x !== oId) };
      if (cur.length >= max) return prev;
      return { ...prev, [gId]: [...cur, oId] };
    });
  };

  const confirm = () => {
    const opts = item.optionGroups.flatMap((g) => g.options.filter((o) => chosen[g.id]?.includes(o.id)));
    onConfirm({
      menuItemId: item.id,
      name: item.name,
      quantity: qty,
      optionIds: opts.map((o) => o.id),
      optionsLabel: opts.map((o) => o.name).join(" · "),
      specialInstructions: notes.trim(),
      unitPrice,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto p-0">
        {item.imageUrl && <img src={item.imageUrl} alt="" className="w-full h-44 object-cover" />}
        <div className="p-5 space-y-4">
          <DialogHeader className="text-left space-y-1">
            <DialogTitle className="text-lg">{item.name}</DialogTitle>
            {item.description && <DialogDescription>{item.description}</DialogDescription>}
            <p className="font-semibold text-primary">{kz(item.price)}</p>
          </DialogHeader>
          <DietaryBadges tags={item.dietaryTags} />
          {item.allergens.length > 0 && (
            <p className="text-xs text-neutral-600">
              <span className="font-medium">{t({ pt: "Alergénios", en: "Allergens", fr: "Allergènes" })}:</span>{" "}
              {item.allergens.map((a) => (ALLERGEN[a] ? t(ALLERGEN[a]) : a)).join(", ")}
            </p>
          )}

          {item.optionGroups.map((g) => {
            const required = g.minSelect > 0;
            const count = chosen[g.id]?.length ?? 0;
            return (
              <fieldset key={g.id} className="space-y-2">
                <legend className="flex w-full items-center justify-between">
                  <span className="font-semibold text-sm">{g.name}</span>
                  <span className={cn("text-xs rounded-full px-2 py-0.5", required ? "bg-amber-100 text-amber-800" : "bg-neutral-100 text-neutral-600")}>
                    {required
                      ? t({ pt: "Obrigatório", en: "Required", fr: "Obligatoire" })
                      : g.maxSelect > 1
                        ? t({ pt: `Até ${g.maxSelect}`, en: `Up to ${g.maxSelect}`, fr: `Jusqu'à ${g.maxSelect}` })
                        : t({ pt: "Opcional", en: "Optional", fr: "Facultatif" })}
                  </span>
                </legend>
                <div className="divide-y rounded-lg border">
                  {g.options.map((o) => {
                    const checked = chosen[g.id]?.includes(o.id) ?? false;
                    const disabled = !o.isAvailable || (!checked && g.maxSelect > 1 && count >= g.maxSelect);
                    return (
                      <label key={o.id} className={cn("flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer", disabled && "opacity-50 cursor-not-allowed")}>
                        <input
                          type={g.maxSelect === 1 ? "radio" : "checkbox"}
                          name={`g-${g.id}`}
                          className="h-4 w-4 accent-[hsl(var(--primary))]"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => toggle(g.id, o.id, g.maxSelect)}
                        />
                        <span className="flex-1">{o.name}{!o.isAvailable && ` (${t({ pt: "esgotado", en: "sold out", fr: "épuisé" })})`}</span>
                        {o.priceDelta !== 0 && <span className="text-neutral-600">{o.priceDelta > 0 ? "+" : ""}{kz(o.priceDelta)}</span>}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}

          <div className="space-y-1.5">
            <label htmlFor="item-notes" className="text-sm font-semibold">
              {t({ pt: "Instruções especiais", en: "Special instructions", fr: "Instructions spéciales" })}
            </label>
            <Textarea id="item-notes" value={notes} maxLength={200} rows={2} onChange={(e) => setNotes(e.target.value)}
              placeholder={t({ pt: "Ex.: bem passado, molho à parte…", en: "E.g. well done, sauce on the side…", fr: "Ex. : bien cuit, sauce à part…" })} />
          </div>

          <div className="flex items-center gap-3 pt-1">
            <div className="flex items-center rounded-full border">
              <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="-" onClick={() => setQty((q) => Math.max(1, q - 1))}><Minus className="h-4 w-4" /></Button>
              <span className="w-8 text-center font-semibold" aria-live="polite">{qty}</span>
              <Button type="button" variant="ghost" size="icon" className="rounded-full" aria-label="+" onClick={() => setQty((q) => Math.min(50, q + 1))}><Plus className="h-4 w-4" /></Button>
            </div>
            <Button className="flex-1" disabled={problems.length > 0 || busy || !item.isAvailable} onClick={confirm}>
              {problems.length > 0
                ? t({ pt: `Escolha: ${problems[0].name}`, en: `Choose: ${problems[0].name}`, fr: `Choisir : ${problems[0].name}` })
                : `${confirmLabel ?? t({ pt: "Adicionar", en: "Add", fr: "Ajouter" })} · ${kz(unitPrice * qty)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
