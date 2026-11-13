// Geen standaardnaam. Vroeger stond iedereen die geen naam typte als
// "Pia", en met sync aan schreef hij dan in Pia's record op de server.
// Nu: zonder opgeslagen oefenaar vraagt de app eerst een naam (het veld bij
// "Wie oefent", open en met focus). Zolang er geen naam is, start er geen
// ronde, gaat er niets naar de sync en wordt er niets onder een naam
// bewaard. Wie al een naam heeft, merkt niets.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

// naam: false is een verse browser zonder oefenaar. sync: een geheim in
// opslag, zodat de app zou synchroniseren als hij een naam had.
async function open({ naam = false, sync = false, zaai = {}, thema = "light", breedte = 360 } = {}) {
  const context = await browser.newContext({ naam, viewport: { width: breedte, height: 780 }, colorScheme: thema, serviceWorkers: "block" });
  const extern = await schermNetwerkAf(context);
  const alles = Object.assign({}, zaai, sync ? { "overhoor:app-secret": JSON.stringify("geheim") } : {});
  if (Object.keys(alles).length) await context.addInitScript(z => {
    if (sessionStorage.getItem("test:gezaaid")) return;
    sessionStorage.setItem("test:gezaaid", "1");
    for (const [k, v] of Object.entries(z)) localStorage.setItem(k, v);
  }, alles);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten, extern };
}
const syncVerzoeken = extern => extern.filter(u => /\/sync\//.test(u));
const opslag = page => page.evaluate(() => {
  const o = {};
  for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); o[k] = localStorage.getItem(k); }
  return o;
});
const naamVeld = page => page.evaluate(() => ({
  form: !document.getElementById("learner-form").hidden && document.getElementById("learner-form").checkVisibility(),
  view: document.getElementById("learner-view").checkVisibility(),
  focus: document.activeElement && document.activeElement.id,
  label: document.querySelector('label[for="learner-name"]')?.textContent.trim() || "",
  waarde: document.getElementById("learner-name").value
}));
// sleutels die bij een oefenaar horen: voortgang, ronde, tijd, grens, alts, cats
const onderNaam = o => Object.keys(o).filter(k => /^overhoor:(progress|session|tijd|grens|alts|cats):/.test(k));

