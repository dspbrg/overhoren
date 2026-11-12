#!/usr/bin/env bash
# Bouwt de zelf gehoste fonts in fonts/ opnieuw op. Alleen nodig als je
# een andere versie wilt; de woff2-bestanden staan gewoon in de repo.
#
#   Chakra Petch 600 en 700  uit @fontsource/chakra-petch (kant-en-klaar)
#   Inter variabel 400-700   uit inter-ui (de bestanden van de maker)
#
# Inter komt niet uit Fontsource: die versie komt van Google Fonts en
# mist de stylistic sets, en ds.css zet 'ss02' aan (de onderscheidende
# I, l en 1). Daarom subsetten we hier zelf, met alle features erin.
#
# Vereist: npm, python3 met fonttools en brotli (pip install fonttools brotli).
# Gebruik: bash scripts/maak-fonts.sh
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
FONTS="$REPO/fonts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

CHAKRA_VERSIE="5.3.0"
INTER_VERSIE="4.1.1"

# zelfde subsets als Fontsource en Google Fonts
LATIN="U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT="U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

cd "$TMP"
npm pack --silent "@fontsource/chakra-petch@$CHAKRA_VERSIE" "inter-ui@$INTER_VERSIE" >/dev/null
mkdir chakra inter
tar xzf "fontsource-chakra-petch-$CHAKRA_VERSIE.tgz" -C chakra
tar xzf "inter-ui-$INTER_VERSIE.tgz" -C inter

mkdir -p "$FONTS"
for w in 600 700; do
  for s in latin latin-ext; do
    cp "chakra/package/files/chakra-petch-$s-$w-normal.woff2" "$FONTS/"
  done
done

# Inter: eerst de gewichtas inperken tot 400-700, dan per subset knippen.
# --layout-features='*' houdt ss02 en de andere stylistic sets erin.
python3 -I -m fontTools.varLib.instancer inter/package/variable/InterVariable.woff2 \
  wght=400:700 -o inter-400-700.ttf --quiet
python3 -I -m fontTools.subset inter-400-700.ttf --unicodes="$LATIN" \
  --layout-features='*' --flavor=woff2 --output-file="$FONTS/inter-latin-wght-normal.woff2"
python3 -I -m fontTools.subset inter-400-700.ttf --unicodes="$LATIN_EXT" \
  --layout-features='*' --flavor=woff2 --output-file="$FONTS/inter-latin-ext-wght-normal.woff2"

# licenties
{
  echo "Chakra Petch"; echo "============"
  cat chakra/package/LICENSE; echo; echo
  echo "Inter"; echo "====="
  cat inter/package/LICENSE.txt
} > "$FONTS/OFL.txt"

echo "Fonts staan in $FONTS"
ls -l "$FONTS"
