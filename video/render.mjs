// node render.mjs [from] [to] → out/00000.jpg … (1920×1080, 30 fps). Needs: python3 -m http.server 4180 (in this folder)
import { chromium } from 'playwright';
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('timing.json', 'utf8'));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(t => { window.TIMING = t; }, T);
await p.goto('http://localhost:4180/stage.html');
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
const N = Math.round(T.total * 30);
const from = Number(process.argv[2] || 0), to = Math.min(N, Number(process.argv[3] || N));
if (from === 0) { fs.rmSync('out', { recursive: true, force: true }); }
fs.mkdirSync('out', { recursive: true });
for (let i = from; i < to; i++) {
  await p.evaluate(t => window.render(t), i / 30);
  await p.screenshot({ path: `out/${String(i).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 90 });
  if (i % 300 === 0) console.log('frame', i, '/', N);
}
console.log(to - from, 'frames → out/');
await b.close();
