import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

// Every registration request is answered in the browser; all other writes are blocked.
// No accounts are created or login requests reach the server, even on a regression.
const BASE = process.env.BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const CHROME = process.env.CHROME_BIN || [
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/repl/tools/bin/chromium",
].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=pt-PT"],
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const unexpectedWrites = [];
  const unexpectedApiReads = [];
  const apiReads = [];
  const registrations = [];
  const loginRequests = [];
  const translations = {
    pt: {
      account: "Tipo de conta", business: "Tipo de negócio",
      accounts: ["Cliente Encomendar", "Loja/Restaurante Vender", "Estafeta Entregar", "Motorista Táxi"],
      businesses: ["Loja ou restaurante Com espaço físico", "Negócio caseiro Bolos, salgados, comida feita em casa"],
      bakery: "Pastelaria e bolos",
    },
    en: {
      account: "Account type", business: "Business kind",
      accounts: ["Customer Order", "Store/Restaurant Sell", "Rider Deliver", "Driver Taxi"],
      businesses: ["Shop or restaurant With premises", "Home business Cakes, snacks, home cooking"],
      bakery: "Bakery & cakes",
    },
    fr: {
      account: "Type de compte", business: "Type d'activité",
      accounts: ["Client Commander", "Magasin/Restaurant Vendre", "Livreur Livrer", "Chauffeur Taxi"],
      businesses: ["Magasin ou restaurant Avec local", "Activité à domicile Gâteaux, snacks, cuisine maison"],
      bakery: "Pâtisserie",
    },
  };
  const accountGroup = '[role="radiogroup"][aria-labelledby="account-type-label"]';
  const businessGroup = 'form [role="radiogroup"]:not([aria-labelledby])';
  async function switchLanguage(lang, target = page) {
    const selector = 'select[aria-label="Idioma / Language"]';
    // Use the real LanguageSwitch with keyboard input, never mutate its value or storage.
    await target.focus(selector);
    await target.keyboard.press("Home");
    for (let i = 0; i < ["pt", "en", "fr"].indexOf(lang); i++) {
      await target.keyboard.press("ArrowDown");
    }
    await target.keyboard.press("Enter");
    await target.waitForFunction((lang) =>
      document.documentElement.lang === (lang === "pt" ? "pt-AO" : lang)
      && document.querySelector('select[aria-label="Idioma / Language"]').value === lang,
    {}, lang);
    assert.equal(await target.evaluate(() => localStorage.getItem("lang")), lang);
  }
  async function accessibleGroups(lang, supplier = false, target = page) {
    const expected = translations[lang];
    assert.equal((await target.$$('[role="radiogroup"]')).length, supplier ? 2 : 1);
    for (const [selector, name, options] of [
      [accountGroup, expected.account, expected.accounts],
      ...(supplier ? [[businessGroup, expected.business, expected.businesses]] : []),
    ]) {
      const root = await target.$(selector);
      try {
        const tree = await target.accessibility.snapshot({ root, interestingOnly: false });
        assert.equal(tree?.role, "radiogroup");
        assert.equal(tree.name, name, `${lang}: accessible group name`);
        const radios = [];
        function collect(node) {
          if (node.role === "radio") radios.push(node);
          else for (const child of node.children ?? []) collect(child);
        }
        collect(tree);
        assert.deepEqual(radios.map((node) => node.name), options, `${lang}: accessible option names`);
        assert.equal(radios.filter((node) => node.checked === true).length, 1);
      } finally {
        await root.dispose();
      }
    }
  }
  let reply = { code: "TEST_INTERCEPTED", message: "Pedido interceptado pelo teste." };
  let replyStatus = 400;
  // A controlled gate holds synthetic responses until pending-state assertions finish.
  let registrationGate = null;
  let onRegistration = null;
  // Empty destination data keeps successful registrations independent of the database.
  const destinationReplies = {
    "/api/addresses": { addresses: [] },
    "/api/popular-items": { items: [] },
    "/api/stores": { stores: [] },
    "/api/banners": { banners: [] },
    "/api/orders": { orders: [] },
    "/api/partner/orders": { orders: [] },
    "/api/partner/store": { store: {
      id: 900001, name: "Loja sintética", isApproved: false, isOpen: false,
      openingTime: "08:00", closingTime: "20:00", zone: "Talatona",
    } },
    "/api/driver/presence": { presence: { isOnline: false }, autoDispatch: true, offerSeconds: 30 },
    "/api/driver/current": { order: null },
    "/api/driver/available": { orders: [] },
    "/api/driver/offers": { offer: null },
  };
  await page.evaluateOnNewDocument(() => localStorage.setItem("lang", "pt"));
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) => request.respond({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (path === "/api/auth/login") {
      loginRequests.push(request.method());
      return respond({ message: "Unexpected login request intercepted by test." }, 400);
    }
    if (path === "/api/auth/register" && request.method() === "POST") {
      registrations.push(JSON.parse(request.postData()));
      onRegistration?.();
      const body = reply;
      const status = replyStatus;
      if (registrationGate) await registrationGate;
      return respond(body, status);
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      unexpectedWrites.push(`${request.method()} ${path}`);
      return request.abort();
    }
    if (path.startsWith("/api/")) {
      apiReads.push(path);
      // Never supply a logged-in session here: protected destinations must use setUser.
      if (path === "/api/auth/me") return respond({ user: null });
      if (path === "/api/meta") return respond({
        zones: ["Talatona", "Maianga"], welcomeBonusPoints: 100,
        storeTypes: ["restaurant", "bakery"], dietaryTags: [], cuisines: [],
        plus: { monthlyPrice: 3000, freeDeliveryMinOrder: 5000 },
        points: { pointValueKz: 1, kzPerPointEarned: 100, maxDiscountPct: 20 },
      });
      if (Object.hasOwn(destinationReplies, path)) return respond(destinationReplies[path]);
      unexpectedApiReads.push(path);
      return request.abort();
    }
    return request.continue();
  });

  // Exercise Login's real submit handler, not registration validation or native constraints.
  const loginMessages = {
    en: "Enter your username and password.",
    fr: "Saisissez votre identifiant et votre mot de passe.",
  };
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const [lang, message] of Object.entries(loginMessages)) {
      await page.goto(`${BASE}/entrar`, { waitUntil: "networkidle0" });
      await page.waitForSelector("#username");
      await switchLanguage(lang);
      assert.equal(await page.$eval("#username", (el) => el.value), "");
      assert.equal(await page.$eval("#password", (el) => el.value), "");
      assert.equal(await page.$('[role="alert"]'), null);
      await page.evaluate(() => {
        window.loginSubmits = 0;
        document.querySelector("form").addEventListener("submit", () => {
          window.loginSubmits++;
        });
      });
      const before = loginRequests.length;
      await page.click('form button[type="submit"]');
      await page.waitForSelector('form [role="alert"]');
      await page.waitForNetworkIdle({ idleTime: 500 });
      assert.equal(await page.evaluate(() => window.loginSubmits), 1, `${lang}: form submitted`);
      assert.equal(
        await page.$eval('form [role="alert"]', (el) => el.textContent.trim()),
        message, `${lang}: exact empty-login message`,
      );
      assert.equal(loginRequests.length, before, `${lang}: empty login must not send a request`);
      assert.equal(await page.$eval('form button[type="submit"]', (el) => el.disabled), false);
      assert.equal(new URL(page.url()).pathname, "/entrar");
      console.log(`PASS ${width}px ${lang}: empty login shows exact localized message without a login request`);
    }
  }

  // A separate page has no evaluateOnNewDocument hook that resets the saved language to PT.
  const persistencePage = await browser.newPage();
  const persistenceErrors = [];
  persistencePage.on("pageerror", (error) => persistenceErrors.push(error.message));
  await persistencePage.setRequestInterception(true);
  persistencePage.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    const respond = (body, status = 200) => request.respond({
      status, contentType: "application/json", body: JSON.stringify(body),
    });
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) return request.abort();
    if (!path.startsWith("/api/")) return request.continue();
    if (path === "/api/auth/me") return respond({ user: null });
    if (path === "/api/meta") return respond({
      zones: ["Talatona", "Maianga"], welcomeBonusPoints: 100,
      storeTypes: ["restaurant", "bakery"], dietaryTags: [], cuisines: [],
      plus: { monthlyPrice: 3000, freeDeliveryMinOrder: 5000 },
      points: { pointValueKz: 1, kzPerPointEarned: 100, maxDiscountPct: 20 },
    });
    if (Object.hasOwn(destinationReplies, path)) return respond(destinationReplies[path]);
    return respond({});
  });
  async function assertPersistedLanguage(lang) {
    await persistencePage.waitForFunction((expected) =>
      document.documentElement.lang === (expected === "pt" ? "pt-AO" : expected)
      && document.querySelector('select[aria-label="Idioma / Language"]')?.value === expected,
    {}, lang);
    await accessibleGroups(lang, false, persistencePage);
  }
  for (const lang of ["en", "fr"]) {
    await persistencePage.goto(`${BASE}/registar`, { waitUntil: "networkidle0" });
    await persistencePage.waitForSelector("#fullName");
    await switchLanguage(lang, persistencePage);
    await assertPersistedLanguage(lang);

    await persistencePage.reload({ waitUntil: "networkidle0" });
    await persistencePage.waitForSelector("#fullName");
    await assertPersistedLanguage(lang);

    await persistencePage.goto(`${BASE}/`, { waitUntil: "networkidle0" });
    await persistencePage.goto(`${BASE}/registar`, { waitUntil: "networkidle0" });
    await persistencePage.waitForSelector("#fullName");
    await assertPersistedLanguage(lang);
    assert.deepEqual(persistenceErrors, [], `${lang}: no page errors while restoring language`);
    console.log(`PASS language persistence ${lang}: reload and leave/return preserve document, selector and accessible group name`);
  }
  await persistencePage.close();

  const keyboardCases = [1280, 390].flatMap((width) =>
    Object.keys(translations).map((lang) => ({ width, lang })));
  for (const { width, lang } of keyboardCases) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/registar`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#fullName");
    await switchLanguage(lang);
    await page.evaluate(() => {
      window.registrationSubmits = 0;
      document.querySelector("form").addEventListener("submit", (event) => {
        window.registrationSubmits++;
        event.preventDefault();
      }, true);
    });
    const account = accountGroup;
    const business = businessGroup;
    const radios = (group) => `${group} > [role="radio"]`;
    const radio = (group, index) => `${radios(group)}:nth-child(${index + 1})`;
    async function shiftTab() {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    }
    async function choice(group, expected) {
      await page.waitForFunction((selector) => {
        const button = document.querySelector(selector);
        return button?.getAttribute("aria-checked") === "true" && document.activeElement === button;
      }, {}, radio(group, expected));
      const state = await page.$$eval(radios(group), (buttons) => buttons.map((button) => ({
        selected: button.getAttribute("aria-checked") === "true",
        focused: document.activeElement === button,
        tabIndex: button.tabIndex,
        visible: button.matches(":focus-visible"),
        outline: getComputedStyle(button).outlineStyle,
        outlineWidth: getComputedStyle(button).outlineWidth,
      })));
      assert.equal(state.filter((button) => button.selected).length, 1);
      assert.deepEqual(state.map((button) => button.tabIndex), state.map((_, i) => i === expected ? 0 : -1));
      assert.equal(state[expected].selected, true);
      assert.equal(state[expected].focused, true);
      assert.equal(state[expected].visible, true);
      assert.equal(state[expected].outline, "solid");
      assert.notEqual(state[expected].outlineWidth, "0px");
    }
    async function tabStop(group, expected) {
      await page.focus(radio(group, expected));
      await shiftTab();
      assert.equal(await page.$eval(group, (el) => el.contains(document.activeElement)), false);
      await page.keyboard.press("Tab");
      await choice(group, expected);
      await page.keyboard.press("Tab");
      assert.equal(await page.$eval(group, (el) => el.contains(document.activeElement)), false);
      await shiftTab();
      await choice(group, expected);
    }
    async function fields({ supplier = false, home = false, customer = false } = {}) {
      assert.equal(!!await page.$("#referralCode"), customer);
      for (const id of ["b-name", "b-type", "b-phone", "b-street", "b-zone", "b-nif", "b-desc"]) {
        assert.equal(!!await page.$(`#${id}`), supplier, id);
      }
      assert.equal(!!await page.$("#b-notice"), home);
    }

    await tabStop(account, 0);
    await accessibleGroups(lang);
    await fields({ customer: true });
    // All four arrows, including wrapping in both directions (4 account types: the last is taxi driver).
    for (const [key, expected] of [
      ["ArrowLeft", 3], ["ArrowRight", 0], ["ArrowUp", 3],
      ["ArrowDown", 0], ["ArrowRight", 1],
    ]) {
      await page.keyboard.press(key);
      await choice(account, expected);
      await fields({ customer: expected === 0, supplier: expected === 1 });
    }
    await tabStop(account, 1);
    await tabStop(business, 0);
    await accessibleGroups(lang, true);
    for (const [key, expected] of [
      ["ArrowRight", 1], ["ArrowDown", 0], ["ArrowLeft", 1], ["ArrowUp", 0],
    ]) {
      await page.keyboard.press(key);
      await choice(business, expected);
      await fields({ supplier: true, home: expected === 1 });
      if (expected === 1) {
        assert.match(await page.$eval("#b-notice", (el) => el.textContent), /24 h/);
        assert.ok((await page.$eval("#b-type", (el) => el.textContent)).includes(translations[lang].bakery));
      }
    }
    // Focus unselected options directly to verify native Space/Enter activation too.
    for (const group of [business, account]) {
      for (const [key, expected] of [["Space", 1], ["Enter", 0]]) {
        await page.focus(radio(group, expected));
        await page.keyboard.press(key);
        await choice(group, expected);
        if (group === business) await fields({ supplier: true, home: expected === 1 });
      }
    }
    await fields({ customer: true });
    await page.click(radio(account, 1));
    await page.click(radio(business, 1));
    await fields({ supplier: true, home: true });
    await tabStop(business, 1);
    await page.click(radio(account, 0));
    await tabStop(account, 0);
    assert.equal(await page.evaluate(() => window.registrationSubmits), 0, "selection must not submit");
    console.log(`PASS ${width}px ${lang}: accessible names, arrows, wrapping, Tab, visible focus, Space/Enter, clicks and conditional fields`);
  }
  assert.equal(registrations.length, 0, "radio selection must not send registration requests");

  const account = '[aria-labelledby="account-type-label"] > [role="radio"]';
  const business = '[aria-label="Tipo de negócio"] > [role="radio"]';
  const submit = 'form button[type="submit"]';
  const common = {
    fullName: "  Pessoa de Teste  ", username: "  pessoa_teste.9  ",
    phone: "  +244923456789  ", email: "  pessoa@example.test  ",
    password: " Segredo#2026 ", confirm: " Segredo#2026 ",
  };
  const businessFields = {
    "b-name": "  Cozinha Teste  ", "b-phone": "  923456789  ",
    "b-street": "  Rua Teste 123  ", "b-nif": "  1234567890  ",
    "b-desc": "  Refeições de teste  ",
  };
  const expectedCommon = {
    fullName: "Pessoa de Teste", username: "pessoa_teste.9",
    phone: "+244923456789", email: "pessoa@example.test", password: common.password,
  };
  const expectedBusiness = {
    name: "Cozinha Teste", phone: "923456789", street: "Rua Teste 123",
    zone: "Talatona", nif: "1234567890", description: "Refeições de teste",
  };
  async function fill(values) {
    for (const [id, value] of Object.entries(values)) {
      await page.focus(`#${id}`);
      await page.keyboard.down("Control");
      await page.keyboard.press("A");
      await page.keyboard.up("Control");
      await page.keyboard.press("Backspace");
      if (value) await page.type(`#${id}`, value);
    }
  }
  async function select(id, label) {
    await page.click(`#${id}`);
    await page.waitForSelector('[role="option"]');
    const option = await page.evaluate((text) => Array.from(document.querySelectorAll('[role="option"]'))
      .findIndex((el) => el.textContent.trim() === text), label);
    assert.notEqual(option, -1, `option ${label} exists`);
    await page.click(`[role="option"]:nth-child(${option + 1})`);
    await page.waitForSelector('[role="listbox"]', { hidden: true });
  }
  async function open(role, query = "") {
    await page.goto(`${BASE}/registar${query}`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#fullName");
    if (role !== "customer") await page.click(`${account}:nth-child(${role === "driver" ? 3 : 2})`);
    if (role === "home") await page.click(`${business}:nth-child(2)`);
  }
  async function fieldErrors(expected) {
    for (const [id, message] of Object.entries(expected)) {
      await page.waitForFunction((id) => !!document.getElementById(`${id}-err`), {}, id);
      assert.equal(await page.$eval(`#${id}-err`, (el) => el.textContent), message, id);
      assert.equal(await page.$eval(`#${id}`, (el) => el.getAttribute("aria-invalid")), "true", `${id}: invalid state`);
      const references = await page.$eval(`#${id}`, (el) => (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean));
      assert.deepEqual(references, ["phone", "password"].includes(id) ? [`${id}-hint`, `${id}-err`] : [`${id}-err`],
        `${id}: exact hint/error associations`);
      for (const reference of references) {
        assert.equal((await page.$$(`[id="${reference}"]`)).length, 1, `${id}: description target exists exactly once`);
      }
      const root = await page.$(`#${id}`);
      try {
        const tree = await page.accessibility.snapshot({ root, interestingOnly: false });
        assert.ok(tree?.description?.includes(message), `${id}: browser accessibility description includes error`);
        if (["phone", "password"].includes(id)) {
          const hint = await page.$eval(`#${id}-hint`, (el) => el.textContent);
          assert.ok(tree.description.includes(hint), `${id}: hint remains accessible alongside error`);
        }
      } finally {
        await root.dispose();
      }
    }
  }
  async function clearedFields(ids) {
    for (const id of ids) {
      assert.equal(await page.$(`#${id}-err`), null, `${id}: corrected error removed`);
      assert.equal(await page.$eval(`#${id}`, (el) => el.getAttribute("aria-invalid")), "false", `${id}: no stale invalid state`);
      assert.equal(await page.$eval(`#${id}`, (el) => el.getAttribute("aria-describedby")),
        ["phone", "password"].includes(id) ? `${id}-hint` : null, `${id}: no stale error association`);
    }
    const missing = await page.$$eval('form [aria-describedby]', (controls) => controls.flatMap((el) =>
      el.getAttribute("aria-describedby").split(/\s+/).filter((id) => !document.getElementById(id))));
    assert.deepEqual(missing, [], "all description references resolve");
  }
  async function send(expectedReply = { code: "TEST_INTERCEPTED", message: "Pedido interceptado pelo teste." }) {
    reply = expectedReply;
    const before = registrations.length;
    const response = page.waitForResponse((res) =>
      new URL(res.url()).pathname === "/api/auth/register" && res.request().method() === "POST");
    await page.click(submit);
    await response;
    await page.waitForFunction(() => !document.querySelector('form button[type="submit"]').disabled);
    assert.equal(registrations.length, before + 1, "exactly one intercepted registration");
    assert.match(await page.$eval('[role="alert"]', (el) => el.textContent), new RegExp(expectedReply.message));
    return registrations.at(-1);
  }

  // Hold each response instead of relying on a timer: every click/Enter burst
  // must finish while the original request is still pending, including on retry.
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await open("customer");
    await fill(common);
    await page.click("#terms");
    const before = registrations.length;
    const formUrl = page.url();
    for (const [attempt, trigger] of ["click", "Enter"].entries()) {
      replyStatus = 503;
      reply = { code: "TEST_UNAVAILABLE", message: `Falha sintética ${attempt + 1}. Tente novamente.` };
      let release;
      registrationGate = new Promise((resolve) => { release = resolve; });
      // Puppeteer queues request listeners behind async interception handlers;
      // observe arrival here without waiting for the gated handler to finish.
      const requestSeen = new Promise((resolve) => { onRegistration = resolve; });
      let responseSeen = false;
      const onResponse = (res) => {
        if (new URL(res.url()).pathname === "/api/auth/register") responseSeen = true;
      };
      page.on("response", onResponse);
      try {
        if (trigger === "click") await page.click(submit);
        else {
          await page.focus("#confirm");
          await page.keyboard.press("Enter");
        }
        await requestSeen;
        await page.waitForFunction(() => document.querySelector('form button[type="submit"]').disabled);
        assert.equal(await page.$eval(submit, (el) => el.textContent.trim()), "A carregar…");
        assert.equal(await page.$('[role="alert"]'), null, "retry clears the previous API error");
        for (let i = 0; i < 4; i++) {
          // Real pointer and keyboard input; do not dispatch artificial submit events.
          await page.click(submit);
          await page.focus("#confirm");
          await page.keyboard.press("Enter");
          assert.equal(await page.$eval(submit, (el) => el.disabled), true,
            `${width}px: submit stays disabled throughout the burst`);
        }
        // Allow requests from the last input to reach interception. Exactly one
        // in-flight request is expected; any duplicate is held by the same gate.
        await page.waitForNetworkIdle({ concurrency: 1, idleTime: 200, timeout: 5000 });
        assert.equal(responseSeen, false, "synthetic error has not been released");
        assert.equal(registrations.length, before + attempt + 1,
          `${width}px attempt ${attempt + 1}: click/Enter burst sends only one request`);
        assert.deepEqual(registrations.at(-1), {
          ...expectedCommon, userType: "customer", referralCode: null,
        }, "retry preserves and serializes the original form values");
      } finally {
        registrationGate = null;
        onRegistration = null;
        release();
        page.off("response", onResponse);
      }
      await page.waitForFunction((message) =>
        !document.querySelector('form button[type="submit"]').disabled
        && document.querySelector('[role="alert"]')?.textContent.includes(message),
      {}, reply.message);
      assert.equal(await page.$eval(submit, (el) => el.textContent.trim()), "Criar conta");
      assert.equal(page.url(), formUrl, "synthetic failure keeps the registration form open");
      assert.equal(registrations.length, before + attempt + 1, "failure must not auto-retry");
    }
    console.log(`PASS ${width}px: pending click/Enter bursts send one request, disable submit and recover after error for a keyboard retry`);
  }
  replyStatus = 400;

  // Language changes must not remount/reset the form, including hidden role state.
  // No submission (not even an intercepted one) is allowed in these scenarios.
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await open("customer");
    await page.evaluate(() => {
      window.registrationSubmits = 0;
      document.querySelector("form").addEventListener("submit", (event) => {
        window.registrationSubmits++;
        event.preventDefault();
      }, true);
    });
    const before = registrations.length;
    // Email inputs normalize surrounding whitespace before React receives the value.
    const preservedCommon = { ...common, email: common.email.trim() };
    const values = { ...preservedCommon, referralCode: "CONVITE_IDIOMA" };
    await fill(values);
    await page.focus("#terms");
    await page.keyboard.press("Space");
    async function assertValues(expected) {
      for (const [id, value] of Object.entries(expected)) {
        assert.equal(await page.$eval(`#${id}`, (el) => el.value), value, `${width}px: preserved ${id}`);
      }
      assert.equal(await page.$eval("#terms", (el) => el.getAttribute("aria-checked")), "true");
    }
    async function choose(selector, index) {
      await page.focus(`${selector} > [role="radio"]:nth-child(${index + 1})`);
      await page.keyboard.press("Space");
      await page.waitForFunction((selector, index) => {
        const radio = document.querySelectorAll(`${selector} > [role="radio"]`)[index];
        return radio?.getAttribute("aria-checked") === "true" && document.activeElement === radio;
      }, {}, selector, index);
    }
    for (const role of ["customer", "shop", "home", "driver", "home", "customer"]) {
      const supplier = ["shop", "home"].includes(role);
      const accountIndex = supplier ? 1 : role === "driver" ? 2 : 0;
      await choose(accountGroup, accountIndex);
      if (supplier) {
        await choose(businessGroup, role === "home" ? 1 : 0);
        if (role === "shop") {
          await fill(businessFields);
          await select("b-zone", "Talatona");
        }
        if (role === "home") await select("b-notice", "48 h");
      }
      // Return to PT too: assert every transition with populated fields and selections.
      for (const lang of ["en", "fr", "pt"]) {
        await switchLanguage(lang);
        await accessibleGroups(lang, supplier);
        const selected = (selector) => page.$$eval(`${selector} > [role="radio"]`,
          (radios) => radios.map((radio) => radio.getAttribute("aria-checked") === "true"));
        assert.deepEqual(await selected(accountGroup), [0, 1, 2, 3].map((i) => i === accountIndex));
        await assertValues(role === "customer" ? values : preservedCommon);
        assert.equal(!!await page.$("#referralCode"), role === "customer");
        assert.equal(!!await page.$("#b-name"), supplier);
        assert.equal(!!await page.$("#b-notice"), role === "home");
        if (supplier) {
          await assertValues(businessFields);
          assert.deepEqual(await selected(businessGroup), [role === "shop", role === "home"]);
          assert.equal(await page.$eval("#b-zone", (el) => el.textContent), "Talatona");
          if (role === "home") {
            assert.equal(await page.$eval("#b-notice", (el) => el.textContent), "48 h");
            assert.ok((await page.$eval("#b-type", (el) => el.textContent)).includes(translations[lang].bakery));
          }
        }
        assert.equal(await page.evaluate(() => window.registrationSubmits), 0);
        assert.equal(registrations.length, before, "language changes must not send registration requests");
      }
    }
    console.log(`PASS ${width}px PT/EN/FR: language switching preserves account/business selection, common/business/referral fields, terms and notice`);
  }

  // Test the same validation and serialization contract at desktop and phone widths.
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const role of ["customer", "supplier", "home", "driver"]) {
      await open(role, "?ref=CONVITE_URL");
      await clearedFields(["fullName", "username", "phone", "email", "password", "confirm", "terms"]);
      const before = registrations.length;
      await page.click(submit);
      await fieldErrors({
        fullName: "Indique o nome completo (mín. 3 caracteres)",
        username: "3–40 caracteres: letras, números, _ e .",
        phone: "Número de telemóvel inválido", password: "Mínimo 8 caracteres",
        terms: "Tem de aceitar os termos",
        ...(["supplier", "home"].includes(role) ? {
          "b-name": "Campo obrigatório", "b-phone": "Número de telemóvel inválido",
          "b-street": "Campo obrigatório", "b-zone": "Campo obrigatório",
        } : {}),
      });
      assert.equal(await page.$eval("#terms", (el) => el.getAttribute("aria-invalid")), "true");
      assert.match(await page.$eval("#terms", (el) => el.parentElement.parentElement.textContent), /Tem de aceitar os termos/);
      assert.equal(registrations.length, before, `${role}: invalid form must not send`);
      if (role === "customer") assert.equal(await page.$eval("#referralCode", (el) => el.value), "CONVITE_URL");
      await fill(common);
      await page.click("#terms");
      const supplier = ["supplier", "home"].includes(role);
      if (supplier) {
        await fill(businessFields);
        await select("b-zone", "Talatona");
      }
      await clearedFields(["fullName", "username", "phone", "email", "password", "confirm", "terms",
        ...(supplier ? ["b-name", "b-type", "b-phone", "b-street", "b-zone", "b-nif", "b-desc"] : [])]);
      if (role === "customer") await fill({ referralCode: "  AMIGO123  " });
      assert.deepEqual(await send(), {
        ...expectedCommon, userType: supplier ? "supplier" : role,
        ...(role === "driver" ? { vehicleType: "moto" } : {}),
        referralCode: role === "customer" ? "AMIGO123" : null,
        ...(supplier ? { business: {
          ...expectedBusiness, storeType: role === "home" ? "bakery" : "restaurant",
          isHomeBusiness: role === "home", minNoticeHours: role === "home" ? 24 : 0,
        } } : {}),
      }, `${width}px ${role}: exact serialized body`);
      // Optional empty values are null, not whitespace or omitted business properties.
      await fill({ email: "   ", ...(supplier ? { "b-nif": "   ", "b-desc": "   " } : {}) });
      if (role === "customer") await fill({ referralCode: "   " });
      const optional = await send();
      assert.equal(optional.email, null);
      assert.equal(optional.referralCode, null);
      if (supplier) {
        assert.equal(optional.business.nif, null);
        assert.equal(optional.business.description, null);
      }
      console.log(`PASS ${width}px ${role}: required fields, terms, exact payload and optional nulls`);
    }

    // Populated hidden state must not leak when switching roles or business kind.
    await open("customer");
    await fill({ ...common, referralCode: "  NAO_ENVIAR  " });
    await page.click("#terms");
    await page.click(`${account}:nth-child(2)`);
    await page.click(`${business}:nth-child(2)`);
    await fill(businessFields);
    await select("b-zone", "Talatona");
    for (const hours of [0, 2, 12, 24, 48, 72]) {
      await select("b-notice", hours === 0 ? "Aceito encomendas para já" : `${hours} h`);
      const body = await send();
      assert.equal(body.userType, "supplier");
      assert.equal(body.referralCode, null);
      assert.equal(body.business.isHomeBusiness, true);
      assert.equal(body.business.minNoticeHours, hours);
      assert.equal(typeof body.business.minNoticeHours, "number");
    }
    await page.click(`${business}:nth-child(1)`);
    const shop = await send();
    assert.equal(shop.business.isHomeBusiness, false);
    assert.equal(shop.business.minNoticeHours, 0, "home notice must reset for a shop");
    await page.click(`${account}:nth-child(3)`);
    assert.deepEqual(await send(), { ...expectedCommon, userType: "driver", vehicleType: "moto", referralCode: null });
    await page.click(`${account}:nth-child(1)`);
    assert.deepEqual(await send(), { ...expectedCommon, userType: "customer", referralCode: "NAO_ENVIAR" });
    console.log(`PASS ${width}px: all notice values, switching business kind and no hidden business/referral leakage`);
  }

  // Invalid non-empty values and boundaries exercise validators, not just required fields.
  await open("customer");
  await fill(common);
  await page.click("#terms");
  for (const [id, value, message] of [
    ["fullName", "  ab  ", "Indique o nome completo (mín. 3 caracteres)"],
    ["username", "ab", "3–40 caracteres: letras, números, _ e ."],
    ["username", "a".repeat(41), "3–40 caracteres: letras, números, _ e ."],
    ["username", "nome-invalido", "3–40 caracteres: letras, números, _ e ."],
    ["phone", "12345678", "Número de telemóvel inválido"],
    ["phone", "12345678x", "Número de telemóvel inválido"],
    ["phone", "1".repeat(16), "Número de telemóvel inválido"],
    ["email", "teste@invalido", "Email inválido"],
    ["password", "1234567", "Mínimo 8 caracteres"],
    ["confirm", "Diferente#2026", "As palavras-passe não coincidem"],
  ]) {
    await fill({ [id]: value });
    const before = registrations.length;
    await page.click(submit);
    await fieldErrors({ [id]: message });
    assert.equal(registrations.length, before, `${id}: invalid value must not send`);
    await fill({ [id]: common[id] });
    await clearedFields([id]);
  }
  await fill({ fullName: "abc", username: "abc", phone: "123456789", password: "12345678", confirm: "12345678" });
  await send();
  await fill({ username: "a".repeat(40), phone: "1".repeat(15) });
  await send();
  console.log("PASS validation: invalid formats, trimmed values and accepted length boundaries");

  // Local validation messages must follow the language selected through LanguageSwitch.
  // Compare the rendered messages as a set, without asserting their field associations.
  const localizedValidation = {
    en: {
      fullName: "Enter your full name (min. 3 characters)",
      username: "3–40 characters: letters, numbers, _ and .",
      phone: "Invalid phone number", email: "Invalid email",
      password: "At least 8 characters", confirm: "Passwords don't match",
      terms: "You must accept the terms", required: "Required",
    },
    fr: {
      fullName: "Nom complet (min. 3 caractères)",
      username: "3–40 caractères : lettres, chiffres, _ et .",
      phone: "Numéro de téléphone invalide", email: "Email invalide",
      password: "8 caractères minimum", confirm: "Les mots de passe ne correspondent pas",
      terms: "Vous devez accepter les conditions", required: "Champ obligatoire",
    },
  };
  async function assertRenderedValidation(expected, label) {
    const messages = Object.values(expected).sort();
    await page.waitForFunction((count) =>
      document.querySelectorAll('form [id$="-err"]').length === count,
    {}, messages.length);
    const rendered = await page.$$eval('form [id$="-err"]',
      (errors) => errors.map((error) => error.textContent.trim()).sort());
    assert.deepEqual(rendered, messages, `${label}: exact rendered validation messages`);
  }
  for (const lang of ["en", "fr"]) {
    const message = localizedValidation[lang];
    for (const role of ["customer", "supplier", "home", "driver"]) {
      await open(role);
      await switchLanguage(lang);
      const supplier = ["supplier", "home"].includes(role);
      const beforeRequired = registrations.length;
      await page.click(submit);
      await assertRenderedValidation({
        fullName: message.fullName,
        username: message.username,
        phone: message.phone,
        password: message.password,
        terms: message.terms,
        ...(supplier ? {
          businessName: message.required,
          businessPhone: message.phone,
          businessStreet: message.required,
          businessZone: message.required,
        } : {}),
      }, `${lang} ${role}: required values`);
      assert.equal(registrations.length, beforeRequired, `${lang} ${role}: required validation must not send`);

      await fill(common);
      if (supplier) {
        await fill(businessFields);
        await select("b-zone", "Talatona");
      }
      await fill({
        fullName: "ab", username: "a-", phone: "12345678",
        email: "invalid", password: "1234567", confirm: "different",
        ...(supplier ? { "b-phone": "12345678" } : {}),
      });
      const beforeInvalid = registrations.length;
      await page.click(submit);
      await assertRenderedValidation({
        fullName: message.fullName,
        username: message.username,
        phone: message.phone,
        email: message.email,
        password: message.password,
        confirm: message.confirm,
        terms: message.terms,
        ...(supplier ? { businessPhone: message.phone } : {}),
      }, `${lang} ${role}: invalid formats and terms`);
      assert.equal(registrations.length, beforeInvalid, `${lang} ${role}: invalid values must not send`);
    }
  }
  // Restore the Portuguese, valid customer form state expected by the API tests below.
  await open("customer");
  await switchLanguage("pt");
  await fill(common);
  await page.click("#terms");
  console.log("PASS validation: localized EN/FR required, format, confirmation and terms messages for all account types");

  // API errors are synthetic: exercise field mapping without any database writes.
  await send({ code: "USERNAME_TAKEN", message: "Este utilizador já existe." });
  await fieldErrors({ username: "Este utilizador já existe." });
  await fill({ username: common.username });
  await clearedFields(["username"]);
  await fill({ referralCode: "INVALIDO" });
  await send({ code: "REFERRAL_INVALID", message: "Código de convite inválido." });
  await fieldErrors({ referralCode: "Código de convite inválido." });
  await fill({ referralCode: "CORRIGIDO" });
  await clearedFields(["referralCode"]);
  for (const role of ["supplier", "home"]) {
    await open(role);
    await fill({ ...common, ...businessFields });
    await select("b-zone", "Talatona");
    await page.click("#terms");
    const paths = {
      fullName: "fullName", username: "username", phone: "phone", email: "email",
      password: "password", "b-name": "business.name", "b-type": "business.storeType",
      "b-phone": "business.phone", "b-street": "business.street", "b-zone": "business.zone",
      "b-nif": "business.nif", "b-desc": "business.description",
      ...(role === "home" ? { "b-notice": "business.minNoticeHours" } : {}),
    };
    const messages = Object.fromEntries(Object.keys(paths).map((id) => [id, `Valor rejeitado: ${id}`]));
    await send({
      code: "VALIDATION_ERROR", message: "Verifique os campos",
      errors: Object.entries(paths).map(([id, path]) => ({ path, message: messages[id] })),
    });
    await fieldErrors(messages);
    // Correct every control type without resubmitting; hints must remain connected.
    await fill({ ...common, ...businessFields });
    await select("b-type", role === "home" ? "🍽️ Restaurantes" : "🎂 Pastelaria e bolos");
    await select("b-zone", "Maianga");
    if (role === "home") await select("b-notice", "48 h");
    await clearedFields(Object.keys(paths));
    await send();
    assert.equal((await page.$$('[id$="-err"]')).length, 0);
    // A retry also clears API errors even if the values are submitted unchanged.
    await send({
      code: "VALIDATION_ERROR", message: "Verifique os campos",
      errors: Object.entries(paths).map(([id, path]) => ({ path, message: messages[id] })),
    });
    await fieldErrors(messages);
    await send();
    await clearedFields(Object.keys(paths));
  }
  console.log("PASS API errors: username, referral, nested business fields and retry recovery");

  // Submit the real form with synthetic success responses, exercising Register,
  // AuthProvider.setUser and the destination's actual role guard together.
  const safeNext = "/encomendas?origem=registo#anteriores";
  const successCases = [
    ...["customer", "supplier", "home", "driver"].map((role) => ({ role })),
    { role: "customer", next: safeNext, destination: safeNext },
    { role: "customer", next: "https://example.test/fora" },
    { role: "customer", next: "//example.test/fora" },
    // URLSearchParams encodes the slash/backslash input just as an incoming link would.
    // Browsers can interpret these as external URLs, making SPA navigation throw.
    ...["customer", "supplier", "home", "driver"].map((role) => ({
      role, next: "/\\example.test/fora",
    })),
    { role: "customer", next: "/\\\\example.test/fora" },
    ...["supplier", "home", "driver"].map((role) => ({ role, next: safeNext })),
    // Also exercise the rider dashboard's requests, beyond the initial approval screen.
    { role: "driver", approved: true },
  ];
  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    for (const { role, next, destination, approved = role !== "driver" } of successCases) {
      const supplier = ["supplier", "home"].includes(role);
      const userType = supplier ? "supplier" : role;
      const target = destination ?? (supplier ? "/parceiro" : role === "driver" ? "/estafeta" : "/");
      await open(role, next === undefined ? "" : `?${new URLSearchParams({ next })}`);
      await fill(common);
      if (supplier) {
        await fill(businessFields);
        await select("b-zone", "Talatona");
      }
      await page.click("#terms");
      const before = registrations.length;
      const readsBefore = apiReads.length;
      replyStatus = 201;
      reply = { user: {
        id: 900001, username: expectedCommon.username, fullName: expectedCommon.fullName,
        email: expectedCommon.email, phone: expectedCommon.phone, userType,
        isApproved: approved, referralCode: "SYNTHETIC",
        loyaltyPoints: 0, preferredLanguage: null, dietaryPreferences: [],
      } };
      const response = page.waitForResponse((res) =>
        new URL(res.url()).pathname === "/api/auth/register" && res.request().method() === "POST");
      await page.click(submit);
      assert.equal((await response).status(), 201);
      const expectedUrl = new URL(target, BASE).href;
      await page.waitForFunction((url) => window.location.href === url, {}, expectedUrl);
      // Wait for destination data and rendered content, not just a transient URL.
      // The protected pages would redirect to /entrar if setUser lost the session.
      const destinationApi = supplier ? "/api/partner/store"
        : role === "driver" ? (approved ? "/api/driver/presence" : null)
        : destination ? "/api/orders" : "/api/addresses";
      await page.waitForNetworkIdle();
      if (destinationApi) {
        assert.ok(apiReads.slice(readsBefore).includes(destinationApi), `${role}: destination requested its data`);
      }
      const marker = supplier ? "Loja sintética"
        : role === "driver" ? (approved ? "Offline" : "Conta a aguardar aprovação")
        : destination ? "Ainda sem encomendas anteriores" : "Pessoa";
      await page.waitForFunction((text) => document.body.innerText.includes(text), {}, marker);
      assert.equal(page.url(), expectedUrl, `${role}: remains at the correct destination`);
      assert.equal(await page.$("#fullName"), null, "registration form was unmounted");
      assert.equal(registrations.length, before + 1, "exactly one synthetic registration");
      assert.equal(registrations.at(-1).userType, userType);
      console.log(`PASS ${width}px ${role} (approved=${approved}): successful registration, next=${next ?? "(absent)"} → ${target}`);
    }
  }
  assert.deepEqual(unexpectedWrites, [], "no unhandled write requests may be attempted");
  assert.deepEqual(loginRequests, [], "no login requests may be attempted");
  assert.deepEqual(unexpectedApiReads, [], "all API reads must be intercepted, including destination pages");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
