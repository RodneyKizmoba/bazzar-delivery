// PedeJá — headless-browser UI journey test.
// Run: node tests/ui.test.mjs   (server on BASE, fresh seeded DB recommended)
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const BASE = process.env.BASE || "http://localhost:5055";
const SHOTS = path.resolve("tests/screenshots");
fs.mkdirSync(SHOTS, { recursive: true });
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };
const DESKTOP = { width: 1280, height: 800 };

const results = [];
const pageIssues = []; // {page, kind, detail}
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: ok ? undefined : String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400) });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400)}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/google-chrome", headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=pt-PT"],
});

async function newCtx(label, viewport = MOBILE) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  page.__label = label;
  page.__current = "start";
  page.on("console", (m) => { if (m.type() === "error") pageIssues.push({ ctx: label, page: page.__current, kind: "console.error", detail: m.text().slice(0, 300) }); });
  page.on("pageerror", (e) => pageIssues.push({ ctx: label, page: page.__current, kind: "pageerror", detail: String(e.message).slice(0, 300) }));
  page.on("requestfailed", (r) => { if (!r.url().includes("favicon")) pageIssues.push({ ctx: label, page: page.__current, kind: "requestfailed", detail: `${r.method()} ${r.url()} ${r.failure()?.errorText}` }); });
  page.on("response", (r) => { if (r.status() >= 400) pageIssues.push({ ctx: label, page: page.__current, kind: `http${r.status()}`, detail: `${r.request().method()} ${r.url().replace(BASE, "")}` }); });
  return { ctx, page };
}

async function go(page, url, name) {
  page.__current = name;
  await page.goto(BASE + url, { waitUntil: "networkidle0", timeout: 30000 });
  await sleep(400);
}

// DOM quality audit on current page
async function audit(page, name, { lang } = {}) {
  page.__current = name;
  const a = await page.evaluate(() => {
    const text = document.body.innerText;
    const bad = [];
    for (const k of ["NaN", "undefined", "[object Object]", "Invalid Date", "null Kz"]) if (text.includes(k)) {
      const i = text.indexOf(k); bad.push(`${k}: "…${text.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, " ")}…"`);
    }
    const unnamed = [];
    for (const el of document.querySelectorAll("button, [role=button], a[href]")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const name = (el.getAttribute("aria-label") || el.innerText || el.getAttribute("title") || "").trim()
        || [...el.querySelectorAll("img[alt]")].map((i) => i.alt).join("").trim()
        || (el.getAttribute("aria-labelledby") ? document.getElementById(el.getAttribute("aria-labelledby"))?.innerText : "");
      if (!name) unnamed.push(el.outerHTML.slice(0, 160));
    }
    const unlabeled = [];
    for (const el of document.querySelectorAll("input:not([type=hidden]), select, textarea")) {
      const r = el.getBoundingClientRect(); if (r.width === 0) continue;
      const id = el.id;
      const has = el.getAttribute("aria-label") || el.getAttribute("aria-labelledby") || (id && document.querySelector(`label[for="${id}"]`)) || el.closest("label");
      if (!has) unlabeled.push(el.outerHTML.slice(0, 160));
    }
    return { sw: document.documentElement.scrollWidth, iw: window.innerWidth, bad, unnamed, unlabeled, text };
  });
  if (a.sw > a.iw) pageIssues.push({ ctx: page.__label, page: name, kind: "overflow", detail: `scrollWidth ${a.sw} > innerWidth ${a.iw}` });
  for (const b of a.bad) pageIssues.push({ ctx: page.__label, page: name, kind: "bad-text", detail: b });
  for (const u of a.unnamed) pageIssues.push({ ctx: page.__label, page: name, kind: "unnamed-button", detail: u });
  for (const u of a.unlabeled) pageIssues.push({ ctx: page.__label, page: name, kind: "unlabeled-input", detail: u });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: true });
  return a;
}

