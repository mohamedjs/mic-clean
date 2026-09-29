#!/usr/bin/env node
// Mic (Mohamed) Dashboard — local server (no npm deps).
// Talks to PulseAudio / PipeWire via pactl, pw-cli, pw-dump and runs a
// "Mic (Mohamed)" virtual microphone (RNNoise + EQ via PipeWire filter-chain,
// or WebRTC noise suppression via module-echo-cancel).
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile, spawn } = require('child_process');

const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC = path.join(__dirname, 'public');
const STATE_DIR = path.join(os.homedir(), '.config', 'mic-clean-dashboard');
const STATE_FILE = path.join(STATE_DIR, 'settings.json');
const CONF_FILE = path.join(STATE_DIR, 'mic-clean-chain.conf');
const CLEAN_NODE = 'mic_mohamed';          // source name we create
const CLEAN_DESC = 'Mic (Mohamed)';        // name you see in Ubuntu / Zoom / OBS
const CLEAN_CAPTURE = 'capture.mic_mohamed'; // filter-chain input node

// ---------------------------------------------------------------- helpers
function run(cmd, args, { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
    });
  });
}
async function has(cmd) { return (await run('sh', ['-c', `command -v ${cmd}`])).ok; }

const EQ_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
// Default = "Podcast" profile: double RNNoise (stage 1 gates, stage 2 polishes),
// rumble cut, warm + present voice EQ, gentle compressor, a little make-up gain.
const PODCAST_EQ = [-6, -3, 1.5, -2, -1.5, 0, 1.5, 2.5, -1, 0];
const SETTINGS_VERSION = 2;
const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  profile: 'podcast',
  engine: 'pipewire',          // 'pipewire' (RNNoise+EQ) | 'webrtc'
  master: '',                  // source name to clean ('' = current default hw mic)
  makeDefault: true,           // set Mic (Mohamed) as default input when started
  autoStart: false,
  // Stage 1 RNNoise — main cleaner + gate
  rnnoise: true,
  vadThreshold: 55,            // %
  vadGrace: 300,               // ms
  retroGrace: 50,              // ms (recording → a little latency is fine)
  // Stage 2 RNNoise — second pass on the already-clean signal (residual hiss)
  rnnoise2: true,
  vad2Threshold: 20,
  vad2Grace: 400,
  retro2Grace: 0,
  highpass: 90,                // Hz, 0 = off
  eq: EQ_FREQS.map((f, i) => ({ freq: f, gain: PODCAST_EQ[i], q: 1.0 })),
  // Compressor (needs swh-plugins: sc4m_1916) — evens out loud/quiet speech
  comp: true,
  compThreshold: -20,          // dB
  compRatio: 3,                // 1:n
  compAttack: 10,              // ms
  compRelease: 150,            // ms
  compMakeup: 4,               // dB
  outputGainDb: 0,
  // Limiter — last stage, hard ceiling so boosting a quiet mic never clips
  limiter: true,
  limiterCeiling: -2,          // dBFS
  webrtc: { noiseSuppression: true, gainControl: false, highPass: true },
};
function loadSettings() {
  try {
    const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    // One-time move to the new podcast defaults (keep which mic you picked)
    if ((saved.settingsVersion || 1) < SETTINGS_VERSION) return { ...structuredClone(DEFAULT_SETTINGS), master: saved.master || '', autoStart: !!saved.autoStart };
    return { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}
function saveSettings(s) {
  try { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); } catch {}
}
let settings = loadSettings();

// ---------------------------------------------------------------- pactl parsing
// Parses `pactl list <things>` (human format, works on PulseAudio 15 and PipeWire).
function parsePactlList(text, header) {
  const items = [];
  let cur = null, inProps = false, inPorts = false, lastKey = null;
  for (const raw of text.split('\n')) {
    const m = raw.match(new RegExp(`^${header} #(\\d+)`));
    if (m) { cur = { index: Number(m[1]), props: {}, ports: [] }; items.push(cur); inProps = inPorts = false; continue; }
    if (!cur || !raw.trim()) continue;
    const indent = raw.match(/^\t*/)[0].length;
    const line = raw.trim();
    if (indent === 1) {
      inProps = line === 'Properties:';
      inPorts = line === 'Ports:';
      if (inProps || inPorts) continue;
      const kv = line.match(/^([^:]+):\s?(.*)$/);
      if (kv) { lastKey = kv[1]; cur[kv[1]] = kv[2]; }
    } else if (indent >= 2 && inProps) {
      const pv = line.match(/^([^=]+?)\s*=\s*"(.*)"$/);
      if (pv) cur.props[pv[1]] = pv[2];
    } else if (indent === 2 && inPorts) {
      cur.ports.push(line);
    } else if (indent >= 2 && lastKey) {
      cur[lastKey] += ' ' + line; // continuation (e.g. multi-line volume)
    }
  }
  return items;
}
function pctFromVolume(v = '') {
  const all = [...v.matchAll(/(\d+)%/g)].map((x) => Number(x[1]));
  return all.length ? Math.round(all.reduce((a, b) => a + b, 0) / all.length) : null;
}
function dbFromVolume(v = '') {
  const m = v.match(/(-?[\d.]+|-inf) dB/);
  return m ? m[1] : null;
}

// Decide where a source's audio actually comes from.
function classifySource(s, modulesByIndex) {
  const p = s.props;
  const name = s.Name || '';
  const driver = s.Driver || '';
  const ownerMod = modulesByIndex[Number(s['Owner Module'])];
  const nodeName = p['node.name'] || '';
  const factory = p['factory.name'] || '';
  const mediaName = p['media.name'] || '';
  const res = { kind: 'unknown', label: 'غير معروف', detail: '', master: null };

  if (name.endsWith('.monitor') || p['device.class'] === 'monitor') {
    return { kind: 'monitor', label: 'مراقبة الخرج (مش مايك)', detail: 'بيسجل الصوت اللي طالع من السماعات/الهيدفون — ده مش مايك، متختاروش كمدخل للكلام.', master: null };
  }
  if (name === CLEAN_NODE) return { kind: 'filter', label: 'Mic (Mohamed) (من الداشبورد دي)', detail: 'مايك وهمي عاملته الداشبورد دي — بيتشال لما تقفل السيرفر.', master: settings.master || null };
  if (/easyeffects/i.test(name + nodeName + (p['application.name'] || ''))) {
    return { kind: 'filter', label: 'EasyEffects', detail: 'الصوت بيتعالج جوه برنامج EasyEffects (عزل الضوضاء والـ EQ بتوعه) — ظبطه من البرنامج نفسه.', master: null };
  }
  if (ownerMod && /echo-cancel/.test(ownerMod.name)) {
    const a = ownerMod.args || '';
    return { kind: 'filter', label: 'فلتر WebRTC (إلغاء صدى/ضوضاء)', detail: `module-echo-cancel ${a}`.trim(), master: (a.match(/source_master=(\S+)/) || [])[1] || null };
  }
  if (ownerMod && /ladspa|rnnoise|filter-chain|remap|virtual/.test(ownerMod.name)) {
    const a = ownerMod.args || '';
    return { kind: 'filter', label: ownerMod.name, detail: a, master: (a.match(/(?:source_)?master=(\S+)/) || [])[1] || null };
  }
  if (/filter-chain|rnnoise|noise|echo.?cancel|denoise|clean/i.test(nodeName + ' ' + mediaName + ' ' + (s.Description || '') + ' ' + factory)) {
    return { kind: 'filter', label: 'فلتر PipeWire', detail: `node.name=${nodeName}${mediaName ? ' · ' + mediaName : ''}`, master: p['target.object'] || p['node.target'] || null };
  }
  if (p['device.api'] === 'alsa' || /alsa/.test(driver) || p['alsa.card']) {
    const bus = p['device.bus'] || (p['api.alsa.path'] || '').split(':')[0] || '';
    const product = p['device.product.name'] || p['alsa.card_name'] || p['alsa.long_card_name'] || '';
    const ff = p['device.form_factor'] || '';
    const port = s['Active Port'] || '';
    const where = /usb/i.test(bus) ? 'مايك USB' : /bluetooth/i.test(bus) ? 'بلوتوث' : 'مدمج / كارت صوت';
    return { kind: 'hardware', label: `هاردوير · ${where}`, detail: [product, ff, port && `المنفذ: ${port}`, p['alsa.card'] !== undefined && `كارت ALSA رقم ${p['alsa.card']}`].filter(Boolean).join(' · '), master: null };
  }
  if (p['device.api'] === 'bluez5' || /bluez/.test(driver)) {
    return { kind: 'hardware', label: 'هاردوير · سماعة بلوتوث', detail: p['device.description'] || '', master: null };
  }
  if (/null|virtual/i.test(driver + ' ' + factory + ' ' + (p['media.class'] || ''))) {
    return { kind: 'virtual', label: 'مصدر وهمي', detail: `${driver} ${factory}`.trim(), master: null };
  }
  res.detail = driver;
  return res;
}

async function getStatus() {
  const [info, srcs, mods, outs] = await Promise.all([
    run('pactl', ['info']),
    run('pactl', ['list', 'sources']),
    run('pactl', ['list', 'modules', 'short']),
    run('pactl', ['list', 'source-outputs']),
  ]);
  if (!info.ok) {
    return { ok: false, error: 'أمر pactl مش موجود أو مفيش sound server شغال. نزّله بـ: sudo apt install pulseaudio-utils', raw: info.err };
  }
  const infoMap = Object.fromEntries(info.out.split('\n').map((l) => l.match(/^([^:]+):\s*(.*)$/)).filter(Boolean).map((m) => [m[1], m[2]]));
  const serverName = infoMap['Server Name'] || '';
  const isPipeWire = /pipewire/i.test(serverName);

  const modules = mods.out.split('\n').filter(Boolean).map((l) => { const [i, name, ...a] = l.split('\t'); return { index: Number(i), name, args: a.join('\t') }; });
  const modulesByIndex = Object.fromEntries(modules.map((m) => [m.index, m]));

  const recorders = parsePactlList(outs.out, 'Source Output').map((o) => ({
    source: Number(o.Source),
    app: o.props['node.link-group'] ? `الفلتر «${o.props['node.description'] || o.props['node.name'] || 'filter'}»`
      : (o.props['application.name'] || o.props['application.process.binary'] || o.props['node.description'] || o.props['media.name'] || o.props['node.name'] || 'برنامج مش معروف'),
    binary: o.props['application.process.binary'] || '',
  }));

  const sources = parsePactlList(srcs.out, 'Source').map((s) => {
    const origin = classifySource(s, modulesByIndex);
    return {
      index: s.index,
      name: s.Name,
      description: s.Description,
      state: s.State,
      mute: /yes/i.test(s.Mute || ''),
      volumePercent: pctFromVolume(s.Volume),
      volumeDb: dbFromVolume(s.Volume),
      baseVolume: s['Base Volume'] || '',
      sampleSpec: s['Sample Specification'] || '',
      activePort: s['Active Port'] || '',
      driver: s.Driver || '',
      isDefault: s.Name === infoMap['Default Source'],
      origin,
      recordedBy: recorders.filter((r) => r.source === s.index),
      props: s.props,
    };
  });

  const relevantModules = modules.filter((m) => /echo-cancel|ladspa|filter|remap|loopback|null|rnnoise|virtual|combine/.test(m.name));

  return {
    ok: true,
    platform: 'linux',
    server: { name: serverName, version: infoMap['Server Version'] || '', isPipeWire, defaultSource: infoMap['Default Source'], defaultSink: infoMap['Default Sink'], sampleSpec: infoMap['Default Sample Specification'] },
    sources,
    modules: relevantModules,
    clean: await cleanStatus(isPipeWire),
    settings,
    eqFreqs: EQ_FREQS,
  };
}

// ---------------------------------------------------------------- RNNoise / filter-chain
const RNNOISE_CANDIDATES = [
  path.join(os.homedir(), '.ladspa/librnnoise_ladspa.so'),
  path.join(os.homedir(), '.local/lib/ladspa/librnnoise_ladspa.so'),
  '/usr/lib/ladspa/librnnoise_ladspa.so',
  '/usr/lib/x86_64-linux-gnu/ladspa/librnnoise_ladspa.so',
  '/usr/lib64/ladspa/librnnoise_ladspa.so',
  '/usr/local/lib/ladspa/librnnoise_ladspa.so',
];
function ladspaDirs() {
  const home = os.homedir();
  const env = (process.env.LADSPA_PATH || '').split(':').filter(Boolean);
  return [...new Set([...env, path.join(home, '.ladspa'), path.join(home, '.local/lib/ladspa'), '/usr/lib/ladspa', '/usr/lib/x86_64-linux-gnu/ladspa', '/usr/lib64/ladspa', '/usr/local/lib/ladspa', '/usr/local/lib64/ladspa', '/opt/ladspa'])];
}
function scanLadspa(re) {
  for (const d of ladspaDirs()) {
    let ents; try { ents = fs.readdirSync(d); } catch { continue; }
    const f = ents.find((n) => re.test(n));
    if (f) return path.join(d, f);
  }
  return null;
}
function findRnnoise() {
  if (process.env.RNNOISE_LADSPA && fs.existsSync(process.env.RNNOISE_LADSPA)) return process.env.RNNOISE_LADSPA;
  const hit = RNNOISE_CANDIDATES.find((p) => fs.existsSync(p)) || scanLadspa(/^librnnoise.*ladspa.*\.so$|^librnnoise_ladspa\.so$/i);
  if (hit) return hit;
  // plugin path referenced by an old config that reset-audio.sh moved to ~/audio-backup-*
  try {
    for (const d of fs.readdirSync(os.homedir()).filter((n) => n.startsWith('audio-backup-'))) {
      for (const f of walkFiles(path.join(os.homedir(), d), (n) => /\.conf|\.mic-dashboard-off$/.test(n))) {
        const m = readSafe(f).match(/plugin\s*=\s*"?([^"\s}]*rnnoise[^"\s}]*\.so)/i);
        const pth = m && m[1].replace(/^~/, os.homedir());
        if (pth && fs.existsSync(pth)) return pth;
      }
    }
  } catch {}
  // Reuse the plugin path from an existing config (e.g. the one behind "Mic (clean)")
  const offFiles = [path.join(os.homedir(), '.config/pipewire'), path.join(os.homedir(), '.config/wireplumber')]
    .flatMap((d) => walkFiles(d, (n) => n.endsWith('.mic-dashboard-off'))).map((p) => ({ path: p, content: readSafe(p) }));
  for (const f of [...findFilterConfigs(), ...offFiles]) {
    const m = f.content.match(/plugin\s*=\s*"?([^"\s}]*rnnoise[^"\s}]*\.so)/i);
    if (m && fs.existsSync(m[1].replace(/^~/, os.homedir()))) return m[1].replace(/^~/, os.homedir());
  }
  return null;
}

const COMP_CANDIDATES = ['/usr/lib/ladspa/sc4m_1916.so', '/usr/lib/x86_64-linux-gnu/ladspa/sc4m_1916.so', '/usr/lib64/ladspa/sc4m_1916.so', '/usr/local/lib/ladspa/sc4m_1916.so', path.join(os.homedir(), '.ladspa/sc4m_1916.so')];
const findComp = () => COMP_CANDIDATES.find((p) => fs.existsSync(p)) || scanLadspa(/^sc4m_1916\.so$/) || null;
let compBroken = false; // set if the chain failed to start with the compressor

let chainProc = null;      // pipewire -c child
let chainLog = [];
let echoModuleIndex = null; // module-echo-cancel we loaded
let lastError = '';

async function cleanStatus(isPipeWire) {
  const rnnoisePath = findRnnoise();
  return {
    running: !!chainProc || echoModuleIndex !== null,
    engine: chainProc ? 'pipewire' : echoModuleIndex !== null ? 'webrtc' : null,
    pid: chainProc ? chainProc.pid : null,
    echoModuleIndex,
    capabilities: {
      pipewire: isPipeWire && (await has('pipewire')),
      pwCli: await has('pw-cli'),
      rnnoisePath,
      compPath: compBroken ? null : findComp(),
      compFound: findComp(),
      compStatus: !findComp() ? 'missing' : compBroken ? 'failed' : 'ok',
      ladspaDirs: ladspaDirs().filter((d) => fs.existsSync(d)),
      webrtc: true,
    },
    lastError,
    log: chainLog.slice(-15),
  };
}

const q = (s) => JSON.stringify(String(s)); // SPA-JSON string quoting
function buildChainConf(s, rnnoisePath) {
  const nodes = [];
  const order = [];
  // High-pass first: removes rumble before RNNoise so it can focus on real noise
  if (Number(s.highpass) > 0) {
    nodes.push(`{ type = builtin name = hp label = bq_highpass control = { "Freq" = ${Number(s.highpass)} "Q" = 0.707 } }`);
    order.push(['hp', 'In', 'Out']);
  }
  if (s.rnnoise && rnnoisePath) {
    nodes.push(`{ type = ladspa name = rnnoise plugin = ${q(rnnoisePath)} label = noise_suppressor_mono
          control = { "VAD Threshold (%)" = ${Number(s.vadThreshold)} "VAD Grace Period (ms)" = ${Number(s.vadGrace)} "Retroactive VAD Grace (ms)" = ${Number(s.retroGrace)} } }`);
    order.push(['rnnoise', 'Input', 'Output']);
  }
  if (s.rnnoise && s.rnnoise2 && rnnoisePath) {
    nodes.push(`{ type = ladspa name = rnnoise2 plugin = ${q(rnnoisePath)} label = noise_suppressor_mono
          control = { "VAD Threshold (%)" = ${Number(s.vad2Threshold)} "VAD Grace Period (ms)" = ${Number(s.vad2Grace)} "Retroactive VAD Grace (ms)" = ${Number(s.retro2Grace)} } }`);
    order.push(['rnnoise2', 'Input', 'Output']);
  }
  s.eq.forEach((b, i) => {
    nodes.push(`{ type = builtin name = eq${i} label = bq_peaking control = { "Freq" = ${Number(b.freq)} "Q" = ${Number(b.q) || 1} "Gain" = ${Number(b.gain)} } }`);
    order.push([`eq${i}`, 'In', 'Out']);
  });
  const compLib = !compBroken ? findComp() : null;
  const compPath = s.comp ? compLib : null;
  if (compPath) {
    nodes.push(`{ type = ladspa name = comp plugin = ${q(compPath)} label = sc4m
          control = { "RMS/peak" = 0.5 "Attack time (ms)" = ${Number(s.compAttack)} "Release time (ms)" = ${Number(s.compRelease)} "Threshold level (dB)" = ${Number(s.compThreshold)} "Ratio (1:n)" = ${Number(s.compRatio)} "Knee radius (dB)" = 6 "Makeup gain (dB)" = ${Number(s.compMakeup)} } }`);
    order.push(['comp', 'Input', 'Output']);
  }
  nodes.push(`{ type = builtin name = gain label = mixer control = { "Gain 1" = ${Math.pow(10, Number(s.outputGainDb) / 20).toFixed(4)} } }`);
  order.push(['gain', 'In 1', 'Out']);
  if (s.limiter && compLib) { // same sc4m plugin, set up as a fast brick-wall-ish limiter
    nodes.push(`{ type = ladspa name = limiter plugin = ${q(compPath)} label = sc4m
          control = { "RMS/peak" = 1.0 "Attack time (ms)" = 1.5 "Release time (ms)" = 60 "Threshold level (dB)" = ${Number(s.limiterCeiling)} "Ratio (1:n)" = 20 "Knee radius (dB)" = 1 "Makeup gain (dB)" = 0 } }`);
    order.push(['limiter', 'Input', 'Output']);
  }
  const last = order[order.length - 1];
  const links = [];
  for (let i = 0; i < order.length - 1; i++) links.push(`{ output = "${order[i][0]}:${order[i][2]}" input = "${order[i + 1][0]}:${order[i + 1][1]}" }`);
  const target = s.master ? `node.target = ${q(s.master)} target.object = ${q(s.master)}` : '';

  return `# Generated by Mic (Mohamed) Dashboard — ${new Date().toISOString()}
context.properties = { log.level = 0 }
context.spa-libs = {
  audio.convert.* = audioconvert/libspa-audioconvert
  support.*       = support/libspa-support
}
context.modules = [
  { name = libpipewire-module-rt args = { nice.level = -11 } flags = [ ifexists nofail ] }
  { name = libpipewire-module-protocol-native }
  { name = libpipewire-module-client-node }
  { name = libpipewire-module-adapter }
  { name = libpipewire-module-filter-chain
    args = {
      node.description = "${CLEAN_DESC}"
      media.name       = "${CLEAN_DESC}"
      filter.graph = {
        nodes = [
          ${nodes.join('\n          ')}
        ]
        links = [
          ${links.join('\n          ')}
        ]
        inputs  = [ "${order[0][0]}:${order[0][1]}" ]
        outputs = [ "${last[0]}:${last[2]}" ]
      }
      audio.rate = 48000
      audio.channels = 1
      audio.position = [ MONO ]
      capture.props = {
        node.name = "${CLEAN_CAPTURE}"
        node.passive = true
        stream.dont-remix = true
        ${target}
      }
      playback.props = {
        node.name = "${CLEAN_NODE}"
        node.description = "${CLEAN_DESC}"
        media.class = Audio/Source
      }
    }
  }
]
`;
}

function stopChain() {
  return new Promise((resolve) => {
    if (!chainProc) return resolve();
    const p = chainProc; chainProc = null;
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch {} resolve(); }, 1500);
    p.once('exit', () => { clearTimeout(t); resolve(); });
    try { p.kill('SIGTERM'); } catch { clearTimeout(t); resolve(); }
  });
}

