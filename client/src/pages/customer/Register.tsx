import { useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Eye, EyeOff, AlertCircle, User as UserIcon, Store as StoreIcon, Bike, Gift, Info } from "lucide-react";
import logo from "@/assets/bazzardelivery-logo.svg";
import { CustomerShell, LanguageSwitch } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, homeFor, type User } from "@/hooks/useAuth";
import { post, ApiError } from "@/lib/api";
import { useT, T, type Tr } from "@/lib/i18n";
import { STORE_TYPE } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Meta } from "@/pages/customer/Home";

type AccountType = "customer" | "supplier" | "driver";

/**
 * Pontos de boas-vindas para quem se regista com código de convite.
 * O valor real vem de WELCOME_BONUS_POINTS no servidor (por omissão 100) mas não é exposto em /api/meta.
 */
const WELCOME_POINTS_FALLBACK = 100;

const PHONE_RE = /^\+?[0-9 ]{9,15}$/;
const USERNAME_RE = /^[a-zA-Z0-9_.]+$/;

function Field({ id, label, error, hint, children }: { id: string; label: string; error?: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? <p id={`${id}-err`} className="text-xs text-red-600">{error}</p> : hint ? <p className="text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export default function Register() {
  const t = useT();
  const [, navigate] = useLocation();
  const { setUser } = useAuth();
  const meta = useQuery<Meta & { welcomeBonusPoints?: number }>({ queryKey: ["/api/meta"], staleTime: 5 * 60_000 });

  const sp = new URLSearchParams(window.location.search);
  const [type, setType] = useState<AccountType>("customer");
  const [form, setForm] = useState({
    fullName: "", username: "", phone: "", email: "", password: "", confirm: "", referralCode: sp.get("ref") ?? "",
  });
  const [biz, setBiz] = useState({ name: "", storeType: "restaurant", phone: "", street: "", zone: "", nif: "", description: "" });
  const [terms, setTerms] = useState(false);
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const upd = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const updB = (k: keyof typeof biz) => (e: { target: { value: string } }) => setBiz((b) => ({ ...b, [k]: e.target.value }));

  const welcomePoints = meta.data?.welcomeBonusPoints ?? WELCOME_POINTS_FALLBACK;

  const msg = {
    required: { pt: "Campo obrigatório", en: "Required", fr: "Champ obligatoire" },
    fullName: { pt: "Indique o nome completo (mín. 3 caracteres)", en: "Enter your full name (min. 3 characters)", fr: "Nom complet (min. 3 caractères)" },
    username: { pt: "3–40 caracteres: letras, números, _ e .", en: "3–40 characters: letters, numbers, _ and .", fr: "3–40 caractères : lettres, chiffres, _ et ." },
    phone: { pt: "Número de telemóvel inválido", en: "Invalid phone number", fr: "Numéro de téléphone invalide" },
    email: { pt: "Email inválido", en: "Invalid email", fr: "Email invalide" },
    password: { pt: "Mínimo 8 caracteres", en: "At least 8 characters", fr: "8 caractères minimum" },
    confirm: { pt: "As palavras-passe não coincidem", en: "Passwords don't match", fr: "Les mots de passe ne correspondent pas" },
    terms: { pt: "Tem de aceitar os termos", en: "You must accept the terms", fr: "Vous devez accepter les conditions" },
  } satisfies Record<string, Tr>;

  const validate = () => {
    const e: Record<string, string> = {};
    if (form.fullName.trim().length < 3) e.fullName = t(msg.fullName);
    const u = form.username.trim();
    if (u.length < 3 || u.length > 40 || !USERNAME_RE.test(u)) e.username = t(msg.username);
    if (!PHONE_RE.test(form.phone.trim())) e.phone = t(msg.phone);
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = t(msg.email);
    if (form.password.length < 8) e.password = t(msg.password);
    if (form.confirm !== form.password) e.confirm = t(msg.confirm);
    if (type === "supplier") {
      if (biz.name.trim().length < 2) e["business.name"] = t(msg.required);
      if (biz.phone.trim().length < 9) e["business.phone"] = t(msg.phone);
      if (biz.street.trim().length < 3) e["business.street"] = t(msg.required);
      if (!biz.zone) e["business.zone"] = t(msg.required);
    }
    if (!terms) e.terms = t(msg.terms);
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setApiError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      const body = {
        username: form.username.trim(),
        password: form.password,
        fullName: form.fullName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim(),
        userType: type,
        referralCode: type === "customer" && form.referralCode.trim() ? form.referralCode.trim() : null,
        business: type === "supplier" ? {
          name: biz.name.trim(), storeType: biz.storeType, phone: biz.phone.trim(), street: biz.street.trim(), zone: biz.zone,
          nif: biz.nif.trim() || null, description: biz.description.trim() || null,
        } : undefined,
      };
      const { user } = await post<{ user: User }>("/api/auth/register", body);
      setUser(user);
      const next = sp.get("next");
      const safe = next && next.startsWith("/") && !next.startsWith("//") && user.userType === "customer" ? next : null;
      navigate(safe ?? homeFor(user), { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.errors?.length) {
        const fe: Record<string, string> = {};
        for (const x of err.errors) fe[x.path] = x.message;
        setErrors(fe);
      }
      if (err instanceof ApiError && err.code === "USERNAME_TAKEN") setErrors((e) => ({ ...e, username: err.message }));
      if (err instanceof ApiError && err.code === "REFERRAL_INVALID") setErrors((e) => ({ ...e, referralCode: err.message }));
      setApiError(err instanceof Error ? err.message : t(T.error));
    } finally {
      setBusy(false);
    }
  };

  const types: { id: AccountType; icon: typeof UserIcon; label: Tr; sub: Tr }[] = [
    { id: "customer", icon: UserIcon, label: { pt: "Cliente", en: "Customer", fr: "Client" }, sub: { pt: "Encomendar", en: "Order", fr: "Commander" } },
    { id: "supplier", icon: StoreIcon, label: { pt: "Loja/Restaurante", en: "Store/Restaurant", fr: "Magasin/Restaurant" }, sub: { pt: "Vender", en: "Sell", fr: "Vendre" } },
    { id: "driver", icon: Bike, label: { pt: "Estafeta", en: "Rider", fr: "Livreur" }, sub: { pt: "Entregar", en: "Deliver", fr: "Livrer" } },
  ];

  const err = (k: string) => errors[k];
  const inputCls = (k: string) => cn("h-11 rounded-xl", err(k) && "border-red-400 focus-visible:ring-red-400");

  return (
    <CustomerShell hideNav>
      <div className="px-6 py-6">
        <div className="flex items-center justify-between">
          <Link href="/" aria-label="BazzarDelivery"><img src={logo} alt="BazzarDelivery" className="h-9 w-auto" /></Link>
          <LanguageSwitch />
        </div>

        <h1 className="mt-8 text-3xl font-extrabold tracking-tight text-neutral-900">{t(T.register)}</h1>
        <p className="mt-1 text-neutral-500">{t({ pt: "Junte-se à BazzarDelivery em Luanda.", en: "Join BazzarDelivery in Luanda.", fr: "Rejoignez BazzarDelivery à Luanda." })}</p>

        <form onSubmit={submit} noValidate className="mt-6 space-y-5">
          <fieldset>
            <legend className="mb-2 text-sm font-medium">{t({ pt: "Tipo de conta", en: "Account type", fr: "Type de compte" })}</legend>
            <div className="grid grid-cols-3 gap-2" role="radiogroup">
              {types.map(({ id, icon: Icon, label, sub }) => (
                <button key={id} type="button" role="radio" aria-checked={type === id} onClick={() => setType(id)}
                  className={cn("flex flex-col items-center gap-1 rounded-2xl border-2 px-2 py-3 text-center transition-colors",
                    type === id ? "border-primary bg-orange-50 text-primary" : "border-neutral-200 text-neutral-700 hover:bg-neutral-50")}>
                  <Icon className="h-6 w-6" aria-hidden />
                  <span className="text-xs font-semibold leading-tight">{t(label)}</span>
                  <span className="text-[10px] text-neutral-500">{t(sub)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          {type !== "customer" && (
            <div className="flex items-start gap-2 rounded-xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {type === "driver"
                ? t({ pt: "As contas de estafeta precisam de aprovação. A nossa equipa vai verificar os seus dados e contactá-lo.", en: "Rider accounts need approval. Our team will review your details and contact you.", fr: "Les comptes livreur doivent être approuvés. Notre équipe vérifiera vos informations et vous contactera." })
                : t({ pt: "A sua loja precisa de aprovação antes de aparecer na app. Pode preparar o menu entretanto.", en: "Your store needs approval before it appears in the app. You can set up your menu meanwhile.", fr: "Votre magasin doit être approuvé avant d'apparaître dans l'app. Vous pouvez préparer le menu en attendant." })}
            </div>
          )}

          {apiError && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {apiError}
            </div>
          )}

          <Field id="fullName" label={t({ pt: "Nome completo", en: "Full name", fr: "Nom complet" })} error={err("fullName")}>
            <Input id="fullName" autoComplete="name" value={form.fullName} onChange={upd("fullName")} className={inputCls("fullName")} aria-invalid={!!err("fullName")} />
          </Field>
          <Field id="username" label={t({ pt: "Nome de utilizador", en: "Username", fr: "Nom d'utilisateur" })} error={err("username")}>
            <Input id="username" autoComplete="username" autoCapitalize="none" value={form.username} onChange={upd("username")} className={inputCls("username")} aria-invalid={!!err("username")} />
          </Field>
          <Field id="phone" label={t({ pt: "Telemóvel", en: "Phone", fr: "Téléphone" })} error={err("phone")} hint={t({ pt: "Ex.: +244 923 456 789", en: "E.g. +244 923 456 789", fr: "Ex. : +244 923 456 789" })}>
            <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+244 9XX XXX XXX" value={form.phone} onChange={upd("phone")} className={inputCls("phone")} aria-invalid={!!err("phone")} />
          </Field>
          <Field id="email" label={`${t({ pt: "Email", en: "Email", fr: "Email" })} (${t({ pt: "opcional", en: "optional", fr: "facultatif" })})`} error={err("email")}>
            <Input id="email" type="email" autoComplete="email" value={form.email} onChange={upd("email")} className={inputCls("email")} aria-invalid={!!err("email")} />
          </Field>
          <Field id="password" label={t({ pt: "Palavra-passe", en: "Password", fr: "Mot de passe" })} error={err("password")} hint={t(msg.password)}>
            <div className="relative">
              <Input id="password" type={show ? "text" : "password"} autoComplete="new-password" value={form.password} onChange={upd("password")} className={cn(inputCls("password"), "pr-12")} aria-invalid={!!err("password")} />
              <button type="button" onClick={() => setShow((s) => !s)}
                aria-label={show ? t({ pt: "Ocultar palavra-passe", en: "Hide password", fr: "Masquer" }) : t({ pt: "Mostrar palavra-passe", en: "Show password", fr: "Afficher" })}
                className="absolute right-1 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-100">
                {show ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </Field>
          <Field id="confirm" label={t({ pt: "Confirmar palavra-passe", en: "Confirm password", fr: "Confirmer le mot de passe" })} error={err("confirm")}>
            <Input id="confirm" type={show ? "text" : "password"} autoComplete="new-password" value={form.confirm} onChange={upd("confirm")} className={inputCls("confirm")} aria-invalid={!!err("confirm")} />
          </Field>

          {type === "customer" && (
            <Field id="referralCode" label={`${t({ pt: "Código de convite", en: "Referral code", fr: "Code de parrainage" })} (${t({ pt: "opcional", en: "optional", fr: "facultatif" })})`} error={err("referralCode")}>
              <Input id="referralCode" autoCapitalize="characters" value={form.referralCode} onChange={upd("referralCode")} className={cn(inputCls("referralCode"), "uppercase")} />
              {form.referralCode.trim() && !err("referralCode") && (
                <p className="flex items-center gap-1.5 text-xs font-medium text-green-700">
                  <Gift className="h-3.5 w-3.5" aria-hidden />
                  {t({ pt: `Ganhe ${welcomePoints} pontos de boas-vindas`, en: `Earn ${welcomePoints} welcome points`, fr: `Gagnez ${welcomePoints} points de bienvenue` })}
                </p>
              )}
            </Field>
          )}

          {type === "supplier" && (
            <fieldset className="space-y-4 rounded-2xl border p-4">
              <legend className="px-1 text-sm font-semibold">{t({ pt: "Dados do negócio", en: "Business details", fr: "Informations de l'entreprise" })}</legend>
              <Field id="b-name" label={t({ pt: "Nome da loja", en: "Store name", fr: "Nom du magasin" })} error={err("business.name")}>
                <Input id="b-name" value={biz.name} onChange={updB("name")} className={inputCls("business.name")} />
              </Field>
              <Field id="b-type" label={t({ pt: "Tipo de loja", en: "Store type", fr: "Type de magasin" })} error={err("business.storeType")}>
                <Select value={biz.storeType} onValueChange={(v) => setBiz((b) => ({ ...b, storeType: v }))}>
                  <SelectTrigger id="b-type" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(STORE_TYPE).map(([k, v]) => <SelectItem key={k} value={k}>{v.icon} {t(v)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="b-phone" label={t({ pt: "Telefone da loja", en: "Store phone", fr: "Téléphone du magasin" })} error={err("business.phone")}>
                <Input id="b-phone" type="tel" inputMode="tel" placeholder="+244 2XX XXX XXX" value={biz.phone} onChange={updB("phone")} className={inputCls("business.phone")} />
              </Field>
              <Field id="b-street" label={t({ pt: "Morada (rua e número)", en: "Address (street)", fr: "Adresse (rue)" })} error={err("business.street")}>
                <Input id="b-street" autoComplete="street-address" value={biz.street} onChange={updB("street")} className={inputCls("business.street")} />
              </Field>
              <Field id="b-zone" label={t({ pt: "Zona / bairro", en: "Area / neighbourhood", fr: "Quartier" })} error={err("business.zone")}>
                <Select value={biz.zone} onValueChange={(v) => setBiz((b) => ({ ...b, zone: v }))}>
                  <SelectTrigger id="b-zone" className={cn("h-11 rounded-xl", err("business.zone") && "border-red-400")}>
                    <SelectValue placeholder={t({ pt: "Escolha a zona", en: "Choose area", fr: "Choisir le quartier" })} />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    {(meta.data?.zones ?? []).map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field id="b-nif" label={`NIF (${t({ pt: "opcional", en: "optional", fr: "facultatif" })})`} error={err("business.nif")}>
                <Input id="b-nif" inputMode="numeric" value={biz.nif} onChange={updB("nif")} className={inputCls("business.nif")} />
              </Field>
              <Field id="b-desc" label={`${t({ pt: "Descrição", en: "Description", fr: "Description" })} (${t({ pt: "opcional", en: "optional", fr: "facultatif" })})`} error={err("business.description")}>
                <Textarea id="b-desc" rows={3} maxLength={500} value={biz.description} onChange={updB("description")} className="rounded-xl" />
              </Field>
            </fieldset>
          )}

          <div className="space-y-1">
            <div className="flex items-start gap-3">
              <Checkbox id="terms" checked={terms} onCheckedChange={(v) => setTerms(v === true)} className="mt-0.5" aria-invalid={!!err("terms")} />
              <Label htmlFor="terms" className="text-sm font-normal leading-snug text-neutral-700">
                {t({ pt: "Li e aceito os", en: "I have read and accept the", fr: "J'ai lu et j'accepte les" })}{" "}
                <Link href="/info/termos" className="font-medium text-primary underline">{t({ pt: "Termos e Condições", en: "Terms and Conditions", fr: "Conditions générales" })}</Link>{" "}
                {t({ pt: "e a", en: "and the", fr: "et la" })}{" "}
                <Link href="/info/privacidade" className="font-medium text-primary underline">{t({ pt: "Política de Privacidade", en: "Privacy Policy", fr: "Politique de confidentialité" })}</Link>.
              </Label>
            </div>
            {err("terms") && <p className="pl-7 text-xs text-red-600">{err("terms")}</p>}
          </div>

          <Button type="submit" className="h-12 w-full rounded-full text-base" disabled={busy}>
            {busy ? t(T.loading) : t(T.register)}
          </Button>
        </form>

        <p className="mt-6 pb-4 text-center text-sm text-neutral-600">
          {t({ pt: "Já tem conta?", en: "Already have an account?", fr: "Déjà un compte ?" })}{" "}
          <Link href="/entrar" className="font-semibold text-primary hover:underline">{t(T.login)}</Link>
        </p>
      </div>
    </CustomerShell>
  );
}
