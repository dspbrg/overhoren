# overhoren
Overhoor-app voor woordenlijsten (Engels, Frans) met gespreide herhaling

## Live

- https://overhoren.vandaan.net: Cloudflare Worker `overhoren`, alleen statische bestanden.
- https://dspbrg.github.io/overhoren/: GitHub Pages.

Beide bouwen vanzelf bij elke commit op `main`. Cloudflare (Workers Builds):
- stempelt eerst de versie in `index.html` (`?v=`) en `sw.js` (`VERSIE`) met de commit-code;
- draait daarna `npx --yes wrangler@4.156.2 deploy`.

Wat er online komt, staat in `.assetsignore`. Dat is een allowlist: zet een nieuw app-bestand daar ook in.

## Lokaal

    python3 -m http.server 8766 --bind 127.0.0.1
    node --test tests/*.test.mjs
