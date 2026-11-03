import { useEffect, useState } from "react";
import { useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loading, ErrorState, EmptyState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AdminPage } from "./AdminDashboard";

interface AdminUser {
  id: number; username: string; fullName: string; email: string | null; phone: string;
  userType: "customer" | "supplier" | "driver" | "admin"; isApproved: boolean; isActive: boolean; createdAt: string;
}

const TYPE_LABEL: Record<AdminUser["userType"], Tr> = {
  customer: { pt: "Cliente", en: "Customer", fr: "Client" },
  supplier: { pt: "Loja", en: "Store", fr: "Magasin" },
  driver: { pt: "Estafeta", en: "Rider", fr: "Livreur" },
  admin: { pt: "Admin", en: "Admin", fr: "Admin" },
};

export default function AdminUsers() {
  return <AdminPage><UsersContent /></AdminPage>;
}

function UsersContent() {
  const t = useT();
  const initial = new URLSearchParams(useSearch());
  const [q, setQ] = useState(initial.get("q") ?? "");
  const [debounced, setDebounced] = useState(q);
  const [type, setType] = useState(initial.get("type") ?? "all");
  const [pending, setPending] = useState(initial.get("pending") === "1");
  const [plusFor, setPlusFor] = useState<AdminUser | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setDebounced(q.trim()), 350);
    return () => clearTimeout(id);
  }, [q]);

  const qs = new URLSearchParams();
  if (debounced) qs.set("q", debounced);
  if (type !== "all") qs.set("type", type);
  if (pending) qs.set("pending", "1");
  const url = `/api/admin/users${qs.toString() ? `?${qs}` : ""}`;
  const { data, isLoading, error, refetch } = useQuery<{ users: AdminUser[] }>({ queryKey: [url] });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t({ pt: "Utilizadores", en: "Users", fr: "Utilisateurs" })}</h1>
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-white p-3">
        <div className="min-w-[220px] flex-1 space-y-1">
          <Label htmlFor="u-q">{t(T.search)}</Label>
          <Input id="u-q" type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t({ pt: "Nome, utilizador ou telemóvel", en: "Name, username or phone", fr: "Nom, identifiant ou téléphone" })} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="u-type">{t({ pt: "Tipo", en: "Type", fr: "Type" })}</Label>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger id="u-type" className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t({ pt: "Todos", en: "All", fr: "Tous" })}</SelectItem>
              {(Object.keys(TYPE_LABEL) as AdminUser["userType"][]).map((k) => <SelectItem key={k} value={k}>{t(TYPE_LABEL[k])}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex h-10 items-center gap-2">
          <Switch id="u-pending" checked={pending} onCheckedChange={setPending} />
          <Label htmlFor="u-pending">{t({ pt: "Por aprovar", en: "Pending approval", fr: "En attente" })}</Label>
        </div>
      </div>

      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !data!.users.length ? (
        <EmptyState icon="👤" title={t({ pt: "Nenhum utilizador encontrado", en: "No users found", fr: "Aucun utilisateur trouvé" })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="p-2">{t({ pt: "Nome", en: "Name", fr: "Nom" })}</th>
                <th className="p-2">{t({ pt: "Contacto", en: "Contact", fr: "Contact" })}</th>
                <th className="p-2">{t({ pt: "Tipo", en: "Type", fr: "Type" })}</th>
                <th className="p-2">{t({ pt: "Estado", en: "Status", fr: "Statut" })}</th>
                <th className="p-2">{t({ pt: "Registo", en: "Joined", fr: "Inscription" })}</th>
                <th className="p-2"><span className="sr-only">{t({ pt: "Acções", en: "Actions", fr: "Actions" })}</span></th>
              </tr>
            </thead>
            <tbody>{data!.users.map((u) => <UserRow key={u.id} user={u} onPlus={() => setPlusFor(u)} />)}</tbody>
          </table>
        </div>
      )}
      {plusFor && <PlusDialog user={plusFor} onClose={() => setPlusFor(null)} />}
    </div>
  );
}

function invalidateUsers() {
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/users") });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
}

