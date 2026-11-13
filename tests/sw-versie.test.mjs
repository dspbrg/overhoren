// De service worker na een update: nooit oud en nieuw door elkaar.
//
// Op een iPhone (app op het beginscherm) gaf een update een kapotte mix:
// nieuwe index.html met de oude ui.js en ds.css uit de cache. De nieuwe
// code riep iets aan dat in de oude ui.js niet bestond en stopte.
//
// Deze tests spelen dat na met een eigen server die twee versies kent.
// Elke versie heeft een eigen stempel (?v= in index.html, VERSIE in sw.js),
// een eigen functie in ui.js die index.html aanroept, en een eigen
// css-merkje. Een mix geeft dus een JS-fout, of een css die niet past.
//
//   - versie A installeren en openen
//   - de server zet versie B neer, soms met sw.js nog even op A (zoals een
//     CDN die sw.js later ververst)
//   - een paar keer openen: nooit een fout, nooit een mix, uiteindelijk B
//   - offline: de bewaarde versie, zonder fouten
//   - na een update hooguit een keer herladen, niet midden in een ronde
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";
import { REPO, startBrowser, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";

// korte stempels, zoals de sha die de deploy erin zet
const STEMPEL = { A: "a111111", B: "b222222", C: "c333333" };

const MIME = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2"
};

