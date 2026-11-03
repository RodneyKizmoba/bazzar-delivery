import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loading, ErrorState, EmptyState, StatusBadge } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime, ORDER_STATUS, PAYMENT } from "@/lib/format";
import { AdminPage } from "./AdminDashboard";

/** Transições permitidas ao admin (espelha server/lib/orderFlow.ts). */
const ADMIN_NEXT: Record<string, string[]> = {
  scheduled: ["pending", "cancelled"], pending: ["accepted", "rejected", "cancelled"], accepted: ["preparing", "cancelled"],
  preparing: ["ready", "cancelled"], ready: ["picked_up", "cancelled"], picked_up: ["delivered", "cancelled"],
};
const ASSIGNABLE = ["accepted", "preparing", "ready", "picked_up"];

interface AdminOrder {
  id: number; orderNumber: string; status: string; total: number; createdAt: string; storeName: string; customerName: string;
  driverId: number | null; paymentMethod: string; paymentStatus: string; deliveryAddress: { zone: string };
}
interface Driver { id: number; fullName: string; phone: string; isApproved: boolean; isActive: boolean; activeOrder: number | null }

export default function AdminOrders() {
  return <AdminPage><OrdersContent /></AdminPage>;
}

function OrdersContent() {
  const t = useT();
  const { lang } = useLang();
  const search = new URLSearchParams(useSearch());
  const [status, setStatus] = useState<string>(search.get("status") ?? "all");
  const [unassigned, setUnassigned] = useState(search.get("unassigned") === "1");
  const [statusFor, setStatusFor] = useState<AdminOrder | null>(null);
  const [driverFor, setDriverFor] = useState<AdminOrder | null>(null);

  const qs = new URLSearchParams();
  if (status !== "all") qs.set("status", status);
  if (unassigned) qs.set("unassigned", "1");
  const url = `/api/admin/orders${qs.toString() ? `?${qs}` : ""}`;
  const { data, isLoading, error, refetch } = useQuery<{ orders: AdminOrder[] }>({ queryKey: [url], refetchInterval: 10_000 });
  const driversQ = useQuery<{ drivers: Driver[] }>({ queryKey: ["/api/admin/drivers"], refetchInterval: 15_000 });
  const driverName = (id: number | null) => (id ? driversQ.data?.drivers.find((d) => d.id === id)?.fullName ?? `#${id}` : null);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">{t({ pt: "Encomendas", en: "Orders", fr: "Commandes" })}</h1>
      <div className="flex flex-wrap items-end gap-4 rounded-lg border bg-white p-3">
        <div className="space-y-1">
          <Label htmlFor="f-status">{t({ pt: "Estado", en: "Status", fr: "Statut" })}</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="f-status" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t({ pt: "Todos", en: "All", fr: "Tous" })}</SelectItem>
              {Object.entries(ORDER_STATUS).map(([k, v]) => <SelectItem key={k} value={k}>{t(v)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex h-10 items-center gap-2">
          <Switch id="f-unassigned" checked={unassigned} onCheckedChange={setUnassigned} />
          <Label htmlFor="f-unassigned">{t({ pt: "Sem estafeta", en: "No rider", fr: "Sans livreur" })}</Label>
        </div>
      </div>

      {isLoading ? <Loading /> : error ? <ErrorState error={error} onRetry={() => refetch()} /> : !data!.orders.length ? (
        <EmptyState icon="🧾" title={t({ pt: "Nenhuma encomenda encontrada", en: "No orders found", fr: "Aucune commande trouvée" })} />
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr>
                <th className="p-2">{t({ pt: "Encomenda", en: "Order", fr: "Commande" })}</th>
                <th className="p-2">{t({ pt: "Loja", en: "Store", fr: "Magasin" })}</th>
                <th className="p-2">{t({ pt: "Cliente", en: "Customer", fr: "Client" })}</th>
                <th className="p-2">{t({ pt: "Estado", en: "Status", fr: "Statut" })}</th>
                <th className="p-2">{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}</th>
                <th className="p-2 text-right">{t(T.total)}</th>
                <th className="p-2">{t({ pt: "Criada", en: "Created", fr: "Créée" })}</th>
                <th className="p-2"><span className="sr-only">{t({ pt: "Acções", en: "Actions", fr: "Actions" })}</span></th>
              </tr>
            </thead>
            <tbody>
              {data!.orders.map((o) => (
                <tr key={o.id} className="border-t align-middle">
                  <td className="p-2"><Link href={`/encomendas/${o.id}`} className="font-mono text-xs text-primary hover:underline">{o.orderNumber}</Link></td>
                  <td className="p-2">{o.storeName}</td>
                  <td className="p-2">{o.customerName}<p className="text-xs text-neutral-500">{o.deliveryAddress?.zone}</p></td>
                  <td className="p-2"><StatusBadge status={o.status} /></td>
                  <td className="p-2 text-xs">{driverName(o.driverId) ?? (ASSIGNABLE.includes(o.status) ? <span className="font-semibold text-amber-700">{t({ pt: "Sem estafeta", en: "Unassigned", fr: "Non assignée" })}</span> : "—")}</td>
                  <td className="p-2 text-right whitespace-nowrap">{kz(o.total)}<p className="text-[11px] text-neutral-500">{PAYMENT[o.paymentMethod] ? t(PAYMENT[o.paymentMethod]) : o.paymentMethod}</p></td>
                  <td className="p-2 whitespace-nowrap text-xs">{dateTime(o.createdAt, lang)}</td>
                  <td className="p-2">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="outline" disabled={!ADMIN_NEXT[o.status]} onClick={() => setStatusFor(o)}>{t({ pt: "Estado", en: "Status", fr: "Statut" })}</Button>
                      <Button size="sm" variant="outline" disabled={!ASSIGNABLE.includes(o.status)} onClick={() => setDriverFor(o)}>{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {statusFor && <StatusDialog order={statusFor} onClose={() => setStatusFor(null)} />}
      {driverFor && <DriverDialog order={driverFor} drivers={driversQ.data?.drivers ?? []} loading={driversQ.isLoading} onClose={() => setDriverFor(null)} />}
    </div>
  );
}

function invalidateOrders() {
  queryClient.invalidateQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && (q.queryKey[0] as string).startsWith("/api/admin/orders") });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/stats"] });
  queryClient.invalidateQueries({ queryKey: ["/api/admin/drivers"] });
}

function StatusDialog({ order, onClose }: { order: AdminOrder; onClose: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const options = ADMIN_NEXT[order.status] ?? [];
  const [next, setNext] = useState(options[0] ?? "");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: () => post(`/api/admin/orders/${order.id}/status`, { status: next, note: note.trim() || null }),
    onSuccess: () => { invalidateOrders(); toast({ title: t({ pt: "Estado alterado", en: "Status changed", fr: "Statut modifié" }) }); onClose(); },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  const destructive = next === "cancelled" || next === "rejected";
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t({ pt: "Alterar estado", en: "Change status", fr: "Changer le statut" })} · {order.orderNumber}</DialogTitle>
          <DialogDescription>{t({ pt: "Estado actual:", en: "Current status:", fr: "Statut actuel :" })} {ORDER_STATUS[order.status] ? t(ORDER_STATUS[order.status]) : order.status}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label htmlFor="next-status">{t({ pt: "Novo estado", en: "New status", fr: "Nouveau statut" })}</Label>
            <Select value={next} onValueChange={setNext}>
              <SelectTrigger id="next-status"><SelectValue /></SelectTrigger>
              <SelectContent>{options.map((s) => <SelectItem key={s} value={s}>{ORDER_STATUS[s] ? t(ORDER_STATUS[s]) : s}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="status-note">{t({ pt: "Nota (visível no histórico)", en: "Note (shown in history)", fr: "Note (visible dans l'historique)" })}</Label>
            <Textarea id="status-note" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />
          </div>
          {destructive && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{t({ pt: "Esta acção é final. Pagamentos electrónicos serão reembolsados.", en: "This is final. Electronic payments will be refunded.", fr: "Action définitive. Les paiements électroniques seront remboursés." })}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t(T.cancel)}</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={!next || m.isPending} onClick={() => m.mutate()}>{t(T.confirm)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DriverDialog({ order, drivers, loading, onClose }: { order: AdminOrder; drivers: Driver[]; loading: boolean; onClose: () => void }) {
  const t = useT();
  const { toast } = useToast();
  const [driverId, setDriverId] = useState<string>(order.driverId ? String(order.driverId) : "none");
  const eligible = drivers.filter((d) => d.isApproved && d.isActive);
  const m = useMutation({
    mutationFn: () => post(`/api/admin/orders/${order.id}/assign-driver`, { driverId: driverId === "none" ? null : Number(driverId) }),
    onSuccess: () => { invalidateOrders(); toast({ title: t({ pt: "Estafeta actualizado", en: "Rider updated", fr: "Livreur mis à jour" }) }); onClose(); },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t({ pt: "Atribuir estafeta", en: "Assign rider", fr: "Assigner un livreur" })} · {order.orderNumber}</DialogTitle>
          <DialogDescription>{t({ pt: "Estafetas ocupados estão assinalados.", en: "Busy riders are marked.", fr: "Les livreurs occupés sont signalés." })}</DialogDescription>
        </DialogHeader>
        {loading ? <Loading /> : (
          <div className="space-y-1">
            <Label htmlFor="assign-driver">{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}</Label>
            <Select value={driverId} onValueChange={setDriverId}>
              <SelectTrigger id="assign-driver"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">{t({ pt: "— Nenhum (remover) —", en: "— None (unassign) —", fr: "— Aucun (retirer) —" })}</SelectItem>
                {eligible.map((d) => (
                  <SelectItem key={d.id} value={String(d.id)}>
                    {d.fullName} · {d.phone}{d.activeOrder && d.activeOrder !== order.id ? ` · ${t({ pt: "ocupado", en: "busy", fr: "occupé" })} (#${d.activeOrder})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!eligible.length && <p className="text-sm text-neutral-500">{t({ pt: "Não há estafetas aprovados e activos.", en: "No approved, active riders.", fr: "Aucun livreur approuvé et actif." })}</p>}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>{t(T.cancel)}</Button>
          <Button disabled={m.isPending} onClick={() => m.mutate()}>{t(T.confirm)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
