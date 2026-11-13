// Sync-worker (worker/src) zonder Cloudflare: het samenvoegen als pure
// functie, en de fetch-handler met een nep-KV. Niets gaat naar internet:
// fetch naar de Anthropic-API wordt in de test vervangen.
//
// WORKER_SRC=/pad/naar/src laat dezelfde tests op een andere kopie draaien
// (gebruikt om te zien dat ze falen zonder de fix).
import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { REPO } from "./lib/omgeving.mjs";

const SRC = process.env.WORKER_SRC || join(REPO, "worker", "src");
const { mergeSync } = await import(pathToFileURL(join(SRC, "merge.js")).href);
const worker = (await import(pathToFileURL(join(SRC, "index.js")).href)).default;

const NU = 1_800_000_000_000;
const MARGE = 5 * 60 * 1000;
const json = x => JSON.parse(JSON.stringify(x));
// een voortgang zoals de worker hem opslaat: altijd items en sessions
const vg = updated => ({ items: {}, sessions: [], updated });

// ---------- nep-omgeving voor de handler ----------
function nepKV(begin = {}) {
  const data = new Map(Object.entries(begin).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    puts: 0,
    async get(k, type) {
      if (!data.has(k)) return null;
      return type === "json" ? JSON.parse(data.get(k)) : data.get(k);
    },
    async put(k, v) { this.puts++; data.set(k, v); },
  };
}
const ORIGINS = "https://overhoren.vandaan.net,https://dspbrg.github.io";
function env(kv = nepKV()) {
  return { SYNC: kv, APP_SECRET: "geheim", ALLOWED_ORIGIN: ORIGINS, ANTHROPIC_API_KEY: "test" };
}
function put(body, { origin = "https://dspbrg.github.io", raw } = {}) {
  return new Request("https://api.test/sync/pia", {
    method: "PUT",
    headers: { "Content-Type": "application/json", "x-api-token": "geheim", Origin: origin },
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
}
const opgeslagen = kv => JSON.parse(kv.data.get("learner:pia"));

// ---------- katten (vervallen) ----------

test("katten wordt genegeerd: niet opgeslagen, niet teruggegeven, rest wel", async () => {
  const k = { verdiend: ["strepen"], huidig: "strepen", start: "strepen", bijgewerkt: 1 };
  const uit = mergeSync({ katten: k }, { katten: k, progress: { l1: { updated: 1 } }, updated: 5 }, NU);
  assert.deepEqual(Object.keys(uit).sort(), ["cats", "lists", "progress", "updated"]);
  assert.deepEqual(uit.progress, { l1: vg(1) });

  // via de handler, met een oud katten-veld al in KV
  const kv = nepKV({ "learner:pia": { katten: k, progress: { l0: { updated: 1 } }, updated: 1 } });
  const get1 = await (await worker.fetch(new Request("https://api.test/sync/pia", { headers: { "x-api-token": "geheim" } }), env(kv))).json();
  assert.equal("katten" in get1, false, "GET geeft katten niet terug");
  assert.deepEqual(get1.progress, { l0: vg(1) });

  const res = await worker.fetch(put({ katten: k, extra: "x", progress: { l1: { updated: 2 } }, updated: 5 }), env(kv));
  assert.equal(res.status, 200);
  const terug = await res.json();
  assert.equal("katten" in terug, false);
  assert.equal("extra" in terug, false);
  assert.equal("katten" in opgeslagen(kv), false);
  assert.equal("extra" in opgeslagen(kv), false);
  assert.deepEqual(opgeslagen(kv).progress, { l0: vg(1), l1: vg(2) });

  // ook een rare katten-waarde (veel items, kapot, __proto__) houdt niets tegen
  const raar = [Array.from({ length: 50 }, () => "strepen"), "x", null, JSON.parse('{"__proto__":{"a":1}}')];
  for (const r of raar) {
    const antw = await worker.fetch(put({ katten: r, updated: 6 }), env(kv));
    assert.equal(antw.status, 200);
    assert.equal("katten" in opgeslagen(kv), false);
  }
});

test("__proto__ in progress, cats en lists vervuilt niets", () => {
  const body = JSON.parse(
    '{"progress":{"__proto__":{"vervuild":true},"constructor":{"x":1},"l1":{"updated":3}},' +
      '"cats":{"__proto__":{"laatst":9}},"lists":[{"id":"__proto__","title":"t","items":[],"added":1},{"id":"a","title":"t","items":[],"added":1}]}',
  );
  const uit = mergeSync({}, body, NU);
  assert.equal(({}).vervuild, undefined);
  assert.equal(Object.getPrototypeOf(uit.progress), Object.prototype);
  assert.deepEqual(Object.keys(uit.progress), ["l1"]);
  assert.deepEqual(Object.keys(uit.cats), []);
  assert.deepEqual(uit.lists.map(l => l.id), ["a"]);
});

test("updated in de toekomst wordt begrensd tot nu plus 5 minuten", () => {
  assert.equal(mergeSync({}, { updated: 1e20 }, NU).updated, NU + MARGE);
  assert.equal(mergeSync({}, { updated: -5 }, NU).updated, 0);
  assert.equal(mergeSync({ updated: 1e20 }, {}, NU).updated, NU + MARGE);
});

test("kapot progress houdt cats en de rest niet tegen", async () => {
  const kv = nepKV({ "learner:pia": { progress: { l1: { updated: 5 } } } });
  for (const progress of [null, "kapot", 42, ["a"], { l2: null, l3: "x", l4: [1], l5: { updated: 9 } }]) {
    const res = await worker.fetch(put({ progress, cats: { s: { laatst: 2, aantal: 1 } }, updated: 7 }), env(kv));
    assert.equal(res.status, 200, JSON.stringify(progress));
    const o = opgeslagen(kv);
    assert.equal(o.progress.l1.updated, 5);
    assert.equal("l2" in o.progress || "l3" in o.progress || "l4" in o.progress, false);
    assert.deepEqual(o.cats.s, { laatst: 2, aantal: 1 });
    assert.equal(o.updated, 7);
  }
});

test("kapotte cats, lists en remote uit KV houden de sync niet tegen", () => {
  const uit = mergeSync(
    { cats: "x", progress: [1], lists: { id: 1 }, katten: "oud", updated: "gisteren" },
    { cats: { a: null, b: { laatst: 1 } }, lists: [null, 1, { id: null }, { id: "x", title: "t", items: [], added: 2 }], updated: NU },
    NU,
  );
  assert.deepEqual(uit.cats, { b: { laatst: 1 } });
  assert.deepEqual(uit.lists, [{ id: "x", title: "t", added: 2, items: [] }]);
  assert.deepEqual(uit.progress, {});
  assert.equal(uit.updated, NU);
});

// ---------- handler: grenzen en foutvorm ----------

test("verzoek boven 1 MB krijgt 413, met en zonder Content-Length", async () => {
  const kv = nepKV();
  const groot = JSON.stringify({ progress: { l1: { pad: "x".repeat(1024 * 1024) } } });
  const r1 = await worker.fetch(put(null, { raw: groot }), env(kv));
  assert.equal(r1.status, 413);
  // stream zonder lengte
  const stream = new ReadableStream({
    start(c) { c.enqueue(new TextEncoder().encode(groot)); c.close(); },
  });
  const req = new Request("https://api.test/sync/pia", {
    method: "PUT", headers: { "x-api-token": "geheim" }, body: stream, duplex: "half",
  });
  assert.equal(req.headers.get("content-length"), null);
  const r2 = await worker.fetch(req, env(kv));
  assert.equal(r2.status, 413);
  assert.equal(kv.puts, 0);
  // net onder de grens gaat goed
  const klein = JSON.stringify({ progress: { l1: { pad: "x".repeat(1000 * 1000) } } });
  const r3 = await worker.fetch(put(null, { raw: klein }), env(kv));
  assert.equal(r3.status, 200);
});

test("ongeldige JSON of geen object geeft 400, niet 500", async () => {
  for (const raw of ["{kapot", "[]", "null", "12"]) {
    const res = await worker.fetch(put(null, { raw }), env());
    assert.equal(res.status, 400, raw);
  }
});

// ---------- CORS ----------

test("CORS: alleen de twee bekende origins komen terug", async () => {
  for (const origin of ["https://overhoren.vandaan.net", "https://dspbrg.github.io"]) {
    const pre = await worker.fetch(new Request("https://api.test/sync/pia", {
      method: "OPTIONS",
      headers: { Origin: origin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type,x-api-token" },
    }), env());
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), origin);
    assert.match(pre.headers.get("access-control-allow-methods"), /PUT/);
    assert.match(pre.headers.get("access-control-allow-headers"), /x-api-token/);
    const res = await worker.fetch(put({ updated: 1 }, { origin }), env());
    assert.equal(res.headers.get("access-control-allow-origin"), origin);
    assert.match(res.headers.get("vary"), /Origin/);
  }
  for (const origin of ["https://evil.example", "https://dspbrg.github.io.evil.example", "null", "*"]) {
    const res = await worker.fetch(put({ updated: 1 }, { origin }), env());
    assert.equal(res.headers.get("access-control-allow-origin"), null, origin);
  }
  const zonder = await worker.fetch(new Request("https://api.test/x", { headers: { "x-api-token": "geheim" } }), env());
  assert.equal(zonder.headers.get("access-control-allow-origin"), null);
  // 401 voor een bekende origin draagt wel de CORS-kop, zodat de app de fout kan lezen
  const nee = await worker.fetch(new Request("https://api.test/sync/pia", { headers: { Origin: "https://dspbrg.github.io" } }), env());
  assert.equal(nee.status, 401);
  assert.equal(nee.headers.get("access-control-allow-origin"), "https://dspbrg.github.io");
});

// ---------- foutmeldingen van de Anthropic-API ----------

test("fout van de Anthropic-API: algemene melding naar de client, details alleen in console.error", async (t) => {
  const geheimDetail = "invalid x-api-key sk-ant-detail-123";
  t.mock.method(globalThis, "fetch", async () => new Response(geheimDetail, { status: 401 }));
  const logs = [];
  t.mock.method(console, "error", (...a) => logs.push(a.join(" ")));
  const res = await worker.fetch(new Request("https://api.test/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": "geheim", Origin: "https://overhoren.vandaan.net" },
    body: JSON.stringify({ items: [{ word: "a", def: "b" }] }),
  }), env());
  assert.ok(res.status >= 500);
  const tekst = await res.text();
  assert.equal(tekst.includes("sk-ant"), false);
  assert.equal(tekst.includes("Claude API"), false);
  assert.ok(logs.some(l => l.includes(geheimDetail)), "details in console.error");
});