test("naam: een verse browser vraagt eerst een naam, en er staat geen Pia in opslag", async () => {
  const { context, page, fouten } = await open();
  await page.waitForTimeout(300);
  const v = await naamVeld(page);
  assert.ok(v.form, "het naamveld staat niet open");
  assert.ok(!v.view, "'Wie oefent' met een naam staat er toch");
  assert.equal(v.focus, "learner-name", "het naamveld heeft geen focus");
  assert.equal(v.label, "Wie oefent?", "het naamveld heeft geen zichtbaar label");
  assert.equal(v.waarde, "");
  const o = await opslag(page);
  assert.equal(o["overhoor:learner"], undefined, "er is toch een oefenaar opgeslagen: " + o["overhoor:learner"]);
  assert.equal(o["overhoor:learners"], undefined, "er is toch een lijst oefenaars opgeslagen");
  assert.ok(!Object.values(o).some(w => /pia/i.test(w)) && !Object.keys(o).some(k => /pia/i.test(k)), "Pia staat ergens in opslag");
  assert.deepEqual(onderNaam(o), [], "er is iets onder een naam bewaard");
  assert.doesNotMatch(await page.locator("#scr-lessons").innerText(), /Pia/, "Pia staat op het scherm");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: zonder naam geen sync-verzoek, na het typen alleen naar die naam", async () => {
  const { context, page, fouten, extern } = await open({ sync: true });
  await page.waitForTimeout(800);
  assert.deepEqual(syncVerzoeken(extern), [], "sync zonder naam");
  // iets doen dat anders een push geeft: een les proberen te openen
  await page.locator("#lessons .lesson").first().click();
  await page.waitForTimeout(2500);   // de push wacht 2 s
  assert.deepEqual(syncVerzoeken(extern), [], "sync zonder naam na een tik op een les");
  await page.fill("#learner-name", "Tom");
  await page.press("#learner-name", "Enter");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
  const s = syncVerzoeken(extern);
  assert.ok(s.length, "na het typen van een naam geen sync");
  assert.ok(s.every(u => u.endsWith("/sync/tom")), "sync naar een andere naam: " + s.join(", "));
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:learner")), JSON.stringify("Tom"));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: een opgeslagen naam blijft, met voortgang en sync naar die naam", async () => {
  const voortgang = JSON.stringify({ items: { 0: { box: 3, lapses: 0, seen: 2, due: 0, partWrong: {}, dirWrong: {} } }, sessions: [{ at: 1, n: 1, firstTry: 1 }], updated: 5 });
  const lid = await (async () => {
    const { context, page } = await open({ naam: true });
    const id = await page.evaluate(() => document.querySelector("#lessons .lesson").dataset.id);
    await context.close();
    return id;
  })();
  const { context, page, fouten, extern } = await open({ naam: false, sync: true, zaai: {
    "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia"]),
    ["overhoor:progress:pia:" + lid]: voortgang
  } });
  for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
  const v = await naamVeld(page);
  assert.ok(!v.form, "het naamveld staat open terwijl er een naam is");
  assert.ok(v.view, "'Wie oefent' staat er niet");
  assert.equal(await page.locator("#learner-label").textContent(), "Pia");
  const o = await opslag(page);
  assert.equal(o["overhoor:learner"], JSON.stringify("Pia"));
  assert.equal(o["overhoor:progress:pia:" + lid], voortgang, "voortgang van Pia is aangeraakt");
  assert.ok(syncVerzoeken(extern).length && syncVerzoeken(extern).every(u => u.endsWith("/sync/pia")), "sync niet naar Pia: " + syncVerzoeken(extern).join(", "));
  // herladen: nog steeds Pia
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.equal(await page.locator("#learner-label").textContent(), "Pia");
  // de les opent gewoon
  await page.locator("#lessons .lesson").first().click();
  await wachtOpScherm(page, "scr-home");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: starten zonder naam kan niet, een lege naam opslaan ook niet", async () => {
  const { context, page, fouten } = await open();
  // een les openen: blijft op het startscherm, met een korte vraag om de naam
  await page.locator("#lessons .lesson").first().click();
  await page.waitForTimeout(200);
  assert.ok(await page.locator("#scr-lessons").isVisible(), "startscherm is weg");
  assert.ok(!(await page.locator("#scr-home").isVisible()), "de les ging toch open");
  assert.ok(!(await page.locator("#scr-quiz").isVisible()), "er liep toch een ronde");
  const hint = page.locator("#learner-hint");
  assert.ok(await hint.isVisible(), "geen vraag om de naam");
  assert.equal((await hint.textContent()).trim(), "Typ eerst je naam.");
  assert.equal(await page.evaluate(() => document.activeElement.id), "learner-name", "focus niet in het naamveld");
  // leeg opslaan, met de knop en met Enter, ook alleen spaties
  await page.click("#btn-learner-save");
  await page.fill("#learner-name", "   ");
  await page.press("#learner-name", "Enter");
  assert.ok((await naamVeld(page)).form, "naamveld ging dicht zonder naam");
  // ook langs de code: geen ronde zonder naam
  await page.evaluate(() => { document.getElementById("btn-start").click(); document.getElementById("btn-resume").click(); });
  await page.waitForTimeout(200);
  assert.ok(!(await page.locator("#scr-quiz").isVisible()), "de ronde startte zonder naam");
  const o = await opslag(page);
  assert.equal(o["overhoor:learner"], undefined);
  assert.deepEqual(onderNaam(o), [], "er is iets onder een naam bewaard");
  // met een naam gaat de les wel open, en de vraag is weg
  await page.fill("#learner-name", "Pia");
  await page.click("#btn-learner-save");
  assert.ok(!(await hint.isVisible()), "de vraag om de naam blijft staan");
  await page.locator("#lessons .lesson").first().click();
  await wachtOpScherm(page, "scr-home");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: het open naamveld met de vraag, contrast en overloop in licht en donker", async () => {
  const problemen = [];
  for (const thema of THEMAS) for (const breedte of BREEDTES) {
    const { context, page, fouten } = await open({ thema, breedte });
    await page.locator("#lessons .lesson").first().click();
    await page.evaluate(rondAnimatiesAf);
    const stand = thema + " " + breedte;
    const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
    for (const f of c.fouten) problemen.push(`${stand}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
    for (const f of c.nietMeetbaar) problemen.push(`${stand}: niet meetbaar bij ${f.waar} "${f.tekst}"`);
    const o = await page.evaluate(overloopMeting);
    if (o.overloop) problemen.push(`${stand}: overloop ${o.scrollWidth}px: ${o.boosdoeners.join(", ")}`);
    // tikdoel van Opslaan
    const h = await page.locator("#btn-learner-save").evaluate(b => b.getBoundingClientRect().height);
    if (h < 44) problemen.push(`${stand}: Opslaan is ${h}px hoog`);
    for (const f of fouten) problemen.push(`${stand}: ${f}`);
    await context.close();
  }
  assert.deepEqual(problemen, []);
});
