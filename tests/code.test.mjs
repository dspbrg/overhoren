// Sync per persoon met een eigen code. Zonder browser: de woordlijst en de
// codefuncties in index.html tegen die van de worker. In de browser, met de
// echte worker achter de app (tests/lib/nepworker.mjs): de knop "Op een
// ander toestel verder" met code en link, de code invullen op een tweede
// toestel, de #code=-link, de overstap van het oude wachtwoord en dat een
// naam alleen niets meer ophaalt.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";
import { nepWorker } from "./lib/nepworker.mjs";

const SRC = process.env.WORKER_SRC || join(REPO, "worker", "src");
const CODE = await import(pathToFileURL(join(SRC, "code.js")).href);
const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const sha = s => createHash("sha256").update(s).digest("hex");
const HTML = readFileSync(join(REPO, "index.html"), "utf8");

// De codefuncties uit index.html: het blok "code per persoon" tot de sync.
function appCode() {
  const begin = HTML.indexOf("// ---------- code per persoon");
  const eind = HTML.indexOf("// Een code per oefenaar op dit toestel");
  assert.ok(begin > 0 && eind > begin, "codeblok niet gevonden in index.html");
  const c = vm.createContext({ crypto: globalThis.crypto });
  vm.runInContext(HTML.slice(begin, eind) + "\nthis.code = { CODE_WOORDEN, geldigeCode, schoneCode, maakCode };", c);
  return c.code;
}

const LIJST_ID = (() => {
  const c = vm.createContext({}); c.window = c;
  vm.runInContext(readFileSync(join(REPO, "lists.js"), "utf8"), c);
  return c.WORDLISTS[0].id;
})();
const staat = { box: 3, due: 1, seen: 2, correct: 2, wrong: 0, lapses: 0, streak: 2, last: 1,
  dirWrong: { wd: 0, dw: 0, ex: 0 }, partWrong: { cls: 0, def: 0, word: 0 } };
// een plaatje van 1 bij 1 pixel, voor de foto-import
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const voortgang = (updated, box = 3) => ({ items: { 0: { ...staat, box } }, sessions: [], updated });

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// Een toestel: eigen browsercontext, dezelfde worker. zaai: localStorage
// (als JSON), eenmalig. pad: achter /index.html, bijvoorbeeld "#code=...".
async function toestel(w, { naam = true, zaai = {}, pad = "", thema = "light", breedte = 360, voorWorker = null } = {}) {
  const context = await browser.newContext({ naam, viewport: { width: breedte, height: 900 }, colorScheme: thema, serviceWorkers: "block", locale: "nl-NL" });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: server.url });
  const extern = await schermNetwerkAf(context);
  await w.koppel(context);
  if (voorWorker) await voorWorker(context);
  if (Object.keys(zaai).length) await context.addInitScript(z => {
    if (sessionStorage.getItem("test:gezaaid")) return;
    sessionStorage.setItem("test:gezaaid", "1");
    for (const [k, v] of Object.entries(z)) localStorage.setItem(k, JSON.stringify(v));
  }, zaai);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  const console_ = [];
  page.on("console", m => console_.push(m.text()));
  await page.goto(server.url + "/index.html" + pad);
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten, extern, console: console_ };
}
const lees = (page, k) => page.evaluate(k => JSON.parse(localStorage.getItem(k)), k);
async function wachtTot(fn, ms = 4000) {
  const eind = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > eind) return v;
    await new Promise(r => setTimeout(r, 50));
  }
}
async function openPaneel(page) {
  await page.click("#btn-ander-toestel");
  await page.locator("#code-plek .code-paneel").waitFor({ state: "visible", timeout: 5000 });
  return (await page.locator("#code-tekst").textContent()).trim();
}
// De code staat nergens in beeld behalve in het paneel, en niet in de console.
async function alleenInPaneel(page, code, consoleRegels) {
  const buiten = await page.evaluate(code => {
    const kloon = document.body.cloneNode(true);
    kloon.querySelector("#code-plek")?.remove();
    return kloon.innerHTML.includes(code) || document.title.includes(code) || location.href.includes(code);
  }, code);
  assert.equal(buiten, false, "de code staat buiten het paneel");
  assert.equal(consoleRegels.some(r => r.includes(code)), false, "de code staat in de console");
}

// ---------- zonder browser ----------

test("code: de woordlijst in index.html is gelijk aan die van de worker", () => {
  const app = appCode();
  assert.deepEqual([...app.CODE_WOORDEN], CODE.CODE_WOORDEN);
  assert.ok(app.CODE_WOORDEN.length >= 1000);
});

test("code: de app maakt geldige codes en leest getypte of geplakte codes goed", () => {
  const app = appCode();
  const codes = Array.from({ length: 1000 }, () => app.maakCode());
  for (const c of codes) assert.ok(CODE.geldigeCode(c), "de worker vindt de code van de app ongeldig: " + c);
  assert.equal(new Set(codes).size, codes.length);
  const goed = "panda-mango-wolk-47";
  for (const invoer of [goed, " panda-mango-wolk-47 ", "Panda Mango Wolk 47", "PANDA-MANGO-WOLK-47", "panda mango wolk47",
    "panda_mango_wolk_47", "https://overhoren.vandaan.net/#code=panda-mango-wolk-47", "pánda-mango-wolk-47"]) {
    assert.equal(app.schoneCode(invoer), goed, invoer);
  }
  for (const fout of ["", "panda-mango-47", "panda-mango-wolk-4", "tijger-mango-wolk-47", "panda-mango-wolk-kous-47", null, "x".repeat(500)]) {
    assert.equal(app.schoneCode(fout), "", String(fout).slice(0, 30));
  }
  for (const w of [CODE.CODE_WOORDEN[0], CODE.CODE_WOORDEN.at(-1)]) assert.ok(app.geldigeCode(w + "-" + w + "-" + w + "-00"));
});

test("scripts/code-hash.mjs: geeft alleen de hash, nooit de code", () => {
  const script = join(REPO, "scripts", "code-hash.mjs");
  const uit = spawnSync(process.execPath, [script], { input: "Panda Mango Wolk 47\n", encoding: "utf8" });
  assert.equal(uit.status, 0, uit.stderr);
  assert.equal(uit.stdout.trim(), sha("panda-mango-wolk-47"));
  assert.doesNotMatch(uit.stdout + uit.stderr, /panda|mango|wolk/i);
  const fout = spawnSync(process.execPath, [script], { input: "panda-mango-47\n", encoding: "utf8" });
  assert.equal(fout.status, 1);
  assert.doesNotMatch(fout.stdout + fout.stderr, /panda|mango/i);
  const arg = spawnSync(process.execPath, [script, "panda-mango-wolk-47"], { input: "", encoding: "utf8" });
  assert.equal(arg.status, 2, "een code als argument wordt niet geweigerd");
  assert.equal(arg.stdout, "");
});

// ---------- in de browser ----------

