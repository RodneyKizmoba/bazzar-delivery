import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Check, Coins, Copy, Gift, ShoppingBag, Sparkles, Users } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLang, useT, type Tr } from "@/lib/i18n";
import { kz, dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMeta } from "./_orderingKit";

interface PointsInfo {
  balance: number; pointValueKz: number; kzPerPointEarned: number; referralCode: string;
  referralBonusPoints: number; welcomeBonusPoints: number; friendsReferred: number;
  history: { id: number; delta: number; reason: string; orderId: number | null; createdAt: string }[];
}

const REASON: Record<string, Tr & { icon: string }> = {
  order_earned: { pt: "Pontos ganhos numa encomenda", en: "Earned on an order", fr: "Gagnés sur une commande", icon: "🛍️" },
  order_redeemed: { pt: "Usados numa encomenda", en: "Redeemed on an order", fr: "Utilisés sur une commande", icon: "💸" },
  referral_bonus: { pt: "Bónus de convite", en: "Referral bonus", fr: "Bonus de parrainage", icon: "🤝" },
  welcome_bonus: { pt: "Bónus de boas-vindas", en: "Welcome bonus", fr: "Bonus de bienvenue", icon: "🎉" },
  refund: { pt: "Pontos devolvidos", en: "Points refunded", fr: "Points remboursés", icon: "↩️" },
};

