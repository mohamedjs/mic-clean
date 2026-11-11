'use strict';
// The user's settings: one shared object, loaded once, saved on every change.
// Defaults are the 🎙 Podcast scene from shared/presets.js.
const fs = require('fs');
const { PATHS } = require('../../core/config');
const { EQ_FREQS, SCENES, DEFAULT_SCENE } = require('../../shared/presets');

const SETTINGS_VERSION = 3; // 3: input follows the system default mic (no USB preference)

function sceneSettings(name) {
  const s = structuredClone(SCENES[name].s);
  s.eq = EQ_FREQS.map((freq, i) => ({ freq, gain: s.eq[i], q: 1.0 }));
  return s;
}

const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  profile: DEFAULT_SCENE,
  engine: 'pipewire',          // 'pipewire' (RNNoise + EQ + compressor) | 'webrtc'
  master: '',                  // input mic; '' = whatever the system's default mic is
  makeDefault: true,           // make the clean mic the system's default input while it runs
  autoStart: false,
  ...sceneSettings(DEFAULT_SCENE),
  webrtc: { noiseSuppression: true, gainControl: false, highPass: true },
};

function load() {
  try {
    const saved = JSON.parse(fs.readFileSync(PATHS.settings, 'utf8'));
    const v = saved.settingsVersion || 1;
    // v1 → podcast defaults (keep the picked mic); v2 → follow the system default mic
    if (v < 2) return { ...structuredClone(DEFAULT_SETTINGS), master: '', autoStart: !!saved.autoStart };
    if (v < 3) return { ...structuredClone(DEFAULT_SETTINGS), ...saved, settingsVersion: SETTINGS_VERSION, master: '', webInputId: 'default' };
    return { ...structuredClone(DEFAULT_SETTINGS), ...saved };
  } catch { return structuredClone(DEFAULT_SETTINGS); }
}

const settings = load();

function save() {
  try { fs.mkdirSync(PATHS.stateDir, { recursive: true }); fs.writeFileSync(PATHS.settings, JSON.stringify(settings, null, 2)); } catch {}
}
function update(patch) { if (patch && typeof patch === 'object') Object.assign(settings, patch); save(); return settings; }
// Back to the defaults, keeping the picked mic and autostart.
function reset() {
  const keep = { master: settings.master, autoStart: settings.autoStart };
  for (const k of Object.keys(settings)) delete settings[k];
  Object.assign(settings, structuredClone(DEFAULT_SETTINGS), keep);
  save();
  return settings;
}

module.exports = settings;
Object.defineProperties(module.exports, {
  save: { value: save }, update: { value: update }, reset: { value: reset },
  DEFAULT_SETTINGS: { value: DEFAULT_SETTINGS }, SETTINGS_VERSION: { value: SETTINGS_VERSION },
});
