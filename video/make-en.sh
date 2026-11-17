#!/usr/bin/env bash
# The English cut of the explainer, rendered with HyperFrames in the Notebook style (stage.en.html).
# Same footage and the same before/after recordings as the Arabic cut; only the voice and the text change.
#   bash make-en.sh                 narration (skips takes that exist) → timing → audio → snapshots → render → mp4
#   VO=dir bash make-en.sh --preview  snapshots only, from the takes in dir (default vo_en/)
# Needs clips/ (bash make.sh --film) and vo_en/demo_raw.wav + vo_en/demo_clean.wav (copies of vo/).
set -euo pipefail
cd "$(dirname "$0")"
VO="${VO:-vo_en}"
OUT="${OUT:-mic-clean-en.mp4}"

[ -f sfx/whoosh.wav ] || { mkdir -p sfx; ffmpeg -y -loglevel error -f lavfi -i "anoisesrc=d=0.5:c=pink:r=48000:a=0.5" \
  -af "highpass=f=500,lowpass=f=5000,afade=t=in:d=0.22:curve=qsin,afade=t=out:st=0.24:d=0.26:curve=qsin,volume=0.5" -ac 2 sfx/whoosh.wav; }
for f in demo_raw demo_clean; do [ -f "$VO/$f.wav" ] || cp "vo/$f.wav" "$VO/"; done

# ElevenLabs premade male voice; the key comes from ELEVENLABS_API_KEY or ~/.config/lura/keys.json (never printed)
[ "${1:-}" = "--preview" ] || python3 tts.py lines.en.json "$VO/" --provider "${TTS_PROVIDER:-elevenlabs}" ${TTS_VOICE:+--voice "$TTS_VOICE"}
python3 build.py storyboard.en.json "$VO/" en          # → timing.en.json, audio/mix.en.wav
python3 - <<'EOF'
import json, os
T = json.load(open('timing.en.json'))
for s in T['scenes']:
    if s.get('type') == 'shot': s['frames'] = len(os.listdir(f"clips/{s['clip']}"))
json.dump(T, open('timing.en.json', 'w'), ensure_ascii=False, indent=1)
EOF
DUR=$(python3 -c 'import json;print(json.load(open("timing.en.json"))["total"])')
W=(--page stage.en.html --out hf_en --size 1920x1080 --duration "$DUR" --audio audio/mix.en.wav
   --data timing.en.json=TIMING --fn render --copy fonts img clips remixicon.css remixicon.woff2)
SNAP=$(python3 -c 'import json;T=json.load(open("timing.en.json"));print(",".join(f"{s["start"]+s["dur"]*.6:.2f}" for s in T["scenes"]))')
python3 hf_wrap.py "${W[@]}" --snapshot "$SNAP"
[ "${1:-}" = "--preview" ] && exit 0
python3 hf_wrap.py "${W[@]}" --render "$OUT"
# web copy + poster for the landing page
ffmpeg -y -loglevel error -i "$OUT" -vf scale=1280:-2 -c:v libx264 -preset slow -crf 27 -pix_fmt yuv420p \
  -c:a aac -b:a 96k -movflags +faststart ../site/assets/mic-clean-en.mp4
ffmpeg -y -loglevel error -ss 2 -i "$OUT" -frames:v 1 -vf scale=1280:-2 ../site/assets/video-poster-en.png
ls -la "$OUT" ../site/assets/mic-clean-en.mp4
