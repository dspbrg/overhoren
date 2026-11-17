// Kattenbeelden: in de app staat de kat stil, alleen het welkom beweegt.
//
// Zonder browser: katten.json tegen de bestanden (18 stilstaande beelden
// van 400 x 480, per kat een welkomclip van 480 x 480 met alpha, 36
// beelden, 12 per seconde, 3 s, en zijn eerste beeld stil), de oude
// goed- en bijna-clips in het archief, service worker en allowlist;
// Celebrate.toon zet meteen het beeld van een stand zonder clip of timer,
// spiegelen volgens de regel voor alle zes katten; laadKat laadt alleen de
// stilstaande beelden van de kat van de ronde en nooit een clip; laadWelkom
// en welkomSpeler spelen de welkomclip uit een nieuwe object-URL en ruimen
// hem op, en bij reduced motion alleen het stilstaande eerste beeld.
//
// In de browser (360 px): voor alle zes katten elk moment in een echte
// ronde meteen het stilstaande beeld, zonder verspringen, zonder clip en
// alleen de beelden van die kat; het gedag; en het welkom: de welkomclip
// van de kat in de zeshoek, hij beweegt echt, en na sluiten is alles
// opgeruimd. Bij reduced motion staat het eerste beeld stil in dezelfde
// zeshoek en wordt de clip niet eens gehaald.
//
// Ook in WebKit: PW_BROWSER=webkit node --test tests/kattenclips.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import { REPO, startBrowser, startServer, schermNetwerkAf, volgFouten } from "./lib/omgeving.mjs";
import { beantwoord, wachtOpScherm } from "./lib/schermen.mjs";

const lees = f => readFileSync(join(REPO, f), "utf8");
const MAP = "katten/clips/";
const ALLE = ["strepen", "tuxedo", "lapjes", "sokjes", "stippen", "rodestreep"];
const EIND = ["goed", "bijna"];
const KAT = JSON.parse(lees(MAP + "katten.json"));
const kijkt = (kat, stand) => (stand === "rust" ? KAT.katten[kat].goed.kijkt : KAT.katten[kat][stand].kijkt);
// een clip uit de ronde (de oude goed- en bijna-clips) of het welkom
const RONDECLIP = /katten\/clips\/[a-z]+-(goed|bijna)\.webp$/;

