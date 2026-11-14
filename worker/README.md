# overhoren-api

Cloudflare Worker voor de sync (KV-binding `SYNC`) en de foto-import via de
Anthropic-API (`/extract`, `/enrich`). Los van de app zelf: die heeft een eigen
config in `../wrangler.jsonc`.

Bindings in `wrangler.toml`:

- `SYNC`: KV, alleen voor de sync.
- `TELLER`: Durable Object `FotoTeller` (`src/teller.js`), SQLite-opslag, ook
  op het gratis plan. Telt de foto-import (instantie `foto`) en bewaart de
  codes van de overstap (instantie `migratie`).
- `FOTO_TEMPO`: Cloudflare Rate Limiting, 20 foto-verzoeken per minuut per IP.
- `SYNC_TEMPO`: Cloudflare Rate Limiting, 120 sync-verzoeken per minuut per IP
  (`/sync`, de oude `/sync/<naam>` en `/migreer`).

## Sync per persoon met een code

Elke persoon heeft een eigen code, zoals `panda-mango-wolk-47`: drie woorden
uit een vaste lijst (`src/code.js`, dezelfde lijst als `CODE_WOORDEN` in
`index.html`) en twee cijfers. De woorden: 1052 korte Nederlandse woorden van
3 tot 6 letters, zonder c, q, x, y en ij. Dat geeft 1052^3 x 100, ongeveer
1,2e11 codes. De app maakt de code zelf (crypto-random) als iemand tikt op
"Op een ander toestel verder". Zonder code geen sync.

| Route | Kop | Wat |
| --- | --- | --- |
| `GET /sync` | `x-code` | de voortgang van die persoon, of `{}` |
| `PUT /sync` | `x-code` | samenvoegen en opslaan, geeft het resultaat terug |
| `POST /migreer` | `x-api-token` | body `{ "slug": "pia" }`, geeft `{ "code": "..." }` |
| `POST /migreer/wis` | geen | wist de codes van de overstap; alleen als `APP_SECRET` weg is, anders 409 |

- `x-code` moet precies de vorm `woord-woord-woord-12` hebben, met woorden uit
  de lijst. Ontbreekt hij: 401 `Geen code`. Een andere vorm: 400
  `Ongeldige code`, zonder KV te lezen.
- De data staat onder `persoon:<sha256(code)>`. De code zelf staat nergens in
  KV en gaat niet naar de logs. Een slug heeft geen dubbele punt, dus de oude
  route kan nooit bij `persoon:`-data, en de nieuwe route nooit bij
  `learner:`-data.
- Wie een code heeft, kan die voortgang lezen en aanvullen. De code is dus een
  geheim; de app toont hem alleen in het codepaneel.
- Tempo: eerst `SYNC_TEMPO` (120 per minuut per IP, per Cloudflare-locatie bij
  benadering), voor het lezen van de code en de body. Daarboven 429 met
  `"grens": "tempo"`. Dat remt het raden van codes (bij 120 per minuut kost het
  vinden van een van tien codes gemiddeld duizenden jaren per IP) en het
  volschrijven van KV. Een eigen binding en niet `FOTO_TEMPO`: de app duwt
  tijdens een ronde hooguit elke 2 seconden, dus 20 per minuut zou de sync
  laten haperen en de foto-import van hetzelfde IP opeten. 120 laat ruimte voor
  een paar kinderen achter hetzelfde IP (school, thuis).
- De sleutel van beide tempogrenzen (`src/ip.js`): een IPv4-adres zoals het
  is, een IPv6-adres als zijn /64-prefix. Een aansluiting krijgt vaak een heel
  /64; anders zou elk adres daarin een eigen teller hebben.
