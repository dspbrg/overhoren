// Prullenbak over meer toestellen, met de echte sync-worker achter twee of
// drie browsers (tests/lib/nepworker.mjs): om de beurt verwijderen, terugzetten
// en definitief verwijderen en na elke stap op het andere toestel openen;
// een oude app die een levende kopie terugduwt; een verwijdering die uit de
// pull-code van index.html komt (niet uit merge.js); een lijst die op de
// server al langer dan 30 dagen in de prullenbak staat; en definitief
// verwijderen dat de voortgang van elke oefenaar op het toestel opruimt.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { wachtOpScherm, uitMenu } from "./lib/schermen.mjs";
import { nepWorker } from "./lib/nepworker.mjs";

const DAG = 24 * 60 * 60 * 1000;
const LKEY = "overhoor:lists";
const CODE = "zwaluw-karton-bonbon-08";
const sha = s => createHash("sha256").update(s).digest("hex");
const REC = "persoon:" + sha(CODE);
const P = (id, s = "pia") => `overhoor:progress:${s}:${id}`;
const staat = { box: 3, due: 1, seen: 2, correct: 2, wrong: 0, lapses: 0, streak: 2, last: 1, dirWrong: {}, partWrong: {} };
const voortgang = updated => ({ items: { 0: staat }, sessions: [], updated });
const eigen = (id, title, extra = {}) => ({ id, title, subject: "Duits", mode: "translate", from: "Duits", to: "Nederlands", directions: ["wd"], added: 1000,
  items: [{ word: "der Hund", def: "de hond" }, { word: "die Katze", def: "de kat" }], ...extra });

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function toestel(w, { zaai = {}, code = CODE } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, serviceWorkers: "block", locale: "nl-NL" });
  await schermNetwerkAf(context);
  await w.koppel(context);
  const alles = Object.assign({ "overhoor:klas": true }, code ? { "overhoor:code:pia": code } : {}, zaai);
  await context.addInitScript(z => {
    if (sessionStorage.getItem("test:gezaaid")) return;
    sessionStorage.setItem("test:gezaaid", "1");
    for (const [k, v] of Object.entries(z)) localStorage.setItem(k, JSON.stringify(v));
  }, alles);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  await rust(page);
  return { context, page, fouten };
}
// wacht tot de eerste pull klaar is
const rust = page => page.waitForTimeout(500);
async function herlaad(t) { await t.page.reload(); await wachtOpScherm(t.page, "scr-lessons"); await rust(t.page); }
const lees = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
const ids = page => page.evaluate(() => [...document.querySelectorAll("#lessons .lesson")].map(b => b.dataset.id));
const een = (lijsten, id) => (lijsten || []).find(l => l && l.id === id);
async function wachtTot(fn, ms = 6000) {
  const eind = Date.now() + ms;
  for (;;) { const v = await fn(); if (v || Date.now() > eind) return v; await new Promise(r => setTimeout(r, 50)); }
}
async function verwijder(page, id) {
  await page.locator(`#lessons .lesson[data-id="${id}"]`).click();
  await wachtOpScherm(page, "scr-home");
  await page.click("#btn-delete-list");
  await wachtOpScherm(page, "scr-lessons");
}
async function prullenbak(page) { await uitMenu(page, "#btn-prullenbak"); await wachtOpScherm(page, "scr-prullenbak"); }
async function terugNaarStart(page) { await page.click("#btn-prullenbak-back"); await wachtOpScherm(page, "scr-lessons"); }
const zonderVerbinding = f => f.filter(x => !/Failed to load resource|net::|workers\.dev/i.test(String(x)));

