'use strict';
// LADSPA plugins the Linux chain needs: RNNoise (noise removal) and sc4m from
// swh-plugins (compressor + limiter). Finds them, diagnoses and installs them.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, which, has } = require('../../core/exec');
const { walkFiles, readSafe } = require('../../core/fsutil');
const { findFilterConfigs } = require('./configs');

// ---------------------------------------------------------------- RNNoise / filter-chain
const RNNOISE_CANDIDATES = [
  path.join(os.homedir(), '.ladspa/librnnoise_ladspa.so'),
  path.join(os.homedir(), '.local/lib/ladspa/librnnoise_ladspa.so'),
  '/usr/lib/ladspa/librnnoise_ladspa.so',
  '/usr/lib/x86_64-linux-gnu/ladspa/librnnoise_ladspa.so',
  '/usr/lib64/ladspa/librnnoise_ladspa.so',
  '/usr/local/lib/ladspa/librnnoise_ladspa.so',
];
function ladspaDirs() {
  const home = os.homedir();
  const env = (process.env.LADSPA_PATH || '').split(':').filter(Boolean);
  return [...new Set([...env, path.join(home, '.ladspa'), path.join(home, '.local/lib/ladspa'), '/usr/lib/ladspa', '/usr/lib/x86_64-linux-gnu/ladspa', '/usr/lib/aarch64-linux-gnu/ladspa', '/usr/lib64/ladspa', '/usr/local/lib/ladspa', '/usr/local/lib64/ladspa', '/opt/ladspa'])];
}
function scanLadspa(re) {
  for (const d of ladspaDirs()) {
    let ents; try { ents = fs.readdirSync(d); } catch { continue; }
    const f = ents.find((n) => re.test(n));
    if (f) return path.join(d, f);
  }
  return null;
}
function findRnnoise() {
  if (process.env.RNNOISE_LADSPA && fs.existsSync(process.env.RNNOISE_LADSPA)) return process.env.RNNOISE_LADSPA;
  const hit = RNNOISE_CANDIDATES.find((p) => fs.existsSync(p)) || scanLadspa(/^librnnoise.*ladspa.*\.so$|^librnnoise_ladspa\.so$/i);
  if (hit) return hit;
  // plugin path referenced by an old config that reset-audio.sh moved to ~/audio-backup-*
  try {
    for (const d of fs.readdirSync(os.homedir()).filter((n) => n.startsWith('audio-backup-'))) {
      for (const f of walkFiles(path.join(os.homedir(), d), (n) => /\.conf|\.mic-dashboard-off$/.test(n))) {
        const m = readSafe(f).match(/plugin\s*=\s*"?([^"\s}]*rnnoise[^"\s}]*\.so)/i);
        const pth = m && m[1].replace(/^~/, os.homedir());
        if (pth && fs.existsSync(pth)) return pth;
      }
    }
  } catch {}
  // Reuse the plugin path from an existing config (e.g. the one behind "Mic (clean)")
  const offFiles = [path.join(os.homedir(), '.config/pipewire'), path.join(os.homedir(), '.config/wireplumber')]
    .flatMap((d) => walkFiles(d, (n) => n.endsWith('.mic-dashboard-off'))).map((p) => ({ path: p, content: readSafe(p) }));
  for (const f of [...findFilterConfigs(), ...offFiles]) {
    const m = f.content.match(/plugin\s*=\s*"?([^"\s}]*rnnoise[^"\s}]*\.so)/i);
    if (m && fs.existsSync(m[1].replace(/^~/, os.homedir()))) return m[1].replace(/^~/, os.homedir());
  }
  return null;
}

