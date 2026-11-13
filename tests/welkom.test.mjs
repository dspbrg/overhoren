// Het welkom bij het openen (variant A uit de opzet van Dieter): heel
// scherm, de naam van de app, de kat van de eerstvolgende ronde springt
// omhoog en wiebelt twee keer, dan "Hoi <naam>", daarna vervaagt alles.
// Samen 1,2 s. Tik of toets haalt het eerder weg, de app eronder is zolang
// inert. Hooguit een keer per kalenderdag per apparaat, niet binnen
// dezelfde sessie en niet als er een ronde openstaat. Alleen als het beeld
// binnen 300 ms klaar is. Reduced motion: een stilstaand eindbeeld.
//
// Alle andere tests zetten de dag van het welkom al op vandaag (zie
// tests/lib/omgeving.mjs); hier opent elke context met { welkom: true }.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES, WELKOM_DAG } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting } from "./lib/meten.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const lees = f => readFileSync(join(REPO, f), "utf8");
const ALLE = ["strepen", "tuxedo", "lapjes", "sokjes", "stippen", "rodestreep"];
const VORIGE = "overhoor:kat:vorige";
const katVan = src => /katten\/(\w+)-goed\.webp$/.exec(src || "")?.[1];

// ---------- zonder browser ----------
function laad({ opslag = {} } = {}) {
  const store = opslag;
  const ctx = vm.createContext({
    localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } },
    __r: null
  });
  ctx.window = ctx;
  ctx.matchMedia = () => ({ matches: true });
  vm.runInContext("const __echt = Math.random; Math.random = () => (globalThis.__r ? globalThis.__r() : __echt());", ctx);
  vm.runInContext(lees("ui.js"), ctx);
  vm.runInContext(lees("celebrate.js"), ctx);
  return { C: ctx.Celebrate, UI: ctx.UI, store, ctx };
}
function lcg(zaad) { let s = zaad >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32); }

test("volgende kat: kiest zonder te onthouden, en de ronde daarna krijgt precies die kat", () => {
  const { C, store } = laad({ opslag: { [VORIGE]: JSON.stringify("sokjes") } });
  assert.equal(typeof C.volgende, "function", "Celebrate.volgende ontbreekt");
  const voor = JSON.stringify(store);
  const v = C.volgende();
  assert.ok(ALLE.includes(v));
  assert.notEqual(v, "sokjes", "de volgende kat is de vorige");
  assert.equal(JSON.stringify(store), voor, "volgende() schrijft iets weg");
  assert.equal(C.volgende(), v, "twee keer vragen geeft een andere kat");
  assert.equal(C.nieuweRonde(), v, "de ronde krijgt niet de kat van het welkom");
  assert.equal(JSON.parse(store[VORIGE]), v);
  // daarna wordt er weer vers gekozen, en nooit dezelfde als net
  assert.notEqual(C.volgende(), v);
});

test("volgende kat: 300 willekeurige reeksen, nooit twee keer dezelfde kat na elkaar, welkom en ronde altijd gelijk", () => {
  for (let zaad = 1; zaad <= 300; zaad++) {
    const { C, ctx } = laad();
    const r = lcg(zaad); ctx.__r = r;
    let laatste = null, beloofd = null;
    for (let stap = 0; stap < 30; stap++) {
      const x = r();
      if (x < 0.4) {
        beloofd = C.volgende();
        assert.notEqual(beloofd, laatste, `zaad ${zaad}: welkom toont de vorige kat`);
      } else if (x < 0.85) {
        const id = C.nieuweRonde();
        assert.notEqual(id, laatste, `zaad ${zaad}: twee rondes na elkaar ${id}`);
        if (beloofd) assert.equal(id, beloofd, `zaad ${zaad}: welkom ${beloofd}, ronde ${id}`);
        laatste = id; beloofd = null;
      } else {
        // een hervatte ronde: zijn kat telt als de laatste
        const id = ALLE[Math.floor(r() * ALLE.length)];
        C.onthoud(id);
        if (beloofd === id) beloofd = null;   // die kat mag nu niet meer
        laatste = id;
      }
    }
  }
});

