'use strict';
// Finds anything that makes a noise-cancel mic outside this app (an old
// "Mic (clean)" config, EasyEffects, NoiseTorch…) and switches it off, reversibly.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { PATHS } = require('../../core/config');
const { run } = require('../../core/exec');
const { walkFiles, readSafe } = require('../../core/fsutil');
const settings = require('../settings');
const engine = require('./engine');

// ---------------------------------------------------------------- Old / legacy mic filters
// Finds anything that creates a noise-cancel mic outside this dashboard (e.g. the old
// "Mic (clean)") so it can be switched off — reversibly — and the dashboard owns the mic.
const OFF_SUFFIX = '.mic-dashboard-off';
const LEGACY_RE = /filter-chain|rnnoise|noise[_-]?suppress|echo-cancel|ladspa|librnnoise|deepfilter|noisetorch/i;
function namesIn(txt) {
  const n = [...txt.matchAll(/node\.(?:description|name)\s*=\s*"?([^"\n}]+?)"?\s*$/gm)].map((m) => m[1].trim());
  return [...new Set(n)].filter((x) => !/^capture\.|^playback\./.test(x)).slice(0, 6);
}

let legacyCache = [];
async function scanLegacy() {
  const home = os.homedir();
  const items = [];
  // 1) PipeWire / WirePlumber config fragments (active *.conf and ones we switched off)
  const confRoots = [path.join(home, '.config/pipewire'), path.join(home, '.config/wireplumber'), '/etc/pipewire', '/etc/wireplumber'];
  for (const root of confRoots) {
    for (const p of walkFiles(root, (n) => /\.(conf|lua)$/.test(n) || n.endsWith(OFF_SUFFIX))) {
      if (p === PATHS.chainConf || p.startsWith(PATHS.stateDir)) continue;
      const txt = readSafe(p);
      if (!LEGACY_RE.test(txt)) continue;
      const off = p.endsWith(OFF_SUFFIX);
      const inHome = p.startsWith(home);
      items.push({
        id: 'cfg:' + p, type: 'config', path: off ? p.slice(0, -OFF_SUFFIX.length) : p, enabled: !off,
        names: namesIn(txt), canChange: inHome,
        manual: inHome ? '' : `sudo mv ${p} ${p}${OFF_SUFFIX} && systemctl --user restart pipewire pipewire-pulse wireplumber`,
      });
    }
  }
  // 2) systemd --user services that start a filter / noise app
  for (const p of walkFiles(path.join(home, '.config/systemd/user'), (n) => n.endsWith('.service'))) {
    const txt = readSafe(p);
    if (!(LEGACY_RE.test(txt) || /pipewire\s+-c|easyeffects|pactl\s+load-module/i.test(txt))) continue;
    const unit = path.basename(p);
    const en = (await run('systemctl', ['--user', 'is-enabled', unit])).out.trim();
    const act = (await run('systemctl', ['--user', 'is-active', unit])).out.trim();
    items.push({ id: 'svc:' + unit, type: 'service', path: p, unit, enabled: en === 'enabled' || act === 'active', state: `${en} / ${act}`, names: namesIn(txt), canChange: true });
  }
  // 3) Autostart entries (e.g. EasyEffects, NoiseTorch, scripts running pactl load-module)
  for (const p of walkFiles(path.join(home, '.config/autostart'), (n) => n.endsWith('.desktop') || n.endsWith(OFF_SUFFIX), 1)) {
    const txt = readSafe(p);
    if (!(LEGACY_RE.test(txt) || /easyeffects|pactl\s+load-module|pipewire\s+-c/i.test(txt))) continue;
    const off = p.endsWith(OFF_SUFFIX);
    const name = (txt.match(/^Name=(.*)$/m) || [])[1] || path.basename(p);
    items.push({ id: 'auto:' + p, type: 'autostart', path: off ? p.slice(0, -OFF_SUFFIX.length) : p, enabled: !off, names: [name], canChange: true });
  }
  // 4) Loaded pulse modules (echo-cancel / ladspa / remap…) not created by us — unload now
  const mods = await run('pactl', ['list', 'modules', 'short']);
  for (const l of mods.out.split('\n').filter(Boolean)) {
    const [idx, name, ...a] = l.split('\t');
    if (!/echo-cancel|ladspa|remap-source|virtual-source/.test(name)) continue;
    if (Number(idx) === engine.state.echoModuleIndex) continue;
    items.push({ id: 'mod:' + idx, type: 'module', index: Number(idx), enabled: true, names: [name], detail: a.join(' '), canChange: true });
  }
  // 5) Running processes that host a filter (pipewire -c <file>, easyeffects, noisetorch)
  const ps = await run('ps', ['-u', String(os.userInfo().uid), '-o', 'pid=,args=']);
  for (const l of ps.out.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m) continue;
    const pid = Number(m[1]), args = m[2];
    if (engine.state.chainPid && pid === engine.state.chainPid) continue;
    if (pid === process.pid) continue;
    if (!(/(^|\/)pipewire\s+-c\s+\S+/.test(args) || /(^|\/)(easyeffects|noisetorch)(\s|$)/.test(args))) continue;
    if (args.includes(PATHS.chainConf)) continue;
    items.push({ id: 'proc:' + pid, type: 'process', pid, enabled: true, names: [args.slice(0, 160)], canChange: true });
  }
  legacyCache = items;
  return items;
}