test("knop: Op een ander toestel verder toont een code en de link, en de code staat nergens anders", async () => {
  const w = nepWorker();
  const { context, page, fouten, console: con } = await toestel(w, { zaai: { ["overhoor:progress:pia:" + LIJST_ID]: voortgang(Date.now() - 5000) } });
  assert.equal(await page.locator("#code-plek").isVisible(), false, "het paneel staat al open");
  assert.equal(await lees(page, "overhoor:code:pia"), null, "er is al een code voor iemand tikte");
  assert.deepEqual(w.verzoeken, [], "zonder code toch sync");
  const code = await openPaneel(page);
  assert.ok(CODE.geldigeCode(code), "geen geldige code: " + code);
  assert.equal(await lees(page, "overhoor:code:pia"), code);
  assert.equal((await page.locator("#code-link").textContent()).trim(), server.url + "/index.html#code=" + code);
  assert.equal(await page.getAttribute("#btn-ander-toestel", "aria-expanded"), "true");
  assert.equal((await page.locator("#code-uitleg").textContent()).trim(), "Je voortgang wordt per lijst samengevoegd: het nieuwste telt.");
  // de voortgang staat meteen op de server, onder de hash
  const record = await wachtTot(() => w.kv("persoon:" + sha(code)));
  assert.ok(record, "niets naar de worker gestuurd");
  assert.deepEqual(Object.keys(record.progress), [LIJST_ID]);
  assert.ok(w.verzoeken.every(v => v.pad === "/sync" && v.koppen["x-code"] === code && !("x-api-token" in v.koppen)));
  assert.equal(w.sleutels().some(k => k.includes(code)), false, "de code zelf staat in KV");
  // kopieren
  await page.click("#btn-code-kopieer");
  await page.locator("#code-melding", { hasText: "Gekopieerd." }).waitFor();
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), code);
  await page.click("#btn-link-kopieer");
  await wachtTot(async () => (await page.evaluate(() => navigator.clipboard.readText())).includes("#code="));
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), server.url + "/index.html#code=" + code);
  await alleenInPaneel(page, code, con);
  // dicht en weer open: dezelfde code
  await page.click("#btn-code-sluit");
  assert.equal(await page.locator("#code-plek").isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.id), "btn-ander-toestel");
  assert.equal(await openPaneel(page), code);
  // na herladen: dicht, en de code blijft
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.equal(await page.locator("#code-plek").isVisible(), false);
  assert.equal(await openPaneel(page), code);
  // wisselen van naam sluit het paneel; een ander krijgt een eigen code
  await page.click("#btn-learner");
  assert.equal(await page.locator("#code-plek").isVisible(), false, "paneel open bij wisselen");
  await page.fill("#learner-name", "Tom"); await page.press("#learner-name", "Enter");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  const tom = await openPaneel(page);
  assert.notEqual(tom, code);
  assert.equal(await lees(page, "overhoor:code:pia"), code, "de code van Pia is weg");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("tweede toestel: de code invullen haalt de voortgang op en voegt hem samen", async () => {
  const w = nepWorker();
  const nu = Date.now();
  const a = await toestel(w, { zaai: { ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 5000, 4) } });
  const code = await openPaneel(a.page);
  await wachtTot(() => w.kv("persoon:" + sha(code)));
  // het tweede toestel heeft een eigen lijst en een eigen code
  const eigen = { id: "custom-b", title: "Lijst van B", subject: "Engels", added: nu - 1000, items: [{ word: "cat", def: "kat" }] };
  const b = await toestel(w, { zaai: { "overhoor:lists": [eigen] } });
  assert.deepEqual(w.verzoeken.filter(v => v.koppen["x-code"] !== code), [], "het tweede toestel synct zonder code");
  const eigenCode = await openPaneel(b.page);
  assert.notEqual(eigenCode, code);
  // fout getypt: melding, niets veranderd
  await b.page.fill("#code-invoer", "panda-mango-47");
  await b.page.click("#btn-code-gebruik");
  await b.page.locator("#code-melding", { hasText: "Deze code klopt niet." }).waitFor();
  assert.equal(await lees(b.page, "overhoor:code:pia"), eigenCode);
  // goed, met hoofdletters en spaties zoals een kind het typt
  await b.page.fill("#code-invoer", " " + code.toUpperCase().replace(/-/g, " ") + " ");
  await b.page.press("#code-invoer", "Enter");
  // B had al een eigen code met data: eerst de vraag, met de eigen code in beeld, en nog niets gestuurd
  await b.page.locator("#code-vraag", { hasText: "Deze code hoort bij iemand anders of bij een ander toestel. Wil je overstappen?" }).waitFor({ timeout: 5000 });
  assert.equal((await b.page.locator("#code-tekst").textContent()).trim(), eigenCode);
  assert.equal(await lees(b.page, "overhoor:code:pia"), eigenCode, "overgestapt voor de bevestiging");
  assert.equal((w.kv("persoon:" + sha(code)).lists || []).some(l => l.id === "custom-b"), false, "naar de nieuwe code geduwd voor de bevestiging");
  await b.page.click("#btn-code-over");
  await b.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(b.page, "overhoor:code:pia"), code);
  assert.equal((await b.page.locator("#code-tekst").textContent()).trim(), code, "het paneel toont de oude code nog");
  // de vorige code staat erbij, zodat je terug kunt
  assert.equal(await lees(b.page, "overhoor:code-vorige:pia"), eigenCode);
  assert.equal((await b.page.locator("#code-vorige").textContent()).trim(), eigenCode);
  const p = await lees(b.page, "overhoor:progress:pia:" + LIJST_ID);
  assert.equal(p.items[0].box, 4, "de voortgang van het eerste toestel is niet opgehaald");
  // de lijst van B gaat naar de server en komt op A bij een volgende pull
  await wachtTot(() => (w.kv("persoon:" + sha(code))?.lists || []).some(l => l.id === "custom-b"));
  assert.ok(w.kv("persoon:" + sha(code)).lists.some(l => l.id === "custom-b"), "de lijst van B is niet samengevoegd");
  await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
  await wachtTot(async () => (await lees(a.page, "overhoor:lists") || []).some(l => l.id === "custom-b"));
  assert.ok((await lees(a.page, "overhoor:lists")).some(l => l.id === "custom-b"), "A ziet de lijst van B niet");
  await alleenInPaneel(b.page, code, b.console);
  assert.deepEqual(a.fouten, []); assert.deepEqual(b.fouten, []);
  await a.context.close(); await b.context.close();
});

