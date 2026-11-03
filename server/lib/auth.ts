import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { users, type User } from "@shared/schema";
import { HttpError } from "./http";

declare module "express-session" {
  interface SessionData {
    userId?: number;
    userType?: string;
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
      if (u && u.isActive) req.user = u;
      else req.session.userId = undefined;
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
    if (!req.user) return next(new HttpError(401, "Precisa de iniciar sessão.", "AUTH_REQUIRED"));
    if (!roles.includes(req.user.userType)) return next(new HttpError(403, "Sem permissão para esta área.", "FORBIDDEN"));
    if (!req.user.isApproved) return next(new HttpError(403, "A sua conta ainda aguarda aprovação.", "NOT_APPROVED"));
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
  };
}
