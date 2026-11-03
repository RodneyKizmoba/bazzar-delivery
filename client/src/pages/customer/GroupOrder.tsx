import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, Check, Clock, Copy, CreditCard, Crown, Loader2, Lock, MapPin, MessageSquare, Plus, Share2, ShoppingBasket, Trash2, Unlock, Users, XCircle,
} from "lucide-react";
import { CustomerShell, TopBar } from "@/components/AppShell";
import { EmptyState, ErrorState, Loading, StoreImage, DietaryBadges } from "@/components/common";
import { ItemDialog, type ItemSelection, type MenuItemFull } from "@/components/ItemDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { api, ApiError, del, post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { kz, dateTime, time } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  AddressPicker, useAddresses, OrderErrorAlert, PaymentPicker, PromoInput, Section, WhenPicker, type SelectedOption, type StoreDetail, type WhenMode,
} from "./_orderingKit";

interface GroupItemView {
  id: number; participantId: number; menuItemId: number; quantity: number; optionIds: number[]; specialInstructions: string | null;
  name: string; unitPrice: number; lineTotal: number; selectedOptions: SelectedOption[]; problem: string | null;
}
interface GroupView {
  group: { token: string; status: "open" | "locked" | "checking_out" | "ordered" | "cancelled"; expiresAt: string; orderId: number | null; hostId: number };
  store: StoreDetail["store"];
  participants: { id: number; name: string; isHost: boolean; items: GroupItemView[]; subtotal: number }[];
  subtotal: number; itemCount: number;
}
interface Creds { participantId: number; secret: string }

const credKey = (token: string) => `pedeai.group.${token}`;
function readCreds(token: string): Creds | null {
  try {
    const v = JSON.parse(localStorage.getItem(credKey(token)) || "null");
    return v && typeof v.participantId === "number" && typeof v.secret === "string" ? v : null;
  } catch { return null; }
}
function saveCreds(token: string, c: Creds | null) {
  try { c ? localStorage.setItem(credKey(token), JSON.stringify(c)) : localStorage.removeItem(credKey(token)); } catch { /* ignore */ }
}

function ShareBox({ link, storeName }: { link: string; storeName: string }) {
  const t = useT();
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const msg = t({ pt: `Junta-te à minha encomenda de grupo em ${storeName} no PedeAí Delivery: ${link}`, en: `Join my group order from ${storeName} on PedeAí Delivery: ${link}`, fr: `Rejoins ma commande groupée chez ${storeName} sur PedeAí Delivery : ${link}` });
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { toast({ variant: "destructive", title: t({ pt: "Não foi possível copiar", en: "Couldn't copy", fr: "Copie impossible" }) }); }
  };
  return (
    <div className="rounded-2xl border border-teal-200 bg-teal-50 p-4">
      <p className="flex items-center gap-2 text-sm font-semibold text-teal-900"><Share2 className="h-4 w-4" />{t({ pt: "Convide amigos para o cesto", en: "Invite friends to the basket", fr: "Invitez vos amis" })}</p>
      <p className="mt-0.5 text-xs text-teal-800">{t({ pt: "Cada pessoa escolhe o que quer — não precisam de conta.", en: "Everyone picks their own — no account needed.", fr: "Chacun choisit — sans compte." })}</p>
      <div className="mt-3 flex gap-2">
        <Input readOnly value={link} aria-label={t({ pt: "Link do grupo", en: "Group link", fr: "Lien du groupe" })} className="bg-white text-xs" onFocus={(e) => e.target.select()} />
        <Button variant="outline" className="bg-white" onClick={copy} aria-label={t({ pt: "Copiar link", en: "Copy link", fr: "Copier le lien" })}>
          {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
        </Button>
      </div>
      <a href={`https://wa.me/?text=${encodeURIComponent(msg)}`} target="_blank" rel="noopener noreferrer" className="mt-2 block">
        <Button className="w-full bg-[#1f9d55] hover:bg-[#17803f]">{t({ pt: "Partilhar no WhatsApp", en: "Share on WhatsApp", fr: "Partager sur WhatsApp" })}</Button>
      </a>
    </div>
  );
}

