# overhoren-api

Cloudflare Worker voor de sync (KV-binding `SYNC`) en de foto-import via de
Anthropic-API (`/extract`, `/enrich`). Los van de app zelf: die heeft een eigen
config in `../wrangler.jsonc`.

Bindings in `wrangler.toml`:

- `SYNC`: KV, alleen voor de sync.
- `TELLER`: Durable Object `FotoTeller` (`src/teller.js`), SQLite-opslag, ook
  op het gratis plan. Telt de foto-import.
- `FOTO_TEMPO`: Cloudflare Rate Limiting, 20 foto-verzoeken per minuut per IP.

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
| `PUT /sync/<naam>` | 1 MiB, anders 413 | samengevoegd record hooguit 2 MiB, anders 413 en niets opgeslagen |
| `POST /extract` | 2 MiB plus 1 KiB, anders 413 | `image` verplicht, alleen base64, hooguit 2 MiB; `mediaType` jpeg, png, gif of webp; `subjectHint` leeg, `zinnen`, `anders`, of `wd:`/`dw:` met een taal van hooguit 20 letters |
| `POST /enrich` | 64 KiB, anders 413 | `items` hooguit 150, elk met `word` en `def` als tekst van hooguit 200 tekens; andere velden gaan niet naar de AI |

Een `subject` bij `/enrich` die geen taalnaam van hooguit 20 letters is, wordt
"vreemde taal". `max_tokens`: 4096 voor `/extract`, 8192 voor `/enrich`
(ongeveer 70 tokens per woord; een bladzijde van 20 tot 40 woorden past ruim).

## Wachtwoord en foto-grenzen

De sync (`/sync/<naam>`) vraagt het wachtwoord (`x-api-token`, gelijk aan
`APP_SECRET`), anders 401. De foto-import (`POST /extract` en `POST /enrich`)
is open voor iedereen, met of zonder wachtwoord, onder dezelfde grenzen.
Volgorde per verzoek:

1. Tempo: per IP (`CF-Connecting-IP`) hooguit 20 per minuut, voor alles
   anders, ook voor het lezen van de body. Daarboven 429 met `"grens":
   "tempo"`. Dit telt per Cloudflare-locatie en bij benadering; het houdt een
   stroom verzoeken tegen, de echte grens is de teller.
2. Toestel: het id in `x-toestel` (een `crypto.randomUUID()`, versie 4,
   kleine letters). Een oude app zonder `x-toestel` maar met het juiste
   wachtwoord telt onder het vaste id `wachtwoord`. Verder: 400.
3. Invoer controleren (zie de tabel).
4. Reserveren bij de teller, voor de AI-aanroep:
   - `FOTO_PER_TOESTEL_PER_DAG` (10): per toestel per kalenderdag.
   - `FOTO_PER_MAAND` (100): voor iedereen samen per kalendermaand.
   Boven een grens komt 429 met `{ "error": "Grens bereikt", "grens":
   "toestel" }` of `"maand"`, zonder AI-aanroep.
5. De AI-aanroep. Alleen bij een storing aan de kant van Anthropic (429,
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

Bij 80 en 100 foto's (`/extract`) in een maand geeft de teller die drempel
terug bij precies de reservering die hem haalt, en roept de worker
`meldDrempel` aan. Die doet nog niets en gaat niet het net op.

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

Geheimen (`APP_SECRET`, `ANTHROPIC_API_KEY`) staan als secret in Cloudflare,
niet in deze map.
