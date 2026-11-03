import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Star } from "lucide-react";
import { Guard, Loading, ErrorState, EmptyState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { post, queryClient } from "@/lib/api";
import { useLang, useT, T } from "@/lib/i18n";
import { dateTime } from "@/lib/format";
import { usePartnerTabs, usePartnerTitle } from "./PartnerOrders";

interface Review {
  id: number; rating: number; driverRating: number | null; comment: string | null; reply: string | null;
  repliedAt: string | null; createdAt: string; author: string; orderNumber: string;
}

export default function PartnerReviews() {
  const tabs = usePartnerTabs();
  const title = usePartnerTitle();
  return (
    <Guard roles={["supplier"]}>
      <PanelShell title={title} tabs={tabs}>
        <ReviewsContent />
      </PanelShell>
    </Guard>
  );
}

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex" aria-label={`${value}/5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={`${size} ${i <= Math.round(value) ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`} aria-hidden />
      ))}
    </span>
  );
}

function ReviewsContent() {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<{ reviews: Review[] }>({ queryKey: ["/api/partner/reviews"] });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const reviews = data!.reviews;
  const avg = reviews.length ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : 0;
  const unanswered = reviews.filter((r) => !r.reply).length;
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-xl font-bold">{t({ pt: "Avaliações", en: "Reviews", fr: "Avis" })}</h1>
      <div className="flex flex-wrap items-center gap-6 rounded-lg border bg-white p-4">
        <div>
          <p className="text-3xl font-bold">{avg ? avg.toFixed(1) : "—"}</p>
          <Stars value={avg} size="h-5 w-5" />
        </div>
        <div className="text-sm text-neutral-600">
          <p>{t({ pt: `${reviews.length} avaliações`, en: `${reviews.length} reviews`, fr: `${reviews.length} avis` })}</p>
          <p>{t({ pt: `${unanswered} por responder`, en: `${unanswered} unanswered`, fr: `${unanswered} sans réponse` })}</p>
        </div>
      </div>
      {!reviews.length ? (
        <EmptyState icon="⭐" title={t({ pt: "Ainda sem avaliações", en: "No reviews yet", fr: "Pas encore d'avis" })}
          text={t({ pt: "Os clientes podem avaliar depois de receberem a encomenda.", en: "Customers can review after receiving their order.", fr: "Les clients peuvent noter après réception de leur commande." })} />
      ) : (
        <ul className="space-y-3">{reviews.map((r) => <ReviewCard key={r.id} review={r} />)}</ul>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: Review }) {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(review.reply ?? "");
  const reply = useMutation({
    mutationFn: () => post(`/api/partner/reviews/${review.id}/reply`, { reply: text.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/partner/reviews"] });
      setEditing(false);
      toast({ title: t({ pt: "Resposta publicada", en: "Reply posted", fr: "Réponse publiée" }) });
    },
    onError: (err: Error) => toast({ variant: "destructive", title: t(T.error), description: err.message }),
  });
  const showForm = editing || !review.reply;
  return (
    <li className="rounded-lg border bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Stars value={review.rating} />
          <p className="text-sm font-medium">{review.author}</p>
        </div>
        <div className="text-right text-xs text-neutral-500">
          <p className="font-mono">{review.orderNumber}</p>
          <p>{dateTime(review.createdAt, lang)}</p>
        </div>
      </div>
      {review.comment ? <p className="mt-2 text-sm text-neutral-800">{review.comment}</p>
        : <p className="mt-2 text-sm italic text-neutral-400">{t({ pt: "Sem comentário", en: "No comment", fr: "Sans commentaire" })}</p>}
      {review.reply && !editing && (
        <div className="mt-3 rounded-md border-l-4 border-primary bg-neutral-50 p-3 text-sm">
          <p className="mb-1 text-xs font-semibold text-neutral-600">{t({ pt: "A sua resposta", en: "Your reply", fr: "Votre réponse" })}{review.repliedAt && ` · ${dateTime(review.repliedAt, lang)}`}</p>
          <p>{review.reply}</p>
          <Button variant="link" size="sm" className="h-auto px-0" onClick={() => { setText(review.reply ?? ""); setEditing(true); }}>{t(T.edit)}</Button>
        </div>
      )}
      {showForm && (
        <form className="mt-3 space-y-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) reply.mutate(); }}>
          <Label htmlFor={`reply-${review.id}`}>{t({ pt: "Responder", en: "Reply", fr: "Répondre" })}</Label>
          <Textarea id={`reply-${review.id}`} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)}
            placeholder={t({ pt: "Agradeça ou esclareça — a resposta é pública.", en: "Thank or clarify — the reply is public.", fr: "Remerciez ou précisez — la réponse est publique." })} />
          <div className="flex justify-end gap-2">
            {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>{t(T.cancel)}</Button>}
            <Button type="submit" size="sm" disabled={!text.trim() || reply.isPending}>{t({ pt: "Publicar resposta", en: "Post reply", fr: "Publier" })}</Button>
          </div>
        </form>
      )}
    </li>
  );
}