test("UI.Welkom: de naam gaat door esc(), zonder naam geen Hoi, de kat is versiering", () => {
  const { C, UI } = laad();
  assert.equal(typeof UI.Welkom, "function", "UI.Welkom ontbreekt");
  const b = C.welkomBeeld("tuxedo");
  assert.equal(b.src, "katten/tuxedo-goed.webp");
  assert.equal(b.width, C.beeld("tuxedo", "goed").width);
  const html = UI.Welkom({ beeld: b, naam: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img src=x/, "naam niet ontsnapt");
  assert.match(html, /Hoi &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /<img class="welkom-kat" src="katten\/tuxedo-goed\.webp" width="\d+" height="480" alt="">/);
  for (const naam of ["", "   ", null, undefined]) assert.doesNotMatch(UI.Welkom({ beeld: b, naam }), /Hoi/, `"Hoi" bij naam ${JSON.stringify(naam)}`);
  assert.match(UI.Welkom({ beeld: b, naam: " Pia " }), /<p class="welkom-groet">Hoi Pia<\/p>/);
  assert.equal(UI.Welkom({ naam: "Pia" }), "", "zonder beeld geen welkom");
  // de toon: geen uitroeptekens, geen em dashes
  const tekst = UI.Welkom({ beeld: b, naam: "Pia" }).replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(tekst, /[!—]/);
});

test("welkom in ds.css: duur 1,2 s, alleen transform en opacity, uit bij reduced motion", () => {
  const css = lees("ds.css");
  assert.match(css, /--welkom-duur:\s*1200ms;/);
  const frames = [...css.matchAll(/@keyframes (welkom-[\w-]+)\s*\{((?:[^{}]*\{[^}]*\})+)\s*\}/g)];
  assert.ok(frames.length >= 4, "keyframes van het welkom niet gevonden");
  for (const [, naam, body] of frames) {
    const props = [...body.matchAll(/([\w-]+)\s*:/g)].map(m => m[1]);
    for (const p of props) assert.ok(["opacity", "translate", "scale", "rotate", "transform"].includes(p), `${naam} animeert ${p}`);
  }
  // reduced motion zet alle animaties uit (de algemene regel onderaan)
  assert.match(css, /prefers-reduced-motion: reduce\)\s*\{\s*\*\s*\{[^}]*animation: none !important/);
});

// ---------- in de browser ----------
let browser, server, LIJST;
before(async () => {
  browser = await startBrowser(); server = await startServer();
  const ctx = vm.createContext({}); ctx.window = ctx; vm.runInContext(lees("lists.js"), ctx);
  LIJST = ctx.WORDLISTS[0].id;
});
after(async () => { await browser?.close(); await server?.stop(); });

// Houdt bij of het welkom ooit verscheen en wanneer, ook als het al weg is.
function kijker() {
  window.__welkom = { gezien: 0, weg: 0, inert: false };
  new MutationObserver(() => {
    const el = document.querySelector("body > .welkom");
    const w = window.__welkom;
    if (el && !w.gezien) { w.gezien = performance.now(); w.inert = !!document.querySelector("body > .app")?.inert; }
    if (!el && w.gezien && !w.weg) w.weg = performance.now();
  }).observe(document, { childList: true, subtree: true });
}

async function nieuweContext({ thema = "light", breedte = 360, reduced = false, zaai = {} } = {}) {
  const context = await browser.newContext({ welkom: true, viewport: { width: breedte, height: 780 }, colorScheme: thema,
    serviceWorkers: "block", locale: "nl-NL", reducedMotion: reduced ? "reduce" : "no-preference" });
  const extern = await schermNetwerkAf(context);
  await context.addInitScript(zaai => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    for (const k in zaai) localStorage.setItem(k, zaai[k]);
  }, zaai);
  await context.addInitScript(kijker);
  return { context, extern };
}
async function openPagina(context, { klok = false } = {}) {
  const page = await context.newPage();
  const fouten = volgFouten(page);
  if (klok) await page.clock.install();
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { page, fouten };
}
const vandaag = page => page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
const welkomEl = page => page.locator("body > .welkom");
// wacht lang genoeg om zeker te weten dat er geen welkom komt (300 ms beeld plus marge)
const geenWelkom = async page => { await page.waitForTimeout(700); return page.evaluate(() => ({ ...window.__welkom, nu: !!document.querySelector(".welkom") })); };