// De server. stand.app is de versie van index.html, ui.js en ds.css;
// stand.sw die van sw.js. Die twee kunnen even uit de pas lopen.
function startVersieServer() {
  const stand = { app: "A", sw: "A" };
  const server = createServer((req, res) => {
    const pad = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let bestand = normalize(join(REPO, pad));
    if (!bestand.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    if (existsSync(bestand) && statSync(bestand).isDirectory()) bestand = join(bestand, "index.html");
    if (!existsSync(bestand)) { res.writeHead(404); return res.end("niet gevonden"); }
    let body = readFileSync(bestand);
    const naam = bestand.slice(REPO.length);
    const v = stand.app;
    if (naam === "/index.html") {
      body = String(body).replace(/\?v=[A-Za-z0-9]+/g, "?v=" + STEMPEL[v])
        // de nieuwe code gebruikt iets wat alleen in de ui.js van dezelfde versie staat
        .replace("  zetBeta();\n", "  zetBeta();\n  document.documentElement.dataset.testversie = UI.testVersie" + v + "();\n");
    } else if (naam === "/ui.js") {
      body = String(body) + "\nwindow.UI.testVersie" + v + " = function () { return \"" + v + "\"; };\n";
    } else if (naam === "/ds.css") {
      body = String(body) + "\n:root { --testversie: \"" + v + "\"; }\n";
    } else if (naam === "/sw.js") {
      body = String(body).replace(/^const VERSIE = ".*";/m, "const VERSIE = \"" + STEMPEL[stand.sw] + "\";");
    }
    res.writeHead(200, { "Content-Type": MIME[extname(bestand)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(body);
  });
  return new Promise(ok => server.listen(0, "localhost", () => {
    const { port } = server.address();
    ok({ url: "http://localhost:" + port, stand,
      stop: () => new Promise(r => { server.closeAllConnections?.(); server.close(() => r()); }) });
  }));
}

let browser, server;
before(async () => { browser = await startBrowser(); server = await startVersieServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function nieuweContext() {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: "allow", locale: "nl-NL" });
  await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  // elke keer dat het hoofdframe een nieuw document laadt
  const laden = [];
  page.on("framenavigated", f => { if (f === page.mainFrame()) laden.push(f.url()); });
  return { context, page, fouten, laden };
}

// Versie A installeren: openen, wachten tot de service worker de pagina
// beheert en de schil in de cache staat.
async function installeer(page) {
  await page.goto(server.url + "/");
  await wachtOpScherm(page, "scr-lessons");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await wachtTot(page, async () => {
    if (!navigator.serviceWorker.controller) return false;
    for (const n of await caches.keys()) { const c = await caches.open(n); if (await c.match("./ui.js") && await c.match("./")) return true; }
    return false;
  });
}

// Herhaal fn in de pagina tot hij waar geeft. (waitForFunction wacht niet
// op een async functie: een Promise telt daar al als waar.)
async function wachtTot(page, fn, arg, ms = 10000) {
  const eind = Date.now() + ms;
  for (;;) {
    if (await page.evaluate(fn, arg).catch(() => false)) return;
    if (Date.now() > eind) throw new Error("wachtTot: duurt te lang");
    await page.waitForTimeout(100);
  }
}

// De VERSIE van de service worker die de pagina beheert (vraagt het hem).
const swVersieIn = page => page.evaluate(() => new Promise(klaar => {
  const sw = navigator.serviceWorker.controller;
  if (!sw) return klaar(null);
  const kanaal = new MessageChannel();
  kanaal.port1.onmessage = e => klaar(e.data);
  sw.postMessage("versie", [kanaal.port2]);
  setTimeout(() => klaar(null), 1000);
})).catch(() => null);

// Welke versie staat er in beeld, volgens elk onderdeel apart.
const inBeeld = page => page.evaluate(() => {
  const script = document.querySelector('script[src^="ui.js"]');
  const html = script ? new URL(script.src).searchParams.get("v") : null;
  const js = document.documentElement.dataset.testversie || null;
  const css = getComputedStyle(document.documentElement).getPropertyValue("--testversie").trim().replace(/"/g, "") || null;
  const lessen = document.querySelectorAll("#lessons .lesson").length;
  const beta = !!document.querySelector("#app-titel .beta");
  return { html, js, css, lessen, beta };
});
const versieVan = stempel => Object.keys(STEMPEL).find(k => STEMPEL[k] === stempel);

// Een hele, consistente versie: html, js en css van dezelfde, lijsten en Beta in beeld.
async function heel(page, fouten, moment) {
  await wachtOpScherm(page, "scr-lessons").catch(() => {});
  // even wachten: een fout in init komt soms net na het tonen van het scherm
  await page.waitForTimeout(150);
  const b = await inBeeld(page);
  assert.deepEqual(fouten, [], moment + ": fouten " + fouten.join("; "));
  const v = versieVan(b.html);
  assert.ok(v && b.js === v && b.css === v, moment + ": oud en nieuw door elkaar " + JSON.stringify(b));
  assert.ok(b.lessen > 0, moment + ": geen lijsten in beeld");
  assert.ok(b.beta, moment + ": geen Beta in beeld");
  return v;
}

// Open de app opnieuw, zoals tikken op het icoon: een navigatie naar /.
async function open(page) {
  await page.goto(server.url + "/");
}

// Wacht tot de service worker van de verwachte versie de pagina beheert
// en alleen zijn eigen cache er nog staat.
async function wachtOpSw(page, stempel) {
  const eind = Date.now() + 10000;
  while (await swVersieIn(page) !== stempel) {
    if (Date.now() > eind) throw new Error("service worker " + stempel + " neemt niet over");
    await page.waitForTimeout(100);
  }
  await wachtTot(page, async s => { const n = await caches.keys(); return n.length === 1 && n[0].endsWith("-" + s); }, stempel);
}

for (const geval of [
  { naam: "sw.js loopt even achter (zoals een CDN)", achter: true },
  { naam: "alles tegelijk", achter: false }
]) {
  test(`update van A naar B, ${geval.naam}: nooit een fout of een mix, daarna B, en offline de bewaarde B`, async () => {
    server.stand.app = "A"; server.stand.sw = "A";
    const { context, page, fouten } = await nieuweContext();
    await installeer(page);
    assert.equal(await heel(page, fouten, "A na installatie"), "A");

    // de server zet B neer
    server.stand.app = "B"; server.stand.sw = geval.achter ? "A" : "B";
    for (let i = 1; i <= 3; i++) {
      await open(page);
      await heel(page, fouten, `B open ${i}`);
      await page.waitForTimeout(300);   // achtergrondwerk van de service worker
    }
    server.stand.sw = "B";
    let laatst = null;
    for (let i = 1; i <= 4; i++) {
      await open(page);
      laatst = await heel(page, fouten, `B met sw B open ${i}`);
      await page.waitForTimeout(300);
    }
    assert.equal(laatst, "B", "uiteindelijk niet B in beeld");
    await wachtOpSw(page, STEMPEL.B);

    // offline: de bewaarde versie, heel en zonder fouten
    await context.setOffline(true);
    for (const pad of ["/", "/index.html"]) {
      const res = await page.goto(server.url + pad).catch(e => e);
      assert.ok(!(res instanceof Error) && res.ok(), `offline ${pad}: ${res?.message || res?.status()}`);
      assert.equal(await heel(page, fouten, "offline " + pad), "B", "offline niet de bewaarde B");
    }
    await context.close();
  });
}

test("eerste installatie: de service worker neemt over zonder te herladen, ook als hij een andere versie is", async () => {
  // de pagina is al B, sw.js nog A (een CDN die achterloopt): bij een
  // eerste installatie toch niet herladen
  server.stand.app = "B"; server.stand.sw = "A";
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  await page.waitForTimeout(800);
  assert.equal(laden.length, 1, "herladen bij de eerste installatie: " + laden.join(", "));
  assert.equal(await heel(page, fouten, "eerste installatie"), "B");
  await context.close();
});

// De app staat open op A; ondertussen komt B binnen. Een update laten
// zoeken, zoals de browser dat vanzelf ook doet.
const zoekUpdate = page => page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); });

test("update terwijl de app openstaat op het lessenscherm: een keer herladen, dan B", async () => {
  server.stand.app = "A"; server.stand.sw = "A";
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  assert.equal(await heel(page, fouten, "A"), "A");
  const voor = laden.length;

  server.stand.app = "B"; server.stand.sw = "B";
  await zoekUpdate(page);
  await page.waitForFunction(() => document.documentElement.dataset.testversie === "B", null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);   // geen tweede keer
  assert.equal(laden.length - voor, 1, "niet precies een keer herladen: " + laden.slice(voor).join(", "));
  assert.equal(await heel(page, fouten, "na herladen"), "B");
  await context.close();
});

test("geen lus: een tweede update vanaf dezelfde versie herlaadt niet nog eens", async () => {
  server.stand.app = "A"; server.stand.sw = "A";
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  const voor = laden.length;

  // sw B komt, maar de server geeft de app nog als A: na het herladen
  // staat A er nog steeds
  server.stand.sw = "B";
  await zoekUpdate(page);
  await page.waitForTimeout(1500);
  const na1 = laden.length - voor;
  assert.ok(na1 <= 1, "meer dan een keer herladen na de eerste update: " + na1);
  await wachtOpScherm(page, "scr-lessons");
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });

  // nog een update, de app nog steeds A: nu niet meer herladen
  server.stand.sw = "C";
  await zoekUpdate(page);
  await wachtOpSw(page, STEMPEL.C);
  await page.waitForTimeout(1500);
  assert.equal(laden.length - voor, na1, "opnieuw herladen vanaf dezelfde versie: " + laden.slice(voor).join(", "));
  assert.equal(await heel(page, fouten, "na twee updates"), "A");
  await context.close();
});

