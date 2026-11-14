// Het gedrag van de katten door een ronde heen, model "de kat is een
// maatje": elke ronde een andere kat, binnen de ronde dezelfde, niets te
// verdienen. Aan het eind zegt de kat gedag. Vlekkeloze rondes achter
// elkaar (confetti), geen confetti bij een fout of "doe later", wisselen
// van oefenaar, de stevige ronde rond de grens van de helft, de toon van
// alle kattekst, oude data na de update, offline en reduced motion op
// elk moment.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm, uitMenu } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const lees = f => readFileSync(join(REPO, f), "utf8");
const ALLE = ["strepen", "tuxedo", "lapjes", "sokjes", "stippen", "rodestreep"];
const LASTIG = naam => `Dat was een stevige ronde. Die woorden krijg je straks nog een keer. Dag ${naam}.`;
const GEWOON = naam => `Dat was de ronde. Dag ${naam}.`;
const VLEKKELOOS = naam => `Alles in één keer goed. Dag ${naam}.`;
const GESTOPT = naam => `Even pauze. Wat je deed, telt al mee. Dag ${naam}.`;
// zinnen die niet bij de toon passen: verdrietig, schuld, of "kom terug"
const VERBODEN = /\b(jammer|helaas|verdrietig|teleurgesteld|sorry|balen|spijt|huil\w*|zonde|tot snel|we missen|mis je)\b|\bkom\b[^.!?]*\bterug\b|kom je terug/i;