test("welkom: de eerste keer vandaag, heel scherm, app inert, Hoi Pia, na 1,2 s weg en de dag onthouden", async () => {
  const { context } = await nieuweContext();
  const { page, fouten } = await openPagina(context);
  await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
  const r = await page.evaluate(() => {
    const el = document.querySelector("body > .welkom"), k = el.getBoundingClientRect();
    return { inert: document.querySelector("body > .app").inert, groet: el.querySelector(".welkom-groet")?.textContent,
      heel: k.left === 0 && k.top === 0 && k.width === innerWidth && k.height === innerHeight,
      kat: el.querySelector("img.welkom-kat")?.getAttribute("alt"), merk: el.querySelector(".welkom-merk")?.textContent.replace(/\s+/g, " ").trim() };
  });
  assert.equal(r.inert, true, "de app eronder is niet inert");
  assert.equal(r.groet, "Hoi Pia");
  assert.ok(r.heel, "het welkom bedekt niet het hele scherm");
  assert.equal(r.kat, "", "de kat is versiering, alt hoort leeg");
  assert.equal(r.merk, "Overhoren Beta");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), await vandaag(page));
  await welkomEl(page).waitFor({ state: "detached", timeout: 2500 });
  const w = await page.evaluate(() => window.__welkom);
  const duur = w.weg - w.gezien;
  assert.ok(duur > 1050 && duur < 1600, `welkom stond ${Math.round(duur)} ms, verwacht 1200`);
  assert.equal(await page.evaluate(() => document.querySelector("body > .app").inert), false, "app blijft inert na het welkom");
  // de app werkt daarna gewoon
  await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: hooguit een keer per dag; nieuw tabblad dezelfde dag niet, de volgende dag weer wel", async () => {
  const { context } = await nieuweContext();
  const een = await openPagina(context);
  await welkomEl(een.page).waitFor({ state: "attached", timeout: 1500 });
  const twee = await openPagina(context);
  const r = await geenWelkom(twee.page);
  assert.equal(r.gezien, 0, "welkom kwam twee keer op dezelfde dag");
  // een dag later (de bewaarde dag is gisteren of ouder)
  await twee.page.evaluate(k => localStorage.setItem(k, "2000-01-01"), WELKOM_DAG);
  const drie = await openPagina(context);
  await welkomEl(drie.page).waitFor({ state: "attached", timeout: 1500 });
  assert.equal(await drie.page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), await vandaag(drie.page));
  assert.deepEqual([...een.fouten, ...twee.fouten, ...drie.fouten], []);
  await context.close();
});

test("welkom: niet als je binnen de sessie terugkomt, ook niet na middernacht", async () => {
  const { context } = await nieuweContext();
  const { page, fouten } = await openPagina(context);
  await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
  await welkomEl(page).waitFor({ state: "detached", timeout: 2500 });
  // de dag verstrijkt terwijl de app openstaat, en ze herlaadt
  await page.evaluate(k => localStorage.setItem(k, "2000-01-01"), WELKOM_DAG);
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.equal((await geenWelkom(page)).gezien, 0, "welkom bij terugkomen in dezelfde sessie");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: niet bij een ronde die openstaat om te hervatten; die houdt zijn eigen kat", async () => {
  const sessie = { listId: LIJST, queue: [{ i: 0, dir: null }, { i: 1, dir: null }], pos: 1, total: 2, attempts: {}, firstTry: {},
    done: 1, streak: 0, skipped: 0, startedAt: Date.now(), elapsedBefore: 0, actief: 0, laatsteActie: Date.now(), kind: "nieuw", kat: "lapjes" };
  const { context } = await nieuweContext({ zaai: { ["overhoor:session:pia:" + LIJST]: JSON.stringify(sessie), "overhoor:current": JSON.stringify(LIJST), [VORIGE]: JSON.stringify("lapjes") } });
  const { page, fouten } = await openPagina(context);
  const r = await geenWelkom(page);
  assert.equal(r.gezien, 0, "welkom terwijl er een ronde openstaat");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), null, "de dag is onthouden zonder welkom");
  // hervatten werkt en houdt de kat
  await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
  assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), VORIGE), "lapjes");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: de kat is die van de eerstvolgende ronde, en nooit de vorige", async () => {
  for (const vorige of ["strepen", "sokjes", "rodestreep"]) {
    const { context } = await nieuweContext({ zaai: { [VORIGE]: JSON.stringify(vorige) } });
    const { page, fouten } = await openPagina(context);
    await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
    const kat = katVan(await page.locator("body > .welkom img.welkom-kat").getAttribute("src"));
    assert.ok(ALLE.includes(kat), "geen kat in het welkom");
    assert.notEqual(kat, vorige, "het welkom toont de kat van de vorige ronde");
    await welkomEl(page).waitFor({ state: "detached", timeout: 2500 });
    await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
    assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), VORIGE), kat, "de ronde heeft een andere kat dan het welkom");
    const inBeeld = katVan(await page.locator("#scr-quiz img.kat").first().getAttribute("src").catch(() => null));
    if (inBeeld) assert.equal(inBeeld, kat);
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("welkom wegtikken: een tik of een toets haalt het meteen weg en doet verder niets", async () => {
  // tik midden op het scherm, waar eronder een lijst ligt
  {
    const { context } = await nieuweContext();
    const { page, fouten } = await openPagina(context);
    await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
    const t0 = Date.now();
    await page.mouse.click(180, 390);
    await welkomEl(page).waitFor({ state: "detached", timeout: 300 });
    assert.ok(Date.now() - t0 < 600, "wegtikken duurde te lang");
    assert.equal(await page.evaluate(() => document.querySelector("body > .app").inert), false);
    assert.ok(await page.locator("#scr-lessons").isVisible(), "de tik ging door naar de app");
    assert.deepEqual(fouten, []);
    await context.close();
  }
  for (const toets of ["Enter", "Escape", "Space"]) {
    const { context } = await nieuweContext();
    const { page, fouten } = await openPagina(context);
    await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
    await page.keyboard.press(toets);
    await welkomEl(page).waitFor({ state: "detached", timeout: 300 });
    assert.equal(await page.evaluate(() => document.querySelector("body > .app").inert), false, toets + ": app blijft inert");
    assert.ok(await page.locator("#scr-lessons").isVisible(), toets + " ging door naar de app");
    // daarna doen toetsen weer gewoon hun werk
    await page.locator("#btn-info").focus(); await page.keyboard.press("Enter"); await wachtOpScherm(page, "scr-info");
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("welkom bij reduced motion: een stilstaand eindbeeld, en op dezelfde tijd weg", async () => {
  const { context } = await nieuweContext({ reduced: true });
  const { page, fouten } = await openPagina(context);
  await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
  const r = await page.evaluate(() => {
    const el = document.querySelector("body > .welkom");
    const delen = [el, ...el.querySelectorAll("*")];
    const stijl = e => getComputedStyle(e);
    return {
      lopend: document.getAnimations().filter(a => el.contains(a.effect?.target)).length,
      namen: delen.map(e => stijl(e).animationName).filter(n => n !== "none"),
      opacity: delen.map(e => stijl(e).opacity).filter(o => o !== "1"),
      beweging: delen.map(e => [stijl(e).translate, stijl(e).scale, stijl(e).rotate, stijl(e).transform]).flat().filter(v => v !== "none"),
      groet: el.querySelector(".welkom-groet")?.textContent
    };
  });
  assert.equal(r.lopend, 0, "er lopen animaties in het welkom");
  assert.deepEqual(r.namen, [], "animaties staan nog aan");
  assert.deepEqual(r.opacity, [], "niet alles is helemaal zichtbaar");
  assert.deepEqual(r.beweging, [], "de kat staat niet in zijn eindstand");
  assert.equal(r.groet, "Hoi Pia");
  await welkomEl(page).waitFor({ state: "detached", timeout: 2500 });
  const w = await page.evaluate(() => window.__welkom);
  const duur = w.weg - w.gezien;
  assert.ok(duur > 1050 && duur < 1600, `welkom stond ${Math.round(duur)} ms, verwacht 1200`);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: komt het beeld niet binnen 300 ms, dan stil overslaan", async () => {
  const { context } = await nieuweContext();
  await context.route(/\/katten\/\w+-goed\.webp/, async route => { await new Promise(r => setTimeout(r, 900)); await route.continue(); });
  const { page, fouten } = await openPagina(context);
  const r = await geenWelkom(page);
  assert.equal(r.gezien, 0, "welkom ondanks een traag beeld");
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".welkom").count(), 0, "welkom kwam alsnog, te laat");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), null, "de dag is onthouden zonder welkom");
  assert.equal(await page.evaluate(() => document.querySelector("body > .app").inert), false);
  assert.deepEqual(fouten, []);
  await context.close();
});

