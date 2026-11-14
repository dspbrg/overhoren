// De app wordt gedeeld buiten de klas. Bij de eerste start vraagt hij
// daarom, onder het naamveld, of je in Mendel 1EHA2 zit. Ja: de klaslijsten
// uit lists.js. Nee: alleen eigen lijsten, en een lege staat met een
// duidelijke knop voor een nieuwe lijst. Wie al voortgang, eigen lijsten of
// een naam op het toestel heeft, krijgt de vraag niet en telt als ja.
// Wisselen kan later onder "Hoe werkt het?". De keuze blijft op het toestel.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const KLAS_KEY = "overhoor:klas";
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// naam: false is een verse browser zonder oefenaar; zaai komt een keer in opslag
async function open({ naam = false, zaai = {}, thema = "light", breedte = 360 } = {}) {
  const context = await browser.newContext({ naam, viewport: { width: breedte, height: 780 }, colorScheme: thema, serviceWorkers: "block" });
  await schermNetwerkAf(context);
  if (Object.keys(zaai).length) await context.addInitScript(z => {
    if (sessionStorage.getItem("test:gezaaid")) return;
    sessionStorage.setItem("test:gezaaid", "1");
    for (const [k, v] of Object.entries(z)) localStorage.setItem(k, v);
  }, zaai);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten };
}
const zichtbaar = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && e.checkVisibility(); }, sel);
// de ids van de lijsten op het startscherm, zonder de gemengde
const lijstIds = page => page.evaluate(() => [...document.querySelectorAll("#lessons .lesson")].map(b => b.dataset.id).filter(id => !id.startsWith("mix:")));
const klasIds = page => page.evaluate(() => window.WORDLISTS.map(l => l.id));
const eigenLijst = { id: "custom-1", title: "Mijn lijst", subject: "Duits", mode: "translate", from: "Duits", to: "Nederlands", directions: ["wd"],
  items: [{ word: "der Hund", def: "de hond" }, { word: "die Katze", def: "de kat" }, { word: "das Haus", def: "het huis" }] };

