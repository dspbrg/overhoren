// De app op Cloudflare (Workers static assets, html_handling
// "auto-trailing-slash"): /index.html geeft daar een 307 naar /.
// Een response die via zo'n doorverwijzing in de cache belandt, mag nooit
// een navigatie beantwoorden: de browser weigert hem en de geinstalleerde
// app opent met een foutpagina. Deze test bootst die server na.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer({ zoalsCloudflare: true }); });
after(async () => { await browser?.close(); await server?.stop(); });

test("controle: de testserver stuurt /index.html door naar /", async () => {
  const res = await fetch(server.url + "/index.html", { redirect: "manual" });
  assert.equal(res.status, 307);
  assert.equal(res.headers.get("location"), "/");
});

test("start_url van het manifest wordt niet doorgestuurd", async () => {
  const manifest = JSON.parse(readFileSync(join(REPO, "manifest.json"), "utf8"));
  const start = new URL(manifest.start_url, server.url + "/manifest.json");
  const res = await fetch(start, { redirect: "manual" });
  assert.equal(res.status, 200, "start_url " + manifest.start_url + " geeft " + res.status);
});

// Alle responses in alle caches, met hun redirected-kenmerk.
const cacheInhoud = page => page.evaluate(async () => {
  const uit = [];
  for (const naam of await caches.keys()) {
    const c = await caches.open(naam);
    for (const req of await c.keys()) {
      const res = await c.match(req);
      uit.push({ url: req.url, redirected: res.redirected, status: res.status });
    }
  }
  return uit;
});

function geenOmleiding(inhoud, moment) {
  assert.ok(inhoud.length > 0, "cache is leeg " + moment);
  const omgeleid = inhoud.filter(r => r.redirected);
  assert.deepEqual(omgeleid, [], "gecachte responses met redirected=true " + moment + ": " + omgeleid.map(r => r.url).join(", "));
}

for (const begin of ["/", "/index.html"]) {
  test(`offline openen na installatie via ${begin}: / en /index.html geven de app`, async () => {
    const context = await browser.newContext({ serviceWorkers: "allow" });
    await schermNetwerkAf(context);
    const page = await context.newPage();
    const fouten = volgFouten(page);

    // online: service worker installeren en wachten tot de schil er staat
    await page.goto(server.url + begin);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(async () => !!(await caches.match("./ds.css", { ignoreSearch: true })) && !!(await caches.match("./")),
      null, { timeout: 10000, polling: 200 });
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker neemt de pagina niet over");
    geenOmleiding(await cacheInhoud(page), "na installatie");

    // online nog een keer naar /index.html (oude snelkoppeling), dan
    // verversen de achtergrondverzoeken ook de cache
    const online = await page.goto(server.url + "/index.html");
    assert.ok(online && online.ok(), "online /index.html geeft " + online?.status());
    await page.locator("#scr-lessons").waitFor({ state: "visible" });
    await page.waitForTimeout(300);

    geenOmleiding(await cacheInhoud(page), "na verversen");

    // offline: beide adressen moeten de app geven
    await context.setOffline(true);
    for (const pad of ["/", "/index.html", "/index.html?bron=snelkoppeling"]) {
      const res = await page.goto(server.url + pad).catch(e => e);
      assert.ok(!(res instanceof Error), `offline ${pad}: ${res?.message}`);
      assert.ok(res && res.ok(), `offline ${pad} geeft status ${res?.status()}`);
      assert.ok(res.fromServiceWorker(), `offline ${pad} kwam niet uit de service worker`);
      await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
    }

    assert.deepEqual(fouten, [], "fouten: " + fouten.join("; "));
    await context.close();
  });
}
