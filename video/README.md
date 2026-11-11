# The Mic Clean explainer video

A 16:9 explainer (1920×1080, 30 fps) with one Egyptian Arabic narrator. Every app shot is the real desktop app filmed on Linux. The before/after audio is a noisy recording played through the real Mic Clean chain, not an edit.

```bash
cd video && bash make.sh           # narration → timing → render → mic-clean-explainer.mp4 (+ a web copy in site/assets)
bash make.sh --film                # also re-film the app (desktop session + PipeWire needed)
```

| File | What it is |
|---|---|
| `storyboard.json` | Scenes in order: title, problem, before/after demo, install, the five tabs, the Linux and macOS/Windows diagrams, code layout, the default-mic code, outro |
| `lines.json` | Narration lines (Egyptian Arabic). `tts.py` turns them into `vo/<id>.wav` with Gemini TTS (voice Mako) and rejects takes that run far longer than the line |
| `tour.json`, `tour.mjs` | Films the Electron app with Playwright, clip by clip, on port 4797 with its own settings folder |
| `tools/demo-mic.sh`, `tools/record-demo.sh`, `demo/noisy.wav` | A pretend noisy mic (null sink + remapped source). The demo records it before and after Mic Clean into `vo/demo_raw.wav` and `vo/demo_clean.wav` |
| `tools/shots.js`, `tools/cdp.js` | The landing-page screenshots, taken over the DevTools protocol |
| `build.py`, `stage.html`, `render.mjs` | Timing and audio mix, the HTML stage with a deterministic `render(t)`, and frame-by-frame rendering |
| `transcribe.py` | Checks each take by transcribing it and printing it next to the script |

Keys come from `GEMINI_API_KEY` or `~/.config/lura/keys.json` and are never printed. The free Gemini tier allows 10 TTS requests a day per model, so `lines.json` groups the diagram and code lines into one request per scene.