function HostCheckout({ view, token }: { view: GroupView; token: string }) {
  const t = useT();
  const { lang } = useLang();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const store = view.store;
  const [addressId, setAddressId] = useState<number | null>(null);
  const [mode, setMode] = useState<WhenMode>(store.isOpenNow ? "now" : "schedule");
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [notes, setNotes] = useState("");
  const [promo, setPromo] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const hasProblems = view.participants.some((p) => p.items.some((i) => i.problem));
  const belowMin = view.subtotal < store.minOrder;

  const checkout = useMutation({
    mutationFn: () => post<{ order: { id: number } }>(`/api/groups/${token}/checkout`, {
      addressId, paymentMethod, notes: notes.trim() || null, scheduledFor: mode === "schedule" ? scheduledFor : null, promoCode: promo, usePoints: 0,
    }),
    onSuccess: ({ order }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/orders"] });
      toast({ title: t({ pt: "Encomenda de grupo feita! 🎉", en: "Group order placed! 🎉", fr: "Commande groupée passée ! 🎉" }) });
      navigate(`/encomendas/${order.id}`);
    },
    onError: (e) => { setError(e); queryClient.invalidateQueries({ queryKey: [`/api/groups/${token}`] }); },
  });

  const addrs = useAddresses();
  const chosenZone = addrs.data?.addresses.find((a) => a.id === addressId)?.zone;
  const zoneServed = !chosenZone || !store.zonesServed?.length || store.zonesServed.some((z) => z.toLowerCase() === chosenZone.toLowerCase());
  const canPlace = view.itemCount > 0 && !!addressId && zoneServed && !(mode === "schedule" && !scheduledFor) && !hasProblems && !belowMin && !checkout.isPending;

  return (
    <div className="space-y-4">
      <h2 className="px-1 pt-2 text-lg font-bold">{t({ pt: "Finalizar (anfitrião)", en: "Checkout (host)", fr: "Finaliser (hôte)" })}</h2>
      <OrderErrorAlert error={error} onDismiss={() => setError(null)} onSchedule={() => { setMode("schedule"); setError(null); }} onPickCash={() => { setPaymentMethod("cash"); setError(null); }} />
      <Section title={t({ pt: "Morada de entrega", en: "Delivery address", fr: "Adresse de livraison" })} icon={<MapPin className="h-4 w-4 text-primary" />}>
        <AddressPicker value={addressId} onChange={setAddressId} zonesServed={store.zonesServed} />
      </Section>
      <Section title={t({ pt: "Quando", en: "When", fr: "Quand" })} icon={<Clock className="h-4 w-4 text-primary" />}>
        <WhenPicker mode={mode} onModeChange={setMode} value={scheduledFor} onChange={setScheduledFor}
          hours={{ openingTime: store.openingTime, closingTime: store.closingTime }} allowNow={store.isOpenNow && !store.minNoticeMin}
          minNoticeMin={store.minNoticeMin ?? 0} maxAheadHours={store.maxAheadHours}
          nowNote={store.isOpenNow ? `~${store.deliveryTimeMin} ${t(T.minutes)}` : t({ pt: "Loja fechada agora", en: "Store closed now", fr: "Magasin fermé" })} />
        {mode === "schedule" && scheduledFor && <p className="mt-2 text-xs text-neutral-500">{dateTime(scheduledFor, lang)}</p>}
      </Section>
      <Section title={t({ pt: "Pagamento", en: "Payment", fr: "Paiement" })} icon={<CreditCard className="h-4 w-4 text-primary" />}>
        <PaymentPicker value={paymentMethod} onChange={setPaymentMethod} />
      </Section>
      <Section title={t({ pt: "Notas e código", en: "Notes & code", fr: "Notes et code" })} icon={<MessageSquare className="h-4 w-4 text-primary" />}>
        <div className="space-y-3">
          <div>
            <Label htmlFor="group-notes" className="sr-only">{t({ pt: "Notas", en: "Notes", fr: "Notes" })}</Label>
            <Textarea id="group-notes" rows={2} maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder={t({ pt: "Notas para o estafeta / loja", en: "Notes for the rider / store", fr: "Notes pour le livreur / magasin" })} />
          </div>
          <PromoInput applied={promo} onRemove={() => setPromo(null)} onApply={async (c) => {
            const items = view.participants.flatMap((p) => p.items.filter((i) => !i.problem)).map((i) => ({ menuItemId: i.menuItemId, quantity: i.quantity, optionIds: i.optionIds, specialInstructions: i.specialInstructions }));
            if (!items.length) throw new Error(t({ pt: "O cesto está vazio.", en: "The basket is empty.", fr: "Le panier est vide." }));
            await post("/api/cart/quote", { storeId: store.id, items, promoCode: c });
            setPromo(c);
          }} />
        </div>
      </Section>
      <div className="rounded-2xl border bg-white p-4 shadow-sm">
        <div className="flex justify-between text-sm"><span>{t(T.subtotal)}</span><span className="font-semibold">{kz(view.subtotal)}</span></div>
        <p className="mt-1 text-xs text-neutral-500">{t({ pt: "Taxa de entrega e descontos calculados ao confirmar.", en: "Delivery fee and discounts are calculated on confirm.", fr: "Frais et réductions calculés à la confirmation." })} {t(T.deliveryFee)}: {kz(store.deliveryFee)}</p>
        {belowMin && <p className="mt-2 text-xs font-medium text-red-600">{t({ pt: `Mínimo de encomenda: ${kz(store.minOrder)}`, en: `Minimum order: ${kz(store.minOrder)}`, fr: `Minimum : ${kz(store.minOrder)}` })}</p>}
        {hasProblems && <p className="mt-2 text-xs font-medium text-red-600">{t({ pt: "Remova os itens com aviso antes de finalizar.", en: "Remove items with warnings before checking out.", fr: "Retirez les articles signalés." })}</p>}
        <Button className="mt-3 h-12 w-full rounded-xl text-base" disabled={!canPlace} onClick={() => { setError(null); checkout.mutate(); }}>
          {checkout.isPending && <Loader2 className="mr-2 h-5 w-5 animate-spin" />}
          {t({ pt: "Fazer encomenda de grupo", en: "Place group order", fr: "Passer la commande groupée" })}
        </Button>
      </div>
    </div>
  );
}

