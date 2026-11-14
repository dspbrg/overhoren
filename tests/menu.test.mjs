// Het menu rechtsboven op het startscherm. Een icoonknop van minstens
// 44 px opent een kaart met Rapport, Over Overhoren, het thema en de
// versie; de footer onder de lijsten is weg. Open wordt de knop een kruis,
// dimt een laag de pagina en staat de focus op het eerste item. De knop,
// Escape en een tik buiten het menu sluiten het en zetten de focus terug
// op de knop; Tab uit het menu sluit het stil. Het thema werkt vanuit het
// menu en blijft bewaard. Over Overhoren toont de wetenschap, de schakelaar
// voor klaslijsten en het colofon met een link naar dspbrg.com, zonder
// "Pia", zonder achternaam en zonder mailadres.
// Contrast en overloop met het menu open, licht en donker, 360 en 1280 px.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { startBrowser, startServer, schermNetwerkAf, volgFouten, THEMAS, BREEDTES } from "./lib/omgeving.mjs";
import { contrastMeting, overloopMeting, rondAnimatiesAf } from "./lib/meten.mjs";
import { wachtOpScherm, openMenu } from "./lib/schermen.mjs";

const MIN_CONTRAST = Number(process.env.MIN_CONTRAST || 4.5);
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

// alles wat open of dicht laat zien
const staat = page => page.evaluate(() => {
  const k = document.getElementById("btn-menu");
  const m = document.getElementById(k.getAttribute("aria-controls"));
  const s = document.querySelector(".menu-scrim");
  return {
    expanded: k.getAttribute("aria-expanded"),
    menu: !!m && m.checkVisibility(),
    dim: !!s && s.checkVisibility(),
    kruis: k.querySelector("svg path")?.getAttribute("d") === UI.ICONS.close.match(/d="([^"]+)"/)[1],
    focus: document.activeElement?.id || document.activeElement?.tagName
  };
});
const DICHT_OP_KNOP = { expanded: "false", menu: false, dim: false, kruis: false, focus: "btn-menu" };