test("update midden in een ronde: niet herladen tot het lessenscherm, dan een keer", async () => {
  server.stand.app = "A"; server.stand.sw = "A";
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  await page.locator("#lessons .lesson").first().click();
  await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start");
  await wachtOpScherm(page, "scr-quiz");
  const voor = laden.length;

  server.stand.app = "B"; server.stand.sw = "B";
  await zoekUpdate(page);
  await wachtOpSw(page, STEMPEL.B);
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 0, "herladen midden in de ronde");
  assert.ok(await page.locator("#scr-quiz").isVisible(), "de ronde is weg");

  // naar huis: stoppen, dan naar het lessenscherm
  await page.click("#btn-quit");
  await wachtOpScherm(page, "scr-summary");
  await page.click("#btn-sum-lessons");
  await page.waitForFunction(() => document.documentElement.dataset.testversie === "B", null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 1, "niet precies een keer herladen op het lessenscherm: " + laden.slice(voor).join(", "));
  assert.equal(await heel(page, fouten, "na de ronde"), "B");
  await context.close();
});

test("versie in beeld: de uitleg achter Beta noemt de versie van de app", async () => {
  server.stand.app = "B"; server.stand.sw = "B";
  const { context, page, fouten } = await nieuweContext();
  await page.goto(server.url + "/");
  await wachtOpScherm(page, "scr-lessons");
  await page.click("#app-titel .beta");
  const regel = page.locator("#beta-uitleg .beta-versie");
  assert.equal(await regel.count(), 1, "geen versieregel in de Beta-uitleg");
  assert.equal((await regel.textContent()).trim(), "Versie " + STEMPEL.B);
  assert.ok(await regel.isVisible(), "versieregel niet zichtbaar");
  assert.deepEqual(fouten, []);
  await context.close();
});