// ---------- WebP lezen ----------
// De chunks van een WebP-bestand: maat, alpha, aantal beelden, duur per
// beeld en hoe vaak hij speelt (0 is altijd).
function webp(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  let maat = null, beelden = 0, lus = null, alpha = false;
  const duur = [];
  for (let o = 12; o + 8 <= buf.length;) {
    const soort = buf.toString("ascii", o, o + 4), n = buf.readUInt32LE(o + 4), d = o + 8;
    if (soort === "VP8X") { maat = [1 + buf.readUIntLE(d + 4, 3), 1 + buf.readUIntLE(d + 7, 3)]; alpha = !!(buf[d] & 0x10); }
    if (soort === "VP8L" && !maat) { const b = buf.readUInt32LE(d + 1); maat = [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; alpha = !!((b >> 28) & 1); }
    if (soort === "VP8 " && !maat) maat = [buf.readUInt16LE(d + 6) & 0x3fff, buf.readUInt16LE(d + 8) & 0x3fff];
    if (soort === "ANIM") lus = buf.readUInt16LE(d + 4);
    if (soort === "ANMF") { beelden++; duur.push(buf.readUIntLE(d + 12, 3)); }
    o = d + n + (n % 2);
  }
  return { maat, beelden: beelden || 1, lus, alpha, duur };
}

test("katten.json klopt met de bestanden: 18 stilstaande beelden, per kat een welkomclip (36 beelden, 12 per seconde, 3 s, alpha, speelt een keer) en zijn eerste beeld stil", () => {
  assert.deepEqual([KAT.breedte, KAT.hoogte], [400, 480]);
  assert.deepEqual(KAT.welkom, { fps: 12, breedte: 480, hoogte: 480 });
  assert.deepEqual(Object.keys(KAT.katten).sort(), [...ALLE].sort());
  const stil = [], welkom = [];
  for (const id of ALLE) {
    const k = KAT.katten[id];
    assert.equal(k.rust, `${id}-rust.webp`);
    stil.push(k.rust);
    for (const m of EIND) {
      assert.deepEqual(Object.keys(k[m]).sort(), ["eind", "kijkt"], `${id} ${m}: er staat nog een clip in katten.json`);
      assert.equal(k[m].eind, `${id}-${m}-eind.webp`);
      assert.ok(["rechts", "voor"].includes(k[m].kijkt), `${id} ${m}: kijkt ${k[m].kijkt}`);
      stil.push(k[m].eind);
    }
    const w = k.welkom;
    assert.deepEqual(w, { anim: `welkom-${id}.webp`, stil: `welkom-${id}-stil.webp`, beelden: 36, duurMs: 3000 }, id + ": welkom in katten.json");
    const clip = webp(readFileSync(join(REPO, MAP, w.anim)));
    assert.deepEqual(clip.maat, [480, 480], w.anim + ": niet 480 x 480");
    assert.equal(clip.alpha, true, w.anim + ": zonder alpha");
    assert.equal(clip.beelden, 36, w.anim + ": " + clip.beelden + " beelden");
    assert.equal(clip.lus, 1, w.anim + ": speelt niet precies een keer (loop-telling " + clip.lus + ")");
    assert.ok(clip.duur.every(d => Math.abs(d - 1000 / KAT.welkom.fps) <= 1), w.anim + ": niet 12 beelden per seconde");
    assert.ok(Math.abs(clip.duur.reduce((a, b) => a + b, 0) - w.duurMs) <= 20, w.anim + ": niet 3 s");
    const eerste = webp(readFileSync(join(REPO, MAP, w.stil)));
    assert.deepEqual(eerste.maat, [480, 480], w.stil + ": niet 480 x 480");
    assert.equal(eerste.beelden, 1, w.stil + " beweegt");
    assert.equal(eerste.alpha, true, w.stil + ": zonder alpha");
    welkom.push(w.anim, w.stil);
  }
  assert.equal(stil.length, 18);
  for (const f of stil) assert.deepEqual(webp(readFileSync(join(REPO, MAP, f))).maat, [KAT.breedte, KAT.hoogte], f + ": niet 400 x 480");
  // niets anders in de map: geen goed- of bijna-clips meer
  assert.deepEqual(readdirSync(join(REPO, MAP)).sort(), [...stil, ...welkom, "katten.json"].sort());
});

test("de oude goed- en bijna-clips staan in het archief; de schil heeft de stilstaande beelden, de welkomclips niet; alles gaat online", () => {
  for (const id of ALLE) for (const m of EIND) {
    assert.ok(!existsSync(join(REPO, MAP, `${id}-${m}.webp`)), `${MAP}${id}-${m}.webp staat er nog`);
    assert.ok(existsSync(join(REPO, "archief/katten-clips-v3", `${id}-${m}.webp`)), `archief/katten-clips-v3/${id}-${m}.webp ontbreekt`);
  }
  const schil = [...lees("sw.js").matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
  const bestanden = readdirSync(join(REPO, MAP)).map(f => MAP + f);
  for (const f of bestanden) {
    const clip = /\/welkom-[a-z]+\.webp$/.test(f);
    assert.equal(schil.includes(f), !clip, clip ? f + " (welkomclip) staat in SCHIL" : f + " niet in SCHIL");
  }
  assert.deepEqual(schil.filter(f => RONDECLIP.test(f)), [], "een oude clip staat nog in SCHIL");
  assert.deepEqual(schil.filter(f => /^katten\//.test(f) && !f.startsWith(MAP)), [], "oude kattenbeelden staan nog in SCHIL");
  // .assetsignore met de regels van git uitgevoerd: wat online gaat en wat niet
  const online = pad => spawnSync("git", ["-c", "core.excludesFile=" + join(REPO, ".assetsignore"), "check-ignore", "--no-index", "-q", pad], { cwd: REPO }).status === 1;
  for (const f of bestanden) assert.ok(online(f), f + " gaat niet online (.assetsignore)");
  for (const f of ["katten/clips/LEESMIJ.md", "katten/clips/.DS_Store", "katten/ander/x.webp", "archief/katten-clips-v3/strepen-goed.webp", "cats/katten.zip"]) {
    assert.ok(!online(f), f + " zou online gaan");
  }
  // nergens in de app een verwijzing naar een goed- of bijna-clip
  for (const f of ["index.html", "celebrate.js", "ui.js", "designsystem.html"]) {
    assert.doesNotMatch(lees(f), /\b(goed|bijna)\.anim\b|\[m\]\.anim\b|\{ lus: true \}|uitlopen\(|Celebrate\.speler\b|\bspeler\(/, f + " speelt nog een clip in de ronde");
  }
});

// ---------- zonder browser ----------
// celebrate.js in een eigen context met een nep-klok, nep-URL's, een
// nep-Image en een fetch die de bestanden uit de repo leest.
function laad({ reduced = false, kapot = [], metImage = true, houd = [] } = {}) {
  const vast = [];   // opgehouden ophalingen: { pad, los }
  let volg = 1;
  const timers = new Map();
  const urls = { gemaakt: [], weg: [] };
  const opgehaald = [], plaatjes = [];
  const ctx = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (f, ms) => { const id = volg++; timers.set(id, { f, ms }); return id; },
    clearTimeout: id => { timers.delete(id); },
    URL: {
      createObjectURL: b => { const u = "blob:test/" + urls.gemaakt.length + "/" + b.pad; urls.gemaakt.push(u); return u; },
      revokeObjectURL: u => { urls.weg.push(u); }
    },
    fetch: async pad => {
      opgehaald.push(pad);
      if (kapot.some(k => pad.includes(k))) throw new TypeError("offline");
      if (houd.some(k => pad.includes(k))) await new Promise(los => vast.push({ pad, los }));
      const buf = readFileSync(join(REPO, pad));
      return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), blob: async () => ({ pad, size: buf.length }) };
    }
  });
  ctx.window = ctx;
  ctx.matchMedia = () => ({ matches: reduced });
  if (metImage) ctx.Image = function () { const o = { decode: async () => {} }; Object.defineProperty(o, "src", { set: v => plaatjes.push(v) }); return o; };
  vm.runInContext(lees("celebrate.js"), ctx);
  // alle timers die er nu staan laten aflopen
  const tik = () => { for (const [id, t] of [...timers]) { timers.delete(id); t.f(); } };
  const laatLos = deel => { for (const v of vast.filter(x => x.pad.includes(deel))) v.los(); };
  return { C: ctx.Celebrate, urls, opgehaald, plaatjes, timers, tik, laatLos };
}
const nogEven = () => new Promise(r => setImmediate(r));
// een nep-<img> die bijhoudt welk beeld er stond
function nepImg() {
  const klassen = new Set(), attr = {}, log = [];
  let src = "";
  return {
    log, attr,
    get src() { return src; }, set src(v) { src = v; log.push(v); },
    setAttribute(k, v) { attr[k] = String(v); }, getAttribute: k => (k === "src" ? src : k in attr ? attr[k] : null),
    classList: { toggle: (c, aan) => { (aan ?? !klassen.has(c)) ? klassen.add(c) : klassen.delete(c); return klassen.has(c); }, contains: c => klassen.has(c) }
  };
}

test("Celebrate.toon: elk moment meteen het stilstaande beeld, geen clip, geen timer, geen object-URL; voor alle zes katten", async () => {
  for (const reduced of [false, true]) {
    const { C, timers, urls, opgehaald } = laad({ reduced });
    assert.equal(C.speler, undefined, "Celebrate.speler bestaat nog");
    assert.equal(await C.laadCatalogus().then(c => !!c), true, "katten.json laadt niet");
    for (const id of ALLE) {
      const img = nepImg();
      for (const m of ["rust", "goed", "bijna", "goed", "rust", "bijna"]) {
        assert.equal(C.toon(img, id, m, "rechts"), true);
        const beeld = m === "rust" ? "rust" : m + "-eind";
        assert.equal(img.src, MAP + (m === "rust" ? `${id}-rust.webp` : `${id}-${m}-eind.webp`), `${id} ${m}`);
        assert.equal(img.getAttribute("data-beeld"), beeld);
        assert.equal(img.getAttribute("data-kat"), id);
      }
    }
    assert.equal(timers.size, 0, "er loopt een timer");
    assert.equal(urls.gemaakt.length, 0, "een object-URL in de ronde");
    assert.deepEqual(opgehaald.filter(p => p !== MAP + "katten.json"), [], "toon haalt iets op");
  }
  // onbekende kat: niets
  const { C } = laad();
  await C.laadCatalogus();
  const img = nepImg();
  assert.equal(C.toon(img, "bestaatniet", "goed", "rechts"), false);
  assert.equal(img.src, "");
});

test("Celebrate.toon: spiegelen volgens de regel, voor alle zes katten (rechts en kijkt rechts: gespiegeld; voor: nooit; midden: nooit)", async () => {
  const { C } = laad();
  await C.laadCatalogus();
  for (const id of ALLE) for (const plaats of ["rechts", "midden"]) {
    const img = nepImg();
    for (const m of ["rust", "goed", "bijna"]) {
      C.toon(img, id, m, plaats);
      const moet = plaats === "rechts" && kijkt(id, m) === "rechts";
      assert.equal(img.classList.contains("gespiegeld"), moet, `${id} ${m} ${plaats}: gespiegeld hoort ${moet}`);
    }
  }
  assert.equal(C.spiegel("rechts", "rechts"), true);
  assert.equal(C.spiegel("voor", "rechts"), false);
  assert.equal(C.spiegel("rechts", "midden"), false);
  assert.equal(C.spiegel("rechts", "links"), false);
});

test("laadKat: alleen de stilstaande beelden van de kat van de ronde, nooit een clip", async () => {
  const { C, opgehaald, plaatjes } = laad();
  const g = await C.laadKat("lapjes");
  assert.equal(g.volledig, true);
  assert.deepEqual(opgehaald.filter(p => p !== MAP + "katten.json"), [], "laadKat haalt een clip op");
  assert.deepEqual([...plaatjes].sort(), [MAP + "lapjes-bijna-eind.webp", MAP + "lapjes-goed-eind.webp", MAP + "lapjes-rust.webp"]);
  // dezelfde kat nog een keer: niets nieuws; een andere kat: alleen die
  await C.laadKat("lapjes");
  assert.equal(plaatjes.length, 3);
  await C.laadKat("stippen");
  assert.deepEqual(plaatjes.slice(3).sort(), [MAP + "stippen-bijna-eind.webp", MAP + "stippen-goed-eind.webp", MAP + "stippen-rust.webp"]);
  assert.ok(!plaatjes.some(p => RONDECLIP.test(p) || p.includes("welkom")), "een clip of het welkom geladen in de ronde");
});

test("welkom: laadWelkom haalt de welkomclip als Blob en het eerste beeld; de speler speelt hem uit een nieuwe object-URL en ruimt hem op", async () => {
  for (const id of ALLE) {
    const { C, opgehaald, plaatjes, urls, timers } = laad();
    await C.laadCatalogus();
    const b = C.welkomBeeld(id);
    assert.deepEqual({ src: b.src, anim: b.anim, beeld: b.beeld, w: b.width, h: b.height, d: b.duurMs },
      { src: MAP + `welkom-${id}-stil.webp`, anim: MAP + `welkom-${id}.webp`, beeld: "welkom-stil", w: 480, h: 480, d: 3000 });
    const g = await C.laadWelkom(id);
    assert.equal(g.volledig, true);
    assert.deepEqual(opgehaald.filter(p => p !== MAP + "katten.json"), [MAP + `welkom-${id}.webp`], id + ": niet (alleen) de welkomclip gehaald");
    assert.deepEqual(plaatjes, [MAP + `welkom-${id}-stil.webp`]);
    const img = nepImg(), sp = C.welkomSpeler(img);
    assert.equal(sp.speel(id), true);
    const een = img.src;
    assert.match(een, new RegExp("^blob:test/\\d+/" + MAP + `welkom-${id}\\.webp$`), id + ": de clip speelt niet uit een object-URL");
    assert.equal(img.getAttribute("data-beeld"), "welkom");
    assert.equal(img.getAttribute("data-kat"), id);
    assert.equal(img.classList.contains("gespiegeld"), false, "het welkom wordt gespiegeld");
    // opnieuw: een nieuwe URL, de vorige opgeruimd
    sp.speel(id);
    assert.notEqual(img.src, een);
    assert.deepEqual(urls.weg, [een]);
    sp.stop();
    assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort(), "stop() ruimt de URL niet op");
    sp.stop();
    assert.equal(urls.weg.length, 2, "twee keer stop() ruimt twee keer op");
    assert.equal(timers.size, 0);
  }
});

test("welkom met wacht: is de clip er na de wachttijd nog niet, dan het stilstaande beeld; een clip die later komt, start niet alsnog", async () => {
  const { C, urls, tik, laatLos, timers } = laad({ houd: ["welkom-sokjes.webp"] });
  await C.laadCatalogus();
  let g = null;
  C.laadWelkom("sokjes", 240).then(x => { g = x; });
  await nogEven();
  assert.equal(g, null, "de belofte wordt waar voor de wachttijd om is");
  assert.equal(timers.size, 1, "geen timer voor de wachttijd");
  tik(); await nogEven(); await nogEven();
  assert.ok(g, "na de wachttijd niet waar, terwijl het stilstaande beeld er is");
  assert.deepEqual([g.stil, g.clip, g.volledig], [true, null, false]);
  const img = nepImg(), sp = C.welkomSpeler(img);
  assert.equal(sp.speel("sokjes"), false);
  assert.deepEqual([img.src, img.getAttribute("data-beeld")], [MAP + "welkom-sokjes-stil.webp", "welkom-stil"]);
  // de clip komt binnen: geen object-URL, het beeld blijft staan
  laatLos("welkom-sokjes.webp"); await nogEven(); await nogEven(); await nogEven();
  assert.ok(g.clip, "de clip wordt niet bewaard als hij binnenkomt");
  assert.equal(urls.gemaakt.length, 0, "de late clip start alsnog");
  assert.equal(img.src, MAP + "welkom-sokjes-stil.webp");
  // de volgende keer (tweede welkom in dezelfde pagina, of de ontwerppagina) speelt hij wel
  const g2 = await C.laadWelkom("sokjes", 240);
  assert.equal(g2.volledig, true);
  assert.equal(sp.speel("sokjes"), true);
  assert.match(img.src, /^blob:test\/\d+\/katten\/clips\/welkom-sokjes\.webp$/);
  // is de clip er wel op tijd, dan wacht niemand op de timer
  const { C: snel } = laad();
  const g3 = await snel.laadWelkom("tuxedo", 240);
  assert.ok(g3.clip && g3.stil && g3.volledig, "met een snelle clip niet volledig");
});

test("welkomVooruit: haalt de welkomclip met lage prioriteit op; niet bij reduced motion, saveData, offline of een clip die de pagina al heeft", async () => {
  const opgevraagd = [];
  const maak = ({ reduced = false, saveData = false, offline = false } = {}) => {
    const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} }, setTimeout, clearTimeout, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
      fetch: async (pad, opties) => { opgevraagd.push([pad, opties?.priority]); const buf = readFileSync(join(REPO, pad));
        return { ok: true, json: async () => JSON.parse(buf.toString("utf8")), blob: async () => ({ pad }), arrayBuffer: async () => buf }; } });
    ctx.window = ctx; ctx.matchMedia = () => ({ matches: reduced });
    if (saveData) ctx.navigator = { connection: { saveData: true } };
    if (offline) ctx.navigator = { onLine: false };
    vm.runInContext(lees("celebrate.js"), ctx);
    return ctx.Celebrate;
  };
  const clips = () => opgevraagd.filter(([p]) => p.endsWith(".webp"));
  assert.equal(await maak().welkomVooruit("stippen"), true);
  assert.deepEqual(clips(), [[MAP + "welkom-stippen.webp", "low"]]);
  for (const opties of [{ reduced: true }, { saveData: true }, { offline: true }]) {
    opgevraagd.length = 0;
    assert.equal(await maak(opties).welkomVooruit("stippen"), false, JSON.stringify(opties));
    assert.deepEqual(clips(), [], JSON.stringify(opties) + ": toch opgehaald");
  }
  // de pagina heeft de clip al (het welkom van nu): niet nog een keer
  opgevraagd.length = 0;
  const C = maak();
  await C.laadWelkom("lapjes");
  assert.equal(await C.welkomVooruit("lapjes"), false);
  assert.deepEqual(clips(), [[MAP + "welkom-lapjes.webp", undefined]]);
  assert.equal(await C.welkomVooruit("bestaatniet"), false);
});

