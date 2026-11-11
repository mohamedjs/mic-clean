// Renders scene.js with Excalidraw 0.17.6 in headless Chromium → <out>/mic-clean-architecture.{png,excalidraw,svg}
//   node docs/diagram/render.mjs docs        (uses Playwright from video/node_modules)
import { chromium } from "../../video/node_modules/playwright/index.mjs";
import { writeFileSync, readFileSync } from "fs";
import { createServer } from "http";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || join(here, "..");
const name = process.env.NAME || "mic-clean-architecture";
const srv = createServer((q, r) => {
  const f = q.url === "/" ? "page.html" : q.url.slice(1);
  try { r.end(readFileSync(join(here, f))); } catch { r.statusCode = 404; r.end(); }
}).listen(8766);
const browser = await chromium.launch();
const page = await browser.newPage();
page.on("console", m => console.log("page:", m.text()));
page.on("pageerror", e => console.log("ERR", e.message));
await page.goto("http://127.0.0.1:8766/");
await page.waitForFunction(() => window.ExcalidrawLib && window.SCENE, null, { timeout: 60000 });
await page.evaluate(async () => { for (const f of ["Virgil", "Cascadia", "Helvetica"]) { try { await document.fonts.load(`20px ${f}`); } catch {} } });
const r = await page.evaluate(() => window.build());
writeFileSync(join(out, name + ".png"), Buffer.from(r.png.split(",")[1], "base64"));
writeFileSync(join(out, name + ".excalidraw"), r.json);
writeFileSync(join(out, name + ".svg"), r.svg);
await browser.close(); srv.close();
console.log("ok →", join(out, name + ".png"));
