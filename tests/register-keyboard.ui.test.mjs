import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

// Only reads the registration page. No accounts are created, even on a regression.
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
  let writes = 0;
  await page.setRequestInterception(true);
  page.on("request", (request) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      writes++;
      return request.abort();
    }
    return request.continue();
  });

  for (const width of [1280, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/registar`, { waitUntil: "networkidle0" });
    await page.waitForSelector("#fullName");
    await page.evaluate(() => {
      window.registrationSubmits = 0;
      document.querySelector("form").addEventListener("submit", (event) => {
        window.registrationSubmits++;
        event.preventDefault();
      }, true);
    });
    const account = '[role="radiogroup"][aria-labelledby="account-type-label"]';
    const business = '[role="radiogroup"][aria-label="Tipo de negócio"]';
    const radios = (group) => `${group} > [role="radio"]`;
    const radio = (group, index) => `${radios(group)}:nth-child(${index + 1})`;
    async function shiftTab() {
      await page.keyboard.down("Shift");
      await page.keyboard.press("Tab");
      await page.keyboard.up("Shift");
    }
    async function choice(group, expected) {
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
    await fields({ customer: true });
    // All four arrows, including wrapping in both directions.
    for (const [key, expected] of [
      ["ArrowLeft", 2], ["ArrowRight", 0], ["ArrowUp", 2],
      ["ArrowDown", 0], ["ArrowRight", 1],
    ]) {
      await page.keyboard.press(key);
      await choice(account, expected);
      await fields({ customer: expected === 0, supplier: expected === 1 });
    }
    await tabStop(account, 1);
    await tabStop(business, 0);
    for (const [key, expected] of [
      ["ArrowRight", 1], ["ArrowDown", 0], ["ArrowLeft", 1], ["ArrowUp", 0],
    ]) {
      await page.keyboard.press(key);
      await choice(business, expected);
      await fields({ supplier: true, home: expected === 1 });
      if (expected === 1) {
        assert.match(await page.$eval("#b-notice", (el) => el.textContent), /24 h/);
        assert.match(await page.$eval("#b-type", (el) => el.textContent), /Pastelaria/);
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
    console.log(`PASS ${width}px: arrows, wrapping, Tab, visible focus, Space/Enter, clicks and conditional fields`);
  }
  assert.equal(writes, 0, "no write requests may be attempted");
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
