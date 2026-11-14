// Themaknop in het menu op het startscherm (#theme-seg): Systeem, Licht, Donker.
// 1. elke stand zet data-theme, aria-pressed, .on en theme-color goed
// 2. de keuze blijft na herladen, en staat er al voor de app-scripts
// 3. een thema dat afwijkt van het systeem haalt alle eisen op alle schermen
// 4. zonder localStorage geen crash, en de knop werkt nog
// 5. bedienbaar met het toetsenbord, tikdoelen minstens 44px
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { loopSchermen, kiesThema, openMenu } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const KLEUR = { light: "#F4F1FC", dark: "#16142A" };
const SLEUTEL = "overhoor:thema";
const STANDEN = [
  { naam: "Systeem", waarde: "" },
  { naam: "Licht", waarde: "light" },
  { naam: "Donker", waarde: "dark" }
];

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function nieuweContext(opties = {}) {
  const context = await browser.newContext({
    viewport: { width: 360, height: 780 }, colorScheme: "light",
    serviceWorkers: "block", locale: "nl-NL", ...opties
  });
  const extern = await schermNetwerkAf(context);
  return { context, extern };
}

async function openStart(page) {
  await page.goto(server.url + "/index.html");
  await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
}

// alles wat de themaknop zichtbaar of hoorbaar verandert
function stand(page) {
  return page.evaluate(() => {
    const knoppen = [...document.querySelectorAll("#theme-seg button")];
    return {
      dataTheme: document.documentElement.getAttribute("data-theme"),
      aan: knoppen.filter(b => b.classList.contains("on")).map(b => b.textContent.trim()),
      ingedrukt: knoppen.filter(b => b.getAttribute("aria-pressed") === "true").map(b => b.textContent.trim()),
      nietIngedrukt: knoppen.filter(b => b.getAttribute("aria-pressed") === "false").length,
      metas: [...document.querySelectorAll('meta[name="theme-color"]')].map(m => ({ media: m.media, content: m.content.toUpperCase() })),
      colorScheme: getComputedStyle(document.documentElement).colorScheme,
      tekstKleur: getComputedStyle(document.body).color
    };
  });
}

function controleerStand(s, verwacht, systeem) {
  const naam = STANDEN.find(x => x.waarde === verwacht).naam;
  if (verwacht) assert.equal(s.dataTheme, verwacht, "data-theme");
  else assert.equal(s.dataTheme, null, "bij Systeem hoort geen data-theme");
  assert.deepEqual(s.aan, [naam], "precies een knop met .on");
  assert.deepEqual(s.ingedrukt, [naam], "precies een knop met aria-pressed=true");
  assert.equal(s.nietIngedrukt, 2, "de andere twee hebben aria-pressed=false");
  assert.equal(s.metas.length, 2, "twee theme-color-metatags");
  for (const m of s.metas) {
    const per = /dark/.test(m.media) ? KLEUR.dark : KLEUR.light;
    assert.equal(m.content, verwacht ? KLEUR[verwacht] : per, `theme-color (${m.media}) bij ${naam}`);
  }
  // het thema moet ook echt in de stijl doorkomen
  const effectief = verwacht || systeem;
  assert.match(s.colorScheme, new RegExp(effectief), `color-scheme bij ${naam} met systeem ${systeem}`);
}

// ---------- 1. elke stand ----------
for (const systeem of ["light", "dark"]) {
  test(`knop: elke stand zet data-theme, aria-pressed, .on en theme-color (systeem ${systeem})`, async () => {
    const { context } = await nieuweContext({ colorScheme: systeem });
    const page = await context.newPage();
    const fouten = volgFouten(page);
    await openStart(page);
    controleerStand(await stand(page), "", systeem);

    // in een volgorde die elke overgang raakt, ook terug naar Systeem
    for (const doel of ["dark", "light", "", "light", "dark", ""]) {
      const naam = STANDEN.find(x => x.waarde === doel).naam;
      await kiesThema(page, naam);
      controleerStand(await stand(page), doel, systeem);
      const bewaard = await page.evaluate(k => localStorage.getItem(k), SLEUTEL);
      assert.equal(bewaard, doel ? JSON.stringify(doel) : null, `localStorage na ${naam}`);
    }
    // Licht en Donker moeten ook echt een andere pagina geven
    await kiesThema(page, "Licht");
    const licht = (await stand(page)).tekstKleur;
    await kiesThema(page, "Donker");
    const donker = (await stand(page)).tekstKleur;
    assert.notEqual(licht, donker, "tekstkleur verandert niet tussen Licht en Donker");

    assert.deepEqual(fouten, []);
    await context.close();
  });
}

