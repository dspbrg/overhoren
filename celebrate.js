// =============================================================
// Overhoren katten en viering
//
// Zes vaste katten, elk met een eigen karakter. In de app staat de kat
// stil, met per kat drie beelden:
//   rust         als de vraag openstaat
//   goed-eind    bij een goed antwoord en bij gedag
//   bijna-eind   bij een fout of bijna-goed antwoord, en bij gedag na
//                een stevige ronde
// Alleen het welkom beweegt: per kat een eigen clip (welkom-<kat>.webp,
// geanimeerde WebP met alpha, 36 beelden, 12 per seconde, 3 s, speelt een
// keer) in een lichte zeshoek. Bij reduced motion staat daar het eerste beeld van die
// clip stil (welkom-<kat>-stil.webp).
// De oude goed- en bijna-clips (6 beelden per seconde) staan in
// archief/katten-clips-v3/ en worden niet meer geladen.
// Alles staat in katten/clips/, en katten/clips/katten.json beschrijft
// het: bestandsnamen, maat van het doek, kijkrichting en de welkomclip.
// Hier staat daarvan niets vast; laadCatalogus() leest het.
//
// Regel: de kat kijkt naar binnen. Staat hij rechts van de inhoud en
// kijkt hij "rechts", dan spiegelen we hem (klasse .gespiegeld in ds.css).
// Kijkt hij "voor", dan nooit. Rust is het eerste beeld van de oude
// goed-clip, dus rust volgt de kijkrichting van goed. Het welkom staat in
// het midden en wordt nooit gespiegeld.
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
// confetti en geen welkomclip.
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
  const EIND = ["goed", "bijna"];
  // houding voor de alt-tekst: "Strepen, knus, blij"
  const HOUDING = { rust: "kijkt mee", goed: "blij", bijna: "rustig" };

  function zoek(id) { return KATTEN.find(k => k.id === id) || null; }
  function bestaat(id) { return !!zoek(id); }

  // --- katten.json ----------------------------------------------------
  const MAP = "katten/clips/";
  let catalogus = null, catalogusBelofte = null;
  const bestand = s => typeof s === "string" && /^[a-z0-9-]+\.webp$/.test(s);
  const maat = n => Number.isInteger(n) && n > 0 && n <= 4096;
  // Alleen wat klopt komt erin: veilige bestandsnamen, een maat, een
  // kijkrichting. Een kat die niet klopt, valt weg (dan geen kat). Klopt
  // alleen zijn welkom niet, dan blijft de kat en slaat het welkom over.
  function controleer(c) {
    if (!c || typeof c !== "object" || !maat(c.breedte) || !maat(c.hoogte) || !c.katten || typeof c.katten !== "object") return null;
    const w = c.welkom;
    const doek = w && typeof w === "object" && maat(w.breedte) && maat(w.hoogte) ? { breedte: w.breedte, hoogte: w.hoogte } : null;
    const katten = {};
    for (const k of KATTEN) {
      const x = c.katten[k.id];
      if (!x || !bestand(x.rust)) continue;
      const ok = EIND.every(m => x[m] && bestand(x[m].eind) && (x[m].kijkt === "rechts" || x[m].kijkt === "voor"));
      if (!ok) continue;
      katten[k.id] = { rust: x.rust };
      for (const m of EIND) katten[k.id][m] = { eind: x[m].eind, kijkt: x[m].kijkt };
      const v = x.welkom;
      if (doek && v && bestand(v.anim) && bestand(v.stil) && Number.isFinite(v.duurMs) && v.duurMs > 0 && v.duurMs <= 10000) {
        katten[k.id].welkom = { anim: v.anim, stil: v.stil, duurMs: v.duurMs };
      }
    }
    return { breedte: c.breedte, hoogte: c.hoogte, welkom: doek, katten };
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

  // Kijkrichting per stand. Rust volgt goed.
  function kijkt(id, stand) {
    const k = gegevens(id);
    if (!k) return "voor";
    return (stand === "bijna" ? k.bijna : k.goed).kijkt;
  }
  // De regel: alleen rechts van de inhoud en naar rechts kijkend spiegelen.
  function spiegel(richting, plaats) { return plaats === "rechts" && richting === "rechts"; }

  // Alles om een kat te tekenen: rust, of het eindbeeld van een stand.
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

  // --- de kat stil zetten ---------------------------------------------
  // toon(img, id, stand, plaats) zet op een bestaand <img> meteen het
  // beeld van een stand (rust, goed-eind of bijna-eind), met data-kat en
  // data-beeld, en spiegelt volgens de regel. Er speelt niets: geen clip,
  // geen timer. Het <img> houdt zijn width en height; alle beelden hebben
  // hetzelfde doek, dus niets verspringt. plaats: "rechts" (rechts van de
  // inhoud, dan geldt de spiegelregel) of "midden" (nooit spiegelen).
  // Geeft false als de kat (nog) niet bekend is; dan blijft alles staan.
  function toon(img, id, stand, plaats) {
    const b = beeld(id, stand);
    if (!b) return false;
    if (img.getAttribute("src") !== b.src) img.src = b.src;
    img.setAttribute("data-kat", b.id);
    img.setAttribute("data-beeld", b.beeld);
    img.classList.toggle("gespiegeld", spiegel(b.kijkt, plaats || "midden"));
    return true;
  }

  // --- de beelden van een kat laden -------------------------------------
  // Alleen de kat van de ronde: rust en de twee eindbeelden, alvast in de
  // browser, zodat een wissel van stand niets laat zien. Een andere kat
  // laden laat de vorige los.
  function vooraf(g, src) {
    if (typeof root.Image !== "function") return Promise.resolve(true);
    const i = new root.Image();
    i.src = src;
    g.beelden.push(i);
    return i.decode ? i.decode().then(() => true, () => false) : Promise.resolve(true);
  }
  let geladen = null;
  function laadKat(id) {
    if (geladen && geladen.id === id) return geladen.belofte;
    const g = { id, klaar: false, volledig: false, beelden: [] };
    geladen = g;
    g.belofte = laadCatalogus().then(() => {
      const k = gegevens(id);
      if (!k) return [false];
      return Promise.all([k.rust, k.goed.eind, k.bijna.eind].map(f => vooraf(g, MAP + f)));
    }).then(ok => {
      g.klaar = true;
      g.volledig = ok.every(Boolean);
      return g;
    });
    return g.belofte;
  }

  // --- het welkom -------------------------------------------------------
  // welkomBeeld(id): wat UI.Welkom tekent. src is het stilstaande eerste
  // beeld van de welkomclip; daarmee begint het welkom altijd, ook bij
  // reduced motion. anim is de clip zelf. Eigen doek uit katten.json
  // (welkom.breedte, welkom.hoogte), anders dan dat van de ronde.
  function welkomBeeld(id) {
    const k = zoek(id), g = gegevens(id);
    if (!k || !g || !g.welkom) return null;
    return { id: k.id, src: MAP + g.welkom.stil, anim: MAP + g.welkom.anim, beeld: "welkom-stil",
      width: catalogus.welkom.breedte, height: catalogus.welkom.hoogte, duurMs: g.welkom.duurMs };
  }
  // laadWelkom(id, wacht): het stilstaande beeld alvast in de browser, en
  // de clip als Blob, zodat hij uit een eigen object-URL bij het eerste
  // beeld begint. Bij reduced motion alleen het stilstaande beeld, de clip
  // niet. De clip staat niet in de schil van de service worker: de eerste
  // keer komt hij van het netwerk (en de service worker bewaart hem), en
  // dat mag langer duren. Zonder wacht: de belofte wordt waar als alles
  // binnen is. Met wacht (ms): uiterlijk dan, zodra het stilstaande beeld
  // er is, ook als de clip nog onderweg is. g.stil zegt of het stilstaande
  // beeld er is, g.clip is de clip (null zolang hij er niet is), g.volledig
  // of alles binnen is.
  let welkomGeladen = null;
  function laadWelkom(id, wacht) {
    let g = welkomGeladen && welkomGeladen.id === id ? welkomGeladen : null;
    if (!g) {
      g = { id, clip: null, stil: false, klaar: false, volledig: false, beelden: [] };
      welkomGeladen = g;
      const k = laadCatalogus().then(() => gegevens(id));
      g.stilBelofte = k.then(k => (k && k.welkom ? vooraf(g, MAP + k.welkom.stil) : false)).then(ok => { g.stil = ok; return g; });
      const clip = k.then(k => {
        if (!k || !k.welkom) return false;
        if (reduced()) return true;
        return root.fetch(MAP + k.welkom.anim)
          .then(r => (r.ok ? r.blob() : null)).catch(() => null)
          .then(b => { g.clip = b || null; return !!b; });
      });
      g.belofte = Promise.all([g.stilBelofte, clip]).then(([, ok]) => {
        g.klaar = true;
        g.volledig = g.stil && ok;
        return g;
      });
    }
    if (!wacht) return g.belofte;
    const vast = g;
    return Promise.race([vast.belofte, new Promise(af => root.setTimeout(af, wacht)).then(() => vast.stilBelofte)]);
  }
  // welkomVooruit(id): haalt de welkomclip van een kat alvast op, met lage
  // prioriteit, zodat de service worker hem bewaart en een volgend welkom
  // hem uit de cache heeft. De inhoud wordt niet bewaard in de pagina.
  // Niet bij reduced motion (dan speelt de clip nooit), niet bij
  // navigator.connection.saveData, niet offline, en niet als deze pagina de clip van die
  // kat al ophaalt of heeft (laadWelkom). Geeft true als hij is opgehaald.
  function welkomVooruit(id) {
    const nav = root.navigator;
    if (reduced() || (nav && nav.connection && nav.connection.saveData) || (nav && nav.onLine === false)) return Promise.resolve(false);
    if (welkomGeladen && welkomGeladen.id === id) return Promise.resolve(false);
    return laadCatalogus().then(() => {
      const k = gegevens(id);
      if (!k || !k.welkom) return false;
      return root.fetch(MAP + k.welkom.anim, { priority: "low" })
        .then(r => (r.ok ? r.arrayBuffer().then(() => true) : false));
    }).catch(() => false);
  }
  // welkomSpeler(img): speel(id) zet de welkomclip uit een nieuwe
  // object-URL op het <img>, dus altijd vanaf het eerste beeld. De WebP
  // speelt een keer en blijft dan op zijn laatste beeld staan; de clip
  // duurt 3 s, het welkom --welkom-duur. Bij reduced motion, of als de clip
  // er (nog) niet is, blijft het stilstaande eerste beeld staan; een clip
  // die later binnenkomt, start niet alsnog. stop() ruimt de URL op.
  // data-beeld: "welkom" als de clip speelt, "welkom-stil" als hij stilstaat.
  function welkomSpeler(img) {
    let url = null;
    function stop() {
      if (url) { root.URL.revokeObjectURL(url); url = null; }
    }
    function speel(id) {
      stop();
      const k = gegevens(id);
      if (!k || !k.welkom) return false;
      const g = welkomGeladen && welkomGeladen.id === id ? welkomGeladen : null;
      img.setAttribute("data-kat", id);
      if (reduced() || !g || !g.clip) {
        img.src = MAP + k.welkom.stil;
        img.setAttribute("data-beeld", "welkom-stil");
        return false;
      }
      url = root.URL.createObjectURL(g.clip);
      img.src = url;
      img.setAttribute("data-beeld", "welkom");
      return true;
    }
    return { speel, stop };
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
  // Per moment de tekst en de stand van de kat: rust, of het eindbeeld van
  // goed of bijna. De kat staat stil, er speelt geen clip.
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
    laadKat, laadWelkom, welkomVooruit, toon, welkomSpeler, bestaat, nieuweRonde, volgende, onthoud, vorige, zegt, gedag, ZEGT, GEDAG, VORIGE };
})(typeof window === "object" ? window : globalThis);
