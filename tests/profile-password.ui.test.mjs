import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

// A synthetic session and intercepted API keep this test independent of accounts.
// All writes are blocked, including password changes if local validation regresses.
const BASE = process.env.BASE || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const CHROME = process.env.CHROME_BIN || [
  "/usr/bin/google-chrome", "/usr/bin/chromium", "/repl/tools/bin/chromium",
].find(existsSync);
const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const messages = {
  pt: {
    title: "Alterar palavra-passe", save: "Guardar",
    short: "A nova palavra-passe tem de ter pelo menos 8 caracteres.",
    mismatch: "As palavras-passe não coincidem.",
  },
  en: {
    title: "Change password", save: "Save",
    short: "The new password must be at least 8 characters.",
    mismatch: "Passwords don't match.",
  },
  fr: {
    title: "Changer le mot de passe", save: "Enregistrer",
    short: "Au moins 8 caractères.",
    mismatch: "Les mots de passe ne correspondent pas.",
  },
};

try {
  for (const [lang, expected] of Object.entries(messages)) {
    const page = await browser.newPage();
    const writes = [];
    const unexpectedReads = [];
    const errors = [];
    let submits = 0;
    try {
      page.on("pageerror", (error) => errors.push(error.message));
      await page.exposeFunction("recordPasswordSubmit", () => { submits++; });
      await page.evaluateOnNewDocument((language) => {
        localStorage.setItem("lang", language);
        document.addEventListener("submit", (event) => {
          if (event.target.id === "pw-form") window.recordPasswordSubmit();
        }, true);
      }, lang);
      await page.setRequestInterception(true);
      page.on("request", (request) => {
        const path = new URL(request.url()).pathname;
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
          writes.push(`${request.method()} ${path}`);
          return request.abort();
        }
        const respond = (body) => request.respond({
          status: 200, contentType: "application/json", body: JSON.stringify(body),
        });
        if (path === "/api/auth/me") return respond({ user: {
          id: 900001, username: "profile_fixture", fullName: "Perfil de teste",
          email: null, phone: "+244900000000", userType: "customer",
          isApproved: true, referralCode: "FIXTURE", loyaltyPoints: 0,
          preferredLanguage: lang, dietaryPreferences: [],
        } });
        if (path === "/api/plus") return respond({ active: false });
        if (path.startsWith("/api/")) {
          unexpectedReads.push(path);
          return request.abort();
        }
        return request.continue();
      });
      await page.goto(`${BASE}/perfil`, { waitUntil: "networkidle0" });
      assert.equal(await page.evaluate(() => document.documentElement.lang), lang === "pt" ? "pt-AO" : lang);
      const open = await page.waitForSelector(`button ::-p-text(${expected.title})`);
      await open.click();
      await page.waitForSelector('#pw-cur', { visible: true });
      assert.equal(await page.$eval('[role="dialog"] h2', (el) => el.textContent), expected.title);
      assert.equal(await page.$eval('button[form="pw-form"]', (el) => el.textContent), expected.save);
      await page.type("#pw-cur", "SyntheticCurrent#2026");

      async function fill(selector, value) {
        await page.click(selector, { clickCount: 3 });
        await page.keyboard.press("Backspace");
        await page.type(selector, value);
      }
      async function checkError(message, expectedSubmits) {
        // Native required validation must not prevent the real React submit handler.
        assert.equal(await page.$eval("#pw-form", (form) => form.checkValidity()), true);
        await page.click('button[form="pw-form"]');
        await page.waitForFunction((text) =>
          document.querySelector('#pw-form [role="alert"]')?.textContent === text,
        {}, message);
        assert.equal(await page.$eval('#pw-form [role="alert"]', (el) =>
          !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length)), true);
        assert.equal(await page.$$eval('#pw-form [role="alert"]', (els) => els.length), 1);
        assert.equal(submits, expectedSubmits, `${lang}: real form submitted`);
        assert.ok(await page.$('[role="dialog"]'), `${lang}: dialog remains open`);
        assert.deepEqual(writes, [], `${lang}: validation must not send any writes`);
      }

      // Matching seven-character values isolate the minimum-length validation.
      await fill("#pw-new", "1234567");
      await fill("#pw-conf", "1234567");
      await checkError(expected.short, 1);
      // Exactly eight characters passes the boundary and isolates confirmation.
      await fill("#pw-new", "12345678");
      await fill("#pw-conf", "87654321");
      await checkError(expected.mismatch, 2);
      assert.equal(await page.$eval("#pw-cur", (el) => el.value), "SyntheticCurrent#2026");
      assert.deepEqual(errors, [], `${lang}: no browser errors`);
      assert.deepEqual(unexpectedReads, [], `${lang}: all API reads use fixtures`);
      console.log(`PASS ${lang}: visible short-password and mismatch messages; zero account writes`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}
