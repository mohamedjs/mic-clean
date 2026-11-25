'use strict';
// Runs the clean mic on Linux: a `pipewire -c` child with the filter-chain
// (RNNoise ×2, EQ, compressor, limiter), or PulseAudio's WebRTC echo-cancel.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { APP, PATHS } = require('../../core/config');
const { run, has } = require('../../core/exec');
const settings = require('../settings');
const { parsePactlList } = require('./pactl');
const { findRnnoise, findComp, ladspaDirs, compDiagnose, comp } = require('./plugins');
const { buildChainConf } = require('./chain-conf');
const defaults = require('./default-mic');

let chainProc = null;      // pipewire -c child
let chainLog = [];
let echoModuleIndex = null; // module-echo-cancel we loaded
let lastError = '';
// The session caps real-time threads at 200 ms of CPU (RLIMIT_RTTIME, soft = hard),
// and the kernel SIGKILLs the chain when it goes over. After such a kill we restart
// without real-time priority, which that limit does not apply to.
let noRt = false;
let crashes = [];
let lastConsumers = [];
let watchTimer = null; // who was recording the clean mic at the last check (for a crash restart)          // times of unexpected exits, for the restart limit

// A log that survives chain restarts and app restarts: <stateDir>/engine.log.
const LOG_FILE = path.join(PATHS.stateDir, 'engine.log');
function logEvent(msg) {
  const line = `${new Date().toISOString()} ${msg}`;
  chainLog.push(line); chainLog = chainLog.slice(-200);
  try {
    fs.mkdirSync(PATHS.stateDir, { recursive: true });
    try { if (fs.statSync(LOG_FILE).size > 1024 * 1024) fs.renameSync(LOG_FILE, LOG_FILE + '.1'); } catch {}
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch {}
}

// Apps recording the clean mic right now (not our own filter's capture stream).
async function sourceIndex(name) {
  const r = await run('pactl', ['list', 'sources', 'short']);
  const row = r.out.split('\n').map((l) => l.split('\t')).find((c) => c[1] === name);
  return row ? Number(row[0]) : null;
}
async function consumersOf(name) {
  const idx = await sourceIndex(name);
  if (idx === null) return [];
  const outs = parsePactlList((await run('pactl', ['list', 'source-outputs'])).out, 'Source Output');
  return outs.filter((o) => Number(o.Source) === idx && o.props['node.name'] !== APP.capture)
    .map((o) => ({ client: o.Client, media: o.props['media.name'] || '', app: o.props['application.name'] || o.props['node.name'] || '?' }));
}
// When the clean mic is rebuilt, PipeWire moves its recorders to another mic (usually
// the raw one) and they stay there. Put them back on the new clean mic.
async function reattach(consumers) {
  if (!consumers.length) return;
  const end = Date.now() + 2500;
  let pending = consumers.slice();
  while (pending.length && Date.now() < end) {
    const idx = await sourceIndex(APP.node);
    const outs = parsePactlList((await run('pactl', ['list', 'source-outputs'])).out, 'Source Output');
    const left = [];
    for (const c of pending) {
      const o = outs.find((x) => x.Client === c.client && (x.props['media.name'] || '') === c.media);
      if (!o) { left.push(c); continue; }           // not re-created yet
      if (Number(o.Source) === idx) continue;        // already back
      const r = await run('pactl', ['move-source-output', String(o.index), APP.node]);
      logEvent(`reattach ${c.app} (${c.media || '-'}) → ${APP.node}: ${r.ok ? 'ok' : r.err.trim()}`);
      if (!r.ok && !/invalid argument/i.test(r.err)) left.push(c); // "Invalid argument": the app pinned its stream (e.g. a level meter); leave it
    }
    pending = left;
    if (pending.length) await new Promise((r) => setTimeout(r, 250));
  }
  if (pending.length) logEvent(`could not reattach: ${pending.map((c) => c.app).join(', ')}`);
}

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
      compPath: comp.broken ? null : findComp(),
      compFound: findComp(),
      compStatus: !findComp() ? 'missing' : comp.broken ? 'failed' : 'ok',
      ladspaDirs: ladspaDirs().filter((d) => fs.existsSync(d)),
      compDiag: findComp() ? null : await compDiagnose(),
      webrtc: true,
    },
    lastError,
    log: chainLog.slice(-15),
  };
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

