// Het Beta-label naast Overhoren in de kop van het startscherm. Een klein
// chipje; tikken, Enter of Spatie opent een regel eronder, nog een keer of
// Escape sluit hem. aria-expanded volgt mee, het tikdoel is minstens 44 px
// en de tekst haalt 4,5:1, open en dicht, licht en donker, 360 en 1280 px.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
const UITLEG = "We leren nog. Dingen kunnen veranderen.";
let browser, server;
before(async () => { browser = await startBrowser(); server = await startServer(); });
after(async () => { await browser?.close(); await server?.stop(); });

async function open({ thema = "light", breedte = 360 } = {}) {
  const context = await browser.newContext({ viewport: { width: breedte, height: 780 }, colorScheme: thema, serviceWorkers: "block" });
  const extern = await schermNetwerkAf(context);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  return { context, page, fouten, extern };
}
const knop = page => page.locator("#scr-lessons .brand h1 button.beta");
const staat = page => page.evaluate(() => {
  const b = document.querySelector("#scr-lessons .brand h1 button.beta");
  const u = document.getElementById(b.getAttribute("aria-controls"));
  return { expanded: b.getAttribute("aria-expanded"), zichtbaar: !!u && u.checkVisibility(), tekst: u?.textContent.trim(), focus: document.activeElement === b };
});

test("Beta: een knop in de kop naast Overhoren, dicht bij de start", async () => {
  const { context, page, fouten } = await open();
  const b = knop(page);
  assert.equal(await b.count(), 1, "geen Beta-knop in de h1 van het startscherm");
  assert.equal((await b.textContent()).trim(), "Beta");
  assert.equal(await b.getAttribute("type"), "button");
  assert.deepEqual(await staat(page), { expanded: "false", zichtbaar: false, tekst: UITLEG, focus: false });
  // naast de titel, op dezelfde regel
  const r = await page.evaluate(() => {
    const h = document.querySelector("#scr-lessons .brand h1"), b = h.querySelector(".beta");
    const tekst = document.createRange(); tekst.selectNodeContents(h.firstChild);
    const t = tekst.getBoundingClientRect(), k = b.getBoundingClientRect();
    return { naast: k.left >= t.right, regel: k.top < t.bottom && k.bottom > t.top };
  });
  assert.ok(r.naast && r.regel, "Beta staat niet naast de titel: " + JSON.stringify(r));
  assert.deepEqual(fouten, []);
  await context.close();
});

test("Beta: tikken opent en sluit, aria-expanded volgt mee", async () => {
  const { context, page, fouten } = await open();
  await knop(page).click();
  let s = await staat(page);
  assert.equal(s.expanded, "true"); assert.ok(s.zichtbaar, "uitleg niet zichtbaar na tikken");
  await knop(page).click();
  s = await staat(page);
  assert.equal(s.expanded, "false"); assert.ok(!s.zichtbaar, "uitleg blijft staan na nog een keer tikken");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("Beta: met het toetsenbord, Enter en Spatie wisselen, Escape sluit en houdt de focus op de knop", async () => {
  const { context, page, fouten } = await open();
  await knop(page).focus();
  await page.keyboard.press("Enter");
  assert.equal((await staat(page)).expanded, "true", "Enter opent niet");
  await page.keyboard.press("Space");
  assert.equal((await staat(page)).expanded, "false", "Spatie sluit niet");
  await page.keyboard.press("Space");
  assert.equal((await staat(page)).expanded, "true", "Spatie opent niet");
  await page.keyboard.press("Escape");
  const s = await staat(page);
  assert.equal(s.expanded, "false", "Escape sluit niet"); assert.ok(!s.zichtbaar); assert.ok(s.focus, "focus niet op de knop na Escape");
  // Escape als hij al dicht is doet niets
  await page.keyboard.press("Escape");
  assert.equal((await staat(page)).expanded, "false");
  // na toetsen is de focus zichtbaar: een echte rand om de knop
  const zichtbaar = await page.evaluate(() => { const e = document.activeElement; const c = getComputedStyle(e); return e.classList.contains("beta") && e.matches(":focus-visible") && c.outlineStyle !== "none" && parseFloat(c.outlineWidth) >= 2; });
  assert.ok(zichtbaar, "geen zichtbare focusrand op de Beta-knop bij Tab");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("Beta: tikdoel minstens 44 bij 44 px, ook al is het vlak klein", async () => {
  for (const breedte of BREEDTES) {
    const { context, page } = await open({ breedte });
    const r = await page.evaluate(() => {
      const b = document.querySelector("#scr-lessons .brand h1 .beta");
      const k = b.getBoundingClientRect();
      const mx = k.left + k.width / 2, my = k.top + k.height / 2;
      // raakt een punt 21,5 px van het midden de knop nog?
      const raak = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && b.contains(e); };
      return { hoog: k.height, raak: [raak(mx, my - 21.5), raak(mx, my + 21.5), raak(mx - 21.5, my), raak(mx + 21.5, my)] };
    });
    assert.deepEqual(r.raak, [true, true, true, true], `${breedte}px: tikdoel kleiner dan 44 px (${JSON.stringify(r)})`);
    await context.close();
  }
});

for (const thema of THEMAS) for (const breedte of BREEDTES) {
  test(`Beta, ${thema}, ${breedte}px: dicht en open contrast 4,5:1 en geen overloop`, async () => {
    const { context, page, fouten, extern } = await open({ thema, breedte });
    const problemen = [];
    for (const stand of ["dicht", "open"]) {
      if (stand === "open") await knop(page).click();
      await page.mouse.move(0, 0);
      await page.evaluate(rondAnimatiesAf);
      const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
      for (const f of c.fouten) problemen.push(`${stand}: contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}"`);
      for (const f of c.nietMeetbaar) problemen.push(`${stand}: niet meetbaar bij ${f.waar} "${f.tekst}"`);
      const o = await page.evaluate(overloopMeting);
      if (o.overloop) problemen.push(`${stand}: overloop ${o.scrollWidth}px: ${o.boosdoeners.join(", ")}`);
      // het chipje zelf moet mee gemeten zijn
      const gemeten = await page.evaluate(() => { const v = document.querySelector(".beta .beta-chip"); return !!v && v.checkVisibility(); });
      if (!gemeten) problemen.push(`${stand}: chip niet zichtbaar`);
    }
    problemen.push(...fouten);
    if (extern.length) problemen.push("verzoeken naar buiten: " + extern.join(", "));
    await context.close();
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });
}
