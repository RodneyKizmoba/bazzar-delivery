/**
 * Preços do táxi (funções puras): tabela da categoria Económica do dono.
 * Correr: DATABASE_URL=postgres://... TAXI_SURGE=1 npx tsx tests/taxi.unit.test.ts
 */
import { categoryFactor, fareFor, isPeak, splitRide, surgeFrom, waitFeeFor } from "../server/lib/taxiFares";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`);
}

// --- Económica: tarifa mínima 455 Kz já inclui 2,5 km e 5,8 min
const short = fareFor({ category: "economy", km: 2, minutes: 5 });
check("short trip inside the minimum (2 km, 5 min) = 455 Kz rounded up to 500", short.minFare === 455 && short.distance === 0 && short.time === 0 && short.total === 500, short);
const edge = fareFor({ category: "economy", km: 2.5, minutes: 5.8 });
check("exactly 2.5 km and 5.8 min: still only the minimum fare", edge.distance === 0 && edge.time === 0 && edge.total === 500, edge);
// 10 km, 30 min: 455 + 7,5×80 (600) + 24,2×48 (1 161,6 → 1 162) = 2 217 → 2 250
const ten = fareFor({ category: "economy", km: 10, minutes: 30 });
check("10 km / 30 min: 455 + 600 (80 Kz/km after 2.5 km) + 1 162 (48 Kz/min after 5.8 min) = 2 217 → 2 250", ten.distance === 600 && ten.time === 1162 && ten.total === 2250 && ten.rounding === 33, ten);
check("price is always a multiple of 50 Kz, rounded UP", [1, 3.3, 7.7, 12.1, 25].every((km) => { const f = fareFor({ category: "economy", km, minutes: km * 3 }); return f.total % 50 === 0 && f.total >= f.total - f.rounding && f.rounding >= 0 && f.rounding < 50; }));

// --- acréscimos
const surged = fareFor({ category: "economy", km: 10, minutes: 30, surge: 1.5 });
check("dynamic pricing ×1.5 on the fare (before rounding)", surged.surgeAmount === Math.round(2217 * 0.5) && surged.total === 3350, surged);
const stops = fareFor({ category: "economy", km: 10, minutes: 30, stops: 2 });
check("2 extra stops add the stop fee twice", stops.stopFee === 200 && stops.total === 2450, stops);

// --- espera: 10 min grátis, depois 40 Kz/min
check("waiting 8 min = free", waitFeeFor(8) === 0);
check("waiting 10 min = free", waitFeeFor(10) === 0);
check("waiting 15 min = 5 × 40 = 200 Kz", waitFeeFor(15) === 200, waitFeeFor(15));
check("waiting 12.5 min = 2.5 × 40 = 100 Kz", waitFeeFor(12.5) === 100, waitFeeFor(12.5));

// --- outras categorias multiplicam a Económica
check("Moto cheaper, Comfort and XL dearer", categoryFactor("moto") < 1 && categoryFactor("comfort") > 1 && categoryFactor("xl") > categoryFactor("comfort"));
const moto = fareFor({ category: "moto", km: 10, minutes: 30 }), xl = fareFor({ category: "xl", km: 10, minutes: 30 });
check("same trip: moto < economy < XL", moto.total < ten.total && ten.total < xl.total, { moto: moto.total, eco: ten.total, xl: xl.total });

// --- tarifa dinâmica: hora de ponta (dias úteis) e procura
const wedPeak = new Date("2026-11-25T07:00:00Z"); // 08:00 em Luanda, quarta
const wedCalm = new Date("2026-11-25T10:00:00Z"); // 11:00
const sat = new Date("2026-11-28T07:00:00Z"); // sábado 08:00
check("peak: weekday 08:00 yes, 11:00 no, Saturday no", isPeak(wedPeak) && !isPeak(wedCalm) && !isPeak(sat));
check("surge: calm = 1, peak hour = 1.2, very busy = 1.5", surgeFrom(wedCalm, 0, 5) === 1 && surgeFrom(wedPeak, 0, 5) === 1.2 && surgeFrom(wedCalm, 8, 2) === 1.5,
  [surgeFrom(wedCalm, 0, 5), surgeFrom(wedPeak, 0, 5), surgeFrom(wedCalm, 8, 2)]);

// --- comissão PedeJá 10%
const split = splitRide({ fare: 2250, waitFee: 200, tip: 300 });
check("10% commission on fare + wait; tip 100% to the driver", split.commission === 245 && split.driverEarning === 2250 + 200 - 245 + 300, split);

console.log(`\n========== TAXI FARES SUMMARY: ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
