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
dezelfde regels als `applyRemote` in `index.html`). Elk onderdeel wordt nieuw
opgebouwd met alleen de bekende velden:

- `progress[lijst-id]`: altijd `{ items, sessions, updated? }`. `items` heeft
  alleen sleutels die een index zijn, met een woordtoestand (box, due, seen,
  correct, wrong, lapses, streak, last als eindig getal, ontbrekend wordt 0;
  dirWrong en partWrong met tellers, kapot wordt 0). Een woordtoestand of ronde
  met een kapot getal valt weg. `items` of `sessions` met de verkeerde vorm
  worden leeg.
- `lists[]`: `id` (tekst tot 100 tekens of getal), `title` (tot 200) en `items`
  (array, hooguit 5000 woorden, elk met `word` en `def` tot 1000 tekens) zijn
  verplicht. Een kapot woord laat de hele lijst vallen, omdat weglaten de
  nummering van de voortgang verschuift. Losse optionele velden met een
  verkeerde vorm vallen weg; `mix` en `bronnen` komen er nooit in.
- `cats[bron]`: alleen `aantal`, `eerst` en `laatst`, als eindig getal.

## Testen

    node --test tests/worker.test.mjs

(vanuit de map van de repo; zonder Cloudflare en zonder internet)

## Uitrollen

Alleen na akkoord. Vanuit deze map, en altijd met `-c`, anders pakt wrangler
de config van de app:

    npx wrangler deploy -c wrangler.toml

Geheimen (`APP_SECRET`, `ANTHROPIC_API_KEY`) staan als secret in Cloudflare,
niet in deze map.
