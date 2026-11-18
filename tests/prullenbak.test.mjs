// Prullenbak in de app. Verwijderen gaat zonder vraag naar de prullenbak
// (eigen lijst: weg en bijgewerkt; klaslijst: een regel in
// overhoor:klas-weg), de voortgang blijft. Onderin een balk met Ongedaan
// maken (8 s, pauzeert bij muis en focus). In het menu een regel
// Prullenbak met een teller. Het scherm Prullenbak: terugzetten, en bij
// eigen lijsten definitief verwijderen (grafsteen, opruimen), met een
// vraag in de kaart. Na 30 dagen wordt een lijst bij het laden een
// grafsteen. De sync kiest per lijst op stand en brengt een verwijderde
// lijst niet terug; de push stuurt klasWeg en de grafstenen mee.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm, openMenu, uitMenu } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const DAG = 24 * 60 * 60 * 1000;
const LKEY = "overhoor:lists", KWKEY = "overhoor:klas-weg", CKEY = "overhoor:current";
const P = id => "overhoor:progress:pia:" + id;

const WL = (() => {
  const c = vm.createContext({}); c.window = c;
  vm.runInContext(readFileSync(join(REPO, "lists.js"), "utf8"), c);
  return JSON.parse(JSON.stringify(c.WORDLISTS));
})();
const KLAS = WL[0];

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT" };
const eigen = (id, title, extra = {}) => ({ id, title, subject: "Duits", mode: "translate", from: "Duits", to: "Nederlands", directions: ["wd"], added: 1000,
  items: [{ word: "der Hund", def: "de hond" }, { word: "die Katze", def: "de kat" }, { word: "das Haus", def: "het huis" }], ...extra });
const voortgang = () => ({ items: { 0: { box: 1, seen: 1, due: 0, correct: 1, wrong: 0, lapses: 0, streak: 1, last: 1, dirWrong: {}, partWrong: {} } },
  sessions: [{ date: 1, n: 3, first: 2, ms: 60000 }], updated: 5 });

// zaai: eenmalig in localStorage (als JSON). sync: antwoord op GET /sync.
// Elke vraag van de browser (confirm) wordt geteld en geweigerd.
async function open({ zaai = {}, sync = null, puts = [], thema = "light", breedte = 360, reducedMotion = "no-preference", hoogte = 780 } = {}) {
  const context = await browser.newContext({ viewport: { width: breedte, height: hoogte }, colorScheme: thema, reducedMotion, serviceWorkers: "block", locale: "nl-NL" });
  await schermNetwerkAf(context);
  const alles = Object.assign({ "overhoor:learner": "Pia", "overhoor:learners": ["Pia"], "overhoor:klas": true }, zaai);
  if (sync) alles["overhoor:app-secret"] = "test";
  await context.addInitScript(zaai => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    for (const k in zaai) localStorage.setItem(k, JSON.stringify(zaai[k]));
  }, alles);
  let opgehaald = 0;
  if (sync) {
    await context.route(/workers\.dev\/sync\//, route => {
      const req = route.request();
      if (req.method() === "PUT") puts.push(JSON.parse(req.postData()));
      else opgehaald++;
      const body = req.method() === "PUT" ? {} : sync;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: CORS });
    });
  }
  const page = await context.newPage();
  const fouten = volgFouten(page);
  page.on("dialog", d => { fouten.push("vraag van de browser: " + d.message()); d.dismiss(); });
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  if (sync) {
    for (let i = 0; i < 60 && !opgehaald; i++) await page.waitForTimeout(50);
    assert.ok(opgehaald, "de app haalde niets op");
    await page.waitForTimeout(300);
  }
  return { context, page, fouten };
}

const lees = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
const lijstIds = page => page.evaluate(() => [...document.querySelectorAll("#lessons .lesson")].map(b => b.dataset.id));
const zichtbaar = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);
const focusId = page => page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.dataset.actie || document.activeElement.tagName));
const eigenUit = (rauw, id) => rauw.find(l => l && l.id === id);

async function verwijder(page, id) {
  await page.locator(`#lessons .lesson[data-id="${id}"]`).click();
  await wachtOpScherm(page, "scr-home");
  await page.click("#btn-delete-list");
  await wachtOpScherm(page, "scr-lessons");
}
async function naarPrullenbak(page) {
  await uitMenu(page, "#btn-prullenbak");
  await wachtOpScherm(page, "scr-prullenbak");
}
const kaarten = page => page.locator("#prullenbak-body .prullen").evaluateAll(ks => ks.map(k => ({
  id: k.dataset.id, vak: k.querySelector(".eyebrow")?.textContent || "", titel: k.querySelector("h2").textContent,
  regel: k.querySelector(".muted").textContent, knoppen: [...k.querySelectorAll("button")].map(b => b.textContent.trim()) })));

// ---------- verwijderen ----------

