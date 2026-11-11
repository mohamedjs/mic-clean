'use strict';
// GET /api/status on Linux: the sound server, every source and the clean mic.
const { run } = require('../../core/exec');
const { EQ_FREQS } = require('../../shared/presets');
const settings = require('../settings');
const { parsePactlList, pctFromVolume, dbFromVolume, classifySource } = require('./pactl');
const { cleanStatus } = require('./engine');

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

module.exports = { getStatus };
