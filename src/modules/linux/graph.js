'use strict';
// Reads the real PipeWire graph (pw-dump, or pactl + pw-cli as a fallback) to
// show each source's chain back to the hardware and every controllable filter.
const { run, has } = require('../../core/exec');
const { parsePactlList } = require('./pactl');

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

module.exports = { getGraph, parsePwCliParams };