function UserRow({ user, onPlus }: { user: AdminUser; onPlus: () => void }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const { user: me } = useAuth();
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const isMe = me?.id === user.id;
  const m = useMutation({
    mutationFn: (body: { isApproved?: boolean; isActive?: boolean }) => patch(`/api/admin/users/${user.id}`, body),
    onSuccess: () => { invalidateUsers(); toast({ title: t({ pt: "Utilizador actualizado", en: "User updated", fr: "Utilisateur mis à jour" }) }); },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  return (
    <tr className={cn("border-t", !user.isActive && "bg-neutral-50 text-neutral-500")}>
      <td className="p-2"><p className="font-medium">{user.fullName}</p><p className="text-xs text-neutral-500">@{user.username}</p></td>
      <td className="p-2 text-xs">{user.phone}{user.email && <p>{user.email}</p>}</td>
      <td className="p-2">{t(TYPE_LABEL[user.userType])}</td>
      <td className="p-2">
        <div className="flex flex-wrap gap-1">
          {!user.isApproved && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{t({ pt: "Por aprovar", en: "Pending", fr: "En attente" })}</span>}
          <span className={cn("rounded-full px-2 py-0.5 text-xs", user.isActive ? "bg-green-100 text-green-800" : "bg-neutral-200 text-neutral-700")}>
            {user.isActive ? t({ pt: "Activo", en: "Active", fr: "Actif" }) : t({ pt: "Desactivado", en: "Deactivated", fr: "Désactivé" })}
          </span>
        </div>
      </td>
      <td className="p-2 text-xs whitespace-nowrap">{dateTime(user.createdAt, lang)}</td>
      <td className="p-2">
        <div className="flex flex-wrap justify-end gap-1">
          {!user.isApproved && (
            <Button size="sm" disabled={m.isPending || isMe} onClick={() => m.mutate({ isApproved: true })}>{t({ pt: "Aprovar", en: "Approve", fr: "Approuver" })}</Button>
          )}
          {user.isActive ? (
            <Button size="sm" variant="outline" className="text-red-700" disabled={m.isPending || isMe} onClick={() => setConfirmDeactivate(true)}>{t({ pt: "Desactivar", en: "Deactivate", fr: "Désactiver" })}</Button>
          ) : (
            <Button size="sm" variant="outline" disabled={m.isPending || isMe} onClick={() => m.mutate({ isActive: true })}>{t({ pt: "Activar", en: "Activate", fr: "Activer" })}</Button>
          )}
          {user.userType === "customer" && (
            <Button size="sm" variant="outline" onClick={onPlus}>{t({ pt: "Activar Plus", en: "Activate Plus", fr: "Activer Plus" })}</Button>
          )}
        </div>
        <AlertDialog open={confirmDeactivate} onOpenChange={setConfirmDeactivate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{t({ pt: `Desactivar ${user.fullName}?`, en: `Deactivate ${user.fullName}?`, fr: `Désactiver ${user.fullName} ?` })}</AlertDialogTitle>
              <AlertDialogDescription>{t({ pt: "A conta deixa de poder entrar até ser activada de novo.", en: "The account won't be able to log in until reactivated.", fr: "Le compte ne pourra plus se connecter jusqu'à réactivation." })}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t(T.cancel)}</AlertDialogCancel>
              <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={() => m.mutate({ isActive: false })}>{t({ pt: "Desactivar", en: "Deactivate", fr: "Désactiver" })}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  );
}

function PlusDialog({ user, onClose }: { user: AdminUser; onClose: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [months, setMonths] = useState("1");
  const m = useMutation({
    mutationFn: () => post(`/api/admin/users/${user.id}/plus`, { months: Number(months) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
      toast({ title: t({ pt: "Plus activado", en: "Plus activated", fr: "Plus activé" }), description: user.fullName });
      onClose();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t({ pt: "Activar Plus", en: "Activate Plus", fr: "Activer Plus" })} · {user.fullName}</DialogTitle>
          <DialogDescription>{t({ pt: "Para pagamentos recebidos no escritório (numerário/transferência). Substitui uma subscrição activa.", en: "For payments received at the office (cash/transfer). Replaces any active subscription.", fr: "Pour les paiements reçus au bureau (espèces/virement). Remplace un abonnement actif." })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <Label htmlFor="plus-months">{t({ pt: "Meses", en: "Months", fr: "Mois" })}</Label>
          <Select value={months} onValueChange={setMonths}>
            <SelectTrigger id="plus-months" className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>{Array.from({ length: 12 }, (_, i) => String(i + 1)).map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t(T.cancel)}</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>{t(T.confirm)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
