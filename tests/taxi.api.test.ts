/**
 * Táxi de ponta a ponta pela API (servidor de testes com a base de demonstração acabada de criar).
 * Correr: TAXI_SURGE=0 DISPATCH_TICK_MS=500 ADMIN_REQUIRE_2FA=0 AUTH_RATE_LIMIT=60 bash scripts/local-server.sh
 *         npx tsx tests/taxi.api.test.ts
 */
const BASE = process.env.BASE || "http://localhost:5055";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) pass++; else fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)?.slice(0, 400)}`);
}

class Client {
  cookie = "";
  async req(method: string, path: string, body?: unknown) {
    const h: Record<string, string> = { Origin: BASE };
    if (this.cookie) h.cookie = this.cookie;
    if (body !== undefined) h["Content-Type"] = "application/json";
    const res = await fetch(BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
    for (const c of res.headers.getSetCookie?.() ?? []) if (c.startsWith("pedeja.sid=")) this.cookie = c.split(";")[0];
    const text = await res.text();
    let b: any = null; try { b = text ? JSON.parse(text) : null; } catch { b = text; }
    return { status: res.status, body: b };
  }
  get(p: string) { return this.req("GET", p); }
  post(p: string, b: unknown = {}) { return this.req("POST", p, b); }
  async login(u: string, pw: string) { const r = await this.post("/api/auth/login", { username: u, password: pw }); if (r.status !== 200) throw new Error(`login ${u}: ${r.status}`); return r.body.user; }
}

const BELAS = { label: "Belas Shopping", latitude: -8.918, longitude: 13.183, zone: "Talatona" };
const MARGINAL = { label: "Marginal", latitude: -8.812, longitude: 13.234, zone: "Ingombota" };
const trip = { pickup: BELAS, dropoff: MARGINAL, stops: [] };

async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(300); }
  return null;
}

async function main() {
  const anon = new Client();
  const cust = new Client(); await cust.login("cliente", "Cliente#2026");
  const cust2 = new Client(); await cust2.login("cliente2", "Cliente#2026");
  const eco = new Client(); const ecoUser = await eco.login("taxista", "Taxista#2026");
  const moto = new Client(); await moto.login("taxista2", "Taxista#2026");
  const rider = new Client(); await rider.login("estafeta", "Estafeta#2026");
  const admin = new Client(); await admin.login("admin", "Admin#2026demo");

  // --- preços
  const q = await anon.post("/api/taxi/quote", trip);
  const cats = q.body?.options?.map((o: any) => o.category);
  check("quote: 4 categories (moto, economy, comfort, xl), no login needed", q.status === 200 && JSON.stringify(cats) === JSON.stringify(["moto", "economy", "comfort", "xl"]), q.body);
  const ecoOpt = q.body.options.find((o: any) => o.category === "economy");
  check("quote: economy = Yango −5% (622 min, 97 Kz/km, 46 Kz/min), multiple of 50, 5 min free wait", ecoOpt.fare % 50 === 0 && ecoOpt.fare >= 600 && ecoOpt.detail.minFare === 622 && ecoOpt.detail.perKm === 97 && ecoOpt.detail.perMin === 46 && ecoOpt.waitFreeMin === 5 && ecoOpt.waitPerMin === 55, ecoOpt);
  const same = await anon.post("/api/taxi/quote", { pickup: BELAS, dropoff: BELAS, stops: [] });
  check("quote: same pickup and destination is refused", same.status === 400 && same.body.code === "SAME_PLACE", same.body);

  // --- quem pode pedir
  check("request without login → 401", (await anon.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "cash" })).status === 401);
  check("delivery rider can't request a taxi (passenger accounts only)", (await rider.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "cash" })).status === 403);
  check("delivery rider can't use the taxi driver app", (await rider.get("/api/taxi/driver/current")).status === 403);
  check("taxi driver can't use the delivery rider app (separate accounts)", (await eco.get("/api/driver/current")).status === 403);

  // --- motoristas online
  await eco.post("/api/taxi/driver/presence", { online: true, latitude: -8.915, longitude: 13.185 });
  await moto.post("/api/taxi/driver/presence", { online: true, latitude: -8.9185, longitude: 13.1832 }); // mais perto, mas é mota
  const q2 = await anon.post("/api/taxi/quote", trip);
  check("quote shows a nearby economy driver", q2.body.options.find((o: any) => o.category === "economy").driversNearby === 1, q2.body.options);

  // --- 1.ª viagem: pedir e cancelar
  let r = await cust.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "cash" });
  check("request ride → searching, with a 4-digit code for the passenger", r.status === 201 && r.body.ride.status === "searching" && /^\d{4}$/.test(r.body.ride.pin), r.body);
  const ride1 = r.body.ride;
  check("fare is fixed at request = quoted price", ride1.fare === ecoOpt.fare, [ride1.fare, ecoOpt.fare]);
  const twice = await cust.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "cash" });
  check("only one active ride per passenger", twice.status === 409 && twice.body.code === "RIDE_IN_PROGRESS", twice.body);
  const offer1 = await waitFor(async () => (await eco.get("/api/taxi/driver/offers")).body.offer);
  check("offer goes to the economy driver (not to the closer moto driver)", !!offer1 && offer1.ride.id === ride1.id, offer1);
  check("moto driver gets no economy offer", (await moto.get("/api/taxi/driver/offers")).body.offer === null);
  check("offer hides the passenger's phone and code", offer1 && !offer1.ride.customer.phone && !("pin" in offer1.ride), offer1?.ride);
  check("other passengers can't see this ride", (await cust2.get(`/api/taxi/rides/${ride1.id}`)).status === 404);
  const c1 = await cust.post(`/api/taxi/rides/${ride1.id}/cancel`, {});
  check("passenger cancels before a driver accepts: free", c1.status === 200 && c1.body.ride.status === "cancelled" && c1.body.ride.cancelFee === 0, c1.body);
  check("driver's offer disappears after the cancel", (await eco.get("/api/taxi/driver/offers")).body.offer === null);

  // --- 2.ª viagem: completa, em numerário
  r = await cust.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "cash" });
  const ride2 = r.body.ride;
  const offer2 = await waitFor(async () => (await eco.get("/api/taxi/driver/offers")).body.offer);
  const acc = await eco.post(`/api/taxi/driver/offers/${offer2.id}/accept`);
  check("driver accepts → accepted, sees passenger phone and earning (fare − 10%)", acc.status === 200 && acc.body.ride.status === "accepted" && acc.body.ride.customer.phone && acc.body.ride.earning === ride2.fare - Math.round(ride2.fare * 0.1), acc.body);
  const cv = (await cust.get("/api/taxi/rides/current")).body.ride;
  check("passenger sees driver, car, plate and the car on the map", cv.status === "accepted" && cv.driver?.vehicle?.plate === "LD-12-34-AB" && !!cv.driverLocation, cv);
  check("accept twice → error", (await eco.post(`/api/taxi/driver/offers/${offer2.id}/accept`)).status === 409);
  check("can't start before arriving without the code", (await eco.post(`/api/taxi/driver/rides/${ride2.id}/start`, {})).body.code === "PIN_REQUIRED");
  check("arrived", (await eco.post(`/api/taxi/driver/rides/${ride2.id}/arrived`)).body.ride.status === "arrived");
  const bad = await eco.post(`/api/taxi/driver/rides/${ride2.id}/start`, { pin: ride2.pin === "0000" ? "1111" : "0000" });
  check("wrong code is refused and counted", bad.status === 400 && bad.body.code === "BAD_PIN", bad.body);
  check("another driver can't touch this ride", (await moto.post(`/api/taxi/driver/rides/${ride2.id}/complete`)).status === 404);
  const st = await eco.post(`/api/taxi/driver/rides/${ride2.id}/start`, { pin: ride2.pin });
  check("right code → trip starts; short wait = no wait fee", st.status === 200 && st.body.ride.status === "in_progress" && st.body.ride.waitFee === 0, st.body);
  check("passenger can't cancel once the trip has started", (await cust.post(`/api/taxi/rides/${ride2.id}/cancel`, {})).status === 409);
  const sos = await cust.post(`/api/taxi/rides/${ride2.id}/sos`);
  check("SOS is recorded and returns the police number 113", sos.status === 200 && sos.body.sosPhone === "113");
  const done = await eco.post(`/api/taxi/driver/rides/${ride2.id}/complete`);
  check("complete → total = agreed fare; cash to collect = total", done.status === 200 && done.body.ride.status === "completed" && done.body.ride.total === ride2.fare && done.body.ride.collectCash === ride2.fare, done.body);
  const w = (await eco.get("/api/taxi/driver/wallet")).body;
  const commission = Math.round(ride2.fare * 0.1);
  check("wallet: cash in hand = fare; owes PedeJá the 10% commission", w.cashHeld === ride2.fare && w.balance === -commission, { cashHeld: w.cashHeld, balance: w.balance });
  const rate = await cust.post(`/api/taxi/rides/${ride2.id}/rate`, { rating: 5 });
  check("passenger rates the driver", rate.status === 200 && rate.body.ride.rating === 5);
  check("can't rate twice", (await cust.post(`/api/taxi/rides/${ride2.id}/rate`, { rating: 1 })).status === 409);
  const me = (await eco.get("/api/taxi/driver/me")).body.vehicle;
  check("driver rating updated", me.ratingCount === 1 && me.ratingAvg === 5, me);
  const share = await anon.get(`/api/taxi/share/${cv.shareToken}`);
  check("share link works without login and shows no phones or code", share.status === 200 && share.body.ride.driver.firstName === "Domingos" && !JSON.stringify(share.body).includes("+2449") && !JSON.stringify(share.body).includes(ride2.pin), share.body);
  check("bad share link → 404", (await anon.get("/api/taxi/share/nope")).status === 404);

  // --- 3.ª viagem: pago por banco (sandbox), motorista desiste e volta a procurar
  r = await cust.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "multicaixa_express" });
  const ride3 = r.body.ride;
  const offer3 = await waitFor(async () => (await eco.get("/api/taxi/driver/offers")).body.offer);
  await eco.post(`/api/taxi/driver/offers/${offer3.id}/accept`);
  const drop = await eco.post(`/api/taxi/driver/rides/${ride3.id}/cancel`, {});
  const after = (await cust.get("/api/taxi/rides/current")).body.ride;
  check("driver drops the trip → passenger's ride goes back to searching", drop.status === 200 && ["searching", "no_driver"].includes(after.status) && !after.driver, after);
  check("the same driver isn't offered it again", (await eco.get("/api/taxi/driver/offers")).body.offer === null);
  const adm = await admin.get("/api/admin/rides");
  check("admin sees rides, 10% commission and the SOS", adm.status === 200 && adm.body.commissionPct === 10 && adm.body.rides.some((x: any) => x.id === ride2.id && x.sosAt), adm.body.summary);
  const ac = await admin.post(`/api/admin/rides/${ride3.id}/cancel`, { reason: "teste" });
  check("admin can cancel a waiting ride", ac.status === 200 && ac.body.ride.status === "cancelled", ac.body);

  // --- 4.ª viagem: pago por banco, até ao fim
  r = await cust.post("/api/taxi/rides", { ...trip, category: "economy", paymentMethod: "multicaixa_express" });
  const ride4 = r.body.ride;
  // o motorista desistiu da 3.ª: continua online e recebe pedidos novos
  const offer4 = await waitFor(async () => (await eco.get("/api/taxi/driver/offers")).body.offer);
  check("driver gets the next new request", offer4?.ride?.id === ride4.id, offer4);
  await eco.post(`/api/taxi/driver/offers/${offer4.id}/accept`);
  await eco.post(`/api/taxi/driver/rides/${ride4.id}/arrived`);
  await eco.post(`/api/taxi/driver/rides/${ride4.id}/start`, { pin: ride4.pin });
  const d4 = await eco.post(`/api/taxi/driver/rides/${ride4.id}/complete`);
  check("bank payment: nothing to collect in cash", d4.body.ride.collectCash === 0 && d4.body.ride.status === "completed", d4.body);
  const w2 = (await eco.get("/api/taxi/driver/wallet")).body;
  check("wallet after a bank trip: earning added (fare − 10%)", w2.balance === -commission + (ride4.fare - Math.round(ride4.fare * 0.1)), { balance: w2.balance });
  const users = (await admin.get("/api/admin/users?type=taxi")).body.users;
  check("admin users list shows taxi drivers with car and plate; the new one is pending", users.length === 3 && users.some((u: any) => u.username === "taxista3" && !u.isApproved && u.taxi.plate === "LD-55-21-CF"), users.map((u: any) => [u.username, u.isApproved]));

  // --- registo de motorista
  const fresh = new Client();
  const reg = await fresh.post("/api/auth/register", {
    username: `motorista${Date.now() % 100000}`, password: "Teste#2026", fullName: "Novo Motorista", phone: "+244923999999", userType: "taxi",
    taxi: { category: "moto", make: "Honda", model: "CG125", colour: "Preta", plate: "ld-11-22-mt", year: 2020, licenceNumber: "LDA-999" },
  });
  check("taxi driver can register (awaits approval)", reg.status === 201 && reg.body.user.userType === "taxi" && reg.body.user.isApproved === false, reg.body);
  check("pending taxi driver can't go online", (await fresh.post("/api/taxi/driver/presence", { online: true })).status === 403);
  const noCar = await new Client().post("/api/auth/register", { username: `semcarro${Date.now() % 100000}`, password: "Teste#2026", fullName: "Sem Carro", phone: "+244923999998", userType: "taxi" });
  check("taxi registration without vehicle details is refused", noCar.status === 400 && noCar.body.code === "TAXI_REQUIRED", noCar.body);
  void ecoUser;
}

main().then(() => {
  console.log(`\n========== TAXI API SUMMARY: ${pass} passed, ${fail} failed ==========`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
