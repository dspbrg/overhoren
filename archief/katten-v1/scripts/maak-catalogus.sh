#!/usr/bin/env bash
# Bouwt cats.js uit de bestanden in cats/.
# De bestandsnaam is de database: <rang>-<naam-met-streepjes>.<ext>
#   gewoon-de-spionnen.jpg   -> "De Spionnen", rang gewoon
#   zeldzaam-grumpy.jpg      -> "Grumpy",      rang zeldzaam
# Rangen: gewoon, bijzonder, zeldzaam. Onbekend voorvoegsel wordt gewoon.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
UIT="$APP/cats.js"

{
  echo "// Automatisch gegenereerd door maak-catalogus.sh. Niet met de hand aanpassen:"
  echo "// zet een bestand in cats/ met de naam <rang>-<naam>.jpg en draai het script."
  echo "window.CAT_CATALOG = ["
  first=1
  for f in "$APP"/cats/*.jpg "$APP"/cats/*.jpeg "$APP"/cats/*.png "$APP"/cats/*.webp "$APP"/cats/*.svg; do
    [ -e "$f" ] || continue
    base="$(basename "$f")"
    stem="${base%.*}"
    rang="${stem%%-*}"
    rest="${stem#*-}"
    case "$rang" in
      gewoon|bijzonder|zeldzaam) ;;
      *) rest="$stem"; rang="gewoon" ;;
    esac
    naam="$(echo "$rest" | tr '-' ' ' | awk '{for(i=1;i<=NF;i++) $i=toupper(substr($i,1,1)) substr($i,2)}1')"
    [ $first -eq 1 ] || echo ","
    first=0
    printf '  { src: "cats/%s", naam: "%s", rang: "%s" }' "$base" "$naam" "$rang"
  done
  echo ""
  echo "];"
} > "$UIT"

echo "cats.js bijgewerkt: $(grep -c 'src:' "$UIT") katten"
