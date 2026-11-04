/**
 * PedeJá — API end-to-end + security test suite.
 * Run against a FRESH seeded DB:  npx tsx tests/api.test.ts
 * BASE env var overrides the server URL (default http://localhost:5055).
 */
const BASE = process.env.BASE || "http://localhost:5055";
const ORIGIN = BASE;

type Res = { status: number; body: any; text: string };
const results: { name: string; ok: boolean; detail?: string; known?: string }[] = [];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function check(name: string, ok: boolean, detail?: unknown) {
  results.push({ name, ok: !!ok, detail: ok ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + (typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 400))}`);
}

class Client {
  cookie = "";
  constructor(public label: string) {}
  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}, raw?: string): Promise<Res> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const h: Record<string, string> = { ...headers };
      if (this.cookie) h.cookie = this.cookie;
      if (method !== "GET" && !("origin" in Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v])))) h.Origin = ORIGIN;
      if (body !== undefined || raw !== undefined) h["Content-Type"] = "application/json";
      const res = await fetch(BASE + path, { method, headers: h, body: raw ?? (body !== undefined ? JSON.stringify(body) : undefined) });
      const sc = res.headers.getSetCookie?.() ?? [];
      for (const c of sc) if (c.startsWith("pedeja.sid=")) this.cookie = c.split(";")[0];
      const text = await res.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      if (res.status === 429 && parsed?.code === "RATE_LIMITED" && String(parsed?.message).startsWith("Demasiados pedidos")) { await sleep(3000); continue; }
      return { status: res.status, body: parsed, text };
    }
    throw new Error("rate limited forever");
  }
  get(p: string) { return this.req("GET", p); }
  post(p: string, b?: unknown, h?: Record<string, string>) { return this.req("POST", p, b ?? {}, h); }
  put(p: string, b?: unknown) { return this.req("PUT", p, b ?? {}); }
  patch(p: string, b?: unknown) { return this.req("PATCH", p, b ?? {}); }
  del(p: string, h?: Record<string, string>) { return this.req("DELETE", p, undefined, h); }
  async login(username: string, password: string) {
    const r = await this.post("/api/auth/login", { username, password });
    if (r.status !== 200) throw new Error(`login ${username} failed ${r.status} ${r.text}`);
    return r.body.user;
  }
}

// Luanda = UTC+1. Returns ISO for Luanda-local day offset & time.
function luanda(dayOffset: number, hh: number, mm = 0): string {
  const nowL = new Date(Date.now() + 3_600_000);
  const d = new Date(Date.UTC(nowL.getUTCFullYear(), nowL.getUTCMonth(), nowL.getUTCDate() + dayOffset, hh - 1, mm));
  return d.toISOString();
}
const inMin = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

const FRANGO = { menuItemId: 1, quantity: 1, optionIds: [1, 4] }; // 4500
const FRANGO_FUNJE = { menuItemId: 1, quantity: 2, optionIds: [2, 6] }; // (4500+300)*2 = 9600
const AGUA = { menuItemId: 10, quantity: 1, optionIds: [] }; // 500
const BOLO = { menuItemId: 51, quantity: 1, optionIds: [] as number[] };

let uniq = Date.now().toString(36).slice(-5);
async function newCustomer(prefix: string, extra: Record<string, unknown> = {}, zone = "Talatona") {
  const c = new Client(prefix);
  const r = await c.post("/api/auth/register", {
    username: `${prefix}_${uniq}`, password: "Teste#2026xx", fullName: `${prefix} Teste Silva`, phone: "+244923555" + String(Math.floor(Math.random() * 900) + 100),
    userType: "customer", ...extra,
  });
  if (r.status !== 201) throw new Error(`register ${prefix}: ${r.status} ${r.text}`);
  const a = await c.post("/api/addresses", { label: "Casa", street: "Rua de teste 1", zone, city: "Luanda" });
  if (a.status !== 201) throw new Error(`address ${prefix}: ${a.status} ${a.text}`);
  return { c, user: r.body.user, addressId: a.body.address.id as number };
}

async function section(name: string, fn: () => Promise<void>) {
  console.log(`\n=== ${name} ===`);
  try { await fn(); } catch (e: any) { check(`${name}: section crashed`, false, e?.stack?.split("\n").slice(0, 3).join(" | ") ?? String(e)); }
}

async function main() {
  const health = await fetch(BASE + "/api/health").then((r) => r.json()).catch(() => null);
  if (!health?.ok) { console.error("server not reachable at", BASE); process.exit(2); }

  const anon = new Client("anon");
  const admin = new Client("admin"); await admin.login("admin", "Admin#2026demo");
  const cli = new Client("cliente"); const cliUser = await cli.login("cliente", "Cliente#2026");
  const cli2 = new Client("cliente2"); await cli2.login("cliente2", "Cliente#2026");
  const loja = new Client("loja"); await loja.login("loja", "Loja#2026demo");
  const tia = new Client("tiarosa"); await tia.login("tiarosa", "Loja#2026demo");
  const loja2 = new Client("loja2"); await loja2.login("loja2", "Loja#2026demo");
  const est = new Client("estafeta"); await est.login("estafeta", "Estafeta#2026");
  const est2 = new Client("estafeta2"); await est2.login("estafeta2", "Estafeta#2026");

  const cliAddrs = (await cli.get("/api/addresses")).body.addresses;
  const addrTalatona = cliAddrs.find((a: any) => a.zone === "Talatona").id;
  const addrIngombota = cliAddrs.find((a: any) => a.zone === "Ingombota").id;
  const cli2Addr = (await cli2.get("/api/addresses")).body.addresses[0].id;

  // helper: full lifecycle to delivered
  async function deliver(orderId: number, driver = est) {
    for (const s of ["accepted", "preparing", "ready"]) {
      const r = await loja.post(`/api/partner/orders/${orderId}/status`, { status: s });
      if (r.status !== 200) throw new Error(`partner ${s}: ${r.status} ${r.text}`);
    }
    let r = await driver.post(`/api/driver/orders/${orderId}/claim`);
    if (r.status !== 200) throw new Error(`claim: ${r.status} ${r.text}`);
    r = await driver.post(`/api/driver/orders/${orderId}/status`, { status: "picked_up" });
    if (r.status !== 200) throw new Error(`pickup: ${r.status} ${r.text}`);
    r = await driver.post(`/api/driver/orders/${orderId}/status`, { status: "delivered" });
    if (r.status !== 200) throw new Error(`deliver: ${r.status} ${r.text}`);
  }

  // =========================================================================
  await section("CSRF / Origin", async () => {
    const r = await cli.req("POST", "/api/cart/quote", { storeId: 1, items: [FRANGO] }, { Origin: "https://evil.example" });
    check("cross-origin POST rejected with 403 BAD_ORIGIN", r.status === 403 && r.body?.code === "BAD_ORIGIN", r);
    const r2 = await cli.req("POST", "/api/orders/1/cancel", {}, { Origin: "null" });
    check("Origin: null rejected", r2.status === 403, r);
    const r3 = await cli.req("POST", "/api/cart/quote", { storeId: 1, items: [FRANGO] }, { Origin: ORIGIN });
    check("same-origin POST accepted", r3.status === 200, r3);
  });

  // =========================================================================
  await section("Auth & registration", async () => {
    let r = await anon.post("/api/auth/register", { username: `adm_${uniq}`, password: "Teste#2026xx", fullName: "Hacker Admin", phone: "+244923111222", userType: "admin" });
    check("register userType=admin rejected (400)", r.status === 400, r);
    const drv = new Client("newdrv");
    r = await drv.post("/api/auth/register", { username: `drv_${uniq}`, password: "Teste#2026xx", fullName: "Novo Estafeta", phone: "+244923111333", userType: "driver", isApproved: true, loyaltyPoints: 99999 });
    check("driver registers (201) but stays unapproved despite isApproved in body", r.status === 201 && r.body.user.isApproved === false && r.body.user.loyaltyPoints === 0, r.body);
    r = await drv.get("/api/driver/available");
    check("unapproved driver blocked from driver panel (403 NOT_APPROVED)", r.status === 403 && r.body.code === "NOT_APPROVED", r);
    r = await est2.get("/api/driver/available");
    check("seed pending estafeta2 blocked from driver panel", r.status === 403, r);

    // home business supplier without NIF
    const home = new Client("home");
    r = await home.post("/api/auth/register", {
      username: `casa_${uniq}`, password: "Teste#2026xx", fullName: "Dona Ana Cozinha", phone: "+244923111444", userType: "supplier",
      business: { name: `Cozinha da Ana ${uniq}`, storeType: "bakery", phone: "+244923111444", street: "Rua 1, casa 4", zone: "Kilamba", isHomeBusiness: true, minNoticeHours: 12 },
    });
    check("home business registers without NIF (201)", r.status === 201, r);
    const hs = await home.get("/api/partner/store");
    check("home business store is flagged isHomeBusiness, 12h notice, pending approval, closed",
      hs.status === 200 && hs.body.store.isHomeBusiness === true && hs.body.store.minNoticeMin === 720 && hs.body.store.isApproved === false, hs.body);
    const pub = await anon.get(`/api/stores/${hs.body.store?.id}`);
    check("pending home store not visible publicly (404)", pub.status === 404, pub.status);
    const srch = await anon.get(`/api/stores?q=${encodeURIComponent("Cozinha da Ana")}`);
    check("pending store not in search", srch.status === 200 && srch.body.stores.length === 0, srch.body);
    r = await new Client("sx").post("/api/auth/register", { username: `semneg_${uniq}`, password: "Teste#2026xx", fullName: "Sem Negocio", phone: "+244923111888", userType: "supplier" });
    check("supplier without business data -> 400 BUSINESS_REQUIRED", r.status === 400, r.body);
    r = await anon.post("/api/auth/register", { username: "cliente", password: "Teste#2026xx", fullName: "Dup User", phone: "+244923111555" });
    check("duplicate username rejected (409)", r.status === 409, r);
    r = await anon.post("/api/auth/login", { username: "cliente", password: "wrong-password" });
    check("wrong password -> 401", r.status === 401, r);
    r = await new Client("ci").post("/api/auth/login", { username: "CLIENTE", password: "Cliente#2026" });
    check("username login is case-insensitive", r.status === 200, r);
    r = await anon.get("/api/auth/me");
    check("GET /auth/me unauthenticated -> 401", r.status === 401, r.status);
    const me = await cli.get("/api/auth/me");
    check("/auth/me does not leak passwordHash", me.status === 200 && !me.text.includes("passwordHash") && !me.text.includes("$2"), me.text.slice(0, 200));
    r = await cli.patch("/api/auth/me", { preferredLanguage: "en", userType: "admin", isApproved: true, loyaltyPoints: 999999 });
    check("PATCH /auth/me ignores userType/loyaltyPoints injection", r.status === 200 && r.body.user.userType === "customer" && r.body.user.loyaltyPoints === cliUser.loyaltyPoints, r.body);
    await cli.patch("/api/auth/me", { preferredLanguage: "pt" });
  });

  // =========================================================================
  await section("Catalog, search & filters", async () => {
    const meta = await anon.get("/api/meta");
    check("meta returns zones/paymentMethods/plus/schedule", meta.status === 200 && meta.body.zones.length > 5 && meta.body.paymentMethods.length === 5 && meta.body.paymentsMode === "sandbox", meta.body?.paymentsMode);
    let r = await anon.get("/api/stores?q=frango");
    const s1 = r.body.stores?.find((s: any) => s.id === 1);
    check("search 'frango' finds store 1 with matchingItems incl. Frango grelhado", !!s1 && s1.matchingItems.some((i: any) => i.name === "Frango grelhado"), r.body.stores?.map((s: any) => s.name));
    r = await anon.get("/api/stores?homeBusiness=1");
    check("homeBusiness filter returns only home businesses (Tia Rosa)", r.status === 200 && r.body.stores.length >= 1 && r.body.stores.every((s: any) => s.isHomeBusiness), r.body.stores?.map((s: any) => s.name));
    r = await anon.get("/api/stores?dietary=vegan");
    check("dietary=vegan returns stores", r.status === 200 && r.body.stores.length > 0, r.body);
    r = await anon.get("/api/stores?cuisine=pizza");
    check("cuisine filter (case-insensitive) finds Pizzaria Ilha", r.body.stores?.length === 1 && r.body.stores[0].name === "Pizzaria Ilha", r.body.stores?.map((s: any) => s.name));
    r = await anon.get("/api/stores?zone=Kilamba");
    check("zone=Kilamba excludes Grelhados do Mussulo (doesn't serve Kilamba)", r.body.stores?.every((s: any) => s.id !== 1) && r.body.stores.length > 0, r.body.stores?.map((s: any) => s.name));
    r = await anon.get("/api/stores?maxDeliveryTime=35");
    check("maxDeliveryTime filter", r.body.stores?.every((s: any) => s.deliveryTimeMin <= 35) && r.body.stores.length > 0, r.body.stores?.map((s: any) => s.deliveryTimeMin));
    r = await anon.get("/api/stores?minRating=4.5");
    check("minRating filter", r.status === 200 && r.body.stores.every((s: any) => s.ratingAvg >= 4.45), r.body.stores?.map((s: any) => s.ratingAvg));
    r = await anon.get("/api/stores?sort=delivery_fee");
    const fees = r.body.stores?.map((s: any) => s.deliveryFee) ?? [];
    check("sort=delivery_fee ascending", fees.every((f: number, i: number) => i === 0 || f >= fees[i - 1]), fees);
    r = await anon.get("/api/stores?type=pharmacy");
    check("type=pharmacy", r.body.stores?.length === 1 && r.body.stores[0].storeType === "pharmacy", r.body);
    r = await anon.get(`/api/stores?q=${encodeURIComponent("'; DROP TABLE users; --")}`);
    check("SQL-ish search string handled safely (200, empty)", r.status === 200 && Array.isArray(r.body.stores), r);
    r = await anon.get(`/api/stores?q=%25`);
    check("q='%' does not act as wildcard error", r.status === 200, r);
    r = await anon.get(`/api/stores?q=${"a".repeat(500)}`);
    check("over-long q rejected 400", r.status === 400, r.status);
    r = await anon.get("/api/stores?minRating=abc");
    check("minRating=abc -> 400", r.status === 400, r.status);
    r = await anon.get("/api/stores/11");
    check("unapproved store 11 hidden from public (404)", r.status === 404, r.status);
    r = await anon.get("/api/stores/abc");
    check("store id 'abc' -> 400", r.status === 400, r.status);
    r = await anon.get("/api/stores/1");
    const fr = r.body.items?.find((i: any) => i.name === "Frango grelhado");
    check("store detail includes option groups with min/max + allergens/dietary arrays", fr && fr.optionGroups.length === 3 && fr.optionGroups[0].minSelect === 1 && Array.isArray(fr.allergens) && Array.isArray(fr.dietaryTags), fr);
    const users2 = await admin.get("/api/admin/users");
    check("users table intact after SQL-ish search", users2.status === 200 && users2.body.users.length >= 8, users2.status);
    r = await anon.get("/api/stores?openNow=1");
    check("openNow filter returns only open stores", r.status === 200 && r.body.stores.every((s: any) => s.isOpenNow), r.body.stores?.length);
  });

  // =========================================================================
  await section("Quote & price tampering", async () => {
    let r = await cli.post("/api/cart/quote", { storeId: 1, items: [FRANGO, FRANGO_FUNJE] });
    check("quote computes server-side subtotal (4500 + 9600 = 14100) + fee 1000", r.status === 200 && r.body.quote.subtotal === 14100 && r.body.quote.deliveryFee === 1000 && r.body.quote.total === 15100, r.body?.quote);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: 1, quantity: 1, optionIds: [4] }] });
    check("missing required option group -> 400 OPTION_REQUIRED", r.status === 400 && r.body.code === "OPTION_REQUIRED", r.body);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: 1, quantity: 1, optionIds: [1, 2, 4] }] });
    check("too many in single-choice group -> 400 OPTION_TOO_MANY", r.status === 400 && r.body.code === "OPTION_TOO_MANY", r.body);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: 1, quantity: 1, optionIds: [1, 4, 14] }] });
    check("option from another item -> 400 INVALID_OPTION", r.status === 400 && r.body.code === "INVALID_OPTION", r.body);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: 12, quantity: 1, optionIds: [] }] });
    check("item from another store -> 400 ITEM_NOT_IN_STORE", r.status === 400 && r.body.code === "ITEM_NOT_IN_STORE", r.body);
    r = await cli.post("/api/cart/quote", { storeId: 11, items: [{ menuItemId: 55, quantity: 1, optionIds: [] }] });
    check("quote at unapproved store -> 404", r.status === 404, r.body);

    // tampering on create order
    r = await cli.post("/api/orders", {
      storeId: 1, items: [{ ...FRANGO, price: 1, unitPrice: 1, lineTotal: 1, name: "hacked" }], addressId: addrTalatona, paymentMethod: "cash",
      subtotal: 1, total: 1, deliveryFee: 0, discount: 99999, status: "delivered", paymentStatus: "paid", customerId: 3, driverId: 7, pointsRedeemed: -500,
    });
    const o = r.body.order;
    check("create order ignores client price/total/status fields", r.status === 201 && o.subtotal === 4500 && o.total === 5500 && o.status === "pending" && o.paymentStatus === "pending" && o.customerId === cliUser.id && o.driverId === null && o.discount === 0, r.body);
    if (o) {
      const d = await cli.get(`/api/orders/${o.id}`);
      check("order item name/unit price come from DB", d.body.items[0].name === "Frango grelhado" && d.body.items[0].unitPrice === 4500, d.body.items);
      await cli.post(`/api/orders/${o.id}/cancel`, {});
    }
  });

  // =========================================================================
  await section("Input validation", async () => {
    const base = { storeId: 1, addressId: addrTalatona, paymentMethod: "cash" };
    const bad: [string, any][] = [
      ["quantity 0", { ...base, items: [{ ...FRANGO, quantity: 0 }] }],
      ["quantity -2", { ...base, items: [{ ...FRANGO, quantity: -2 }] }],
      ["quantity 1.5", { ...base, items: [{ ...FRANGO, quantity: 1.5 }] }],
      ["quantity '2' (string)", { ...base, items: [{ ...FRANGO, quantity: "2" }] }],
      ["quantity 51", { ...base, items: [{ ...FRANGO, quantity: 51 }] }],
      ["quantity 1e9", { ...base, items: [{ ...FRANGO, quantity: 1e9 }] }],
      ["storeId string", { ...base, storeId: "1", items: [FRANGO] }],
      ["menuItemId negative", { ...base, items: [{ ...FRANGO, menuItemId: -1 }] }],
      ["optionIds not array", { ...base, items: [{ ...FRANGO, optionIds: "1,4" }] }],
      ["specialInstructions 5000 chars", { ...base, items: [{ ...FRANGO, specialInstructions: "x".repeat(5000) }] }],
      ["notes 10k chars", { ...base, items: [FRANGO], notes: "n".repeat(10000) }],
      ["unknown paymentMethod", { ...base, items: [FRANGO], paymentMethod: "bitcoin" }],
      ["scheduledFor not ISO", { ...base, items: [FRANGO], scheduledFor: "amanhã às 10" }],
      ["usePoints negative", { ...base, items: [FRANGO], usePoints: -100 }],
      ["empty items", { ...base, items: [] }],
      ["items null", { ...base, items: null }],
    ];
    for (const [label, body] of bad) {
      const r = await cli.post("/api/orders", body);
      check(`create order rejects ${label} (400)`, r.status === 400, `${r.status} ${r.text.slice(0, 150)}`);
      if (r.status === 201) await cli.post(`/api/orders/${r.body.order.id}/cancel`, {});
    }
    let r = await cli.req("POST", "/api/orders", undefined, {}, "{not json");
    check("malformed JSON -> 400 BAD_JSON", r.status === 400 && r.body.code === "BAD_JSON", r);
    r = await cli.req("POST", "/api/cart/quote", undefined, {}, JSON.stringify({ storeId: 1, items: [FRANGO], pad: "x".repeat(300_000) }));
    check("oversized body (300KB) -> 413 (not 500)", r.status === 413, `${r.status} ${r.text.slice(0, 120)}`);
    r = await cli.post("/api/addresses", { label: "<script>alert(1)</script>", street: "x".repeat(201), zone: "Talatona" });
    check("address street > 200 chars rejected", r.status === 400, r.status);
    r = await cli.post("/api/addresses", { label: "L", street: "Rua A", zone: "Talatona", latitude: 999 });
    check("address latitude 999 rejected", r.status === 400, r.status);
    r = await cli.get("/api/orders/1abc");
    check("order id '1abc' -> 400", r.status === 400, r.status);
    r = await cli.get("/api/orders/99999999");
    check("non-existent order -> 404", r.status === 404, r.status);
    r = await cli.post("/api/orders/1/review", { rating: 6 });
    check("rating 6 rejected", r.status === 400, r.status);
    r = await cli.post("/api/orders/1/review", { rating: 4.5 });
    check("rating 4.5 rejected", r.status === 400, r.status);
  });

  // =========================================================================
  await section("Access control between users", async () => {
    const r0 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", notes: "privado" });
    const oid = r0.body.order.id;
    let r = await cli2.get(`/api/orders/${oid}`);
    check("other customer cannot view order (403)", r.status === 403, r.status);
    r = await cli2.get(`/api/orders/${oid}/tracking`);
    check("other customer cannot track order", r.status === 403, r.status);
    r = await cli2.post(`/api/orders/${oid}/cancel`, {});
    check("other customer cannot cancel order", r.status === 403, r.status);
    r = await cli2.patch(`/api/orders/${oid}`, { notes: "hijack" });
    check("other customer cannot modify order", r.status === 403, r.status);
    r = await cli2.get("/api/orders");
    check("GET /orders lists only own orders", r.body.orders.every((o: any) => o.customerId !== cliUser.id), r.body.orders.length);
    r = await cli2.get("/api/addresses");
    check("GET /addresses lists only own", r.body.addresses.every((a: any) => a.id !== addrTalatona), r.body);
    r = await cli2.put(`/api/addresses/${addrTalatona}`, { street: "Hacked street 1" });
    check("cannot edit another user's address (403)", r.status === 403, r.status);
    r = await cli2.del(`/api/addresses/${addrTalatona}`);
    check("cannot delete another user's address (403)", r.status === 403, r.status);
    r = await cli2.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    check("cannot order to another user's address (400 INVALID_ADDRESS)", r.status === 400 && r.body.code === "INVALID_ADDRESS", r.body);
    r = await tia.get(`/api/orders/${oid}`);
    check("supplier of other store cannot view order", r.status === 403, r.status);
    r = await tia.post(`/api/partner/orders/${oid}/status`, { status: "accepted" });
    check("supplier cannot change another store's order (403)", r.status === 403, r.body);
    r = await est.get(`/api/orders/${oid}`);
    check("unassigned driver cannot view order details", r.status === 403, r.status);
    r = await anon.get(`/api/orders/${oid}`);
    check("anonymous cannot view order (401)", r.status === 401, r.status);
    // menu tampering by other supplier
    r = await tia.put("/api/partner/items/1", { name: "Hacked", price: 1 });
    check("supplier cannot edit another store's item (404)", r.status === 404, r.status);
    r = await tia.patch("/api/partner/items/1/availability", { isAvailable: false });
    check("supplier cannot toggle another store's item", r.status === 404, r.status);
    r = await tia.del("/api/partner/items/1");
    check("supplier cannot delete another store's item", r.status === 404, r.status);
    const menu1 = (await loja.get("/api/partner/menu")).body;
    const secId = menu1.sections[0].id;
    r = await tia.del(`/api/partner/sections/${secId}`);
    const after = (await loja.get("/api/partner/menu")).body;
    check("supplier cannot delete another store's section (section still exists)", after.sections.some((s: any) => s.id === secId), r.status);
    r = await tia.post("/api/partner/items", { name: "Intruso", price: 100, sectionId: secId });
    check("supplier cannot add item into another store's section (403)", r.status === 403, r.status);
    r = await tia.put(`/api/partner/sections/${secId}`, { name: "Hacked" });
    check("supplier cannot rename another store's section (404)", r.status === 404, r.status);
    const rev = await tia.post("/api/partner/reviews/1/reply", { reply: "x" });
    check("supplier cannot reply to review of another store (404)", rev.status === 404, rev.status);
    // role checks
    for (const [p, m] of [["/api/partner/orders", "GET"], ["/api/admin/stats", "GET"], ["/api/driver/available", "GET"], ["/api/admin/users/3", "PATCH"], ["/api/driver/orders/" + oid + "/claim", "POST"]] as const) {
      const rr = await cli.req(m, p, m === "GET" ? undefined : { isApproved: true });
      check(`customer forbidden on ${m} ${p} (403)`, rr.status === 403, rr.status);
    }
    r = await loja.get("/api/admin/stores");
    check("supplier forbidden on admin", r.status === 403, r.status);
    r = await est.get("/api/partner/store");
    check("driver forbidden on partner", r.status === 403, r.status);
    r = await loja.post("/api/orders", { storeId: 2, items: [{ menuItemId: 12, quantity: 1, optionIds: [] }], addressId: 1, paymentMethod: "cash" });
    check("supplier cannot place orders via /api/orders (403)", r.status === 403, r.status);
    r = await anon.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    check("anonymous cannot place order (401)", r.status === 401, r.status);
    r = await admin.patch(`/api/admin/users/1`, { isActive: false });
    check("admin cannot deactivate self", r.status === 400, r.status);
    await cli.post(`/api/orders/${oid}/cancel`, {});
  });

  // =========================================================================
  await section("Order lifecycle & state machine", async () => {
    const r0 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    const id = r0.body.order.id;
    let r = await est.post(`/api/driver/orders/${id}/claim`);
    check("driver cannot claim pending (not yet accepted) order", r.status === 409, r.status);
    r = await loja.post(`/api/partner/orders/${id}/status`, { status: "ready" });
    check("store cannot jump pending -> ready (409)", r.status === 409, r.body);
    r = await loja.post(`/api/partner/orders/${id}/status`, { status: "accepted" });
    check("store accepts", r.status === 200 && r.body.order.status === "accepted", r.body);
    r = await cli.get(`/api/orders/${id}`);
    check("canCancel true while accepted; canModify false", r.body.order.canCancel === true && r.body.order.canModify === false, r.body.order);
    r = await cli.patch(`/api/orders/${id}`, { notes: "x" });
    check("modify after accept -> 409 NOT_MODIFIABLE", r.status === 409, r.body);
    r = await loja.post(`/api/partner/orders/${id}/status`, { status: "preparing" });
    check("store preparing", r.status === 200, r.body);
    r = await cli.post(`/api/orders/${id}/cancel`, {});
    check("customer cannot cancel after preparing (409 NOT_CANCELLABLE)", r.status === 409 && r.body.code === "NOT_CANCELLABLE", r.body);
    r = await est.post(`/api/driver/orders/${id}/claim`);
    check("driver claims accepted/preparing order", r.status === 200 && r.body.order.driverId === 7, r.body);
    r = await est.post(`/api/driver/orders/${id}/status`, { status: "delivered" });
    check("driver cannot deliver before pickup (409)", r.status === 409, r.body);
    r = await est.post(`/api/driver/orders/${id}/status`, { status: "picked_up" });
    check("driver cannot pick up before store marks ready (409)", r.status === 409, r.body);
    r = await est.post("/api/driver/location", { latitude: -8.92, longitude: 13.19 });
    check("driver location update applies to active order", r.status === 200 && r.body.updatedOrders.includes(id), r.body);
    r = await cli.get(`/api/orders/${id}/tracking`);
    check("customer tracking shows driver location", r.body.driverLocation?.latitude === -8.92 && r.body.status === "preparing", r.body);
    r = await est.post("/api/driver/location", { latitude: 200, longitude: 13 });
    check("invalid driver latitude rejected", r.status === 400, r.status);
    r = await loja.post(`/api/partner/orders/${id}/status`, { status: "ready" });
    check("store ready", r.status === 200, r.body);
    r = await est.post(`/api/driver/orders/${id}/status`, { status: "picked_up" });
    check("driver picked_up", r.status === 200, r.body);
    r = await est.get("/api/driver/current");
    check("driver current shows collectCash = total for cash", r.body.order?.id === id && r.body.order.collectCash === 5500, r.body);
    r = await est.post(`/api/driver/orders/${id}/status`, { status: "delivered" });
    check("driver delivered", r.status === 200 && r.body.order.status === "delivered" && r.body.order.paymentStatus === "paid", r.body);
    r = await admin.post(`/api/admin/orders/${id}/status`, { status: "pending" });
    check("admin cannot move delivered -> pending (409)", r.status === 409, r.body);
    r = await loja.post(`/api/partner/orders/${id}/status`, { status: "rejected" });
    check("store cannot reject delivered order", r.status === 409, r.body);
    r = await cli.post(`/api/orders/${id}/cancel`, {});
    check("customer cannot cancel delivered order", r.status === 409, r.body);
    r = await cli.get(`/api/orders/${id}`);
    check("order events history recorded (>= 6 events)", r.body.events.length >= 6, r.body.events?.length);

    // customer cancel while accepted
    const r1 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    await loja.post(`/api/partner/orders/${r1.body.order.id}/status`, { status: "accepted" });
    r = await cli.post(`/api/orders/${r1.body.order.id}/cancel`, { reason: "mudei de ideias" });
    check("customer can cancel free while accepted", r.status === 200 && r.body.order.status === "cancelled", r.body);
    r = await loja.post(`/api/partner/orders/${r1.body.order.id}/status`, { status: "preparing" });
    check("store cannot prepare a cancelled order", r.status === 409, r.body);

    // store reject
    const r2 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    r = await loja.post(`/api/partner/orders/${r2.body.order.id}/status`, { status: "rejected", note: "Sem frango" });
    check("store can reject pending order with reason", r.status === 200 && r.body.order.status === "rejected" && r.body.order.cancelReason === "Sem frango", r.body);

    // partner order lists
    r = await loja.get("/api/partner/orders?scope=history");
    check("partner history includes delivered/rejected", r.body.orders.some((o: any) => o.id === id) && r.body.orders.some((o: any) => o.id === r2.body.order.id), r.body.orders?.length);
    r = await loja.get("/api/partner/orders");
    check("partner active orders don't leak customer surname", r.status === 200 && r.body.orders.every((o: any) => !String(o.customerName).includes(" ")), r.body.orders?.map((o: any) => o.customerName));
    r = await tia.get("/api/partner/orders?scope=history");
    check("tiarosa doesn't see store 1 orders", r.body.orders.every((o: any) => o.storeId === 10), r.body.orders?.length);
    r = await est.get("/api/driver/history");
    check("driver history lists delivered order", r.body.orders.some((o: any) => o.id === id), r.body);
  });

  // =========================================================================
  await section("Online payment sandbox, refund", async () => {
    let r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "multicaixa_express" });
    check("sandbox online payment -> paymentStatus paid", r.status === 201 && r.body.order.paymentStatus === "paid", r.body);
    const id = r.body.order.id;
    r = await cli.patch(`/api/orders/${id}`, { items: [FRANGO, AGUA] });
    check("cannot change items of a paid order (409)", r.status === 409, r.body);
    r = await cli.post(`/api/orders/${id}/cancel`, {});
    check("cancel paid order -> refunded", r.status === 200 && r.body.order.status === "cancelled", r.body);
    r = await cli.get(`/api/orders/${id}`);
    check("paymentStatus refunded after cancel", r.body.order.paymentStatus === "refunded", r.body.order.paymentStatus);
  });

  // =========================================================================
  await section("Modify order reprices", async () => {
    let r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", notes: "a" });
    const id = r.body.order.id;
    r = await cli.patch(`/api/orders/${id}`, { items: [FRANGO_FUNJE, AGUA], notes: "b" });
    check("modify reprices: subtotal 10100, total 11100", r.status === 200 && r.body.order.subtotal === 10100 && r.body.order.total === 11100 && r.body.order.notes === "b", r.body);
    r = await cli.get(`/api/orders/${id}`);
    check("modified order items replaced", r.body.items.length === 2 && r.body.items.some((i: any) => i.unitPrice === 4800 && i.quantity === 2), r.body.items);
    r = await cli.patch(`/api/orders/${id}`, { items: [{ ...FRANGO, price: 1, unitPrice: 1 }], total: 1 });
    check("modify ignores tampered prices", r.status === 200 && r.body.order.total === 5500, r.body);
    r = await cli.patch(`/api/orders/${id}`, { addressId: addrIngombota });
    check("modify to address in unserved zone -> 409 ZONE_NOT_SERVED", r.status === 409, r.body);
    r = await cli.patch(`/api/orders/${id}`, { scheduledFor: luanda(1, 12) });
    check("cannot schedule an already-pending order (409)", r.status === 409, r.body);
    // scheduled order modify time
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: inMin(180) });
    check("scheduled order created with status 'scheduled'", r.status === 201 && r.body.order.status === "scheduled", r.body);
    const tr = await cli.get(`/api/orders/${r.body.order.id}/tracking`);
    check("scheduledFor round-trips exactly (no timezone shift)", Math.abs(new Date(tr.body.scheduledFor).getTime() - new Date(r.body.order.scheduledFor).getTime()) < 1000 && Math.abs(new Date(tr.body.scheduledFor).getTime() - (Date.now() + 180 * 60_000)) < 120_000, tr.body.scheduledFor);
    const sid = r.body.order.id;
    r = await cli.patch(`/api/orders/${sid}`, { scheduledFor: inMin(240) });
    check("modify scheduled time within bounds", r.status === 200, r.body);
    r = await cli.patch(`/api/orders/${sid}`, { scheduledFor: inMin(60 * 30) });
    check("modify scheduled time too far -> 400", r.status === 400, r.body);
    r = await loja.post(`/api/partner/orders/${sid}/status`, { status: "accepted" });
    check("store cannot accept a still-scheduled order (409)", r.status === 409, r.body);
    // modify with promo kept
    const nc = await newCustomer("mod");
    r = await nc.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: nc.addressId, paymentMethod: "cash", promoCode: "bemvindo" });
    check("BEMVINDO (lowercase) applied 20% of 9600 = 1920", r.status === 201 && r.body.order.discount === 1920 && r.body.order.total === 9600 + 1000 - 1920, r.body);
    r = await nc.c.patch(`/api/orders/${r.body.order.id}`, { items: [FRANGO] });
    check("modify keeps promo and recomputes 20% of 4500 = 900", r.status === 200 && r.body.order.discount === 900 && r.body.order.total === 4600, r.body);
    await cli.post(`/api/orders/${id}/cancel`, {}); await cli.post(`/api/orders/${sid}/cancel`, {});
  });

  // =========================================================================
  await section("Schedule bounds, closed store, zones", async () => {
    let r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: inMin(10) });
    check("schedule 10 min ahead -> 400 SCHEDULE_TOO_SOON", r.status === 400 && r.body.code === "SCHEDULE_TOO_SOON", r.body);
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: inMin(25 * 60) });
    check("schedule 25h ahead -> 400 SCHEDULE_TOO_FAR", r.status === 400 && r.body.code === "SCHEDULE_TOO_FAR", r.body);
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: new Date(Date.now() - 3600_000).toISOString() });
    check("schedule in the past -> 400", r.status === 400, r.body);
    // Pizzaria Ilha 11:00–23:30; schedule tomorrow 03:00 Luanda (within 24h if now > 03:00)
    const t3 = luanda(1, 3);
    if (new Date(t3).getTime() - Date.now() < 24 * 3600_000 && new Date(t3).getTime() - Date.now() > 3600_000) {
      r = await cli.post("/api/orders", { storeId: 3, items: [{ menuItemId: 21, quantity: 1, optionIds: [] }], addressId: addrIngombota, paymentMethod: "cash", scheduledFor: t3 });
      check("schedule outside opening hours (03:00 at Pizzaria Ilha) -> 409 OUTSIDE_HOURS", r.status === 409 && r.body.code === "OUTSIDE_HOURS", r.body);
    }
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrIngombota, paymentMethod: "cash" });
    check("zone not served -> 409 ZONE_NOT_SERVED", r.status === 409 && r.body.code === "ZONE_NOT_SERVED", r.body);
    r = await cli.post("/api/orders", { storeId: 11, items: [{ menuItemId: 55, quantity: 1, optionIds: [] }], addressId: addrTalatona, paymentMethod: "cash" });
    check("order at unapproved store -> 404", r.status === 404, r.body);
    // store temporarily closed
    await loja.patch("/api/partner/store", { isOpen: false });
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    check("store closed (isOpen=false) -> 409 STORE_CLOSED", r.status === 409 && r.body.code === "STORE_CLOSED", r.body);
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: inMin(120) });
    check("closed store still accepts scheduled order", r.status === 201, r.body);
    if (r.status === 201) await cli.post(`/api/orders/${r.body.order.id}/cancel`, {});
    await loja.patch("/api/partner/store", { isOpen: true });
    // outside hours immediate: set hours to a window that excludes now
    const nowL = new Date(Date.now() + 3600_000).getUTCHours();
    const o = String((nowL + 2) % 24).padStart(2, "0"), c = String((nowL + 4) % 24).padStart(2, "0");
    await loja.patch("/api/partner/store", { openingTime: `${o}:00`, closingTime: `${c}:00` });
    r = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    check("outside opening hours immediate order -> 409 OUTSIDE_HOURS", r.status === 409 && r.body.code === "OUTSIDE_HOURS", r.body);
    const st = await anon.get("/api/stores/1");
    check("store card isOpenNow=false outside hours", st.body.store.isOpenNow === false, st.body.store);
    r = await loja.patch("/api/partner/store", { openingTime: "25:99" });
    check("partner cannot set invalid time '25:99' (400)", r.status === 400, `${r.status} ${JSON.stringify(r.body?.store?.openingTime)}`);
    await loja.patch("/api/partner/store", { openingTime: "00:00", closingTime: "00:00" });
    // min order
    r = await cli.post("/api/orders", { storeId: 4, items: [{ menuItemId: 26, quantity: 1, optionIds: [] }], addressId: addrIngombota, paymentMethod: "cash" });
    check("below store minimum order -> 400 BELOW_MIN_ORDER", r.status === 400 && r.body.code === "BELOW_MIN_ORDER", r.body);
  });

  // =========================================================================
  await section("Home bakery pre-order, notice, capacity", async () => {
    let r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash" });
    check("home bakery immediate order -> 400 PREORDER_REQUIRED", r.status === 400 && r.body.code === "PREORDER_REQUIRED", r.body);
    r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: inMin(20 * 60) });
    check("home bakery with 20h notice (< 24h) -> 400 NOTICE_TOO_SHORT", r.status === 400 && r.body.code === "NOTICE_TOO_SHORT", r.body);
    r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: luanda(8, 10) });
    check("home bakery 8 days ahead -> 400 SCHEDULE_TOO_FAR", r.status === 400 && r.body.code === "SCHEDULE_TOO_FAR", r.body);
    r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: luanda(2, 21) });
    check("home bakery at 21:00 (closes 19:00) -> 409 OUTSIDE_HOURS", r.status === 409, r.body);
    r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: luanda(5, 10) });
    check("home bakery 5 days ahead accepted (pre-order up to 7 days)", r.status === 201 && r.body.order.status === "scheduled", r.body);
    if (r.status === 201) {
      const preId = r.body.order.id;
      r = await tia.get("/api/partner/orders");
      check("bakery partner sees scheduled pre-order in active list", r.body.orders.some((o: any) => o.status === "scheduled"), r.body.orders?.length);
      r = await tia.post(`/api/partner/orders/${preId}/confirm`, {});
      check("home bakery can confirm a pre-order days in advance", r.status === 200 && !!r.body.order?.storeConfirmedAt && r.body.order.status === "scheduled", `${r.status} ${r.body?.code}`);
      r = await loja.post(`/api/partner/orders/${preId}/confirm`, {});
      check("other store cannot confirm the bakery's pre-order", r.status === 403, r.status);
      r = await tia.post(`/api/partner/orders/${preId}/status`, { status: "rejected", note: "Sem disponibilidade" });
      check("home bakery can reject a pre-order it cannot fulfil", r.status === 200 || r.status === 409 && false, `${r.status} ${r.body?.code}`);
    }
    // concurrency: 8 parallel orders on day+3 → max 5
    const custs = [{ c: cli2, addressId: cli2Addr }, { c: cli, addressId: addrTalatona }];
    for (let i = 0; i < 6; i++) { const n = await newCustomer(`cap${i}`, {}, "Kilamba"); custs.push({ c: n.c, addressId: n.addressId }); }
    const day = luanda(3, 11);
    const rs = await Promise.all(custs.map((x, i) => x.c.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: x.addressId, paymentMethod: "cash", scheduledFor: luanda(3, 9 + i) })));
    const ok = rs.filter((x) => x.status === 201).length;
    const full = rs.filter((x) => x.status === 409 && x.body.code === "STORE_FULL_DAY").length;
    check(`8 parallel bakery orders same day -> exactly 5 succeed (got ${ok} ok, ${full} full)`, ok === 5 && full === 3, rs.map((x) => x.status + ":" + (x.body?.code ?? "")));
    void day;
    // capacity freed on cancel
    const winner = rs.findIndex((x) => x.status === 201);
    await custs[winner].c.post(`/api/orders/${rs[winner].body.order.id}/cancel`, {});
    const loser = rs.findIndex((x) => x.status === 409);
    r = await custs[loser].c.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: custs[loser].addressId, paymentMethod: "cash", scheduledFor: luanda(3, 17) });
    check("capacity slot freed after cancellation", r.status === 201, r.body);
    // modify scheduled order into the full day
    const d4 = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: luanda(4, 10) });
    r = await cli2.patch(`/api/orders/${d4.body.order.id}`, { scheduledFor: luanda(3, 12) });
    check("moving a pre-order into a full day -> 409 STORE_FULL_DAY", r.status === 409 && r.body.code === "STORE_FULL_DAY", r.body);
    // partner settings for notice/capacity/payout
    r = await tia.patch("/api/partner/store", { maxOrdersPerDay: 7, minNoticeMin: 2880, payoutMethod: "unitel_money", payoutReference: "923000008", isApproved: true, ratingAvg: 5, ownerId: 1 });
    check("partner updates notice/capacity/payout; cannot inject isApproved/rating/owner",
      r.status === 200 && r.body.store.maxOrdersPerDay === 7 && r.body.store.minNoticeMin === 2880 && r.body.store.payoutMethod === "unitel_money" && r.body.store.ownerId === 6, r.body?.store);
    r = await cli2.post("/api/orders", { storeId: 10, items: [{ menuItemId: 52, quantity: 1, optionIds: [] }], addressId: cli2Addr, paymentMethod: "cash", scheduledFor: inMin(30 * 60) });
    check("new 48h notice enforced (30h ahead rejected)", r.status === 400 && r.body.code === "NOTICE_TOO_SHORT", r.body);
    await tia.patch("/api/partner/store", { maxOrdersPerDay: 5, minNoticeMin: 1440 });
  });

  // =========================================================================
  await section("Concurrent driver claims", async () => {
    // approve a 2nd driver
    const d2 = new Client("drv2");
    const reg = await d2.post("/api/auth/register", { username: `drvb_${uniq}`, password: "Teste#2026xx", fullName: "Driver Dois", phone: "+244923111666", userType: "driver" });
    let r = await admin.patch(`/api/admin/users/${reg.body.user.id}`, { isApproved: true });
    check("admin approves new driver", r.status === 200 && r.body.user.isApproved === true, r.body);
    const o = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    const id = o.body.order.id;
    await loja.post(`/api/partner/orders/${id}/status`, { status: "accepted" });
    const [a, b] = await Promise.all([est.post(`/api/driver/orders/${id}/claim`), d2.post(`/api/driver/orders/${id}/claim`)]);
    const wins = [a, b].filter((x) => x.status === 200).length;
    check("two drivers claim same order concurrently -> exactly one wins", wins === 1 && [a, b].some((x) => x.status === 409), [a.status, b.status, a.body?.code, b.body?.code]);
    r = await admin.get(`/api/admin/orders`);
    // release: finish with whoever won
    const winner = a.status === 200 ? est : d2;
    await loja.post(`/api/partner/orders/${id}/status`, { status: "preparing" });
    await loja.post(`/api/partner/orders/${id}/status`, { status: "ready" });
    await winner.post(`/api/driver/orders/${id}/status`, { status: "picked_up" });
    await winner.post(`/api/driver/orders/${id}/status`, { status: "delivered" });
    // same driver claiming two different orders concurrently
    const o1 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    const o2 = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    await loja.post(`/api/partner/orders/${o1.body.order.id}/status`, { status: "accepted" });
    await loja.post(`/api/partner/orders/${o2.body.order.id}/status`, { status: "accepted" });
    const [c1, c2] = await Promise.all([d2.post(`/api/driver/orders/${o1.body.order.id}/claim`), d2.post(`/api/driver/orders/${o2.body.order.id}/claim`)]);
    const w2 = [c1, c2].filter((x) => x.status === 200).length;
    check("same driver claiming 2 orders concurrently -> only one succeeds (DRIVER_BUSY)", w2 === 1, [c1.status, c2.status, c1.body?.code, c2.body?.code]);
    // sequential busy check
    r = await d2.post(`/api/driver/orders/${(c1.status === 200 ? o2 : o1).body.order.id}/claim`);
    check("driver with active delivery cannot claim another (sequential)", r.status === 409, r.body);
    // admin assign / unassign
    for (const oo of [o1, o2]) { await admin.post(`/api/admin/orders/${oo.body.order.id}/status`, { status: "cancelled", note: "teste" }); }
    r = await admin.post(`/api/admin/orders/${o1.body.order.id}/assign-driver`, { driverId: 7 });
    check("admin cannot assign driver to cancelled order (409)", r.status === 409, r.body);
    r = await admin.post(`/api/admin/orders/${o1.body.order.id}/assign-driver`, { driverId: 8 });
    check("admin cannot assign unapproved driver (estafeta2) (400)", r.status === 400 || r.status === 409, r.body);
  });

  // =========================================================================
  await section("Admin features", async () => {
    let r = await admin.get("/api/admin/stores?pending=1");
    check("admin lists pending stores incl. Kitanda (loja2)", r.body.stores.some((s: any) => s.id === 11), r.body.stores?.map((s: any) => s.name));
    r = await loja2.get("/api/partner/store");
    check("unapproved store owner can open panel (store isApproved=false shown)", r.status === 200 && r.body.store.isApproved === false, r.body);
    r = await admin.patch("/api/admin/stores/11", { isApproved: true });
    check("admin approves loja2 store", r.status === 200 && r.body.store.isApproved === true, r.body);
    r = await anon.get("/api/stores/11");
    check("approved store now public", r.status === 200, r.status);
    r = await admin.patch("/api/admin/users/8", { isApproved: true });
    check("admin approves estafeta2", r.status === 200 && r.body.user.isApproved, r.body);
    r = await est2.get("/api/driver/available");
    check("approved estafeta2 can now use driver panel", r.status === 200, r.status);
    r = await admin.get("/api/admin/stats");
    check("admin stats", r.status === 200 && typeof r.body.users === "number", r.body);
    // promo create
    r = await admin.post("/api/admin/promos", { code: `TESTE${uniq}`.toUpperCase(), discountType: "fixed", value: 700, maxUsesPerUser: 1 });
    check("admin creates promo", r.status === 201, r.body);
    const pid = r.body.promo?.id;
    r = await admin.post("/api/admin/promos", { code: `teste${uniq}`, discountType: "fixed", value: 700 });
    check("duplicate promo code (case-insensitive) -> 409", r.status === 409, r.body);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: `teste${uniq}` });
    check("custom fixed promo gives 700 off", r.status === 200 && r.body.quote.discount === 700, r.body);
    await admin.patch(`/api/admin/promos/${pid}`, { isActive: false });
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: `teste${uniq}` });
    check("deactivated promo -> 400 PROMO_INVALID", r.status === 400 && r.body.code === "PROMO_INVALID", r.body);
    r = await admin.post("/api/admin/users/999999/plus", { months: 1 });
    check("admin Plus activation for non-existent user -> 404 (not 500)", r.status === 404, `${r.status} ${r.text.slice(0, 100)}`);
    r = await admin.post("/api/admin/promos", { code: "X", discountType: "percent", value: 10 });
    check("invalid promo code format rejected", r.status === 400, r.status);
    // admin status override
    const o = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    r = await admin.post(`/api/admin/orders/${o.body.order.id}/status`, { status: "accepted" });
    check("admin status override pending -> accepted", r.status === 200, r.body);
    r = await admin.post(`/api/admin/orders/${o.body.order.id}/assign-driver`, { driverId: 7 });
    check("admin assigns driver", r.status === 200 && r.body.order.driverId === 7, r.body);
    const busy = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash" });
    await loja.post(`/api/partner/orders/${busy.body.order.id}/status`, { status: "accepted" });
    r = await admin.post(`/api/admin/orders/${busy.body.order.id}/assign-driver`, { driverId: 7 });
    check("admin cannot assign a driver who already has an active delivery", r.status === 409 || r.status === 400, `${r.status}: driver 7 now has 2 active orders`);
    await admin.post(`/api/admin/orders/${busy.body.order.id}/status`, { status: "cancelled" });
    r = await admin.post(`/api/admin/orders/${o.body.order.id}/assign-driver`, { driverId: null });
    check("admin unassigns driver", r.status === 200 && r.body.order.driverId === null, r.body);
    r = await admin.post(`/api/admin/orders/${o.body.order.id}/status`, { status: "cancelled" });
    check("admin cancels order", r.status === 200, r.body);
  });

  // =========================================================================
  await section("Promo rules", async () => {
    const n = await newCustomer("promo");
    let r = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: n.addressId, paymentMethod: "cash", promoCode: "BEMVINDO" });
    check("BEMVINDO on first order", r.status === 201 && r.body.order.promoCode === "BEMVINDO", r.body);
    const first = r.body.order.id;
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "BEMVINDO" });
    check("BEMVINDO second time -> 400 (already used / first order only)", r.status === 400 && ["PROMO_ALREADY_USED", "PROMO_FIRST_ORDER"].includes(r.body.code), r.body);
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "BEMVINDO" });
    check("BEMVINDO for customer with previous orders -> 400", r.status === 400, r.body);
    // max discount cap: 20% of 4800*10 = 9600 → capped 2000
    const n2 = await newCustomer("promocap");
    r = await n2.c.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: 1, quantity: 10, optionIds: [2, 6] }], promoCode: "BEMVINDO" });
    check("BEMVINDO capped at 2000 Kz", r.status === 200 && r.body.quote.discount === 2000, r.body);
    await n.c.post(`/api/orders/${first}/cancel`, {});
    // ENTREGAGRATIS: min 5000, 3 uses/user
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "ENTREGAGRATIS" });
    check("ENTREGAGRATIS below 5000 -> 400 PROMO_MIN_ORDER", r.status === 400 && r.body.code === "PROMO_MIN_ORDER", r.body);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      r = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: n.addressId, paymentMethod: "cash", promoCode: "ENTREGAGRATIS" });
      check(`ENTREGAGRATIS use ${i + 1}/3 gives free delivery`, r.status === 201 && r.body.order.discount === 1000 && r.body.order.total === 9600, r.body);
      if (r.status === 201) ids.push(r.body.order.id);
    }
    r = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: n.addressId, paymentMethod: "cash", promoCode: "ENTREGAGRATIS" });
    check("ENTREGAGRATIS 4th use -> 400 PROMO_ALREADY_USED", r.status === 400 && r.body.code === "PROMO_ALREADY_USED", r.body);
    await n.c.post(`/api/orders/${ids[0]}/cancel`, {});
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO_FUNJE], promoCode: "ENTREGAGRATIS" });
    check("cancelled order returns promo use", r.status === 200, r.body);
    // concurrent promo reuse by same user (first order)
    const n3 = await newCustomer("promorace");
    const rs = await Promise.all([0, 1, 2].map(() => n3.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: n3.addressId, paymentMethod: "cash", promoCode: "BEMVINDO" })));
    check("parallel BEMVINDO orders by same new user -> only 1 succeeds", rs.filter((x) => x.status === 201).length === 1, rs.map((x) => x.status + ":" + (x.body?.code ?? "")));
    // global maxUses race: promo with maxUses=1, 4 different users in parallel
    const code = `UMAVEZ${uniq}`.toUpperCase();
    await admin.post("/api/admin/promos", { code, discountType: "fixed", value: 500, maxUses: 1 });
    const racers = [] as { c: Client; addressId: number }[];
    for (let i = 0; i < 4; i++) { const x = await newCustomer(`mx${i}`); racers.push({ c: x.c, addressId: x.addressId }); }
    const pr = await Promise.all(racers.map((x) => x.c.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: x.addressId, paymentMethod: "cash", promoCode: code })));
    check("promo with maxUses=1 used in parallel by 4 users -> only 1 succeeds", pr.filter((x) => x.status === 201).length === 1, pr.map((x) => x.status));
    for (let i = 0; i < 4; i++) if (pr[i].status === 201) await racers[i].c.post(`/api/orders/${pr[i].body.order.id}/cancel`, {});
    // PLUS10
    r = await n2.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "PLUS10" });
    check("PLUS10 for non-Plus -> 400 PROMO_PLUS_ONLY", r.status === 400 && r.body.code === "PROMO_PLUS_ONLY", r.body);
    r = await n2.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "NAOEXISTE" });
    check("unknown promo -> 400 PROMO_INVALID", r.status === 400 && r.body.code === "PROMO_INVALID", r.body);
    for (const id of ids.slice(1)) await n.c.post(`/api/orders/${id}/cancel`, {});
  });

  // =========================================================================
  await section("PedeJá Plus", async () => {
    const n = await newCustomer("plus");
    let r = await n.c.get("/api/plus");
    check("GET /plus inactive by default", r.status === 200 && r.body.active === false && r.body.monthlyPrice > 0, r.body);
    r = await n.c.post("/api/plus/subscribe", { paymentMethod: "cash" });
    check("Plus with cash -> 409 PLUS_CASH", r.status === 409, r.body);
    r = await n.c.post("/api/plus/subscribe", { paymentMethod: "card", price: 1 });
    check("Plus subscribe via sandbox card", r.status === 201 && r.body.subscription.status === "active", r.body);
    r = await n.c.post("/api/plus/subscribe", { paymentMethod: "card" });
    check("double Plus subscribe -> 409 ALREADY_PLUS", r.status === 409, r.body);
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO] });
    check("Plus: free delivery above min (4500 >= 3000)", r.body.quote.deliveryFee === 0 && r.body.quote.isPlus === true && r.body.quote.plusSavings === 1000, r.body.quote);
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [AGUA] });
    check("Plus: delivery charged below min (500 < 3000)", r.body.quote.deliveryFee === 1000, r.body.quote);
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], promoCode: "PLUS10" });
    check("PLUS10 accepted for Plus member (10% of 4500 = 450)", r.status === 200 && r.body.quote.discount === 450, r.body);
    r = await n.c.post("/api/plus/cancel");
    check("Plus cancel keeps active until end (autoRenew false)", r.status === 200 && r.body.subscription.autoRenew === false && r.body.subscription.status === "active", r.body);
    // concurrent subscribe race
    const n2 = await newCustomer("plusrace");
    const rs = await Promise.all([0, 1, 2, 3, 4].map(() => n2.c.post("/api/plus/subscribe", { paymentMethod: "card" })));
    check("parallel Plus subscribe -> only one charge/subscription", rs.filter((x) => x.status === 201).length === 1, rs.map((x) => x.status));
    // admin activation
    r = await admin.post(`/api/admin/users/3/plus`, { months: 2 });
    check("admin activates Plus for cliente2", r.status === 201, r.body);
    r = await cli2.get("/api/plus");
    check("cliente2 is Plus after admin activation", r.body.active === true, r.body);
  });

  // =========================================================================
  await section("Loyalty points & referral", async () => {
    const pts = (await cli.get("/api/auth/points")).body;
    check("points endpoint returns referralCode", typeof pts.referralCode === "string" && pts.referralCode.length >= 5, pts);
    let r = await anon.post("/api/auth/register", { username: `refbad_${uniq}`, password: "Teste#2026xx", fullName: "Ref Bad", phone: "+244923111777", referralCode: "ZZZZZZZ" });
    check("invalid referral code -> 400", r.status === 400 && r.body.code === "REFERRAL_INVALID", r.body);
    const before = (await cli.get("/api/auth/me")).body.user.loyaltyPoints;
    const n = await newCustomer("ref", { referralCode: pts.referralCode.toLowerCase() });
    check("referred user gets welcome bonus 100 points", n.user.loyaltyPoints === 100, n.user);
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [FRANGO], usePoints: 100000 });
    check("usePoints capped at balance (100 pts = 1000 Kz)", r.status === 200 && r.body.quote.pointsRedeemed === 100 && r.body.quote.pointsDiscount === 1000, r.body.quote);
    r = await n.c.post("/api/cart/quote", { storeId: 1, items: [AGUA], usePoints: 100 });
    check("usePoints capped at 50% of total (1500*50% = 750 Kz -> 75 pts)", r.status === 200 && r.body.quote.pointsRedeemed === 75, r.body.quote);
    r = await anon.post("/api/cart/quote", { storeId: 1, items: [FRANGO], usePoints: 10 });
    check("anonymous usePoints -> 400", r.status === 400, r.body);
    r = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: n.addressId, paymentMethod: "cash", usePoints: 100 });
    check("order with points: total 5500 - 1000 = 4500", r.status === 201 && r.body.order.pointsRedeemed === 100 && r.body.order.total === 4500, r.body);
    let me = (await n.c.get("/api/auth/me")).body.user;
    check("points deducted after order (0)", me.loyaltyPoints === 0, me);
    await n.c.post(`/api/orders/${r.body.order.id}/cancel`, {});
    me = (await n.c.get("/api/auth/me")).body.user;
    check("points refunded after cancel (100)", me.loyaltyPoints === 100, me);
    // parallel points double-spend
    const rs = await Promise.all([0, 1].map(() => n.c.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: n.addressId, paymentMethod: "cash", usePoints: 100 })));
    const redeemed = rs.filter((x) => x.status === 201).reduce((s, x) => s + x.body.order.pointsRedeemed, 0);
    me = (await n.c.get("/api/auth/me")).body.user;
    check("parallel orders cannot double-spend points", redeemed <= 100 && me.loyaltyPoints >= 0, { redeemed, bal: me.loyaltyPoints });
    // deliver one order → referrer bonus
    const toDeliver = rs.find((x) => x.status === 201)!.body.order.id;
    for (const x of rs) if (x.status === 201 && x.body.order.id !== toDeliver) await n.c.post(`/api/orders/${x.body.order.id}/cancel`, {});
    const balBeforeDelivery = (await n.c.get("/api/auth/me")).body.user.loyaltyPoints;
    await deliver(toDeliver);
    const after = (await cli.get("/api/auth/me")).body.user.loyaltyPoints;
    check("referrer gets 100 bonus after referee's first delivery", after - before === 100, { before, after });
    me = (await n.c.get("/api/auth/me")).body.user;
    const ord = (await n.c.get(`/api/orders/${toDeliver}`)).body.order;
    check("customer earns 1 pt / 100 Kz on delivery", me.loyaltyPoints === balBeforeDelivery + Math.floor(ord.total / 100), { before: balBeforeDelivery, pts: me.loyaltyPoints, total: ord.total });
    const o2 = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: n.addressId, paymentMethod: "cash" });
    await deliver(o2.body.order.id);
    const after2 = (await cli.get("/api/auth/me")).body.user.loyaltyPoints;
    check("no referral bonus on referee's second delivery", after2 === after, { after, after2 });
    // modify an order that used points down to a small basket: points discount must respect 50% cap
    const m = await newCustomer("ptsmod", { referralCode: pts.referralCode });
    const mo = await m.c.post("/api/orders", { storeId: 1, items: [FRANGO_FUNJE], addressId: m.addressId, paymentMethod: "cash", usePoints: 100 });
    const mm = await m.c.patch(`/api/orders/${mo.body.order.id}`, { items: [AGUA] });
    check("modify order: points discount still capped at 50% of total (AGUA 500+1000 fee -> max 750 Kz off)", mm.status === 200 && mm.body.order.total >= 750, { total: mm.body?.order?.total, discount: mm.body?.order?.discount, pointsRedeemed: mm.body?.order?.pointsRedeemed });
    await m.c.post(`/api/orders/${mo.body.order.id}/cancel`, {});
    const hist = (await n.c.get("/api/auth/points")).body;
    check("points history lists welcome/redeem/refund/earned", ["welcome_bonus", "order_redeemed", "refund", "order_earned"].every((k) => hist.history.some((h: any) => h.reason === k)), hist.history?.map((h: any) => h.reason));
  });

  // =========================================================================
  await section("Reviews", async () => {
    const n = await newCustomer("rev");
    const o = await n.c.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: n.addressId, paymentMethod: "cash" });
    const id = o.body.order.id;
    let r = await n.c.post(`/api/orders/${id}/review`, { rating: 5 });
    check("review before delivery -> 409 NOT_DELIVERED", r.status === 409, r.body);
    await deliver(id);
    r = await cli.post(`/api/orders/${id}/review`, { rating: 1 });
    check("other customer cannot review someone's order (403)", r.status === 403, r.status);
    const storeBefore = (await anon.get("/api/stores/1")).body.store;
    const rs = await Promise.all([n.c.post(`/api/orders/${id}/review`, { rating: 2, driverRating: 4, comment: "Frango frio <b>x</b>" }), n.c.post(`/api/orders/${id}/review`, { rating: 2 })]);
    check("concurrent double review -> one 201 and one 409 (no 500)", rs.filter((x) => x.status === 201).length === 1 && rs.filter((x) => x.status === 409).length === 1, rs.map((x) => x.status));
    r = await n.c.post(`/api/orders/${id}/review`, { rating: 5 });
    check("second review -> 409 ALREADY_REVIEWED", r.status === 409, r.body);
    const storeAfter = (await anon.get("/api/stores/1")).body.store;
    check(`store rating count increments by 1 (before ${storeBefore.ratingCount}/${storeBefore.ratingAvg}, after ${storeAfter.ratingCount}/${storeAfter.ratingAvg})`, storeAfter.ratingCount === storeBefore.ratingCount + 1, "aggregate recomputed only from reviews table, discarding existing rating_count/avg");
    const pubAvg = (await anon.get("/api/stores/1/reviews")).body.reviews;
    const realAvg = pubAvg.reduce((s: number, x: any) => s + x.rating, 0) / pubAvg.length;
    check("store ratingAvg equals average of published reviews", Math.abs(storeAfter.ratingAvg - Math.round(realAvg * 10) / 10) < 0.06, { storeAvg: storeAfter.ratingAvg, realAvg });
    const revs = (await anon.get("/api/stores/1/reviews")).body.reviews;
    check("public reviews show first name only", revs.length > 0 && revs.every((x: any) => !String(x.author).includes(" ")), revs.map((x: any) => x.author));
    const pr = await loja.get("/api/partner/reviews");
    const rid = pr.body.reviews.find((x: any) => x.orderId === id)?.id;
    r = await loja.post(`/api/partner/reviews/${rid}/reply`, { reply: "Pedimos desculpa!" });
    check("partner replies to review", r.status === 200 && r.body.review.reply === "Pedimos desculpa!", r.body);
    const revs2 = (await anon.get("/api/stores/1/reviews")).body.reviews;
    check("reply visible publicly", revs2.some((x: any) => x.reply === "Pedimos desculpa!"), revs2.length);
    r = await n.c.get(`/api/orders/${id}`);
    check("order canReview false after review", r.body.order.canReview === false && r.body.review?.rating === 2, r.body.order.canReview);
    r = await loja.get("/api/partner/stats");
    check("partner stats has rating & topItems", r.status === 200 && Array.isArray(r.body.topItems) && r.body.last30Days.orders >= 1, r.body);
  });

  // =========================================================================
  await section("Group ordering", async () => {
    let r = await anon.post("/api/groups", { storeId: 1 });
    check("anonymous cannot create group (401)", r.status === 401, r.status);
    r = await cli.post("/api/groups", { storeId: 1 });
    check("host creates group", r.status === 201 && r.body.token && r.body.secret, r.body);
    const { token, participantId: hostPid, secret: hostSecret } = r.body;
    const guest = new Client("guest");
    r = await guest.post(`/api/groups/${token}/items`, FRANGO);
    check("add item without secret -> 401 NOT_PARTICIPANT", r.status === 401, r.body);
    r = await guest.post(`/api/groups/${token}/items`, FRANGO, { "X-Group-Participant": String(hostPid), "X-Group-Secret": "wrong" });
    check("add item with wrong secret -> 401", r.status === 401, r.body);
    r = await guest.post(`/api/groups/${token}/join`, { name: "Zé Convidado" });
    check("guest joins without account", r.status === 201 && r.body.secret, r.body);
    const g = { "X-Group-Participant": String(r.body.participantId), "X-Group-Secret": r.body.secret };
    r = await guest.post(`/api/groups/${token}/items`, { ...FRANGO_FUNJE, price: 1 }, g);
    check("guest adds item", r.status === 201, r.body);
    const guestItem = r.body.item?.id;
    r = await guest.post(`/api/groups/${token}/items`, { menuItemId: 1, quantity: 1, optionIds: [] }, g);
    check("guest item missing required option rejected", r.status === 400, r.body);
    r = await cli.post(`/api/groups/${token}/items`, AGUA, { "X-Group-Participant": String(hostPid), "X-Group-Secret": hostSecret });
    check("host adds item", r.status === 201, r.body);
    r = await guest.get(`/api/groups/${token}`);
    check("group view shows 2 participants, subtotal 10100, no secrets leaked", r.status === 200 && r.body.participants.length === 2 && r.body.subtotal === 10100 && !r.text.includes(hostSecret) && !/secret/i.test(r.text), { st: r.status, sub: r.body.subtotal });
    // other group's participant credentials can't be used
    const other = await cli2.post("/api/groups", { storeId: 1 });
    r = await guest.post(`/api/groups/${token}/items`, AGUA, { "X-Group-Participant": String(other.body.participantId), "X-Group-Secret": other.body.secret });
    check("participant of another group cannot add to this group", r.status === 401, r.body);
    r = await guest.del(`/api/groups/${token}/items/abc`, g);
    check("DELETE group item with non-numeric id -> 400/404 (not 500)", r.status === 400 || r.status === 404, `${r.status} ${r.text.slice(0, 100)}`);
    // non-host checkout
    r = await cli2.post(`/api/groups/${token}/checkout`, { addressId: cli2Addr, paymentMethod: "cash" });
    check("non-host checkout -> 403", r.status === 403, r.body);
    r = await guest.post(`/api/groups/${token}/checkout`, { addressId: 1, paymentMethod: "cash" });
    check("anonymous guest checkout -> 401", r.status === 401, r.body);
    r = await cli2.post(`/api/groups/${token}/lock`, { locked: true });
    check("non-host lock -> 403", r.status === 403, r.body);
    // concurrent double checkout by host
    const rs = await Promise.all([0, 1].map(() => cli.post(`/api/groups/${token}/checkout`, { addressId: addrTalatona, paymentMethod: "cash", notes: "grupo" })));
    const okN = rs.filter((x) => x.status === 201).length;
    check("concurrent double group checkout -> exactly one order", okN === 1, rs.map((x) => x.status + ":" + (x.body?.code ?? x.body?.order?.id)));
    const oid = rs.find((x) => x.status === 201)?.body.order.id;
    r = await cli.get(`/api/orders/${oid}`);
    check("group order items carry addedBy names", r.body.items?.some((i: any) => i.addedBy === "Zé Convidado") && r.body.items.some((i: any) => i.addedBy === "Maria"), r.body.items?.map((i: any) => i.addedBy));
    check("group order total server-computed (10100 + 1000)", r.body.order?.total === 11100, r.body.order?.total);
    r = await guest.post(`/api/groups/${token}/items`, AGUA, g);
    check("cannot add items after checkout", r.status === 409, r.body);
    r = await guest.del(`/api/groups/${token}/items/${guestItem}`, g);
    check("cannot delete items after checkout", r.status === 409, r.body);
    r = await cli.patch(`/api/orders/${oid}`, { items: [AGUA] });
    check("group order items cannot be modified (409)", r.status === 409, r.body);
    for (const x of rs) if (x.status === 201) await cli.post(`/api/orders/${x.body.order.id}/cancel`, {});
    // supplier/driver as group host bypasses customer-only ordering
    const la = await loja.post("/api/addresses", { label: "Loja", street: "Rua da loja", zone: "Kilamba" });
    const lg = await loja.post("/api/groups", { storeId: 2 });
    await loja.post(`/api/groups/${lg.body.token}/items`, { menuItemId: 13, quantity: 1, optionIds: [] }, { "X-Group-Participant": String(lg.body.participantId), "X-Group-Secret": lg.body.secret });
    r = await loja.post(`/api/groups/${lg.body.token}/checkout`, { addressId: la.body.address?.id, paymentMethod: "cash" });
    check("supplier account cannot place orders via group checkout (should be 403 like /api/orders)", r.status === 403, `${r.status} ${r.body?.order ? "order " + r.body.order.id + " created" : r.text.slice(0, 100)}`);
    if (r.status === 201) await admin.post(`/api/admin/orders/${r.body.order.id}/status`, { status: "cancelled" });
  });

  // =========================================================================
  await section("Partner menu editor", async () => {
    const menu = (await loja.get("/api/partner/menu")).body;
    let r = await loja.post("/api/partner/items", {
      sectionId: menu.sections[0].id, name: "Prato de teste", price: 2000, dietaryTags: ["vegan"], allergens: ["soy"], unitPrice: 1, storeId: 2,
      optionGroups: [{ name: "Tamanho", minSelect: 1, maxSelect: 1, options: [{ name: "Normal", priceDelta: 0 }, { name: "Grande", priceDelta: 500 }] }],
    });
    check("partner creates item with option groups (storeId injection ignored)", r.status === 201 && r.body.item.storeId === 1, r.body);
    const itemId = r.body.item.id;
    const st = (await anon.get("/api/stores/1")).body.items.find((i: any) => i.id === itemId);
    check("new item visible on public store menu with options", st && st.optionGroups[0].options.length === 2, st);
    const big = st.optionGroups[0].options.find((o: any) => o.name === "Grande").id;
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: itemId, quantity: 2, optionIds: [big] }] });
    check("quote uses new item price + option delta (2*2500)", r.body.quote?.subtotal === 5000, r.body);
    r = await loja.patch(`/api/partner/items/${itemId}/availability`, { isAvailable: false });
    r = await cli.post("/api/cart/quote", { storeId: 1, items: [{ menuItemId: itemId, quantity: 1, optionIds: [big] }] });
    check("unavailable item -> 409 ITEM_UNAVAILABLE", r.status === 409, r.body);
    r = await loja.post("/api/partner/items", { name: "Neg", price: -5 });
    check("negative price rejected", r.status === 400, r.status);
    r = await loja.post("/api/partner/items", { name: "Bad grp", price: 100, optionGroups: [{ name: "G", minSelect: 3, maxSelect: 3, options: [{ name: "a" }] }] });
    check("option group requiring more selections than options rejected (400)", r.status === 400, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
    r = await loja.del(`/api/partner/items/1`);
    check("deleting an item used in orders archives it", r.status === 200 && r.body.archived === true, r.body);
    await loja.patch(`/api/partner/items/1/availability`, { isAvailable: true });
    r = await loja.del(`/api/partner/items/${itemId}`);
    check("delete unused item -> 204", r.status === 204, r.status);
  });

  // =========================================================================
  await section("Scheduled release (scheduler)", async () => {
    const o = await cli.post("/api/orders", { storeId: 1, items: [FRANGO], addressId: addrTalatona, paymentMethod: "cash", scheduledFor: inMin(32) });
    check("scheduled order (32 min) created", o.status === 201 && o.body.order.status === "scheduled", o.body);
    let status = "scheduled";
    for (let i = 0; i < 15 && status === "scheduled"; i++) { await sleep(5000); status = (await cli.get(`/api/orders/${o.body.order.id}`)).body.order.status; }
    check("scheduler releases scheduled order to pending within ~75s", status === "pending", status);
    await cli.post(`/api/orders/${o.body.order.id}/cancel`, {});
  });

  // =========================================================================
  const failed = results.filter((r) => !r.ok);
  console.log(`\n\n========== SUMMARY: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total ==========`);
  for (const f of failed) console.log(`FAIL  ${f.name}\n      ${f.detail}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
