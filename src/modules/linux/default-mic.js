'use strict';
// "Use the system's default mic" on Linux, without feeding the clean mic into itself.
//
// The clean mic becomes the system default while it runs (so apps pick it up). Its
// input must therefore be pinned to the mic that was the default *before* that, and
// that mic goes back to being the default when the clean mic stops.
const { APP } = require('../../core/config');
const { run } = require('../../core/exec');
const settings = require('../settings');

const isOurs = (name) => !name || name === APP.node || /^mic_mohamed$/.test(name); // mic_mohamed: the app's old name

async function systemDefault() {
  const r = await run('pactl', ['get-default-source']);
  return r.ok ? r.out.trim() : '';
}

async function hardwareSources() {
  const list = await run('pactl', ['list', 'sources', 'short']);
  return list.out.split('\n').map((l) => l.split('\t')[1]).filter((n) => n && !n.endsWith('.monitor') && !isOurs(n));
}

// The mic to clean: the one the user picked, else the system default (remembered
// across restarts, so it survives the clean mic being the default for a while).
async function resolveInput() {
  if (settings.master && !isOurs(settings.master)) return settings.master;
  const def = await systemDefault();
  if (!isOurs(def)) { if (settings.previousDefault !== def) { settings.previousDefault = def; settings.save(); } return def; }
  const names = await hardwareSources();
  if (settings.previousDefault && names.includes(settings.previousDefault)) return settings.previousDefault;
  return names.find((n) => n.startsWith('alsa_input')) || names[0] || '';
}

// When the clean mic stops: hand the default back to the mic it was cleaning.
async function restore() {
  if (!isOurs(await systemDefault())) return;
  const names = await hardwareSources();
  const target = [settings.master, settings.previousDefault].find((n) => n && names.includes(n))
    || names.find((n) => n.startsWith('alsa_input')) || names[0];
  if (target) await run('pactl', ['set-default-source', target]);
}

module.exports = { resolveInput, restore, systemDefault, isOurs };