async function textOf(page) { return page.evaluate(() => document.body.innerText); }
async function waitText(page, re, timeout = 10000) {
  const src = re instanceof RegExp ? re.source : re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = re instanceof RegExp ? re.flags : "";
  try {
    await page.waitForFunction((s, f) => new RegExp(s, f).test(document.body.innerText), { timeout }, src, flags);
    return true;
  } catch { return false; }
}
// click the visible element (button/a/label/[role]) whose text matches
async function clickText(page, re, { selector = "button, a, label, [role=button], [role=tab], [role=radio], [role=option], [role=menuitem]", exact = false } = {}) {
  const src = re instanceof RegExp ? re.source : re.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const flags = re instanceof RegExp ? re.flags : "";
  const ok = await page.evaluate((sel, s, f, ex) => {
    const rx = new RegExp(ex ? `^\\s*${s}\\s*$` : s, f);
    const els = [...document.querySelectorAll(sel)].filter((e) => {
      const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && !e.disabled;
    });
    const el = els.find((e) => rx.test((e.innerText || e.getAttribute("aria-label") || "").trim()));
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    el.click();
    return true;
  }, selector, src, flags, exact);
  await sleep(500);
  return ok;
}
async function login(page, username, password, next = "/") {
  await go(page, `/entrar?next=${encodeURIComponent(next)}`, `login-${username}`);
  await page.type("#username", username);
  await page.type("#password", password);
  await Promise.all([page.waitForNetworkIdle({ idleTime: 500, timeout: 15000 }).catch(() => {}), page.click("button[type=submit]")]);
  await sleep(1500);
  check(`login ${username} leaves /entrar without reload (→ ${next})`, !/\/entrar/.test(page.url()), page.url());
}
async function apiFetch(page, method, url, body) {
  return page.evaluate(async (m, u, b) => {
    const r = await fetch(u, { method: m, headers: b ? { "Content-Type": "application/json" } : {}, body: b ? JSON.stringify(b) : undefined, credentials: "include" });
    let j = null; try { j = await r.json(); } catch {}
    return { status: r.status, body: j };
  }, method, url, body);
}

