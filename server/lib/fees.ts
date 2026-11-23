import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { config } from "../config";
import type { RiderPayDetail, VehicleType } from "@shared/schema";

/**
 * Taxas e pagamento aos estafetas — modelo Deliveroo, em Kz.
 *
 * O que o CLIENTE paga e o que o ESTAFETA recebe são contas separadas:
 *  - Cliente: taxa de entrega (distância loja→cliente, mais cara quando está muito movimentado),
 *    taxa de serviço (% da comida antes de descontos, com mínimo e máximo),
 *    taxa de encomenda pequena (a diferença até ao mínimo da loja), gorjeta opcional.
 *  - Estafeta: valor por entrega (base + km até à loja + km até ao cliente, ajustado pelo veículo,
 *    hora do dia e movimento), nunca abaixo de um mínimo por hora estimada; + espera na loja acima
 *    de 5 min; + 100% da gorjeta. É mostrado na oferta, antes de aceitar.
 * Funções puras (testadas em tests/fees.unit.test.ts) + uma consulta para o nível de movimento.
 */

type LL = { latitude: number; longitude: number };
const round50 = (n: number) => Math.round(n / 50) * 50;
const round10 = (n: number) => Math.round(n / 10) * 10;

/** km de estrada estimados (linha recta × 1,3). */
export function roadKm(a: LL, b: LL) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad, dLng = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h)) * 1.3;
}
export const hasLL = (p: { latitude?: number | null; longitude?: number | null } | null | undefined): p is LL =>
  !!p && p.latitude != null && p.longitude != null;

// ---------------------------------------------------------------------------
// Movimento: encomendas à espera de estafeta vs estafetas livres
// ---------------------------------------------------------------------------
export function busyLevelFrom(waiting: number, freeRiders: number): 0 | 1 | 2 {
  const free = Math.max(1, freeRiders);
  if (waiting >= 4 && waiting >= 2 * free) return 2;
  if (waiting >= 2 && waiting >= free) return 1;
  return 0;
}
export async function currentBusyLevel(db: DbOrTx): Promise<0 | 1 | 2> {
  if (!config.busyPricing) return 0;
  const r = await db.execute(sql`
    select
      (select count(*) from orders where driver_id is null and fulfilment = 'delivery' and status in ('accepted','preparing','ready')
         and updated_at > now() - interval '2 hours')::int as waiting,
      (select count(*) from driver_presence p join users u on u.id = p.user_id
         where p.is_online and u.is_active and u.is_approved
           and (p.location_at is null or p.location_at > now() - make_interval(mins => ${config.presenceStaleMin}))
           and not exists (select 1 from orders o where o.driver_id = u.id and o.status in ('accepted','preparing','ready','picked_up')))::int as free`);
  const row = r.rows[0] as { waiting: number; free: number };
  return busyLevelFrom(row.waiting, row.free);
}

// ---------------------------------------------------------------------------
// Cliente
// ---------------------------------------------------------------------------
/** Taxa de entrega: base + km, entre mínimo e máximo, + sobretaxa quando muito movimentado. Sem coordenadas: taxa da loja. */
export function customerDeliveryFee(km: number | null, busy: 0 | 1 | 2, storeFallback: number) {
  let fee = km == null ? storeFallback : Math.min(config.deliveryMaxFee, Math.max(config.deliveryMinFee, config.deliveryBaseFee + km * config.deliveryPerKm));
  const pct = busy === 2 ? config.veryBusySurchargePct : busy === 1 ? config.busySurchargePct : 0;
  fee = fee * (1 + pct / 100);
  return round50(fee);
}
/** Taxa de serviço: % da comida (antes de descontos), com mínimo e máximo. */
export function serviceFeeFor(subtotal: number) {
  if (subtotal <= 0 || config.serviceFeePct <= 0) return 0;
  return round10(Math.min(config.serviceFeeMax, Math.max(config.serviceFeeMin, (subtotal * config.serviceFeePct) / 100)));
}
/** Encomenda pequena: a diferença até ao mínimo (o da loja, ou o geral). */
export function smallOrderFeeFor(subtotal: number, storeMin: number) {
  const min = storeMin > 0 ? storeMin : config.smallOrderMin;
  return min > 0 && subtotal < min ? min - subtotal : 0;
}

