/**
 * Contas das taxas e do pagamento aos estafetas (funções puras).
 * Correr: DATABASE_URL=postgres://... npx tsx tests/fees.unit.test.ts
 */
import {
  busyLevelFrom, customerDeliveryFee, instantCashoutFee, nextPayday, riderPayFor, serviceFeeFor, smallOrderFeeFor,
  timeBand, waitFeeFor, weekStartLuanda,
} from "../server/lib/fees";
import { splitOrder } from "../server/lib/settlement";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`);
}
// 10:00 de Luanda numa quarta (09:00 UTC) = hora normal
const NORMAL = new Date("2026-11-25T09:00:00Z");

// --- exemplo do dono: 10 000 Kz de comida
const ex = splitOrder({ subtotal: 10000, deliveryFee: 1000, serviceFee: 500, smallOrderFee: 0, priorityFee: 0, discount: 0, riderTip: 0, total: 11500, riderPay: 1800, riderWaitFee: 0 }, 30);
check("example: customer 11 500 = restaurant 7 000 + rider 1 800 + PedeJá 2 700", ex.storeEarning === 7000 && ex.riderEarning === 1800 && ex.platform === 2700 && ex.storeEarning + ex.riderEarning + ex.platform === 11500, ex);
const ex20 = splitOrder({ subtotal: 10000, deliveryFee: 1000, serviceFee: 500, smallOrderFee: 0, priorityFee: 0, discount: 0, riderTip: 300, total: 11800, riderPay: 1800, riderWaitFee: 0 }, 20);
check("default 20%: restaurant 8 000, rider 1 800 + 300 tip, PedeJá 1 700; everything adds up", ex20.storeEarning === 8000 && ex20.riderEarning === 2100 && ex20.platform === 1700 && ex20.storeEarning + ex20.riderEarning + ex20.platform === 11800, ex20);

// --- cliente
check("service fee 5%: 10 000 -> 500", serviceFeeFor(10000) === 500);
check("service fee minimum 150", serviceFeeFor(500) === 150);
check("service fee maximum 2 500", serviceFeeFor(200000) === 2500);
check("small order: 3 000 with 5 000 minimum -> 2 000", smallOrderFeeFor(3000, 5000) === 2000);
check("no small-order fee at/above minimum", smallOrderFeeFor(5000, 5000) === 0 && smallOrderFeeFor(9000, 0) === 0);
check("delivery 4 km -> 1 000 Kz", customerDeliveryFee(4, 0, 1234) === 1000, customerDeliveryFee(4, 0, 1234));
check("delivery minimum 500 Kz", customerDeliveryFee(0.3, 0, 1234) === 500);
check("delivery maximum 3 500 Kz", customerDeliveryFee(60, 0, 1234) === 3500);
check("no coordinates -> store's own fee", customerDeliveryFee(null, 0, 1200) === 1200);
check("busy +20%, very busy +40%", customerDeliveryFee(4, 1, 0) === 1200 && customerDeliveryFee(4, 2, 0) === 1400, [customerDeliveryFee(4, 1, 0), customerDeliveryFee(4, 2, 0)]);
check("busy levels from waiting orders vs free riders", busyLevelFrom(0, 3) === 0 && busyLevelFrom(1, 0) === 0 && busyLevelFrom(3, 2) === 1 && busyLevelFrom(5, 1) === 2 && busyLevelFrom(4, 3) === 1);

// --- estafeta
const moto = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: NORMAL, busy: 0 });
check("moto, 2 km + 4 km, normal hour -> ~1 800 Kz", moto.total === 1800 && moto.base === 600 && moto.distance === 1200, moto);
const car = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "car", at: NORMAL, busy: 0 });
const bike = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "bike", at: NORMAL, busy: 0 });
check("car pays more than moto, bike less", car.total > moto.total && bike.total < moto.total, [car.total, moto.total, bike.total]);
const night = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: new Date("2026-11-25T22:30:00Z"), busy: 0 });
check("night (23:30 Luanda) +20%", night.band === "night" && night.timeBonus === 360 && night.total === 2160, night);
const peak = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: new Date("2026-11-25T11:30:00Z"), busy: 2 });
check("lunch peak +10% and very busy +30%", peak.band === "peak" && peak.timeBonus === 180 && peak.busyBonus === 540, peak);
const slow = riderPayFor({ pickupKm: 0.2, dropKm: 0.3, vehicle: "car", at: NORMAL, busy: 0 });
check("hourly floor tops up very short jobs (car 2 400 Kz/h)", slow.floorTopUp >= 0 && slow.total >= Math.round(2400 * slow.estMinutes / 60), slow);
const noGps = riderPayFor({ pickupKm: null, dropKm: null, vehicle: null, at: NORMAL, busy: 0 });
check("no GPS: assumes 2 km + 4 km on a moto", noGps.vehicle === "moto" && noGps.pickupKm === 2 && noGps.dropKm === 4);
check("time bands", timeBand(new Date("2026-11-25T04:00:00Z")) === "night" && timeBand(new Date("2026-11-25T18:30:00Z")) === "peak" && timeBand(NORMAL) === "normal");

// --- espera na loja
const t0 = new Date("2026-11-25T09:00:00Z");
const after = (min: number) => new Date(t0.getTime() + min * 60_000);
check("wait: first 5 min free", waitFeeFor(t0, after(5)) === 0);
check("wait: 12 min -> 7 paid min × 30 = 210 Kz", waitFeeFor(t0, after(12)) === 210, waitFeeFor(t0, after(12)));
check("wait: counted by the second (5.5 min -> 15 Kz)", waitFeeFor(t0, after(5.5)) === 15);
check("wait: capped at 30 paid minutes (900 Kz)", waitFeeFor(t0, after(120)) === 900);
check("wait: never arrived -> 0", waitFeeFor(null, after(20)) === 0);

// --- pagamentos
check("instant cash-out fee 2%, minimum 200", instantCashoutFee(5000) === 200 && instantCashoutFee(50000) === 1000);
const wed = new Date("2026-11-25T12:00:00Z"); // quarta
check("week starts Monday 00:00 Luanda (Sunday 23:00 UTC)", weekStartLuanda(wed).toISOString() === "2026-11-22T23:00:00.000Z", weekStartLuanda(wed));
check("next payday from Wednesday = Tuesday 1 Dec (Luanda)", nextPayday(wed).toISOString() === "2026-11-30T23:00:00.000Z", nextPayday(wed));
check("on Tuesday the payday is today", nextPayday(new Date("2026-12-01T10:00:00Z")).toISOString() === "2026-11-30T23:00:00.000Z", nextPayday(new Date("2026-12-01T10:00:00Z")));

console.log(`\n========== FEES SUMMARY: ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
