import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { pointsLedger, registerSchema, loginSchema, stores, users, DIETARY_TAGS } from "@shared/schema";
import { config } from "../config";
import { ah, badRequest, conflict, HttpError, parse } from "../lib/http";
import { publicUser, requireAuth } from "../lib/auth";

export const authRouter = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: config.isProd ? 10 : 200,
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
      isApproved: input.userType === "customer" || input.userType === "supplier", // estafetas aguardam aprovação
      referralCode,
      referredBy: referrerId,
      loyaltyPoints: referrerId && input.userType === "customer" ? config.welcomeBonusPoints : 0,
    }).returning();
    if (referrerId && input.userType === "customer") {
      await tx.insert(pointsLedger).values({ userId: u.id, delta: config.welcomeBonusPoints, reason: "welcome_bonus" });
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

authRouter.post("/login", authLimiter, ah(async (req, res) => {
  const { username, password } = parse(loginSchema, req.body);
  const [user] = await db.select().from(users).where(eq(users.username, username.toLowerCase()));
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, "Nome de utilizador ou palavra-passe incorrectos.", "INVALID_CREDENTIALS");
  if (!user.isActive) throw new HttpError(403, "Esta conta foi desactivada.", "ACCOUNT_DISABLED");

  await regenerate(req);
  req.session.userId = user.id;
  req.session.userType = user.userType;
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));
  res.json({ user: publicUser(user) });
}));

authRouter.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("pedeai.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  if (!req.user) return res.status(401).json({ message: "Não autenticado", code: "AUTH_REQUIRED" });
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
