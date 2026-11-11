'use strict';
// Mic Clean — desktop app. Runs the local server inside the app and shows it in
// its own window. Linux: the server cleans the audio (PipeWire). macOS/Windows:
// this window cleans it (Web Audio + RNNoise) into BlackHole / VB-CABLE, so the
// window hides to the tray instead of closing.
const { app, BrowserWindow, Tray, Menu, shell, session, systemPreferences, nativeImage, dialog } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ICON = path.join(ROOT, 'public', 'icons', 'icon-512.png');
const HIDDEN = process.argv.includes('--hidden');

// RNNoise ships inside the Linux packages (resources/ladspa), so nothing to download.
const bundled = path.join(process.resourcesPath || '', 'ladspa', 'librnnoise_ladspa.so');
if (process.platform === 'linux' && !process.env.RNNOISE_LADSPA && fs.existsSync(bundled)) process.env.RNNOISE_LADSPA = bundled;

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const server = require('../src/server');
let win = null, tray = null, port = null, quitting = false;

// ---- start at login ------------------------------------------------------------
const prefsFile = () => path.join(app.getPath('userData'), 'desktop.json');
const prefs = () => { try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); } catch { return {}; } };
const savePrefs = (p) => { fs.mkdirSync(path.dirname(prefsFile()), { recursive: true }); fs.writeFileSync(prefsFile(), JSON.stringify(p, null, 2)); };
const linuxAutostartFile = path.join(os.homedir(), '.config', 'autostart', 'mic-clean.desktop');

function setOpenAtLogin(on) {
  if (process.platform === 'linux') {
    const exec = process.env.APPIMAGE || process.execPath;
    if (on) {
      fs.mkdirSync(path.dirname(linuxAutostartFile), { recursive: true });
      fs.writeFileSync(linuxAutostartFile, `[Desktop Entry]\nType=Application\nName=Mic Clean\nExec="${exec}" --hidden\nIcon=mic-clean\nX-GNOME-Autostart-enabled=true\nNoDisplay=false\n`);
    } else { try { fs.unlinkSync(linuxAutostartFile); } catch {} }
  } else {
    app.setLoginItemSettings({ openAtLogin: on, openAsHidden: true, args: ['--hidden'] });
  }
  savePrefs({ ...prefs(), openAtLogin: on });
}
const openAtLogin = () => prefs().openAtLogin !== false;

// ---- window ----------------------------------------------------------------------
function createWindow() {
  // MIC_CLEAN_WINDOW=1440x810: exact content size (used to film the explainer video)
  const [w, h] = (process.env.MIC_CLEAN_WINDOW || '1180x860').split('x').map(Number);
  win = new BrowserWindow({
    width: w, height: h, useContentSize: !!process.env.MIC_CLEAN_WINDOW, minWidth: 380, minHeight: 520,
    title: 'Mic Clean', icon: ICON, show: !HIDDEN, autoHideMenuBar: true, backgroundColor: '#ebe8f7',
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false },
  });
  win.setMenuBarVisibility(false);
  win.loadURL(`http://127.0.0.1:${port}/`);
  // links to download pages open in the real browser
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(`http://127.0.0.1:${port}`)) { e.preventDefault(); if (/^https?:/.test(url)) shell.openExternal(url); } });
  win.on('close', (e) => {
    if (quitting) return;
    e.preventDefault(); win.hide(); // keep cleaning in the background
    if (!prefs().toldTray) { savePrefs({ ...prefs(), toldTray: true }); tray?.displayBalloon?.({ title: 'Mic Clean', content: 'شغال في الخلفية. افتحه من الأيقونة جنب الساعة.' }); }
  });
}
function show() { if (!win) createWindow(); win.show(); win.focus(); }

function createTray() {
  try {
    const img = nativeImage.createFromPath(ICON).resize({ width: process.platform === 'darwin' ? 18 : 22 });
    tray = new Tray(img);
  } catch { tray = null; return; }
  const menu = () => Menu.buildFromTemplate([
    { label: 'افتح Mic Clean', click: show },
    { type: 'separator' },
    { label: 'يفتح مع الجهاز', type: 'checkbox', checked: openAtLogin(), click: (i) => { setOpenAtLogin(i.checked); tray.setContextMenu(menu()); } },
    { type: 'separator' },
    { label: 'اقفل Mic Clean', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setToolTip('Mic Clean');
  tray.setContextMenu(menu());
  tray.on('click', show);
}

// ---- permissions: the mic, and choosing the output device (setSinkId) ------------
function allowMedia() {
  const ours = (origin) => origin && origin.startsWith(`http://127.0.0.1:${port}`);
  const ok = new Set(['media', 'speaker-selection', 'clipboard-sanitized-write', 'clipboard-read', 'notifications']);
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb, details) => cb(ok.has(perm) && ours(details?.requestingUrl || wc.getURL())));
  session.defaultSession.setPermissionCheckHandler((wc, perm, origin) => ok.has(perm) && ours(origin || wc?.getURL()));
}

app.on('second-instance', show);
app.on('activate', show); // macOS dock click

app.whenReady().then(async () => {
  if (app.isPackaged && !process.env.MIC_CLEAN_TEST) { // MIC_CLEAN_TEST: CI/smoke runs leave login items alone
    try { await require('../src/modules/migrate').removeOldAutostart(); } catch {}
    if (prefs().openAtLogin === undefined) setOpenAtLogin(true); // a mic app is expected to be there at login
  }
  try { port = await server.start({ quiet: true }); }
  catch (e) { dialog.showErrorBox('Mic Clean', 'مقدرتش أشغّل السيرفر المحلي: ' + e.message); app.exit(1); return; }
  allowMedia();
  if (process.platform === 'darwin') { try { await systemPreferences.askForMediaAccess('microphone'); } catch {} }
  createTray();
  createWindow();
});

// Closing every window does not quit (the tray keeps it running).
app.on('window-all-closed', () => {});

// On quit (menu, logout, kill): remove the virtual mic and hand the default mic back.
// Without this the PipeWire child would outlive the app and leave "Mic Clean" behind.
for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(sig, () => { quitting = true; app.quit(); });
let stopping = false;
app.on('before-quit', (e) => {
  quitting = true;
  if (stopping) return;
  e.preventDefault(); stopping = true;
  Promise.race([server.stop(), new Promise((r) => setTimeout(r, 4000))]).finally(() => app.exit(0));
});