// ===========================================================================
// 1. Customer journey
// ===========================================================================
const { ctx: cctx, page: cp } = await newCtx("customer");
let orderId = null;
try {
  await go(cp, "/", "01-home");
  const home = await audit(cp, "01-home");
  check("home renders store sections", /Grelhados do Mussulo/.test(home.text), home.text.slice(0, 200));
  check("home has 'Feito em casa' entry", /Feito em casa/.test(home.text), "");

  await go(cp, "/pesquisa?q=frango", "02-search");
  await waitText(cp, /Grelhados do Mussulo/);
  let a = await audit(cp, "02-search-frango");
  check("search 'frango' shows Grelhados do Mussulo + matching dish", /Grelhados do Mussulo/.test(a.text) && /Frango grelhado/.test(a.text), a.text.slice(0, 300));
  // open filters and choose Feito em casa
  await go(cp, "/pesquisa", "03-search-filter");
  const openedFilters = await cp.evaluate(() => { const b = document.querySelector('button[aria-label="Filtros"]'); if (b) { b.click(); return true; } return false; });
  await sleep(600);
  const clickedHome = await clickText(cp, /Feito em casa/, { selector: '[role="dialog"] button' });
  await sleep(1200);
  // close the sheet if there's an apply button
  await clickText(cp, /^(Ver|Aplicar|Mostrar).*/i);
  await sleep(800);
  a = await audit(cp, "03-search-homemade");
  const url = cp.url();
  check("search filter 'Feito em casa' applies homeBusiness=1 and shows Tia Rosa only", openedFilters && clickedHome && /homeBusiness=1/.test(url) && /Bolos da Tia Rosa/.test(a.text) && !/Grelhados do Mussulo/.test(a.text), { openedFilters, clickedHome, url, t: a.text.slice(0, 300) });

  // store page
  await go(cp, "/loja/1", "04-store1");
  a = await audit(cp, "04-store1");
  check("store 1 page shows name and menu", /Grelhados do Mussulo/.test(a.text) && /Frango grelhado/.test(a.text), "");
  // open Frango grelhado
  const opened = await clickText(cp, /Frango grelhado/, { selector: "button" });
  await cp.waitForSelector('[role="dialog"]', { timeout: 5000 }).catch(() => {});
  await sleep(500);
  const dialogText = await cp.evaluate(() => document.querySelector('[role="dialog"]')?.innerText ?? "");
  check("item dialog opens with required groups", opened && /Molho/.test(dialogText) && /Obrigatório/.test(dialogText), dialogText.slice(0, 200));
  const addDisabled = await cp.evaluate(() => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => /Escolha:/.test(x.innerText)); return b ? b.disabled : null; });
  check("add button disabled until required options chosen", addDisabled === true, addDisabled);
  await clickText(cp, /Alho e limão/, { selector: '[role="dialog"] label' });
  await clickText(cp, /^Funje/, { selector: '[role="dialog"] label' });
  await clickText(cp, /Batata frita/, { selector: '[role="dialog"] label' });
  await cp.type("#item-notes", "Bem passado, por favor");
  await audit(cp, "05-item-dialog");
  const addBtnText = await cp.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.innerText).find((x) => /Adicionar/.test(x)));
  check("dialog price reflects option delta (4500 + 300 = 4.800 Kz)", /4[\s. ]?800/.test(addBtnText || ""), addBtnText);
  await clickText(cp, /Adicionar/, { selector: '[role="dialog"] button' });
  await sleep(800);
  const cartBar = await textOf(cp);
  check("cart bar appears with 1 item", /Ver carrinho/.test(cartBar), "");

  await go(cp, "/carrinho", "06-cart");
  await sleep(1500);
  a = await audit(cp, "06-cart");
  check("cart shows server-computed total (4.800 + 1.000 = 5.800 Kz)", /5[\s. ]?800/.test(a.text) && /Frango grelhado/.test(a.text), a.text.slice(0, 500));

  // proceed to checkout -> login
  await clickText(cp, /(Finalizar|Continuar|Checkout|Ir para o pagamento)/i, { selector: "button, a" });
  await sleep(1500);
  check("checkout redirects anonymous user to /entrar", /\/entrar/.test(cp.url()), cp.url());
  await audit(cp, "07-login");
  await cp.type("#username", "cliente");
  await cp.type("#password", "Cliente#2026");
  await cp.click("button[type=submit]");
  await sleep(2500);
  check("after login (SPA, no reload) returns to checkout as logged-in user", /\/checkout/.test(cp.url()), cp.url());
  check("cart survives login", /Frango grelhado/.test(await textOf(cp)), "");
  await cp.waitForNetworkIdle({ idleTime: 500 }).catch(() => {});
  a = await audit(cp, "08-checkout");
  check("checkout shows address, payment and total 5.800", /Morada de entrega/.test(a.text) && /Pagamento/.test(a.text) && /5[\s. ]?800/.test(a.text), a.text.slice(0, 600));
  const placed = await clickText(cp, /^Fazer encomenda/, { selector: "button" });
  await sleep(3000);
  const m = cp.url().match(/\/encomendas\/(\d+)/);
  orderId = m ? Number(m[1]) : null;
  check("placing cash order navigates to order page", placed && !!orderId, cp.url());
  a = await audit(cp, "09-order-pending");
  check("order page shows status (pending)", /(Aguarda|À espera|Pendente|enviada|confirma)/i.test(a.text), a.text.slice(0, 400));
} catch (e) { check("customer journey crashed", false, e.stack); }

// ===========================================================================
// 2. Partner accepts / prepares / readies (desktop)
// ===========================================================================
const { ctx: pctx, page: pp } = await newCtx("partner", DESKTOP);
try {
  await login(pp, "loja", "Loja#2026demo", "/parceiro");
  await go(pp, "/parceiro", "10-partner-orders");
  await waitText(pp, /Aceitar/);
  let a = await audit(pp, "10-partner-orders");
  check("partner sees incoming order with Aceitar", /Aceitar/.test(a.text), a.text.slice(0, 400));
  await clickText(pp, /^Aceitar$/, { selector: "button" }); await sleep(1500);
  // possible confirm dialog
  await clickText(pp, /^Aceitar$/, { selector: '[role="dialog"] button, [role="alertdialog"] button' });
  check("partner: Começar a preparar available", await waitText(pp, /Começar a preparar/), "");
  await clickText(pp, /Começar a preparar/, { selector: "button" }); await sleep(1500);
  check("partner: Pronta available", await waitText(pp, /Pronta/), "");
  await clickText(pp, /^Pronta$/, { selector: "button" }); await sleep(1500);
  a = await audit(pp, "11-partner-ready");
  const st = await apiFetch(pp, "GET", `/api/orders/${orderId}`);
  check("order is 'ready' after partner UI actions", st.body?.order?.status === "ready", st.body?.order?.status);
  // mobile partner view
  await pp.setViewport(MOBILE); await go(pp, "/parceiro", "12-partner-orders-mobile"); await audit(pp, "12-partner-orders-mobile"); await pp.setViewport(DESKTOP);
  for (const [u, n] of [["/parceiro/menu", "13-partner-menu"], ["/parceiro/loja", "14-partner-store"], ["/parceiro/estatisticas", "15-partner-stats"]]) { await go(pp, u, n); await audit(pp, n); }
} catch (e) { check("partner journey crashed", false, e.stack); }

