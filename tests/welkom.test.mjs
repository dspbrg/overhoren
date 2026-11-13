// Het welkom bij het openen (variant A uit de opzet van Dieter): heel
// scherm, de naam van de app, de goed-clip van de kat van de eerstvolgende
// ronde (geen css-sprong of wiebel), dan "Hoi <naam>", daarna vervaagt
// alles. Minstens 1,2 s en pas weg als de clip op zijn eindbeeld staat
// (de clip zelf: kattenclips.test.mjs). Tik of toets haalt het eerder weg,
// de app eronder is zolang inert. Bij elke keer openen (nieuw tabblad, nieuwe sessie), maar niet
// opnieuw binnen dezelfde sessie en niet als er een ronde openstaat. Alleen als het beeld
// binnen 300 ms klaar is. Reduced motion: een stilstaand eindbeeld.
//
// Alle andere tests zetten de sessievlag van het welkom al (zie
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
const KAT = JSON.parse(lees("katten/clips/katten.json"));
// hoe lang het welkom met deze kat staat: minstens 1,2 s, en de clip uit plus het vervagen
const verwacht = (kat, stil) => (stil ? 3500 : Math.max(3500, KAT.katten[kat].goed.duurMs + 300));

// ---------- zonder browser ----------
function laad({ opslag = {} } = {}) {
  const store = opslag;
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

test("UI.Welkom: de naam gaat door esc(), zonder naam geen Hoi, de kat is versiering", async () => {
  const { C, UI } = laad();
  assert.equal(typeof UI.Welkom, "function", "UI.Welkom ontbreekt");
  await C.laadCatalogus();
  const b = C.welkomBeeld("tuxedo");
  // eerst rust (het eerste beeld van de goed-clip), stil is het eindbeeld
  assert.equal(b.src, "katten/clips/tuxedo-rust.webp");
  assert.equal(b.stil, "katten/clips/tuxedo-goed-eind.webp");
  assert.equal(b.duurMs, KAT.katten.tuxedo.goed.duurMs);
  assert.equal(b.width, C.beeld("tuxedo", "goed").width);
  assert.match(UI.Welkom({ beeld: b, stil: true }), /<img class="welkom-kat" src="katten\/clips\/tuxedo-goed-eind\.webp" width="400" height="480" alt="" data-kat="tuxedo" data-beeld="goed-eind"/);
  const html = UI.Welkom({ beeld: b, naam: '<img src=x onerror="alert(1)">' });
  assert.doesNotMatch(html, /<img src=x/, "naam niet ontsnapt");
  assert.match(html, /Hoi &lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
  assert.match(html, /<img class="welkom-kat" src="katten\/clips\/tuxedo-rust\.webp" width="400" height="480" alt="" data-kat="tuxedo" data-beeld="rust"/);
  for (const naam of ["", "   ", null, undefined]) assert.doesNotMatch(UI.Welkom({ beeld: b, naam }), /Hoi/, `"Hoi" bij naam ${JSON.stringify(naam)}`);
  assert.match(UI.Welkom({ beeld: b, naam: " Pia " }), /<p class="welkom-groet">Hoi Pia<\/p>/);
  assert.equal(UI.Welkom({ naam: "Pia" }), "", "zonder beeld geen welkom");
  // de toon: geen uitroeptekens, geen em dashes
  const tekst = UI.Welkom({ beeld: b, naam: "Pia" }).replace(/<[^>]+>/g, " ");
  assert.doesNotMatch(tekst, /[!—]/);
});

test("welkom in ds.css: minstens 1,2 s, alleen transform en opacity, geen sprong of wiebel op de kat, uit bij reduced motion", () => {
  const css = lees("ds.css");
  assert.match(css, /--welkom-duur:\s*3500ms;/);
  assert.match(css, /--welkom-vervaag:\s*300ms;/);
  const frames = [...css.matchAll(/@keyframes (welkom-[\w-]+)\s*\{((?:[^{}]*\{[^}]*\})+)\s*\}/g)];
  assert.deepEqual(frames.map(f => f[1]).sort(), ["welkom-in", "welkom-uit"], "keyframes van het welkom");
  assert.doesNotMatch(css, /welkom-hop|welkom-wiebel|beweegt-zelf/, "de css-sprong of het wiebelen staat er nog");
  assert.match(css, /\.welkom-kat\s*\{[^}]*\}/);
  assert.doesNotMatch(css.match(/\.welkom-kat\s*\{([^}]*)\}/)[1], /animation|transform/, "css-beweging op de kat in het welkom");
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
const welkomEl = page => page.locator("body > .welkom");
// wacht lang genoeg om zeker te weten dat er geen welkom komt (300 ms beeld plus marge)
const geenWelkom = async page => { await page.waitForTimeout(700); return page.evaluate(() => ({ ...window.__welkom, nu: !!document.querySelector(".welkom") })); };

test("welkom: bij het openen, heel scherm, app inert, Hoi Pia, na 1,2 s weg; geen dagsleutel", async () => {
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
  assert.equal(await page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), null, "de dagsleutel wordt nog geschreven");
  const kat = await page.locator("body > .welkom img.welkom-kat").getAttribute("data-kat");
  await welkomEl(page).waitFor({ state: "detached", timeout: 6000 });
  const w = await page.evaluate(() => window.__welkom);
  const duur = w.weg - w.gezien;
  assert.ok(duur > verwacht(kat) - 150 && duur < verwacht(kat) + 400, `welkom stond ${Math.round(duur)} ms, verwacht ${verwacht(kat)}`);
  assert.equal(await page.evaluate(() => document.querySelector("body > .app").inert), false, "app blijft inert na het welkom");
  // de app werkt daarna gewoon
  await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: elke keer openen; een nieuw tabblad dezelfde dag wel, ook met een oude dagsleutel", async () => {
  const { context } = await nieuweContext({ zaai: { [WELKOM_DAG]: "2099-01-01" } });
  const een = await openPagina(context);
  await welkomEl(een.page).waitFor({ state: "attached", timeout: 1500 });
  // een tweede tabblad is een nieuwe sessie: weer een welkom
  const twee = await openPagina(context);
  await welkomEl(twee.page).waitFor({ state: "attached", timeout: 1500 });
  // nog een, nadat het vorige welkom al weg is
  await welkomEl(twee.page).waitFor({ state: "detached", timeout: 6000 });
  const drie = await openPagina(context);
  await welkomEl(drie.page).waitFor({ state: "attached", timeout: 1500 });
  // een oude dagsleutel blijft ongemoeid en telt niet mee
  assert.equal(await drie.page.evaluate(k => localStorage.getItem(k), WELKOM_DAG), "2099-01-01");
  assert.deepEqual([...een.fouten, ...twee.fouten, ...drie.fouten], []);
  await context.close();
});

