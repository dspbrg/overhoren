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
| `designsystem.test.mjs` | designsystem.html laadt zonder fouten, toont elk component uit `window.UI`, themaknop werkt, overloop en contrast. |
| `thema.test.mjs` | Themaknop op het startscherm: elke stand (data-theme, aria-pressed, theme-color), keuze blijft na herladen en staat er al voor de app-scripts, afwijkend thema op alle schermen (contrast, overloop, JS-fouten), datumveld volgt de stand, werkt zonder localStorage, toetsenbord en tikdoelen. |
| `knopvlak.test.mjs` | Lesscherm ("Eerst lezen", niet-gekozen keuzeknoppen) en vraagscherm (woordsoortknoppen), licht en donker, 360 en 1280 px: het knopvlak steekt op elk punt af tegen de kaartbaan eronder (OKLab-verschil minstens 0,025 in licht, 0,05 in donker), en hover geeft een ander vlak dan rust. |
| `fotokeuze.test.mjs` | Foto-import na het kiezen van een (zelfgemaakt) testplaatje: contrast van alle tekst bij de vier typeknoppen, in rust en bij hover op elke knop, licht en donker, 360 en 1280 px. De worker wordt niet aangeroepen. |
| `cloudflare.test.mjs` | Server zoals Cloudflare (307 van /index.html naar /): start_url wordt niet doorgestuurd, geen gecachte response met redirected=true, en offline geven /, /index.html en /index.html?query de app uit de service worker. |
| `katten.test.mjs` | De katten, model "de kat is een maatje". Zonder browser: catalogus (namen uit celebrate.js, beelden en maten uit `katten/clips/katten.json`) en afmetingen tegen de WebP-bestanden, oude katten en het verzamelen weg uit app, CSS, design system, service worker en allowlist (geen Mijn katten, geen KatTegel of silhouet, geen `overhoor:katten`), elke ronde een andere kat (200 willekeurige reeksen, nooit twee keer achter elkaar dezelfde, alle zes komen langs, alleen de sleutel `overhoor:kat:vorige`), randen van Math.random, kapotte of geen opslag, de vaste zinnen van de kat per moment en bij gedag (met naam, zonder uitroeptekens), en KatRand en Spraak zonder vrije HTML (alles ontsnapt); KatRij, KatBeloning en het bekertje zijn weg. In de browser (licht en donker, 360 px): wacht, goed, fout en lastige ronde met steeds de kat van de ronde op de bovenrand van de kaart (rust, clip of eindbeeld, alt leeg, 104 px, 30 px over de rand, gespiegeld als hij naar rechts kijkt, rechts, spraakbalk links, geen tekst of bediening eronder, oordeel in de kaart en niet dubbel, de kaart verspringt niet), een lange vraagkaart waarbij de kat met zijn reactie in beeld blijft na scrollen naar Controleer, vlekkeloze ronde met confetti en gedag, geen warm vlak rond het scorecijfer, daarna een andere kat, tien rondes zonder herhaling ook na herladen, hervatte ronde houdt zijn kat, een rondehint zonder kat als prijs en zonder beker, reduced motion, geen css-beweging op de kat (alleen de clip), sync (geen `katten` mee, oude cats ongewijzigd, een kapot onderdeel houdt de rest niet tegen, een antwoord voor een vorige oefenaar landt niet bij de nieuwe) en getallen uit opslag nooit rauw in HTML. |
| `katten-gedrag.test.mjs` | De katten door een ronde heen. Een kat kiezen schrijft alleen `overhoor:kat:vorige` en laat oude `overhoor:cats:*` en `overhoor:katten:*` staan. Vier vlekkeloze rondes achter elkaar: elke keer confetti en de kat van die ronde zegt gedag, nooit twee keer dezelfde. Geen confetti bij een fout of bij "doe later", wel een gewoon gedag. Wisselen van oefenaar: geen katten per oefenaar, de volgende ronde heeft een andere kat. Stevige ronde rond de grens: 5 en 6 van 10, 7 en 8 van 15 fout. Toon van alle kattekst. Oude voortgang, eigen lijsten, oefenaars en oude kattendata blijven staan. Dertig beelden en katten.json offline uit de service worker, en een hele ronde offline met de clip tot het eindbeeld. Elk kattenmoment (twijfel, goed, fout, gestopt, lastige ronde, twee vlekkeloze rondes) op 360 px in licht en donker, met en zonder reduced motion. |
| `kattenclips.test.mjs` | De kattenclips (6 beelden per seconde). Zonder browser: `katten.json` tegen de bestanden (30 beelden van 400 x 480, duur, kijkrichting, aantal beelden en een keer afspelen per clip, niets anders in de map), service worker en allowlist (met de regels van git nagespeeld: clips online, rest niet, oude beelden in `archief/katten-v2/`), en de speler met een nep-klok: elk moment het juiste beeld en na duurMs het eindbeeld, twee keer hetzelfde moment een nieuwe object-URL, elke vorige URL opgeruimd, een nieuw moment breekt een clip af, reduced motion meteen het eindbeeld, spiegelen volgens de regel voor alle zes katten, alleen de kat van de ronde geladen, een clip of katten.json die niet laadt breekt niets. In de browser (360 px), voor alle zes katten in een hervatte ronde: rust, goed, nog een keer goed, bijna, nog een keer bijna en een afgebroken clip, met per frame `getBoundingClientRect` en de layoutbox (niets verspringt), spiegelen, duur tot het eindbeeld, opruimen van URL's en alleen beelden van die kat; reduced motion; het gedag (bijna-clip bij een stevige ronde, anders goed); het welkom (minstens 3,5 s, sluit pas op het eindbeeld, geen css-beweging, nooit gespiegeld, wegtikken ruimt op). Ook in WebKit: `PW_BROWSER=webkit`. |
| `beta.test.mjs` | Het Beta-label in de kop van het startscherm: een knop naast de titel, tikken opent en sluit de uitleg (met een regel Versie en de eerste zeven tekens van ?v=), Enter en Spatie wisselen, Escape sluit en houdt de focus, `aria-expanded` volgt mee, zichtbare focusrand, tikdoel minstens 44 px op 360 en 1280 px, en contrast en overloop dicht en open in licht en donker. |
| `welkom.test.mjs` | Het welkom bij het openen. Zonder browser: `Celebrate.volgende` kiest zonder te onthouden en `nieuweRonde` geeft daarna dezelfde kat (300 willekeurige reeksen, nooit twee keer dezelfde na elkaar), `UI.Welkom` ontsnapt de naam en laat "Hoi" weg zonder naam, en in ds.css duurt het minstens 3500 ms met alleen transform en opacity en zonder sprong of wiebel op de kat. In de browser: verschijnt bij het openen over het hele scherm met de app inert, "Hoi Pia", weg na 3,5 s of na de clip plus het vervagen als die langer duurt, zonder dagsleutel te schrijven; in elk nieuw tabblad weer, ook dezelfde dag en met een oude dagsleutel; niet opnieuw in hetzelfde tabblad, niet bij een ronde die openstaat; de kat is die van de eerstvolgende ronde; een tik, Enter, Escape of Spatie haalt het meteen weg zonder door te gaan naar de app; reduced motion geeft een stilstaand eindbeeld en gaat op dezelfde tijd weg; een beeld dat niet binnen 300 ms klaar is slaat het stil over; contrast, overloop en alles in beeld in licht en donker, 360 en 1280 px. |
| `naam.test.mjs` | Geen standaardnaam. Een verse browser vraagt eerst een naam (veld bij "Wie oefent" open, met focus en label) en zet geen Pia in opslag. Zonder naam geen sync-verzoek, ook niet na een tik op een les; daarna alleen naar de getypte naam. Een opgeslagen naam blijft, met voortgang, en synchroniseert naar die naam. Zonder naam opent geen les en start geen ronde, een lege naam opslaan kan niet, en er wordt niets onder een naam bewaard. Contrast, overloop en tikdoel van het open veld in licht en donker, 360 en 1280 px. |
| `sw-versie.test.mjs` | De service worker na een update, met een eigen server die twee versies kent (eigen stempel, eigen functie in ui.js die index.html aanroept, eigen css-merkje). Van A naar B, met sw.js even achter en alles tegelijk: bij elke keer openen geen JS-fout en geen mix van html, js en css, lijsten en Beta in beeld, uiteindelijk B, en offline de bewaarde B. Een eerste installatie herlaadt niet. Een update op het lessenscherm herlaadt precies een keer, midden in een ronde pas op het lessenscherm, en een tweede update vanaf dezelfde versie niet nog eens. De Beta-uitleg noemt de versie. Ongestempeld (GitHub Pages, ?v= en VERSIE blijven gelijk): online na elke wijziging meteen de nieuwste, nooit een mix, offline de laatst geziene, een te trage pagina geeft de bewaarde pagina met zijn eigen bestanden, en de overgang van de oude sw.js van main (`tests/fixtures/sw-oud-main.js`) gaat schoon, zonder herladen midden in een ronde. Ronde 2: een hangend bestand houdt de app niet wit (time-out, dan de cache), katten en fonts komen meteen uit de cache en worden op de achtergrond ververst, niet herladen zolang het welkom (`.welkom`) openstaat, de bewaarde pagina krijgt zijn bewaarde bestanden ook na een herstart van de service worker (`&bron=cache` in de url), een installatie waarbij de pagina mislukt is niet half, een vreemde cache wordt nooit gebruikt, en de ongestempelde waarde in sw.js klopt met `VERSIE` en de `?v=` in de html. Ook in WebKit: `PW_BROWSER=webkit`. |
| `ui.test.mjs` | De zeshoekige Ring en de confettikleuren, zonder browser. |
| `sync-vorm.test.mjs` | Rare vormen in localStorage en uit een nep-sync-antwoord (items geen object, sessions geen array, lijst zonder items of met een kapot woord, kapotte cats, een gebroken grens, HTML in de reeks van een opgeslagen ronde): lessen, voortgang, rapport en een ronde lopen niet vast, de goede data blijft. Te lange tekst wordt afgekapt in plaats van de lijst weg te gooien, lokale rauwe lijsten overleven de sync, tijden worden begrensd, en "Typ zelf" en de foto-import melden te lange invoer. Een pariteitstest vergelijkt de vormfuncties uit `index.html` met die van de worker. |
| `worker.test.mjs` | De sync-worker zonder Cloudflare: samenvoegen, vorm van cats, progress en lists (herstellen en afkappen, box en tellers), begrenzen van tijden (ook de aanval met 1e308), grenzen, foutvorm en CORS. |

Het welkom (bij het openen, een keer per sessie) zou de app even inert
maken. Daarom zet `startBrowser()` in elk tabblad de sessievlag van het
welkom al (`overhoor:welkom:sessie`). `browser.newContext({ welkom: true })` laat dat weg; alleen
`welkom.test.mjs` doet dat.

De app heeft geen standaardnaam. Daarom zet `startBrowser()` in elk
tabblad de oefenaar "Pia" (`overhoor:learner`) als er nog geen staat.
`browser.newContext({ naam: false })` laat dat weg; `naam.test.mjs` doet dat.

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

WebKit (de motor van Safari) in plaats van Chromium: `PW_BROWSER=webkit`.
Ontbreekt de WebKit van deze Playwright-versie, dan pakken de tests de
nieuwste uit de cache, of `PW_WEBKIT=/pad/naar/pw_run.sh`.

Staat er helemaal geen Playwright op de machine, dan is eenmalig nodig
(buiten de repo, dus geen afhankelijkheid van het project):

    npm install -g playwright && npx playwright install chromium