// ===========================================================================
// 3. Driver claims, picks up, delivers
// ===========================================================================
const { ctx: dctx, page: dp } = await newCtx("driver", MOBILE);
try {
  await login(dp, "estafeta", "Estafeta#2026", "/estafeta");
  await go(dp, "/estafeta", "16-driver-home");
  await waitText(dp, /Entregas disponíveis/);
  let a = await audit(dp, "16-driver-home");
  check("driver sees available delivery", /Entregas disponíveis/.test(a.text) && /Grelhados do Mussulo/.test(a.text), a.text.slice(0, 400));
  await clickText(dp, /^Aceitar$/, { selector: "button" }); await sleep(1500);
  check("driver: Recolhi a encomenda", await waitText(dp, /Recolhi a encomenda/), (await textOf(dp)).slice(0, 300));
  await audit(dp, "17-driver-current");
  await clickText(dp, /Recolhi a encomenda/, { selector: "button" }); await sleep(1500);
  check("driver: Entreguei", await waitText(dp, /Entreguei/), "");
  await clickText(dp, /^Entreguei$/, { selector: "button" }); await sleep(800);
  // confirm dialog
  await clickText(dp, /(Confirmar|Entreguei|Sim)/, { selector: '[role="alertdialog"] button, [role="dialog"] button' }); await sleep(1500);
  const st = await apiFetch(dp, "GET", `/api/orders/${orderId}`);
  check("order delivered via driver UI", st.body?.order?.status === "delivered", st.body?.order?.status);
  await audit(dp, "18-driver-after");
  await go(dp, "/estafeta/historico", "19-driver-history"); await audit(dp, "19-driver-history");
  await dp.setViewport(DESKTOP); await go(dp, "/estafeta", "20-driver-desktop"); await audit(dp, "20-driver-desktop");
} catch (e) { check("driver journey crashed", false, e.stack); }

// ===========================================================================
// 4. Customer sees Entregue, leaves review; partner replies
// ===========================================================================
try {
  await go(cp, `/encomendas/${orderId}`, "21-order-delivered");
  await waitText(cp, /Entregue/);
  let a = await audit(cp, "21-order-delivered");
  check("customer sees 'Entregue'", /Entregue/.test(a.text), a.text.slice(0, 300));
  await cp.evaluate(() => [...document.querySelectorAll('[role=radio]')].find((b) => b.getAttribute("aria-label") === "4 estrelas")?.click());
  await sleep(300);
  await cp.type("#review-comment", "Muito bom, chegou quente!");
  await clickText(cp, /Enviar avaliação/, { selector: "button" }); await sleep(2000);
  const st = await apiFetch(cp, "GET", `/api/orders/${orderId}`);
  check("review saved via UI (rating 4)", st.body?.review?.rating === 4, st.body?.review);
  await audit(cp, "22-order-reviewed");

  await go(pp, "/parceiro/avaliacoes", "23-partner-reviews");
  await waitText(pp, /Muito bom/);
  await clickText(pp, /^Responder$/, { selector: "button" }); await sleep(600);
  const ta = await pp.$("textarea");
  if (ta) { await ta.type("Obrigado, volte sempre!"); }
  await clickText(pp, /(Enviar|Publicar|Responder|Guardar)/, { selector: "button" }); await sleep(1500);
  a = await audit(pp, "23-partner-reviews");
  const revs = await apiFetch(pp, "GET", "/api/stores/1/reviews");
  check("partner reply saved & public", revs.body?.reviews?.some((r) => r.reply === "Obrigado, volte sempre!"), revs.body?.reviews?.slice(0, 2));
  await go(cp, "/loja/1", "24-store-reviews");
  for (const tb of await cp.$$("[role=tab]")) { if (/Avaliações/.test(await tb.evaluate((e) => e.innerText))) await tb.click(); }
  await sleep(1200);
  a = await audit(cp, "24-store-reviews-tab");
  check("store reviews tab shows store reply", /Obrigado, volte sempre!/.test(a.text) && /Resposta da loja/.test(a.text), a.text.slice(-500));
  const rc = await apiFetch(cp, "GET", "/api/stores/1");
  check("store rating comes only from real reviews (first review -> count 1)", rc.body.store.ratingCount === 1 && rc.body.store.ratingAvg >= 1, `ratingCount=${rc.body.store.ratingCount}, avg=${rc.body.store.ratingAvg}`);
} catch (e) { check("review journey crashed", false, e.stack); }