test("samengevoegd record boven 2 MiB: 413 en niet opslaan", async () => {
  // een geldige eigen lijst van ongeveer `kb` KiB: woorden met een lange definitie
  const grootLijst = (id, kb) => ({ id, title: id, items: Array.from({ length: kb }, () => ({ word: "w", def: "x".repeat(1000) })) });
  const kv = nepKV({ "learner:pia": { lists: [grootLijst("oud", 1200)] } });
  const voor = kv.data.get("learner:pia");
  const res = await worker.fetch(put({ lists: [grootLijst("nieuw", 900)] }), env(kv));
  assert.equal(res.status, 413);
  assert.equal(kv.puts, 0);
  assert.equal(kv.data.get("learner:pia"), voor);
  // klein genoeg samen: wel opslaan
  const res2 = await worker.fetch(put({ lists: [grootLijst("nieuw", 500)] }), env(kv));
  assert.equal(res2.status, 200);
  assert.equal(kv.puts, 1);
});

function ai(pad, raw, extra = {}) {
  return new Request("https://api.test" + pad, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-token": "geheim", ...extra },
    body: raw,
  });
}

test("/extract en /enrich: grenzen, kapotte JSON en te veel items, zonder AI-aanroep", async (t) => {
  let aanroepen = 0;
  t.mock.method(globalThis, "fetch", async () => {
    aanroepen++;
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"items":[]}' }] }), { status: 200 });
  });
  const gevallen = [
    ["/extract", "{kapot", 400],
    ["/extract", "[]", 400],
    ["/extract", JSON.stringify({ image: 12 }), 400],
    ["/extract", JSON.stringify({ image: "abc", mediaType: "text/html" }), 400],
    ["/extract", JSON.stringify({ image: "a".repeat(8 * 1024 * 1024 + 10) }), 413],
    ["/enrich", "{kapot", 400],
    ["/enrich", JSON.stringify({ items: "a" }), 400],
    ["/enrich", JSON.stringify({ items: Array.from({ length: 201 }, () => ({ word: "a", def: "b" })) }), 400],
    ["/enrich", JSON.stringify({ items: [{ word: "a".repeat(65 * 1024), def: "b" }] }), 413],
  ];
  for (const [pad, raw, status] of gevallen) {
    const res = await worker.fetch(ai(pad, raw), env());
    assert.equal(res.status, status, pad + " " + raw.slice(0, 40));
  }
  assert.equal(aanroepen, 0, "geen betaalde aanroep bij ongeldige invoer");
  // geldige verzoeken gaan wel door
  const ok1 = await worker.fetch(ai("/enrich", JSON.stringify({ items: Array.from({ length: 200 }, () => ({ word: "a", def: "b" })) })), env());
  assert.equal(ok1.status, 200);
  const ok2 = await worker.fetch(ai("/extract", JSON.stringify({ image: "a".repeat(5 * 1024 * 1024), mediaType: "image/jpeg", subjectHint: null })), env());
  assert.equal(ok2.status, 200);
  assert.equal(aanroepen, 2);
});

