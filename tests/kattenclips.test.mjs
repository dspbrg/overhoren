// Kattenclips (bouwopdracht 3): de kat beweegt met korte clips van zes
// beelden per seconde en blijft daarna in zijn eindstand staan.
//
// Zonder browser: katten.json tegen de bestanden (30 beelden, 400 x 480,
// duur, kijkrichting, aantal beelden, een keer afspelen), service worker
// en allowlist, en de speler met een nep-klok: elk moment het juiste
// beeld en na duurMs het eindbeeld, twee keer hetzelfde moment geeft een
// nieuwe object-URL, de vorige URL wordt opgeruimd, een nieuw moment
// breekt een clip af, reduced motion geeft meteen het eindbeeld,
// spiegelen volgens de regel voor alle zes katten, alleen de kat van de
// ronde wordt geladen, en een clip die niet laadt breekt niets.
//
// In de browser (360 px): voor alle zes katten elk moment in een echte
// ronde, zonder verspringen (getBoundingClientRect op elk frame), met
// spiegelen, opruimen van URL's en alleen de beelden van die kat; reduced
// motion; het gedag; en het welkom (3,5 s, de goed-clip in een lus die
// netjes bij het eerste beeld herbegint, en na sluiten loopt er niets meer).
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
const CLIPS = ["goed", "bijna"];
const KAT = JSON.parse(lees(MAP + "katten.json"));
const kijkt = (kat, stand) => (stand === "rust" ? KAT.katten[kat].goed.kijkt : KAT.katten[kat][stand].kijkt);

// ---------- WebP lezen ----------
// De chunks van een WebP-bestand: maat, aantal beelden en hoe vaak hij speelt.
function webp(buf) {
  assert.equal(buf.toString("ascii", 0, 4), "RIFF"); assert.equal(buf.toString("ascii", 8, 12), "WEBP");
  let maat = null, beelden = 0, lus = null;
  for (let o = 12; o + 8 <= buf.length;) {
    const soort = buf.toString("ascii", o, o + 4), n = buf.readUInt32LE(o + 4), d = o + 8;
    if (soort === "VP8X") maat = [1 + buf.readUIntLE(d + 4, 3), 1 + buf.readUIntLE(d + 7, 3)];
    if (soort === "VP8L" && !maat) { const b = buf.readUInt32LE(d + 1); maat = [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1]; }
    if (soort === "VP8 " && !maat) maat = [buf.readUInt16LE(d + 6) & 0x3fff, buf.readUInt16LE(d + 8) & 0x3fff];
    if (soort === "ANIM") lus = buf.readUInt16LE(d + 4);
    if (soort === "ANMF") beelden++;
    o = d + n + (n % 2);
  }
  return { maat, beelden: beelden || 1, lus };
}

test("katten.json klopt met de bestanden: 30 beelden van 400 x 480, duur, kijkrichting, aantal beelden, speelt een keer", () => {
  assert.equal(KAT.fps, 6, "6 beelden per seconde is bewust");
  assert.deepEqual([KAT.breedte, KAT.hoogte], [400, 480]);
  assert.deepEqual(Object.keys(KAT.katten).sort(), [...ALLE].sort());
  const verwacht = [];
  for (const id of ALLE) {
    const k = KAT.katten[id];
    assert.equal(k.rust, `${id}-rust.webp`);
    verwacht.push(k.rust);
    for (const m of CLIPS) {
      const c = k[m];
      assert.equal(c.anim, `${id}-${m}.webp`); assert.equal(c.eind, `${id}-${m}-eind.webp`);
      assert.ok(Number.isFinite(c.duurMs) && c.duurMs > 0 && c.duurMs < 5000, `${id} ${m}: duurMs ${c.duurMs}`);
      assert.ok(["rechts", "voor"].includes(c.kijkt), `${id} ${m}: kijkt ${c.kijkt}`);
      const clip = webp(readFileSync(join(REPO, MAP, c.anim)));
      assert.equal(clip.beelden, c.beelden, `${c.anim}: ${clip.beelden} beelden, katten.json zegt ${c.beelden}`);
      assert.equal(clip.lus, 1, `${c.anim} speelt niet precies een keer`);
      verwacht.push(c.anim, c.eind);
    }
  }
  assert.equal(verwacht.length, 30);
  for (const f of verwacht) {
    assert.ok(existsSync(join(REPO, MAP, f)), f + " bestaat niet");
    assert.deepEqual(webp(readFileSync(join(REPO, MAP, f))).maat, [KAT.breedte, KAT.hoogte], f + ": niet 400 x 480");
  }
  // niets anders in de map dan de 30 beelden en katten.json
  assert.deepEqual(readdirSync(join(REPO, MAP)).sort(), [...verwacht, "katten.json"].sort());
});

