'use strict';
// Running system commands without a shell, on Linux, macOS and Windows.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const IS_WIN_HOST = process.platform === 'win32';

function run(cmd, args, { timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err ? (err.code ?? 1) : 0, out: String(stdout || ''), err: String(stderr || (err && err.message) || '') });
    });
  });
}

// Looks a program up on PATH.
function which(cmd) {
  const exts = IS_WIN_HOST ? (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').filter(Boolean) : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const f = path.join(dir, cmd + ext);
      try { fs.accessSync(f, IS_WIN_HOST ? fs.constants.F_OK : fs.constants.X_OK); if (fs.statSync(f).isFile()) return f; } catch {}
    }
  }
  return null;
}
async function has(cmd) { return !!which(cmd); }

module.exports = { run, which, has };
