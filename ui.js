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
    trophy:  '<path d="M7 4h10v4.6a5 5 0 0 1-10 0z"/><path d="M7 6H4.2v1.7A3 3 0 0 0 7 10.6M17 6h2.8v1.7A3 3 0 0 1 17 10.6"/><path d="M12 13.6V18M9.5 20h5"/>',
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

  // --- Chip: woordsoort ---------------------------------------
  function Chip(kind) {
    return kind ? '<span class="chip ' + esc(kind) + '">' + esc(kind) + '</span>' : "";
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
    return '<button type="button" class="lesson"' + attr("data-id", o.id) + '>' +
      '<span class="subj">' + esc(o.subject || "Woordenlijst") + '</span>' +
      '<span class="cnt">' + esc(o.known) + '<small>van ' + esc(o.total) + '</small></span>' +
      '<h2>' + esc(o.title) + '</h2>' +
      '<span class="muted">' + esc(o.meta) + (o.due ? ' · <b>' + esc(o.due) + ' aan de beurt</b>' : "") + '</span>' +
      Meter({ size: "sm", total: o.total, parts: [
        { kind: "a", value: o.known },
        { kind: "b", value: o.learning }
      ]}) +
      '</button>';
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

  root.UI = { esc, cls, pct, Icon, ICONS, Button, Link, TopBar, Stat, StatsRow, Meter, Chip,
              Choice, Choices, Notice, Empty, Mark, MARK_ICON, LessonCard, hydrateIcons };
})(typeof window === "object" ? window : globalThis);
