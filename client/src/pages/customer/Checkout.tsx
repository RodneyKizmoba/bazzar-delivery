import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Clock, CreditCard, Loader2, MapPin, MessageSquare, Receipt, ShoppingBag } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, Guard, StoreImage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useCart, toApiItems } from "@/context/CartContext";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AddressPicker, clearCheckoutPrefs, OrderErrorAlert, PaymentPicker, QuoteBreakdown, readCheckoutPrefs, Section,
  useAddresses, useMeta, useQuote, WhenPicker, noticeLabel, type StoreDetail, type WhenMode,
} from "./_orderingKit";

function CheckoutInner() {
  const t = useT();
  const { lang } = useLang();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, refresh } = useAuth();
  const cart = useCart();
  const meta = useMeta();
  const prefs = useMemo(readCheckoutPrefs, []);
  const storeQ = useQuery<StoreDetail>({ queryKey: [`/api/stores/${cart.storeId}`], enabled: !!cart.storeId });
  const store = storeQ.data?.store;
  const addresses = useAddresses();

  const [addressId, setAddressId] = useState<number | null>(null);
  const [mode, setMode] = useState<WhenMode>("now");
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [orderError, setOrderError] = useState<unknown>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const balance = user?.loyaltyPoints ?? 0;
  const usePoints = prefs.usePoints && balance > 0 ? balance : 0;
  const body = cart.storeId && cart.lines.length
    ? { storeId: cart.storeId, items: toApiItems(cart.lines), promoCode: prefs.promoCode, usePoints }
    : null;
  const quote = useQuote(body, 0);

  // se o método escolhido deixar de estar disponível, voltar a numerário
  useEffect(() => {
    const m = meta.data?.paymentMethods.find((x) => x.id === paymentMethod);
    if (m && !m.available) setPaymentMethod("cash");
  }, [meta.data]);

  const storeClosedNow = store ? !store.isOpenNow : false;
  useEffect(() => { if (storeClosedNow) setMode("schedule"); }, [storeClosedNow]);

  const place = useMutation({
    mutationFn: () => post<{ order: { id: number } }>("/api/orders", {
      storeId: cart.storeId,
      items: toApiItems(cart.lines),
      addressId,
      paymentMethod,
      notes: notes.trim() || null,
      scheduledFor: mode === "schedule" ? scheduledFor : null,
      promoCode: prefs.promoCode,
      usePoints,
    }),
    onSuccess: ({ order }) => {
      cart.clear();
      clearCheckoutPrefs();
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      if (usePoints) refresh();
      toast({ title: t({ pt: "Encomenda feita! 🎉", en: "Order placed! 🎉", fr: "Commande passée ! 🎉" }), description: t({ pt: "Pode acompanhar o estado em tempo real.", en: "You can track it in real time.", fr: "Suivez-la en temps réel." }) });
      navigate(`/encomendas/${order.id}`);
    },
    onError: (e) => {
      setOrderError(e);
      setTimeout(() => errorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    },
  });

  if (!cart.storeId || !cart.lines.length) {
    return (
      <EmptyState icon={<ShoppingBag className="h-12 w-12 text-neutral-300" />}
        title={t({ pt: "O carrinho está vazio", en: "Your basket is empty", fr: "Votre panier est vide" })}
        action={<Link href="/"><Button>{t({ pt: "Explorar lojas", en: "Explore stores", fr: "Explorer" })}</Button></Link>} />
    );
  }

  const q = quote.error ? undefined : quote.data;
  const hasAddresses = (addresses.data?.addresses.length ?? 0) > 0;
  const missing = !addressId ? t({ pt: "Escolha uma morada de entrega", en: "Choose a delivery address", fr: "Choisissez une adresse" })
    : mode === "schedule" && !scheduledFor ? t({ pt: "Escolha a hora de entrega", en: "Choose a delivery time", fr: "Choisissez l'heure" })
      : null;
  const canPlace = !!q && !missing && !place.isPending && !quote.isUpdating;

  return (
    <div className="space-y-4 px-4 pb-40 pt-4">
      <div className="flex items-center gap-3">
        <StoreImage name={cart.storeName} url={store?.logoUrl} className="h-11 w-11 text-sm" rounded="rounded-xl" />
        <div className="min-w-0">
          <p className="truncate font-semibold">{cart.storeName}</p>
          <p className="text-xs text-neutral-500">
            {store ? `${store.openingTime}–${store.closingTime}` : ""}{store && ` · ~${store.deliveryTimeMin} ${t(T.minutes)}`}
            {storeClosedNow && <span className="ml-1 font-medium text-red-600">· {t(T.closed)}</span>}
          </p>
        </div>
      </div>

      <div ref={errorRef}>
        <OrderErrorAlert error={orderError} onDismiss={() => setOrderError(null)}
          onSchedule={() => { setMode("schedule"); setOrderError(null); }}
          onPickCash={() => { setPaymentMethod("cash"); setOrderError(null); }} />
      </div>

      <Section title={t({ pt: "Morada de entrega", en: "Delivery address", fr: "Adresse de livraison" })} icon={<MapPin className="h-4 w-4 text-primary" />}>
        <AddressPicker value={addressId} onChange={(id) => { setAddressId(id); setOrderError(null); }} zonesServed={store?.zonesServed} />
      </Section>

      <Section title={t({ pt: "Quando", en: "When", fr: "Quand" })} icon={<Clock className="h-4 w-4 text-primary" />}>
        <WhenPicker mode={mode} onModeChange={setMode} value={scheduledFor} onChange={setScheduledFor}
          hours={store ? { openingTime: store.openingTime, closingTime: store.closingTime } : undefined}
          allowNow={!storeClosedNow && !(store?.minNoticeMin)}
          minNoticeMin={store?.minNoticeMin ?? 0} maxAheadHours={store?.maxAheadHours}
          nowNote={store?.minNoticeMin
            ? t({ pt: `Só por encomenda (${noticeLabel(store.minNoticeMin, t)} antes)`, en: `Pre-order only (${noticeLabel(store.minNoticeMin, t)} ahead)`, fr: `Sur commande (${noticeLabel(store.minNoticeMin, t)} avant)` })
            : storeClosedNow ? t({ pt: "Loja fechada agora", en: "Store closed now", fr: "Magasin fermé" }) : store ? `~${store.deliveryTimeMin} ${t(T.minutes)}` : undefined} />
        {mode === "schedule" && scheduledFor && (
          <p className="mt-2 text-xs text-neutral-500">
            {t({ pt: "Entrega prevista:", en: "Expected delivery:", fr: "Livraison prévue :" })} <span className="font-medium text-neutral-800">{dateTime(scheduledFor, lang)}</span>
          </p>
        )}
      </Section>

      <Section title={t({ pt: "Pagamento", en: "Payment", fr: "Paiement" })} icon={<CreditCard className="h-4 w-4 text-primary" />}>
        <PaymentPicker value={paymentMethod} onChange={setPaymentMethod} />
        {paymentMethod === "cash" && (
          <p className="mt-2 text-xs text-neutral-500">{t({ pt: "Pague ao estafeta quando receber. Tenha o valor certo, se possível.", en: "Pay the rider on delivery. Exact change helps.", fr: "Payez le livreur à la réception. Prévoyez l'appoint." })}</p>
        )}
      </Section>

      <Section title={t({ pt: "Notas para o estafeta / loja", en: "Notes for the rider / store", fr: "Notes pour le livreur / magasin" })} icon={<MessageSquare className="h-4 w-4 text-primary" />}>
        <Label htmlFor="order-notes" className="sr-only">{t({ pt: "Notas", en: "Notes", fr: "Notes" })}</Label>
        <Textarea id="order-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={t({ pt: "Ex.: ligar ao chegar, portão verde, sem talheres…", en: "E.g. call on arrival, green gate, no cutlery…", fr: "Ex. : appeler en arrivant, portail vert, sans couverts…" })} />
        <p className="mt-1 text-right text-[11px] text-neutral-400">{notes.length}/500</p>
      </Section>

      <Section title={t({ pt: "Resumo da encomenda", en: "Order summary", fr: "Récapitulatif" })} icon={<Receipt className="h-4 w-4 text-primary" />}
        right={<Link href="/carrinho" className="text-sm font-medium text-primary">{t(T.edit)}</Link>}>
        {quote.error ? (
          <OrderErrorAlert error={quote.error} />
        ) : !q ? (
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-neutral-100" />)}</div>
        ) : (
          <div className="space-y-3">
            <ul className="space-y-2">
              {q.lines.map((l, i) => (
                <li key={i} className="flex justify-between gap-3 text-sm">
                  <span className="min-w-0">
                    <span className="font-medium">{l.quantity}× {l.name}</span>
                    {l.selectedOptions.length > 0 && <span className="block text-xs text-neutral-500">{l.selectedOptions.map((o) => o.name).join(" · ")}</span>}
                    {l.specialInstructions && <span className="block text-xs italic text-neutral-500">“{l.specialInstructions}”</span>}
                  </span>
                  <span className="whitespace-nowrap">{kz(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            <div className="border-t pt-3"><QuoteBreakdown quote={q} /></div>
            {(prefs.promoCode && !q.promoCode) && (
              <p className="text-xs text-amber-700">{t({ pt: "O código promocional não foi aplicado.", en: "The promo code wasn't applied.", fr: "Le code promo n'a pas été appliqué." })}</p>
            )}
          </div>
        )}
      </Section>

      <div className="fixed bottom-0 left-0 right-0 z-30">
        <div className="mx-auto max-w-md space-y-1.5 border-t bg-white/95 px-4 py-3 backdrop-blur">
          {missing && hasAddresses && <p className="text-center text-xs text-neutral-500">{missing}</p>}
          <Button className="h-12 w-full rounded-xl text-base" disabled={!canPlace} onClick={() => { setOrderError(null); place.mutate(); }}>
            {place.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
            <span className={cn("flex-1 text-left", place.isPending && "flex-none")}>
              {mode === "schedule" ? t({ pt: "Agendar encomenda", en: "Schedule order", fr: "Programmer la commande" }) : t({ pt: "Fazer encomenda", en: "Place order", fr: "Commander" })}
            </span>
            {q && !place.isPending && <span className="font-bold">{kz(q.total)}</span>}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function Checkout() {
  const t = useT();
  return (
    <CustomerShell hideHeader hideNav>
      <TopBar title={t({ pt: "Finalizar encomenda", en: "Checkout", fr: "Finaliser la commande" })} back="/carrinho" />
      <Guard roles={["customer"]}>
        <CheckoutInner />
      </Guard>
    </CustomerShell>
  );
}