// ---------------------------------------------------------------------------
// Estafeta
// ---------------------------------------------------------------------------
export const VEHICLES: Record<VehicleType, { speedKmh: number; mult: number; hourlyFloor: number; label: string }> = {
  moto: { speedKmh: 22, mult: 1, hourlyFloor: 1800, label: "Mota" },
  car: { speedKmh: 18, mult: 1.15, hourlyFloor: 2400, label: "Carro" },
  ebike: { speedKmh: 16, mult: 0.9, hourlyFloor: 1400, label: "Bicicleta eléctrica" },
  bike: { speedKmh: 12, mult: 0.85, hourlyFloor: 1200, label: "Bicicleta" },
};

/** Hora de Luanda (UTC+1): noite 22–06, pico 12–14 e 19–21. */
export function timeBand(at: Date): "night" | "peak" | "normal" {
  const h = (at.getUTCHours() + 1) % 24;
  if (h >= 22 || h < 6) return "night";
  if ((h >= 12 && h < 14) || (h >= 19 && h < 21)) return "peak";
  return "normal";
}

/** Valor da entrega para o estafeta (sem gorjeta nem espera). */
export function riderPayFor(opts: { pickupKm: number | null; dropKm: number | null; vehicle: VehicleType | null; at: Date; busy: 0 | 1 | 2 }): RiderPayDetail {
  const vehicle = opts.vehicle ?? "moto";
  const v = VEHICLES[vehicle];
  const pickupKm = Math.round((opts.pickupKm ?? 2) * 10) / 10; // sem GPS: assume 2 km até à loja
  const dropKm = Math.round((opts.dropKm ?? 4) * 10) / 10; // sem coordenadas: assume 4 km
  const km = pickupKm + dropKm;
  const estMinutes = Math.round((km / v.speedKmh) * 60 + config.riderHandlingMin);
  // cada parcela arredondada a 10 Kz, para a soma mostrada ao estafeta bater certo
  const base = round10(config.riderBasePay * v.mult);
  const distance = round10(km * config.riderPerKm * v.mult);
  const band = timeBand(opts.at);
  const bandPct = band === "night" ? config.riderNightBonusPct : band === "peak" ? config.riderPeakBonusPct : 0;
  const timeBonus = round10(((base + distance) * bandPct) / 100);
  const busyPct = opts.busy === 2 ? config.riderVeryBusyBonusPct : opts.busy === 1 ? config.riderBusyBonusPct : 0;
  const busyBonus = round10(((base + distance) * busyPct) / 100);
  const subtotal = base + distance + timeBonus + busyBonus;
  const floor = Math.ceil((v.hourlyFloor * estMinutes) / 60 / 10) * 10; // mínimo por hora estimada, arredondado para cima
  const floorTopUp = Math.max(0, floor - subtotal);
  const total = subtotal + floorTopUp;
  return { vehicle, pickupKm, dropKm, estMinutes, base, distance, timeBonus, busyBonus, floorTopUp, total, band, busyLevel: opts.busy };
}

/** Espera na loja: paga ao segundo depois dos primeiros 5 min, no máximo 30 min. */
export function waitFeeFor(arrivedAt: Date | null, pickedUpAt: Date) {
  if (!arrivedAt) return 0;
  const waitedMin = (pickedUpAt.getTime() - arrivedAt.getTime()) / 60_000;
  const paidMin = Math.min(config.riderWaitMaxMin, Math.max(0, waitedMin - config.riderWaitFreeMin));
  return Math.round(paidMin * config.riderWaitPerMin);
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------
/** Taxa do levantamento imediato. */
export function instantCashoutFee(amount: number) {
  return Math.max(config.instantCashoutFeeMin, Math.round((amount * config.instantCashoutFeePct) / 100));
}
/** Início da semana corrente (segunda 00:00, hora de Luanda): o pagamento semanal cobre tudo antes disto. */
export function weekStartLuanda(now: Date) {
  const lu = new Date(now.getTime() + 3_600_000); // relógio de Luanda
  const dow = (lu.getUTCDay() + 6) % 7; // 0 = segunda
  const start = Date.UTC(lu.getUTCFullYear(), lu.getUTCMonth(), lu.getUTCDate() - dow) - 3_600_000;
  return new Date(start);
}
/** Próximo dia de pagamento (terça por defeito), 00:00 de Luanda. */
export function nextPayday(now: Date) {
  const lu = new Date(now.getTime() + 3_600_000);
  const add = (config.payoutWeekday - lu.getUTCDay() + 7) % 7; // 0 = hoje
  return new Date(Date.UTC(lu.getUTCFullYear(), lu.getUTCMonth(), lu.getUTCDate() + add) - 3_600_000);
}
