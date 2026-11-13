// Eis 4: designsystem.html laadt zonder fouten en toont elk component uit
// window.UI. Daarbij ook: geen overloop en contrast, net als de app.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function open(thema, breedte) {
  const context = await browser.newContext({ viewport: { width: breedte, height: 900 }, colorScheme: thema, serviceWorkers: "block" });
  const extern = await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/designsystem.html");
  await page.locator("#sg-components .card").first().waitFor();
  await page.evaluate(rondAnimatiesAf);
  return { context, page, fouten, extern };
}

test("designsystem toont elk component uit window.UI", async () => {
  const { context, page, fouten } = await open("light", 1280);
  const r = await page.evaluate(() => {
    // componenten zijn de functies met een hoofdletter; esc, cls, pct en
    // hydrateIcons zijn hulpjes (hydrateIcons heeft wel een eigen blok)
    const namen = Object.keys(window.UI).filter(k => typeof window.UI[k] === "function" && /^[A-Z]/.test(k));
    // een component telt als getoond als zijn blok (kop of coderegel)
    // hem noemt en het voorbeeld in dat blok echt iets tekent
    const blokken = [...document.querySelectorAll("#sg-components > .card")];
    const ontbreekt = [], leeg = [];
    for (const n of namen) {
      const blok = blokken.filter(b => new RegExp("\\b" + n + "\\b").test(b.querySelector("h2")?.textContent || "") ||
        [...b.querySelectorAll(".sg-row > code")].some(c => c.textContent.includes("UI." + n + "(")));
      if (!blok.length) { ontbreekt.push(n); continue; }
      const getekend = blok.some(b => [...b.querySelectorAll(".sg-demo *")].some(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; }));
      if (!getekend) leeg.push(n);
    }
    const iconen = Object.keys(window.UI.ICONS);
    const codes = [...document.querySelectorAll("#sg-components code")].map(c => c.textContent);
    const iconenWeg = iconen.filter(i => !codes.includes(i));
    const svgIconen = document.querySelectorAll("#sg-components svg.icon").length;
    const hydrate = document.querySelector('#sg-components button[data-icon="trophy"] svg.icon');
    return { namen, ontbreekt, leeg, iconenWeg, svgIconen, iconen: iconen.length, hydrate: !!hydrate,
      ring: document.querySelectorAll("#sg-components .sg-ring-row svg.ring").length,
      tokensLeeg: [...document.querySelectorAll("[data-token]")].filter(e => !/^#[0-9A-F]{6}/.test(e.textContent)).map(e => e.dataset.token) };
  });
  assert.ok(r.namen.length >= 14, "te weinig componenten gevonden in window.UI: " + r.namen);
  assert.deepEqual(r.ontbreekt, [], "componenten zonder voorbeeld in het design system");
  assert.deepEqual(r.leeg, [], "componenten waarvan het voorbeeld niets tekent");
  assert.deepEqual(r.iconenWeg, [], "iconen die niet in het design system staan");
  assert.ok(r.svgIconen >= r.iconen, "minder iconen getekend dan er bestaan");
  assert.ok(r.hydrate, "hydrateIcons-voorbeeld heeft geen icoon gekregen");
  assert.equal(r.ring, 4, "verwacht vier Ring-voorbeelden");
  assert.deepEqual(r.tokensLeeg, [], "tokens zonder uitgerekende kleur");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("designsystem: themaknop schakelt licht en donker", async () => {
  const { context, page, fouten } = await open("light", 1280);
  const kleur = () => page.evaluate(() => getComputedStyle(document.body).color + "|" + document.querySelector('[data-token="--ink"]').textContent);
  const licht = await kleur();
  await page.click('#sg-theme button[data-theme="dark"]');
  const donker = await kleur();
  assert.notEqual(licht, donker, "kleuren veranderen niet na Dark");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await page.click('#sg-theme button[data-theme=""]');
  assert.equal(await kleur(), licht, "System zet niet terug naar licht");
  assert.deepEqual(fouten, []);
  await context.close();
});

for (const thema of THEMAS) {
  for (const breedte of BREEDTES) {
    test(`designsystem, ${thema}, ${breedte}px: geen fouten, geen overloop, contrast`, async t => {
      const { context, page, fouten, extern } = await open(thema, breedte);
      const problemen = [];
      const o = await page.evaluate(overloopMeting);
      if (o.overloop) problemen.push(`horizontale overloop: ${o.scrollWidth}px bij ${o.breedte}px. Uitstekend: ${o.boosdoeners.join(", ")}`);
      const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
      for (const f of c.fouten) problemen.push(`contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
      for (const f of c.nietMeetbaar) problemen.push(`contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
      for (const f of c.vrijgesteld) t.diagnostic(`uitgeschakeld, telt niet mee: ${f.waar} "${f.tekst}" ${f.ratio}:1`);
      problemen.push(...fouten);
      if (extern.length) problemen.push("verzoeken naar buiten: " + extern.join(", "));
      await context.close();
      if (problemen.length) assert.fail(`\n${problemen.length} probleem/problemen:\n  ` + problemen.join("\n  "));
    });
  }
}
