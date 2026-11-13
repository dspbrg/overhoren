// =============================================================
// Overhoren katten en viering
//
// Zes vaste katten, elk met een eigen karakter en twee standen:
//   goed   blij, bij een goed antwoord en na een vlekkeloze ronde
//   bijna  rustig, bij een fout of bijna-goed antwoord
// De beelden staan in katten/<id>-<stand>.webp, vrijstaand, 480 px hoog.
// Ze kijken naar rechts of recht vooruit. Regel: de kat kijkt naar
// binnen. Links van de inhoud zoals hij is, rechts gespiegeld (ds.css).
//
// De kat is een maatje, geen beloning. Hij zit de hele ronde op de
// rand van de vraagkaart, kijkt mee en zegt iets bij elk antwoord. Aan
// het eind zegt hij gedag. Wat hij zegt staat hieronder (ZEGT, gedag).
//
// Er valt niets te verdienen of te verzamelen. Elke ronde komt er
// vanzelf een kat langs, binnen de ronde steeds dezelfde, en nooit twee
// rondes achter elkaar dezelfde. Het enige dat bewaard wordt is welke
// kat het laatst langskwam (overhoor:kat:vorige, voor alle oefenaars
// samen). De app zet de kat van een ronde in die ronde zelf, zodat een
// hervatte ronde dezelfde kat houdt.
//
// Oude data van eerdere versies (overhoor:cats:* en de kattenopslag
// per oefenaar) blijft ongemoeid staan en wordt niet meer gelezen.
//
// Confetti alleen na een vlekkeloze ronde, met de hand getekend op een
// canvas, geen library. Respecteert prefers-reduced-motion: dan geen confetti.
// =============================================================
(function (root) {
  "use strict";

  // --- de zes katten -----------------------------------------------
  // breed: breedte in pixels per stand bij een hoogte van HOOG, zodat
  // elk <img> vaste afmetingen krijgt en er niets verspringt.
  const HOOG = 480;
  const KATTEN = [
    { id: "strepen",    naam: "Strepen",     karakter: "knus",         breed: { goed: 275, bijna: 347 } },
    { id: "tuxedo",     naam: "Tuxedo",      karakter: "muziek",       breed: { goed: 360, bijna: 335 } },
    { id: "lapjes",     naam: "Lapjes",      karakter: "leergierig",   breed: { goed: 315, bijna: 366 } },
    { id: "sokjes",     naam: "Sokjes",      karakter: "sportief",     breed: { goed: 368, bijna: 341 } },
    { id: "stippen",    naam: "Stippen",     karakter: "avontuurlijk", breed: { goed: 339, bijna: 346 } },
    { id: "rodestreep", naam: "Rode streep", karakter: "ondeugend",    breed: { goed: 338, bijna: 339 } }
  ];
  const STANDEN = ["goed", "bijna"];
  // houding voor de alt-tekst: "Strepen, knus, blij"
  const HOUDING = { goed: "blij", bijna: "rustig" };

  function zoek(id) { return KATTEN.find(k => k.id === id) || null; }
  function bestaat(id) { return !!zoek(id); }

  // Alles wat nodig is om een kat te tekenen. ui.js kent de catalogus
  // niet; die krijgt dit object en tekent het.
  function beeld(id, stand) {
    const k = zoek(id);
    if (!k) return null;
    const s = STANDEN.includes(stand) ? stand : "goed";
    return {
      id: k.id, naam: k.naam, karakter: k.karakter, stand: s, houding: HOUDING[s],
      src: "katten/" + k.id + "-" + s + ".webp",
      width: k.breed[s], height: HOOG,
      alt: k.naam + ", " + k.karakter + ", " + HOUDING[s]
    };
  }

  // --- het beeld van het welkom -------------------------------------
  // De enige plek waar het welkom zijn beeld per kat kiest. Nu de blije
  // stand ("goed") als stilstaand beeld; de sprong en het wiebelen doet
  // ds.css (.welkom-kat).
  //
  // Een geanimeerde kat per kat inhangen:
  //   1. Zet het bestand in katten/, bijvoorbeeld katten/<id>-welkom.webp
  //      (geanimeerde WebP, speelt een keer af) of katten/<id>-welkom.mp4.
  //   2. Zet het in SCHIL in sw.js, anders werkt het welkom offline niet en
  //      slaat het stil over. katten/ staat al in .assetsignore.
  //   3. Geef hier src, width en height van dat bestand terug, met
  //      beweegtZelf: true. Dan laat ds.css de sprong en het wiebelen weg en
  //      speelt alleen het bestand. Voor een geanimeerde WebP is dat alles:
  //      het blijft een <img>. Laat stil naar het stilstaande beeld wijzen:
  //      dat krijgt wie minder beweging wil (UI.Welkom met stil: true).
  //   4. Video kan nog niet: geef dan soort: "video", voeg in UI.Welkom een
  //      <video muted playsinline autoplay> toe met stil als poster, en laat
  //      welkom() in index.html op "canplaythrough" wachten in plaats van op
  //      img.decode(). Totale duur blijft --welkom-duur in ds.css.
  function welkomBeeld(id) {
    const b = beeld(id, "goed");
    if (!b) return null;
    return { id: b.id, soort: "img", src: b.src, stil: b.src, width: b.width, height: b.height, beweegtZelf: false };
  }

  function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

  // --- de kat van een ronde -----------------------------------------
  // Een sleutel: het id van de laatst getoonde kat. Lukt localStorage
  // niet, dan onthouden we het in het geheugen voor deze sessie.
  const VORIGE = "overhoor:kat:vorige";
  let vorigeGeheugen = null;
  function vorige() {
    if (bestaat(vorigeGeheugen)) return vorigeGeheugen;
    try {
      const v = JSON.parse(localStorage.getItem(VORIGE));
      if (bestaat(v)) return v;
    } catch (e) { /* geen opslag of kapotte data */ }
    return null;
  }
  // De kat van de eerstvolgende ronde, alvast gekozen maar nog niet
  // onthouden (het welkom laat hem zien). Alleen in het geheugen: na
  // herladen wordt er opnieuw gekozen. Willekeurig, maar nooit de vorige.
  // Twee keer vragen geeft dezelfde kat.
  let gepland = null;
  function volgende() {
    const v = vorige();
    if (bestaat(gepland) && gepland !== v) return gepland;
    gepland = pick(KATTEN.filter(k => k.id !== v)).id;
    return gepland;
  }
  // Kiest de kat voor een nieuwe ronde: de geplande als die er is, anders
  // een nieuwe. Nooit de vorige. Geeft het id terug en onthoudt het als
  // de vorige.
  function nieuweRonde() {
    const id = volgende();
    gepland = null;
    onthoud(id);
    return id;
  }
  // Een hervatte ronde houdt zijn kat; die telt dan als de laatst getoonde.
  function onthoud(id) {
    if (!bestaat(id)) return;
    vorigeGeheugen = id;
    try { localStorage.setItem(VORIGE, JSON.stringify(id)); } catch (e) {}
  }

  // --- wat de kat zegt ----------------------------------------------
  // Altijd vriendelijk en vooruit kijkend, geen uitroeptekens.
  // Per moment de tekst en de stand van de kat.
  const ZEGT = {
    wacht: { stand: "bijna", tekst: "Ik kijk mee." },
    goed:  { stand: "goed",  tekst: "Dat zat erin." },
    fout:  { stand: "bijna", tekst: "Hm, wat zag je in dit woord? Hij komt straks nog een keer." }
  };
  // Einde van de ronde: soort is "vlekkeloos", "lastig", "gestopt" of iets
  // anders (gewoon). Gestopt: zelf gestopt en geen stevige ronde.
  const GEDAG = {
    vlekkeloos: { stand: "goed",  tekst: "Alles in één keer goed." },
    gewoon:     { stand: "goed",  tekst: "Dat was de ronde." },
    gestopt:    { stand: "goed",  tekst: "Even pauze. Wat je deed, telt al mee." },
    lastig:     { stand: "bijna", tekst: "Dat was een stevige ronde. Die woorden krijg je straks nog een keer." }
  };
  function zegt(moment) {
    const z = ZEGT[moment] || ZEGT.wacht;
    return { stand: z.stand, tekst: z.tekst };
  }
  function gedag(soort, naam) {
    const g = GEDAG[soort] || GEDAG.gewoon;
    const n = String(naam == null ? "" : naam).trim();
    return { stand: g.stand, tekst: g.tekst + (n ? " Dag " + n + "." : " Dag.") };
  }

  function reduced() {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

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
    return out.length ? out : ["#6B3FD1", "#F29A52", "#F0BE55", "#A88BF0"];
  }

  function confetti(duration) {
    const colors = resolveColors(["--confetti-1", "--confetti-2", "--confetti-3", "--confetti-4"]);

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

  // --- viering ----------------------------------------------------
  // Alleen na een vlekkeloze ronde: confetti, niet bij reduced motion.
  // Wat de kat zegt, regelt gedag().
  function celebrate(opts) {
    opts = opts || {};
    if (!reduced()) confetti(opts.duration);
  }

  root.Celebrate = { celebrate, confetti, KATTEN, STANDEN, HOUDING, beeld, welkomBeeld, bestaat, nieuweRonde, volgende, onthoud, vorige, zegt, gedag, ZEGT, GEDAG, VORIGE };
})(typeof window === "object" ? window : globalThis);
