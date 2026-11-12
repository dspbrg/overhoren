// Vorm van voortgang, eigen lijsten en oude cats in de app. Wat in
// localStorage staat of van de sync-worker komt, kan een rare vorm hebben
// (items geen object, sessions geen array, een lijst zonder items). De app
// mag daar niet op vastlopen, en de goede data moet blijven.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { beantwoord, wachtOpScherm } from "./lib/schermen.mjs";

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
  { id: "custom-woord-null", title: "Kapot woord null", items: [{ word: "a", def: "b" }, null] },
  { id: "custom-woord-getal", title: "Kapot woord getal", items: [{ word: 5, def: "b" }] },
  { id: "custom-geen-titel", items: [{ word: "a", def: "b" }] },
  // een lijst van buiten mag geen gemengde lijst worden: mix valt weg, de lijst blijft
  { id: "custom-mix", title: "Was mix", mix: true, bronnen: ["x"], items: [{ word: "a", def: "b" }] },
];
const KAPOT = ["Kapot zonder items", "Kapot items tekst", "Kapot woord null", "Kapot woord getal"];

// ---------- localStorage ----------

test("localStorage: kapotte eigen lijsten laten het lessenscherm niet vastlopen, de goede blijven", async () => {
  const { context, page, fouten } = await open({ zaai: { "overhoor:lists": [goedeLijst, ...kapotteLijsten] } });
  const t = await titels(page);
  assert.ok(t.some(x => x.includes("Goede lijst")), "goede lijst ontbreekt: " + t.join(" | "));
  assert.ok(t.some(x => x.includes("Was mix")), "lijst met mix-veld ontbreekt");
  for (const k of KAPOT) assert.ok(!t.some(x => x.includes(k)), k + " staat er toch");
  assert.ok(t.some(x => x.includes(FRANS.title)), "ingebouwde lijsten weg");
  await bekijkAlles(page, "Goede lijst");
  await bekijkAlles(page, "Was mix");
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
  assert.deepEqual(Object.keys(e.items), ["0"]);
  assert.deepEqual(e.items[0], staat());
  assert.deepEqual(e.sessions, [ronde()]);
  assert.deepEqual(await lees(page, "overhoor:progress:pia:" + WL[0].id), goedeVoortgang, "goede voortgang aangetast");
  const w1 = await lees(page, "overhoor:progress:pia:" + WL[1].id);
  assert.deepEqual(w1, { items: {}, sessions: [], updated: 62 });
  const lijsten = await lees(page, "overhoor:lists");
  assert.deepEqual(lijsten.map(l => l.id).sort(), ["custom-goed", "custom-mix"]);
  assert.deepEqual(lijsten.find(l => l.id === "custom-goed"), goedeLijst);
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