for (const thema of THEMAS) for (const breedte of BREEDTES) {
  test(`welkom, ${thema}, ${breedte}px: contrast 4,5:1, geen overloop, alles in beeld`, async () => {
    const problemen = [];
    for (const reduced of [true, false]) {
      const { context, extern } = await nieuweContext({ thema, breedte, reduced });
      // de klok stil: het welkom blijft staan zolang we meten
      const { page, fouten } = await openPagina(context, { klok: true });
      await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
      await page.evaluate(() => document.fonts.ready);
      // met beweging: alle animaties op het moment dat alles er staat, voor het vervagen
      if (!reduced) await page.evaluate(() => document.getAnimations().forEach(a => { a.pause(); a.currentTime = 880; }));
      const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
      const wie = reduced ? "stil" : "880 ms";
      for (const f of c.fouten) problemen.push(`${wie}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
      for (const f of c.nietMeetbaar) problemen.push(`${wie}: niet meetbaar bij ${f.waar} "${f.tekst}"`);
      const o = await page.evaluate(overloopMeting);
      if (o.overloop) problemen.push(`${wie}: overloop ${o.scrollWidth}px: ${o.boosdoeners.join(", ")}`);
      const binnen = await page.evaluate(() => [...document.querySelectorAll(".welkom > *")].every(e => {
        const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
      }));
      if (!binnen) problemen.push(`${wie}: het welkom past niet in beeld`);
      const gemeten = await page.evaluate(() => [".welkom-merk", ".welkom-groet", ".welkom .beta-chip"].every(s => document.querySelector(s)?.checkVisibility()));
      if (!gemeten) problemen.push(`${wie}: tekst van het welkom niet zichtbaar, dus niet gemeten`);
      problemen.push(...fouten);
      if (extern.length) problemen.push("verzoeken naar buiten: " + extern.join(", "));
      await context.close();
    }
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });
}