// ---------- 2. herladen en geen flits ----------
// Voor het eerste app-script (ui.js) zetten we een meetpunt: welke
// data-theme en welk color-scheme gelden op dat moment al?
async function meetVoorAppScripts(context) {
  await context.route(/\/ui\.js(\?|$)/, async route => {
    const antwoord = await route.fetch();
    const meet = "window.__voorApp = { dataTheme: document.documentElement.getAttribute('data-theme'), " +
      "colorScheme: getComputedStyle(document.documentElement).colorScheme, " +
      "metas: [...document.querySelectorAll('meta[name=\"theme-color\"]')].map(m => m.content.toUpperCase()) };\n";
    await route.fulfill({ response: antwoord, body: meet + (await antwoord.text()) });
  });
}

for (const [systeem, keuze] of [["light", "dark"], ["dark", "light"], ["dark", "dark"]]) {
  test(`herladen: ${keuze} blijft staan en staat er al voor de app-scripts (systeem ${systeem})`, async () => {
    const { context } = await nieuweContext({ colorScheme: systeem });
    await meetVoorAppScripts(context);
    const page = await context.newPage();
    const fouten = volgFouten(page);
    await openStart(page);
    const naam = STANDEN.find(x => x.waarde === keuze).naam;
    await kiesThema(page, naam);

    await page.reload();
    await page.locator("#scr-lessons").waitFor({ state: "visible" });
    const voor = await page.evaluate(() => window.__voorApp);
    assert.ok(voor, "meetpunt voor de app-scripts is niet gedraaid");
    assert.equal(voor.dataTheme, keuze, "data-theme staat er nog niet voor de app-scripts: flits");
    assert.match(voor.colorScheme, new RegExp(keuze), "stylesheet volgt het thema nog niet voor de app-scripts");
    assert.deepEqual(voor.metas, [KLEUR[keuze], KLEUR[keuze]], "theme-color nog niet gezet voor de app-scripts");
    controleerStand(await stand(page), keuze, systeem);

    // en terug naar Systeem overleeft ook een herlaadbeurt
    await kiesThema(page, "Systeem");
    await page.reload();
    await page.locator("#scr-lessons").waitFor({ state: "visible" });
    assert.equal((await page.evaluate(() => window.__voorApp)).dataTheme, null);
    controleerStand(await stand(page), "", systeem);

    assert.deepEqual(fouten, []);
    await context.close();
  });
}

test("herladen: onzin in localStorage geeft Systeem en geen fout", async () => {
  for (const waarde of ["blauw", "{kapot", '"blauw"', "null", '"<img src=x onerror=alert(1)>"', "42"]) {
    const { context } = await nieuweContext();
    await context.addInitScript(([k, v]) => { try { localStorage.setItem(k, v); } catch (_) {} }, [SLEUTEL, waarde]);
    const page = await context.newPage();
    const fouten = volgFouten(page);
    await openStart(page);
    const s = await stand(page);
    assert.equal(s.dataTheme, null, `data-theme bij opgeslagen ${waarde}`);
    assert.deepEqual(s.aan, ["Systeem"], `knop bij opgeslagen ${waarde}`);
    assert.deepEqual(fouten, [], `fouten bij opgeslagen ${waarde}`);
    await context.close();
  }
});

