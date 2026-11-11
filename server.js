#!/usr/bin/env node
// Mic Clean without the desktop app: `node server.js`, then open http://localhost:4747
// The code lives in src/ (see src/server.js). This file stays so older installs keep working.
'use strict';

const app = require('./src/server');
const { APP } = require('./src/core/config');

if (require.main === module) {
  app.start().then(() => console.log(`  Ctrl+C يقفل السيرفر ويشيل المايك الوهمي ${APP.desc}.\n`)).catch((e) => { console.error(e.message); process.exit(1); });
  let exiting = false;
  const shutdown = async () => {
    if (exiting) return; exiting = true;
    console.log(`\nبقفل ${APP.name}…`);
    await app.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Kept for tests and older scripts.
const { parsePactlList, classifySource } = require('./src/modules/linux/pactl');
const { buildChainConf } = require('./src/modules/linux/chain-conf');
const { DEFAULT_SETTINGS } = require('./src/modules/settings');
module.exports = { parsePactlList, classifySource, buildChainConf, DEFAULT_SETTINGS };
