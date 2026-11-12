// Secundaire knoppen moeten als knop te zien zijn op de kaart.
// Op het lesscherm (#scr-home) liggen "Eerst lezen" (#btn-study) en de
// niet-gekozen .seg-knoppen op een .card, op het vraagscherm (#scr-quiz)
// de woordsoortknoppen (.choice). Het vlak van zowel knop als kaart zit
// op ::before. Vroeger was het knopvlak in licht wit (#FFFFFF) op een
// kaart die links ook wit is: dan valt de knop weg.
//
// We meten in de levende pagina:
// 1. rust: het knopvlak verschilt genoeg van de kaartbaan die er echt
//    onder ligt (de kaart is een schuine gradient met drie banen), op
//    elk meetpunt binnen de knop
// 2. hover: het knopvlak verandert zichtbaar ten opzichte van rust
// in licht en in donker.
//
// Maat: kleurverschil in OKLab (ΔE, L van 0 tot 1). Ongeveer 0,02 is net
// waarneembaar als twee vlakken direct naast elkaar liggen. WCAG-contrast
// past hier niet: dat is voor tekst en randen, en bijna-witte vlakken
// halen daarin nooit veel (wit tegen #EEE8FB is maar 1,13:1, terwijl je
// het verschil wel ziet).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { rondAnimatiesAf } from "./lib/meten.mjs";

// Rust: op elk meetpunt binnen de knop (100% van het oppervlak) moet
// het vlak minstens zoveel van de kaartbaan eronder verschillen. Een knop
// mag dus op geen enkele baan wegvallen.
// Licht: 0,025, net boven de waarneembaarheidsgrens. Ter vergelijking:
// #E4DCF8 (nu) is 0,099 / 0,068 / 0,040 tegen de drie banen; #EEE8FB
// (vorige ronde) was 0,064 / 0,033 / 0,005 en valt dus weg op de
// rechterbaan; wit (#FFFFFF, de oude waarde) is 0 op de linkerbaan.
// Donker: 0,05. Gemeten haalt #3A3460 0,100 / 0,082 / 0,065 tegen de
// drie donkere banen (#221F3A / #262242 / #2A2549); de rechterbaan is het
// krapst. 0,05 is twee keer de waarneembaarheidsgrens en laat 0,015
// ruimte voor kleine bijstellingen. In donker viel een knop eerder al
// weg (reden voor het lichtere donkere vlak), dus hier houden we vast
// wat het ontwerp nu haalt in plaats van alleen "net zichtbaar".
const MIN_RUST = { light: 0.025, dark: 0.05 };
// Hover tegen rust: hetzelfde vlak, dus geen baan-probleem. 0,025.
const MIN_HOVER = 0.025;

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// ---------- kleurrekenwerk (in Node) ----------
function naarOklab([r, g, b]) {
  const lin = c => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717528 * m - 0.8086757660 * s
  ];
}
function deltaE(a, b) {
  const [x, y] = [naarOklab(a), naarOklab(b)];
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}
const hex = c => "#" + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