// ===========================================================================
// 5. Home bakery: notice + checkout forces scheduling >= 24h
// ===========================================================================
try {
  // cliente has no Kilamba address but Talatona is served by Tia Rosa
  // logout via UI (profile page) and check UI state
  await go(cp, "/perfil", "24b-profile-before-logout");
  const lo = await clickText(cp, /^(Sair|Terminar sessão)$/, { selector: "button" });
  await sleep(1500);
  await clickText(cp, /^(Sair|Terminar sessão|Confirmar)$/, { selector: '[role="alertdialog"] button, [role="dialog"] button' });
  await sleep(1500);
  await go(cp, "/", "24c-home-after-logout").catch(() => {});
  const navAfter = await cp.evaluate(() => [...document.querySelectorAll("nav a")].map((a) => a.innerText).join("|"));
  const meAfter = await apiFetch(cp, "GET", "/api/auth/me");
  check("logout via UI ends session and nav shows 'Entrar'", lo && meAfter.status === 401 && /Entrar/.test(navAfter), { lo, me: meAfter.status, navAfter });
  await apiFetch(cp, "POST", "/api/auth/logout");
  await cp.evaluate(() => localStorage.clear());
  await login(cp, "cliente2", "Cliente#2026", "/loja/10");
  await go(cp, "/loja/10", "25-bakery-store");
  let a = await audit(cp, "25-bakery-store");
  check("bakery page shows pre-order notice (1 dia)", /Trabalha por encomenda/.test(a.text) && /1 dia/.test(a.text), a.text.slice(0, 600));
  check("bakery page shows Feito em casa badge", /Feito em casa/.test(a.text), "");
  await clickText(cp, /Bolo de ginguba/, { selector: "button" });
  await sleep(600);
  await clickText(cp, /Adicionar/, { selector: '[role="dialog"] button' }); await sleep(600);
  await clickText(cp, /Novo carrinho/, { selector: "button" }); await sleep(600);
  await go(cp, "/checkout", "26-bakery-checkout");
  await sleep(1500);
  a = await audit(cp, "26-bakery-checkout");
  const nowDisabled = await cp.evaluate(() => {
    const g = document.querySelector('[role="radiogroup"][aria-label="Quando"]');
    const b = g && [...g.querySelectorAll("button, [role=radio]")].find((x) => /Agora/.test(x.innerText));
    return b ? (b.disabled || b.getAttribute("aria-disabled") === "true") : "absent";
  });
  check("bakery checkout: 'Agora' unavailable (disabled or absent)", nowDisabled === true || nowDisabled === "absent", nowDisabled);
  const expected = await cp.evaluate(() => document.body.innerText.match(/Entrega prevista:\s*([^\n]+)/)?.[1] ?? null);
  check("bakery checkout pre-selects a slot", !!expected, a.text.slice(0, 800));
  // Intercept the order POST to inspect scheduledFor
  let sentBody = null;
  cp.on("request", (r) => { if (r.url().endsWith("/api/orders") && r.method() === "POST") sentBody = JSON.parse(r.postData() || "{}"); });
  await clickText(cp, /^Agendar encomenda/, { selector: "button" });
  await sleep(2500);
  const diffH = sentBody?.scheduledFor ? (new Date(sentBody.scheduledFor).getTime() - Date.now()) / 3600000 : null;
  check("bakery checkout sends scheduledFor >= 24h ahead", diffH != null && diffH >= 24, { diffH, sentBody });
  check("bakery order placed (navigated to order page)", /\/encomendas\/\d+/.test(cp.url()), cp.url() + " " + (await textOf(cp)).slice(0, 300));
  await audit(cp, "27-bakery-order");
} catch (e) { check("bakery journey crashed", false, e.stack); }

