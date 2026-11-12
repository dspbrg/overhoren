#!/usr/bin/env bash
# Kopieert de app uit de vault naar de publieke repo en pusht naar GitHub Pages.
# Bestanden: index.html (schermen), ds.css (design systeem), ui.js (componenten),
# engine.js (nakijken en herhaalschema), lists.js (woordenlijsten).
# Gebruik: bash "02 - Projects/Overhoren/deploy.sh" "commit message"
set -euo pipefail
VAULT_APP="$(cd "$(dirname "$0")/app" && pwd)"
REPO="${OVERHOREN_REPO:-$HOME/Developer/14 Overhoren}"
MSG="${1:-update: app}"

if [ ! -d "$REPO/.git" ]; then
  echo "Repo niet gevonden op $REPO. Eerst: git clone https://github.com/dspbrg/overhoren.git $REPO"
  exit 1
fi

# catalogus altijd verversen, zodat een nieuwe kat vanzelf meegaat
bash "$(dirname "$0")/maak-catalogus.sh"

cp "$VAULT_APP"/index.html "$VAULT_APP"/ds.css "$VAULT_APP"/ui.js "$VAULT_APP"/cats.js "$VAULT_APP"/celebrate.js "$VAULT_APP"/engine.js "$VAULT_APP"/lists.js "$VAULT_APP"/manifest.json "$VAULT_APP"/sw.js "$REPO"/
mkdir -p "$REPO/icons"
cp "$VAULT_APP"/icons/*.png "$REPO"/icons/ 2>/dev/null || true
mkdir -p "$REPO/cats"
cp "$VAULT_APP"/cats/*.jpg "$VAULT_APP"/cats/*.png "$VAULT_APP"/cats/*.svg "$REPO"/cats/ 2>/dev/null || true
# fonts zijn zelf gehost; ontbreken ze, dan liever stoppen dan een app zonder letters live zetten
mkdir -p "$REPO/fonts"
cp "$VAULT_APP"/fonts/*.woff2 "$VAULT_APP"/fonts/OFL.txt "$REPO"/fonts/
cd "$REPO"
# Versiestempel op de verwijzingen, anders houdt een browser na een deploy
# de oude ui.js of ds.css bij de nieuwe index.html en breekt de app.
VERSIE="$(date +%Y%m%d%H%M%S)"
sed -i '' "s/?v=[A-Za-z0-9]*/?v=$VERSIE/g" "$REPO/index.html"
# dezelfde versie in de service worker, anders blijft een oude cache hangen
sed -i '' "s/^const VERSIE = \".*\";/const VERSIE = \"$VERSIE\";/" "$REPO/sw.js"

git add index.html ds.css ui.js cats.js celebrate.js engine.js lists.js manifest.json sw.js cats icons fonts
if git diff --cached --quiet; then
  echo "Niets veranderd."
  exit 0
fi
git commit -m "$MSG"
git push origin main
echo "Gepusht. Live over ongeveer een minuut op https://dspbrg.github.io/overhoren/"
