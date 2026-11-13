// =============================================================
// Overhoren katten en viering
//
// Zes vaste katten, elk met een eigen karakter. Ze bewegen met korte
// clips (geanimeerde WebP, 6 beelden per seconde, bewust een beetje
// schokkerig) en blijven daarna in hun eindstand staan. Per kat:
//   rust         stilstaand, als de vraag openstaat
//   goed         clip, daarna goed-eind: bij een goed antwoord en bij gedag
//   bijna        clip, daarna bijna-eind: bij een fout of bijna-goed
//                antwoord, en bij gedag na een stevige ronde
// Alles staat in katten/clips/, en katten/clips/katten.json beschrijft
// het: bestandsnamen, maat van het doek, duur per clip en kijkrichting.
// Hier staat daarvan niets vast; laadCatalogus() leest het.
//
// Regel: de kat kijkt naar binnen. Staat hij rechts van de inhoud en
// kijkt hij "rechts", dan spiegelen we hem (klasse .gespiegeld in ds.css).
// Kijkt hij "voor", dan nooit. Rust is het eerste beeld van de goed-clip,
// dus rust volgt de kijkrichting van goed.
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
// canvas, geen library. Respecteert prefers-reduced-motion: dan geen
// confetti, en de kat staat meteen in zijn eindstand.
// =============================================================
(function (root) {
  "use strict";

  // --- de zes katten -----------------------------------------------
  // Naam en karakter; de beelden komen uit katten.json.
  const KATTEN = [
    { id: "strepen",    naam: "Strepen",     karakter: "knus" },
    { id: "tuxedo",     naam: "Tuxedo",      karakter: "muziek" },
    { id: "lapjes",     naam: "Lapjes",      karakter: "leergierig" },
    { id: "sokjes",     naam: "Sokjes",      karakter: "sportief" },
    { id: "stippen",    naam: "Stippen",     karakter: "avontuurlijk" },
    { id: "rodestreep", naam: "Rode streep", karakter: "ondeugend" }
  ];
  const STANDEN = ["rust", "goed", "bijna"];
  const CLIPS = ["goed", "bijna"];
  // houding voor de alt-tekst: "Strepen, knus, blij"
  const HOUDING = { rust: "kijkt mee", goed: "blij", bijna: "rustig" };

  function zoek(id) { return KATTEN.find(k => k.id === id) || null; }
  function bestaat(id) { return !!zoek(id); }

  // --- katten.json ----------------------------------------------------
  const MAP = "katten/clips/";
  let catalogus = null, catalogusBelofte = null;
  const bestand = s => typeof s === "string" && /^[a-z0-9-]+\.webp$/.test(s);
  const maat = n => Number.isInteger(n) && n > 0 && n <= 4096;
  // Alleen wat klopt komt erin: veilige bestandsnamen, een duur, een
  // kijkrichting. Een kat die niet klopt, valt weg (dan geen kat).
  function controleer(c) {
    if (!c || typeof c !== "object" || !maat(c.breedte) || !maat(c.hoogte) || !c.katten || typeof c.katten !== "object") return null;
    const katten = {};
    for (const k of KATTEN) {
      const x = c.katten[k.id];
      if (!x || !bestand(x.rust)) continue;
      const ok = CLIPS.every(m => x[m] && bestand(x[m].anim) && bestand(x[m].eind) &&
        Number.isFinite(x[m].duurMs) && x[m].duurMs > 0 && x[m].duurMs <= 10000 && (x[m].kijkt === "rechts" || x[m].kijkt === "voor"));
      if (!ok) continue;
      katten[k.id] = { rust: x.rust };
      for (const m of CLIPS) katten[k.id][m] = { anim: x[m].anim, eind: x[m].eind, duurMs: x[m].duurMs, kijkt: x[m].kijkt };
    }
    return { breedte: c.breedte, hoogte: c.hoogte, katten };
  }
  // Haalt katten.json een keer op (uit de service worker als die er is).
  // Lukt het niet, dan null, en de volgende keer opnieuw proberen.
  function laadCatalogus() {
    if (catalogus) return Promise.resolve(catalogus);
    if (!catalogusBelofte) {
      catalogusBelofte = Promise.resolve()
        .then(() => root.fetch(MAP + "katten.json"))
        .then(r => { if (!r.ok) throw new Error("katten.json " + r.status); return r.json(); })
        .then(c => { catalogus = controleer(c); if (!catalogus) throw new Error("katten.json klopt niet"); return catalogus; })
        .catch(() => { catalogusBelofte = null; return null; });
    }
    return catalogusBelofte;
  }
  function gegevens(id) { return (catalogus && catalogus.katten[id]) || null; }

  // Kijkrichting per stand. Rust is het eerste beeld van de goed-clip.
  function kijkt(id, stand) {
    const k = gegevens(id);
    if (!k) return "voor";
    return (stand === "bijna" ? k.bijna : k.goed).kijkt;
  }
  // De regel: alleen rechts van de inhoud en naar rechts kijkend spiegelen.
  function spiegel(richting, plaats) { return plaats === "rechts" && richting === "rechts"; }

  // Alles om een kat stil te tekenen: rust, of het eindbeeld van een stand.
  // ui.js kent de catalogus niet; die krijgt dit object en tekent het.
  function beeld(id, stand) {
    const k = zoek(id), g = gegevens(id);
    if (!k || !g) return null;
    const s = STANDEN.includes(stand) ? stand : "rust";
    return {
      id: k.id, naam: k.naam, karakter: k.karakter, stand: s, houding: HOUDING[s],
      src: MAP + (s === "rust" ? g.rust : g[s].eind), beeld: s === "rust" ? "rust" : s + "-eind",
      width: catalogus.breedte, height: catalogus.hoogte, kijkt: kijkt(id, s),
      alt: k.naam + ", " + k.karakter + ", " + HOUDING[s]
    };
  }

  // --- het beeld van het welkom -------------------------------------
  // De goed-clip van de kat. UI.Welkom tekent eerst src (rust, het eerste
  // beeld van de clip), of stil bij reduced motion (het eindbeeld). Daarna
  // speelt index.html de clip met speler().
  function welkomBeeld(id) {
    const r = beeld(id, "rust"), e = beeld(id, "goed");
    if (!r || !e) return null;
    return { id: r.id, src: r.src, stil: e.src, beeld: "rust", width: r.width, height: r.height, duurMs: gegevens(id).goed.duurMs };
  }

  // --- de beelden van een kat laden -------------------------------------
  // Alleen de kat van de ronde: rust, twee clips en twee eindbeelden. De
  // clips als Blob, zodat elke start een eigen object-URL krijgt en dus
  // bij het eerste beeld begint. De stilstaande beelden alvast in de
  // browser, zodat de wissel naar het eindbeeld niets laat zien. Een
  // andere kat laden laat de vorige los.
  let geladen = null;
  function laadKat(id) {
    if (geladen && geladen.id === id) return geladen.belofte;
    const g = { id, clips: { goed: null, bijna: null }, klaar: false, volledig: false, beelden: [] };
    geladen = g;
    g.belofte = laadCatalogus().then(() => {
      const k = gegevens(id);
      if (!k) return [false];
      const stil = typeof root.Image === "function" ? [k.rust, k.goed.eind, k.bijna.eind].map(f => {
        const i = new root.Image();
        i.src = MAP + f;
        g.beelden.push(i);
        return i.decode ? i.decode().then(() => true, () => false) : Promise.resolve(true);
      }) : [];
      const clips = CLIPS.map(m => root.fetch(MAP + k[m].anim)
        .then(r => (r.ok ? r.blob() : null)).catch(() => null)
        .then(b => { g.clips[m] = b || null; return !!b; }));
      return Promise.all(stil.concat(clips));
    }).then(ok => {
      g.klaar = true;
      g.volledig = ok.length > 0 && ok.every(Boolean);
      return g;
    });
    return g.belofte;
  }

  // --- de speler ------------------------------------------------------
  // Een gewoon <img> en een timer. speel(id, stand):
  //   rust          meteen het rustbeeld
  //   goed, bijna   de clip uit een nieuwe object-URL, na duurMs het
  //                 eindbeeld (gelijk aan het laatste beeld van de clip,
  //                 en het vangt een browser op die de clip toch herhaalt)
  // speel(id, stand, { lus: true }), alleen voor het welkom: na elke duurMs
  // begint de clip opnieuw met een nieuwe object-URL (de WebP's spelen zelf
  // een keer), de vorige wordt opgeruimd. Het laatste beeld staat al 600 ms,
  // dus de herstart valt precies na dat beeld. uitlopen() maakt de lopende
  // ronde af en zet dan het eindbeeld; stop() houdt meteen op.
  // Een nieuw moment stopt de timer en begint meteen. De vorige URL wordt
  // opgeruimd zodra hij niet meer te zien is. Bij reduced motion, of als
  // de clip niet te laden is, meteen het eindbeeld. Geeft een belofte die
  // true wordt als het eindbeeld (of rust) staat, false als hij is afgebroken.
  // Het <img> houdt vaste width en height; alle beelden hebben hetzelfde doek.
  // plaats: "rechts" (rechts van de inhoud, dan geldt de spiegelregel),
  // of "midden" (nooit spiegelen).
  const WACHT_OP_CLIP = 600;   // ms; is de clip er dan nog niet, het eindbeeld
  function speler(img, opties) {
    const plaats = (opties && opties.plaats) || "midden";
    let timer = null, url = null, beurt = 0, lopend = null, lus = false;
    function ruimOp(behalve) {
      if (url && url !== behalve) { root.URL.revokeObjectURL(url); url = null; }
    }
    function zet(src, id, naam, richting) {
      img.src = src;
      img.setAttribute("data-kat", id);
      img.setAttribute("data-beeld", naam);
      img.classList.toggle("gespiegeld", spiegel(richting, plaats));
    }
    function onderbreek() {
      beurt++;
      if (timer !== null) { clearTimeout(timer); timer = null; }
      if (lopend) { const af = lopend; lopend = null; af(false); }
    }
    function speel(id, stand, opties) {
      onderbreek();
      lus = !!(opties && opties.lus);
      const mijn = beurt;
      return new Promise(af => {
        lopend = af;
        const klaar = () => { if (mijn === beurt) { lopend = null; af(true); } };
        const k = gegevens(id);
        if (!k) { klaar(); return; }
        laadKat(id);
        if (stand !== "goed" && stand !== "bijna") {
          zet(MAP + k.rust, id, "rust", kijkt(id, "rust")); ruimOp(); klaar(); return;
        }
        const c = k[stand];
        const eind = () => {
          if (mijn !== beurt) return;
          timer = null;
          zet(MAP + c.eind, id, stand + "-eind", c.kijkt); ruimOp(); klaar();
        };
        if (reduced()) { eind(); return; }
        const start = blob => {
          if (mijn !== beurt) return;
          if (!blob) { eind(); return; }
          const nieuw = root.URL.createObjectURL(blob);
          zet(nieuw, id, stand, c.kijkt);
          ruimOp(nieuw);
          url = nieuw;
          timer = setTimeout(() => (lus ? start(blob) : eind()), c.duurMs);
        };
        const g = geladen && geladen.id === id ? geladen : null;
        if (g && g.klaar) { start(g.clips[stand]); return; }
        // nog aan het laden: even wachten, dan de clip of het eindbeeld
        let gewacht = false;
        timer = setTimeout(() => { gewacht = true; timer = null; eind(); }, WACHT_OP_CLIP);
        laadKat(id).then(x => {
          if (gewacht || mijn !== beurt) return;
          clearTimeout(timer); timer = null;
          start(x.id === id ? x.clips[stand] : null);
        });
      });
    }
    function stop() { lus = false; onderbreek(); ruimOp(); }
    function uitlopen() { lus = false; }
    return { speel, stop, uitlopen };
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
  // Per moment de tekst en de stand van de kat: rust staat stil, goed en
  // bijna spelen hun clip en blijven dan in het eindbeeld.
  const ZEGT = {
    wacht: { stand: "rust",  tekst: "Ik kijk mee." },
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

  root.Celebrate = { celebrate, confetti, KATTEN, STANDEN, HOUDING, MAP, laadCatalogus, catalogus: () => catalogus, beeld, welkomBeeld, kijkt, spiegel,
    laadKat, speler, bestaat, nieuweRonde, volgende, onthoud, vorige, zegt, gedag, ZEGT, GEDAG, VORIGE };
})(typeof window === "object" ? window : globalThis);
