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

  // PedeJá Plus
  plusMonthlyPrice: num("PLUS_MONTHLY_PRICE", 2500),
  plusFreeDeliveryMinOrder: num("PLUS_FREE_DELIVERY_MIN_ORDER", 3000),
  priorityFee: num("PRIORITY_FEE", 500), // Kz a mais pela entrega prioritária
  priorityMinutesSaved: num("PRIORITY_MINUTES_SAVED", 10),

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

  // Despacho automático: oferece cada entrega ao melhor estafeta online, um de cada vez
  autoDispatch: process.env.AUTO_DISPATCH !== "0",
  dispatchOfferSeconds: num("DISPATCH_OFFER_SECONDS", 30),
  dispatchMaxRounds: num("DISPATCH_MAX_ROUNDS", 5),
  dispatchRadiusKm: num("DISPATCH_RADIUS_KM", 8),
  dispatchTickMs: num("DISPATCH_TICK_MS", 5000),
  riderSpeedKmh: num("RIDER_SPEED_KMH", 20), // média em Luanda, com trânsito
  dispatchLeadMin: num("DISPATCH_LEAD_MIN", 3), // margem: oferecer uns minutos antes do necessário
  presenceStaleMin: num("PRESENCE_STALE_MIN", 10), // sem GPS há mais de 10 min: deixa de receber ofertas

  // Dinheiro
  commissionPct: num("COMMISSION_PCT", 20), // comissão PedeJá sobre o valor da comida (cada loja pode ter a sua)
  allowCash: process.env.ALLOW_CASH === "1", // por defeito NÃO: os clientes pagam tudo por banco
  pinMaxAttempts: num("PIN_MAX_ATTEMPTS", 5),

  // Taxas ao cliente (modelo Deliveroo, em Kz)
  deliveryBaseFee: num("DELIVERY_BASE_FEE", 400),
  deliveryPerKm: num("DELIVERY_PER_KM", 150),
  deliveryMinFee: num("DELIVERY_MIN_FEE", 500),
  deliveryMaxFee: num("DELIVERY_MAX_FEE", 3500),
  busyPricing: process.env.BUSY_PRICING !== "0",
  busySurchargePct: num("BUSY_SURCHARGE_PCT", 20), // movimentado
  veryBusySurchargePct: num("VERY_BUSY_SURCHARGE_PCT", 40), // muito movimentado
  serviceFeePct: num("SERVICE_FEE_PCT", 5), // % da comida antes de descontos
  serviceFeeMin: num("SERVICE_FEE_MIN", 150),
  serviceFeeMax: num("SERVICE_FEE_MAX", 2500),
  smallOrderMin: num("SMALL_ORDER_MIN", 0), // mínimo geral; cada loja pode ter o seu (abaixo: paga a diferença)

  // Pagamento aos estafetas (por entrega, separado do que o cliente paga)
  riderBasePay: num("RIDER_BASE_PAY", 600),
  riderPerKm: num("RIDER_PER_KM", 200), // km até à loja + km até ao cliente
  riderNightBonusPct: num("RIDER_NIGHT_BONUS_PCT", 20), // 22h–06h
  riderPeakBonusPct: num("RIDER_PEAK_BONUS_PCT", 10), // 12h–14h e 19h–21h
  riderBusyBonusPct: num("RIDER_BUSY_BONUS_PCT", 15),
  riderVeryBusyBonusPct: num("RIDER_VERY_BUSY_BONUS_PCT", 30),
  riderHandlingMin: num("RIDER_HANDLING_MIN", 6), // minutos de recolha + entrega, além da viagem
  riderWaitFreeMin: num("RIDER_WAIT_FREE_MIN", 5), // espera na loja sem pagamento
  riderWaitPerMin: num("RIDER_WAIT_PER_MIN", 30), // Kz por minuto (contado ao segundo)
  riderWaitMaxMin: num("RIDER_WAIT_MAX_MIN", 30), // no máximo 30 min de espera pagos
  // Pagamentos: semanal à terça (ganhos de segunda a domingo da semana anterior); levantamento imediato com taxa
  payoutWeekday: num("PAYOUT_WEEKDAY", 2), // 0=domingo … 2=terça
  instantCashoutFeePct: num("INSTANT_CASHOUT_FEE_PCT", 2),
  instantCashoutFeeMin: num("INSTANT_CASHOUT_FEE_MIN", 200),
  instantCashoutMin: num("INSTANT_CASHOUT_MIN", 2000),

  // Portal externo de estafetas (opcional)
  driverPortalUrl: process.env.DRIVER_PORTAL_URL || "",
  driverPortalApiKey: process.env.DRIVER_PORTAL_API_KEY || "",
  driverWebhookSecret: process.env.DRIVER_WEBHOOK_SECRET || "",
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
};