// ---------- zonder browser ----------
function laad({ opslag = {} } = {}) {
  const store = Object.assign({}, opslag);
  const ctx = vm.createContext({
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    __r: null,
    fetch: async pad => { const buf = readFileSync(join(REPO, pad)); return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), blob: async () => ({ pad }) }; }
  });
  ctx.window = ctx;
  ctx.matchMedia = () => ({ matches: true });
  vm.runInContext("const __echt = Math.random; Math.random = () => (globalThis.__r ? globalThis.__r() : __echt());", ctx);
  vm.runInContext(lees("ui.js"), ctx);
  vm.runInContext(lees("celebrate.js"), ctx);
  return { C: ctx.Celebrate, store, ctx };
}
const json = x => JSON.parse(JSON.stringify(x));
// eenvoudige, herhaalbare toevalsgenerator (geen echte Math.random in de test)
function lcg(zaad) { let s = zaad >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test("geen opslag per oefenaar: een kat kiezen schrijft alleen de ene sleutel en laat oude data byte voor byte staan", () => {
  const oud = {
    "overhoor:cats:pia": JSON.stringify({ "cats/gewoon-sok.svg": { aantal: 4, eerst: 1, laatst: 9 }, "cats/zeldzaam-grumpy.jpg": { aantal: 1, eerst: 5, laatst: 5 } }),
    "overhoor:cats:tom": JSON.stringify({ "cats/gewoon-dut.svg": { aantal: 1, eerst: 2, laatst: 2 } }),
    "overhoor:cats": JSON.stringify({ x: 1 }),
    "overhoor:katten:pia": JSON.stringify({ verdiend: ["strepen", "tuxedo"], huidig: "tuxedo", start: "strepen", bijgewerkt: 1 })
  };
  const { C, store } = laad({ opslag: oud });
  for (let i = 0; i < 20; i++) { C.nieuweRonde(); C.celebrate({}); C.gedag("vlekkeloos", "Pia"); }
  for (const k in oud) assert.equal(store[k], oud[k], k + " is aangeraakt");
  assert.deepEqual(Object.keys(store).filter(k => !(k in oud)), ["overhoor:kat:vorige"], "er wordt meer weggeschreven dan die ene sleutel");
  // de oude huidige kat telt niet als vorige: niets wordt gelezen uit de oude opslag
  assert.equal(laad({ opslag: { "overhoor:katten:pia": oud["overhoor:katten:pia"] } }).C.vorige(), null);
});

test("toon: geen enkele kattekst in de code is verdrietig, zegt 'kom terug' of roept", async () => {
  const { C } = laad();
  await C.laadCatalogus();
  const teksten = [...Object.values(C.ZEGT), ...Object.values(C.GEDAG)].map(z => z.tekst);
  teksten.push(...Object.values(C.HOUDING), ...C.KATTEN.flatMap(k => [k.naam, k.karakter]));
  for (const soort of ["vlekkeloos", "gewoon", "lastig", "gestopt"]) teksten.push(C.gedag(soort, "Pia").tekst);
  for (const id of ALLE) for (const s of C.STANDEN) teksten.push(C.beeld(id, s).alt);
  // alle tekst rond de katten in index.html: Celebrate-, kat- en kat-regels
  const html = lees("index.html").split("\n").filter(r => /kat|Kat|Celebrate|size-kans|setVerdict|fb-verdict/.test(r));
  for (const r of html) for (const m of r.matchAll(/(['"])((?:(?!\1).){4,})\1/g)) teksten.push(m[2]);
  teksten.push(lees("ui.js").split("// --- Spraak")[1].split("// --- hydrateIcons")[0]);
  teksten.push(lees("celebrate.js"));
  for (const t of teksten) assert.doesNotMatch(t, VERBODEN, "tekst past niet bij de toon: " + t);
  // geen uitroeptekens in wat de kat zegt
  for (const z of [...Object.values(C.ZEGT), ...Object.values(C.GEDAG)]) assert.doesNotMatch(z.tekst, /!/, z.tekst);
  assert.ok(teksten.some(t => /Dat was een stevige ronde\./.test(t)), "de zin van de stevige ronde is niet gevonden, controle mist hem");
  assert.ok(teksten.some(t => /Hij komt straks nog een keer\./.test(t)), "de zin bij fout is niet gevonden, controle mist hem");
  assert.ok(teksten.some(t => /Alles in één keer goed\./.test(t)), "de zin bij vlekkeloos is niet gevonden");
});

// ---------- in de browser ----------
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// zaai: { sleutel: waarde } eenmalig in localStorage voor de app start
async function open({ thema = "light", reduced = false, zaai = {}, sw = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: thema,
    serviceWorkers: sw ? "allow" : "block", locale: "nl-NL", reducedMotion: reduced ? "reduce" : "no-preference" });
  const extern = await schermNetwerkAf(context);
  await context.addInitScript(zaai => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    for (const k in zaai) localStorage.setItem(k, zaai[k]);
  }, zaai);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten, extern };
}
// de kat van de laatst begonnen ronde
const vorige = page => page.evaluate(() => JSON.parse(localStorage.getItem("overhoor:kat:vorige")));
const MAP = "katten/clips/";
// de kat op de rand en welk beeld hij toont (de speler zet data-kat en data-beeld)
const katOp = async (page, sel) => ({ kat: await page.locator(sel).getAttribute("data-kat"), beeld: await page.locator(sel).getAttribute("data-beeld") });
// stand goed of bijna: de clip of al het eindbeeld
const inStand = (b, stand) => b.beeld === stand || b.beeld === stand + "-eind";
const alleSleutels = page => page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])));

