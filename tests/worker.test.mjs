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
import { REPO } from "./lib/omgeving.mjs";

const SRC = process.env.WORKER_SRC || join(REPO, "worker", "src");
const { mergeSync } = await import(pathToFileURL(join(SRC, "merge.js")).href);
const worker = (await import(pathToFileURL(join(SRC, "index.js")).href)).default;

const NU = 1_800_000_000_000;
const MARGE = 5 * 60 * 1000;
const json = x => JSON.parse(JSON.stringify(x));

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
  assert.deepEqual(uit.progress, { l1: { updated: 1 } });

  // via de handler, met een oud katten-veld al in KV
  const kv = nepKV({ "learner:pia": { katten: k, progress: { l0: { updated: 1 } }, updated: 1 } });
  const get1 = await (await worker.fetch(new Request("https://api.test/sync/pia", { headers: { "x-api-token": "geheim" } }), env(kv))).json();
  assert.equal("katten" in get1, false, "GET geeft katten niet terug");
  assert.deepEqual(get1.progress, { l0: { updated: 1 } });

  const res = await worker.fetch(put({ katten: k, extra: "x", progress: { l1: { updated: 2 } }, updated: 5 }), env(kv));
  assert.equal(res.status, 200);
  const terug = await res.json();
  assert.equal("katten" in terug, false);
  assert.equal("extra" in terug, false);
  assert.equal("katten" in opgeslagen(kv), false);
  assert.equal("extra" in opgeslagen(kv), false);
  assert.deepEqual(opgeslagen(kv).progress, { l0: { updated: 1 }, l1: { updated: 2 } });

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
      '"cats":{"__proto__":{"laatst":9}},"lists":[{"id":"__proto__","added":1},{"id":"a","added":1}]}',
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
    { cats: { a: null, b: { laatst: 1 } }, lists: [null, 1, { id: null }, { id: "x", added: 2 }], updated: NU },
    NU,
  );
  assert.deepEqual(uit.cats, { b: { laatst: 1 } });
  assert.deepEqual(uit.lists, [{ id: "x", added: 2 }]);
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
  const groot = "x".repeat(1024 * 1024 + 200 * 1024);
  const kv = nepKV({ "learner:pia": { progress: { oud: { pad: groot } } } });
  const voor = kv.data.get("learner:pia");
  const res = await worker.fetch(put({ progress: { nieuw: { pad: "y".repeat(900 * 1024) } } }), env(kv));
  assert.equal(res.status, 413);
  assert.equal(kv.puts, 0);
  assert.equal(kv.data.get("learner:pia"), voor);
  // klein genoeg samen: wel opslaan
  const res2 = await worker.fetch(put({ progress: { nieuw: { pad: "y".repeat(500 * 1024) } } }), env(kv));
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
