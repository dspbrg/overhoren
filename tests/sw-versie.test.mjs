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
// stand.gestempeld = false is GitHub Pages: ?v= en VERSIE blijven zoals ze
// in de repo staan, ook als de inhoud verandert. stand.swBron = "oud"
// serveert de sw.js van main van voor deze fix (tests/fixtures).
// stand.traag: { "/pad/begin": ms } wacht zo lang met elk pad dat zo begint.
// stand.faalPagina: de hoeveelste verzoeken om de pagina een 500 geven.
// /katten/ en /fonts/ krijgen een kop X-Testversie met de versie van de app.
const SW_OUD = readFileSync(join(REPO, "tests", "fixtures", "sw-oud-main.js"), "utf8");
function startVersieServer() {
  const stand = { app: "A", sw: "A", gestempeld: true, swBron: "nieuw" };
  const server = createServer(async (req, res) => {
    const pad = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let bestand = normalize(join(REPO, pad));
    if (!bestand.startsWith(REPO)) { res.writeHead(403); return res.end(); }
    if (existsSync(bestand) && statSync(bestand).isDirectory()) bestand = join(bestand, "index.html");
    if (!existsSync(bestand)) { res.writeHead(404); return res.end("niet gevonden"); }
    let body = readFileSync(bestand);
    const naam = bestand.slice(REPO.length);
    const v = stand.app;
    for (const [begin, ms] of Object.entries(stand.traag || {})) if (naam.startsWith(begin)) await new Promise(r => setTimeout(r, ms));
    const koppen = { "Content-Type": MIME[extname(bestand)] || "application/octet-stream", "Cache-Control": "no-store" };
    if (/^\/(katten|fonts)\//.test(naam)) koppen["X-Testversie"] = v;
    if (naam === "/index.html") {
      stand.paginaTeller = (stand.paginaTeller || 0) + 1;
      if ((stand.faalPagina || []).includes(stand.paginaTeller)) { res.writeHead(500, { "Cache-Control": "no-store" }); return res.end("kapot"); }
      // stand.trageHtml: zo veel ms wachten met de pagina (een traag netwerk)
      if (stand.trageHtml) await new Promise(r => setTimeout(r, stand.trageHtml));
      body = String(body);
      if (stand.gestempeld) body = body.replace(/\?v=[A-Za-z0-9]+/g, "?v=" + STEMPEL[v]);
      body = body.replace("</head>", '<meta name="testversie" content="' + v + '">\n</head>')
        // de nieuwe code gebruikt iets wat alleen in de ui.js van dezelfde versie staat
        .replace("  zetBeta();\n", "  zetBeta();\n  document.documentElement.dataset.testversie = UI.testVersie" + v + "();\n");
    } else if (naam === "/ui.js") {
      body = String(body) + "\nwindow.UI.testVersie" + v + " = function () { return \"" + v + "\"; };\n";
    } else if (naam === "/ds.css") {
      body = String(body) + "\n:root { --testversie: \"" + v + "\"; }\n";
    } else if (naam === "/sw.js") {
      body = stand.swBron === "oud" ? SW_OUD : String(body);
      if (stand.gestempeld) body = body.replace(/^const VERSIE = ".*";/m, "const VERSIE = \"" + STEMPEL[stand.sw] + "\";");
    }
    res.writeHead(200, koppen);
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
// Zet de server in een stand; wat niet genoemd wordt, wordt de standaard.
const zet = stand => Object.assign(server.stand, { app: "A", sw: "A", gestempeld: true, swBron: "nieuw", trageHtml: 0, traag: {}, faalPagina: [], paginaTeller: 0 }, stand);

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
  const stempel = script ? new URL(script.src).searchParams.get("v") : null;
  const html = document.querySelector('meta[name="testversie"]')?.content || null;
  const js = document.documentElement.dataset.testversie || null;
  const css = getComputedStyle(document.documentElement).getPropertyValue("--testversie").trim().replace(/"/g, "") || null;
  const lessen = document.querySelectorAll("#lessons .lesson").length;
  const beta = !!document.querySelector("#app-titel .beta");
  return { stempel, html, js, css, lessen, beta };
});

// Een hele, consistente versie: html, js en css van dezelfde, lijsten en Beta in beeld.
async function heel(page, fouten, moment) {
  await wachtOpScherm(page, "scr-lessons").catch(() => {});
  // even wachten: een fout in init komt soms net na het tonen van het scherm
  await page.waitForTimeout(150);
  const b = await inBeeld(page);
  assert.deepEqual(fouten, [], moment + ": fouten " + fouten.join("; "));
  const v = b.html;
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
    zet({ app: "A", sw: "A" });
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
  zet({ app: "B", sw: "A" });
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
  zet({ app: "A", sw: "A" });
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
  zet({ app: "A", sw: "A" });
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
  zet({ app: "A", sw: "A" });
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
  zet({ app: "B", sw: "B" });
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

// ---------- ongestempeld: GitHub Pages ----------
// Pages serveert de repo zoals hij is: ?v= en VERSIE blijven de waarde uit
// de repo, ook als de inhoud verandert. Dan moet de service worker online
// alles vers halen, en offline de laatst geziene versie geven.
const PLAATSHOUDER = /^const VERSIE = "(.*)";/m.exec(readFileSync(join(REPO, "sw.js"), "utf8"))[1];

// Wacht tot de nieuwe sw.js (die op "versie" antwoordt) de pagina beheert
// en alleen zijn eigen cache er nog staat.
async function wachtOpNieuweSw(page) {
  const eind = Date.now() + 10000;
  while (await swVersieIn(page) !== PLAATSHOUDER) {
    if (Date.now() > eind) throw new Error("de nieuwe service worker neemt niet over");
    await page.waitForTimeout(100);
  }
  await wachtTot(page, async () => { const n = await caches.keys(); return n.length === 1 && n[0].startsWith("overhoren-2-"); });
}

async function offlineIs(page, context, fouten, verwacht) {
  await context.setOffline(true);
  for (const pad of ["/", "/index.html"]) {
    const res = await page.goto(server.url + pad).catch(e => e);
    assert.ok(!(res instanceof Error) && res.ok(), `offline ${pad}: ${res?.message || res?.status()}`);
    assert.equal(await heel(page, fouten, "offline " + pad), verwacht, "offline niet de laatst geziene versie");
  }
  await context.setOffline(false);
}

test("ongestempeld (GitHub Pages): na een wijziging op de server meteen de nieuwste, nooit een mix, offline de laatst geziene", async () => {
  zet({ app: "A", gestempeld: false });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  assert.equal(await heel(page, fouten, "A"), "A");
  assert.equal(await swVersieIn(page), PLAATSHOUDER, "de testserver stempelt toch");

  for (const v of ["B", "C"]) {
    server.stand.app = v;
    for (const pad of ["/", "/index.html", "/"]) {
      await page.goto(server.url + pad);
      assert.equal(await heel(page, fouten, `${v} via ${pad}`), v, `online niet meteen de nieuwste (${v}) via ${pad}`);
    }
  }
  await offlineIs(page, context, fouten, "C");
  await context.close();
});

test("ongestempeld: van de oude sw.js van main naar de nieuwe, midden in een ronde niet herladen, daarna vers", async () => {
  zet({ app: "A", gestempeld: false, swBron: "oud" });
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  assert.equal(await heel(page, fouten, "A onder de oude sw.js"), "A");
  await page.locator("#lessons .lesson").first().click();
  await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start");
  await wachtOpScherm(page, "scr-quiz");
  const voor = laden.length;

  // de nieuwe sw.js en een nieuwe app staan op Pages
  zet({ app: "B", gestempeld: false, swBron: "nieuw" });
  await zoekUpdate(page);
  await wachtOpNieuweSw(page);
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 0, "herladen midden in de ronde");
  assert.ok(await page.locator("#scr-quiz").isVisible(), "de ronde is weg");
  await page.click("#btn-quit");
  await wachtOpScherm(page, "scr-summary");
  await page.click("#btn-sum-lessons");
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 0, "herladen op Pages: daar is de pagina online al vers");
  assert.equal(await heel(page, fouten, "na de ronde, nog de open pagina"), "A");

  // de volgende keer openen: vers, en daarna elke wijziging meteen
  await open(page);
  assert.equal(await heel(page, fouten, "volgende keer openen"), "B");
  server.stand.app = "C";
  await open(page);
  assert.equal(await heel(page, fouten, "na nog een wijziging"), "C");
  await offlineIs(page, context, fouten, "C");
  await context.close();
});

test("ongestempeld: van de oude sw.js naar de nieuwe door gewoon te openen, zonder mix, daarna vers", async () => {
  zet({ app: "A", gestempeld: false, swBron: "oud" });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  assert.equal(await heel(page, fouten, "A onder de oude sw.js"), "A");

  zet({ app: "B", gestempeld: false, swBron: "nieuw" });
  // de oude sw.js geeft nog een keer zijn bewaarde versie, heel
  await open(page);
  await heel(page, fouten, "eerste keer openen na de wijziging");
  // de browser zoekt bij het openen vanzelf naar een nieuwe sw.js
  await wachtOpNieuweSw(page);
  for (const v of ["B", "C"]) {
    server.stand.app = v;
    await open(page);
    assert.equal(await heel(page, fouten, "onder de nieuwe sw.js: " + v), v);
  }
  await offlineIs(page, context, fouten, "C");
  await context.close();
});

test("ongestempeld: is de pagina te traag, dan de bewaarde pagina met zijn eigen bewaarde bestanden, geen mix", async () => {
  zet({ app: "A", gestempeld: false });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  await open(page);
  assert.equal(await heel(page, fouten, "A"), "A");

  // B staat klaar, maar de pagina komt pas na 4 s (de service worker wacht 3 s)
  zet({ app: "B", gestempeld: false, trageHtml: 4000 });
  await open(page);
  assert.equal(await heel(page, fouten, "trage pagina"), "A", "niet de bewaarde pagina bij een traag netwerk");

  zet({ app: "B", gestempeld: false });
  await open(page);
  assert.equal(await heel(page, fouten, "weer snel"), "B");
  await context.close();
});

test("sw A, server al B: de eerste keer openen is meteen B, en de cache van A houdt zijn eigen A-pagina", async () => {
  // Navigatie is niet stale-while-revalidate (geen oude pagina eerst) en
  // een oude versie schrijft nooit een nieuwe pagina in zijn cache.
  zet({ app: "A", sw: "A" });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  server.stand.app = "B";   // sw.js blijft A
  for (let i = 1; i <= 3; i++) {
    await open(page);
    assert.equal(await heel(page, fouten, `open ${i}`), "B", `open ${i}: niet meteen de verse pagina`);
    await page.waitForTimeout(400);   // ruimte voor een achtergrondschrijfactie
    const bewaard = await page.evaluate(async () => {
      const c = await caches.open("overhoren-2-a111111");
      const res = await c.match("./");
      return res ? await res.text() : null;
    });
    assert.ok(bewaard, "de cache van A heeft geen ./");
    assert.ok(bewaard.includes("?v=" + STEMPEL.A) && !bewaard.includes("?v=" + STEMPEL.B),
      `open ${i}: de cache van A bevat een pagina van een andere versie`);
  }
  await context.close();
});

// ---------- ronde 2 van de keuring ----------

test("ongestempeld: een bestand dat blijft hangen houdt de app niet wit, het komt na de time-out uit de cache", async () => {
  zet({ app: "A", gestempeld: false });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  await open(page);
  assert.equal(await heel(page, fouten, "A"), "A");

  // slechte wifi: de pagina komt, ui.js blijft 10 s hangen
  zet({ app: "A", gestempeld: false, traag: { "/ui.js": 10000 } });
  const t0 = Date.now();
  await page.goto(server.url + "/", { waitUntil: "commit" });
  // de lijsten staan er pas als ui.js en de rest geladen zijn
  await page.locator("#lessons .lesson").first().waitFor({ state: "visible", timeout: 6000 }).catch(() => {});
  const duur = Date.now() - t0;
  assert.ok(duur < 6000, "de app bleef " + duur + " ms wit door een hangende ui.js");
  assert.equal(await heel(page, fouten, "ui.js hangt"), "A");
  zet({ app: "A", gestempeld: false });
  await context.close();
});

test("ongestempeld: katten en fonts komen meteen uit de cache en worden op de achtergrond ververst", async () => {
  zet({ app: "A", gestempeld: false });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  const haal = u => page.evaluate(async u => {
    const t = performance.now(); const r = await fetch(u); await r.arrayBuffer();
    return { ms: performance.now() - t, versie: r.headers.get("X-Testversie"), ok: r.ok };
  }, u);
  const bestanden = ["katten/strepen-goed.webp", "fonts/inter-latin-wght-normal.woff2"];
  // het net is traag en heeft een nieuwe versie (B)
  zet({ app: "B", gestempeld: false, traag: { "/katten/": 2000, "/fonts/": 2000 } });
  for (const u of bestanden) {
    const r = await haal(u);
    assert.ok(r.ok && r.ms < 1000, u + ": niet meteen uit de cache (" + Math.round(r.ms) + " ms)");
    assert.equal(r.versie, "A", u + ": niet de bewaarde versie");
  }
  // na het verversen op de achtergrond staat B in de eigen cache
  await page.waitForTimeout(2600);
  for (const u of bestanden) {
    const r = await haal(u);
    assert.ok(r.ms < 1000, u + ": tweede keer niet meteen (" + Math.round(r.ms) + " ms)");
    assert.equal(r.versie, "B", u + ": niet op de achtergrond ververst");
  }
  assert.deepEqual(fouten, []);
  zet({ app: "A", gestempeld: false });
  await context.close();
});

test("update terwijl het welkom openstaat: pas herladen als het welkom weg is, en dan een keer", async () => {
  zet({ app: "A", sw: "A" });
  const { context, page, fouten, laden } = await nieuweContext();
  await installeer(page);
  // een welkom over het lessenscherm (zoals UI.Welkom, klasse .welkom)
  await page.evaluate(() => document.body.insertAdjacentHTML("beforeend", '<div class="welkom"></div>'));
  const voor = laden.length;
  server.stand.app = "B"; server.stand.sw = "B";
  await zoekUpdate(page);
  await wachtOpSw(page, STEMPEL.B);
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 0, "herladen terwijl het welkom openstaat");
  await page.evaluate(() => document.querySelector(".welkom").remove());
  await page.waitForFunction(() => document.documentElement.dataset.testversie === "B", null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1000);
  assert.equal(laden.length - voor, 1, "niet precies een keer herladen na het welkom: " + laden.slice(voor).join(", "));
  assert.equal(await heel(page, fouten, "na het welkom"), "B");
  await context.close();
});

test("ongestempeld: de bewaarde pagina krijgt zijn bewaarde bestanden, ook na een herstart van de service worker", async () => {
  zet({ app: "A", gestempeld: false });
  const { context, page, fouten } = await nieuweContext();
  await installeer(page);
  await open(page);
  // B staat klaar, de pagina is te traag: de bewaarde A-pagina
  zet({ app: "B", gestempeld: false, trageHtml: 4000 });
  await open(page);
  assert.equal(await heel(page, fouten, "trage pagina"), "A");
  zet({ app: "B", gestempeld: false });
  // de service worker stopt tussendoor (in Chromium na te bootsen); zijn
  // geheugen is dan leeg
  if (browser.browserType().name() === "chromium") {
    const cdp = await context.newCDPSession(page);
    await cdp.send("ServiceWorker.enable");
    await cdp.send("ServiceWorker.stopAllWorkers");
    await page.waitForTimeout(300);
  }
  // de pagina vraagt nog een keer zijn eigen ui.js en ds.css
  const r = await page.evaluate(async () => {
    const js = document.querySelector('script[src^="ui.js"]').src, css = document.querySelector('link[href^="ds.css"]').href;
    return { js: await (await fetch(js)).text(), css: await (await fetch(css)).text() };
  });
  assert.ok(r.js.includes("testVersieA") && !r.js.includes("testVersieB"), "de bewaarde pagina krijgt een andere ui.js");
  assert.ok(r.css.includes('--testversie: "A"'), "de bewaarde pagina krijgt een andere ds.css");
  await context.close();
});

test("installatie: lukt de pagina niet, dan installeert de service worker niet half, en de volgende keer wel heel", async () => {
  // verzoek 1 is het openen, verzoek 2 de installatie: die faalt
  zet({ app: "A", sw: "A", faalPagina: [2] });
  const { context, page, fouten } = await nieuweContext();
  await page.goto(server.url + "/");
  await wachtOpScherm(page, "scr-lessons");
  await page.waitForTimeout(1500);
  // de volgende keer openen, online
  await page.goto(server.url + "/");
  await wachtOpScherm(page, "scr-lessons");
  await wachtTot(page, async () => {
    if (!navigator.serviceWorker.controller) return false;
    const n = await caches.keys(); if (n.length !== 1) return false;
    return !!(await (await caches.open(n[0])).match("./"));
  }).catch(() => {});
  await context.setOffline(true);
  const res = await page.goto(server.url + "/").catch(e => e);
  assert.ok(!(res instanceof Error) && res.ok(), "offline geen app na een mislukte installatie: " + (res?.message || res?.status()));
  assert.equal(await heel(page, fouten.filter(f => !f.includes("HTTP 500")), "offline"), "A");
  await context.close();
});

test("een vreemde cache (van een andere versie of een oude service worker) wordt nooit gebruikt", async () => {
  zet({ app: "A", sw: "A" });
  const { context, page } = await nieuweContext();
  await installeer(page);
  // een cache die er niet hoort: een oude service worker die hem na het
  // opruimen opnieuw aanmaakte. Met een bestand dat de eigen cache niet heeft.
  await page.evaluate(async () => {
    const c = await caches.open("overhoren-vreemd");
    await c.put(new URL("icons/apple-touch-icon.png", location.href).href, new Response("vreemd", { headers: { "Content-Type": "text/plain" } }));
  });
  await context.setOffline(true);
  const r = await page.evaluate(async () => {
    try { return await (await fetch("icons/apple-touch-icon.png")).text(); } catch (e) { return "netwerkfout"; }
  });
  assert.notEqual(r, "vreemd", "de service worker gaf een bestand uit een vreemde cache");
  await context.close();
});

test("de ongestempelde waarde in sw.js is gelijk aan VERSIE in sw.js en de ?v= in index.html en designsystem.html", async () => {
  const sw = readFileSync(join(REPO, "sw.js"), "utf8");
  const regel = /^const NIET_GESTEMPELD = \[(.*)\];/m.exec(sw);
  assert.ok(regel, "geen NIET_GESTEMPELD in sw.js");
  const waarden = regel[1].split(",").map(d => d.trim().split("+").map(x => JSON.parse(x.trim())).join(""));
  const versie = /^const VERSIE = "(.*)";/m.exec(sw)[1];
  assert.ok(waarden.includes(versie), "VERSIE " + versie + " staat niet in NIET_GESTEMPELD " + waarden.join(", "));
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  const stempels = new Set([...html.matchAll(/\?v=([A-Za-z0-9]+)/g)].map(m => m[1]));
  assert.deepEqual([...stempels], [versie], "index.html heeft een andere ?v= dan VERSIE");
  const ds = readFileSync(join(REPO, "designsystem.html"), "utf8");
  for (const m of ds.matchAll(/\?v=([A-Za-z0-9]+)/g)) assert.ok(waarden.includes(m[1]), "designsystem.html heeft ?v=" + m[1] + ", niet ongestempeld");
});
