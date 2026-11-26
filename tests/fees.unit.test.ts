/**
 * Contas das taxas e do pagamento aos estafetas (funções puras).
 * Correr: DATABASE_URL=postgres://... npx tsx tests/fees.unit.test.ts
 */
import {
  busyLevelFrom, calibratedDeliveryFee, customerDeliveryFee, referenceDeliveryFee, instantCashoutFee, nextPayday, riderPayFor, serviceFeeFor, smallOrderFeeFor,
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
check("delivery = Yango moto delivery −5%: 2 km 300, 4 km 500, 6 km 650, 10 km 1 000, 15 km 1 500",
  [2, 4, 6, 10, 15].map((k) => customerDeliveryFee(k, 0, 1234)).join() === "300,500,650,1000,1500", [2, 4, 6, 10, 15].map((k) => customerDeliveryFee(k, 0, 1234)));
check("delivery always ≥ 5% below the reference, in multiples of 50",
  [0.3, 1, 3.3, 5, 7.7, 12, 25, 40].every((k) => { const p = calibratedDeliveryFee(k), y = referenceDeliveryFee(k); return p % 50 === 0 && p <= y * 0.95 && p > y * 0.95 - 50; }));
check("large parcels use the car rate: 6 km 1 350 (reference 1 450)", calibratedDeliveryFee(6, "car") === 1350 && referenceDeliveryFee(6, "car") === 1450);
check("no coordinates -> store's own fee", customerDeliveryFee(null, 0, 1200) === 1200);
check("busy +20%, very busy +40% (4 km: 500 → 600 / 700)", customerDeliveryFee(4, 1, 0) === 600 && customerDeliveryFee(4, 2, 0) === 700, [customerDeliveryFee(4, 1, 0), customerDeliveryFee(4, 2, 0)]);
check("busy levels from waiting orders vs free riders", busyLevelFrom(0, 3) === 0 && busyLevelFrom(1, 0) === 0 && busyLevelFrom(3, 2) === 1 && busyLevelFrom(5, 1) === 2 && busyLevelFrom(4, 3) === 1);

// --- estafeta
const moto = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: NORMAL, busy: 0, noFloor: true });
check("moto, 4 km delivery, normal hour -> 88% of the 500 Kz fee = 440 Kz", moto.total === 440 && moto.base === 260 && moto.distance === 180, moto);
const six = riderPayFor({ pickupKm: 2, dropKm: 6, vehicle: "moto", at: NORMAL, busy: 0, noFloor: true });
check("moto, 6 km -> 88% of 650 = 572 → 570 Kz (as in the pricing sheet)", six.total === 570, six);
const car = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "car", at: NORMAL, busy: 0, noFloor: true });
const bike = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "bike", at: NORMAL, busy: 0, noFloor: true });
check("car pays more than moto, bike less", car.total > moto.total && bike.total < moto.total, [car.total, moto.total, bike.total]);
const big = riderPayFor({ pickupKm: 2, dropKm: 6, vehicle: "car", at: NORMAL, busy: 0, rate: "car" });
check("large parcel (car rate), 6 km -> 88% of 1 350 ≈ 1 190 Kz", big.total === 1190, big);
const night = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: new Date("2026-11-25T22:30:00Z"), busy: 0, noFloor: true });
check("night (23:30 Luanda) +20%", night.band === "night" && night.timeBonus === 90 && night.total === 530, night);
const peak = riderPayFor({ pickupKm: 2, dropKm: 4, vehicle: "moto", at: new Date("2026-11-25T11:30:00Z"), busy: 2, noFloor: true });
check("lunch peak +10% and very busy +30%", peak.band === "peak" && peak.timeBonus === 40 && peak.busyBonus === 130, peak);
const floored = riderPayFor({ pickupKm: 2, dropKm: 6, vehicle: "moto", at: NORMAL, busy: 0 });
check("hourly floor 1 500 Kz/h on delivery time: 6 km (28 min) moto -> 700 Kz (570 + 130 top-up)", floored.estMinutes === 28 && floored.floorTopUp === 130 && floored.total === 700, floored);
const carFloor = riderPayFor({ pickupKm: 0.2, dropKm: 0.3, vehicle: "car", at: NORMAL, busy: 0 });
check("car floor in proportion (2 000 Kz/h)", carFloor.total >= Math.round((2000 * carFloor.estMinutes) / 60), carFloor);
check("no floor when asked (parcels)", riderPayFor({ pickupKm: 2, dropKm: 6, vehicle: "moto", at: NORMAL, busy: 0, noFloor: true }).floorTopUp === 0);
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
check("instant cash-out fee 1%, minimum 200", instantCashoutFee(5000) === 200 && instantCashoutFee(50000) === 500);
const wed = new Date("2026-11-25T12:00:00Z"); // quarta
check("week starts Monday 00:00 Luanda (Sunday 23:00 UTC)", weekStartLuanda(wed).toISOString() === "2026-11-22T23:00:00.000Z", weekStartLuanda(wed));
check("next payday from Wednesday = Tuesday 1 Dec (Luanda)", nextPayday(wed).toISOString() === "2026-11-30T23:00:00.000Z", nextPayday(wed));
check("on Tuesday the payday is today", nextPayday(new Date("2026-12-01T10:00:00Z")).toISOString() === "2026-11-30T23:00:00.000Z", nextPayday(new Date("2026-12-01T10:00:00Z")));

console.log(`\n========== FEES SUMMARY: ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
