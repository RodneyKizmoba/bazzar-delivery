import type { NextFunction, Request, Response } from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import * as OTPAuth from "otpauth";
import { db } from "../db";
import { config } from "../config";
import { adminAudit, users, type User } from "@shared/schema";
import { HttpError } from "./http";

/**
 * Segurança da área de administração:
 *  - verificação em dois passos (código de 6 dígitos de uma app autenticadora) — segredo cifrado na base de dados;
 *  - códigos de recuperação de uso único (guardados só como hash);
 *  - endereço próprio (ADMIN_HOST) e lista opcional de ligações permitidas (ADMIN_ALLOWED_IPS);
 *  - registo de tudo o que a equipa faz.
 */

// ---------------------------------------------------------------------------
// Segredo cifrado (AES-256-GCM, chave derivada do SESSION_SECRET)
// ---------------------------------------------------------------------------
const KEY = createHash("sha256").update(`${config.sessionSecret}:totp`).digest();
export function seal(plain: string) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${enc.toString("base64url")}`;
}
export function unseal(box: string) {
  const [v, iv, tag, enc] = box.split(".");
  if (v !== "v1") throw new Error("formato desconhecido");
  const d = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(enc, "base64url")), d.final()]).toString("utf8");
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238: 6 dígitos, 30 s) — compatível com Google/Microsoft Authenticator, Authy…
// ---------------------------------------------------------------------------
export function totpFor(secretB32: string, label: string) {
  return new OTPAuth.TOTP({ issuer: "PedeJá Admin", label, algorithm: "SHA1", digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secretB32) });
}
export function newTotpSecret() {
  return new OTPAuth.Secret({ size: 20 }).base32;
}

/** Confere um código: aceita ±30 s de diferença de relógio e nunca o mesmo código duas vezes. */
export async function checkTotp(user: User, code: string, secretB32?: string): Promise<boolean> {
  const token = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(token)) return false;
  const secret = secretB32 ?? (user.totpSecret ? unseal(user.totpSecret) : null);
  if (!secret) return false;
  const delta = totpFor(secret, user.username).validate({ token, window: 1 });
  if (delta === null) return false;
  const step = Math.floor(Date.now() / 30_000) + delta;
  if (user.totpLastStep != null && step <= user.totpLastStep) return false; // código já usado
  await db.update(users).set({ totpLastStep: step }).where(eq(users.id, user.id));
  user.totpLastStep = step;
  return true;
}

// ---------------------------------------------------------------------------
// Códigos de recuperação (8, uso único)
// ---------------------------------------------------------------------------
const sha = (s: string) => createHash("sha256").update(s.toLowerCase().replace(/[^a-z0-9]/g, "")).digest("hex");
export function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => {
    const r = randomBytes(5).toString("hex"); // 10 caracteres
    return `${r.slice(0, 5)}-${r.slice(5)}`;
  });
  return { codes, hashes: codes.map(sha) };
}
export async function useRecoveryCode(user: User, code: string) {
  const h = sha(code);
  const list = user.totpRecovery ?? [];
  const i = list.findIndex((x) => x.length === h.length && timingSafeEqual(Buffer.from(x), Buffer.from(h)));
  if (i < 0) return false;
  const rest = list.filter((_, j) => j !== i);
  await db.update(users).set({ totpRecovery: rest }).where(eq(users.id, user.id));
  return true;
}

// ---------------------------------------------------------------------------
// Endereço próprio e ligações permitidas
// ---------------------------------------------------------------------------
export function isAdminHost(req: Request) {
  return !config.adminHost || req.hostname?.toLowerCase() === config.adminHost;
}
function ipv4ToInt(ip: string) {
  const p = ip.split(".").map(Number);
  return p.length === 4 && p.every((n) => n >= 0 && n <= 255) ? ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3] : null;
}
export function ipAllowed(ipRaw: string | undefined, list = config.adminAllowedIps) {
  if (!list.length) return true;
  const ip = (ipRaw ?? "").replace(/^::ffff:/, "");
  return list.some((rule) => {
    if (!rule.includes("/")) return rule === ip;
    const [base, bitsS] = rule.split("/");
    const bits = Number(bitsS), a = ipv4ToInt(ip), b = ipv4ToInt(base);
    if (a === null || b === null || !(bits >= 0 && bits <= 32)) return false;
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (a & mask) === (b & mask);
  });
}

/** Antes de tudo no /api/admin: fora do endereço do admin "não existe"; fora das ligações permitidas é recusado. */
export function adminNetworkGate(req: Request, _res: Response, next: NextFunction) {
  if (!isAdminHost(req)) return next(new HttpError(404, "Não encontrado", "NOT_FOUND"));
  if (!ipAllowed(req.ip)) return next(new HttpError(403, "Esta ligação não está autorizada a aceder à administração.", "IP_NOT_ALLOWED"));
  next();
}

/** Depois do login: a equipa tem de activar a verificação em dois passos antes de usar o portal. */
export function require2faSetup(req: Request, _res: Response, next: NextFunction) {
  if (config.adminRequire2fa && req.user?.userType === "admin" && !req.user.totpEnabledAt) {
    return next(new HttpError(403, "Active a verificação em dois passos para continuar.", "TWO_FACTOR_SETUP_REQUIRED"));
  }
  next();
}

// ---------------------------------------------------------------------------
// Registo de actividade
// ---------------------------------------------------------------------------
const SECRET_KEYS = /pass|pin|code|secret|token|key|iban|reference/i;
function redact(v: unknown, depth = 0): unknown {
  if (depth > 4 || v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.slice(0, 20).map((x) => redact(x, depth + 1));
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "•••" : redact(x, depth + 1)]));
}

export async function audit(req: Request, action: string, extra: { user?: Pick<User, "id" | "username"> | null; status?: number; details?: unknown; targetType?: string; targetId?: string | number } = {}) {
  const u = extra.user ?? req.user;
  try {
    await db.insert(adminAudit).values({
      userId: u?.id ?? null, username: u?.username ?? null, action,
      targetType: extra.targetType ?? null, targetId: extra.targetId != null ? String(extra.targetId) : null,
      details: (redact(extra.details) as Record<string, unknown>) ?? null, status: extra.status ?? null,
      ip: (req.ip ?? "").replace(/^::ffff:/, "") || null, userAgent: (req.get("user-agent") ?? "").slice(0, 200) || null,
    });
  } catch (e) { console.error("[audit]", e); }
}

/** Regista cada alteração feita no portal admin (POST/PATCH/PUT/DELETE), com o resultado. */
export function auditAdminWrites(req: Request, res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD") return next();
  const path = req.path;
  const m = path.match(/^\/([a-z-]+)\/(\d+)/);
  res.on("finish", () => {
    void audit(req, `${req.method} ${path}`, { status: res.statusCode, details: req.body, targetType: m?.[1], targetId: m?.[2] });
  });
  next();
}

/** Emergência: ADMIN_RESET_2FA=<utilizador> remove a verificação em dois passos dessa conta ao arrancar. */
export async function emergencyReset2fa() {
  if (!config.adminReset2faFor) return;
  const r = await db.update(users).set({ totpSecret: null, totpEnabledAt: null, totpRecovery: null, totpLastStep: null })
    .where(eq(users.username, config.adminReset2faFor)).returning({ id: users.id });
  console.warn(`[security] ADMIN_RESET_2FA: verificação em dois passos removida para "${config.adminReset2faFor}" (${r.length} conta). Remova este segredo já.`);
}
