#!/usr/bin/env bash
# Haalt de zelf gehoste fonts uit npm (Fontsource) naar app/fonts.
# Eenmalig nodig, of als je de fonts wilt bijwerken. Vereist npm.
# Gebruik: bash "02 - Projects/Overhoren/haal-fonts.sh"
set -euo pipefail
FONTS="$(cd "$(dirname "$0")/app" && pwd)/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$FONTS"
cd "$TMP"
npm pack --silent @fontsource-variable/fredoka@5.3.0 @fontsource/atkinson-hyperlegible@5.3.0 >/dev/null
mkdir fr at
tar xzf fontsource-variable-fredoka-5.3.0.tgz -C fr
tar xzf fontsource-atkinson-hyperlegible-5.3.0.tgz -C at
cp fr/package/files/fredoka-latin-wght-normal.woff2 \
   fr/package/files/fredoka-latin-ext-wght-normal.woff2 \
   at/package/files/atkinson-hyperlegible-latin-400-normal.woff2 \
   at/package/files/atkinson-hyperlegible-latin-ext-400-normal.woff2 \
   at/package/files/atkinson-hyperlegible-latin-700-normal.woff2 \
   at/package/files/atkinson-hyperlegible-latin-ext-700-normal.woff2 \
   "$FONTS"/
echo "Fonts staan in $FONTS"
ls -1 "$FONTS"