// het goede antwoord en een sleutel per woord, zodat een herhaling herkend wordt
async function vraag(page) {
  return page.evaluate(() => {
    const prompt = document.getElementById("q-prompt").textContent.trim();
    const label = document.getElementById("q-input-label").textContent.trim();
    for (const l of window.WORDLISTS) for (const it of l.items) {
      if (it.word === prompt && label.startsWith(l.to || "Definitie")) return { sleutel: it.word, a: String(it.def).split(/\s*[\/,;]\s*|\s+of\s+/)[0].trim(), cls: it.cls || null, richting: "wd" };
      if (it.def === prompt) return { sleutel: it.word, a: it.word, cls: it.cls || null, richting: "dw" };
    }
    return null;
  });
}
async function geef(page, antwoord, cls) {
  const keuzes = page.locator("#q-classes .choice");
  if (await keuzes.count()) {
    const doel = cls ? keuzes.filter({ hasText: cls }).first() : keuzes.first();
    await (await doel.count() ? doel : keuzes.first()).click();
  }
  await page.fill("#q-input", antwoord);
  await page.click("#btn-check");
}
async function kiesLes(page, grootte) {
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  if (grootte) await page.click(`#size-seg button[data-size="${grootte}"]`);
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
}
// Speelt een hele ronde. fout: zoveel verschillende woorden bij de eerste
// keer fout, daarna goed. later: bij de eerste vraag eenmaal "doe later".
async function speelRonde(page, { fout = 0, later = false, grootte = null, bijMoment = null } = {}) {
  await kiesLes(page, grootte);
  const gehad = new Set();
  let nogFout = fout, nogLater = later;
  for (let i = 0; i < 300; i++) {
    if (await page.locator("#scr-summary").isVisible()) break;
    if (nogLater) {
      assert.ok(await page.locator("#btn-later").isVisible(), "knop doe later ontbreekt");
      await page.click("#btn-later"); nogLater = false; continue;
    }
    const v = await vraag(page);
    if (!v) throw new Error("antwoord niet gevonden in WORDLISTS");
    const nieuw = !gehad.has(v.sleutel);
    gehad.add(v.sleutel);
    const goed = !(nieuw && nogFout > 0);
    if (!goed) nogFout--;
    await geef(page, goed ? v.a : "qqq zzz", goed ? v.cls : null);
    if (await page.locator("#fb-assess").isVisible()) await page.click(goed ? "#btn-assess-yes" : "#btn-assess-no");
    await page.locator("#btn-next").waitFor({ state: "visible" });
    if (bijMoment) await bijMoment(goed ? "goed" : "fout");
    await page.click("#btn-next");
    await page.waitForFunction(() => !document.getElementById("scr-summary").hidden || document.getElementById("btn-next").hidden);
  }
  await wachtOpScherm(page, "scr-summary");
  assert.equal(nogFout, 0, "ronde was te kort voor het aantal fouten");
  // de driver zelf controleren: het aantal in een keer goed klopt met de opzet
  const n = Number(await page.locator("#sum-n").textContent());
  assert.equal(Number((await page.locator("#sum-first").textContent()).trim()), n - fout, "aantal in een keer goed klopt niet met de opzet");
  return n;
}
async function naarLessen(page) { await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons"); }
async function keur(page, naam, problemen, fouten) {
  await page.evaluate(rondAnimatiesAf);
  const o = await page.evaluate(overloopMeting);
  if (o.overloop) problemen.push(`[${naam}] overloop: ${o.boosdoeners.join(", ")}`);
  const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
  for (const f of c.fouten) problemen.push(`[${naam}] contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
  for (const f of c.nietMeetbaar) problemen.push(`[${naam}] contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
  for (const f of fouten.splice(0)) problemen.push(`[${naam}] ${f}`);
}
// alle zichtbare tekst rond katten, voor de toontoets
async function kattekst(page) {
  return page.evaluate(() => [...document.querySelectorAll(".kat-rand, #fb-verdict, #sum-title, .size-kans")]
    .filter(e => e.checkVisibility()).map(e => e.textContent.trim()).filter(Boolean));
}
const FRANS_ID = (() => { const c = vm.createContext({}); c.window = c; vm.runInContext(lees("lists.js"), c); return c.WORDLISTS.find(l => l.title === "Arrêt Apprendre").id; })();
const OUD = JSON.stringify({ "cats/gewoon-sok.svg": { aantal: 3, eerst: 1, laatst: 2 }, "cats/bijzonder-cool.svg": { aantal: 1, eerst: 2, laatst: 2 } });
const OUD_KATTEN = JSON.stringify({ verdiend: ["strepen", "tuxedo", "lapjes"], huidig: "lapjes", start: "strepen", bijgewerkt: 1 });
// na een ronde: niets per oefenaar geschreven
const geenPerOefenaar = async page => assert.deepEqual(await page.evaluate(() => Object.keys(localStorage).filter(k => /^overhoor:katten?:(?!vorige$)/.test(k))), [], "katten per oefenaar opgeslagen");

test("vlekkeloos achter elkaar: elke ronde confetti en de kat van die ronde zegt gedag, nooit twee keer dezelfde", async () => {
  const { context, page, fouten } = await open();
  const gezien = [];
  for (let ronde = 1; ronde <= 4; ronde++) {
    await speelRonde(page);
    const kat = await vorige(page);
    assert.ok(ALLE.includes(kat), "geen kat in ronde " + ronde);
    if (gezien.length) assert.notEqual(kat, gezien[gezien.length - 1], `ronde ${ronde}: dezelfde kat als de vorige ronde`);
    gezien.push(kat);
    assert.ok(await page.locator("canvas.fx-canvas").count() > 0, "geen confetti in ronde " + ronde);
    assert.equal((await page.locator("#sum-title").textContent()).trim(), "Ronde klaar");
    assert.equal((await page.locator("#sum-kat .spraak").textContent()).trim(), VLEKKELOOS("Pia"));
    const b = await katOp(page, "#sum-kat .kat");
    assert.ok(b.kat === kat && inStand(b, "goed"), "niet de kat van deze ronde in goed-stand: " + JSON.stringify(b));
    assert.equal(await page.locator(".kat-beloning, #scr-summary svg.icon").count(), 0, "beloningskaart of beker");
    await page.waitForFunction(() => !document.querySelector("canvas.fx-canvas"), null, { timeout: 6000 });
    await naarLessen(page);
  }
  // home belooft geen kat, alleen confetti
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  assert.match(await page.locator("#size-hint").textContent(), /confetti/);
  assert.doesNotMatch(await page.locator("#size-hint").textContent(), /kat/i);
  await geenPerOefenaar(page);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("gewone ronde: een fout bij de eerste poging, de kat zegt gewoon gedag, geen confetti", async () => {
  const { context, page, fouten } = await open();
  await speelRonde(page, { fout: 1 });
  assert.equal((await page.locator("#sum-title").textContent()).trim(), "Ronde klaar");
  assert.equal((await page.locator("#sum-kat .spraak").textContent()).trim(), GEWOON("Pia"));
  const b = await katOp(page, "#sum-kat .kat");
  assert.ok(b.kat === await vorige(page) && inStand(b, "goed"), JSON.stringify(b));
  assert.equal(await page.locator("canvas.fx-canvas").count(), 0, "confetti na een ronde met een fout");
  await geenPerOefenaar(page);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("geen confetti: alles goed maar een keer 'doe later', de kat zegt gewoon gedag", async () => {
  const { context, page, fouten } = await open();
  await speelRonde(page, { later: true });
  assert.equal((await page.locator("#sum-title").textContent()).trim(), "Ronde klaar");
  assert.equal(await page.locator("canvas.fx-canvas").count(), 0, "confetti na overslaan");
  assert.equal((await page.locator("#sum-kat .spraak").textContent()).trim(), GEWOON("Pia"));
  await geenPerOefenaar(page);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("oefenaar wisselen: geen katten per oefenaar, de volgende ronde heeft gewoon een andere kat", async () => {
  const { context, page, fouten } = await open({ zaai: { "overhoor:katten:pia": OUD_KATTEN } });
  const wissel = async naam => {
    await page.click("#btn-learner"); await page.fill("#learner-name", naam); await page.click("#btn-learner-save");
    await page.locator("#learner-view").waitFor({ state: "visible" });
  };
  await speelRonde(page);
  const pia = await vorige(page);
  await naarLessen(page);
  await wissel("Tom");
  await kiesLes(page);
  const v = await vraag(page); await geef(page, v.a, v.cls);
  if (await page.locator("#fb-assess").isVisible()) await page.click("#btn-assess-yes");
  await page.locator("#q-kat .kat").waitFor();
  const tom = (await katOp(page, "#q-kat .kat")).kat;
  assert.ok(ALLE.includes(tom));
  assert.notEqual(tom, pia, "na het wisselen dezelfde kat als de ronde ervoor");
  assert.equal(await vorige(page), tom);
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:katten:pia")), OUD_KATTEN, "oude kattendata van Pia is aangeraakt");
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => /^overhoor:katten?:(?!vorige$)/.test(k)).join()), "overhoor:katten:pia");
  assert.deepEqual(fouten, []);
  await context.close();
});

// elk geval in een eigen, verse context: na eerdere rondes kiest de app
// soms minder woorden, dan klopt de lengte van de ronde niet meer
for (const g of [
  { grootte: "10", fout: 5, kat: false },   // precies de helft
  { grootte: "10", fout: 6, kat: true },
  { grootte: "15", fout: 7, kat: false },   // net onder de helft
  { grootte: "15", fout: 8, kat: true }
]) {
  test(`stevige ronde: ${g.fout} van ${g.grootte} fout bij de eerste poging ${g.kat ? "geeft de bijna-kat met die zin" : "is een gewone ronde"}`, async () => {
    const zaai = {};
    // een verse ronde heeft hooguit 10 nieuwe woorden; voor 15 zetten we
    // er 5 klaar om te herhalen
    if (g.grootte === "15") zaai["overhoor:progress:pia:" + FRANS_ID] = JSON.stringify({ items: Object.fromEntries([60, 61, 62, 63, 64].map(i =>
      [i, { box: 1, lapses: 0, seen: 1, due: 0, partWrong: { word: 0, def: 0, cls: 0 }, dirWrong: { wd: 0, dw: 0 } }])), sessions: [], updated: 1 });
    const { context, page, fouten } = await open({ zaai });
    const n = await speelRonde(page, { fout: g.fout, grootte: g.grootte });
    assert.equal(n, Number(g.grootte), "ronde heeft niet de gekozen lengte");
    const zin = (await page.locator("#sum-kat .spraak").textContent()).trim();
    assert.equal(zin, g.kat ? LASTIG("Pia") : GEWOON("Pia"), `${g.fout} van ${n} fout: verkeerde zin`);
    const b = await katOp(page, "#sum-kat .kat");
    assert.ok(b.kat === await vorige(page) && inStand(b, g.kat ? "bijna" : "goed"), "niet de kat van deze ronde in de goede stand: " + JSON.stringify(b));
    assert.equal(await page.locator("#sum-kat .kat").getAttribute("alt"), "");
    assert.equal(await page.locator("canvas.fx-canvas").count(), 0, "confetti in een ronde met fouten");
    await geenPerOefenaar(page);
    assert.deepEqual(fouten, []);
    await context.close();
  });
}

test("oude voortgang van woorden, lijsten en oefenaars blijft na de update staan en werkt", async () => {
  const id = FRANS_ID;
  const nu = Date.now();
  const eigenLijst = [{ id: "eigen-1", title: "Mijn toetslijst", subject: "Engels", from: "Engels", to: "Nederlands", items: [{ word: "apple", def: "appel" }, { word: "pear", def: "peer" }] }];
  const voortgang = { items: { 0: { box: 3, lapses: 2, seen: 5, due: nu + 864e5, partWrong: { word: 0, def: 2, cls: 0 }, dirWrong: { wd: 2, dw: 0 } } },
    sessions: [{ date: nu - 864e5, n: 15, first: 12, ms: 300000, stopped: false }], updated: nu - 864e5 };
  const zaai = {
    "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia", "Tom"]),
    "overhoor:lists": JSON.stringify(eigenLijst),
    ["overhoor:progress:pia:" + id]: JSON.stringify(voortgang),
    ["overhoor:progress:tom:" + id]: JSON.stringify(voortgang),
    "overhoor:cats:pia": OUD, "overhoor:cats:tom": OUD, "overhoor:katten:pia": OUD_KATTEN
  };
  const { context, page, fouten } = await open({ zaai });
  const na = await alleSleutels(page);
  for (const k in zaai) assert.equal(na[k], zaai[k], k + " veranderd door alleen het openen");
  assert.ok(await page.locator(".lesson", { hasText: "Mijn toetslijst" }).count() > 0, "eigen lijst weg");
  // Voortgang toont het oude woord in box 3 met 2 keer fout
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  const rij = await page.locator("#progress-body tr").first().evaluate(r => [...r.cells].map(c => c.textContent.trim()));
  assert.equal(rij[0], "le français"); assert.match(rij[1], /moeilijk/); assert.match(rij[1], /●●●○/); assert.equal(rij[2], "2");
  await page.click("#btn-progress-back"); await page.click("#btn-home-back"); await wachtOpScherm(page, "scr-lessons");
  // Rapport kent de oude ronde
  await uitMenu(page, "#btn-report"); await wachtOpScherm(page, "scr-report");
  assert.match(await page.locator("#report-body").textContent(), /12\/15/);
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  // na een ronde: oude woordtoestand en oude ronde staan er nog, de nieuwe komt erbij
  await speelRonde(page);
  const p = JSON.parse(await page.evaluate(k => localStorage.getItem(k), "overhoor:progress:pia:" + id));
  assert.equal(p.sessions.length, 2); assert.deepEqual(p.sessions[0], voortgang.sessions[0]);
  assert.equal(p.items[0].lapses, 2, "oude fouttelling van een woord is weg");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), "overhoor:progress:tom:" + id), zaai["overhoor:progress:tom:" + id]);
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:lists")), zaai["overhoor:lists"]);
  // oude kattendata blijft na een ronde ongemoeid staan
  for (const k of ["overhoor:cats:pia", "overhoor:cats:tom", "overhoor:katten:pia"]) assert.equal(await page.evaluate(k => localStorage.getItem(k), k), zaai[k], k + " is aangeraakt");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("offline: alle dertig kattenbeelden en katten.json staan in de cache van de service worker en laden zonder netwerk", async () => {
  const { context, page, fouten } = await open({ sw: true });
  const urls = ALLE.flatMap(id => ["rust", "goed", "goed-eind", "bijna", "bijna-eind"].map(s => `${MAP}${id}-${s}.webp`));
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForFunction(async urls => {
    for (const u of urls) if (!(await caches.match(u))) return false;
    return true;
  }, [...urls, MAP + "katten.json"], { timeout: 10000, polling: 200 });
  if (!(await page.evaluate(() => !!navigator.serviceWorker.controller))) await page.reload();
  assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), "service worker neemt de pagina niet over");

  await context.setOffline(true);
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  // elk beeld echt laden en tekenen, zonder netwerk
  const r = await page.evaluate(async urls => Promise.all(urls.map(u => new Promise(ok => {
    const i = new Image(); i.onload = () => ok({ u, w: i.naturalWidth, h: i.naturalHeight }); i.onerror = () => ok({ u, w: 0, h: 0 }); i.src = u;
  }))), urls);
  for (const x of r) { assert.ok(x.w > 0, x.u + " laadt niet offline"); assert.equal(x.h, 480, x.u); }
  const types = await page.evaluate(async urls => Promise.all(urls.map(async u => { const res = await fetch(u); return res.status + " " + res.headers.get("content-type"); })), urls);
  for (const t of types) assert.equal(t, "200 image/webp");
  assert.equal(await page.evaluate(async u => (await (await fetch(u)).json()).fps, MAP + "katten.json"), 6, "katten.json niet offline");
  // en in de app: een ronde offline, de kat op de rand van de vraag en van de samenvatting
  await speelRonde(page);
  await page.waitForFunction(() => { const i = document.querySelector("#sum-kat .kat"); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
  const b = await katOp(page, "#sum-kat .kat");
  assert.ok(b.kat === await vorige(page) && inStand(b, "goed"), JSON.stringify(b));
  // de clip speelde ook offline, en eindigt op het eindbeeld
  await page.waitForFunction(() => document.querySelector("#sum-kat .kat").dataset.beeld === "goed-eind", null, { timeout: 4000 });
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- 360px, licht en donker, met en zonder reduced motion: elk kattenmoment ----------
for (const thema of THEMAS) for (const reduced of [false, true]) {
  test(`elk kattenmoment (${thema}, 360px, reduced motion ${reduced ? "aan" : "uit"}): contrast, overloop, toon${reduced ? ", geen beweging" : ""}`, async () => {
    const { context, page, fouten } = await open({ thema, reduced });
    const problemen = [], teksten = [];
    const stil = async naam => {
      if (!reduced) return;
      await page.waitForTimeout(50);
      const n = await page.evaluate(() => [...document.querySelectorAll(".kat, .kat-rand, .spraak, .verdict")]
        .filter(e => e.checkVisibility()).flatMap(e => e.getAnimations().map(a => (e.id || e.className) + ":" + (a.animationName || a.constructor.name))));
      if (n.length) problemen.push(`[${naam}] beweegt bij reduced motion: ${n.join(", ")}`);
      if (await page.locator("canvas.fx-canvas").count()) problemen.push(`[${naam}] confetti bij reduced motion`);
    };
    const moment = async naam => {
      await page.locator(".kat").first().waitFor({ state: "attached" });
      await page.waitForFunction(() => [...document.querySelectorAll(".kat")].filter(i => i.checkVisibility()).every(i => i.complete && i.naturalWidth > 0), null, { timeout: 5000 });
      await stil(naam);
      teksten.push(...await kattekst(page));
      await keur(page, naam, problemen, fouten);
    };

    // twijfelgeval: oordeel "Bijna?" in de kaart, de kat kijkt nog mee in rust
    await kiesLes(page);
    const kat1 = await vorige(page);
    let twijfel = false;
    for (let i = 0; i < 15 && !twijfel; i++) {
      const v = await vraag(page);
      if (v.richting === "wd" && v.a.length > 3) {
        await geef(page, v.a.slice(0, -1) + (v.a.endsWith("x") ? "y" : "x"), v.cls);
        if (await page.locator("#fb-assess").isVisible()) {
          twijfel = true;
          assert.deepEqual(await katOp(page, "#q-kat .kat"), { kat: kat1, beeld: "rust" });
          assert.equal((await page.locator("#scr-quiz .q-card #fb-verdict.verdict.maybe").textContent()).trim(), "Bijna?");
          assert.equal((await page.locator("#q-kat .spraak").textContent()).trim(), "Ik kijk mee.");
          await moment("twijfel");
          await page.click("#btn-assess-no");
        }
      } else await geef(page, v.a, v.cls);
      if (await page.locator("#fb-assess").isVisible()) await page.click("#btn-assess-yes");
      if (!twijfel) { await page.locator("#btn-next").waitFor(); await page.click("#btn-next"); await page.locator("#btn-check").waitFor(); }
    }
    assert.ok(twijfel, "geen twijfelgeval kunnen maken in vijftien vragen");
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    assert.equal((await page.locator("#sum-title").textContent()).trim(), "Ronde gestopt");
    // zelf gestopt: een eigen gedag, tenzij het een stevige ronde was
    assert.ok([GESTOPT("Pia"), LASTIG("Pia")].includes((await page.locator("#sum-kat .spraak").textContent()).trim()), "gestopte ronde zonder eigen gedag");
    await moment("gestopt na twijfel");
    await naarLessen(page);

    // goed, fout en lastige ronde in een ronde van 10 met 6 fout
    await speelRonde(page, { grootte: "10", fout: 6, bijMoment: async soort => {
      if (!teksten.includes("__" + soort)) { teksten.push("__" + soort); await moment(soort); }
    } });
    const kat2 = await vorige(page);
    assert.notEqual(kat2, kat1, "twee rondes achter elkaar dezelfde kat");
    assert.equal((await page.locator("#sum-kat .spraak").textContent()).trim(), LASTIG("Pia"));
    await moment("lastige ronde");
    await naarLessen(page);

    // vlekkeloos, twee keer: de kat van die ronde zegt gedag
    await speelRonde(page);
    await moment("vlekkeloos");
    await naarLessen(page);
    await speelRonde(page);
    await moment("vlekkeloos, volgende ronde");

    for (const t of teksten.filter(t => !t.startsWith("__"))) if (VERBODEN.test(t)) problemen.push("toon: " + t);
    await context.close();
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });
}

