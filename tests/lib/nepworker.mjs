// De echte sync-worker (worker/src/index.js) achter de browser, zonder
// Cloudflare en zonder internet: verzoeken van de app naar workers.dev gaan
// via context.route naar worker.fetch, met KV, de Durable Object en het
// tempo in het geheugen. Twee browsercontexten met dezelfde nepWorker zijn
// twee toestellen op dezelfde server.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { REPO } from "./omgeving.mjs";

const SRC = process.env.WORKER_SRC || join(REPO, "worker", "src");
const mod = await import(pathToFileURL(join(SRC, "index.js")).href);
const worker = mod.default;

function nepKV(begin = {}) {
  const data = new Map(Object.entries(begin).map(([k, v]) => [k, JSON.stringify(v)]));
  return {
    data,
    async get(k, type) {
      if (!data.has(k)) return null;
      return type === "json" ? JSON.parse(data.get(k)) : data.get(k);
    },
    async put(k, v) { data.set(k, v); },
  };
}
function nepTeller() {
  const data = new Map();
  const kv = {
    get: k => (data.has(k) ? structuredClone(data.get(k)) : undefined),
    put: (k, v) => { data.set(k, structuredClone(v)); },
    delete: k => data.delete(k),
  };
  const instantie = new mod.FotoTeller({ storage: { kv } }, {});
  return { data, idFromName: n => n, get: () => ({ fetch: (url, init) => instantie.fetch(new Request(url, init)) }) };
}
const ruim = { async limit() { return { success: true }; } };

// kv: wat er al in KV staat, zoals { "learner:pia": {...} }.
export function nepWorker(kv = {}) {
  const env = {
    SYNC: nepKV(kv), TELLER: nepTeller(), FOTO_TEMPO: ruim, SYNC_TEMPO: ruim,
    APP_SECRET: "geheim", ALLOWED_ORIGIN: "https://overhoren.vandaan.net", ANTHROPIC_API_KEY: "test",
  };
  const verzoeken = [];
  // uit = true: de worker is onbereikbaar (de verbinding mislukt). Verzoeken
  // worden nog wel genoteerd, zodat een test ziet dat de app het probeerde.
  const stand = { uit: false };
  const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "GET,PUT,POST" };
  // Na schermNetwerkAf registreren: de laatste route gaat voor.
  async function koppel(context) {
    await context.route(/workers\.dev\//, async route => {
      const r = route.request();
      const url = new URL(r.url());
      if (r.method() === "OPTIONS") return route.fulfill({ status: 204, headers: CORS });
      const koppen = r.headers();
      verzoeken.push({ methode: r.method(), pad: url.pathname, koppen, uit: stand.uit, body: r.postData() });
      if (stand.uit) return route.abort("connectionrefused");
      const body = ["GET", "HEAD"].includes(r.method()) ? undefined : r.postDataBuffer();
      const res = await worker.fetch(new Request("https://api.test" + url.pathname, {
        method: r.method(), headers: { ...koppen, "CF-Connecting-IP": "203.0.113.5" }, body,
      }), env);
      return route.fulfill({ status: res.status, contentType: "application/json", body: await res.text(), headers: CORS });
    });
  }
  return {
    env, verzoeken, koppel,
    get uit() { return stand.uit; }, set uit(v) { stand.uit = !!v; },
    kv: k => (env.SYNC.data.has(k) ? JSON.parse(env.SYNC.data.get(k)) : undefined),
    sleutels: () => [...env.SYNC.data.keys()],
    migratie: slug => env.TELLER.data.get("migratie:" + slug),
  };
}
