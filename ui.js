// =============================================================
// Overhoren markup-componenten
//
// Elke bouwsteen die meer dan eens voorkomt staat hier een keer.
// De schermen roepen deze functies aan en stellen zelf nooit
// klassen samen, zodat een wijziging hier overal landt.
//
// Elke functie geeft een HTML-string terug. Alles wat van buiten
// komt gaat door esc(). Styling hoort in ds.css, niet hier.
// =============================================================
(function (root) {
  "use strict";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, c =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }
  // bouwt een class-attribuut uit vaste en optionele delen
  function cls() {
    const out = [];
    for (const a of arguments) {
      if (!a) continue;
      if (typeof a === "string") out.push(a);
      else for (const k in a) if (a[k]) out.push(k);
    }
    return out.join(" ");
  }
  function attr(name, value) {
    return value == null || value === false ? "" : " " + name + '="' + esc(value) + '"';
  }
  function pct(n, total) {
    return Math.round(100 * (Number(n) || 0) / Math.max(1, Number(total) || 1));
  }

  // --- Icon ---------------------------------------------------
  // Inline SVG, geen iconfont. Alles tekent in currentColor en schaalt
  // mee met de tekstgrootte, dus een icoon past zich vanzelf aan het
  // component aan waar het in staat. Nieuw icoon = een pad erbij.
  const ICONS = {
    check:   '<path d="M5 13l4 4L19 7"/>',
    close:   '<path d="M6 6l12 12M18 6L6 18"/>',
    help:    '<path d="M9.2 9.3a3 3 0 1 1 3.6 3c-.6.2-.8.7-.8 1.4"/><circle cx="12" cy="17.6" r=".9" fill="currentColor" stroke="none"/>',
    back:    '<path d="M15 5l-7 7 7 7"/>',
    book:    '<path d="M4 5.6A1.6 1.6 0 0 1 5.6 4H19v13H5.6A1.6 1.6 0 0 0 4 18.6z"/><path d="M19 17v3H5.6"/>',
    chart:   '<path d="M5 20v-5M12 20V5M19 20v-9"/>',
    clock:   '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2V12l3.2 2"/>',
    flame:   '<path d="M12 3.2c3 3.8 5 5.6 5 8.9a5 5 0 0 1-10 0c0-1.6.7-2.8 1.6-3.7.2 1.2.9 1.9 1.6 1.9-.9-2.4.3-5.2 1.8-7.1z"/>',
    play:    '<path d="M8.5 5.4l10 6.6-10 6.6z"/>',
    alert:   '<path d="M12 4.2l8.6 15.3H3.4z"/><path d="M12 10v4"/><circle cx="12" cy="16.8" r=".9" fill="currentColor" stroke="none"/>',
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>'
  };
  // name: sleutel uit ICONS. size volgt standaard de tekstgrootte (1em).
  function Icon(name, o) {
    o = o || {};
    const d = ICONS[name];
    if (!d) return "";
    return '<svg class="' + cls("icon", o.className) + '" viewBox="0 0 24 24" ' +
      'width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="' + (o.weight || 2) + '" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' + d + '</svg>';
  }

  // --- Button -------------------------------------------------
  // variant: primary | ok | danger | null   size: big | null
  function Button(o) {
    o = o || {};
    return '<button type="button"' + attr("id", o.id) +
      ' class="' + cls("btn", o.variant, o.size === "big" && "big", o.className) + '"' +
      attr("data-cls", o.dataCls) + (o.hidden ? " hidden" : "") + (o.disabled ? " disabled" : "") +
      '>' + (o.icon ? Icon(o.icon) : "") + '<span>' + (o.html || esc(o.label)) + '</span></button>';
  }

  // --- Link: tekstknop met een volwaardig tikdoel --------------
  function Link(o) {
    o = o || {};
    return '<button type="button" class="' + cls("link", o.className) + '"' +
      attr("id", o.id) + (o.hidden ? " hidden" : "") + '>' +
      (o.icon ? Icon(o.icon) : "") + '<span>' + esc(o.label) + '</span></button>';
  }

  // --- TopBar: terugknop links, vrije inhoud rechts ------------
  // items: array van {id, label, cls, type:'link'|'text'}
  function TopBar(items) {
    return '<div class="topbar">' + (items || []).map(function (it) {
      if (!it) return "";
      if (it.type === "link") return Link({ id: it.id, label: it.label });
      return '<span' + attr("id", it.id) + attr("class", it.cls || null) + '>' + esc(it.label || "") + '</span>';
    }).join("") + '</div>';
  }

  // --- Stat: getal met label ----------------------------------
  function Stat(o) {
    o = o || {};
    return '<div class="stat"><b' + attr("id", o.id) + '>' + esc(o.value) + '</b>' +
      '<span>' + esc(o.label) + '</span></div>';
  }
  function StatsRow(stats, className) {
    return '<div class="' + cls("stats-row", className) + '">' +
      (stats || []).map(Stat).join("") + '</div>';
  }

  // --- Meter: elke voortgangsbalk -----------------------------
  // size: sm | md | lg    parts: [{kind:'a'|'b'|'c', value, total}]
  function Meter(o) {
    o = o || {};
    const parts = (o.parts || []).map(function (p) {
      return '<i class="' + (p.kind || "a") + '" style="width:' + pct(p.value, o.total != null ? o.total : p.total) + '%"></i>';
    }).join("");
    return '<span class="' + cls("meter", o.size || "sm", o.className) + '"' + attr("id", o.id) + '>' + parts + '</span>';
  }

  // --- Ring: voortgang als zeshoek ----------------------------
  // Twee lijnen over elkaar: eerst alles wat geoefend is, daarbovenop
  // het deel dat er echt in zit. In het midden het percentage dat al
  // een keer geoefend is, want dat beweegt na elke ronde. "Zit erin"
  // alleen zou dagenlang op nul blijven staan.
  // De zeshoek begint bovenaan en loopt met de klok mee. pathLength=100
  // maakt de lengte van de lijn gelijk aan het percentage.
  const HEX = "M32 6L54.52 19L54.52 45L32 58L9.48 45L9.48 19Z";
  function Ring(o) {
    o = o || {};
    const total = Math.max(1, Number(o.total) || 1);
    const known = Number(o.known) || 0;
    const learning = Number(o.learning) || 0;
    const geoefend = Math.min(total, known + learning);
    const lijn = v => (Math.max(0, Math.min(total, v)) / total * 100).toFixed(2) + " 100";
    // Een lijn van lengte nul tekent met stroke-linecap:round alsnog een
    // rond puntje. Bij nul laten we hem dus helemaal weg.
    const arc = (klasse, v) => v > 0
      ? '<path class="ring-arc ' + klasse + '" d="' + HEX + '" pathLength="100" stroke-dasharray="' + lijn(v) + '"/>'
      : "";
    const pct = Math.round(100 * geoefend / total);
    return '<svg class="ring" viewBox="0 0 64 64" aria-hidden="true" focusable="false">' +
      '<path class="ring-track" d="' + HEX + '"/>' +
      arc("learning", geoefend) +
      arc("known", known) +
      '<text class="ring-pct" x="32" y="32">' + pct + '<tspan class="ring-sign">%</tspan></text>' +
      '</svg>';
  }

  // --- Chip: woordsoort ---------------------------------------
  function Chip(kind) {
    return kind ? '<span class="chip ' + esc(kind) + '">' + esc(kind) + '</span>' : "";
  }

  // --- Beta: het chipje naast de naam van de app --------------
  // Een knop die een korte uitleg eronder opent en sluit. Het vlak is
  // klein, het tikdoel 44 px (ds.css). Zet BetaUitleg ergens onder de
  // kop en koppel ze met bindBeta(knop). uitlegId is het id van die regel.
  // Onder de uitleg een kleine regel met de versie van de app.
  const BETA_UITLEG = "We leren nog. Dingen kunnen veranderen.";
  // De versie van de app: de ?v= van dit script, die de deploy stempelt
  // (op Cloudflare de korte commit-sha). Zonder stempel, of buiten een
  // browser, "dev". index.html gebruikt hem ook na een update (registreerSW).
  const VERSIE = (function () {
    try { return new URL(document.currentScript.src).searchParams.get("v") || "dev"; }
    catch (e) { return "dev"; }
  })();
  function Beta(o) {
    o = o || {};
    return '<button type="button" class="beta"' + attr("id", o.id) +
      ' aria-expanded="' + (o.open ? "true" : "false") + '"' + attr("aria-controls", o.uitlegId) + '>' +
      '<span class="beta-chip">Beta</span></button>';
  }
  function BetaUitleg(o) {
    o = o || {};
    return '<p class="beta-uitleg"' + attr("id", o.id) + (o.open ? "" : " hidden") + '>' + esc(BETA_UITLEG) +
      '<small class="beta-versie">Versie ' + esc(VERSIE.slice(0, 7)) + '</small></p>';
  }
  // Tikken, Enter of Spatie wisselt (dat doet een <button> vanzelf),
  // Escape sluit en zet de focus terug op de knop.
  function bindBeta(knop) {
    if (!knop || knop.dataset.betaDone) return;
    const uitleg = document.getElementById(knop.getAttribute("aria-controls"));
    if (!uitleg) return;
    const zet = open => { uitleg.hidden = !open; knop.setAttribute("aria-expanded", open ? "true" : "false"); };
    knop.addEventListener("click", () => zet(uitleg.hidden));
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || uitleg.hidden) return;
      zet(false); knop.focus();
    });
    knop.dataset.betaDone = "1";
  }

  // --- Choice: woordsoortknop met toetshint -------------------
  function Choice(o) {
    o = o || {};
    return '<button type="button" class="choice"' + attr("data-cls", o.value) + '>' +
      '<span>' + esc(o.label) + '</span>' +
      (o.key ? '<kbd>' + esc(o.key) + '</kbd>' : "") + '</button>';
  }
  function Choices(items) {
    return (items || []).map(function (it, i) {
      return Choice({ value: it, label: it, key: i + 1 });
    }).join("");
  }

  // --- Notice: melding met gekleurde kantlijn -----------------
  function Notice(o) {
    o = o || {};
    return '<div class="' + cls("notice", o.spread && "row-between", o.className) + '"' +
      attr("id", o.id) + (o.hidden ? " hidden" : "") + '>' +
      (o.icon === false ? "" : Icon(o.icon || "alert", { className: "notice-icon" })) +
      '<div>' + (o.html || esc(o.text)) + '</div></div>';
  }

  // --- Empty: lege staat --------------------------------------
  function Empty(o) {
    o = o || {};
    return '<div class="empty"><span class="glyph">' + esc(o.glyph || "?") + '</span>' +
      '<p><b>' + esc(o.title) + '</b></p>' +
      (o.body ? '<p class="muted">' + esc(o.body) + '</p>' : "") + '</div>';
  }

  // --- Mark: het oordeel per onderdeel in de feedbacklijst ----
  const MARK_ICON = { ok: "check", bad: "close", maybe: "help" };
  function Mark(kind, id) {
    return '<span class="' + cls("mark", kind) + '"' + attr("id", id) + '>' +
      Icon(MARK_ICON[kind] || "help") + '</span>';
  }

  // --- LessonCard: kaart op het lessenoverzicht ---------------
  // Het getal staat rechts en heeft daarvoor een expliciete
  // grid-kolom nodig; die zit in ds.css op .lesson .cnt.
  function LessonCard(o) {
    o = o || {};
    const known = Number(o.known) || 0, learning = Number(o.learning) || 0;
    const nieuw = Math.max(0, (Number(o.total) || 0) - known - learning);
    // Alleen tonen wat er is, zodat er geen rij nullen op de kaart staat.
    // Hooguit twee segmenten: anders breekt de regel op een telefoon en
    // springt de kaarthoogte. "Nieuw" is af te leiden en valt als eerste af.
    const delen = [];
    if (known) delen.push(known + " zit erin");
    if (learning) delen.push(learning + " aan het leren");
    if (!delen.length && nieuw) delen.push(nieuw + " nieuw");
    return '<button type="button" class="' + cls("lesson", o.mix && "is-mix") + '"' + attr("data-id", o.id) + '>' +
      '<div class="lesson-body">' +
        // het vak staat al als kop boven de kaarten; alleen de gemengde ronde krijgt een label
        (o.mix ? '<span class="subj">' + Icon("sparkle") + "<span>herhalen</span></span>" : "") +
        '<h3>' + esc(o.title) + '</h3>' +
        '<span class="muted lesson-meta">' + esc(o.meta) + '</span>' +
        '<span class="lesson-stats">' + esc(delen.join(" · ")) + '</span>' +
      '</div>' +
      '<div class="lesson-ring">' + Ring({ known: known, learning: learning, total: o.total }) +
        '<span class="ring-cap">geoefend</span>' +
      '</div>' +
      '<span class="lesson-chips">' +
        (o.deadline ? '<span class="' + cls("deadline-chip", o.deadlineDagen !== null && o.deadlineDagen <= 1 && "is-dichtbij") + '">' +
          Icon("alert") + '<span>' + esc(o.deadline) + '</span></span>' : "") +
        (o.due ? '<span class="due-chip">' + Icon("clock") + '<span>' + esc(o.due) + ' aan de beurt</span></span>' : "") +
      '</span>' +
      '</button>';
  }

  // --- Spraak: wat de kat zegt -------------------------------
  // Een rustige balk met een korte zin. Alleen tekst, geen vrije HTML.
  function Spraak(o) {
    o = o || {};
    return '<p class="' + esc(cls("spraak", o.className)) + '"' + attr("id", o.id) + '>' + esc(o.text) + '</p>';
  }

  // --- Katten -------------------------------------------------
  // Elke kat komt binnen als beeld-object uit Celebrate.beeld(id, stand):
  // { id, src, beeld, width, height, kijkt }. Vaste width en height (het
  // doek uit katten.json, voor alle beelden gelijk), zodat er niets
  // verspringt als het plaatje binnenkomt of wisselt. data-kat en
  // data-beeld zeggen welk beeld er staat; Celebrate.speler werkt ze bij.
  function katImg(b, cl) {
    return '<img class="' + esc(cl) + '" src="' + esc(b.src) + '"' +
      ' width="' + (Number(b.width) || 0) + '" height="' + (Number(b.height) || 0) + '"' +
      ' alt="" data-kat="' + esc(b.id) + '" data-beeld="' + esc(b.beeld) + '" decoding="async">';
  }

  // KatRand: de kat van de ronde op de bovenrand van een kaart, rechts,
  // met links een Spraak. Hij kijkt naar binnen: kijkt hij naar rechts,
  // dan gespiegeld (de regel van Celebrate.spiegel, hier staat hij altijd
  // rechts). Zet hem samen met de kaart in een .kat-kaart. De kat is
  // versiering (alt leeg): de zin zegt wat er te zeggen is. Alles gaat
  // door esc(). Beweging doet Celebrate.speler op het <img>.
  //   beeld   Celebrate.beeld(id, stand)
  //   text    de zin in de spraakbalk
  //   textId  optioneel id op de spraakbalk
  function KatRand(o) {
    o = o || {};
    if (!o.beeld) return "";
    return '<div class="' + esc(cls("kat-rand", o.className)) + '"' + attr("id", o.id) + '>' +
      Spraak({ text: o.text, id: o.textId }) + katImg(o.beeld, cls("kat", o.beeld.kijkt === "rechts" && "gespiegeld")) + '</div>';
  }

  // Welkom: bij het openen, een keer per sessie, heel scherm. De naam van de
  // app, de kat van de eerstvolgende ronde, dan "Hoi <naam>". De kat
  // beweegt alleen met zijn eigen clip (Celebrate.speler, in index.html),
  // er komt geen css-beweging bovenop. Hij staat in het midden en wordt dus
  // nooit gespiegeld. Daarna vervaagt alles (ds.css, .welkom.vervaagt).
  // Zonder naam alleen de kat. De kat is versiering (alt leeg).
  //   beeld  Celebrate.welkomBeeld(id)
  //   naam   wie er oefent; gaat door esc()
  //   stil   true bij reduced motion: meteen het eindbeeld
  function Welkom(o) {
    o = o || {};
    const b = o.beeld;
    if (!b) return "";
    const naam = String(o.naam == null ? "" : o.naam).trim();
    const kat = o.stil ? { id: b.id, src: b.stil || b.src, beeld: "goed-eind", width: b.width, height: b.height } : b;
    return '<div class="welkom" role="status">' +
      '<p class="welkom-merk">Overhoren <span class="beta-chip">Beta</span></p>' +
      '<div class="welkom-podium">' + katImg(kat, "welkom-kat") + '</div>' +
      (naam ? '<p class="welkom-groet">Hoi ' + esc(naam) + '</p>' : "") +
      '</div>';
  }

  // --- hydrateIcons -------------------------------------------
  // Zet een icoon voor elk element met data-icon="naam", zodat de
  // HTML leesbaar blijft en de iconen toch uit een bron komen.
  function hydrateIcons(root) {
    (root || document).querySelectorAll("[data-icon]").forEach(function (el) {
      if (el.dataset.iconDone) return;
      const name = el.dataset.icon;
      if (!ICONS[name]) return;
      el.insertAdjacentHTML("afterbegin", Icon(name));
      // bestaande tekst in een span, zodat alleen die onderstreept wordt
      const svg = el.firstElementChild;
      const rest = [];
      for (let n = svg.nextSibling; n; n = n.nextSibling) rest.push(n);
      if (rest.length && !(rest.length === 1 && rest[0].nodeType === 1 && rest[0].tagName === "SPAN")) {
        const span = document.createElement("span");
        rest.forEach(n => span.appendChild(n));
        el.appendChild(span);
      }
      el.dataset.iconDone = "1";
    });
  }

  root.UI = { esc, cls, pct, Icon, ICONS, Button, Link, TopBar, Stat, StatsRow, Meter, Ring, Chip,
              Beta, BetaUitleg, BETA_UITLEG, VERSIE, bindBeta, Choice, Choices, Notice, Empty, Mark, MARK_ICON, LessonCard, Spraak, KatRand, Welkom, hydrateIcons };
})(typeof window === "object" ? window : globalThis);
