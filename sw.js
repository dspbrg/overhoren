// =============================================================
// Service worker voor Overhoren
//
// Doel: de app start en werkt zonder internet. Alles draait toch al
// lokaal, dus als de bestanden er eenmaal zijn is er niets meer nodig.
//
// Regel nummer een: nooit oud en nieuw door elkaar. Een nieuwe index.html
// met een oude ui.js of ds.css breekt de app (gezien op een iPhone: geen
// lijsten, geen naam, geen Beta). Daarom:
//   - elke versie heeft een eigen cache (CACHE) en deze service worker
//     zoekt alleen in die cache, nooit in die van een andere versie
//   - de schil komt alleen bij installatie in de cache, in een keer, en
//     wordt daarna niet op de achtergrond bijgewerkt
//   - een bestand met ?v= van een andere versie dan VERSIE komt van het
//     netwerk; de cache alleen als laatste redmiddel, als het net er niet is
//   - de app openen (navigatie): online eerst het netwerk, met een korte
//     time-out (NAV_WACHT); offline of te traag de "./" uit de eigen cache.
//     Heeft de pagina van het net een andere ?v= dan VERSIE, dan die
//     verse pagina (zijn bestanden komen dan ook van het net); dezelfde
//     ?v=, dan de bewaarde pagina. Zo hoort de pagina altijd bij de
//     bestanden die hij daarna vraagt. Gekozen boven "alleen uit de cache",
//     omdat een update zo meteen bij de eerstvolgende keer openen in beeld
//     komt, ook als de nieuwe service worker nog niet klaar is.
//   - "./" wordt nooit buiten de installatie geschreven, dus een oude
//     versie kan geen nieuwe pagina in zijn cache zetten (dat was de fout)
//   - bij een nieuwe versie (andere CACHE) de oude weggooien
// index.html herlaadt na een update hooguit een keer (zie registreerSW).
//
// De versie wordt bij elke deploy vervangen, zodat een nieuwe versie
// gegarandeerd doorkomt in plaats van blijven hangen. Het build command
// van Cloudflare (of scripts/deploy.sh) vult VERSIE en de ?v=-stempels.
// GitHub Pages stempelt niet: daar zijn VERSIE en ?v= altijd gelijk, dus
// de bestanden met ?v= komen daar uit de cache van de installatie, en
// iets nieuws komt pas binnen als sw.js zelf verandert.
//
// Doorverwijzingen: Cloudflare stuurt /index.html met een 307 door naar /.
// Een response die via zo'n doorverwijzing binnenkwam (redirected) mag
// nooit een navigatie beantwoorden, anders weigert de browser hem en
// opent de app met een foutpagina. Daarom:
//   - de schil bevat alleen "./", niet "./index.html"
//   - elke navigatie naar de app (/, /index.html, oude snelkoppelingen)
//     vraagt "./" en krijgt een schone kopie
//   - een redirected response gaat nooit de cache in
// =============================================================
const VERSIE = "20261112104108";
// "2-": de indeling van de cache veranderde (alles zonder ?v=, alleen de
// eigen cache). Zo begint ook GitHub Pages, waar VERSIE niet verandert,
// een keer met een schone cache.
const CACHE = "overhoren-2-" + VERSIE;

const SCHIL = [
  "./", "./ds.css", "./ui.js",
  "./celebrate.js", "./engine.js", "./lists.js", "./manifest.json",
  "./icons/icoon-192.png", "./icons/icoon-512.png",
  "./fonts/chakra-petch-latin-600-normal.woff2",
  "./fonts/chakra-petch-latin-ext-600-normal.woff2",
  "./fonts/chakra-petch-latin-700-normal.woff2",
  "./fonts/chakra-petch-latin-ext-700-normal.woff2",
  "./fonts/inter-latin-wght-normal.woff2",
  "./fonts/inter-latin-ext-wght-normal.woff2",
  // de zes katten, elk in twee standen (zie KATTEN in celebrate.js)
  "./katten/strepen-goed.webp", "./katten/strepen-bijna.webp",
  "./katten/tuxedo-goed.webp", "./katten/tuxedo-bijna.webp",
  "./katten/lapjes-goed.webp", "./katten/lapjes-bijna.webp",
  "./katten/sokjes-goed.webp", "./katten/sokjes-bijna.webp",
  "./katten/stippen-goed.webp", "./katten/stippen-bijna.webp",
  "./katten/rodestreep-goed.webp", "./katten/rodestreep-bijna.webp"
];

