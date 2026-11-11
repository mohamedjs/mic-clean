'use strict';
// Runs the clean mic on Linux: a `pipewire -c` child with the filter-chain
// (RNNoise ×2, EQ, compressor, limiter), or PulseAudio's WebRTC echo-cancel.
const fs = require('fs');
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
  fs.mkdirSync(PATHS.stateDir, { recursive: true });
  // Pin the input to the system's default mic (or the picked one), never to the clean mic itself.
  const input = await defaults.resolveInput();
  fs.writeFileSync(PATHS.chainConf, buildChainConf({ ...settings, master: input }, rnnoisePath));
  await stopChain();
  chainLog = [];
  const proc = spawn('pipewire', ['-c', PATHS.chainConf], { stdio: ['ignore', 'pipe', 'pipe'] });
  chainProc = proc;
  const onData = (d) => { chainLog.push(...String(d).split('\n').filter(Boolean)); chainLog = chainLog.slice(-200); };
  proc.stdout.on('data', onData); proc.stderr.on('data', onData);
  proc.on('exit', (code) => { if (chainProc === proc) { chainProc = null; lastError = `الفلتر وقف فجأة (كود ${code}) — بص على السجل تحت.`; } });
  const ok = await waitForSource(APP.node);
  if (!ok) {
    if (settings.comp && findComp() && !comp.broken) { // retry once without the compressor
      comp.broken = true;
      const r2 = await startPipewireChain();
      if (r2) lastError = 'الضاغط (Compressor) مشتغلش مع نسخة الـ PipeWire دي — اشتغل من غيره.';
      return r2;
    }
    lastError = `المايك الوهمي ${APP.desc} مظهرش — بص على السجل تحت.`; return false;
  }
  if (comp.broken) return true;
  lastError = settings.rnnoise && !rnnoisePath ? 'ملف RNNoise مش موجود — شغال EQ بس من غير عزل ضوضاء. نزّل noise-suppression-for-voice (شوف README).' : '';
  if (settings.makeDefault) await run('pactl', ['set-default-source', APP.node]);
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

module.exports = { cleanStatus, startPipewireChain, livePipewireUpdate, startWebrtc, stopWebrtc, stopChain, stopAll, restoreDefault, state, forgetWebrtc: () => { echoModuleIndex = null; } };
