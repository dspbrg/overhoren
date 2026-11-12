// Samenvoegen van sync-data. Pure functies zonder Cloudflare, zodat de tests
// ze met `node --test` kunnen draaien. index.js gebruikt ze voor PUT /sync.
//
// Uitgangspunten:
// - Alles wat binnenkomt (van de client en uit KV) gaat eerst door een
//   controle. Een kapot onderdeel valt weg, de rest blijft staan.
// - Resultaten worden als nieuw object opgebouwd. Geen Object.assign of
//   for...in op invoer, en sleutels als __proto__ komen er niet in.

// speling voor klokken die iets voorlopen
export const TOEKOMST_MARGE_MS = 5 * 60 * 1000;

const VERBODEN_SLEUTELS = new Set(["__proto__", "constructor", "prototype"]);

// Fout die als HTTP-status naar de client gaat (bijvoorbeeld 400 of 413).
export class HttpFout extends Error {
  constructor(status, melding) {
    super(melding);
    this.status = status;
  }
}

function isObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function veiligeSleutel(k) {
  return typeof k === "string" && k.length > 0 && !VERBODEN_SLEUTELS.has(k);
}

// Tijdstempel als getal: eindig en niet negatief, anders 0.
function tijd(v) {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

// Begrens een tijd tussen 0 en nu plus de marge.
export function begrens(t, nu) {
  return Math.min(Math.max(t, 0), nu + TOEKOMST_MARGE_MS);
}

// ---------- cats, progress, lists ----------

// Een object met objectwaarden. Geen object: null (veld telt niet mee).
// Losse kapotte waarden of verboden sleutels vallen weg.
export function controleerMap(d) {
  if (!isObject(d)) return null;
  const out = {};
  for (const k of Object.keys(d)) {
    if (!veiligeSleutel(k) || !isObject(d[k])) continue;
    out[k] = d[k];
  }
  return out;
}

// Een lijst van objecten met een id (string of getal). Kapotte items vallen weg.
export function controleerLists(d) {
  if (!Array.isArray(d)) return null;
  const out = [];
  for (const l of d) {
    if (!isObject(l)) continue;
    const id = l.id;
    if (typeof id === "number" ? !Number.isFinite(id) : !veiligeSleutel(id)) continue;
    out.push(l);
  }
  return out;
}

function mergeCats(a, b) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k];
  for (const k of Object.keys(b)) {
    const oud = out[k];
    if (!oud || tijd(b[k].laatst) > tijd(oud.laatst)) {
      out[k] = b[k];
    } else {
      const aantal = Math.max(tijd(oud.aantal), tijd(b[k].aantal));
      out[k] = { ...oud, aantal };
    }
  }
  return out;
}

function mergeProgress(a, b) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k];
  for (const k of Object.keys(b)) {
    if (!out[k] || tijd(b[k].updated) > tijd(out[k].updated)) out[k] = b[k];
  }
  return out;
}

function mergeLists(a, b) {
  const byId = new Map();
  for (const l of a) byId.set(String(l.id), l);
  for (const l of b) {
    const oud = byId.get(String(l.id));
    if (!oud || tijd(l.added) > tijd(oud.added)) byId.set(String(l.id), l);
  }
  return Array.from(byId.values());
}

// remote: wat in KV staat, local: de body van de PUT.
// Het resultaat bevat alleen cats, progress, lists en updated. Andere velden
// (zoals het vervallen `katten`) worden niet opgeslagen en niet teruggegeven.
export function mergeSync(remote, local, nu = Date.now()) {
  const r = isObject(remote) ? remote : {};
  const l = isObject(local) ? local : {};
  return {
    cats: mergeCats(controleerMap(r.cats) || {}, controleerMap(l.cats) || {}),
    progress: mergeProgress(controleerMap(r.progress) || {}, controleerMap(l.progress) || {}),
    lists: mergeLists(controleerLists(r.lists) || [], controleerLists(l.lists) || []),
    updated: Math.max(begrens(tijd(r.updated), nu), begrens(tijd(l.updated), nu)),
  };
}
