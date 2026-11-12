// Eis 1 en 2: elk scherm zonder JS-fouten, zonder horizontale overloop en
// met contrast van minstens 4,5:1, in licht en donker, op 360 en 1280px.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { loopSchermen } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

for (const thema of THEMAS) {
  for (const breedte of BREEDTES) {
    test(`app, ${thema}, ${breedte}px`, async t => {
      const context = await browser.newContext({
        viewport: { width: breedte, height: breedte < 600 ? 780 : 900 },
        colorScheme: thema, serviceWorkers: "block", locale: "nl-NL"
      });
      const extern = await schermNetwerkAf(context);
      const page = await context.newPage();
      const jsFouten = volgFouten(page);
      const problemen = [];
      const bezocht = [];

      await loopSchermen(page, server.url, async naam => {
        bezocht.push(naam);
        await page.evaluate(rondAnimatiesAf);
        const o = await page.evaluate(overloopMeting);
        if (o.overloop) problemen.push(`[${naam}] horizontale overloop: pagina ${o.scrollWidth}px breed bij ${o.breedte}px. Uitstekend: ${o.boosdoeners.join(", ") || "onbekend"}`);
        if (o.verstopt) problemen.push(`[${naam}] overflow-x: hidden op html/body verbergt mogelijke overloop`);
        const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
        if (c.gemeten === 0) problemen.push(`[${naam}] geen tekst gemeten, meting klopt niet`);
        for (const f of c.fouten) problemen.push(`[${naam}] contrast ${f.ratio}:1 < ${MIN_CONTRAST} bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
        for (const f of c.vrijgesteld) t.diagnostic(`[${naam}] uitgeschakeld, telt niet mee: ${f.waar} "${f.tekst}" ${f.ratio}:1`);
        for (const f of c.nietMeetbaar) problemen.push(`[${naam}] contrast niet meetbaar (plaatje of onbekende kleurnotatie) bij ${f.waar} "${f.tekst}"`);
        for (const f of jsFouten.splice(0)) problemen.push(`[${naam}] ${f}`);
      });
      for (const f of jsFouten) problemen.push(`[na laatste scherm] ${f}`);
      const nietSync = extern.filter(u => !/workers\.dev\//.test(u));
      if (nietSync.length) problemen.push("verzoeken naar buiten: " + nietSync.join(", "));
      await context.close();

      assert.ok(bezocht.length >= 20, "niet alle schermen bereikt: " + bezocht.join(", "));
      if (problemen.length) assert.fail(`\n${problemen.length} probleem/problemen in ${thema} ${breedte}px:\n  ` + problemen.join("\n  "));
    });
  }
}
