/**
 * Envios de ponta a ponta pela API (base de demonstração acabada de criar).
 * Correr: DISPATCH_OFFER_SECONDS=6 DISPATCH_TICK_MS=500 BUSY_PRICING=0 ADMIN_REQUIRE_2FA=0 AUTH_RATE_LIMIT=60 bash scripts/local-server.sh
 *         npx tsx tests/parcels.api.test.ts
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
async function waitFor<T>(fn: () => Promise<T | null | undefined>, ms = 10_000): Promise<T | null> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await sleep(300); }
  return null;
}

// Maianga → Talatona (~12 km)
const FROM = { label: "Casa da Ana", street: "Rua Rainha Ginga 10", zone: "Maianga", latitude: -8.8180, longitude: 13.2340 };
const TO = { label: "Escritório", street: "Via S8, Talatona", zone: "Talatona", latitude: -8.9180, longitude: 13.1830 };
const base = {
  pickup: FROM, dropoff: TO, senderName: "Ana Cliente", senderPhone: "923000001",
  recipientName: "João Recebe", recipientPhone: "+244 923 111 222", description: "Documentos do banco", fragile: false, riderTip: 0,
};

async function main() {
  const anon = new Client();
  const cust = new Client(); await cust.login("cliente", "Cliente#2026");
  const other = new Client(); await other.login("cliente2", "Cliente#2026");
  const rider = new Client(); await rider.login("estafeta", "Estafeta#2026");
  const taxi = new Client(); await taxi.login("taxista", "Taxista#2026");
  const admin = new Client(); await admin.login("admin", "Admin#2026demo");

  // --- preço
  const qs = await anon.post("/api/parcels/quote", { pickup: FROM, dropoff: TO, size: "small" });
  const qm = await anon.post("/api/parcels/quote", { pickup: FROM, dropoff: TO, size: "medium" });
  const ql = await anon.post("/api/parcels/quote", { pickup: FROM, dropoff: TO, size: "large" });
  check("quote: size extra 0 / 500 / 1 500 and bigger parcels cost more", qs.status === 200 && qs.body.sizeFee === 0 && qm.body.sizeFee === 500 && ql.body.sizeFee === 1500
    && qs.body.total < qm.body.total && qm.body.total < ql.body.total && ql.body.total === ql.body.deliveryFee + 1500, [qs.body, qm.body, ql.body]);
  check("quote: delivery fee follows the normal rule (min 500, multiple of 50)", qs.body.deliveryFee >= 500 && qs.body.deliveryFee % 50 === 0, qs.body);
  check("quote: same place refused", (await anon.post("/api/parcels/quote", { pickup: FROM, dropoff: FROM, size: "small" })).body?.code === "SAME_PLACE");

  // --- quem pode enviar
  check("send without login → 401", (await anon.post("/api/parcels", { ...base, size: "small", paymentMethod: "cash" })).status === 401);
  check("taxi driver can't send a parcel (customer accounts only)", (await taxi.post("/api/parcels", { ...base, size: "small", paymentMethod: "cash" })).status === 403);
  const badPhone = await cust.post("/api/parcels", { ...base, recipientPhone: "12345", size: "small", paymentMethod: "cash" });
  check("recipient phone is validated", badPhone.status === 400, badPhone.body);
  check("store list never shows the internal 'PedeJá Envios' store", !(await anon.get("/api/stores")).body.stores.some((s: any) => s.name === "PedeJá Envios"));

  // --- 1: criar e cancelar antes de haver estafeta
  let r = await cust.post("/api/parcels", { ...base, size: "small", paymentMethod: "cash" });
  check("create parcel → ready for pickup, total = quote", r.status === 201 && r.body.order.status === "ready" && r.body.order.total === qs.body.total, r.body);
  const p1 = r.body.order.id;
  const d1 = (await cust.get(`/api/orders/${p1}`)).body;
  check("sender sees the delivery code to pass on, pickup point and recipient", /^\d{4}$/.test(d1.order.deliveryCode) && d1.order.kind === "parcel" && d1.order.parcel.recipientName === "João Recebe" && d1.store.latitude === FROM.latitude, d1.order);
  check("other customers can't see the parcel", (await other.get(`/api/orders/${p1}`)).status === 403);
  const c1 = await cust.post(`/api/orders/${p1}/cancel`, {});
  check("sender can cancel before a rider accepts", c1.status === 200 && c1.body.order.status === "cancelled", c1.body);

  // --- 2: pequeno, em numerário, até ao fim
  await rider.post("/api/driver/presence", { online: true, latitude: -8.8175, longitude: 13.2335 });
  r = await cust.post("/api/parcels", { ...base, size: "small", paymentMethod: "cash" });
  const p2 = r.body.order.id;
  const offer = await waitFor(async () => (await rider.get("/api/driver/offers")).body.offer);
  check("offer goes to the nearby rider, pickup shown as the sender", offer?.order?.id === p2 && offer.order.kind === "parcel" && offer.order.store.name.includes("Ana Cliente") && offer.order.store.latitude === FROM.latitude, offer?.order);
  check("taxi drivers never get parcel offers", (await taxi.get("/api/driver/offers")).status === 403);
  const acc = await rider.post(`/api/driver/offers/${offer.id}/accept`);
  check("rider accepts", acc.status === 200, acc.body);
  const cur = (await rider.get("/api/driver/current")).body.order;
  check("rider sees: pickup = sender contact, drop-off = recipient (name + phone), parcel details", cur.store.phone === "923000001" && cur.customer.name === "João Recebe" && cur.customer.phone === "+244 923 111 222" && cur.parcel.description === "Documentos do banco", cur);
  check("cancel no longer possible once a rider has it", (await cust.post(`/api/orders/${p2}/cancel`, {})).status === 409);
  check("arrived at the pickup (GPS is next to the sender)", (await rider.post(`/api/driver/orders/${p2}/arrived`, { at: "store" })).status === 200);
  check("picked up", (await rider.post(`/api/driver/orders/${p2}/status`, { status: "picked_up" })).body?.order?.status === "picked_up");
  await rider.post(`/api/driver/orders/${p2}/arrived`, { at: "customer" });
  const code = (await cust.get(`/api/orders/${p2}`)).body.order.deliveryCode;
  check("wrong code refused", (await rider.post(`/api/driver/orders/${p2}/status`, { status: "delivered", pin: code === "0000" ? "1111" : "0000" })).body?.code === "BAD_PIN");
  const del = await rider.post(`/api/driver/orders/${p2}/status`, { status: "delivered", pin: code });
  check("delivered with the recipient's code", del.status === 200 && del.body.order.status === "delivered", del.body);
  const o2 = (await admin.get(`/api/orders/${p2}`)).body.order;
  check("money: no store earning; PedeJá keeps the fee minus the rider's pay", o2.storeEarning === 0 && o2.riderEarning > 0 && o2.riderEarning <= o2.total, { store: o2.storeEarning, rider: o2.riderEarning, total: o2.total });
  const w = (await rider.get("/api/driver/wallet")).body;
  check("rider wallet: cash in hand = what the sender paid", w.cashHeld === o2.total, { cashHeld: w.cashHeld, total: o2.total });

  // --- 3: médio, pago por banco: o estafeta recebe parte do extra
  r = await cust.post("/api/parcels", { ...base, size: "medium", fragile: true, paymentMethod: "multicaixa_express" });
  const p3 = r.body.order.id;
  const offer3 = await waitFor(async () => (await rider.get("/api/driver/offers")).body.offer);
  check("medium parcel offer includes the rider's share of the size extra (50% of 500)", offer3?.payDetail?.parcelBonus === 250, offer3?.payDetail);
  await rider.post(`/api/driver/offers/${offer3.id}/accept`);
  await rider.post(`/api/driver/orders/${p3}/arrived`, { at: "store" });
  await rider.post(`/api/driver/orders/${p3}/status`, { status: "picked_up" });
  const code3 = (await cust.get(`/api/orders/${p3}`)).body.order.deliveryCode;
  const del3 = await rider.post(`/api/driver/orders/${p3}/status`, { status: "delivered", pin: code3 });
  check("bank-paid medium parcel delivered; nothing to collect in cash", del3.status === 200 && del3.body.order.paymentStatus === "paid", del3.body);

  // --- 4: grande: só carro
  r = await cust.post("/api/parcels", { ...base, size: "large", paymentMethod: "cash" });
  const p4 = r.body.order.id;
  await sleep(2500);
  check("large parcel is never offered to a moto rider", (await rider.get("/api/driver/offers")).body.offer === null);
  check("…nor shown in the moto rider's open list", !(await rider.get("/api/driver/available")).body.orders.some((x: any) => x.id === p4));
  const claim = await rider.post(`/api/driver/orders/${p4}/claim`);
  check("…and a moto rider can't claim it", claim.status === 409 && claim.body.code === "VEHICLE_TOO_SMALL", claim.body);
  await cust.post(`/api/orders/${p4}/cancel`, {});
}

main().then(() => {
  console.log(`\n========== PARCELS API SUMMARY: ${pass} passed, ${fail} failed ==========`);
  process.exit(fail ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
