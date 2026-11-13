# Overhoren (projectnotities)

Overhoor-app voor woordenlijsten (Engels, Frans) met gespreide herhaling. Zie `README.md`.

## Werkwijze

- Elke commit op `main` gaat vanzelf live (Cloudflare Workers Builds en GitHub Pages). Commit en push daarom nooit op `main`.
- Werk op een branch `claude/<onderwerp>` en maak een pull request. Daan voegt zelf samen.
- Vóór je iets af noemt: `node --test tests/*.test.mjs`. Er is geen build-stap en geen linter.
- Tests moeten aantoonbaar kunnen falen. Bewijs een nieuwe test met een rode run en noem die in de PR.
- Nieuw app-bestand: zet het ook in `.assetsignore` (allowlist), anders komt het niet online.
- Sleutels nooit tonen, loggen of committen.
