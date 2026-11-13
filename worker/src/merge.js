// Samenvoegen van sync-data. Pure functies zonder Cloudflare, zodat de tests
// ze met `node --test` kunnen draaien. index.js gebruikt ze voor PUT /sync.
//
// Uitgangspunten:
// - Alles wat binnenkomt (van de client en uit KV) gaat eerst door een
//   controle. Wat te herstellen is, wordt hersteld; alleen wat niet te
//   herstellen is, valt weg. De rest blijft staan.
// - Resultaten worden als nieuw object opgebouwd. Geen Object.assign of
//   for...in op invoer, en sleutels als __proto__ komen er niet in.

// speling voor klokken die iets voorlopen
export const TOEKOMST_MARGE_MS = 5 * 60 * 1000;

// Hoogste box. Gelijk aan MAX_BOX in engine.js (een test bewaakt dat).
export const MAX_BOX = 6;

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

// Tijdstempel: een eindig getal van 0 tot nu plus de marge. Negatief of
// kapot wordt 0, verder in de toekomst wordt nu plus de marge. Zo kan een
// tijd van 1e308 niet voorgoed van alle latere wijzigingen winnen.
// Dezelfde regel staat in index.html (tijd).
export function tijd(v, nu) {
  const t = typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
  return Math.min(t, nu + TOEKOMST_MARGE_MS);
}

// ---------- vorm ----------
// Dezelfde regels staan in index.html (schoneLijst, schoneStaat enzovoort).
// Pas ze samen aan; een pariteitstest vergelijkt ze.
//
// Elk onderdeel wordt als nieuw object opgebouwd met alleen de bekende
// velden. Herstellen gaat voor weggooien:
// - een kapot getal in een woordtoestand wordt 0; box is een heel getal
//   van 0 tot en met MAX_BOX, tellers zijn niet negatief;
// - te lange tekst wordt afgekapt, te lange lijstjes ook;
// - een word of def die geen tekst is wordt "", een kapot woord een leeg
//   woord op dezelfde plek, zodat de nummering van de voortgang klopt;
// - een titel die geen tekst is wordt "";
// - een los optioneel veld van de verkeerde soort valt weg;
// - items of sessions met de verkeerde vorm worden leeg;
// - een ronde of cats-waarde met een kapot getal valt weg.
// Alleen een lijst zonder geldig id of zonder items-array valt helemaal weg.

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
const LIJST_TEKSTEN = ["subtitle", "subject", "mode", "from", "to", "deadline"];
const LIJST_VLAGGEN = ["strict", "interleave"];
const WOORD_TEKSTEN = ["cls", "section"];
const INDEX = /^\d{1,5}$/;

