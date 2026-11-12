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

// ---------- vorm ----------
// Dezelfde regels staan in index.html (applyRemote). Pas ze samen aan.
//
// Elk onderdeel wordt als nieuw object opgebouwd met alleen de bekende
// velden. Wat de verkeerde vorm heeft, valt weg op het kleinste niveau dat
// veilig is:
// - een kapotte teller in dirWrong of partWrong wordt 0;
// - een woordtoestand of ronde met een kapot getal valt weg;
// - items of sessions met de verkeerde vorm worden leeg;
// - een los optioneel veld van een lijst of woord valt weg;
// - een woord zonder geldige word/def laat de hele lijst vallen, want een
//   woord weglaten verschuift de nummering waar de voortgang op leunt.

export const GRENS = {
  id: 100,         // id van een lijst
  sleutel: 200,    // sleutel in cats
  tekst: 200,      // titel, vak, woordsoort, sectie en dergelijke
  woord: 1000,     // word, def, ex, keys en accept
  woorden: 5000,   // woorden per lijst
  lijstje: 50,     // ex, accept, keys, classes: zoveel per veld
};

const STAAT_GETALLEN = ["box", "due", "seen", "correct", "wrong", "lapses", "streak", "last"];
const RICHTINGEN = ["wd", "dw", "ex"];
const DELEN = ["cls", "def", "word"];
const RONDE_GETALLEN = ["date", "n", "first", "ms"];
const CAT_GETALLEN = ["aantal", "eerst", "laatst"];
const LIJST_TEKSTEN = ["subtitle", "subject", "mode", "from", "to", "deadline"];
const LIJST_VLAGGEN = ["strict", "interleave"];
const WOORD_TEKSTEN = ["cls", "section"];
const INDEX = /^\d{1,5}$/;

function getal(v) {
  return typeof v === "number" && Number.isFinite(v);
}
function tekst(v, max) {
  return typeof v === "string" && v.length <= max;
}
// Array van strings; losse kapotte strings vallen weg. Geen array of te
// lang: undefined.
function tekstLijst(v, max) {
  if (!Array.isArray(v) || v.length > GRENS.lijstje) return undefined;
  return v.filter(x => tekst(x, max));
}
// Object van string naar string; kapotte waarden en sleutels vallen weg.
function tekstMap(v) {
  if (!isObject(v)) return undefined;
  const out = {};
  for (const k of Object.keys(v)) {
    if (veiligeSleutel(k) && k.length <= GRENS.tekst && tekst(v[k], GRENS.tekst)) out[k] = v[k];
  }
  return out;
}
// Getallen die ontbreken worden 0. Een aanwezig maar kapot getal: null.
function getallen(v, namen) {
  const out = {};
  for (const n of namen) {
    if (v[n] === undefined) out[n] = 0;
    else if (getal(v[n])) out[n] = v[n];
    else return null;
  }
  return out;
}
function tellers(v, namen) {
  const out = {};
  for (const n of namen) out[n] = isObject(v) && getal(v[n]) ? v[n] : 0;
  return out;
}

// Toestand van een woord: box, due, seen enzovoort, en twee tellerobjecten.
export function controleerStaat(s) {
  if (!isObject(s)) return null;
  const out = getallen(s, STAAT_GETALLEN);
  if (!out) return null;
  out.dirWrong = tellers(s.dirWrong, RICHTINGEN);
  out.partWrong = tellers(s.partWrong, DELEN);
  return out;
}

// Een afgeronde ronde: date, n, first, ms en stopped.
export function controleerRonde(r) {
  if (!isObject(r)) return null;
  const out = getallen(r, RONDE_GETALLEN);
  if (!out) return null;
  out.stopped = r.stopped === true;
  return out;
}

// Voortgang van een lijst: items (index naar toestand), sessions en updated.
export function controleerVoortgang(p) {
  if (!isObject(p)) return null;
  const items = {};
  if (isObject(p.items)) {
    for (const k of Object.keys(p.items)) {
      if (!INDEX.test(k)) continue;
      const s = controleerStaat(p.items[k]);
      if (s) items[k] = s;
    }
  }
  const sessions = [];
  if (Array.isArray(p.sessions)) {
    for (const r of p.sessions) {
      const x = controleerRonde(r);
      if (x) sessions.push(x);
    }
  }
  const out = { items, sessions };
  if (getal(p.updated)) out.updated = p.updated;
  return out;
}

