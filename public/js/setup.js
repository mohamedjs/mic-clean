// Mic Clean — "is this computer ready?": shows what the app needs (GET /api/deps),
// what is missing and the one step that fixes each.
(() => {
  'use strict';
  const card = document.getElementById('setupCard');
  if (!card) return;
  const list = document.getElementById('setupList'), badge = document.getElementById('setupBadge');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const LEVEL = { required: 'لازم', recommended: 'مستحسن', optional: 'اختياري' };
  const ACTION = { rnnoise: ['/api/rnnoise/install', '⬇ نزّله'], comp: ['/api/comp/install', '⬇ سطّبه'] };

  function row(it) {
    const fix = it.ok ? '' : [
      it.fix?.action ? `<button class="btn primary" data-act="${esc(it.fix.action)}">${ACTION[it.fix.action][1]}</button>` : '',
      it.fix?.url ? `<a class="btn" href="${esc(it.fix.url)}" target="_blank" rel="noopener">↗ صفحة التحميل</a>` : '',
      it.fix?.cmd ? `<span class="cmd"><code>${esc(it.fix.cmd)}</code><button class="copy" data-copy="${esc(it.fix.cmd)}">نسخ</button></span>` : '',
    ].join(' ');
    return `<div class="dep ${it.ok ? 'ok' : it.level}">
      <span class="dep-icon">${it.ok ? '✅' : it.level === 'required' ? '⛔' : it.level === 'recommended' ? '⚠️' : '➖'}</span>
      <div class="dep-body"><div><b>${esc(it.name)}</b> <span class="badge ${it.ok ? 'b-hardware' : it.level === 'required' ? 'b-error' : 'b-unknown'}">${it.ok ? 'موجود' : LEVEL[it.level]}</span></div>
      <div class="small muted">${esc(it.why)}</div>${fix ? `<div class="row small" style="margin-top:6px">${fix}</div>` : ''}</div></div>`;
  }

  async function check() {
    let r;
    try { r = await (await fetch('/api/deps', { cache: 'no-store' })).json(); } catch { return; }
    if (!r?.ok) return;
    const missing = r.items.filter((i) => !i.ok && i.level !== 'optional');
    card.hidden = !missing.length && card.dataset.forced !== '1';
    badge.textContent = !missing.length ? 'كله جاهز' : r.ready ? 'شغال، وفيه حاجات تحسّنه' : 'ناقص حاجة';
    badge.className = 'badge ' + (!missing.length ? 'b-hardware' : r.ready ? 'b-unknown' : 'b-error');
    list.innerHTML = r.items.map(row).join('');
  }

  list.addEventListener('click', async (e) => {
    const c = e.target.closest('[data-copy]');
    if (c) { try { await navigator.clipboard.writeText(c.dataset.copy); c.textContent = '✓ اتنسخ'; setTimeout(() => (c.textContent = 'نسخ'), 1500); } catch {} return; }
    const b = e.target.closest('[data-act]'); if (!b) return;
    const [url] = ACTION[b.dataset.act];
    b.disabled = true; b.textContent = '… بيشتغل';
    try {
      const r = await (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).json();
      if (!r.ok) throw new Error(r.error || 'فشل');
      for (let i = 0; i < 120 && r.started; i++) { await new Promise((res) => setTimeout(res, 2000)); const d = await (await fetch('/api/deps')).json(); if (d.items.find((x) => x.fix?.action === b.dataset.act)?.ok) break; }
    } catch (err) { b.textContent = '⚠ ' + err.message; return; }
    card.dataset.forced = '1';
    check();
  });

  check();
  setInterval(() => { if (!document.hidden) check(); }, 30000);
  window.MicSetup = { check, show() { card.dataset.forced = '1'; card.hidden = false; check(); } };
})();