// Alleen gewone, directe antwoorden bewaren. De kopie wordt meteen
// gemaakt, voordat de browser het origineel kan uitlezen.
function bewaar(sleutel, res) {
  if (!res || !res.ok || res.redirected) return Promise.resolve();
  const kopie = res.clone();
  return caches.open(CACHE).then(c => c.put(sleutel, kopie));
}

// Schone kopie zonder het redirected-kenmerk, voor een navigatie.
function schoon(res) {
  if (!res.redirected) return res;
  return new Response(res.body, { headers: res.headers, status: res.status, statusText: res.statusText });
}

// Is dit een navigatie naar de app zelf (/ of /index.html binnen de scope)?
function isApp(url) {
  const basis = new URL(self.registration.scope).pathname;
  return url.pathname === basis || url.pathname === basis + "index.html";
}

// Alleen in de eigen cache zoeken, nooit in die van een andere versie.
// De schil staat er zonder ?v=, dus de zoekterm negeert die.
function uitCache(sleutel) {
  return caches.open(CACHE).then(c => c.match(sleutel, { ignoreSearch: true }));
}

// Zo lang wacht een navigatie op het netwerk; daarna de bewaarde pagina.
const NAV_WACHT = 3000;

// Het netwerk, maar niet langer dan ms, tot en met de inhoud als lees
// waar is. Te traag geeft een fout. Geeft { res, tekst }.
function netMetTijd(sleutel, ms, lees) {
  const net = fetch(sleutel).then(res =>
    lees && res.ok ? res.clone().text().then(tekst => ({ res, tekst })) : { res, tekst: "" });
  const klok = new Promise((_, mis) => setTimeout(() => mis(new Error("te traag")), ms));
  return Promise.race([net, klok]);
}

self.addEventListener("install", e => {
  // faalt er een bestand, dan niet de hele installatie laten klappen
  e.waitUntil(Promise.allSettled(SCHIL.map(u => fetch(u).then(res => bewaar(u, res)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(namen => Promise.all(namen.filter(n => n !== CACHE).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

// De pagina vraagt na een update welke versie dit is (registreerSW in
// index.html): dezelfde als de pagina, dan hoeft die niet te herladen.
self.addEventListener("message", e => {
  if (e.data === "versie" && e.ports && e.ports[0]) e.ports[0].postMessage(VERSIE);
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // sync gaat gewoon naar het net

  // Navigaties: online het netwerk (kort), anders de bewaarde pagina.
  // Voor de app altijd "./", ook bij /index.html, en nooit in de cache
  // schrijven: dat doet alleen de installatie.
  if (req.mode === "navigate") {
    const app = isApp(url);
    e.respondWith(
      netMetTijd(app ? "./" : req, NAV_WACHT, app)
        .then(({ res, tekst }) => {
          if (!app) return schoon(res);
          if (!res.ok) return uitCache("./").then(hit => hit || res);
          // Dezelfde stempel als deze versie: dan de bewaarde pagina, die
          // hoort zeker bij de bewaarde bestanden (op GitHub Pages blijft
          // de stempel gelijk terwijl de inhoud verandert). Een andere
          // stempel: de verse pagina, zijn bestanden komen dan ook vers.
          const m = /\?v=([A-Za-z0-9]+)/.exec(tekst);
          if (!m || m[1] !== VERSIE) return schoon(res);
          return uitCache("./").then(hit => hit || schoon(res));
        })
        .catch(() => uitCache(app ? "./" : req).then(hit => hit || Response.error()))
    );
    return;
  }

  // Een bestand van een andere versie: van het netwerk, niet uit deze
  // cache (die hoort bij een andere versie). Alleen als het net er niet
  // is, de cache als laatste redmiddel.
  const v = url.searchParams.get("v");
  if (v !== null && v !== VERSIE) {
    e.respondWith(fetch(req).catch(() => uitCache(req).then(hit => hit || Response.error())));
    return;
  }

  // De rest (bestanden van deze versie, fonts, katten, iconen): uit de
  // eigen cache. Ontbreekt het, dan van het netwerk en bewaren, zonder
  // ?v=, net als de schil: zo staat elk bestand er maar een keer in.
  e.respondWith(
    uitCache(req).then(hit => hit || fetch(req).then(res => { bewaar(url.origin + url.pathname, res); return res; }))
  );
});