// ---------- vorm van wat in cats, progress en lists zit ----------
// Alleen het object zijn is niet genoeg: de app leest p.sessions.slice,
// l.items.length en s.box. Een onderdeel met de verkeerde vorm valt weg op
// het kleinste niveau dat veilig is; de rest blijft staan.

const staat = (extra = {}) => ({ box: 2, due: 5, seen: 3, correct: 2, wrong: 1, lapses: 1, streak: 1, last: 4,
  dirWrong: { wd: 1, dw: 0, ex: 0 }, partWrong: { cls: 0, def: 1, word: 0 }, ...extra });
const ronde = (extra = {}) => ({ date: 10, n: 5, first: 4, ms: 1000, stopped: false, ...extra });
const lijst = (extra = {}) => ({ id: "custom-1", title: "Lijst", subject: "Engels", added: 3,
  items: [{ word: "cat", def: "kat" }, { word: "dog", def: "hond", cls: "Noun", section: "A" }], ...extra });

test("vorm: voortgang met kapotte items of sessions wordt een veilige voortgang", () => {
  const body = { progress: {
    a: { items: "kapot", sessions: "kapot", updated: 5 },
    b: { items: [staat()], sessions: { 0: ronde() }, updated: 6 },
    c: { items: { 0: staat(), 1: null, 2: "x", 3: staat({ box: "<b>" }), 4: staat({ due: Infinity }), abc: staat(), 5: staat({ extra: "weg" }) },
         sessions: [ronde(), null, 7, ronde({ ms: "lang" }), ronde({ n: NaN }), ronde({ stopped: "ja", extra: 1 })], updated: 7 },
    d: { updated: 8 },
    e: { items: {}, sessions: [], updated: "gisteren" },
  } };
  const uit = mergeSync({}, body, NU);
  assert.deepEqual(uit.progress.a, { items: {}, sessions: [], updated: 5 });
  assert.deepEqual(uit.progress.b, { items: {}, sessions: [], updated: 6 });
  assert.deepEqual(Object.keys(uit.progress.c.items), ["0", "3", "4", "5"]);
  assert.deepEqual(uit.progress.c.items[0], staat());
  assert.deepEqual(uit.progress.c.items[3], staat({ box: 0 }), "kapotte box wordt 0, de toestand blijft");
  assert.deepEqual(uit.progress.c.items[4], staat({ due: 0 }), "kapotte due wordt 0, de toestand blijft");
  assert.deepEqual(uit.progress.c.items[5], staat(), "onbekende velden in een woordtoestand vallen weg");
  assert.deepEqual(uit.progress.c.sessions, [ronde(), ronde({ stopped: false })], "stopped is altijd een boolean");
  assert.deepEqual(uit.progress.d, { items: {}, sessions: [], updated: 8 });
  assert.deepEqual(uit.progress.e, { items: {}, sessions: [] });
  for (const p of Object.values(uit.progress)) {
    assert.ok(Array.isArray(p.sessions));
    assert.ok(p.items && typeof p.items === "object" && !Array.isArray(p.items));
  }
});

