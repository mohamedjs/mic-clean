'use strict';
// HTTP routes for Linux (PulseAudio / PipeWire).
const fs = require('fs');
const { APP, PATHS } = require('../../core/config');
const { run } = require('../../core/exec');
const { validName } = require('../../core/http');
const settings = require('../settings');
const { getStatus } = require('./status');
const { getGraph } = require('./graph');
const { findFilterConfigs } = require('./configs');
const engine = require('./engine');
const plugins = require('./plugins');
const legacy = require('./legacy');

let restartTimer = null;

const routes = {
  'GET /api/status': async () => getStatus(),

  'GET /api/graph': async () => getGraph(),
  'GET /api/configs': async () => ({ ok: true, files: findFilterConfigs(), services: (await run('sh', ['-c', 'systemctl --user list-units --type=service --no-pager 2>/dev/null | grep -iE "pipewire|wireplumber|pulse|easyeffects|filter|rnnoise|noise|clean"'])).out }),
  'POST /api/filter/set': async ({ id, key, value }) => {
    if (!Number.isInteger(id) || typeof key !== 'string' || !/^[\w .:()%\-/]+$/.test(key)) throw new Error('اسم الإعداد غلط');
    const v = typeof value === 'boolean' ? String(value) : Number(value);
    if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('القيمة غلط');
    const r = await run('pw-cli', ['set-param', String(id), 'Props', `{ params = [ ${JSON.stringify(key)} ${v} ] }`]);
    if (!r.ok) throw new Error(r.err || 'أمر pw-cli فشل');
    return { ok: true };
  },

  'GET /api/raw': async () => {
    const cmds = [['pactl', ['info']], ['pactl', ['list', 'sources']], ['pactl', ['list', 'modules', 'short']], ['wpctl', ['status']], ['sh', ['-c', 'arecord -l 2>&1; echo; cat /proc/asound/cards 2>&1']], ['sh', ['-c', 'systemctl --user is-active pipewire pipewire-pulse wireplumber pulseaudio easyeffects 2>&1']]];
    const out = {};
    for (const [c, a] of cmds) { const r = await run(c, a); out[`${c} ${a.join(' ')}`] = (r.out || r.err).slice(0, 60000); }
    if (fs.existsSync(PATHS.chainConf)) out['mic-clean-chain.conf'] = fs.readFileSync(PATHS.chainConf, 'utf8');
    return out;
  },

  'POST /api/source/volume': async ({ name, percent }) => {
    if (!validName(name)) throw new Error('اسم المصدر غلط');
    const p = Math.max(0, Math.min(200, Math.round(Number(percent))));
    const r = await run('pactl', ['set-source-volume', name, `${p}%`]);
    if (!r.ok) throw new Error(r.err);
    return { ok: true };
  },
  'POST /api/source/mute': async ({ name, mute }) => {
    if (!validName(name)) throw new Error('اسم المصدر غلط');
    const r = await run('pactl', ['set-source-mute', name, mute ? '1' : '0']);
    if (!r.ok) throw new Error(r.err);
    return { ok: true };
  },
  'POST /api/source/default': async ({ name }) => {
    if (!validName(name)) throw new Error('اسم المصدر غلط');
    const r = await run('pactl', ['set-default-source', name]);
    if (!r.ok) throw new Error(r.err);
    return { ok: true };
  },

  'POST /api/clean/start': async (body) => {
    plugins.comp.broken = false;
    if (body.settings) Object.assign(settings, body.settings);
    if (settings.master && !validName(settings.master)) throw new Error('اسم المايك المصدر غلط');
    if (settings.master === APP.node) settings.master = '';
    settings.save();
    const st = await getStatus();
    await engine.stopAll();
    const ok = settings.engine === 'pipewire' ? await engine.startPipewireChain() : await engine.startWebrtc(st.server.isPipeWire);
    return { ok, error: engine.state.lastError };
  },
  'POST /api/clean/update': async (body) => {
    const before = JSON.stringify({ r: settings.rnnoise, r2: settings.rnnoise2, c: settings.comp, l: settings.limiter, hp: Number(settings.highpass) > 0, m: settings.master, e: settings.engine, w: settings.webrtc });
    if (body.settings) Object.assign(settings, body.settings);
    settings.save();
    const after = JSON.stringify({ r: settings.rnnoise, r2: settings.rnnoise2, c: settings.comp, l: settings.limiter, hp: Number(settings.highpass) > 0, m: settings.master, e: settings.engine, w: settings.webrtc });
    if (!engine.state.running) return { ok: true, applied: 'saved' };
    if (engine.state.chainPid && before === after && (await engine.livePipewireUpdate())) return { ok: true, applied: 'live' };
    // Graph changed or live update unsupported -> debounced restart.
    clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
      const st = await getStatus();
      if (settings.engine === 'pipewire') { await engine.stopWebrtc(); await engine.startPipewireChain(); }
      else { await engine.stopChain(); await engine.startWebrtc(st.server.isPipeWire); }
    }, 350);
    return { ok: true, applied: 'restart' };
  },
  'POST /api/clean/stop': async () => { await engine.stopAll(); engine.state.lastError = ''; return { ok: true }; },
  'GET /api/legacy': async () => ({ ok: true, items: await legacy.scanLegacy(), autoStart: !!settings.autoStart }),
  'POST /api/legacy/disable': async ({ id }) => legacy.setLegacy(String(id), false),
  'POST /api/legacy/enable': async ({ id }) => legacy.setLegacy(String(id), true),
  'POST /api/legacy/disable-all': async () => legacy.disableAll(),
  'POST /api/comp/install': async () => plugins.installComp(),
  'POST /api/rnnoise/install': async () => plugins.installRnnoise(),
  'POST /api/clean/autostart': async ({ on }) => { settings.autoStart = !!on; settings.save(); return { ok: true, autoStart: settings.autoStart }; },
  'POST /api/clean/reset': async () => ({ ok: true, settings: settings.reset() }),
};

module.exports = routes;
