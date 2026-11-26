/**
 * Comissão por tipo de negócio, plano e artigo (funções puras).
 * Correr: DATABASE_URL=postgres://... npx tsx tests/commission.unit.test.ts
 */
import { commissionRateFor, itemCommissions, planOptionsFor } from "../server/lib/commission";

let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`);
}
const store = (o: Partial<Parameters<typeof commissionRateFor>[0]> = {}) => ({ storeType: "restaurant", plan: "standard" as const, commissionPct: null, counterPrice: false, commissionFreeUntil: null, ...o });

check("restaurant, Standard plan = 20%", commissionRateFor(store(), "delivery") === 20);
check("pharmacy 12%, grocery 15%, fashion/vintage 18%, jewellery 18%",
  commissionRateFor(store({ storeType: "pharmacy" }), "delivery") === 12 && commissionRateFor(store({ storeType: "grocery" }), "delivery") === 15
  && commissionRateFor(store({ storeType: "vintage" }), "delivery") === 18 && commissionRateFor(store({ storeType: "jewelry" }), "delivery") === 18);
check("plans: Basic −5, Featured +5 (restaurant 15 / 20 / 25)",
  commissionRateFor(store({ plan: "basic" }), "delivery") === 15 && commissionRateFor(store({ plan: "featured" }), "delivery") === 25);
check("pickup 9%, own riders 10% (whatever the plan)",
  commissionRateFor(store({ plan: "featured" }), "pickup") === 9 && commissionRateFor(store({ plan: "basic" }), "store_delivery") === 10);
check("same price as in store: −2 points (restaurant 18%, pickup 7%)",
  commissionRateFor(store({ counterPrice: true }), "delivery") === 18 && commissionRateFor(store({ counterPrice: true }), "pickup") === 7);
check("negotiated commission replaces type + plan", commissionRateFor(store({ commissionPct: 14, plan: "featured" }), "delivery") === 14);
const now = new Date("2026-11-26T12:00:00Z");
check("first month free: 0% until the date, then normal",
  commissionRateFor(store({ commissionFreeUntil: new Date("2026-12-20T00:00:00Z") }), "delivery", now) === 0
  && commissionRateFor(store({ commissionFreeUntil: new Date("2026-11-01T00:00:00Z") }), "delivery", now) === 20);
check("never below 0", commissionRateFor(store({ storeType: "pharmacy", plan: "basic", counterPrice: true, commissionPct: 1 }), "delivery") === 0);

const ic = itemCommissions([{ unitPrice: 4500, quantity: 1 }, { unitPrice: 750, quantity: 3 }, { unitPrice: 333, quantity: 1 }], 20);
check("commission per item: 900 + 450 + 67 = 1 417", ic.lines.map((l) => l.commissionAmount).join() === "900,450,67" && ic.total === 1417, ic);
const med = itemCommissions([{ unitPrice: 2500, quantity: 2 }], 12);
check("medicine 2 × 2 500 at 12% = 600", med.total === 600, med);
const o = planOptionsFor({ storeType: "pharmacy", counterPrice: false });
check("plan options for a pharmacy: 7 / 12 / 17", o.basic === 7 && o.standard === 12 && o.featured === 17, o);

console.log(`\n========== COMMISSION SUMMARY: ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
