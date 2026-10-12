#!/bin/sh
# Builds the macOS .icns from the rendered PNGs.
#
# iconutil demands this exact directory layout and these exact names; it is not
# a general converter and will refuse anything else without saying why.
set -eu
cd "$(dirname "$0")/.."

SRC=assets/logo/render
SET=assets/logo/CodeStation.iconset
OUT=assets/logo/CodeStation.icns

[ -f "$SRC/codestation-1024.png" ] || { echo "Keine Renders. Erst: npm run logo:render" >&2; exit 1; }

rm -rf "$SET"
mkdir -p "$SET"

cp "$SRC/codestation-16.png"   "$SET/icon_16x16.png"
cp "$SRC/codestation-32.png"   "$SET/icon_16x16@2x.png"
cp "$SRC/codestation-32.png"   "$SET/icon_32x32.png"
cp "$SRC/codestation-64.png"   "$SET/icon_32x32@2x.png"
cp "$SRC/codestation-128.png"  "$SET/icon_128x128.png"
cp "$SRC/codestation-256.png"  "$SET/icon_128x128@2x.png"
cp "$SRC/codestation-256.png"  "$SET/icon_256x256.png"
cp "$SRC/codestation-512.png"  "$SET/icon_256x256@2x.png"
cp "$SRC/codestation-512.png"  "$SET/icon_512x512.png"
cp "$SRC/codestation-1024.png" "$SET/icon_512x512@2x.png"

iconutil -c icns "$SET" -o "$OUT"
rm -rf "$SET"
cp "$SRC/codestation-512.png" assets/logo/icon-512.png
echo "[logo] $OUT ($(wc -c < "$OUT" | tr -d ' ') Bytes)"
