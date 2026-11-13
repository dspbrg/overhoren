// Vorm van voortgang, eigen lijsten en oude cats in de app. Wat in
// localStorage staat of van de sync-worker komt, kan een rare vorm hebben
// (items geen object, sessions geen array, een lijst zonder items). De app
// mag daar niet op vastlopen, en de goede data moet blijven.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { pathToFileURL } from "node:url";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { beantwoord, wachtOpScherm } from "./lib/schermen.mjs";

// dezelfde regels in de worker, voor de pariteitstest
const MERGE = await import(pathToFileURL(join(REPO, "worker", "src", "merge.js")).href);
const MARGE = 5 * 60 * 1000;

// De vormfuncties van de app, rechtstreeks uit index.html: het blok tussen
// "vorm van voortgang" en applyRemote, in een eigen vm met de echte engine.
function appVorm() {
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  const begin = html.indexOf("// ---------- vorm van voortgang");
  const eind = html.indexOf("// Wat de worker terugstuurt");
  assert.ok(begin > 0 && eind > begin, "vormblok niet gevonden in index.html");
  const c = vm.createContext({});
  c.window = c;
  vm.runInContext(readFileSync(join(REPO, "engine.js"), "utf8"), c);
  vm.runInContext("var E = window.Engine;\n" + html.slice(begin, eind) +
    "\nthis.vorm = { schoneLijst, schoneStaat, schoneVoortgang, schoneCat };", c);
  return c.vorm;
}

const WL = (() => {
  const c = vm.createContext({}); c.window = c;
  vm.runInContext(readFileSync(join(REPO, "lists.js"), "utf8"), c);
  return c.WORDLISTS;
})();
const FRANS = WL.find(l => l.title === "Arrêt Apprendre");
const ENGELS = WL.find(l => l.title === "Horrid Henry wordlist");

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT" };

// zaai: eenmalig in localStorage (waarden worden als JSON opgeslagen).
// sync: antwoord van de nep-worker op GET /sync, of null voor geen sync.
async function open({ zaai = {}, sync = null, puts = [] } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: "block", locale: "nl-NL" });
  await schermNetwerkAf(context);
  const alles = Object.assign({ "overhoor:learner": "Pia", "overhoor:learners": ["Pia"] }, zaai);
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
const titels = page => page.locator("#lessons .lesson").evaluateAll(els => els.map(e => e.textContent));
async function naarLes(page, titel) {
  await page.locator(".lesson", { hasText: titel }).first().click();
  await wachtOpScherm(page, "scr-home");
}
async function terugNaarLessen(page) {
  await page.click("#btn-home-back");
  await wachtOpScherm(page, "scr-lessons");
}
// Voortgang, rapport en een gespeelde vraag: de plekken die items en
// sessions lezen.
async function bekijkAlles(page, titel) {
  await naarLes(page, titel);
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  await page.click("#btn-progress-back"); await wachtOpScherm(page, "scr-home");
  await terugNaarLessen(page);
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await page.waitForTimeout(100);
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
}

// ---------- vormen om te zaaien ----------
const staat = (extra = {}) => ({ box: 3, due: 1, seen: 2, correct: 2, wrong: 0, lapses: 0, streak: 2, last: 1,
  dirWrong: { wd: 0, dw: 0, ex: 0 }, partWrong: { cls: 0, def: 0, word: 0 }, ...extra });
const ronde = (extra = {}) => ({ date: 1_700_000_000_000, n: 5, first: 4, ms: 60000, stopped: false, ...extra });
const goedeLijst = { id: "custom-goed", title: "Goede lijst", subject: "Engels", added: 5,
  items: [{ word: "cat", def: "kat" }, { word: "dog", def: "hond" }, { word: "cow", def: "koe" }] };
