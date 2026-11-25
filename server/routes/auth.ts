import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { config } from "../config";
import { audit, checkTotp, ipAllowed, isAdminHost, newRecoveryCodes, newTotpSecret, seal, totpFor, unseal, useRecoveryCode } from "../lib/adminSecurity";
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { pointsLedger, registerSchema, loginSchema, stores, taxiDrivers, users, DIETARY_TAGS } from "@shared/schema";
import { ah, badRequest, conflict, HttpError, parse } from "../lib/http";
import { publicUser, requireAuth } from "../lib/auth";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.AUTH_RATE_LIMIT) || (config.isProd ? 10 : 200), // falhas por ligação em 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: "Demasiadas tentativas. Tente novamente daqui a alguns minutos.", code: "RATE_LIMITED" },
});

// hash fixo para comparar quando o utilizador não existe (evita revelar contas por tempo de resposta)
const DUMMY_HASH = bcrypt.hashSync("dummy-password-not-used", 10);

async function newReferralCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomBytes(4).toString("hex").toUpperCase().slice(0, 7);
    const [exists] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, code));
    if (!exists) return code;
  }
  throw new Error("Não foi possível gerar código de convite");
}

function regenerate(req: any): Promise<void> {
  return new Promise((resolve, reject) => req.session.regenerate((err: any) => (err ? reject(err) : resolve())));
}

authRouter.post("/register", authLimiter, ah(async (req, res) => {
  const input = parse(registerSchema, req.body);
  if (input.userType === "supplier" && !input.business) throw badRequest("Indique os dados do negócio.", "BUSINESS_REQUIRED");
  if (input.userType === "taxi" && !input.taxi) throw badRequest("Indique os dados da viatura e da carta de condução.", "TAXI_REQUIRED");

  const username = input.username.toLowerCase();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.username, username));
  if (existing) throw conflict("Este nome de utilizador já existe.", "USERNAME_TAKEN");

  let referrerId: number | null = null;
  if (input.referralCode) {
    const [ref] = await db.select({ id: users.id }).from(users).where(eq(users.referralCode, input.referralCode.toUpperCase()));
    if (!ref) throw badRequest("Código de convite inválido.", "REFERRAL_INVALID");
    referrerId = ref.id;
  }

  const passwordHash = await bcrypt.hash(input.password, 12);
  const referralCode = await newReferralCode();

  const user = await db.transaction(async (tx) => {
    const [u] = await tx.insert(users).values({
      username,
      passwordHash,
      fullName: input.fullName,
      email: input.email || null,
      phone: input.phone,
      userType: input.userType,
      isApproved: input.userType === "customer" || input.userType === "supplier", // estafetas e motoristas aguardam aprovação
      vehicleType: input.userType === "driver" ? input.vehicleType ?? "moto" : null,
      referralCode,
      referredBy: referrerId,
      loyaltyPoints: referrerId && input.userType === "customer" ? config.welcomeBonusPoints : 0,
    }).returning();
    if (referrerId && input.userType === "customer") {
      await tx.insert(pointsLedger).values({ userId: u.id, delta: config.welcomeBonusPoints, reason: "welcome_bonus" });
    }
    if (input.userType === "taxi" && input.taxi) {
      await tx.insert(taxiDrivers).values({ userId: u.id, ...input.taxi, year: input.taxi.year ?? null });
    }
    if (input.userType === "supplier" && input.business) {
      await tx.insert(stores).values({
        ownerId: u.id,
        name: input.business.name,
        storeType: input.business.storeType,
        phone: input.business.phone,
        street: input.business.street,
        zone: input.business.zone,
        zonesServed: [input.business.zone],
        businessNif: input.business.nif || null,
        description: input.business.description || null,
        isHomeBusiness: !!input.business.isHomeBusiness,
        minNoticeMin: (input.business.minNoticeHours ?? 0) * 60,
        maxOrdersPerDay: input.business.isHomeBusiness ? 10 : null,
        isApproved: false, // fica pendente até o admin aprovar
        isOpen: false,
      });
    }
    return u;
  });

  await regenerate(req);
  req.session.userId = user.id;
  req.session.userType = user.userType;
  res.status(201).json({ user: publicUser(user) });
}));