test("menu: knop rechtsboven in de kop, dicht bij de start, en geen footer meer", async () => {
  const { context, page, fouten } = await open();
  const k = page.locator("#btn-menu");
  assert.equal(await k.count(), 1, "geen menuknop");
  assert.equal(await k.getAttribute("type"), "button");
  assert.equal(await k.getAttribute("aria-label"), "Menu");
  assert.equal(await k.getAttribute("aria-expanded"), "false");
  assert.equal(await k.getAttribute("aria-controls"), "menu");
  assert.equal(await page.evaluate(() => document.getElementById("menu")?.tagName), "NAV");
  const s = await staat(page);
  assert.equal(s.menu, false, "menu staat open bij de start");
  assert.equal(s.dim, false, "de pagina is gedimd bij de start");
  // rechtsboven: in de kop naast de titel, rechts in de kolom, minstens 44 px
  const r = await page.evaluate(() => {
    const k = document.getElementById("btn-menu").getBoundingClientRect();
    const h = document.getElementById("app-titel").getBoundingClientRect();
    const app = document.querySelector("#scr-lessons > .app").getBoundingClientRect();
    return { b: k.width, h: k.height, rechts: Math.abs(k.right - app.right) < 2, naast: k.left > h.right, regel: k.top < h.bottom && k.bottom > h.top };
  });
  assert.ok(r.b >= 44 && r.h >= 44, "menuknop kleiner dan 44 px: " + JSON.stringify(r));
  assert.ok(r.rechts && r.naast && r.regel, "menuknop staat niet rechts naast de titel: " + JSON.stringify(r));
  // de footer is weg; Rapport, Over Overhoren en het thema zitten in het menu
  assert.equal(await page.locator(".start-foot, #scr-lessons footer").count(), 0, "de footer staat er nog");
  const inMenu = await page.evaluate(() => ["btn-report", "btn-info", "theme-seg"].map(id => !!document.getElementById(id)?.closest("#menu")));
  assert.deepEqual(inMenu, [true, true, true], "Rapport, Over Overhoren of het thema staat niet in het menu");
  const items = await page.locator("#menu .menu-item").evaluateAll(bs => bs.map(b => b.textContent.trim()));
  assert.deepEqual(items, ["Rapport", "Over Overhoren"]);
  // klasvraag en "Op een ander toestel verder" blijven op het startscherm
  assert.equal(await page.locator("#scr-lessons .start-kop #btn-ander-toestel").count(), 1);
  assert.equal(await page.locator("#scr-lessons .start-kop #klas-vraag").count(), 1);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: de knop opent en sluit, focus naar het eerste item en terug naar de knop", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-menu");
  assert.deepEqual(await staat(page), { expanded: "true", menu: true, dim: true, kruis: true, focus: "btn-report" });
  await page.click("#btn-menu");
  assert.deepEqual(await staat(page), DICHT_OP_KNOP);
  // met het toetsenbord: Enter opent, Spatie op het kruis sluit
  await page.locator("#btn-menu").focus();
  await page.keyboard.press("Enter");
  assert.equal((await staat(page)).focus, "btn-report", "Enter zet de focus niet op het eerste item");
  await page.locator("#btn-menu").focus();
  await page.keyboard.press("Space");
  assert.deepEqual(await staat(page), DICHT_OP_KNOP);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: Escape sluit en zet de focus terug op de knop", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-menu");
  // ook met de focus dieper in het menu, op het thema
  await page.locator("#theme-seg button", { hasText: "Licht" }).focus();
  await page.keyboard.press("Escape");
  assert.deepEqual(await staat(page), DICHT_OP_KNOP);
  // Escape bij een dicht menu doet niets met het menu
  await page.keyboard.press("Escape");
  assert.equal((await staat(page)).expanded, "false");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: tikken buiten het menu sluit het, zonder door te tikken naar wat eronder ligt", async () => {
  for (const breedte of BREEDTES) {
    const { context, page, fouten } = await open({ breedte });
    await page.click("#btn-menu");
    // een tik op een lijst die achter de dimlaag ligt, naast of onder het menu
    const punt = await page.evaluate(() => {
      const m = document.getElementById("menu").getBoundingClientRect();
      for (const l of document.querySelectorAll(".lesson")) {
        const r = l.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const inMenu = x >= m.left && x <= m.right && y >= m.top && y <= m.bottom;
        if (!inMenu && y > 0 && y < innerHeight) return { x, y };
      }
      return null;
    });
    assert.ok(punt, "geen lijst in beeld naast het menu, de test bewijst dan weinig");
    const { x, y } = punt;
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [x, y]), "menu-scrim", "de dimlaag ligt niet over de lijst");
    await page.mouse.click(x, y);
    assert.deepEqual(await staat(page), DICHT_OP_KNOP, "na een tik buiten het menu (" + breedte + " px)");
    assert.ok(await page.locator("#scr-lessons").isVisible(), "de tik ging door naar de les eronder");
    // een tik in het menu zelf, op de versie, laat het open
    await page.click("#btn-menu");
    await page.locator("#menu .menu-versie").click();
    assert.equal((await staat(page)).menu, true, "een tik in het menu sluit het");
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("menu: Tab uit het menu sluit het", async () => {
  const { context, page, fouten } = await open();
  await page.click("#btn-menu");
  await page.locator("#theme-seg button", { hasText: "Donker" }).focus();
  await page.keyboard.press("Tab");
  const s = await staat(page);
  assert.equal(s.expanded, "false"); assert.equal(s.menu, false); assert.equal(s.dim, false);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: het thema kiezen werkt vanuit het menu en blijft bewaard", async () => {
  const { context, page, fouten } = await open({ thema: "light" });
  await openMenu(page);
  const groep = await page.evaluate(() => {
    const g = document.getElementById("theme-seg").closest("[role=group]");
    return document.getElementById(g.getAttribute("aria-labelledby"))?.textContent.trim();
  });
  assert.equal(groep, "Thema");
  const ingedrukt = () => page.locator("#theme-seg button[aria-pressed=true]").evaluateAll(bs => bs.map(b => b.textContent.trim()));
  assert.deepEqual(await ingedrukt(), ["Systeem"]);
  await page.locator("#theme-seg button", { hasText: "Donker" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  assert.equal(await page.evaluate(() => localStorage.getItem("overhoor:thema")), '"dark"');
  assert.deepEqual(await ingedrukt(), ["Donker"]);
  assert.equal((await staat(page)).menu, true, "het menu sluit na een themakeuze");
  await page.reload(); await wachtOpScherm(page, "scr-lessons");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
  await openMenu(page);
  assert.deepEqual(await ingedrukt(), ["Donker"]);
  await page.locator("#theme-seg button", { hasText: "Systeem" }).click();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), undefined);
  assert.ok([null, "null"].includes(await page.evaluate(() => localStorage.getItem("overhoor:thema"))), "Systeem bewaart toch een thema");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: de versie staat onderaan, de eerste zeven tekens van ?v=", async () => {
  const { context, page, fouten } = await open();
  await openMenu(page);
  const v = await page.evaluate(() => ({
    regel: document.querySelector("#menu .menu-versie")?.textContent.trim(),
    v: new URL(document.querySelector('script[src^="ui.js"]').src).searchParams.get("v"),
    laatste: document.getElementById("menu").lastElementChild?.classList.contains("menu-versie")
  }));
  assert.equal(v.regel, "Versie " + v.v.slice(0, 7));
  assert.ok(v.laatste, "de versie staat niet onderaan");
  assert.ok(await page.locator("#menu .menu-versie").isVisible(), "versie niet zichtbaar");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: Rapport opent het rapport en sluit het menu", async () => {
  const { context, page, fouten } = await open();
  await openMenu(page);
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  assert.equal(await page.locator("#btn-menu").getAttribute("aria-expanded"), "false");
  assert.equal(await page.locator(".menu-scrim").isVisible(), false, "de dimlaag blijft staan");
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
  assert.equal((await staat(page)).menu, false);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("Over Overhoren: opent uit het menu, met de wetenschap, klaslijsten en het colofon, met een link naar dspbrg.com, zonder Pia, achternaam of mailadres", async () => {
  const { context, page, fouten } = await open();
  await openMenu(page);
  await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
  assert.equal(await page.locator("#btn-menu").getAttribute("aria-expanded"), "false");
  const r = await page.evaluate(() => {
    const s = document.getElementById("scr-info");
    return {
      h1: s.querySelector("h1")?.textContent.trim(),
      h2: [...s.querySelectorAll("h2")].map(h => h.textContent.trim()),
      tekst: s.innerText, html: s.outerHTML,
      klas: !!s.querySelector("#klas-seg"),
      colofon: document.getElementById("colofon")?.innerText || "",
      link: (a => a && { href: a.getAttribute("href"), rel: a.getAttribute("rel"), tekst: a.textContent.trim(), cls: a.className, maker: a.closest("p")?.textContent.trim() })(document.querySelector('#colofon a[href="https://dspbrg.com"]')),
      katten: Celebrate.KATTEN.map(k => k.naam)
    };
  });
  assert.equal(r.h1, "Over Overhoren");
  assert.deepEqual(r.h2, ["De wetenschap", "Klaslijsten", "Colofon"]);
  assert.ok(r.klas, "de schakelaar voor klaslijsten ontbreekt");
  assert.match(r.tekst, /Ophalen werkt beter dan herlezen/);
  assert.ok(r.link, "geen link naar https://dspbrg.com in het colofon");
  assert.equal(r.link.maker, "Gemaakt door dspbrg.com");
  assert.equal(r.link.tekst, "dspbrg.com");
  assert.equal(r.link.rel, "noopener");
  assert.equal(r.link.cls, "link", "de link heeft niet de linkstijl van de app");
  assert.match(r.colofon, /Chakra Petch/); assert.match(r.colofon, /Inter/);
  for (const naam of r.katten) assert.ok(r.colofon.includes(naam), "kat " + naam + " ontbreekt in het colofon");
  assert.match(r.colofon, /met AI gemaakt/);
  assert.doesNotMatch(r.html, /Pia/i, "Over Overhoren noemt Pia");
  assert.doesNotMatch(r.html, /Spangenberg/i, "Over Overhoren noemt de achternaam");
  assert.doesNotMatch(r.html, /@/, "Over Overhoren bevat een @");
  assert.doesNotMatch(r.html, /mailto:/i);
  // terug naar het startscherm
  await page.click("#btn-info-back"); await wachtOpScherm(page, "scr-lessons");
  assert.deepEqual(fouten, []);
  await context.close();
});

test("menu: na Rapport of Over Overhoren staat de focus op Terug, en na Terug weer op de menuknop", async () => {
  const { context, page, fouten } = await open();
  const focus = () => page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  for (const [item, scherm, terug] of [["#btn-report", "scr-report", "btn-report-back"], ["#btn-info", "scr-info", "btn-info-back"]]) {
    // met de muis
    await openMenu(page);
    await page.click(item); await wachtOpScherm(page, scherm);
    assert.equal(await focus(), terug, item + ": de focus staat niet op Terug");
    await page.click("#" + terug); await wachtOpScherm(page, "scr-lessons");
    assert.equal(await focus(), "btn-menu", item + ": na Terug staat de focus niet op de menuknop");
    // met het toetsenbord: Enter op het item, Enter op Terug
    await page.locator("#btn-menu").focus(); await page.keyboard.press("Enter");
    await page.locator(item).focus(); await page.keyboard.press("Enter"); await wachtOpScherm(page, scherm);
    assert.equal(await focus(), terug, item + " met Enter: de focus staat niet op Terug");
    await page.keyboard.press("Enter"); await wachtOpScherm(page, "scr-lessons");
    assert.equal(await focus(), "btn-menu", item + " met Enter: na Terug staat de focus niet op de menuknop");
  }
  assert.deepEqual(fouten, []);
  await context.close();
});

for (const thema of THEMAS) for (const breedte of BREEDTES) {
  test(`menu open en Over Overhoren: contrast, overloop en tikdoelen, ${thema} ${breedte}px`, async t => {
    const { context, page, fouten, extern } = await open({ thema, breedte });
    const problemen = [];
    const meet = async naam => {
      await page.evaluate(rondAnimatiesAf);
      const o = await page.evaluate(overloopMeting);
      if (o.overloop) problemen.push(`[${naam}] horizontale overloop: ${o.scrollWidth}px bij ${o.breedte}px. ${o.boosdoeners.join(", ")}`);
      const c = await page.evaluate(contrastMeting, { min: MIN_CONTRAST });
      if (c.gemeten === 0) problemen.push(`[${naam}] geen tekst gemeten`);
      for (const f of c.fouten) problemen.push(`[${naam}] contrast ${f.ratio}:1 bij ${f.waar} "${f.tekst}" (${f.kleur} op ${f.achtergrond})`);
      for (const f of c.nietMeetbaar) problemen.push(`[${naam}] contrast niet meetbaar bij ${f.waar} "${f.tekst}"`);
      for (const f of c.vrijgesteld) t.diagnostic(`[${naam}] uitgeschakeld: ${f.waar} "${f.tekst}"`);
    };
    await meet("menu dicht");
    await openMenu(page);
    await meet("menu open");
    // het menu past in beeld en elk item is minstens 44 px hoog
    const m = await page.evaluate(() => {
      const r = document.getElementById("menu").getBoundingClientRect();
      const items = [...document.querySelectorAll("#menu .menu-item, #theme-seg button")].map(b => b.getBoundingClientRect());
      return { links: r.left, rechts: r.right, breed: innerWidth, klein: items.filter(i => i.height < 44 || i.width < 44).length };
    });
    assert.ok(m.links >= 0 && m.rechts <= m.breed, "menu steekt buiten beeld: " + JSON.stringify(m));
    assert.equal(m.klein, 0, "een tikdoel in het menu is kleiner dan 44 px");
    await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
    await meet("over overhoren");
    await context.close();
    assert.deepEqual(fouten, []);
    assert.deepEqual(extern.filter(u => !/workers\.dev\//.test(u)), []);
    if (problemen.length) assert.fail("\n  " + problemen.join("\n  "));
  });
}
