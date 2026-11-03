import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChevronRight, CircleHelp, Coins, Crown, FileText, Globe, Heart, KeyRound, LayoutDashboard, Loader2, LogOut, MapPin, Pencil, Receipt, Shield, Utensils,
} from "lucide-react";
import { CustomerShell } from "@/components/AppShell";
import { Guard } from "@/components/common";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth, homeFor, type User } from "@/hooks/useAuth";
import { patch, post } from "@/lib/api";
import { useLang, useT, T, type Lang } from "@/lib/i18n";
import { DIETARY, colorFor, initials } from "@/lib/format";
import { cn } from "@/lib/utils";

function Row({ href, icon, label, hint }: { href: string; icon: ReactNode; label: string; hint?: ReactNode }) {
  return (
    <Link href={href} className="flex min-h-[52px] items-center gap-3 px-4 py-3 hover:bg-neutral-50">
      <span className="text-neutral-500">{icon}</span>
      <span className="flex-1 text-sm font-medium">{label}</span>
      {hint}
      <ChevronRight className="h-4 w-4 text-neutral-400" />
    </Link>
  );
}

function EditProfileDialog({ open, onOpenChange, user }: { open: boolean; onOpenChange: (o: boolean) => void; user: User }) {
  const t = useT();
  const { toast } = useToast();
  const { setUser } = useAuth();
  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setFullName(user.fullName); setEmail(user.email ?? ""); setPhone(user.phone); setError(null); } }, [open]);
  const save = useMutation({
    mutationFn: () => patch<{ user: User }>("/api/auth/me", { fullName: fullName.trim(), email: email.trim(), phone: phone.trim() }),
    onSuccess: ({ user: u }) => { setUser(u); onOpenChange(false); toast({ title: t({ pt: "Perfil actualizado", en: "Profile updated", fr: "Profil mis à jour" }) }); },
    onError: (e: Error) => setError(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>{t({ pt: "Editar perfil", en: "Edit profile", fr: "Modifier le profil" })}</DialogTitle></DialogHeader>
        <form id="profile-form" className="space-y-3" onSubmit={(e) => { e.preventDefault(); setError(null); save.mutate(); }}>
          <div className="space-y-1.5">
            <Label htmlFor="pf-name">{t({ pt: "Nome completo", en: "Full name", fr: "Nom complet" })}</Label>
            <Input id="pf-name" value={fullName} minLength={3} maxLength={100} required onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-email">{t({ pt: "Email (opcional)", en: "Email (optional)", fr: "E-mail (facultatif)" })}</Label>
            <Input id="pf-email" type="email" value={email} maxLength={120} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pf-phone">{t({ pt: "Telemóvel", en: "Phone", fr: "Téléphone" })}</Label>
            <Input id="pf-phone" type="tel" value={phone} required onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="+244 9XX XXX XXX" />
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </form>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t(T.cancel)}</Button>
          <Button type="submit" form="profile-form" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t(T.save)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const t = useT();
  const { toast } = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (open) { setCurrent(""); setNext(""); setConfirm(""); setError(null); } }, [open]);
  const save = useMutation({
    mutationFn: () => post("/api/auth/password", { currentPassword: current, newPassword: next }),
    onSuccess: () => { onOpenChange(false); toast({ title: t({ pt: "Palavra-passe alterada", en: "Password changed", fr: "Mot de passe modifié" }) }); },
    onError: (e: Error) => setError(e.message),
  });
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setError(null);
    if (next.length < 8) return setError(t({ pt: "A nova palavra-passe tem de ter pelo menos 8 caracteres.", en: "The new password must be at least 8 characters.", fr: "Au moins 8 caractères." }));
    if (next !== confirm) return setError(t({ pt: "As palavras-passe não coincidem.", en: "Passwords don't match.", fr: "Les mots de passe ne correspondent pas." }));
    save.mutate();
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t({ pt: "Alterar palavra-passe", en: "Change password", fr: "Changer le mot de passe" })}</DialogTitle>
          <DialogDescription>{t({ pt: "Mínimo de 8 caracteres.", en: "At least 8 characters.", fr: "8 caractères minimum." })}</DialogDescription>
        </DialogHeader>
        <form id="pw-form" className="space-y-3" onSubmit={submit}>
          <div className="space-y-1.5">
            <Label htmlFor="pw-cur">{t({ pt: "Palavra-passe actual", en: "Current password", fr: "Mot de passe actuel" })}</Label>
            <Input id="pw-cur" type="password" value={current} required onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-new">{t({ pt: "Nova palavra-passe", en: "New password", fr: "Nouveau mot de passe" })}</Label>
            <Input id="pw-new" type="password" value={next} required onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pw-conf">{t({ pt: "Confirmar nova palavra-passe", en: "Confirm new password", fr: "Confirmer" })}</Label>
            <Input id="pw-conf" type="password" value={confirm} required onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
          </div>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
        </form>
        <DialogFooter className="gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t(T.cancel)}</Button>
          <Button type="submit" form="pw-form" disabled={save.isPending}>{save.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{t(T.save)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ProfileInner() {
  const t = useT();
  const { lang, setLang } = useLang();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user, setUser, logout } = useAuth();
  const u = user!;
  const isCustomer = u.userType === "customer";
  const plusQ = useQuery<{ active: boolean }>({ queryKey: ["/api/plus"], enabled: isCustomer });
  const [editOpen, setEditOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [diet, setDiet] = useState<string[]>(u.dietaryPreferences ?? []);
  useEffect(() => { setDiet(u.dietaryPreferences ?? []); }, [u.dietaryPreferences?.join(",")]);

  const saveProfile = useMutation({
    mutationFn: (body: Partial<Pick<User, "dietaryPreferences">> & { preferredLanguage?: Lang }) => patch<{ user: User }>("/api/auth/me", body),
    onSuccess: ({ user: nu }) => setUser(nu),
    onError: (e: Error) => { setDiet(u.dietaryPreferences ?? []); toast({ variant: "destructive", title: t(T.error), description: e.message }); },
  });

  const toggleDiet = (tag: string) => {
    const next = diet.includes(tag) ? diet.filter((d) => d !== tag) : [...diet, tag];
    setDiet(next);
    saveProfile.mutate({ dietaryPreferences: next });
  };

  const changeLang = (l: Lang) => { setLang(l); saveProfile.mutate({ preferredLanguage: l }); };

  const doLogout = async () => {
    try { await logout(); navigate("/"); } catch (e) { toast({ variant: "destructive", title: t(T.error), description: (e as Error).message }); }
  };

  const panelLabel = u.userType === "supplier" ? t({ pt: "Abrir portal da loja", en: "Open store portal", fr: "Ouvrir le portail" })
    : u.userType === "driver" ? t({ pt: "Abrir app de estafeta", en: "Open rider app", fr: "Ouvrir l'app livreur" })
      : t({ pt: "Abrir painel de administração", en: "Open admin panel", fr: "Ouvrir l'administration" });

  return (
    <div className="space-y-5 px-4 pb-8 pt-4">
      {/* Cabeçalho */}
      <div className="flex items-center gap-4 rounded-2xl border bg-white p-4 shadow-sm">
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-bold text-white" style={{ background: colorFor(u.fullName) }} aria-hidden>{initials(u.fullName)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{u.fullName}</p>
          <p className="truncate text-sm text-neutral-500">{u.phone}</p>
          {u.email && <p className="truncate text-xs text-neutral-500">{u.email}</p>}
          {plusQ.data?.active && <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800"><Crown className="h-3 w-3" />Plus</span>}
        </div>
        <Button variant="outline" size="icon" onClick={() => setEditOpen(true)} aria-label={t({ pt: "Editar perfil", en: "Edit profile", fr: "Modifier le profil" })}><Pencil className="h-4 w-4" /></Button>
      </div>

      {!isCustomer && (
        <Link href={homeFor(u)}><Button className="h-12 w-full rounded-xl"><LayoutDashboard className="mr-2 h-5 w-5" />{panelLabel}</Button></Link>
      )}

      {/* Pontos */}
      {isCustomer && (
        <Link href="/perfil/pontos" className="flex items-center gap-3 rounded-2xl bg-gradient-to-r from-amber-500 to-teal-600 p-4 text-white shadow-sm">
          <Coins className="h-7 w-7" />
          <div className="flex-1">
            <p className="text-2xl font-extrabold leading-none">{u.loyaltyPoints}</p>
            <p className="text-xs text-white/85">{t({ pt: "pontos · convide amigos e ganhe mais", en: "points · invite friends to earn more", fr: "points · invitez des amis" })}</p>
          </div>
          <ChevronRight className="h-5 w-5" />
        </Link>
      )}

      {/* Ligações */}
      <nav className="divide-y overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label={t({ pt: "Conta", en: "Account", fr: "Compte" })}>
        {isCustomer && <Row href="/encomendas" icon={<Receipt className="h-5 w-5" />} label={t({ pt: "Encomendas", en: "Orders", fr: "Commandes" })} />}
        <Row href="/perfil/moradas" icon={<MapPin className="h-5 w-5" />} label={t({ pt: "Moradas", en: "Addresses", fr: "Adresses" })} />
        {isCustomer && <Row href="/favoritos" icon={<Heart className="h-5 w-5" />} label={t({ pt: "Favoritos", en: "Favourites", fr: "Favoris" })} />}
        {isCustomer && <Row href="/perfil/pontos" icon={<Coins className="h-5 w-5" />} label={t({ pt: "Pontos e convites", en: "Points & referrals", fr: "Points et parrainage" })} />}
        {isCustomer && <Row href="/plus" icon={<Crown className="h-5 w-5" />} label="PedeAí Plus"
          hint={plusQ.data?.active ? <span className="text-xs font-semibold text-violet-700">{t({ pt: "Activo", en: "Active", fr: "Actif" })}</span> : undefined} />}
      </nav>

      {/* Preferências */}
      <section className="space-y-4 rounded-2xl border bg-white p-4 shadow-sm">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-bold"><Utensils className="h-4 w-4 text-primary" />{t({ pt: "Preferências alimentares", en: "Dietary preferences", fr: "Préférences alimentaires" })}</h2>
          <p className="mt-0.5 text-xs text-neutral-500">{t({ pt: "Usamos isto para destacar opções adequadas.", en: "We use this to highlight suitable options.", fr: "Pour mettre en avant les options adaptées." })}</p>
          <div className="mt-3 flex flex-wrap gap-2" role="group">
            {Object.entries(DIETARY).map(([tag, d]) => {
              const on = diet.includes(tag);
              return (
                <button key={tag} type="button" aria-pressed={on} onClick={() => toggleDiet(tag)}
                  className={cn("min-h-[40px] rounded-full border px-3 py-1.5 text-sm transition", on ? "border-green-600 bg-green-50 font-medium text-green-800" : "bg-white text-neutral-700 hover:border-neutral-400")}>
                  <span aria-hidden className="mr-1">{d.icon}</span>{t(d)}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex items-center gap-3 border-t pt-4">
          <Globe className="h-4 w-4 text-primary" />
          <Label htmlFor="pf-lang" className="flex-1 text-sm font-bold">{t({ pt: "Idioma", en: "Language", fr: "Langue" })}</Label>
          <Select value={lang} onValueChange={(v) => changeLang(v as Lang)}>
            <SelectTrigger id="pf-lang" className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="pt">Português</SelectItem>
              <SelectItem value="en">English</SelectItem>
              <SelectItem value="fr">Français</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      {/* Segurança e ajuda */}
      <nav className="divide-y overflow-hidden rounded-2xl border bg-white shadow-sm" aria-label={t({ pt: "Ajuda", en: "Help", fr: "Aide" })}>
        <button type="button" onClick={() => setPwOpen(true)} className="flex min-h-[52px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-50">
          <KeyRound className="h-5 w-5 text-neutral-500" />
          <span className="flex-1 text-sm font-medium">{t({ pt: "Alterar palavra-passe", en: "Change password", fr: "Changer le mot de passe" })}</span>
          <ChevronRight className="h-4 w-4 text-neutral-400" />
        </button>
        <Row href="/info/suporte" icon={<CircleHelp className="h-5 w-5" />} label={t({ pt: "Suporte", en: "Support", fr: "Support" })} />
        <Row href="/info/termos" icon={<FileText className="h-5 w-5" />} label={t({ pt: "Termos e condições", en: "Terms & conditions", fr: "Conditions générales" })} />
        <Row href="/info/privacidade" icon={<Shield className="h-5 w-5" />} label={t({ pt: "Privacidade", en: "Privacy", fr: "Confidentialité" })} />
      </nav>

      <Button variant="outline" className="h-12 w-full rounded-xl text-red-600 hover:text-red-700" onClick={doLogout}>
        <LogOut className="mr-2 h-4 w-4" />{t(T.logout)}
      </Button>
      <p className="text-center text-[11px] text-neutral-400">@{u.username}</p>

      <EditProfileDialog open={editOpen} onOpenChange={setEditOpen} user={u} />
      <PasswordDialog open={pwOpen} onOpenChange={setPwOpen} />
    </div>
  );
}

export default function Profile() {
  return (
    <CustomerShell>
      <Guard><ProfileInner /></Guard>
    </CustomerShell>
  );
}
