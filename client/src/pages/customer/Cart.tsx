import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { AlertTriangle, ChevronRight, Coins, Crown, Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { EmptyState, PageTitle, StoreImage } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { useCart, toApiItems, type CartLine } from "@/context/CartContext";
import { post } from "@/lib/api";
import { useT, T } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  errCode, PromoInput, QuoteBreakdown, readCheckoutPrefs, useMeta, useQuote, writeCheckoutPrefs, type Quote,
} from "./_orderingKit";

/** Procura no texto do erro ("X" está esgotado) a linha correspondente do carrinho. */
function findProblemLines(message: string, lines: CartLine[]): CartLine[] {
  const quoted = Array.from(message.matchAll(/"([^"]+)"/g)).map((m) => m[1].toLowerCase());
  if (!quoted.length) return [];
  return lines.filter((l) => quoted.some((q) => l.name.toLowerCase() === q || l.optionsLabel.toLowerCase().split(" · ").includes(q)));
}

export default function Cart() {
  const t = useT();
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const cart = useCart();
  const meta = useMeta();
  const initial = useMemo(readCheckoutPrefs, []);
  const [promo, setPromo] = useState<string | null>(initial.promoCode);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [usePoints, setUsePoints] = useState<boolean>(initial.usePoints);
  const balance = user?.loyaltyPoints ?? 0;
  const pointsOn = !!user && usePoints && balance > 0;

  useEffect(() => { writeCheckoutPrefs({ promoCode: promo, usePoints }); }, [promo, usePoints]);

  const body = cart.storeId && cart.lines.length
    ? { storeId: cart.storeId, items: toApiItems(cart.lines), promoCode: promo, usePoints: pointsOn ? balance : 0 }
    : null;
  const quote = useQuote(body);

  // promo deixou de ser válido (ex.: subtotal abaixo do mínimo) → retirar e mostrar o motivo
  useEffect(() => {
    const code = errCode(quote.error);
    if (promo && code?.startsWith("PROMO_")) {
      setPromoError(quote.error!.message);
      setPromo(null);
    }
  }, [quote.error]);

  if (!cart.storeId || cart.lines.length === 0) {
    return (
      <CustomerShell>
        <PageTitle title={{ pt: "Carrinho", en: "Basket", fr: "Panier" }} />
        <EmptyState icon={<ShoppingBag className="h-12 w-12 text-neutral-300" />}
          title={t({ pt: "O seu carrinho está vazio", en: "Your basket is empty", fr: "Votre panier est vide" })}
          text={t({ pt: "Explore restaurantes e lojas perto de si e adicione o que lhe apetecer.", en: "Explore restaurants and shops near you and add what you fancy.", fr: "Découvrez les restaurants et magasins près de chez vous." })}
          action={<Link href="/"><Button>{t({ pt: "Explorar lojas", en: "Explore stores", fr: "Explorer" })}</Button></Link>} />
      </CustomerShell>
    );
  }

  const q: Quote | undefined = quote.error ? undefined : quote.data;
  const code = errCode(quote.error);
  const problemLines = quote.error && (code === "ITEM_UNAVAILABLE" || code === "OPTION_UNAVAILABLE" || code === "INVALID_OPTION" || code === "ITEM_NOT_IN_STORE")
    ? findProblemLines(quote.error.message, cart.lines) : [];
  const blocking = !!quote.error && !code?.startsWith("PROMO_");
  // as linhas do orçamento vêm pela mesma ordem do pedido
  const lineTotal = (l: CartLine, i: number) => {
    const ql = q?.lines[i];
    return ql && ql.menuItemId === l.menuItemId && ql.quantity === l.quantity ? ql.lineTotal : l.unitPrice * l.quantity;
  };

  const applyPromo = async (c: string) => {
    setPromoError(null);
    // validar já para mostrar o erro no campo
    await post("/api/cart/quote", { storeId: cart.storeId, items: toApiItems(cart.lines), promoCode: c, usePoints: 0 });
    setPromo(c);
  };

  const goCheckout = () => {
    writeCheckoutPrefs({ promoCode: promo, usePoints });
    navigate(user ? "/checkout" : `/entrar?next=${encodeURIComponent("/checkout")}`);
  };

  const showPlusUpsell = !q?.isPlus && user?.userType !== "admin";

  return (
    <CustomerShell>
      <PageTitle title={{ pt: "Carrinho", en: "Basket", fr: "Panier" }} />

      <div className="space-y-4 px-4 pb-36">
        {/* Loja */}
        <Link href={`/loja/${cart.storeId}`} className="flex items-center gap-3 rounded-2xl border bg-white p-3 shadow-sm hover:bg-neutral-50">
          <StoreImage name={cart.storeName} className="h-12 w-12 text-sm" rounded="rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{cart.storeName}</p>
            <p className="text-xs text-neutral-500">{t({ pt: "Adicionar mais itens", en: "Add more items", fr: "Ajouter d'autres articles" })}</p>
          </div>
          <ChevronRight className="h-5 w-5 text-neutral-400" />
        </Link>

        {/* Erros do orçamento */}
        {blocking && (
          <Alert variant="destructive" className="rounded-xl bg-red-50">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>
              {code === "BELOW_MIN_ORDER"
                ? t({ pt: "Ainda não atingiu o mínimo", en: "Below the minimum order", fr: "Minimum non atteint" })
                : code === "ITEM_UNAVAILABLE" || code === "OPTION_UNAVAILABLE"
                  ? t({ pt: "Há um produto indisponível", en: "An item is unavailable", fr: "Un article est indisponible" })
                  : t({ pt: "Não foi possível calcular o preço", en: "Couldn't calculate the price", fr: "Impossible de calculer le prix" })}
            </AlertTitle>
            <AlertDescription className="space-y-2">
              <p>{quote.error!.message}</p>
              {code === "BELOW_MIN_ORDER" && (
                <Link href={`/loja/${cart.storeId}`}><Button size="sm" variant="outline">{t({ pt: "Adicionar mais itens", en: "Add more items", fr: "Ajouter des articles" })}</Button></Link>
              )}
              {problemLines.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {problemLines.map((l) => (
                    <Button key={l.key} size="sm" variant="outline" onClick={() => cart.remove(l.key)}>
                      <Trash2 className="mr-1.5 h-4 w-4" />{t({ pt: `Remover "${l.name}"`, en: `Remove "${l.name}"`, fr: `Retirer « ${l.name} »` })}
                    </Button>
                  ))}
                </div>
              )}
              {code !== "BELOW_MIN_ORDER" && !problemLines.length && (
                <Button size="sm" variant="outline" onClick={() => quote.refetch()}>{t(T.retry)}</Button>
              )}
            </AlertDescription>
          </Alert>
        )}

        {/* Linhas */}
        <ul className="divide-y rounded-2xl border bg-white shadow-sm">
          {cart.lines.map((l, i) => {
            const bad = problemLines.some((p) => p.key === l.key);
            return (
              <li key={l.key} className={cn("flex gap-3 p-3", bad && "bg-red-50/60")}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium leading-snug">{l.name}</p>
                  {l.optionsLabel && <p className="text-xs text-neutral-500">{l.optionsLabel}</p>}
                  {l.specialInstructions && <p className="mt-0.5 text-xs italic text-neutral-500">“{l.specialInstructions}”</p>}
                  {bad && <p className="mt-1 text-xs font-medium text-red-600">{t({ pt: "Indisponível", en: "Unavailable", fr: "Indisponible" })}</p>}
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex items-center rounded-full border">
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full"
                        aria-label={t({ pt: "Diminuir quantidade", en: "Decrease quantity", fr: "Diminuer" })}
                        onClick={() => cart.setQuantity(l.key, l.quantity - 1)}>
                        {l.quantity === 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                      </Button>
                      <span className="w-7 text-center text-sm font-semibold" aria-live="polite">{l.quantity}</span>
                      <Button variant="ghost" size="icon" className="h-9 w-9 rounded-full" disabled={l.quantity >= 50}
                        aria-label={t({ pt: "Aumentar quantidade", en: "Increase quantity", fr: "Augmenter" })}
                        onClick={() => cart.setQuantity(l.key, l.quantity + 1)}>
                        <Plus className="h-4 w-4" />
                      </Button>
                    </div>
                    <button className="px-2 py-2 text-xs font-medium text-neutral-500 hover:text-red-600" onClick={() => cart.remove(l.key)}>
                      {t(T.remove)}
                    </button>
                  </div>
                </div>
                <p className="whitespace-nowrap text-sm font-semibold">{kz(lineTotal(l, i))}</p>
              </li>
            );
          })}
        </ul>

        {/* Promo */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <p className="mb-2 text-sm font-semibold">{t({ pt: "Tem um código?", en: "Got a code?", fr: "Un code promo ?" })}</p>
          <PromoInput applied={promo} externalError={promoError} onApply={applyPromo} onRemove={() => { setPromo(null); setPromoError(null); }} />
        </div>

        {/* Pontos */}
        {user && (
          <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Coins className="h-5 w-5" /></span>
            <div className="min-w-0 flex-1">
              <Label htmlFor="use-points" className="text-sm font-semibold">{t({ pt: "Usar pontos", en: "Use points", fr: "Utiliser mes points" })}</Label>
              <p className="text-xs text-neutral-500">
                {balance > 0
                  ? t({ pt: `Tem ${balance} pontos${meta.data ? ` (até ${kz(balance * meta.data.points.pointValueKz)})` : ""}`, en: `You have ${balance} points${meta.data ? ` (up to ${kz(balance * meta.data.points.pointValueKz)})` : ""}`, fr: `Vous avez ${balance} points${meta.data ? ` (jusqu'à ${kz(balance * meta.data.points.pointValueKz)})` : ""}` })
                  : t({ pt: "Ainda não tem pontos. Ganhe pontos em cada encomenda.", en: "No points yet. Earn points on every order.", fr: "Pas encore de points. Gagnez-en à chaque commande." })}
                {pointsOn && q && q.pointsRedeemed < balance && q.pointsRedeemed > 0 && meta.data && (
                  <> · {t({ pt: `máx. ${meta.data.points.maxDiscountPct}% do total`, en: `max ${meta.data.points.maxDiscountPct}% of total`, fr: `max ${meta.data.points.maxDiscountPct}% du total` })}</>
                )}
              </p>
            </div>
            <Switch id="use-points" checked={pointsOn} disabled={balance <= 0} onCheckedChange={setUsePoints} />
          </div>
        )}

        {/* Upsell Plus */}
        {showPlusUpsell && (
          <Link href="/plus" className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-on-brand to-brand-800 p-4 text-white shadow-sm">
            <Crown className="h-6 w-6 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-bold">{t({ pt: "Entrega grátis com PedeJá Plus", en: "Free delivery with PedeJá Plus", fr: "Livraison gratuite avec PedeJá Plus" })}</p>
              {meta.data && (
                <p className="text-xs text-white/85">
                  {t({ pt: `Em encomendas acima de ${kz(meta.data.plus.freeDeliveryMinOrder)} · ${kz(meta.data.plus.monthlyPrice)}/mês`, en: `On orders over ${kz(meta.data.plus.freeDeliveryMinOrder)} · ${kz(meta.data.plus.monthlyPrice)}/month`, fr: `Dès ${kz(meta.data.plus.freeDeliveryMinOrder)} · ${kz(meta.data.plus.monthlyPrice)}/mois` })}
                </p>
              )}
            </div>
            <ChevronRight className="h-5 w-5" />
          </Link>
        )}

        {/* Resumo */}
        <div className="rounded-2xl border bg-white p-4 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-semibold">{t({ pt: "Resumo", en: "Summary", fr: "Récapitulatif" })}</p>
            {quote.isUpdating && <Loader2 className="h-4 w-4 animate-spin text-neutral-400" aria-label={t(T.loading)} />}
          </div>
          {q ? (
            <div className={cn(quote.isUpdating && "opacity-60 transition-opacity")}><QuoteBreakdown quote={q} /></div>
          ) : quote.isLoading || (quote.isUpdating && !quote.error) ? (
            <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-neutral-100" />)}</div>
          ) : (
            <p className="text-sm text-neutral-500">
              {t({ pt: `Subtotal estimado: ${kz(cart.estimatedSubtotal)}`, en: `Estimated subtotal: ${kz(cart.estimatedSubtotal)}`, fr: `Sous-total estimé : ${kz(cart.estimatedSubtotal)}` })}
            </p>
          )}
        </div>
      </div>

      {/* Barra fixa */}
      <div className="fixed bottom-16 left-0 right-0 z-20">
        <div className="mx-auto max-w-md border-t bg-white/95 px-4 py-3 backdrop-blur">
          <Button className="h-12 w-full rounded-xl text-base" disabled={blocking || !q || quote.isUpdating} onClick={goCheckout}>
            <span className="flex-1 text-left">{user ? t({ pt: "Continuar", en: "Continue", fr: "Continuer" }) : t({ pt: "Entrar para continuar", en: "Log in to continue", fr: "Se connecter pour continuer" })}</span>
            {q && <span className="font-bold">{kz(q.total)}</span>}
          </Button>
        </div>
      </div>
    </CustomerShell>
  );
}
