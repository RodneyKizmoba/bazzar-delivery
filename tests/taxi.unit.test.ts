/**
 * Preços do táxi (funções puras): tarifas da Yango Luanda com 5% a menos (calibração do dono).
 * Correr: DATABASE_URL=postgres://... TAXI_SURGE=1 npx tsx tests/taxi.unit.test.ts
 */
import { fareFor, isPeak, referenceFare, splitRide, surgeFrom, tariffFor, waitFeeFor } from "../server/lib/taxiFares";
import type { RideCategory } from "../shared/schema";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`);
}
const mins = (c: RideCategory, km: number) => km * (c === "moto" ? 2.4 : 3);
const CATS: RideCategory[] = ["moto", "economy", "comfort", "xl"];

// --- Económica = Yango Economy (655 mín., 2,5 km e 5,8 min incluídos, 102 Kz/km, 48 Kz/min) com −5%
const eco = tariffFor("economy");
check("economy tariff = Yango −5%: 622 min, 97 Kz/km, 46 Kz/min, 5 min free wait then 55 Kz/min",
  eco.minFare === 622 && eco.perKm === 97 && eco.perMin === 46 && eco.includedKm === 2.5 && eco.includedMin === 5.8 && eco.waitFreeMin === 5 && eco.waitPerMin === 55, eco);
const short = fareFor({ category: "economy", km: 2, minutes: 5 });
check("short trip inside the minimum (2 km, 5 min): Yango 700 → PedeJá 650", short.distance === 0 && short.time === 0 && referenceFare({ category: "economy", km: 2, minutes: 5 }) === 700 && short.total === 650, short);

// --- tabela de 6 km (igual à folha de cálculo de calibração)
const six = Object.fromEntries(CATS.map((c) => [c, fareFor({ category: c, km: 6, minutes: mins(c, 6) }).total]));
check("6 km: moto 650, economy 1 500, comfort 1 650, XL 2 050 (as in the pricing sheet)", six.moto === 650 && six.economy === 1500 && six.comfort === 1650 && six.xl === 2050, six);

// --- sempre ≥ 5% abaixo da referência, em múltiplos de 50
const grid = CATS.flatMap((c) => [1, 2, 3.3, 4, 6, 7.7, 10, 12.1, 15, 25].map((km) => ({ c, km, y: referenceFare({ category: c, km, minutes: mins(c, km) }), p: fareFor({ category: c, km, minutes: mins(c, km) }).total })));
check("every price is a multiple of 50 Kz", grid.every((g) => g.p % 50 === 0), grid.filter((g) => g.p % 50));
check("every price is at least 5% below the Yango price", grid.every((g) => g.p <= g.y * 0.95 + 1e-9), grid.filter((g) => g.p > g.y * 0.95));
check("…and never more than ~5% + 50 Kz below it (no needless discount)", grid.every((g) => g.p > g.y * 0.95 - 50), grid.filter((g) => g.p <= g.y * 0.95 - 50));

// --- acréscimos
const ten = fareFor({ category: "economy", km: 10, minutes: 30 });
check("10 km / 30 min economy = 2 450 (Yango 2 600)", ten.total === 2450 && referenceFare({ category: "economy", km: 10, minutes: 30 }) === 2600, ten);
const surged = fareFor({ category: "economy", km: 10, minutes: 30, surge: 1.5 });
check("dynamic pricing ×1.5 = 3 700", surged.surgeAmount > 0 && surged.total === 3700, surged);
const stops = fareFor({ category: "economy", km: 10, minutes: 30, stops: 2 });
check("2 extra stops add the stop fee twice", stops.stopFee === 2 * eco.stopFee && stops.total === 2650, stops);

// --- espera: Económica 5 min grátis, depois 55 Kz/min; Mota 3 min grátis
check("economy waiting 5 min = free", waitFeeFor(5) === 0);
check("economy waiting 10 min = 5 × 55 = 280 Kz (to 10 Kz)", waitFeeFor(10) === 280, waitFeeFor(10));
check("moto: 3 min free, then 33 Kz/min", waitFeeFor(3, "moto") === 0 && waitFeeFor(5, "moto") === 70, waitFeeFor(5, "moto"));

// --- categorias
check("XL (no Yango XL in Luanda) = Comfort+ × 1.1 −5%: 856 min", tariffFor("xl").minFare === 856, tariffFor("xl"));
const motoT = fareFor({ category: "moto", km: 10, minutes: 24 }), xlT = fareFor({ category: "xl", km: 10, minutes: 30 });
check("same trip: moto < economy < comfort < XL", motoT.total < ten.total && ten.total < fareFor({ category: "comfort", km: 10, minutes: 30 }).total && fareFor({ category: "comfort", km: 10, minutes: 30 }).total < xlT.total);

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
