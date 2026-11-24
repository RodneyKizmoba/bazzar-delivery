import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminPage } from "./AdminDashboard";
import { Loading, ErrorState } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { patch, post, queryClient } from "@/lib/api";
import { useLang, useT, T, type Tr } from "@/lib/i18n";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AdminPerm } from "@/hooks/useAuth";

interface Member { id: number; username: string; fullName: string; phone: string; isActive: boolean; adminPerms: AdminPerm[] | null; isOwner: boolean; createdAt: string; lastLoginAt: string | null; twoFactor: boolean }

export const PERM_INFO: Record<AdminPerm, { label: Tr; desc: Tr }> = {
  orders: { label: { pt: "Encomendas e despacho", en: "Orders & dispatch", fr: "Commandes et dispatch" }, desc: { pt: "Ver e cancelar encomendas, atribuir estafetas", en: "See and cancel orders, assign riders", fr: "Voir et annuler les commandes, assigner des livreurs" } },
  finance: { label: { pt: "Finanças", en: "Finance", fr: "Finances" }, desc: { pt: "Receita, gráficos, pagamentos a lojas e estafetas", en: "Revenue, charts, payouts to stores and riders", fr: "Revenus, graphiques, paiements" } },
  people: { label: { pt: "Lojas e utilizadores", en: "Stores & users", fr: "Magasins et utilisateurs" }, desc: { pt: "Aprovar e bloquear lojas, estafetas e clientes", en: "Approve and block stores, riders and customers", fr: "Approuver et bloquer magasins, livreurs et clients" } },
  marketing: { label: { pt: "Marketing", en: "Marketing", fr: "Marketing" }, desc: { pt: "Promoções, banners e lojas patrocinadas", en: "Promotions, banners and sponsored stores", fr: "Promotions, bannières et magasins sponsorisés" } },
};
const PERMS = Object.keys(PERM_INFO) as AdminPerm[];

export default function AdminTeam() {
  return <AdminPage><Team /></AdminPage>;
}

