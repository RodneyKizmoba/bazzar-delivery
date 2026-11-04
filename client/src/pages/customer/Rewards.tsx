import { useQuery } from "@tanstack/react-query";
import { Copy, Gift, Share2, Users } from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, Loading } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useLang, useT, type Tr } from "@/lib/i18n";
import { dateTime, kz } from "@/lib/format";
import { useMeta } from "./_orderingKit";

interface PointsData {
  balance: number;
  pointValueKz: number;
  kzPerPointEarned: number;
  referralCode: string;
  referralBonusPoints: number;
  welcomeBonusPoints: number;
  friendsReferred: number;
  history: { id: number; delta: number; reason: string; orderId: number | null; createdAt: string }[];
}

const REASON: Record<string, Tr> = {
  order_earned: { pt: "Pontos ganhos numa encomenda", en: "Points earned on an order", fr: "Points gagnés sur une commande" },
  order_redeemed: { pt: "Pontos usados numa encomenda", en: "Points used on an order", fr: "Points utilisés" },
  referral_bonus: { pt: "Bónus: amigo convidado", en: "Bonus: friend referred", fr: "Bonus : ami parrainé" },
  welcome_bonus: { pt: "Bónus de boas-vindas", en: "Welcome bonus", fr: "Bonus de bienvenue" },
  refund: { pt: "Pontos devolvidos (encomenda cancelada)", en: "Points refunded (order cancelled)", fr: "Points remboursés" },
};

export default function Rewards() {
  const t = useT();
  return (
    <CustomerShell hideHeader>
      <TopBar title={t({ pt: "Pontos e convites", en: "Points & referrals", fr: "Points et parrainage" })} back="/perfil" />
      <Guard>
        <RewardsBody />
      </Guard>
    </CustomerShell>
  );
}

