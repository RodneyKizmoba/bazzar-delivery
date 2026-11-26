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
  // Segurança do admin
  adminRequire2fa: process.env.ADMIN_REQUIRE_2FA !== "0", // verificação em dois passos obrigatória para a equipa
  adminHost: (process.env.ADMIN_HOST || "").trim().toLowerCase(), // ex.: admin.pedeja.ao — vazio = em qualquer endereço
  adminAllowedIps: (process.env.ADMIN_ALLOWED_IPS || "").split(",").map((s) => s.trim()).filter(Boolean), // vazio = qualquer ligação
  adminIdleMin: Number(process.env.ADMIN_IDLE_MIN || 30), // sessão do admin termina após X min sem uso
  adminReset2faFor: (process.env.ADMIN_RESET_2FA || "").trim().toLowerCase(), // emergência: utilizador cuja 2FA é removida ao arrancar
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
  commissionPct: num("COMMISSION_PCT", 20), // entrega com estafeta PedeJá (cada loja pode ter a sua)
  commissionPickupPct: num("COMMISSION_PICKUP_PCT", 9), // cliente levanta no balcão (8–10%)
  commissionSelfDeliveryPct: num("COMMISSION_SELF_DELIVERY_PCT", 10), // loja entrega com os seus estafetas (8–12%)
  // Publicidade ("Patrocinado" no topo das pesquisas)
  adPricePerDay: num("AD_PRICE_PER_DAY", 2000),
  adMaxSlots: num("AD_MAX_SLOTS", 3),
  // numerário ligado por defeito até haver gateway (Multicaixa Express / Unitel Money); ALLOW_CASH=0 para só banco
  allowCash: process.env.ALLOW_CASH !== "0",
  riderCashLimit: num("RIDER_CASH_LIMIT", 50000), // acima disto o estafeta entrega o numerário antes de levar mais encomendas em dinheiro
  pinMaxAttempts: num("PIN_MAX_ATTEMPTS", 5),

  // Taxas ao cliente (modelo Deliveroo, em Kz)
  // Taxa de entrega = tarifa de entrega de mota da Yango Luanda com DELIVERY_DISCOUNT_PCT a menos,
  // arredondada para baixo a 50 Kz (tabela em server/lib/fees.ts, DELIVERY_REFERENCE)
  deliveryDiscountPct: num("DELIVERY_DISCOUNT_PCT", 5),
  busyPricing: process.env.BUSY_PRICING !== "0",
  busySurchargePct: num("BUSY_SURCHARGE_PCT", 20), // movimentado
  veryBusySurchargePct: num("VERY_BUSY_SURCHARGE_PCT", 40), // muito movimentado
  serviceFeePct: num("SERVICE_FEE_PCT", 5), // % da comida antes de descontos
  serviceFeeMin: num("SERVICE_FEE_MIN", 150),
  serviceFeeMax: num("SERVICE_FEE_MAX", 2500),
  smallOrderMin: num("SMALL_ORDER_MIN", 0), // mínimo geral; cada loja pode ter o seu (abaixo: paga a diferença)

  // Pagamento aos estafetas (por entrega, separado do que o cliente paga)
  riderSharePct: num("RIDER_SHARE_PCT", 88), // o estafeta fica com 88% da taxa de entrega (comissão PedeJá 12%)
  riderHourlyFloor: process.env.RIDER_HOURLY_FLOOR === "1", // mínimo por hora estimada (desligado por defeito)
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

  // Táxi (estilo DiDi). Preço = tarifa de referência da Yango Luanda (máximas, válidas até 01.12.2026)
  // com TAXI_DISCOUNT_PCT a menos, arredondado PARA BAIXO a 50 Kz: fica sempre pelo menos 5% mais barato.
  // A tabela por categoria está em server/lib/taxiFares.ts (TAXI_REFERENCE).
  taxiDiscountPct: num("TAXI_DISCOUNT_PCT", 5),
  taxiXlFactor: num("TAXI_XL_FACTOR", 1.1), // a Yango não tem XL em Luanda: XL = Comfort+ × 1,10 (6–7 lugares)
  taxiPickupFee: num("TAXI_PICKUP_FEE", 0), // taxa de recolha (0 = sem taxa)
  taxiRoundTo: num("TAXI_ROUND_TO", 50), // múltiplos de 50 Kz
  taxiSpeedKmh: num("TAXI_SPEED_KMH", 20), // carro em Luanda, com trânsito (mota: +25%)
  // tarifa dinâmica: hora de ponta e muita procura (o maior dos dois); TAXI_SURGE=0 desliga
  taxiSurge: process.env.TAXI_SURGE !== "0",
  taxiPeakMult: num("TAXI_PEAK_MULT", 1.2), // dias úteis 06:30–09:00 e 16:30–19:30
  taxiBusyMult: num("TAXI_BUSY_MULT", 1.2),
  taxiVeryBusyMult: num("TAXI_VERY_BUSY_MULT", 1.5),
  taxiCommissionPct: num("TAXI_COMMISSION_PCT", 10), // comissão PedeJá por viagem
  taxiCancelFee: num("TAXI_CANCEL_FEE", 0), // cliente cancela depois de X min do motorista aceitar (0 = grátis)
  taxiFreeCancelMin: num("TAXI_FREE_CANCEL_MIN", 2),
  taxiOfferSeconds: num("TAXI_OFFER_SECONDS", num("DISPATCH_OFFER_SECONDS", 20)),
  taxiMaxRounds: num("TAXI_MAX_ROUNDS", 6),
  taxiRadiusKm: num("TAXI_RADIUS_KM", 6),
  taxiSearchMaxMin: num("TAXI_SEARCH_MAX_MIN", 5), // sem motorista ao fim de 5 min: avisa o cliente
  sosPhone: process.env.SOS_PHONE || "113", // Polícia Nacional de Angola

  // Envios: tarifa de entrega Yango −5% (mota; pacote grande: carro) + extra por tamanho opcional (0 por defeito)
  parcelMediumFee: num("PARCEL_MEDIUM_FEE", 0), // até ~15 kg
  parcelLargeFee: num("PARCEL_LARGE_FEE", 0), // até ~30 kg, só carro (já paga a tarifa de carro)
  parcelRiderSharePct: num("PARCEL_RIDER_SHARE_PCT", 50),
  // sem comida não há comissão: o envio nunca custa menos do que o estafeta ganha (+ esta margem)
  parcelMinMarginPct: num("PARCEL_MIN_MARGIN_PCT", 0),

  // Portal externo de estafetas (opcional)
  driverPortalUrl: process.env.DRIVER_PORTAL_URL || "",
  driverPortalApiKey: process.env.DRIVER_PORTAL_API_KEY || "",
  driverWebhookSecret: process.env.DRIVER_WEBHOOK_SECRET || "",
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET || "",
};
