import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Guard, Loading, ErrorState } from "@/components/common";
import { PanelShell } from "@/components/AppShell";
import { useT, type Tr } from "@/lib/i18n";
import { kz } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Separadores da área de administração (reutilizados nas outras páginas admin). */
export function useAdminTabs() {
  const t = useT();
  return [
    { href: "/admin", label: t({ pt: "Resumo", en: "Overview", fr: "Résumé" }) },
    { href: "/admin/encomendas", label: t({ pt: "Encomendas", en: "Orders", fr: "Commandes" }) },
    { href: "/admin/lojas", label: t({ pt: "Lojas", en: "Stores", fr: "Magasins" }) },
    { href: "/admin/utilizadores", label: t({ pt: "Utilizadores", en: "Users", fr: "Utilisateurs" }) },
    { href: "/admin/promocoes", label: t({ pt: "Promoções", en: "Promotions", fr: "Promotions" }) },
    { href: "/admin/publicidade", label: t({ pt: "Publicidade", en: "Ads", fr: "Publicité" }) },
  ];
}
export function useAdminTitle() {
  const t = useT();
  return t({ pt: "Administração", en: "Administration", fr: "Administration" });
}

/** Moldura comum das páginas admin. */
export function AdminPage({ children }: { children: React.ReactNode }) {
  const tabs = useAdminTabs();
  const title = useAdminTitle();
  return (
    <Guard roles={["admin"]}>
      <PanelShell title={title} tabs={tabs}>{children}</PanelShell>
    </Guard>
  );
}

interface Stats {
  last24h: { total: number; delivered: number; active: number; gmv: number };
  pending: { stores: number; drivers: number; unassigned: number };
  users: number;
  plusMembers: number;
}

export default function AdminDashboard() {
  return <AdminPage><Dashboard /></AdminPage>;
}

function Tile({ label, value, href, warn }: { label: Tr; value: string | number; href?: string; warn?: boolean }) {
  const t = useT();
  const body = (
    <div className={cn("h-full rounded-lg border bg-white p-4", warn && "border-amber-400 bg-amber-50", href && "transition hover:shadow-md")}>
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">{t(label)}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
      {href && <p className="mt-1 text-xs font-medium text-primary">{t({ pt: "Ver →", en: "View →", fr: "Voir →" })}</p>}
    </div>
  );
  return href ? <Link href={href} className="block">{body}</Link> : body;
}

function Dashboard() {
  const t = useT();
  const { data, isLoading, error, refetch } = useQuery<Stats>({ queryKey: ["/api/admin/stats"], refetchInterval: 30_000 });
  if (isLoading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={() => refetch()} />;
  const s = data!;
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">{t({ pt: "Resumo", en: "Overview", fr: "Résumé" })}</h1>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t({ pt: "Últimas 24 horas", en: "Last 24 hours", fr: "Dernières 24 heures" })}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={{ pt: "Encomendas", en: "Orders", fr: "Commandes" }} value={s.last24h.total} href="/admin/encomendas" />
          <Tile label={{ pt: "Entregues", en: "Delivered", fr: "Livrées" }} value={s.last24h.delivered} />
          <Tile label={{ pt: "Em curso", en: "Active", fr: "En cours" }} value={s.last24h.active} />
          <Tile label={{ pt: "GMV (entregues)", en: "GMV (delivered)", fr: "GMV (livrées)" }} value={kz(s.last24h.gmv)} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t({ pt: "Requer atenção", en: "Needs attention", fr: "À traiter" })}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Tile label={{ pt: "Encomendas sem estafeta", en: "Orders without rider", fr: "Commandes sans livreur" }} value={s.pending.unassigned}
            href="/admin/encomendas?unassigned=1" warn={s.pending.unassigned > 0} />
          <Tile label={{ pt: "Lojas por aprovar", en: "Stores to approve", fr: "Magasins à approuver" }} value={s.pending.stores}
            href="/admin/lojas?pending=1" warn={s.pending.stores > 0} />
          <Tile label={{ pt: "Estafetas por aprovar", en: "Riders to approve", fr: "Livreurs à approuver" }} value={s.pending.drivers}
            href="/admin/utilizadores?type=driver&pending=1" warn={s.pending.drivers > 0} />
        </div>
      </section>
      <section>
        <h2 className="mb-2 text-sm font-semibold text-neutral-700">{t({ pt: "Plataforma", en: "Platform", fr: "Plateforme" })}</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label={{ pt: "Utilizadores", en: "Users", fr: "Utilisateurs" }} value={s.users} href="/admin/utilizadores" />
          <Tile label={{ pt: "Membros Plus", en: "Plus members", fr: "Membres Plus" }} value={s.plusMembers} />
        </div>
      </section>
    </div>
  );
}