const COMP_CANDIDATES = ['/usr/lib/ladspa/sc4m_1916.so', '/usr/lib/x86_64-linux-gnu/ladspa/sc4m_1916.so', '/usr/lib/aarch64-linux-gnu/ladspa/sc4m_1916.so', '/usr/lib64/ladspa/sc4m_1916.so', '/usr/local/lib/ladspa/sc4m_1916.so', path.join(os.homedir(), '.ladspa/sc4m_1916.so')];
const findComp = () => COMP_CANDIDATES.find((p) => fs.existsSync(p)) || scanLadspa(/^sc4m_1916\.so$/) || null;
let compBroken = false; // set if the chain failed to start with the compressor
let compInstall = { running: false, log: '', ok: null };
// swh-plugins has a different package name per distro
function compPkg() {
  if (which('apt-get')) return { pm: 'apt-get', pkg: 'swh-plugins', args: ['install', '-y', 'swh-plugins'], cmd: 'sudo apt install swh-plugins' };
  if (which('dnf')) return { pm: 'dnf', pkg: 'ladspa-swh-plugins', args: ['install', '-y', 'ladspa-swh-plugins'], cmd: 'sudo dnf install ladspa-swh-plugins' };
  if (which('pacman')) return { pm: 'pacman', pkg: 'swh-plugins', args: ['-S', '--noconfirm', 'swh-plugins'], cmd: 'sudo pacman -S swh-plugins' };
  if (which('zypper')) return { pm: 'zypper', pkg: 'ladspa-swh-plugins', args: ['--non-interactive', 'install', 'ladspa-swh-plugins'], cmd: 'sudo zypper install ladspa-swh-plugins' };
  return null;
}
async function compDiagnose() {
  const d = { searched: ladspaDirs().map((p) => ({ p, exists: fs.existsSync(p) })) };
  const q = which('dpkg-query') ? await run('dpkg-query', ['-W', '-f=${Package} ${Status}\\n', 'swh-plugins', 'swh-lv2']) : { out: '' };
  const st = (name) => (q.out.split('\n').find((l) => l.startsWith(name + ' ')) || '').includes('install ok installed');
  d.swhPlugins = st('swh-plugins');
  d.swhLv2 = st('swh-lv2');
  // sandboxed terminal (Flatpak VS Code, Snap...) hides /usr of the real system
  d.sandbox = fs.existsSync('/.flatpak-info') ? 'flatpak' : process.env.SNAP ? 'snap' : fs.existsSync('/run/.containerenv') || fs.existsSync('/.dockerenv') ? 'container' : '';
  d.pkexec = await has('pkexec');
  const pk = compPkg(); d.installCmd = pk ? pk.cmd : 'sudo apt install swh-plugins'; d.pm = pk ? pk.pm : '';
  d.install = compInstall;
  return d;
}

// Set when PipeWire refused to start the chain with the compressor.
const comp = { get broken() { return compBroken; }, set broken(v) { compBroken = !!v; } };

async function installComp() {
  if (findComp()) return { ok: true, already: true, path: findComp() };
  if (compInstall.running) return { ok: true, running: true };
  const pk = compPkg();
  if (!pk || !(await has('pkexec'))) throw new Error('نفّذ في التيرمنال:  ' + (pk ? pk.cmd : 'sudo apt install swh-plugins'));
  compInstall = { running: true, log: '', ok: null };
  // runs in the background: pkexec shows the system password dialog
  run('pkexec', [pk.pm, ...pk.args], { timeout: 600000 }).then((r) => {
    compInstall = { running: false, ok: r.ok && !!findComp(), log: (r.out + '\n' + r.err).trim().split('\n').slice(-12).join('\n') };
    compBroken = false;
  });
  return { ok: true, started: true };
}

async function installRnnoise() {
  if (findRnnoise()) return { ok: true, path: findRnnoise(), already: true };
  if (process.arch !== 'x64') throw new Error(`النسخة الجاهزة من RNNoise لـ x86_64 بس، وجهازك ${process.arch}. سطّبها من مدير الحزم (مثلًا: sudo apt install noise-suppression-for-voice) أو اعمل build من github.com/werman/noise-suppression-for-voice`);
  const dir = path.join(os.homedir(), '.ladspa'); fs.mkdirSync(dir, { recursive: true });
  const zip = path.join(os.tmpdir(), 'linux-rnnoise.zip');
  const url = 'https://github.com/werman/noise-suppression-for-voice/releases/download/v1.10/linux-rnnoise.zip';
  const dl = await run('curl', ['-fsSL', '-o', zip, url], { timeout: 120000 });
  if (!dl.ok) throw new Error('مقدرتش أنزّل RNNoise (فيه نت؟): ' + dl.err.trim().slice(0, 160));
  const py = `import zipfile,sys\nz=zipfile.ZipFile(sys.argv[1])\nn=[x for x in z.namelist() if x.endswith('ladspa/librnnoise_ladspa.so')][0]\nopen(sys.argv[2],'wb').write(z.read(n))`;
  let ex = await run('python3', ['-c', py, zip, path.join(dir, 'librnnoise_ladspa.so')], { timeout: 30000 });
  if (!ex.ok && which('unzip')) ex = await run('unzip', ['-jo', zip, '*/ladspa/librnnoise_ladspa.so', '-d', dir], { timeout: 30000 });
  if (!ex.ok) throw new Error('فك الضغط فشل: ' + ex.err.trim().slice(0, 160));
  return { ok: true, path: findRnnoise() };
}

module.exports = { ladspaDirs, findRnnoise, findComp, compPkg, compDiagnose, installComp, installRnnoise, comp };
