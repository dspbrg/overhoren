// =============================================================
// Service worker voor Overhoren
//
// Doel: de app start en werkt zonder internet. Alles draait toch al
// lokaal, dus als de bestanden er eenmaal zijn is er niets meer nodig.
//
// Strategie:
//   - bij installatie alles in de cache zetten
//   - daarna eerst uit de cache serveren, en op de achtergrond verversen
//   - bij een nieuwe versie (andere CACHE) de oude weggooien
//
// De versie wordt bij elke deploy vervangen, zodat een nieuwe versie
// gegarandeerd doorkomt in plaats van blijven hangen. Dat doet
// scripts/deploy.sh (GitHub Pages) of het build command van Cloudflare,
// dat VERSIE en de ?v=-stempels met de commit-sha vult.
//
// Doorverwijzingen: Cloudflare stuurt /index.html met een 307 door naar /.
// Een response die via zo'n doorverwijzing binnenkwam (redirected) mag
// nooit een navigatie beantwoorden, anders weigert de browser hem en
// opent de app met een foutpagina. Daarom:
//   - de schil bevat alleen "./", niet "./index.html"
//   - elke navigatie naar de app (/, /index.html, oude snelkoppelingen)
//     krijgt de gecachte "./"
//   - een redirected response gaat nooit de cache in
// =============================================================
const VERSIE = "20261112104108";
const CACHE = "overhoren-" + VERSIE;

const SCHIL = [
  "./", "./ds.css", "./ui.js",
  "./celebrate.js", "./engine.js", "./lists.js", "./manifest.json",
  "./icons/icoon-192.png", "./icons/icoon-512.png", "./icons/favicon-32.png",
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

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // sync gaat gewoon naar het net

  // De app openen: altijd de gecachte "./", met het netwerk als terugval.
  if (req.mode === "navigate" && isApp(url)) {
    e.respondWith(
      caches.match("./").then(hit => {
        const vers = fetch("./").then(res => { bewaar("./", res); return schoon(res); }).catch(() => hit);
        return hit || vers;
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      // op de achtergrond bijwerken, zodat een volgende keer vers is
      const vers = fetch(req).then(res => {
        bewaar(req, res);
        return req.mode === "navigate" ? schoon(res) : res;
      }).catch(() => hit);
      return hit || vers;
    })
  );
});
