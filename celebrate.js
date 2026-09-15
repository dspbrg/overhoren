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

  // Vrijstaande katten. Zet je bestanden in app/cats/ en vul deze lijst aan.
  const CATS = [
    "cats/kat-01.jpg",
    "cats/kat-03.jpg",
    "cats/kat-04.jpg",
    "cats/kat-05.jpg",
    "cats/kat-06.jpg"
  ];

  // Onderschriften bij de foto. Willekeurig gekozen, los van de kat.
  const CAPTIONS = ["Foutloos!", "Nul fouten", "Kat is trots", "Hoedje af", "Helemaal goed"];

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
    if (!CATS.length) return;
    const src = pick(CATS);
    const img = new Image();
    img.src = src;
    img.onerror = function () { /* stil overslaan */ };
    img.onload = function () {
      const fig = document.createElement("figure");
      fig.className = "fx-cat";
      // lichte willekeurige scheefstand, zodat het niet klinisch recht hangt
      fig.style.setProperty("--tilt", (Math.random() < .5 ? -1 : 1) * (3 + Math.random() * 3) + "deg");
      fig.setAttribute("aria-hidden", "true");
      img.alt = "";
      fig.appendChild(img);
      const cap = document.createElement("figcaption");
      cap.textContent = pick(CAPTIONS);
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

  root.Celebrate = { celebrate, confetti, cat, CATS, CAPTIONS, PRAISE };
})(typeof window === "object" ? window : globalThis);