test("service worker en allowlist: alle clips en katten.json gaan mee en online, de oude stilstaande beelden niet", () => {
  const schil = [...lees("sw.js").matchAll(/"\.\/([^"]+)"/g)].map(m => m[1]);
  const bestanden = readdirSync(join(REPO, MAP)).map(f => MAP + f);
  for (const f of bestanden) assert.ok(schil.includes(f), f + " niet in SCHIL");
  assert.deepEqual(schil.filter(f => /^katten\//.test(f) && !f.startsWith(MAP)), [], "oude kattenbeelden staan nog in SCHIL");
  // .assetsignore met de regels van git uitgevoerd: wat online gaat en wat niet
  const online = pad => spawnSync("git", ["-c", "core.excludesFile=" + join(REPO, ".assetsignore"), "check-ignore", "--no-index", "-q", pad], { cwd: REPO }).status === 1;
  for (const f of bestanden) assert.ok(online(f), f + " gaat niet online (.assetsignore)");
  for (const f of ["katten/clips/LEESMIJ.md", "katten/clips/.DS_Store", "katten/ander/x.webp", "archief/katten-v2/strepen-goed.webp", "cats/katten.zip"]) {
    assert.ok(!online(f), f + " zou online gaan");
  }
  // de oude beelden staan in het archief, niet meer in katten/
  for (const id of ALLE) for (const s of CLIPS) {
    assert.ok(!existsSync(join(REPO, "katten", `${id}-${s}.webp`)), `katten/${id}-${s}.webp staat er nog`);
    assert.ok(existsSync(join(REPO, "archief/katten-v2", `${id}-${s}.webp`)), `archief/katten-v2/${id}-${s}.webp ontbreekt`);
  }
});

// ---------- de speler zonder browser ----------
// celebrate.js in een eigen context met een nep-klok, nep-URL's en een
// fetch die de bestanden uit de repo leest.
function laad({ reduced = false, kapot = [], houd = [] } = {}) {
  const vast = [];   // opgehouden ophalingen: { pad, los }
  let nu = 0, volg = 1;
  const timers = new Map();
  const urls = { gemaakt: [], weg: [] };
  const opgehaald = [];
  const ctx = vm.createContext({
    localStorage: { getItem: () => null, setItem: () => {} },
    setTimeout: (f, ms) => { const id = volg++; timers.set(id, { f, t: nu + (ms || 0) }); return id; },
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
  vm.runInContext(lees("celebrate.js"), ctx);
  // de klok vooruit, timers in volgorde
  function tik(ms) {
    const eind = nu + ms;
    for (;;) {
      const volgende = [...timers.entries()].filter(([, t]) => t.t <= eind).sort((a, b) => a[1].t - b[1].t)[0];
      if (!volgende) break;
      timers.delete(volgende[0]); nu = volgende[1].t; volgende[1].f();
    }
    nu = eind;
  }
  const laatLos = deel => { for (const v of vast.filter(x => x.pad.includes(deel))) v.los(); };
  return { C: ctx.Celebrate, urls, opgehaald, tik, timers, laatLos };
}
// een nep-<img> die bijhoudt welk beeld er stond
function nepImg() {
  const klassen = new Set(), attr = {}, log = [];
  let src = "";
  return {
    log, attr,
    get src() { return src; }, set src(v) { src = v; log.push(v); },
    setAttribute(k, v) { attr[k] = String(v); }, getAttribute: k => (k in attr ? attr[k] : null),
    classList: { toggle: (c, aan) => { (aan ?? !klassen.has(c)) ? klassen.add(c) : klassen.delete(c); return klassen.has(c); }, contains: c => klassen.has(c) }
  };
}
const nogEven = () => new Promise(r => setImmediate(r));

test("speler: elk moment geeft het juiste beeld en na duurMs het eindbeeld, voor alle zes katten", async () => {
  for (const id of ALLE) {
    const { C, tik } = laad();
    assert.equal(await C.laadCatalogus().then(c => !!c), true, "katten.json laadt niet");
    await C.laadKat(id);
    const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
    sp.speel(id, "rust");
    assert.equal(img.src, MAP + `${id}-rust.webp`); assert.equal(img.getAttribute("data-beeld"), "rust"); assert.equal(img.getAttribute("data-kat"), id);
    for (const m of CLIPS) {
      const c = KAT.katten[id][m];
      let klaar = null;
      sp.speel(id, m).then(v => { klaar = v; });
      assert.match(img.src, new RegExp("^blob:test/\\d+/" + MAP + `${id}-${m}\\.webp$`), `${id} ${m}: de clip speelt niet uit een object-URL`);
      assert.equal(img.getAttribute("data-beeld"), m);
      tik(c.duurMs - 1);
      assert.equal(img.getAttribute("data-beeld"), m, `${id} ${m}: eindbeeld te vroeg`);
      tik(1);
      assert.equal(img.src, MAP + c.eind, `${id} ${m}: na ${c.duurMs} ms niet het eindbeeld`);
      assert.equal(img.getAttribute("data-beeld"), m + "-eind");
      await nogEven();
      assert.equal(klaar, true, "de belofte van speel() wordt niet waar na het eindbeeld");
      // volgende vraag: rust
      sp.speel(id, "rust");
      assert.equal(img.src, MAP + `${id}-rust.webp`);
    }
  }
});

test("speler: twee keer hetzelfde moment start opnieuw met een nieuwe object-URL, en elke vorige URL wordt opgeruimd", async () => {
  const { C, tik, urls } = laad();
  await C.laadKat("tuxedo");
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  const d = KAT.katten.tuxedo.goed.duurMs;
  sp.speel("tuxedo", "goed");
  const een = img.src;
  tik(d);
  assert.deepEqual(urls.weg, [een], "de URL is niet opgeruimd toen het eindbeeld stond");
  sp.speel("tuxedo", "goed");
  const twee = img.src;
  assert.notEqual(twee, een, "tweede keer goed: dezelfde URL, dus geen herstart");
  assert.match(twee, /^blob:/);
  // direct nog een keer, midden in de clip
  tik(200);
  sp.speel("tuxedo", "goed");
  const drie = img.src;
  assert.notEqual(drie, twee);
  assert.ok(urls.weg.includes(twee), "de URL van de afgebroken clip is niet opgeruimd");
  tik(d);
  assert.equal(img.getAttribute("data-beeld"), "goed-eind");
  assert.equal(urls.gemaakt.length, 3);
  assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort(), "niet elke URL is opgeruimd");
  // stoppen ruimt ook op
  sp.speel("tuxedo", "bijna"); sp.stop();
  assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort(), "stop() ruimt de URL niet op");
});

test("speler in een lus (alleen het welkom): na elke duurMs opnieuw met een nieuwe URL, de oude opgeruimd; uitlopen eindigt op het eindbeeld; stop() laat niets lopen", async () => {
  for (const id of ALLE) {
    const { C, tik, urls, timers } = laad();
    await C.laadKat(id);
    const img = nepImg(), sp = C.speler(img, { plaats: "midden" });
    const d = KAT.katten[id].goed.duurMs;
    let klaar = null;
    sp.speel(id, "goed", { lus: true }).then(v => { klaar = v; });
    const starts = [img.src];
    for (let ronde = 1; ronde <= 4; ronde++) {
      tik(d - 1);
      assert.equal(img.src, starts.at(-1), `${id}: de lus herstart te vroeg (ronde ${ronde})`);
      tik(1);
      assert.match(img.src, new RegExp("^blob:test/\\d+/" + MAP + `${id}-goed\\.webp$`), `${id}: ronde ${ronde} start niet met de clip`);
      assert.equal(img.getAttribute("data-beeld"), "goed", `${id}: in de lus komt het eindbeeld`);
      assert.ok(!starts.includes(img.src), `${id}: ronde ${ronde} hergebruikt een oude URL`);
      starts.push(img.src);
      assert.deepEqual([...urls.weg].sort(), starts.slice(0, -1).sort(), `${id}: de vorige URL is niet opgeruimd (ronde ${ronde})`);
    }
    assert.ok(!img.log.some(s => /-eind\.webp$/.test(s)), `${id}: eindbeeld tijdens de lus`);
    // uitlopen: de lopende ronde maakt hij af, dan het eindbeeld, geen nieuwe ronde
    tik(300); sp.uitlopen();
    tik(d - 300);
    assert.equal(img.src, MAP + KAT.katten[id].goed.eind, `${id}: na uitlopen niet het eindbeeld`);
    assert.equal(urls.gemaakt.length, 5, `${id}: na uitlopen nog een ronde`);
    await nogEven();
    assert.equal(klaar, true);
    assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort());
    // stop() midden in een lus: alles opgeruimd, geen timer meer
    sp.speel(id, "goed", { lus: true }); tik(d + 50); sp.stop();
    assert.equal(timers.size, 0, `${id}: na stop() loopt er nog een timer`);
    tik(10 * d);
    assert.equal(urls.gemaakt.length, 7);
    assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort(), `${id}: stop() laat een URL staan`);
  }
  // zonder lus (de ronde): nog steeds een keer, dan het eindbeeld
  const { C, tik, urls } = laad();
  await C.laadKat("lapjes");
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  sp.speel("lapjes", "goed"); tik(5 * KAT.katten.lapjes.goed.duurMs);
  assert.equal(urls.gemaakt.length, 1, "in de ronde speelt de clip vaker dan een keer");
  assert.equal(img.getAttribute("data-beeld"), "goed-eind");
});