test("link: #code= op een nieuw toestel haalt de voortgang op, ook als de naam nog moet komen", async () => {
  const code = "zwaluw-karton-bonbon-08";
  const w = nepWorker({ ["persoon:" + sha(code)]: { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 5) }, updated: Date.now() - 1000 } });
  // met een naam
  const a = await toestel(w, { pad: "#code=" + code });
  await a.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(a.page, "overhoor:code:pia"), code);
  assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 5);
  assert.equal(await a.page.evaluate(() => location.hash), "", "de code blijft in de adresbalk staan");
  // zonder naam: eerst de naam, dan pas ophalen
  await a.page.waitForTimeout(2500);   // de push van A is klaar
  const voor = w.verzoeken.length;
  const b = await toestel(w, { naam: false, pad: "#code=" + code.toUpperCase() });
  assert.equal(await b.page.evaluate(() => location.hash), "");
  await b.page.waitForTimeout(300);
  assert.equal(w.verzoeken.length, voor, "sync zonder naam");
  assert.equal(await lees(b.page, "overhoor:progress:pia:" + LIJST_ID), null);
  await b.page.fill("#learner-name", "Pia"); await b.page.press("#learner-name", "Enter");
  await b.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.ok(w.verzoeken.length > voor);
  assert.equal(await lees(b.page, "overhoor:code:pia"), code);
  assert.equal(await lees(b.page, "overhoor:code-nieuw"), null);
  assert.equal((await lees(b.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 5);
  // een kapotte code in de link doet niets
  const c = await toestel(w, { pad: "#code=panda-mango-47" });
  await c.page.waitForTimeout(300);
  assert.equal(await lees(c.page, "overhoor:code:pia"), null);
  assert.equal(await c.page.locator("#code-plek").isVisible(), false);
  for (const t of [a, b, c]) { assert.deepEqual(t.fouten, []); await t.context.close(); }
});

test("overstap: een toestel met het wachtwoord krijgt een code, het wachtwoord verdwijnt, en een tweede toestel met dezelfde naam krijgt dezelfde code", async () => {
  const oud = { progress: { [LIJST_ID]: voortgang(Date.now() - 60000, 2) }, updated: Date.now() - 60000 };
  const w = nepWorker({ "learner:pia": oud });
  const a = await toestel(w, { zaai: { "overhoor:app-secret": "geheim" } });
  const code = await wachtTot(() => lees(a.page, "overhoor:code:pia"));
  assert.ok(CODE.geldigeCode(code), "geen code na de overstap");
  assert.equal(code, w.migratie("pia"));
  assert.equal(await lees(a.page, "overhoor:app-secret"), null, "het wachtwoord staat er nog");
  await wachtTot(async () => (await lees(a.page, "overhoor:progress:pia:" + LIJST_ID))?.items?.[0]?.box === 2);
  assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 2, "oude voortgang niet opgehaald");
  const paden = w.verzoeken.map(v => v.methode + " " + v.pad);
  assert.equal(paden[0], "POST /migreer");
  assert.ok(paden.slice(1).every(p => p === "GET /sync" || p === "PUT /sync"), "na de overstap toch de oude route: " + paden.join(", "));
  assert.equal(await openPaneel(a.page), code, "het paneel toont een andere code");
  // het tweede toestel van Pia, met dezelfde naam (ook met een andere schrijfwijze)
  const b = await toestel(w, { zaai: { "overhoor:app-secret": "geheim", "overhoor:learner": "pía", "overhoor:learners": ["pía"] } });
  assert.equal(await wachtTot(() => lees(b.page, "overhoor:code:pia")), code, "tweede toestel kreeg een andere code");
  assert.equal(await lees(b.page, "overhoor:app-secret"), null);
  // na herladen geen nieuwe overstap
  const n = w.verzoeken.filter(v => v.pad === "/migreer").length;
  await b.page.reload(); await wachtOpScherm(b.page, "scr-lessons");
  await b.page.waitForTimeout(300);
  assert.equal(w.verzoeken.filter(v => v.pad === "/migreer").length, n);
  // de foto-import stuurt de code mee (voor ONBEPERKT), zonder wachtwoord
  const fotoKoppen = [];
  await b.context.route(/workers\.dev\/extract/, route => {
    fotoKoppen.push(route.request().headers());
    return route.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: "Grens bereikt", grens: "toestel" }),
      headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  });
  await b.page.click("#btn-import");
  await b.page.click("#btn-photo-start");
  await b.page.setInputFiles("#photo-input", { name: "b.png", mimeType: "image/png", buffer: Buffer.from(PNG, "base64") });
  await b.page.locator("#photo-actions").waitFor({ state: "visible", timeout: 5000 });
  await b.page.click('.photo-type-btn[data-type="anders"]');
  await b.page.locator("#photo-error").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(fotoKoppen.length, 1);
  assert.equal(fotoKoppen[0]["x-code"], code);
  assert.equal("x-api-token" in fotoKoppen[0], false);
  await b.page.click("#btn-photo-back"); await b.page.click("#btn-import-back");
  b.fouten.splice(0, b.fouten.length, ...b.fouten.filter(f => !/status of 429/.test(f)));   // de nep-grens hierboven
  for (const t of [a, b]) { assert.deepEqual(t.fouten, []); await alleenInPaneel(t.page, code, t.console); await t.context.close(); }
});

test("overstap: 401 op /migreer wist het wachtwoord, de app gaat verder zonder, en het paneel toont het veld", async () => {
  const w = nepWorker({ "learner:pia": { progress: { [LIJST_ID]: voortgang(Date.now() - 60000, 2) }, updated: Date.now() - 60000 } });
  // een fout of verlopen wachtwoord: de worker geeft 401
  const a = await toestel(w, { zaai: { "overhoor:app-secret": "fout", ["overhoor:progress:pia:" + LIJST_ID]: voortgang(Date.now() - 90000, 1) } });
  await wachtTot(async () => (await lees(a.page, "overhoor:app-secret")) === null);
  assert.equal(await lees(a.page, "overhoor:app-secret"), null, "het wachtwoord staat er nog na 401");
  await a.page.waitForTimeout(300);
  assert.deepEqual(w.verzoeken.map(v => v.methode + " " + v.pad), ["POST /migreer"], "na 401 toch de oude route");
  assert.equal(await lees(a.page, "overhoor:code:pia"), null);
  assert.equal(w.migratie("pia"), undefined);
  // het paneel: gewoon een eigen code, en het veld voor een code die je al hebt
  const code = await openPaneel(a.page);
  assert.ok(CODE.geldigeCode(code));
  assert.ok(await a.page.locator("#code-invoer").isVisible(), "geen veld voor een code");
  assert.deepEqual(a.fouten.filter(f => !/status of 401/.test(f)), []);
  await a.context.close();
});

test("overstap: een 500 of 429 op /migreer laat het wachtwoord staan, de oude sync werkt, en het paneel zegt 'Dat lukt nu niet' met het veld erbij", async () => {
  const w = nepWorker({ "learner:pia": { progress: { [LIJST_ID]: voortgang(Date.now() - 60000, 2) }, updated: Date.now() - 60000 } });
  for (const status of [500, 429]) {
    const a = await toestel(w, { zaai: { "overhoor:app-secret": "geheim" }, voorWorker: async context => {
      await context.route(/workers\.dev\/migreer$/, route => route.fulfill({ status, body: "{}", headers: { "Access-Control-Allow-Origin": "*" } }));
    } });
    await wachtTot(async () => (await lees(a.page, "overhoor:progress:pia:" + LIJST_ID))?.items?.[0]?.box === 2);
    assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 2, status + ": de oude sync werkt niet");
    assert.equal(await lees(a.page, "overhoor:app-secret"), "geheim", status + ": wachtwoord weg");
    await a.page.click("#btn-ander-toestel");
    await a.page.locator("#code-melding", { hasText: "Dat lukt nu niet. Probeer het straks nog eens." }).waitFor({ timeout: 5000 });
    assert.equal(await a.page.locator("#code-tekst").count(), 0);
    assert.ok(await a.page.locator("#code-invoer").isVisible(), status + ": geen veld zonder eigen code");
    assert.equal(await lees(a.page, "overhoor:code:pia"), null);
    await a.context.close();
  }
});

