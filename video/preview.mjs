// node preview.mjs → preview/<scene>.jpg (middle of every scene + each diagram step). Needs the http.server on 4180.
import { chromium } from 'playwright';
import fs from 'node:fs';
const T = JSON.parse(fs.readFileSync('timing.json', 'utf8'));
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.addInitScript(t => { window.TIMING = t; }, T);
await p.goto('http://localhost:4180/stage.html');
await p.evaluate(() => document.fonts.ready); await p.waitForTimeout(400);
fs.mkdirSync('preview', { recursive: true });
for (const s of T.scenes) {
  const at = [['mid', s.start + s.dur * 0.6]];
  (s.flow || []).forEach((f, i) => f.at !== undefined && at.push([`step${i + 1}`, s.start + f.at + 0.9]));
  for (const [n, t] of at) { await p.evaluate(x => window.render(x), t); await p.screenshot({ path: `preview/${s.id}-${n}.jpg`, quality: 70, type: 'jpeg' }); }
}
console.log('preview/'); await b.close();