test("twee toestellen om de beurt: verwijderen, terugzetten, opnieuw verwijderen en definitief, nooit komt iets terug", async () => {
  const nu = Date.now();
  const w = nepWorker({ [REC]: {
    lists: [eigen("custom-1", "Unité 2", { added: nu - 5 * DAG }), eigen("custom-2", "Blijft", { added: nu - 5 * DAG })],
    progress: { "custom-1": voortgang(nu - DAG) }, updated: nu - DAG } });
  const a = await toestel(w), b = await toestel(w);
  assert.deepEqual((await ids(a.page)).filter(i => i.startsWith("custom")).sort(), ["custom-1", "custom-2"]);
  assert.deepEqual((await ids(b.page)).filter(i => i.startsWith("custom")).sort(), ["custom-1", "custom-2"]);
  await a.page.evaluate(([k, v]) => localStorage.setItem(k, v), [P("custom-1"), JSON.stringify(voortgang(nu))]);

  // 1. A verwijdert, de server krijgt weg
  await verwijder(a.page, "custom-1");
  assert.ok(await wachtTot(() => een(w.kv(REC).lists, "custom-1")?.weg > 0), "de verwijdering kwam niet op de server");
  assert.equal(een(w.kv(REC).lists, "custom-1").items.length, 2, "de lijst in de prullenbak houdt zijn woorden");
  assert.ok(w.kv(REC).progress["custom-1"], "de voortgang van een lijst in de prullenbak blijft");

  // 2. B opent de app: de lijst is daar ook weg, en staat in de prullenbak
  await herlaad(b);
  assert.ok(!(await ids(b.page)).includes("custom-1"), "B toont een verwijderde lijst");
  assert.ok(een(await lees(b.page, LKEY), "custom-1").weg > 0);
  // 3. B zet terug
  await prullenbak(b.page);
  await b.page.click('#prullenbak-body .prullen[data-id="custom-1"] [data-actie="terug"]');
  await terugNaarStart(b.page);
  assert.ok(await wachtTot(async () => !("weg" in (een(w.kv(REC).lists, "custom-1") || { weg: 1 }))), "de terugzetting kwam niet op de server");
  assert.equal(een(w.kv(REC).lists, "custom-1").items.length, 2);

  // 4. A opent de app: de lijst is terug
  await herlaad(a);
  assert.ok((await ids(a.page)).includes("custom-1"), "A mist de teruggezette lijst");
  assert.equal(een(await lees(a.page, LKEY), "custom-1").weg, undefined);

  // 5. A verwijdert opnieuw, B (nog levend op het scherm) pusht een andere wijziging: de verwijdering blijft
  await verwijder(a.page, "custom-1");
  assert.ok(await wachtTot(() => een(w.kv(REC).lists, "custom-1")?.weg > 0));
  await verwijder(b.page, "custom-2");   // B duwt zijn lijsten, met een nog levende custom-1
  assert.ok(await wachtTot(() => een(w.kv(REC).lists, "custom-2")?.weg > 0));
  assert.ok(een(w.kv(REC).lists, "custom-1").weg > 0, "de oude levende kopie van B won van de verwijdering");

  // 6. A maakt hem definitief
  await prullenbak(a.page);
  await a.page.click('#prullenbak-body .prullen[data-id="custom-1"] [data-actie="wis"]');
  await a.page.click('[data-actie="ja"]');
  await terugNaarStart(a.page);
  assert.ok(await wachtTot(() => een(w.kv(REC).lists, "custom-1")?.gewist > 0), "de grafsteen kwam niet op de server");
  const steen = een(w.kv(REC).lists, "custom-1");
  assert.equal(steen.title, ""); assert.deepEqual(steen.items, []);
  assert.equal(w.kv(REC).progress["custom-1"], undefined, "de voortgang van de grafsteen staat nog op de server");

  // 7. B (met nog de lijst in de prullenbak en voortgang) haalt de grafsteen op en ruimt op
  await herlaad(b);
  assert.ok(een(await lees(b.page, LKEY), "custom-1").gewist > 0, "B heeft de grafsteen niet");
  assert.equal(await lees(b.page, P("custom-1")), null, "B ruimde de voortgang niet op");
  await prullenbak(b.page);
  assert.deepEqual(await b.page.locator("#prullenbak-body .prullen").evaluateAll(k => k.map(x => x.dataset.id)), ["custom-2"]);
  // en B kan custom-1 niet meer terugbrengen met een nieuwe push
  await terugNaarStart(b.page);
  await b.page.evaluate(() => { const l = JSON.parse(localStorage.getItem("overhoor:lists")); l.find(x => x.id === "custom-2").bijgewerkt = Date.now(); localStorage.setItem("overhoor:lists", JSON.stringify(l)); });
  await herlaad(a);
  assert.ok(!(await ids(a.page)).includes("custom-1"));
  assert.ok(een(w.kv(REC).lists, "custom-1").gewist > 0);
  assert.deepEqual(zonderVerbinding(a.fouten), []); assert.deepEqual(zonderVerbinding(b.fouten), []);
  await a.context.close(); await b.context.close();
});

