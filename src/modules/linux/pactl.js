'use strict';
// Parsing `pactl` output and deciding where each source's audio comes from.
const { APP } = require('../../core/config');
const settings = require('../settings');

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
  if (name === APP.node) return { kind: 'filter', label: `${APP.desc} (من الأبلكيشن ده)`, detail: 'المايك النضيف اللي عامله الأبلكيشن ده — بيتشال لما تقفله.', master: settings.master || null };
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

module.exports = { parsePactlList, pctFromVolume, dbFromVolume, classifySource };