test("klas: een nieuwe gebruiker krijgt onder het naamveld de vraag of hij in de klas zit", async () => {
  const { context, page, fouten } = await open();
  assert.ok(await zichtbaar(page, "#klas-vraag"), "de klasvraag staat er niet");
  assert.equal((await page.locator("#klas-vraag p").textContent()).trim(), "Zit je in Mendel 1EHA2?");
  assert.equal((await page.locator("#btn-klas-ja").textContent()).trim(), "Ja, geef me de klaslijsten");
  assert.equal((await page.locator("#btn-klas-nee").textContent()).trim(), "Nee, ik maak eigen lijsten");
  assert.equal(await page.locator("#btn-klas-ja").evaluate(b => b.tagName), "BUTTON");
  assert.ok(await zichtbaar(page, "#learner-form"), "het naamveld staat er niet boven");
  // de volgorde: eerst de naam, dan de klas
  const naamEerst = await page.evaluate(() => !!(document.getElementById("learner-name").compareDocumentPosition(document.getElementById("btn-klas-ja")) & Node.DOCUMENT_POSITION_FOLLOWING));
  assert.ok(naamEerst, "de klasvraag staat voor het naamveld");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: zonder naam kiezen kan niet, de vraag blijft en het naamveld krijgt focus", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-klas-nee");
  assert.ok(await zichtbaar(page, "#klas-vraag"), "de vraag is weg zonder naam");
  assert.equal((await page.locator("#learner-hint").textContent()).trim(), "Typ eerst je naam.");
  assert.equal(await page.evaluate(() => document.activeElement.id), "learner-name");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), JSON.stringify("vraag"), "keuze bewaard zonder naam");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: Nee verbergt de klaslijsten en toont een lege staat met een duidelijke knop", async () => {
  const { context, page, fouten } = await open();
  await page.fill("#learner-name", "Sam");
  await page.click("#btn-klas-nee");
  assert.ok(!(await zichtbaar(page, "#klas-vraag")), "de vraag blijft staan");
  assert.equal(await page.locator("#learner-label").textContent(), "Sam");
  assert.deepEqual(await lijstIds(page), [], "er staan toch lijsten");
  const tekst = (await page.locator("#lessons").innerText()).replace(/\s+/g, " ");
  assert.match(tekst, /Nog geen lijsten\. Maak een foto van je boek of typ de woorden zelf\./);
  const knop = page.locator("#btn-import");
  assert.ok(await knop.isVisible(), "geen knop voor een nieuwe lijst");
  assert.equal((await knop.textContent()).trim(), "+ Nieuwe lijst");
  assert.ok(await knop.evaluate(b => b.classList.contains("primary")), "de knop is niet prominent");
  assert.equal(await page.evaluate(() => document.activeElement.id), "btn-import", "focus niet op de knop");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), "false");
  // na herladen: geen vraag, nog steeds leeg
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(!(await zichtbaar(page, "#klas-vraag")), "de vraag komt terug na herladen");
  assert.deepEqual(await lijstIds(page), []);
  // de knop werkt
  await knop.click(); await wachtOpScherm(page, "scr-import");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: bij Nee blijven eigen lijsten zichtbaar, de klaslijsten niet", async () => {
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false", "overhoor:lists": JSON.stringify([eigenLijst]) } });
  assert.deepEqual(await lijstIds(page), ["custom-1"]);
  assert.ok(!(await page.locator("#btn-import").evaluate(b => b.classList.contains("primary"))), "de knop is prominent terwijl er een lijst is");
  await page.locator('#lessons .lesson[data-id="custom-1"]').click();
  await wachtOpScherm(page, "scr-home");
  assert.equal(await page.locator("#list-title").textContent(), "Mijn lijst");
  // een eigen lijst wissen die de laatste was: weer de lege staat, geen fout
  page.once("dialog", d => d.accept());
  await page.click("#btn-delete-list");
  await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), []);
  assert.match(await page.locator("#lessons").innerText(), /Nog geen lijsten/);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: Ja toont de klaslijsten", async () => {
  const { context, page, fouten } = await open();
  await page.fill("#learner-name", "Noor");
  await page.click("#btn-klas-ja");
  assert.ok(!(await zichtbaar(page, "#klas-vraag")), "de vraag blijft staan");
  assert.deepEqual(await lijstIds(page), await klasIds(page));
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), "true");
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(!(await zichtbaar(page, "#klas-vraag")), "de vraag komt terug na herladen");
  assert.deepEqual(await lijstIds(page), await klasIds(page));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: alleen een naam opslaan beantwoordt de vraag niet, ook niet na herladen", async () => {
  const { context, page, fouten } = await open();
  await page.fill("#learner-name", "Tom");
  await page.press("#learner-name", "Enter");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  assert.ok(await zichtbaar(page, "#klas-vraag"), "de vraag is weg na alleen een naam");
  assert.equal(await page.evaluate(() => document.activeElement.id), "btn-klas-ja", "focus niet naar de vraag");
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(await zichtbaar(page, "#klas-vraag"), "na herladen telt Tom ineens als bestaande gebruiker");
  await page.click("#btn-klas-nee");
  assert.deepEqual(await lijstIds(page), []);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: een bestaande gebruiker krijgt de vraag niet en houdt de klaslijsten", async () => {
  const lid = "gold-a2-starter-unit1";
  const voortgang = JSON.stringify({ items: { 0: { box: 1, seen: 1, due: 0 } }, sessions: [], updated: 5 });
  const gevallen = {
    "een naam": { naam: true },
    "alleen voortgang": { zaai: { ["overhoor:progress:pia:" + lid]: voortgang } },
    "alleen eigen lijsten": { zaai: { "overhoor:lists": JSON.stringify([eigenLijst]) } },
    "oude voortgang zonder naam": { zaai: { ["overhoor:progress:" + lid]: voortgang } },
    "alleen een lijst oefenaars": { zaai: { "overhoor:learners": JSON.stringify(["Pia"]) } }
  };
  for (const [naam, opties] of Object.entries(gevallen)) {
    const { context, page, fouten } = await open(opties);
    assert.ok(!(await zichtbaar(page, "#klas-vraag")), naam + ": de vraag staat er toch");
    const ids = await lijstIds(page);
    for (const k of await klasIds(page)) assert.ok(ids.includes(k), naam + ": klaslijst " + k + " ontbreekt");
    assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), "true", naam + ": niet als ja bewaard");
    assert.deepEqual(fouten, [], naam);
    await context.close();
  }
  // een thema of een oude welkomsdatum maakt nog geen bestaande gebruiker
  const { context, page } = await open({ zaai: { "overhoor:thema": JSON.stringify("dark"), "overhoor:current": JSON.stringify(lid) } });
  assert.ok(await zichtbaar(page, "#klas-vraag"), "thema telt als bestaande gebruiker");
  await context.close();
});

