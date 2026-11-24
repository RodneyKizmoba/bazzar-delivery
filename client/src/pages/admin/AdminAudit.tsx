import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AdminPage } from "./AdminDashboard";
import { Loading, ErrorState } from "@/components/common";
import { Input } from "@/components/ui/input";
import { useLang, useT, type Tr } from "@/lib/i18n";
import { dateTime } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Entry { id: number; userId: number | null; username: string | null; action: string; targetType: string | null; targetId: string | null; details: Record<string, unknown> | null; status: number | null; ip: string | null; userAgent: string | null; createdAt: string }

const LOGIN: Record<string, Tr> = {
  "login.ok": { pt: "Entrou", en: "Logged in", fr: "Connexion" },
  "login.ok_2fa": { pt: "Entrou (com código)", en: "Logged in (with code)", fr: "Connexion (avec code)" },
  "login.ok_recovery_code": { pt: "Entrou com código de recuperação", en: "Logged in with recovery code", fr: "Connexion avec code de récupération" },
  "login.password_ok": { pt: "Palavra-passe certa, à espera do código", en: "Password OK, waiting for code", fr: "Mot de passe OK, en attente du code" },
  "login.fail": { pt: "Palavra-passe errada", en: "Wrong password", fr: "Mauvais mot de passe" },
  "login.2fa_fail": { pt: "Código errado", en: "Wrong code", fr: "Mauvais code" },
  "login.blocked_ip": { pt: "Bloqueado: ligação não autorizada", en: "Blocked: connection not allowed", fr: "Bloqué : connexion non autorisée" },
  "2fa.enabled": { pt: "Activou a verificação em dois passos", en: "Turned on two-step verification", fr: "Validation en deux étapes activée" },
};

/** Tudo o que a equipa do admin faz: quem, o quê, quando e de onde (só o dono vê). */
export default function AdminAudit() {
  return <AdminPage><Log /></AdminPage>;
}

function Log() {
  const t = useT();
  const { lang } = useLang();
  const [q, setQ] = useState("");
  const query = useQuery<{ entries: Entry[] }>({ queryKey: [`/api/admin/audit${q.trim() ? `?q=${encodeURIComponent(q.trim())}` : ""}`] });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h1 className="text-xl font-bold">{t({ pt: "Registo de actividade", en: "Activity log", fr: "Journal d'activité" })}</h1>
          <p className="text-sm text-neutral-600">{t({ pt: "Entradas na administração e tudo o que a equipa altera. Palavras-passe, códigos e contas bancárias nunca aparecem.", en: "Admin logins and every change the team makes. Passwords, codes and bank accounts are never shown.", fr: "Connexions admin et toutes les modifications de l'équipe. Mots de passe, codes et comptes bancaires ne sont jamais affichés." })}</p>
        </div>
        <Input aria-label={t({ pt: "Procurar", en: "Search", fr: "Rechercher" })} placeholder={t({ pt: "Procurar pessoa ou acção…", en: "Search person or action…", fr: "Chercher personne ou action…" })} value={q} onChange={(e) => setQ(e.target.value)} className="w-64" />
      </div>
      {query.isLoading ? <Loading /> : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} /> : (
        <div className="overflow-x-auto rounded-lg border bg-white">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-left text-xs text-neutral-500">
              <tr><th className="p-2">{t({ pt: "Quando", en: "When", fr: "Quand" })}</th><th className="p-2">{t({ pt: "Quem", en: "Who", fr: "Qui" })}</th><th className="p-2">{t({ pt: "O quê", en: "What", fr: "Quoi" })}</th><th className="p-2">{t({ pt: "Resultado", en: "Result", fr: "Résultat" })}</th><th className="p-2">{t({ pt: "De onde", en: "From", fr: "D'où" })}</th></tr>
            </thead>
            <tbody>
              {query.data!.entries.map((e) => {
                const failed = (e.status ?? 200) >= 400 || /fail|blocked/.test(e.action);
                return (
                  <tr key={e.id} className="border-t align-top">
                    <td className="whitespace-nowrap p-2 text-xs">{dateTime(e.createdAt, lang)}</td>
                    <td className="p-2 font-medium">{e.username ?? "—"}</td>
                    <td className="p-2">
                      {LOGIN[e.action] ? t(LOGIN[e.action]) : <code className="text-xs">{e.action}</code>}
                      {e.details && Object.keys(e.details).length > 0 && <details className="mt-1"><summary className="cursor-pointer text-xs text-brand-800">{t({ pt: "detalhes", en: "details", fr: "détails" })}</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap text-[11px] text-neutral-600">{JSON.stringify(e.details, null, 1)}</pre></details>}
                    </td>
                    <td className={cn("p-2 text-xs font-semibold", failed ? "text-red-700" : "text-green-700")}>{failed ? t({ pt: "falhou", en: "failed", fr: "échec" }) : "ok"}{e.status ? ` (${e.status})` : ""}</td>
                    <td className="p-2 text-xs text-neutral-600">{e.ip ?? "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
