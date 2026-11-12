#!/usr/bin/env bash
# Bouwt de kattencatalogus, stempelt een versie en pusht de app naar GitHub.
# De repo zelf is de bron: er wordt niets meer uit de vault gekopieerd.
# Gebruik: bash scripts/deploy.sh "commit message"
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
MSG="${1:-update: app}"
cd "$REPO"

# catalogus altijd verversen, zodat een nieuwe kat vanzelf meegaat
bash "$REPO/scripts/maak-catalogus.sh"

# Versiestempel op de verwijzingen, anders houdt een browser na een deploy
# de oude ui.js of ds.css bij de nieuwe index.html en breekt de app.
VERSIE="$(date +%Y%m%d%H%M%S)"
sed -i '' "s/?v=[A-Za-z0-9]*/?v=$VERSIE/g" "$REPO/index.html"
# dezelfde versie in de service worker, anders blijft een oude cache hangen
sed -i '' "s/^const VERSIE = \".*\";/const VERSIE = \"$VERSIE\";/" "$REPO/sw.js"

git add index.html ds.css ui.js cats.js celebrate.js engine.js lists.js manifest.json sw.js cats icons
if git diff --cached --quiet; then
  echo "Niets veranderd."
  exit 0
fi
git commit -m "$MSG"
git push origin main
echo "Gepusht. Live over ongeveer een minuut op https://dspbrg.github.io/overhoren/"