function getal(v) {
  return typeof v === "number" && Number.isFinite(v);
}
// Tekst, afgekapt op max. Geen tekst: undefined.
function kap(v, max) {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}
// Tekst, afgekapt op max. Geen tekst: "".
function kapOfLeeg(v, max) {
  return typeof v === "string" ? v.slice(0, max) : "";
}
// Array van teksten, afgekapt op GRENS.lijstje stuks; elke tekst afgekapt
// op max, wat geen tekst is valt weg. Geen array: undefined.
function tekstLijst(v, max) {
  if (!Array.isArray(v)) return undefined;
  const out = [];
  for (const x of v.slice(0, GRENS.lijstje)) if (typeof x === "string") out.push(x.slice(0, max));
  return out;
}
// Object van tekst naar tekst; kapotte sleutels en waarden vallen weg,
// te lange waarden worden afgekapt.
function tekstMap(v) {
  if (!isObject(v)) return undefined;
  const out = {};
  for (const k of Object.keys(v)) {
    if (veiligeSleutel(k) && k.length <= GRENS.tekst && typeof v[k] === "string") out[k] = v[k].slice(0, GRENS.tekst);
  }
  return out;
}
// Teller: een eindig getal van 0 of meer. Kapot of negatief wordt 0.
function teller(v) {
  return getal(v) && v > 0 ? v : 0;
}
function tellers(v, namen) {
  const out = {};
  for (const n of namen) out[n] = teller(isObject(v) ? v[n] : undefined);
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

// Toestand van een woord: box, due, seen enzovoort, en twee tellerobjecten.
// Elk kapot of negatief getal wordt 0; box wordt een heel getal tot en met
// MAX_BOX. Alleen iets dat geen object is valt weg.
export function controleerStaat(s) {
  if (!isObject(s)) return null;
  const out = {};
  for (const n of STAAT_GETALLEN) out[n] = teller(s[n]);
  out.box = Math.min(Math.floor(out.box), MAX_BOX);
  out.dirWrong = tellers(s.dirWrong, RICHTINGEN);
  out.partWrong = tellers(s.partWrong, DELEN);
  return out;
}

// Een afgeronde ronde: date, n, first, ms en stopped. Een ronde met een
// kapot getal valt weg; een ronde weglaten verschuift niets.
export function controleerRonde(r) {
  if (!isObject(r)) return null;
  const out = getallen(r, RONDE_GETALLEN);
  if (!out) return null;
  out.stopped = r.stopped === true;
  return out;
}

// Voortgang van een lijst: items (index naar toestand), sessions en updated.
export function controleerVoortgang(p, nu = Date.now()) {
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
  if (getal(p.updated)) out.updated = tijd(p.updated, nu);
  return out;
}

// Een oude cats-waarde: alleen aantal, eerst en laatst, als getal. eerst en
// laatst zijn tijden, aantal is een teller.
export function controleerCat(c, nu = Date.now()) {
  if (!isObject(c)) return null;
  const out = {};
  for (const n of ["aantal", "eerst", "laatst"]) {
    if (c[n] === undefined) continue;
    if (!getal(c[n])) return null;
    out[n] = n === "aantal" ? teller(c[n]) : tijd(c[n], nu);
  }
  return out;
}

// Een woord van een eigen lijst. Altijd een woord, ook als het kapot is:
// word en def worden dan "".
export function controleerWoord(it) {
  const w = isObject(it) ? it : {};
  const out = { word: kapOfLeeg(w.word, GRENS.woord), def: kapOfLeeg(w.def, GRENS.woord) };
  for (const n of WOORD_TEKSTEN) {
    const t = kap(w[n], GRENS.tekst);
    if (t !== undefined) out[n] = t;
  }
  if (typeof w.ex === "string") out.ex = w.ex.slice(0, GRENS.woord);
  else {
    const ex = tekstLijst(w.ex, GRENS.woord);
    if (ex && ex.length) out.ex = ex;
  }
  if (Array.isArray(w.keys)) {
    const keys = [];
    for (const g of w.keys.slice(0, GRENS.lijstje)) {
      const groep = tekstLijst(g, GRENS.woord);
      if (groep && groep.length) keys.push(groep);
    }
    if (keys.length) out.keys = keys;
  }
  const accept = tekstLijst(w.accept, GRENS.woord);
  if (accept && accept.length) out.accept = accept;
  return out;
}

// Een eigen lijst. Zonder geldig id of zonder items-array: null. Verder
// wordt alles hersteld of afgekapt. Velden die een lijst van buiten niet
// mag hebben (mix, bronnen) komen er niet in.
export function controleerLijst(l, nu = Date.now()) {
  if (!isObject(l)) return null;
  const id = l.id;
  if (typeof id === "number" ? !Number.isFinite(id) : !(veiligeSleutel(id) && id.length <= GRENS.id)) return null;
  if (!Array.isArray(l.items)) return null;
  const out = { id, title: kapOfLeeg(l.title, GRENS.tekst) };
  for (const n of LIJST_TEKSTEN) {
    const t = kap(l[n], GRENS.tekst);
    if (t !== undefined) out[n] = t;
  }
  for (const n of LIJST_VLAGGEN) if (typeof l[n] === "boolean") out[n] = l[n];
  if (getal(l.added)) out.added = tijd(l.added, nu);
  const dirs = (tekstLijst(l.directions, GRENS.tekst) || []).filter(d => RICHTINGEN.includes(d));
  if (dirs.length) out.directions = dirs;
  const classes = tekstLijst(l.classes, GRENS.tekst);
  if (classes && classes.length) out.classes = classes;
  for (const n of ["sections", "instructions"]) {
    const m = tekstMap(l[n]);
    if (m) out[n] = m;
  }
  out.items = l.items.slice(0, GRENS.woorden).map(controleerWoord);
  return out;
}

// ---------- cats, progress, lists ----------

// Een object waarvan elke waarde door `controleer` gaat. Geen object: null
// (veld telt niet mee). Kapotte waarden of verboden sleutels vallen weg.
function controleerMapMet(d, controleer, maxSleutel, nu) {
  if (!isObject(d)) return null;
  const out = {};
  for (const k of Object.keys(d)) {
    if (!veiligeSleutel(k) || k.length > maxSleutel) continue;
    const v = controleer(d[k], nu);
    if (v) out[k] = v;
  }
  return out;
}
export const controleerCats = (d, nu = Date.now()) => controleerMapMet(d, controleerCat, GRENS.sleutel, nu);
export const controleerProgress = (d, nu = Date.now()) => controleerMapMet(d, controleerVoortgang, GRENS.id, nu);

// Een lijst van eigen lijsten. Lijsten zonder geldig id of items vallen weg.
export function controleerLists(d, nu = Date.now()) {
  if (!Array.isArray(d)) return null;
  const out = [];
  for (const l of d) {
    const x = controleerLijst(l, nu);
    if (x) out.push(x);
  }
  return out;
}

// De tijden zijn al begrensd door de controle; tijd() hieronder vangt
// alleen een ontbrekende waarde op.
function mergeCats(a, b, nu) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k];
  for (const k of Object.keys(b)) {
    const oud = out[k];
    if (!oud || tijd(b[k].laatst, nu) > tijd(oud.laatst, nu)) {
      out[k] = b[k];
    } else {
      const aantal = Math.max(teller(oud.aantal), teller(b[k].aantal));
      out[k] = { ...oud, aantal };
    }
  }
  return out;
}

function mergeProgress(a, b, nu) {
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k];
  for (const k of Object.keys(b)) {
    if (!out[k] || tijd(b[k].updated, nu) > tijd(out[k].updated, nu)) out[k] = b[k];
  }
  return out;
}

function mergeLists(a, b, nu) {
  const byId = new Map();
  for (const l of a) byId.set(String(l.id), l);
  for (const l of b) {
    const oud = byId.get(String(l.id));
    if (!oud || tijd(l.added, nu) > tijd(oud.added, nu)) byId.set(String(l.id), l);
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
    cats: mergeCats(controleerCats(r.cats, nu) || {}, controleerCats(l.cats, nu) || {}, nu),
    progress: mergeProgress(controleerProgress(r.progress, nu) || {}, controleerProgress(l.progress, nu) || {}, nu),
    lists: mergeLists(controleerLists(r.lists, nu) || [], controleerLists(l.lists, nu) || [], nu),
    updated: Math.max(tijd(r.updated, nu), tijd(l.updated, nu)),
  };
}
