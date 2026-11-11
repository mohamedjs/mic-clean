// Films the real Mic Clean desktop app (Electron) clip by clip, with a fake cursor.
//   node tour.mjs tour.json [clipId …]  → clips/<id>/0000.jpg … (15 fps)
// tour.json: { "fps": 15, "clips": [ { "id": "home", "seconds": 9, "skip": 1.2, "env": { "MIC_PLATFORM": "darwin" },
//   "settings": { … settings.json for this clip … }, "before": "shell command", "after": "shell command",
//   "steps": [ { "wait": 800 }, { "move": "#x" }, { "click": "#x" }, { "scroll": 600 }, { "eval": "…js…" } ] } ] }
// Each clip starts the app fresh on port 4797 with its own settings folder (never your real one).
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';

const tour = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const only = process.argv.slice(3);
const size = { width: 1440, height: 810 };
const fps = tour.fps || 15;
const ROOT = path.resolve('..');

const CURSOR = `(() => { if (document.getElementById('__cur')) return;
  const c = document.createElement('div'); c.id = '__cur';
  c.style.cssText = 'position:fixed;left:0;top:0;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;background:rgba(255,197,77,.9);box-shadow:0 0 0 6px rgba(255,197,77,.35),0 6px 14px rgba(0,0,0,.35);z-index:2147483647;pointer-events:none;transition:transform .12s';
  document.documentElement.appendChild(c); window.__curXY = [innerWidth / 2, innerHeight / 2];
  c.style.left = innerWidth / 2 + 'px'; c.style.top = innerHeight / 2 + 'px'; })()`;

async function glide(p, sel) {
  const loc = p.locator(sel).first();
  await loc.scrollIntoViewIfNeeded().catch(() => {});
  const box = await loc.boundingBox(); if (!box) return null;
  const to = [box.x + box.width / 2, box.y + box.height / 2];
  await p.evaluate(async ([x, y]) => {
    const c = document.getElementById('__cur'), [x0, y0] = window.__curXY, t0 = performance.now(), D = 650;
    await new Promise(res => { const f = now => { const k = Math.min(1, (now - t0) / D), e = 1 - Math.pow(1 - k, 3);
      c.style.left = x0 + (x - x0) * e + 'px'; c.style.top = y0 + (y - y0) * e + 'px'; k < 1 ? requestAnimationFrame(f) : res(); }; requestAnimationFrame(f); });
    window.__curXY = [x, y];
  }, to);
  return to;
}
const tap = p => p.evaluate(() => { const c = document.getElementById('__cur'); c.style.transform = 'scale(.7)'; setTimeout(() => (c.style.transform = ''), 160); });

async function run(p, steps) {
  for (const s of steps) {
    if (s.wait) await p.waitForTimeout(s.wait);
    if (s.move) await glide(p, s.move);
    if (s.click) { await glide(p, s.click); await tap(p); await p.click(s.click); await p.waitForTimeout(400); }
    if (s.scroll) { await p.evaluate(y => window.scrollBy({ top: y, behavior: 'smooth' }), s.scroll); await p.waitForTimeout(900); }
    if (s.eval) await p.evaluate(s.eval);
  }
}

fs.mkdirSync('raw', { recursive: true });
for (const clip of tour.clips) {
  if (only.length && !only.includes(clip.id)) continue;
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'mic-clean-tour-'));
  fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ settingsVersion: 3, ...(clip.settings || {}) }));
  if (clip.before) execSync(clip.before, { stdio: 'inherit' });
  const app = await electron.launch({
    args: [ROOT], cwd: ROOT,
    env: { ...process.env, PORT: '4797', MIC_STATE_DIR: state, MIC_CLEAN_TEST: '1', MIC_CLEAN_WINDOW: `${size.width}x${size.height}`, ...(clip.env || {}) },
    recordVideo: { dir: 'raw', size },
  });
  const p = await app.firstWindow();
  await p.waitForLoadState('networkidle').catch(() => {});
  await p.waitForTimeout(1500);
  await p.evaluate(CURSOR);
  if (clip.setup) await run(p, clip.setup);   // before filming starts (still recorded, cut by "skip")
  const t0 = Date.now(); await run(p, clip.steps);
  const left = clip.seconds * 1000 - (Date.now() - t0); if (left > 0) await p.waitForTimeout(left);
  const video = p.video();
  await app.close();
  if (clip.after) execSync(clip.after, { stdio: 'inherit' });
  const webm = await video.path();
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', webm]).toString());
  const skip = clip.skip ?? Math.max(0, dur - clip.seconds - 0.3);   // default: keep the last `seconds` (the filmed steps)
  const dir = `clips/${clip.id}`; fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', String(skip), '-i', webm, '-t', String(clip.seconds),
    '-vf', `fps=${fps}`, '-q:v', '2', '-start_number', '0', `${dir}/%04d.jpg`]);
  console.log(clip.id, fs.readdirSync(dir).length, 'frames', `(video ${dur.toFixed(1)} s, skip ${skip.toFixed(1)} s)`);
  fs.rmSync(state, { recursive: true, force: true });
}