test("vorm: woordtoestand vult ontbrekende tellers aan, kapotte tellers in dirWrong en partWrong worden 0", () => {
  const uit = mergeSync({}, { progress: { a: { items: {
    0: { box: 1, seen: 1 },
    1: staat({ dirWrong: "x", partWrong: { cls: "veel", def: 2, word: null, extra: 9 } }),
  }, sessions: [], updated: 1 } } }, NU);
  const s0 = uit.progress.a.items[0];
  assert.equal(s0.box, 1);
  for (const k of ["due", "correct", "wrong", "lapses", "streak", "last"]) assert.equal(s0[k], 0, k);
  assert.deepEqual(s0.dirWrong, { wd: 0, dw: 0, ex: 0 });
  assert.deepEqual(uit.progress.a.items[1].dirWrong, { wd: 0, dw: 0, ex: 0 });
  assert.deepEqual(uit.progress.a.items[1].partWrong, { cls: 0, def: 2, word: 0 });
});

test("vorm: lijst zonder items-array valt weg, een kapot woord of kapotte titel wordt hersteld", () => {
  const uit = mergeSync({}, { lists: [
    lijst({ id: "goed" }),
    lijst({ id: "geen-items", items: undefined }),
    lijst({ id: "items-tekst", items: "kapot" }),
    lijst({ id: "items-object", items: { 0: { word: "a", def: "b" } } }),
    // een woord weglaten zou de nummering van de voortgang verschuiven,
    // dus een kapot woord wordt een leeg woord op dezelfde plek
    lijst({ id: "woord-null", items: [{ word: "a", def: "b" }, null] }),
    lijst({ id: "woord-getal", items: [{ word: 5, def: "b" }] }),
    lijst({ id: "geen-def", items: [{ word: "a" }] }),
    lijst({ id: "geen-titel", title: undefined }),
    lijst({ id: "titel-getal", title: 7 }),
    lijst({ id: "x".repeat(101) }),
    lijst({ id: "leeg", items: [] }),
  ] }, NU);
  const per = Object.fromEntries(uit.lists.map(l => [l.id, l]));
  assert.deepEqual(Object.keys(per), ["goed", "woord-null", "woord-getal", "geen-def", "geen-titel", "titel-getal", "leeg"]);
  assert.deepEqual(per.goed, lijst({ id: "goed" }));
  assert.deepEqual(per["woord-null"].items, [{ word: "a", def: "b" }, { word: "", def: "" }]);
  assert.deepEqual(per["woord-getal"].items, [{ word: "", def: "b" }]);
  assert.deepEqual(per["geen-def"].items, [{ word: "a", def: "" }]);
  assert.equal(per["geen-titel"].title, "");
  assert.equal(per["titel-getal"].title, "");
});

