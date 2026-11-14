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

// ---------- foto-import zonder wachtwoord, en de grenzen ----------
// De nep-worker antwoordt op /extract en /enrich; er gaat niets naar buiten.
// Zonder overhoor:app-secret moet de foto-import gewoon werken, met een
// toestel-id in de kop en zonder x-api-token. Bij 429 toont de app de
// vaste melding voor de grens die de worker noemt, met "Typ zelf".

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT,POST" };
const UUID4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TEKST_DAG = "Vandaag kunnen er geen foto's meer bij. Morgen weer, of typ de woorden zelf.";
const TEKST_MAAND = "Deze maand kunnen er geen foto's meer bij. Typ de woorden zelf.";
const RESULTAAT = { mode: "translate", subject: "Frans", title: "Foto", from: "Frans", to: "Nederlands",
  items: [{ word: "chat", def: "kat" }, { word: "chien", def: "hond" }] };

async function openFoto({ thema = "light", extract, secret = null } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 900 }, colorScheme: thema, serviceWorkers: "block", locale: "nl-NL" });
  const extern = await schermNetwerkAf(context);
  const verzoeken = [];
  await context.route(/workers\.dev\/(extract|enrich)/, route => {
    const r = route.request();
    if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
    verzoeken.push({ pad: new URL(r.url()).pathname, koppen: r.headers() });
    if (/enrich/.test(r.url())) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: RESULTAAT.items }), headers: CORS });
    const { status, body } = extract();
    return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body), headers: CORS });
  });
  if (secret) await context.addInitScript(s => localStorage.setItem("overhoor:app-secret", JSON.stringify(s)), secret);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:app-secret")), secret ? JSON.stringify(secret) : null);
  return { context, page, fouten, extern, verzoeken };
}

async function fotoNaarWorker(page) {
  await page.click("#btn-import");
  await page.locator("#scr-import").waitFor({ state: "visible", timeout: 5000 });
  assert.ok(await page.locator("#btn-photo-start").isVisible(), "foto-knop niet zichtbaar");
  await page.click("#btn-photo-start");
  await page.locator("#scr-photo").waitFor({ state: "visible", timeout: 5000 });
  await page.setInputFiles("#photo-input", { name: "bladzijde.png", mimeType: "image/png", buffer: PLAATJE });
  await page.locator("#photo-actions").waitFor({ state: "visible", timeout: 5000 });
  await page.click('.photo-type-btn[data-type="anders"]');
}

test("foto-import zonder wachtwoord: knop zichtbaar, verzoek met toestel-id en zonder wachtwoord", async () => {
  const { context, page, fouten, verzoeken } = await openFoto({ extract: () => ({ status: 200, body: RESULTAAT }) });
  await fotoNaarWorker(page);
  await page.locator("#photo-review").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(verzoeken.length, 1);
  const id = verzoeken[0].koppen["x-toestel"];
  assert.match(id || "", UUID4);
  assert.equal("x-api-token" in verzoeken[0].koppen, false, "geen leeg wachtwoord meesturen");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("overhoor:toestel"))), id, "id bewaard");
  // opslaan: de verrijking gaat ook met hetzelfde toestel-id
  await page.click("#btn-photo-save");
  await page.locator("#photo-done").waitFor({ state: "visible", timeout: 5000 });
  await page.waitForFunction(() => /verrijkt/.test(document.getElementById("photo-done-text").textContent), null, { timeout: 5000 });
  assert.equal(verzoeken[1].pad, "/enrich");
  assert.equal(verzoeken[1].koppen["x-toestel"], id);
  // nog een foto na herladen: zelfde id
  await page.reload();
  await page.locator("#scr-lessons").waitFor({ state: "visible", timeout: 5000 });
  await fotoNaarWorker(page);
  await page.locator("#photo-review").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(verzoeken[2].koppen["x-toestel"], id, "toestel-id blijft hetzelfde");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("foto-import met wachtwoord: wachtwoord en toestel-id gaan allebei mee", async () => {
  const { context, page, fouten, verzoeken } = await openFoto({ secret: "test-wachtwoord", extract: () => ({ status: 200, body: RESULTAAT }) });
  await fotoNaarWorker(page);
  await page.locator("#photo-review").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(verzoeken[0].koppen["x-api-token"], "test-wachtwoord");
  assert.match(verzoeken[0].koppen["x-toestel"] || "", UUID4);
  assert.deepEqual(fouten, []);
  await context.close();
});

