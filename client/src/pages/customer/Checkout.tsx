import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bike, Clock, CreditCard, HandCoins, Loader2, MapPin, MessageSquare, Receipt, ShoppingBag, Utensils, Zap } from "lucide-react";
import { Switch } from "@/components/ui/switch";
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
  AddressPicker, clearCheckoutPrefs, firstAvailableMethod, OrderErrorAlert, PaymentPicker, QuoteBreakdown, readCheckoutPrefs, Section,
  useAddresses, useMeta, useQuote, WhenPicker, noticeLabel, type StoreDetail, type WhenMode,
} from "./_orderingKit";

import { handleRadioArrowKey } from "@/lib/radio-keyboard";

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
  const [paymentMethod, setPaymentMethod] = useState("multicaixa_express");
  const [notes, setNotes] = useState("");
  // Deliveroo: entrega normal ou prioritária, gorjeta e talheres
  const [priorityPick, setPriority] = useState(false);
  const [riderTip, setRiderTip] = useState(0);
  const [cutlery, setCutlery] = useState(false);
  // entrega ou recolha no balcão (se a loja aceitar)
  const [pickupPick, setPickup] = useState(false);
  const [orderError, setOrderError] = useState<unknown>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  const balance = user?.loyaltyPoints ?? 0;
  const usePoints = prefs.usePoints && balance > 0 ? balance : 0;
  const pickup = pickupPick && !!store?.offersPickup;
  const priority = priorityPick && mode === "now" && !pickup && !store?.ownDelivery;
  const body = cart.storeId && cart.lines.length
    ? { storeId: cart.storeId, items: toApiItems(cart.lines), promoCode: prefs.promoCode, usePoints, priority, riderTip: pickup ? 0 : riderTip, addressId: pickup ? null : addressId, ...(pickup ? { fulfilment: "pickup" as const } : {}) }
    : null;
  const quote = useQuote(body, 0);

  // se o método escolhido não estiver disponível, escolher o primeiro que esteja (só pagamentos por banco)
  useEffect(() => {
    const m = meta.data?.paymentMethods.find((x) => x.id === paymentMethod);
    if (meta.data && (!m || !m.available)) setPaymentMethod(firstAvailableMethod(meta.data.paymentMethods));
  }, [meta.data]);

  const storeClosedNow = store ? !store.isOpenNow : false;
  useEffect(() => { if (storeClosedNow) setMode("schedule"); }, [storeClosedNow]);

  const place = useMutation({
    mutationFn: () => post<{ order: { id: number } }>("/api/orders", {
      storeId: cart.storeId,
      items: toApiItems(cart.lines),
      addressId: pickup ? null : addressId,
      ...(pickup ? { fulfilment: "pickup" } : {}),
      paymentMethod,
      notes: notes.trim() || null,
      scheduledFor: mode === "schedule" ? scheduledFor : null,
      promoCode: prefs.promoCode,
      usePoints,
      priority,
      riderTip: pickup ? 0 : riderTip,
      cutlery,
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
  const missing = !addressId && !pickup ? t({ pt: "Escolha uma morada de entrega", en: "Choose a delivery address", fr: "Choisissez une adresse" })
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
          onPickCash={() => { setPaymentMethod(firstAvailableMethod(meta.data?.paymentMethods)); setOrderError(null); }} />
      </div>

      {store?.offersPickup && (
        <div role="radiogroup" aria-label={t({ pt: "Entrega ou recolha", en: "Delivery or pickup", fr: "Livraison ou retrait" })} className="grid grid-cols-2 gap-1 rounded-full bg-neutral-100 p-1">
          {[{ v: false, label: t({ pt: "🛵 Entrega", en: "🛵 Delivery", fr: "🛵 Livraison" }) }, { v: true, label: t({ pt: "🛍️ Recolha na loja", en: "🛍️ Pickup", fr: "🛍️ Retrait" }) }].map((o) => (
            <button key={String(o.v)} type="button" role="radio" aria-checked={pickupPick === o.v} onClick={() => { setPickup(o.v); setOrderError(null); }}
              className={cn("min-h-10 rounded-full text-sm font-semibold transition", pickupPick === o.v ? "bg-white text-neutral-900 shadow" : "text-neutral-600")}>
              {o.label}
            </button>
          ))}
        </div>
      )}

      {pickup && store ? (
        <Section title={t({ pt: "Recolha na loja", en: "Pickup at the store", fr: "Retrait au magasin" })} icon={<MapPin className="h-4 w-4 text-primary" />}>
          <p className="text-sm font-semibold">{store.name}</p>
          <p className="text-sm text-neutral-600">{store.street}, {store.zone}</p>
          {store.latitude != null && store.longitude != null && (
            <a className="mt-1 inline-block text-sm font-semibold text-brand-800 underline" target="_blank" rel="noreferrer"
              href={`https://www.google.com/maps/dir/?api=1&destination=${store.latitude},${store.longitude}`}>{t({ pt: "Como chegar", en: "Directions", fr: "Itinéraire" })}</a>
          )}
          <p className="mt-2 text-xs text-neutral-500">{t({ pt: "Sem taxa de entrega. Avisamos quando estiver pronta; mostre o código de recolha ao balcão.", en: "No delivery fee. We'll tell you when it's ready; show your pickup code at the counter.", fr: "Sans frais de livraison. Nous vous prévenons quand c'est prêt ; montrez votre code au comptoir." })}</p>
        </Section>
      ) : (
        <Section title={t({ pt: "Morada de entrega", en: "Delivery address", fr: "Adresse de livraison" })} icon={<MapPin className="h-4 w-4 text-primary" />}>
          <AddressPicker value={addressId} onChange={(id) => { setAddressId(id); setOrderError(null); }} zonesServed={store?.zonesServed} />
          {store?.ownDelivery && <p className="mt-2 text-xs text-neutral-500">🛵 {t({ pt: "Entregue pelos estafetas da própria loja.", en: "Delivered by the store's own riders.", fr: "Livré par les livreurs du magasin." })}</p>}
        </Section>
      )}

      <Section title={t({ pt: "Quando", en: "When", fr: "Quand" })} icon={<Clock className="h-4 w-4 text-primary" />}>
        <WhenPicker mode={mode} onModeChange={setMode} value={scheduledFor} onChange={setScheduledFor}
          hours={store ? { openingTime: store.openingTime, closingTime: store.closingTime } : undefined}
          allowNow={!storeClosedNow && !(store?.minNoticeMin)}
          minNoticeMin={store?.minNoticeMin ?? 0} maxAheadHours={store?.maxAheadHours}
          nowNote={store?.minNoticeMin
            ? t({ pt: `Só por encomenda (${noticeLabel(store.minNoticeMin, t)} antes)`, en: `Pre-order only (${noticeLabel(store.minNoticeMin, t)} ahead)`, fr: `Sur commande (${noticeLabel(store.minNoticeMin, t)} avant)` })
            : storeClosedNow ? t({ pt: "Loja fechada agora", en: "Store closed now", fr: "Magasin fermé" }) : store ? `~${pickup ? store.prepTimeMin ?? 20 : store.deliveryTimeMin} ${t(T.minutes)}` : undefined} />
        {mode === "schedule" && scheduledFor && (
          <p className="mt-2 text-xs text-neutral-500">
            {t({ pt: "Entrega prevista:", en: "Expected delivery:", fr: "Livraison prévue :" })} <span className="font-medium text-neutral-800">{dateTime(scheduledFor, lang)}</span>
          </p>
        )}
      </Section>

      {mode === "now" && store && !pickup && !store.ownDelivery && (
        <Section title={t({ pt: "Opções de entrega", en: "Delivery options", fr: "Options de livraison" })} icon={<Bike className="h-4 w-4 text-primary" />}>
          <div role="radiogroup" aria-label={t({ pt: "Opções de entrega", en: "Delivery options", fr: "Options de livraison" })} onKeyDown={handleRadioArrowKey} className="space-y-2">
            {[
              { on: false, icon: <Bike className="h-5 w-5" />, title: t({ pt: "Normal", en: "Standard", fr: "Standard" }), sub: `~${store.deliveryTimeMin} ${t(T.minutes)}`, price: t({ pt: "Incluída", en: "Included", fr: "Incluse" }) },
              { on: true, icon: <Zap className="h-5 w-5" />, title: t({ pt: "Prioritária", en: "Priority", fr: "Prioritaire" }),
                sub: t({ pt: `~${Math.max(10, store.deliveryTimeMin - (q?.priorityOption?.minutesSaved ?? 10))} min · a sua encomenda vai primeiro`, en: `~${Math.max(10, store.deliveryTimeMin - (q?.priorityOption?.minutesSaved ?? 10))} min · your order goes first`, fr: `~${Math.max(10, store.deliveryTimeMin - (q?.priorityOption?.minutesSaved ?? 10))} min · votre commande passe en premier` }),
                price: `+${kz(q?.priorityOption?.fee ?? 500)}` },
            ].map((o) => (
              <button key={String(o.on)} type="button" role="radio" aria-checked={priorityPick === o.on} onClick={() => setPriority(o.on)}
                tabIndex={priorityPick === o.on ? 0 : -1}
                className={cn("flex w-full items-center gap-3 rounded-xl border-2 px-3 py-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                  priorityPick === o.on ? "border-primary bg-brand-50" : "border-neutral-200 hover:border-neutral-300")}>
                <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", priorityPick === o.on ? "bg-primary text-on-brand" : "bg-neutral-100 text-neutral-700")}>{o.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{o.title}</span>
                  <span className="block text-xs text-neutral-500">{o.sub}</span>
                </span>
                <span className="shrink-0 text-sm font-semibold">{o.price}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {!pickup && <Section title={t({ pt: "Gorjeta para o estafeta", en: "Tip your rider", fr: "Pourboire pour le livreur" })} icon={<HandCoins className="h-4 w-4 text-primary" />}>
        <p className="mb-2 text-xs text-neutral-500">{t({ pt: "100% da gorjeta vai para o estafeta.", en: "100% of the tip goes to your rider.", fr: "100 % du pourboire va au livreur." })}</p>
        <div role="radiogroup" aria-label={t({ pt: "Gorjeta", en: "Tip", fr: "Pourboire" })} onKeyDown={handleRadioArrowKey} className="grid grid-cols-4 gap-2">
          {[0, 200, 500, 1000].map((v) => (
            <button key={v} type="button" role="radio" aria-checked={riderTip === v} onClick={() => setRiderTip(v)}
              tabIndex={riderTip === v ? 0 : -1}
              className={cn("rounded-xl border-2 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
                riderTip === v ? "border-primary bg-brand-50 text-primary" : "border-neutral-200 text-neutral-800 hover:border-neutral-300")}>
              {v === 0 ? t({ pt: "Agora não", en: "Not now", fr: "Pas maintenant" }) : kz(v)}
            </button>
          ))}
        </div>
      </Section>}

      <Section title={t({ pt: "Pagamento", en: "Payment", fr: "Paiement" })} icon={<CreditCard className="h-4 w-4 text-primary" />}>
        <PaymentPicker value={paymentMethod} onChange={setPaymentMethod} />
        <p className="mt-2 text-xs text-neutral-500">{paymentMethod === "cash"
          ? pickup
            ? t({ pt: "Pague ao balcão quando levantar e mostre o código de recolha.", en: "Pay at the counter when you collect and show your pickup code.", fr: "Payez au comptoir au retrait et montrez votre code." })
            : t({ pt: "Pague ao estafeta quando receber (tenha o valor certo, se possível) e diga-lhe o código de entrega.", en: "Pay the rider on delivery (exact change helps) and give them the delivery code.", fr: "Payez le livreur à la réception (prévoyez l'appoint) et donnez-lui le code de livraison." })
          : t({ pt: "Paga já, por banco. Na entrega só diz ao estafeta o código de entrega.", en: "You pay now, by bank. At the door you just give the rider the delivery code.", fr: "Vous payez maintenant, par banque. Donnez seulement le code de livraison au livreur." })}</p>
      </Section>

      <Section title={t({ pt: "Notas para o estafeta / loja", en: "Notes for the rider / store", fr: "Notes pour le livreur / magasin" })} icon={<MessageSquare className="h-4 w-4 text-primary" />}>
        <Label htmlFor="order-notes" className="sr-only">{t({ pt: "Notas", en: "Notes", fr: "Notes" })}</Label>
        <Textarea id="order-notes" rows={3} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
          placeholder={t({ pt: "Ex.: ligar ao chegar, portão verde…", en: "E.g. call on arrival, green gate…", fr: "Ex. : appeler en arrivant, portail vert…" })} />
        <p className="mt-1 text-right text-[11px] text-neutral-400">{notes.length}/500</p>
        <div className="mt-3 flex items-center gap-3 rounded-xl bg-neutral-50 p-3">
          <Utensils className="h-5 w-5 shrink-0 text-neutral-600" aria-hidden />
          <Label htmlFor="cutlery" className="min-w-0 flex-1 cursor-pointer">
            <span className="block text-sm font-semibold">{t({ pt: "Talheres e guardanapos", en: "Cutlery and napkins", fr: "Couverts et serviettes" })}</span>
            <span className="block text-xs font-normal text-neutral-500">{t({ pt: "Só enviamos se pedir — menos plástico.", en: "We only send them if you ask — less plastic.", fr: "Envoyés uniquement sur demande — moins de plastique." })}</span>
          </Label>
          <Switch id="cutlery" checked={cutlery} onCheckedChange={setCutlery} />
        </div>
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