test("vorm: kapotte losse velden van een lijst of woord vallen weg, de lijst blijft", () => {
  const body = JSON.parse(JSON.stringify({ lists: [lijst({
    subtitle: 5, subject: ["Engels"], mode: { a: 1 }, from: "Frans", to: null, deadline: "2026-09-17",
    directions: ["wd", "zz", 3], strict: "ja", interleave: true, added: "gisteren",
    sections: { A: "In de klas", B: 7 }, classes: ["Noun", 3],
    instructions: "kapot", mix: true, bronnen: ["a"], extra: "weg",
    items: [
      { word: "a", def: "b", cls: 3, section: "A", ex: "Een [kat] zit.", keys: [["kat", "poes"], "los", [1]], accept: ["kat", 2], bron: { lid: "x" } },
      { word: "c", def: "d", ex: ["Zin [een].", 4], keys: "x", accept: "kat" },
      { word: "e", def: "f", ex: 12 },
    ],
  })] }));
  body.lists[0].sections = JSON.parse('{"A":"In de klas","B":7,"__proto__":"x"}');
  const l = mergeSync({}, body, NU).lists[0];
  assert.deepEqual(Object.keys(l).sort(), ["classes", "deadline", "directions", "from", "id", "interleave", "items", "sections", "title"]);
  assert.equal(l.from, "Frans");
  assert.deepEqual(l.directions, ["wd"]);
  assert.deepEqual(l.sections, { A: "In de klas" });
  assert.equal(Object.getPrototypeOf(l.sections), Object.prototype);
  assert.deepEqual(l.classes, ["Noun"]);
  assert.equal(l.interleave, true);
  assert.equal("mix" in l || "bronnen" in l, false, "een lijst van buiten mag geen gemengde lijst worden");
  assert.deepEqual(l.items[0], { word: "a", def: "b", section: "A", ex: "Een [kat] zit.", keys: [["kat", "poes"]], accept: ["kat"] });
  assert.deepEqual(l.items[1], { word: "c", def: "d", ex: ["Zin [een]."] });
  assert.deepEqual(l.items[2], { word: "e", def: "f" });
});