function RewardsInner() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const meta = useMeta();
  const q = useQuery<PointsInfo>({ queryKey: ["/api/auth/points"] });
  const [copied, setCopied] = useState<"code" | "link" | null>(null);

  if (q.isLoading) return <Loading />;
  if (q.error || !q.data) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const p = q.data;
  const link = `${window.location.origin}/registar?ref=${encodeURIComponent(p.referralCode)}`;
  const maxPct = meta.data?.points.maxDiscountPct;
  const shareMsg = t({
    pt: `Experimenta o BazzarDelivery! Regista-te com o meu código ${p.referralCode} e ganha ${p.welcomeBonusPoints} pontos: ${link}`,
    en: `Try BazzarDelivery! Sign up with my code ${p.referralCode} and get ${p.welcomeBonusPoints} points: ${link}`,
    fr: `Essaie BazzarDelivery ! Inscris-toi avec mon code ${p.referralCode} et gagne ${p.welcomeBonusPoints} points : ${link}`,
  });

  const copy = async (text: string, which: "code" | "link") => {
    try { await navigator.clipboard.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 2000); }
    catch { toast({ variant: "destructive", title: t({ pt: "Não foi possível copiar", en: "Couldn't copy", fr: "Copie impossible" }) }); }
  };

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      {/* Saldo */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-amber-500 to-orange-700 p-6 text-white shadow-lg">
        <Sparkles className="absolute -right-3 -top-3 h-24 w-24 text-white/10" aria-hidden />
        <p className="flex items-center gap-1.5 text-sm font-medium text-white/85"><Coins className="h-4 w-4" />{t({ pt: "O seu saldo", en: "Your balance", fr: "Votre solde" })}</p>
        <p className="mt-1 text-5xl font-extrabold">{p.balance}<span className="ml-2 text-lg font-semibold text-white/80">{t({ pt: "pontos", en: "points", fr: "points" })}</span></p>
        <p className="mt-1 text-sm text-white/90">{t({ pt: `Valem ${kz(p.balance * p.pointValueKz)} em descontos`, en: `Worth ${kz(p.balance * p.pointValueKz)} in discounts`, fr: `Valent ${kz(p.balance * p.pointValueKz)} de réduction` })}</p>
      </div>

      {/* Como funciona */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <h2 className="mb-3 text-base font-bold">{t({ pt: "Como funciona", en: "How it works", fr: "Comment ça marche" })}</h2>
        <ol className="space-y-3">
          {[
            { icon: ShoppingBag, text: { pt: `Ganhe 1 ponto por cada ${kz(p.kzPerPointEarned)} gastos em encomendas entregues.`, en: `Earn 1 point for every ${kz(p.kzPerPointEarned)} spent on delivered orders.`, fr: `Gagnez 1 point par ${kz(p.kzPerPointEarned)} dépensés sur les commandes livrées.` } },
            { icon: Coins, text: { pt: `Cada ponto vale ${kz(p.pointValueKz)}. Use-os no carrinho com "Usar pontos"${maxPct != null ? ` — até ${maxPct}% do total` : ""}.`, en: `Each point is worth ${kz(p.pointValueKz)}. Use them in your basket with "Use points"${maxPct != null ? ` — up to ${maxPct}% of the total` : ""}.`, fr: `Chaque point vaut ${kz(p.pointValueKz)}. Utilisez-les au panier${maxPct != null ? ` — jusqu'à ${maxPct}% du total` : ""}.` } },
            { icon: Gift, text: { pt: `Convide amigos: ganha ${p.referralBonusPoints} pontos quando se registam com o seu código, e eles recebem ${p.welcomeBonusPoints} pontos de boas-vindas.`, en: `Invite friends: you earn ${p.referralBonusPoints} points when they sign up with your code, and they get ${p.welcomeBonusPoints} welcome points.`, fr: `Parrainez : vous gagnez ${p.referralBonusPoints} points et vos amis ${p.welcomeBonusPoints} points de bienvenue.` } },
          ].map(({ icon: Icon, text }, i) => (
            <li key={i} className="flex gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700"><Icon className="h-4 w-4" /></span>
              <p className="text-sm text-neutral-700">{t(text)}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Convites */}
      <section className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold">{t({ pt: "Convide amigos", en: "Invite friends", fr: "Parrainez vos amis" })}</h2>
          <span className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-700">
            <Users className="h-3.5 w-3.5" />{t({ pt: `${p.friendsReferred} convidado${p.friendsReferred === 1 ? "" : "s"}`, en: `${p.friendsReferred} referred`, fr: `${p.friendsReferred} parrainé${p.friendsReferred === 1 ? "" : "s"}` })}
          </span>
        </div>
        <p className="mt-3 text-xs text-neutral-500">{t({ pt: "O seu código", en: "Your code", fr: "Votre code" })}</p>
        <div className="mt-1 flex items-center gap-2">
          <p className="flex-1 rounded-xl border-2 border-dashed border-orange-300 bg-orange-50 py-3 text-center font-mono text-2xl font-extrabold tracking-widest text-orange-800">{p.referralCode}</p>
          <Button variant="outline" size="icon" className="h-14 w-14" onClick={() => copy(p.referralCode, "code")} aria-label={t({ pt: "Copiar código", en: "Copy code", fr: "Copier le code" })}>
            {copied === "code" ? <Check className="h-5 w-5 text-green-600" /> : <Copy className="h-5 w-5" />}
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => copy(link, "link")}>
            {copied === "link" ? <Check className="mr-1.5 h-4 w-4 text-green-600" /> : <Copy className="mr-1.5 h-4 w-4" />}
            {t({ pt: "Copiar link", en: "Copy link", fr: "Copier le lien" })}
          </Button>
          <a href={`https://wa.me/?text=${encodeURIComponent(shareMsg)}`} target="_blank" rel="noopener noreferrer">
            <Button className="w-full bg-[#1f9d55] hover:bg-[#17803f]">WhatsApp</Button>
          </a>
        </div>
      </section>

      {/* Histórico */}
      <section className="rounded-2xl border bg-white shadow-sm">
        <h2 className="px-4 pb-2 pt-4 text-base font-bold">{t({ pt: "Histórico", en: "History", fr: "Historique" })}</h2>
        {p.history.length === 0 ? (
          <EmptyState icon="🪙" title={t({ pt: "Ainda sem movimentos", en: "No activity yet", fr: "Aucun mouvement" })}
            text={t({ pt: "Faça a sua primeira encomenda para começar a ganhar pontos.", en: "Place your first order to start earning.", fr: "Passez votre première commande pour gagner des points." })}
            action={<Link href="/"><Button size="sm">{t({ pt: "Explorar lojas", en: "Explore stores", fr: "Explorer" })}</Button></Link>} />
        ) : (
          <ul className="divide-y">
            {p.history.map((h) => {
              const r = REASON[h.reason];
              const content = (
                <>
                  <span className="text-xl" aria-hidden>{r?.icon ?? "•"}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{r ? t(r) : h.reason}</p>
                    <p className="text-xs text-neutral-500">{dateTime(h.createdAt, lang)}</p>
                  </div>
                  <span className={cn("whitespace-nowrap font-bold", h.delta >= 0 ? "text-green-700" : "text-red-600")}>{h.delta >= 0 ? "+" : "−"}{Math.abs(h.delta)}</span>
                </>
              );
              return (
                <li key={h.id}>
                  {h.orderId ? <Link href={`/encomendas/${h.orderId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-neutral-50">{content}</Link>
                    : <div className="flex items-center gap-3 px-4 py-3">{content}</div>}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function Rewards() {
  const t = useT();
  return (
    <CustomerShell hideHeader>
      <TopBar title={t({ pt: "Pontos e convites", en: "Points & referrals", fr: "Points et parrainage" })} back="/perfil" />
      <Guard><RewardsInner /></Guard>
    </CustomerShell>
  );
}
