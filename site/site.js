// Mic Clean landing page: language (Arabic / English), theme, visitor's OS, download links.
'use strict';

const REPO = 'mohamedjs/mic-clean';
const LATEST = `https://github.com/${REPO}/releases/latest/download/`;

const T = {
  en: {
    'nav.download': 'Download', 'nav.how': 'How it works',
    'hero.t1': 'Any mic,', 'hero.t2': 'studio clean.',
    'hero.lead': 'Mic Clean removes fans, AC, keyboards and street noise, keeps your voice at a steady level and stops it clipping. Then it gives Zoom, Meet, Teams, OBS and Discord a clean mic. Linux, macOS and Windows. Free, offline, no account.',
    'hero.dl': 'Download for {os}', 'hero.other': 'Other platforms', 'hero.ver': 'Version {v} · free and open source (MIT)',
    'video.t': 'See it in 2 minutes', 'video.sub': 'What it does, how to set it up and what each tab is for. Every shot is the real app.',
    'feat.t': 'What it does',
    'feat.rn.t': 'Double RNNoise', 'feat.rn.d': 'A neural network removes the noise twice: the first pass takes most of it and mutes the silences, the second takes what is left, without the robot voice.',
    'feat.chain.t': 'A podcast chain', 'feat.chain.d': 'High-pass, 10-band EQ, compressor, make-up gain and a limiter at −2 dB, the same steps a sound engineer would use.',
    'feat.default.t': 'Your default mic', 'feat.default.d': 'It cleans the mic your computer already uses. USB, XLR interface, laptop or Bluetooth: no setup, and you can pick another one.',
    'feat.ab.t': 'Hear the difference', 'feat.ab.d': 'Switch between the raw and the clean mic with A and B, listen on headphones, watch the meters and spectrogram, record 10 seconds.',
    'feat.deps.t': 'Tells you what is missing', 'feat.deps.d': 'The home tab checks your computer: RNNoise, the compressor, BlackHole or VB-CABLE, with a button or a command for each.',
    'feat.local.t': 'Stays on your computer', 'feat.local.d': 'Audio never leaves your machine. The app only listens on 127.0.0.1 and refuses requests from websites.',
    'scenes.t': 'One click for the room you are in', 'scenes.sub': 'Pick a preset, then fine-tune any stage. Podcast is the default.',
    'scenes.podcast': '🎙 Podcast', 'scenes.lecture': '🎓 Lecture recording', 'scenes.meeting': '💼 Meetings', 'scenes.stream': '🎮 Stream and gaming', 'scenes.noisy': '🚧 Very noisy room', 'scenes.natural': '🌿 Natural',
    'shot.tune': 'Tune: every stage, applied live', 'shot.monitor': 'Listen and compare: A/B, meters, spectrogram, calibration',
    'dl.t': 'Download', 'dl.sub': 'Pick your computer. Your OS is highlighted.',
    'dl.yours': 'Your computer', 'dl.copy': 'Copy', 'dl.all': 'All releases',
    'dl.mac.req': 'macOS 12+, Apple Silicon or Intel. Homebrew installs BlackHole for you:',
    'dl.mac.arm': '⬇ .dmg for Apple Silicon (M1–M4)', 'dl.mac.intel': '⬇ .dmg for Intel',
    'dl.mac.note': 'Not notarised by Apple yet, so the first open needs one extra click.', 'dl.mac.how': 'How?',
    'dl.win.req': 'Windows 10 or 11 (64-bit). Needs the free VB-CABLE virtual mic.',
    'dl.win.exe': '⬇ Mic Clean Setup (.exe)', 'dl.win.cable': '↗ Get VB-CABLE (free)',
    'dl.win.note': 'If SmartScreen warns you: More info → Run anyway. In your apps pick “CABLE Output”.',
    'dl.linux.req': 'PipeWire or PulseAudio (Ubuntu 22.04+, Fedora, Debian 12, Arch…). RNNoise is bundled.',
    'dl.linux.deb': '⬇ .deb for Ubuntu / Debian', 'dl.linux.app': '⬇ AppImage for any distro',
    'dl.linux.note': 'For the compressor and limiter: sudo apt install swh-plugins (the app has a button). In your apps pick “Mic Clean”.',
    'mac.t': 'Opening it on a Mac the first time', 'mac.sub': 'Apple has not notarised Mic Clean yet (that needs a paid developer ID), so macOS says “Mic Clean” Not Opened. Click Done, not Move to Trash, then:',
    'mac.brew.badge': 'Easiest', 'mac.brew.t': 'Homebrew', 'mac.brew.d': 'The two brew commands above install Mic Clean and BlackHole and clear the warning, so it simply opens. Update with brew upgrade --cask --greedy mic-clean.',
    'mac.dmg.t': 'Downloaded .dmg',
    'mac.dmg.1': 'Drag Mic Clean into Applications.', 'mac.dmg.2': 'Open it once and click Done.', 'mac.dmg.3': 'Open System Settings → Privacy & Security and scroll down.', 'mac.dmg.4': 'Click Open Anyway next to “Mic Clean” and confirm.',
    'mac.dmg.or': 'Or in Terminal:',
    'mac.bh.t': 'BlackHole: the virtual mic', 'mac.bh.d': 'macOS cannot make a new mic by itself. The free BlackHole 2ch driver is the mic that Zoom and OBS record from; Mic Clean plays your clean voice into it. Restart once after installing it.',
    'mac.perm': 'The first time, allow the microphone. Mic Clean lives in the menu bar when its window is closed.',
    'how.t': 'How it works on each computer', 'how.sub': 'The same chain everywhere. Where it runs differs.',
    'how.where': 'Cleaning runs', 'how.where.l': 'In PipeWire (filter-chain + LADSPA)', 'how.where.m': 'Inside the app (Web Audio + RNNoise WASM)',
    'how.needs': 'Needs', 'how.needs.l': 'PipeWire or PulseAudio; swh-plugins for the compressor', 'how.needs.m': 'BlackHole 2ch (free)', 'how.needs.w': 'VB-CABLE (free)',
    'how.pick': 'Pick in Zoom / OBS', 'how.open': 'App must stay open?', 'how.open.l': 'No: it keeps running in the tray', 'how.open.m': 'Yes (minimised or in the tray is fine)',
    'faq.t': 'Questions',
    'faq.q1': 'Which mic does it use?', 'faq.a1': 'The default mic of your computer, the one you picked in the system sound settings. You can pick another one on the home tab. While it runs on Linux, Mic Clean becomes the default input; when it stops, your real mic is the default again.',
    'faq.q2': 'Does it send my voice anywhere?', 'faq.a2': 'No. Everything runs on your computer. There is no account and no cloud.',
    'faq.q3': 'It sounds robotic. What do I change?', 'faq.a3': 'Lower the second RNNoise gate (15–30%) or pick the 🌿 Natural preset. Compare with A/B on the Listen and compare tab.',
    'faq.q4': 'Coming from Mic (Mohamed)?', 'faq.a4': 'That is this app’s old name. The virtual mic is now called Mic Clean: pick it again in your apps. The old background service is switched off on first start, and your settings stay.',
    'foot': 'Mic Clean · free and open source, MIT',
    'os.mac': 'Mac', 'os.windows': 'Windows', 'os.linux': 'Linux',
  },
  ar: {
    'nav.download': 'التحميل', 'nav.how': 'بيشتغل إزاي',
    'hero.t1': 'صوتك نضيف', 'hero.t2': 'زي البودكاست، من أي مايك.',
    'hero.lead': 'Mic Clean بيشيل صوت المروحة والتكييف والكيبورد والشارع، ويخلي علو صوتك ثابت ومن غير تكسير، وبعدين بيدّي زوم وميت وتيمز وOBS وديسكورد مايك نضيف. على لينكس والماك وويندوز. مجاني، ومن غير نت ولا حساب.',
    'hero.dl': 'نزّله لـ {os}', 'hero.other': 'أنظمة تانية', 'hero.ver': 'نسخة {v} · مجاني ومفتوح المصدر (MIT)',
    'video.t': 'شوفه في دقيقتين', 'video.sub': 'بيعمل إيه، وتسطّبه إزاي، وكل تاب بيعمل إيه. كل اللقطات من الأبلكيشن الحقيقي.',
    'feat.t': 'بيعمل إيه',
    'feat.rn.t': 'RNNoise مزدوج', 'feat.rn.d': 'شبكة عصبية بتشيل الضوضاء مرتين: الأولى بتشيل أغلبها وبتكتم السكوت، والتانية بتشيل البواقي، من غير صوت روبوت.',
    'feat.chain.t': 'سلسلة بودكاست', 'feat.chain.d': 'قص الترددات الواطية، وEQ عشر درجات، وضاغط، وتعلية، وليميتر عند −2 dB. نفس خطوات مهندس الصوت.',
    'feat.default.t': 'المايك الافتراضي بتاعك', 'feat.default.d': 'بينضّف المايك اللي جهازك مختاره أصلًا. USB أو كارت صوت أو لابتوب أو بلوتوث، من غير أي ظبط، وتقدر تختار غيره.',
    'feat.ab.t': 'اسمع الفرق', 'feat.ab.d': 'قارن بين المايك الخام والنضيف بزرار A وB، واسمع نفسك بالهيدفون، وشوف القراءات والـ spectrogram، وسجّل 10 ثواني.',
    'feat.deps.t': 'بيقولك إيه الناقص', 'feat.deps.d': 'تاب الرئيسية بيشيّك على جهازك: RNNoise والضاغط وBlackHole أو VB-CABLE، ولكل حاجة زرار أو أمر.',
    'feat.local.t': 'كله على جهازك', 'feat.local.d': 'الصوت عمره ما بيخرج من جهازك. الأبلكيشن بيسمع على 127.0.0.1 بس، وبيرفض أي طلب من موقع.',
    'scenes.t': 'دوسة واحدة على حسب المكان', 'scenes.sub': 'اختار وضع جاهز، وبعدين ظبّط أي مرحلة. الافتراضي بودكاست.',
    'scenes.podcast': '🎙 بودكاست', 'scenes.lecture': '🎓 تسجيل شرح', 'scenes.meeting': '💼 اجتماعات', 'scenes.stream': '🎮 ستريم وجيمنج', 'scenes.noisy': '🚧 مكان دوشة جدًا', 'scenes.natural': '🌿 طبيعي',
    'shot.tune': 'الضبط: كل مرحلة، والتعديل بيتطبق على طول', 'shot.monitor': 'اسمع وقارن: A/B وقراءات وspectrogram ومعايرة',
    'dl.t': 'التحميل', 'dl.sub': 'اختار جهازك. جهازك متعلّم عليه.',
    'dl.yours': 'جهازك', 'dl.copy': 'نسخ', 'dl.all': 'كل النسخ',
    'dl.mac.req': 'macOS 12 أو أحدث، Apple Silicon أو Intel. Homebrew بيسطّب BlackHole كمان:',
    'dl.mac.arm': '⬇ ‎.dmg لـ Apple Silicon (M1–M4)', 'dl.mac.intel': '⬇ ‎.dmg لـ Intel',
    'dl.mac.note': 'أبل لسه مراجعتهوش، فأول مرة بتفتحه محتاجة دوسة زيادة.', 'dl.mac.how': 'إزاي؟',
    'dl.win.req': 'ويندوز 10 أو 11 (64-bit). محتاج المايك الوهمي المجاني VB-CABLE.',
    'dl.win.exe': '⬇ Mic Clean Setup ‎(.exe)', 'dl.win.cable': '↗ نزّل VB-CABLE (مجاني)',
    'dl.win.note': 'لو SmartScreen طلعلك تحذير: More info ← Run anyway. وفي البرامج اختار «CABLE Output».',
    'dl.linux.req': 'PipeWire أو PulseAudio (أوبونتو 22.04+، فيدورا، ديبيان 12، آرش…). RNNoise جاي جواه.',
    'dl.linux.deb': '⬇ ‎.deb لأوبونتو / ديبيان', 'dl.linux.app': '⬇ AppImage لأي توزيعة',
    'dl.linux.note': 'للضاغط والليميتر: sudo apt install swh-plugins (أو الزرار اللي في الأبلكيشن). وفي البرامج اختار «Mic Clean».',
    'mac.t': 'أول مرة تفتحه على الماك', 'mac.sub': 'أبل لسه مراجعتش Mic Clean (ده محتاج حساب مطوّر مدفوع)، فالماك هيقولك «Mic Clean» Not Opened. دوس Done، مش Move to Trash، وبعدين:',
    'mac.brew.badge': 'الأسهل', 'mac.brew.t': 'Homebrew', 'mac.brew.d': 'أمرين brew اللي فوق بيسطّبوا Mic Clean وBlackHole وبيشيلوا التحذير، فبيفتح على طول. وللتحديث: brew upgrade --cask --greedy mic-clean.',
    'mac.dmg.t': 'لو نزّلت الـ ‎.dmg',
    'mac.dmg.1': 'اسحب Mic Clean لـ Applications.', 'mac.dmg.2': 'افتحه مرة ودوس Done.', 'mac.dmg.3': 'افتح System Settings ← Privacy & Security وانزل لتحت.', 'mac.dmg.4': 'دوس Open Anyway جنب «Mic Clean» وأكّد.',
    'mac.dmg.or': 'أو من التيرمنال:',
    'mac.bh.t': 'BlackHole: المايك الوهمي', 'mac.bh.d': 'الماك مش بيعرف يعمل مايك جديد لوحده. درايفر BlackHole 2ch المجاني هو المايك اللي زوم وOBS بيسجلوا منه، وMic Clean بيطلّع صوتك النضيف عليه. اعمل Restart مرة بعد ما تسطّبه.',
    'mac.perm': 'أول مرة اسمح بالمايك. ولما تقفل الشباك Mic Clean بيفضل شغال في الشريط اللي فوق.',
    'how.t': 'بيشتغل إزاي على كل جهاز', 'how.sub': 'نفس السلسلة في كل حتة، اللي بيختلف مكان تشغيلها.',
    'how.where': 'التنضيف بيحصل', 'how.where.l': 'جوه PipeWire (filter-chain + LADSPA)', 'how.where.m': 'جوه الأبلكيشن (Web Audio + RNNoise WASM)',
    'how.needs': 'محتاج', 'how.needs.l': 'PipeWire أو PulseAudio، وswh-plugins للضاغط', 'how.needs.m': 'BlackHole 2ch (مجاني)', 'how.needs.w': 'VB-CABLE (مجاني)',
    'how.pick': 'تختار في زوم / OBS', 'how.open': 'لازم الأبلكيشن يفضل مفتوح؟', 'how.open.l': 'لأ، بيفضل شغال في الخلفية', 'how.open.m': 'أيوه (متصغّر أو في الخلفية عادي)',
    'faq.t': 'أسئلة',
    'faq.q1': 'بيستخدم أنهي مايك؟', 'faq.a1': 'المايك الافتراضي بتاع جهازك، اللي انت مختاره في إعدادات الصوت. وتقدر تختار غيره من الرئيسية. على لينكس وهو شغال Mic Clean بيبقى المدخل الافتراضي، ولما يقف المايك الحقيقي بيرجع الافتراضي تاني.',
    'faq.q2': 'بيبعت صوتي لأي حتة؟', 'faq.a2': 'لأ. كله شغال على جهازك. مفيش حساب ولا كلاود.',
    'faq.q3': 'الصوت طالع روبوتي، أعمل إيه؟', 'faq.a3': 'وطّي بوابة RNNoise التانية (15–30%) أو اختار وضع 🌿 طبيعي، وقارن بـ A/B في تاب «اسمع وقارن».',
    'faq.q4': 'كان اسمه Mic (Mohamed)؟', 'faq.a4': 'ده كان اسم الأبلكيشن ده قبل كده. المايك الوهمي اسمه دلوقتي Mic Clean، فاختاره تاني في البرامج. الخدمة القديمة بتتقفل لوحدها أول ما تفتحه، وإعداداتك زي ما هي.',
    'foot': 'Mic Clean · مجاني ومفتوح المصدر، MIT',
    'os.mac': 'الماك', 'os.windows': 'ويندوز', 'os.linux': 'لينكس',
  },
};

