const isProd = process.env.NODE_ENV === "production";

function num(name: string, fallback: number) {
  const v = process.env[name];
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) ? n : fallback;
}

if (isProd && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET é obrigatório em produção (Replit → Secrets).");
}

export const config = {
  isProd,
  port: num("PORT", 5000),
  sessionSecret: process.env.SESSION_SECRET || "dev-only-secret-change-me",
  appOrigins: (process.env.APP_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean),

  // Pagamentos: "disabled" (só numerário), "sandbox" (simulação para testes) ou "live" (gateway real)
  paymentsMode: (process.env.PAYMENTS_MODE || (isProd ? "disabled" : "sandbox")) as "disabled" | "sandbox" | "live",

  // Bazzar Plus
  plusMonthlyPrice: num("PLUS_MONTHLY_PRICE", 2500),
  plusFreeDeliveryMinOrder: num("PLUS_FREE_DELIVERY_MIN_ORDER", 3000),

  // Pontos de fidelização
  pointValueKz: num("POINT_VALUE_KZ", 10), // 1 ponto = 10 Kz de desconto
  kzPerPointEarned: num("KZ_PER_POINT_EARNED", 100), // ganha 1 ponto por cada 100 Kz
  referralBonusPoints: num("REFERRAL_BONUS_POINTS", 100), // para quem convida (após 1ª entrega do convidado)
  welcomeBonusPoints: num("WELCOME_BONUS_POINTS", 100), // para quem se regista com código
  maxPointsDiscountPct: num("MAX_POINTS_DISCOUNT_PCT", 50),

  // Agendamento
  scheduleMinLeadMin: num("SCHEDULE_MIN_LEAD_MIN", 30),
  scheduleMaxAheadHours: num("SCHEDULE_MAX_AHEAD_HOURS", 24),

  // Cancelamento grátis até a loja começar a preparar
  cancellableStatuses: ["scheduled", "pending", "accepted"] as const,
  modifiableStatuses: ["scheduled", "pending"] as const,

  // Portal externo de estafetas (opcional)
  driverPortalUrl: process.env.DRIVER_PORTAL_URL || "",
  driverPortalApiKey: process.env.DRIVER_PORTAL_API_KEY || "",
  driverWebhookSecret: process.env.DRIVER_WEBHOOK_SECRET || "",
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
};