test("speler in een lus bij reduced motion: geen lus, meteen het eindbeeld", async () => {
  const { C, tik, urls, timers } = laad({ reduced: true });
  await C.laadKat("tuxedo");
  const img = nepImg(), sp = C.speler(img, { plaats: "midden" });
  sp.speel("tuxedo", "goed", { lus: true });
  assert.equal(img.getAttribute("data-beeld"), "goed-eind");
  tik(10000);
  assert.equal(urls.gemaakt.length, 0); assert.equal(timers.size, 0);
});

test("speler: een nieuw moment tijdens een clip breekt hem af; het oude eindbeeld komt nooit", async () => {
  const { C, tik, timers } = laad();
  await C.laadKat("sokjes");
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  let eerste = null;
  sp.speel("sokjes", "goed").then(v => { eerste = v; });
  tik(400);
  sp.speel("sokjes", "bijna");
  assert.match(img.src, /sokjes-bijna\.webp$/, "het nieuwe moment start niet meteen");
  assert.equal(timers.size, 1, "de timer van de afgebroken clip loopt nog");
  tik(5000);
  assert.ok(!img.log.includes(MAP + "sokjes-goed-eind.webp"), "het eindbeeld van de afgebroken clip kwam toch");
  assert.equal(img.src, MAP + "sokjes-bijna-eind.webp");
  await nogEven();
  assert.equal(eerste, false, "de afgebroken clip meldt zich als klaar");
  // ook rust breekt af
  sp.speel("sokjes", "goed"); tik(100); sp.speel("sokjes", "rust"); tik(5000);
  assert.equal(img.src, MAP + "sokjes-rust.webp");
});

