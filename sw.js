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
// De versie wordt bij elke deploy door deploy.sh vervangen, zodat een
// nieuwe versie gegarandeerd doorkomt in plaats van blijven hangen.
// =============================================================
const VERSIE = "20261007140000";
const CACHE = "overhoren-" + VERSIE;

const SCHIL = [
  "./", "./index.html", "./ds.css", "./ui.js", "./cats.js",
  "./celebrate.js", "./engine.js", "./lists.js", "./manifest.json",
  "./icons/icoon-192.png", "./icons/icoon-512.png"
];

self.addEventListener("install", e => {
  // faalt er een bestand, dan niet de hele installatie laten klappen
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SCHIL.map(u => c.add(u)))).then(() => self.skipWaiting()));
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
  if (url.origin !== self.location.origin) return;   // fonts en sync gaan gewoon naar het net

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(hit => {
      // op de achtergrond bijwerken, zodat een volgende keer vers is
      const vers = fetch(req).then(res => {
        if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
        return res;
      }).catch(() => hit);
      return hit || vers;
    })
  );
});
