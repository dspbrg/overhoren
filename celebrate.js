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
  function confetti(duration) {
    const cs = getComputedStyle(document.documentElement);
    const colors = ["--accent", "--ok", "--tertiary", "--warn", "--adj"]
      .map(t => cs.getPropertyValue(t).trim()).filter(Boolean);

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

    const N = innerWidth < 500 ? 80 : 140;
    const bits = [];
    for (let i = 0; i < N; i++) {
      bits.push({
        x: Math.random() * innerWidth,
        y: -20 - Math.random() * innerHeight * 0.6,
        w: 6 + Math.random() * 6,
        h: 9 + Math.random() * 8,
        vx: -1.2 + Math.random() * 2.4,
        vy: 2.2 + Math.random() * 3.2,
        rot: Math.random() * Math.PI,
        vr: -0.14 + Math.random() * 0.28,
        color: pick(colors)
      });
    }

    const end = performance.now() + (duration || 2600);
    function frame(now) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      let alive = false;
      for (const b of bits) {
        b.vy += 0.045;          // zwaartekracht
        b.vx *= 0.995;          // luchtweerstand
        b.x += b.vx; b.y += b.vy; b.rot += b.vr;
        if (b.y < innerHeight + 40) alive = true;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.fillStyle = b.color;
        // de snipper kantelt, zodat hij lijkt te fladderen
        ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h * Math.abs(Math.cos(b.rot)));
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
