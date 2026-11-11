'use strict';
// Config files that define filters (so you can see where an old "Mic (clean)" lives).
const fs = require('fs');
const os = require('os');
const path = require('path');

// Find config files that define filters (so you can see where "Mic (clean)" is defined).
function findFilterConfigs() {
  const roots = [path.join(os.homedir(), '.config/pipewire'), path.join(os.homedir(), '.config/wireplumber'), '/etc/pipewire', path.join(os.homedir(), '.config/easyeffects')];
  const found = [];
  const walk = (dir, depth = 0) => {
    if (depth > 4) return;
    let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (/\.(conf|json|lua)$/.test(e.name)) {
        try {
          const txt = fs.readFileSync(p, 'utf8');
          if (/filter-chain|rnnoise|noise|echo-cancel|clean|ladspa|lv2/i.test(txt)) found.push({ path: p, content: txt.slice(0, 20000) });
        } catch {}
      }
    }
  };
  roots.forEach((r) => walk(r));
  return found;
}

module.exports = { findFilterConfigs };