// ===========================================================================
// 6. Group order: host + guest (2nd context, no login)
// ===========================================================================
try {
  await go(cp, "/loja/1", "28-store-group");
  await clickText(cp, /Encomenda em grupo/, { selector: "button" });
  await sleep(2500);
  const groupUrl = cp.url();
  check("group order created -> /grupo/:token", /\/grupo\/[A-Za-z0-9_-]+/.test(groupUrl), groupUrl);
  let a = await audit(cp, "28-group-host");
  const linkVal = await cp.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).find((v) => v.includes("/grupo/")));
  check("group page shows share link", /Convide amigos/.test(a.text) && !!linkVal, linkVal);
  const { ctx: gctx, page: gp } = await newCtx("guest", MOBILE);
  await go(gp, groupUrl.replace(BASE, ""), "29-group-guest");
  a = await audit(gp, "29-group-guest-join");
  const nameInput = await gp.$("#join-name");
  check("guest sees join form without login", !!nameInput && /Juntar-me/.test(a.text), a.text.slice(0, 300));
  if (nameInput) { await nameInput.type("Zé Convidado"); await clickText(gp, /Juntar-me/, { selector: "button" }); await sleep(1500); }
  a = await audit(gp, "30-group-guest-joined");
  // guest adds Água
  const addedA = await clickText(gp, /Água 1,5L/, { selector: "button" });
  await sleep(700);
  await clickText(gp, /(Adicionar ao cesto|Adicionar)/, { selector: '[role="dialog"] button' }); await sleep(1500);
  a = await audit(gp, "31-group-guest-added");
  check("guest added item to group basket", addedA && /Zé Convidado/.test(a.text) && /Água/.test(a.text), a.text.slice(0, 500));
  const ls = await gp.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("pedeja.group.")));
  check("guest credentials stored in localStorage pedeja.group.<token>", ls.length === 1, ls);
  // host adds Frango and checks out
  await go(cp, groupUrl.replace(BASE, ""), "32-group-host-refresh");
  await clickText(cp, /Frango grelhado/, { selector: "button" }); await sleep(700);
  await clickText(cp, /Piri-piri/, { selector: '[role="dialog"] label' });
  await clickText(cp, /^Arroz/, { selector: '[role="dialog"] label' });
  await clickText(cp, /(Adicionar ao cesto|Adicionar)/, { selector: '[role="dialog"] button' }); await sleep(1500);
  await go(cp, groupUrl.replace(BASE, ""), "33-group-host");
  a = await audit(cp, "33-group-host-basket");
  check("host sees both participants' items", /Zé Convidado/.test(a.text) && /Frango grelhado/.test(a.text), a.text.slice(0, 600));
  await clickText(cp, /Finalizar/, { selector: "button" }); await sleep(1200);
  a = await audit(cp, "34-group-checkout");
  // cliente2 lives in Kilamba, which store 1 doesn't serve -> expect zone error; record behaviour
  const placeDisabled = await cp.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /Fazer encomenda/.test(x.innerText));
    return b ? b.disabled : null;
  });
  a = await audit(cp, "35-group-after-checkout");
  check("group checkout to unserved zone: warning shown and place-order button disabled", placeDisabled === true && /não entrega nesta zona/.test(a.text), { placeDisabled, text: a.text.slice(0, 300) });
  await gctx.close();
} catch (e) { check("group journey crashed", false, e.stack); }

