#!/usr/bin/env bash
# Downloads the RNNoise LADSPA plugin (werman/noise-suppression-for-voice, GPL-3.0)
# that ships inside the Linux packages, and checks it is the expected file.
set -euo pipefail
cd "$(dirname "$0")"
VER=v1.10
URL="https://github.com/werman/noise-suppression-for-voice/releases/download/$VER/linux-rnnoise.zip"
OUT=ladspa/librnnoise_ladspa.so
if [ -s "$OUT" ]; then echo "RNNoise already here: $OUT"; exit 0; fi
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL -o "$TMP/r.zip" "$URL"
unzip -q -j -o "$TMP/r.zip" '*/ladspa/librnnoise_ladspa.so' -d "$TMP/x"
install -m 0644 "$TMP/x/librnnoise_ladspa.so" "$OUT"
file "$OUT" | grep -q 'ELF 64-bit.*x86-64' || { echo "unexpected RNNoise binary"; exit 1; }
curl -fsSL -o ../licenses/RNNoise-LADSPA-LICENSE.txt "https://raw.githubusercontent.com/werman/noise-suppression-for-voice/$VER/LICENSE"
echo "RNNoise $VER → $OUT"