async function waitForSource(name, ms = 4000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await run('pactl', ['list', 'sources', 'short']);
    if (r.out.split('\n').some((l) => l.split('\t')[1] === name)) return true;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return false;
}

async function startPipewireChain() {
  const rnnoisePath = findRnnoise();
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(CONF_FILE, buildChainConf(settings, rnnoisePath));
  await stopChain();
  chainLog = [];
  const proc = spawn('pipewire', ['-c', CONF_FILE], { stdio: ['ignore', 'pipe', 'pipe'] });
  chainProc = proc;
  const onData = (d) => { chainLog.push(...String(d).split('\n').filter(Boolean)); chainLog = chainLog.slice(-200); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('exit', (code) => { if (chainProc === proc) { chainProc = null; lastError = `الفلتر وقف فجأة (كود ${code}) — بص على السجل تحت.`; } });
  const ok = await waitForSource(CLEAN_NODE);
  if (!ok) {
    if (settings.comp && findComp() && !compBroken) { // retry once without the compressor
      compBroken = true;
      const r2 = await startPipewireChain();
      if (r2) lastError = 'الضاغط (Compressor) مشتغلش مع نسخة الـ PipeWire دي — اشتغل من غيره.';
      return r2;
    }
    lastError = 'المايك الوهمي Mic (Mohamed) مظهرش — بص على السجل تحت.'; return false;
  }
  if (compBroken) return true;
  lastError = settings.rnnoise && !rnnoisePath ? 'ملف RNNoise مش موجود — شغال EQ بس من غير عزل ضوضاء. نزّل noise-suppression-for-voice (شوف README).' : '';
  if (settings.makeDefault) await run('pactl', ['set-default-source', CLEAN_NODE]);
  return true;
}

// Live update without restarting (works for control values only).
async function livePipewireUpdate() {
  if (!chainProc || !(await has('pw-cli'))) return false;
  // Find the filter's capture node id via pactl (no pw-dump needed)
  const outs = await run('pactl', ['list', 'source-outputs']);
  const cap = parsePactlList(outs.out, 'Source Output').find((o) => o.props['node.name'] === CLEAN_CAPTURE);
  const id = cap?.props['object.id'];
  if (id === undefined) return false;
  const s = settings;
  const params = [];
  if (s.rnnoise && findRnnoise()) params.push(`"rnnoise:VAD Threshold (%)" ${Number(s.vadThreshold)}`, `"rnnoise:VAD Grace Period (ms)" ${Number(s.vadGrace)}`, `"rnnoise:Retroactive VAD Grace (ms)" ${Number(s.retroGrace)}`);
  if (s.rnnoise && s.rnnoise2 && findRnnoise()) params.push(`"rnnoise2:VAD Threshold (%)" ${Number(s.vad2Threshold)}`, `"rnnoise2:VAD Grace Period (ms)" ${Number(s.vad2Grace)}`, `"rnnoise2:Retroactive VAD Grace (ms)" ${Number(s.retro2Grace)}`);
  if (s.comp && !compBroken && findComp()) params.push(`"comp:Attack time (ms)" ${Number(s.compAttack)}`, `"comp:Release time (ms)" ${Number(s.compRelease)}`, `"comp:Threshold level (dB)" ${Number(s.compThreshold)}`, `"comp:Ratio (1:n)" ${Number(s.compRatio)}`, `"comp:Makeup gain (dB)" ${Number(s.compMakeup)}`);
  if (Number(s.highpass) > 0) params.push(`"hp:Freq" ${Number(s.highpass)}`);
  s.eq.forEach((b, i) => params.push(`"eq${i}:Freq" ${Number(b.freq)}`, `"eq${i}:Q" ${Number(b.q) || 1}`, `"eq${i}:Gain" ${Number(b.gain)}`));
  params.push(`"gain:Gain 1" ${Math.pow(10, Number(s.outputGainDb) / 20).toFixed(4)}`);
  if (s.limiter && !compBroken && findComp()) params.push(`"limiter:Threshold level (dB)" ${Number(s.limiterCeiling)}`);
  const r = await run('pw-cli', ['set-param', String(id), 'Props', `{ params = [ ${params.join(' ')} ] }`]);
  if (process.env.MIC_DEBUG) console.log('[live]', id, params.join(' '), '→', r.code, r.err.trim());
  return r.ok && !/error/i.test(r.out + r.err);
}

async function startWebrtc(isPipeWire) {
  await stopWebrtc();
  const w = settings.webrtc;
  const aecArgs = isPipeWire
    ? `webrtc.noise_suppression=${w.noiseSuppression} webrtc.gain_control=${w.gainControl} webrtc.high_pass_filter=${w.highPass} webrtc.extended_filter=false`
    : `noise_suppression=${w.noiseSuppression ? 1 : 0} analog_gain_control=0 digital_gain_control=${w.gainControl ? 1 : 0} high_pass_filter=${w.highPass ? 1 : 0}`;
  const args = ['load-module', 'module-echo-cancel', 'aec_method=webrtc', `aec_args="${aecArgs}"`,
    `source_name=${CLEAN_NODE}`, 'sink_name=mic_mohamed_echo_ref', `source_properties=device.description="${CLEAN_DESC}"`, 'sink_properties=device.description="Mic (Mohamed) echo reference"'];
  if (settings.master) args.push(`source_master=${settings.master}`);
  const r = await run('pactl', args);
  if (!r.ok) { lastError = `تحميل موديول WebRTC فشل: ${r.err.trim()}`; return false; }
  echoModuleIndex = Number(r.out.trim());
  lastError = '';
  if (settings.makeDefault) { await waitForSource(CLEAN_NODE, 2000); await run('pactl', ['set-default-source', CLEAN_NODE]); }
  return true;
}
async function stopWebrtc() {
  if (echoModuleIndex === null) return;
  await run('pactl', ['unload-module', String(echoModuleIndex)]);
  echoModuleIndex = null;
}

async function restoreDefault() {
  // If Mic (Mohamed) was the default input, fall back to its master (or any hw mic).
  const info = await run('pactl', ['get-default-source']);
  if (info.ok && info.out.trim() !== CLEAN_NODE) return;
  let target = settings.master;
  if (!target) {
    const list = await run('pactl', ['list', 'sources', 'short']);
    const names = list.out.split('\n').map((l) => l.split('\t')[1]).filter((n) => n && n.startsWith('alsa_input'));
    target = names.find((n) => /usb/i.test(n)) || names[0];
  }
  if (target) await run('pactl', ['set-default-source', target]);
}

async function stopAll() {
  await restoreDefault();
  await stopChain();
  await stopWebrtc();
}

// ---------------------------------------------------------------- PipeWire graph (existing filters like "Mic (clean)")
let pwDumpReason = '';
async function pwDump() {
  const r = await run('pw-dump', [], { timeout: 8000 });
  if (!r.ok) {
    pwDumpReason = /ENOENT|not found/i.test(r.err) ? 'pw-dump مش متسطب (sudo apt install pipewire-bin)' : `pw-dump رجّع خطأ: ${r.err.trim().slice(0, 200)}`;
    return null;
  }
  try { return JSON.parse(r.out); } catch (e) { pwDumpReason = `مخرجات pw-dump مش JSON سليم: ${e.message}`; return null; }
}

// Parse `pw-cli enum-params <id> Props` → [{key,value}] from the "params" struct.
function parsePwCliParams(text) {
  const out = [];
  const lines = text.split('\n');
  let inParams = false, pendingKey = null;
  for (const line of lines) {
    if (/Prop: key .*:params\b/.test(line)) { inParams = true; continue; }
    if (inParams && /Prop: key /.test(line)) { inParams = false; }
    if (!inParams) continue;
    const s = line.match(/^\s*String "(.*)"\s*$/);
    if (s && pendingKey === null) { pendingKey = s[1]; continue; }
    const v = line.match(/^\s*(Float|Double|Int|Long|Bool|String) (.*?)\s*$/);
    if (v && pendingKey !== null) {
      const raw = v[2].replace(/^"|"$/g, '');
      const value = v[1] === 'Bool' ? raw === 'true' : v[1] === 'String' ? raw : Number(raw);
      out.push({ key: pendingKey, value });
      pendingKey = null;
    }
  }
  return out;
}
async function pwCliParams(id) {
  const r = await run('pw-cli', ['enum-params', String(id), 'Props'], { timeout: 4000 });
  return r.ok ? parsePwCliParams(r.out) : [];
}

// Fallback graph from pactl only (works without pw-dump) + pw-cli for params.
async function getGraphFallback() {
  const [srcs, outs] = await Promise.all([run('pactl', ['list', 'sources']), run('pactl', ['list', 'source-outputs'])]);
  const sources = parsePactlList(srcs.out, 'Source');
  const streams = parsePactlList(outs.out, 'Source Output');
  const label = (x) => x.props['node.description'] || x.Description || x.props['media.name'] || x.props['node.name'] || x.Name || `#${x.index}`;
  const toStep = (x, isStream) => ({
    id: Number(x.props['object.id'] ?? (isStream ? 100000 + x.index : x.index)),
    name: x.props['node.name'] || x.Name || '',
    label: label(x),
    mediaClass: x.props['media.class'] || (isStream ? 'Stream/Input/Audio' : 'Audio/Source'),
    api: x.props['device.api'] || (x.props['api.alsa.path'] ? 'alsa' : ''),
    product: x.props['device.product.name'] || x.props['api.alsa.card.name'] || '',
    factory: x.props['factory.name'] || '',
  });
  const bySrcIndex = Object.fromEntries(sources.map((s) => [s.index, s]));
  function trace(src, depth = 0, seen = new Set()) {
    if (!src || depth > 6 || seen.has(src.index)) return [];
    seen.add(src.index);
    const steps = [toStep(src, false)];
    const group = src.props['node.link-group'];
    if (group) {
      const cap = streams.find((o) => o.props['node.link-group'] === group);
      if (cap) { steps.push(toStep(cap, true)); steps.push(...trace(bySrcIndex[Number(cap.Source)], depth + 1, seen)); }
    }
    return steps;
  }
  const chains = sources.filter((s) => !(s.Name || '').endsWith('.monitor')).map((s) => ({ id: toStep(s).id, name: s.Name, label: label(s), chain: trace(s) }));

  // Params: filter nodes are the ones sharing a link-group
  const controllable = [];
  if (await has('pw-cli')) {
    const cands = [...streams.filter((o) => o.props['node.link-group']).map((o) => [o, true]), ...sources.filter((s) => s.props['node.link-group']).map((s) => [s, false])];
    const seenGroups = new Set();
    for (const [x, isStream] of cands) {
      const id = x.props['object.id']; if (id === undefined) continue;
      const g = x.props['node.link-group'];
      if (seenGroups.has(g)) continue;
      const params = await pwCliParams(id);
      if (!params.length) continue;
      seenGroups.add(g);
      controllable.push({ id: Number(id), name: x.props['node.name'] || x.Name || '', label: label(x), mediaClass: x.props['media.class'] || '', group: g, params });
    }
  }
  return { ok: true, chains, controllable, note: `وضع بديل (من غير pw-dump): ${pwDumpReason}` };
}
// Flatten Props params (["key", value, "key2", value2]) into [{key,value}]
function propsParams(node) {
  const out = [];
  for (const p of node.info?.params?.Props || []) {
    const arr = p?.params;
    if (Array.isArray(arr)) for (let i = 0; i + 1 < arr.length; i += 2) out.push({ key: String(arr[i]), value: arr[i + 1] });
  }
  return out;
}
// Parameter ranges from PropInfo (when PipeWire exposes them)
function propInfo(node) {
  const map = {};
  for (const p of node.info?.params?.PropInfo || []) {
    if (!p?.name) continue;
    const t = p.type || {};
    const def = typeof t === 'object' ? (t.default ?? t) : t;
    map[p.name] = { min: t.min, max: t.max, default: def, description: p.description };
  }
  return map;
}

async function getGraph() {
  const dump = await pwDump();
  if (!dump) {
    try { return await getGraphFallback(); }
    catch (e) { return { ok: false, error: `مش قادر أقرا شبكة الصوت: ${pwDumpReason || e.message}` }; }
  }
  const nodes = dump.filter((o) => o.type === 'PipeWire:Interface:Node').map((o) => ({ id: o.id, props: o.info?.props || {}, raw: o }));
  const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const links = dump.filter((o) => o.type === 'PipeWire:Interface:Link').map((o) => ({ out: o.info?.['output-node-id'], in: o.info?.['input-node-id'], state: o.info?.state }));
  const label = (n) => n ? (n.props['node.description'] || n.props['node.nick'] || n.props['node.name'] || `#${n.id}`) : '?';
  const upstream = (id) => [...new Set(links.filter((l) => l.in === id).map((l) => l.out))].map((i) => byId[i]).filter(Boolean);

  // Trace a source back to the hardware (through filter-chain link-groups).
  function trace(node, depth = 0, seen = new Set()) {
    if (!node || depth > 8 || seen.has(node.id)) return [];
    seen.add(node.id);
    const step = { id: node.id, name: node.props['node.name'], label: label(node), mediaClass: node.props['media.class'] || '', api: node.props['device.api'] || (node.props['api.alsa.path'] ? 'alsa' : ''), product: node.props['device.product.name'] || node.props['api.alsa.card.name'] || '', factory: node.props['factory.name'] || '' };
    let ups = upstream(node.id);
    const group = node.props['node.link-group'] || node.props['node.group'];
    if (!ups.length && group) {
      const sibs = nodes.filter((n) => n.id !== node.id && (n.props['node.link-group'] === group || n.props['node.group'] === group));
      ups = sibs; // e.g. "Mic (clean)" (playback side) <- its capture side
    }
    return [step, ...ups.slice(0, 1).flatMap((u) => trace(u, depth + 1, seen))];
  }

  const sources = nodes.filter((n) => /^Audio\/Source/.test(n.props['media.class'] || ''));
  const chains = sources.map((s) => ({ id: s.id, name: s.props['node.name'], label: label(s), chain: trace(s) }));

  // Every node that exposes controllable params (filter-chain, rnnoise, eq…)
  const controllable = nodes.map((n) => {
    const params = propsParams(n.raw);
    if (!params.length) return null;
    const info = propInfo(n.raw);
    return { id: n.id, name: n.props['node.name'], label: label(n), mediaClass: n.props['media.class'] || '', group: n.props['node.link-group'] || '', params: params.map((p) => ({ ...p, ...(info[p.key] || {}) })) };
  }).filter(Boolean);

  return { ok: true, chains, controllable };
}

// Find config files that define filters (so you can see where "Mic (clean)" is defined).
function findFilterConfigs() {
  const roots = [path.join(os.homedir(), '.config/pipewire'), path.join(os.homedir(), '.config/wireplumber'), '/etc/pipewire', path.join(os.homedir(), '.config/easyeffects')];
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(conf|json|lua)$/.test(e.name)) {
        try {
          const txt = fs.readFileSync(p, 'utf8');
          if (/filter-chain|rnnoise|noise|echo-cancel|clean|ladspa|lv2/i.test(txt)) found.push({ path: p, content: txt.slice(0, 20000) });
        } catch {}
      }
    }
  };
  roots.forEach((r) => walk(r));
  return found;
}

