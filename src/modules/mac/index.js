'use strict';
// macOS: no PipeWire, so the app's window runs the audio chain (Web Audio +
// RNNoise WASM) and plays the result into BlackHole. The server lists devices,
// sets the input volume and stores settings.
const { APP } = require('../../core/config');
const { run, has } = require('../../core/exec');
const { EQ_FREQS } = require('../../shared/presets');
const settings = require('../settings');

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
    const isBH = /blackhole|mic clean|mohamed/i.test(d._name);
    const kind = isBH ? 'filter' : /virtual|aggregate/i.test(tr) ? 'virtual' : 'hardware';
    const where = /usb/i.test(tr) ? 'مايك USB' : /built/i.test(tr) ? 'مايك الماك' : /bluetooth/i.test(tr) ? 'بلوتوث' : tr || 'جهاز';
    return {
      index: i, name: d._name, description: d._name, state: isDef ? 'RUNNING' : 'IDLE', mute: isDef && vol === 0,
      volumePercent: isDef ? vol : null, volumeDb: isDef && vol ? (60 * Math.log10(vol / 100)).toFixed(1) : null,
      sampleSpec: `${d.coreaudio_device_input}ch ${d.coreaudio_device_srate || ''}Hz`, activePort: '', driver: 'CoreAudio',
      isDefault: isDef, recordedBy: [], props: {},
      origin: {
        kind, master: null,
        label: kind === 'hardware' ? `هاردوير · ${where}` : isBH ? `BlackHole (خرج ${APP.desc})` : 'مصدر وهمي',
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
    const bh = st.sources.find((s) => /blackhole|mic clean|mohamed/i.test(s.name));
    const chain = [
      { id: 2, name: bh?.name || 'BlackHole 2ch', label: bh ? APP.desc + ' ← ' + bh.name : 'BlackHole (مش متسطب)', mediaClass: 'Audio/Source', api: '', product: '' },
      { id: 1, name: 'browser', label: 'التنضيف جوه الأبلكيشن (RNNoise ×2 · EQ · ضاغط · ليميتر)', mediaClass: 'web', api: '', product: '' },
      { id: 0, name: hw?.name || '', label: hw?.name || 'المايك', mediaClass: 'Audio/Source', api: 'coreaudio', product: '' },
    ];
    return { ok: true, chains: [{ id: 2, name: bh?.name || 'blackhole', label: APP.desc, chain }], controllable: [], note: 'على الماك: الفلتر شغال جوه شباك الأبلكيشن (لازم يفضل مفتوح، ممكن تصغّره) وبيطلّع على BlackHole.' };
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
    if (mute) { settings.macVolBeforeMute = (await macInputVolume()) ?? 75; settings.save(); }
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
  'POST /api/clean/start': async (body) => { if (body.settings) Object.assign(settings, body.settings); settings.save(); return { ok: true, browser: true }; },
  'POST /api/clean/update': async (body) => { if (body.settings) Object.assign(settings, body.settings); settings.save(); return { ok: true, applied: 'live' }; },
  'POST /api/clean/stop': async () => ({ ok: true, browser: true }),
  'POST /api/rnnoise/install': async () => ({ ok: true, already: true, path: 'wasm' }),
  'POST /api/comp/install': async () => ({ ok: true, already: true, path: 'web' }),
  'POST /api/legacy/disable-all': async () => ({ ok: true, errors: [], items: [] }),
  'POST /api/clean/autostart': async ({ on }) => { settings.autoStart = !!on; settings.save(); return { ok: true, autoStart: settings.autoStart }; },
};

module.exports = { routes: MAC_ROUTES, macStatus, macDevices };