test("nieuw toestel: wie Pia typt zonder code, ziet de voortgang van Pia niet", async () => {
  const code = "zwaluw-karton-bonbon-08";
  const w = nepWorker({
    ["persoon:" + sha(code)]: { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 5) }, updated: Date.now() - 1000 },
    "learner:pia": { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 6) }, updated: Date.now() - 1000 },
  });
  const { context, page, fouten, extern } = await toestel(w, { naam: false });
  await page.fill("#learner-name", "Pia"); await page.press("#learner-name", "Enter");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  await page.waitForTimeout(800);
  assert.deepEqual(w.verzoeken, [], "zonder code toch naar de worker");
  assert.deepEqual(extern.filter(u => /workers\.dev/.test(u)), []);
  assert.equal(await lees(page, "overhoor:progress:pia:" + LIJST_ID), null, "de voortgang van Pia staat op dit toestel");
  // de knop maakt een nieuwe, eigen code: ook dan niets van Pia
  const eigen = await openPaneel(page);
  assert.notEqual(eigen, code);
  await page.waitForTimeout(300);
  assert.equal(await lees(page, "overhoor:progress:pia:" + LIJST_ID), null);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("codepaneel: contrast, overloop en tikdoelen in licht en donker, 360 en 1280 px", async () => {
  const w = nepWorker();
  for (const thema of THEMAS) for (const breedte of BREEDTES) {
    const { context, page, fouten } = await toestel(w, { thema, breedte });
    await openPaneel(page);
    await page.fill("#code-invoer", "dit klopt niet");
    await page.click("#btn-code-gebruik");
    await page.locator("#code-melding").waitFor({ state: "visible" });
    await page.evaluate(rondAnimatiesAf);
    const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
    assert.deepEqual(c.fouten, [], `${thema} ${breedte}: contrast\n` + JSON.stringify(c.fouten, null, 1));
    assert.deepEqual(c.nietMeetbaar, [], `${thema} ${breedte}: niet meetbaar`);
    const o = await page.evaluate(overloopMeting);
    assert.equal(o.overloop, false, `${thema} ${breedte}: overloop ` + o.boosdoeners.join(", "));
    const klein = await page.evaluate(() => [...document.querySelectorAll("#btn-ander-toestel, #code-plek button, #code-invoer")]
      .map(e => ({ id: e.id, h: e.getBoundingClientRect().height })).filter(x => x.h < 44));
    assert.deepEqual(klein, [], `${thema} ${breedte}: tikdoel kleiner dan 44 px`);
    // de vraag of je overstapt (een code zonder voortgang)
    await page.fill("#code-invoer", "zwaluw-karton-bonbon-08");
    await page.click("#btn-code-gebruik");
    await page.locator("#code-vraag").waitFor({ state: "visible", timeout: 5000 });
    await page.evaluate(rondAnimatiesAf);
    const c2 = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
    assert.deepEqual(c2.fouten, [], `${thema} ${breedte}: contrast bij de vraag\n` + JSON.stringify(c2.fouten, null, 1));
    assert.equal((await page.evaluate(overloopMeting)).overloop, false, `${thema} ${breedte}: overloop bij de vraag`);
    const klein2 = await page.evaluate(() => [...document.querySelectorAll("#code-plek button")]
      .map(e => ({ id: e.id, h: e.getBoundingClientRect().height })).filter(x => x.h < 44));
    assert.deepEqual(klein2, [], `${thema} ${breedte}: tikdoel bij de vraag`);
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

// ---------- aanvullende gevallen: gaten van de eerste ronde ----------

const zonderVerbindingsfouten = fouten => fouten.filter(f => !/ERR_CONNECTION_REFUSED|Failed to load resource|Failed to fetch/.test(f));

test("overstap: een onbereikbare worker laat het wachtwoord staan, en later opnieuw proberen lukt", async () => {
  const oud = { progress: { [LIJST_ID]: voortgang(Date.now() - 60000, 2) }, updated: Date.now() - 60000 };
  const w = nepWorker({ "learner:pia": oud });
  w.uit = true;
  const lokaal = voortgang(Date.now() - 120000, 1);
  const a = await toestel(w, { zaai: { "overhoor:app-secret": "geheim", ["overhoor:progress:pia:" + LIJST_ID]: lokaal } });
  await wachtTot(() => w.verzoeken.length >= 1);
  await a.page.waitForTimeout(300);
  assert.ok(w.verzoeken.length >= 1, "de app probeerde de overstap niet");
  assert.ok(w.verzoeken.every(v => v.uit), "de worker was niet uit");
  assert.equal(w.verzoeken[0].methode + " " + w.verzoeken[0].pad, "POST /migreer");
  assert.equal(await lees(a.page, "overhoor:code:pia"), null, "een code zonder dat de worker er was");
  assert.equal(await lees(a.page, "overhoor:app-secret"), "geheim", "het wachtwoord is weg terwijl de overstap mislukte");
  assert.deepEqual(await lees(a.page, "overhoor:progress:pia:" + LIJST_ID), lokaal, "lokale voortgang is aangetast");
  assert.equal(w.migratie("pia"), undefined);
  assert.deepEqual(zonderVerbindingsfouten(a.fouten), []);
  // de worker is weer bereikbaar: bij het volgende openen lukt de overstap
  w.uit = false;
  await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
  const code = await wachtTot(() => lees(a.page, "overhoor:code:pia"));
  assert.ok(CODE.geldigeCode(code), "na herstel geen code");
  assert.equal(code, w.migratie("pia"));
  assert.equal(await lees(a.page, "overhoor:app-secret"), null, "het wachtwoord staat er nog na de overstap");
  await wachtTot(async () => (await lees(a.page, "overhoor:progress:pia:" + LIJST_ID))?.items?.[0]?.box === 2);
  assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 2, "de nieuwere voortgang van de server is niet opgehaald");
  await a.context.close();
});

test("klasgenoot-toestel: oude standaard Pia in de lijst met voortgang, Tom oefent: /migreer nooit voor pia, het wachtwoord blijft", async () => {
  const nu = Date.now();
  const w = nepWorker({
    "learner:pia": { progress: { [LIJST_ID]: voortgang(nu - 60000, 2) }, updated: nu - 60000 },
    "learner:tom": { progress: { [LIJST_ID]: voortgang(nu - 60000, 3) }, updated: nu - 60000 },
  });
  const piaLokaal = voortgang(nu - 90000, 1);
  const a = await toestel(w, { zaai: {
    "overhoor:app-secret": "geheim", "overhoor:learner": "Tom", "overhoor:learners": ["Pia", "Tom"],
    ["overhoor:progress:pia:" + LIJST_ID]: piaLokaal, ["overhoor:progress:tom:" + LIJST_ID]: voortgang(nu - 90000, 1),
  } });
  const tomCode = await wachtTot(() => lees(a.page, "overhoor:code:tom"));
  assert.ok(CODE.geldigeCode(tomCode), "Tom kreeg geen code");
  // ook na herladen, het paneel openen en een ronde wachten: nooit pia
  await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
  await openPaneel(a.page);
  await a.page.waitForTimeout(2500);
  const slugs = w.verzoeken.filter(v => v.pad === "/migreer").map(v => JSON.parse(v.body || "{}").slug);
  assert.equal(slugs.includes("pia"), false, "/migreer met slug pia aangeroepen: " + slugs.join(","));
  assert.equal(w.migratie("pia"), undefined);
  assert.equal(await lees(a.page, "overhoor:code:pia"), null, "het toestel van Tom kreeg de code van Pia");
  assert.equal(await lees(a.page, "overhoor:app-secret"), "geheim", "het wachtwoord is weg terwijl pia hier voortgang zonder code heeft");
  assert.deepEqual(await lees(a.page, "overhoor:progress:pia:" + LIJST_ID), piaLokaal, "de voortgang onder pia is aangeraakt");
  assert.equal(w.kv("persoon:" + sha(tomCode)).progress[LIJST_ID].items[0].box, 3);
  // wordt de worker 401 (Daan haalde APP_SECRET weg), dan ruimt de app het wachtwoord op
  delete w.env.APP_SECRET;
  await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
  await wachtTot(async () => (await lees(a.page, "overhoor:app-secret")) === null);
  assert.equal(await lees(a.page, "overhoor:app-secret"), null);
  assert.equal(w.migratie("pia"), undefined);
  assert.deepEqual(zonderVerbindingsfouten(a.fouten).filter(f => !/status of 401/.test(f)), []);
  await a.context.close();
});

test("twee oefenaars: wie zelf zijn naam kiest, stapt over; het wachtwoord gaat weg als elke naam met voortgang een code heeft", async () => {
  const nu = Date.now();
  const w = nepWorker({
    "learner:pia": { progress: { [LIJST_ID]: voortgang(nu - 60000, 2) }, updated: nu - 60000 },
    "learner:tom": { progress: { [LIJST_ID]: voortgang(nu - 60000, 3) }, updated: nu - 60000 },
  });
  const a = await toestel(w, { zaai: {
    "overhoor:app-secret": "geheim", "overhoor:learner": "Tom", "overhoor:learners": ["Pia", "Tom"],
    ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 90000, 1), ["overhoor:progress:tom:" + LIJST_ID]: voortgang(nu - 90000, 1),
  } });
  const tomCode = await wachtTot(() => lees(a.page, "overhoor:code:tom"));
  assert.equal(await lees(a.page, "overhoor:app-secret"), "geheim");
  // Pia kiest zelf haar naam
  await a.page.click("#btn-learner");
  await a.page.fill("#learner-name", "Pia"); await a.page.press("#learner-name", "Enter");
  const piaCode = await wachtTot(() => lees(a.page, "overhoor:code:pia"));
  assert.ok(CODE.geldigeCode(piaCode), "Pia stapte niet over na het kiezen van haar naam");
  assert.notEqual(piaCode, tomCode);
  assert.equal(piaCode, w.migratie("pia"));
  await wachtTot(async () => (await lees(a.page, "overhoor:app-secret")) === null);
  assert.equal(await lees(a.page, "overhoor:app-secret"), null, "het wachtwoord staat er nog terwijl iedereen over is");
  await wachtTot(async () => (await lees(a.page, "overhoor:progress:pia:" + LIJST_ID))?.items?.[0]?.box === 2);
  assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 2);
  assert.deepEqual(zonderVerbindingsfouten(a.fouten), []);
  await a.context.close();
});

