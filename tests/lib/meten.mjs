// Metingen die in de levende pagina draaien (via page.evaluate).
//
// contrastMeting: zoekt alle zichtbare tekst en rekent het contrast uit
// tegen de echte achtergrond. De achtergrond wordt opgebouwd uit alle
// lagen eronder: background-color, gradients (elke stop telt als
// mogelijke kleur) en ::before-vlakken, tot en met body::before en html.
// Opacity van een element werkt op het element en alles erin, net als in
// de browser. Van alle combinaties van gradient-stops telt de slechtste.

export function contrastMeting(opts) {
  const MIN = opts.min;

  // ---- kleuren ----
  function parseKleur(s) {
    s = s.trim();
    let m = s.match(/^rgba?\(([^)]*)\)$/);
    if (m) {
      const n = m[1].split(/[\s,\/]+/).filter(Boolean).map(x => x.endsWith("%") ? parseFloat(x) / 100 : parseFloat(x));
      return [n[0], n[1], n[2], n.length > 3 ? n[3] : 1];
    }
    m = s.match(/^color\(srgb\s+([^)]*)\)$/);
    if (m) {
      const n = m[1].split(/[\s\/]+/).filter(Boolean).map(parseFloat);
      return [n[0] * 255, n[1] * 255, n[2] * 255, n.length > 3 ? n[3] : 1];
    }
    if (s === "transparent") return [0, 0, 0, 0];
    return null;
  }
  // alle kleuren in een (gradient-)waarde; onbekende notaties melden
  function kleurenIn(waarde) {
    const uit = [];
    const re = /rgba?\([^)]*\)|color\(srgb[^)]*\)/g;
    let m; while ((m = re.exec(waarde))) uit.push(parseKleur(m[0]));
    const onbekend = /(oklch|oklab|lab|lch|hsl|hwb|color)\((?!srgb)/.test(waarde.replace(re, ""));
    return { kleuren: uit.filter(Boolean), onbekend };
  }
  const over = (a, b) => { // a over b, b is dekkend
    const al = a[3];
    return [a[0] * al + b[0] * (1 - al), a[1] * al + b[1] * (1 - al), a[2] * al + b[2] * (1 - al), 1];
  };
  const meng = (a, b, t) => [a[0] * t + b[0] * (1 - t), a[1] * t + b[1] * (1 - t), a[2] * t + b[2] * (1 - t), 1];
  const lum = c => {
    const f = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const hex = c => "#" + c.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase();

  // ---- lagen per element ----
  function maaktStapelcontext(cs) {
    return cs.isolation === "isolate" || parseFloat(cs.opacity) < 1 || cs.transform !== "none" ||
      cs.filter !== "none" || cs.mixBlendMode !== "normal" || cs.contain.includes("paint") ||
      (cs.position !== "static" && cs.zIndex !== "auto");
  }
  // geeft lagen van onder naar boven: { opties: [kleur...], bron }
  function vlakLagen(cs, bron, alphaFactor) {
    const lagen = [];
    let onbekend = false;
    const bg = parseKleur(cs.backgroundColor);
    // een kleur die we niet kunnen lezen (bijvoorbeeld oklab() midden in
    // een overgang) nooit stil overslaan: dan zou de tekst tegen wit gemeten
    // worden. Melden als niet meetbaar.
    if (!bg) onbekend = true;
    if (bg && bg[3] > 0) lagen.push({ opties: [[bg[0], bg[1], bg[2], bg[3] * alphaFactor]], bron: bron + " background-color" });
    if (cs.backgroundImage && cs.backgroundImage !== "none") {
      // meerdere achtergronden: de eerste ligt bovenop
      const delen = cs.backgroundImage.split(/,(?![^(]*\))(?=\s*(?:url|[a-z-]*gradient)\()/).reverse();
      for (const d of delen) {
        if (/url\(/.test(d)) { onbekend = true; continue; }
        const { kleuren, onbekend: o } = kleurenIn(d);
        if (o) onbekend = true;
        const uniek = [];
        for (const k of kleuren) if (!uniek.some(u => u.every((v, i) => Math.abs(v - k[i]) < 0.01))) uniek.push(k);
        if (uniek.length) lagen.push({ opties: uniek.map(k => [k[0], k[1], k[2], k[3] * alphaFactor]), bron: bron + " gradient" });
      }
    }
    return { lagen, onbekend };
  }
  function lagenVan(el) {
    const cs = getComputedStyle(el);
    const eigen = vlakLagen(cs, beschrijf(el), 1);
    let onbekend = eigen.onbekend;
    let onder = [], boven = eigen.lagen;
    const ps = getComputedStyle(el, "::before");
    if (ps.content && ps.content !== "none" && ps.content !== "normal" && ps.display !== "none" && ps.visibility === "visible") {
      // alleen een ::before die het hele element bedekt is een vlak
      const dekt = ps.position !== "static" && ["top", "right", "bottom", "left"].every(k => ps[k] === "0px");
      if (dekt) {
        const p = vlakLagen(ps, beschrijf(el) + "::before", parseFloat(ps.opacity));
        if (p.onbekend) onbekend = true;
        const negatief = parseInt(ps.zIndex, 10) < 0;
        // een negatieve ::before in een element zonder eigen stapelcontext
        // zakt onder de achtergrond van dat element (body::before)
        if (negatief && !maaktStapelcontext(cs)) onder = p.lagen;
        else boven = boven.concat(p.lagen);
      }
    }
    return { lagen: onder.concat(boven), opacity: parseFloat(cs.opacity), onbekend };
  }

  function beschrijf(el) {
    if (!el || el.nodeType !== 1) return "?";
    const deel = e => e.id ? "#" + e.id : e.tagName.toLowerCase() + (e.classList.length ? "." + [...e.classList].slice(0, 2).join(".") : "");
    const pad = [];
    let e = el;
    while (e && e !== document.body && pad.length < 3) { pad.unshift(deel(e)); if (e.id) break; e = e.parentElement; }
    return pad.join(" > ");
  }

  // rekent voor een tekstkleur op element el het slechtste contrast uit
  function meet(el, tekstKleur) {
    const keten = [];
    for (let e = el; e; e = e.parentElement) keten.unshift(e);
    const info = keten.map(lagenVan);
    const onbekend = info.some(i => i.onbekend);
    const gradientLagen = [];
    info.forEach(i => i.lagen.forEach(l => { if (l.opties.length > 1) gradientLagen.push(l); }));
    // alle combinaties van stops; ruim genoeg begrensd
    let combis = [new Map()];
    for (const l of gradientLagen) {
      const nieuw = [];
      for (const c of combis) for (let k = 0; k < l.opties.length; k++) { const m = new Map(c); m.set(l, k); nieuw.push(m); }
      combis = nieuw.length > 2000 ? nieuw.slice(0, 2000) : nieuw;
    }
    function teken(i, onder, keuze, metTekst) {
      let c = onder;
      for (const l of info[i].lagen) c = over(l.opties[keuze.get(l) || 0], c);
      if (i < keten.length - 1) c = teken(i + 1, c, keuze, metTekst);
      else if (metTekst) c = over(tekstKleur, c);
      if (info[i].opacity < 1) c = meng(c, onder, info[i].opacity);
      return c;
    }
    let slechtst = null;
    for (const keuze of combis) {
      const wit = [255, 255, 255, 1];
      const achter = teken(0, wit, keuze, false);
      const voor = teken(0, wit, keuze, true);
      const r = ratio(voor, achter);
      if (!slechtst || r < slechtst.ratio) slechtst = { ratio: r, tekst: hex(voor), achter: hex(achter) };
    }
    return Object.assign(slechtst, { onbekend });
  }

  // ---- zichtbare tekst zoeken ----
  const zichtbaar = el => el.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true });
  const resultaten = [], vrijgesteld = [], nietMeetbaar = [];
  let gemeten = 0;
  const gezien = new Set();

  function verwerk(el, tekst, kleurStr, soort) {
    const kleur = parseKleur(kleurStr);
    if (!kleur || kleur[3] === 0) return;
    const sleutel = beschrijf(el) + "|" + tekst + "|" + soort;
    if (gezien.has(sleutel)) return;
    gezien.add(sleutel);
    const m = meet(el, kleur);
    // uitgeschakelde bediening valt niet onder de contrasteis (WCAG 1.4.3),
    // maar we melden het wel als het eronder zit
    if (el.closest(":disabled, [aria-disabled=true]")) {
      if (m.ratio < MIN) vrijgesteld.push({ waar: beschrijf(el), tekst, ratio: Math.round(m.ratio * 100) / 100 });
      return;
    }
    gemeten++;
    if (m.onbekend) nietMeetbaar.push({ waar: beschrijf(el), tekst });
    if (m.ratio < MIN) resultaten.push({ waar: beschrijf(el), tekst, soort, ratio: Math.round(m.ratio * 100) / 100, kleur: m.tekst, achtergrond: m.achter });
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tekst = n.nodeValue.replace(/\s+/g, " ").trim();
    if (!tekst) continue;
    const el = n.parentElement;
    if (!el || ["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "TITLE"].includes(el.tagName)) continue;
    if (el.closest("option")) continue;
    if (!zichtbaar(el)) continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const vakken = [...r.getClientRects()].filter(b => b.width > 1 && b.height > 1);
    if (!vakken.length) continue;
    const cs = getComputedStyle(el);
    // sr-only en dergelijke: weggeknipt, dus niet zichtbaar
    if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") continue;
    let kleur = cs.webkitTextFillColor && cs.webkitTextFillColor !== cs.color ? cs.webkitTextFillColor : cs.color;
    if (el instanceof SVGElement) { const f = parseKleur(cs.fill); if (f) kleur = cs.fill; }
    verwerk(el, tekst.slice(0, 60), kleur, "tekst");
  }
  // tekst in invoervelden en placeholders
  for (const el of document.querySelectorAll("input, textarea, select")) {
    if (!zichtbaar(el) || el.type === "hidden" || el.type === "range" || el.type === "file" || el.type === "checkbox" || el.type === "radio") continue;
    const cs = getComputedStyle(el);
    if (el.value) verwerk(el, String(el.tagName === "SELECT" ? el.selectedOptions[0]?.text : el.value).slice(0, 60), cs.color, "invoer");
    else if (el.placeholder) verwerk(el, el.placeholder.slice(0, 60), getComputedStyle(el, "::placeholder").color, "placeholder");
  }
  return { fouten: resultaten, vrijgesteld, nietMeetbaar, gemeten };
}

// Horizontale overloop: scrollt de pagina opzij? En zo ja, welke
// elementen steken buiten beeld (niet binnen een eigen scrollcontainer).
export function overloopMeting() {
  const doc = document.documentElement;
  const vw = doc.clientWidth;
  const overloop = doc.scrollWidth > vw + 1;
  const htmlX = getComputedStyle(doc).overflowX, bodyX = getComputedStyle(document.body).overflowX;
  const boosdoeners = [];
  const binnenScroller = el => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) {
      const o = getComputedStyle(e).overflowX;
      if (o === "auto" || o === "scroll" || o === "hidden" || o === "clip") return true;
    }
    return false;
  };
  for (const el of document.body.querySelectorAll("*")) {
    if (!el.checkVisibility()) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !binnenScroller(el)) {
      const naam = el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.classList.length ? "." + [...el.classList].join(".") : "");
      boosdoeners.push(naam + " (" + Math.round(r.left) + " tot " + Math.round(r.right) + "px)");
    }
  }
  return { overloop, scrollWidth: doc.scrollWidth, breedte: vw, verstopt: htmlX === "hidden" || bodyX === "hidden" || htmlX === "clip" || bodyX === "clip", boosdoeners: boosdoeners.slice(0, 10) };
}

// Animaties afronden, zodat we de eindtoestand meten en niet een frame
// halverwege een fade-in.
//
// Eerst een paar frames wachten. Verschijnt er een knop onder de muis
// (bijvoorbeeld "Maak een foto" op de plek waar net "Foto" stond), dan
// zet de browser :hover pas een frame later aan en start er dan pas een
// overgang. Zonder wachten liep de meting soms midden in die overgang,
// waar Chromium de kleur als oklab() geeft.
export async function rondAnimatiesAf() {
  await document.fonts.ready;
  const frame = () => new Promise(r => requestAnimationFrame(() => r()));
  const rond = () => {
    for (const a of document.getAnimations()) {
      try { if (a.effect && a.effect.getTiming().iterations !== Infinity) a.finish(); } catch (_) { /* oneindig */ }
    }
  };
  rond();
  await frame(); await frame();
  await new Promise(r => setTimeout(r, 50));
  rond();
  await frame();
  rond();
}
