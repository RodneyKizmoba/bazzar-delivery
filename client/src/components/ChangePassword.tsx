import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { post } from "@/lib/api";
import { useT } from "@/lib/i18n";

/** Mudar a própria palavra-passe (termina as outras sessões abertas). */
export function ChangePassword({ minLength = 8 }: { minLength?: number }) {
  const t = useT();
  const { toast } = useToast();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation({
    mutationFn: () => post("/api/auth/password", { currentPassword: cur, newPassword: next }),
    onSuccess: () => { setCur(""); setNext(""); setErr(null); toast({ title: t({ pt: "Palavra-passe alterada", en: "Password changed", fr: "Mot de passe modifié" }) }); },
    onError: (e: Error) => setErr(e.message),
  });
  return (
    <details className="rounded-lg border bg-white p-4">
      <summary className="cursor-pointer text-sm font-semibold">🔑 {t({ pt: "Mudar a minha palavra-passe", en: "Change my password", fr: "Changer mon mot de passe" })}</summary>
      <form className="mt-3 grid gap-3 sm:grid-cols-3 sm:items-end" onSubmit={(e) => { e.preventDefault(); setErr(null); save.mutate(); }}>
        <div className="space-y-1"><Label htmlFor="pw-cur">{t({ pt: "Actual", en: "Current", fr: "Actuel" })}</Label><Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></div>
        <div className="space-y-1"><Label htmlFor="pw-new">{t({ pt: `Nova (mín. ${minLength})`, en: `New (min ${minLength})`, fr: `Nouveau (min ${minLength})` })}</Label><Input id="pw-new" type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} aria-invalid={!!err} aria-describedby={err ? "pw-err" : undefined} /></div>
        <Button type="submit" disabled={!cur || next.length < minLength || save.isPending}>{t({ pt: "Guardar", en: "Save", fr: "Enregistrer" })}</Button>
        {err && <p id="pw-err" role="alert" className="text-sm text-red-700 sm:col-span-3">{err}</p>}
      </form>
    </details>
  );
}
