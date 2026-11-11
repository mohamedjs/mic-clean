'use strict';
// App-wide constants: the app's name, where it keeps its files, which OS it is
// running on and which audio engine that means.
const os = require('os');
const path = require('path');
const { which } = require('./exec');

const APP = {
  name: 'Mic Clean',
  id: 'mic-clean',
  // The virtual microphone other apps record from (Linux). Zoom/OBS remember mics by name.
  node: 'mic_clean',
  desc: 'Mic Clean',
  capture: 'capture.mic_clean',
  echoRef: 'mic_clean_echo_ref',
};

const PORT = Number(process.env.PORT || 4747);
const HOST = process.env.HOST || '127.0.0.1';

// MIC_PLATFORM=darwin|win32|linux overrides detection (to try another OS's UI).
const PLATFORM = process.env.MIC_PLATFORM || process.platform;
const IS_WIN_HOST = process.platform === 'win32';
const IS_MAC = PLATFORM === 'darwin';
const IS_WIN = PLATFORM === 'win32';
// Linux without pactl/PipeWire (or MIC_ENGINE=web): the in-window engine, as on macOS/Windows.
const LINUX_WEB = !IS_MAC && !IS_WIN && (process.env.MIC_ENGINE === 'web' || !which('pactl'));
const BROWSER_MODE = IS_MAC || IS_WIN || LINUX_WEB;
const MODE = IS_MAC ? 'darwin' : IS_WIN ? 'win32' : LINUX_WEB ? 'web' : 'linux';

// The settings folder kept its first name so nobody loses their settings.
const STATE_DIR = process.env.MIC_STATE_DIR
  || (IS_WIN_HOST && process.env.APPDATA ? path.join(process.env.APPDATA, 'mic-clean-dashboard') : path.join(os.homedir(), '.config', 'mic-clean-dashboard'));

const ROOT = path.join(__dirname, '..', '..');
const PATHS = {
  root: ROOT,
  public: path.join(ROOT, 'public'),
  shared: path.join(ROOT, 'src', 'shared'),
  stateDir: STATE_DIR,
  settings: path.join(STATE_DIR, 'settings.json'),
  chainConf: path.join(STATE_DIR, 'mic-clean-chain.conf'),
};

module.exports = { APP, PORT, HOST, PLATFORM, IS_WIN_HOST, IS_MAC, IS_WIN, LINUX_WEB, BROWSER_MODE, MODE, PATHS };
