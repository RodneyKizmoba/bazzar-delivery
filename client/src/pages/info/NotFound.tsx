import { Link } from "wouter";
import { CustomerShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

export default function NotFound() {
  const t = useT();
  return (
    <CustomerShell>
      <div className="flex flex-col items-center px-6 py-20 text-center">
        <p className="text-6xl" aria-hidden>🛵💨</p>
        <p className="mt-6 text-5xl font-extrabold text-primary">404</p>
        <h1 className="mt-2 text-xl font-bold text-neutral-900">{t({ pt: "Página não encontrada", en: "Page not found", fr: "Page introuvable" })}</h1>
        <p className="mt-1 max-w-xs text-sm text-neutral-500">
          {t({ pt: "O estafeta procurou por todo o lado, mas esta página não existe.", en: "Our rider looked everywhere, but this page doesn't exist.", fr: "Notre livreur a cherché partout, mais cette page n'existe pas." })}
        </p>
        <div className="mt-6 flex gap-2">
          <Link href="/"><Button>{t({ pt: "Ir para o início", en: "Go home", fr: "Accueil" })}</Button></Link>
          <Link href="/info/suporte"><Button variant="outline">{t({ pt: "Ajuda", en: "Help", fr: "Aide" })}</Button></Link>
        </div>
      </div>
    </CustomerShell>
  );
}
