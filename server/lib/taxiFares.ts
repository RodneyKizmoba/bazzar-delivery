import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { config } from "../config";
import type { FareDetail, RideCategory, RidePlace } from "@shared/schema";
import { busyLevelFrom, roadKm } from "./fees";

/**
 * Preço das viagens de táxi (estilo DiDi), em Kz. Funções puras, testadas em tests/taxi.unit.test.ts.
 *
 * Calibração do dono: "o mesmo preço da Yango com 5% menos".
 *  - TAXI_REFERENCE = tarifas máximas da Yango em Luanda (válidas até 01.12.2026), por categoria;
 *  - a PedeJá cobra cada valor com TAXI_DISCOUNT_PCT a menos (mínimo, Kz/km, Kz/min, espera);
 *  - preço final = preço Yango (arredondado para cima a 50, como a Yango) × 0,95, arredondado PARA BAIXO a 50 Kz,
 *    por isso fica sempre pelo menos 5% abaixo da Yango;
 *  - a Yango não tem XL em Luanda: XL = Comfort+ × TAXI_XL_FACTOR (1,10, carro de 6–7 lugares);
 *  - acréscimos: tarifa dinâmica (hora de ponta / muita procura), taxa de recolha e paragens adicionais.
 * O preço é combinado ANTES da viagem (o cliente sabe quanto paga); só a espera pode somar no fim.
 */

export const CATEGORY_ORDER: RideCategory[] = ["moto", "economy", "comfort", "xl"];

export interface Tariff { minFare: number; includedKm: number; includedMin: number; perKm: number; perMin: number; waitFreeMin: number; waitPerMin: number; stopFee: number }

const COMFORT_PLUS = { minFare: 818.75, includedKm: 2.5, includedMin: 5.8, perKm: 127.5, perMin: 60, waitFreeMin: 5, waitPerMin: 72.5 };

/** Tarifas de referência (Yango Luanda), antes do desconto PedeJá. */
export function referenceTariff(c: RideCategory): Tariff {
  switch (c) {
    case "moto": // Bikes Premium
      return { minFare: 325, includedKm: 2, includedMin: 5.5, perKm: 58, perMin: 16, waitFreeMin: 3, waitPerMin: 35, stopFee: 50 };
    case "comfort":
      return { minFare: 724.5, includedKm: 2.5, includedMin: 6, perKm: 113.85, perMin: 50.6, waitFreeMin: 5, waitPerMin: 45, stopFee: 100 };
    case "xl": {
      const f = config.taxiXlFactor;
      return { ...COMFORT_PLUS, minFare: COMFORT_PLUS.minFare * f, perKm: COMFORT_PLUS.perKm * f, perMin: COMFORT_PLUS.perMin * f, waitPerMin: COMFORT_PLUS.waitPerMin * f, stopFee: 150 };
    }
    default: // Economy
      return { minFare: 655, includedKm: 2.5, includedMin: 5.8, perKm: 102, perMin: 48, waitFreeMin: 5, waitPerMin: 58, stopFee: 100 };
  }
}

const keep = () => 1 - config.taxiDiscountPct / 100;

/** Tarifa PedeJá da categoria (referência com o desconto), arredondada ao Kz para mostrar ao cliente. */
export function tariffFor(c: RideCategory): Tariff {
  const r = referenceTariff(c), k = keep();
  return {
    minFare: Math.round(r.minFare * k), includedKm: r.includedKm, includedMin: r.includedMin,
    perKm: Math.round(r.perKm * k), perMin: Math.round(r.perMin * k),
    waitFreeMin: r.waitFreeMin, waitPerMin: Math.round(r.waitPerMin * k), stopFee: Math.round(r.stopFee * k),
  };
}

/** Velocidade média estimada (a mota anda mais no trânsito de Luanda). */
export function speedKmh(c: RideCategory) {
  return c === "moto" ? config.taxiSpeedKmh * 1.25 : config.taxiSpeedKmh;
}

/** km de estrada do percurso: partida → paragens → destino. */
export function routeKm(pickup: RidePlace, dropoff: RidePlace, stops: RidePlace[] = []) {
  const pts = [pickup, ...stops, dropoff];
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += roadKm(pts[i - 1], pts[i]);
  return Math.round(km * 10) / 10;
}

export function estMinutes(km: number, c: RideCategory) {
  return Math.round((km / speedKmh(c)) * 60 * 10) / 10;
}

const roundUp = (n: number, step: number) => (step > 0 ? Math.ceil(n / step - 1e-9) * step : Math.round(n));
const roundDown = (n: number, step: number) => (step > 0 ? Math.floor(n / step + 1e-9) * step : Math.round(n));