test("afgewezen naam: stapt niet over; bevestigt Pia later zelf, dan wel, met dezelfde code als op haar telefoon", async () => {
  const nu = Date.now();
  const w = nepWorker({ "learner:pia": { progress: { [LIJST_ID]: voortgang(nu - 60000, 2) }, updated: nu - 60000 } });
  // Pia's telefoon stapt eerst over
  const telefoon = await toestel(w, { zaai: { "overhoor:app-secret": "geheim" } });
  const x = await wachtTot(() => lees(telefoon.page, "overhoor:code:pia"));
  assert.ok(CODE.geldigeCode(x));
  await telefoon.context.close();
  // de tablet: "Ben jij Pia?" Nee, dan Tom
  const a = await toestel(w, { naam: false, zaai: {
    "overhoor:app-secret": "geheim", "overhoor:learner": "Pia", "overhoor:learners": ["Pia"],
    ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 90000, 1),
  } });
  await a.page.click("#btn-naam-nee");
  assert.deepEqual(await lees(a.page, "overhoor:naam-afgewezen"), ["pia"]);
  await a.page.fill("#learner-name", "Tom"); await a.page.press("#learner-name", "Enter");
  assert.ok(CODE.geldigeCode(await wachtTot(() => lees(a.page, "overhoor:code:tom"))));
  await a.page.waitForTimeout(300);
  assert.equal(await lees(a.page, "overhoor:code:pia"), null, "het toestel van Tom kreeg de code van Pia");
  const n = w.verzoeken.filter(v => v.pad === "/migreer").length;
  // later typt Pia zelf haar naam op de tablet
  await a.page.click("#btn-learner");
  await a.page.fill("#learner-name", "Pia"); await a.page.press("#learner-name", "Enter");
  assert.equal(await wachtTot(() => lees(a.page, "overhoor:code:pia")), x, "Pia kreeg een andere code dan op haar telefoon");
  assert.deepEqual(await lees(a.page, "overhoor:naam-afgewezen"), [], "de afwijzing staat er nog");
  assert.ok(w.verzoeken.filter(v => v.pad === "/migreer").length > n);
  await wachtTot(async () => (await lees(a.page, "overhoor:app-secret")) === null);
  assert.equal(await lees(a.page, "overhoor:app-secret"), null);
  await a.context.close();
});

test("afgewezen naam: Ja op 'Ben jij Pia?' haalt de afwijzing weg", async () => {
  const w = nepWorker();
  const a = await toestel(w, { naam: false, zaai: { "overhoor:learner": "Pia", "overhoor:naam-afgewezen": ["pia", "tom"] } });
  await a.page.click("#btn-naam-ja");
  await a.page.waitForTimeout(200);
  assert.deepEqual(await lees(a.page, "overhoor:naam-afgewezen"), ["tom"]);
  await a.context.close();
});