test("welkom bij reduced motion: de clip wordt niet gehaald, het eerste beeld staat stil", async () => {
  const { C, opgehaald, plaatjes, urls } = laad({ reduced: true });
  const g = await C.laadWelkom("tuxedo");
  assert.equal(g.volledig, true);
  assert.deepEqual(opgehaald.filter(p => p !== MAP + "katten.json"), [], "de clip wordt toch gehaald");
  assert.deepEqual(plaatjes, [MAP + "welkom-tuxedo-stil.webp"]);
  const img = nepImg();
  assert.equal(C.welkomSpeler(img).speel("tuxedo"), false);
  assert.equal(img.src, MAP + "welkom-tuxedo-stil.webp");
  assert.equal(img.getAttribute("data-beeld"), "welkom-stil");
  assert.equal(urls.gemaakt.length, 0);
});

test("welkom offline: een clip die niet laadt breekt niets; het welkom is niet volledig en de speler toont het eerste beeld", async () => {
  const { C, urls } = laad({ kapot: ["welkom-strepen.webp"] });
  const g = await C.laadWelkom("strepen");
  assert.equal(g.clip, null);
  assert.equal(g.volledig, false);
  const img = nepImg();
  assert.equal(C.welkomSpeler(img).speel("strepen"), false);
  assert.equal(img.src, MAP + "welkom-strepen-stil.webp");
  assert.equal(urls.gemaakt.length, 0);
  // geen katten.json: geen kat, geen welkom, geen fout
  const { C: zonder } = laad({ kapot: ["katten.json"] });
  assert.equal(await zonder.laadCatalogus(), null);
  assert.equal(zonder.welkomBeeld("strepen"), null);
  assert.equal((await zonder.laadWelkom("strepen")).volledig, false);
  const img2 = nepImg();
  assert.equal(zonder.welkomSpeler(img2).speel("strepen"), false);
  assert.equal(img2.src, "");
});

