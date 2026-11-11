#!/usr/bin/env python3
"""Narration with Google Gemini TTS (one voice).   python3 tts.py lines.json vo/ [--only n3] [--provider openrouter] [--voice Mako]
lines.json: [{"id": "n1", "text": "…", "style": "warm, clear"}, …] → vo/<id>.wav (24 kHz mono) + vo/durations.json
Resumable (existing WAVs are skipped: delete one to re-take it). Standard library only; never prints the key."""
import argparse, base64, json, os, re, sys, time, urllib.error, urllib.request, wave
from pathlib import Path

GEMINI_MODEL, OPENROUTER_MODEL = 'gemini-3.8-flash-tts', 'google/gemini-3.8-flash-lite-tts'
DIALECT = ('You are one friendly Egyptian narrator explaining a software system. Speak natural Egyptian colloquial '
           'Arabic (العامية المصرية); say English technical terms the way Egyptian engineers do. Read only the line.')

def key(name):
    v = os.environ.get(f'{name.upper()}_API_KEY')
    p = Path.home() / '.config/lura/keys.json'
    if not v and p.exists():
        k = json.loads(p.read_text()); v = k.get(name) or k.get(f'{name}_api_key') or (k.get('google') if name == 'gemini' else None)
    if not v: sys.exit(f'No {name} key: set {name.upper()}_API_KEY or add "{name}" to ~/.config/lura/keys.json')
    return v

def post(url, body, headers):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **headers})
    with urllib.request.urlopen(req, timeout=180) as r: return r.read(), r.headers.get('Content-Type', '')

def gemini(line, k, model, voice):
    body = {'contents': [{'parts': [{'text': f'{DIALECT} Tone: {line.get("style", "warm, clear")}.\n\n{line["text"]}'}]}],
            'generationConfig': {'responseModalities': ['AUDIO'], 'speechConfig': {'voiceConfig': {'prebuiltVoiceConfig': {'voiceName': voice}}}}}
    raw, _ = post(f'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', body, {'x-goog-api-key': k})
    part = json.loads(raw)['candidates'][0]['content']['parts'][0]['inlineData']
    return base64.b64decode(part['data']), int(m.group(1)) if (m := re.search(r'rate=(\d+)', part.get('mimeType', ''))) else 24000

def openrouter(line, k, model, voice):
    body = {'model': model, 'input': line['text'], 'voice': voice, 'response_format': 'pcm',
            'instructions': f'{DIALECT} Tone: {line.get("style", "warm, clear")}.'}
    raw, ctype = post('https://openrouter.ai/api/v1/audio/speech', body, {'Authorization': f'Bearer {k}'})
    if 'json' in ctype: raise RuntimeError(raw[:300])
    return raw, int(m.group(1)) if (m := re.search(r'rate=(\d+)', ctype)) else 24000

ELEVEN_MODEL, ELEVEN_VOICE = 'eleven_multilingual_v2', 'mXovlg4TtTSUsS5BeRYF'   # Haz: Egyptian Arabic, male (Ziad: 5REPlS2Ja1VZ7zNA0ykn)

def elevenlabs(line, k, model, voice):
    body = {'text': line['text'], 'model_id': model, 'voice_settings': {'stability': 0.5, 'similarity_boost': 0.75, 'style': 0.2}}
    raw, ctype = post(f'https://api.elevenlabs.io/v1/text-to-speech/{voice}?output_format=pcm_24000', body, {'xi-api-key': k})
    if 'json' in ctype: raise RuntimeError(raw[:300])
    return raw, 24000

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('lines'); ap.add_argument('out')
    ap.add_argument('--provider', choices=['gemini', 'openrouter', 'elevenlabs'], default='gemini'); ap.add_argument('--model')
    ap.add_argument('--voice'); ap.add_argument('--only'); a = ap.parse_args()
    lines = json.loads(Path(a.lines).read_text()); out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    k = key(a.provider)
    model = a.model or {'gemini': GEMINI_MODEL, 'openrouter': OPENROUTER_MODEL, 'elevenlabs': ELEVEN_MODEL}[a.provider]
    a.voice = a.voice or (ELEVEN_VOICE if a.provider == 'elevenlabs' else 'Mako')
    fn = {'gemini': gemini, 'openrouter': openrouter, 'elevenlabs': elevenlabs}[a.provider]
    for L in lines:
        f = out / f'{L["id"]}.wav'
        if (a.only and L['id'] != a.only) or f.exists(): continue
        for attempt in range(5):
            try:
                pcm, rate = fn(L, k, model, a.voice)
                # Gemini TTS sometimes reads the line and then keeps going with ~20 s of non-speech.
                # Spoken Egyptian Arabic here runs at about 12 characters a second; reject takes far longer than that.
                secs, expect = len(pcm) / 2 / rate, max(3.0, len(L['text']) / 12)
                if secs > expect * 1.8: raise RuntimeError(f'take is {secs:.1f} s, expected about {expect:.1f} s')
                with wave.open(str(f), 'wb') as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)
                print('✓', L['id'], flush=True); break
            except urllib.error.HTTPError as e:
                msg = e.read().decode('utf-8', 'replace')[:300]
                if e.code in (400, 401, 402, 403): sys.exit(f'{L["id"]}: HTTP {e.code} {msg}')   # wrong voice/model/key: fix, don't retry
                time.sleep(min(10 * 2 ** attempt, 120))
            except Exception as e:
                print(' ', L['id'], e, flush=True); time.sleep(min(10 * 2 ** attempt, 120))
        else: print('✗', L['id'], 'failed', flush=True)
        time.sleep(1.5)
    durs = {}
    for f in sorted(out.glob('*.wav')):
        with wave.open(str(f)) as w: durs[f.stem] = round(w.getnframes() / w.getframerate(), 3)
    (out / 'durations.json').write_text(json.dumps(durs, indent=1)); print('durations →', out / 'durations.json')

if __name__ == '__main__': main()
