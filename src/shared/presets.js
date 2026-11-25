/* Mic Clean — presets shared by the server and the dashboard (one source of truth).
 * Server: require('./shared/presets'). Browser: <script src="/shared/presets.js"> → window.MicPresets. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MicPresets = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const EQ_FREQS = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // One-click scenes: every stage of the chain. 'podcast' is the default.
  const SCENES = {
    podcast: { e: '🎙', t: 'بودكاست', d: 'صوت دافي ومريح للودان: تخن في الـ 125، حدة وسين أقل بكتير، وضغط ناعم. للتسجيل.',
      // Warm radio voice: body at 100–150 Hz, less box at 500, 2–16 kHz pulled down (no de-esser in the chain).
      // Tuned by ear on a cheap USB mic that RNNoise leaves 4–5 dB brighter in 2.5–10 kHz.
      s: { rnnoise: true, vadThreshold: 55, vadGrace: 300, retroGrace: 50, rnnoise2: true, vad2Threshold: 20, vad2Grace: 400, retro2Grace: 0, highpass: 70,
        eq: [-6, -1.5, 3, -2.5, -2.5, 0, 0.5, -2, -4.5, -4], comp: true, compThreshold: -24, compRatio: 3, compAttack: 15, compRelease: 200, compMakeup: 7, outputGainDb: 3, limiter: true, limiterCeiling: -2 } },
    lecture: { e: '🎓', t: 'تسجيل شرح', d: 'سكتات التفكير متتقطعش، وصوت واضح وعالي كفاية، ومن غير تكسير.',
      s: { rnnoise: true, vadThreshold: 45, vadGrace: 450, retroGrace: 50, rnnoise2: true, vad2Threshold: 15, vad2Grace: 500, retro2Grace: 0, highpass: 80,
        eq: [-6, -3, 1, -2, -1, 0.5, 2, 2.5, -1, 0], comp: true, compThreshold: -24, compRatio: 3, compAttack: 12, compRelease: 200, compMakeup: 6, outputGainDb: 0, limiter: true, limiterCeiling: -2 } },
    meeting: { e: '💼', t: 'اجتماعات ومكالمات', d: 'كلام واضح ومن غير تأخير. زوم وتيمز وميت.',
      s: { rnnoise: true, vadThreshold: 45, vadGrace: 250, retroGrace: 0, rnnoise2: false, vad2Threshold: 20, vad2Grace: 400, retro2Grace: 0, highpass: 100,
        eq: [-6, -3, -1, 0, -1, 0, 2, 3, 2, 0], comp: true, compThreshold: -22, compRatio: 2.5, compAttack: 10, compRelease: 200, compMakeup: 3, outputGainDb: 0, limiter: true, limiterCeiling: -2 } },
    stream: { e: '🎮', t: 'ستريم وجيمنج', d: 'بيكتم الكيبورد والماوس جامد، وصوتك قوي.',
      s: { rnnoise: true, vadThreshold: 70, vadGrace: 200, retroGrace: 30, rnnoise2: true, vad2Threshold: 30, vad2Grace: 300, retro2Grace: 0, highpass: 100,
        eq: [-6, -3, 0, -1.5, -1, 0, 1.5, 2, 0, -1], comp: true, compThreshold: -18, compRatio: 3.5, compAttack: 8, compRelease: 150, compMakeup: 5, outputGainDb: 0, limiter: true, limiterCeiling: -2 } },
    noisy: { e: '🚧', t: 'مكان دوشة جدًا', d: 'أقصى عزل: شارع أو تكييف عالي أو ناس بتتكلم.',
      s: { rnnoise: true, vadThreshold: 80, vadGrace: 250, retroGrace: 50, rnnoise2: true, vad2Threshold: 45, vad2Grace: 300, retro2Grace: 0, highpass: 120,
        eq: [-8, -5, -2, -1, -2, 0, 3, 4, 2, -2], comp: true, compThreshold: -20, compRatio: 3, compAttack: 10, compRelease: 150, compMakeup: 4, outputGainDb: 0, limiter: true, limiterCeiling: -2 } },
    natural: { e: '🌿', t: 'طبيعي', d: 'أقل معالجة. بيشيل الضوضاء من غير ما يكتم، ومن غير EQ ولا ضغط.',
      s: { rnnoise: true, vadThreshold: 0, vadGrace: 200, retroGrace: 0, rnnoise2: false, vad2Threshold: 20, vad2Grace: 400, retro2Grace: 0, highpass: 60,
        eq: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0], comp: false, compThreshold: -20, compRatio: 3, compAttack: 10, compRelease: 150, compMakeup: 0, outputGainDb: 0, limiter: true, limiterCeiling: -2 } },
  };

  // EQ-only templates (the EQ preset menu). podcast = SCENES.podcast.s.eq
  const EQ_PRESETS = {
    flat: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    voice: [-6, -3, -1, 0, -1, 0, 2, 3, 2, 0],
    podcast: [-6, -1.5, 3, -2.5, -2.5, 0, 0.5, -2, -4.5, -4],
    warm: [0, 2, 3, 1, 0, -1, 0, 1, 0, -2],
    deess: [0, 0, 0, 0, 0, 0, -1, -3, -4, -3],
    laptop: [-8, -5, -2, -1, -2, 0, 3, 4, 2, -2],
  };

  const DEFAULT_SCENE = 'podcast';
  return { EQ_FREQS, SCENES, EQ_PRESETS, DEFAULT_SCENE };
});
