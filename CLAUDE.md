# Overhoren (projectnotities)

Overhoor-app voor Pia (1TTO) en een paar klasgenoten: woordenlijsten (Engels, Frans) met gespreide herhaling. Statische PWA zonder build, plus een sync-worker.

Volledige overdracht in Outline: Projecten › Overhoren › Overdracht. PRD, bouwopdrachten en Styleguide-regels staan daar ook.

## Afspraken

- Daan is geen developer, wel UX-ontwerper. Laat bij een nieuw scherm eerst een opzet zien voordat je het uitbouwt.
- UI-teksten en commentaar in het Nederlands. Kort, geen em dashes, geen uitroeptekens.
- De repo is de bron. Werk nooit in de vault: daar staat een oude kopie.
- De kat is nooit verdrietig en vraagt nooit om terug te komen.
- Uiterlijk komt uit `ds.css` (tokens bovenin, daarna componenten) en `ui.js`. Geen losse waarden in schermen. Het design system staat op `/designsystem` (`designsystem.html`); werk die mee bij in dezelfde commit.
- Alle tekst haalt 4,5:1 contrast, ook in het donkere thema.

## Techniek

- Statische bestanden in de root: `index.html`, `ds.css`, `ui.js`, `celebrate.js`, `engine.js`, `lists.js`, `sw.js`, `manifest.json`, `designsystem.html`, `katten/`, `fonts/`, `icons/`.
- Live op https://overhoren.vandaan.net (Cloudflare Worker `overhoren`, alleen statische bestanden, `wrangler.jsonc`) en https://dspbrg.github.io/overhoren/ (GitHub Pages).
- Wat online komt staat in `.assetsignore`. Dat is een allowlist: een nieuw app-bestand moet daar ook in, en in `SCHIL` in `sw.js` als het offline moet werken.
- Sync-worker `overhoren-api` in `worker/` (Cloudflare KV). Uitrollen alleen vanuit `worker/` met `-c wrangler.toml`, anders pakt wrangler de app-config.
- De versie stempelt Cloudflare zelf bij elke build: het build command zet de eerste 12 tekens van de commit-sha in `?v=` (`index.html`, `designsystem.html`) en in `VERSIE` (`sw.js`). In de repo blijft alles ongestempeld; met de hand stempelen laat de tests falen. GitHub Pages stempelt niet en draait network-first.
- Na het samenvoegen controleren of `VERSIE` in https://overhoren.vandaan.net/sw.js de sha van main is. Tot 14-11-2026 bouwde Cloudflare nooit (Git-koppeling kapot); toen is die opnieuw gekoppeld. Zie Overdracht › Deployen.
- Sleutels nooit tonen, loggen of committen.

## Werkwijze

- Elke commit op `main` gaat vanzelf live (Cloudflare Workers Builds en GitHub Pages). Commit en push daarom nooit op `main`.
- Werk op een branch `claude/<onderwerp>` en maak een pull request. Daan voegt zelf samen.
- Volg `~/Developer/Agents/afspraken.md` (bouwers, keurders, wanneer opnieuw keuren).
- Vóór je iets af noemt: `node --test tests/*.test.mjs` helemaal groen. Er is geen build of lint.
- Tests moeten aantoonbaar kunnen falen. Bewijs een nieuwe test met een rode run en noem die in de PR.
- Uitrollen naar productie (app of worker) alleen met akkoord van Daan.
- Na een wijziging die de werking verandert: werk de Overdracht in Outline bij.
