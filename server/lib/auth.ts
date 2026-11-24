import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type AdminPerm, type User } from "@shared/schema";
import { HttpError } from "./http";
import { config } from "../config";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userType?: string;
    lastSeen?: number; // admin: termina após ADMIN_IDLE_MIN sem uso
    pending2fa?: { userId: number; at: number; tries: number }; // palavra-passe certa, falta o código
    totpSetup?: string; // segredo cifrado durante a activação
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

/** Carrega o utilizador da sessão (se existir) em req.user. */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.session?.userId) {
      const [u] = await db.select().from(users).where(eq(users.id, req.session.userId));
      if (u && u.isActive) {
        // admin: sessão termina depois de ADMIN_IDLE_MIN minutos sem uso
        const now = Date.now();
        if (u.userType === "admin" && req.session.lastSeen && now - req.session.lastSeen > config.adminIdleMin * 60_000) {
          req.session.userId = undefined;
          req.session.lastSeen = undefined;
          (req as any).sessionExpired = true;
        } else {
          req.user = u;
          if (u.userType === "admin" && (!req.session.lastSeen || now - req.session.lastSeen > 30_000)) req.session.lastSeen = now;
        }
      } else req.session.userId = undefined;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Precisa de iniciar sessão.", "AUTH_REQUIRED"));
  next();
}

export function requireRole(...roles: User["userType"][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return (req as any).sessionExpired
        ? next(new HttpError(401, "A sessão terminou por inactividade. Entre de novo.", "SESSION_EXPIRED"))
        : next(new HttpError(401, "Precisa de iniciar sessão.", "AUTH_REQUIRED"));
    }
    if (!roles.includes(req.user.userType)) return next(new HttpError(403, "Sem permissão para esta área.", "FORBIDDEN"));
    if (!req.user.isApproved) return next(new HttpError(403, "A sua conta ainda aguarda aprovação.", "NOT_APPROVED"));
    next();
  };
}

/** Dono = admin sem lista de permissões. */
export const isOwner = (u: User) => u.userType === "admin" && !u.adminPerms;
export function hasAdminPerm(u: User, perm: AdminPerm) {
  return u.userType === "admin" && (!u.adminPerms || u.adminPerms.includes(perm));
}
/** Áreas do portal admin: cada pedido tem de caber nas permissões de quem o faz. */
export function requireAdminPerm(perm: AdminPerm | "owner") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const u = req.user!;
    const ok = perm === "owner" ? isOwner(u) : hasAdminPerm(u, perm);
    if (!ok) return next(new HttpError(403, "A sua conta da equipa não tem acesso a esta área.", "NO_ADMIN_PERM"));
    next();
  };
}

export function publicUser(u: User) {
  return {
    id: u.id,
    username: u.username,
    fullName: u.fullName,
    email: u.email,
    phone: u.phone,
    userType: u.userType,
    isApproved: u.isApproved,
    referralCode: u.referralCode,
    loyaltyPoints: u.loyaltyPoints,
    preferredLanguage: u.preferredLanguage,
    dietaryPreferences: u.dietaryPreferences,
    vehicleType: u.vehicleType,
    // admin: null = dono (acesso total); lista = membro da equipa
    ...(u.userType === "admin" ? {
      adminPerms: u.adminPerms ?? null, isOwner: !u.adminPerms,
      twoFactorEnabled: !!u.totpEnabledAt, twoFactorSetupRequired: config.adminRequire2fa && !u.totpEnabledAt,
    } : {}),
  };
}