/** Mudar a própria palavra-passe (toda a gente; a equipa do admin recebe uma provisória). */
authRouter.post("/password", authLimiter, ah(async (req, res) => {
  if (!req.user) throw new HttpError(401, "Precisa de iniciar sessão.", "AUTH_REQUIRED");
  const b = parse(z.object({ currentPassword: z.string().min(1).max(128), newPassword: z.string().min(req.user.userType === "admin" ? 12 : 8, req.user.userType === "admin" ? "Pelo menos 12 caracteres" : "Pelo menos 8 caracteres").max(128) }), req.body);
  const [u] = await db.select().from(users).where(eq(users.id, req.user.id));
  if (!u || !(await bcrypt.compare(b.currentPassword, u.passwordHash))) throw new HttpError(400, "A palavra-passe actual está errada.", "BAD_PASSWORD");
  if (b.currentPassword === b.newPassword) throw new HttpError(400, "A nova palavra-passe tem de ser diferente.", "SAME_PASSWORD");
  await db.update(users).set({ passwordHash: await bcrypt.hash(b.newPassword, 12) }).where(eq(users.id, u.id));
  // termina as outras sessões; esta continua
  await db.execute(sql`delete from sessions where (sess->>'userId')::int = ${u.id} and sid <> ${req.sessionID}`).catch(() => {});
  res.json({ ok: true });
}));

authRouter.post("/login", authLimiter, ah(async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user?.userType === "admin") await audit(req, "login.fail", { user, status: 401 });
    throw new HttpError(401, "Nome de utilizador ou palavra-passe incorrectos.", "INVALID_CREDENTIALS");
  }
  if (!user.isActive) throw new HttpError(403, "Esta conta foi desactivada.", "ACCOUNT_DISABLED");

  // a equipa do admin só entra pelo endereço do admin (e ligações permitidas); os outros nunca entram por lá
  if (user.userType === "admin") {
    if (!isAdminHost(req)) throw new HttpError(403, `A administração está em https://${config.adminHost}`, "ADMIN_HOST_ONLY");
    if (!ipAllowed(req.ip)) {
      await audit(req, "login.blocked_ip", { user, status: 403 });
      throw new HttpError(403, "Esta ligação não está autorizada a aceder à administração.", "IP_NOT_ALLOWED");
    }
  } else if (config.adminHost && isAdminHost(req)) {
    throw new HttpError(403, "Este endereço é só para a equipa PedeJá.", "ADMIN_HOST_STAFF_ONLY");
  }

  await regenerate(req);
  // verificação em dois passos activada: falta o código da app autenticadora
  if (user.userType === "admin" && user.totpEnabledAt) {
    req.session.pending2fa = { userId: user.id, at: Date.now(), tries: 0 };
    await audit(req, "login.password_ok", { user });
    return res.json({ twoFactorRequired: true });
  }
  req.session.userId = user.id;
  req.session.userType = user.userType;
  req.session.lastSeen = Date.now();
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  if (user.userType === "admin") await audit(req, "login.ok", { user });
  res.json({ user: publicUser(user) });
}));

/** Segundo passo do login: código de 6 dígitos (ou um código de recuperação). */
authRouter.post("/2fa/verify", authLimiter, ah(async (req, res) => {
  const { code } = parse(z.object({ code: z.string().trim().min(6).max(20) }), req.body);
  const p = req.session.pending2fa;
  if (!p || Date.now() - p.at > 5 * 60_000) {
    req.session.pending2fa = undefined;
    throw new HttpError(401, "O tempo para o código acabou. Entre de novo.", "TWO_FACTOR_EXPIRED");
  }
  const [user] = await db.select().from(users).where(eq(users.id, p.userId));
  if (!user || !user.isActive || !user.totpEnabledAt) { req.session.pending2fa = undefined; throw new HttpError(401, "Entre de novo.", "TWO_FACTOR_EXPIRED"); }
  const isRecovery = code.includes("-") || code.replace(/\s/g, "").length > 6;
  const ok = isRecovery ? await useRecoveryCode(user, code) : await checkTotp(user, code);
  if (!ok) {
    p.tries += 1;
    await audit(req, "login.2fa_fail", { user, status: 401 });
    if (p.tries >= 5) { req.session.pending2fa = undefined; throw new HttpError(401, "Demasiados códigos errados. Entre de novo.", "TWO_FACTOR_EXPIRED"); }
    throw new HttpError(401, "Código errado ou já usado.", "BAD_2FA_CODE");
  }
  await regenerate(req);
  req.session.userId = user.id;
  req.session.userType = user.userType;
  req.session.lastSeen = Date.now();
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  await audit(req, isRecovery ? "login.ok_recovery_code" : "login.ok_2fa", { user });
  const [fresh] = await db.select().from(users).where(eq(users.id, user.id));
  res.json({ user: publicUser(fresh), recoveryCodesLeft: isRecovery ? fresh.totpRecovery?.length ?? 0 : undefined });
}));

