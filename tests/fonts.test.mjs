// Eis 3: fonts laden zonder internet (via de service worker) en er gaat
// geen enkel verzoek naar Google.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";

const lees = f => readFileSync(join(REPO, f), "utf8");
const GOOGLE = /fonts\.googleapis\.com|fonts\.gstatic\.com|google/i;

// ---------- zonder browser ----------
test("elk font uit ds.css bestaat en staat in de service worker", () => {
  const css = lees("ds.css");
  const sw = lees("sw.js");
  const fonts = [...css.matchAll(/url\((?:["']?)(fonts\/[^)"']+)(?:["']?)\)/g)].map(m => m[1]);
  assert.ok(fonts.length >= 6, "verwacht minstens 6 fontbestanden in ds.css, gevonden: " + fonts.length);
  const schil = [...sw.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
  for (const f of fonts) {
    assert.ok(existsSync(join(REPO, f)), f + " bestaat niet");
    assert.ok(schil.includes(f), f + " staat niet in de lijst van sw.js, dus niet offline");
  }
  for (const f of schil) assert.ok(existsSync(join(REPO, f === "" ? "index.html" : f)), "sw.js noemt " + f + ", maar dat bestand bestaat niet");
});

test("geen verwijzing naar Google in de app-bestanden", () => {
  for (const f of ["index.html", "styleguide.html", "ds.css", "sw.js", "ui.js", "celebrate.js", "manifest.json"]) {
    assert.doesNotMatch(lees(f), /fonts\.googleapis|fonts\.gstatic/, f + " verwijst naar Google Fonts");
  }
});

// ---------- in de browser ----------
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// welk lettertype tekent de browser echt voor een element (niet wat CSS vraagt)
async function getekendFont(page, selector) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable"); await cdp.send("CSS.enable");
  const { root } = await cdp.send("DOM.getDocument", { depth: -1 });
  const { nodeId } = await cdp.send("DOM.querySelector", { nodeId: root.nodeId, selector });
  const { fonts } = await cdp.send("CSS.getPlatformFontsForNode", { nodeId });
  await cdp.detach();
  // isCustomFont: uit een @font-face (onze bestanden), niet van het systeem
  return fonts.map(f => (f.isCustomFont ? "" : "systeem:") + f.familyName);
}

test("controle: zonder service worker laadt de app offline niet", async () => {
  // Bewijst dat de offline-stand echt offline is, ook voor localhost.
  const context = await browser.newContext({ serviceWorkers: "block" });
  await schermNetwerkAf(context);
  const page = await context.newPage();
  await page.goto(server.url + "/index.html");
  await context.setOffline(true);
  await assert.rejects(page.reload(), /ERR_INTERNET_DISCONNECTED|net::/);
  await context.close();
});

for (const thema of ["light", "dark"]) {
  test(`fonts laden offline via de service worker (${thema})`, async () => {
    const context = await browser.newContext({ serviceWorkers: "allow", colorScheme: thema });
    const extern = await schermNetwerkAf(context);
    const page = await context.newPage();
    const fouten = volgFouten(page);
    const fontAntwoorden = [];
    page.on("response", r => { if (/\.woff2/.test(r.url())) fontAntwoorden.push({ url: r.url(), sw: r.fromServiceWorker(), status: r.status() }); });

    // online: service worker installeren en wachten tot alles in de cache staat
    await page.goto(server.url + "/index.html");
    const fontUrls = [...lees("ds.css").matchAll(/url\((fonts\/[^)]+)\)/g)].map(m => m[1]);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.waitForFunction(async urls => {
      for (const u of urls) if (!(await caches.match(u, { ignoreSearch: true }))) return false;
      return true;
    }, fontUrls, { timeout: 10000, polling: 200 });
    if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
    assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker neemt de pagina niet over");

    // offline: alles moet nu uit de cache komen
    fontAntwoorden.length = 0;
    await context.setOffline(true);
    await page.reload();
    await page.locator("#scr-lessons").waitFor({ state: "visible" });
    // ook de latin-ext-subsets aanspreken (ő, ł)
    await page.evaluate(() => {
      const p = document.createElement("p"); p.id = "fonttest";
      p.innerHTML = '<b style="font-family:\'Chakra Petch\';font-weight:600">Aő</b><b style="font-family:\'Chakra Petch\';font-weight:700">Aő</b><span style="font-family:Inter">Ił1ő</span>';
      document.body.appendChild(p);
    });
    const status = await page.evaluate(async () => {
      // allSettled: een font dat niet laadt moet als "error" in de lijst
      // hieronder verschijnen, niet als onduidelijke NetworkError
      await Promise.allSettled([
        document.fonts.load('600 20px "Chakra Petch"', "Aő"), document.fonts.load('700 20px "Chakra Petch"', "Aő"),
        document.fonts.load('400 20px "Inter"', "Ił1ő"), document.fonts.load('700 20px "Inter"', "Ił1ő")
      ]);
      await document.fonts.ready;
      return [...document.fonts].map(f => ({ fam: f.family.replace(/"/g, ""), w: f.weight, s: f.status }));
    });
    for (const f of status) assert.notEqual(f.s, "error", `font ${f.fam} ${f.w} laadt niet offline`);
    for (const fam of ["Chakra Petch", "Inter"]) {
      assert.ok(status.some(f => f.fam === fam && f.s === "loaded"), fam + " is offline niet geladen");
    }
    assert.equal(status.filter(f => f.s === "loaded").length, 6, "verwacht alle 6 fontbestanden geladen: " + JSON.stringify(status));
    assert.ok(fontAntwoorden.length > 0, "geen fontverzoeken gezien");
    for (const a of fontAntwoorden) {
      assert.equal(a.status, 200, a.url);
      assert.ok(a.sw, a.url + " kwam niet uit de service worker");
    }

    // wat de browser echt tekent
    assert.deepEqual(await getekendFont(page, "#scr-lessons h1, h1"), ["Chakra Petch"], "kop niet in Chakra Petch");
    // Inter heet in het bestand zelf "Inter Variable"
    const isInter = f => /^Inter( Variable)?$/.test(f);
    const knop = await getekendFont(page, "#btn-import");
    assert.ok(knop.length && knop.every(isInter), "knoptekst niet in Inter: " + knop);
    const ext = await getekendFont(page, "#fonttest span");
    assert.ok(ext.length && ext.every(isInter), "latin-ext niet in Inter: " + ext);
    assert.match(await page.evaluate(() => getComputedStyle(document.body).fontFeatureSettings), /ss02/, "ss02 staat niet aan");

    assert.deepEqual(extern.filter(u => GOOGLE.test(u)), [], "verzoek naar Google");
    assert.deepEqual(fouten, [], "fouten: " + fouten.join("; "));
    await context.close();
  });
}

test("styleguide doet geen verzoeken naar Google", async () => {
  const context = await browser.newContext({ serviceWorkers: "block" });
  const extern = await schermNetwerkAf(context);
  const page = await context.newPage();
  await page.goto(server.url + "/styleguide.html");
  await page.evaluate(() => document.fonts.ready);
  assert.deepEqual(extern, [], "externe verzoeken: " + extern.join(", "));
  await context.close();
});