export default function GroupOrder() {
  const t = useT();
  const { lang } = useLang();
  const { token } = useParams<{ token: string }>();
  const { user } = useAuth();
  const { toast } = useToast();
  const [creds, setCreds] = useState<Creds | null>(() => readCreds(token));
  const [name, setName] = useState("");
  const [dialogItem, setDialogItem] = useState<MenuItemFull | null>(null);
  const [confirmCancel, setConfirmCancel] = useState(false);

  const groupQ = useQuery<GroupView>({
    queryKey: [`/api/groups/${token}`],
    refetchInterval: (q) => (q.state.data?.group.status === "open" || q.state.data?.group.status === "locked" || q.state.data?.group.status === "checking_out" ? 4_000 : false),
  });
  const view = groupQ.data;
  const storeQ = useQuery<StoreDetail>({ queryKey: [`/api/stores/${view?.store.id}`], enabled: !!view?.store.id });

  useEffect(() => { if (user && !name) setName(user.fullName.split(" ")[0]); }, [user]);

  // credenciais guardadas que já não pertencem ao grupo → esquecer
  useEffect(() => {
    if (view && creds && !view.participants.some((p) => p.id === creds.participantId)) { saveCreds(token, null); setCreds(null); }
  }, [view]);

  const headers = creds ? { "X-Group-Participant": String(creds.participantId), "X-Group-Secret": creds.secret } : undefined;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [`/api/groups/${token}`] });
  const onErr = (e: Error) => {
    if (e instanceof ApiError && e.code === "NOT_PARTICIPANT") { saveCreds(token, null); setCreds(null); }
    toast({ variant: "destructive", title: t(T.error), description: e.message });
  };

  const join = useMutation({
    mutationFn: () => post<Creds & { name: string }>(`/api/groups/${token}/join`, { name: name.trim() }),
    onSuccess: (r) => { const c = { participantId: r.participantId, secret: r.secret }; saveCreds(token, c); setCreds(c); refresh(); },
    onError: onErr,
  });
  const addItem = useMutation({
    mutationFn: (sel: ItemSelection) => api("POST", `/api/groups/${token}/items`, {
      menuItemId: sel.menuItemId, quantity: sel.quantity, optionIds: sel.optionIds, specialInstructions: sel.specialInstructions || null,
    }, headers),
    onSuccess: (_r, sel) => { setDialogItem(null); refresh(); toast({ title: t({ pt: `${sel.name} adicionado ao cesto`, en: `${sel.name} added to basket`, fr: `${sel.name} ajouté` }) }); },
    onError: onErr,
  });
  const removeItem = useMutation({
    mutationFn: (itemId: number) => del(`/api/groups/${token}/items/${itemId}`, headers),
    onSuccess: refresh,
    onError: onErr,
  });
  const lock = useMutation({
    mutationFn: (locked: boolean) => post(`/api/groups/${token}/lock`, { locked }),
    onSuccess: refresh, onError: onErr,
  });
  const cancel = useMutation({
    mutationFn: () => post(`/api/groups/${token}/cancel`),
    onSuccess: () => { setConfirmCancel(false); refresh(); }, onError: onErr,
  });

  const sections = useMemo(() => {
    const d = storeQ.data;
    if (!d) return [];
    const out = d.sections.map((s) => ({ id: s.id as number | null, name: s.name, items: d.items.filter((i) => i.sectionId === s.id) }));
    const orphan = d.items.filter((i) => !i.sectionId || !d.sections.some((s) => s.id === i.sectionId));
    if (orphan.length) out.push({ id: null, name: t({ pt: "Outros", en: "Other", fr: "Autres" }), items: orphan });
    return out.filter((s) => s.items.length);
  }, [storeQ.data, lang]);

  const title = t({ pt: "Encomenda em grupo", en: "Group order", fr: "Commande groupée" });

  if (groupQ.isLoading) return <CustomerShell hideHeader><TopBar title={title} back="/" /><Loading /></CustomerShell>;
  if (groupQ.error || !view) {
    return (
      <CustomerShell hideHeader><TopBar title={title} back="/" />
        {groupQ.error instanceof ApiError && groupQ.error.status === 404
          ? <EmptyState icon="🔗" title={t({ pt: "Grupo não encontrado", en: "Group not found", fr: "Groupe introuvable" })} text={t({ pt: "O link pode estar errado ou ter expirado.", en: "The link may be wrong or expired.", fr: "Le lien est peut-être erroné ou expiré." })}
            action={<Link href="/"><Button>{t({ pt: "Ir para o início", en: "Go home", fr: "Accueil" })}</Button></Link>} />
          : <ErrorState error={groupQ.error} onRetry={() => groupQ.refetch()} />}
      </CustomerShell>
    );
  }

  const { group, store, participants } = view;
  const isHost = !!user && user.id === group.hostId;
  const me = creds ? participants.find((p) => p.id === creds.participantId) : undefined;
  const myIsHost = me?.isHost ?? false;
  const host = participants.find((p) => p.isHost);
  const isOpen = group.status === "open";
  const link = `${window.location.origin}/grupo/${token}`;

  return (
    <CustomerShell hideHeader>
      <TopBar title={title} back="/" right={<span className="flex items-center gap-1 pr-2 text-xs text-neutral-500"><Users className="h-4 w-4" />{participants.length}</span>} />
      <div className="space-y-4 px-4 pb-10 pt-4">
        {/* Loja + anfitrião */}
        <div className="flex items-center gap-3 rounded-2xl border bg-white p-4 shadow-sm">
          <StoreImage name={store.name} url={store.logoUrl} className="h-14 w-14 text-base" rounded="rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-lg font-bold">{store.name}</p>
            <p className="flex items-center gap-1 text-xs text-neutral-500">
              <Crown className="h-3.5 w-3.5 text-amber-500" />{t({ pt: `Anfitrião: ${host?.name ?? "—"}`, en: `Host: ${host?.name ?? "—"}`, fr: `Hôte : ${host?.name ?? "—"}` })}
              {isOpen && <> · {t({ pt: "expira às", en: "expires at", fr: "expire à" })} {time(group.expiresAt, lang)}</>}
            </p>
          </div>
        </div>

        {/* Estados */}
        {(group.status === "locked" || group.status === "checking_out") && (
          <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{isHost ? t({ pt: "Fechou o cesto. Ninguém pode adicionar ou remover itens até o reabrir.", en: "You locked the basket. No one can add or remove items until you reopen it.", fr: "Panier verrouillé. Rouvrez-le pour modifier." })
              : t({ pt: "O anfitrião fechou o cesto e está a finalizar a encomenda.", en: "The host locked the basket and is checking out.", fr: "L'hôte a verrouillé le panier et finalise la commande." })}</p>
          </div>
        )}
        {group.status === "ordered" && (
          <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900">
            <p className="font-semibold">{t({ pt: "Encomenda feita! 🎉", en: "Order placed! 🎉", fr: "Commande passée ! 🎉" })}</p>
            <p className="mt-0.5">{isHost ? t({ pt: "Acompanhe a entrega na página da encomenda.", en: "Track the delivery on the order page.", fr: "Suivez la livraison sur la page de commande." })
              : t({ pt: `${host?.name ?? "O anfitrião"} fez a encomenda. Bom apetite!`, en: `${host?.name ?? "The host"} placed the order. Enjoy!`, fr: `${host?.name ?? "L'hôte"} a passé la commande. Bon appétit !` })}</p>
            {isHost && group.orderId && <Link href={`/encomendas/${group.orderId}`}><Button size="sm" className="mt-3">{t({ pt: "Ver encomenda", en: "View order", fr: "Voir la commande" })}</Button></Link>}
          </div>
        )}
        {group.status === "cancelled" && (
          <div className="flex items-start gap-3 rounded-2xl border bg-neutral-100 p-4 text-sm text-neutral-700">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{t({ pt: "Este grupo foi cancelado ou expirou.", en: "This group was cancelled or has expired.", fr: "Ce groupe a été annulé ou a expiré." })}</p>
          </div>
        )}

        {/* Partilhar */}
        {isOpen && <ShareBox link={link} storeName={store.name} />}

        {/* Juntar-me */}
        {isOpen && !me && (
          <form className="space-y-3 rounded-2xl border bg-white p-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); if (name.trim()) join.mutate(); }}>
            <p className="font-semibold">{t({ pt: "Junte-se ao grupo para escolher", en: "Join the group to start picking", fr: "Rejoignez le groupe" })}</p>
            <div className="space-y-1.5">
              <Label htmlFor="join-name">{t({ pt: "O seu nome", en: "Your name", fr: "Votre nom" })}</Label>
              <Input id="join-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={t({ pt: "Ex.: Ana", en: "E.g. Ana", fr: "Ex. : Ana" })} />
            </div>
            <Button type="submit" className="w-full" disabled={!name.trim() || join.isPending}>
              {join.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t({ pt: "Juntar-me", en: "Join", fr: "Rejoindre" })}
            </Button>
          </form>
        )}

        {/* Cesto */}
        <Section title={t({ pt: "Cesto do grupo", en: "Group basket", fr: "Panier du groupe" })} icon={<ShoppingBasket className="h-4 w-4 text-primary" />}
          right={<span className="text-sm font-semibold">{kz(view.subtotal)}</span>}>
          {view.itemCount === 0 ? (
            <p className="py-4 text-center text-sm text-neutral-500">{t({ pt: "Ainda ninguém adicionou nada.", en: "Nobody has added anything yet.", fr: "Personne n'a encore rien ajouté." })}</p>
          ) : (
            <div className="space-y-4">
              {participants.filter((p) => p.items.length).map((p) => (
                <div key={p.id}>
                  <div className="mb-1.5 flex items-center justify-between">
                    <p className="flex items-center gap-1.5 text-sm font-semibold">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] text-white">{p.name[0]?.toUpperCase()}</span>
                      {p.name}{p.id === me?.id && <span className="text-xs font-normal text-neutral-500">({t({ pt: "eu", en: "me", fr: "moi" })})</span>}
                      {p.isHost && <Crown className="h-3.5 w-3.5 text-amber-500" />}
                    </p>
                    <span className="text-sm text-neutral-600">{kz(p.subtotal)}</span>
                  </div>
                  <ul className="divide-y rounded-xl border">
                    {p.items.map((i) => {
                      const canRemove = isOpen && !!me && (i.participantId === me.id || myIsHost);
                      return (
                        <li key={i.id} className={cn("flex items-start gap-2 p-2.5", i.problem && "bg-amber-50")}>
                          <div className="min-w-0 flex-1 text-sm">
                            <p><span className="mr-1 font-semibold text-primary">{i.quantity}×</span>{i.name}</p>
                            {i.selectedOptions.length > 0 && <p className="text-xs text-neutral-500">{i.selectedOptions.map((o) => o.name).join(" · ")}</p>}
                            {i.specialInstructions && <p className="text-xs italic text-neutral-500">“{i.specialInstructions}”</p>}
                            {i.problem && <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle className="h-3 w-3" />{i.problem}</p>}
                          </div>
                          <span className="whitespace-nowrap text-sm">{i.problem ? "—" : kz(i.lineTotal)}</span>
                          {canRemove && (
                            <Button variant="ghost" size="icon" className="h-9 w-9" disabled={removeItem.isPending} aria-label={t({ pt: `Remover ${i.name}`, en: `Remove ${i.name}`, fr: `Retirer ${i.name}` })}
                              onClick={() => removeItem.mutate(i.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* Controlo do anfitrião */}
        {isHost && (group.status === "open" || group.status === "locked") && (
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" disabled={lock.isPending} onClick={() => lock.mutate(isOpen)}>
              {isOpen ? <><Lock className="mr-1.5 h-4 w-4" />{t({ pt: "Fechar cesto", en: "Lock basket", fr: "Verrouiller" })}</> : <><Unlock className="mr-1.5 h-4 w-4" />{t({ pt: "Reabrir cesto", en: "Reopen basket", fr: "Rouvrir" })}</>}
            </Button>
            <Button variant="outline" className="flex-1 text-red-600 hover:text-red-700" onClick={() => setConfirmCancel(true)}>
              <XCircle className="mr-1.5 h-4 w-4" />{t({ pt: "Cancelar grupo", en: "Cancel group", fr: "Annuler le groupe" })}
            </Button>
          </div>
        )}

        {/* Menu */}
        {isOpen && me && (
          <div className="space-y-4">
            <h2 className="px-1 pt-2 text-lg font-bold">{t({ pt: "Escolha o que quer", en: "Pick what you want", fr: "Choisissez" })}</h2>
            {storeQ.isLoading ? <Loading /> : storeQ.error ? <ErrorState error={storeQ.error} onRetry={() => storeQ.refetch()} /> : sections.map((s) => (
              <section key={s.id ?? "other"}>
                <h3 className="mb-2 px-1 text-sm font-bold uppercase tracking-wide text-neutral-500">{s.name}</h3>
                <ul className="divide-y rounded-2xl border bg-white shadow-sm">
                  {s.items.map((it) => (
                    <li key={it.id}>
                      <button type="button" disabled={!it.isAvailable} onClick={() => setDialogItem(it)}
                        className={cn("flex w-full items-center gap-3 p-3 text-left hover:bg-neutral-50", !it.isAvailable && "cursor-not-allowed opacity-50")}>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium">{it.name}</p>
                          {it.description && <p className="line-clamp-2 text-xs text-neutral-500">{it.description}</p>}
                          <div className="mt-1 flex items-center gap-2">
                            <span className="text-sm font-semibold">{kz(it.price)}</span>
                            {!it.isAvailable && <span className="text-xs text-red-600">{t({ pt: "Esgotado", en: "Sold out", fr: "Épuisé" })}</span>}
                          </div>
                          <div className="mt-1"><DietaryBadges tags={it.dietaryTags} small /></div>
                        </div>
                        {it.imageUrl ? <img src={it.imageUrl} alt="" className="h-16 w-16 rounded-lg object-cover" loading="lazy" /> : null}
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-teal-50 text-primary"><Plus className="h-4 w-4" /></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {isHost && (group.status === "open" || group.status === "locked") && <HostCheckout view={view} token={token} />}

        {!user && isOpen && (
          <p className="text-center text-xs text-neutral-500">
            {t({ pt: "Só o anfitrião paga e finaliza a encomenda.", en: "Only the host pays and checks out.", fr: "Seul l'hôte paie et finalise." })}
          </p>
        )}
      </div>

      <ItemDialog item={dialogItem} open={!!dialogItem} onOpenChange={(o) => !o && setDialogItem(null)}
        onConfirm={(sel) => addItem.mutate(sel)} busy={addItem.isPending}
        confirmLabel={t({ pt: "Adicionar ao cesto", en: "Add to basket", fr: "Ajouter au panier" })} />

      <AlertDialog open={confirmCancel} onOpenChange={setConfirmCancel}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t({ pt: "Cancelar o grupo?", en: "Cancel the group?", fr: "Annuler le groupe ?" })}</AlertDialogTitle>
            <AlertDialogDescription>{t({ pt: "O cesto será apagado para todos os participantes.", en: "The basket will be removed for everyone.", fr: "Le panier sera supprimé pour tous." })}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t({ pt: "Voltar", en: "Back", fr: "Retour" })}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 hover:bg-red-700" onClick={(e) => { e.preventDefault(); cancel.mutate(); }} disabled={cancel.isPending}>
              {t({ pt: "Cancelar grupo", en: "Cancel group", fr: "Annuler le groupe" })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </CustomerShell>
  );
}