// ---------------------------------------------------------------- Old / legacy mic filters
// Finds anything that creates a noise-cancel mic outside this dashboard (e.g. the old
// "Mic (clean)") so it can be switched off — reversibly — and the dashboard owns the mic.
const OFF_SUFFIX = '.mic-dashboard-off';
const LEGACY_RE = /filter-chain|rnnoise|noise[_-]?suppress|echo-cancel|ladspa|librnnoise|deepfilter|noisetorch/i;

function walkFiles(dir, test, depth = 0, out = []) {
  if (depth > 4) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, test, depth + 1, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };
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
      if (p === CONF_FILE || p.startsWith(STATE_DIR)) continue;
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
    if (Number(idx) === echoModuleIndex) continue;
    items.push({ id: 'mod:' + idx, type: 'module', index: Number(idx), enabled: true, names: [name], detail: a.join(' '), canChange: true });
  }
  // 5) Running processes that host a filter (pipewire -c <file>, easyeffects, noisetorch)
  const ps = await run('ps', ['-u', String(os.userInfo().uid), '-o', 'pid=,args=']);
  for (const l of ps.out.split('\n')) {
    const m = l.trim().match(/^(\d+)\s+(.*)$/); if (!m) continue;
    const pid = Number(m[1]), args = m[2];
    if (chainProc && pid === chainProc.pid) continue;
    if (pid === process.pid) continue;
    if (!(/(^|\/)pipewire\s+-c\s+\S+/.test(args) || /(^|\/)(easyeffects|noisetorch)(\s|$)/.test(args))) continue;
    if (args.includes(CONF_FILE)) continue;
    items.push({ id: 'proc:' + pid, type: 'process', pid, enabled: true, names: [args.slice(0, 160)], canChange: true });
  }
  legacyCache = items;
  return items;
}