function Team() {
  const t = useT();
  const { lang } = useLang();
  const { toast } = useToast();
  const KEY = "/api/admin/staff";
  const q = useQuery<{ staff: Member[] }>({ queryKey: [KEY] });
  const [form, setForm] = useState({ fullName: "", username: "", phone: "", password: "", perms: ["orders"] as AdminPerm[] });
  const [err, setErr] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => post(KEY, form),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [KEY] });
      toast({ title: t({ pt: "Conta criada — envie o utilizador e a palavra-passe provisória à pessoa", en: "Account created — send the username and temporary password to the person", fr: "Compte créé — envoyez l'identifiant et le mot de passe provisoire" }) });
      setForm({ fullName: "", username: "", phone: "", password: "", perms: ["orders"] });
    },
    onError: (e: Error) => setErr(e.message),
  });
  const update = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) => patch(`${KEY}/${id}`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
    onError: (e: Error) => toast({ variant: "destructive", title: t(T.error), description: e.message }),
  });
  if (q.isLoading) return <Loading />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const toggle = (list: AdminPerm[], p: AdminPerm) => (list.includes(p) ? list.filter((x) => x !== p) : [...list, p]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">{t({ pt: "Equipa", en: "Team", fr: "Équipe" })}</h1>
        <p className="text-sm text-neutral-600">{t({ pt: "Dê acesso a colaboradores só às áreas de que precisam. Só o dono (você) vê esta página e pode gerir contas de admin.", en: "Give staff access only to the areas they need. Only the owner (you) sees this page and manages admin accounts.", fr: "Donnez à vos collaborateurs l'accès aux seules zones nécessaires. Seul le propriétaire voit cette page." })}</p>
      </div>

      <ul className="space-y-3">
        {q.data!.staff.map((m) => (
          <li key={m.id} className={cn("rounded-lg border bg-white p-4", !m.isActive && "opacity-60")}>
            <div className="flex flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{m.fullName} <span className="text-sm font-normal text-neutral-500">@{m.username}</span></p>
                <p className="text-xs text-neutral-500">{m.isOwner ? t({ pt: "Dono — acesso total", en: "Owner — full access", fr: "Propriétaire — accès total" }) : `${t({ pt: "Desde", en: "Since", fr: "Depuis" })} ${dateTime(m.createdAt, lang)}`}{!m.isActive && ` · ${t({ pt: "desactivado", en: "deactivated", fr: "désactivé" })}`}
                  {m.lastLoginAt && ` · ${t({ pt: "última entrada", en: "last login", fr: "dernière connexion" })} ${dateTime(m.lastLoginAt, lang)}`}</p>
                <p className={cn("text-xs font-semibold", m.twoFactor ? "text-green-700" : "text-amber-700")}>{m.twoFactor ? `🔐 ${t({ pt: "Verificação em dois passos activa", en: "Two-step verification on", fr: "Validation en deux étapes active" })}` : `⚠ ${t({ pt: "Ainda sem verificação em dois passos (pedida no próximo login)", en: "No two-step verification yet (asked at next login)", fr: "Pas encore de validation en deux étapes (demandée à la prochaine connexion)" })}`}</p>
              </div>
              {!m.isOwner && (
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => {
                    const pw = window.prompt(t({ pt: "Nova palavra-passe provisória (mín. 12 caracteres):", en: "New temporary password (min 12 characters):", fr: "Nouveau mot de passe provisoire (min 12 caractères) :" }));
                    if (pw) update.mutate({ id: m.id, body: { password: pw } });
                  }}>{t({ pt: "Repor palavra-passe", en: "Reset password", fr: "Réinitialiser" })}</Button>
                  {m.twoFactor && <Button size="sm" variant="outline" onClick={() => update.mutate({ id: m.id, body: { reset2fa: true } })}>{t({ pt: "Repor 2 passos (telemóvel perdido)", en: "Reset 2-step (lost phone)", fr: "Réinitialiser 2 étapes" })}</Button>}
                  <Button size="sm" variant={m.isActive ? "outline" : "default"} onClick={() => update.mutate({ id: m.id, body: { isActive: !m.isActive } })}>
                    {m.isActive ? t({ pt: "Desactivar", en: "Deactivate", fr: "Désactiver" }) : t({ pt: "Reactivar", en: "Reactivate", fr: "Réactiver" })}
                  </Button>
                </div>
              )}
            </div>
            {!m.isOwner && (
              <fieldset className="mt-3 flex flex-wrap gap-2">
                <legend className="sr-only">{t({ pt: "Áreas", en: "Areas", fr: "Zones" })}</legend>
                {PERMS.map((p) => {
                  const on = !!m.adminPerms?.includes(p);
                  return (
                    <button key={p} type="button" aria-pressed={on} disabled={update.isPending || (on && m.adminPerms!.length === 1)}
                      onClick={() => update.mutate({ id: m.id, body: { perms: toggle(m.adminPerms ?? [], p) } })}
                      className={cn("min-h-9 rounded-full border px-3 text-xs font-semibold", on ? "border-primary bg-brand-100 text-brand-900" : "bg-white text-neutral-600")}>
                      {on ? "✓ " : ""}{t(PERM_INFO[p].label)}
                    </button>
                  );
                })}
              </fieldset>
            )}
          </li>
        ))}
      </ul>

      <form className="space-y-3 rounded-lg border-2 border-primary bg-white p-4" onSubmit={(e) => { e.preventDefault(); setErr(null); add.mutate(); }}>
        <h2 className="font-bold">{t({ pt: "Adicionar à equipa", en: "Add to the team", fr: "Ajouter à l'équipe" })}</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1"><Label htmlFor="st-name">{t({ pt: "Nome", en: "Name", fr: "Nom" })}</Label><Input id="st-name" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} /></div>
          <div className="space-y-1"><Label htmlFor="st-user">{t({ pt: "Nome de utilizador", en: "Username", fr: "Identifiant" })}</Label><Input id="st-user" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })} /></div>
          <div className="space-y-1"><Label htmlFor="st-phone">{t({ pt: "Telefone", en: "Phone", fr: "Téléphone" })}</Label><Input id="st-phone" inputMode="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+2449…" /></div>
          <div className="space-y-1"><Label htmlFor="st-pw">{t({ pt: "Palavra-passe provisória (mín. 12)", en: "Temporary password (min 12)", fr: "Mot de passe provisoire (min 12)" })}</Label><Input id="st-pw" type="text" autoComplete="off" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
        </div>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold">{t({ pt: "Áreas a que tem acesso", en: "Areas they can access", fr: "Zones accessibles" })}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {PERMS.map((p) => (
              <label key={p} className={cn("flex cursor-pointer items-start gap-2 rounded-lg border p-3", form.perms.includes(p) && "border-primary bg-brand-50")}>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[#00a396]" checked={form.perms.includes(p)} onChange={() => setForm({ ...form, perms: toggle(form.perms, p) })} />
                <span><span className="block text-sm font-semibold">{t(PERM_INFO[p].label)}</span><span className="block text-xs text-neutral-600">{t(PERM_INFO[p].desc)}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        {err && <p role="alert" className="text-sm text-red-700">{err}</p>}
        <Button type="submit" disabled={add.isPending || !form.perms.length}>{t({ pt: "Criar conta", en: "Create account", fr: "Créer le compte" })}</Button>
      </form>
    </div>
  );
}
