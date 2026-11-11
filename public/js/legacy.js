// ===== Old mic takeover =====
(() => {
  'use strict';
  const q = (id) => document.getElementById(id);
  if (!q('legacyCard')) return;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const post = async (p, b) => { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b || {}) }); return r.json().catch(() => ({ ok: false, error: 'رد غلط' })); };
  const TYPE = {
    config: ['📄 ملف إعدادات PipeWire', 'بيتحمّل مع PipeWire كل مرة الجهاز يفتح.'],
    service: ['⚙️ خدمة بتشتغل مع الجهاز', 'خدمة systemd بتشغّل الفلتر أوتوماتيك.'],
    autostart: ['🚀 برنامج بيفتح مع الدخول', 'بيتشغّل لما تعمل login.'],
    module: ['🧩 موديول شغال دلوقتي', 'فلتر متحمّل دلوقتي في الصوت.'],
    process: ['▶ برنامج شغال دلوقتي', 'برنامج مشغّل فلتر في الخلفية.'],
  };
  const say = (m) => { const t = q('toast'); if (t) { t.textContent = m; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), 4000); } };
  function render(items) {
    const on = items.filter((x) => x.enabled);
    const badge = q('lgBadge');
    badge.textContent = on.length ? `${on.length} شغال` : 'مفيش حاجة قديمة ✓';
    badge.className = 'badge ' + (on.length ? 'b-filter' : 'b-hardware');
    q('lgAll').disabled = !on.some((x) => x.canChange);
    if (!items.length) { q('lgList').innerHTML = '<div class="status">✓ مفيش أي مايك نضيف قديم. الداشبورد بقت هي الوحيدة اللي بتتحكم.</div>'; return; }
    q('lgList').innerHTML = items.map((it) => {
      const [t, d] = TYPE[it.type] || [it.type, ''];
      const what = it.names?.length ? `بيعمل: <b>${it.names.map(esc).join('، ')}</b>` : '';
      const where = it.path ? `<div class="mono muted" style="margin-top:2px">${esc(it.path)}</div>` : it.detail ? `<div class="mono muted">${esc(it.detail)}</div>` : '';
      const btn = !it.canChange
        ? `<div class="small" style="margin-top:6px">محتاج sudo. انسخ ونفّذ في التيرمنال:</div><pre>${esc(it.manual)}</pre>`
        : it.enabled
          ? `<button class="btn danger" data-lg-off="${esc(it.id)}">⏻ اقفله</button>`
          : `<button class="btn mint" data-lg-on="${esc(it.id)}">↩ رجّعه</button>`;
      return `<div class="status" style="margin-bottom:10px;${it.enabled ? '' : 'opacity:.75'}">
        <div class="row"><b>${t}</b><span class="badge ${it.enabled ? 'b-filter' : 'b-unknown'}">${it.enabled ? 'شغال' : 'مقفول'}</span><span class="sp" style="flex:1"></span>${it.canChange ? btn : ''}</div>
        <div class="small muted">${d} ${what}</div>${where}${it.canChange ? '' : btn}
      </div>`;
    }).join('');
  }
  async function load() {
    q('lgList').innerHTML = 'بيدوّر…';
    const r = await fetch('/api/legacy').then((x) => x.json()).catch(() => ({ ok: false }));
    if (!r.ok) { q('lgList').innerHTML = '<div class="status err">مقدرتش أدوّر. شغّل السيرفر الجديد (Ctrl+C وبعدين node server.js).</div>'; return; }
    q('lgAuto').checked = !!r.autoStart;
    render(r.items);
  }
  q('lgList').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const id = b.dataset.lgOff || b.dataset.lgOn; if (!id) return;
    b.disabled = true; b.textContent = '⏳ لحظة…';
    const r = await post(b.dataset.lgOff ? '/api/legacy/disable' : '/api/legacy/enable', { id });
    if (!r.ok) { say('⚠ ' + r.error); load(); return; }
    say(r.restarted ? '✓ اتعمل و PipeWire اتعمله restart' : '✓ اتعمل');
    render(r.items); if (typeof refresh === 'function') setTimeout(refresh, 800);
  });
  q('lgAll').onclick = async () => {
    q('lgAll').disabled = true; q('lgAll').textContent = '⏳ بيقفل…';
    const r = await post('/api/legacy/disable-all');
    q('lgAll').textContent = '🧹 اقفل كل القديم';
    if (!r.ok) { say('⚠ ' + r.error); return load(); }
    say(r.errors?.length ? '⚠ فيه حاجات مقفلتش: ' + r.errors.join(' | ') : '✓ كل القديم اتقفل. شغّل المايك النضيف من الرئيسية');
    render(r.items); if (typeof refresh === 'function') setTimeout(refresh, 1500);
  };
  q('lgRefresh').onclick = load;
  q('lgAuto').onchange = async (e) => { const r = await post('/api/clean/autostart', { on: e.target.checked }); if (r.ok) say(r.autoStart ? '✓ المايك النضيف هيشتغل لوحده مع الأبلكيشن' : 'المايك النضيف مش هيشتغل لوحده'); };
  load();
})();
