'use strict';
// Windows, and Linux without pactl: the window cleans the audio and plays it into
// a virtual cable (VB-CABLE: apps record from "CABLE Output"). Devices come from
// PowerShell; volume and default device live in Windows' Sound settings.
const { APP, IS_WIN } = require('../../core/config');
const { run } = require('../../core/exec');
const { EQ_FREQS } = require('../../shared/presets');
const settings = require('../settings');
const mac = require('../mac');
const MAC_ROUTES = mac.routes;

const VCABLE_RE = /cable (output|input)|vb-audio|voicemeeter|blackhole|mic clean|mohamed/i;
async function winDevices() {
  const ps = "Get-CimInstance Win32_PnPEntity -Filter \"PNPClass='AudioEndpoint'\" | Select-Object Name,Status | ConvertTo-Json -Compress";
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 15000 });
  try { const j = JSON.parse(r.out || '[]'); return (Array.isArray(j) ? j : [j]).filter((d) => d && d.Name); } catch { return []; }
}
const isCaptureName = (n) => /microphone|mic\b|mikrofon|micro|line in|input|headset|array|cable output|voicemeeter out|aux/i.test(n) && !/speaker|headphone|cable input|voicemeeter in|digital output|hdmi|display audio|realtek digital/i.test(n);
function browserSource(name, i, { isDef = false, extra = '' } = {}) {
  const isVirt = VCABLE_RE.test(name);
  const where = /usb/i.test(name) ? 'مايك USB' : /bluetooth|hands-free|headset/i.test(name) ? 'سماعة / بلوتوث' : /array|realtek|built|internal/i.test(name) ? 'مايك مدمج' : 'جهاز';
  return {
    index: i, name, description: name, state: isDef ? 'RUNNING' : 'IDLE', mute: false, volumePercent: null, volumeDb: null,
    sampleSpec: '', activePort: '', driver: IS_WIN ? 'WASAPI' : 'Browser', isDefault: isDef, recordedBy: [], props: {},
    origin: {
      kind: isVirt ? 'filter' : 'hardware', master: null,
      label: isVirt ? `كابل وهمي (خرج ${APP.desc})` : `هاردوير · ${where}`,
      detail: isVirt ? 'ده المايك اللي تختاره في زوم/OBS/ديسكورد — الصوت النضيف بيوصله من الداشبورد.' : extra,
    },
  };
}
async function webStatus() {
  let sources = [];
  if (IS_WIN) sources = (await winDevices()).filter((d) => isCaptureName(d.Name)).map((d, i) => browserSource(d.Name, i, { extra: d.Status && d.Status !== 'OK' ? `الحالة: ${d.Status}` : '' }));
  const vcable = sources.some((s) => /cable output|voicemeeter/i.test(s.name));
  return {
    ok: true, platform: IS_WIN ? 'win32' : 'web',
    server: { name: IS_WIN ? 'Windows · WASAPI' : 'Browser audio (من غير PipeWire)', version: '', isPipeWire: false, defaultSource: '', defaultSink: '', sampleSpec: '' },
    sources, modules: [],
    clean: {
      running: false, engine: 'browser', pid: null, echoModuleIndex: null, lastError: '', log: [],
      capabilities: {
        pipewire: false, pwCli: false, webrtc: false, browserEngine: true,
        rnnoisePath: 'RNNoise WASM (جوه البراوزر)', compPath: 'Web Audio compressor', compFound: 'web', compStatus: 'ok', ladspaDirs: [],
        vcable, blackhole: vcable,
      },
    },
    settings, eqFreqs: EQ_FREQS,
  };
}
const SOUND_SETTINGS_MSG = IS_WIN ? 'على ويندوز غيّر ده من Settings ← System ← Sound ← Input (أو اكتب mmsys.cpl في Run).' : 'غيّر ده من إعدادات الصوت بتاعة النظام.';
const WEB_ROUTES = {
  ...MAC_ROUTES,
  'GET /api/status': async () => webStatus(),
  'GET /api/graph': async () => {
    const st = await webStatus();
    const vc = st.sources.find((s) => /cable output|voicemeeter/i.test(s.name));
    const hw = st.sources.find((s) => s.origin.kind === 'hardware');
    const chain = [
      { id: 2, name: vc?.name || 'CABLE Output', label: vc ? APP.desc + ' ← ' + vc.name : (IS_WIN ? 'VB-CABLE (مش متسطب)' : 'الخرج'), mediaClass: 'Audio/Source', api: '', product: '' },
      { id: 1, name: 'browser', label: 'التنضيف جوه الأبلكيشن (RNNoise ×2 · EQ · ضاغط · ليميتر)', mediaClass: 'web', api: '', product: '' },
      { id: 0, name: hw?.name || '', label: hw?.name || 'المايك', mediaClass: 'Audio/Source', api: IS_WIN ? 'wasapi' : 'browser', product: '' },
    ];
    return { ok: true, chains: [{ id: 2, name: 'vcable', label: APP.desc, chain }], controllable: [], note: 'الفلتر شغال جوه شباك الأبلكيشن (لازم يفضل مفتوح، ممكن تصغّره) وبيطلّع على الكابل الوهمي.' };
  },
  'GET /api/raw': async () => IS_WIN ? { 'Win32_PnPEntity AudioEndpoint': JSON.stringify(await winDevices(), null, 2) } : { info: 'وضع البراوزر: مفيش pactl على الجهاز ده.' },
  'POST /api/source/volume': async () => { throw new Error('الجين: ' + SOUND_SETTINGS_MSG + ' أو استخدم «تعلية الدخل» في الداشبورد.'); },
  'POST /api/source/mute': async () => { throw new Error('الكتم: ' + SOUND_SETTINGS_MSG); },
  'POST /api/source/default': async () => { throw new Error('المايك الافتراضي: ' + SOUND_SETTINGS_MSG); },
};

module.exports = { routes: WEB_ROUTES, webStatus, winDevices };
