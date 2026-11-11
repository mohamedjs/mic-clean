'use strict';
const fs = require('fs');
const path = require('path');

function walkFiles(dir, test, depth = 0, out = []) {
  if (depth > 4) return out;
  let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkFiles(p, test, depth + 1, out);
    else if (test(e.name)) out.push(p);
  }
  return out;
}
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return ''; } };

module.exports = { walkFiles, readSafe };
