import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loading, ErrorState, EmptyState, StoreImage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { patch, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime, STORE_TYPE } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPage } from "./AdminDashboard";

interface AdminStore {
  id: number; name: string; storeType: string; zone: string; street: string; phone: string; isApproved: boolean; isChain: boolean; isHomeBusiness?: boolean;
  isOpen: boolean; deliveryFee: number; businessNif: string | null; ownerName: string | null; ownerPhone: string | null;
  logoUrl: string | null; createdAt: string; ratingAvg: number; ratingCount: number; zonesServed: string[];
}

export default function AdminStores() {
  return <AdminPage><StoresContent /></AdminPage>;
}

function StoresContent() {
  const t = useT();
  const [pendingOnly, setPendingOnly] = useState(new URLSearchParams(useSearch()).get("pending") === "1");
  const url = pendingOnly ? "/api/admin/stores?pending=1" : "/api/admin/stores";
  const { data, isLoading, error, refetch } = useQuery<{ stores: AdminStore[] }>({ queryKey: [url] });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-bold">{t({ pt: "Lojas", en: "Stores", fr: "Magasins" })}</h1>
        <div className="flex items-center gap-2">
          <Switch id="pending-only" checked={pendingOnly} onCheckedChange={setPendingOnly} />
          <Label htmlFor="pending-only">{t({ pt: "Só por aprovar", en: "Pending only", fr: "En attente seulement" })}</Label>
        </div>
      </div>
      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !data!.stores.length ? (
        <EmptyState icon="🏪" title={pendingOnly ? t({ pt: "Nenhuma loja por aprovar", en: "No stores pending", fr: "Aucun magasin en attente" }) : t({ pt: "Sem lojas", en: "No stores", fr: "Aucun magasin" })} />
      ) : (
        <ul className="grid gap-3 lg:grid-cols-2">{data!.stores.map((s) => <StoreRow key={s.id} store={s} />)}</ul>
      )}
    </div>
  );
}

function StoreRow({ store }: { store: AdminStore }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [fee, setFee] = useState(String(store.deliveryFee));
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const m = useMutation({
    mutationFn: (body: Partial<Pick<AdminStore, "isApproved" | "isChain" | "isOpen" | "deliveryFee" | "isHomeBusiness">>) => patch(`/api/admin/stores/${store.id}`, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/stores") });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: t({ pt: "Loja actualizada", en: "Store updated", fr: "Magasin mis à jour" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  const feeNum = Number(fee);
  const feeValid = fee !== "" && Number.isInteger(feeNum) && feeNum >= 0;
  return (
    <li className={cn("rounded-lg border bg-white p-4", !store.isApproved && "border-amber-400")}>
      <div className="flex items-start gap-3">
        <StoreImage name={store.name} url={store.logoUrl} className="h-12 w-12 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/loja/${store.id}`} className="font-semibold hover:underline">{store.name}</Link>
            <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", store.isApproved ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800")}>
              {store.isApproved ? t({ pt: "Aprovada", en: "Approved", fr: "Approuvé" }) : t({ pt: "Por aprovar / suspensa", en: "Pending / suspended", fr: "En attente / suspendu" })}
            </span>
          </div>
          <p className="text-sm text-neutral-600">
            {STORE_TYPE[store.storeType] ? `${STORE_TYPE[store.storeType].icon} ${t(STORE_TYPE[store.storeType])}` : store.storeType} · {store.zone}
          </p>
          <p className="text-xs text-neutral-500">{store.street} · {store.phone}</p>
          <p className="mt-1 text-xs text-neutral-600">
            {t({ pt: "Dono", en: "Owner", fr: "Propriétaire" })}: {store.ownerName ?? "—"}{store.ownerPhone && ` · ${store.ownerPhone}`} · NIF: {store.businessNif || "—"}
          </p>
          <p className="text-xs text-neutral-400">{t({ pt: "Criada", en: "Created", fr: "Créé" })} {dateTime(store.createdAt, lang)}{store.ratingCount > 0 && ` · ★ ${store.ratingAvg.toFixed(1)} (${store.ratingCount})`}</p>
        </div>
      </div>

      <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
        <div className="flex items-center gap-2">
          <Switch id={`chain-${store.id}`} checked={store.isChain} disabled={m.isPending} onCheckedChange={(v) => m.mutate({ isChain: v })} />
          <Label htmlFor={`chain-${store.id}`}>{t({ pt: "Cadeia", en: "Chain", fr: "Chaîne" })}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`home-${store.id}`} checked={!!store.isHomeBusiness} disabled={m.isPending} onCheckedChange={(v) => m.mutate({ isHomeBusiness: v })} />
          <Label htmlFor={`home-${store.id}`}>🏠 {t({ pt: "Negócio caseiro", en: "Home business", fr: "Activité à domicile" })}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch id={`open-${store.id}`} checked={store.isOpen} disabled={m.isPending} onCheckedChange={(v) => m.mutate({ isOpen: v })} />
          <Label htmlFor={`open-${store.id}`}>{store.isOpen ? t(T.open) : t(T.closed)}</Label>
        </div>
        <form className="flex items-end gap-2 sm:col-span-2" onSubmit={(e) => { e.preventDefault(); if (feeValid) m.mutate({ deliveryFee: feeNum }); }}>
          <div className="space-y-1">
            <Label htmlFor={`fee-${store.id}`}>{t(T.deliveryFee)} (Kz)</Label>
            <Input id={`fee-${store.id}`} className="w-32" type="number" min={0} step={1} value={fee} onChange={(e) => setFee(e.target.value)} />
          </div>
          <Button type="submit" size="sm" variant="outline" disabled={!feeValid || feeNum === store.deliveryFee || m.isPending}>{t(T.save)}</Button>
          <span className="pb-2 text-xs text-neutral-500">{t({ pt: "Actual", en: "Current", fr: "Actuel" })}: {kz(store.deliveryFee)}</span>
        </form>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        {store.isApproved ? (
          <Button variant="outline" className="text-red-700" disabled={m.isPending} onClick={() => setConfirmSuspend(true)}>{t({ pt: "Suspender", en: "Suspend", fr: "Suspendre" })}</Button>
        ) : (
          <Button disabled={m.isPending} onClick={() => m.mutate({ isApproved: true })}>{t({ pt: "Aprovar", en: "Approve", fr: "Approuver" })}</Button>
        )}
      </div>

      <AlertDialog open={confirmSuspend} onOpenChange={setConfirmSuspend}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: `Suspender "${store.name}"?`, en: `Suspend "${store.name}"?`, fr: `Suspendre « ${store.name} » ?` })}</AlertDialogTitle>
            <AlertDialogDescription>{t({ pt: "A loja deixa de aparecer aos clientes até ser aprovada de novo.", en: "The store will be hidden from customers until approved again.", fr: "Le magasin sera masqué jusqu'à nouvelle approbation." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => m.mutate({ isApproved: false })}>{t({ pt: "Suspender", en: "Suspend", fr: "Suspendre" })}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  );
}
