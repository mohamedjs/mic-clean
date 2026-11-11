'use strict';
// The app used to be called "Mic (Mohamed)" and ran as a background server started
// by an install script. The desktop app runs its own server, so the old one would
// fight it for port 4747 and make a second virtual mic. This switches the old one off.
// Nothing is deleted outside the old autostart entries.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../core/exec');

async function removeOldAutostart() {
  const done = [];
  const home = os.homedir();
  if (process.platform === 'linux') {
    const unit = path.join(home, '.config/systemd/user/mic-mohamed.service');
    if (fs.existsSync(unit)) {
      await run('systemctl', ['--user', 'disable', '--now', 'mic-mohamed.service'], { timeout: 15000 });
      try { fs.unlinkSync(unit); } catch {}
      await run('systemctl', ['--user', 'daemon-reload']);
      done.push('systemd: mic-mohamed.service');
    }
  } else if (process.platform === 'darwin') {
    const plist = path.join(home, 'Library/LaunchAgents/com.mohamed.mic.plist');
    if (fs.existsSync(plist)) {
      await run('launchctl', ['bootout', `gui/${os.userInfo().uid}/com.mohamed.mic`]);
      try { fs.unlinkSync(plist); } catch {}
      done.push('LaunchAgent: com.mohamed.mic');
    }
  } else if (process.platform === 'win32' && process.env.APPDATA) {
    const lnk = path.join(process.env.APPDATA, 'Microsoft/Windows/Start Menu/Programs/Startup/Mic (Mohamed).lnk');
    if (fs.existsSync(lnk)) { try { fs.unlinkSync(lnk); done.push('Startup: Mic (Mohamed).lnk'); } catch {} }
  }
  return done;
}

module.exports = { removeOldAutostart };