async function restartPipeWire() {
  const wasRunning = engine.state.running;
  if (engine.state.chainPid) await engine.stopChain();
  engine.forgetWebrtc(); // modules vanish with pipewire-pulse restart
  const r = await run('systemctl', ['--user', 'restart', 'pipewire', 'pipewire-pulse', 'wireplumber'], { timeout: 15000 });
  await new Promise((res) => setTimeout(res, 2000));
  if (wasRunning) { // bring the dashboard's mic back up
    const st = await require('./status').getStatus();
    if (settings.engine === 'pipewire') await engine.startPipewireChain(); else await engine.startWebrtc(st.server?.isPipeWire);
  }
  return r;
}

async function setLegacy(id, enable) {
  if (!legacyCache.length) await scanLegacy();
  const it = legacyCache.find((x) => x.id === id);
  if (!it) throw new Error('العنصر ده مش موجود — اعمل تحديث وجرب تاني');
  if (!it.canChange) throw new Error('الملف ده في /etc ومحتاج sudo — انسخ الأمر اللي ظاهر ونفّذه في التيرمنال');
  let needRestart = false;
  if (it.type === 'config' || it.type === 'autostart') {
    const from = enable ? it.path + OFF_SUFFIX : it.path, to = enable ? it.path : it.path + OFF_SUFFIX;
    if (!fs.existsSync(from)) throw new Error('الملف مش موجود: ' + from);
    if (fs.existsSync(to)) throw new Error('فيه ملف بنفس الاسم أصلًا: ' + to);
    fs.renameSync(from, to);
    needRestart = it.type === 'config';
  } else if (it.type === 'service') {
    const r = await run('systemctl', ['--user', enable ? 'enable' : 'disable', '--now', it.unit], { timeout: 15000 });
    if (!r.ok) throw new Error(r.err);
  } else if (it.type === 'module') {
    if (enable) throw new Error('الموديول ده اتشال — هيرجع لوحده مع أول restart لو كان متسجل في ملف');
    const r = await run('pactl', ['unload-module', String(it.index)]);
    if (!r.ok) throw new Error(r.err);
  } else if (it.type === 'process') {
    if (enable) throw new Error('البرنامج ده اتقفل — شغّله تاني بنفسك لو محتاجه');
    try { process.kill(it.pid, 'SIGTERM'); } catch (e) { throw new Error(e.message); }
  }
  if (needRestart) await restartPipeWire();
  await new Promise((r) => setTimeout(r, 500));
  return { ok: true, restarted: needRestart, items: await scanLegacy() };
}

async function disableAll() {
  await scanLegacy();
  const errors = [];
  const targets = legacyCache.filter((x) => x.enabled && x.canChange);
  // file/service changes first, one pipewire restart at the end
  let restart = false;
  for (const it of targets) {
    try {
      if (it.type === 'config') { fs.renameSync(it.path, it.path + OFF_SUFFIX); restart = true; }
      else await setLegacy(it.id, false);
    } catch (e) { errors.push(`${it.names[0] || it.id}: ${e.message}`); }
  }
  if (restart) await restartPipeWire();
  return { ok: true, errors, items: await scanLegacy() };
}

module.exports = { scanLegacy, setLegacy, disableAll, restartPipeWire };