- Nieuwe records: iedereen met een geldige code kan een nieuw record maken (zo
  werkt een nieuwe code). Daarom, geteld in de Durable Object (instantie
  `migratie`), per kalenderdag hooguit `NIEUW_PER_DAG` (30) nieuwe
  `persoon:`-records voor iedereen samen en hooguit `NIEUW_PER_IP_PER_DAG` (5)
  per tempo-sleutel (IPv4-adres of IPv6-/64). Daarboven 429 met
  `"grens": "nieuw"` en niets opgeslagen; de app meldt "Er kunnen vandaag geen
  nieuwe codes bij. Probeer het morgen." Een nieuw record (de eerste PUT voor
  een code) is hooguit 256 KiB, anders 413 `Nieuwe gegevens te groot`. Lezen,
  een bestaand record bijwerken en de overstap tellen niet mee.
- Opslag, ergste geval: op het gratis plan van KV mag een account 1.000 keer
  per dag naar verschillende sleutels schrijven en 1 GB bewaren
  (Cloudflare-documentatie, 14-11-2026). Een aanvaller maakt hooguit 30 nieuwe
  records per dag van 256 KiB (7,5 MiB), maar kan die daarna met gewone PUT's
  (768 KiB per keer) laten groeien tot 2 MiB per record: 30 x 2 MiB = 60 MiB
  per dag, en dat kost hem maar ongeveer 90 schrijfacties. Zo zit 1 GB na
  ongeveer 17 dagen vol. Het tempo (120 per minuut per IP) remt dat niet echt;
  de grens per IP (5 nieuwe per dag) wel, want voor 30 per dag zijn 6 IP's
  nodig. Valt het op (veel `persoon:`-sleutels in het KV-dashboard), dan kan
  Daan ze wissen; een automatische opruiming bestaat nog niet (open punt).
- Body van een PUT: hooguit 768 KiB. Gemeten op 14-11-2026 met de vier
  ingebouwde lijsten en voortgang op elk woord: 20 rondes per lijst zonder
  eigen lijsten is 45 KiB, 50 rondes met 10 eigen lijsten van 40 woorden is
  234 KiB, 100 rondes met 30 eigen lijsten (een zwaar schooljaar) is 702 KiB.
  De rondes groeien zonder grens; zie de open punten.

Samenvoegen: per lijst wint de voortgang met de nieuwste `updated`, per eigen
lijst die met de nieuwste `added`. Een code invullen op een tweede toestel
voegt zo de voortgang van beide toestellen samen; de app zegt dat ook in het
paneel ("Je voortgang wordt per lijst samengevoegd: het nieuwste telt.").

Een code van een ander toestel (link of invulveld) neemt de app niet stil
over als deze oefenaar al een code heeft die ergens bij hoort, of als er bij
de nieuwe code niets staat. Dan eerst de vraag "Deze code hoort bij iemand
anders of bij een ander toestel. Wil je overstappen?" (en/of "Geen voortgang
gevonden bij deze code."), met de huidige code in beeld en de knoppen
Overstappen en Mijn code houden. Voor de bevestiging gaat er alleen een GET
naar de nieuwe code, geen PUT. Bij overstappen bewaart de app de vorige code
(`overhoor:code-vorige:<slug>`) en toont hem als "Vorige code", zodat terug
kan.

## Overstap van het oude wachtwoord

Vroeger: een gedeeld wachtwoord (`APP_SECRET`, deellink `#sync=...`) en de
naam als sleutel (`learner:<slug>`). Iedereen met de link die "Pia" typte, zag
en overschreef Pia's voortgang.

Een toestel met het wachtwoord stapt over met `POST /migreer`, alleen voor de
naam die op dat moment de huidige, bevestigde oefenaar is: bij het openen, en
opnieuw na het kiezen of bevestigen van een naam. Nooit stil voor andere namen
in `overhoor:learners`: oude versies van de app bewaarden "Pia" als
standaardnaam, met voortgang onder `pia`, ook op toestellen van klasgenoten;
die zouden anders Pia's code krijgen. Een naam waarvan iemand zei dat hij het
niet is ("Ben jij Pia?" Nee) staat in `overhoor:naam-afgewezen`; kiest of
bevestigt iemand die naam later zelf, dan gaat hij van die lijst en stapt hij
over (en krijgt hij dezelfde code als op de andere toestellen). Per naam:

1. Wachtwoord nodig (`x-api-token` gelijk aan `APP_SECRET`), anders 401. Een
   slug van hooguit 64 tekens, `a-z`, `0-9` en losse streepjes, anders 400.
2. De Durable Object (instantie `migratie`) geeft voor die slug de bestaande
   code, of maakt er een (crypto-random, dezelfde woordlijst) en bewaart
   `migratie:<slug>`. Dat gaat in een stap zonder wachten, dus ook twee
   toestellen tegelijk krijgen dezelfde code. Een Durable Object en geen KV:
   KV kan op een andere plek tot een minuut achterlopen, en dan zou Pia's
   tweede toestel een andere code kunnen krijgen.
3. `learner:<slug>` wordt samengevoegd in `persoon:<sha256(code)>`, bij elke
   aanroep. Zo komt ook mee wat een tweede toestel intussen nog via de oude
   route stuurde.
4. De app bewaart de code (per naam, `overhoor:code:<slug>`) en synct voortaan
   met `x-code`.

Het wachtwoord gaat lokaal weg zodra elke bekende naam met voortgang op het
toestel een code heeft, of zodra `/migreer` 401 geeft (het wachtwoord geldt
niet meer, bijvoorbeeld omdat Daan `APP_SECRET` verwijderde). Daarom vraagt de
app `/migreer` voor de huidige naam zolang het wachtwoord er staat, ook als die
al een code heeft (een bestaande code wordt nooit overschreven). Op het toestel
van een klasgenoot met een oude `pia` in de lijst blijft het wachtwoord dus
staan tot `APP_SECRET` weg is, en ruimt de 401 het dan op. Na een 401 gaat de
app verder zoals zonder wachtwoord. Bij een netwerkfout, 429 of 5xx blijft het
wachtwoord staan, synct de naam nog via de oude route en probeert de app het
bij het volgende openen opnieuw. Tikt iemand dan op "Op een ander toestel
verder", dan maakt de app geen losse code maar zegt "Dat lukt nu niet.
Probeer het straks nog eens.", met het veld "Heb je al een code?" eronder; een
losse code zou de voortgang op de server onbereikbaar maken. Een oude deellink `#sync=...` werkt ook nog: na het typen van de naam
levert de overstap de bestaande code.

`migratie:<slug>` bevat de code zelf, in de Durable Object en niet in KV. Wie
het wachtwoord heeft, kan dus via de overstap de code van een naam opvragen.
Daarom het wachtwoord weghalen zodra alle toestellen over zijn.

De oude routes (`GET`/`PUT /sync/<naam>`) blijven voorlopig werken. Ze gaan uit
door het wachtwoord te verwijderen:

    npx wrangler secret delete APP_SECRET -c wrangler.toml

Daarna geven `/sync/<naam>` en `/migreer` altijd 401. Een toestel dat dan nog
niet over is, synct niet meer; met de knop "Op een ander toestel verder" en de
code van een ander toestel komt het weer mee.

Wis daarna de codes van de overstap uit de Durable Object (ze zijn dan nergens
meer voor nodig, en zo staat geen enkele code meer leesbaar op de server):

    curl -X POST https://overhoren-api.y8n876dtrq.workers.dev/migreer/wis

Dat werkt alleen als `APP_SECRET` weg is (anders 409) en geeft
`{ "gewist": <aantal> }`. De voortgang zelf blijft staan.

Wissen is definitief: zonder `migratie:`-sleutels krijgt een naam bij een
nieuwe overstap een nieuwe code, los van de voortgang onder de oude code. Zet
`APP_SECRET` daarna dus nooit meer terug.

## ONBEPERKT: foto's buiten de gewone maandgrens

