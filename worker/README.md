# overhoren-api

Cloudflare Worker voor de sync (KV-binding `SYNC`) en de foto-import via de
Anthropic-API (`/extract`, `/enrich`). Los van de app zelf: die heeft een eigen
config in `../wrangler.jsonc`.

## Alleen vanaf twee origins

CORS werkt met een allowlist in `wrangler.toml` (`ALLOWED_ORIGIN`, gescheiden
door komma's):

- `https://overhoren.vandaan.net`
- `https://dspbrg.github.io`

Vanaf een andere origin, ook `localhost`, blokkeert de browser sync en
foto-import. De tests gebruiken een nep-worker en hebben daar geen last van.

## Grenzen

| Endpoint | Body | Verder |
| --- | --- | --- |
| `PUT /sync/<naam>` | 1 MiB, anders 413 | samengevoegd record hooguit 2 MiB, anders 413 en niets opgeslagen |
| `POST /extract` | 8 MiB, anders 413 | `image` verplicht, `mediaType` jpeg, png, gif of webp |
| `POST /enrich` | 64 KiB, anders 413 | `items` een lijst van hooguit 200 |

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
de config van de app:

    npx wrangler deploy -c wrangler.toml

Geheimen (`APP_SECRET`, `ANTHROPIC_API_KEY`) staan als secret in Cloudflare,
niet in deze map.
