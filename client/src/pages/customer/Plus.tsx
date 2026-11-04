import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BadgePercent, Bike, CalendarCheck, Check, Crown, Loader2, Sparkles, XCircle } from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { ErrorState, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { ApiError, post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { PaymentPicker, useMeta } from "./_orderingKit";

interface PlusInfo {
  active: boolean;
  subscription: { id: number; status: string; startsAt: string | null; endsAt: string | null; autoRenew: boolean; activatedBy: string | null } | null;
  monthlyPrice: number; freeDeliveryMinOrder: number; estimatedSavings: number;
}

function PlusMember({ info }: { info: PlusInfo }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [confirm, setConfirm] = useState(false);
  const sub = info.subscription!;
  const cancel = useMutation({
    mutationFn: () => post("/api/plus/cancel"),
    onSuccess: () => {
      setConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["/api/plus"] });
      toast({ title: t({ pt: "Renovação desligada", en: "Auto-renew turned off", fr: "Renouvellement désactivé" }), description: t({ pt: "Mantém os benefícios até ao fim do período.", en: "You keep your benefits until the end of the period.", fr: "Vous gardez vos avantages jusqu'à la fin." }) });
    },
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  return (
    <div className="space-y-3">
      <div className="rounded-2xl border bg-white p-5 shadow-sm">
        <p className="flex items-center gap-2 text-sm font-semibold text-brand-700"><Check className="h-4 w-4" />{t({ pt: "É membro PedeAí Plus", en: "You're a PedeAí Plus member", fr: "Vous êtes membre PedeAí Plus" })}</p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-brand-50 p-3">
            <p className="text-xs text-brand-700">{t({ pt: "Poupança estimada", en: "Estimated savings", fr: "Économies estimées" })}</p>
            <p className="text-xl font-bold text-brand-900">{kz(info.estimatedSavings)}</p>
          </div>
          <div className="rounded-xl bg-neutral-50 p-3">
            <p className="text-xs text-neutral-600">{sub.autoRenew ? t({ pt: "Renova a", en: "Renews on", fr: "Renouvelé le" }) : t({ pt: "Termina a", en: "Ends on", fr: "Se termine le" })}</p>
            <p className="text-sm font-bold text-neutral-900">{sub.endsAt ? dateTime(sub.endsAt, lang) : "—"}</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          {sub.autoRenew
            ? t({ pt: `Renovação automática ligada · ${kz(info.monthlyPrice)}/mês`, en: `Auto-renew on · ${kz(info.monthlyPrice)}/month`, fr: `Renouvellement auto · ${kz(info.monthlyPrice)}/mois` })
            : t({ pt: "Renovação automática desligada. Os benefícios mantêm-se até à data acima.", en: "Auto-renew is off. Benefits last until the date above.", fr: "Renouvellement désactivé. Avantages jusqu'à la date ci-dessus." })}
        </p>
      </div>
      <Link href="/"><Button className="w-full">{t({ pt: "Encomendar agora", en: "Order now", fr: "Commander" })}</Button></Link>
      {sub.autoRenew && (
        <Button variant="ghost" className="w-full text-neutral-600" onClick={() => setConfirm(true)}>
          <XCircle className="mr-1.5 h-4 w-4" />{t({ pt: "Cancelar renovação", en: "Cancel renewal", fr: "Annuler le renouvellement" })}
        </Button>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Cancelar a renovação?", en: "Cancel renewal?", fr: "Annuler le renouvellement ?" })}</AlertDialogTitle>
            <AlertDialogDescription>
              {t({ pt: `Continua com entregas grátis até ${sub.endsAt ? dateTime(sub.endsAt, lang) : "ao fim do período"}. Depois disso não é cobrado.`, en: `You keep free delivery until ${sub.endsAt ? dateTime(sub.endsAt, lang) : "the end of the period"}. You won't be charged after that.`, fr: `Livraison gratuite jusqu'au ${sub.endsAt ? dateTime(sub.endsAt, lang) : "terme"}. Aucun prélèvement ensuite.` })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Manter Plus", en: "Keep Plus", fr: "Garder Plus" })}</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); cancel.mutate(); }} disabled={cancel.isPending}>
              {cancel.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t({ pt: "Cancelar renovação", en: "Cancel renewal", fr: "Annuler" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Subscribe({ price }: { price: number }) {
  const t = useT();
  const { toast } = useToast();
  const meta = useMeta();
  const [method, setMethod] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (method || !meta.data) return;
    const first = meta.data.paymentMethods.find((m) => m.id !== "cash" && m.available);
    if (first) setMethod(first.id);
  }, [meta.data]);

  const anyOnline = meta.data?.paymentMethods.some((m) => m.id !== "cash" && m.available) ?? true;

  const subscribe = useMutation({
    mutationFn: () => post("/api/plus/subscribe", { paymentMethod: method }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/plus"] });
      toast({ title: t({ pt: "Bem-vindo ao PedeAí Plus! 👑", en: "Welcome to PedeAí Plus! 👑", fr: "Bienvenue dans PedeAí Plus ! 👑" }) });
    },
    onError: (e: Error) => {
      const code = e instanceof ApiError ? e.code : undefined;
      if (code === "PAYMENT_METHOD_UNAVAILABLE" || code === "PAYMENT_GATEWAY_MISSING" || code === "PLUS_CASH") setUnavailable(true);
      else toast({ variant: "destructive", title: t(T.error), description: e.message });
    },
  });

  return (
    <div className="space-y-3 rounded-2xl border bg-white p-5 shadow-sm">
      <p className="font-semibold">{t({ pt: "Escolha como pagar", en: "Choose how to pay", fr: "Choisissez le paiement" })}</p>
      {(unavailable || !anyOnline) && (
        <Alert className="rounded-xl border-amber-200 bg-amber-50">
          <AlertTitle>{t({ pt: "Pagamentos online brevemente", en: "Online payments coming soon", fr: "Paiements en ligne bientôt" })}</AlertTitle>
          <AlertDescription className="space-y-2 text-sm">
            <p>{t({ pt: "Ainda não é possível pagar a subscrição online. Peça ao nosso suporte para activar o Plus na sua conta.", en: "You can't pay for the subscription online yet. Ask our support team to activate Plus on your account.", fr: "Le paiement en ligne n'est pas encore disponible. Demandez au support d'activer Plus." })}</p>
            <Link href="/info/suporte"><Button size="sm" variant="outline">{t({ pt: "Contactar suporte", en: "Contact support", fr: "Contacter le support" })}</Button></Link>
          </AlertDescription>
        </Alert>
      )}
      <PaymentPicker value={method} onChange={setMethod} excludeCash />
      <Button className="h-12 w-full rounded-xl bg-on-brand text-base text-white hover:bg-on-brand/90" disabled={!method || subscribe.isPending || !anyOnline} onClick={() => subscribe.mutate()}>
        {subscribe.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
        {t({ pt: `Aderir por ${kz(price)}/mês`, en: `Join for ${kz(price)}/month`, fr: `S'abonner pour ${kz(price)}/mois` })}
      </Button>
      <p className="text-center text-xs text-neutral-500">{t({ pt: "Cancele quando quiser. Sem fidelização.", en: "Cancel anytime. No commitment.", fr: "Résiliable à tout moment. Sans engagement." })}</p>
    </div>
  );
}

function PlusAccount() {
  const q = useQuery<PlusInfo>({ queryKey: ["/api/plus"] });
  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return q.data.active && q.data.subscription ? <PlusMember info={q.data} /> : <Subscribe price={q.data.monthlyPrice} />;
}

export default function Plus() {
  const t = useT();
  const { user, isLoading } = useAuth();
  const meta = useMeta();
  const price = meta.data?.plus.monthlyPrice;
  const min = meta.data?.plus.freeDeliveryMinOrder;

  const perks = [
    { icon: Bike, title: { pt: "Entrega grátis", en: "Free delivery", fr: "Livraison gratuite" }, text: min != null ? { pt: `Em todas as encomendas acima de ${kz(min)}.`, en: `On every order over ${kz(min)}.`, fr: `Sur toutes les commandes dès ${kz(min)}.` } : { pt: "Em encomendas elegíveis.", en: "On eligible orders.", fr: "Sur les commandes éligibles." } },
    { icon: BadgePercent, title: { pt: "Ofertas exclusivas", en: "Exclusive offers", fr: "Offres exclusives" }, text: { pt: "Códigos PLUS só para membros, em restaurantes e lojas.", en: "Members-only PLUS codes at restaurants and shops.", fr: "Codes PLUS réservés aux membres." } },
    { icon: CalendarCheck, title: { pt: "Cancele quando quiser", en: "Cancel anytime", fr: "Résiliable à tout moment" }, text: { pt: "Sem fidelização. Mantém os benefícios até ao fim do mês pago.", en: "No commitment. Keep benefits until the end of the paid month.", fr: "Sans engagement. Avantages jusqu'à la fin du mois payé." } },
  ];

  return (
    <CustomerShell>
      <div className="px-4 pb-8 pt-4">
        {/* Hero */}
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-on-brand via-on-brand to-brand-800 p-6 text-white shadow-lg">
          <Sparkles className="absolute -right-4 -top-4 h-28 w-28 text-white/10" aria-hidden />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold"><Crown className="h-3.5 w-3.5" />PedeAí Plus</span>
          <h1 className="mt-3 text-3xl font-extrabold leading-tight">{t({ pt: "Entregas grátis, todos os dias.", en: "Free delivery, every day.", fr: "Livraison gratuite, tous les jours." })}</h1>
          <p className="mt-2 text-sm text-white/85">{t({ pt: "A forma mais barata de pedir comida, compras e muito mais em Luanda.", en: "The cheapest way to get food, groceries and more in Luanda.", fr: "Le moyen le moins cher de vous faire livrer à Luanda." })}</p>
          {price != null && (
            <p className="mt-5"><span className="text-3xl font-extrabold">{kz(price)}</span><span className="text-sm text-white/80">/{t({ pt: "mês", en: "month", fr: "mois" })}</span></p>
          )}
        </div>

        {/* Benefícios */}
        <ul className="mt-5 space-y-3">
          {perks.map(({ icon: Icon, title, text }) => (
            <li key={title.pt} className="flex gap-3 rounded-2xl border bg-white p-4 shadow-sm">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand-700"><Icon className="h-5 w-5" /></span>
              <div>
                <p className="font-semibold">{t(title)}</p>
                <p className="text-sm text-neutral-600">{t(text)}</p>
              </div>
            </li>
          ))}
        </ul>

        <div className="mt-5">
          {isLoading ? <Loading /> : user ? <PlusAccount /> : (
            <div className="space-y-2 rounded-2xl border bg-white p-5 text-center shadow-sm">
              <p className="font-semibold">{t({ pt: "Inicie sessão para aderir", en: "Log in to join", fr: "Connectez-vous pour adhérer" })}</p>
              <Link href={`/entrar?next=${encodeURIComponent("/plus")}`}><Button className="w-full">{t(T.login)}</Button></Link>
              <Link href={`/registar?next=${encodeURIComponent("/plus")}`} className="block text-sm font-medium text-primary">{t(T.register)}</Link>
            </div>
          )}
        </div>
      </div>
    </CustomerShell>
  );
}
