import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { del, put, queryClient } from "@/lib/api";
import { useT, T } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { AddressForm, useAddresses, type Address } from "./_orderingKit";

function AddressesInner() {
  const t = useT();
  const { toast } = useToast();
  const q = useAddresses();
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Address | null>(null);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["/api/addresses"] });
  const onErr = (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message });

  const makeDefault = useMutation({
    mutationFn: (id: number) => put(`/api/addresses/${id}`, { isDefault: true }),
    onSuccess: () => { invalidate(); toast({ title: t({ pt: "Morada predefinida actualizada", en: "Default address updated", fr: "Adresse par défaut mise à jour" }) }); },
    onError: onErr,
  });
  const remove = useMutation({
    mutationFn: (id: number) => del(`/api/addresses/${id}`),
    onSuccess: () => { setDeleting(null); invalidate(); toast({ title: t({ pt: "Morada apagada", en: "Address deleted", fr: "Adresse supprimée" }) }); },
    onError: onErr,
  });

  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const list = q.data?.addresses ?? [];

  return (
    <div className="space-y-3 px-4 pb-8 pt-4">
      {list.length === 0 ? (
        <EmptyState icon={<MapPin className="h-10 w-10 text-neutral-300" />}
          title={t({ pt: "Ainda não tem moradas", en: "No addresses yet", fr: "Aucune adresse" })}
          text={t({ pt: "Guarde as suas moradas para encomendar mais depressa.", en: "Save your addresses to order faster.", fr: "Enregistrez vos adresses pour commander plus vite." })}
          action={<Button onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />{t({ pt: "Adicionar morada", en: "Add address", fr: "Ajouter une adresse" })}</Button>} />
      ) : (
        <>
          <ul className="space-y-3">
            {list.map((a) => (
              <li key={a.id} className={cn("rounded-2xl border bg-white p-4 shadow-sm", a.isDefault && "border-primary/60")}>
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-orange-50 text-primary"><MapPin className="h-5 w-5" /></span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-semibold">
                      {a.label}
                      {a.isDefault && <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-semibold text-orange-800">{t({ pt: "Predefinida", en: "Default", fr: "Par défaut" })}</span>}
                    </p>
                    <p className="text-sm text-neutral-600">{a.street}</p>
                    <p className="text-sm text-neutral-600">{a.zone}, {a.city}</p>
                    {a.reference && <p className="text-xs text-neutral-500">{a.reference}</p>}
                    {a.latitude != null && <p className="mt-1 text-[11px] text-green-700">📍 {t({ pt: "Com localização GPS", en: "GPS location saved", fr: "Position GPS enregistrée" })}</p>}
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {!a.isDefault && (
                    <Button variant="outline" size="sm" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(a.id)}>
                      <Star className="mr-1.5 h-4 w-4" />{t({ pt: "Tornar predefinida", en: "Make default", fr: "Par défaut" })}
                    </Button>
                  )}
                  <Button variant="outline" size="sm" onClick={() => setEditing(a)}><Pencil className="mr-1.5 h-4 w-4" />{t(T.edit)}</Button>
                  <Button variant="ghost" size="sm" className="text-red-600 hover:text-red-700" onClick={() => setDeleting(a)}><Trash2 className="mr-1.5 h-4 w-4" />{t(T.delete)}</Button>
                </div>
              </li>
            ))}
          </ul>
          <Button variant="outline" className="h-12 w-full rounded-xl border-dashed" onClick={() => setAdding(true)}>
            <Plus className="mr-1.5 h-4 w-4" />{t({ pt: "Adicionar morada", en: "Add address", fr: "Ajouter une adresse" })}
          </Button>
        </>
      )}

      <Dialog open={adding || !!editing} onOpenChange={(o) => { if (!o) { setAdding(false); setEditing(null); } }}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t({ pt: "Editar morada", en: "Edit address", fr: "Modifier l'adresse" }) : t({ pt: "Nova morada", en: "New address", fr: "Nouvelle adresse" })}</DialogTitle>
          </DialogHeader>
          <AddressForm key={editing?.id ?? "new"} address={editing}
            onDone={() => { setAdding(false); setEditing(null); }}
            onCancel={() => { setAdding(false); setEditing(null); }} />
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Apagar esta morada?", en: "Delete this address?", fr: "Supprimer cette adresse ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{deleting ? `${deleting.label} · ${deleting.street}, ${deleting.zone}` : ""}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={remove.isPending} onClick={(e) => { e.preventDefault(); if (deleting) remove.mutate(deleting.id); }}>
              {remove.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t(T.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default function Addresses() {
  const t = useT();
  return (
    <CustomerShell hideHeader>
      <TopBar title={t({ pt: "As minhas moradas", en: "My addresses", fr: "Mes adresses" })} back="/perfil" />
      <Guard><AddressesInner /></Guard>
    </CustomerShell>
  );
}
