import { sql } from "drizzle-orm";
import type { DbOrTx } from "../db";
import { config } from "../config";
import type { FareDetail, RideCategory, RidePlace } from "@shared/schema";
import { busyLevelFrom, roadKm } from "./fees";

/**
 * Preço das viagens de táxi (estilo DiDi), em Kz. Funções puras, testadas em tests/taxi.unit.test.ts.
 *
 * Categoria Económica (tabela do dono):
 *  - tarifa mínima 455 Kz, que já inclui os primeiros 2,5 km e 5,8 min;
 *  - 80 Kz por km depois dos km incluídos (cidade e subúrbios);
 *  - 48 Kz por minuto de trajecto depois dos minutos incluídos;
 *  - espera na recolha: 10 min grátis, depois 40 Kz/min (somada no fim da viagem);
 *  - acréscimos: tarifa dinâmica (hora de ponta / muita procura), taxa de recolha, paragens adicionais
 *    e arredondamento para cima em múltiplos de 50 Kz.
 * As outras categorias (Mota, Conforto, XL) multiplicam os valores em dinheiro da Económica.
 * O preço é combinado ANTES da viagem (o cliente sabe quanto paga); só a espera pode somar no fim.
 */

export const CATEGORY_ORDER: RideCategory[] = ["moto", "economy", "comfort", "xl"];

export function categoryFactor(c: RideCategory) {
  return c === "moto" ? config.taxiFactorMoto : c === "comfort" ? config.taxiFactorComfort : c === "xl" ? config.taxiFactorXl : 1;
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

const roundUp = (n: number, step: number) => (step > 0 ? Math.ceil(n / step) * step : Math.round(n));

/** Preço de uma viagem (antes da espera). */
export function fareFor(input: { category: RideCategory; km: number; minutes: number; surge?: number; stops?: number }): FareDetail {
  const f = categoryFactor(input.category);
  const minFare = Math.round(config.taxiMinFare * f);
  const perKm = Math.round(config.taxiPerKm * f);
  const perMin = Math.round(config.taxiPerMin * f);
  const km = Math.max(0, input.km), minutes = Math.max(0, input.minutes);
  const distance = Math.round(Math.max(0, km - config.taxiIncludedKm) * perKm);
  const time = Math.round(Math.max(0, minutes - config.taxiIncludedMin) * perMin);
  const base = minFare + distance + time;
  const surge = Math.max(1, input.surge ?? 1);
  const surgeAmount = Math.round(base * (surge - 1));
  const stops = Math.max(0, input.stops ?? 0);
  const stopFee = stops * Math.round(config.taxiStopFee * f);
  const pickupFee = Math.round(config.taxiPickupFee * f);
  const raw = base + surgeAmount + stopFee + pickupFee;
  const total = roundUp(raw, config.taxiRoundTo);
  return {
    category: input.category, km, minutes, minFare, includedKm: config.taxiIncludedKm, includedMin: config.taxiIncludedMin,
    perKm, perMin, distance, time, surge, surgeAmount, pickupFee, stops, stopFee, rounding: total - raw, total,
  };
}

/** Espera na recolha: grátis nos primeiros minutos, depois por minuto (contado ao segundo, arredondado a 10 Kz). */
export function waitFeeFor(waitMinutes: number, category: RideCategory = "economy") {
  const paid = Math.max(0, waitMinutes - config.taxiWaitFreeMin);
  return Math.round((paid * config.taxiWaitPerMin * categoryFactor(category)) / 10) * 10;
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