// ---------- meten in de pagina ----------
// Per knop: de effen kleur van zijn ::before, en de kaartkleuren die op
// een raster van punten binnen de knop onder die knop liggen. De gradient
// van de kaart wordt nagerekend volgens de CSS-regels voor
// linear-gradient(<hoek>, ...) met stops in procenten.
function meetKnoppen(selectors) {
  function parseKleur(s) {
    s = s.trim();
    let m = s.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      const n = m[1].split(/[\s,\/]+/).filter(Boolean).map(x => x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x));
      return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    }
    m = s.match(/^color\(srgb\s+([^)]*)\)$/);
    if (m) {
      const n = m[1].split(/[\s\/]+/).filter(Boolean).map(parseFloat);
      return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1];
    }
    return null;
  }
  // effen vlak: background-image none en een kleur, of een gradient met
  // overal dezelfde kleur
  function effen(bg) {
    const kleuren = (bg.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/g) || []).map(parseKleur);
    if (!kleuren.length || kleuren.some(k => !k)) return null;
    const eerste = kleuren[0];
    if (kleuren.some(k => k.some((v, i) => Math.abs(v - eerste[i]) > 0.5))) return { gradient: true, kleuren };
    return { kleur: eerste };
  }
  function gradientKleurOp(bg, rect, x, y) {
    const m = bg.match(/linear-gradient\((.*)\)\s*$/);
    if (!m) return null;
    const delen = m[1].split(/,(?![^(]*\))/).map(s => s.trim());
    let hoek = 180;
    if (/deg$/.test(delen[0])) hoek = parseFloat(delen.shift());
    const stops = delen.map(d => {
      const k = d.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)/)[0];
      const pos = [...d.replace(k, "").matchAll(/(-?[\d.]+)%/g)].map(p => parseFloat(p[1]) / 100);
      return { kleur: parseKleur(k), pos };
    });
    // stops met twee posities uitvouwen, ontbrekende posities niet nodig hier
    const lijst = [];
    for (const s of stops) for (const p of s.pos) lijst.push({ kleur: s.kleur, p });
    const rad = hoek * Math.PI / 180;
    const dx = Math.sin(rad), dy = -Math.cos(rad);
    const L = Math.abs(rect.width * Math.sin(rad)) + Math.abs(rect.height * Math.cos(rad));
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    const t = ((x - cx) * dx + (y - cy) * dy) / L + 0.5;
    if (t <= lijst[0].p) return lijst[0].kleur;
    for (let i = 1; i < lijst.length; i++) {
      if (t <= lijst[i].p) {
        const a = lijst[i - 1], b = lijst[i];
        const f = b.p === a.p ? 1 : (t - a.p) / (b.p - a.p);
        return a.kleur.map((v, j) => v + (b.kleur[j] - v) * f);
      }
    }
    return lijst[lijst.length - 1].kleur;
  }

  const uit = [];
  for (const sel of selectors) {
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const kaart = el.closest(".card");
      const vlak = effen(getComputedStyle(el, "::before").backgroundImage !== "none"
        ? getComputedStyle(el, "::before").backgroundImage
        : getComputedStyle(el, "::before").backgroundColor);
      const kaartBg = kaart ? getComputedStyle(kaart, "::before").backgroundImage : null;
      const kr = kaart ? kaart.getBoundingClientRect() : null;
      const onder = [];
      if (kaart) {
        for (let i = 0; i < 20; i++) for (let j = 0; j < 3; j++) {
          const x = r.left + r.width * (i + 0.5) / 20, y = r.top + r.height * (j + 0.5) / 3;
          const k = kaartBg === "none"
            ? parseKleur(getComputedStyle(kaart, "::before").backgroundColor)
            : gradientKleurOp(kaartBg, kr, x, y);
          if (k) onder.push(k);
        }
      }
      uit.push({ sel, naam: el.id ? "#" + el.id : el.textContent.trim(), vlak, kaart: !!kaart, kaartBg, onder });
    }
  }
  return uit;
}

async function open(thema, breedte, scherm) {
  const context = await browser.newContext({
    viewport: { width: breedte, height: 900 }, colorScheme: thema,
    serviceWorkers: "block", locale: "nl-NL"
  });
  await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
  // de eerste lijst heeft woordsoorten, dus .choice op het vraagscherm
  await page.locator(".lesson").first().click();
  await page.locator("#scr-home").waitFor({ state: "visible", timeout: 5000 });
  if (scherm === "quiz") {
    await page.click("#btn-start");
    await page.locator("#scr-quiz").waitFor({ state: "visible", timeout: 5000 });
  }
  await page.evaluate(rondAnimatiesAf);
  return { context, page, fouten };
}

const SCHERMEN = {
  home: { naam: "lesscherm", knoppen: ["#scr-home #btn-study", "#scr-home .seg button:not(.on)"], minimaal: 4,
          hover: ["#scr-home #btn-study", "#scr-home #size-seg button:not(.on)", "#scr-home #deadline-seg button:not(.on)"] },
  quiz: { naam: "vraagscherm", knoppen: ["#scr-quiz #q-classes .choice:not(.on)"], minimaal: 2,
          hover: ["#scr-quiz #q-classes .choice:not(.on)"] }
};