async function restartPipeWire() {
  const wasRunning = !!chainProc || echoModuleIndex !== null;
  if (chainProc) await stopChain();
  echoModuleIndex = null; // modules vanish with pipewire-pulse restart
  const r = await run('systemctl', ['--user', 'restart', 'pipewire', 'pipewire-pulse', 'wireplumber'], { timeout: 15000 });
  await new Promise((res) => setTimeout(res, 2000));
  if (wasRunning) { // bring the dashboard's mic back up
    const st = await getStatus();
    if (settings.engine === 'pipewire') await startPipewireChain(); else await startWebrtc(st.server?.isPipeWire);
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

// ---------------------------------------------------------------- HTTP
function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}
const validName = (n) => typeof n === 'string' && /^[\w.\-:@]+$/.test(n);
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
    if (fs.existsSync(CONF_FILE)) out['mic-clean-chain.conf'] = fs.readFileSync(CONF_FILE, 'utf8');
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
    compBroken = false;
    if (body.settings) Object.assign(settings, body.settings);
    if (settings.master && !validName(settings.master)) throw new Error('اسم المايك المصدر غلط');
    if (settings.master === CLEAN_NODE) settings.master = '';
    saveSettings(settings);
    const st = await getStatus();
    await stopAll();
    const ok = settings.engine === 'pipewire' ? await startPipewireChain() : await startWebrtc(st.server.isPipeWire);
    return { ok, error: lastError };
  },
  'POST /api/clean/update': async (body) => {
    const before = JSON.stringify({ r: settings.rnnoise, r2: settings.rnnoise2, c: settings.comp, l: settings.limiter, hp: Number(settings.highpass) > 0, m: settings.master, e: settings.engine, w: settings.webrtc });
    if (body.settings) Object.assign(settings, body.settings);
    saveSettings(settings);
    const after = JSON.stringify({ r: settings.rnnoise, r2: settings.rnnoise2, c: settings.comp, l: settings.limiter, hp: Number(settings.highpass) > 0, m: settings.master, e: settings.engine, w: settings.webrtc });
    if (!chainProc && echoModuleIndex === null) return { ok: true, applied: 'saved' };
    if (chainProc && before === after && (await livePipewireUpdate())) return { ok: true, applied: 'live' };
    // Graph changed or live update unsupported -> debounced restart.
    clearTimeout(restartTimer);
    restartTimer = setTimeout(async () => {
      const st = await getStatus();
      if (settings.engine === 'pipewire') { await stopWebrtc(); await startPipewireChain(); }
      else { await stopChain(); await startWebrtc(st.server.isPipeWire); }
    }, 350);
    return { ok: true, applied: 'restart' };
  },
  'POST /api/clean/stop': async () => { await stopAll(); lastError = ''; return { ok: true }; },
  'GET /api/legacy': async () => ({ ok: true, items: await scanLegacy(), autoStart: !!settings.autoStart }),
  'POST /api/legacy/disable': async ({ id }) => setLegacy(String(id), false),
  'POST /api/legacy/enable': async ({ id }) => setLegacy(String(id), true),
  'POST /api/legacy/disable-all': async () => {
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
  },
  'POST /api/rnnoise/install': async () => {
    if (findRnnoise()) return { ok: true, path: findRnnoise(), already: true };
    const dir = path.join(os.homedir(), '.ladspa'); fs.mkdirSync(dir, { recursive: true });
    const zip = path.join(os.tmpdir(), 'linux-rnnoise.zip');
    const url = 'https://github.com/werman/noise-suppression-for-voice/releases/download/v1.10/linux-rnnoise.zip';
    const dl = await run('curl', ['-fsSL', '-o', zip, url], { timeout: 120000 });
    if (!dl.ok) throw new Error('مقدرتش أنزّل RNNoise (فيه نت؟): ' + dl.err.trim().slice(0, 160));
    const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nn=[x for x in z.namelist() if x.endswith('ladspa/librnnoise_ladspa.so')][0]\nopen(sys.argv[2],'wb').write(z.read(n))`;
    const ex = await run('python3', ['-c', py, zip, path.join(dir, 'librnnoise_ladspa.so')], { timeout: 30000 });
    if (!ex.ok) throw new Error('فك الضغط فشل: ' + ex.err.trim().slice(0, 160));
    return { ok: true, path: findRnnoise() };
  },
  'POST /api/clean/autostart': async ({ on }) => { settings.autoStart = !!on; saveSettings(settings); return { ok: true, autoStart: settings.autoStart }; },
  'POST /api/clean/reset': async () => { settings = { ...structuredClone(DEFAULT_SETTINGS), master: settings.master, autoStart: settings.autoStart }; saveSettings(settings); return { ok: true, settings }; },
};

// ---------------------------------------------------------------- macOS mode
// No PipeWire on the Mac: the dashboard page itself runs the audio engine
// (public/engine-web.js → RNNoise WASM ×2, EQ, compressor, limiter) and plays the
// result into BlackHole. The server only lists devices, sets the input volume,
// and stores settings.
const IS_MAC = (process.env.MIC_PLATFORM || process.platform) === 'darwin';

async function macDevices() {
  const sp = await run('system_profiler', ['SPAudioDataType', '-json'], { timeout: 15000 });
  try { return JSON.parse(sp.out).SPAudioDataType?.[0]?._items || []; } catch { return []; }
}
async function macInputVolume() {
  const r = await run('osascript', ['-e', 'input volume of (get volume settings)']);
  const v = Number(r.out.trim());
  return Number.isFinite(v) ? v : null;
}
async function macStatus() {
  const items = await macDevices();
  const vol = await macInputVolume();
  const sources = items.filter((d) => Number(d.coreaudio_device_input) > 0).map((d, i) => {
    const isDef = d.coreaudio_default_audio_input_device === 'spaudio_yes';
    const tr = String(d.coreaudio_device_transport || '').replace('coreaudio_device_type_', '');
    const isBH = /blackhole|mohamed/i.test(d._name);
    const kind = isBH ? 'filter' : /virtual|aggregate/i.test(tr) ? 'virtual' : 'hardware';
    const where = /usb/i.test(tr) ? 'مايك USB' : /built/i.test(tr) ? 'مايك الماك' : /bluetooth/i.test(tr) ? 'بلوتوث' : tr || 'جهاز';
    return {
      index: i, name: d._name, description: d._name, state: isDef ? 'RUNNING' : 'IDLE', mute: isDef && vol === 0,
      volumePercent: isDef ? vol : null, volumeDb: isDef && vol ? (60 * Math.log10(vol / 100)).toFixed(1) : null,
      sampleSpec: `${d.coreaudio_device_input}ch ${d.coreaudio_device_srate || ''}Hz`, activePort: '', driver: 'CoreAudio',
      isDefault: isDef, recordedBy: [], props: {},
      origin: {
        kind, master: null,
        label: kind === 'hardware' ? `هاردوير · ${where}` : isBH ? 'BlackHole (خرج Mic (Mohamed))' : 'مصدر وهمي',
        detail: isBH ? 'ده المايك اللي تختاره في زوم/OBS — الصوت النضيف بيوصله من الداشبورد.' : isDef ? '' : 'على الماك الجين بيتظبط للمايك الافتراضي بس — دوس «خليه افتراضي» الأول.',
      },
    };
  });
  const def = sources.find((s) => s.isDefault);
  return {
    ok: true, platform: 'darwin',
    server: { name: 'macOS · CoreAudio', version: '', isPipeWire: false, defaultSource: def?.name || '', defaultSink: '', sampleSpec: '' },
    sources, modules: [],
    clean: {
      running: false, engine: 'browser', pid: null, echoModuleIndex: null, lastError: '', log: [],
      capabilities: {
        pipewire: false, pwCli: false, webrtc: false, browserEngine: true,
        rnnoisePath: 'RNNoise WASM (جوه البراوزر)', compPath: 'Web Audio compressor', compFound: 'web', compStatus: 'ok', ladspaDirs: [],
        blackhole: items.some((d) => /blackhole/i.test(d._name)), switchAudio: await has('SwitchAudioSource'),
      },
    },
    settings, eqFreqs: EQ_FREQS,
  };
}
const MAC_ROUTES = {
  'GET /api/status': async () => macStatus(),
  'GET /api/graph': async () => {
    const st = await macStatus();
    const hw = st.sources.find((s) => s.origin.kind === 'hardware' && s.isDefault) || st.sources.find((s) => s.origin.kind === 'hardware');
    const bh = st.sources.find((s) => /blackhole|mohamed/i.test(s.name));
    const chain = [
      { id: 2, name: bh?.name || 'BlackHole 2ch', label: bh ? 'Mic (Mohamed) ← ' + bh.name : 'BlackHole (مش متسطب)', mediaClass: 'Audio/Source', api: '', product: '' },
      { id: 1, name: 'browser', label: 'التنضيف جوه الداشبورد (RNNoise ×2 · EQ · ضاغط · ليميتر)', mediaClass: 'web', api: '', product: '' },
      { id: 0, name: hw?.name || '', label: hw?.name || 'المايك', mediaClass: 'Audio/Source', api: 'coreaudio', product: '' },
    ];
    return { ok: true, chains: [{ id: 2, name: bh?.name || 'blackhole', label: 'Mic (Mohamed)', chain }], controllable: [], note: 'على الماك: الفلتر شغال جوه صفحة الداشبورد (لازم تفضل مفتوحة) وبيطلّع على BlackHole.' };
  },
  'GET /api/configs': async () => ({ ok: true, files: [], services: '' }),
  'GET /api/legacy': async () => ({ ok: true, items: [], autoStart: !!settings.autoStart }),
  'GET /api/raw': async () => {
    const sp = await run('system_profiler', ['SPAudioDataType'], { timeout: 15000 });
    const v = await run('osascript', ['-e', 'get volume settings']);
    return { 'system_profiler SPAudioDataType': sp.out || sp.err, 'osascript get volume settings': v.out || v.err, 'SwitchAudioSource -a': (await run('SwitchAudioSource', ['-a', '-t', 'input'])).out || 'SwitchAudioSource مش متسطب (brew install switchaudio-osx)' };
  },
  'POST /api/source/volume': async ({ name, percent }) => {
    const st = await macStatus();
    const src = st.sources.find((s) => s.name === name);
    if (!src?.isDefault) throw new Error('على الماك الجين بيتغير للمايك الافتراضي بس — دوس «خليه افتراضي» على المايك ده الأول');
    const p = Math.max(0, Math.min(100, Math.round(Number(percent))));
    const r = await run('osascript', ['-e', `set volume input volume ${p}`]);
    if (!r.ok) throw new Error(r.err);
    return { ok: true, capped: Number(percent) > 100 };
  },
  'POST /api/source/mute': async ({ name, mute }) => {
    const st = await macStatus();
    if (!st.sources.find((s) => s.name === name)?.isDefault) throw new Error('الكتم على الماك للمايك الافتراضي بس');
    if (mute) { settings.macVolBeforeMute = (await macInputVolume()) ?? 75; saveSettings(settings); }
    const r = await run('osascript', ['-e', `set volume input volume ${mute ? 0 : settings.macVolBeforeMute ?? 75}`]);
    if (!r.ok) throw new Error(r.err);
    return { ok: true };
  },
  'POST /api/source/default': async ({ name }) => {
    if (typeof name !== 'string' || name.length > 200) throw new Error('اسم غلط');
    if (!(await has('SwitchAudioSource'))) throw new Error('عشان أغيّر المايك الافتراضي محتاج: brew install switchaudio-osx — أو غيّره من System Settings ← Sound ← Input');
    const r = await run('SwitchAudioSource', ['-t', 'input', '-s', name]);
    if (!r.ok) throw new Error(r.err || r.out);
    return { ok: true };
  },
  'POST /api/clean/start': async (body) => { if (body.settings) Object.assign(settings, body.settings); saveSettings(settings); return { ok: true, browser: true }; },
  'POST /api/clean/update': async (body) => { if (body.settings) Object.assign(settings, body.settings); saveSettings(settings); return { ok: true, applied: 'live' }; },
  'POST /api/clean/stop': async () => ({ ok: true, browser: true }),
  'POST /api/rnnoise/install': async () => ({ ok: true, already: true, path: 'wasm' }),
  'POST /api/legacy/disable-all': async () => ({ ok: true, errors: [], items: [] }),
};
if (IS_MAC) Object.assign(routes, MAC_ROUTES);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const key = `${req.method} ${url.pathname}`;
  if (routes[key]) {
    // Only accept same-origin writes (blocks other websites from driving your mic).
    if (req.method !== 'GET') {
      const origin = req.headers.origin;
      if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { ok: false, error: 'طلب من موقع تاني — مرفوض' });
    }
    try { send(res, 200, await routes[key](req.method === 'POST' ? await readBody(req) : {})); }
    catch (e) { send(res, 400, { ok: false, error: e.message }); }
    return;
  }
  let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(PUBLIC)) return send(res, 403, 'forbidden', 'text/plain');
  fs.readFile(file, (err, data) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream'));
});

if (require.main === module) server.listen(PORT, HOST, () => {
  console.log(`\n  🎙  Mic (Mohamed) Dashboard → http://localhost:${PORT}${IS_MAC ? '   (وضع الماك: التنضيف جوه الصفحة → BlackHole)' : ''}\n`);
  console.log('  Ctrl+C يقفل السيرفر ويشيل المايك الوهمي Mic (Mohamed).\n');
  if (settings.autoStart && !IS_MAC) {
    setTimeout(async () => {
      const st = await getStatus();
      const ok = settings.engine === 'pipewire' ? await startPipewireChain() : await startWebrtc(st.server?.isPipeWire);
      console.log(ok ? '  ✓ Mic (Mohamed) اشتغل تلقائي' : `  ⚠ Mic (Mohamed) مقدرش يشتغل: ${lastError}`);
    }, 800);
  }
});

let exiting = false;
async function shutdown() {
  if (exiting) return; exiting = true;
  console.log('\nبقفل Mic (Mohamed)…');
  await stopAll();
  process.exit(0);
}
if (require.main === module) { process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown); }

module.exports = { parsePactlList, classifySource, buildChainConf, DEFAULT_SETTINGS };