// ---------- 3. afwijkend thema: alle schermen, contrast, overloop ----------
for (const [systeem, keuze] of [["light", "dark"], ["dark", "light"]]) {
  for (const breedte of BREEDTES) {
    test(`schermen: stand ${keuze} bij systeem ${systeem}, ${breedte}px`, async t => {
      const { context, extern } = await nieuweContext({
        colorScheme: systeem, viewport: { width: breedte, height: breedte < 600 ? 780 : 900 }
      });
      const page = await context.newPage();
      const jsFouten = volgFouten(page);
      const problemen = [];
      const bezocht = [];

      // keuze maken via de knop; loopSchermen laadt daarna opnieuw
      await openStart(page);
      await kiesThema(page, STANDEN.find(x => x.waarde === keuze).naam);

      await loopSchermen(page, server.url, async naam => {
        bezocht.push(naam);
        const dt = await page.evaluate(() => document.documentElement.getAttribute("data-theme"));
        if (dt !== keuze) problemen.push(`[${naam}] data-theme is ${dt}, verwacht ${keuze}`);
        await page.evaluate(rondAnimatiesAf);
        const o = await page.evaluate(overloopMeting);
        if (o.overloop) problemen.push(`[${naam}] horizontale overloop: pagina ${o.scrollWidth}px breed bij ${o.breedte}px. Uitstekend: ${o.boosdoeners.join(", ") || "onbekend"}`);
        if (o.verstopt) problemen.push(`[${naam}] overflow-x: hidden op html/body verbergt mogelijke overloop`);
        const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
        if (c.gemeten === 0) problemen.push(`[${naam}] geen tekst gemeten, meting klopt niet`);
        for (const f of c.fouten) problemen.push(`[${naam}] contrast ${f.ratio}:1 < ${MIN_CONTRAST} bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
        for (const f of c.vrijgesteld) t.diagnostic(`[${naam}] uitgeschakeld, telt niet mee: ${f.waar} "${f.tekst}" ${f.ratio}:1`);
        for (const f of c.nietMeetbaar) problemen.push(`[${naam}] contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
        for (const f of jsFouten.splice(0)) problemen.push(`[${naam}] ${f}`);
      });
      for (const f of jsFouten) problemen.push(`[na laatste scherm] ${f}`);
      const nietSync = extern.filter(u => !/workers\.dev\//.test(u));
      if (nietSync.length) problemen.push("verzoeken naar buiten: " + nietSync.join(", "));
      await context.close();

      assert.ok(bezocht.length >= 20, "niet alle schermen bereikt: " + bezocht.join(", "));
      if (problemen.length) assert.fail(`\n${problemen.length} probleem/problemen, stand ${keuze} bij systeem ${systeem}, ${breedte}px:\n  ` + problemen.join("\n  "));
    });
  }
}

// ---------- 3b. datumveld volgt de themakeuze, niet het systeem ----------
// Een veld met een eigen color-scheme (bijvoorbeeld "light dark") rekent
// zijn light-dark()-kleuren uit naar het systeem. Daarom vergelijken we
// het veld met een handmatige stand tegen hetzelfde veld waarbij het
// systeem al die stand heeft (Systeem gekozen): die moeten gelijk zijn.
async function datumveld(systeem, keuze) {
  const { context } = await nieuweContext({ colorScheme: systeem });
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await openStart(page);
  await kiesThema(page, STANDEN.find(x => x.waarde === keuze).naam);
  await page.keyboard.press("Escape");   // het menu dicht, dan kun je weer bij de lijsten
  await page.locator(".lesson").first().click();
  await page.locator("#scr-home").waitFor({ state: "visible", timeout: 5000 });
  await page.locator("#deadline-seg button", { hasText: "Andere dag" }).click();
  const veld = page.locator("#deadline-input");
  await veld.waitFor({ state: "visible" });
  await page.evaluate(rondAnimatiesAf);
  const s = await veld.evaluate(el => {
    const cs = getComputedStyle(el);
    return { colorScheme: cs.colorScheme, achtergrond: cs.backgroundColor, tekst: cs.color };
  });
  await context.close();
  return { ...s, fouten };
}

for (const [systeem, keuze] of [["light", "dark"], ["dark", "light"]]) {
  test(`datumveld: "Andere dag" volgt stand ${keuze} bij systeem ${systeem}`, async () => {
    const echt = await datumveld(systeem, keuze);
    const referentie = await datumveld(keuze, ""); // systeem is al de gekozen stand
    assert.equal(echt.colorScheme, keuze, `color-scheme van #deadline-input is "${echt.colorScheme}"`);
    assert.equal(echt.achtergrond, referentie.achtergrond, "achtergrond van het datumveld volgt het systeem in plaats van de gekozen stand");
    assert.equal(echt.tekst, referentie.tekst, "tekstkleur van het datumveld volgt het systeem in plaats van de gekozen stand");
    assert.deepEqual(echt.fouten, []);
  });
}

// ---------- 4. zonder localStorage ----------
// Zoals Safari in sommige privé-standen of met geblokkeerde cookies:
// alleen al localStorage aanraken gooit een SecurityError.
async function blokkeerOpslag(context) {
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() { throw new DOMException("opslag geblokkeerd (test)", "SecurityError"); }
    });
  });
}

for (const systeem of ["light", "dark"]) {
  test(`zonder localStorage: geen crash en de knop werkt (systeem ${systeem})`, async () => {
    const { context } = await nieuweContext({ colorScheme: systeem });
    await blokkeerOpslag(context);
    const page = await context.newPage();
    const fouten = volgFouten(page);
    await openStart(page);
    assert.equal(await page.evaluate(() => { try { localStorage; return "open"; } catch (_) { return "dicht"; } }), "dicht", "blokkade werkt niet");
    controleerStand(await stand(page), "", systeem);

    for (const doel of ["dark", "light", ""]) {
      await kiesThema(page, STANDEN.find(x => x.waarde === doel).naam);
      controleerStand(await stand(page), doel, systeem);
    }
    // herladen kan niets onthouden, maar mag ook niet stuk gaan
    await kiesThema(page, "Donker");
    await page.reload();
    await page.locator("#scr-lessons").waitFor({ state: "visible" });
    controleerStand(await stand(page), "", systeem);
    assert.ok(await page.locator(".lesson").count() > 0, "lessenlijst is leeg zonder opslag");

    assert.deepEqual(fouten, []);
    await context.close();
  });
}