Het geheim `ONBEPERKT` is een lijst sha256-hashes van codes, gescheiden door
komma's. De app stuurt bij `/extract` en `/enrich` ook `x-code` mee als er een
code is. Staat de hash daarvan in de lijst, dan geldt `FOTO_PER_MAAND` niet,
maar wel een eigen harde grens per hash: `ONBEPERKT_PER_MAAND` (300) per
kalendermaand, voor `/extract` en `/enrich` elk apart. Daarboven 429 met
`"grens": "maand"`. Het verzoek telt ook mee voor de maandstand en de drempels
(80 en 100). Een `x-code` met een verkeerde vorm geeft 400, zonder teller en
zonder AI. De toestelgrens beschermt hier niet: `x-toestel` kiest de app zelf,
dus wie de code heeft, kan steeds een nieuw toestel-id sturen.

Behandel de ONBEPERKT-hash even geheim als de code: hij wijst precies de
code aan die buiten de gewone grens valt, en wie die code heeft, kan op Pia's
grens foto's laten lezen. Zet ONBEPERKT pas aan nadat `APP_SECRET` is
verwijderd (en de codes van de overstap gewist zijn); zolang het wachtwoord
bestaat, kan iedereen met de oude deellink via `/migreer` Pia's code opvragen.
De worker dwingt dat af: zolang `APP_SECRET` gezet is, telt ONBEPERKT niet.

Zo zet je Pia's code erin, zonder dat de code ergens gelogd wordt:

1. Open de app op Pia's toestel, tik op "Op een ander toestel verder" en lees
   de code af.
2. Vanuit de map van de repo: `node scripts/code-hash.mjs`. Typ of plak de
   code (je ziet niets verschijnen). Het script toont alleen de hash. Geef de
   code nooit als argument mee; dat weigert het script.
3. Vanuit `worker/`: `npx wrangler secret put ONBEPERKT -c wrangler.toml` en
   plak de hash. Meer codes: de hashes achter elkaar met komma's.

Kosten: per ONBEPERKT-code hooguit 300 foto's en 300 verrijkingen per maand.
Bij de prijzen hieronder is dat in het ergste geval ongeveer $0,90 aan foto's
en $39 aan verrijkingen per code per maand, bovenop de gewone grens.

## Open punten

- Een code intrekken of een nieuwe code maken voor een bestaande persoon
  bestaat nog niet. Lekt een code uit, dan kan wie hem heeft de voortgang
  lezen en aanvullen tot er een manier is om te wisselen.
- De rondes (`sessions`) per lijst groeien zonder grens; na een paar jaar kan
  een record de 768 KiB per PUT halen. De app kan oude rondes inkorten.
- Lege of verlaten `persoon:`-records worden niet vanzelf opgeruimd.
- Zolang `APP_SECRET` bestaat, vraagt elk toestel dat nog een wachtwoord heeft
  bij elk openen `/migreer` (een KV-schrijfactie voor het samenvoegen van de
  oude voortgang). Dat stopt zodra `APP_SECRET` weg is.

## Alleen vanaf twee origins