test("overstap: het paneel zonder verbinding maakt geen nieuwe code terwijl het wachtwoord nog staat", async () => {
  const nu = Date.now();
  const w = nepWorker({ "learner:pia": { progress: { [LIJST_ID]: voortgang(nu - 60000, 2) }, updated: nu - 60000 } });
  w.uit = true;
  const a = await toestel(w, { zaai: { "overhoor:app-secret": "geheim", ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 90000, 1) } });
  try {
    await a.page.click("#btn-ander-toestel");
    await a.page.locator("#code-melding", { hasText: "Dat lukt nu niet. Probeer het straks nog eens." }).waitFor({ timeout: 5000 });
    assert.equal(await a.page.locator("#code-tekst").count(), 0, "er staat toch een code in het paneel");
    assert.equal(await lees(a.page, "overhoor:code:pia"), null, "er is een losse code gemaakt");
    assert.equal(await lees(a.page, "overhoor:app-secret"), "geheim");
    // opnieuw tikken met de worker weer bereikbaar: nu wel, met de code van de overstap
    w.uit = false;
    await a.page.click("#btn-code-sluit");
    const viaKnop = await openPaneel(a.page);
    assert.equal(viaKnop, w.migratie("pia"));
    assert.equal(await lees(a.page, "overhoor:app-secret"), null);
    await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
    const code = await wachtTot(() => lees(a.page, "overhoor:code:pia"));
    assert.equal(code, w.migratie("pia"));
  } finally { await a.context.close(); }
});

test("code invullen met lokale voortgang die nieuwer is dan de server: samengevoegd, niets kwijt", async () => {
  const nu = Date.now();
  const code = "zwaluw-karton-bonbon-08";
  const andere = "l-server";
  const w = nepWorker({ ["persoon:" + sha(code)]: {
    progress: { [LIJST_ID]: voortgang(nu - 100000, 2), [andere]: voortgang(nu - 50000, 4) },
    lists: [{ id: "custom-server", title: "Van de server", subject: "Engels", added: nu - 5000, items: [{ word: "dog", def: "hond" }] }],
    updated: nu - 50000 } });
  const eigen = { id: "custom-lokaal", title: "Lokaal", subject: "Engels", added: nu - 1000, items: [{ word: "cat", def: "kat" }] };
  const b = await toestel(w, { zaai: { "overhoor:lists": [eigen], ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 1000, 5) } });
  await openPaneel(b.page);
  await b.page.fill("#code-invoer", code);
  await b.page.click("#btn-code-gebruik");
  // B had al een eigen code met data: eerst bevestigen
  await b.page.click("#btn-code-over");
  await b.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  // lokaal nieuwer wint, wat alleen op de server staat komt erbij
  assert.equal((await lees(b.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 5, "de nieuwere lokale voortgang is overschreven");
  assert.equal((await lees(b.page, "overhoor:progress:pia:" + andere)).items[0].box, 4, "de voortgang van alleen de server is niet opgehaald");
  const ids = (await lees(b.page, "overhoor:lists")).map(l => l.id).sort();
  assert.deepEqual(ids, ["custom-lokaal", "custom-server"]);
  // en het samengevoegde staat terug op de server, zodat het andere toestel niets mist
  await wachtTot(() => w.kv("persoon:" + sha(code))?.progress?.[LIJST_ID]?.items?.[0]?.box === 5);
  const record = w.kv("persoon:" + sha(code));
  assert.equal(record.progress[LIJST_ID].items[0].box, 5, "de nieuwere lokale voortgang kwam niet op de server");
  assert.equal(record.progress[andere].items[0].box, 4, "de server verloor een lijst");
  assert.deepEqual(record.lists.map(l => l.id).sort(), ["custom-lokaal", "custom-server"]);
  assert.deepEqual(zonderVerbindingsfouten(b.fouten), []);
  await b.context.close();
});

test("code invullen: een ongeldige code geeft een melding en verandert niets", async () => {
  const nu = Date.now();
  const w = nepWorker();
  const lokaal = voortgang(nu - 1000, 3);
  const eigen = { id: "custom-lokaal", title: "Lokaal", subject: "Engels", added: nu - 1000, items: [{ word: "cat", def: "kat" }] };
  const b = await toestel(w, { zaai: { "overhoor:lists": [eigen], ["overhoor:progress:pia:" + LIJST_ID]: lokaal } });
  const eigenCode = await openPaneel(b.page);
  await wachtTot(() => w.kv("persoon:" + sha(eigenCode)));
  const voor = w.verzoeken.length;
  const record = JSON.stringify(w.kv("persoon:" + sha(eigenCode)));
  for (const fout of ["", "   ", "panda-mango-47", "tijger-mango-wolk-47", "panda-mango-wolk-4", "learner:pia", "x".repeat(300), "panda-mango-wolk-47-extra"]) {
    await b.page.fill("#code-invoer", fout);
    await b.page.click("#btn-code-gebruik");
    await b.page.locator("#code-melding", { hasText: "Deze code klopt niet." }).waitFor();
    assert.equal(await lees(b.page, "overhoor:code:pia"), eigenCode, "de code veranderde bij invoer " + JSON.stringify(fout.slice(0, 20)));
    assert.equal(await b.page.evaluate(() => document.activeElement.id), "code-invoer", "de focus ging weg van het veld");
    assert.equal(await b.page.locator("#code-plek").isVisible(), true, "het paneel ging dicht");
    assert.equal((await b.page.locator("#code-tekst").textContent()).trim(), eigenCode);
  }
  await b.page.waitForTimeout(300);
  assert.equal(w.verzoeken.length, voor, "een ongeldige code ging toch naar de worker");
  assert.deepEqual(await lees(b.page, "overhoor:progress:pia:" + LIJST_ID), lokaal);
  assert.deepEqual((await lees(b.page, "overhoor:lists")).map(l => l.id), ["custom-lokaal"]);
  assert.equal(JSON.stringify(w.kv("persoon:" + sha(eigenCode))), record, "het serverrecord veranderde");
  assert.equal(await lees(b.page, "overhoor:code-nieuw"), null);
  // de eigen code invullen: zeggen dat het al je code is, niets doen
  await b.page.fill("#code-invoer", eigenCode.toUpperCase());
  await b.page.click("#btn-code-gebruik");
  await b.page.locator("#code-melding", { hasText: "Dit is al je code." }).waitFor();
  assert.equal(w.verzoeken.length, voor);
  assert.deepEqual(b.fouten, []);
  await b.context.close();
});

test("link: de #code= verdwijnt uit de adresbalk, ook bij een kapotte code en als de app al openstaat", async () => {
  const code = "zwaluw-karton-bonbon-08";
  const w = nepWorker({ ["persoon:" + sha(code)]: { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 5) }, updated: Date.now() - 1000 } });
  const zichtbaar = page => page.evaluate(() => ({ href: location.href, hash: location.hash, geschiedenis: history.length }));
  // geldige link
  const a = await toestel(w, { pad: "#code=" + code });
  await a.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  let z = await zichtbaar(a.page);
  assert.equal(z.href.includes("code"), false, "de code staat nog in de url: " + z.href);
  assert.equal(z.hash, "");
  assert.equal(z.href, server.url + "/index.html");
  // terug-knop brengt de code niet terug (geen extra geschiedenisregel met de code)
  await a.page.goBack().catch(() => {});
  assert.equal((await zichtbaar(a.page)).href.includes("code"), false);
  // kapotte link: toch uit de balk
  const c = await toestel(w, { pad: "#code=panda-mango-47" });
  await c.page.waitForTimeout(300);
  assert.equal((await zichtbaar(c.page)).href.includes("code"), false, "kapotte code blijft in de url");
  // app staat al open en krijgt een link erbij (hashchange)
  const b = await toestel(w);
  assert.equal(await lees(b.page, "overhoor:code:pia"), null);
  await b.page.evaluate(c => { location.hash = "#code=" + c; }, code);
  await b.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.equal((await zichtbaar(b.page)).href.includes("code"), false, "hashchange liet de code staan");
  assert.equal(await lees(b.page, "overhoor:code:pia"), code);
  assert.equal((await lees(b.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 5);
  // na herladen is er niets meer om opnieuw in te lezen
  const n = w.verzoeken.length;
  await b.page.reload(); await wachtOpScherm(b.page, "scr-lessons");
  assert.equal((await zichtbaar(b.page)).href.includes("code"), false);
  for (const t of [a, b, c]) { assert.deepEqual(t.fouten, []); await t.context.close(); }
  assert.ok(w.verzoeken.length >= n);
});

// ---------- herstelronde: niet stil overstappen, nieuwe codes begrensd ----------

test("link: een andere code terwijl je er al een hebt: eerst vragen, Mijn code houden verandert niets", async () => {
  const nu = Date.now();
  const pia = "zwaluw-karton-bonbon-08";
  const w = nepWorker({ ["persoon:" + sha(pia)]: { progress: { [LIJST_ID]: voortgang(nu - 1000, 5) }, updated: nu - 1000 } });
  const eigen = "appel-zebra-kous-11";
  const a = await toestel(w, { zaai: { "overhoor:code:pia": eigen, ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 5000, 1) } });
  await a.page.waitForTimeout(300);
  const voor = JSON.stringify(w.kv("persoon:" + sha(eigen)));
  // iemand stuurt een link met de code van een ander
  await a.page.evaluate(c => { location.hash = "#code=" + c; }, pia);
  await a.page.locator("#code-vraag", { hasText: "Deze code hoort bij iemand anders of bij een ander toestel. Wil je overstappen?" }).waitFor({ timeout: 5000 });
  assert.equal((await a.page.locator("#code-tekst").textContent()).trim(), eigen, "de huidige code staat niet in beeld");
  assert.equal(await lees(a.page, "overhoor:code:pia"), eigen, "stil overgestapt");
  assert.equal((await lees(a.page, "overhoor:progress:pia:" + LIJST_ID)).items[0].box, 1, "de voortgang van de ander is al binnen");
  assert.equal(w.verzoeken.some(v => v.methode === "PUT" && v.koppen["x-code"] === pia), false, "naar de andere code geduwd voor de bevestiging");
  await a.page.click("#btn-code-houden");
  await a.page.locator("#code-melding", { hasText: "Je houdt je eigen code." }).waitFor();
  assert.equal(await lees(a.page, "overhoor:code:pia"), eigen);
  assert.equal(await lees(a.page, "overhoor:code-nieuw"), null);
  assert.equal(await lees(a.page, "overhoor:code-vorige:pia"), null);
  assert.equal(JSON.stringify(w.kv("persoon:" + sha(eigen))), voor);
  // na herladen geen vraag meer
  await a.page.reload(); await wachtOpScherm(a.page, "scr-lessons");
  await a.page.waitForTimeout(300);
  assert.equal(await a.page.locator("#code-vraag").count(), 0);
  assert.deepEqual(a.fouten, []);
  await a.context.close();
});