test("speler: bij reduced motion meteen het eindbeeld, geen clip, geen timer", async () => {
  const { C, urls, timers } = laad({ reduced: true });
  for (const id of ALLE) {
    await C.laadKat(id);
    const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
    for (const m of CLIPS) {
      let klaar = null;
      sp.speel(id, m).then(v => { klaar = v; });
      assert.equal(img.src, MAP + KAT.katten[id][m].eind, `${id} ${m}`);
      assert.equal(img.getAttribute("data-beeld"), m + "-eind");
      await nogEven();
      assert.equal(klaar, true);
    }
  }
  assert.equal(urls.gemaakt.length, 0, "object-URL bij reduced motion");
  assert.equal(timers.size, 0);
});

test("speler: spiegelen volgens de regel, voor alle zes katten (rechts en kijkt rechts: gespiegeld; voor: nooit; midden: nooit)", async () => {
  const { C, tik } = laad();
  await C.laadCatalogus();
  for (const id of ALLE) {
    await C.laadKat(id);
    for (const plaats of ["rechts", "midden"]) {
      const img = nepImg(), sp = C.speler(img, { plaats });
      for (const m of ["rust", "goed", "bijna"]) {
        sp.speel(id, m);
        const moet = plaats === "rechts" && kijkt(id, m) === "rechts";
        assert.equal(img.classList.contains("gespiegeld"), moet, `${id} ${m} ${plaats}: gespiegeld hoort ${moet}`);
        tik(3000);
        assert.equal(img.classList.contains("gespiegeld"), moet, `${id} ${m}-eind ${plaats}`);
      }
    }
  }
  // de regel zelf
  assert.equal(C.spiegel("rechts", "rechts"), true);
  assert.equal(C.spiegel("voor", "rechts"), false);
  assert.equal(C.spiegel("rechts", "midden"), false);
  assert.equal(C.spiegel("rechts", "links"), false);
});

test("laden: alleen de kat van de ronde (rust, twee clips, twee eindbeelden), clips als Blob", async () => {
  const { C, opgehaald } = laad();
  const g = await C.laadKat("lapjes");
  assert.deepEqual(opgehaald.filter(p => p !== MAP + "katten.json").sort(), [MAP + "lapjes-bijna.webp", MAP + "lapjes-goed.webp"],
    "zonder Image worden alleen de clips gehaald, en alleen van lapjes");
  assert.equal(g.clips.goed.pad, MAP + "lapjes-goed.webp");
  // dezelfde kat nog een keer: niets nieuws
  await C.laadKat("lapjes");
  assert.equal(opgehaald.filter(p => p.endsWith(".webp")).length, 2);
  // een andere kat: alleen die
  await C.laadKat("stippen");
  assert.deepEqual(opgehaald.filter(p => p.endsWith(".webp")).slice(2).sort(), [MAP + "stippen-bijna.webp", MAP + "stippen-goed.webp"]);
  // de stilstaande beelden: rust en de twee eindbeelden, ook alleen van die kat
  const geladen = [];
  const ctx = vm.createContext({ localStorage: { getItem: () => null, setItem: () => {} }, setTimeout, clearTimeout, URL: { createObjectURL: () => "blob:x", revokeObjectURL() {} },
    fetch: async pad => ({ ok: true, json: async () => KAT, blob: async () => ({ pad }) }) });
  ctx.window = ctx; ctx.matchMedia = () => ({ matches: false });
  ctx.Image = function () { const o = { decode: async () => {} }; Object.defineProperty(o, "src", { set: v => geladen.push(v) }); return o; };
  vm.runInContext(lees("celebrate.js"), ctx);
  const r = await ctx.Celebrate.laadKat("rodestreep");
  assert.deepEqual(geladen.sort(), [MAP + "rodestreep-bijna-eind.webp", MAP + "rodestreep-goed-eind.webp", MAP + "rodestreep-rust.webp"]);
  assert.equal(r.volledig, true);
});