// ===========================================================================
// 7. Plus, points
// ===========================================================================
try {
  await go(cp, "/plus", "36-plus");
  let a = await audit(cp, "36-plus");
  // cliente2 might already be Plus? fresh DB: not
  await clickText(cp, /(Cartão|card|Multicaixa)/i, { selector: "label, button, [role=radio]" });
  const joined = await clickText(cp, /^Aderir por/, { selector: "button" });
  await sleep(2500);
  a = await audit(cp, "37-plus-after");
  const plus = await apiFetch(cp, "GET", "/api/plus");
  check("Plus sandbox subscribe via UI", joined && plus.body?.active === true, { joined, plus: plus.body?.active, t: a.text.slice(0, 300) });
  await go(cp, "/perfil/pontos", "38-points");
  a = await audit(cp, "38-points");
  const pts = await apiFetch(cp, "GET", "/api/auth/points");
  check("points page shows balance & referral code", /pontos/i.test(a.text) && a.text.includes(pts.body.referralCode), a.text.slice(0, 400));
  for (const [u, n] of [["/perfil", "39-profile"], ["/perfil/moradas", "40-addresses"], ["/encomendas", "41-orders"], ["/favoritos", "42-favorites"], ["/info/sobre", "43-info"], ["/registar", "44-register"], ["/nao-existe", "45-notfound"]]) { await go(cp, u, n); await audit(cp, n); }
} catch (e) { check("plus/points crashed", false, e.stack); }

// ===========================================================================
// 8. Admin approvals (desktop + mobile)
// ===========================================================================
const { ctx: actx, page: ap } = await newCtx("admin", DESKTOP);
try {
  await login(ap, "admin", "Admin#2026demo", "/admin");
  await go(ap, "/admin", "46-admin-dashboard"); await audit(ap, "46-admin-dashboard");
  await go(ap, "/admin/lojas", "47-admin-stores");
  await waitText(ap, /Kitanda/);
  let a = await audit(ap, "47-admin-stores");
  check("admin sees pending Kitanda store", /Kitanda/.test(a.text), "");
  const approvedStore = await ap.evaluate(() => {
    const cards = [...document.querySelectorAll("li, article, div")].filter((d) => /Kitanda/.test(d.innerText) && [...d.querySelectorAll("button")].some((b) => /^Aprovar$/.test(b.innerText.trim())));
    cards.sort((x, y) => x.innerText.length - y.innerText.length);
    const b = cards[0] && [...cards[0].querySelectorAll("button")].find((b) => /^Aprovar$/.test(b.innerText.trim()));
    if (b) { b.click(); return true; } return false;
  });
  await sleep(1500);
  await clickText(ap, /^(Aprovar|Confirmar)$/, { selector: '[role="alertdialog"] button, [role="dialog"] button' }); await sleep(1000);
  const s11 = await apiFetch(ap, "GET", "/api/admin/stores?pending=1");
  check("admin approves loja2 store via UI", approvedStore && !s11.body?.stores?.some((s) => s.id === 11), { approvedStore, pending: s11.body?.stores?.map((s) => s.name) });
  await go(ap, "/admin/utilizadores", "48-admin-users");
  await waitText(ap, /Rui Novo/);
  const approvedDrv = await ap.evaluate(() => {
    const cards = [...document.querySelectorAll("li, tr, article, div")].filter((d) => /Rui Novo/.test(d.innerText) && [...d.querySelectorAll("button")].some((b) => /^Aprovar$/.test(b.innerText.trim())));
    cards.sort((x, y) => x.innerText.length - y.innerText.length);
    const b = cards[0] && [...cards[0].querySelectorAll("button")].find((b) => /^Aprovar$/.test(b.innerText.trim()));
    if (b) { b.click(); return true; } return false;
  });
  await sleep(1500);
  await clickText(ap, /^(Aprovar|Confirmar)$/, { selector: '[role="alertdialog"] button, [role="dialog"] button' }); await sleep(1000);
  a = await audit(ap, "48-admin-users");
  const u8 = await apiFetch(ap, "GET", "/api/admin/users?pending=1");
  check("admin approves estafeta2 via UI", approvedDrv && !u8.body?.users?.some((u) => u.username === "estafeta2"), { approvedDrv, pending: u8.body?.users?.map((u) => u.username) });
  for (const [u, n] of [["/admin/encomendas", "49-admin-orders"], ["/admin/promocoes", "50-admin-promos"]]) { await go(ap, u, n); await audit(ap, n); }
  await ap.setViewport(MOBILE);
  for (const [u, n] of [["/admin", "51-admin-dashboard-mobile"], ["/admin/encomendas", "52-admin-orders-mobile"], ["/admin/lojas", "53-admin-stores-mobile"], ["/admin/utilizadores", "54-admin-users-mobile"], ["/admin/promocoes", "55-admin-promos-mobile"]]) { await go(ap, u, n); await audit(ap, n); }
} catch (e) { check("admin journey crashed", false, e.stack); }

