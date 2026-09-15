// Engine voor de overhoor-app: soepel nakijken + herhaalschema (Leitner met oplopende intervallen).
// Geen DOM, zodat dit los te testen is (node) en later hergebruikt kan worden.

(function (root) {
  "use strict";

  // ---------- Tekst normaliseren ----------
  const STOP = new Set(("to a an the of in on at and or is are be being been you your it its something someone somebody " +
    "way very from for with that this who which when what do does done did make makes making made feel feeling feels felt " +
    "get gets got has have had not too so by as about before after into up out over off if than then them they he she his her " +
    "person people thing things given give gives some any one all can could would should will").split(" "));

  const SUFFIXES = ["ally", "ily", "ly", "ing", "ied", "ies", "ed", "ness", "s"];

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[’']/g, "")
      .replace(/[^a-z\s-]/g, " ")
      .replace(/-/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function tokens(s) {
    return norm(s).split(" ").filter(Boolean);
  }

  function stem(w) {
    if (w.length <= 3) return w;
    for (const suf of SUFFIXES) {
      if (!w.endsWith(suf)) continue;
      if (suf === "s" && w.endsWith("ss")) continue;
      const base = w.slice(0, -suf.length);
      if (base.length < 3) continue;
      if (suf === "ies" || suf === "ied" || suf === "ily") return base + "y";
      return base;
    }
    return w;
  }

  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n;
    if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      [prev, cur] = [cur, prev];
    }
    return prev[n];
  }

  function tolerance(len) {
    return len >= 8 ? 2 : len >= 5 ? 1 : 0;
  }

  function sameWord(a, b) {
    if (a === b) return true;
    return lev(a, b) <= tolerance(Math.min(a.length, b.length));
  }

  // Elke token van de zin komt (gestemd, met typo-tolerantie) voor in het antwoord.
  function phraseMatches(answerStems, phrase) {
    const ps = tokens(phrase).map(stem);
    return ps.length > 0 && ps.every(p => answerStems.some(a => sameWord(a, p)));
  }

  function autoKeys(def) {
    const seen = new Set();
    const groups = [];
    for (const t of tokens(def)) {
      if (STOP.has(t)) continue;
      const s = stem(t);
      if (seen.has(s)) continue;
      seen.add(s);
      groups.push([t]);
    }
    return groups;
  }

  // ---------- Nakijken ----------
  // Definitie: soepel. Resultaat: correct | maybe | wrong (+ telling voor feedback).
  function gradeDefinition(item, answer) {
    const answerStems = tokens(answer).map(stem);
    if (!answerStems.length) return { status: "wrong", matched: 0, needed: 1, total: 1, empty: true };

    if (item.accept && item.accept.some(p => phraseMatches(answerStems, p))) {
      return { status: "correct", matched: 1, needed: 1, total: 1, viaAccept: true };
    }

    const curated = Array.isArray(item.keys) && item.keys.length > 0;
    const groups = curated ? item.keys : autoKeys(item.def);
    let matched = 0;
    for (const group of groups) {
      const hit = group.some(k => k.includes(" ") ? phraseMatches(answerStems, k) : answerStems.some(a => sameWord(a, stem(norm(k)))));
      if (hit) matched++;
    }
    const total = groups.length;
    const needed = Math.max(1, Math.ceil(total * (curated ? 0.6 : 0.5)));
    const status = matched >= needed ? "correct" : matched >= 1 ? "maybe" : "wrong";
    return { status, matched, needed, total };
  }

  // Woord: spelling telt. Resultaat: correct | near | wrong.
  function gradeWord(item, answer) {
    const a = norm(answer).replace(/^to /, "").replace(/^(a|an|the) /, "");
    const w = norm(item.word);
    if (!a) return { status: "wrong", empty: true };
    if (a === w) return { status: "correct" };
    if (lev(a, w) <= (w.length >= 5 ? 1 : 0) || a.replace(/ /g, "") === w) return { status: "near" };
    return { status: "wrong" };
  }

  // Vertaling (bijv. Frans naar Nederlands): meerdere goede antwoorden gescheiden door / , ; of "of".
  // Resultaat: correct | maybe | wrong. Lidwoorden vooraan tellen niet mee, kleine typo's ook niet.
  const ARTICLES = /^(de|het|een|le|la|les|un|une|des|l|the|a|an|to) /;
  function gradeTranslation(item, answer) {
    const a = norm(answer).replace(ARTICLES, "").trim();
    if (!a) return { status: "wrong", empty: true };
    const alts = String(item.def).split(/\s*[\/,;]\s*|\s+of\s+/).map(x => norm(x).replace(ARTICLES, "").trim()).filter(Boolean);
    if (alts.some(alt => alt === a)) return { status: "correct" };
    // Eén letter verschil: kan een typo zijn (hont/hond) of een ander woord (lezen/leren). Zelf laten beoordelen.
    if (alts.some(alt => lev(alt, a) <= 1)) return { status: "maybe", near: true };
    const aStems = tokens(a).map(stem);
    const partial = alts.some(alt => {
      const ts = tokens(alt).map(stem).filter(t => t.length >= 3);
      return ts.length > 0 && ts.some(t => aStems.some(x => sameWord(x, t)));
    });
    return { status: partial ? "maybe" : "wrong" };
  }

  // ---------- Herhaalschema ----------
  const MIN = 60 * 1000, DAY = 24 * 60 * MIN;
  // Interval na een goed antwoord, per box. Box 1 = leerstap van 10 minuten (dezelfde dag nog eens),
  // daarna oplopend: 1 dag, 3 dagen, 1 week, 2 weken, 1 maand.
  const INTERVALS = [0, 10 * MIN, 1 * DAY, 3 * DAY, 7 * DAY, 14 * DAY, 30 * DAY];
  const MAX_BOX = INTERVALS.length - 1;

  function defaultState() {
    return { box: 0, due: 0, seen: 0, correct: 0, wrong: 0, lapses: 0, streak: 0, last: 0,
      dirWrong: { wd: 0, dw: 0 }, partWrong: { cls: 0, def: 0, word: 0 } };
  }

  function getState(progress, i) {
    if (!progress.items[i]) progress.items[i] = defaultState();
    const s = progress.items[i];
    if (!s.dirWrong) s.dirWrong = { wd: 0, dw: 0 };
    if (!s.partWrong) s.partWrong = { cls: 0, def: 0, word: 0 };
    return s;
  }

  function applyAnswer(state, correct, now) {
    state.seen++;
    state.last = now;
    if (correct) {
      state.correct++;
      state.streak++;
      state.box = Math.min(state.box + 1, MAX_BOX);
      state.due = now + INTERVALS[state.box];
    } else {
      state.wrong++;
      state.lapses++;
      state.streak = 0;
      state.box = 0;
      state.due = now;
    }
    return state;
  }

  // Hoe zwaarder, hoe eerder aan de beurt. Vaak-fout woorden krijgen extra gewicht.
  function weight(state, now) {
    const overdueDays = state.due ? Math.max(0, (now - state.due) / DAY) : 0;
    return 1 + state.lapses * 2 + (state.box === 0 && state.seen > 0 ? 2 : 0) + Math.min(7, overdueDays);
  }

  function weightedSample(entries, k, rnd) {
    const pool = entries.slice();
    const out = [];
    while (pool.length && out.length < k) {
      const total = pool.reduce((s, e) => s + e.w, 0);
      let r = rnd() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) { r -= pool[idx].w; if (r <= 0) break; }
      if (idx >= pool.length) idx = pool.length - 1;
      out.push(pool[idx].i);
      pool.splice(idx, 1);
    }
    return out;
  }

  function shuffle(arr, rnd) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Kiest de woorden voor een ronde.
  // size: getal of "all". newMax: max nieuwe woorden per ronde (standaard 10).
  function selectSession(list, progress, size, now, opts) {
    opts = opts || {};
    const rnd = opts.rnd || Math.random;
    const newMax = opts.newMax == null ? 10 : opts.newMax;
    const all = size === "all";
    const cap = all ? Infinity : size;

    const allowed = opts.allowed ? new Set(opts.allowed) : null;
    const due = [], fresh = [];
    list.items.forEach((_, i) => {
      if (allowed && !allowed.has(i)) return;
      const s = progress.items[i];
      if (!s || s.seen === 0) fresh.push(i);
      else if (s.due <= now) due.push({ i, w: weight(s, now) });
    });

    let picked = all ? due.map(e => e.i) : weightedSample(due, cap, rnd);
    const room = Math.min(cap - picked.length, all ? Infinity : newMax);
    const newPicked = fresh.slice(0, Math.max(0, room));
    picked = picked.concat(newPicked);

    let kind = "due";
    if (!picked.length) {
      // Niets aan de beurt: extra oefenen met de zwakste woorden.
      kind = "extra";
      const ranked = list.items.map((_, i) => ({ i, s: progress.items[i] || defaultState() })).filter(e => !allowed || allowed.has(e.i))
        .sort((a, b) => (a.s.box - b.s.box) || (b.s.lapses - a.s.lapses) || (a.s.due - b.s.due));
      picked = ranked.slice(0, all ? ranked.length : Math.min(cap, ranked.length)).map(e => e.i);
    }
    return { indices: shuffle(picked, rnd), kind, dueCount: due.length, newCount: fresh.length };
  }

  // Richting: eerste keer altijd woord -> definitie (herkennen), daarna gewogen naar de richting die vaker fout ging.
  function pickDirection(state, rnd, directions) {
    rnd = rnd || Math.random;
    if (Array.isArray(directions) && directions.length === 1) return directions[0];
    if (!state || state.seen === 0) return "wd";
    const pdw = (1 + state.dirWrong.dw) / (2 + state.dirWrong.dw + state.dirWrong.wd);
    return rnd() < pdw ? "dw" : "wd";
  }

  function boxLabel(state) {
    if (!state || state.seen === 0) return "nieuw";
    if (state.box === 0) return "opnieuw";
    if (state.box <= 2) return "aan het leren";
    if (state.box <= 4) return "kent het";
    return "zit erin";
  }

  const Engine = { norm, tokens, stem, lev, gradeDefinition, gradeWord, gradeTranslation, autoKeys,
    INTERVALS, MAX_BOX, defaultState, getState, applyAnswer, weight, selectSession, pickDirection, shuffle, boxLabel };

  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  root.Engine = Engine;
})(typeof window === "object" ? window : globalThis);
