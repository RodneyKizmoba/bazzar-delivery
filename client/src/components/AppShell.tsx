import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Home, Search, ShoppingBag, Receipt, User, ChevronLeft } from "lucide-react";
import mark from "@/assets/pedeja-mark.png";
import { useCart } from "@/context/CartContext";
import { useAuth } from "@/hooks/useAuth";
import { useLang, useT, type Lang } from "@/lib/i18n";
import { cn } from "@/lib/utils";

/** Logótipo PedeJá: símbolo + nome (compacto, para cabeçalhos). */
export function BrandLogo({ size = "md" }: { size?: "sm" | "md" }) {
  return (
    <span className="flex items-center gap-2">
      <img src={mark} alt="" className={size === "sm" ? "h-7 w-7" : "h-9 w-9"} />
      <span className={cn("font-extrabold leading-none tracking-tight text-on-brand", size === "sm" ? "text-lg" : "text-[22px]")}>PedeJá</span>
    </span>
  );
}

export function LanguageSwitch({ className }: { className?: string }) {
  const { lang, setLang } = useLang();
  return (
    <select
      aria-label="Idioma / Language"
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      className={cn("rounded-md border bg-white px-1.5 py-1 text-xs", className)}
    >
      <option value="pt">PT</option>
      <option value="en">EN</option>
      <option value="fr">FR</option>
    </select>
  );
}

/** Cabeçalho simples com botão voltar (para páginas internas). */
export function TopBar({ title, back, right }: { title: string; back?: string | true; right?: ReactNode }) {
  const [, navigate] = useLocation();
  const t = useT();
  return (
    <div className="sticky top-0 z-20 flex items-center gap-2 border-b bg-white/95 px-2 py-2 backdrop-blur">
      {back && (
        <button
          className="rounded-full p-2 hover:bg-neutral-100"
          aria-label={t({ pt: "Voltar", en: "Back", fr: "Retour" })}
          onClick={() => (back === true ? window.history.length > 1 ? window.history.back() : navigate("/") : navigate(back))}
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="flex-1 truncate text-base font-semibold">{title}</h1>
      {right}
    </div>
  );
}

/** Layout das páginas de cliente: largura de telemóvel, cabeçalho e navegação inferior. */
export function CustomerShell({ children, hideHeader, hideNav }: { children: ReactNode; hideHeader?: boolean; hideNav?: boolean }) {
  const [location] = useLocation();
  const { itemCount } = useCart();
  const { user } = useAuth();
  const t = useT();

  const nav = [
    { href: "/", icon: Home, label: t({ pt: "Início", en: "Home", fr: "Accueil" }) },
    { href: "/pesquisa", icon: Search, label: t({ pt: "Pesquisar", en: "Search", fr: "Rechercher" }) },
    { href: "/carrinho", icon: ShoppingBag, label: t({ pt: "Carrinho", en: "Cart", fr: "Panier" }), badge: itemCount },
    { href: "/encomendas", icon: Receipt, label: t({ pt: "Encomendas", en: "Orders", fr: "Commandes" }) },
    { href: user ? "/perfil" : "/entrar", icon: User, label: user ? t({ pt: "Conta", en: "Account", fr: "Compte" }) : t({ pt: "Entrar", en: "Log in", fr: "Connexion" }) },
  ];

  return (
    <div className="mx-auto min-h-screen max-w-md bg-white shadow-sm">
      {!hideHeader && (
        <header className="sticky top-0 z-30 flex items-center justify-between border-b bg-white/95 px-4 py-2.5 backdrop-blur">
          <Link href="/" className="flex items-center gap-2" aria-label="PedeJá">
            <BrandLogo />
          </Link>
          <div className="flex items-center gap-2">
            {user && user.userType !== "customer" && (
              <Link href={user.userType === "supplier" ? "/parceiro" : user.userType === "driver" ? "/estafeta" : "/admin"}
                className="rounded-full bg-neutral-900 px-3 py-1 text-xs font-medium text-white">
                {user.userType === "supplier" ? t({ pt: "Portal da loja", en: "Store portal", fr: "Portail" })
                  : user.userType === "driver" ? t({ pt: "App estafeta", en: "Rider app", fr: "Livreur" }) : "Admin"}
              </Link>
            )}
            <LanguageSwitch />
          </div>
        </header>
      )}
      <main className={cn(!hideNav && "pb-20")}>{children}</main>
      {!hideNav && (
        <nav className="fixed bottom-0 left-0 right-0 z-30 border-t bg-white" aria-label="Navegação principal">
          <div className="mx-auto flex h-16 max-w-md items-center justify-around">
            {nav.map(({ href, icon: Icon, label, badge }) => {
              const active = href === "/" ? location === "/" : location.startsWith(href);
              return (
                <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 px-2 text-[11px]", active ? "text-primary font-semibold" : "text-neutral-500")}>
                  <span className="relative">
                    <Icon className="h-5 w-5" />
                    {!!badge && (
                      <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-on-brand">{badge}</span>
                    )}
                  </span>
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </div>
  );
}

/** Layout de painel (parceiro, estafeta, admin): mais largo, com navegação em separadores. */
export function PanelShell({ title, tabs, children }: { title: string; tabs: { href: string; label: string }[]; children: ReactNode }) {
  const [location] = useLocation();
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const t = useT();
  return (
    <div className="min-h-screen bg-neutral-50">
      <header className="sticky top-0 z-30 border-b bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2.5">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" aria-label="PedeJá"><BrandLogo size="sm" /></Link>
            <span className="truncate font-semibold text-neutral-800">{title}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-sm text-neutral-500 sm:inline">{user?.fullName}</span>
            <LanguageSwitch />
            <button className="rounded-md border px-2 py-1 text-xs" onClick={async () => { await logout(); navigate("/entrar"); }}>
              {t({ pt: "Sair", en: "Log out", fr: "Déconnexion" })}
            </button>
          </div>
        </div>
        <nav className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-2 scrollbar-hide">
          {tabs.map((tab) => {
            const active = location === tab.href;
            return (
              <Link key={tab.href} href={tab.href}
                className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-primary text-primary font-semibold" : "border-transparent text-neutral-600 hover:text-neutral-900")}>
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="mx-auto max-w-6xl p-4">{children}</main>
    </div>
  );
}