test("offline: een clip die niet laadt breekt niets, dan meteen het eindbeeld", async () => {
  const { C, urls, tik } = laad({ kapot: ["-goed.webp"] });
  const g = await C.laadKat("strepen");
  assert.equal(g.clips.goed, null);
  assert.equal(g.volledig, false);
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  sp.speel("strepen", "goed");
  assert.equal(img.src, MAP + "strepen-goed-eind.webp");
  sp.speel("strepen", "bijna");
  assert.match(img.src, /^blob:/, "de bijna-clip laadde wel en speelt");
  tik(3000);
  assert.equal(urls.gemaakt.length, 1);
  // geen katten.json: geen kat, geen fout
  const { C: zonder } = laad({ kapot: ["katten.json"] });
  assert.equal(await zonder.laadCatalogus(), null);
  const img2 = nepImg();
  await zonder.speler(img2, { plaats: "rechts" }).speel("strepen", "goed");
  assert.equal(img2.src, "");
  assert.equal(zonder.beeld("strepen", "goed"), null);
});

test("speler: een clip die te traag laadt wordt na 600 ms het eindbeeld, en start daarna niet alsnog", async () => {
  const { C, tik, urls, laatLos } = laad({ houd: ["-goed.webp"] });
  await C.laadCatalogus();
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  let klaar = null;
  C.laadKat("strepen");
  sp.speel("strepen", "goed").then(v => { klaar = v; });
  assert.equal(img.src, "", "tijdens het laden staat er nog niets");
  tik(599);
  assert.equal(img.src, "");
  tik(1);
  assert.equal(img.src, MAP + KAT.katten.strepen.goed.eind, "na 600 ms niet het eindbeeld");
  await nogEven();
  assert.equal(klaar, true);
  laatLos("-goed.webp"); await nogEven(); await nogEven();
  tik(5000);
  assert.equal(urls.gemaakt.length, 0, "de late clip start alsnog");
  assert.equal(img.getAttribute("data-beeld"), "goed-eind");
});