// ===========================================================================
// 9. Language switch EN / FR on home & store pages
// ===========================================================================
const { ctx: lctx, page: lp } = await newCtx("i18n", MOBILE);
try {
  const PT_WORDS = ["Início", "Pesquisar", "Carrinho", "Encomendas", "Entrar", "Feito em casa", "Ver tudo", "Perto de si", "Restaurantes", "Mercearia", "entrega", "Aberto", "Fechado", "Avaliações", "avaliações", "Horário", "Encomenda em grupo", "Taxa de entrega", "Pedido mínimo", "Populares", "Mais populares", "Recomendado", "Grátis"];
  for (const [lang, label] of [["en", "EN"], ["fr", "FR"]]) {
    await go(lp, "/", `56-home-${lang}`);
    await lp.select('select[aria-label="Idioma / Language"]', lang);
    await sleep(1200);
    let a = await audit(lp, `56-home-${lang}`, { lang });
    const left = PT_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(a.text));
    check(`home in ${label}: no untranslated PT UI words`, left.length === 0, left);
    const htmlLang = await lp.evaluate(() => document.documentElement.lang);
    check(`html lang attr = ${lang}`, htmlLang === lang, htmlLang);
    await go(lp, "/loja/1", `57-store-${lang}`);
    a = await audit(lp, `57-store-${lang}`, { lang });
    const left2 = PT_WORDS.filter((w) => new RegExp(`(^|[^\\p{L}])${w}([^\\p{L}]|$)`, "u").test(a.text));
    check(`store page in ${label}: no untranslated PT UI words`, left2.length === 0, left2);
    await go(lp, "/loja/10", `58-bakery-${lang}`);
    a = await audit(lp, `58-bakery-${lang}`, { lang });
    check(`bakery notice translated (${label})`, lang === "en" ? /Pre-order only/.test(a.text) : /Sur commande/.test(a.text), a.text.slice(0, 500));
    await go(lp, "/pesquisa", `59-search-${lang}`); await audit(lp, `59-search-${lang}`, { lang });
    await go(lp, "/plus", `60-plus-${lang}`);
    a = await audit(lp, `60-plus-${lang}`, { lang });
    await go(lp, "/entrar", `61-login-${lang}`); await audit(lp, `61-login-${lang}`, { lang });
  }
  await lp.select('select[aria-label="Idioma / Language"]', "pt").catch(() => {});
} catch (e) { check("i18n crashed", false, e.stack); }

// ===========================================================================
// Report
// ===========================================================================
await browser.close();
const groups = {};
for (const i of pageIssues) {
  const key = `${i.kind} | ${i.detail}`;
  (groups[key] ||= new Set()).add(`${i.ctx}:${i.page}`);
}
console.log("\n========== PAGE ISSUES (deduplicated) ==========");
for (const [k, pages] of Object.entries(groups)) console.log(`${k}\n     on: ${[...pages].join(", ")}`);
fs.writeFileSync(path.join(SHOTS, "_issues.json"), JSON.stringify(Object.fromEntries(Object.entries(groups).map(([k, v]) => [k, [...v]])), null, 2));
const failed = results.filter((r) => !r.ok);
console.log(`\n========== UI SUMMARY: ${results.length - failed.length} passed, ${failed.length} failed, ${results.length} total; ${Object.keys(groups).length} distinct page issues ==========`);
for (const f of failed) console.log(`FAIL  ${f.name}\n      ${f.detail}`);
process.exit(failed.length ? 1 : 0);