test("oude app: een levende kopie zonder bijgewerkt, door de pull of met een PUT teruggeduwd, komt niet terug", async () => {
  const nu = Date.now();
  const weg = nu - 3 * DAG;
  const w = nepWorker({ [REC]: {
    lists: [{ id: "custom-1", title: "", items: [], weg: weg - DAG, gewist: weg, bijgewerkt: weg, added: nu - 20 * DAG },
      eigen("custom-2", "In de bak", { added: nu - 20 * DAG, weg, bijgewerkt: weg })],
    updated: weg } });
  // een oud toestel: levende kopieen zonder bijgewerkt en met voortgang
  const oud = await toestel(w, { zaai: {
    [LKEY]: [eigen("custom-1", "Oud toestel", { added: nu - 20 * DAG }), eigen("custom-2", "Oud toestel 2", { added: nu - 20 * DAG })],
    [P("custom-1")]: voortgang(nu - DAG) } });
  const lokaal = await lees(oud.page, LKEY);
  assert.ok(een(lokaal, "custom-1").gewist > 0, "de pull bracht een grafsteen niet naar het oude toestel");
  assert.ok(een(lokaal, "custom-2").weg > 0, "de pull zette de lijst niet in de prullenbak");
  assert.ok(!(await ids(oud.page)).some(i => i === "custom-1" || i === "custom-2"));
  assert.equal(await lees(oud.page, P("custom-1")), null);
  // een echte oude app stuurt zijn PUT zonder bijgewerkt, weg en klasWeg
  const status = await oud.page.evaluate(async ([c, lijsten, vg]) => {
    const r = await fetch("https://overhoren-api.y8n876dtrq.workers.dev/sync", { method: "PUT", headers: { "x-code": c, "Content-Type": "application/json" },
      body: JSON.stringify({ cats: {}, progress: { "custom-1": vg }, lists: lijsten, updated: Date.now() }) });
    return r.status;
  }, [CODE, [eigen("custom-1", "Oud toestel", { added: nu - 20 * DAG }), eigen("custom-2", "Oud toestel 2", { added: nu - 20 * DAG })], voortgang(nu)]);
  assert.equal(status, 200);
  const rec = w.kv(REC);
  assert.ok(een(rec.lists, "custom-1").gewist > 0, "een oude PUT bracht de grafsteen terug als lijst");
  assert.deepEqual(een(rec.lists, "custom-1").items, []);
  assert.ok(een(rec.lists, "custom-2").weg > 0, "een oude PUT haalde de lijst uit de prullenbak");
  assert.equal(rec.progress["custom-1"], undefined, "de voortgang van de grafsteen kwam terug");
  assert.deepEqual(rec.klasWeg || {}, {});
  await oud.context.close();
});