test("speler: een nieuwe ronde (andere kat) terwijl de clip van de vorige nog laadt, de late clip lekt niets en verschijnt nooit", async () => {
  const { C, tik, urls, laatLos } = laad({ houd: ["strepen-goed.webp"] });
  await C.laadCatalogus();
  const img = nepImg(), sp = C.speler(img, { plaats: "rechts" });
  let eerste = null;
  C.laadKat("strepen");
  sp.speel("strepen", "goed").then(v => { eerste = v; });
  // de nieuwe ronde: een andere kat, de speler van de kaart speelt die
  await C.laadKat("tuxedo");
  sp.speel("tuxedo", "goed");
  assert.match(img.src, /^blob:test\/\d+\/katten\/clips\/tuxedo-goed\.webp$/);
  laatLos("strepen-goed.webp"); await nogEven(); await nogEven();
  assert.ok(img.log.every(s => !s.includes("strepen")), "de kat van de vorige ronde verschijnt toch: " + img.log.join(" "));
  tik(5000);
  assert.equal(img.src, MAP + KAT.katten.tuxedo.goed.eind);
  assert.equal(img.getAttribute("data-kat"), "tuxedo");
  await nogEven();
  assert.equal(eerste, false);
  assert.deepEqual([...urls.weg].sort(), [...urls.gemaakt].sort(), "een object-URL is niet opgeruimd");
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
  window.__urls = { gemaakt: [], weg: [] };
  URL.createObjectURL = b => { const u = echtMaak(b); window.__urls.gemaakt.push(u); return u; };
  URL.revokeObjectURL = u => { window.__urls.weg.push(u); return echtWeg(u); };
  window.__wissels = [];
  window.__vakken = [];
  const meet = () => {
    const img = document.querySelector("#scr-quiz:not([hidden]) #q-kat .kat, #scr-summary:not([hidden]) #sum-kat .kat");
    if (img) {
      // gemeten ten opzichte van de kaart eronder: wat erboven gebeurt
      // (de reeks-chip in de kop) is niet van de kat
      const kaart = img.closest(".kat-kaart").lastElementChild.getBoundingClientRect();
      const r = img.getBoundingClientRect(), z = img.parentElement.querySelector(".spraak").getBoundingClientRect();
      const tot = n => Math.round(n * 10) / 10;
      // de layoutbox (zonder transform, binnen de rand) en de rand zelf
      // ten opzichte van de kaart moeten precies gelijk blijven
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
  // een ronde die openstaat met deze kat: hervatten geeft precies die kat
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
const wachtOpBeeld = (page, sel, beeld, timeout = 4000) => page.waitForFunction(([s, b]) => document.querySelector(s)?.dataset.beeld === b, [sel, beeld], { timeout });
const GESPIEGELD = "matrix(-1, 0, 0, 1, 0, 0)";
// alle vakken van een scherm gelijk: niets verspringt
// De getekende box (getBoundingClientRect, met de spiegeling) mag alleen
// verschillen als de kat van kijkrichting wisselt, en dan minder dan een
// halve pixel: WebKit rondt de box van een gespiegeld beeld van 86,7 px
// breed anders af. Binnen dezelfde kijkrichting en voor de layoutbox geldt
// precies gelijk.
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
  test(`${kat}: rust, goed, nog een keer goed, bijna, nog een keer bijna en een afgebroken clip, op 360px zonder verspringen`, async () => {
    const { context, page, fouten, extern, verzoeken } = await openRonde(kat);
    const spiegel = stand => (kijkt(kat, stand) === "rechts" ? GESPIEGELD : "none");

    // de vraag staat open: rust
    let b = await beeldNu(page);
    assert.deepEqual([b.kat, b.beeld, b.src], [kat, "rust", MAP + `${kat}-rust.webp`], "vraag open: niet de rust van de kat van de ronde");
    assert.deepEqual([b.w, b.h, b.alt], [String(KAT.breedte), String(KAT.hoogte), ""], "vaste maat uit katten.json en alt leeg");
    assert.equal(b.transform, spiegel("rust"), "rust: spiegelen klopt niet");

    const blobs = [];
    for (const [goed, m] of [[true, "goed"], [true, "goed"], [false, "bijna"], [false, "bijna"]]) {
      const t0 = await page.evaluate(() => performance.now());
      await beantwoord(page, goed);
      b = await beeldNu(page);
      // de clip speelt (of staat al op het eindbeeld als de test traag was)
      const clip = await page.evaluate(([t, m]) => window.__wissels.find(w => w.t >= t && w.beeld === m), [t0, m]);
      assert.ok(clip, `${m}: de clip startte niet`);
      assert.match(clip.src, /^blob:/, `${m}: de clip speelt niet uit een object-URL`);
      assert.equal(clip.transform, spiegel(m), `${m}: spiegelen klopt niet`);
      blobs.push(clip.src);
      await wachtOpBeeld(page, "#q-kat .kat", m + "-eind");
      const eind = await page.evaluate(([t, m]) => window.__wissels.find(w => w.t >= t && w.beeld === m + "-eind"), [t0, m]);
      const duur = eind.t - clip.t, verwacht = KAT.katten[kat][m].duurMs;
      assert.ok(Math.abs(duur - verwacht) < 150, `${m}: eindbeeld na ${Math.round(duur)} ms, verwacht ${verwacht}`);
      assert.equal(eind.src, MAP + KAT.katten[kat][m].eind);
      assert.equal(eind.transform, spiegel(m), `${m}-eind: spiegelen klopt niet`);
      await page.waitForTimeout(150);
      await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
      b = await beeldNu(page);
      assert.equal(b.beeld, "rust", "volgende vraag: niet de rust");
    }
    assert.equal(new Set(blobs).size, blobs.length, "twee keer hetzelfde moment gebruikt dezelfde object-URL");

    // een clip afbreken: goed, en meteen door naar de volgende vraag
    await beantwoord(page, true);
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    assert.equal((await beeldNu(page)).beeld, "rust", "na afbreken niet meteen rust");
    await page.waitForTimeout(KAT.katten[kat].goed.duurMs + 200);
    assert.equal((await beeldNu(page)).beeld, "rust", "het eindbeeld van de afgebroken clip kwam toch");

    // geen css-beweging bovenop de clips
    assert.equal((await beeldNu(page)).anim, 0, "er loopt een css-animatie op de kat");
    // niets verspringt, op geen enkel frame
    geenSprong(await page.evaluate(() => window.__vakken), "q-kat", kat);
    // elke object-URL is opgeruimd
    const u = await page.evaluate(() => window.__urls);
    assert.equal(u.gemaakt.length, 5);
    assert.deepEqual([...u.weg].sort(), [...u.gemaakt].sort(), "niet elke object-URL is opgeruimd");
    // alleen de beelden van deze kat
    assert.deepEqual(verzoeken.filter(p => !p.startsWith(MAP + kat + "-") && p !== MAP + "katten.json"), [], "beelden van een andere kat geladen");
    assert.ok(verzoeken.includes(MAP + `${kat}-goed.webp`) && verzoeken.includes(MAP + `${kat}-bijna.webp`), "clips niet geladen");
    assert.deepEqual(fouten, []); assert.deepEqual(extern, []);
    await context.close();
  });
}

test("reduced motion: elk moment meteen het eindbeeld, nooit een clip", async () => {
  const { context, page, fouten } = await openRonde("lapjes", { reduced: true });
  for (const [goed, m] of [[true, "goed"], [false, "bijna"]]) {
    await beantwoord(page, goed);
    const b = await beeldNu(page);
    assert.deepEqual([b.beeld, b.src], [m + "-eind", MAP + `lapjes-${m}-eind.webp`]);
    await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
  }
  const w = await page.evaluate(() => window.__wissels);
  assert.deepEqual(w.filter(x => /^blob:/.test(x.src)), [], "clip bij reduced motion");
  assert.equal((await page.evaluate(() => window.__urls)).gemaakt.length, 0);
  geenSprong(await page.evaluate(() => window.__vakken), "q-kat", "reduced motion", 3);
  assert.deepEqual(fouten, []);
  await context.close();
});

test("gedag: gestopte ronde met veel fout geeft de bijna-clip, een gewone ronde de goed-clip, zonder verspringen", async () => {
  for (const [fout, m] of [[true, "bijna"], [false, "goed"]]) {
    const { context, page, fouten } = await openRonde("stippen");
    await beantwoord(page, !fout); await page.click("#btn-next"); await page.locator("#btn-check").waitFor();
    await beantwoord(page, !fout);
    await page.click("#btn-quit"); await wachtOpScherm(page, "scr-summary");
    const t = await page.evaluate(() => performance.now());
    await wachtOpBeeld(page, "#sum-kat .kat", m + "-eind");
    const w = await page.evaluate(t => window.__wissels.filter(x => x.waar === "sum-kat"), t);
    assert.equal(w[0].beeld, m, "het gedag begint niet met de " + m + "-clip");
    assert.match(w[0].src, /^blob:/);
    await page.waitForTimeout(200);
    geenSprong(await page.evaluate(() => window.__vakken), "sum-kat", "gedag " + m);
    assert.deepEqual(fouten, []);
    await context.close();
  }
});

test("welkom: de goed-clip van de kat van de volgende ronde in een lus tot de overgang, 3,5 s, daarna loopt er niets meer", async () => {
  for (const reduced of [false, true]) {
    for (let keer = 0; keer < 3; keer++) {
      const context = await browser.newContext({ welkom: true, viewport: { width: 360, height: 780 }, serviceWorkers: "block", locale: "nl-NL",
        reducedMotion: reduced ? "reduce" : "no-preference" });
      await schermNetwerkAf(context);
      await context.addInitScript(volger);
      // het beeld net na elke start van de clip, verkleind, om te zien dat
      // elke ronde van de lus bij hetzelfde eerste beeld begint
      await context.addInitScript(() => {
        window.__eerste = [];
        new MutationObserver(lijst => {
          for (const m of lijst) if (m.target.matches?.(".welkom-kat") && m.target.dataset.beeld === "goed") {
            const img = m.target, src = img.getAttribute("src");
            img.decode().then(() => {
              if (img.getAttribute("src") !== src) return;
              const c = document.createElement("canvas"); c.width = 40; c.height = 48;
              const g = c.getContext("2d"); g.drawImage(img, 0, 0, 40, 48);
              window.__eerste.push([...g.getImageData(0, 0, 40, 48).data]);
            }, () => {});
          }
        }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-beeld", "src"] });
      });
      await context.addInitScript(() => {
        window.__welkom = { in: 0, uit: 0, laatste: null };
        new MutationObserver(lijst => {
          for (const m of lijst) {
            for (const n of m.addedNodes) if (n.classList?.contains("welkom")) window.__welkom.in = performance.now();
            for (const n of m.removedNodes) if (n.classList?.contains("welkom")) {
              const i = n.querySelector(".welkom-kat");
              window.__welkom.uit = performance.now(); window.__welkom.laatste = { beeld: i.dataset.beeld, kat: i.dataset.kat, src: i.getAttribute("src") };
            }
          }
        }).observe(document, { childList: true, subtree: true });
      });
      const page = await context.newPage();
      const fouten = volgFouten(page);
      await page.goto(server.url + "/index.html");
      await page.locator("body > .welkom").waitFor({ state: "attached", timeout: 1500 });
      const css = await page.locator(".welkom-kat").evaluate(i => ({ anim: i.getAnimations().length, transform: getComputedStyle(i).transform,
        w: i.getAttribute("width"), h: i.getAttribute("height") }));
      assert.equal(css.anim, 0, "nog een css-sprong of wiebel op de kat");
      assert.equal(css.transform, "none", "de kat in het welkom staat in het midden en wordt nooit gespiegeld");
      assert.deepEqual([css.w, css.h], [String(KAT.breedte), String(KAT.hoogte)]);
      await page.locator("body > .welkom").waitFor({ state: "detached", timeout: 6000 });
      const w = await page.evaluate(() => window.__welkom);
      const wissels = await page.evaluate(() => window.__wissels.filter(x => x.waar === "welkom-kat"));
      const kat = w.laatste.kat, d = KAT.katten[kat].goed.duurMs;
      assert.ok(ALLE.includes(kat));
      const duur = w.uit - w.in;
      if (reduced) {
        assert.deepEqual(wissels.map(x => x.beeld), ["goed-eind"], "reduced motion: niet meteen het eindbeeld");
        assert.ok(duur > 3450 && duur < 3900, `reduced motion: welkom stond ${Math.round(duur)} ms, verwacht 3500`);
      } else {
        assert.equal(wissels[0].beeld, "goed"); assert.match(wissels[0].src, /^blob:/, "de clip speelt niet");
        assert.ok(duur > 3350 && duur < 3900, `welkom stond ${Math.round(duur)} ms, verwacht 3500 (clip ${d} ms)`);
        // de lus: tot de overgang (3000 ms) start de clip na elke duurMs opnieuw
        const starts = wissels.filter(x => x.beeld === "goed" && x.t < w.uit);
        const minstens = Math.floor(3000 / d) + 1;
        assert.ok(starts.length >= minstens, `${kat}: de clip startte ${starts.length} keer in het welkom, verwacht minstens ${minstens}`);
        assert.equal(new Set(starts.map(x => x.src)).size, starts.length, "een ronde van de lus hergebruikt een oude URL");
        for (const x of starts) assert.match(x.src, /^blob:/);
        // geen sprong: een ronde begint pas als het laatste beeld (600 ms) van de vorige uit is
        for (let i = 1; i < starts.length; i++) {
          const tussen = starts[i].t - starts[i - 1].t;
          assert.ok(tussen > d - 40 && tussen < d + 150, `${kat}: ronde ${i + 1} begon na ${Math.round(tussen)} ms, de clip duurt ${d} ms`);
        }
        // geen eindbeeld zolang de lus loopt
        assert.ok(!wissels.some(x => x.beeld === "goed-eind" && x.t < starts.at(-1).t), "het eindbeeld kwam midden in de lus");
        // elke ronde begint bij hetzelfde eerste beeld
        const eerste = await page.evaluate(() => window.__eerste);
        assert.ok(eerste.length >= 2, `te weinig rondes gezien (${eerste.length})`);
        for (let i = 1; i < eerste.length; i++) {
          const verschil = eerste[i].reduce((som, v, j) => som + Math.abs(v - eerste[0][j]), 0) / eerste[0].length;
          assert.ok(verschil < 4, `${kat}: ronde ${i + 1} begint niet bij het eerste beeld (verschil ${verschil.toFixed(1)})`);
        }
        // na sluiten: alle URL's opgeruimd en er komt niets meer bij
        const u = await page.evaluate(() => window.__urls);
        assert.equal(u.gemaakt.length, starts.length, "na het sluiten nog een ronde");
        assert.deepEqual([...u.weg].sort(), [...u.gemaakt].sort(), "de object-URL's van het welkom zijn niet opgeruimd");
        await page.waitForTimeout(d + 300);
        const later = await page.evaluate(() => ({ urls: window.__urls.gemaakt.length, wissels: window.__wissels.filter(x => x.waar === "welkom-kat").length }));
        assert.deepEqual(later, { urls: u.gemaakt.length, wissels: wissels.length }, "na het sluiten loopt de lus nog");
      }
      assert.deepEqual(fouten, []);
      await context.close();
    }
  }
});

test("welkom: wegtikken midden in de clip stopt de lus, haalt het weg en ruimt de URL op", async () => {
  const context = await browser.newContext({ welkom: true, viewport: { width: 360, height: 780 }, serviceWorkers: "block" });
  await schermNetwerkAf(context);
  await context.addInitScript(volger);
  const page = await context.newPage();
  const fouten = volgFouten(page);
  await page.goto(server.url + "/index.html");
  await page.locator("body > .welkom").waitFor({ state: "attached", timeout: 1500 });
  await page.waitForTimeout(200);
  await page.mouse.click(180, 390);
  await page.locator("body > .welkom").waitFor({ state: "detached", timeout: 1000 });
  await page.waitForTimeout(2000);
  const u = await page.evaluate(() => window.__urls);
  assert.equal(u.gemaakt.length, 1, "na wegtikken liep de lus door");
  assert.deepEqual([...u.weg].sort(), [...u.gemaakt].sort(), "wegtikken laat een object-URL staan");
  assert.equal(await page.locator(".welkom").count(), 0);
  assert.deepEqual(fouten, []);
  await context.close();
});
