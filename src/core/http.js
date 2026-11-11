'use strict';
// A tiny HTTP layer: JSON routes ('METHOD /path' → handler) and static files.
const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

function send(res, code, body, type = 'application/json') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = ''; req.on('data', (c) => { d += c; if (d.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { resolve({}); } });
  });
}
const validName = (n) => typeof n === 'string' && /^[\w.\-:@]+$/.test(n);

// mounts: [['/shared/', dir], ['/', dir]] — first prefix that matches wins.
function createServer(routes, mounts) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const key = `${req.method} ${url.pathname}`;
    if (routes[key]) {
      // Only same-origin writes: other websites in your browser must not drive your mic.
      if (req.method !== 'GET') {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${req.headers.host}`) return send(res, 403, { ok: false, error: 'طلب من موقع تاني — مرفوض' });
      }
      try { send(res, 200, await routes[key](req.method === 'POST' ? await readBody(req) : {})); }
      catch (e) { send(res, 400, { ok: false, error: e.message }); }
      return;
    }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { ok: false, error: 'not found' });
    const [prefix, dir] = mounts.find(([p]) => url.pathname.startsWith(p));
    const rel = url.pathname.slice(prefix.length) || 'index.html';
    const file = path.normalize(path.join(dir, rel));
    if (!file.startsWith(dir)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(file, (err, data) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream'));
  });
}

module.exports = { send, readBody, validName, createServer };
