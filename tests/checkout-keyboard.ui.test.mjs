import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

// Browser-only fixtures: no API request reaches the server, including order creation.
const BASE = process.env.BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const CHROME = process.env.CHROME_BIN || [
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/repl/tools/bin/chromium",
].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=pt-PT"],
});
const group = (name) => `[role="radiogroup"][aria-label="${name}"]`;
const delivery = group("Opções de entrega");
const tips = group("Gorjeta");
const payment = group("Pagamento");
const radios = (selector) => `${selector} [role="radio"]`;
const money = (n) => `${n.toLocaleString("pt-AO").replace(/ /g, " ")} Kz`;

try {
  for (const width of [1280, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: 900 });
    const errors = [];
    const unexpected = [];
    const quotes = [];
    let cashOnly = false;
    page.on("pageerror", (error) => errors.push(error.message));
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("lang", "pt");
      localStorage.setItem("pedeja.cart.v2", JSON.stringify({
        storeId: 777, storeName: "Loja de teste", lines: [{
          key: "888||", menuItemId: 888, name: "Refeição de teste", quantity: 1,
          optionIds: [], optionsLabel: "", specialInstructions: "", unitPrice: 3000,
        }],
      }));
      sessionStorage.removeItem("pedeja.checkout");
      window.checkoutSubmits = 0;
      document.addEventListener("submit", (event) => {
        window.checkoutSubmits++;
        event.preventDefault();
      }, true);
    });
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (!path.startsWith("/api/")) {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          unexpected.push(`${request.method()} ${path}`);
          return request.abort();
        }
        return request.continue();
      }
      const respond = (body) => request.respond({
        status: 200, contentType: "application/json", body: JSON.stringify(body),
      });
      if (path === "/api/cart/quote" && request.method() === "POST") {
        const body = JSON.parse(request.postData());
        quotes.push(body);
        const priorityFee = body.priority ? 500 : 0;
        return respond({ quote: {
          storeId: 777, storeName: "Loja de teste",
          lines: [{ menuItemId: 888, name: "Refeição de teste", quantity: 1,
            unitPrice: 3000, lineTotal: 3000, selectedOptions: [], specialInstructions: null }],
          subtotal: 3000, deliveryFee: 700, baseDeliveryFee: 700, discount: 0,
          pointsRedeemed: 0, pointsDiscount: 0, promoCode: null, plusSavings: 0,
          priorityFee, riderTip: body.riderTip, total: 3700 + priorityFee + body.riderTip,
          priorityOption: { fee: 500, minutesSaved: 10 },
        } });
      }
      if (request.method() !== "GET") {
        unexpected.push(`${request.method()} ${path}`);
        return request.abort();
      }
      if (path === "/api/auth/me") return respond({ user: {
        id: 999, username: "keyboard-test", fullName: "Cliente de teste",
        userType: "customer", isApproved: true, loyaltyPoints: 0, dietaryPreferences: [],
      } });
      if (path === "/api/meta") return respond({
        zones: ["Talatona"], schedule: { minLeadMin: 30, maxAheadHours: 48 },
        paymentMethods: [
          { id: "cash", available: true },
          { id: "card", available: false },
          { id: "multicaixa_express", available: !cashOnly, sandbox: true },
          { id: "unitel_money", available: !cashOnly, sandbox: true },
        ],
      });
      if (path === "/api/stores/777") return respond({ store: {
        id: 777, name: "Loja de teste", isOpenNow: true, zonesServed: ["Talatona"],
        openingTime: "00:00", closingTime: "23:59", deliveryTimeMin: 40,
      } });
      if (path === "/api/addresses") return respond({ addresses: [{
        id: 999, label: "Casa de teste", street: "Rua de teste", zone: "Talatona",
        city: "Luanda", isDefault: true,
      }] });
      unexpected.push(`GET ${path}`);
      return request.abort();
    });
    await page.goto(`${BASE}/checkout`, { waitUntil: "networkidle0" });
    await page.waitForSelector(radios(delivery));
    const orderButton = "div.fixed.bottom-0 button";
    let priority = false;
    let tip = 0;
    async function total() {
      const expected = money(3700 + (priority ? 500 : 0) + tip);
      await page.waitForFunction(({ selector, expected }) => {
        const button = document.querySelector(selector);
        return button && !button.disabled && button.textContent.includes(expected);
      }, {}, { selector: orderButton, expected });
      const summary = await page.$$eval("section", (els) => els.map((el) => el.textContent));
      // Check both the quote summary and the final order button.
      assert.ok(summary.some((text) => text.includes("Resumo da encomenda") && text.includes(expected)));
    }
    async function focusChoice(selector, index) {
      const elements = await page.$$(radios(selector));
      await elements[index].focus();
    }
    async function choice(selector, expected) {
      // Radix moves focus in a timer; wait for selection before inspecting it.
      await page.waitForFunction(({ selector, expected }) => {
        const el = document.querySelectorAll(`${selector} [role="radio"]`)[expected];
        return el?.getAttribute("aria-checked") === "true" && document.activeElement === el;
      }, {}, { selector, expected });
      const state = await page.$$eval(radios(selector), (els) => els.map((el) => ({
        selected: el.getAttribute("aria-checked") === "true",
        focused: document.activeElement === el, tabIndex: el.tabIndex,
        visible: el.matches(":focus-visible"),
        outline: getComputedStyle(el.closest("label") || el).outlineStyle,
        outlineWidth: getComputedStyle(el.closest("label") || el).outlineWidth,
      })));
      assert.equal(state.filter((el) => el.selected).length, 1);
      assert.deepEqual(state.map((el) => el.tabIndex), state.map((_, i) => i === expected ? 0 : -1));
      assert.equal(state[expected].selected, true);
      assert.equal(state[expected].focused, true);
      assert.equal(state[expected].visible, true);
      assert.equal(state[expected].outline, "solid");
      assert.notEqual(state[expected].outlineWidth, "0px");
      await total();
    }
    async function shiftTab() {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    }
    async function tabStop(selector, expected) {
      await focusChoice(selector, expected);
      await shiftTab();
      assert.equal(await page.$eval(selector, (el) => el.contains(document.activeElement)), false);
      await page.keyboard.press("Tab");
      await choice(selector, expected);
      await page.keyboard.press("Tab");
      assert.equal(await page.$eval(selector, (el) => el.contains(document.activeElement)), false);
      await shiftTab();
      await choice(selector, expected);
    }
    await total();
    // Payment: a bank method (Multicaixa Express, index 2) is pre-selected when available; cash (index 0) is the
    // fallback. Arrow order skips the disabled card: 2 → 3 → 0 → 2.
    for (const [selector, values] of [[delivery, [0, 1]], [tips, [0, 200, 500, 1000]], [payment, [2, 3, 0]]]) {
      const optionIndex = (index) => selector === payment ? values[index] : index;
      let index = 0;
      await tabStop(selector, optionIndex(index));
      for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "ArrowLeft", "ArrowRight"]) {
        index = (index + (["ArrowRight", "ArrowDown"].includes(key) ? 1 : -1) + values.length) % values.length;
        if (selector === delivery) priority = !!values[index];
        if (selector === tips) tip = values[index];
        await page.keyboard.press(key);
        await choice(selector, optionIndex(index));
      }
      for (const [key, target] of [["Space", 1], ["Enter", 0]]) {
        await focusChoice(selector, optionIndex(target));
        if (selector === delivery) priority = !!values[target];
        if (selector === tips) tip = values[target];
        await page.keyboard.press(key);
        await choice(selector, optionIndex(target));
      }
      // Mouse activation keeps the new selection as the group's only Tab stop.
      const elements = await page.$$(radios(selector));
      await elements[optionIndex(1)].click();
      if (selector === delivery) priority = !!values[1];
      if (selector === tips) tip = values[1];
      await tabStop(selector, optionIndex(1));
    }
    assert.ok(quotes.some((q) => q.priority && q.riderTip === 1000));
    assert.ok(quotes.every((q) => q.items[0].menuItemId === 888 && q.storeId === 777));
    // Production-like configuration: cash is the only available method.
    cashOnly = true;
    priority = false;
    tip = 0;
    await page.reload({ waitUntil: "networkidle0" });
    await tabStop(payment, 0);
    for (const key of ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Space", "Enter"]) {
      await page.keyboard.press(key);
      await choice(payment, 0);
    }
    assert.equal(await page.evaluate(() => window.checkoutSubmits), 0);
    assert.equal(new URL(page.url()).pathname, "/checkout");
    assert.deepEqual(unexpected, [], "no unmocked API calls or order attempts");
    assert.deepEqual(errors, []);
    console.log(`PASS ${width}px: arrows, wrap, Tab/Shift+Tab, focus, Space/Enter, clicks, disabled payments and totals; no orders`);
    await page.close();
  }
} finally {
  await browser.close();
}