/** Preço da referência (Yango) para a mesma viagem, arredondado para cima a 50 Kz. */
export function referenceFare(input: { category: RideCategory; km: number; minutes: number; surge?: number; stops?: number }) {
  const r = referenceTariff(input.category);
  const km = Math.max(0, input.km), minutes = Math.max(0, input.minutes);
  const base = r.minFare + Math.max(0, km - r.includedKm) * r.perKm + Math.max(0, minutes - r.includedMin) * r.perMin;
  const surge = Math.max(1, input.surge ?? 1);
  const raw = base * surge + Math.max(0, input.stops ?? 0) * r.stopFee + config.taxiPickupFee / keep();
  return roundUp(raw, config.taxiRoundTo);
}

/** Preço de uma viagem (antes da espera). */
export function fareFor(input: { category: RideCategory; km: number; minutes: number; surge?: number; stops?: number }): FareDetail {
  const t = tariffFor(input.category);
  const km = Math.max(0, input.km), minutes = Math.max(0, input.minutes);
  const distance = Math.round(Math.max(0, km - t.includedKm) * t.perKm);
  const time = Math.round(Math.max(0, minutes - t.includedMin) * t.perMin);
  const base = t.minFare + distance + time;
  const surge = Math.max(1, input.surge ?? 1);
  const surgeAmount = Math.round(base * (surge - 1));
  const stops = Math.max(0, input.stops ?? 0);
  const stopFee = stops * t.stopFee;
  const pickupFee = Math.round(config.taxiPickupFee);
  const raw = base + surgeAmount + stopFee + pickupFee;
  const total = roundDown(referenceFare(input) * keep(), config.taxiRoundTo);
  return {
    category: input.category, km, minutes, minFare: t.minFare, includedKm: t.includedKm, includedMin: t.includedMin,
    perKm: t.perKm, perMin: t.perMin, distance, time, surge, surgeAmount, pickupFee, stops, stopFee, rounding: total - raw, total,
  };
}

/** Espera na recolha: grátis nos primeiros minutos, depois por minuto (contado ao segundo, arredondado a 10 Kz). */
export function waitFeeFor(waitMinutes: number, category: RideCategory = "economy") {
  const t = tariffFor(category);
  const paid = Math.max(0, waitMinutes - t.waitFreeMin);
  return Math.round((paid * t.waitPerMin) / 10) * 10;
}

/** Hora de ponta em Luanda (UTC+1): dias úteis 06:30–09:00 e 16:30–19:30. */
export function isPeak(at: Date) {
  const lu = new Date(at.getTime() + 3_600_000);
  const day = lu.getUTCDay();
  if (day === 0 || day === 6) return false;
  const m = lu.getUTCHours() * 60 + lu.getUTCMinutes();
  return (m >= 390 && m < 540) || (m >= 990 && m < 1170);
}

/** Multiplicador da tarifa dinâmica: o maior entre hora de ponta e procura (pedidos à espera vs motoristas livres). */
export function surgeFrom(at: Date, waiting: number, free: number) {
  if (!config.taxiSurge) return 1;
  const busy = busyLevelFrom(waiting, free);
  const demand = busy === 2 ? config.taxiVeryBusyMult : busy === 1 ? config.taxiBusyMult : 1;
  const peak = isPeak(at) ? config.taxiPeakMult : 1;
  return Math.max(1, demand, peak);
}

/** Procura agora, por categoria: viagens à procura de motorista vs motoristas de táxi livres. */
export async function currentSurge(db: DbOrTx, category: RideCategory, at = new Date()) {
  if (!config.taxiSurge) return 1;
  const r = await db.execute(sql`
    select
      (select count(*) from rides where status = 'searching' and category = ${category}
         and created_at > now() - interval '30 minutes')::int as waiting,
      (select count(*) from driver_presence p join users u on u.id = p.user_id join taxi_drivers td on td.user_id = u.id
         where u.user_type = 'taxi' and p.is_online and u.is_active and u.is_approved and td.category = ${category}
           and (p.location_at is null or p.location_at > now() - make_interval(mins => ${config.presenceStaleMin}))
           and not exists (select 1 from rides x where x.driver_id = u.id and x.status in ('accepted','arrived','in_progress')))::int as free`);
  const row = r.rows[0] as { waiting: number; free: number };
  return surgeFrom(at, row.waiting, row.free);
}

/** Divisão no fim da viagem: comissão PedeJá sobre o preço + espera; a gorjeta é 100% do motorista. */
export function splitRide(r: { fare: number; waitFee: number; tip: number; cancelFee?: number }, pct = config.taxiCommissionPct) {
  const gross = r.fare + r.waitFee + (r.cancelFee ?? 0);
  const commission = Math.round((gross * pct) / 100);
  return { gross, commission, driverEarning: gross - commission + r.tip };
}
