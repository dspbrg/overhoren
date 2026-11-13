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
const BEVESTIGD = "overhoor:naam-bevestigd";
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
    [BEVESTIGD]: "true", ["overhoor:progress:pia:" + lid]: voortgang
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

// ---------- ronde 2 ----------
const LETTERS = "Gebruik letters of cijfers in je naam.";
const EERST = "Typ eerst je naam.";
async function eersteLes(naam = true) {
  const { context, page } = await open({ naam });
  const id = await page.evaluate(() => document.querySelector("#lessons .lesson").dataset.id);
  await context.close();
  return id;
}
const VOORTGANG = JSON.stringify({ items: { 0: { box: 3, lapses: 0, seen: 2, due: 0, partWrong: {}, dirWrong: {} } }, sessions: [{ at: 1, n: 1, firstTry: 1 }], updated: 5 });

test("naam: zonder gewone letters of cijfers geweigerd, met melding en zonder sync", async () => {
  for (const [naam, melding] of [["???", LETTERS], ["😺", LETTERS], ["Мария", LETTERS], ["李", LETTERS], ["  ", EERST]]) {
    const { context, page, fouten, extern } = await open({ sync: true });
    await page.fill("#learner-name", naam);
    await page.click("#btn-learner-save");
    const v = await naamVeld(page);
    assert.ok(v.form, `[${naam}] naamveld ging dicht`);
    assert.equal(v.focus, "learner-name", `[${naam}] focus niet in het naamveld`);
    assert.ok(await page.locator("#learner-hint").isVisible(), `[${naam}] geen melding`);
    assert.equal((await page.locator("#learner-hint").textContent()).trim(), melding, `[${naam}] verkeerde melding`);
    assert.equal(await page.locator("#learner-hint").getAttribute("role"), "status", "melding zonder role=status");
    await page.press("#learner-name", "Enter");
    await page.locator("#lessons .lesson").first().click();
    await page.waitForTimeout(2300);
    assert.ok(!(await page.locator("#scr-home").isVisible()), `[${naam}] les ging open`);
    assert.deepEqual(syncVerzoeken(extern), [], `[${naam}] sync`);
    const o = await opslag(page);
    assert.equal(o["overhoor:learner"], undefined, `[${naam}] naam opgeslagen`);
    assert.deepEqual(onderNaam(o), [], `[${naam}] iets onder een naam bewaard`);
    assert.ok(!Object.keys(o).some(k => /leerling/.test(k)), `[${naam}] sleutel onder leerling`);
    assert.deepEqual(fouten, [], naam);
    await context.close();
  }
});