test("vorm: cats-waarden met kapotte getallen vallen weg, onbekende velden ook", () => {
  const uit = mergeSync({}, { cats: {
    "cats/a.svg": { aantal: 2, eerst: 1, laatst: 3, extra: "<b>" },
    "cats/b.svg": { aantal: "veel", laatst: 1 },
    "cats/c.svg": { laatst: Infinity },
    "cats/d.svg": {},
    ["c".repeat(201)]: { laatst: 1 },
  } }, NU);
  assert.deepEqual(uit.cats, { "cats/a.svg": { aantal: 2, eerst: 1, laatst: 3 }, "cats/d.svg": {} });
});

test("vorm: kapotte vormen die al in KV staan gaan niet terug naar de app, de goede wel", async () => {
  const kv = nepKV({ "learner:pia": {
    progress: { a: { items: "x", sessions: "x", updated: 1 }, b: { items: { 0: staat() }, sessions: [ronde()], updated: 2 } },
    lists: [lijst({ id: "kapot", items: "x" }), lijst({ id: "goed" })],
    cats: { "cats/a.svg": { laatst: "x" } },
    updated: 3,
  } });
  const terug = await (await worker.fetch(new Request("https://api.test/sync/pia", { headers: { "x-api-token": "geheim" } }), env(kv))).json();
  assert.deepEqual(terug.progress.a, { items: {}, sessions: [], updated: 1 });
  assert.deepEqual(terug.progress.b, { items: { 0: staat() }, sessions: [ronde()], updated: 2 });
  assert.deepEqual(terug.lists.map(l => l.id), ["goed"]);
  assert.deepEqual(terug.cats, {});
  // een PUT schrijft de opgeschoonde versie weg
  const res = await worker.fetch(put({ updated: 4 }), env(kv));
  assert.equal(res.status, 200);
  assert.deepEqual(opgeslagen(kv).progress.a, { items: {}, sessions: [], updated: 1 });
  assert.deepEqual(opgeslagen(kv).lists.map(l => l.id), ["goed"]);
});

// ---------- herstellen in plaats van weggooien, en tijden begrenzen ----------