const kapotteLijsten = [
  null, 5, "x",
  { id: "custom-geen-items", title: "Kapot zonder items" },
  { id: "custom-items-tekst", title: "Kapot items tekst", items: "kapot" },
  // een kapot woord wordt een leeg woord op dezelfde plek: de lijst blijft
  { id: "custom-woord-null", title: "Hersteld woord null", items: [{ word: "a", def: "b" }, null] },
  { id: "custom-woord-getal", title: "Hersteld woord getal", items: [{ word: 5, def: "b" }] },
  // zonder titel: titel wordt "", de lijst blijft
  { id: "custom-geen-titel", items: [{ word: "a", def: "b" }] },
  // een lijst van buiten mag geen gemengde lijst worden: mix valt weg, de lijst blijft
  { id: "custom-mix", title: "Was mix", mix: true, bronnen: ["x"], items: [{ word: "a", def: "b" }] },
];
// alleen een lijst zonder geldig id of zonder items-array valt weg
const KAPOT = ["Kapot zonder items", "Kapot items tekst"];
const HERSTELD = ["Hersteld woord null", "Hersteld woord getal", "Was mix"];

// ---------- localStorage ----------

test("localStorage: kapotte eigen lijsten laten het lessenscherm niet vastlopen, de goede blijven", async () => {
  const { context, page, fouten } = await open({ zaai: { "overhoor:lists": [goedeLijst, ...kapotteLijsten] } });
  const t = await titels(page);
  assert.ok(t.some(x => x.includes("Goede lijst")), "goede lijst ontbreekt: " + t.join(" | "));
  for (const k of HERSTELD) assert.ok(t.some(x => x.includes(k)), k + " ontbreekt");
  for (const k of KAPOT) assert.ok(!t.some(x => x.includes(k)), k + " staat er toch");
  assert.ok(t.some(x => x.includes(FRANS.title)), "ingebouwde lijsten weg");
  await bekijkAlles(page, "Goede lijst");
  for (const k of HERSTELD) await bekijkAlles(page, k);
  // de opslag blijft rauw: niets weggeschreven
  assert.deepEqual(await lees(page, "overhoor:lists"), JSON.parse(JSON.stringify([goedeLijst, ...kapotteLijsten])));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("localStorage: voortgang met kapotte items en sessions laat lessen, voortgang, rapport en een ronde niet vastlopen", async () => {
  const { context, page, fouten } = await open({ zaai: {
    ["overhoor:progress:pia:" + FRANS.id]: { items: "kapot", sessions: "kapot", updated: 1 },
    ["overhoor:progress:pia:" + ENGELS.id]: { items: { 0: null, 1: "x", 2: staat({ box: "<b>" }), 3: staat() },
      sessions: [null, 5, ronde({ n: "veel" }), ronde()], updated: 2 },
    ["overhoor:progress:pia:" + WL[0].id]: { items: [staat()], sessions: { 0: ronde() }, updated: 3 },
    ["overhoor:progress:pia:" + WL[1].id]: "kapot",
  } });
  await bekijkAlles(page, FRANS.title);
  await bekijkAlles(page, ENGELS.title);
  await bekijkAlles(page, WL[0].title);
  await bekijkAlles(page, WL[1].title);
  // de goede delen van de Engelse voortgang staan in het rapport
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  const rapport = await page.locator("#report-body").textContent();
  assert.match(rapport, new RegExp(ENGELS.title));
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  // een vraag beantwoorden op de lijst met kapotte voortgang
  await naarLes(page, FRANS.title);
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  await beantwoord(page, true);
  const p = await lees(page, "overhoor:progress:pia:" + FRANS.id);
  assert.ok(p.items && typeof p.items === "object" && !Array.isArray(p.items), "items is geen object: " + JSON.stringify(p.items));
  assert.ok(Array.isArray(p.sessions), "sessions is geen array");
  assert.ok(Object.keys(p.items).length >= 1, "het antwoord is niet geboekt");
  // de goede woordtoestand van de Engelse lijst is er nog
  const e = await lees(page, "overhoor:progress:pia:" + ENGELS.id);
  assert.equal(e.items[3].box, 3);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("localStorage: een grens die geen heel getal is laat het startscherm van de les niet vastlopen", async () => {
  const { context, page, fouten } = await open({ zaai: { ["overhoor:grens:pia:" + FRANS.id]: 2.5 } });
  await naarLes(page, FRANS.title);
  assert.match(await page.locator("#grens-hint").textContent(), /Tot en met .* 2 van 70 woorden/);
  await terugNaarLessen(page);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("beveiliging: de reeks uit een opgeslagen ronde komt niet rauw in de HTML", async () => {
  const boos = "<img src=x onerror=\"window.__xss=1\">";
  const { context, page, fouten } = await open({ zaai: {
    ["overhoor:session:pia:" + FRANS.id]: { listId: FRANS.id, queue: [{ i: 0, dir: "wd" }, { i: 1, dir: "wd" }], pos: 0, total: 2,
      attempts: {}, firstTry: {}, done: 0, streak: boos, skipped: 0, startedAt: 1, elapsedBefore: 0, actief: 0, laatsteActie: 1, kind: "due", kat: "strepen" },
  } });
  await naarLes(page, FRANS.title);
  await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
  await page.waitForTimeout(200);
  assert.equal(await page.locator("#q-streak img").count(), 0, "HTML uit opslag in de reeks");
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(fouten.filter(f => !/HTTP 404: .*\/x$/.test(f)), []);
  await context.close();
});

// ---------- sync ----------

test("sync: rare vormen uit de worker worden opgeschoond opgeslagen, de goede data landt, en na herladen loopt niets vast", async () => {
  const goedeVoortgang = { items: { 0: staat(), 1: staat({ box: 1 }) }, sessions: [ronde()], updated: 50 };
  const remote = {
    updated: 9,
    cats: { "cats/a.svg": { laatst: 3, aantal: 1, extra: "<b>" }, "cats/b.svg": { laatst: "gisteren" } },
    progress: {
      [FRANS.id]: { items: "kapot", sessions: "kapot", updated: 60 },
      [ENGELS.id]: { items: { 0: staat(), 1: null, 2: staat({ due: "morgen" }), abc: staat() }, sessions: [ronde(), null, ronde({ ms: "lang" })], updated: 61 },
      [WL[0].id]: goedeVoortgang,
      [WL[1].id]: { items: [staat()], sessions: { 0: ronde() }, updated: 62 },
    },
    lists: [goedeLijst, ...kapotteLijsten],
  };
  const { context, page, fouten } = await open({ sync: remote, zaai: {
    // eigen voortgang die ouder is dan die van de worker
    ["overhoor:progress:pia:" + FRANS.id]: { items: { 0: staat() }, sessions: [ronde()], updated: 10 },
  } });
  const f = await lees(page, "overhoor:progress:pia:" + FRANS.id);
  assert.deepEqual(f, { items: {}, sessions: [], updated: 60 }, "kapotte items/sessions niet opgeschoond");
  const e = await lees(page, "overhoor:progress:pia:" + ENGELS.id);
  assert.deepEqual(Object.keys(e.items), ["0", "2"]);
  assert.deepEqual(e.items[0], staat());
  assert.deepEqual(e.items[2], staat({ due: 0 }), "een kapot getal wordt 0, de rest van de toestand blijft");
  assert.deepEqual(e.sessions, [ronde()]);
  assert.deepEqual(await lees(page, "overhoor:progress:pia:" + WL[0].id), goedeVoortgang, "goede voortgang aangetast");
  const w1 = await lees(page, "overhoor:progress:pia:" + WL[1].id);
  assert.deepEqual(w1, { items: {}, sessions: [], updated: 62 });
  const lijsten = await lees(page, "overhoor:lists");
  assert.deepEqual(lijsten.map(l => l.id).sort(), ["custom-geen-titel", "custom-goed", "custom-mix", "custom-woord-getal", "custom-woord-null"]);
  assert.deepEqual(lijsten.find(l => l.id === "custom-goed"), goedeLijst);
  assert.deepEqual(lijsten.find(l => l.id === "custom-woord-null").items, [{ word: "a", def: "b" }, { word: "", def: "" }]);
  assert.deepEqual(lijsten.find(l => l.id === "custom-woord-getal").items, [{ word: "", def: "b" }]);
  assert.equal(lijsten.find(l => l.id === "custom-geen-titel").title, "");
  assert.equal("mix" in lijsten.find(l => l.id === "custom-mix"), false);
  assert.deepEqual(await lees(page, "overhoor:cats:pia"), { "cats/a.svg": { laatst: 3, aantal: 1 } });

  // na herladen (de worker stuurt hetzelfde nog eens) loopt niets vast
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.waitForTimeout(300);
  for (const t of [FRANS.title, ENGELS.title, WL[0].title, "Goede lijst"]) await bekijkAlles(page, t);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: lokale data met een rare vorm wint niet van goede data uit de worker en laat niets vastlopen", async () => {
  const remote = { updated: 9, progress: { [FRANS.id]: { items: { 0: staat() }, sessions: [ronde()], updated: 5 } }, lists: [goedeLijst] };
  const { context, page, fouten } = await open({ sync: remote, zaai: {
    // lokaal kapot en zonder updated: de worker wint
    ["overhoor:progress:pia:" + FRANS.id]: { items: "kapot", sessions: 3 },
    "overhoor:lists": [{ id: "custom-goed", title: "Kapot lokaal", items: "x", added: 99 }],
  } });
  assert.deepEqual(await lees(page, "overhoor:progress:pia:" + FRANS.id), remote.progress[FRANS.id]);
  const lijsten = await lees(page, "overhoor:lists");
  assert.deepEqual(lijsten, [goedeLijst]);
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await bekijkAlles(page, FRANS.title);
  await bekijkAlles(page, "Goede lijst");
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- herstellen in plaats van weggooien ----------

const langeLijst = { id: "custom-lang", title: "Lange titel " + "t".repeat(250), subject: "Engels", added: 7,
  items: [{ word: "w".repeat(1500), def: "lang" }, { word: "dog", def: "d".repeat(1200) }, { word: "cow", def: "koe", cls: "c".repeat(300) }] };

test("localStorage: een eigen lijst met een te lang woord of een te lange titel blijft staan, afgekapt, en de opslag blijft rauw", async () => {
  const { context, page, fouten } = await open({ zaai: { "overhoor:lists": [langeLijst] } });
  const t = await titels(page);
  const regel = t.find(x => x.includes("Lange titel"));
  assert.ok(regel, "lijst met te lange titel is weg: " + t.join(" | "));
  assert.ok(!regel.includes("t".repeat(200)), "titel niet afgekapt");
  await bekijkAlles(page, "Lange titel");
  assert.deepEqual(await lees(page, "overhoor:lists"), [langeLijst], "rauwe lijst in opslag aangepast");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("Typ zelf: maxlength op de velden, en een te lang woord of een te lange titel geeft een melding in plaats van een kapotte lijst", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-import"); await wachtOpScherm(page, "scr-import");
  await page.click("#btn-type-start");
  for (const id of ["imp-subject", "imp-title", "imp-from", "imp-to"]) {
    assert.equal(await page.getAttribute("#" + id, "maxlength"), "200", id);
  }
  const zet = (id, v) => page.evaluate(([id, v]) => { document.getElementById(id).value = v; }, [id, v]);
  const melding = () => page.locator("#imp-msg").textContent();
  // te lang woord
  await zet("imp-title", "Mijn lijst");
  await zet("imp-text", "chat | kat\n" + "w".repeat(1001) + " | hond\nvache | koe");
  await page.click("#btn-import-save");
  assert.match(await melding(), /te lang/i);
  assert.equal(await lees(page, "overhoor:lists"), null, "lijst toch opgeslagen");
  // te lange vertaling
  await zet("imp-text", "chat | kat\nchien | " + "d".repeat(1001) + "\nvache | koe");
  await page.click("#btn-import-save");
  assert.match(await melding(), /te lang/i);
  // te lange titel
  await zet("imp-title", "t".repeat(201));
  await zet("imp-text", "chat | kat\nchien | hond\nvache | koe");
  await page.click("#btn-import-save");
  assert.match(await melding(), /te lang/i);
  assert.equal(await lees(page, "overhoor:lists"), null, "lijst toch opgeslagen");
  // goed: wordt opgeslagen
  await zet("imp-title", "Mijn lijst");
  await page.click("#btn-import-save");
  await wachtOpScherm(page, "scr-home");
  const l = await lees(page, "overhoor:lists");
  assert.equal(l.length, 1);
  assert.equal(l[0].title, "Mijn lijst");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("foto-import: maxlength op de velden, en een te lang woord geeft een melding bij opslaan", async () => {
  // sync aan (sleutel gezet), en /extract geeft een vast resultaat terug
  const { context, page, fouten } = await open({ sync: {} });
  const resultaat = { mode: "translate", subject: "Frans", title: "Foto", from: "Frans", to: "Nederlands",
    items: [{ word: "chat", def: "kat" }, { word: "chien", def: "hond" }] };
  await context.route(/workers\.dev\/extract/, route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(resultaat), headers: CORS }));
  await page.click("#btn-import"); await wachtOpScherm(page, "scr-import");
  await page.click("#btn-photo-start"); await wachtOpScherm(page, "scr-photo");
  // 4x4 grijs PNG-plaatje, hier gemaakt voor de test
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAAAAACMmsGiAAAADklEQVR4nGNoAAIGVAIAUBQIAXAlrj8AAAAASUVORK5CYII=", "base64");
  await page.setInputFiles("#photo-input", { name: "bladzijde.png", mimeType: "image/png", buffer: png });
  await wachtOpScherm(page, "photo-actions");
  await page.click('.photo-type-btn[data-type="anders"]');
  await wachtOpScherm(page, "photo-review");
  for (const id of ["photo-subject", "photo-title", "photo-from", "photo-to"]) {
    assert.equal(await page.getAttribute("#" + id, "maxlength"), "200", id);
  }
  for (const k of [".photo-word", ".photo-def"]) {
    assert.deepEqual(await page.locator(k).evaluateAll(els => els.map(e => e.getAttribute("maxlength"))), ["1000", "1000"], k);
  }
  await page.locator(".photo-word").first().evaluate(el => { el.value = "w".repeat(1001); });
  await page.click("#btn-photo-save");
  assert.match(await page.locator("#photo-error").textContent(), /te lang/i);
  assert.equal(await page.locator("#photo-error").isVisible(), true);
  assert.equal(await lees(page, "overhoor:lists"), null, "lijst toch opgeslagen");
  await page.locator(".photo-word").first().evaluate(el => { el.value = "chat"; });
  await page.evaluate(() => { document.getElementById("photo-title").value = "t".repeat(201); });
  await page.click("#btn-photo-save");
  assert.match(await page.locator("#photo-error").textContent(), /te lang/i);
  assert.equal(await lees(page, "overhoor:lists"), null, "lijst toch opgeslagen");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: een lijst met een te lang woord of te lange titel landt afgekapt, en lokale rauwe lijsten overleven applyRemote", async () => {
  const rauwKapot = { id: "custom-rauw", title: "Rauw kapot", items: "x", added: 1 };
  const rauwZonderId = { title: "Zonder id", items: [] };
  const lokaalLang = { ...langeLijst, id: "custom-lokaal-lang", title: "Lokaal lang " + "t".repeat(250) };
  const remote = { updated: 9, lists: [langeLijst, goedeLijst] };
  const { context, page, fouten } = await open({ sync: remote, zaai: {
    "overhoor:lists": [rauwKapot, rauwZonderId, lokaalLang, null],
  } });
  const lijsten = await lees(page, "overhoor:lists");
  // lokale rauwe lijsten staan er nog, ongewijzigd en op hun plek
  assert.deepEqual(lijsten.slice(0, 4), [rauwKapot, rauwZonderId, lokaalLang, null]);
  const lang = lijsten.find(l => l && l.id === "custom-lang");
  assert.ok(lang, "lange lijst uit de worker is weg");
  assert.equal(lang.title, langeLijst.title.slice(0, 200));
  assert.equal(lang.items.length, 3);
  assert.equal(lang.items[0].word, "w".repeat(1000));
  assert.equal(lang.items[1].def, "d".repeat(1000));
  assert.equal(lang.items[2].cls, "c".repeat(200));
  assert.deepEqual(lijsten.find(l => l && l.id === "custom-goed"), goedeLijst);
  // na herladen staan ze op het lessenscherm en loopt niets vast
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.waitForTimeout(300);
  await bekijkAlles(page, "Lange titel");
  await bekijkAlles(page, "Lokaal lang");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: tijden uit de worker worden begrensd, de aanval met 1e308 blijft niet staan", async () => {
  const remote = { updated: 9,
    progress: { [FRANS.id]: { items: { 0: staat() }, sessions: [], updated: 1e308 } },
    lists: [{ ...goedeLijst, added: 1e308 }],
    cats: { "cats/a.svg": { laatst: 1e308, eerst: 1e308, aantal: 2 } } };
  const voor = Date.now();
  const { context, page, fouten } = await open({ sync: remote });
  const na = await page.evaluate(() => Date.now());
  const p = await lees(page, "overhoor:progress:pia:" + FRANS.id);
  assert.ok(p.updated >= voor && p.updated <= na + MARGE, "updated niet begrensd: " + p.updated);
  const l = (await lees(page, "overhoor:lists")).find(x => x.id === "custom-goed");
  assert.ok(l.added <= na + MARGE, "added niet begrensd: " + l.added);
  const c = (await lees(page, "overhoor:cats:pia"))["cats/a.svg"];
  assert.ok(c.laatst <= na + MARGE && c.eerst <= na + MARGE, "cats niet begrensd: " + JSON.stringify(c));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: lokale voortgang met een tijd in de toekomst wint niet van nieuwere voortgang uit de worker", async () => {
  const nu = Date.now();
  const remote = { updated: 9, progress: { [FRANS.id]: { items: { 0: staat({ box: 4 }) }, sessions: [], updated: nu + 4 * 60 * 1000 } } };
  const { context, page, fouten } = await open({ sync: remote, zaai: {
    ["overhoor:progress:pia:" + FRANS.id]: { items: { 0: staat({ box: 1 }) }, sessions: [], updated: 1e308 },
  } });
  // lokaal 1e308 telt als hooguit nu plus 5 minuten; de worker zit daar net
  // onder en wint dus niet. De lokale tijd wordt begrensd opgeslagen, zodat
  // hij veroudert en nieuwere voortgang later weer wint.
  const p = await lees(page, "overhoor:progress:pia:" + FRANS.id);
  assert.equal(p.items[0].box, 1);
  const na = await page.evaluate(() => Date.now());
  assert.ok(p.updated >= nu && p.updated <= na + MARGE, "lokale 1e308 niet begrensd opgeslagen: " + p.updated);
  // de worker stuurt nu iets dat net nieuwer is dan de begrensde lokale tijd
  remote.progress[FRANS.id].updated = p.updated + 1;
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.waitForTimeout(400);
  assert.equal((await lees(page, "overhoor:progress:pia:" + FRANS.id)).items[0].box, 4, "nieuwere voortgang wint niet van lokaal 1e308");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: box -4 of 2.5 wordt een geldige box, due null kost niet de hele woordtoestand", async () => {
  const remote = { updated: 9, progress: { [FRANS.id]: { items: {
    0: staat({ box: -4 }), 1: staat({ box: 2.5 }), 2: staat({ box: 99 }), 3: staat({ due: null }), 4: staat({ seen: -3 }),
  }, sessions: [], updated: 5 } } };
  const { context, page, fouten } = await open({ sync: remote });
  const it = (await lees(page, "overhoor:progress:pia:" + FRANS.id)).items;
  assert.equal(it[0].box, 0);
  assert.equal(it[1].box, 2);
  assert.equal(it[2].box, 6);
  assert.deepEqual(it[3], staat({ due: 0 }));
  assert.equal(it[4].seen, 0);
  await bekijkAlles(page, FRANS.title);
  assert.deepEqual(fouten, []);
  await context.close();
});

// ---------- pariteit: app en worker passen dezelfde regels toe ----------

test("pariteit: schoneLijst, schoneStaat, schoneVoortgang en schoneCat in de app geven hetzelfde als de worker", async () => {
  const NU = 1_800_000_000_000;
  const lijst = (extra = {}) => ({ id: "custom-1", title: "Lijst", subject: "Engels", added: 3,
    items: [{ word: "cat", def: "kat" }, { word: "dog", def: "hond", cls: "Noun", section: "A" }], ...extra });
  const lijsten = [
    lijst(), null, 5, "x", [], lijst({ id: 12 }), lijst({ id: NaN }), lijst({ id: "x".repeat(101) }), lijst({ id: "constructor" }),
    lijst({ items: undefined }), lijst({ items: "x" }), lijst({ items: {} }),
    lijst({ title: "t".repeat(250) }), lijst({ title: 7 }), lijst({ title: undefined }),
    lijst({ items: [{ word: "w".repeat(1500), def: "d".repeat(1200), cls: "c".repeat(300), section: 4, ex: "e".repeat(1100) }] }),
    lijst({ items: [null, "x", 5, { word: 5, def: null }, { word: "a" }, { def: "b" }] }),
    lijst({ items: Array.from({ length: 5003 }, (_, i) => ({ word: "a" + i, def: "b" })) }),
    lijst({ items: [{ word: "a", def: "b", ex: ["Zin [een].", 4, "z".repeat(1200)], keys: [["kat", "poes"], "los", [1], Array(60).fill("k")], accept: Array(60).fill("x") }] }),
    lijst({ added: 1e308 }), lijst({ added: -5 }), lijst({ added: "gisteren" }), lijst({ added: Infinity }), lijst({ added: NU + 1 }),
    lijst({ subtitle: 5, mode: "m".repeat(300), from: "Frans", to: null, deadline: "2026-09-17", strict: "ja", interleave: true,
      directions: ["wd", "zz", 3, "dw"], classes: ["Noun", 3, "v".repeat(300)], sections: { A: "In de klas", B: 7, C: "s".repeat(300) },
      instructions: "kapot", mix: true, bronnen: ["a"], extra: "weg" }),
    lijst({ directions: Array(60).fill("wd") }),
  ];
  const staten = [
    staat(), null, "x", [], {}, staat({ box: -4 }), staat({ box: 2.5 }), staat({ box: 99 }), staat({ box: "<b>" }), staat({ due: null }),
    staat({ seen: -1, correct: NaN, wrong: Infinity, lapses: "x", streak: -0.5, last: -7 }),
    staat({ dirWrong: "x", partWrong: { cls: -1, def: 2, word: null, extra: 9 } }), staat({ extra: "weg" }),
  ];
  const voortgangen = [
    null, "x", [], { items: "kapot", sessions: "kapot", updated: 5 }, { items: [staat()], sessions: { 0: ronde() } },
    { items: { 0: staat(), 1: null, abc: staat(), 123456: staat(), 2: staat({ due: null }) }, sessions: [ronde(), null, ronde({ ms: "lang" }), ronde({ stopped: "ja" })], updated: 7 },
    { items: {}, sessions: [], updated: 1e308 }, { items: {}, sessions: [], updated: -1 }, { items: {}, sessions: [], updated: "gisteren" },
  ];
  const cats = [
    null, "x", {}, { aantal: 2, eerst: 1, laatst: 3, extra: "<b>" }, { aantal: "veel" }, { laatst: Infinity },
    { laatst: 1e308, eerst: 1e308, aantal: -3 }, { laatst: -1, eerst: -2 },
  ];
  const A = appVorm();
  const app = {
    lijsten: lijsten.map(l => A.schoneLijst(l, NU)),
    staten: staten.map(s => A.schoneStaat(s)),
    voortgangen: voortgangen.map(p => A.schoneVoortgang(p, NU)),
    cats: cats.map(c => A.schoneCat(c, NU)),
    proto: A.schoneLijst(JSON.parse('{"id":"a","title":"t","items":[],"sections":{"__proto__":"x","A":"b"}}'), NU),
  };
  // via JSON: objecten uit de vm hebben een ander Object.prototype
  const json = x => JSON.parse(JSON.stringify(x));
  for (const k of Object.keys(app)) app[k] = json(app[k]);
  const worker = {
    lijsten: lijsten.map(l => MERGE.controleerLijst(l, NU)),
    staten: staten.map(s => MERGE.controleerStaat(s)),
    voortgangen: voortgangen.map(p => MERGE.controleerVoortgang(p, NU)),
    cats: cats.map(c => MERGE.controleerCat(c, NU)),
    proto: MERGE.controleerLijst(JSON.parse('{"id":"a","title":"t","items":[],"sections":{"__proto__":"x","A":"b"}}'), NU),
  };
  for (const k of Object.keys(worker)) {
    if (Array.isArray(worker[k])) worker[k].forEach((w, i) => assert.deepEqual(app[k][i], json(w), k + "[" + i + "] verschilt"));
    else assert.deepEqual(app[k], json(worker[k]), k + " verschilt");
  }
  // en ze herstellen in plaats van weg te gooien: alleen geen object, geen
  // geldig id of geen items-array valt weg
  const weg = worker.lijsten.map((l, i) => l ? null : i).filter(i => i !== null);
  assert.deepEqual(weg, [1, 2, 3, 4, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(worker.staten.map(s => s === null), [false, true, true, true, false, false, false, false, false, false, false, false, false]);
});
