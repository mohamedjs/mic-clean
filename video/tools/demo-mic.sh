#!/usr/bin/env bash
# A pretend noisy microphone for the video, so the before/after demo is real Mic Clean
# output and not an edit:  demo/noisy.wav → sink "demo_spk" → source "demo_mic" (Demo Mic).
#   bash tools/demo-mic.sh up      create the devices
#   bash tools/demo-mic.sh play    loop demo/noisy.wav into the demo mic (in the background)
#   bash tools/demo-mic.sh down    stop the loop and remove the devices
set -euo pipefail
cd "$(dirname "$0")/.."
case "${1:-}" in
  up)
    pactl list sinks short | grep -q demo_spk || pactl load-module module-null-sink sink_name=demo_spk sink_properties=device.description=DemoSpeaker rate=48000 channels=1 > .demo-mod1
    pactl list sources short | grep -q -P '\tdemo_mic\t' || pactl load-module module-remap-source master=demo_spk.monitor source_name=demo_mic source_properties=device.description=DemoMic > .demo-mod2
    pactl list sources short | cut -f2 | grep demo ;;
  play)
    ( while :; do paplay --device=demo_spk demo/noisy.wav; done ) > /dev/null 2>&1 &
    echo $! > .demo-play; echo "playing (pid $(cat .demo-play))" ;;
  down)
    [ -f .demo-play ] && { pkill -P "$(cat .demo-play)" 2>/dev/null || true; kill "$(cat .demo-play)" 2>/dev/null || true; rm -f .demo-play; }
    for f in .demo-mod2 .demo-mod1; do [ -f $f ] && { pactl unload-module "$(cat $f)" 2>/dev/null || true; rm -f $f; }; done
    pactl list sources short | cut -f2 | grep demo || echo "demo devices removed" ;;
  *) echo "usage: $0 up|play|down"; exit 1 ;;
esac