test("verwijderen: een eigen lijst gaat zonder vraag naar de prullenbak, met weg en bijgewerkt, en de voortgang blijft", async () => {
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Mijn lijst"), eigen("custom-2", "Andere lijst")], [P("custom-1")]: voortgang() } });
  const voor = Date.now();
  await verwijder(page, "custom-1");
  const na = Date.now();
  const l = eigenUit(await lees(page, LKEY), "custom-1");
  assert.ok(l.weg >= voor && l.weg <= na, "weg is niet nu: " + l.weg);
  assert.equal(l.bijgewerkt, l.weg, "bijgewerkt is niet gelijk aan weg");
  assert.equal(l.items.length, 3, "de woorden zijn weg");
  assert.equal(eigenUit(await lees(page, LKEY), "custom-2").weg, undefined, "de andere lijst is ook verwijderd");
  assert.deepEqual(await lees(page, P("custom-1")), voortgang(), "de voortgang is weg of veranderd");
  assert.ok(!(await lijstIds(page)).includes("custom-1"), "de lijst staat nog op het startscherm");
  assert.notEqual(await lees(page, CKEY), "custom-1", "de laatste lijst wijst nog naar de verwijderde");
  // na herladen nog steeds weg
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(!(await lijstIds(page)).includes("custom-1"), "de lijst komt terug na herladen");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("verwijderen: de prullenbakknop staat rechtsboven op het lesscherm, rood, bij eigen lijsten en klaslijsten, niet bij Alles door elkaar", async () => {
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Mijn lijst"), eigen("custom-2", "Andere lijst")] } });
  const kijk = async () => page.evaluate(() => {
    const b = document.getElementById("btn-delete-list"), r = b.getBoundingClientRect(), t = b.closest(".topbar").getBoundingClientRect();
    return { zichtbaar: b.checkVisibility(), label: b.getAttribute("aria-label"), klasse: b.className, svg: !!b.querySelector("svg.icon"),
      rechts: Math.round(t.right - r.right), boven: r.top < 120, b: r.width, h: r.height, kleur: getComputedStyle(b).color,
      rood: getComputedStyle(document.documentElement).getPropertyValue("--bad-ink").trim(), foot: !!document.querySelector("#scr-home .foot #btn-delete-list") };
  });
  for (const id of ["custom-1", KLAS.id]) {
    await page.locator(`#lessons .lesson[data-id="${id}"]`).click(); await wachtOpScherm(page, "scr-home");
    const k = await kijk();
    assert.ok(k.zichtbaar, "geen knop bij " + id);
    assert.equal(k.label, "Lijst verwijderen");
    assert.match(k.klasse, /\bicon-btn\b/); assert.match(k.klasse, /\bdanger\b/);
    assert.ok(k.svg && k.boven && k.rechts <= 1, "de knop staat niet rechtsboven met een icoon: " + JSON.stringify(k));
    assert.ok(k.b >= 44 && k.h >= 44, "tikdoel te klein");
    assert.equal(k.foot, false, "de oude link onderaan staat er nog");
    await page.click("#btn-home-back"); await wachtOpScherm(page, "scr-lessons");
  }
  await page.locator('#lessons .lesson[data-id^="mix:"]').first().click(); await wachtOpScherm(page, "scr-home");
  assert.equal((await kijk()).zichtbaar, false, "de knop staat bij Alles door elkaar");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("ongedaan-balk: role=status, de zin, pakt de focus niet en is met Tab bereikbaar; Ongedaan maken zet terug", async () => {
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Unité 2")], [P("custom-1")]: voortgang() } });
  await verwijder(page, "custom-1");
  const b = await page.evaluate(() => {
    const el = document.getElementById("ongedaan");
    return { zichtbaar: el.checkVisibility(), role: el.getAttribute("role"), tekst: el.querySelector(".ongedaan-tekst").textContent,
      link: el.querySelector("button").textContent.trim(), tabindex: el.querySelector("button").tabIndex, focusErin: el.contains(document.activeElement),
      onderin: el.getBoundingClientRect().bottom > innerHeight - 120 };
  });
  assert.deepEqual(b, { zichtbaar: true, role: "status", tekst: "Unité 2 is verwijderd.", link: "Ongedaan maken", tabindex: 0, focusErin: false, onderin: true });
  // met Tab bereikbaar: vanaf de menuknop verder tabben komt erbij
  await page.focus("#btn-menu");
  let erin = false;
  for (let i = 0; i < 80 && !erin; i++) {
    await page.keyboard.press("Tab");
    erin = await page.evaluate(() => document.getElementById("ongedaan").contains(document.activeElement));
  }
  assert.ok(erin, "de balk is niet met Tab bereikbaar");
  // en de focus erin pauzeert hem (zie ook de test hieronder)
  assert.ok(await page.evaluate(() => document.getElementById("ongedaan").classList.contains("pauze")));
  await page.keyboard.press("Enter");
  assert.equal(await zichtbaar(page, "#ongedaan"), false, "de balk blijft staan na Ongedaan maken");
  const l = eigenUit(await lees(page, LKEY), "custom-1");
  assert.equal(l.weg, undefined, "weg staat er nog");
  assert.ok(l.bijgewerkt > 1000, "bijgewerkt is niet gezet");
  assert.ok((await lijstIds(page)).includes("custom-1"), "de lijst staat niet terug");
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), "custom-1", "de focus staat niet op de teruggezette lijst");
  assert.deepEqual(await lees(page, P("custom-1")), voortgang());
  assert.deepEqual(fouten, []);
  await context.close();
});

test("ongedaan-balk: staat --ongedaan-duur (8 s), pauzeert bij muis en focus, en een nieuwe verwijdering vervangt hem", async () => {
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Lijst een"), eigen("custom-2", "Lijst twee")] } });
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--ongedaan-duur").trim()), "8000ms");
  // in de test korter, zelfde gedrag
  await page.addStyleTag({ content: ":root { --ongedaan-duur: 700ms !important; }" });
  await page.mouse.move(5, 5);
  await verwijder(page, "custom-1");
  await page.waitForTimeout(300);
  assert.ok(await zichtbaar(page, "#ongedaan"), "de balk is te vroeg weg");
  await page.waitForTimeout(800);
  assert.equal(await zichtbaar(page, "#ongedaan"), false, "de balk gaat niet weg na de tijd");
  // muis erin: pauze; muis eruit: verder
  await verwijder(page, "custom-2");
  await page.hover("#ongedaan .ongedaan-tekst");
  await page.waitForTimeout(1200);
  assert.ok(await zichtbaar(page, "#ongedaan"), "de balk gaat weg terwijl de muis erin is");
  assert.ok(await page.evaluate(() => document.getElementById("ongedaan").classList.contains("pauze")), "de aftelbalk staat niet stil");
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  assert.equal(await zichtbaar(page, "#ongedaan"), false, "de balk gaat niet weg na de muis");
  // focus erin: pauze
  await page.evaluate(() => { const l = JSON.parse(localStorage.getItem("overhoor:lists")); l.forEach(x => { delete x.weg; x.bijgewerkt = Date.now(); }); localStorage.setItem("overhoor:lists", JSON.stringify(l)); });
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.addStyleTag({ content: ":root { --ongedaan-duur: 700ms !important; }" });
  await verwijder(page, "custom-1");
  await page.focus("#ongedaan .ongedaan-actie");
  await page.waitForTimeout(1200);
  assert.ok(await zichtbaar(page, "#ongedaan"), "de balk gaat weg terwijl de focus erin is");
  await page.evaluate(() => document.activeElement.blur());
  await page.waitForTimeout(1000);
  assert.equal(await zichtbaar(page, "#ongedaan"), false, "de balk gaat niet weg na de focus");
  // een nieuwe verwijdering vervangt de balk: een balk, de nieuwe zin, en Ongedaan maken zet alleen de laatste terug
  await page.addStyleTag({ content: ":root { --ongedaan-duur: 8000ms !important; }" });
  await verwijder(page, "custom-2");
  assert.equal(await page.locator(".ongedaan").count(), 1);
  assert.equal(await page.locator("#ongedaan .ongedaan-tekst").textContent(), "Lijst twee is verwijderd.");
  await page.click("#ongedaan .ongedaan-actie");
  const ids = await lijstIds(page);
  assert.ok(ids.includes("custom-2") && !ids.includes("custom-1"), "ongedaan zette de verkeerde lijst terug: " + ids);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("ongedaan-balk: bij reduced motion beweegt de aftelbalk niet, maar de tijd geldt wel", async () => {
  const { context, page, fouten } = await open({ reducedMotion: "reduce", zaai: { [LKEY]: [eigen("custom-1", "Lijst een")] } });
  await page.addStyleTag({ content: ":root { --ongedaan-duur: 600ms !important; }" });
  await page.mouse.move(5, 5);
  await verwijder(page, "custom-1");
  const a = await page.evaluate(() => getComputedStyle(document.querySelector("#ongedaan .ongedaan-meter i")).animationName);
  assert.equal(a, "none", "de aftelbalk beweegt bij reduced motion");
  await page.waitForTimeout(1000);
  assert.equal(await zichtbaar(page, "#ongedaan"), false, "de tijd geldt niet bij reduced motion");
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- klaslijsten ----------

test("klaslijst: verbergen zet een regel in overhoor:klas-weg, terugzetten zet weg op 0", async () => {
  const { context, page, fouten } = await open({ zaai: { [P(KLAS.id)]: voortgang() } });
  const voor = Date.now();
  await verwijder(page, KLAS.id);
  const kw = await lees(page, KWKEY);
  assert.ok(kw[KLAS.id].weg >= voor && kw[KLAS.id].bijgewerkt === kw[KLAS.id].weg, "geen regel in klas-weg: " + JSON.stringify(kw));
  assert.ok(!(await lijstIds(page)).includes(KLAS.id), "de klaslijst staat nog op het startscherm");
  assert.deepEqual(await lees(page, P(KLAS.id)), voortgang(), "de voortgang van de klaslijst is weg");
  await naarPrullenbak(page);
  assert.deepEqual(await kaarten(page), [{ id: KLAS.id, vak: KLAS.subject, titel: KLAS.title, regel: "Klaslijst · blijft hier tot je hem terugzet", knoppen: ["Terugzetten"] }]);
  await page.click('#prullenbak-body [data-actie="terug"]');
  const kw2 = await lees(page, KWKEY);
  assert.equal(kw2[KLAS.id].weg, 0, "weg is niet 0 na terugzetten");
  assert.ok(kw2[KLAS.id].bijgewerkt >= kw[KLAS.id].bijgewerkt);
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#prullenbak-melding").textContent(), KLAS.title + " staat weer bij je lijsten.");
  assert.equal(await page.locator("#prullenbak-melding").getAttribute("role"), "status");
  assert.equal(await focusId(page), "prullenbak-kop", "de focus staat niet op de kop bij een lege prullenbak");
  await page.click("#btn-prullenbak-back"); await wachtOpScherm(page, "scr-lessons");
  assert.ok((await lijstIds(page)).includes(KLAS.id), "de klaslijst staat niet terug");
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- prullenbak-scherm ----------

test("prullenbak: kop, uitleg, kaarten met het nieuwste bovenaan, de regels en dagen, en de focus", async () => {
  const nu = Date.now();
  const { context, page, fouten } = await open({ zaai: {
    [LKEY]: [eigen("custom-1", "Oud", { weg: nu - 29.5 * DAG, bijgewerkt: nu - 29.5 * DAG }), eigen("custom-2", "Nieuw", { weg: nu - 3 * DAG, bijgewerkt: nu - 3 * DAG, items: [{ word: "a", def: "b" }] }),
      eigen("custom-3", "Weg", { gewist: nu - DAG, bijgewerkt: nu - DAG, title: "", items: [] }), eigen("custom-4", "Levend")],
    [KWKEY]: { [KLAS.id]: { weg: nu - 10 * DAG, bijgewerkt: nu - 10 * DAG } } } });
  await naarPrullenbak(page);
  assert.equal(await focusId(page), "btn-prullenbak-back", "na openen staat de focus niet op Terug");
  assert.equal(await page.locator("#scr-prullenbak h1").textContent(), "Prullenbak");
  assert.equal(await page.locator("#scr-prullenbak .tag").textContent(), "Verwijderde lijsten blijven 30 dagen bewaard, met je voortgang.");
  assert.deepEqual(await kaarten(page), [
    { id: "custom-2", vak: "Duits", titel: "Nieuw", regel: "1 woord · nog 27 dagen", knoppen: ["Terugzetten", "Definitief verwijderen"] },
    { id: KLAS.id, vak: KLAS.subject, titel: KLAS.title, regel: "Klaslijst · blijft hier tot je hem terugzet", knoppen: ["Terugzetten"] },
    { id: "custom-1", vak: "Duits", titel: "Oud", regel: "3 woorden · nog 1 dag", knoppen: ["Terugzetten", "Definitief verwijderen"] },
  ]);
  // Definitief verwijderen is een rode link, Terugzetten de primaire knop
  const stijl = await page.evaluate(() => {
    const k = document.querySelector("#prullenbak-body .prullen");
    return { terug: k.querySelector('[data-actie="terug"]').className, wis: k.querySelector('[data-actie="wis"]').className,
      rood: getComputedStyle(k.querySelector('[data-actie="wis"]')).color === getComputedStyle(document.querySelector("#prullenbak-body .link.danger")).color };
  });
  assert.match(stijl.terug, /\bbtn\b.*\bprimary\b/); assert.match(stijl.wis, /\blink\b.*\bdanger\b/);
  // Terugzetten: kaart weg, melding, focus naar de volgende kaart
  await page.click('#prullenbak-body .prullen[data-id="custom-2"] [data-actie="terug"]');
  assert.deepEqual((await kaarten(page)).map(k => k.id), [KLAS.id, "custom-1"]);
  assert.equal(await page.evaluate(() => document.activeElement.closest(".prullen")?.dataset.id + "/" + document.activeElement.dataset.actie), KLAS.id + "/terug");
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#prullenbak-melding").textContent(), "Nieuw staat weer bij je lijsten.");
  // de laatste kaart terugzetten: de focus naar de vorige
  await page.click('#prullenbak-body .prullen[data-id="custom-1"] [data-actie="terug"]');
  assert.equal(await page.evaluate(() => document.activeElement.closest(".prullen")?.dataset.id), KLAS.id);
  // Terug: focus op de menuknop, en de lijsten staan terug
  await page.click("#btn-prullenbak-back"); await wachtOpScherm(page, "scr-lessons");
  assert.equal(await focusId(page), "btn-menu");
  const ids = await lijstIds(page);
  assert.ok(ids.includes("custom-1") && ids.includes("custom-2") && !ids.includes("custom-3"), "verkeerde lijsten op het startscherm: " + ids);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("prullenbak: leeg toont de lege staat", async () => {
  const { context, page, fouten } = await open();
  await naarPrullenbak(page);
  assert.equal(await page.locator("#prullenbak-body .prullen").count(), 0);
  const leeg = await page.locator("#prullenbak-body .empty").evaluate(e => ({ glyph: e.querySelector(".glyph").textContent, titel: e.querySelector("b").textContent, tekst: e.querySelector(".muted").textContent }));
  assert.deepEqual(leeg, { glyph: "0", titel: "De prullenbak is leeg.", tekst: "Een verwijderde lijst staat hier 30 dagen." });
  assert.deepEqual(fouten, []);
  await context.close();
});

test("definitief: vraag in de kaart, focus op Annuleren, Escape annuleert, Ja maakt een grafsteen en ruimt de voortgang op", async () => {
  const nu = Date.now();
  const { context, page, fouten } = await open({ zaai: {
    [LKEY]: [eigen("custom-1", "Unité 2", { weg: nu - 3 * DAG, bijgewerkt: nu - 3 * DAG }), eigen("custom-2", "Blijft")],
    [P("custom-1")]: voortgang(), [P("custom-2")]: voortgang(), "overhoor:progress:noor:custom-1": voortgang(),
    "overhoor:session:pia:custom-1": { queue: [], pos: 0 }, "overhoor:alts:pia:custom-1": { 0: ["hondje"] },
    "overhoor:grens:pia:custom-1": 2, "overhoor:deadline:custom-1": "2030-01-01", "overhoor:deadline:custom-2": "2030-01-01" } });
  await naarPrullenbak(page);
  await page.click('[data-actie="wis"]');
  const vraag = await page.evaluate(() => {
    const n = document.querySelector("#prullenbak-body .prullen .notice");
    return { tekst: n.querySelector("p").textContent, vet: n.querySelector("p b").textContent, role: n.getAttribute("role"),
      naam: document.getElementById(n.getAttribute("aria-labelledby"))?.textContent,
      knoppen: [...n.querySelectorAll("button")].map(b => b.textContent.trim()), ja: n.querySelector('[data-actie="ja"]').className,
      terugWeg: !document.querySelector('#prullenbak-body .prullen [data-actie="terug"]') };
  });
  assert.deepEqual(vraag, { tekst: "Definitief verwijderen? Dit kan niet ongedaan worden gemaakt.", vet: "Definitief verwijderen?", role: "group",
    naam: "Definitief verwijderen? Dit kan niet ongedaan worden gemaakt.", knoppen: ["Ja, verwijder", "Annuleren"], ja: "btn danger", terugWeg: true });
  assert.equal(await focusId(page), "annuleer", "de focus staat niet op Annuleren");
  await page.keyboard.press("Escape");
  assert.equal(await page.locator("#prullenbak-body .notice").count(), 0, "Escape annuleert niet");
  assert.equal(await focusId(page), "wis", "na annuleren staat de focus niet op Definitief verwijderen");
  // Annuleren met de knop
  await page.keyboard.press("Enter");
  await page.click('[data-actie="annuleer"]');
  assert.equal(await page.locator("#prullenbak-body .notice").count(), 0);
  // nu echt
  await page.click('[data-actie="wis"]');
  const voor = Date.now();
  await page.click('[data-actie="ja"]');
  const steen = eigenUit(await lees(page, LKEY), "custom-1");
  assert.deepEqual(Object.keys(steen), ["id", "title", "items", "weg", "gewist", "bijgewerkt", "added"], "velden van de grafsteen");
  assert.equal(steen.title, ""); assert.deepEqual(steen.items, []);
  assert.ok(steen.gewist >= voor && steen.bijgewerkt === steen.gewist);
  for (const k of [P("custom-1"), "overhoor:progress:noor:custom-1", "overhoor:session:pia:custom-1", "overhoor:alts:pia:custom-1", "overhoor:grens:pia:custom-1", "overhoor:deadline:custom-1"]) {
    assert.equal(await lees(page, k), null, k + " is niet opgeruimd");
  }
  assert.deepEqual(await lees(page, P("custom-2")), voortgang(), "de voortgang van een andere lijst is weg");
  assert.equal(await lees(page, "overhoor:deadline:custom-2"), "2030-01-01");
  await page.waitForTimeout(150);
  assert.equal(await page.locator("#prullenbak-melding").textContent(), "Unité 2 is definitief verwijderd.");
  assert.equal(await focusId(page), "prullenbak-kop");
  assert.equal(await page.locator("#prullenbak-body .empty").count(), 1);
  // niet terug na herladen, niet op het startscherm, niet in de prullenbak
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(!(await lijstIds(page)).includes("custom-1"));
  await naarPrullenbak(page);
  assert.equal(await page.locator("#prullenbak-body .prullen").count(), 0);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("30 dagen: bij het laden wordt een lijst die langer in de prullenbak staat een grafsteen; korter blijft hij", async () => {
  const nu = Date.now();
  const oud = nu - 31 * DAG, jong = nu - 29 * DAG;
  const { context, page, fouten } = await open({ zaai: {
    [LKEY]: [eigen("custom-1", "Oud", { weg: oud, bijgewerkt: oud }), eigen("custom-2", "Jong", { weg: jong, bijgewerkt: jong })],
    [P("custom-1")]: voortgang(), [P("custom-2")]: voortgang() } });
  const rauw = await lees(page, LKEY);
  assert.deepEqual(eigenUit(rauw, "custom-1"), { id: "custom-1", title: "", items: [], weg: oud, gewist: oud + 30 * DAG, bijgewerkt: oud + 30 * DAG, added: 1000 });
  assert.equal(eigenUit(rauw, "custom-2").weg, jong);
  assert.equal(eigenUit(rauw, "custom-2").gewist, undefined);
  assert.equal(await lees(page, P("custom-1")), null, "de voortgang van de grafsteen staat er nog");
  assert.deepEqual(await lees(page, P("custom-2")), voortgang());
  await naarPrullenbak(page);
  assert.deepEqual((await kaarten(page)).map(k => k.id), ["custom-2"]);
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- startscherm, mix, rapport, laatste lijst ----------

test("allLists en het startscherm: geen lijsten uit de prullenbak, ook niet in Alles door elkaar, het rapport of als laatste lijst", async () => {
  const nu = Date.now();
  const { context, page, fouten } = await open({ zaai: {
    [LKEY]: [eigen("custom-1", "Weggegooid", { weg: nu - DAG, bijgewerkt: nu - DAG }), eigen("custom-2", "Blijft"), eigen("custom-3", "Steen", { gewist: nu - DAG, bijgewerkt: nu - DAG })],
    [KWKEY]: { [KLAS.id]: { weg: nu - DAG, bijgewerkt: nu - DAG } },
    [P("custom-1")]: voortgang(), [P("custom-2")]: voortgang(), [P(KLAS.id)]: voortgang(), [CKEY]: "custom-1" } });
  const ids = await lijstIds(page);
  assert.ok(!ids.includes("custom-1") && !ids.includes("custom-3") && !ids.includes(KLAS.id), "prullenbaklijsten op het startscherm: " + ids);
  assert.ok(ids.includes("custom-2"));
  const lijsten = await page.evaluate(() => [...document.querySelectorAll("#lessons .lesson")].map(b => ({ id: b.dataset.id, meta: b.querySelector(".lesson-meta").textContent })));
  const duitsMix = lijsten.find(l => l.id.startsWith("mix:duits"));
  // een gemengde ronde over een lijst: alleen Blijft telt
  assert.ok(!duitsMix || /alles herhalen/.test(duitsMix.meta), "Alles door elkaar telt de prullenbaklijst mee: " + JSON.stringify(duitsMix));
  assert.notEqual(await lees(page, CKEY), "custom-1", "de laatste lijst wijst naar de prullenbak");
  await uitMenu(page, "#btn-report"); await wachtOpScherm(page, "scr-report");
  await page.waitForTimeout(200);
  const rapport = await page.locator("#report-body").innerText();
  assert.ok(!rapport.includes("Weggegooid") && !rapport.includes(KLAS.title), "het rapport toont een prullenbaklijst");
  assert.ok(rapport.includes("Blijft"));
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- menu ----------

test("menu: Prullenbak tussen Rapport en Over Overhoren, met een teller van wat zichtbaar in de prullenbak staat", async () => {
  const nu = Date.now();
  const zaai = { [LKEY]: [eigen("custom-1", "Een", { weg: nu - DAG, bijgewerkt: nu - DAG }), eigen("custom-2", "Steen", { gewist: nu - DAG, bijgewerkt: nu - DAG })],
    [KWKEY]: { [KLAS.id]: { weg: nu - DAG, bijgewerkt: nu - DAG }, [WL[1].id]: { weg: 0, bijgewerkt: nu } } };
  const teller = page => page.evaluate(() => {
    const t = document.getElementById("prullenbak-teller");
    return { zichtbaar: t.checkVisibility(), chip: t.querySelector(".chip").textContent, sr: t.querySelector(".sr-only").textContent,
      items: [...document.querySelectorAll("#menu .menu-item")].map(b => b.id), icoon: !!document.querySelector("#btn-prullenbak svg.icon") };
  });
  let { context, page, fouten } = await open({ zaai });
  await openMenu(page);
  assert.deepEqual(await teller(page), { zichtbaar: true, chip: "2", sr: ", 2 lijsten", items: ["btn-report", "btn-prullenbak", "btn-info"], icoon: true });
  // na verwijderen telt hij mee
  await page.keyboard.press("Escape");
  await verwijder(page, WL[1].id);
  await openMenu(page);
  assert.equal((await teller(page)).chip, "3");
  assert.deepEqual(fouten, []);
  await context.close();
  // klaslijsten op Nee: die tellen niet
  ({ context, page, fouten } = await open({ zaai: Object.assign({}, zaai, { "overhoor:klas": false }) }));
  await openMenu(page);
  assert.deepEqual((await teller(page)), { zichtbaar: true, chip: "1", sr: ", 1 lijst", items: ["btn-report", "btn-prullenbak", "btn-info"], icoon: true });
  await page.keyboard.press("Escape");
  await naarPrullenbak(page);
  assert.deepEqual((await kaarten(page)).map(k => k.id), ["custom-1"]);
  assert.deepEqual(fouten, []);
  await context.close();
  // niets: geen chip, en geen getal in de tekst
  ({ context, page, fouten } = await open());
  await openMenu(page);
  const leeg = await teller(page);
  assert.equal(leeg.zichtbaar, false);
  assert.equal(await page.locator("#btn-prullenbak").textContent(), "Prullenbak");
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- sync ----------

test("pull: kiest per lijst op stand, gelijk wint de grafsteen, en een verwijderde lijst komt niet terug", async () => {
  const nu = Date.now();
  const T = n => nu - 10 * DAG + n * 60_000;
  const remote = { updated: 9,
    lists: [
      eigen("custom-1", "Lokaal weg", { bijgewerkt: T(100) }),                           // ouder dan de lokale weg: lokaal blijft
      { id: "custom-2", title: "", items: [], gewist: T(300), bijgewerkt: T(300) },       // nieuwer dan lokaal levend: grafsteen
      { id: "custom-3", title: "", items: [], gewist: T(400), bijgewerkt: T(400) },       // gelijke stand: grafsteen wint
      eigen("custom-4", "Weer terug", { bijgewerkt: T(600) }),                           // nieuwer dan de lokale weg: terug
      eigen("custom-5", "Oude app", { added: 1000 }),                                     // oude app zonder bijgewerkt, lokaal grafsteen
    ],
    klasWeg: { [KLAS.id]: { weg: T(50), bijgewerkt: T(50) }, kapot: { weg: "x" } } };
  const { context, page, fouten } = await open({ sync: remote, zaai: {
    [LKEY]: [eigen("custom-1", "Lokaal weg", { weg: T(200), bijgewerkt: T(200) }), eigen("custom-2", "Ergens anders gewist", { bijgewerkt: T(100) }),
      eigen("custom-3", "Gelijk", { bijgewerkt: T(400) }), eigen("custom-4", "Weer terug", { weg: T(500), bijgewerkt: T(500) }),
      { id: "custom-5", title: "", items: [], gewist: T(10), bijgewerkt: T(10), added: 1000 }],
    [P("custom-2")]: voortgang() } });
  const rauw = await lees(page, LKEY);
  assert.equal(eigenUit(rauw, "custom-1").weg, T(200), "de pull bracht een verwijderde lijst terug");
  assert.equal(eigenUit(rauw, "custom-2").gewist, T(300));
  assert.equal(eigenUit(rauw, "custom-3").gewist, T(400), "bij gelijke stand wint de grafsteen niet");
  assert.equal(eigenUit(rauw, "custom-4").weg, undefined, "een nieuwere levende versie wint niet");
  assert.equal(eigenUit(rauw, "custom-5").gewist, T(10), "een oude app bracht een grafsteen terug");
  assert.equal(await lees(page, P("custom-2")), null, "de voortgang van een gewiste lijst staat er nog");
  assert.deepEqual(await lees(page, KWKEY), { [KLAS.id]: { weg: T(50), bijgewerkt: T(50) } });
  const ids = await lijstIds(page);
  assert.deepEqual(["custom-1", "custom-2", "custom-3", "custom-5", KLAS.id].filter(i => ids.includes(i)), [], "verwijderd en toch op het startscherm: " + ids);
  assert.ok(ids.includes("custom-4"), "de teruggezette lijst staat er niet");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("pull: klasWeg samenvoegen, de nieuwste regel wint", async () => {
  const nu = Date.now();
  const remote = { updated: 9, klasWeg: { [KLAS.id]: { weg: 0, bijgewerkt: nu - 1000 }, [WL[1].id]: { weg: nu - 5000, bijgewerkt: nu - 5000 } } };
  const { context, page, fouten } = await open({ sync: remote, zaai: { [KWKEY]: { [KLAS.id]: { weg: nu - 9000, bijgewerkt: nu - 9000 }, [WL[1].id]: { weg: 0, bijgewerkt: nu - 100 } } } });
  assert.deepEqual(await lees(page, KWKEY), { [KLAS.id]: { weg: 0, bijgewerkt: nu - 1000 }, [WL[1].id]: { weg: 0, bijgewerkt: nu - 100 } });
  const ids = await lijstIds(page);
  assert.ok(ids.includes(KLAS.id) && ids.includes(WL[1].id));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("push: klasWeg, de grafstenen en de lijsten in de prullenbak gaan mee, en de voortgang van een prullenbaklijst ook", async () => {
  const nu = Date.now();
  const puts = [];
  const { context, page, fouten } = await open({ sync: { updated: 0 }, puts, zaai: {
    [LKEY]: [{ id: "custom-9", title: "", items: [], gewist: nu - DAG, bijgewerkt: nu - DAG }, eigen("custom-1", "Een")], [P("custom-1")]: voortgang() } });
  await verwijder(page, KLAS.id);
  await verwijder(page, "custom-1");
  for (let i = 0; i < 60 && !puts.length; i++) await page.waitForTimeout(100);
  assert.ok(puts.length, "geen PUT");
  const body = puts[puts.length - 1];
  assert.deepEqual(Object.keys(body).sort(), ["cats", "klasWeg", "lists", "progress", "updated"]);
  assert.ok(body.klasWeg[KLAS.id].weg > 0, "klasWeg gaat niet mee");
  assert.deepEqual(body.lists.find(l => l.id === "custom-9"), { id: "custom-9", title: "", items: [], gewist: nu - DAG, bijgewerkt: nu - DAG });
  assert.ok(body.lists.find(l => l.id === "custom-1").weg > 0, "de lijst in de prullenbak gaat niet mee");
  assert.ok(body.progress["custom-1"], "de voortgang van de lijst in de prullenbak gaat niet mee");
  assert.equal(body.progress["custom-9"], undefined);
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- teksten ----------

test("teksten: geen uitroeptekens en geen em dashes in de prullenbak, de balk en de bronnen", async () => {
  const nu = Date.now();
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Een", { weg: nu - DAG, bijgewerkt: nu - DAG }), eigen("custom-2", "Twee")] } });
  await verwijder(page, "custom-2");
  const balk = await page.locator("#ongedaan").innerText();
  await naarPrullenbak(page);
  await page.click('.prullen[data-id="custom-1"] [data-actie="wis"]');
  const scherm = await page.locator("#scr-prullenbak").innerText();
  await page.click("#btn-prullenbak-back");
  await openMenu(page);
  const menu = await page.locator("#menu").innerText();
  for (const t of [balk, scherm, menu]) assert.doesNotMatch(t, /[!—]/, "uitroepteken of em dash in: " + t);
  const bron = readFileSync(join(REPO, "ui.js"), "utf8");
  const blok = bron.slice(bron.indexOf("// --- Ongedaan"), bron.indexOf("// --- Empty"));
  for (const zin of blok.match(/"[^"]*"/g) || []) assert.doesNotMatch(zin, /[!—]/, "in ui.js: " + zin);
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- contrast, overloop, tikdoelen ----------

for (const thema of THEMAS) {
  for (const breedte of BREEDTES) {
    test(`prullenbak, ${thema}, ${breedte}px: contrast, overloop en tikdoelen van de knop, de balk, de prullenbak, de vraag en leeg`, async t => {
      const nu = Date.now();
      const { context, page, fouten } = await open({ thema, breedte, zaai: {
        [LKEY]: [eigen("custom-1", "Unité 2", { weg: nu - 3 * DAG, bijgewerkt: nu - 3 * DAG }), eigen("custom-2", "Eigen woordjes week 44")],
        [KWKEY]: { [KLAS.id]: { weg: nu - DAG, bijgewerkt: nu - DAG } } } });
      const problemen = [];
      async function meet(waar) {
        await page.evaluate(rondAnimatiesAf);
        const o = await page.evaluate(overloopMeting);
        if (o.overloop) problemen.push(`${waar}: horizontale overloop ${o.scrollWidth}px. Uitstekend: ${o.boosdoeners.join(", ")}`);
        const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
        for (const f of c.fouten) problemen.push(`${waar}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
        for (const f of c.nietMeetbaar) problemen.push(`${waar}: contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
        for (const f of c.vrijgesteld) t.diagnostic(`uitgeschakeld: ${f.waar} "${f.tekst}" ${f.ratio}:1`);
        const klein = await page.evaluate(() => [...document.querySelectorAll("#btn-delete-list, #ongedaan button, #scr-prullenbak button, #btn-prullenbak")]
          .filter(b => b.checkVisibility()).map(b => ({ id: b.id || b.dataset.actie || b.textContent.trim(), r: b.getBoundingClientRect() }))
          .filter(x => x.r.height < 44 || x.r.width < 44).map(x => x.id + " " + Math.round(x.r.width) + "x" + Math.round(x.r.height)));
        if (klein.length) problemen.push(`${waar}: tikdoel kleiner dan 44 px: ${klein.join(", ")}`);
      }
      await page.locator('#lessons .lesson[data-id="custom-2"]').click(); await wachtOpScherm(page, "scr-home");
      await meet("lesscherm");
      await page.click("#btn-delete-list"); await wachtOpScherm(page, "scr-lessons");
      await page.hover("#ongedaan .ongedaan-tekst");   // de balk blijft staan
      await meet("ongedaan-balk");
      await page.mouse.move(1, 1);
      await openMenu(page);
      await meet("menu");
      await page.click("#btn-prullenbak"); await wachtOpScherm(page, "scr-prullenbak");
      await meet("prullenbak");
      await page.click('.prullen[data-id="custom-1"] [data-actie="wis"]');
      await meet("bevestigen");
      await page.click('[data-actie="ja"]');
      for (const id of ["custom-2", KLAS.id]) await page.click(`.prullen[data-id="${id}"] [data-actie="terug"]`);
      await meet("leeg");
      await context.close();
      problemen.push(...fouten);
      if (problemen.length) assert.fail(`\n${problemen.length} probleem/problemen:\n  ` + problemen.join("\n  "));
    });
  }
}

// ---------- na de keuring ----------

// Een pull die pas antwoordt als de test dat zegt: zo komt hij binnen
// terwijl je op een ander scherm bent. Geeft { context, page, fouten, laat }.
async function openMetLatePull(remote, { zaai = {}, puts = [] } = {}) {
  let laat;
  const poort = new Promise(r => { laat = r; });
  let gevraagd = 0;
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: "block", locale: "nl-NL" });
  await schermNetwerkAf(context);
  const alles = Object.assign({ "overhoor:learner": "Pia", "overhoor:learners": ["Pia"], "overhoor:klas": true, "overhoor:app-secret": "test" }, zaai);
  await context.addInitScript(z => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    for (const k in z) localStorage.setItem(k, JSON.stringify(z[k]));
  }, alles);
  await context.route(/workers\.dev\/sync\//, async route => {
    const req = route.request();
    if (req.method() === "PUT") { puts.push(JSON.parse(req.postData())); return route.fulfill({ status: 200, contentType: "application/json", body: "{}", headers: CORS }); }
    gevraagd++;
    await poort;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(remote), headers: CORS });
  });
  const page = await context.newPage();
  const fouten = volgFouten(page);
  page.on("dialog", d => { fouten.push("vraag van de browser: " + d.message()); d.dismiss(); });
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  for (let i = 0; i < 60 && !gevraagd; i++) await page.waitForTimeout(50);
  assert.ok(gevraagd, "de app vroeg niets op");
  return { context, page, fouten, laat: async () => { laat(); await page.waitForTimeout(400); } };
}

test("keuring 1: na verwijderen staat de focus op de kop, en de balk staat direct na de kop (alleen Beta ertussen)", async () => {
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Unité 2")] } });
  await verwijder(page, "custom-1");
  const r = await page.evaluate(() => {
    const kop = document.getElementById("app-titel"), balk = document.getElementById("ongedaan");
    return { focus: document.activeElement.id, tabindex: kop.getAttribute("tabindex"), naKop: kop.nextElementSibling === balk,
      focusErin: balk.contains(document.activeElement) };
  });
  assert.deepEqual(r, { focus: "app-titel", tabindex: "-1", naKop: true, focusErin: false });
  await page.keyboard.press("Tab");
  const eerste = await page.evaluate(() => document.activeElement.className);
  if (!/ongedaan-actie/.test(eerste)) {
    assert.match(eerste, /\bbeta\b/, "tussen de kop en de balk staat meer dan Beta: " + eerste);
    await page.keyboard.press("Tab");
  }
  assert.ok(await page.evaluate(() => document.activeElement.classList.contains("ongedaan-actie")), "de balk is niet direct na de kop te bereiken");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("keuring 2: bij een klok die achterloopt wordt bijgewerkt toch hoger dan wat er stond", async () => {
  const later = Date.now() + 2 * 60_000;   // een ander toestel zette dit, met een klok die voorloopt
  const { context, page, fouten } = await open({ zaai: {
    [LKEY]: [eigen("custom-1", "Een", { bijgewerkt: later })], [KWKEY]: { [KLAS.id]: { weg: 0, bijgewerkt: later } } } });
  await verwijder(page, "custom-1");
  const weg = eigenUit(await lees(page, LKEY), "custom-1").bijgewerkt;
  assert.ok(weg > later, "verwijderen verliest van de oudere stand: " + (weg - later));
  await naarPrullenbak(page);
  await page.click('.prullen[data-id="custom-1"] [data-actie="terug"]');
  assert.ok(eigenUit(await lees(page, LKEY), "custom-1").bijgewerkt > weg, "terugzetten verliest van het verwijderen");
  await page.click("#btn-prullenbak-back"); await wachtOpScherm(page, "scr-lessons");
  await verwijder(page, KLAS.id);
  const kw = (await lees(page, KWKEY))[KLAS.id];
  assert.ok(kw.weg > 0 && kw.bijgewerkt > later, "de klasregel verliest van de oudere stand");
  await naarPrullenbak(page);
  await page.click(`.prullen[data-id="${KLAS.id}"] [data-actie="terug"]`);
  assert.ok((await lees(page, KWKEY))[KLAS.id].bijgewerkt > kw.bijgewerkt, "terugzetten van de klaslijst verliest");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("keuring 3: een pull terwijl de prullenbak open staat tekent hem opnieuw; een open vraag sluit alleen als zijn lijst weg is", async () => {
  const nu = Date.now();
  const steen = id => ({ id, title: "", items: [], weg: nu - 2 * DAG, gewist: nu - 1000, bijgewerkt: nu - 1000 });
  const zaai = { [LKEY]: [eigen("custom-1", "Een", { weg: nu - 2 * DAG, bijgewerkt: nu - 2 * DAG }), eigen("custom-2", "Twee", { weg: nu - 3 * DAG, bijgewerkt: nu - 3 * DAG })] };
  // de vraag staat bij custom-1, de pull wist custom-1
  let t = await openMetLatePull({ updated: 9, lists: [steen("custom-1")] }, { zaai });
  await naarPrullenbak(t.page);
  await t.page.click('.prullen[data-id="custom-1"] [data-actie="wis"]');
  await t.laat();
  assert.deepEqual((await kaarten(t.page)).map(k => k.id), ["custom-2"], "de prullenbak is niet opnieuw getekend");
  assert.equal(await t.page.locator("#prullenbak-body .notice").count(), 0, "de vraag bleef staan");
  assert.equal(await focusId(t.page), "prullenbak-kop");
  assert.deepEqual(t.fouten, []);
  await t.context.close();
  // de vraag staat bij custom-1, de pull wist custom-2: de vraag blijft, met de focus
  t = await openMetLatePull({ updated: 9, lists: [steen("custom-2")] }, { zaai });
  await naarPrullenbak(t.page);
  await t.page.click('.prullen[data-id="custom-1"] [data-actie="wis"]');
  await t.laat();
  assert.deepEqual((await kaarten(t.page)).map(k => k.id), ["custom-1"]);
  assert.equal(await t.page.locator('.prullen[data-id="custom-1"] .notice').count(), 1, "de vraag sloot terwijl zijn lijst er nog is");
  assert.equal(await focusId(t.page), "annuleer");
  assert.deepEqual(t.fouten, []);
  await t.context.close();
});

test("keuring 4: wordt de open lijst door een pull een grafsteen, dan terug naar het lessenscherm; in een ronde blijft de ronde en komt er geen voortgang onder de grafsteen", async () => {
  const nu = Date.now();
  const remote = { updated: 9, lists: [{ id: "custom-1", title: "", items: [], gewist: nu - 1000, bijgewerkt: nu - 1000 }] };
  const zaai = { [LKEY]: [eigen("custom-1", "Een", { added: nu - DAG }), eigen("custom-2", "Twee")] };
  // op het lesscherm
  let t = await openMetLatePull(remote, { zaai });
  await t.page.locator('#lessons .lesson[data-id="custom-1"]').click(); await wachtOpScherm(t.page, "scr-home");
  await t.laat();
  await wachtOpScherm(t.page, "scr-lessons");
  assert.notEqual(await lees(t.page, CKEY), "custom-1", "de laatste lijst wijst naar de grafsteen");
  assert.ok(!(await lijstIds(t.page)).includes("custom-1"));
  assert.deepEqual(t.fouten, []);
  await t.context.close();
  // in een ronde: de ronde loopt door, maar er wordt niets onder custom-1 bewaard
  t = await openMetLatePull(remote, { zaai });
  await t.page.locator('#lessons .lesson[data-id="custom-1"]').click(); await wachtOpScherm(t.page, "scr-home");
  await t.page.click("#btn-start"); await wachtOpScherm(t.page, "scr-quiz");
  await t.laat();
  assert.ok(await zichtbaar(t.page, "#scr-quiz"), "de ronde is afgebroken");
  await t.page.fill("#q-input", "de hond");
  await t.page.click("#btn-check");
  await t.page.locator("#btn-next").waitFor({ state: "visible" });
  await t.page.click("#btn-next");
  await t.page.waitForTimeout(200);
  assert.equal(await lees(t.page, P("custom-1")), null, "voortgang geschreven onder een grafsteen");
  assert.equal(await lees(t.page, "overhoor:session:pia:custom-1"), null, "ronde bewaard onder een grafsteen");
  assert.equal(eigenUit(await lees(t.page, LKEY), "custom-1").gewist, nu - 1000);
  assert.deepEqual(t.fouten, []);
  await t.context.close();
});

test("keuring 5: een grafsteen met het id van een klaslijst wist niets, wordt genegeerd en niet bewaard of verstuurd", async () => {
  const nu = Date.now();
  const puts = [];
  const stenen = [{ id: KLAS.id, title: "", items: [], gewist: nu - 1000, bijgewerkt: nu - 1000 }];
  const { context, page, fouten } = await open({ sync: { updated: 9, lists: stenen }, puts, zaai: {
    [LKEY]: [{ id: WL[1].id, title: "", items: [], weg: nu - 40 * DAG, gewist: nu - DAG, bijgewerkt: nu - DAG }, eigen("custom-1", "Een")],
    [P(KLAS.id)]: voortgang(), [P(WL[1].id)]: voortgang(), ["overhoor:session:pia:" + KLAS.id]: { queue: [], pos: 0 } } });
  assert.deepEqual(await lees(page, P(KLAS.id)), voortgang(), "de pull wiste de voortgang van een klaslijst");
  assert.deepEqual(await lees(page, P(WL[1].id)), voortgang(), "het laden wiste de voortgang van een klaslijst");
  assert.ok(await lees(page, "overhoor:session:pia:" + KLAS.id), "de ronde van een klaslijst is gewist");
  assert.equal((await lees(page, LKEY)).some(l => l && (l.id === KLAS.id || l.id === WL[1].id)), false, "een grafsteen met een klas-id is bewaard");
  const ids = await lijstIds(page);
  assert.ok(ids.includes(KLAS.id) && ids.includes(WL[1].id), "een klaslijst is verdwenen: " + ids);
  assert.equal(ids.filter(i => i === WL[1].id).length, 1, "een klaslijst staat er dubbel");
  // de push stuurt geen eigen lijst met een klas-id
  await verwijder(page, "custom-1");
  for (let i = 0; i < 60 && !puts.length; i++) await page.waitForTimeout(100);
  assert.ok(puts.length, "geen PUT");
  assert.deepEqual(puts[puts.length - 1].lists.map(l => l.id), ["custom-1"]);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("keuring 6: bij het laden blijven hooguit 500 grafstenen, de nieuwste", async () => {
  const nu = Date.now();
  const stenen = Array.from({ length: 520 }, (_, i) => ({ id: "custom-s" + i, title: "", items: [], gewist: nu - DAG - i * 1000, bijgewerkt: nu - DAG - i * 1000 }));
  const { context, page, fouten } = await open({ zaai: { [LKEY]: [eigen("custom-1", "Levend")].concat(stenen) } });
  const rauw = await lees(page, LKEY);
  const over = rauw.filter(l => l.gewist > 0).map(l => l.id);
  assert.equal(over.length, 500, "aantal grafstenen: " + over.length);
  assert.ok(over.includes("custom-s0") && over.includes("custom-s499") && !over.includes("custom-s500"), "niet de nieuwste 500");
  assert.ok(rauw.some(l => l.id === "custom-1" && !l.gewist), "een levende lijst is weg");
  assert.deepEqual(fouten, []);
  await context.close();
});