test("katten.json: een kat zonder goede welkomclip houdt zijn beelden in de ronde maar krijgt geen welkom", () => {
  const kapot = JSON.parse(JSON.stringify(KAT));
  kapot.katten.sokjes.welkom.anim = "../geheim.webp";
  delete kapot.katten.stippen.welkom;
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} }, setTimeout, clearTimeout, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    fetch: async () => ({ ok: true, json: async () => kapot, blob: async () => ({}) }) });
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false });
  vm.runInContext(lees("celebrate.js"), ctx);
  return ctx.Celebrate.laadCatalogus().then(() => {
    const C = ctx.Celebrate;
    for (const id of ["sokjes", "stippen"]) {
      assert.ok(C.beeld(id, "goed"), id + " valt helemaal weg");
      assert.equal(C.welkomBeeld(id), null, id + " krijgt toch een welkom");
    }
    assert.ok(C.welkomBeeld("tuxedo"));
  });
});

test("katten.json: lukt het niet, dan geen kat en geen fout; de volgende keer wordt opnieuw geprobeerd", async () => {
  let stuk = true;
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} }, setTimeout, clearTimeout, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    fetch: async pad => { if (stuk) return { ok: false, status: 503 }; return { ok: true, json: async () => KAT, blob: async () => ({ pad }) }; } });
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false });
  vm.runInContext(lees("celebrate.js"), ctx);
  const C = ctx.Celebrate;
  assert.equal(await C.laadCatalogus(), null, "een 503 geeft toch een catalogus");
  assert.equal(C.beeld("tuxedo", "goed"), null);
  assert.equal((await C.laadKat("tuxedo")).volledig, false);
  stuk = false;
  assert.ok(await C.laadCatalogus(), "na herstel wordt katten.json niet opnieuw geprobeerd");
  assert.ok(C.beeld("tuxedo", "goed"));
});

