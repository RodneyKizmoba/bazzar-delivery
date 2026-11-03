import { useState, type FormEvent } from "react";
import { Link, useLocation } from "wouter";
import { Eye, EyeOff, ChevronDown, AlertCircle } from "lucide-react";
import logo from "@/assets/bazzardelivery-logo.svg";
import { CustomerShell, LanguageSwitch } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useAuth, homeFor } from "@/hooks/useAuth";
import { useT, T } from "@/lib/i18n";

/** Só aceita caminhos internos (evita redireccionamentos abertos). */
export function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get("next");
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : null;
}

const DEMO = [
  { u: "cliente", p: "Cliente#2026", role: { pt: "Cliente", en: "Customer", fr: "Client" } },
  { u: "loja", p: "Loja#2026demo", role: { pt: "Loja", en: "Store", fr: "Magasin" } },
  { u: "estafeta", p: "Estafeta#2026", role: { pt: "Estafeta", en: "Rider", fr: "Livreur" } },
  { u: "admin", p: "Admin#2026demo", role: { pt: "Admin", en: "Admin", fr: "Admin" } },
];

export default function Login() {
  const t = useT();
  const [, navigate] = useLocation();
  const { login } = useAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) {
      setError(t({ pt: "Indique o nome de utilizador e a palavra-passe.", en: "Enter your username and password.", fr: "Saisissez votre identifiant et votre mot de passe." }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const user = await login(username.trim(), password);
      navigate(safeNext() ?? homeFor(user), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : t(T.error));
    } finally {
      setBusy(false);
    }
  };

  const next = safeNext();

  return (
    <CustomerShell hideNav>
      <div className="flex min-h-screen flex-col px-6 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="BazzarDelivery"><img src={logo} alt="BazzarDelivery" className="h-9 w-auto" /></Link>
          <LanguageSwitch />
        </div>

        <div className="mt-10">
          <h1 className="text-3xl font-extrabold tracking-tight text-neutral-900">{t({ pt: "Bem-vindo de volta", en: "Welcome back", fr: "Bon retour" })}</h1>
          <p className="mt-1 text-neutral-500">{t({ pt: "Entre para encomendar em Luanda.", en: "Log in to order across Luanda.", fr: "Connectez-vous pour commander à Luanda." })}</p>
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {error}
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="username">{t({ pt: "Nome de utilizador", en: "Username", fr: "Nom d'utilisateur" })}</Label>
            <Input id="username" autoComplete="username" autoCapitalize="none" autoCorrect="off" value={username}
              onChange={(e) => setUsername(e.target.value)} className="h-12 rounded-xl" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">{t({ pt: "Palavra-passe", en: "Password", fr: "Mot de passe" })}</Label>
            <div className="relative">
              <Input id="password" type={show ? "text" : "password"} autoComplete="current-password" value={password}
                onChange={(e) => setPassword(e.target.value)} className="h-12 rounded-xl pr-12" />
              <button type="button" onClick={() => setShow((s) => !s)}
                aria-label={show ? t({ pt: "Ocultar palavra-passe", en: "Hide password", fr: "Masquer le mot de passe" }) : t({ pt: "Mostrar palavra-passe", en: "Show password", fr: "Afficher le mot de passe" })}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>
          <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={busy}>
            {busy ? t(T.loading) : t(T.login)}
          </Button>
        </form>

        <p className="mt-6 text-center text-sm text-neutral-600">
          {t({ pt: "Ainda não tem conta?", en: "Don't have an account?", fr: "Pas encore de compte ?" })}{" "}
          <Link href={next ? `/registar?next=${encodeURIComponent(next)}` : "/registar"} className="font-semibold text-primary hover:underline">{t(T.register)}</Link>
        </p>

        {import.meta.env.DEV && (
          <Collapsible className="mt-8 rounded-xl border border-dashed bg-neutral-50 p-3">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-sm font-medium text-neutral-700">
              {t({ pt: "Contas de demonstração", en: "Demo accounts", fr: "Comptes de démonstration" })}
              <ChevronDown className="h-4 w-4" aria-hidden />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-1.5">
              {DEMO.map((d) => (
                <button key={d.u} type="button" onClick={() => { setUsername(d.u); setPassword(d.p); setError(null); }}
                  className="flex w-full items-center justify-between rounded-lg bg-white px-3 py-2 text-left text-xs hover:bg-orange-50">
                  <span className="font-semibold">{t(d.role)}</span>
                  <code className="text-neutral-600">{d.u} / {d.p}</code>
                </button>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        <div className="mt-auto flex justify-center gap-4 pt-10 text-xs text-neutral-500">
          <Link href="/info/termos" className="hover:underline">{t({ pt: "Termos", en: "Terms", fr: "Conditions" })}</Link>
          <Link href="/info/privacidade" className="hover:underline">{t({ pt: "Privacidade", en: "Privacy", fr: "Confidentialité" })}</Link>
          <Link href="/info/suporte" className="hover:underline">{t({ pt: "Ajuda", en: "Help", fr: "Aide" })}</Link>
        </div>
      </div>
    </CustomerShell>
  );
}
