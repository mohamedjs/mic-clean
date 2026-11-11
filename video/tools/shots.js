#!/usr/bin/env node
// Takes the landing-page screenshots from the real app window:
//   node video/tools/shots.js <devtools-port> <out-dir>
// The app must be running with --remote-debugging-port=<port>.
'use strict';
const path = require('path');
const fs = require('fs');
const { connect } = require('./cdp');

const [port = '9333', out = 'site/assets'] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const c = await connect(Number(port), (p) => /127\.0\.0\.1/.test(p.url));
  await c.send('Page.enable');
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 860, deviceScaleFactor: 1, mobile: false });
  await c.evaluate('location.reload()'); await sleep(2500);
  const tab = async (name) => { await c.evaluate(`document.querySelector('[data-tab=${name}]').click(); scrollTo(0,0); 1`); await sleep(900); };

  await tab('home'); await c.shot(path.join(out, 'app-home.png'));
  await tab('tune'); await c.shot(path.join(out, 'app-tune.png'));
  // monitoring with live meters, on side B = the clean mic
  await c.evaluate(`fetch('/api/clean/start',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}).then(r=>r.json()).then(j=>j.ok)`); await sleep(1500);
  await tab('monitor');
  await c.evaluate(`document.getElementById('micBtn').click(); 1`); await sleep(2500);
  await c.evaluate(`(async()=>{const d=(await navigator.mediaDevices.enumerateDevices()).find(x=>x.kind==='audioinput'&&/mic clean/i.test(x.label)); if(d){const b=document.getElementById('devB'); b.value=d.deviceId; b.dispatchEvent(new Event('change'));} document.getElementById('abB').click(); return !!d})()`); await sleep(3500);
  await c.evaluate(`document.getElementById('cbCard')?.scrollIntoView({block:'start'}); scrollBy(0, 380); 1`); await sleep(1200);
  await c.shot(path.join(out, 'app-monitor.png'));
  await c.evaluate(`document.getElementById('micBtn').click(); scrollTo(0,0); fetch('/api/clean/stop',{method:'POST'}).then(()=>1)`);
  await tab('mics'); await c.shot(path.join(out, 'app-mics.png'));
  await tab('advanced'); await c.shot(path.join(out, 'app-advanced.png'));
  await tab('home');
  c.close();
  console.log('shots in', out);
})().catch((e) => { console.error(e); process.exit(1); });
