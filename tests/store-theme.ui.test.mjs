import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE || "http://localhost:5000";
const CHROME = process.env.CHROME_BIN || [
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/repl/tools/bin/chromium",
].find(existsSync) || "/usr/bin/google-chrome";
const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--lang=pt-PT"],
});

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
let originalTheme;

async function api(method, path, body) {
  return page.evaluate(async ({ method, path, body }) => {
    const response = await fetch(path, {
      method,
      credentials: "include",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  }, { method, path, body });
}

async function selectTheme(label) {
  await page.$eval(`[role="radio"][aria-label="${label}"]`, (button) => button.click());
}

async function saveTheme() {
  const formState = await page.evaluate(() => ({
    disabled: document.querySelector('form button[type="submit"]')?.disabled,
    alerts: [...document.querySelectorAll('[role="alert"]')].map((element) => element.innerText),
  }));
  assert.equal(formState.disabled, false, `o formulário não permite guardar: ${formState.alerts.join(" ")}`);
  const response = page.waitForResponse((r) =>
    r.url().includes("/api/partner/store") && r.request().method() === "PATCH",
    { timeout: 15000 },
  );
  await page.$eval('form button[type="submit"]', (button) => button.click());
  const result = await response;
  assert.equal(result.status(), 200, `guardar cor respondeu ${result.status()}: ${await result.text()}`);
}

try {
  await page.goto(`${BASE}/entrar?next=${encodeURIComponent("/parceiro/loja")}`, { waitUntil: "networkidle0" });
  await page.type("#username", "loja");
  await page.type("#password", "Loja#2026demo");
  await Promise.all([
    page.waitForFunction(() => location.pathname === "/parceiro/loja", { timeout: 15000 }),
    page.click('button[type="submit"]'),
  ]);

  const initial = await api("GET", "/api/partner/store");
  assert.equal(initial.status, 200, "a loja de demonstração deve abrir a sessão autenticada");
  originalTheme = initial.body.store.theme;

  await page.goto(`${BASE}/parceiro/loja`, { waitUntil: "networkidle0" });
  await page.waitForSelector('[role="radiogroup"] [role="radio"]');

  const colors = await page.$$eval('[role="radiogroup"] [role="radio"][aria-label]', (buttons) =>
    buttons.map((button) => button.getAttribute("aria-label")),
  );
  assert.equal(colors.length, 12, `esperava 12 cores, encontrei ${colors.length}`);
  assert.deepEqual(colors, [
    "Pêssego", "Coral", "Pôr do sol", "Rosa", "Frutos silvestres", "Algodão doce",
    "Lilás", "Violeta", "Azul", "Água", "Menta", "Limão",
  ]);
  console.log("PASS  loja de demonstração vê as 12 cores");

  const targetTheme = originalTheme === "lilac" ? "peach" : "lilac";
  const targetLabel = targetTheme === "peach" ? "Pêssego" : "Lilás";
  const preview = '[aria-label="Pré-visualização"] > div';
  const oldPreview = await page.$eval(preview, (element) => element.style.background);
  await selectTheme(targetLabel);
  assert.equal(
    await page.$eval(`[role="radio"][aria-label="${targetLabel}"]`, (button) => button.getAttribute("aria-checked")),
    "true",
    "a cor escolhida deve ficar seleccionada",
  );
  assert.notEqual(await page.$eval(preview, (element) => element.style.background), oldPreview,
    "a pré-visualização deve mudar quando se escolhe outra cor");
  assert.match(await page.$eval('[aria-label="Pré-visualização"]', (element) => element.innerText), new RegExp(targetLabel));
  console.log(`PASS  escolher ${targetLabel} actualiza a pré-visualização`);

  await saveTheme();
  await page.reload({ waitUntil: "networkidle0" });
  await page.waitForSelector(`[role="radio"][aria-label="${targetLabel}"][aria-checked="true"]`);
  assert.match(await page.$eval('[aria-label="Pré-visualização"]', (element) => element.innerText), new RegExp(targetLabel));
  const saved = await api("GET", "/api/partner/store");
  assert.equal(saved.body.store.theme, targetTheme, "a cor escolhida deve continuar guardada após reabrir");
  console.log(`PASS  guardar e reabrir mantém ${targetLabel}`);
} finally {
  if (originalTheme !== undefined) {
    const restored = await api("PATCH", "/api/partner/store", { theme: originalTheme });
    assert.equal(restored.status, 200, "o tema inicial da loja deve ser reposto após o teste");
    const verified = await api("GET", "/api/partner/store");
    assert.equal(verified.body.store.theme, originalTheme, "a loja deve terminar com o tema inicial");
    console.log("PASS  tema inicial da loja foi reposto");
  }
  await browser.close();
}
