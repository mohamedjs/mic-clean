'use strict';
// The user's settings: one shared object, loaded once, saved on every change.
// Defaults are the 🎙 Podcast scene from shared/presets.js.
const fs = require('fs');
const { PATHS } = require('../../core/config');
const { EQ_FREQS, SCENES, DEFAULT_SCENE } = require('../../shared/presets');

const SETTINGS_VERSION = 4; // 3: input follows the system default mic (no USB preference); 4: warmer podcast scene

// The podcast scene before 1.0.3. Settings still on exactly these values move to the new one.
const OLD_PODCAST = { highpass: 90, eq: [-6, -3, 1.5, -2, -1.5, 0, 1.5, 2.5, -1, 0], compThreshold: -20, compRatio: 3, compAttack: 10, compRelease: 150, compMakeup: 4, outputGainDb: 0 };
const isOldPodcast = (s) => Array.isArray(s.eq) && s.eq.length === 10 && s.eq.every((b, i) => Number(b.gain) === OLD_PODCAST.eq[i])
  && Object.entries(OLD_PODCAST).every(([k, v]) => k === 'eq' || Number(s[k]) === v);

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
    // v3 → the warmer podcast scene, only if the stages were never changed from the old one
    if (v < 4) return { ...structuredClone(DEFAULT_SETTINGS), ...saved, ...(isOldPodcast(saved) ? sceneSettings(DEFAULT_SCENE) : {}), settingsVersion: SETTINGS_VERSION };
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