test("naam: letters met accenten gaan gewoon mee (Pía, Zoë)", async () => {
  for (const [naam, slug] of [["Pía", "pia"], ["Zoë", "zoe"]]) {
    const { context, page, fouten, extern } = await open({ sync: true });
    await page.fill("#learner-name", naam);
    await page.click("#btn-learner-save");
    await page.locator("#learner-view").waitFor({ state: "visible" });
    assert.equal(await page.locator("#learner-label").textContent(), naam);
    for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
    assert.ok(syncVerzoeken(extern).length && syncVerzoeken(extern).every(u => u.endsWith("/sync/" + slug)), `[${naam}] sync: ` + syncVerzoeken(extern).join(", "));
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("naam: een opgeslagen naam zonder letters telt als geen naam", async () => {
  const { context, page, fouten, extern } = await open({ sync: true, zaai: { "overhoor:learner": JSON.stringify("???") } });
  await page.waitForTimeout(800);
  assert.ok((await naamVeld(page)).form, "naamveld staat niet open");
  assert.deepEqual(syncVerzoeken(extern), [], "sync met een naam zonder letters");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: Pia-toestel zonder bevestiging ziet een keer de vraag, en synchroniseert niet", async () => {
  const lid = await eersteLes();
  const { context, page, fouten, extern } = await open({ sync: true, zaai: {
    "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia"]), ["overhoor:progress:pia:" + lid]: VOORTGANG } });
  const vraag = page.locator("#naam-vraag");
  await vraag.waitFor({ state: "visible", timeout: 2000 });
  assert.equal((await vraag.locator("p").textContent()).trim(), "Ben jij Pia?");
  assert.equal((await page.locator("#btn-naam-ja").innerText()).trim(), "Ja, ik ben Pia");
  assert.equal(await page.locator("#btn-naam-ja").evaluate(b => b.children.length), 0, "losse delen in de knop geven een te brede spatie");
  assert.equal((await page.locator("#btn-naam-nee").textContent()).trim(), "Nee, ik ben iemand anders");
  // starten mag wel
  await page.locator("#lessons .lesson").first().click();
  await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start");
  await wachtOpScherm(page, "scr-quiz");
  await page.waitForTimeout(2500);
  assert.deepEqual(syncVerzoeken(extern), [], "sync voor bevestiging");
  assert.equal(await page.evaluate(k => localStorage.getItem(k), BEVESTIGD), null);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: Ja, ik ben Pia houdt alles en zet sync aan", async () => {
  const lid = await eersteLes();
  const { context, page, fouten, extern } = await open({ sync: true, zaai: {
    "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia"]), ["overhoor:progress:pia:" + lid]: VOORTGANG } });
  await page.locator("#naam-vraag").waitFor({ state: "visible", timeout: 2000 });
  assert.deepEqual(syncVerzoeken(extern), []);
  await page.click("#btn-naam-ja");
  assert.ok(!(await page.locator("#naam-vraag").isVisible()), "vraag blijft staan");
  assert.equal(await page.locator("#learner-label").textContent(), "Pia");
  for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
  assert.ok(syncVerzoeken(extern).length && syncVerzoeken(extern).every(u => u.endsWith("/sync/pia")), "sync: " + syncVerzoeken(extern).join(", "));
  const o = await opslag(page);
  assert.equal(o[BEVESTIGD], "true");
  assert.equal(o["overhoor:learner"], JSON.stringify("Pia"));
  assert.equal(o["overhoor:progress:pia:" + lid], VOORTGANG);
  await page.reload(); await wachtOpScherm(page, "scr-lessons"); await page.waitForTimeout(300);
  assert.ok(!(await page.locator("#naam-vraag").isVisible()), "vraag na herladen weer");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: Nee vraagt een naam, de voortgang van Pia blijft staan maar gaat niet mee", async () => {
  const lid = await eersteLes();
  const { context, page, fouten, extern } = await open({ sync: true, zaai: {
    "overhoor:learner": JSON.stringify("Pia"), "overhoor:learners": JSON.stringify(["Pia"]), ["overhoor:progress:pia:" + lid]: VOORTGANG } });
  await page.locator("#naam-vraag").waitFor({ state: "visible", timeout: 2000 });
  await page.click("#btn-naam-nee");
  const v = await naamVeld(page);
  assert.ok(v.form, "naamveld niet open"); assert.equal(v.waarde, ""); assert.equal(v.focus, "learner-name");
  assert.ok(!(await page.locator("#naam-vraag").isVisible()), "vraag blijft staan");
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:learner")), null, "Pia blijft de oefenaar");
  await page.locator("#lessons .lesson").first().click();
  assert.ok(!(await page.locator("#scr-home").isVisible()), "les opent zonder naam");
  await page.fill("#learner-name", "Noor"); await page.click("#btn-learner-save");
  await page.locator("#learner-view").waitFor({ state: "visible" });
  for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
  assert.ok(syncVerzoeken(extern).length && syncVerzoeken(extern).every(u => u.endsWith("/sync/noor")), "sync: " + syncVerzoeken(extern).join(", "));
  const o = await opslag(page);
  assert.equal(o["overhoor:progress:pia:" + lid], VOORTGANG, "voortgang van Pia is weg of veranderd");
  assert.equal(o["overhoor:progress:noor:" + lid], undefined, "voortgang van Pia is meegegaan");
  await page.reload(); await wachtOpScherm(page, "scr-lessons"); await page.waitForTimeout(300);
  assert.ok(!(await page.locator("#naam-vraag").isVisible()));
  assert.equal(await page.locator("#learner-label").textContent(), "Noor");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: een andere opgeslagen naam krijgt geen vraag; zelf Pia typen ook niet", async () => {
  {
    const { context, page, fouten, extern } = await open({ sync: true, zaai: { "overhoor:learner": JSON.stringify("Noor") } });
    for (let i = 0; i < 40 && !syncVerzoeken(extern).length; i++) await page.waitForTimeout(50);
    assert.ok(!(await page.locator("#naam-vraag").isVisible()), "vraag bij Noor");
    assert.ok(syncVerzoeken(extern).every(u => u.endsWith("/sync/noor")) && syncVerzoeken(extern).length);
    assert.deepEqual(fouten, []);
    await context.close();
  }
  {
    const { context, page, fouten } = await open();
    await page.fill("#learner-name", "Pia"); await page.click("#btn-learner-save");
    await page.reload(); await wachtOpScherm(page, "scr-lessons"); await page.waitForTimeout(300);
    assert.ok(!(await page.locator("#naam-vraag").isVisible()), "vraag na zelf Pia typen");
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("naam: + Nieuwe lijst zonder naam vraagt eerst de naam", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-import");
  assert.ok(await page.locator("#scr-lessons").isVisible(), "naar het importscherm zonder naam");
  assert.equal((await page.locator("#learner-hint").textContent()).trim(), EERST);
  assert.equal(await page.evaluate(() => document.activeElement.id), "learner-name");
  // met naam: Typ zelf, drie regels, Opslaan, Start
  await page.fill("#learner-name", "Noor"); await page.click("#btn-learner-save");
  await page.click("#btn-import"); await wachtOpScherm(page, "scr-import");
  await page.click("#btn-type-start");
  await page.fill("#imp-text", "le chien | de hond\nle chat | de kat\nla maison | het huis");
  await page.click("#btn-import-save"); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: Start op een les zonder naam toont de naamvraag op het startscherm", async () => {
  // het oude pad: Typ zelf zonder naam en dan Start. Het importscherm kan
  // niet meer zonder naam; hier zetten we het scherm daarom zelf open.
  const { context, page, fouten } = await open();
  await page.evaluate(() => { document.querySelectorAll(".screen").forEach(s => { s.hidden = s.id !== "scr-import"; }); });
  await page.click("#btn-type-start");
  await page.fill("#imp-text", "le chien | de hond\nle chat | de kat\nla maison | het huis");
  await page.click("#btn-import-save"); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start");
  await wachtOpScherm(page, "scr-lessons");
  assert.ok(await page.locator("#learner-hint").isVisible(), "geen naamvraag");
  assert.ok((await naamVeld(page)).form, "naamveld niet open");
  assert.equal(await page.evaluate(() => document.activeElement.id), "learner-name");
  assert.ok(!(await page.locator("#scr-quiz").isVisible()));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: welkom zonder naam zegt geen Hoi, daarna focus in het naamveld", async () => {
  const context = await browser.newContext({ welkom: true, naam: false, viewport: { width: 360, height: 780 }, serviceWorkers: "block" });
  await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  const w = page.locator("body > .welkom");
  await w.waitFor({ state: "attached", timeout: 1500 });
  assert.doesNotMatch(await w.innerText(), /Hoi/, "welkom zegt Hoi zonder naam");
  await w.waitFor({ state: "detached", timeout: 8000 });
  assert.equal(await page.evaluate(() => document.activeElement && document.activeElement.id), "learner-name", "focus niet in het naamveld na het welkom");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: oude voortgang zonder oefenaar wordt zonder naam niet omgezet", async () => {
  const lid = await eersteLes();
  const { context, page, fouten } = await open({ zaai: { ["overhoor:progress:" + lid]: VOORTGANG, "overhoor:current": JSON.stringify(lid) } });
  await page.waitForTimeout(300);
  const o = await opslag(page);
  assert.equal(o["overhoor:progress:" + lid], VOORTGANG, "oude voortgang is weg");
  assert.deepEqual(Object.keys(o).filter(k => k.startsWith("overhoor:progress:") && k !== "overhoor:progress:" + lid), [], "omgezet zonder naam");
  // met een naam gaat de omzetting zoals altijd
  await page.fill("#learner-name", "Noor"); await page.click("#btn-learner-save");
  const n = await opslag(page);
  assert.equal(n["overhoor:progress:noor:" + lid], VOORTGANG, "met naam niet omgezet");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("naam: de vraag Ben jij Pia, contrast, overloop en tikdoelen in licht en donker", async () => {
  const problemen = [];
  for (const thema of THEMAS) for (const breedte of BREEDTES) {
    const { context, page, fouten } = await open({ thema, breedte, zaai: { "overhoor:learner": JSON.stringify("Pia") } });
    const stand = thema + " " + breedte;
    if (!(await page.locator("#naam-vraag").isVisible())) { problemen.push(`${stand}: vraag niet zichtbaar`); await context.close(); continue; }
    await page.evaluate(rondAnimatiesAf);
    const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
    for (const f of c.fouten) problemen.push(`${stand}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
    for (const f of c.nietMeetbaar) problemen.push(`${stand}: niet meetbaar bij ${f.waar} "${f.tekst}"`);
    const o = await page.evaluate(overloopMeting);
    if (o.overloop) problemen.push(`${stand}: overloop ${o.scrollWidth}px: ${o.boosdoeners.join(", ")}`);
    for (const id of ["btn-naam-ja", "btn-naam-nee"]) {
      const h = await page.locator("#" + id).evaluate(b => b.getBoundingClientRect().height);
      if (h < 44) problemen.push(`${stand}: ${id} is ${h}px hoog`);
    }
    await page.screenshot({ path: process.env.NAAM_SCHERM ? `${process.env.NAAM_SCHERM}/vraag-${thema}-${breedte}.png` : undefined });
    for (const f of fouten) problemen.push(`${stand}: ${f}`);
    await context.close();
  }
  assert.deepEqual(problemen, []);
});
