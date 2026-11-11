'use strict';
// Mic Clean — the local server. Picks the routes for this OS, serves the window's
// files and owns the Linux audio chain's lifetime.
//
//   Linux    → modules/linux   (PipeWire filter-chain or WebRTC; the server cleans the audio)
//   macOS    → modules/mac     (the window cleans the audio into BlackHole)
//   Windows  → modules/windows (the window cleans the audio into VB-CABLE)
const { APP, PORT, HOST, MODE, BROWSER_MODE, IS_MAC, PATHS } = require('./core/config');
const { createServer } = require('./core/http');
const settings = require('./modules/settings');
const deps = require('./modules/deps');

function buildRoutes() {
  const routes = { ...require('./modules/linux/routes') };
  if (IS_MAC) Object.assign(routes, require('./modules/mac').routes);
  else if (BROWSER_MODE) Object.assign(routes, require('./modules/windows').routes);
  Object.assign(routes, deps.routes, {
    'GET /api/app': async () => ({ ok: true, name: APP.name, version: require('../package.json').version, mode: MODE, desktop: !!process.versions.electron }),
  });
  return routes;
}

const MODE_NOTE = { darwin: 'وضع الماك: التنضيف جوه الشباك ← BlackHole', win32: 'وضع ويندوز: التنضيف جوه الشباك ← VB-CABLE', web: 'وضع البراوزر: مفيش pactl، التنضيف جوه الشباك', linux: '' };

let server = null;

// Starts the server. Resolves with the port it listens on (tries the next ports if busy).
function start({ port = PORT, host = HOST, tries = 10, quiet = false } = {}) {
  server = createServer(buildRoutes(), [['/shared/', PATHS.shared], ['/', PATHS.public]]);
  return new Promise((resolve, reject) => {
    const attempt = (p, left) => {
      server.once('error', (e) => (e.code === 'EADDRINUSE' && left > 0 ? attempt(p + 1, left - 1) : reject(e)));
      server.listen(p, host, () => {
        if (!quiet) console.log(`\n  🎙  ${APP.name} → http://localhost:${p}   ${MODE_NOTE[MODE]}\n`);
        autoStart();
        resolve(p);
      });
    };
    attempt(port, tries);
  });
}

function autoStart() {
  if (!settings.autoStart || BROWSER_MODE) return;
  setTimeout(async () => {
    const engine = require('./modules/linux/engine');
    const st = await require('./modules/linux/status').getStatus();
    const ok = settings.engine === 'pipewire' ? await engine.startPipewireChain() : await engine.startWebrtc(st.server?.isPipeWire);
    console.log(ok ? `  ✓ ${APP.desc} اشتغل تلقائي` : `  ⚠ ${APP.desc} مقدرش يشتغل: ${engine.state.lastError}`);
  }, 800);
}

// Removes the virtual mic and gives the system default back to the real mic.
async function stop() {
  if (!BROWSER_MODE) await require('./modules/linux/engine').stopAll();
  if (server) await new Promise((r) => server.close(() => r()));
  server = null;
}

module.exports = { start, stop, buildRoutes };