function RewardsBody() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const meta = useMeta();
  const { data, isLoading, error, refetch } = useQuery<PointsData>({ queryKey: ["/api/auth/points"] });

  if (isLoading) return <Loading />;
  if (error || !data) return <ErrorState error={error} onRetry={() => refetch()} />;

  const link = `${window.location.origin}/registar?ref=${data.referralCode}`;
  const shareText = t({
    pt: `Experimenta a PedeAí Delivery! Regista-te com o meu código ${data.referralCode} e ganha ${data.welcomeBonusPoints} pontos: ${link}`,
    en: `Try PedeAí Delivery! Sign up with my code ${data.referralCode} and get ${data.welcomeBonusPoints} points: ${link}`,
    fr: `Essaie PedeAí Delivery ! Inscris-toi avec mon code ${data.referralCode} et gagne ${data.welcomeBonusPoints} points : ${link}`,
  });
  const maxPct = meta.data?.points?.maxDiscountPct ?? 50;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: t({ pt: "Copiado", en: "Copied", fr: "Copié" }) });
    } catch {
      toast({ variant: "destructive", title: t({ pt: "Não foi possível copiar", en: "Couldn't copy", fr: "Copie impossible" }) });
    }
  };

  return (
    <div className="space-y-4 p-4">
      <section className="rounded-2xl bg-gradient-to-br from-primary to-pop p-5 text-white">
        <p className="text-sm opacity-90">{t({ pt: "O seu saldo", en: "Your balance", fr: "Votre solde" })}</p>
        <p className="text-4xl font-bold">{data.balance} <span className="text-lg font-medium">{t({ pt: "pontos", en: "points", fr: "points" })}</span></p>
        <p className="mt-1 text-sm opacity-90">≈ {kz(data.balance * data.pointValueKz)} {t({ pt: "de desconto", en: "off your orders", fr: "de réduction" })}</p>
      </section>

      <section className="rounded-xl border p-4 text-sm">
        <h2 className="mb-2 font-semibold">{t({ pt: "Como funciona", en: "How it works", fr: "Comment ça marche" })}</h2>
        <ul className="list-disc space-y-1 pl-5 text-neutral-700">
          <li>{t({ pt: `Ganha 1 ponto por cada ${kz(data.kzPerPointEarned)} em encomendas entregues.`, en: `Earn 1 point for every ${kz(data.kzPerPointEarned)} on delivered orders.`, fr: `Gagnez 1 point par tranche de ${kz(data.kzPerPointEarned)} livrée.` })}</li>
          <li>{t({ pt: `Cada ponto vale ${kz(data.pointValueKz)}. Use-os no carrinho (até ${maxPct}% do valor).`, en: `Each point is worth ${kz(data.pointValueKz)}. Use them in your cart (up to ${maxPct}% of the total).`, fr: `Chaque point vaut ${kz(data.pointValueKz)}. Utilisez-les dans le panier (jusqu'à ${maxPct} %).` })}</li>
          <li>{t({ pt: "Se cancelar uma encomenda, os pontos usados voltam para si.", en: "If you cancel an order, the points you used come back.", fr: "En cas d'annulation, vos points sont restitués." })}</li>
        </ul>
      </section>

      <section className="rounded-xl border p-4">
        <div className="mb-2 flex items-center gap-2">
          <Gift className="h-5 w-5 text-primary" />
          <h2 className="font-semibold">{t({ pt: "Convide amigos", en: "Invite friends", fr: "Parrainez vos amis" })}</h2>
        </div>
        <p className="text-sm text-neutral-700">
          {t({
            pt: `O seu amigo ganha ${data.welcomeBonusPoints} pontos ao registar-se com o seu código. Você ganha ${data.referralBonusPoints} pontos quando a primeira encomenda dele for entregue.`,
            en: `Your friend gets ${data.welcomeBonusPoints} points when signing up with your code. You get ${data.referralBonusPoints} points when their first order is delivered.`,
            fr: `Votre ami reçoit ${data.welcomeBonusPoints} points à l'inscription avec votre code. Vous recevez ${data.referralBonusPoints} points à sa première livraison.`,
          })}
        </p>
        <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 px-4 py-3">
          <span className="font-mono text-2xl font-bold tracking-widest text-primary">{data.referralCode}</span>
          <Button size="sm" variant="outline" onClick={() => copy(data.referralCode)} aria-label={t({ pt: "Copiar código", en: "Copy code", fr: "Copier le code" })}>
            <Copy className="h-4 w-4" />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => copy(link)}>
            <Copy className="mr-1 h-4 w-4" />{t({ pt: "Copiar link", en: "Copy link", fr: "Copier le lien" })}
          </Button>
          <Button asChild className="bg-green-600 hover:bg-green-700">
            <a href={`https://wa.me/?text=${encodeURIComponent(shareText)}`} target="_blank" rel="noreferrer">
              <Share2 className="mr-1 h-4 w-4" />WhatsApp
            </a>
          </Button>
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-sm text-neutral-600">
          <Users className="h-4 w-4" />
          {t({ pt: `${data.friendsReferred} amigo(s) convidado(s)`, en: `${data.friendsReferred} friend(s) referred`, fr: `${data.friendsReferred} ami(s) parrainé(s)` })}
        </p>
      </section>

      <section>
        <h2 className="mb-2 font-semibold">{t({ pt: "Histórico", en: "History", fr: "Historique" })}</h2>
        {data.history.length === 0 ? (
          <EmptyState icon="⭐" title={t({ pt: "Ainda sem movimentos", en: "No activity yet", fr: "Aucun mouvement" })}
            text={t({ pt: "Faça a sua primeira encomenda para começar a ganhar pontos.", en: "Place your first order to start earning points.", fr: "Passez votre première commande pour gagner des points." })} />
        ) : (
          <ul className="divide-y rounded-xl border">
            {data.history.map((h) => (
              <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate">{REASON[h.reason] ? t(REASON[h.reason]) : h.reason}</p>
                  <p className="text-xs text-neutral-500">{dateTime(h.createdAt, lang)}</p>
                </div>
                <span className={h.delta >= 0 ? "font-semibold text-green-700" : "font-semibold text-red-600"}>
                  {h.delta >= 0 ? "+" : ""}{h.delta}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
