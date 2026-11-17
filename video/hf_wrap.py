#!/usr/bin/env python3
"""Wrap a deterministic stage page (one that exposes `render(t)` or `seek(t)`) into a HyperFrames
project and, optionally, render it to MP4. HyperFrames replaces the old Playwright frame loop and
Remotion: it seeks a paused GSAP timeline frame by frame, and the "clock" tween below calls your
page's function with the time, so the page keeps its own engine and look.

  python3 hf_wrap.py --page stage.html --out hf --size 1920x1080 --duration 95.4 \
      --audio audio/mix.wav --data timing.json=TIMING --fn render \
      --copy fonts img clips remixicon.css remixicon.woff2 [--render explainer.mp4] [--snapshot 2,10,30]

  --data FILE=NAME   inlines FILE as window.NAME before the page's scripts (what the old renderer
                     passed with addInitScript). Repeatable.
  --fn               the page's time function: render (product/system explainers) or seek (reels).
  --copy             files/folders the page loads, copied (hard-linked when possible) next to it.
  --sfx T:FILE:VOL   extra sound effect clips (output seconds). Repeatable.
Pinned: hyperframes@0.9.56, gsap@3.15.0. Needs Node 22+, ffmpeg, Chrome (`npx hyperframes doctor`).
"""
import argparse, json, os, re, shutil, subprocess, sys
from pathlib import Path

HF = 'hyperframes@0.9.56'
GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js'

ap = argparse.ArgumentParser()
ap.add_argument('--page', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--size', default='1920x1080')
ap.add_argument('--duration', type=float, required=True)
ap.add_argument('--audio')
ap.add_argument('--data', action='append', default=[])
ap.add_argument('--fn', default='render')
ap.add_argument('--copy', nargs='*', default=[])
ap.add_argument('--sfx', action='append', default=[])
ap.add_argument('--render')
ap.add_argument('--quality', default='high')
ap.add_argument('--snapshot')
a = ap.parse_args()

W, H = map(int, a.size.lower().split('x'))
src_dir = Path(a.page).resolve().parent
out = Path(a.out).resolve()
out.mkdir(parents=True, exist_ok=True)

def place(rel):
    s, d = src_dir / rel, out / rel
    if not s.exists():
        sys.exit(f'missing: {s}')
    if d.exists() or d.is_symlink():
        shutil.rmtree(d) if d.is_dir() and not d.is_symlink() else d.unlink()
    d.parent.mkdir(parents=True, exist_ok=True)
    if s.is_dir():
        shutil.copytree(s, d, copy_function=link_or_copy)
    else:
        link_or_copy(s, d)

def link_or_copy(s, d):
    try:
        os.link(s, d)
    except OSError:
        shutil.copy2(s, d)

for rel in a.copy:
    place(rel)
media = []
if a.audio:
    place(a.audio)
    media.append(f'<audio id="hf-audio" class="clip" src="{a.audio}" data-start="0" data-duration="{a.duration:.3f}" data-has-audio="true"></audio>')
for k, spec in enumerate(a.sfx):
    t, f, v = (spec.split(':') + ['0.3'])[:3]
    place(f)
    d = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', str(src_dir / f)],
                       capture_output=True, text=True).stdout.strip() or '1'
    d = min(float(d), a.duration - float(t))
    media.append(f'<audio id="hf-sfx{k}" class="clip" src="{f}" data-start="{float(t):.3f}" data-duration="{d:.3f}" data-volume="{v}"></audio>')

page = Path(a.page).read_text()
inject = ''.join(f'<script>window.{name} = {Path(src_dir / f).read_text()};</script>'
                 for f, name in (d.split('=') for d in a.data))
page = re.sub(r'(<head[^>]*>)', r'\1' + inject.replace('\\', '\\\\'), page, count=1)
root_open = (f'<div id="hf-root" data-composition-id="main" data-start="0" data-duration="{a.duration:.3f}" '
             f'data-width="{W}" data-height="{H}" style="position:relative;width:{W}px;height:{H}px;overflow:hidden">' + ''.join(media))
clock = f'''<script src="{GSAP}"></script>
<script>
  // HyperFrames seeks this paused timeline; the function-based property hands every time to the page.
  let __hfT = -1;
  const __hfClock = {{ t(v) {{ if (v === undefined) return __hfT; __hfT = v; return window.{a.fn}(v); }} }};
  const __hfTl = gsap.timeline({{ paused: true }});
  __hfTl.fromTo(__hfClock, {{ t: 0 }}, {{ t: {a.duration:.3f}, duration: {a.duration:.3f}, ease: "none" }}, 0);
  window.__timelines = window.__timelines || {{}};
  window.__timelines["main"] = __hfTl;
  __hfTl.seek(0);
</script>'''
body = re.search(r'<body[^>]*>(.*)</body>', page, re.S)
if not body:
    sys.exit('page has no <body>')
inner = body.group(1)
# scripts stay after the stage markup (they query it); the root wraps everything visible
page = page[:body.start(1)] + root_open + inner + '</div>' + clock + page[body.end(1):]
(out / 'index.html').write_text(page)
(out / 'package.json').write_text(json.dumps({'name': 'hf-stage', 'private': True, 'scripts': {
    'check': f'npx -y {HF} lint', 'render': f'npx -y {HF} render'}}, indent=1))
print(f'HyperFrames project → {out}/index.html ({W}x{H}, {a.duration:.2f}s, fn={a.fn})')

def run(*cmd):
    print('$', ' '.join(cmd)); r = subprocess.run(cmd, cwd=out)
    if r.returncode: sys.exit(r.returncode)
run('npx', '-y', HF, 'lint')
if a.snapshot:
    run('npx', '-y', HF, 'snapshot', '--at', a.snapshot, '--no-end', '-o', str(out / 'snapshots'))
if a.render:
    run('npx', '-y', HF, 'render', '--quality', a.quality, '--output', str(Path(a.render).resolve()))