test("overstappen bewaart de vorige code, en terug kan met die code", async () => {
  const nu = Date.now();
  const pia = "zwaluw-karton-bonbon-08";
  const eigen = "appel-zebra-kous-11";
  const w = nepWorker({
    ["persoon:" + sha(pia)]: { progress: { [LIJST_ID]: voortgang(nu - 1000, 5) }, updated: nu - 1000 },
    ["persoon:" + sha(eigen)]: { progress: { [LIJST_ID]: voortgang(nu - 9000, 1) }, updated: nu - 9000 },
  });
  const a = await toestel(w, { zaai: { "overhoor:code:pia": eigen } });
  await openPaneel(a.page);
  await a.page.fill("#code-invoer", pia);
  await a.page.click("#btn-code-gebruik");
  await a.page.click("#btn-code-over");
  await a.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(a.page, "overhoor:code:pia"), pia);
  assert.equal(await lees(a.page, "overhoor:code-vorige:pia"), eigen);
  assert.equal((await a.page.locator("#code-vorige").textContent()).trim(), eigen);
  // terug naar de vorige
  await a.page.fill("#code-invoer", eigen);
  await a.page.click("#btn-code-gebruik");
  await a.page.click("#btn-code-over");
  await a.page.locator("#code-melding", { hasText: "Je voortgang is opgehaald." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(a.page, "overhoor:code:pia"), eigen);
  assert.equal(await lees(a.page, "overhoor:code-vorige:pia"), pia);
  assert.deepEqual(a.fouten, []);
  await a.context.close();
});

test("een code zonder voortgang: melden en alleen na bevestiging overnemen, zonder push ervoor", async () => {
  const leeg = "zwaluw-karton-bonbon-08";
  const w = nepWorker();
  // nieuw toestel zonder code, via een link
  const a = await toestel(w, { pad: "#code=" + leeg });
  await a.page.locator("#code-vraag", { hasText: "Geen voortgang gevonden bij deze code." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(a.page, "overhoor:code:pia"), null, "overgenomen zonder bevestiging");
  assert.equal(await a.page.locator("#code-tekst").count(), 0, "er is intussen een eigen code gemaakt");
  assert.equal(w.verzoeken.some(v => v.methode === "PUT"), false, "geduwd voor de bevestiging");
  assert.equal(w.kv("persoon:" + sha(leeg)), undefined);
  await a.page.click("#btn-code-over");
  await a.page.locator("#code-melding", { hasText: "Je gebruikt nu deze code." }).waitFor({ timeout: 5000 });
  assert.equal(await lees(a.page, "overhoor:code:pia"), leeg);
  // via het veld met al een gebruikte eigen code: allebei de zinnen
  const eigen = "appel-zebra-kous-11";
  const w2 = nepWorker({ ["persoon:" + sha(eigen)]: { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 3) }, updated: Date.now() - 1000 } });
  const b = await toestel(w2, { zaai: { "overhoor:code:pia": eigen } });
  await openPaneel(b.page);
  await b.page.fill("#code-invoer", leeg);
  await b.page.click("#btn-code-gebruik");
  const vraag = b.page.locator("#code-vraag");
  await vraag.waitFor({ timeout: 5000 });
  assert.match(await vraag.textContent(), /hoort bij iemand anders.*Geen voortgang gevonden bij deze code\./s);
  assert.equal(w2.verzoeken.some(v => v.methode === "PUT" && v.koppen["x-code"] === leeg), false);
  await b.page.click("#btn-code-houden");
  assert.equal(await lees(b.page, "overhoor:code:pia"), eigen);
  for (const t of [a, b]) { assert.deepEqual(t.fouten, []); await t.context.close(); }
});