// A chain left running by an earlier copy of the app (killed by an upgrade or a crash)
// keeps its own "Mic Clean" source, so starting ours next to it gives two. Stop it first.
async function stopStrayChains() {
  const pattern = `pipewire -c ${PATHS.chainConf}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pids = async () => (await run('pgrep', ['-f', pattern])).out.split('\n').map(Number).filter((p) => p && p !== process.pid);
  const stray = await pids();
  if (!stray.length) return;
  logEvent(`stopping ${stray.length} chain(s) left by an earlier run: ${stray.join(', ')}`);
  for (const p of stray) { try { process.kill(p, 'SIGTERM'); } catch {} }
  for (let i = 0; i < 10 && (await pids()).length; i++) await new Promise((r) => setTimeout(r, 150));
  for (const p of await pids()) { try { process.kill(p, 'SIGKILL'); } catch {} }
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

async function startPipewireChain(reason = 'start', keep = null) {
  const rnnoisePath = findRnnoise();
  // Remember who records the clean mic, so a restart doesn't leave them on the raw mic.
  const consumers = keep || (chainProc ? await consumersOf(APP.node) : []);
  fs.mkdirSync(PATHS.stateDir, { recursive: true });
  // Pin the input to the system's default mic (or the picked one), never to the clean mic itself.
  const input = await defaults.resolveInput();
  fs.writeFileSync(PATHS.chainConf, buildChainConf({ ...settings, master: input, noRt }, rnnoisePath));
  await stopChain();
  await stopStrayChains();
  logEvent(`chain ${reason}${noRt ? ' (no real-time)' : ''}: input=${input || '(default)'} recorders=${consumers.map((c) => c.app).join(', ') || 'none'}`);
  const proc = spawn('pipewire', ['-c', PATHS.chainConf], { stdio: ['ignore', 'pipe', 'pipe'] });
  chainProc = proc;
  const onData = (d) => String(d).split('\n').filter(Boolean).forEach((l) => logEvent(`pipewire: ${l}`));
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('exit', (code, sig) => {
    const unexpected = chainProc === proc;
    logEvent(`chain exited code=${code} signal=${sig || '-'}${unexpected ? ' (unexpected)' : ''}`);
    if (!unexpected) return;
    chainProc = null;
    if (sig === 'SIGKILL' && !noRt) { noRt = true; logEvent('killed by the real-time CPU limit; restarting without real-time priority'); }
    const now = Date.now();
    crashes = crashes.filter((t) => now - t < 60000).concat(now);
    if (crashes.length > 5) { lastError = `الفلتر وقف فجأة أكتر من 5 مرات في دقيقة (كود ${code ?? sig}) — بص على السجل تحت.`; logEvent('too many crashes in a minute; not restarting'); restoreDefault(); return; }
    lastError = '';
    // Bring the clean mic straight back and move apps that were recording it back onto it.
    setTimeout(() => { if (!chainProc) startPipewireChain('auto-restart after crash', lastConsumers).catch((e) => logEvent(`auto-restart failed: ${e.message}`)); }, 300);
  });
  const ok = await waitForSource(APP.node);
  if (!ok) {
    if (settings.comp && findComp() && !comp.broken) { // retry once without the compressor
      comp.broken = true;
      logEvent('virtual mic did not appear; retrying without the compressor');
      const r2 = await startPipewireChain('retry-no-comp', consumers);
      if (r2) lastError = 'الضاغط (Compressor) مشتغلش مع نسخة الـ PipeWire دي — اشتغل من غيره.';
      return r2;
    }
    lastError = `المايك الوهمي ${APP.desc} مظهرش — بص على السجل تحت.`; logEvent('virtual mic did not appear'); return false;
  }
  if (settings.makeDefault) await run('pactl', ['set-default-source', APP.node]);
  await reattach(consumers);
  lastConsumers = await consumersOf(APP.node).catch(() => consumers);
  if (!watchTimer) {
    watchTimer = setInterval(async () => { if (chainProc) lastConsumers = await consumersOf(APP.node).catch(() => lastConsumers); }, 3000);
    watchTimer.unref?.();
  }
  if (comp.broken) return true;
  lastError = settings.rnnoise && !rnnoisePath ? 'ملف RNNoise مش موجود — شغال EQ بس من غير عزل ضوضاء. نزّل noise-suppression-for-voice (شوف README).' : '';
  return true;
}

// Live update without restarting (works for control values only).
async function livePipewireUpdate() {
  if (!chainProc || !(await has('pw-cli'))) return false;
  // Find the filter's capture node id via pactl (no pw-dump needed)
  const outs = await run('pactl', ['list', 'source-outputs']);
  const cap = parsePactlList(outs.out, 'Source Output').find((o) => o.props['node.name'] === APP.capture);
  const id = cap?.props['object.id'];
  if (id === undefined) return false;
  const s = settings;
  const params = [];
  if (s.rnnoise && findRnnoise()) params.push(`"rnnoise:VAD Threshold (%)" ${Number(s.vadThreshold)}`, `"rnnoise:VAD Grace Period (ms)" ${Number(s.vadGrace)}`, `"rnnoise:Retroactive VAD Grace (ms)" ${Number(s.retroGrace)}`);
  if (s.rnnoise && s.rnnoise2 && findRnnoise()) params.push(`"rnnoise2:VAD Threshold (%)" ${Number(s.vad2Threshold)}`, `"rnnoise2:VAD Grace Period (ms)" ${Number(s.vad2Grace)}`, `"rnnoise2:Retroactive VAD Grace (ms)" ${Number(s.retro2Grace)}`);
  if (s.comp && !comp.broken && findComp()) params.push(`"comp:Attack time (ms)" ${Number(s.compAttack)}`, `"comp:Release time (ms)" ${Number(s.compRelease)}`, `"comp:Threshold level (dB)" ${Number(s.compThreshold)}`, `"comp:Ratio (1:n)" ${Number(s.compRatio)}`, `"comp:Makeup gain (dB)" ${Number(s.compMakeup)}`);
  if (Number(s.highpass) > 0) params.push(`"hp:Freq" ${Number(s.highpass)}`);
  s.eq.forEach((b, i) => params.push(`"eq${i}:Freq" ${Number(b.freq)}`, `"eq${i}:Q" ${Number(b.q) || 1}`, `"eq${i}:Gain" ${Number(b.gain)}`));
  params.push(`"gain:Gain 1" ${Math.pow(10, Number(s.outputGainDb) / 20).toFixed(4)}`);
  if (s.limiter && !comp.broken && findComp()) params.push(`"limiter:Threshold level (dB)" ${Number(s.limiterCeiling)}`);
  // pw-cli builds the Props pod in a ~1 KB buffer: past ~25 params it silently sends an
  // empty object ("Object: size 8") and nothing changes. Send small batches and treat an
  // empty object as a failure, so the caller falls back to restarting the chain.
  for (let i = 0; i < params.length; i += LIVE_BATCH) {
    const batch = params.slice(i, i + LIVE_BATCH).join(' ');
    const r = await run('pw-cli', ['set-param', String(id), 'Props', `{ params = [ ${batch} ] }`]);
    if (process.env.MIC_DEBUG) console.log('[live]', id, batch, '→', r.code, r.err.trim());
    if (!r.ok || /error/i.test(r.out + r.err) || /Object: size 8,/.test(r.out)) return false;
  }
  return true;
}
const LIVE_BATCH = 12;

async function startWebrtc(isPipeWire) {
  await stopWebrtc();
  const w = settings.webrtc;
  const aecArgs = isPipeWire
    ? `webrtc.noise_suppression=${w.noiseSuppression} webrtc.gain_control=${w.gainControl} webrtc.high_pass_filter=${w.highPass} webrtc.extended_filter=false`
    : `noise_suppression=${w.noiseSuppression ? 1 : 0} analog_gain_control=0 digital_gain_control=${w.gainControl ? 1 : 0} high_pass_filter=${w.highPass ? 1 : 0}`;
  const args = ['load-module', 'module-echo-cancel', 'aec_method=webrtc', `aec_args="${aecArgs}"`,
    `source_name=${APP.node}`, `sink_name=${APP.echoRef}`, `source_properties=device.description="${APP.desc}"`, `sink_properties=device.description="${APP.desc} echo reference"`];
  const input = await defaults.resolveInput();
  if (input) args.push(`source_master=${input}`);
  const r = await run('pactl', args);
  if (!r.ok) { lastError = `تحميل موديول WebRTC فشل: ${r.err.trim()}`; return false; }
  echoModuleIndex = Number(r.out.trim());
  lastError = '';
  if (settings.makeDefault) { await waitForSource(APP.node, 2000); await run('pactl', ['set-default-source', APP.node]); }
  return true;
}
async function stopWebrtc() {
  if (echoModuleIndex === null) return;
  await run('pactl', ['unload-module', String(echoModuleIndex)]);
  echoModuleIndex = null;
}

// Hand the system default back to the real mic when the clean mic goes away.
const restoreDefault = () => defaults.restore();

async function stopAll() {
  if (chainProc || echoModuleIndex !== null) logEvent('stop');
  await restoreDefault();
  await stopChain();
  await stopWebrtc();
}

const state = {
  get running() { return !!chainProc || echoModuleIndex !== null; },
  get chainPid() { return chainProc ? chainProc.pid : null; },
  get echoModuleIndex() { return echoModuleIndex; },
  get lastError() { return lastError; },
  set lastError(v) { lastError = v; },
};

module.exports = { logEvent, cleanStatus, startPipewireChain, livePipewireUpdate, startWebrtc, stopWebrtc, stopChain, stopAll, restoreDefault, state, forgetWebrtc: () => { echoModuleIndex = null; } };