test("klas: de schakelaar onder Hoe werkt het wisselt en blijft bewaard", async () => {
  const { context, page, fouten } = await open({ naam: true });
  const alleKlas = await klasIds(page);
  await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
  const groep = page.locator('[role="group"][aria-labelledby="klas-label"]');
  assert.ok(await groep.isVisible(), "geen schakelaar");
  assert.equal((await page.locator("#klas-label").textContent()).trim(), "Klaslijsten van Mendel 1EHA2 tonen");
  const pressed = () => page.evaluate(() => [...document.querySelectorAll("#klas-seg button")].map(b => b.textContent.trim() + ":" + b.getAttribute("aria-pressed")));
  assert.deepEqual(await pressed(), ["Ja:true", "Nee:false"]);
  await page.click('#klas-seg button[data-klas="nee"]');
  assert.deepEqual(await pressed(), ["Ja:false", "Nee:true"]);
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), "false");
  await page.click("#btn-info-back"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), []);
  // na herladen nog steeds uit
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), []);
  await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
  assert.deepEqual(await pressed(), ["Ja:false", "Nee:true"]);
  await page.click('#klas-seg button[data-klas="ja"]');
  await page.click("#btn-info-back"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), alleKlas);
  assert.equal(await page.evaluate(k => localStorage.getItem(k), KLAS_KEY), "true");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: verborgen klaslijsten met voortgang breken het rapport niet", async () => {
  const lid = "gold-a2-starter-unit1";
  const voortgang = JSON.stringify({ items: { 0: { box: 1, seen: 1, due: 0 } }, sessions: [{ date: 1, n: 1, first: 1, ms: 1000 }], updated: 5 });
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false", ["overhoor:progress:pia:" + lid]: voortgang, "overhoor:current": JSON.stringify(lid) } });
  assert.deepEqual(await lijstIds(page), []);
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await page.locator("#report-body .card").first().waitFor();
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: vraag en lege staat halen contrast, passen en hebben grote knoppen", async () => {
  const problemen = [];
  for (const thema of THEMAS) for (const breedte of BREEDTES) {
    const stand = thema + " " + breedte;
    for (const fase of ["vraag", "leeg"]) {
      const { context, page, fouten } = await open({ thema, breedte });
      if (fase === "leeg") { await page.fill("#learner-name", "Sam"); await page.click("#btn-klas-nee"); }
      await page.evaluate(rondAnimatiesAf);
      const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
      for (const f of c.fouten) problemen.push(`${stand} ${fase}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
      for (const f of c.nietMeetbaar) problemen.push(`${stand} ${fase}: niet meetbaar bij ${f.waar} "${f.tekst}"`);
      const o = await page.evaluate(overloopMeting);
      if (o.overloop) problemen.push(`${stand} ${fase}: overloop ${o.scrollWidth}px: ${o.boosdoeners.join(", ")}`);
      for (const id of fase === "vraag" ? ["btn-klas-ja", "btn-klas-nee"] : ["btn-import"]) {
        const h = await page.locator("#" + id).evaluate(b => b.getBoundingClientRect().height);
        if (h < 44) problemen.push(`${stand} ${fase}: ${id} is ${h}px hoog`);
      }
      for (const f of fouten) problemen.push(`${stand} ${fase}: ${f}`);
      await context.close();
    }
  }
  assert.deepEqual(problemen, []);
});

// ---------- aanvullende dekking ----------
const LID = "gold-a2-starter-unit1";
const VOORTGANG = JSON.stringify({ items: { 0: { box: 1, seen: 1, due: 0 } }, sessions: [], updated: 5 });
const vraagZichtbaar = page => zichtbaar(page, "#klas-vraag");
const bewaard = (page, k = KLAS_KEY) => page.evaluate(k => localStorage.getItem(k), k);
const eigenLijst2 = { id: "custom-2", title: "Tweede lijst", subject: "Duits", mode: "translate", from: "Duits", to: "Nederlands", directions: ["wd"],
  items: [{ word: "der Baum", def: "de boom" }, { word: "das Auto", def: "de auto" }, { word: "die Tür", def: "de deur" }] };

test("klas: elk spoor van een oefenaar telt als bestaande gebruiker, zonder naam op het toestel", async () => {
  // naam: false en geen overhoor:learner: alleen dit ene spoor staat in opslag
  const sporen = {
    "session": { ["overhoor:session:pia:" + LID]: JSON.stringify({ queue: [0], pos: 0 }) },
    "cats": { "overhoor:cats:pia": JSON.stringify({ kat1: { eerst: 1 } }) },
    "alts": { ["overhoor:alts:pia:" + LID]: JSON.stringify({ 0: ["x"] }) },
    "grens": { ["overhoor:grens:pia:" + LID]: JSON.stringify(10) },
    "deadline": { ["overhoor:deadline:" + LID]: JSON.stringify("2099-01-01") },
    "tijd": { ["overhoor:tijd:pia:2026-01-01"]: JSON.stringify({ ms: 1000 }) },
    "naam-bevestigd": { "overhoor:naam-bevestigd": "true" },
    "learner": { "overhoor:learner": JSON.stringify("Pia") },
    "voortgang zonder oefenaar in de sleutel": { ["overhoor:progress:" + LID]: VOORTGANG }
  };
  for (const [naam, zaai] of Object.entries(sporen)) {
    const { context, page, fouten } = await open({ zaai });
    assert.ok(!(await vraagZichtbaar(page)), naam + ": de vraag staat er toch");
    assert.equal(await bewaard(page), "true", naam + ": niet als ja bewaard");
    const ids = await lijstIds(page);
    for (const k of await klasIds(page)) assert.ok(ids.includes(k), naam + ": klaslijst " + k + " ontbreekt");
    assert.deepEqual(fouten, [], naam);
    await context.close();
  }
});

test("klas: lege, kapotte of niet-oefenaar waarden in opslag maken niemand bestaand", async () => {
  const leeg = {
    "lege lijst oefenaars": { "overhoor:learners": "[]" },
    "lege lijst eigen lijsten": { "overhoor:lists": "[]" },
    "null als voortgang": { ["overhoor:progress:pia:" + LID]: "null" },
    "kapotte voortgang": { ["overhoor:progress:pia:" + LID]: "{kapot" },
    "sync-geheim, thema, laatste lijst": { "overhoor:app-secret": JSON.stringify("fictief"), "overhoor:thema": JSON.stringify("dark"), "overhoor:current": JSON.stringify(LID) },
    "welkom en herladen": { "overhoor:welkom:sessie": "1", "overhoor:welkom:dag": JSON.stringify("2026-01-01"), "overhoor:sw:herladen": "1" }
  };
  for (const [naam, zaai] of Object.entries(leeg)) {
    const { context, page, fouten } = await open({ zaai });
    assert.ok(await vraagZichtbaar(page), naam + ": telt ten onrechte als bestaande gebruiker");
    assert.equal(await bewaard(page), JSON.stringify("vraag"), naam);
    assert.deepEqual(fouten, [], naam);
    await context.close();
  }
});

test("klas: oude voortgang zonder naam: geen klasvraag, wel eerst een naam, en de klaslijsten blijven", async () => {
  const { context, page, fouten } = await open({ zaai: { ["overhoor:progress:" + LID]: VOORTGANG } });
  assert.ok(!(await vraagZichtbaar(page)), "klasvraag bij oude voortgang");
  assert.ok(await zichtbaar(page, "#learner-form"), "het naamveld ontbreekt");
  await page.fill("#learner-name", "Roos");
  await page.press("#learner-name", "Enter");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  assert.ok(!(await vraagZichtbaar(page)), "de klasvraag komt na het kiezen van een naam alsnog");
  assert.equal(await bewaard(page), "true");
  assert.deepEqual(await lijstIds(page), await klasIds(page));
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.ok(!(await vraagZichtbaar(page)));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: een eerder bewaarde keuze wint van het toestel: Nee blijft Nee ondanks voortgang", async () => {
  const { context, page, fouten } = await open({ zaai: { [KLAS_KEY]: "false", ["overhoor:progress:pia:" + LID]: VOORTGANG, "overhoor:learner": JSON.stringify("Pia") } });
  assert.ok(!(await vraagZichtbaar(page)));
  assert.equal(await bewaard(page), "false");
  assert.deepEqual(await lijstIds(page), []);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: na Nee kan een ronde met een eigen lijst gedaan worden, tot en met de samenvatting", async () => {
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false", "overhoor:lists": JSON.stringify([eigenLijst]) } });
  await page.locator('#lessons .lesson[data-id="custom-1"]').click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  for (let i = 0; i < 3; i++) {
    const prompt = (await page.locator("#q-prompt").textContent()).trim();
    const item = eigenLijst.items.find(x => x.word === prompt);
    assert.ok(item, "onbekende vraag " + prompt);
    await page.fill("#q-input", item.def);
    await page.click("#btn-check");
    await page.locator("#btn-next").waitFor({ state: "visible" });
    await page.click("#btn-next");
  }
  await wachtOpScherm(page, "scr-summary");
  await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), ["custom-1"]);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: na Nee werkt Alles door elkaar met eigen lijsten, en het rapport en Voortgang ook", async () => {
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false", "overhoor:lists": JSON.stringify([eigenLijst, eigenLijst2]) } });
  const mix = page.locator('#lessons .lesson[data-id^="mix:"]');
  assert.equal(await mix.count(), 1, "een gemengde ronde voor Duits");
  await mix.click(); await wachtOpScherm(page, "scr-home");
  assert.match(await page.locator("#list-sub").textContent(), /6 woorden/);
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  await page.click("#btn-progress-back"); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  const prompt = (await page.locator("#q-prompt").textContent()).trim();
  const alle = eigenLijst.items.concat(eigenLijst2.items);
  assert.ok(alle.some(x => x.word === prompt), "vraag komt niet uit de eigen lijsten: " + prompt);
  await page.click("#btn-quit");
  await page.goto(server.url + "/index.html"); await wachtOpScherm(page, "scr-lessons");
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: Nee zonder eigen lijst: het rapport, Hoe werkt het en de knop Nieuwe lijst geven geen fouten", async () => {
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false" } });
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
  await page.click("#btn-info-back"); await wachtOpScherm(page, "scr-lessons");
  await page.click("#btn-learner"); await page.locator("#learner-form").waitFor({ state: "visible" });
  await page.fill("#learner-name", "Mees"); await page.click("#btn-learner-save");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  assert.match(await page.locator("#lessons").innerText(), /Nog geen lijsten/, "lege staat weg na wisselen van naam");
  assert.ok(!(await vraagZichtbaar(page)));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: Nee en dan zelf een lijst typen: de lijst verschijnt en de lege staat is weg", async () => {
  const { context, page, fouten } = await open();
  await page.fill("#learner-name", "Sam");
  await page.click("#btn-klas-nee");
  assert.match(await page.locator("#lessons").innerText(), /Nog geen lijsten/);
  await page.click("#btn-import"); await wachtOpScherm(page, "scr-import");
  await page.click("#btn-type-start");
  await page.fill("#imp-subject", "Frans"); await page.fill("#imp-title", "Unité 1");
  await page.fill("#imp-from", "Frans"); await page.fill("#imp-to", "Nederlands");
  await page.fill("#imp-text", "le chien | de hond\nle chat | de kat\nla maison | het huis");
  await page.click("#btn-import-save"); await wachtOpScherm(page, "scr-home");
  assert.equal(await page.locator("#list-title").textContent(), "Unité 1");
  await page.click("#btn-home-back"); await wachtOpScherm(page, "scr-lessons");
  const ids = await lijstIds(page);
  assert.equal(ids.length, 1);
  assert.match(ids[0], /^custom-/);
  assert.ok(!/Nog geen lijsten/.test(await page.locator("#lessons").innerText()), "lege staat staat er nog");
  assert.match(await page.locator("#lessons").innerText(), /Unité 1/);
  assert.ok(!(await page.locator("#btn-import").evaluate(b => b.classList.contains("primary"))), "knop nog prominent");
  assert.ok(!(await vraagZichtbaar(page)));
  assert.equal(await bewaard(page), "false");
  // na herladen blijft de eigen lijst, geen klaslijst, geen vraag
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(await lijstIds(page), ids);
  assert.ok(!(await vraagZichtbaar(page)));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: na Nee en herladen komt de vraag niet terug, ook niet bij een tweede keer herladen of na wisselen van naam", async () => {
  const { context, page, fouten } = await open();
  await page.fill("#learner-name", "Sam");
  await page.click("#btn-klas-nee");
  for (let i = 0; i < 2; i++) {
    await page.reload(); await wachtOpScherm(page, "scr-lessons");
    assert.ok(!(await vraagZichtbaar(page)), "de vraag komt terug na herladen " + (i + 1));
    assert.equal(await bewaard(page), "false");
    assert.deepEqual(await lijstIds(page), []);
  }
  await page.click("#btn-learner"); await page.fill("#learner-name", "Lot"); await page.click("#btn-learner-save");
  assert.ok(!(await vraagZichtbaar(page)), "de vraag komt terug na wisselen van naam");
  assert.equal(await bewaard(page), "false");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("klas: na Nee mengt Alles door elkaar alleen eigen woorden, ook bij hetzelfde vak als een klaslijst", async () => {
  // Frans met translate is ook de vorm van de klaslijst frans-arret-apprendre
  const frans = { id: "custom-f", title: "Mijn Frans", subject: "Frans", mode: "translate", from: "Frans", to: "Nederlands", directions: ["wd"],
    items: [{ word: "le chien", def: "de hond" }, { word: "le chat", def: "de kat" }, { word: "la maison", def: "het huis" }] };
  const { context, page, fouten } = await open({ naam: true, zaai: { [KLAS_KEY]: "false", "overhoor:lists": JSON.stringify([frans]) } });
  const mix = page.locator('#lessons .lesson[data-id^="mix:"]');
  assert.equal(await mix.count(), 1);
  await mix.click(); await wachtOpScherm(page, "scr-home");
  assert.match(await page.locator("#list-sub").textContent(), /alles herhalen · 3 woorden/, "de verborgen klaslijst zit in de mix");
  assert.deepEqual(fouten, []);
  await context.close();
});
