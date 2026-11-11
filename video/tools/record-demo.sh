#!/usr/bin/env bash
# Records the same 9 s twice through the real Mic Clean chain: the noisy demo mic (before)
# and the Mic Clean source (after) → vo/demo_raw.wav, vo/demo_clean.wav.
# Uses a test server on port 4796 with its own settings folder (podcast preset, input = demo_mic).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(cd .. && pwd)
ST=$(mktemp -d)
echo '{"settingsVersion":3,"master":"demo_mic","makeDefault":false}' > "$ST/settings.json"
bash tools/demo-mic.sh up
( cd "$ROOT" && PORT=4796 MIC_STATE_DIR="$ST" exec node server.js ) > "$ST/server.log" 2>&1 &
SRV=$!
for i in $(seq 1 40); do curl -s localhost:4796/api/app >/dev/null && break; sleep 0.3; done
curl -s -X POST -H 'Content-Type: application/json' -d '{}' localhost:4796/api/clean/start; echo
grep -E "target.object" "$ST/mic-clean-chain.conf"
bash tools/demo-mic.sh play
sleep 1
# start both recordings at the top of a loop: wait until the file restarts
parec -d demo_mic --rate=48000 --channels=1 --format=s16le --file-format=wav vo/demo_raw.full.wav & R1=$!
parec -d mic_clean --rate=48000 --channels=1 --format=s16le --file-format=wav vo/demo_clean.full.wav & R2=$!
sleep 20
kill $R1 $R2; wait $R1 $R2 2>/dev/null || true
bash tools/demo-mic.sh down
curl -s -X POST localhost:4796/api/clean/stop; echo
kill $SRV; wait $SRV 2>/dev/null || true
rm -rf "$ST"
ls -la vo/demo_*.full.wav
