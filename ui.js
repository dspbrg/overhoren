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
    sparkle: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
    menu:    '<path d="M5 7h14M5 12h14M5 17h14"/>',
    info:    '<circle cx="12" cy="12" r="8.5"/><path d="M12 11.2V16"/><circle cx="12" cy="8.2" r=".9" fill="currentColor" stroke="none"/>',
    prullenbak: '<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2h9.2L17.5 7M10 11v5M14 11v5"/>'
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
  // De versie van de app staat in het menu (UI.Menu).
  const BETA_UITLEG = "We leren nog. Dingen kunnen veranderen.";
  // De versie van de app: de ?v= van dit script, die de deploy stempelt
  // (op Cloudflare de korte commit-sha). Zonder stempel, of buiten een
  // browser, "dev". index.html gebruikt hem ook na een update (registreerSW).
  // Het menu toont de eerste zeven tekens (UI.Menu).
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
    return '<p class="beta-uitleg"' + attr("id", o.id) + (o.open ? "" : " hidden") + '>' + esc(BETA_UITLEG) + '</p>';
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

  // --- IconBtn: vierkante knop met alleen een icoon -----------
  // label is verplicht: het is de naam voor een schermlezer. Met
  // controls wordt het een knop die iets opent (aria-expanded).
  function IconBtn(o) {
    o = o || {};
    return '<button type="button" class="' + cls("icon-btn", o.className) + '"' + attr("id", o.id) +
      attr("aria-label", o.label) +
      (o.controls ? ' aria-expanded="' + (o.open ? "true" : "false") + '"' + attr("aria-controls", o.controls) : "") + '>' +
      Icon(o.icon) + '</button>';
  }

  // --- Menu: kaart onder de menuknop ---------------------------
  // items: [{ id, icon, label, teller, tellerId }], knoppen die ergens
  // heen gaan. teller: een getal in een chip rechts (zoals bij de
  // Prullenbak); bij 0 of zonder teller geen chip. Met tellerId staat de
  // chip er altijd, verborgen bij 0, zodat de app hem kan bijwerken
  // (zetTeller).
  // thema: { id, labelId } zet de themakiezer erin (Systeem, Licht,
  // Donker; de app zet zelf welke aan staat). Onderaan de versie.
  // Ervoor een dimlaag die een tik buiten het menu opvangt.
  // Zet hem naast de menuknop (UI.IconBtn met controls) en koppel ze
  // met bindMenu(knop).
  function Menu(o) {
    o = o || {};
    const open = !!o.open;
    const items = (o.items || []).map(function (it) {
      return '<button type="button" class="menu-item"' + attr("id", it.id) + '>' + Icon(it.icon) + '<span>' + esc(it.label) + '</span>' +
        Teller({ id: it.tellerId, n: it.teller, altijd: !!it.tellerId }) + '</button>';
    }).join("");
    const th = o.thema;
    const thema = th ? '<div class="menu-sectie" role="group"' + attr("aria-labelledby", th.labelId) + '>' +
      '<span class="eyebrow"' + attr("id", th.labelId) + '>Thema</span>' +
      '<div class="seg"' + attr("id", th.id) + '>' +
        '<button type="button" data-theme="" aria-pressed="true" class="on">Systeem</button>' +
        '<button type="button" data-theme="light" aria-pressed="false">Licht</button>' +
        '<button type="button" data-theme="dark" aria-pressed="false">Donker</button>' +
      '</div></div>' : "";
    return '<div class="menu-scrim" aria-hidden="true"' + (open ? "" : " hidden") + '></div>' +
      '<nav class="menu"' + attr("id", o.id) + ' aria-label="Menu"' + (open ? "" : " hidden") + '>' + items + thema +
      '<p class="menu-versie"' + attr("id", o.versieId) + '>Versie ' + esc(String(o.versie || VERSIE).slice(0, 7)) + '</p></nav>';
  }
  // Teller: een getal in een chip, rechts in een menu-item. Alleen een
  // heel getal boven 0 telt; anders verborgen (altijd) of weg. De chip
  // zelf is voor het oog; een schermlezer hoort ", 2 lijsten", zodat de
  // naam van het item "Prullenbak, 2 lijsten" wordt en niet "Prullenbak2".
  function tellerTekst(n) { return ", " + n + (n === 1 ? " lijst" : " lijsten"); }
  function Teller(o) {
    o = o || {};
    const n = Math.max(0, Math.floor(Number(o.n) || 0));
    if (!n && !o.altijd) return "";
    return '<span class="teller"' + attr("id", o.id) + (n ? "" : " hidden") + '>' +
      '<span class="chip" aria-hidden="true">' + (n || "") + '</span><span class="sr-only">' + (n ? tellerTekst(n) : "") + '</span></span>';
  }
  function zetTeller(el, n) {
    if (!el) return;
    n = Math.max(0, Math.floor(Number(n) || 0));
    // bij 0 leeg en verborgen, zodat er ook in de tekst niets staat
    el.querySelector(".chip").textContent = n ? String(n) : "";
    el.querySelector(".sr-only").textContent = n ? tellerTekst(n) : "";
    el.hidden = !n;
  }
  // Tikken op de knop opent en sluit. Open: de focus naar het eerste item,
  // de knop wordt een kruis. Escape, een tik op de dimlaag of de knop
  // sluiten en zetten de focus terug op de knop. Een menu-item kiezen
  // sluit het menu ook, zonder de focus te verplaatsen: het item is dan
  // verborgen, dus de click-handler van het item zet de focus zelf op het
  // scherm dat het opent (in index.html: de Terug-knop, en Terug zet hem
  // weer op de menuknop). Gaat de focus met Tab uit het menu, dan sluit
  // het stil.
  function bindMenu(knop) {
    if (!knop || knop.dataset.menuDone) return;
    const menu = document.getElementById(knop.getAttribute("aria-controls"));
    if (!menu) return;
    const vorige = menu.previousElementSibling;
    const scrim = vorige && vorige.classList.contains("menu-scrim") ? vorige : null;
    const isOpen = () => !menu.hidden;
    function zet(open, focusTerug) {
      menu.hidden = !open;
      if (scrim) scrim.hidden = !open;
      knop.setAttribute("aria-expanded", open ? "true" : "false");
      knop.innerHTML = Icon(open ? "close" : "menu");
      if (open) { const eerste = menu.querySelector("button, a[href]"); if (eerste) eerste.focus(); }
      else if (focusTerug) knop.focus();
    }
    knop.addEventListener("click", () => zet(!isOpen(), true));
    if (scrim) scrim.addEventListener("click", () => zet(false, true));
    menu.addEventListener("click", e => { if (e.target.closest(".menu-item")) zet(false, false); });
    menu.addEventListener("focusout", e => {
      const naar = e.relatedTarget;
      if (isOpen() && naar && naar !== knop && !menu.contains(naar)) zet(false, false);
    });
    // in de vangfase: Escape sluit eerst het menu en verder niets
    document.addEventListener("keydown", e => {
      if (e.key !== "Escape" || !isOpen()) return;
      e.stopPropagation();
      zet(false, true);
    }, true);
    knop.dataset.menuDone = "1";
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

  // --- CodePaneel: verder op een ander toestel -----------------
  //   code     de sync-code, zoals panda-mango-wolk-47 (gaat door esc());
  //            leeg: geen code in beeld, alleen de vraag of de melding
  //   link     dezelfde code als link (gaat door esc())
  //   vorige   de code van voor de laatste overstap, om terug te kunnen
  //   vraag    { ander, leeg }: een code van een ander toestel waarover we
  //            eerst iets vragen; knoppen Overstappen en Mijn code houden
  //   opgeslagen  false: de code staat nog niet op de server; dan geen
  //            kopieerknoppen en geen link
  //   melding  korte tekst (role=status), bijvoorbeeld na kopieren
  //   voorvoegsel  voor alle ids, als er meer dan een op een pagina staat
  //            (alleen het design system; de app heeft er een)
  // Het veld "Heb je al een code?" staat er altijd, ook zonder eigen code.
  // De code is een geheim: dit paneel is de enige plek waar hij staat.
  function CodePaneel(o) {
    o = o || {};
    const v = o.vraag;
    const id = function (n) { return (o.voorvoegsel || "") + n; };
    let html = '<div class="code-paneel" role="group" aria-label="Verder op een ander toestel">';
    if (o.code) {
      html += '<p class="eyebrow">Jouw code</p>' +
        '<p class="code-groot" id="' + id("code-tekst") + '">' + esc(o.code) + '</p>';
      if (!v && o.opgeslagen !== false) html += '<div class="row">' + Button({ id: id("btn-code-kopieer"), label: "Kopieer code" }) +
          Button({ id: id("btn-link-kopieer"), label: "Kopieer link" }) + '</div>' +
        '<p class="code-link" id="' + id("code-link") + '">' + esc(o.link) + '</p>' +
        '<p class="hint">Open de link of typ de code op je andere toestel. Houd hem voor jezelf: met deze code kan iemand je voortgang zien.</p>';
    }
    if (o.vorige) html += '<p class="hint">Vorige code: <span class="code-vorig" id="' + id("code-vorige") + '">' + esc(o.vorige) + '</span></p>';
    if (v) {
      const zinnen = [];
      if (v.ander) zinnen.push("Deze code hoort bij iemand anders of bij een ander toestel. Wil je overstappen?");
      if (v.leeg) zinnen.push("Geen voortgang gevonden bij deze code." + (v.ander ? "" : " Wil je hem toch gebruiken?"));
      html += '<div class="code-vraag" id="' + id("code-vraag") + '">' + zinnen.map(function (z) { return '<p>' + esc(z) + '</p>'; }).join("") +
        '<div class="row">' + Button({ id: id("btn-code-over"), label: "Overstappen", variant: "primary" }) +
        Button({ id: id("btn-code-houden"), label: o.code ? "Mijn code houden" : "Niet overstappen" }) + '</div></div>';
    }
    html += '<label for="' + id("code-invoer") + '">Heb je al een code?</label>' +
      '<div class="row"><input type="text" id="' + id("code-invoer") + '" autocomplete="off" autocapitalize="none" spellcheck="false" maxlength="200"' +
        ' placeholder="woord-woord-woord-12" aria-describedby="' + id("code-uitleg") + " " + id("code-melding") + '">' + Button({ id: id("btn-code-gebruik"), label: "Gebruik code" }) + '</div>' +
      '<p class="hint" id="' + id("code-uitleg") + '">Je voortgang wordt per lijst samengevoegd: het nieuwste telt.</p>';
    html += '<p class="hint" id="' + id("code-melding") + '" role="status"' + (o.melding ? "" : " hidden") + '>' + esc(o.melding || "") + '</p>' +
      Link({ id: id("btn-code-sluit"), label: "Sluiten" }) + '</div>';
    return html;
  }

  // --- Ongedaan: balk onderin na verwijderen --------------------
  // Een donkere balk (in het donkere thema licht) met een korte zin en de
  // link Ongedaan maken, en een balk die aftelt. role="status": de zin
  // wordt voorgelezen, maar de balk pakt de focus niet; met Tab is hij te
  // bereiken. Zet hem een keer in de pagina (hidden) en toon hem met
  // toonOngedaan(el, { tekst, ms, ongedaan }).
  //   id      id van de balk
  //   tekst   de zin, zoals "Unité 2 is verwijderd." (gaat door esc())
  //   actie   tekst van de link, standaard Ongedaan maken
  //   hidden  verborgen beginnen
  function Ongedaan(o) {
    o = o || {};
    return '<div class="ongedaan" role="status"' + attr("id", o.id) + (o.hidden ? " hidden" : "") + '>' +
      '<div class="ongedaan-rij"><p class="ongedaan-tekst">' + esc(o.tekst) + '</p>' +
      Link({ label: o.actie || "Ongedaan maken", className: "ongedaan-actie" }) + '</div>' +
      '<span class="meter sm ongedaan-meter" aria-hidden="true"><i class="b"></i></span></div>';
  }
  // Toont de balk met een nieuwe zin. Hij staat --ongedaan-duur (ds.css, 8 s)
  // en pauzeert zolang de focus of de muis erin is. Een nieuwe aanroep
  // vervangt de vorige: de oude ongedaan-actie vervalt. Ongedaan maken
  // roept o.ongedaan() aan en haalt de balk weg. Geeft een functie terug
  // die de balk meteen weghaalt. De aftelbalk is een css-animatie van
  // dezelfde duur (ds.css, .ongedaan.telt); bij reduced motion staat hij
  // stil, de tijd geldt wel.
  function toonOngedaan(el, o) {
    if (!el) return function () {};
    o = o || {};
    if (el._ongedaanWeg) el._ongedaanWeg();
    // de tijd staat in ds.css (--ongedaan-duur); o.ms kan hem vervangen
    if (Number(o.ms) > 0) el.style.setProperty("--ongedaan-duur", Number(o.ms) + "ms");
    const ms = parseFloat(getComputedStyle(el).getPropertyValue("--ongedaan-duur")) || 8000;
    const link = el.querySelector(".ongedaan-actie");
    let rest = ms, start = 0, klok = null, muis = false, weg = false;
    function loop() { start = Date.now(); klok = setTimeout(sluit, rest); el.classList.remove("pauze"); }
    function pauze() {
      if (!klok) return;
      clearTimeout(klok); klok = null;
      rest = Math.max(0, rest - (Date.now() - start));
      el.classList.add("pauze");
    }
    function verder() { if (!weg && !klok && !muis && !el.contains(document.activeElement)) loop(); }
    const opMuis = () => { muis = true; pauze(); };
    const vanMuis = () => { muis = false; verder(); };
    const opFocus = () => pauze();
    const vanFocus = e => { if (!el.contains(e.relatedTarget)) setTimeout(verder, 0); };
    const opLink = () => { const f = o.ongedaan; sluit(); if (f) f(); };
    function sluit() {
      if (weg) return;
      weg = true;
      clearTimeout(klok); klok = null;
      el.removeEventListener("mouseenter", opMuis); el.removeEventListener("mouseleave", vanMuis);
      el.removeEventListener("focusin", opFocus); el.removeEventListener("focusout", vanFocus);
      if (link) link.removeEventListener("click", opLink);
      el.classList.remove("telt", "pauze");
      el.hidden = true;
      el._ongedaanWeg = null;
    }
    el.classList.remove("telt", "pauze");
    el.hidden = false;
    void el.offsetWidth;   // de aftelbalk begint opnieuw
    el.classList.add("telt");
    // de zin pas na het tonen zetten, zodat role=status hem voorleest
    el.querySelector(".ongedaan-tekst").textContent = String(o.tekst == null ? "" : o.tekst);
    el.addEventListener("mouseenter", opMuis); el.addEventListener("mouseleave", vanMuis);
    el.addEventListener("focusin", opFocus); el.addEventListener("focusout", vanFocus);
    if (link) link.addEventListener("click", opLink);
    el._ongedaanWeg = sluit;
    loop();
    if (el.matches(":hover")) opMuis();
    return sluit;
  }

  // --- PrullenKaart: een lijst in de prullenbak -----------------
  //   id       het id van de lijst (data-id)
  //   vak      eyebrow, mag leeg
  //   titel    de naam van de lijst
  //   regel    eronder, zoals "12 woorden · nog 27 dagen"
  //   eigen    true: ook Definitief verwijderen (alleen eigen lijsten)
  //   bevestig true: in plaats van de knoppen de vraag of het definitief
  //            moet, met Ja, verwijder en Annuleren (role=group met de
  //            vraag als naam)
  //   kopId    id voor de titel (voor aria-labelledby)
  // Alles gaat door esc(). De knoppen hebben data-actie: terug, wis, ja
  // of annuleer; de app koppelt ze.
  function PrullenKaart(o) {
    o = o || {};
    const kop = o.kopId ? attr("id", o.kopId) : "";
    const vraagId = o.kopId ? o.kopId + "-vraag" : null;
    let onder;
    if (o.bevestig) {
      onder = '<div class="notice prullen-vraag" role="group"' + attr("aria-labelledby", vraagId) + '>' +
        Icon("alert", { className: "notice-icon" }) + '<div>' +
        '<p' + attr("id", vraagId) + '><b>Definitief verwijderen?</b> Dit kan niet ongedaan worden gemaakt.</p>' +
        '<div class="row"><button type="button" class="btn danger" data-actie="ja">Ja, verwijder</button>' +
        '<button type="button" class="link" data-actie="annuleer"><span>Annuleren</span></button></div></div></div>';
    } else {
      onder = '<div class="row"><button type="button" class="btn primary" data-actie="terug">Terugzetten</button>' +
        (o.eigen ? '<button type="button" class="link danger" data-actie="wis"><span>Definitief verwijderen</span></button>' : "") + '</div>';
    }
    return '<div class="card prullen"' + attr("data-id", o.id) + '>' +
      '<div>' + (o.vak ? '<span class="eyebrow">' + esc(o.vak) + '</span>' : "") +
      '<h2 class="prullen-titel"' + kop + '>' + esc(o.titel) + '</h2>' +
      '<p class="muted">' + esc(o.regel) + '</p></div>' + onder + '</div>';
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
  // Elke kat komt binnen als beeld-object uit Celebrate.beeld(id, stand)
  // of Celebrate.welkomBeeld(id): { id, src, beeld, width, height }. Vaste
  // width en height (het doek uit katten.json), zodat er niets verspringt
  // als het plaatje binnenkomt of wisselt. data-kat en data-beeld zeggen
  // welk beeld er staat; Celebrate.toon en Celebrate.welkomSpeler werken
  // ze bij.
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
  // door esc(). De kat staat stil; een andere stand zet Celebrate.toon.
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
  // app, de kat van de eerstvolgende ronde in een lichte zeshoek (punt boven
  // en onder) waar hij bovenuit steekt, dan "Hoi <naam>". Alleen hier
  // beweegt de kat: Celebrate.welkomSpeler (in index.html) zet daarna zijn
  // welkomclip op het <img>, er komt geen css-beweging bovenop. Tot dan, en
  // bij reduced motion, staat het eerste beeld van die clip stil. Hij staat
  // in het midden en wordt dus nooit gespiegeld. Daarna opent een zeshoekig
  // gat (ds.css, .welkom.opent). Zonder naam alleen de kat. De kat en de
  // zeshoek zijn versiering (alt leeg, aria-hidden).
  //   beeld  Celebrate.welkomBeeld(id)
  //   naam   wie er oefent; gaat door esc()
  function Welkom(o) {
    o = o || {};
    const b = o.beeld;
    if (!b) return "";
    const naam = String(o.naam == null ? "" : o.naam).trim();
    return '<div class="welkom" role="status">' +
      '<p class="welkom-merk">Overhoren <span class="beta-chip">Beta</span></p>' +
      '<div class="welkom-podium"><span class="welkom-zeshoek" aria-hidden="true"></span>' + katImg(b, "welkom-kat") + '</div>' +
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
              Beta, BetaUitleg, BETA_UITLEG, VERSIE, bindBeta, IconBtn, Menu, Teller, zetTeller, bindMenu, Ongedaan, toonOngedaan, PrullenKaart, Choice, Choices, Notice, CodePaneel, Empty, Mark, MARK_ICON, LessonCard, Spraak, KatRand, Welkom, hydrateIcons };
})(typeof window === "object" ? window : globalThis);