// ---------- in de browser ----------
let browser, server, FRANS;
before(async () => {
  browser = await startBrowser(); server = await startServer();
  const c = vm.createContext({}); c.window = c; vm.runInContext(lees("lists.js"), c);
  FRANS = c.WORDLISTS.find(l => l.title === "Arrêt Apprendre");
});
after(async () => { await browser?.close(); await server?.stop(); });

// Volgt op elk frame het kattenbeeld, de spraakbalk en de kaart, elke
// wissel van beeld, en welke object-URL's er gemaakt en opgeruimd worden.
function volger() {
  const echtMaak = URL.createObjectURL.bind(URL), echtWeg = URL.revokeObjectURL.bind(URL);
  window.__urls = { gemaakt: [], weg: [], maten: [] };
  URL.createObjectURL = b => { const u = echtMaak(b); window.__urls.gemaakt.push(u); window.__urls.maten.push(b.size); return u; };
  URL.revokeObjectURL = u => { window.__urls.weg.push(u); return echtWeg(u); };
  window.__wissels = [];
  window.__vakken = [];
  const meet = () => {
    const img = document.querySelector("#scr-quiz:not([hidden]) #q-kat .kat, #scr-summary:not([hidden]) #sum-kat .kat");
    if (img) {
      const kaart = img.closest(".kat-kaart").lastElementChild.getBoundingClientRect();
      const r = img.getBoundingClientRect(), z = img.parentElement.querySelector(".spraak").getBoundingClientRect();
      const tot = n => Math.round(n * 10) / 10;
      const rand = img.parentElement.getBoundingClientRect();
      window.__vakken.push({ waar: img.parentElement.id, beeld: img.dataset.beeld, spiegel: img.classList.contains("gespiegeld"),
        layout: [img.offsetLeft, img.offsetTop, img.offsetWidth, img.offsetHeight, tot(rand.left - kaart.left), tot(rand.top - kaart.top), tot(rand.width), tot(rand.height)],
        img: [r.left - kaart.left, r.top - kaart.top, r.width, r.height].map(tot),
        zin: [z.left - kaart.left, z.top - kaart.top, z.width].map(tot), kaart: [kaart.left, kaart.width].map(tot) });
    }
    requestAnimationFrame(meet);
  };
  requestAnimationFrame(meet);
  new MutationObserver(lijst => {
    for (const m of lijst) if (m.target.matches?.(".kat, .welkom-kat") && m.attributeName === "data-beeld") {
      window.__wissels.push({ t: performance.now(), waar: m.target.parentElement?.id || m.target.className, beeld: m.target.dataset.beeld, src: m.target.getAttribute("src"),
        transform: getComputedStyle(m.target).transform });
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-beeld"] });
}

async function openRonde(kat, { reduced = false } = {}) {
  const context = await browser.newContext({ viewport: { width: 360, height: 780 }, serviceWorkers: "block", locale: "nl-NL",
    reducedMotion: reduced ? "reduce" : "no-preference" });
  const extern = await schermNetwerkAf(context);
  const sessie = { listId: FRANS.id, queue: [0, 1, 2, 3, 4, 5, 6, 7].map(i => ({ i, dir: null })), pos: 0, total: 8, attempts: {}, firstTry: {},
    done: 0, streak: 0, skipped: 0, startedAt: Date.now(), elapsedBefore: 0, actief: 0, laatsteActie: Date.now(), kind: "nieuw", kat };
  await context.addInitScript(([k, s]) => {
    if (sessionStorage.getItem("gezaaid")) return;
    sessionStorage.setItem("gezaaid", "1");
    localStorage.setItem(k, s); localStorage.setItem("overhoor:current", JSON.stringify(JSON.parse(s).listId));
  }, ["overhoor:session:pia:" + FRANS.id, JSON.stringify(sessie)]);
  await context.addInitScript(volger);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  const verzoeken = [];
  page.on("request", r => { if (r.url().includes("/katten/")) verzoeken.push(new URL(r.url()).pathname.replace(/^\//, "")); });
  await page.goto(server.url + "/index.html");
  await wachtOpScherm(page, "scr-lessons");
  await page.locator(".lesson", { hasText: FRANS.title }).first().click(); await wachtOpScherm(page, "scr-home");
  await page.click("#btn-resume"); await wachtOpScherm(page, "scr-quiz");
  return { context, page, fouten, extern, verzoeken };
}
const beeldNu = page => page.locator("#q-kat .kat").evaluate(i => ({ beeld: i.dataset.beeld, kat: i.dataset.kat, src: i.getAttribute("src"),
  transform: getComputedStyle(i).transform, w: i.getAttribute("width"), h: i.getAttribute("height"), alt: i.getAttribute("alt"), anim: i.getAnimations().length }));
const GESPIEGELD = "matrix(-1, 0, 0, 1, 0, 0)";
// alle vakken van een scherm gelijk: niets verspringt. De getekende box
// mag alleen verschillen als de kat van kijkrichting wisselt, en dan
// minder dan een halve pixel (WebKit rondt een gespiegeld beeld anders af).
function geenSprong(vakken, waar, naam, minstens = 20) {
  const v = vakken.filter(x => x.waar === waar);
  assert.ok(v.length >= minstens, `${naam}: te weinig frames gemeten (${v.length})`);
  for (const sleutel of ["layout", "zin", "kaart"]) {
    const vormen = new Set(v.map(x => JSON.stringify(x[sleutel])));
    assert.equal(vormen.size, 1, `${naam}: ${sleutel} verspringt: ${[...vormen].join(" | ")}`);
  }
  for (const spiegel of [true, false]) {
    const vormen = new Set(v.filter(x => x.spiegel === spiegel).map(x => JSON.stringify(x.img)));
    assert.ok(vormen.size <= 1, `${naam}: het beeld verspringt${spiegel ? " (gespiegeld)" : ""}: ${[...vormen].join(" | ")}`);
  }
  const alle = v.map(x => x.img);
  for (let i = 0; i < 4; i++) {
    const verschil = Math.max(...alle.map(a => a[i])) - Math.min(...alle.map(a => a[i]));
    assert.ok(verschil < 0.5, `${naam}: het beeld verspringt ${verschil} px bij het wisselen van kijkrichting`);
  }
}

for (const kat of ALLE) {
  test(`${kat}: in de ronde staat de kat stil; rust, goed en bijna meteen als stilstaand beeld, geen clip geladen, op 360px zonder verspringen`, async () => {
    const { context, page, fouten, extern, verzoeken } = await openRonde(kat);
    const spiegel = stand => (kijkt(kat, stand) === "rechts" ? GESPIEGELD : "none");
    let b = await beeldNu(page);
    assert.deepEqual([b.kat, b.beeld, b.src], [kat, "rust", MAP + `${kat}-rust.webp`], "vraag open: niet de rust van de kat van de ronde");
    assert.deepEqual([b.w, b.h, b.alt], [String(KAT.breedte), String(KAT.hoogte), ""], "vaste maat uit katten.json en alt leeg");
    assert.equal(b.transform, spiegel("rust"), "rust: spiegelen klopt niet");
    for (const [goed, m] of [[true, "goed"], [true, "goed"], [false, "bijna"], [false, "bijna"]]) {
      await beantwoord(page, goed);
      b = await beeldNu(page);
      // meteen het eindbeeld, ook als we er meteen naar kijken
      assert.deepEqual([b.beeld, b.src], [m + "-eind", MAP + `${kat}-${m}-eind.webp`], `${m}: niet meteen het stilstaande beeld`);
      assert.equal(b.transform, spiegel(m), `${m}: spiegelen klopt niet`);
      await page.waitForTimeout(250);
      assert.equal((await beeldNu(page)).beeld, m + "-eind", `${m}: het beeld wisselt nog`);
      await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
      assert.equal((await beeldNu(page)).beeld, "rust", "volgende vraag: niet de rust");
    }
    // nooit een clip: geen tussenbeeld, geen object-URL, geen css-beweging
    const w = await page.evaluate(() => window.__wissels.filter(x => x.waar === "q-kat"));
    assert.deepEqual(w.filter(x => !["rust", "goed-eind", "bijna-eind"].includes(x.beeld) || /^blob:/.test(x.src)), [], "er speelde toch een clip");
    assert.equal((await page.evaluate(() => window.__urls)).gemaakt.length, 0, "object-URL in de ronde");
    assert.equal((await beeldNu(page)).anim, 0, "er loopt een css-animatie op de kat");
    geenSprong(await page.evaluate(() => window.__vakken), "q-kat", kat);
    // alleen de stilstaande beelden van deze kat, geen clip. Een welkomclip
    // mag een keer: die haalt de app bij het openen vooruit op voor het
    // volgende welkom (welkom.test.mjs), los van de ronde.
    assert.deepEqual(verzoeken.filter(p => RONDECLIP.test(p)), [], "een clip geladen in de ronde");
    assert.ok(verzoeken.filter(p => /\/welkom-[a-z]+\.webp$/.test(p)).length <= 1, "meer dan een welkomclip opgehaald: " + verzoeken.join(", "));
    assert.deepEqual(verzoeken.filter(p => !p.startsWith(MAP + kat + "-") && p !== MAP + "katten.json" && !/\/welkom-[a-z]+\.webp$/.test(p)), [], "beelden van een andere kat geladen");
    assert.deepEqual(fouten, []); assert.deepEqual(extern, []);
    await context.close();
  });
}

test("reduced motion in de ronde: hetzelfde stilstaande beeld, geen clip", async () => {
  const { context, page, fouten } = await openRonde("lapjes", { reduced: true });
  for (const [goed, m] of [[true, "goed"], [false, "bijna"]]) {
    await beantwoord(page, goed);
    const b = await beeldNu(page);
    assert.deepEqual([b.beeld, b.src], [m + "-eind", MAP + `lapjes-${m}-eind.webp`]);
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
  }
  assert.equal((await page.evaluate(() => window.__urls)).gemaakt.length, 0);
  geenSprong(await page.evaluate(() => window.__vakken), "q-kat", "reduced motion", 3);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("gedag: een gestopte ronde met veel fout meteen bijna-eind, een gewone ronde meteen goed-eind, zonder clip en zonder verspringen", async () => {
  for (const [fout, m] of [[true, "bijna"], [false, "goed"]]) {
    const { context, page, fouten, verzoeken } = await openRonde("stippen");
    await beantwoord(page, !fout); await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    await beantwoord(page, !fout);
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    const b = await page.locator("#sum-kat .kat").evaluate(i => ({ beeld: i.dataset.beeld, src: i.getAttribute("src") }));
    assert.deepEqual(b, { beeld: m + "-eind", src: MAP + `stippen-${m}-eind.webp` }, "het gedag staat niet meteen stil");
    await page.waitForTimeout(600);
    const w = await page.evaluate(() => window.__wissels.filter(x => x.waar === "sum-kat"));
    assert.deepEqual(w.filter(x => x.beeld !== m + "-eind"), [], "het gedag speelt een clip");
    geenSprong(await page.evaluate(() => window.__vakken), "sum-kat", "gedag " + m);
    assert.deepEqual(verzoeken.filter(p => RONDECLIP.test(p)), []);
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

// Het welkom openen en meten terwijl het staat: welk beeld, waar de kat
// staat ten opzichte van de zeshoek, de vorm en het vlak van de zeshoek,
// en twee momenten uit het beeld (om te zien of het beweegt).
async function openWelkom({ reduced = false, thema = "light" } = {}) {
  const context = await browser.newContext({ welkom: true, viewport: { width: 360, height: 780 }, colorScheme: thema, serviceWorkers: "block", locale: "nl-NL",
    reducedMotion: reduced ? "reduce" : "no-preference" });
  await schermNetwerkAf(context);
  await context.addInitScript(volger);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  const verzoeken = [];
  page.on("request", r => { if (r.url().includes("/katten/")) verzoeken.push(new URL(r.url()).pathname.replace(/^\//, "")); });
  await page.goto(server.url + "/index.html");
  await page.locator("body > .welkom").waitFor({ state: "attached", timeout: 1500 });
  return { context, page, fouten, verzoeken };
}
const meetWelkom = page => page.evaluate(() => {
  const el = document.querySelector("body > .welkom"), img = el.querySelector(".welkom-kat"), z = el.querySelector(".welkom-podium > .welkom-zeshoek");
  const r = e => e.getBoundingClientRect();
  const vlak = z && getComputedStyle(z, "::before");
  return { beeld: img.dataset.beeld, kat: img.dataset.kat, src: img.getAttribute("src"), w: img.getAttribute("width"), h: img.getAttribute("height"),
    inPodium: img.parentElement.classList.contains("welkom-podium"), zeshoek: !!z,
    vorm: vlak?.clipPath, banen: vlak?.backgroundImage, schaduw: z && getComputedStyle(z).filter,
    doos: { top: r(img).top, bottom: r(img).bottom, left: r(img).left, right: r(img).right, w: r(img).width },
    vak: z && { top: r(z).top, bottom: r(z).bottom, left: r(z).left, right: r(z).right, w: r(z).width, h: r(z).height },
    anim: img.getAnimations().length, transform: getComputedStyle(img).transform };
});
// Wat er op het scherm staat waar de kat staat. drawImage op een canvas
// geeft bij een geanimeerd beeld altijd het eerste beeld, dus een echte
// schermafbeelding.
const momentopname = page => page.locator(".welkom-kat").screenshot({ animations: "allow" });
function keurZeshoek(m, naam) {
  assert.equal(m.inPodium, true, naam + ": de kat staat niet in het podium");
  assert.equal(m.zeshoek, true, naam + ": geen zeshoek");
  assert.match(m.vorm, /^polygon\(50% 0(%|px)?, 100% 25%, 100% 75%, 50% 100%, 0(%|px)? 75%, 0(%|px)? 25%\)$/, naam + ": geen staande zeshoek: " + m.vorm);
  // de drie lichte kaartbanen, ook in het donkere thema
  assert.match(m.banen, /linear-gradient\(115deg, rgb\(255, 255, 255\) 0(%|px)?, rgb\(255, 255, 255\) 45%, rgb\(247, 244, 254\) 45%, rgb\(247, 244, 254\) 75%, rgb\(239, 234, 252\) 75%, rgb\(239, 234, 252\) 100%\)/,
    naam + ": het vlak is niet de drie lichte banen: " + m.banen);
  assert.match(m.schaduw, /drop-shadow\(.*6px 0px\)/, naam + ": geen harde schaduw onder de zeshoek");
  // verhoudingen uit de opzet: zeshoek 260 x 300, kat 310 x 310, 25 links ervan, 26 boven de punt
  assert.ok(Math.abs(m.vak.w / m.vak.h - 260 / 300) < 0.01, naam + `: zeshoek ${m.vak.w} x ${m.vak.h}`);
  const u = m.vak.w / 260;
  assert.ok(Math.abs(m.doos.w - 310 * u) < 1, naam + ": de kat is niet 310 bij 260 zeshoek");
  assert.ok(Math.abs(m.vak.left - m.doos.left - 25 * u) < 1, naam + ": de kat staat niet 25 links van de zeshoek");
  assert.ok(Math.abs(m.vak.bottom - m.doos.bottom - 26 * u) < 1, naam + ": de kat staat niet 26 boven de punt");
  assert.ok(m.doos.top < m.vak.top, naam + ": de kat steekt niet boven de zeshoek uit");
  assert.equal(m.anim, 0, naam + ": css-beweging op de kat");
  assert.equal(m.transform, "none", naam + ": de kat in het welkom wordt gespiegeld");
}

test("welkom: de welkomclip van de kat (welkom-<kat>.webp) in de zeshoek, hij beweegt, en na sluiten is alles opgeruimd", async () => {
  for (const thema of ["light", "dark"]) {
    const { context, page, fouten, verzoeken } = await openWelkom({ thema });
    await page.waitForFunction(() => document.querySelector(".welkom-kat")?.dataset.beeld === "welkom", null, { timeout: 1000 });
    const m = await meetWelkom(page);
    assert.ok(ALLE.includes(m.kat));
    assert.match(m.src, /^blob:/, "de welkomclip speelt niet uit een object-URL");
    assert.deepEqual([m.w, m.h], ["480", "480"]);
    keurZeshoek(m, thema);
    // de URL komt van welkom-<kat>.webp, en verder geen clip
    assert.ok(verzoeken.includes(MAP + `welkom-${m.kat}.webp`), "welkom-" + m.kat + ".webp niet gehaald");
    const u = await page.evaluate(() => window.__urls);
    assert.deepEqual(u.maten, [readFileSync(join(REPO, MAP, `welkom-${m.kat}.webp`)).length], "de object-URL is niet de welkomclip");
    assert.deepEqual(verzoeken.filter(p => RONDECLIP.test(p)), [], "een clip uit de ronde geladen");
    // het beweegt echt: twee momenten verschillen
    await page.waitForFunction(() => document.querySelector(".welkom-kat").complete);
    const een = await momentopname(page);
    await page.waitForTimeout(700);
    const twee = await momentopname(page);
    assert.ok(!een.equals(twee), `${thema}: de kat beweegt niet, na 700 ms hetzelfde beeld`);
    await page.locator("body > .welkom").waitFor({ state: "detached", timeout: 6000 });
    const na = await page.evaluate(() => window.__urls);
    assert.equal(na.gemaakt.length, 1, "meer dan een object-URL in het welkom");
    assert.deepEqual([...na.weg].sort(), [...na.gemaakt].sort(), "de object-URL van het welkom is niet opgeruimd");
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("welkom bij reduced motion: het eerste beeld staat stil in dezelfde zeshoek, de clip wordt niet gehaald", async () => {
  for (const thema of ["light", "dark"]) {
    const { context, page, fouten, verzoeken } = await openWelkom({ reduced: true, thema });
    const m = await meetWelkom(page);
    assert.equal(m.beeld, "welkom-stil", "reduced motion: niet het stilstaande beeld");
    assert.equal(m.src, MAP + `welkom-${m.kat}-stil.webp`);
    keurZeshoek(m, "reduced motion, " + thema);
    await page.locator("body > .welkom").waitFor({ state: "detached", timeout: 6000 });
    const w = await page.evaluate(() => window.__wissels.filter(x => x.waar === "welkom-kat" || x.waar === "welkom-podium"));
    assert.deepEqual(w.filter(x => x.beeld !== "welkom-stil"), [], "reduced motion: toch de clip");
    assert.equal((await page.evaluate(() => window.__urls)).gemaakt.length, 0, "reduced motion: een object-URL");
    assert.deepEqual(verzoeken.filter(p => p.endsWith(`welkom-${m.kat}.webp`) || RONDECLIP.test(p)), [], "reduced motion: de clip wordt gehaald");
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("welkom: wegtikken midden in de clip haalt het weg en ruimt de URL op", async () => {
  const { context, page, fouten } = await openWelkom();
  await page.waitForTimeout(200);
  await page.mouse.click(180, 390);
  await page.locator("body > .welkom").waitFor({ state: "detached", timeout: 1000 });
  await page.waitForTimeout(500);
  const u = await page.evaluate(() => window.__urls);
  assert.equal(u.gemaakt.length, 1);
  assert.deepEqual([...u.weg].sort(), [...u.gemaakt].sort(), "wegtikken laat een object-URL staan");
  assert.equal(await page.locator(".welkom").count(), 0);
  assert.deepEqual(fouten, []);
  await context.close();
});