test("welkom: niet opnieuw in hetzelfde tabblad (herladen, terug naar het tabblad)", async () => {
  const { context } = await nieuweContext();
  const { page, fouten } = await openPagina(context);
  await welkomEl(page).waitFor({ state: "attached", timeout: 1500 });
  await welkomEl(page).waitFor({ state: "detached", timeout: 6000 });
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.equal((await geenWelkom(page)).gezien, 0, "welkom na herladen in hetzelfde tabblad");
  // terug naar het tabblad: de pagina blijft staan, er komt niets bij
  await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true })); });
  assert.equal((await geenWelkom(page)).gezien, 0, "welkom bij terugkeren naar het tabblad");
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
    const kat = await page.locator("body > .welkom img.welkom-kat").getAttribute("data-kat");
    assert.ok(ALLE.includes(kat), "geen kat in het welkom");
    assert.notEqual(kat, vorige, "het welkom toont de kat van de vorige ronde");
    await welkomEl(page).waitFor({ state: "detached", timeout: 6000 });
    await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
    await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
    assert.equal(await page.evaluate(k => JSON.parse(localStorage.getItem(k)), VORIGE), kat, "de ronde heeft een andere kat dan het welkom");
    const inBeeld = await page.locator("#scr-quiz img.kat").first().getAttribute("data-kat", { timeout: 2000 }).catch(() => null);
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
  assert.equal(await page.locator("body > .welkom img.welkom-kat").getAttribute("data-beeld"), "goed-eind", "niet meteen het eindbeeld");
  await welkomEl(page).waitFor({ state: "detached", timeout: 5000 });
  const w = await page.evaluate(() => window.__welkom);
  const duur = w.weg - w.gezien;
  assert.ok(duur > 3350 && duur < 3900, `welkom stond ${Math.round(duur)} ms, verwacht 3500`);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("welkom: komt het beeld niet binnen 300 ms, dan stil overslaan", async () => {
  const { context } = await nieuweContext();
  await context.route(/\/katten\/clips\/\w+-goed\.webp/, async route => { await new Promise(r => setTimeout(r, 900)); await route.continue(); });
  const { page, fouten } = await openPagina(context);
  const r = await geenWelkom(page);
  assert.equal(r.gezien, 0, "welkom ondanks een traag beeld");
  await page.waitForTimeout(600);
  assert.equal(await page.locator(".welkom").count(), 0, "welkom kwam alsnog, te laat");
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