/** Activar a verificação em dois passos (equipa do admin): 1) gerar o código QR … */
authRouter.post("/2fa/setup", ah(async (req, res) => {
  if (!req.user || req.user.userType !== "admin") throw new HttpError(403, "Só para a equipa do admin.", "FORBIDDEN");
  if (req.user.totpEnabledAt) throw new HttpError(409, "A verificação em dois passos já está activa.", "ALREADY_ENABLED");
  const secret = newTotpSecret();
  req.session.totpSetup = seal(secret);
  const url = totpFor(secret, req.user.username).toString();
  res.json({ otpauthUrl: url, qr: await QRCode.toDataURL(url, { margin: 1, width: 220 }), secret: secret.replace(/(.{4})/g, "$1 ").trim() });
}));

/** … 2) confirmar com o primeiro código; devolve os códigos de recuperação (mostrados uma única vez). */
authRouter.post("/2fa/enable", authLimiter, ah(async (req, res) => {
  if (!req.user || req.user.userType !== "admin") throw new HttpError(403, "Só para a equipa do admin.", "FORBIDDEN");
  const { code } = parse(z.object({ code: z.string().trim().min(6).max(8) }), req.body);
  if (!req.session.totpSetup) throw new HttpError(400, "Comece de novo a activação.", "NO_SETUP");
  const secret = unseal(req.session.totpSetup);
  if (!(await checkTotp(req.user, code, secret))) throw new HttpError(400, "Código errado. Confirme a hora do telemóvel e tente o código seguinte.", "BAD_2FA_CODE");
  const rc = newRecoveryCodes();
  await db.update(users).set({ totpSecret: seal(secret), totpEnabledAt: new Date(), totpRecovery: rc.hashes }).where(eq(users.id, req.user.id));
  req.session.totpSetup = undefined;
  await audit(req, "2fa.enabled");
  const [fresh] = await db.select().from(users).where(eq(users.id, req.user.id));
  res.json({ user: publicUser(fresh), recoveryCodes: rc.codes });
}));

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("pedeja.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  if (!req.user) {
    if ((req as any).sessionExpired) return res.status(401).json({ message: "A sessão terminou por inactividade. Entre de novo.", code: "SESSION_EXPIRED" });
    return res.status(401).json({ message: "Não autenticado", code: "AUTH_REQUIRED" });
  }
  res.json({ user: publicUser(req.user) });
});

const profileSchema = z.object({
  fullName: z.string().trim().min(3).max(100).optional(),
  email: z.string().trim().email().max(120).nullable().optional().or(z.literal("")),
  phone: z.string().trim().regex(/^\+?[0-9 ]{9,15}$/).optional(),
  preferredLanguage: z.enum(["pt", "en", "fr"]).optional(),
  dietaryPreferences: z.array(z.enum(DIETARY_TAGS)).optional(),
});

authRouter.patch("/me", requireAuth, ah(async (req, res) => {
  const input = parse(profileSchema, req.body);
  const [u] = await db.update(users).set({
    ...input,
    email: input.email === "" ? null : input.email,
  }).where(eq(users.id, req.user!.id)).returning();
  res.json({ user: publicUser(u) });
}));

authRouter.post("/password", requireAuth, authLimiter, ah(async (req, res) => {
  const { currentPassword, newPassword } = parse(z.object({
    currentPassword: z.string().min(1).max(128),
    newPassword: z.string().min(8).max(128),
  }), req.body);
  const ok = await bcrypt.compare(currentPassword, req.user!.passwordHash);
  if (!ok) throw badRequest("A palavra-passe actual está incorrecta.", "WRONG_PASSWORD");
  await db.update(users).set({ passwordHash: await bcrypt.hash(newPassword, 12) }).where(eq(users.id, req.user!.id));
  res.json({ ok: true });
}));

// usado para mostrar o histórico de pontos
authRouter.get("/points", requireAuth, ah(async (req, res) => {
  const rows = await db.select().from(pointsLedger).where(eq(pointsLedger.userId, req.user!.id))
    .orderBy(sql`${pointsLedger.createdAt} desc`).limit(100);
  const [{ referred }] = await db.select({ referred: sql<number>`count(*)::int` }).from(users).where(eq(users.referredBy, req.user!.id));
  res.json({
    balance: req.user!.loyaltyPoints,
    pointValueKz: config.pointValueKz,
    kzPerPointEarned: config.kzPerPointEarned,
    referralCode: req.user!.referralCode,
    referralBonusPoints: config.referralBonusPoints,
    welcomeBonusPoints: config.welcomeBonusPoints,
    friendsReferred: referred,
    history: rows,
  });
}));