test("vorm: een te lang woord, een te lange titel of te veel woorden worden afgekapt, de lijst blijft", () => {
  const uit = mergeSync({}, { lists: [
    lijst({ id: "lange-titel", title: "t".repeat(250) }),
    lijst({ id: "lang-woord", items: [{ word: "w".repeat(1500), def: "d".repeat(1200), cls: "c".repeat(300), ex: "e".repeat(1100) }] }),
    lijst({ id: "te-veel", items: Array.from({ length: 5003 }, (_, i) => ({ word: "a" + i, def: "b" })) }),
    lijst({ id: "kapotte-woorden", items: [{ word: 5, def: "b" }, null, { word: "a" }, "x", { word: "c", def: "d" }] }),
    lijst({ id: "geen-titel", title: undefined }),
    lijst({ id: "lange-lijstjes", items: [{ word: "a", def: "b", accept: Array.from({ length: 60 }, (_, i) => "x" + i) }] }),
  ] }, NU);
  const per = Object.fromEntries(uit.lists.map(l => [l.id, l]));
  assert.deepEqual(Object.keys(per), ["lange-titel", "lang-woord", "te-veel", "kapotte-woorden", "geen-titel", "lange-lijstjes"]);
  assert.equal(per["lange-titel"].title, "t".repeat(200));
  assert.deepEqual(per["lang-woord"].items[0], { word: "w".repeat(1000), def: "d".repeat(1000), cls: "c".repeat(200), ex: "e".repeat(1000) });
  assert.equal(per["te-veel"].items.length, 5000);
  assert.equal(per["te-veel"].items[4999].word, "a4999");
  // de nummering blijft: elk kapot woord wordt een leeg woord op dezelfde plek
  assert.deepEqual(per["kapotte-woorden"].items, [
    { word: "", def: "b" }, { word: "", def: "" }, { word: "a", def: "" }, { word: "", def: "" }, { word: "c", def: "d" }]);
  assert.equal(per["geen-titel"].title, "");
  assert.equal(per["lange-lijstjes"].items[0].accept.length, 50);
});

test("vorm: alleen een lijst zonder geldig id of zonder items-array valt weg", () => {
  const uit = mergeSync({}, { lists: [
    lijst({ id: "goed" }), lijst({ id: "x".repeat(101) }), lijst({ id: null }), lijst({ id: "__proto__" }),
    lijst({ id: "geen-items", items: undefined }), lijst({ id: "items-object", items: { 0: { word: "a", def: "b" } } }),
  ] }, NU);
  assert.deepEqual(uit.lists.map(l => l.id), ["goed"]);
});

test("vorm: een kapot getal in een woordtoestand wordt 0, de rest van de toestand blijft", () => {
  const uit = mergeSync({}, { progress: { a: { items: {
    0: staat({ due: null }), 1: staat({ seen: "veel", last: Infinity }), 2: staat({ correct: NaN }),
  }, sessions: [], updated: 1 } } }, NU);
  assert.deepEqual(uit.progress.a.items[0], staat({ due: 0 }));
  assert.deepEqual(uit.progress.a.items[1], staat({ seen: 0, last: 0 }));
  assert.deepEqual(uit.progress.a.items[2], staat({ correct: 0 }));
});

test("vorm: box is een heel getal van 0 tot en met MAX_BOX, tellers zijn niet negatief", async () => {
  const { MAX_BOX } = await import(pathToFileURL(join(SRC, "merge.js")).href);
  const engine = createRequire(import.meta.url)(join(REPO, "engine.js"));
  assert.equal(MAX_BOX, engine.MAX_BOX, "MAX_BOX in merge.js wijkt af van engine.js");
  const uit = mergeSync({}, { progress: { a: { items: {
    0: staat({ box: -4 }), 1: staat({ box: 2.5 }), 2: staat({ box: 99 }),
    3: staat({ seen: -1, correct: -2, wrong: -3, lapses: -4, streak: -5, due: -6, last: -7,
      dirWrong: { wd: -1, dw: 2, ex: 0 }, partWrong: { cls: -1, def: 0, word: 3 } }),
  }, sessions: [], updated: 1 } } }, NU);
  const it = uit.progress.a.items;
  assert.equal(it[0].box, 0);
  assert.equal(it[1].box, 2);
  assert.equal(it[2].box, engine.MAX_BOX);
  for (const k of ["seen", "correct", "wrong", "lapses", "streak", "due", "last"]) assert.equal(it[3][k], 0, k);
  assert.deepEqual(it[3].dirWrong, { wd: 0, dw: 2, ex: 0 });
  assert.deepEqual(it[3].partWrong, { cls: 0, def: 0, word: 3 });
});