// Een oude cats-waarde: alleen aantal, eerst en laatst, als getal.
export function controleerCat(c) {
  if (!isObject(c)) return null;
  const out = {};
  for (const n of CAT_GETALLEN) {
    if (c[n] === undefined) continue;
    if (!getal(c[n])) return null;
    out[n] = c[n];
  }
  return out;
}

// Een woord van een eigen lijst. word en def zijn verplicht.
export function controleerWoord(it) {
  if (!isObject(it) || !tekst(it.word, GRENS.woord) || !tekst(it.def, GRENS.woord)) return null;
  const out = { word: it.word, def: it.def };
  for (const n of WOORD_TEKSTEN) if (tekst(it[n], GRENS.tekst)) out[n] = it[n];
  if (tekst(it.ex, GRENS.woord)) out.ex = it.ex;
  else {
    const ex = tekstLijst(it.ex, GRENS.woord);
    if (ex && ex.length) out.ex = ex;
  }
  if (Array.isArray(it.keys) && it.keys.length <= GRENS.lijstje) {
    const keys = [];
    for (const g of it.keys) {
      const groep = tekstLijst(g, GRENS.woord);
      if (groep && groep.length) keys.push(groep);
    }
    if (keys.length) out.keys = keys;
  }
  const accept = tekstLijst(it.accept, GRENS.woord);
  if (accept && accept.length) out.accept = accept;
  return out;
}

// Een eigen lijst. id, title en items zijn verplicht. Velden die een lijst
// van buiten niet mag hebben (mix, bronnen) komen er niet in.
export function controleerLijst(l) {
  if (!isObject(l)) return null;
  const id = l.id;
  if (typeof id === "number" ? !Number.isFinite(id) : !(veiligeSleutel(id) && id.length <= GRENS.id)) return null;
  if (!tekst(l.title, GRENS.tekst)) return null;
  if (!Array.isArray(l.items) || l.items.length > GRENS.woorden) return null;
  const items = [];
  for (const it of l.items) {
    const x = controleerWoord(it);
    if (!x) return null;
    items.push(x);
  }
  const out = { id, title: l.title };
  for (const n of LIJST_TEKSTEN) if (tekst(l[n], GRENS.tekst)) out[n] = l[n];
  for (const n of LIJST_VLAGGEN) if (typeof l[n] === "boolean") out[n] = l[n];
  if (getal(l.added)) out.added = l.added;
  const dirs = tekstLijst(l.directions, GRENS.tekst);
  if (dirs) {
    const goed = dirs.filter(d => RICHTINGEN.includes(d));
    if (goed.length) out.directions = goed;
  }
  const classes = tekstLijst(l.classes, GRENS.tekst);
  if (classes && classes.length) out.classes = classes;
  for (const n of ["sections", "instructions"]) {
    const m = tekstMap(l[n]);
    if (m) out[n] = m;
  }
  out.items = items;
  return out;
}

// ---------- cats, progress, lists ----------

// Een object waarvan elke waarde door `controleer` gaat. Geen object: null
// (veld telt niet mee). Kapotte waarden of verboden sleutels vallen weg.
function controleerMapMet(d, controleer, maxSleutel) {
  if (!isObject(d)) return null;
  const out = {};
  for (const k of Object.keys(d)) {
    if (!veiligeSleutel(k) || k.length > maxSleutel) continue;
    const v = controleer(d[k]);
    if (v) out[k] = v;
  }
  return out;
}
export const controleerCats = d => controleerMapMet(d, controleerCat, GRENS.sleutel);
export const controleerProgress = d => controleerMapMet(d, controleerVoortgang, GRENS.id);

// Een lijst van eigen lijsten. Kapotte lijsten vallen weg.
export function controleerLists(d) {
  if (!Array.isArray(d)) return null;
  const out = [];
  for (const l of d) {
    const x = controleerLijst(l);
    if (x) out.push(x);
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
    cats: mergeCats(controleerCats(r.cats) || {}, controleerCats(l.cats) || {}),
    progress: mergeProgress(controleerProgress(r.progress) || {}, controleerProgress(l.progress) || {}),
    lists: mergeLists(controleerLists(r.lists) || [], controleerLists(l.lists) || []),
    updated: Math.max(begrens(tijd(r.updated), nu), begrens(tijd(l.updated), nu)),
  };
}