test("pull in de app: een lijst die op de server al meer dan 30 dagen weg is, wordt hier een grafsteen en ruimt alle oefenaars op", async () => {
  const nu = Date.now();
  const weg = nu - 31 * DAG, jong = nu - 29 * DAG;
  // de worker zet dit zelf ook om, dus de pull krijgt hier een ongewijzigd antwoord via een eigen route
  const w = nepWorker();
  const t = await (async () => {
    const context = await browser.newContext({ viewport: { width: 360, height: 900 }, serviceWorkers: "block", locale: "nl-NL" });
    await schermNetwerkAf(context);
    await context.route(/workers\.dev\/sync/, route => route.fulfill({ status: 200, contentType: "application/json", headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" },
      body: JSON.stringify(route.request().method() === "PUT" ? {} : { updated: 9, lists: [
        eigen("custom-1", "Oud", { weg, bijgewerkt: weg }), eigen("custom-2", "Jong", { weg: jong, bijgewerkt: jong })] }) }));
    const zaai = { "overhoor:code:pia": CODE, "overhoor:klas": true, "overhoor:learners": ["Pia", "Noor"],
      [P("custom-1")]: voortgang(1), [P("custom-1", "noor")]: voortgang(1), [P("custom-2")]: voortgang(1), [P("custom-2", "noor")]: voortgang(1),
      "overhoor:session:noor:custom-1": { queue: [], pos: 0 } };
    await context.addInitScript(z => { if (sessionStorage.getItem("g")) return; sessionStorage.setItem("g", "1"); for (const [k, v] of Object.entries(z)) localStorage.setItem(k, JSON.stringify(v)); }, zaai);
    const page = await context.newPage();
    const fouten = volgFouten(page);
    await page.goto(server.url + "/index.html");
    await wachtOpScherm(page, "scr-lessons");
    await page.waitForTimeout(600);
    return { context, page, fouten };
  })();
  const l = await lees(t.page, LKEY);
  assert.deepEqual(een(l, "custom-1"), { id: "custom-1", title: "", items: [], weg, gewist: weg + 30 * DAG, bijgewerkt: weg + 30 * DAG, added: 1000 });
  assert.equal(een(l, "custom-2").gewist, undefined);
  assert.equal(een(l, "custom-2").weg, jong);
  for (const k of [P("custom-1"), P("custom-1", "noor"), "overhoor:session:noor:custom-1"]) assert.equal(await lees(t.page, k), null, k + " is niet opgeruimd");
  for (const k of [P("custom-2"), P("custom-2", "noor")]) assert.ok(await lees(t.page, k), k + " is te vroeg opgeruimd");
  void w;
  await t.context.close();
});

test("definitief verwijderen en een grafsteen uit de pull ruimen de voortgang van elke oefenaar op, ook van een lijst met een getal als id", async () => {
  const nu = Date.now();
  const w = nepWorker({ [REC]: { lists: [{ id: 7, title: "", items: [], gewist: nu - DAG, bijgewerkt: nu - DAG }], updated: nu - DAG } });
  const t = await toestel(w, { zaai: {
    "overhoor:learners": ["Pia", "Noor", "Sem"], [LKEY]: [eigen(7, "Getal", { added: nu - 9 * DAG }), eigen("custom-3", "Los", { weg: nu - DAG, bijgewerkt: nu - DAG })],
    [P(7)]: voortgang(1), [P(7, "noor")]: voortgang(1), [P(7, "sem")]: voortgang(1), [P("custom-3")]: voortgang(1), [P("custom-3", "sem")]: voortgang(1),
    "overhoor:current": "custom-3" } });
  // de pull bracht de grafsteen voor lijst 7
  assert.ok(een(await lees(t.page, LKEY), 7).gewist > 0);
  for (const s of ["pia", "noor", "sem"]) assert.equal(await lees(t.page, P(7, s)), null, "voortgang van " + s + " blijft staan");
  // definitief via het scherm: ook Sem en de huidige lijst
  await prullenbak(t.page);
  await t.page.click('#prullenbak-body .prullen[data-id="custom-3"] [data-actie="wis"]');
  await t.page.click('[data-actie="ja"]');
  for (const s of ["pia", "sem"]) assert.equal(await lees(t.page, P("custom-3", s)), null, "voortgang van " + s + " blijft staan");
  assert.notEqual(await lees(t.page, "overhoor:current"), "custom-3", "de laatste lijst wijst nog naar een grafsteen");
  await terugNaarStart(t.page);
  assert.ok(await wachtTot(() => een(w.kv(REC).lists, "custom-3")?.gewist > 0));
  assert.deepEqual(zonderVerbinding(t.fouten), []);
  await t.context.close();
});

// ---------- samenvoegen in de worker, over meer stappen ----------

const { mergeSync, PRULLENBAK_DAGEN } = await import(new URL("file://" + (process.env.WORKER_SRC || new URL("../worker/src", import.meta.url).pathname) + "/merge.js"));
const NU = 1_800_000_000_000;
const lijstW = (extra = {}) => ({ id: "custom-1", title: "Lijst", subject: "Engels", added: 100, items: [{ word: "cat", def: "kat" }], ...extra });
const klonen = x => JSON.parse(JSON.stringify(x));