test("tijden: added, progress.updated, cats.laatst en cats.eerst worden begrensd op 0 tot nu plus 5 minuten", () => {
  const uit = mergeSync({}, {
    lists: [lijst({ id: "a", added: 1e308 }), lijst({ id: "b", added: -5 })],
    progress: { p: vg(1e308), q: vg(-1) },
    cats: { "cats/a.svg": { laatst: 1e308, eerst: 1e308, aantal: -3 }, "cats/b.svg": { laatst: -1, eerst: -2 } },
  }, NU);
  assert.equal(uit.lists[0].added, NU + MARGE);
  assert.equal(uit.lists[1].added, 0);
  assert.equal(uit.progress.p.updated, NU + MARGE);
  assert.equal(uit.progress.q.updated, 0);
  assert.deepEqual(uit.cats["cats/a.svg"], { laatst: NU + MARGE, eerst: NU + MARGE, aantal: 0 });
  assert.deepEqual(uit.cats["cats/b.svg"], { laatst: 0, eerst: 0 });
});

test("tijden: een tijd in de toekomst wint niet van data die al op de grens staat", () => {
  const remote = { lists: [lijst({ id: "a", title: "Echt", added: NU + MARGE })], progress: { p: vg(NU + MARGE) },
    cats: { k: { laatst: NU + MARGE, aantal: 1 } } };
  const uit = mergeSync(remote, { lists: [lijst({ id: "a", title: "Aanval", added: 1e308 })],
    progress: { p: { items: { 0: staat() }, sessions: [], updated: 1e308 } }, cats: { k: { laatst: 1e308, eerst: 5, aantal: 1 } } }, NU);
  assert.equal(uit.lists[0].title, "Echt");
  assert.deepEqual(uit.progress.p, vg(NU + MARGE));
  assert.deepEqual(uit.cats.k, { laatst: NU + MARGE, aantal: 1 });
});

test("tijden: de aanval met 1e308 overschrijft andermans lijst en voortgang niet voorgoed", async () => {
  const kv = nepKV();
  const e = env(kv);
  const echtNu = Date.now;
  try {
    Date.now = () => NU;
    const aanval = { lists: [lijst({ id: "a", title: "Aanval", added: 1e308 })], progress: { p: { items: {}, sessions: [], updated: 1e308 } },
      cats: { k: { laatst: 1e308, aantal: 9 } }, updated: 1e308 };
    assert.equal((await worker.fetch(put(aanval), e)).status, 200);
    const o = opgeslagen(kv);
    assert.equal(o.lists[0].added, NU + MARGE);
    assert.equal(o.progress.p.updated, NU + MARGE);
    assert.equal(o.cats.k.laatst, NU + MARGE);
    // tien minuten later wint een gewone wijziging weer
    const later = NU + 10 * 60 * 1000;
    Date.now = () => later;
    const echt = { lists: [lijst({ id: "a", title: "Echt", added: later })], progress: { p: { items: { 0: staat() }, sessions: [], updated: later } },
      cats: { k: { laatst: later, aantal: 1 } }, updated: later };
    assert.equal((await worker.fetch(put(echt), e)).status, 200);
    const n = opgeslagen(kv);
    assert.equal(n.lists[0].title, "Echt");
    assert.equal(n.progress.p.updated, later);
    assert.deepEqual(n.progress.p.items[0], staat());
    assert.equal(n.cats.k.laatst, later);
  } finally {
    Date.now = echtNu;
  }
});