for (const [grens, tekst] of [["toestel", TEKST_DAG], ["maand", TEKST_MAAND]]) {
  for (const thema of ["light", "dark"]) {
    test(`foto-import: bij 429 (${grens}) de vaste melding en Typ zelf (${thema})`, async t => {
      const { context, page, fouten, extern } = await openFoto({ thema, extract: () => ({ status: 429, body: { error: "Grens bereikt", grens } }) });
      await fotoNaarWorker(page);
      await page.locator("#photo-error").waitFor({ state: "visible", timeout: 5000 });
      assert.equal((await page.locator("#photo-error").textContent()).trim(), tekst);
      assert.ok(await page.locator("#btn-photo-typ").isVisible(), "Typ zelf niet zichtbaar");
      assert.equal(await page.locator("#photo-review").isVisible(), false);

      await page.evaluate(rondAnimatiesAf);
      const problemen = [];
      verzamel(await page.evaluate(contrastMeting, { min: MIN_CONTRAST }), "grens " + grens, problemen, t);
      if (problemen.length) assert.fail(problemen.join("\n"));

      await page.click("#btn-photo-typ");
      await page.locator("#scr-import").waitFor({ state: "visible", timeout: 5000 });
      assert.ok(await page.locator("#import-form").isVisible(), "invulscherm niet open");
      assert.equal(await page.locator("#import-choices").isVisible(), false);
      // terug naar de foto: de melding en de knop zijn weg
      await page.click("#btn-import-form-back");
      await page.click("#btn-photo-start");
      await page.locator("#scr-photo").waitFor({ state: "visible", timeout: 5000 });
      assert.equal(await page.locator("#photo-error").isVisible(), false);
      assert.equal(await page.locator("#btn-photo-typ").isVisible(), false);
      // de browser meldt de 429 zelf in de console; dat is verwacht
      assert.deepEqual(fouten.filter(f => !/status of 429/.test(f)), []);
      assert.deepEqual(extern.filter(u => !/workers\.dev/.test(u)), []);
      await context.close();
    });
  }
}

test("foto-import: een andere fout geeft niet de grensmelding", async () => {
  const { context, page, verzoeken } = await openFoto({ extract: () => ({ status: 502, body: { error: "De AI-dienst gaf een fout." } }) });
  await fotoNaarWorker(page);
  await page.locator("#photo-error").waitFor({ state: "visible", timeout: 5000 });
  const tekst = (await page.locator("#photo-error").textContent()).trim();
  assert.equal(verzoeken.length, 1);
  assert.notEqual(tekst, TEKST_DAG);
  assert.notEqual(tekst, TEKST_MAAND);
  assert.equal(await page.locator("#btn-photo-typ").isVisible(), false);
  await context.close();
});

test("foto-import: na 429 opent Typ zelf het invulscherm, en op een nieuwe dag werkt de foto-import weer", async () => {
  let toestand = { status: 429, body: { error: "Grens bereikt", grens: "toestel" } };
  const { context, page, fouten, verzoeken } = await openFoto({ extract: () => toestand });
  await fotoNaarWorker(page);
  await page.locator("#photo-error").waitFor({ state: "visible", timeout: 5000 });
  assert.equal((await page.locator("#photo-error").textContent()).trim(), TEKST_DAG);
  await page.click("#btn-photo-typ");
  await page.locator("#import-form").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator("#scr-photo").isVisible(), false, "fotoscherm moet dicht zijn");
  // het invulscherm is bruikbaar: een veld is te vullen
  const veld = page.locator("#import-form textarea, #import-form input[type=text]").first();
  await veld.fill("test");
  assert.equal(await veld.inputValue(), "test");

  // nieuwe dag: de worker laat weer door
  toestand = { status: 200, body: RESULTAAT };
  await page.click("#btn-import-form-back");
  await page.click("#btn-photo-start");
  await page.locator("#scr-photo").waitFor({ state: "visible", timeout: 5000 });
  await page.setInputFiles("#photo-input", { name: "bladzijde.png", mimeType: "image/png", buffer: PLAATJE });
  await page.locator("#photo-actions").waitFor({ state: "visible", timeout: 5000 });
  await page.click('.photo-type-btn[data-type="anders"]');
  await page.locator("#photo-review").waitFor({ state: "visible", timeout: 5000 });
  assert.equal(await page.locator("#photo-error").isVisible(), false, "oude melding weg");
  assert.equal(await page.locator("#btn-photo-typ").isVisible(), false, "Typ zelf weg");
  assert.equal(verzoeken.length, 2);
  assert.equal(verzoeken[0].koppen["x-toestel"], verzoeken[1].koppen["x-toestel"], "zelfde toestel");
  assert.deepEqual(fouten.filter(f => !/status of 429/.test(f)), []);
  await context.close();
});

test("foto-import: een 429 zonder leesbare inhoud geeft de daggrensmelding", async () => {
  const { context, page } = await openFoto({ extract: () => ({ status: 429, body: "geen json" }) });
  await fotoNaarWorker(page);
  await page.locator("#photo-error").waitFor({ state: "visible", timeout: 5000 });
  assert.equal((await page.locator("#photo-error").textContent()).trim(), TEKST_DAG);
  assert.ok(await page.locator("#btn-photo-typ").isVisible());
  await context.close();
});