CORS werkt met een allowlist in `wrangler.toml` (`ALLOWED_ORIGIN`, gescheiden
door komma's):

- `https://overhoren.vandaan.net`
- `https://dspbrg.github.io`

Vanaf een andere origin, ook `localhost`, blokkeert de browser sync en
foto-import. Dat houdt alleen browsers tegen, geen scripts; daarvoor zijn de
grenzen hieronder. De tests gebruiken een nep-worker en hebben daar geen last van.

## Grenzen

| Endpoint | Body | Verder |
| --- | --- | --- |
| `PUT /sync` en `PUT /sync/<naam>` | 768 KiB, anders 413 | samengevoegd record hooguit 2 MiB, anders 413 en niets opgeslagen |
| `POST /migreer` | 1 KiB, anders 413 | `slug` hooguit 64 tekens, `a-z`, `0-9` en losse streepjes |
| `POST /extract` | 2 MiB plus 1 KiB, anders 413 | `image` verplicht, alleen base64, hooguit 2 MiB; `mediaType` jpeg, png, gif of webp; `subjectHint` leeg, `zinnen`, `anders`, of `wd:`/`dw:` met een taal van hooguit 20 letters |
| `POST /enrich` | 64 KiB, anders 413 | `items` hooguit 150, elk met `word` en `def` als tekst van hooguit 200 tekens; andere velden gaan niet naar de AI |

Een `subject` bij `/enrich` die geen taalnaam van hooguit 20 letters is, wordt
"vreemde taal". `max_tokens`: 4096 voor `/extract`, 8192 voor `/enrich`
(ongeveer 70 tokens per woord; een bladzijde van 20 tot 40 woorden past ruim).

## Wachtwoord en foto-grenzen

De oude sync (`/sync/<naam>`) vraagt het wachtwoord (`x-api-token`, gelijk aan
`APP_SECRET`), anders 401; de nieuwe sync een code (zie boven). De foto-import (`POST /extract` en `POST /enrich`)
is open voor iedereen, met of zonder wachtwoord, onder dezelfde grenzen.
Volgorde per verzoek:

1. Tempo: per IP (`CF-Connecting-IP`) hooguit 20 per minuut, voor alles
   anders, ook voor het lezen van de body. Daarboven 429 met `"grens":
   "tempo"`. Dit telt per Cloudflare-locatie en bij benadering; het houdt een
   stroom verzoeken tegen, de echte grens is de teller.
2. Toestel: het id in `x-toestel` (een `crypto.randomUUID()`, versie 4,
   kleine letters). Een oude app zonder `x-toestel` maar met het juiste
   wachtwoord telt onder het vaste id `wachtwoord`. Verder: 400.
3. Code: een `x-code` is niet nodig. Staat hij er, dan moet hij de goede vorm
   hebben (anders 400) en kijkt de worker of hij in `ONBEPERKT` staat.
4. Invoer controleren (zie de tabel).
5. Reserveren bij de teller, voor de AI-aanroep:
   - `FOTO_PER_TOESTEL_PER_DAG` (10): per toestel per kalenderdag.
   - `FOTO_PER_MAAND` (100): voor iedereen samen per kalendermaand, behalve
     voor een code in `ONBEPERKT`: die heeft `ONBEPERKT_PER_MAAND` (300) per
     hash, en telt wel mee in de stand.
   Boven een grens komt 429 met `{ "error": "Grens bereikt", "grens":
   "toestel" }` of `"maand"`, zonder AI-aanroep.
6. De AI-aanroep. Alleen bij een storing aan de kant van Anthropic (429,
   500 en hoger, zoals 529) wordt de plek teruggeboekt. Een andere 4xx, een
   netwerkfout (kan al betaald zijn), een onbruikbaar 200-antwoord en een
   verzoek waarvan de client afhaakt blijven geteld.

Dag en maand volgen Europe/Amsterdam. `/extract` en `/enrich` hebben elk een
eigen teller met dezelfde grenzen: hooguit 100 foto's en 100 verrijkingen per
maand, samen dus 100 foto's per maand met hun verrijking.

Kosten in het ergste geval (prijzen van 14-11-2026, invoer plus uitvoer):

- Foto (`/extract`, Haiku 5.5, $0,10 in en $0,50 uit per miljoen tokens):
  hooguit ongeveer 5.500 tokens in en 4.096 uit, samen ongeveer $0,003.
- Verrijking (`/enrich`, Sonnet 5.5, $2 in en $10 uit per miljoen tokens):
  64 KiB invoer is hooguit ongeveer 22.000 tokens ($0,044) plus 8.192 uit
  ($0,082), samen ongeveer $0,13.
- Per maand dus hooguit ongeveer $0,30 aan foto's en $13 aan verrijkingen.
  Een gewone bladzijde van 30 woorden kost bij verrijken ongeveer $0,03.

De teller is een Durable Object met een instantie voor de hele app. Reserveren
gebeurt synchroon, zonder wachten tussen lezen en schrijven, dus ook bij
gelijktijdige verzoeken gaat er nooit iets over de grens. Per soort staat er
een rij met de dag, de tellers per toestel van die dag, de maand en de
maandstand en de al gemelde drempels. De eerste reservering op een nieuwe dag
maakt de toestellen leeg, die in een nieuwe maand de maandstand en de
drempels; een toestel dat door terugboeken op 0 komt, gaat uit de lijst.
De toestelgrens is te omzeilen met een nieuw id; de maandgrens is de echte rem.
Werkt de teller of de tempo-binding niet, dan volgt 500 en geen AI-aanroep.

## Melding naar hq bij 80 en 100 foto's

Bij 80 en 100 foto's (`/extract`) in een maand stuurt de worker een melding
naar het dashboard hq:

    POST <HQ_MELD_URL>
    Authorization: Bearer <HQ_MELD_TOKEN>
    Content-Type: application/json

    {"bron":"overhoren","soort":"foto-80","maand":"2026-11"}

(`soort` is `foto-80` of `foto-100`.) hq antwoordt 201 (nieuw) of 200 (al
bekend); allebei goed. Al het andere telt als fout.

- Alleen als `HQ_MELD_URL` en `HQ_MELD_TOKEN` allebei gezet zijn. Anders
  gaat er niets het net op.
- `HQ_MELD_URL` moet precies `https://hq.vandaan.net/api/melding` zijn: https,
  host `hq.vandaan.net` (vast in de code, `MELD_HOST`), geen poort, en dit
  pad zonder slash op het eind en zonder `?`. Anders gaat er niets weg en
  staat er een regel "HQ_MELD_URL ongeldig" in de logs. Zo kan het token
  nooit naar een andere host.
- Een redirect wordt niet gevolgd (dan zou het token meegaan naar een ander
  adres); een 3xx telt als fout.
- De melding start meteen bij de reservering en loopt parallel aan de
  AI-aanroep (`ctx.waitUntil` houdt hem in leven), met een time-out van 5
  seconden. Het foto-antwoord wacht er niet op, en een fout bij hq laat de
  foto niet mislukken.
- Niet aangekomen? De teller houdt bij welke drempels hq nog niet bevestigd
  heeft (`teMelden` in de rij van `/extract`, hooguit 4, ook over de
  maandgrens). Een volgende reservering voor `/extract`, ook een die op de
  grens wordt geweigerd, probeert ze opnieuw, maar hooguit eens per 5
  minuten (`MELD_PAUZE_MS`, bijgehouden in `laatstePoging`). Een drempel die
  net gehaald is, gaat altijd meteen. Na 200 of 201 vinkt de worker hem af
  in de teller (`/gemeld`). Een melding kan dus twee keer aankomen; hq geeft
  dan 200. Komt er een vijfde open melding bij, dan valt de oudste weg, met
  een logregel zonder details.
- In de logs staat alleen de status of een korte reden (time-out,
  netwerkfout), nooit het token of de Authorization-kop.

Kosten: geen betaalde dienst. Per poging hooguit een aanroep naar hq per open
melding (hooguit 4), en zo'n poging hooguit eens per 5 minuten. Daarbovenop
gaat een net gehaalde drempel meteen, en dat is hooguit twee keer per maand.

Zo zet je het aan (vanuit `worker/`, en altijd met `-c wrangler.toml`):

1. `npx wrangler secret put HQ_MELD_TOKEN -c wrangler.toml` en plak hetzelfde
   token als in de `.env` van hq. Het token komt niet in git en niet in
   `wrangler.toml`.
2. `npx wrangler secret put HQ_MELD_URL -c wrangler.toml` en geef
   `https://hq.vandaan.net/api/melding`. Alleen als secret, niet als `[vars]`
   in `wrangler.toml`: dan staat de melding alleen aan waar Daan beide
   secrets zelf heeft gezet.
3. Daarna de worker uitrollen (alleen na akkoord, zie Uitrollen).

Uitzetten: `npx wrangler secret delete HQ_MELD_TOKEN -c wrangler.toml`.

## Fouten en wat er wordt opgeslagen

Kapotte JSON geeft 400. Fouten van de Anthropic-API geven 502 met een algemene
melding; de details staan alleen in de logs.

Opgeslagen worden alleen `cats`, `progress`, `lists` en `updated`. Andere velden,
zoals het vervallen `katten`, worden genegeerd.

Ook de vorm binnen die velden wordt gecontroleerd (`worker/src/merge.js`,
dezelfde regels als `schoneLijst`, `schoneVoortgang` enzovoort in `index.html`;
een pariteitstest in `tests/sync-vorm.test.mjs` vergelijkt ze). Elk onderdeel
wordt nieuw opgebouwd met alleen de bekende velden. Herstellen gaat voor
weggooien:

- `progress[lijst-id]`: altijd `{ items, sessions, updated? }`. `items` heeft
  alleen sleutels die een index zijn, met een woordtoestand (box, due, seen,
  correct, wrong, lapses, streak, last; dirWrong en partWrong met tellers).
  Elk ontbrekend, kapot of negatief getal wordt 0; `box` wordt een heel getal
  van 0 tot en met `MAX_BOX` (6, gelijk aan engine.js). Een ronde met een
  kapot getal valt weg. `items` of `sessions` met de verkeerde vorm worden leeg.
- `lists[]`: alleen een lijst zonder geldig `id` (tekst tot 100 tekens of
  getal) of zonder `items`-array valt weg. Verder wordt afgekapt: `title` en
  andere teksten op 200 tekens, `word`, `def`, `ex`, `keys` en `accept` op 1000,
  lijstjes op 50 stuks, `items` op 5000 woorden. Een `word` of `def` die geen
  tekst is wordt `""`, een kapot woord een leeg woord op dezelfde plek (zodat
  de nummering van de voortgang klopt), een titel die geen tekst is `""`.
  Losse optionele velden van de verkeerde soort vallen weg; `mix` en `bronnen`
  komen er nooit in.
- `cats[bron]`: alleen `aantal`, `eerst` en `laatst`, als eindig getal; anders
  valt de waarde weg. `aantal` wordt niet negatief.
- Tijden (`updated` van het record, `progress.updated`, `lists[].added`,
  `cats.eerst` en `cats.laatst`) worden begrensd op 0 tot nu plus 5 minuten.
  Zo kan een tijd als 1e308 niet voorgoed van latere wijzigingen winnen.

## Testen

    node --test tests/worker.test.mjs

(vanuit de map van de repo; zonder Cloudflare en zonder internet)

## Uitrollen

Alleen na akkoord. Vanuit deze map, en altijd met `-c`, anders pakt wrangler
de config van de app. De eerste keer maakt de migratie `v1` de Durable Object
`FotoTeller` aan; de Rate Limiting-binding vraagt Wrangler 4.36.0 of nieuwer.

    npx wrangler deploy -c wrangler.toml

Geheimen (`APP_SECRET`, `ANTHROPIC_API_KEY`, `ONBEPERKT`, `HQ_MELD_TOKEN`)
staan als secret in Cloudflare, niet in deze map.

Volgorde bij de sync per persoon:

1. Eerst de worker uitrollen (nieuwe routes, `SYNC_TEMPO`, geen nieuwe
   Durable Object-migratie nodig). Een oude app blijft gewoon werken via
   `/sync/<naam>`.
2. Dan de app. Elk toestel met het wachtwoord stapt bij het openen over.
3. Als alle toestellen over zijn: `APP_SECRET` verwijderen en de codes van de
   overstap wissen met `POST /migreer/wis` (zie boven).
4. Pas daarna, als Pia een code heeft: `ONBEPERKT` zetten (zie boven).
