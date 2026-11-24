/**
 * Switches of the admin security that need their own server settings:
 *   ADMIN_HOST, ADMIN_ALLOWED_IPS, ADMIN_IDLE_MIN and ADMIN_REQUIRE_2FA (on).
 * Start the server with:
 *   ADMIN_HOST=admin.pedeja.test ADMIN_ALLOWED_IPS=127.0.0.1,10.0.0.0/8 ADMIN_IDLE_MIN=0.05 bash scripts/local-server.sh
 * then: node tests/admin-security.smoke.mjs
 * Uses raw http so the Host header can be set (simulates admin.pedeja.test vs the public address).
 */
import http from "node:http";

const PORT = Number(process.env.PORT || 5055);
let pass = 0, fail = 0;
const check = (name, ok, detail) => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + JSON.stringify(detail)}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, path, { host = "localhost", body, cookie, xff } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : undefined;
    const headers = { Host: `${host}:${PORT}`, Origin: `http://${host}:${PORT}`, ...(data ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(xff ? { "X-Forwarded-For": xff } : {}) };
    const r = http.request({ host: "127.0.0.1", port: PORT, method, path, headers }, (res) => {
      let buf = ""; res.on("data", (c) => (buf += c)); res.on("end", () => {
        let json = null; try { json = JSON.parse(buf); } catch { /* html */ }
        resolve({ status: res.statusCode, body: json, cookie: (res.headers["set-cookie"] || [])[0]?.split(";")[0] });
      });
    });
    r.on("error", reject); if (data) r.write(data); r.end();
  });
}
const ADMIN = "admin.pedeja.test";
const login = (host, u, p, xff) => req("POST", "/api/auth/login", { host, body: { username: u, password: p }, xff });

let r = await login("localhost", "admin", "Admin#2026demo");
check("admin login refused on the public address (ADMIN_HOST_ONLY)", r.status === 403 && r.body?.code === "ADMIN_HOST_ONLY" && r.body.message.includes(ADMIN), r.body);
r = await login(ADMIN, "cliente", "Cliente#2026");
check("customers can't log in on the admin address", r.status === 403 && r.body?.code === "ADMIN_HOST_STAFF_ONLY", r.body);
r = await req("GET", "/api/admin/stats", { host: "localhost" });
check("admin API doesn't exist on the public address (404)", r.status === 404, r.status);
r = await req("GET", "/api/meta", { host: "localhost" });
check("meta tells the app where the admin lives", r.body?.adminHost === ADMIN, r.body?.adminHost);

r = await login(ADMIN, "admin", "Admin#2026demo", "203.0.113.7");
check("admin login from a connection not on the list is blocked", r.status === 403 && r.body?.code === "IP_NOT_ALLOWED", r.body);
r = await login(ADMIN, "admin", "Admin#2026demo", "10.1.2.3");
check("connection inside an allowed range (10.0.0.0/8) can log in", r.status === 200 && r.body?.user, r.body);
r = await login(ADMIN, "admin", "Admin#2026demo");
const cookie = r.cookie;
check("admin logs in on the admin address", r.status === 200 && r.body?.user?.twoFactorSetupRequired === true, r.body);
r = await req("GET", "/api/admin/stats", { host: ADMIN, cookie });
check("2FA required: portal blocked until it's set up (TWO_FACTOR_SETUP_REQUIRED)", r.status === 403 && r.body?.code === "TWO_FACTOR_SETUP_REQUIRED", r.body);
r = await req("POST", "/api/auth/2fa/setup", { host: ADMIN, cookie });
check("…but the 2FA setup itself is reachable", r.status === 200 && !!r.body?.secret, r.status);
r = await req("GET", "/api/admin/stats", { host: ADMIN, cookie, xff: "198.51.100.9" });
check("an existing session from a non-allowed connection is refused", r.status === 403 && r.body?.code === "IP_NOT_ALLOWED", r.body);

await sleep(4000); // ADMIN_IDLE_MIN=0.05 → 3 s
r = await req("GET", "/api/auth/me", { host: ADMIN, cookie });
check("admin session ends after the idle time (SESSION_EXPIRED)", r.status === 401 && r.body?.code === "SESSION_EXPIRED", r.body);

console.log(`\n========== ADMIN SECURITY SUMMARY: ${pass} passed, ${fail} failed ==========`);
process.exit(fail ? 1 : 0);
