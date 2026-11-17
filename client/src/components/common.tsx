import type { ReactNode } from "react";
import { Link, Redirect } from "wouter";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth, type User } from "@/hooks/useAuth";
import { useT, T, type Tr } from "@/lib/i18n";
import { ORDER_STATUS, STATUS_COLOR, DIETARY, colorFor, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

export function Loading({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-neutral-500" role="status">
      <Loader2 className="h-5 w-5 animate-spin" /> <span>{label ?? t(T.loading)}</span>
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const t = useT();
  const msg = error instanceof Error ? error.message : t(T.error);
  return (
    <div className="flex flex-col items-center gap-3 py-12 px-6 text-center">
      <AlertCircle className="h-8 w-8 text-red-500" />
      <p className="text-sm text-neutral-700">{msg}</p>
      {onRetry && <Button variant="outline" size="sm" onClick={onRetry}>{t(T.retry)}</Button>}
    </div>
  );
}

export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 px-6 text-center">
      {icon && <div className="text-4xl mb-1">{icon}</div>}
      <p className="font-semibold text-neutral-800">{title}</p>
      {text && <p className="text-sm text-neutral-500 max-w-xs">{text}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = useT();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STATUS_COLOR[status] ?? "bg-neutral-100", className)}>
      {ORDER_STATUS[status] ? t(ORDER_STATUS[status]) : status}
    </span>
  );
}

export function DietaryBadges({ tags, small }: { tags: string[]; small?: boolean }) {
  const t = useT();
  if (!tags?.length) return null;
  return (
    <div className="flex flex-wrap gap-1">
      {tags.map((tag) => DIETARY[tag] && (
        <span key={tag} className={cn("inline-flex items-center gap-1 rounded-full bg-green-50 text-green-800 border border-green-200", small ? "px-1.5 text-[10px]" : "px-2 py-0.5 text-xs")}>
          <span aria-hidden>{DIETARY[tag].icon}</span>{t(DIETARY[tag])}
        </span>
      ))}
    </div>
  );
}

/** Logótipo/capa: imagem se existir, senão bloco colorido com iniciais. */
export function StoreImage({ name, url, className, rounded = "rounded-lg" }: { name: string; url?: string | null; className?: string; rounded?: string }) {
  if (url) return <img src={url} alt="" className={cn("object-cover", rounded, className)} loading="lazy" />;
  return (
    <div className={cn("flex items-center justify-center text-white font-bold", rounded, className)} style={{ background: colorFor(name) }} aria-hidden>
      {initials(name)}
    </div>
  );
}

/** Protege uma página por tipo de conta. Redirecciona para login se não houver sessão. */
export function Guard({ roles, children }: { roles?: User["userType"][]; children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const t = useT();
  if (isLoading) return <Loading />;
  if (!user) {
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    return <Redirect to={`/entrar?next=${next}`} />;
  }
  if (roles && !roles.includes(user.userType)) {
    return <EmptyState icon="🔒" title={t({ pt: "Sem acesso", en: "No access", fr: "Accès refusé" })}
      text={t({ pt: "Esta área não está disponível para a sua conta.", en: "This area isn't available for your account.", fr: "Cette zone n'est pas disponible pour votre compte." })}
      action={<Link href="/"><Button variant="outline">{t({ pt: "Ir para o início", en: "Go home", fr: "Accueil" })}</Button></Link>} />;
  }
  if (!user.isApproved) {
    return <EmptyState icon="⏳" title={t({ pt: "Conta a aguardar aprovação", en: "Account awaiting approval", fr: "Compte en attente d'approbation" })}
      text={t({ pt: "A nossa equipa vai verificar os seus dados e activar a conta em breve.", en: "Our team will review your details and activate your account soon.", fr: "Notre équipe va vérifier vos informations et activer votre compte bientôt." })} />;
  }
  return <>{children}</>;
}

export function PageTitle({ title, subtitle, right }: { title: string | Tr; subtitle?: string; right?: ReactNode }) {
  const t = useT();
  return (
    <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
      <div>
        <h1 className="text-xl font-bold text-neutral-900">{typeof title === "string" ? title : t(title)}</h1>
        {subtitle && <p className="text-sm text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {right}
    </div>
  );
}
