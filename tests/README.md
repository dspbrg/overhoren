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
| `katten.test.mjs` | De katten, model "een kat maakt het leuk". Zonder browser: catalogus en afmetingen tegen de WebP-bestanden, oude katten en het verzamelen weg uit app, CSS, styleguide, service worker en allowlist (geen Mijn katten, geen KatTegel of silhouet, geen `overhoor:katten`), elke ronde een andere kat (200 willekeurige reeksen, nooit twee keer achter elkaar dezelfde, alle zes komen langs, alleen de sleutel `overhoor:kat:vorige`), randen van Math.random, kapotte of geen opslag, de blije zin, en KatRij zonder vrije HTML (alles ontsnapt, oordeel uit een vaste lijst). In de browser (licht en donker, 360 px): goed, fout en lastige ronde met steeds de kat van de ronde (stand, alt leeg, 120 px, oortje 30 px over de kaart, niets eronder, oordeel niet dubbel), vlekkeloze ronde met confetti en de blije kat, daarna een andere kat, tien rondes zonder herhaling ook na herladen, hervatte ronde houdt zijn kat, geen Mijn katten en een rondehint zonder kat als prijs, reduced motion, korte entree, sync (geen `katten` mee, oude cats ongewijzigd, een kapot onderdeel houdt de rest niet tegen, een antwoord voor een vorige oefenaar landt niet bij de nieuwe) en getallen uit opslag nooit rauw in HTML. |
| `katten-gedrag.test.mjs` | De katten door een ronde heen. Een kat kiezen schrijft alleen `overhoor:kat:vorige` en laat oude `overhoor:cats:*` en `overhoor:katten:*` staan. Vier vlekkeloze rondes achter elkaar: elke keer confetti en de blije kat van die ronde, nooit twee keer dezelfde. Geen beloning bij een fout of bij "doe later". Wisselen van oefenaar: geen katten per oefenaar, de volgende ronde heeft een andere kat. Bijna-kat rond de grens: 5 en 6 van 10, 7 en 8 van 15 fout. Toon van alle kattekst. Oude voortgang, eigen lijsten, oefenaars en oude kattendata blijven staan. Twaalf beelden offline uit de service worker, en een hele ronde offline. Elk kattenmoment (twijfel, goed, fout, lastige ronde, twee vlekkeloze rondes) op 360 px in licht en donker, met en zonder reduced motion. |
| `ui.test.mjs` | De zeshoekige Ring en de confettikleuren, zonder browser. |
| `sync-vorm.test.mjs` | Rare vormen in localStorage en uit een nep-sync-antwoord (items geen object, sessions geen array, lijst zonder items of met een kapot woord, kapotte cats, een gebroken grens, HTML in de reeks van een opgeslagen ronde): lessen, voortgang, rapport en een ronde lopen niet vast, de goede data blijft. Te lange tekst wordt afgekapt in plaats van de lijst weg te gooien, lokale rauwe lijsten overleven de sync, tijden worden begrensd, en "Typ zelf" en de foto-import melden te lange invoer. Een pariteitstest vergelijkt de vormfuncties uit `index.html` met die van de worker. |
| `worker.test.mjs` | De sync-worker zonder Cloudflare: samenvoegen, vorm van cats, progress en lists (herstellen en afkappen, box en tellers), begrenzen van tijden (ook de aanval met 1e308), grenzen, foutvorm en CORS. |

Contrast wordt gemeten in de levende pagina: per tekst worden alle lagen
eronder meegenomen (achtergrondkleur, elke stop van een gradient,
`::before`-vlakken tot en met `body::before`, en opacity). De slechtste
combinatie telt. Een achtergrondkleur in een notatie die de meting niet
kent (zoals `oklab()` midden in een overgang) wordt gemeld als niet
meetbaar, nooit stil overgeslagen. Voor het meten wachten de tests een
paar frames en ronden ze alle animaties en overgangen af: een knop die
onder de muis verschijnt, krijgt zijn hover pas een frame later. Uitgeschakelde knoppen tellen niet mee (WCAG), maar
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