for (const thema of ["light", "dark"]) {
  for (const [scherm, opzet] of Object.entries(SCHERMEN)) {
    for (const breedte of [360, 1280]) {
      test(`knopvlak: ${opzet.naam}, knoppen steken overal af tegen de kaart (${thema}, ${breedte}px)`, async t => {
        const { context, page, fouten } = await open(thema, breedte, scherm);
        const metingen = await page.evaluate(meetKnoppen, opzet.knoppen);
        await context.close();

        assert.ok(metingen.length >= opzet.minimaal, `maar ${metingen.length} knoppen gemeten op het ${opzet.naam}`);
        if (scherm === "home") assert.ok(metingen.some(m => m.naam === "#btn-study"), "#btn-study niet gevonden of onzichtbaar");
        const grens = MIN_RUST[thema];
        const problemen = [];
        for (const m of metingen) {
          if (!m.kaart) { problemen.push(`${m.naam} ligt niet op een .card`); continue; }
          if (!m.vlak || m.vlak.gradient) { problemen.push(`${m.naam}: knopvlak is geen effen kleur, meting klopt niet`); continue; }
          if (!m.onder.length) { problemen.push(`${m.naam}: kaartachtergrond niet te lezen (${m.kaartBg})`); continue; }
          const verschillen = m.onder.map(k => deltaE(m.vlak.kleur, k));
          const deel = verschillen.filter(d => d >= grens).length / verschillen.length;
          const i = verschillen.indexOf(Math.min(...verschillen));
          const banen = [...new Set(m.onder.map(hex))].join("/");
          t.diagnostic(`${m.naam}: vlak ${hex(m.vlak.kleur)}, kaart eronder ${banen}, kleinste ΔE ${verschillen[i].toFixed(3)}, ${Math.round(deel * 100)}% steekt af`);
          if (deel < 1) problemen.push(`${m.naam}: vlak ${hex(m.vlak.kleur)} valt weg tegen kaartbaan ${hex(m.onder[i])} ` +
            `(ΔE ${verschillen[i].toFixed(3)} < ${grens}), steekt maar op ${Math.round(deel * 100)}% af`);
        }
        assert.deepEqual(fouten, []);
        if (problemen.length) assert.fail(`\nknoppen vallen weg tegen de kaart (${opzet.naam}, ${thema}, ${breedte}px):\n  ` + problemen.join("\n  "));
      });
    }
  }

  for (const [scherm, opzet] of Object.entries(SCHERMEN)) {
    test(`knopvlak: ${opzet.naam}, hover geeft een ander vlak dan rust (${thema})`, async t => {
      const { context, page, fouten } = await open(thema, 360, scherm);
      const hoverbaar = await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches);
      assert.ok(hoverbaar, "browser meldt geen muis: hover-regels gelden dan niet en de test zegt niets");

      const problemen = [];
      const p = s => s.match(/[\d.]+/g).slice(0, 3).map(Number);
      for (const sel of opzet.hover) {
        const knop = page.locator(sel).first();
        await page.mouse.move(0, 0);
        await page.evaluate(rondAnimatiesAf);
        const rust = await knop.evaluate(el => getComputedStyle(el, "::before").backgroundColor);
        await knop.hover();
        await page.evaluate(rondAnimatiesAf);
        const hover = await knop.evaluate(el => ({
          kleur: getComputedStyle(el, "::before").backgroundColor, hover: el.matches(":hover")
        }));
        assert.ok(hover.hover, `${sel} staat niet in :hover na mouse-over`);
        const d = deltaE(p(rust), p(hover.kleur));
        t.diagnostic(`${sel}: rust ${hex(p(rust))}, hover ${hex(p(hover.kleur))}, ΔE ${d.toFixed(3)}`);
        if (d < MIN_HOVER) problemen.push(`${sel}: hover ${hex(p(hover.kleur))} tegen rust ${hex(p(rust))} verschilt ΔE ${d.toFixed(3)} < ${MIN_HOVER}`);
      }
      await context.close();
      assert.deepEqual(fouten, []);
      if (problemen.length) assert.fail(`\nhover niet te zien (${opzet.naam}, ${thema}):\n  ` + problemen.join("\n  "));
    });
  }
}
