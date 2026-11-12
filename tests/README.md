# Tests

Browsertests met Playwright, gedraaid met de testrunner die in Node zit
(`node --test`). Er is geen package.json en er wordt niets geinstalleerd.

## Draaien

Vanuit de map van de repo:

    node --test "tests/*.test.mjs"

Een enkel bestand:

    node --test tests/schermen.test.mjs

De tests starten zelf een kleine server op `localhost` met een vrije
poort (in Node, geen python nodig) en zetten hem daarna weer uit.
Niets gaat naar internet: de sync-worker krijgt een leeg nep-antwoord,
al het andere externe verkeer wordt geblokkeerd en als fout gemeld.

## Wat er getest wordt

| Bestand | Wat |
| --- | --- |
| `schermen.test.mjs` | Alle schermen van de app, door te klikken, in licht en donker, op 360 en 1280 px: geen JS-fouten, geen horizontale overloop, contrast van alle zichtbare tekst minstens 4,5:1. |
| `fonts.test.mjs` | Fonts staan in de service worker, laden offline uit de cache, de browser tekent echt Chakra Petch en Inter, geen verzoeken naar Google. |
| `styleguide.test.mjs` | styleguide.html laadt zonder fouten, toont elk component uit `window.UI`, themaknop werkt, overloop en contrast. |
| `thema.test.mjs` | Themaknop op het startscherm: elke stand (data-theme, aria-pressed, theme-color), keuze blijft na herladen en staat er al voor de app-scripts, afwijkend thema op alle schermen (contrast, overloop, JS-fouten), datumveld volgt de stand, werkt zonder localStorage, toetsenbord en tikdoelen. |
| `knopvlak.test.mjs` | Lesscherm ("Eerst lezen", niet-gekozen keuzeknoppen) en vraagscherm (woordsoortknoppen), licht en donker, 360 en 1280 px: het knopvlak steekt op elk punt af tegen de kaartbaan eronder (OKLab-verschil minstens 0,025 in licht, 0,05 in donker), en hover geeft een ander vlak dan rust. |
| `fotokeuze.test.mjs` | Foto-import na het kiezen van een (zelfgemaakt) testplaatje: contrast van alle tekst bij de vier typeknoppen, in rust en bij hover op elke knop, licht en donker, 360 en 1280 px. De worker wordt niet aangeroepen. |
| `cloudflare.test.mjs` | Server zoals Cloudflare (307 van /index.html naar /): start_url wordt niet doorgestuurd, geen gecachte response met redirected=true, en offline geven /, /index.html en /index.html?query de app uit de service worker. |
| `ui.test.mjs` | De zeshoekige Ring en de confettikleuren, zonder browser. |

Contrast wordt gemeten in de levende pagina: per tekst worden alle lagen
eronder meegenomen (achtergrondkleur, elke stop van een gradient,
`::before`-vlakken tot en met `body::before`, en opacity). De slechtste
combinatie telt. Uitgeschakelde knoppen tellen niet mee (WCAG), maar
worden als opmerking getoond. Een andere grens proberen kan met
`MIN_CONTRAST=3 node --test "tests/*.test.mjs"`.

## Playwright vinden

De tests zoeken Playwright in deze volgorde:

1. `PLAYWRIGHT_MODULE=/pad/naar/map` (een map met `node_modules/playwright`)
2. een gewone `require("playwright")`
3. de npx-cache (`~/.npm/_npx/*/node_modules/playwright`), bijvoorbeeld
   van een eerder gebruikte `@playwright/mcp`

Hoort bij die Playwright een browserversie die niet gedownload is, dan
pakken de tests de nieuwste Chromium die al in de Playwright-cache staat
(`~/Library/Caches/ms-playwright`). Een eigen browser kiezen kan met
`PW_CHROMIUM=/pad/naar/chrome`.

Staat er helemaal geen Playwright op de machine, dan is eenmalig nodig
(buiten de repo, dus geen afhankelijkheid van het project):

    npm install -g playwright && npx playwright install chromium
