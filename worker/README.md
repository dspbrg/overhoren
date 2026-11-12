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

## Testen

    node --test tests/worker.test.mjs

(vanuit de map van de repo; zonder Cloudflare en zonder internet)

## Uitrollen

Alleen na akkoord. Vanuit deze map, en altijd met `-c`, anders pakt wrangler
de config van de app:

    npx wrangler deploy -c wrangler.toml

Geheimen (`APP_SECRET`, `ANTHROPIC_API_KEY`) staan als secret in Cloudflare,
niet in deze map.
