// Loopt alle schermen van index.html af door te klikken, zoals een
// gebruiker dat doet. Bij elk scherm roept hij bijScherm(naam) aan.

export async function wachtOpScherm(page, id) {
  await page.locator("#" + id).waitFor({ state: "visible", timeout: 5000 });
}

// Beantwoordt de huidige vraag. goed=true: met het officiele antwoord uit
// window.WORDLISTS. goed=false: met onzin.
export async function beantwoord(page, goed) {
  const antwoord = await page.evaluate(goed => {
    const prompt = document.getElementById("q-prompt").textContent.trim();
    const label = document.getElementById("q-input-label").textContent.trim();
    let item = null;
    for (const l of window.WORDLISTS) {
      for (const it of l.items) {
        if (it.word === prompt && label.startsWith(l.to || "Definitie")) { item = { a: String(it.def).split(/\s*[\/,;]\s*|\s+of\s+/)[0].trim(), cls: it.cls }; break; }
        if (it.def === prompt) { item = { a: it.word, cls: it.cls }; break; }
      }
      if (item) break;
    }
    if (!goed) return { a: "qqq zzz", cls: null };
    return item;
  }, goed);
  if (!antwoord) throw new Error("Kon het antwoord op de vraag niet vinden in WORDLISTS");
  const keuzes = page.locator("#q-classes .choice");
  if (await keuzes.count()) {
    const doel = antwoord.cls ? keuzes.filter({ hasText: antwoord.cls }).first() : keuzes.first();
    await (await doel.count() ? doel : keuzes.first()).click();
  }
  await page.fill("#q-input", antwoord.a);
  await page.click("#btn-check");
  // een twijfelgeval: met J beslissen
  if (await page.locator("#fb-assess").isVisible()) await page.click(goed ? "#btn-assess-yes" : "#btn-assess-no");
  await page.locator("#btn-next").waitFor({ state: "visible" });
}

export async function loopSchermen(page, basis, bijScherm) {
  await page.goto(basis + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  await bijScherm("lessenoverzicht");

  await page.click("#btn-info"); await wachtOpScherm(page, "scr-info");
  await bijScherm("hoe werkt het");
  await page.click("#btn-info-back"); await wachtOpScherm(page, "scr-lessons");

  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await bijScherm("rapport (leeg)");
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");

  await page.click("#btn-import"); await wachtOpScherm(page, "scr-import");
  await bijScherm("nieuwe lijst: keuze");
  await page.click("#btn-type-start"); await page.locator("#import-form").waitFor({ state: "visible" });
  await bijScherm("nieuwe lijst: formulier");
  await page.click("#btn-import-form-back");
  await page.click("#btn-photo-start"); await wachtOpScherm(page, "scr-photo");
  await bijScherm("foto");
  await page.click("#btn-photo-back"); await wachtOpScherm(page, "scr-import");
  await page.click("#btn-import-back"); await wachtOpScherm(page, "scr-lessons");

  // Engelse lijst (met woordsoorten)
  await page.locator(".lesson").first().click(); await wachtOpScherm(page, "scr-home");
  await bijScherm("les (home)");
  await page.click("#btn-study"); await wachtOpScherm(page, "scr-study");
  await bijScherm("eerst lezen");
  await page.click("#btn-study-back"); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  await bijScherm("voortgang (leeg)");
  await page.click("#btn-progress-back"); await wachtOpScherm(page, "scr-home");

  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  await bijScherm("overhoren: vraag");
  const keuzes = page.locator("#q-classes .choice");
  if (await keuzes.count()) {
    await keuzes.first().click();
    await bijScherm("overhoren: woordsoort gekozen");
  } else {
    throw new Error("Eerste lijst heeft geen woordsoortknoppen; scenario klopt niet meer");
  }
  await page.click("#btn-check");   // zonder antwoord: waarschuwing
  await page.locator("#q-hint").waitFor({ state: "visible" });
  await bijScherm("overhoren: waarschuwing leeg antwoord");
  await page.fill("#q-input", "qqq zzz");
  await page.click("#btn-check");
  if (await page.locator("#fb-assess").isVisible()) {
    await bijScherm("overhoren: twijfelgeval");
    await page.click("#btn-assess-no");
  }
  await page.locator("#btn-next").waitFor({ state: "visible" });
  await bijScherm("overhoren: feedback fout");
  await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
  // een fout op een vraag: lastige ronde, de kat in de bijna-stand
  await page.locator("#sum-kat .kat").waitFor({ state: "visible", timeout: 3000 });
  await bijScherm("samenvatting (gestopt, lastige ronde)");
  await page.click("#btn-sum-lessons"); await wachtOpScherm(page, "scr-lessons");

  // Franse lijst: alles goed, tot de samenvatting
  await page.locator(".lesson", { hasText: "Arrêt Apprendre" }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-start"); await wachtOpScherm(page, "scr-quiz");
  let eersteGoed = true;
  for (let i = 0; i < 200; i++) {
    if (await page.locator("#scr-summary").isVisible()) break;
    await beantwoord(page, true);
    if (eersteGoed) { await bijScherm("overhoren: feedback goed"); eersteGoed = false; }
    await page.click("#btn-next");
    await page.waitForFunction(() => !document.getElementById("scr-summary").hidden || document.getElementById("btn-next").hidden);
  }
  await wachtOpScherm(page, "scr-summary");
  // vlekkeloos: de kat van de ronde zegt gedag op de rand van de kaart
  await page.locator("#sum-kat .kat").waitFor({ state: "visible", timeout: 3000 });
  await page.waitForFunction(() => { const i = document.querySelector("#sum-kat .kat"); return i.complete && i.naturalWidth > 0; }, null, { timeout: 5000 });
  await bijScherm("samenvatting (vlekkeloos, de kat zegt gedag)");

  await page.click("#btn-sum-home"); await wachtOpScherm(page, "scr-home");
  await bijScherm("les (home, na een ronde)");
  await page.click("#btn-progress"); await wachtOpScherm(page, "scr-progress");
  await bijScherm("voortgang (met data)");
  await page.click("#btn-progress-back"); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-home-back"); await wachtOpScherm(page, "scr-lessons");
  await bijScherm("lessenoverzicht (na een ronde)");
  await page.click("#btn-report"); await wachtOpScherm(page, "scr-report");
  await bijScherm("rapport (met data)");
  await page.click("#btn-report-back"); await wachtOpScherm(page, "scr-lessons");
}