const root = document.documentElement;
let lang = root.lang === 'ar' ? 'ar' : 'en';
const t = (k, vars = {}) => (T[lang][k] ?? T.en[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => vars[n] ?? '');

const OS = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? 'mac' : /Win/.test(navigator.platform || navigator.userAgent) ? 'windows' : 'linux';
const isArmMac = () => { try { const c = document.createElement('canvas').getContext('webgl'); const r = c && c.getParameter(c.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL); return !r || /apple/i.test(r); } catch { return true; } };
let version = '';

function apply() {
  root.lang = lang; root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('#lang button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.value === lang)));
  document.getElementById('heroDlText').textContent = t('hero.dl', { os: t('os.' + OS) });
  document.getElementById('ver').textContent = version ? t('hero.ver', { v: version }) : '';
  document.title = lang === 'ar' ? 'Mic Clean · صوتك نضيف زي البودكاست' : 'Mic Clean · Any mic, studio clean';
}

function links() {
  document.querySelectorAll('[data-asset]').forEach((a) => { a.href = LATEST + a.dataset.asset; });
  document.querySelectorAll(`.platform[data-os="${OS}"]`).forEach((p) => p.classList.add('yours'));
  const hero = document.getElementById('heroDl');
  hero.href = OS === 'mac' ? LATEST + (isArmMac() ? 'Mic-Clean-macos-arm64.dmg' : 'Mic-Clean-macos-x64.dmg')
    : OS === 'windows' ? LATEST + 'Mic-Clean-Setup-windows-x64.exe' : '#download';
}

document.getElementById('lang').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  lang = b.dataset.value; try { localStorage.setItem('lang', lang); } catch {}
  history.replaceState(null, '', '?lang=' + lang + location.hash);
  apply();
});
document.getElementById('theme').addEventListener('click', () => {
  const dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('theme', root.dataset.theme); } catch {}
});
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.copy'); if (!b) return;
  const code = b.parentElement.querySelector('code').textContent;
  try { await navigator.clipboard.writeText(code); b.textContent = '✓'; setTimeout(() => { b.textContent = t('dl.copy'); }, 1500); } catch {}
});

links();
apply();
// no video yet (or it failed to load): hide that section instead of an empty player
{ const v = document.querySelector('#video video'); const hide = () => { document.getElementById('video').hidden = true; };
  v.addEventListener('error', hide, true); v.querySelector('source').addEventListener('error', hide);
  fetch(v.querySelector('source').src, { method: 'HEAD' }).then((r) => { if (!r.ok) hide(); }).catch(hide); }
fetch(`https://api.github.com/repos/${REPO}/releases/latest`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.tag_name) { version = j.tag_name.replace(/^v/, ''); apply(); } }).catch(() => {});