test("nieuwe codes: vol voor vandaag geeft een melding in het paneel", async () => {
  const { dagVan } = await import(pathToFileURL(join(SRC, "teller.js")).href);
  const w = nepWorker();
  w.env.TELLER.data.set("nieuw", { dag: dagVan(Date.now()), aantal: 30 });
  const a = await toestel(w, { zaai: { ["overhoor:progress:pia:" + LIJST_ID]: voortgang(Date.now() - 5000) } });
  await a.page.click("#btn-ander-toestel");
  await a.page.locator("#code-melding", { hasText: "Er kunnen vandaag geen nieuwe codes bij. Probeer het morgen." }).waitFor({ timeout: 5000 });
  const code = (await a.page.locator("#code-tekst").textContent()).trim();
  assert.equal(w.kv("persoon:" + sha(code)), undefined);
  // de code is hier nog niet gebruikt: een andere code invullen vraagt niets
  assert.equal(await lees(a.page, "overhoor:code-ongebruikt:pia"), code);
  assert.equal(await a.page.locator("#btn-code-kopieer").count(), 0, "kopieerknop terwijl de code niet opgeslagen is");
  assert.deepEqual(a.fouten.filter(f => !/status of 429/.test(f)), []);
  await a.context.close();
});

// ---------- herstelronde 2 ----------

test("vreemde code zonder eigen code maar met voortgang of eigen lijsten op dit toestel: eerst vragen", async () => {
  const nu = Date.now();
  const vreemd = "zwaluw-karton-bonbon-08";
  const w = nepWorker({ ["persoon:" + sha(vreemd)]: { progress: { [LIJST_ID]: voortgang(nu - 1000, 5) }, updated: nu - 1000 } });
  const eigen = { id: "custom-lokaal", title: "Lokaal", subject: "Engels", added: nu - 1000, items: [{ word: "cat", def: "kat" }] };
  for (const zaai of [{ ["overhoor:progress:pia:" + LIJST_ID]: voortgang(nu - 5000, 1) }, { "overhoor:lists": [eigen] }]) {
    const a = await toestel(w, { zaai, pad: "#code=" + vreemd });
    await a.page.locator("#code-vraag", { hasText: "Wil je overstappen?" }).waitFor({ timeout: 5000 });
    assert.equal(await lees(a.page, "overhoor:code:pia"), null, "stil overgenomen");
    assert.equal(w.verzoeken.some(v => v.methode === "PUT" && v.koppen["x-code"] === vreemd), false, "geduwd voor de bevestiging");
    await a.page.click("#btn-code-houden");
    await a.page.locator("#code-vraag").waitFor({ state: "detached" });
    assert.notEqual(await lees(a.page, "overhoor:code:pia"), vreemd, "toch de vreemde code");
    assert.equal(await lees(a.page, "overhoor:code-nieuw"), null);
    assert.equal(w.verzoeken.some(v => v.methode === "PUT" && v.koppen["x-code"] === vreemd), false);
    await a.context.close();
  }
});

test("een hier gemaakte code die nog niet opgeslagen is: duidelijke melding en geen kopieerknoppen tot hij er staat", async () => {
  const w = nepWorker();
  const a = await toestel(w, { zaai: { ["overhoor:progress:pia:" + LIJST_ID]: voortgang(Date.now() - 5000) } });
  w.uit = true;
  await a.page.click("#btn-ander-toestel");
  await a.page.locator("#code-melding", { hasText: "Je code is nog niet opgeslagen. Probeer het straks nog eens." }).waitFor({ timeout: 5000 });
  const code = (await a.page.locator("#code-tekst").textContent()).trim();
  assert.equal(await a.page.locator("#btn-code-kopieer").count(), 0, "kopieerknop terwijl de code niet opgeslagen is");
  assert.equal(await a.page.locator("#code-link").count(), 0, "link terwijl de code niet opgeslagen is");
  assert.ok(await a.page.locator("#code-invoer").isVisible());
  // weer verbinding: opnieuw openen slaat hem op en toont de knoppen
  w.uit = false;
  await a.page.click("#btn-code-sluit");
  assert.equal(await openPaneel(a.page), code, "een andere code na opnieuw openen");
  await a.page.locator("#btn-code-kopieer").waitFor();
  assert.ok(w.kv("persoon:" + sha(code)), "niet opgeslagen na opnieuw openen");
  assert.equal(await lees(a.page, "overhoor:code-ongebruikt:pia"), null);
  assert.deepEqual(zonderVerbindingsfouten(a.fouten), []);
  await a.context.close();
});

test("een hier gemaakte code waar op de server al voortgang bij staat, telt na het ophalen als gebruikt", async () => {
  const code = "zwaluw-karton-bonbon-08";
  const w = nepWorker({ ["persoon:" + sha(code)]: { progress: { [LIJST_ID]: voortgang(Date.now() - 1000, 5) }, updated: Date.now() - 1000 } });
  const a = await toestel(w, { zaai: { "overhoor:code:pia": code, "overhoor:code-ongebruikt:pia": code } });
  await wachtTot(async () => (await lees(a.page, "overhoor:code-ongebruikt:pia")) === null);
  assert.equal(await lees(a.page, "overhoor:code-ongebruikt:pia"), null, "na het ophalen nog steeds ongebruikt");
  assert.equal(w.verzoeken.some(v => v.methode === "PUT"), false);
  // een andere code invullen vraagt nu eerst
  await openPaneel(a.page);
  await a.page.fill("#code-invoer", "appel-zebra-kous-11");
  await a.page.click("#btn-code-gebruik");
  await a.page.locator("#code-vraag", { hasText: "Deze code hoort bij iemand anders" }).waitFor({ timeout: 5000 });
  assert.deepEqual(a.fouten, []);
  await a.context.close();
});

test("design system: het codepaneel met de vraag, zonder code en niet opgeslagen, zonder dubbele ids", async () => {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/designsystem.html");
  await page.locator("#sg-components .card").first().waitFor();
  const r = await page.evaluate(() => {
    const ids = [...document.querySelectorAll("[id]")].map(e => e.id);
    const dubbel = ids.filter((x, i) => ids.indexOf(x) !== i);
    const zichtbaar = id => { const e = document.getElementById(id); return !!e && e.checkVisibility(); };
    return {
      dubbel,
      vraag: zichtbaar("sg-vraag-code-vraag") && zichtbaar("sg-vraag-btn-code-over") && zichtbaar("sg-vraag-btn-code-houden"),
      zonderCode: zichtbaar("sg-zonder-code-invoer") && !document.getElementById("sg-zonder-code-tekst"),
      nietOpgeslagen: zichtbaar("sg-niet-code-tekst") && !document.getElementById("sg-niet-btn-code-kopieer"),
    };
  });
  assert.deepEqual(r.dubbel, [], "dubbele ids in het design system");
  assert.ok(r.vraag, "geen voorbeeld van de vraag");
  assert.ok(r.zonderCode, "geen voorbeeld van het paneel zonder code");
  assert.ok(r.nietOpgeslagen, "geen voorbeeld van een niet opgeslagen code");
  assert.deepEqual(fouten, []);
  await context.close();
});
