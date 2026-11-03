import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CustomerShell } from "@/components/AppShell";
import { EmptyState, ErrorState, Guard, PageTitle } from "@/components/common";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { StoreCard, StoreCardSkeleton, type StoreCardData } from "@/pages/customer/Home";

function FavoritesList() {
  const t = useT();
  const q = useQuery<{ stores: StoreCardData[] }>({ queryKey: ["/api/favorites"] });
  const stores = q.data?.stores ?? [];

  return (
    <>
      <PageTitle title={{ pt: "Favoritos", en: "Favourites", fr: "Favoris" }}
        subtitle={q.data && stores.length ? t({ pt: `${stores.length} lojas guardadas`, en: `${stores.length} saved stores`, fr: `${stores.length} magasins enregistrés` }) : undefined} />
      <div className="px-4 pb-6 pt-2">
        {q.isLoading ? (
          <div className="space-y-6">{[0, 1].map((i) => <StoreCardSkeleton key={i} />)}</div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : stores.length === 0 ? (
          <EmptyState icon="❤️"
            title={t({ pt: "Ainda não tem favoritos", en: "No favourites yet", fr: "Pas encore de favoris" })}
            text={t({ pt: "Toque no coração numa loja para a guardar aqui.", en: "Tap the heart on a store to save it here.", fr: "Touchez le cœur d'un magasin pour l'enregistrer ici." })}
            action={<Link href="/"><Button>{t({ pt: "Explorar lojas", en: "Explore stores", fr: "Explorer" })}</Button></Link>} />
        ) : (
          <ul className="space-y-6">{stores.map((s) => <li key={s.id}><StoreCard store={s} /></li>)}</ul>
        )}
      </div>
    </>
  );
}

export default function Favorites() {
  return (
    <CustomerShell>
      <Guard roles={["customer"]}>
        <FavoritesList />
      </Guard>
    </CustomerShell>
  );
}
