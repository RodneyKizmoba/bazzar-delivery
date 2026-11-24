import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { post } from "@/lib/api";
import { useAuth, type User } from "@/hooks/useAuth";
import { useT } from "@/lib/i18n";

/** Activar a verificação em dois passos: ler o QR com a app, confirmar um código, guardar os códigos de recuperação. */
export function TwoFactorSetup() {
  const t = useT();
  const { setUser } = useAuth();
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [pendingUser, setPendingUser] = useState<User | null>(null);
  const [saved, setSaved] = useState(false);
  const setup = useMutation({ mutationFn: () => post<{ qr: string; secret: string }>("/api/auth/2fa/setup") });
  const enable = useMutation({
    mutationFn: () => post<{ user: User; recoveryCodes: string[] }>("/api/auth/2fa/enable", { code: code.trim() }),
    onSuccess: (r) => { setCodes(r.recoveryCodes); setPendingUser(r.user); },
    onError: (e: Error) => setErr(e.message),
  });

  if (codes) {
    return (
      <section className="mx-auto max-w-lg space-y-4 rounded-xl border-2 border-primary bg-white p-6">
        <h1 className="text-xl font-bold">✅ {t({ pt: "Verificação em dois passos activa", en: "Two-step verification is on", fr: "Validation en deux étapes activée" })}</h1>
        <p className="text-sm text-neutral-700">{t({ pt: "Guarde estes códigos de recuperação num sítio seguro (papel, cofre de palavras-passe). Cada um serve uma vez, se perder o telemóvel. Não os voltamos a mostrar.", en: "Keep these recovery codes somewhere safe (paper, password manager). Each works once if you lose your phone. We won't show them again.", fr: "Conservez ces codes de récupération en lieu sûr. Chacun sert une fois si vous perdez votre téléphone. Ils ne seront plus affichés." })}</p>
        <ul className="grid grid-cols-2 gap-2 rounded-lg bg-neutral-50 p-3 font-mono text-sm" aria-label={t({ pt: "Códigos de recuperação", en: "Recovery codes", fr: "Codes de récupération" })}>
          {codes.map((c) => <li key={c}>{c}</li>)}
        </ul>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigator.clipboard?.writeText(codes.join("\n")).catch(() => {})}>{t({ pt: "Copiar", en: "Copy", fr: "Copier" })}</Button>
          <Button variant="outline" onClick={() => window.print()}>{t({ pt: "Imprimir", en: "Print", fr: "Imprimer" })}</Button>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{t({ pt: "Guardei os códigos", en: "I've saved the codes", fr: "J'ai enregistré les codes" })}</label>
        <Button className="w-full" disabled={!saved} onClick={() => pendingUser && setUser(pendingUser)}>{t({ pt: "Continuar para o portal", en: "Continue to the portal", fr: "Continuer vers le portail" })}</Button>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-lg space-y-4 rounded-xl border-2 border-primary bg-white p-6">
      <h1 className="text-xl font-bold">🔐 {t({ pt: "Proteja a sua conta de admin", en: "Protect your admin account", fr: "Protégez votre compte admin" })}</h1>
      <p className="text-sm text-neutral-700">{t({ pt: "A equipa PedeJá entra sempre com a palavra-passe e um código do telemóvel. Assim, mesmo que alguém descubra a palavra-passe, não consegue entrar.", en: "The PedeJá team always logs in with a password and a code from their phone, so a stolen password alone isn't enough.", fr: "L'équipe PedeJá se connecte toujours avec un mot de passe et un code du téléphone : un mot de passe volé ne suffit pas." })}</p>
      <ol className="list-decimal space-y-1 pl-5 text-sm text-neutral-700">
        <li>{t({ pt: "Instale Google Authenticator ou Microsoft Authenticator no telemóvel.", en: "Install Google Authenticator or Microsoft Authenticator on your phone.", fr: "Installez Google Authenticator ou Microsoft Authenticator." })}</li>
        <li>{t({ pt: "Na app, toque em + e leia o código QR.", en: "In the app, tap + and scan the QR code.", fr: "Dans l'app, touchez + et scannez le QR code." })}</li>
        <li>{t({ pt: "Escreva aqui o código de 6 dígitos que aparece.", en: "Type the 6-digit code it shows.", fr: "Saisissez le code à 6 chiffres affiché." })}</li>
      </ol>
      {!setup.data ? (
        <Button className="w-full" disabled={setup.isPending} onClick={() => setup.mutate()}>{t({ pt: "Mostrar código QR", en: "Show QR code", fr: "Afficher le QR code" })}</Button>
      ) : (
        <>
          <div className="flex flex-col items-center gap-2">
            <img src={setup.data.qr} alt={t({ pt: "Código QR para a app autenticadora", en: "QR code for the authenticator app", fr: "QR code pour l'app d'authentification" })} className="h-52 w-52 rounded-lg border" />
            <p className="text-center text-xs text-neutral-500">{t({ pt: "Não consegue ler? Escreva esta chave na app:", en: "Can't scan? Enter this key in the app:", fr: "Impossible de scanner ? Saisissez cette clé :" })}<br /><code className="select-all font-mono text-sm text-neutral-800">{setup.data.secret}</code></p>
          </div>
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); setErr(null); enable.mutate(); }}>
            <Label htmlFor="otp-setup">{t({ pt: "Código de 6 dígitos", en: "6-digit code", fr: "Code à 6 chiffres" })}</Label>
            <Input id="otp-setup" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="h-14 text-center font-mono text-2xl tracking-[0.4em]"
              aria-invalid={!!err} aria-describedby={err ? "otp-err" : undefined} />
            {err && <p id="otp-err" role="alert" className="text-sm text-red-700">{err}</p>}
            <Button type="submit" className="w-full" disabled={code.length !== 6 || enable.isPending}>{t({ pt: "Activar", en: "Turn on", fr: "Activer" })}</Button>
          </form>
        </>
      )}
    </section>
  );
}
