import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { del, put, queryClient } from "@/lib/api";
import { T, useT } from "@/lib/i18n";
import { AddressForm, useAddresses, type Address } from "./_orderingKit";

export default function Addresses() {
  const t = useT();
  return (
    <CustomerShell hideHeader>
      <TopBar title={t({ pt: "As minhas moradas", en: "My addresses", fr: "Mes adresses" })} back="/perfil" />
      <Guard>
        <AddressList />
      </Guard>
    </CustomerShell>
  );
}

function AddressList() {
  const t = useT();
  const { toast } = useToast();
  const { data, isLoading, error, refetch } = useAddresses();
  const [editing, setEditing] = useState<Address | null>(null);
  const [adding, setAdding] = useState(false);
  const [toDelete, setToDelete] = useState<Address | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["/api/addresses"] });
  const onError = (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message });

  const makeDefault = useMutation({
    mutationFn: (a: Address) => put(`/api/addresses/${a.id}`, { isDefault: true }),
    onSuccess: refresh,
    onError,
  });
  const remove = useMutation({
    mutationFn: (a: Address) => del(`/api/addresses/${a.id}`),
    onSuccess: () => {
      refresh();
      toast({ title: t({ pt: "Morada apagada", en: "Address deleted", fr: "Adresse supprimée" }) });
    },
    onError,
  });

  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const list = data?.addresses ?? [];

  if (adding || editing) {
    return (
      <div className="p-4">
        <h2 className="mb-3 font-semibold">
          {editing ? t({ pt: "Editar morada", en: "Edit address", fr: "Modifier l'adresse" }) : t({ pt: "Nova morada", en: "New address", fr: "Nouvelle adresse" })}
        </h2>
        <AddressForm
          address={editing}
          onDone={() => { setAdding(false); setEditing(null); refresh(); }}
          onCancel={() => { setAdding(false); setEditing(null); }}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 p-4">
      {list.length === 0 ? (
        <EmptyState icon="📍" title={t({ pt: "Ainda não tem moradas", en: "No addresses yet", fr: "Aucune adresse" })}
          text={t({ pt: "Adicione onde quer receber as suas encomendas.", en: "Add where you want your orders delivered.", fr: "Ajoutez où vous souhaitez être livré." })} />
      ) : list.map((a) => (
        <div key={a.id} className="rounded-xl border p-3">
          <div className="flex items-start gap-3">
            <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {a.label}
                {a.isDefault && (
                  <span className="ml-2 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                    {t({ pt: "Principal", en: "Default", fr: "Par défaut" })}
                  </span>
                )}
              </p>
              <p className="text-sm text-neutral-700">{a.street}</p>
              <p className="text-sm text-neutral-500">{a.zone}, {a.city}</p>
              {a.reference && <p className="text-xs text-neutral-500">{t({ pt: "Ref.", en: "Ref.", fr: "Réf." })}: {a.reference}</p>}
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {!a.isDefault && (
              <Button size="sm" variant="outline" disabled={makeDefault.isPending} onClick={() => makeDefault.mutate(a)}>
                <Star className="mr-1 h-4 w-4" />{t({ pt: "Tornar principal", en: "Make default", fr: "Par défaut" })}
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing(a)}>
              <Pencil className="mr-1 h-4 w-4" />{t(T.edit)}
            </Button>
            <Button size="sm" variant="outline" className="text-red-600" onClick={() => setToDelete(a)}>
              <Trash2 className="mr-1 h-4 w-4" />{t(T.delete)}
            </Button>
          </div>
        </div>
      ))}

      <Button className="w-full" onClick={() => setAdding(true)}>
        <Plus className="mr-1 h-4 w-4" />{t({ pt: "Adicionar morada", en: "Add address", fr: "Ajouter une adresse" })}
      </Button>

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Apagar morada?", en: "Delete address?", fr: "Supprimer l'adresse ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{toDelete?.label} — {toDelete?.street}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => { if (toDelete) remove.mutate(toDelete); setToDelete(null); }}>
              {t(T.delete)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