test("worker: twee toestellen om de beurt, de laatste handeling wint en een oude levende kopie komt nooit terug", () => {
  let server = mergeSync({}, { lists: [lijstW()] }, NU);
  // A verwijdert
  const a1 = lijstW({ weg: NU - 5000, bijgewerkt: NU - 5000 });
  server = mergeSync(server, { lists: [a1] }, NU);
  assert.equal(server.lists[0].weg, NU - 5000);
  // B heeft nog de oude levende kopie en pusht hem
  server = mergeSync(server, { lists: [lijstW()] }, NU);
  assert.equal(server.lists[0].weg, NU - 5000, "oude kopie won van de verwijdering");
  // B zet terug
  server = mergeSync(server, { lists: [lijstW({ bijgewerkt: NU - 4000 })] }, NU);
  assert.equal("weg" in server.lists[0], false);
  // A pusht zijn verwijdering opnieuw (oud): de terugzetting blijft
  server = mergeSync(server, { lists: [a1] }, NU);
  assert.equal("weg" in server.lists[0], false, "een oudere verwijdering won van de terugzetting");
  // A verwijdert opnieuw en maakt definitief
  server = mergeSync(server, { lists: [lijstW({ weg: NU - 3000, bijgewerkt: NU - 3000 })] }, NU);
  server = mergeSync(server, { lists: [{ id: "custom-1", title: "", items: [], weg: NU - 3000, gewist: NU - 2000, bijgewerkt: NU - 2000 }], progress: { "custom-1": { items: {}, sessions: [], updated: 1 } } }, NU);
  assert.ok(server.lists[0].gewist > 0);
  // B pusht alles wat het ooit had, met voortgang: de grafsteen blijft, de voortgang komt niet terug
  for (const oud of [lijstW(), lijstW({ bijgewerkt: NU - 4000 }), lijstW({ weg: NU - 3000, bijgewerkt: NU - 3000 })]) {
    server = mergeSync(server, { lists: [oud], progress: { "custom-1": { items: {}, sessions: [], updated: NU } } }, NU);
    assert.equal(server.lists.length, 1);
    assert.equal(server.lists[0].gewist, NU - 2000);
    assert.deepEqual(server.lists[0].items, []);
    assert.equal(server.progress["custom-1"], undefined);
  }
  // en het resultaat is stabiel: nog eens samenvoegen met zichzelf verandert niets
  assert.deepEqual(klonen(mergeSync(server, klonen(server), NU)), klonen(server));
});

test("worker: de grens van 30 dagen op de milliseconde, en een grafsteen na 30 dagen wint van een terugzetting die ouder is dan de verlooptijd", () => {
  const B = PRULLENBAK_DAGEN * DAG;
  const op = mergeSync({ lists: [lijstW({ weg: NU - B, bijgewerkt: NU - B })] }, {}, NU).lists[0];
  assert.equal(op.gewist, undefined, "precies 30 dagen is nog een lijst");
  const over = mergeSync({}, { lists: [lijstW({ weg: NU - B - 1, bijgewerkt: NU - B - 1 })], progress: { "custom-1": { items: {}, sessions: [], updated: 1 } } }, NU);
  assert.equal(over.lists[0].gewist, NU - 1);
  assert.equal(over.lists[0].bijgewerkt, NU - 1);
  assert.deepEqual(over.lists[0].items, []);
  assert.equal(over.progress["custom-1"], undefined);
  // een toestel dat de lijst vlak voor het verlopen terugzette (bijgewerkt later dan gewist) wint wel
  const terug = lijstW({ bijgewerkt: NU });
  assert.equal(mergeSync(over, { lists: [terug] }, NU).lists[0].gewist, undefined);
  // een terugzetting van voor het verlopen verliest
  assert.equal(mergeSync(over, { lists: [lijstW({ bijgewerkt: NU - B - 5 })] }, NU).lists[0].gewist, NU - 1);
});
