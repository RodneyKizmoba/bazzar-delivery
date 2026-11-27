import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Bike, CalendarClock, Check, CircleHelp, Loader2, MapPin, MessageSquare, Minus, Pencil, Phone, Plus, Star, Store as StoreIcon, Wallet, XCircle,
} from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { ErrorState, Guard, Loading, StatusBadge, StoreImage } from "@/components/common";
import { OrderMap } from "@/components/OrderMap";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { kz, dateTime, time, ORDER_STATUS, PAYMENT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { poll } from "@/lib/live";
import {
  AddressPicker, FINAL_STATUSES, PriceRow, Section, WhenPicker, OrderErrorAlert, PAYMENT_ICON, SellerNote, type Seller, type SelectedOption,
} from "./_orderingKit";

interface Pt { latitude: number; longitude: number }
interface OrderFull {
  id: number; orderNumber: string; customerId: number; storeId: number; driverId: number | null; groupOrderId: number | null;
  status: string; scheduledFor: string | null; notes: string | null;
  deliveryAddress: { label: string; street: string; zone: string; city: string; reference?: string | null; latitude?: number | null; longitude?: number | null };
  subtotal: number; deliveryFee: number; discount: number; pointsRedeemed: number; total: number; promoCode: string | null;
  priorityFee?: number; riderTip?: number; cutlery?: boolean; fulfilment?: "delivery" | "pickup" | "store_delivery"; serviceFee?: number; smallOrderFee?: number; deliveryKm?: number | null;
  paymentMethod: string; paymentStatus: string; cancelReason: string | null; estimatedDeliveryAt: string | null;
  createdAt: string; deliveredAt: string | null;
  canCancel: boolean; canModify: boolean; canReview: boolean; deliveryCode?: string | null; pinRequired?: boolean;
  // Envios
  kind?: "food" | "parcel";
  pickupAddress?: { label: string; street: string; zone: string; reference?: string | null; contactName: string; contactPhone: string } | null;
  parcel?: { size: "small" | "medium" | "large"; description: string; recipientName: string; recipientPhone: string; fragile: boolean; sizeFee: number } | null;
}

const PARCEL_STEPS = ["ready", "picked_up", "delivered"] as const;
const PARCEL_STEP_LABEL: Record<string, Tr> = {
  ready: { pt: "Envio criado", en: "Parcel booked", fr: "Envoi créé" },
  picked_up: { pt: "Pacote recolhido", en: "Parcel collected", fr: "Colis récupéré" },
  delivered: { pt: "Entregue", en: "Delivered", fr: "Livré" },
};
const PARCEL_SIZE_LABEL: Record<string, Tr> = {
  small: { pt: "Pequeno (até 5 kg)", en: "Small (up to 5 kg)", fr: "Petit (jusqu'à 5 kg)" },
  medium: { pt: "Médio (até 15 kg)", en: "Medium (up to 15 kg)", fr: "Moyen (jusqu'à 15 kg)" },
  large: { pt: "Grande (até 30 kg)", en: "Large (up to 30 kg)", fr: "Grand (jusqu'à 30 kg)" },
};
function parcelHeadline(o: { status: string; driverId: number | null; parcel?: { recipientName: string } | null }, tr?: { driverAtStoreAt?: string | null; driverAtCustomerAt?: string | null }): Tr | null {
  if (!o.parcel) return null;
  const who = o.parcel.recipientName.split(" ")[0];
  if (o.status === "ready" && !o.driverId) return { pt: "À procura de um estafeta perto da recolha…", en: "Finding a rider near the pickup…", fr: "Recherche d'un livreur près du départ…" };
  if (o.status === "ready" && tr?.driverAtStoreAt) return { pt: "O estafeta chegou à recolha 📦", en: "Your rider is at the pickup 📦", fr: "Le livreur est au point de départ 📦" };
  if (o.status === "ready") return { pt: "Estafeta a caminho da recolha", en: "Rider on the way to the pickup", fr: "Livreur en route vers le départ" };
  if (o.status === "picked_up" && tr?.driverAtCustomerAt) return { pt: `O estafeta chegou a ${who}`, en: `Your rider is with ${who}`, fr: `Le livreur est chez ${who}` };
  if (o.status === "picked_up") return { pt: `Pacote a caminho de ${who} 🛵`, en: `Parcel on its way to ${who} 🛵`, fr: `Colis en route vers ${who} 🛵` };
  return null;
}
interface OrderItemRow { id: number; menuItemId: number; name: string; unitPrice: number; quantity: number; selectedOptions: SelectedOption[]; specialInstructions: string | null; addedBy: string | null }
interface OrderEvent { id: number; status: string; note: string | null; createdAt: string }
interface Review { id: number; rating: number; driverRating: number | null; comment: string | null; reply: string | null; repliedAt: string | null; createdAt: string }
interface Detail {
  order: OrderFull; items: OrderItemRow[]; events: OrderEvent[]; review: Review | null;
  driver: { id: number; fullName: string; phone: string } | null;
  customer: { fullName: string; phone: string } | null;
  store: { id: number; name: string; phone: string; street: string; zone: string; latitude: number | null; longitude: number | null; logoUrl: string | null; seller?: Seller };
}
interface Tracking {
  driverAssignedAt?: string | null; driverAtStoreAt?: string | null; driverAtCustomerAt?: string | null;
  status: string; updatedAt: string; estimatedDeliveryAt: string | null; scheduledFor: string | null;
  driverLocation: (Pt & { at: string }) | null; storeLocation: Pt | null; destination: Pt | null;
}

const STEPS = ["pending", "accepted", "preparing", "ready", "picked_up", "delivered"] as const;

/** Momentos do estafeta (como no Deliveroo): têm prioridade sobre o texto do estado. */
function liveHeadline(status: string, tr?: Tracking): Tr | null {
  if (!tr) return null;
  if (status === "picked_up" && tr.driverAtCustomerAt) return { pt: "O estafeta está à sua porta! 🛵", en: "Your rider is outside! 🛵", fr: "Votre livreur est devant chez vous ! 🛵" };
  if (["accepted", "preparing", "ready"].includes(status) && tr.driverAtStoreAt) return { pt: "O estafeta já está no restaurante", en: "Your rider is at the restaurant", fr: "Votre livreur est au restaurant" };
  if (["accepted", "preparing", "ready"].includes(status) && tr.driverAssignedAt) return { pt: "O estafeta vai a caminho do restaurante", en: "Your rider is heading to the restaurant", fr: "Votre livreur se rend au restaurant" };
  return null;
}

/** Recolha no balcão e entrega pela própria loja têm textos próprios. */
function fulfilmentHeadline(status: string, f?: string): Tr | null {
  if (f === "pickup") {
    if (status === "ready") return { pt: "Pronta! Pode vir levantar 🛍️", en: "Ready! Come and collect it 🛍️", fr: "Prête ! Venez la retirer 🛍️" };
    if (status === "delivered") return { pt: "Levantada. Bom apetite!", en: "Collected. Enjoy!", fr: "Retirée. Bon appétit !" };
  }
  if (f === "store_delivery") {
    if (status === "ready") return { pt: "Pronta — o estafeta da loja vai sair", en: "Ready — the store's rider is leaving soon", fr: "Prête — le livreur du magasin va partir" };
    if (status === "picked_up") return { pt: "O estafeta da loja vai a caminho", en: "The store's rider is on the way", fr: "Le livreur du magasin arrive" };
  }
  return null;
}

const HEADLINE: Record<string, Tr> = {
  scheduled: { pt: "Encomenda agendada", en: "Order scheduled", fr: "Commande programmée" },
  pending: { pt: "À espera que a loja aceite", en: "Waiting for the store to accept", fr: "En attente du magasin" },
  accepted: { pt: "A loja aceitou a sua encomenda", en: "The store accepted your order", fr: "Le magasin a accepté" },
  preparing: { pt: "A preparar a sua encomenda", en: "Preparing your order", fr: "Préparation en cours" },
  ready: { pt: "Pronta — à espera do estafeta", en: "Ready — waiting for the rider", fr: "Prête — en attente du livreur" },
  picked_up: { pt: "O estafeta está a caminho", en: "Your rider is on the way", fr: "Le livreur arrive" },
  delivered: { pt: "Entregue. Bom apetite!", en: "Delivered. Enjoy!", fr: "Livrée. Bon appétit !" },
  cancelled: { pt: "Encomenda cancelada", en: "Order cancelled", fr: "Commande annulée" },
  rejected: { pt: "A loja não pôde aceitar", en: "The store couldn't accept", fr: "Le magasin n'a pas pu accepter" },
};

function Stars({ value, onChange, size = "h-8 w-8", label }: { value: number; onChange?: (n: number) => void; size?: string; label: string }) {
  const t = useT();
  return (
    <div className="flex gap-1" role={onChange ? "radiogroup" : "img"} aria-label={`${label}: ${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => {
        const icon = <Star className={cn(size, n <= value ? "fill-amber-400 text-amber-400" : "text-neutral-300")} />;
        return onChange ? (
          <button key={n} type="button" role="radio" aria-checked={value === n} className="rounded p-0.5"
            aria-label={t({ pt: `${n} estrela${n > 1 ? "s" : ""}`, en: `${n} star${n > 1 ? "s" : ""}`, fr: `${n} étoile${n > 1 ? "s" : ""}` })}
            onClick={() => onChange(n)}>{icon}</button>
        ) : <span key={n}>{icon}</span>;
      })}
    </div>
  );
}

function paymentStatusLabel(o: OrderFull): { text: Tr; cls: string } {
  if (o.paymentStatus === "paid") return { text: { pt: "Pago", en: "Paid", fr: "Payé" }, cls: "bg-green-100 text-green-800" };
  if (o.paymentStatus === "refunded") return { text: { pt: "Reembolsado", en: "Refunded", fr: "Remboursé" }, cls: "bg-sky-100 text-sky-800" };
  if (o.paymentStatus === "failed") return { text: { pt: "Pagamento falhou", en: "Payment failed", fr: "Paiement échoué" }, cls: "bg-red-100 text-red-800" };
  if (o.status === "cancelled" || o.status === "rejected") return { text: { pt: "Sem cobrança", en: "Not charged", fr: "Non débité" }, cls: "bg-neutral-100 text-neutral-700" };
  if (o.paymentMethod === "cash" && o.parcel) return { text: { pt: "A pagar na recolha", en: "Pay at pickup", fr: "À payer au départ" }, cls: "bg-amber-100 text-amber-800" };
  if (o.paymentMethod === "cash") return { text: { pt: "A pagar na entrega", en: "Pay on delivery", fr: "À payer à la livraison" }, cls: "bg-amber-100 text-amber-800" };
  return { text: { pt: "Pagamento pendente", en: "Payment pending", fr: "Paiement en attente" }, cls: "bg-amber-100 text-amber-800" };
}

// ---------------------------------------------------------------------------
// Diálogo de alteração
// ---------------------------------------------------------------------------
function ModifyDialog({ open, onOpenChange, detail }: { open: boolean; onOpenChange: (o: boolean) => void; detail: Detail }) {
  const t = useT();
  const { toast } = useToast();
  const { order, items } = detail;
  const canEditItems = !order.groupOrderId && order.paymentStatus !== "paid";
  const [notes, setNotes] = useState(order.notes ?? "");
  const [addressId, setAddressId] = useState<number | null>(null);
  const [changeAddress, setChangeAddress] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<string | null>(order.scheduledFor);
  const [qty, setQty] = useState<Record<number, number>>({});
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!open) return;
    setNotes(order.notes ?? ""); setAddressId(null); setChangeAddress(false); setScheduledFor(order.scheduledFor); setError(null);
    setQty(Object.fromEntries(items.map((i) => [i.id, i.quantity])));
  }, [open]);

  const remainingLines = items.filter((i) => (qty[i.id] ?? i.quantity) > 0).length;
  const itemsChanged = items.some((i) => (qty[i.id] ?? i.quantity) !== i.quantity);
  const estSubtotal = items.reduce((s, i) => s + i.unitPrice * (qty[i.id] ?? i.quantity), 0);

  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = {};
      if ((notes.trim() || null) !== (order.notes || null)) body.notes = notes.trim() || null;
      if (changeAddress && addressId) body.addressId = addressId;
      if (order.status === "scheduled" && scheduledFor && scheduledFor !== order.scheduledFor) body.scheduledFor = scheduledFor;
      if (canEditItems && itemsChanged) {
        body.items = items.filter((i) => (qty[i.id] ?? i.quantity) > 0).map((i) => ({
          menuItemId: i.menuItemId, quantity: qty[i.id] ?? i.quantity,
          optionIds: i.selectedOptions.map((o) => o.optionId), specialInstructions: i.specialInstructions || null,
        }));
      }
      if (!Object.keys(body).length) return Promise.resolve(null);
      return patch(`/api/orders/${order.id}`, body);
    },
    onSuccess: (r) => {
      onOpenChange(false);
      if (!r) return;
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${order.id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t({ pt: "Encomenda actualizada", en: "Order updated", fr: "Commande mise à jour" }) });
    },
    onError: (e) => setError(e),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t({ pt: "Alterar encomenda", en: "Change order", fr: "Modifier la commande" })}</DialogTitle>
          <DialogDescription>{t({ pt: "Pode alterar até a loja aceitar a encomenda.", en: "You can make changes until the store accepts.", fr: "Modifiable jusqu'à l'acceptation du magasin." })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-5">
          <OrderErrorAlert error={error} onDismiss={() => setError(null)} />

          <div className="space-y-2">
            <p className="text-sm font-semibold">{t({ pt: "Itens", en: "Items", fr: "Articles" })}</p>
            {!canEditItems ? (
              <p className="rounded-lg bg-neutral-50 p-3 text-xs text-neutral-600">
                {order.groupOrderId
                  ? t({ pt: "Os itens de encomendas em grupo não podem ser alterados.", en: "Items in group orders can't be changed.", fr: "Les articles d'une commande groupée ne sont pas modifiables." })
                  : t({ pt: "Esta encomenda já foi paga online; para mudar itens, cancele (sem custos) e faça uma nova.", en: "This order is already paid online; to change items, cancel (free) and order again.", fr: "Commande déjà payée ; annulez (sans frais) et recommandez." })}
              </p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {items.map((i) => {
                  const n = qty[i.id] ?? i.quantity;
                  const lastOne = n > 0 && remainingLines === 1;
                  return (
                    <li key={i.id} className={cn("flex items-center gap-3 p-3", n === 0 && "opacity-50")}>
                      <div className="min-w-0 flex-1">
                        <p className={cn("text-sm font-medium", n === 0 && "line-through")}>{i.name}</p>
                        {i.selectedOptions.length > 0 && <p className="text-xs text-neutral-500">{i.selectedOptions.map((o) => o.name).join(" · ")}</p>}
                      </div>
                      <div className="flex items-center rounded-full border">
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" disabled={n === 0 || (lastOne && n === 1)}
                          aria-label={t({ pt: "Diminuir", en: "Decrease", fr: "Diminuer" })} onClick={() => setQty((p) => ({ ...p, [i.id]: Math.max(0, n - 1) }))}>
                          <Minus className="h-4 w-4" />
                        </Button>
                        <span className="w-6 text-center text-sm font-semibold">{n}</span>
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 rounded-full" disabled={n >= 50}
                          aria-label={t({ pt: "Aumentar", en: "Increase", fr: "Augmenter" })} onClick={() => setQty((p) => ({ ...p, [i.id]: n + 1 }))}>
                          <Plus className="h-4 w-4" />
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {canEditItems && itemsChanged && (
              <p className="text-xs text-neutral-500">
                {t({ pt: `Novo subtotal estimado: ${kz(estSubtotal)}. O total final é recalculado pela loja.`, en: `New estimated subtotal: ${kz(estSubtotal)}. The final total is recalculated.`, fr: `Nouveau sous-total estimé : ${kz(estSubtotal)}.` })}
              </p>
            )}
          </div>

          {order.status === "scheduled" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{t({ pt: "Hora de entrega", en: "Delivery time", fr: "Heure de livraison" })}</p>
              <WhenPicker mode="schedule" onModeChange={() => {}} value={scheduledFor} onChange={setScheduledFor} allowNow={false} />
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{t({ pt: "Morada", en: "Address", fr: "Adresse" })}</p>
              {!changeAddress && <Button type="button" variant="ghost" size="sm" onClick={() => setChangeAddress(true)}>{t({ pt: "Mudar", en: "Change", fr: "Changer" })}</Button>}
            </div>
            {changeAddress ? <AddressPicker value={addressId} onChange={setAddressId} /> : (
              <p className="text-sm text-neutral-600">{order.deliveryAddress.label} · {order.deliveryAddress.street}, {order.deliveryAddress.zone}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="mod-notes" className="text-sm font-semibold">{t({ pt: "Notas", en: "Notes", fr: "Notes" })}</Label>
            <Textarea id="mod-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t(T.cancel)}</Button>
          <Button onClick={() => { setError(null); save.mutate(); }} disabled={save.isPending || remainingLines === 0}>
            {save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t({ pt: "Guardar alterações", en: "Save changes", fr: "Enregistrer" })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Avaliação
// ---------------------------------------------------------------------------
function ReviewForm({ orderId, hasDriver }: { orderId: number; hasDriver: boolean }) {
  const t = useT();
  const { toast } = useToast();
  const [rating, setRating] = useState(0);
  const [driverRating, setDriverRating] = useState(0);
  const [comment, setComment] = useState("");
  const send = useMutation({
    mutationFn: () => post(`/api/orders/${orderId}/review`, { rating, driverRating: hasDriver && driverRating ? driverRating : null, comment: comment.trim() || null }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${orderId}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t({ pt: "Obrigado pela avaliação!", en: "Thanks for your review!", fr: "Merci pour votre avis !" }) });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium">{t({ pt: "Como correu com a loja?", en: "How was the store?", fr: "Comment était le magasin ?" })}</p>
        <Stars value={rating} onChange={setRating} label={t({ pt: "Loja", en: "Store", fr: "Magasin" })} />
      </div>
      {hasDriver && (
        <div className="space-y-1.5">
          <p className="text-sm font-medium">{t({ pt: "E com o estafeta? (opcional)", en: "And the rider? (optional)", fr: "Et le livreur ? (facultatif)" })}</p>
          <Stars value={driverRating} onChange={setDriverRating} size="h-6 w-6" label={t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })} />
        </div>
      )}
      <div className="space-y-1.5">
        <Label htmlFor="review-comment">{t({ pt: "Comentário (opcional)", en: "Comment (optional)", fr: "Commentaire (facultatif)" })}</Label>
        <Textarea id="review-comment" rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)}
          placeholder={t({ pt: "O que gostou? O que podia melhorar?", en: "What did you like? What could be better?", fr: "Qu'avez-vous aimé ?" })} />
      </div>
      <Button className="w-full" disabled={!rating || send.isPending} onClick={() => send.mutate()}>
        {send.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t({ pt: "Enviar avaliação", en: "Submit review", fr: "Envoyer" })}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------
function OrderDetailInner({ id }: { id: string }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const { user } = useAuth();
  const detailQ = useQuery<Detail>({ queryKey: [`/api/orders/${id}`] });
  const status = detailQ.data?.order.status;
  const isFinal = status ? FINAL_STATUSES.includes(status) : false;
  const trackQ = useQuery<Tracking>({
    queryKey: [`/api/orders/${id}/tracking`],
    enabled: !!detailQ.data && !isFinal,
    refetchInterval: poll(5_000),
    staleTime: 0,
  });
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [modifyOpen, setModifyOpen] = useState(false);
  const reviewRef = useRef<HTMLDivElement>(null);

  // estado mudou → recarregar o detalhe
  useEffect(() => {
    const tr = trackQ.data;
    if (tr && detailQ.data && (tr.status !== detailQ.data.order.status)) detailQ.refetch();
  }, [trackQ.data?.status, trackQ.data?.updatedAt]);

  useEffect(() => {
    if (detailQ.data && window.location.hash === "#avaliar") setTimeout(() => reviewRef.current?.scrollIntoView({ behavior: "smooth" }), 200);
  }, [!!detailQ.data]);

  const cancel = useMutation({
    mutationFn: () => post(`/api/orders/${id}/cancel`, { reason: cancelReason.trim() || null }),
    onSuccess: () => {
      setCancelOpen(false);
      queryClient.invalidateQueries({ queryKey: [`/api/orders/${id}`] });
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t({ pt: "Encomenda cancelada", en: "Order cancelled", fr: "Commande annulée" }), description: t({ pt: "Não foi cobrado nada.", en: "You haven't been charged.", fr: "Aucun frais." }) });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t({ pt: "Não foi possível cancelar", en: "Couldn't cancel", fr: "Annulation impossible" }), description: e.message }),
  });

  const stepTimes = useMemo(() => {
    const m: Record<string, string> = {};
    for (const e of detailQ.data?.events ?? []) if (!m[e.status]) m[e.status] = e.createdAt;
    return m;
  }, [detailQ.data?.events]);

  if (detailQ.isLoading) return <Loading />;
  if (detailQ.error || !detailQ.data) return <ErrorState error={detailQ.error} onRetry={() => detailQ.refetch()} />;

  const { order, items, review, driver, store } = detailQ.data;
  const tr = trackQ.data;
  const eta = tr?.estimatedDeliveryAt ?? order.estimatedDeliveryAt;
  const isOwner = user?.id === order.customerId;
  const isParcel = !!order.parcel;
  const steps: readonly string[] = isParcel ? PARCEL_STEPS : STEPS;
  const currentIdx = steps.indexOf(order.status);
  const showMap = !isFinal;
  const storePt = tr?.storeLocation ?? (store.latitude != null && store.longitude != null ? { latitude: store.latitude, longitude: store.longitude } : null);
  const destPt = tr?.destination ?? (order.deliveryAddress.latitude != null && order.deliveryAddress.longitude != null ? { latitude: order.deliveryAddress.latitude, longitude: order.deliveryAddress.longitude } : null);
  const pay = paymentStatusLabel(order);
  const groupedByPerson = items.some((i) => i.addedBy);

  return (
    <div className="space-y-4 px-4 pb-10 pt-4">
      {/* Deliveroo: mapa no topo e hora de chegada em grande, com barra de progresso */}
      {showMap && (storePt || destPt || tr?.driverLocation) && (
        <div className="-mx-4 -mt-4">
          <OrderMap store={storePt} destination={destPt} driver={tr?.driverLocation ?? null} className="h-60 w-full overflow-hidden"
            ride={isParcel ? "moto" : undefined} lineTo={isParcel && order.status === "ready" ? "store" : "destination"}
            labels={{ store: isParcel ? t({ pt: "Recolha", en: "Pickup", fr: "Départ" }) : store.name, destination: isParcel ? order.parcel!.recipientName : t({ pt: "A sua morada", en: "Your address", fr: "Votre adresse" }), driver: driver?.fullName.split(" ")[0] ?? t({ pt: "Estafeta", en: "Rider", fr: "Livreur" }) }} />
        </div>
      )}
      {!isFinal && order.status !== "scheduled" ? (
        <div className={cn("relative rounded-2xl border bg-white p-5 shadow-md", showMap && (storePt || destPt) && "-mt-10")}>
          <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
            <span>#{order.orderNumber}</span>
            <span className="flex items-center gap-1 font-medium text-primary"><span className="h-2 w-2 animate-pulse rounded-full bg-primary" />{t({ pt: "Ao vivo", en: "Live", fr: "En direct" })}</span>
          </div>
          {eta && (
            <>
              <p className="mt-2 text-sm text-neutral-600">{t({ pt: "Chegada prevista", en: "Arriving at", fr: "Arrivée prévue" })}</p>
              <p className="text-4xl font-extrabold tracking-tight text-neutral-900">{time(eta, lang)}</p>
            </>
          )}
          <div className="mt-3 grid grid-cols-4 gap-1.5" aria-hidden>
            {[0, 1, 2, 3].map((seg) => {
              const step = Math.min(3, Math.max(0, currentIdx - 1));
              return (
                <span key={seg} className={cn("h-1.5 overflow-hidden rounded-full", seg < step ? "bg-primary" : "bg-neutral-200")}>
                  {seg === step && <span className="block h-full w-1/2 animate-pulse rounded-full bg-primary" />}
                </span>
              );
            })}
          </div>
          <h2 className="mt-3 text-lg font-bold leading-tight">{t(parcelHeadline(order, tr) ?? fulfilmentHeadline(order.status, order.fulfilment) ?? liveHeadline(order.status, tr) ?? HEADLINE[order.status] ?? ORDER_STATUS[order.status] ?? { pt: order.status, en: order.status, fr: order.status })}</h2>
          {!!order.priorityFee && <p className="mt-1 text-xs font-semibold text-primary">⚡ {t({ pt: "Entrega prioritária", en: "Priority delivery", fr: "Livraison prioritaire" })}</p>}
        </div>
      ) : (
      <div className={cn("rounded-2xl p-5 text-white shadow-sm",
        order.status === "cancelled" || order.status === "rejected" ? "bg-neutral-700" : order.status === "delivered" ? "bg-green-700" : "bg-gradient-to-br from-brand-600 to-brand-800")}>
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-wide text-white/80">#{order.orderNumber}</p>
          {!isFinal && <span className="flex items-center gap-1 text-[11px] text-white/80"><span className="h-2 w-2 animate-pulse rounded-full bg-white" />{t({ pt: "Ao vivo", en: "Live", fr: "En direct" })}</span>}
        </div>
        <h2 className="mt-1 text-xl font-bold leading-tight">{t(HEADLINE[order.status] ?? ORDER_STATUS[order.status] ?? { pt: order.status, en: order.status, fr: order.status })}</h2>
        {order.status === "scheduled" && order.scheduledFor ? (
          <p className="mt-2 flex items-center gap-1.5 text-sm"><CalendarClock className="h-4 w-4" />{t({ pt: "Entrega agendada para", en: "Scheduled for", fr: "Programmée pour" })} <b>{dateTime(order.scheduledFor, lang)}</b></p>
        ) : !isFinal && eta ? (
          <p className="mt-2 text-sm">{t({ pt: "Chegada prevista", en: "Estimated arrival", fr: "Arrivée prévue" })} <span className="text-2xl font-bold">{time(eta, lang)}</span></p>
        ) : order.status === "delivered" && order.deliveredAt ? (
          <p className="mt-2 text-sm">{t({ pt: "Entregue às", en: "Delivered at", fr: "Livrée à" })} {time(order.deliveredAt, lang)}</p>
        ) : order.cancelReason ? (
          <p className="mt-2 text-sm text-white/90">{order.cancelReason}</p>
        ) : null}
      </div>
      )}

      {order.deliveryCode && isParcel && (
        <div className="space-y-2 rounded-2xl border-2 border-primary bg-brand-50 p-4" aria-live="polite">
          <div className="flex items-center gap-4">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold">🔒 {t({ pt: "Código de entrega", en: "Delivery code", fr: "Code de livraison" })}</p>
              <p className="text-xs text-neutral-600">{t({ pt: `Envie este código a ${order.parcel!.recipientName}. O estafeta só entrega o pacote com ele.`, en: `Send this code to ${order.parcel!.recipientName}. The rider only hands over the parcel with it.`, fr: `Envoyez ce code à ${order.parcel!.recipientName}. Le livreur ne remet le colis qu'avec ce code.` })}</p>
            </div>
            <p className="font-mono text-3xl font-extrabold tracking-[0.25em] text-brand-900">{order.deliveryCode}</p>
          </div>
          <a className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#25D366] text-sm font-bold text-white"
            href={`https://wa.me/${order.parcel!.recipientPhone.replace(/\D/g, "").replace(/^(?!244)/, "244")}?text=${encodeURIComponent(t({ pt: `Olá ${order.parcel!.recipientName.split(" ")[0]}! Vai receber um pacote PedeJá (${order.orderNumber}). Diga este código ao estafeta na entrega: ${order.deliveryCode}`, en: `Hi ${order.parcel!.recipientName.split(" ")[0]}! A PedeJá parcel (${order.orderNumber}) is on its way to you. Give the rider this code: ${order.deliveryCode}`, fr: `Bonjour ${order.parcel!.recipientName.split(" ")[0]} ! Un colis PedeJá (${order.orderNumber}) arrive. Donnez ce code au livreur : ${order.deliveryCode}` }))}`}
            target="_blank" rel="noreferrer">
            {t({ pt: "Enviar o código por WhatsApp", en: "Send the code on WhatsApp", fr: "Envoyer le code par WhatsApp" })}
          </a>
        </div>
      )}
      {order.deliveryCode && !isParcel && (
        <div className="flex items-center gap-4 rounded-2xl border-2 border-primary bg-brand-50 p-4" aria-live="polite">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">🔒 {order.fulfilment === "pickup" ? t({ pt: "Código de recolha", en: "Pickup code", fr: "Code de retrait" }) : t({ pt: "Código de entrega", en: "Delivery code", fr: "Code de livraison" })}</p>
            <p className="text-xs text-neutral-600">{order.fulfilment === "pickup"
              ? t({ pt: "Mostre este código ao balcão quando levantar.", en: "Show this code at the counter when you collect.", fr: "Montrez ce code au comptoir au retrait." })
              : t({ pt: "Diga este código ao estafeta só quando receber a encomenda.", en: "Give this code to the rider only when you receive your order.", fr: "Donnez ce code au livreur seulement à la réception de la commande." })}</p>
          </div>
          <p className="font-mono text-3xl font-extrabold tracking-[0.25em] text-brand-900">{order.deliveryCode}</p>
        </div>
      )}

      {/* Stepper */}
      {order.status !== "cancelled" && order.status !== "rejected" && (
        <ol className="rounded-2xl border bg-white p-4 shadow-sm">
          {steps.map((s, i) => {
            const done = currentIdx >= i;
            const current = currentIdx === i;
            return (
              <li key={s} className="relative flex gap-3 pb-4 last:pb-0">
                {i < steps.length - 1 && <span className={cn("absolute left-[11px] top-6 h-[calc(100%-16px)] w-0.5", currentIdx > i ? "bg-primary" : "bg-neutral-200")} aria-hidden />}
                <span className={cn("relative z-10 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2",
                  done ? "border-primary bg-primary text-on-brand" : "border-neutral-300 bg-white", current && !isFinal && "ring-4 ring-brand-100")}>
                  {done && <Check className="h-3.5 w-3.5" />}
                </span>
                <div className="flex flex-1 items-baseline justify-between gap-2">
                  <span className={cn("text-sm", done ? "font-semibold text-neutral-900" : "text-neutral-400")}>{t(isParcel ? PARCEL_STEP_LABEL[s] : ORDER_STATUS[s])}</span>
                  {stepTimes[s] && <span className="text-xs text-neutral-500">{time(stepTimes[s], lang)}</span>}
                </div>
              </li>
            );
          })}
        </ol>
      )}


      {/* Estafeta */}
      {driver && !isFinal && (
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-100 text-blue-700"><Bike className="h-5 w-5" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-neutral-500">{t({ pt: "O seu estafeta", en: "Your rider", fr: "Votre livreur" })}</p>
            <p className="truncate font-semibold">{driver.fullName}</p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a href={`tel:${driver.phone.replace(/\s/g, "")}`} aria-label={t({ pt: `Ligar a ${driver.fullName}`, en: `Call ${driver.fullName}`, fr: `Appeler ${driver.fullName}` })}>
              <Phone className="mr-1.5 h-4 w-4" />{t({ pt: "Ligar", en: "Call", fr: "Appeler" })}
            </a>
          </Button>
        </div>
      )}

      {/* Acções */}
      {isOwner && (order.canCancel || order.canModify) && (
        <div className="flex gap-2">
          {order.canModify && (
            <Button variant="outline" className="flex-1" onClick={() => setModifyOpen(true)}><Pencil className="mr-1.5 h-4 w-4" />{t({ pt: "Alterar", en: "Change", fr: "Modifier" })}</Button>
          )}
          {order.canCancel && (
            <Button variant="outline" className="flex-1 text-red-600 hover:text-red-700" onClick={() => setCancelOpen(true)}><XCircle className="mr-1.5 h-4 w-4" />{t({ pt: "Cancelar", en: "Cancel", fr: "Annuler" })}</Button>
          )}
        </div>
      )}

      {/* Avaliação */}
      {isOwner && order.status === "delivered" && !isParcel && (
        <div ref={reviewRef} id="avaliar">
          <Section title={review ? t({ pt: "A sua avaliação", en: "Your review", fr: "Votre avis" }) : t({ pt: "Avalie a sua encomenda", en: "Rate your order", fr: "Notez votre commande" })} icon={<Star className="h-4 w-4 text-amber-500" />}>
            {review ? (
              <div className="space-y-2">
                <Stars value={review.rating} size="h-5 w-5" label={t({ pt: "Loja", en: "Store", fr: "Magasin" })} />
                {review.driverRating != null && (
                  <p className="flex items-center gap-2 text-xs text-neutral-500">{t({ pt: "Estafeta", en: "Rider", fr: "Livreur" })}: <Stars value={review.driverRating} size="h-3.5 w-3.5" label="" /></p>
                )}
                {review.comment && <p className="text-sm text-neutral-700">{review.comment}</p>}
                {review.reply && (
                  <div className="mt-2 rounded-xl bg-neutral-50 p-3">
                    <p className="text-xs font-semibold text-neutral-600">{t({ pt: `Resposta de ${store.name}`, en: `Reply from ${store.name}`, fr: `Réponse de ${store.name}` })}</p>
                    <p className="mt-0.5 text-sm text-neutral-700">{review.reply}</p>
                  </div>
                )}
              </div>
            ) : order.canReview ? <ReviewForm orderId={order.id} hasDriver={!!order.driverId} /> : null}
          </Section>
        </div>
      )}

      {/* Envios: recolha → entrega e o pacote */}
      {isParcel && (
        <Section title={t({ pt: "O seu envio", en: "Your parcel", fr: "Votre envoi" })} icon={<span aria-hidden>📦</span>}>
          <div className="space-y-3 text-sm">
            <div><p className="text-xs font-semibold uppercase text-neutral-500">{t({ pt: "Recolha", en: "Pickup", fr: "Départ" })}</p>
              <p className="font-semibold">{order.pickupAddress?.contactName} · {order.pickupAddress?.contactPhone}</p>
              <p className="text-neutral-600">{order.pickupAddress?.street}{order.pickupAddress?.zone ? `, ${order.pickupAddress.zone}` : ""}</p></div>
            <div><p className="text-xs font-semibold uppercase text-neutral-500">{t({ pt: "Entrega", en: "Drop-off", fr: "Livraison" })}</p>
              <p className="font-semibold">{order.parcel!.recipientName} · {order.parcel!.recipientPhone}</p>
              <p className="text-neutral-600">{order.deliveryAddress.street}{order.deliveryAddress.zone ? `, ${order.deliveryAddress.zone}` : ""}</p></div>
            <p>{t(PARCEL_SIZE_LABEL[order.parcel!.size])}{order.parcel!.fragile && <> · ⚠️ {t({ pt: "Frágil", en: "Fragile", fr: "Fragile" })}</>} · {order.parcel!.description}</p>
          </div>
          <div className="mt-4 space-y-2 border-t pt-3">
            <PriceRow label={<>{t({ pt: "Envio", en: "Delivery", fr: "Livraison" })}{order.deliveryKm != null && <span className="ml-1 text-xs text-neutral-500">({order.deliveryKm.toFixed(1).replace(".", ",")} km)</span>}</>} value={kz(order.deliveryFee)} />
            {!!order.serviceFee && <PriceRow label={t({ pt: "Extra de tamanho", en: "Size extra", fr: "Supplément taille" })} value={kz(order.serviceFee)} />}
            {!!order.riderTip && <PriceRow label={t({ pt: "Gorjeta para o estafeta", en: "Rider tip", fr: "Pourboire livreur" })} value={kz(order.riderTip)} />}
            <div className="border-t pt-2"><PriceRow strong label={t(T.total)} value={kz(order.total)} /></div>
          </div>
        </Section>
      )}

      {/* Loja */}
      {!isParcel && <>
      <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
        <StoreImage name={store.name} url={store.logoUrl} className="h-11 w-11 text-sm" rounded="rounded-xl" />
        <Link href={`/loja/${store.id}`} className="min-w-0 flex-1">
          <p className="truncate font-semibold">{store.name}</p>
          <p className="truncate text-xs text-neutral-500">{store.street}, {store.zone}</p>
        </Link>
        {store.phone && (
          <Button asChild variant="outline" size="icon">
            <a href={`tel:${store.phone.replace(/\s/g, "")}`} aria-label={t({ pt: "Ligar à loja", en: "Call the store", fr: "Appeler le magasin" })}><Phone className="h-4 w-4" /></a>
          </Button>
        )}
      </div>

      {/* Itens e preços */}
      <Section title={t({ pt: "A sua encomenda", en: "Your order", fr: "Votre commande" })} icon={<StoreIcon className="h-4 w-4 text-primary" />}>
        <ul className="space-y-3">
          {items.map((i) => (
            <li key={i.id} className="flex justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p><span className="mr-1 font-semibold text-primary">{i.quantity}×</span><span className="font-medium">{i.name}</span></p>
                {i.selectedOptions.length > 0 && <p className="text-xs text-neutral-500">{i.selectedOptions.map((o) => o.name).join(" · ")}</p>}
                {i.specialInstructions && <p className="text-xs italic text-neutral-500">“{i.specialInstructions}”</p>}
                {groupedByPerson && i.addedBy && <p className="mt-0.5 inline-block rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">{i.addedBy}</p>}
              </div>
              <span className="whitespace-nowrap">{kz(i.unitPrice * i.quantity)}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 space-y-2 border-t pt-3">
          <PriceRow label={t(T.subtotal)} value={kz(order.subtotal)} />
          {!!order.smallOrderFee && <PriceRow label={t({ pt: "Taxa de encomenda pequena", en: "Small order fee", fr: "Frais petite commande" })} value={kz(order.smallOrderFee)} />}
          {order.fulfilment === "pickup" && <PriceRow label={t({ pt: "Recolha na loja", en: "Pickup at store", fr: "Retrait au magasin" })} value={<span className="font-semibold text-green-700">{t(T.free)}</span>} />}
          {order.fulfilment !== "pickup" && <PriceRow label={<>{t(T.deliveryFee)}{order.deliveryKm != null && <span className="ml-1 text-xs text-neutral-500">({order.deliveryKm.toFixed(1).replace(".", ",")} km)</span>}</>} value={order.deliveryFee === 0 ? <span className="font-semibold text-green-700">{t(T.free)}</span> : kz(order.deliveryFee)} />}
          {!!order.serviceFee && <PriceRow label={t({ pt: "Taxa de serviço", en: "Service fee", fr: "Frais de service" })} value={kz(order.serviceFee)} />}
          {!!order.priorityFee && <PriceRow label={t({ pt: "Entrega prioritária", en: "Priority delivery", fr: "Livraison prioritaire" })} value={kz(order.priorityFee)} />}
          {!!order.riderTip && <PriceRow label={t({ pt: "Gorjeta para o estafeta", en: "Rider tip", fr: "Pourboire livreur" })} value={kz(order.riderTip)} />}
          {order.discount > 0 && (
            <PriceRow label={<>{t(T.discount)}{order.promoCode && <span className="ml-1 rounded bg-green-50 px-1.5 py-0.5 text-[11px] font-semibold text-green-800">{order.promoCode}</span>}{order.pointsRedeemed > 0 && <span className="ml-1 text-xs text-neutral-500">(+{order.pointsRedeemed} {t({ pt: "pontos", en: "points", fr: "points" })})</span>}</>}
              value={<span className="text-green-700">−{kz(order.discount)}</span>} />
          )}
          <div className="border-t pt-2"><PriceRow strong label={t(T.total)} value={kz(order.total)} /></div>
        </div>
        <div className="mt-3"><SellerNote seller={store.seller} kind="receipt" /></div>
      </Section>
      </>}

      {/* Entrega e pagamento */}
      <div className="grid gap-3">
        {!isParcel && <div className="flex gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
          <div className="min-w-0 text-sm">
            <p className="font-semibold">{order.deliveryAddress.label}</p>
            <p className="text-neutral-600">{order.deliveryAddress.street}, {order.deliveryAddress.zone}, {order.deliveryAddress.city}</p>
            {order.deliveryAddress.reference && <p className="text-xs text-neutral-500">{order.deliveryAddress.reference}</p>}
          </div>
        </div>}
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <Wallet className="h-5 w-5 shrink-0 text-primary" />
          <p className="flex-1 text-sm font-medium"><span aria-hidden className="mr-1">{PAYMENT_ICON[order.paymentMethod]}</span>{PAYMENT[order.paymentMethod] ? t(PAYMENT[order.paymentMethod]) : order.paymentMethod}</p>
          <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", pay.cls)}>{t(pay.text)}</span>
        </div>
        {order.notes && (
          <div className="flex gap-3 rounded-2xl border bg-white p-4 shadow-sm">
            <MessageSquare className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            <p className="text-sm text-neutral-700">{order.notes}</p>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>{t({ pt: "Feita a", en: "Placed on", fr: "Passée le" })} {dateTime(order.createdAt, lang)}</span>
        <StatusBadge status={order.status} />
      </div>

      <Link href="/info/suporte" className="flex items-center justify-center gap-2 rounded-xl border border-dashed py-3 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
        <CircleHelp className="h-4 w-4" />{t({ pt: "Precisa de ajuda com esta encomenda?", en: "Need help with this order?", fr: "Besoin d'aide avec cette commande ?" })}
      </Link>

      {/* Cancelar */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Cancelar a encomenda?", en: "Cancel this order?", fr: "Annuler la commande ?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t({ pt: "Pode cancelar sem custos enquanto a loja não começar a preparar. Se pagou online, o valor é reembolsado.", en: "You can cancel at no cost until the store starts preparing. Online payments are refunded.", fr: "Annulation sans frais tant que la préparation n'a pas commencé. Les paiements en ligne sont remboursés." })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="cancel-reason">{t({ pt: "Motivo (opcional)", en: "Reason (optional)", fr: "Motif (facultatif)" })}</Label>
            <Textarea id="cancel-reason" rows={2} maxLength={300} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Manter encomenda", en: "Keep order", fr: "Garder" })}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" disabled={cancel.isPending}
              onClick={(e) => { e.preventDefault(); cancel.mutate(); }}>
              {cancel.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t({ pt: "Sim, cancelar", en: "Yes, cancel", fr: "Oui, annuler" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {order.canModify && <ModifyDialog open={modifyOpen} onOpenChange={setModifyOpen} detail={detailQ.data} />}
    </div>
  );
}

export default function OrderDetail() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  return (
    <CustomerShell hideHeader>
      <TopBar title={t({ pt: "Encomenda", en: "Order", fr: "Commande" })} back={true} />
      <Guard><OrderDetailInner id={id} /></Guard>
    </CustomerShell>
  );
}
