#!/usr/bin/env bash
# Builds the explainer video end to end → mic-clean-explainer.mp4 and ../site/assets/.
#   bash make.sh            narration (skips takes that exist) → timing → audio → render → mp4
#   bash make.sh --film     also re-film the app clips first (needs a desktop session and PipeWire)
set -euo pipefail
cd "$(dirname "$0")"
[ -d node_modules ] || npm ci
[ "${1:-}" = "--film" ] && node tour.mjs tour.json && bash tools/record-demo.sh

python3 tts.py lines.json vo/                       # Gemini TTS (free tier: 10 requests a day)
python3 build.py storyboard.json vo/                 # → timing.json, audio/mix.wav
python3 - <<'EOF'
import json, os
T = json.load(open('timing.json'))
for s in T['scenes']:
    if s.get('type') == 'shot': s['frames'] = len(os.listdir(f"clips/{s['clip']}"))
json.dump(T, open('timing.json', 'w'), ensure_ascii=False, indent=1)
EOF

python3 -m http.server 4180 > /dev/null 2>&1 & HTTP=$!
trap 'kill $HTTP 2>/dev/null' EXIT
sleep 1
node render.mjs
ffmpeg -y -loglevel error -framerate 30 -i out/%05d.jpg -i audio/mix.wav -c:v libx264 -preset medium -crf 19 -pix_fmt yuv420p \
  -c:a aac -b:a 192k -shortest -movflags +faststart mic-clean-explainer.mp4
# web copy for the landing page: 1280×720, small enough for GitHub Pages
ffmpeg -y -loglevel error -i mic-clean-explainer.mp4 -vf scale=1280:-2 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart ../site/assets/mic-clean-explainer.mp4
ffmpeg -y -loglevel error -ss 2 -i mic-clean-explainer.mp4 -frames:v 1 -vf scale=1280:-2 ../site/assets/video-poster.png
ls -la mic-clean-explainer.mp4 ../site/assets/mic-clean-explainer.mp4
