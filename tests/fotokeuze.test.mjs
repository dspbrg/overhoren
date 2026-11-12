// Foto-import, stap "Wat voor overhoring is dit?" (#photo-actions).
// Dit scherm verschijnt pas nadat er een foto is gekozen, en zat daarom
// niet in de schermenronde. Hier zetten we een klein, zelfgemaakt
// testplaatje op #photo-input. De worker wordt niet aangeroepen: de app
// verkleint het plaatje alleen lokaal en toont dan de vier typeknoppen.
//
// We meten het contrast van alle zichtbare tekst (zoals schermen.test.mjs),
// in rust en terwijl de muis op elk van de vier typeknoppen staat, in
// licht en donker. Aanleiding: de .hint in .photo-type-btn haalde op het
// lichtpaarse knopvlak maar 4,21:1, en 3,86:1 bij hover.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { contrastMeting, rondAnimatiesAf } from "./lib/meten.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);

// 4x4 grijze PNG, fictief testplaatje, hier zelf opgebouwd
function maakPng() {
  const crcTabel = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = buf => { let c = 0xFFFFFFFF; for (const b of buf) c = crcTabel[(c ^ b) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const blok = (soort, data) => {
    const lengte = Buffer.alloc(4); lengte.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(soort), data]);
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
    return Buffer.concat([lengte, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(4, 0); ihdr.writeUInt32BE(4, 4); ihdr[8] = 8; ihdr[9] = 0; // 8 bit grijs
  const rijen = Buffer.alloc(4 * 5, 0x80); for (let r = 0; r < 4; r++) rijen[r * 5] = 0; // filter 0 per rij
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    blok("IHDR", ihdr), blok("IDAT", deflateSync(rijen)), blok("IEND", Buffer.alloc(0))
  ]);
}
const PLAATJE = maakPng();

let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function openTypekeuze(thema, breedte) {
  const context = await browser.newContext({
    viewport: { width: breedte, height: 900 }, colorScheme: thema,
    serviceWorkers: "block", locale: "nl-NL"
  });
  const extern = await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
  await page.click("#btn-import");
  await page.locator("#scr-import").waitFor({ state: "visible", timeout: 5000 });
  await page.click("#btn-photo-start");
  await page.locator("#scr-photo").waitFor({ state: "visible", timeout: 5000 });
  await page.setInputFiles("#photo-input", { name: "bladzijde.png", mimeType: "image/png", buffer: PLAATJE });
  await page.locator("#photo-actions").waitFor({ state: "visible", timeout: 5000 });
  await page.evaluate(rondAnimatiesAf);
  return { context, page, fouten, extern };
}

function verzamel(c, waar, problemen, t) {
  if (c.gemeten === 0) problemen.push(`[${waar}] geen tekst gemeten, meting klopt niet`);
  for (const f of c.fouten) problemen.push(`[${waar}] contrast ${f.ratio}:1 < ${MIN_CONTRAST} bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
  for (const f of c.vrijgesteld) t.diagnostic(`[${waar}] uitgeschakeld, telt niet mee: ${f.waar} "${f.tekst}" ${f.ratio}:1`);
  for (const f of c.nietMeetbaar) problemen.push(`[${waar}] contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
}

for (const thema of ["light", "dark"]) {
  for (const breedte of [360, 1280]) {
    test(`foto-import typekeuze: contrast in rust en bij hover (${thema}, ${breedte}px)`, async t => {
      const { context, page, fouten, extern } = await openTypekeuze(thema, breedte);
      const problemen = [];

      const knoppen = page.locator("#photo-actions .photo-type-btn");
      assert.equal(await knoppen.count(), 4, "verwacht vier typeknoppen");
      assert.ok(await page.evaluate(() => matchMedia("(hover: hover) and (pointer: fine)").matches),
        "browser meldt geen muis: hover-regels gelden dan niet en de test zegt niets");

      // de hints moeten echt gemeten worden, anders zegt een groene test niets
      const hints = await page.locator("#photo-actions .photo-type-btn .hint").evaluateAll(els => els.filter(e => e.checkVisibility()).length);
      assert.equal(hints, 4, "niet alle vier de hints zijn zichtbaar");

      await page.mouse.move(0, 0);
      await page.evaluate(rondAnimatiesAf);
      verzamel(await page.evaluate(contrastMeting, { min: MIN_CONTRAST }), "rust", problemen, t);

      for (let i = 0; i < 4; i++) {
        const knop = knoppen.nth(i);
        const naam = (await knop.textContent()).trim();
        await knop.hover();
        await page.evaluate(rondAnimatiesAf);
        assert.ok(await knop.evaluate(el => el.matches(":hover")), `${naam} staat niet in :hover`);
        verzamel(await page.evaluate(contrastMeting, { min: MIN_CONTRAST }), `hover ${naam}`, problemen, t);
      }

      // nog steeds op de typekeuze: hover heeft niets aangeklikt
      assert.ok(await page.locator("#photo-actions").isVisible(), "typekeuze verdwenen tijdens de meting");
      await context.close();

      for (const f of fouten) problemen.push(f);
      if (extern.length) problemen.push("verzoeken naar buiten: " + extern.join(", "));
      if (problemen.length) assert.fail(`\n${problemen.length} probleem/problemen, typekeuze ${thema} ${breedte}px:\n  ` + problemen.join("\n  "));
    });
  }
}
