// =============================================================
// Overhoren viering
//
// Gaat alleen af bij een vlekkeloze ronde: alles in een keer goed.
// Zeldzaam houden is het hele punt, anders betekent het niets meer.
//
// Confetti is met de hand getekend op een canvas, geen library.
// De katten zijn gewone bestanden in cats/. Eentje erbij zetten is
// genoeg, CATS hieronder aanvullen en klaar.
//
// Respecteert prefers-reduced-motion: dan geen beweging, wel de kat.
// =============================================================
(function (root) {
  "use strict";

  // De kattencatalogus. Een kat erbij? Zet het bestand in app/cats/ en
  // voeg hier een regel toe met een naam en een zeldzaamheid.
  //   gewoon    valt vaak
  //   bijzonder valt af en toe
  //   zeldzaam  valt bijna nooit, met gouden randje in de collectie
  // De catalogus komt uit cats.js, dat door maak-catalogus.sh uit de map
  // app/cats/ wordt gebouwd. Ontbreekt dat bestand, dan valt de app terug
  // op deze minimale lijst zodat er nooit niets is.
  const CATS = (root.CAT_CATALOG && root.CAT_CATALOG.length) ? root.CAT_CATALOG : [
    { src: "cats/gewoon-de-spionnen.jpg", naam: "De Spionnen", rang: "gewoon" }
  ];
  // Kans per zeldzaamheid. Tellen niet op tot 100 als een rang leeg is;
  // dan valt de keuze vanzelf terug op een rang die wel bestaat.
  const KANS = { gewoon: 70, bijzonder: 25, zeldzaam: 5 };

  // Onderschriften bij de foto. Willekeurig gekozen, los van de kat.
  const CAPTIONS = ["Foutloos!", "Nul fouten", "Kat is trots", "Hoedje af", "Helemaal goed"];

  // --- verzameling -------------------------------------------------
  // Per oefenaar bijhouden welke katten al gevallen zijn en hoe vaak.
  let wieVerzamelt = "pia";
  function setLearner(naam) { wieVerzamelt = String(naam || "pia").toLowerCase().replace(/[^a-z0-9]+/g, "-"); }
  const KKEY = () => "overhoor:cats:" + wieVerzamelt;
  function collectie() {
    try { return JSON.parse(localStorage.getItem(KKEY()) || "{}"); } catch (e) { return {}; }
  }
  function bewaar(c) { try { localStorage.setItem(KKEY(), JSON.stringify(c)); } catch (e) {} }
  function verdien(src) {
    const c = collectie();
    const nu = Date.now();
    const nieuw = !c[src];
    c[src] = { aantal: (c[src] ? c[src].aantal : 0) + 1, eerst: nieuw ? nu : c[src].eerst, laatst: nu };
    bewaar(c);
    return nieuw;
  }
  // Eerst een rang loten, dan een kat binnen die rang. Zo bepaalt de
  // zeldzaamheid de kans, niet het aantal plaatjes per rang.
  function loot() {
    const beschikbaar = Object.keys(KANS).filter(r => CATS.some(k => k.rang === r));
    const totaal = beschikbaar.reduce((s, r) => s + KANS[r], 0);
    let n = Math.random() * totaal;
    let rang = beschikbaar[beschikbaar.length - 1];
    for (const r of beschikbaar) { if (n < KANS[r]) { rang = r; break; } n -= KANS[r]; }
    return pick(CATS.filter(k => k.rang === rang));
  }

  const PRAISE = [
    "Alles goed. Alles.",
    "Foutloos!",
    "Niet een fout. Serieus.",
    "Perfecte ronde.",
    "Helemaal vlekkeloos."
  ];

  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }
  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  // --- confetti ---------------------------------------------------
  // Snippers vallen met zwaartekracht en wat luchtweerstand, en
  // tollen om hun as. Kleuren komen uit de tokens, zodat het bij de
  // app blijft passen ook als je het thema aanpast.
  // De tokens staan als light-dark(licht, donker) in de CSS. getPropertyValue
  // geeft die tekst onopgelost terug, en dat is geen geldige fillStyle: canvas
  // negeert hem dan en alles wordt een kleur. Daarom laten we de browser hem
  // eerst uitrekenen via een echt element.
  function resolveColors(tokens) {
    const probe = document.createElement("span");
    probe.style.cssText = "position:absolute;left:-9999px;width:0;height:0";
    document.body.appendChild(probe);
    const out = tokens.map(function (t) {
      probe.style.color = "";
      probe.style.color = "var(" + t + ")";
      const c = getComputedStyle(probe).color;
      return /^rgba?\(/.test(c) ? c : null;
    }).filter(Boolean);
    probe.remove();
    return out.length ? out : ["#6B3FD1", "#2E9E5B", "#F0BE55", "#D9463A", "#2C6BB3"];
  }

  function confetti(duration) {
    const colors = resolveColors(["--accent", "--ok", "--tertiary", "--warn",
                                  "--adj", "--verb", "--noun", "--bad"]);

    const cv = document.createElement("canvas");
    cv.className = "fx-canvas";
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    function size() {
      cv.width = innerWidth * dpr; cv.height = innerHeight * dpr;
      cv.style.width = innerWidth + "px"; cv.style.height = innerHeight + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    size();
    addEventListener("resize", size);

    const N = innerWidth < 500 ? 120 : 220;
    const bits = [];
    for (let i = 0; i < N; i++) {
      const soort = Math.random();
      bits.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * 0.7,
        w: 6 + Math.random() * 7,
        h: 9 + Math.random() * 9,
        vx: -1.6 + Math.random() * 3.2,
        vy: 2.0 + Math.random() * 3.6,
        rot: Math.random() * Math.PI,
        vr: -0.18 + Math.random() * 0.36,
        zwaai: 0.6 + Math.random() * 1.4,      // hoe sterk hij heen en weer wiegt
        fase: Math.random() * Math.PI * 2,
        vorm: soort < 0.62 ? "snipper" : soort < 0.85 ? "rond" : "lint",
        color: colors[i % colors.length]        // gelijkmatig over alle kleuren
      });
    }

    const end = performance.now() + (duration || 2600);
    function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      for (const b of bits) {
        b.vy += 0.045;          // zwaartekracht
        b.vx *= 0.995;          // luchtweerstand
        b.fase += 0.06;
        b.x += b.vx + Math.sin(b.fase) * b.zwaai * 0.5;   // wiegen tijdens het vallen
        b.y += b.vy; b.rot += b.vr;
        if (b.y < innerHeight + 40) alive = true;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        if (b.vorm === "rond") {
          ctx.beginPath();
          ctx.ellipse(0, 0, b.w / 2, (b.w / 2) * Math.abs(Math.cos(b.rot)), 0, 0, Math.PI * 2);
          ctx.fill();
        } else if (b.vorm === "lint") {
          ctx.fillRect(-b.w / 4, -b.h, b.w / 2, b.h * 2 * Math.abs(Math.cos(b.rot)));
        } else {
          // de snipper kantelt, zodat hij lijkt te fladderen
          ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.rot)));
        }
        ctx.restore();
      }
      if (alive && now < end) requestAnimationFrame(frame);
      else { removeEventListener("resize", size); cv.remove(); }
    }
    requestAnimationFrame(frame);
  }

  // --- kat --------------------------------------------------------
  // De foto's zijn niet vrijstaand, dus ze krijgen een lijstje: een
  // scheef hangend fotokaartje dat midden in beeld opklapt.
  // Vaste beeldverhouding met object-fit, zodat elke foto er even
  // netjes uitziet ongeacht het bronformaat.
  // Laadt het plaatje niet, dan verschijnt er niets en breekt er niets.
  function cat() {
    if (!CATS.length) return null;
    const kat = loot();
    const nieuw = verdien(kat.src);
    const img = new Image();
    img.src = kat.src;
    img.onerror = function () { /* stil overslaan */ };
    img.onload = function () {
      const fig = document.createElement("figure");
      fig.className = "fx-cat";
      // lichte willekeurige scheefstand, zodat het niet klinisch recht hangt
      fig.style.setProperty("--tilt", (Math.random() < .5 ? -1 : 1) * (3 + Math.random() * 3) + "deg");
      fig.setAttribute("aria-hidden", "true");
      img.alt = "";
      fig.appendChild(img);
      fig.dataset.rang = kat.rang;
      const cap = document.createElement("figcaption");
      cap.innerHTML = '<b>' + kat.naam + '</b>' +
        '<span class="fx-cat-sub">' + (nieuw ? "Nieuwe kat!" : pick(CAPTIONS)) + '</span>';
      fig.appendChild(cap);
      document.body.appendChild(fig);
      requestAnimationFrame(() => fig.classList.add("is-in"));
      setTimeout(function () {
        fig.classList.remove("is-in");
        setTimeout(() => fig.remove(), 700);
      }, 3600);
    };
  }

  // --- viering ----------------------------------------------------
  // perfect: alles in een keer goed. Alleen dan gaat dit af.
  function celebrate(opts) {
    opts = opts || {};
    if (!reduced()) confetti(opts.duration);
    cat();
    return pick(PRAISE);
  }

  root.Celebrate = { celebrate, confetti, cat, collectie, setLearner, loot,
                     CATS, KANS, CAPTIONS, PRAISE };
})(typeof window === "object" ? window : globalThis);
