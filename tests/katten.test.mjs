// Katten, model "een kat maakt het leuk": elke ronde komt er vanzelf een
// andere kat langs, binnen de ronde steeds dezelfde. Niets te verdienen,
// geen Mijn katten, geen sync van katten. Eerst zonder browser
// (catalogus, wisselen, markup), daarna elk moment in de levende app:
// goed, fout, lastige ronde, vlekkeloze ronde, hervatten, sync en
// reduced motion. Contrast en overloop tellen op elk kattenscherm mee.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { beantwoord, wachtOpScherm } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const lees = f => readFileSync(join(REPO, f), "utf8");
const ALLE = ["strepen", "tuxedo", "lapjes", "sokjes", "stippen", "rodestreep"];
const VORIGE = "overhoor:kat:vorige";
const blijeZin = naam => `${naam} is helemaal blij: alles in één keer goed!`;

// ---------- zonder browser ----------
// celebrate.js en ui.js in een eigen context, met nep-opslag en een
// stuurbare Math.random.
function laad({ opslag = {}, kapot = false } = {}) {
  const store = opslag;
  const ctx = vm.createContext({
    localStorage: {
      getItem: k => { if (kapot) throw new Error("geen opslag"); return k in store ? store[k] : null; },
      setItem: (k, v) => { if (kapot) throw new Error("geen opslag"); store[k] = String(v); }
    },
    __r: null
  });
  ctx.window = ctx;
  ctx.matchMedia = () => ({ matches: true });   // reduced: geen confetti, geen DOM nodig
  vm.runInContext("const __echt = Math.random; Math.random = () => (globalThis.__r ? globalThis.__r() : __echt());", ctx);
  vm.runInContext(lees("ui.js"), ctx);
  vm.runInContext(lees("celebrate.js"), ctx);
  return { C: ctx.Celebrate, UI: ctx.UI, store, ctx };
}
const json = x => JSON.parse(JSON.stringify(x));
function lcg(zaad) { let s = zaad >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

// breedte en hoogte uit de kop van een WebP-bestand
function webpMaat(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  const soort = buf.toString("ascii", 12, 16);
  if (soort === "VP8X") return [1 + buf.readUIntLE(24, 3), 1 + buf.readUIntLE(27, 3)];
  if (soort === "VP8L") { const b = buf.readUInt32LE(21); return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
  if (soort === "VP8 ") return [buf.readUInt16LE(26) & 0x3fff, buf.readUInt16LE(28) & 0x3fff];
  throw new Error("onbekende WebP-soort " + soort);
}

test("catalogus: zes katten met naam, karakter en twee standen; afmetingen kloppen met de bestanden", () => {
  const { C } = laad();
  assert.deepEqual(json(C.KATTEN.map(k => [k.id, k.naam, k.karakter])), [
    ["strepen", "Strepen", "knus"], ["tuxedo", "Tuxedo", "muziek"], ["lapjes", "Lapjes", "leergierig"],
    ["sokjes", "Sokjes", "sportief"], ["stippen", "Stippen", "avontuurlijk"], ["rodestreep", "Rode streep", "ondeugend"]]);
  for (const k of C.KATTEN) for (const stand of ["goed", "bijna"]) {
    const b = C.beeld(k.id, stand);
    assert.equal(b.src, `katten/${k.id}-${stand}.webp`);
    const pad = join(REPO, b.src);
    assert.ok(existsSync(pad), b.src + " bestaat niet");
    // vaste width/height op het <img> voorkomen verspringen; die moeten kloppen
    assert.deepEqual(webpMaat(readFileSync(pad)), [b.width, b.height], b.src + ": afmetingen in celebrate.js kloppen niet");
  }
  assert.equal(C.beeld("strepen", "goed").alt, "Strepen, knus, blij");
  assert.equal(C.beeld("rodestreep", "bijna").alt, "Rode streep, ondeugend, rustig");
  assert.equal(C.beeld("bestaatniet", "goed"), null);
});

test("oude katten en het verzamelen zijn weg; service worker en allowlist kennen de nieuwe beelden", () => {
  for (const f of ["index.html", "celebrate.js", "ui.js", "sw.js", "designsystem.html"]) {
    assert.doesNotMatch(lees(f), /cats\.js|CAT_CATALOG|kansOpBijzonder|bijnaVlekkeloos|zeldzaam|"cats\//, f + " verwijst nog naar de oude katten");
  }
  // verdienen, startkat, opslag per oefenaar, Mijn katten, silhouet, sync van katten
  for (const f of ["index.html", "celebrate.js", "ui.js", "ds.css", "designsystem.html"]) {
    assert.doesNotMatch(lees(f), /KatTegel|kat-tegel|kat-silhouet|kat-raster|kat-masker|overhoor:katten|voegSamen|\bschoon\(|\bverdien\(|onVerdien|scr-cats|btn-cats|cats-grid|renderCats|Nieuwe kat/,
      f + " bevat nog iets van het verzamelen");
  }
  for (const f of ["index.html", "celebrate.js", "ui.js", "ds.css"]) assert.doesNotMatch(lees(f), /Mijn katten/, f);
  assert.doesNotMatch(lees("index.html"), /katten\s*:/, "index.html stuurt nog katten mee");
  assert.ok(!existsSync(join(REPO, "cats.js")), "cats.js staat nog in de root");
  for (const f of ["archief/katten-v1/cats.js", "archief/katten-v1/cats/LEESMIJ.md", "archief/katten-v1/scripts/maak-catalogus.sh", "archief/katten-v1/scripts/maak-katten.js"]) {
    assert.ok(existsSync(join(REPO, f)), f + " niet gearchiveerd");
  }
  assert.doesNotMatch(lees("scripts/deploy.sh"), /maak-catalogus|cats\.js|\bcats\b/);
  const sw = lees("sw.js");
  const schil = [...sw.matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
  for (const id of ALLE) for (const s of ["goed", "bijna"]) assert.ok(schil.includes(`katten/${id}-${s}.webp`), `katten/${id}-${s}.webp niet in SCHIL`);
  const allow = lees(".assetsignore").split("\n").map(r => r.trim());
  assert.ok(allow.includes("!/katten/") && allow.includes("/katten/*/"), "katten/ niet goed in .assetsignore");
  assert.ok(!allow.some(r => /cats/.test(r) && !r.startsWith("#")), "oude cats-regels staan nog in .assetsignore");
  // de API van Celebrate heeft niets meer om te verzamelen
  const { C, UI } = laad();
  for (const weg of ["setLearner", "staat", "huidig", "verdiend", "verdien", "voegSamen", "opslag", "schoon"]) assert.equal(C[weg], undefined, "Celebrate." + weg + " bestaat nog");
  assert.equal(UI.KatTegel, undefined);
});

test("wisselen per ronde: 200 willekeurige reeksen van 60 rondes, nooit twee keer achter elkaar dezelfde, alle zes komen langs", () => {
  for (let zaad = 1; zaad <= 200; zaad++) {
    const { C, ctx, store } = laad();
    ctx.__r = lcg(zaad);
    let vorige = null;
    const gezien = new Set();
    for (let ronde = 0; ronde < 60; ronde++) {
      const id = C.nieuweRonde();
      assert.ok(ALLE.includes(id), `zaad ${zaad}: onbekende kat ${id}`);
      assert.notEqual(id, vorige, `zaad ${zaad}, ronde ${ronde}: ${id} twee keer achter elkaar`);
      assert.equal(JSON.parse(store[VORIGE]), id, "de laatste kat is niet bewaard");
      assert.equal(C.vorige(), id);
      vorige = id; gezien.add(id);
    }
    assert.equal(gezien.size, 6, `zaad ${zaad}: niet alle katten kwamen langs`);
    // alleen die ene sleutel, niets per oefenaar
    assert.deepEqual(Object.keys(store), [VORIGE]);
  }
});

test("wisselen per ronde: ook na herladen, bij Math.random van bijna 0 of 1, met kapotte opslag of helemaal zonder", () => {
  // herladen: de vorige komt uit de opslag
  const store = {};
  for (let i = 0; i < 30; i++) {
    const { C } = laad({ opslag: store });
    const voor = store[VORIGE] ? JSON.parse(store[VORIGE]) : null;
    assert.notEqual(C.nieuweRonde(), voor, "na herladen dezelfde kat als de vorige ronde");
  }
  // randen van Math.random: nooit de vorige en nooit buiten de lijst
  for (const r of [0, 0.999999999]) {
    for (const vorig of ALLE) {
      const { C, ctx } = laad({ opslag: { [VORIGE]: JSON.stringify(vorig) } });
      ctx.__r = () => r;
      const id = C.nieuweRonde();
      assert.ok(ALLE.includes(id), "kat " + id);
      assert.notEqual(id, vorig);
    }
  }
  // kapotte of vreemde waarde in de sleutel: gewoon een kat, en daarna weer netjes
  for (const vies of ["{niet json", JSON.stringify("<img src=x>"), JSON.stringify(["strepen"]), JSON.stringify(7), "null"]) {
    const { C, store: s } = laad({ opslag: { [VORIGE]: vies } });
    assert.equal(C.vorige(), null, "vreemde vorige kat geaccepteerd: " + vies);
    const id = C.nieuweRonde();
    assert.ok(ALLE.includes(id));
    assert.equal(JSON.parse(s[VORIGE]), id);
  }
  // zonder opslag: het geheugen voorkomt herhaling binnen de sessie
  const zonder = laad({ kapot: true });
  let v = null;
  for (let i = 0; i < 50; i++) { const id = zonder.C.nieuweRonde(); assert.notEqual(id, v, "zonder opslag twee keer dezelfde"); v = id; }
});

test("vlekkeloos: celebrate geeft een lofzin, de beloningszin is blij en nooit 'nieuwe kat'", () => {
  const { C } = laad();
  for (let i = 0; i < 20; i++) assert.ok(C.PRAISE.includes(C.celebrate({ woorden: 15 })));
  for (const k of C.KATTEN) {
    const z = C.blij(k.id);
    assert.equal(z, blijeZin(k.naam));
    assert.doesNotMatch(z, /nieuw|verdien|verzamel|kom.*terug/i);
  }
  assert.equal(C.blij("onbekend"), "");
  assert.equal(C.blij("<b>"), "");
});

test("markup: KatRij laat geen vrije HTML toe, oordeel alleen uit een vaste lijst, alles ontsnapt", () => {
  const { C, UI } = laad();
  const rij = UI.KatRij({ id: "q-kat", beeld: C.beeld("strepen", "bijna"), oordeel: "bad", text: "Nog niet", textId: "fb-verdict" });
  assert.equal(rij, '<div class="kat-rij" id="q-kat"><img class="kat" src="katten/strepen-bijna.webp" width="347" height="480" alt="" decoding="async">' +
    '<div class="kat-rij-tekst"><p class="verdict bad" id="fb-verdict">Nog niet</p></div></div>');
  assert.match(UI.KatRij({ beeld: C.beeld("strepen", "goed"), text: "x", kant: "rechts" }), /class="kat-rij is-rechts"/);
  assert.match(UI.KatRij({ beeld: C.beeld("lapjes", "bijna"), lead: "Lastige ronde.", text: "Deze woorden komen vaker terug, zo gaan ze erin." }),
    /<p><b>Lastige ronde\.<\/b> Deze woorden komen vaker terug, zo gaan ze erin\.<\/p>/);
  // html wordt niet meer overgenomen
  const metHtml = UI.KatRij({ beeld: C.beeld("strepen", "goed"), html: "<script>alert(1)</script>", text: "ok" });
  assert.doesNotMatch(metHtml, /script/);
  // oordeel buiten de lijst: geen klasse, en de waarde lekt niet
  const raar = UI.KatRij({ beeld: C.beeld("strepen", "goed"), oordeel: 'good" onclick="x', text: "t" });
  assert.doesNotMatch(raar, /onclick|verdict/);
  const bel = UI.KatBeloning({ beeld: C.beeld("tuxedo", "goed"), title: C.blij("tuxedo") });
  assert.match(bel, /alt="Tuxedo, muziek, blij"/);
  assert.match(bel, /<b>Tuxedo is helemaal blij: alles in één keer goed!<\/b><span class="kat-karakter">muziek<\/span>/);
  // vijandige invoer in elk veld
  const boos = { naam: '<img src=x onerror=alert(1)>', karakter: '"><script>', src: 'x" onerror="alert(1)', width: "<b>", height: "1 onload=x", alt: '"><svg onload=1>' };
  const kwaad = '"><img src=x onerror=alert(1)>';
  for (const html of [
    UI.KatRij({ beeld: boos, text: kwaad, lead: kwaad, textId: kwaad, id: kwaad, className: kwaad, oordeel: kwaad }),
    UI.KatBeloning({ beeld: boos, title: kwaad, id: kwaad, className: kwaad })
  ]) {
    // attribuutwaarden eruit: wat overblijft is de echte structuur. Een
    // aanhalingsteken dat ontsnapt zou, laat hier een handler of tag achter.
    const kaal = html.replace(/="[^"]*"/g, '=""');
    const namen = [...kaal.matchAll(/\s([\w-]+)=""/g)].map(m => m[1]);
    assert.deepEqual(namen.filter(n => !["class", "id", "src", "width", "height", "alt", "decoding"].includes(n)), [], "vreemd attribuut: " + html);
    assert.deepEqual([...kaal.matchAll(/<(\w+)/g)].map(m => m[1]).filter(t => !["div", "img", "p", "figure", "figcaption", "b", "span"].includes(t)), [], html);
    assert.match(html, /width="0" height="0"/);
  }
  assert.equal(UI.KatRij({}), ""); assert.equal(UI.KatBeloning({}), "");
});

// ---------- in de browser ----------
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

const OUD = JSON.stringify({ "cats/gewoon-sok.svg": { aantal: 1, eerst: 1, laatst: 1 } });
const OUD_KATTEN = JSON.stringify({ verdiend: ["strepen", "tuxedo"], huidig: "tuxedo", start: "strepen", bijgewerkt: 1 });

async function open(thema, { reduced = false, zaai = {}, extra = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, colorScheme: thema, serviceWorkers: "block",
    locale: "nl-NL", reducedMotion: reduced ? "reduce" : "no-preference" });
  const extern = await schermNetwerkAf(context);
  // eenmalig zaaien (niet bij een herlaadbeurt opnieuw)
  await context.addInitScript(zaai => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    for (const k in zaai) localStorage.setItem(k, zaai[k]);
  }, Object.assign({ "overhoor:cats:pia": OUD, "overhoor:katten:pia": OUD_KATTEN }, zaai));
  if (extra) await extra(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten, extern };
}
const vorige = page => page.evaluate(k => JSON.parse(localStorage.getItem(k)), VORIGE);
// de kat van de lopende ronde, zoals de app hem in de ronde bewaart
const rondeKat = page => page.evaluate(() => {
  for (const k of Object.keys(localStorage)) if (k.startsWith("overhoor:session:")) { const s = JSON.parse(localStorage.getItem(k)); if (s) return s.kat; }
  return null;
});
const katVan = src => /^katten\/(\w+)-(goed|bijna)\.webp$/.exec(src)?.[1];
async function frans(page) {
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
}
async function perfecteRonde(page) {
  await frans(page);
  for (let i = 0; i < 200; i++) {
    if (await page.locator("#scr-summary").isVisible()) break;
    await beantwoord(page, true); await page.click("#btn-next");
    await page.waitForFunction(() => !document.getElementById("scr-summary").hidden || document.getElementById("btn-next").hidden);
  }
  await wachtOpScherm(page, "scr-summary");
}
async function beeldGeladen(page, sel) {
  await page.waitForFunction(s => { const i = document.querySelector(s); return i && i.complete && i.naturalWidth > 0; }, sel, { timeout: 5000 });
}
// contrast, overloop en fouten op het huidige scherm
async function keur(page, naam, problemen, fouten) {
  await page.evaluate(rondAnimatiesAf);
  const o = await page.evaluate(overloopMeting);
  if (o.overloop) problemen.push(`[${naam}] overloop: ${o.boosdoeners.join(", ")}`);
  const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
  for (const f of c.fouten) problemen.push(`[${naam}] contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
  for (const f of c.nietMeetbaar) problemen.push(`[${naam}] contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
  for (const f of fouten.splice(0)) problemen.push(`[${naam}] ${f}`);
}
// de kat in een rij: stand, versiering, niet gespiegeld, 120 px, oortje 30 px over de kaart, niets eronder
async function meetRij(page, rij, kaart) {
  await page.evaluate(rondAnimatiesAf);
  await beeldGeladen(page, rij + " .kat");
  return page.evaluate(([rij, kaart]) => {
    const img = document.querySelector(rij + " .kat"), k = document.querySelector(kaart);
    const ri = img.getBoundingClientRect(), rk = k.getBoundingClientRect();
    // alles in de kaart met inhoud moet boven de kat eindigen
    const onder = [...k.querySelectorAll("*")].filter(e => e.checkVisibility() && !e.children.length && e.getBoundingClientRect().height > 0)
      .filter(e => e.getBoundingClientRect().bottom > ri.top + 0.5 && e.getBoundingClientRect().right > ri.left && e.getBoundingClientRect().left < ri.right)
      .map(e => e.id || e.className || e.tagName);
    const bovenop = document.elementFromPoint(ri.left + ri.width / 2, ri.top + 4);
    return { src: img.getAttribute("src"), alt: img.getAttribute("alt"), hoogte: Math.round(ri.height),
      oor: Math.round((rk.bottom - ri.top) * 10) / 10, transform: getComputedStyle(img).transform, onder,
      katBoven: !!bovenop && (bovenop === img || !k.contains(bovenop)),
      tekst: document.querySelector(rij + " .kat-rij-tekst").textContent.trim() };
  }, [rij, kaart]);
}
async function geenKattenOpslag(page) {
  const k = await page.evaluate(() => Object.keys(localStorage).filter(k => /^overhoor:katten:/.test(k)).map(k => [k, localStorage.getItem(k)]));
  assert.deepEqual(k, [["overhoor:katten:pia", OUD_KATTEN]], "overhoor:katten:* is geschreven of veranderd");
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:cats:pia")), OUD, "oude kattendata is aangeraakt");
}

for (const thema of THEMAS) {
  test(`goed, fout en lastige ronde: steeds de kat van deze ronde (${thema}, 360px)`, async () => {
    const { context, page, fouten } = await open(thema);
    const problemen = [];
    assert.equal(await vorige(page), null, "er is al een kat gekozen voor er een ronde is");
    await frans(page);
    const kat = await rondeKat(page);
    assert.ok(ALLE.includes(kat), "de ronde heeft geen kat");
    assert.equal(await vorige(page), kat);
    assert.ok(await page.locator("#q-kat").isHidden(), "kat staat er al voor het antwoord");

    await beantwoord(page, true);
    let r = await meetRij(page, "#q-kat", "#scr-quiz .q-card");
    assert.equal(r.src, `katten/${kat}-goed.webp`);
    assert.equal(r.alt, "", "de kat in de feedbackrij is versiering");
    assert.equal(r.hoogte, 120);
    assert.ok(Math.abs(r.oor - 30) <= 1, "oortje steekt " + r.oor + "px over de kaart, verwacht 30");
    assert.equal(r.transform, "none", "kat links hoort niet gespiegeld te zijn");
    assert.deepEqual(r.onder, [], "de kat valt over inhoud van de kaart");
    assert.ok(r.katBoven, "de kaart ligt over de kat heen");
    assert.equal(await page.locator("#q-kat .verdict.good#fb-verdict").count(), 1);
    assert.ok(await page.locator("#feedback").isHidden(), "bij goed staat er nog feedback in de kaart");
    assert.equal(await page.locator(".verdict").count(), 1, "oordeel staat dubbel");
    await keur(page, "goed", problemen, fouten);

    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    assert.ok(await page.locator("#q-kat").isHidden(), "kat blijft staan bij de volgende vraag");
    await beantwoord(page, false);
    r = await meetRij(page, "#q-kat", "#scr-quiz .q-card");
    assert.equal(r.src, `katten/${kat}-bijna.webp`, "binnen de ronde een andere kat");
    assert.equal(r.alt, "");
    assert.ok(Math.abs(r.oor - 30) <= 1);
    assert.deepEqual(r.onder, [], "de kat valt over de feedback in de kaart");
    assert.equal(await page.locator("#q-kat .verdict.bad").count(), 1);
    assert.ok(await page.locator("#feedback .fb-list").isVisible(), "details van het foute antwoord ontbreken");
    assert.equal(await page.locator(".verdict").count(), 1, "oordeel staat dubbel");
    assert.doesNotMatch(r.tekst, /jammer|helaas|kom terug|verdrietig/i);
    await keur(page, "fout", problemen, fouten);

    // nog een goed antwoord: nog steeds dezelfde kat
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    await beantwoord(page, true);
    assert.equal(katVan(await page.locator("#q-kat .kat").getAttribute("src")), kat, "binnen de ronde een andere kat");

    // lastige ronde: nog een fout (2 van 3), dan stoppen
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    await beantwoord(page, false);
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    await beantwoord(page, false);
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    r = await meetRij(page, "#sum-kat", "#scr-summary .card");
    assert.equal(r.src, `katten/${kat}-bijna.webp`, "de lastige ronde toont een andere kat dan die van de ronde");
    assert.equal(r.tekst, "Lastige ronde. Deze woorden komen vaker terug, zo gaan ze erin.");
    assert.equal(await page.locator("#sum-kat .kat-rij-tekst b").textContent(), "Lastige ronde.");
    assert.deepEqual(r.onder, [], "de kat valt over de knoppen van de samenvatting");
    assert.ok(await page.locator("#sum-beloning").isHidden());
    assert.equal(await page.locator("canvas.fx-canvas").count(), 0);
    await keur(page, "lastige ronde", problemen, fouten);

    await geenKattenOpslag(page);
    await context.close();
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });

  test(`vlekkeloze ronde: confetti en de blije kat van de ronde, daarna een andere kat (${thema}, 360px)`, async () => {
    const { context, page, fouten } = await open(thema);
    const problemen = [];
    await frans(page);
    const kat = await rondeKat(page);
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");

    await perfecteRonde(page);
    const kat2 = await vorige(page);
    assert.ok(ALLE.includes(kat2));
    assert.notEqual(kat2, kat, "twee rondes achter elkaar dezelfde kat");
    assert.ok(await page.locator("canvas.fx-canvas").count() > 0, "geen confetti");
    await beeldGeladen(page, "#sum-beloning .kat");
    const b = await page.evaluate(id => window.Celebrate.beeld(id, "goed"), kat2);
    assert.equal((await page.locator("#sum-title").textContent()).trim(), "Vlekkeloos");
    assert.equal((await page.locator("#sum-beloning figcaption b").textContent()).trim(), blijeZin(b.naam));
    assert.equal((await page.locator("#sum-beloning .kat-karakter").textContent()).trim(), b.karakter);
    assert.equal(await page.locator("#sum-beloning .kat").getAttribute("alt"), `${b.naam}, ${b.karakter}, blij`);
    assert.equal(await page.locator("#sum-beloning .kat").getAttribute("src"), `katten/${kat2}-goed.webp`);
    assert.equal(await page.locator("#sum-beloning").evaluate(e => getComputedStyle(e).rotate), "-3deg");
    assert.ok(await page.locator("#sum-kat").isHidden(), "lastige-rondekat bij een vlekkeloze ronde");
    const lof = (await page.locator("#sum-perfect").textContent()).trim();
    assert.ok(await page.evaluate(t => window.Celebrate.PRAISE.includes(t), lof), "lofzin ontbreekt: " + lof);
    assert.doesNotMatch(await page.locator("#scr-summary").textContent(), /nieuwe kat|verdiend|verzamel/i);
    await keur(page, "vlekkeloos", problemen, fouten);

    // volgende ronde: een andere kat dan de vlekkeloze
    await page.click("#btn-sum-home"); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
    await beantwoord(page, true);
    const kat3 = katVan(await page.locator("#q-kat .kat").getAttribute("src"));
    assert.notEqual(kat3, kat2, "na de vlekkeloze ronde dezelfde kat");
    assert.equal(kat3, await vorige(page));
    await geenKattenOpslag(page);
    await context.close();
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });
}

test("wisselen in de app: tien rondes achter elkaar nooit dezelfde kat, ook na herladen", async () => {
  const { context, page, fouten } = await open("light");
  const katten = [];
  for (let i = 0; i < 10; i++) {
    if (i === 5) { await page.reload(); await wachtOpScherm(page, "scr-lessons"); }
    await frans(page);
    await beantwoord(page, i % 2 === 0);
    const kat = katVan(await page.locator("#q-kat .kat").getAttribute("src"));
    assert.equal(kat, await rondeKat(page));
    if (katten.length) assert.notEqual(kat, katten[katten.length - 1], `ronde ${i + 1}: dezelfde kat als ronde ${i}`);
    katten.push(kat);
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
  }
  assert.ok(new Set(katten).size >= 3, "het wisselt nauwelijks: " + katten.join(", "));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("hervatte ronde: na herladen dezelfde kat; een ronde van voor de katten krijgt er een", async () => {
  const { context, page, fouten } = await open("light");
  await frans(page);
  await beantwoord(page, true);
  await beeldGeladen(page, "#q-kat .kat");
  const kat = katVan(await page.locator("#q-kat .kat").getAttribute("src"));
  await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.locator("#resume").waitFor({ state: "visible" });
  await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
  await beantwoord(page, false);
  await beeldGeladen(page, "#q-kat .kat");
  assert.equal(await page.locator("#q-kat .kat").getAttribute("src"), `katten/${kat}-bijna.webp`, "hervatte ronde heeft een andere kat");
  assert.equal(await vorige(page), kat, "hervatten koos een nieuwe kat");

  // een opgeslagen ronde zonder kat (of met een onbekende): krijgt er een die niet de vorige is
  for (const vreemd of [undefined, "<img src=x>"]) {
    await page.evaluate(v => {
      for (const k of Object.keys(localStorage)) if (k.startsWith("overhoor:session:")) {
        const s = JSON.parse(localStorage.getItem(k));
        if (v === null) delete s.kat; else s.kat = v;
        localStorage.setItem(k, JSON.stringify(s));
      }
    }, vreemd ?? null);
    const voor = await vorige(page);
    await page.reload(); await wachtOpScherm(page, "scr-lessons");
    await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
    await beantwoord(page, true);
    await beeldGeladen(page, "#q-kat .kat");
    const nieuw = katVan(await page.locator("#q-kat .kat").getAttribute("src"));
    assert.ok(ALLE.includes(nieuw), "geen kat bij een oude ronde");
    assert.notEqual(nieuw, voor);
    assert.equal(await rondeKat(page), nieuw, "de nieuwe kat is niet in de ronde bewaard");
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
  }
  assert.deepEqual(fouten.filter(f => !/HTTP 404: .*\/x$/.test(f)), []);
  await context.close();
});

test("hervatte ronde na een andere ronde: de volgende nieuwe ronde herhaalt de hervatte kat niet", async () => {
  const { context, page, fouten } = await open("light");
  // De toets op de vorige kat is vast; de herhaling zelf heeft per keer
  // maar 1 op 5 kans, daarom een paar keer.
  for (let i = 0; i < 5; i++) {
    await frans(page);
    const x = await rondeKat(page);
    await beantwoord(page, true); await beeldGeladen(page, "#q-kat .kat");
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    // tussendoor een ronde in een andere lijst
    await page.reload(); await wachtOpScherm(page, "scr-lessons");
    await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
    // Frans hervatten: weer x, en die ronde afbreken
    await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
    assert.equal(await rondeKat(page), x);
    assert.equal(await vorige(page), x, "de hervatte kat telt niet als de laatst getoonde");
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
    // nieuwe ronde: niet x
    await frans(page);
    assert.notEqual(await rondeKat(page), x, "na de hervatte ronde meteen dezelfde kat");
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
  }
  assert.deepEqual(fouten, []);
  await context.close();
});

test("geen Mijn katten meer: geen knop, geen scherm, en de rondehint belooft geen kat", async () => {
  const { context, page, fouten } = await open("light");
  assert.equal(await page.locator("#btn-cats, #scr-cats, .kat-tegel, .kat-raster").count(), 0);
  assert.doesNotMatch(await page.locator("body").textContent(), /Mijn katten/);
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  const hint = (await page.locator("#size-hint").textContent()).trim();
  assert.match(hint, /Alles in één keer goed: confetti\./);
  assert.doesNotMatch(hint, /kat/i, "de hint maakt de kat nog tot prijs");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("reduced motion: geen confetti en de kat komt zonder beweging", async () => {
  const { context, page, fouten } = await open("light", { reduced: true });
  await frans(page);
  await beantwoord(page, true);
  await beeldGeladen(page, "#q-kat .kat");
  assert.equal(await page.locator("#q-kat .kat").evaluate(e => e.getAnimations().length), 0, "kat beweegt bij reduced motion");
  await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
  await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
  await perfecteRonde(page);
  assert.equal(await page.locator("canvas.fx-canvas").count(), 0, "confetti bij reduced motion");
  await beeldGeladen(page, "#sum-beloning .kat");
  assert.equal(await page.locator("#sum-beloning .kat").evaluate(e => e.getAnimations().length), 0);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("zonder reduced motion: korte entree, onder 400 ms, geen lus, alleen transform en opacity", async () => {
  const { context, page } = await open("light");
  await frans(page);
  await beantwoord(page, true);
  const a = await page.locator("#q-kat .kat").evaluate(e => e.getAnimations().map(x => {
    const t = x.effect.getTiming();
    const props = [...new Set(x.effect.getKeyframes().flatMap(k => Object.keys(k)).filter(k => !["offset", "easing", "composite", "computedOffset"].includes(k)))];
    return { duur: t.duration, keer: t.iterations, props };
  }));
  assert.equal(a.length, 1);
  assert.ok(a[0].duur < 400, "entree duurt " + a[0].duur + " ms");
  assert.equal(a[0].keer, 1);
  for (const p of a[0].props) assert.ok(["opacity", "translate", "scale", "rotate", "transform"].includes(p), "animeert " + p);
  await context.close();
});

// ---------- sync aan de client-kant ----------
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT" };
function metSync(antwoord, puts, { vertraag = null } = {}) {
  return async ctx => {
    await ctx.addInitScript(() => { if (!localStorage.getItem("overhoor:app-secret")) localStorage.setItem("overhoor:app-secret", JSON.stringify("test")); });
    await ctx.route(/workers\.dev\/sync\//, async route => {
      const req = route.request();
      if (req.method() === "PUT") puts.push({ url: req.url(), body: JSON.parse(req.postData()) });
      if (req.method() === "GET" && vertraag) await vertraag(req.url());
      const body = req.method() === "PUT" ? {} : (typeof antwoord === "function" ? antwoord(req.url()) : antwoord);
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body), headers: CORS });
    });
  };
}
// het id van de Franse lijst, zonder browser uit lists.js
const FRANS_ID = (() => { const c = vm.createContext({}); c.window = c; vm.runInContext(lees("lists.js"), c); return c.WORDLISTS.find(l => l.title === "Arrêt Apprendre").id; })();
const FRANS = () => FRANS_ID;

test("sync: de app stuurt geen katten mee en leest ze niet; de oude cats gaan ongewijzigd mee", async () => {
  const puts = [];
  const remote = { updated: 9, katten: { verdiend: ["stippen", "lapjes"], huidig: "lapjes", start: "stippen", bijgewerkt: 9 } };
  const { context, page, fouten } = await open("light", { extra: metSync(remote, puts) });
  await page.waitForTimeout(300);
  await perfecteRonde(page);
  for (let i = 0; i < 40 && !puts.length; i++) await page.waitForTimeout(100);
  assert.ok(puts.length, "geen PUT naar de worker");
  for (const p of puts) {
    assert.equal("katten" in p.body, false, "de app stuurt nog katten mee");
    assert.deepEqual(Object.keys(p.body).sort(), ["cats", "lists", "progress", "updated"]);
  }
  assert.deepEqual(puts[puts.length - 1].body.cats, JSON.parse(OUD), "oude cats gaan niet ongewijzigd mee");
  await geenKattenOpslag(page);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("sync: een kapot onderdeel houdt de rest niet tegen", async () => {
  const f = FRANS_ID, id = "remote-lijst";
  const lijst = { id, title: "Lijst van ver", subject: "Engels", from: "Engels", to: "Nederlands", added: 5, items: [{ word: "cat", def: "kat" }] };
  const voortgang = { items: { 0: { box: 2, lapses: 0, seen: 1, due: 0, partWrong: {}, dirWrong: {} } }, sessions: [], updated: 50 };
  const gevallen = [
    // [naam, antwoord, wat er moet landen]
    ["cats is null", { updated: 9, cats: null, progress: { [f]: voortgang }, lists: [lijst] }, { progress: true, lists: true }],
    ["cats is een tekst", { updated: 9, cats: "kapot", progress: { [f]: voortgang }, lists: [lijst] }, { progress: true, lists: true }],
    ["cats bevat rommel", { updated: 9, cats: { a: null, b: 7, "cats/x.svg": { laatst: 3, aantal: 1 } }, progress: { [f]: voortgang }, lists: [lijst] }, { progress: true, lists: true, cats: true }],
    ["progress is een lijst", { updated: 9, progress: [1, 2], lists: [lijst] }, { lists: true }],
    ["progress-onderdeel is null", { updated: 9, progress: { [f]: null, x: "y" }, lists: [lijst] }, { lists: true }],
    ["progress-onderdeel is een getal", { updated: 9, progress: { [f]: 5, y: [1] }, lists: [lijst] }, { lists: true }],
    ["lists is een object", { updated: 9, progress: { [f]: voortgang }, lists: { id: 1 } }, { progress: true }],
    ["lists met rommel", { updated: 9, progress: { [f]: voortgang }, lists: [null, 1, "x", { id: null }, lijst] }, { progress: true, lists: true }],
    ["alles rommel", { updated: 9, cats: [1], progress: "x", lists: 3 }, {}],
    ["antwoord is een lijst", [1, 2], {}]
  ];
  for (const [naam, antwoord, verwacht] of gevallen) {
    let opgehaald = false;
    // er staat al voortgang (ouder dan die van de worker), zodat een kapot
    // onderdeel echt vergeleken wordt en niet alleen weggeschreven
    const { context, page, fouten } = await open("light", {
      zaai: { ["overhoor:progress:pia:" + f]: JSON.stringify({ items: {}, sessions: [], updated: 10 }) },
      extra: metSync(antwoord, [], { vertraag: async () => { opgehaald = true; } })
    });
    for (let i = 0; i < 40 && !opgehaald; i++) await page.waitForTimeout(50);
    assert.ok(opgehaald, `[${naam}] de app haalde niets op`);
    await page.waitForTimeout(300);
    const st = await page.evaluate(fid => ({
      progress: JSON.parse(localStorage.getItem("overhoor:progress:pia:" + fid)),
      lists: JSON.parse(localStorage.getItem("overhoor:lists") || "[]"),
      cats: JSON.parse(localStorage.getItem("overhoor:cats:pia")),
      alleVoortgang: Object.keys(localStorage).filter(k => k.startsWith("overhoor:progress:")).map(k => [k, JSON.parse(localStorage.getItem(k))])
    }), f);
    for (const [k, v] of st.alleVoortgang) assert.ok(v && typeof v === "object" && !Array.isArray(v), `[${naam}] rommel opgeslagen als voortgang: ${k} = ${JSON.stringify(v)}`);
    if (!verwacht.progress) assert.equal(st.progress.updated, 10, `[${naam}] eigen voortgang aangetast`);
    assert.equal(!!(st.progress && st.progress.updated === 50), !!verwacht.progress, `[${naam}] voortgang ${verwacht.progress ? "niet" : "toch"} binnengekomen`);
    assert.equal(st.lists.some(l => l && l.id === id), !!verwacht.lists, `[${naam}] lijst ${verwacht.lists ? "niet" : "toch"} binnengekomen`);
    assert.ok(st.lists.every(l => l && typeof l === "object" && l.id != null), `[${naam}] rommel in de lijsten`);
    assert.deepEqual(st.cats["cats/gewoon-sok.svg"], JSON.parse(OUD)["cats/gewoon-sok.svg"], `[${naam}] oude cats kwijt`);
    if (verwacht.cats) assert.deepEqual(st.cats["cats/x.svg"], { laatst: 3, aantal: 1 });
    assert.ok(Object.values(st.cats).every(v => v && typeof v === "object"), `[${naam}] rommel in de oude cats`);
    assert.deepEqual(fouten, [], naam);
    await context.close();
  }
});

test("sync: wisselen van oefenaar terwijl het ophalen loopt, het antwoord landt niet bij de nieuwe", async () => {
  const f = FRANS_ID;
  let loslaten;
  const wacht = new Promise(r => { loslaten = r; });
  const gezien = [];
  const voortgang = { items: { 0: { box: 4, lapses: 0, seen: 3, due: 0, partWrong: {}, dirWrong: {} } }, sessions: [], updated: 77 };
  const { context, page, fouten } = await open("light", {
    zaai: { "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia"]) },
    extra: metSync(url => url.endsWith("/pia")
      ? { updated: 9, progress: { [f]: voortgang }, lists: [{ id: "van-pia", title: "x", items: [], added: 1 }] }
      : { updated: 9, lists: [{ id: "van-tom", title: "y", items: [], added: 1 }] }, [], {
      // het antwoord voor Pia blijft hangen tot de test het loslaat
      vertraag: async url => { gezien.push(url.split("/").pop()); if (url.endsWith("/pia")) await wacht; }
    })
  });
  for (let i = 0; i < 40 && !gezien.includes("pia"); i++) await page.waitForTimeout(50);
  assert.ok(gezien.includes("pia"), "geen pull voor Pia gestart");
  await page.click("#btn-learner"); await page.fill("#learner-name", "Tom"); await page.click("#btn-learner-save");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  for (let i = 0; i < 40 && !gezien.includes("tom"); i++) await page.waitForTimeout(50);
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem("overhoor:lists") || "[]")).some(l => l.id === "van-tom"), null, { timeout: 5000 });
  loslaten();
  await page.waitForTimeout(500);
  const st = await page.evaluate(fid => ({
    tom: localStorage.getItem("overhoor:progress:tom:" + fid),
    pia: localStorage.getItem("overhoor:progress:pia:" + fid),
    lijsten: JSON.parse(localStorage.getItem("overhoor:lists") || "[]").map(l => l.id)
  }), f);
  assert.equal(st.tom, null, "het antwoord voor Pia is bij Tom beland");
  assert.equal(st.pia, null, "een verouderd antwoord is toch verwerkt");
  assert.ok(!st.lijsten.includes("van-pia"), "een verouderd antwoord is toch verwerkt");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("beveiliging: getallen uit opslag komen nooit rauw in Voortgang en Rapport", async () => {
  const boos = "5<img src=x onerror=\"window.__xss=1\">";
  const { context, page, fouten } = await open("light");
  const id = FRANS();
  await page.evaluate(([id, boos]) => {
    localStorage.setItem("overhoor:progress:pia:" + id, JSON.stringify({
      items: { 0: { box: boos, lapses: boos, seen: 3, due: 0, partWrong: {}, dirWrong: {} }, 1: { box: "<b>", lapses: 9, seen: 1, due: 0, partWrong: {}, dirWrong: {} } },
      sessions: [{ date: 1, n: boos, first: boos, ms: boos, stopped: false }], updated: 1 }));
  }, [id, boos]);
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  assert.equal(await page.locator("#progress-body img").count(), 0, "HTML uit opslag in Voortgang");
  await page.click("#btn-progress-back"); await page.click("#btn-home-back");
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  assert.equal(await page.locator("#report-body img").count(), 0, "HTML uit opslag in Rapport");
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.__xss), undefined);
  assert.deepEqual(fouten.filter(f => !/HTTP 404: .*\/x$/.test(f)), []);
  await context.close();
});