// ---------- 5. toetsenbord en tikdoelen ----------
test("toetsenbord: met Tab bereikbaar, Enter en Spatie wisselen de stand", async () => {
  const { context } = await nieuweContext();
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await openStart(page);

  const gefocust = () => page.evaluate(() => {
    const a = document.activeElement;
    return a && a.closest("#theme-seg") ? a.textContent.trim() : null;
  });
  // vanaf het begin van de pagina tabben tot de menuknop, met Enter het
  // menu open (de focus staat dan op Rapport), dan verder tot het thema
  let opMenu = false;
  for (let i = 0; i < 20 && !opMenu; i++) { await page.keyboard.press("Tab"); opMenu = await page.evaluate(() => document.activeElement?.id === "btn-menu"); }
  assert.ok(opMenu, "de menuknop is niet met Tab te bereiken");
  await page.keyboard.press("Enter");
  let naam = null;
  for (let i = 0; i < 5 && !naam; i++) { await page.keyboard.press("Tab"); naam = await gefocust(); }
  assert.equal(naam, "Systeem", "eerste tabstop in de themaknop is niet Systeem");

  // focus moet zichtbaar zijn
  const ring = await page.evaluate(() => {
    const a = document.activeElement, cs = getComputedStyle(a);
    return { focusVisible: a.matches(":focus-visible"), outline: cs.outlineStyle, breedte: parseFloat(cs.outlineWidth), schaduw: cs.boxShadow, filter: cs.filter };
  });
  assert.ok(ring.focusVisible, "geen :focus-visible na Tab");
  assert.ok((ring.outline !== "none" && ring.breedte > 0) || ring.schaduw !== "none" || /drop-shadow/.test(ring.filter), "geen zichtbare focusring: " + JSON.stringify(ring));

  await page.keyboard.press("Tab");
  assert.equal(await gefocust(), "Licht");
  await page.keyboard.press("Enter");
  controleerStand(await stand(page), "light", "light");

  await page.keyboard.press("Tab");
  assert.equal(await gefocust(), "Donker");
  await page.keyboard.press("Space");
  controleerStand(await stand(page), "dark", "light");
  assert.equal(await gefocust(), "Donker", "focus springt weg na kiezen");

  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  assert.equal(await gefocust(), "Systeem");
  await page.keyboard.press("Space");
  controleerStand(await stand(page), "", "light");

  // de groep heeft een naam voor schermlezers
  const groep = await page.evaluate(() => {
    const g = document.getElementById("theme-seg").closest("[role=group]");
    const id = g && g.getAttribute("aria-labelledby");
    return id ? document.getElementById(id)?.textContent.trim() : null;
  });
  assert.equal(groep, "Thema", "groep zonder toegankelijke naam");

  assert.deepEqual(fouten, []);
  await context.close();
});

for (const breedte of [320, 360]) {
  test(`tikdoelen: themaknoppen minstens 44 bij 44px en niet overlappend (${breedte}px)`, async () => {
    const { context } = await nieuweContext({ viewport: { width: breedte, height: 780 } });
    const page = await context.newPage();
    await openStart(page);
    await openMenu(page);
    await page.locator("#theme-seg").scrollIntoViewIfNeeded();
    await page.evaluate(rondAnimatiesAf);
    const vakken = await page.locator("#theme-seg button").evaluateAll(bs => bs.map(b => {
      const r = b.getBoundingClientRect();
      return { naam: b.textContent.trim(), x: r.left, y: r.top, b: r.width, h: r.height };
    }));
    assert.equal(vakken.length, 3);
    for (const v of vakken) {
      assert.ok(v.b >= 44 && v.h >= 44, `${v.naam} is ${Math.round(v.b)}x${Math.round(v.h)}px`);
      assert.ok(v.x >= 0 && v.x + v.b <= breedte + 1, `${v.naam} steekt buiten beeld`);
    }
    for (let i = 0; i < vakken.length; i++) for (let j = i + 1; j < vakken.length; j++) {
      const a = vakken[i], c = vakken[j];
      const overlap = a.x < c.x + c.b && c.x < a.x + a.b && a.y < c.y + c.h && c.y < a.y + a.h;
      assert.ok(!overlap, `${a.naam} en ${c.naam} overlappen`);
    }
    // de klik in het midden van elke knop raakt die knop zelf
    for (const v of vakken) {
      const raak = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("#theme-seg button")?.textContent.trim(), [v.x + v.b / 2, v.y + v.h / 2]);
      assert.equal(raak, v.naam, `midden van ${v.naam} raakt iets anders`);
    }
    await context.close();
  });
}
