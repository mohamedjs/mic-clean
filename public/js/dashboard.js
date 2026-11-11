// Mic Clean — the main window: status, sources, filter controls, the clean mic, monitoring.
'use strict';
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const toast = (msg, ms = 2500) => { const t = $('toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); };
const api = async (path, body) => {
  const r = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const j = await r.json().catch(() => ({ ok: false, error: 'رد غلط من السيرفر' }));
  if (j.ok === false && j.error) toast('⚠ ' + j.error, 5000);
  return j;
};
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const setNow = (el, text, level = '') => { el.innerHTML = text; el.className = 'now' + (level ? ' ' + level : ''); };
const L = (s) => `<span class="ltr">${s}</span>`;

// ---- tab switching ----
document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    $('tab-' + btn.dataset.tab).classList.add('active');
  });
});

let STATUS = null, SETTINGS = null, EQF = [], interacting = false;
const STATE_AR = { RUNNING: 'شغال دلوقتي', IDLE: 'جاهز', SUSPENDED: 'نايم (محدش بيسجل منه)' };

// ------------------------------------------------------------ live value descriptions (engine)
const describe = {
  vad: (v) => v === 0 ? ['مقفولة: RNNoise بيقلل الضوضاء بس، ومش بيكتم السكوت خالص.', ''] :
    v <= 30 ? ['خفيفة: مفيش تقطيع للكلام تقريبًا، بس فيه ضوضاء خفيفة بين الكلام.', 'good'] :
    v <= 70 ? ['متوسطة (الموصى بيها): توازن كويس بين السكوت الصامت والكلام الطبيعي.', 'good'] :
    v <= 90 ? ['قوية: السكوت صامت تمامًا، بس خد بالك من أول الكلمات والكلام الواطي.', 'warn'] :
    ['قوية جدًا: غالبًا هتقطع كلام. علّي الـ Grace أو وطّيها.', 'bad'],
  grace: (v) => v < 100 ? ['سريع جدًا: آخر الكلمات ممكن تتاكل والصوت يبان متقطع.', 'warn'] :
    v <= 400 ? ['طبيعي: آخر الكلام بيطلع كويس.', 'good'] :
    ['طويل: هتسمع ضوضاء بتفضل شوية بعد ما تسكت.', 'warn'],
  retro: (v) => v === 0 ? ['مقفول: مفيش تأخير زيادة.', 'good'] :
    v <= 50 ? [`بيضيف تأخير ${L(v + ' ms')}، ومش هتحس بيه تقريبًا.`, 'good'] :
    [`بيضيف تأخير ${L(v + ' ms')} في صوتك، وممكن يتلاحظ في المكالمات.`, 'warn'],
  hp: (v) => v === 0 ? ['مقفول: كل الترددات الواطية بتعدي، بما فيها الزن والخبط.', ''] :
    v < 60 ? ['خفيف: بيشيل الاهتزازات والخبط بس.', 'good'] :
    v <= 120 ? ['موصى بيه للكلام: بيشيل الزن والتكييف ومحافظ على عمق صوتك.', 'good'] :
    v <= 180 ? ['قوي: صوتك هيخف شوية ويبان أرفع.', 'warn'] :
    ['قوي جدًا: صوتك هيبان رفيع زي التليفون.', 'bad'],
  og: (v) => v === 0 ? ['من غير تغيير.', ''] :
    v < 0 ? [`بيوطّي الصوت ${L(v + ' dB')} (تقريبًا ×${Math.pow(10, v / 20).toFixed(2)}).`, ''] :
    v <= 9 ? [`بيعلّي الصوت ${L('+' + v + ' dB')} (تقريبًا ×${Math.pow(10, v / 20).toFixed(1)}). راقب الـ Peak.`, 'good'] :
    [`تعلية كبيرة ${L('+' + v + ' dB')}: غالبًا هيحصل تكسير. الأحسن تعلّي جين المايك نفسه.`, 'bad'],
};
const EQ_INFO = {
  31: ['الزن والرعشة (Sub-bass)', 'اهتزاز الترابيزة وصوت العربيات من بعيد. الكلام تقريبًا مفيهوش حاجة هنا.', 'مفيش فايدة تقريبًا، هتعلّي الزن بس.', 'بينضّف الصوت من الاهتزازات من غير ما يأثر على صوتك.'],
  63: ['الهمهمة (Hum)', 'زن الكهربا (50Hz) والتكييف والمروحة، والعمق التقيل في الأصوات التخينة.', 'صوت "تقيل" و"بومبة"، والزن يعلى.', 'بيشيل زن الكهربا والتكييف. غالبًا وطّيه.'],
  125: ['العمق (Body)', 'التُّخن والدفا بتوع الصوت الرجالي.', 'صوت أدفى وأتخن، بس لو زاد يبقى "مكتوم".', 'صوت أخف وأرفع.'],
  250: ['الكتمة (Boxy/Muddy)', 'المنطقة اللي بتخلي الصوت "جوه علبة" أو "من ورا باب".', 'الصوت يبقى مكتوم وغير واضح.', 'الصوت يبقى أنضف وأوضح. المايكات الرخيصة غالبًا محتاجة توطية هنا.'],
  500: ['الصوت الأنفي (Honky)', 'الرنين الأنفي، والصوت اللي زي "التليفون القديم".', 'صوت أنفي ورخيص.', 'بيقلل الرنين الأنفي، وتوطية بسيطة بتخلي الصوت أنعم.'],
  1000: ['الحضور الأساسي', 'جسم الحروف ووضوح الكلام.', 'صوتك "قدام" أكتر، بس لو زاد يبقى مزعج.', 'صوتك يبعد ويبقى أضعف.'],
  2000: ['وضوح الحروف (Presence)', 'أهم منطقة إن الناس "تفهم" كلامك: الحروف الساكنة.', 'كلام أوضح ومفهوم أكتر في المكالمات.', 'كلام أنعم بس أقل وضوحًا.'],
  4000: ['الحدة (Bite)', 'حدة الصوت، وبداية منطقة السين والشين.', 'وضوح زيادة، بس لو كتير الصوت يبقى حاد ومتعب للودن.', 'بيهدّي الحدة ويخلي الصوت مريح.'],
  8000: ['السين والشين (Sibilance)', 'صوت "سسس" و"شششش"، والهسهسة بتاعة المايك.', 'تفاصيل أكتر، بس السين بتصفّر والهسهسة تعلى.', 'بيخفف تصفير السين والهسهسة.'],
  16000: ['الهوا (Air)', 'اللمعة والإحساس بـ"الفضا"، وهنا بيقعد أغلب الهسهسة الإلكترونية.', 'لمعة، بس الهسهسة بتعلى جامد في المايكات الرخيصة.', 'بيشيل الهسهسة، والكلام نفسه تقريبًا مش بيتأثر.'],
};
const fmtHz = (f) => f >= 1000 ? f / 1000 + 'k' : f;
function describeBand(i) {
  const b = SETTINGS.eq[i], info = EQ_INFO[b.freq] || ['', '', '', ''];
  const g = Number(b.gain);
  const eff = g === 0 ? 'مش متغير دلوقتي.' : g > 0 ? `▲ متعلّي ${L('+' + g + ' dB')}: ${info[2]}` : `▼ متوطّي ${L(g + ' dB')}: ${info[3]}`;
  setNow($('eqNow'), `<b>${L(fmtHz(b.freq) + 'Hz')} · ${info[0]}</b>: ${info[1]}<br>${eff}${Math.abs(g) > 8 ? '<br>⚠ تغيير كبير. أكتر من ±8 dB غالبًا بيبوّظ طبيعية الصوت.' : ''}`, g === 0 ? '' : Math.abs(g) > 8 ? 'warn' : 'good');
  document.querySelectorAll('.eq .band').forEach((el, j) => el.classList.toggle('sel', j === i));
}

// ------------------------------------------------------------ existing filter param help
function paramHelp(key, value) {
  const k = key.toLowerCase(), v = Number(value);
  const node = key.includes(':') ? key.split(':')[0] : '';
  if (/vad threshold/.test(k)) { const [d, lv] = describe.vad(v); return { title: 'قوة البوابة (VAD Threshold)', what: 'نسبة الثقة اللي لازم الصوت يوصلها عشان يتعامل على إنه كلام. أي حاجة تحتها بتتكتم.', up: 'السكوت يبقى صامت تمامًا، بس الكلام الواطي وأول الكلمات ممكن يتقطعوا.', down: 'مفيش تقطيع، بس فيه ضوضاء خفيفة في السكوت.', now: d, lv }; }
  if (/retroactive/.test(k)) { const [d, lv] = describe.retro(v); return { title: 'سماح قبل الكلام (Retroactive Grace)', what: 'بيأخّر الصوت شوية عشان يلحق أول الكلمة قبل ما البوابة تفتح.', up: 'أول حرف مش بيتقطع، بس صوتك بيتأخر بنفس المدة.', down: 'مفيش تأخير، بس أول حرف ممكن يتقطع.', now: d, lv }; }
  if (/grace/.test(k)) { const [d, lv] = describe.grace(v); return { title: 'مدة السماح بعد الكلام (Grace Period)', what: 'البوابة بتفضل مفتوحة المدة دي بعد ما تسكت.', up: 'آخر الكلمات بيطلع طبيعي، بس الضوضاء بتفضل شوية بعد الكلام.', down: 'الكتم بيحصل أسرع، بس آخر الحرف ممكن يتاكل.', now: d, lv }; }
  if (/:freq$|^freq$/.test(k)) return { title: `تردد الفلتر ${node}`, what: 'مركز منطقة الترددات اللي الفلتر ده بيأثر عليها.', up: 'الفلتر يروح للصوت الأعلى والأحدّ (سين، هوا).', down: 'الفلتر يروح للصوت الأوطى والأتخن (عمق، زن).', now: `بيأثر حوالين ${L(Math.round(v) + ' Hz')}.`, lv: '' };
  if (/:q$|^q$/.test(k)) return { title: `عرض الفلتر ${node} (Q)`, what: 'بيحدد الفلتر بيأثر على منطقة عريضة ولا ضيقة حوالين التردد.', up: 'منطقة ضيقة ودقيقة، مفيدة عشان تشيل صفير أو زن معيّن.', down: 'منطقة عريضة وتأثير ناعم وطبيعي.', now: v < 0.8 ? 'عريض (تأثير ناعم).' : v <= 2 ? 'متوسط (مناسب للكلام).' : 'ضيق (جراحي).', lv: '' };
  if (/gain \d/.test(k)) return { title: `تعلية الخرج ${node}`, what: 'مضاعف للصوت: 1 = من غير تغيير، و 2 = ضعف الإشارة (+6 dB).', up: 'صوت أعلى، وممكن يحصل تكسير.', down: 'صوت أوطى.', now: v > 0 ? `حوالي ${L((20 * Math.log10(v)).toFixed(1) + ' dB')}` : 'صامت', lv: v > 2.5 ? 'warn' : '' };
  if (/:gain$|^gain$/.test(k)) return { title: `تعلية/توطية ${node} (EQ)`, what: 'قد إيه المنطقة دي بتتعلّى أو بتتوطّى.', up: 'المنطقة دي تبقى أوضح وأعلى.', down: 'المنطقة دي تتشال أو تهدى.', now: v === 0 ? 'من غير تغيير.' : `${v > 0 ? 'متعلّي' : 'متوطّي'} ${L((v > 0 ? '+' : '') + v + ' dB')}`, lv: Math.abs(v) > 8 ? 'warn' : '' };
  if (/volume/.test(k)) return { title: 'علو صوت الفلتر', what: 'مستوى الصوت الداخلي للفلتر (1 = 100%).', up: 'أعلى.', down: 'أوطى.', now: `${Math.round(v * 100)}%`, lv: '' };
  if (/mute/.test(k)) return { title: 'كتم', what: 'بيكتم الفلتر كله.', up: '', down: '', now: value ? 'مكتوم' : 'شغال', lv: value ? 'bad' : '' };
  return { title: key, what: 'إعداد خاص بالفلتر ده. جرّب تغيّره وانت سامع الفرق من المراقبة المباشرة.', up: '', down: '', now: '', lv: '' };
}

// ------------------------------------------------------------ status
async function refresh() {
  if (interacting) return;
  const [st, gr] = await Promise.all([api('/api/status'), api('/api/graph')]);
  STATUS = st;
  if (!st.ok) { $('srv').textContent = 'مفيش sound server'; $('sources').innerHTML = `<div class="status err">${esc(st.error)}</div>`; return; }
  $('srv').innerHTML = `${esc(st.server.name)} · المدخل الافتراضي: <span class="mono">${esc(st.server.defaultSource)}</span>`;
  if (!SETTINGS) { SETTINGS = st.settings; EQF = st.eqFreqs; renderEngine(); }
  renderSources(st);
  renderChains(gr, st);
  renderFilters(gr);
  renderEngineState(st.clean);
  fillMaster(st);
}

function originBadge(o) { return `<span class="badge b-${o.kind}">${esc(o.label)}</span>`; }
function gainNow(v) {
  if (v === 0) return ['صامت تمامًا.', 'bad'];
  if (v < 40) return ['واطي جدًا: الناس ممكن متسمعكش كويس.', 'warn'];
  if (v <= 100) return ['طبيعي: تكبير من المايك نفسه من غير تكبير رقمي.', 'good'];
  if (v <= 120) return ['فوق 100%: تكبير رقمي بسيط، والضوضاء بتعلى معاه.', 'warn'];
  return ['تكبير رقمي كبير: الضوضاء بتعلى وممكن يحصل تكسير.', 'bad'];
}
function renderSources(st) {
  const show = $('showMonitors').checked;
  const list = st.sources.filter((s) => show || s.origin.kind !== 'monitor');
  $('sources').innerHTML = list.map((s) => {
    const [gn, gl] = gainNow(s.volumePercent ?? 100);
    const role = s.origin.kind === 'hardware' ? 'ده المايك الحقيقي. جينه هو أهم إعداد، ظبطه الأول.' : s.origin.kind === 'filter' ? 'ده مايك متفلتر. سيب جينه على 100% واتحكم في الجين من المايك الحقيقي.' : '';
    return `
    <div class="src-row">
      <div style="min-width:0">
        <div class="name">${s.isDefault ? '<span class="star">★</span> ' : ''}${esc(s.description)}</div>
        <div class="row small" style="margin-top:3px">${originBadge(s.origin)}<span class="muted">${esc(STATE_AR[s.state] || s.state)}</span><span class="mono muted">${esc(s.sampleSpec)}</span></div>
        <div class="small muted mono" style="margin-top:3px;overflow:hidden;text-overflow:ellipsis">${esc(s.name)}</div>
        ${s.origin.detail ? `<div class="small muted" style="margin-top:2px">${esc(s.origin.detail)}</div>` : ''}
        ${role ? `<div class="small" style="margin-top:3px">💡 ${role}</div>` : ''}
        ${s.recordedBy.length ? `<div class="small" style="margin-top:3px">🔴 بيسجل منه دلوقتي: ${s.recordedBy.map((r) => esc(r.app)).join('، ')}</div>` : ''}
      </div>
      <div>
        <div class="small" style="font-weight:700">الجين</div>
        <input type="range" min="0" max="150" step="1" value="${s.volumePercent ?? 100}" data-vol="${esc(s.name)}">
        <div class="gainval ltr" data-volv="${esc(s.name)}" style="text-align:right">${s.volumePercent ?? '?'}% · ${esc(s.volumeDb ?? '')} dB</div>
        <div class="now ${gl}" data-voln="${esc(s.name)}">${gn}</div>
      </div>
      <div class="row">
        <button data-mute="${esc(s.name)}" data-m="${s.mute ? 0 : 1}" class="${s.mute ? 'danger' : ''}" title="كتم المايك ده">${s.mute ? '🔇 مكتوم' : 'كتم'}</button>
        <button data-def="${esc(s.name)}" ${s.isDefault ? 'disabled' : ''} title="خليه افتراضي">${s.isDefault ? '★ افتراضي' : 'خليه افتراضي'}</button>
      </div>
    </div>`;
  }).join('') || '<span class="muted">مفيش مايكات.</span>';
}
const setVol = debounce((name, v) => api('/api/source/volume', { name, percent: v }), 80);
$('sources').addEventListener('input', (e) => {
  const n = e.target.dataset.vol; if (!n) return;
  interacting = true; clearTimeout(window._ih); window._ih = setTimeout(() => (interacting = false), 1200);
  const v = Number(e.target.value);
  const db = v === 0 ? '-inf' : (60 * Math.log10(v / 100)).toFixed(1);
  document.querySelector(`[data-volv="${CSS.escape(n)}"]`).textContent = `${v}% · ${db} dB`;
  const [gn, gl] = gainNow(v); setNow(document.querySelector(`[data-voln="${CSS.escape(n)}"]`), gn, gl);
  setVol(n, v);
});
$('sources').addEventListener('click', async (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.mute) await api('/api/source/mute', { name: b.dataset.mute, mute: b.dataset.m === '1' });
  if (b.dataset.def) { await api('/api/source/default', { name: b.dataset.def }); toast('اتغيّر المدخل الافتراضي'); }
  refresh();
});
$('showMonitors').onchange = () => STATUS && renderSources(STATUS);

function renderChains(gr, st) {
  if (!gr.ok) {
    $('chains').innerHTML = `<div class="status">${esc(gr.error)}</div>` + st.sources.filter((s) => s.origin.kind !== 'monitor').map((s) =>
      `<div class="chain">${s.origin.master ? `<div class="node hw"><div class="t mono">${esc(s.origin.master)}</div></div><span class="arrow">←</span>` : ''}<div class="node ${s.origin.kind === 'filter' ? 'flt' : 'hw'}"><div class="t">${s.isDefault ? '★ ' : ''}${esc(s.description)}</div><div class="s">${esc(s.origin.label)}</div></div></div>`).join('');
    return;
  }
  const def = st.server.defaultSource;
  const all = gr.chains.filter((c) => !/monitor/i.test(c.name || ''));
  const inLonger = new Set(all.filter((c) => c.chain.length > 1).flatMap((c) => c.chain.slice(1).map((n) => n.id)));
  const chains = all.filter((c) => c.chain.length > 1 || !inLonger.has(c.id) || c.name === def);
  chains.sort((a, b) => (b.name === def) - (a.name === def) || b.chain.length - a.chain.length);
  $('chains').innerHTML = chains.map((c) => {
    const steps = [...c.chain].reverse();
    return `<div class="chain">${steps.map((n, i) => {
      const last = i === steps.length - 1;
      const cls = n.api ? 'hw' : last ? 'src' : 'flt';
      const kind = n.api ? `🎤 مايك حقيقي${n.product ? ' · ' + n.product : ''}` : last ? '📥 البرامج بتسجل من هنا' : '🧠 فلتر معالجة';
      return `${i ? '<span class="arrow">←</span>' : ''}<div class="node ${cls}"><div class="t">${last && c.name === def ? '<span class="star">★</span> ' : ''}${esc(n.label)}</div><div class="s">${esc(kind)}</div><div class="s mono">${esc(n.name)}</div></div>`;
    }).join('')}</div>`;
  }).join('') || '<span class="muted">مفيش مصادر.</span>';
}

// ------------------------------------------------------------ existing filter params
function guessRange(key, value, p) {
  if (typeof p.min === 'number' && typeof p.max === 'number' && p.max > p.min) return [p.min, p.max];
  const k = key.toLowerCase();
  if (/freq/.test(k)) return [20, 20000];
  if (/:q$|\bq\b/.test(k)) return [0.1, 10];
  if (/gain \d/.test(k)) return [0, 4];
  if (/gain/.test(k)) return [-24, 24];
  if (/threshold.*%|vad threshold/.test(k)) return [0, 99];
  if (/retroactive/.test(k)) return [0, 200];
  if (/\(ms\)|ms\b/.test(k)) return [0, 1000];
  if (/volume/.test(k)) return [0, 2];
  if (/db/.test(k)) return [-60, 24];
  const v = Math.abs(Number(value)) || 1;
  return [Math.min(0, Number(value)), v * 4];
}
function helpHtml(h) {
  return `<div class="help"><b>بيعمل إيه:</b> ${h.what}${h.up ? `<br><span class="up">▲ لو علّيته:</span> ${h.up}` : ''}${h.down ? `<br><span class="down">▼ لو وطّيته:</span> ${h.down}` : ''}</div>`;
}
let FILTER_SIG = '';
function renderFilters(gr) {
  if (!gr.ok) { $('filters').innerHTML = `<span class="muted">${esc(gr.error)}</span>`; return; }
  const nodes = gr.controllable.filter((n) => n.params.some((p) => typeof p.value === 'number' || typeof p.value === 'boolean'));
  $('filterCount').textContent = nodes.length ? `${nodes.length} فلتر` : '';
  const sig = JSON.stringify(nodes.map((n) => [n.id, n.params.map((p) => p.key)]));
  if (sig === FILTER_SIG) {
    nodes.forEach((n) => n.params.forEach((p) => {
      const row = document.querySelector(`.param[data-fid="${n.id}"][data-fkey="${CSS.escape(p.key)}"]`); if (!row) return;
      row.querySelectorAll('input').forEach((el) => { if (document.activeElement !== el && el.type !== 'checkbox') el.value = el.dataset.num ? +Number(p.value).toFixed(3) : p.value; });
      const h = paramHelp(p.key, p.value), now = row.querySelector('.now'); if (now && h.now) setNow(now, 'دلوقتي: ' + h.now, h.lv);
    }));
    return;
  }
  FILTER_SIG = sig;
  if (!nodes.length) { $('filters').innerHTML = '<span class="muted">مفيش فلتر شغال بيطلّع إعدادات نقدر نتحكم فيها.</span>'; return; }
  $('filters').innerHTML = nodes.map((n) => `
    <details open><summary><strong style="color:var(--text)">${esc(n.label)}</strong> <span class="mono">#${n.id} ${esc(n.name)}</span></summary>
    ${n.params.map((p) => {
      const h = paramHelp(p.key, p.value);
      const head = `<div class="k">${esc(h.title)}<span class="mono" title="${esc(p.key)}">${esc(p.key)}</span></div>`;
      const tail = `${h.now ? `<div class="now ${h.lv}">دلوقتي: ${h.now}</div>` : '<div class="now" style="display:none"></div>'}${helpHtml(h)}`;
      if (typeof p.value === 'boolean') return `<div class="param" data-fid="${n.id}" data-fkey="${esc(p.key)}"><div class="top">${head}<div><input type="checkbox" ${p.value ? 'checked' : ''}></div><div></div></div>${tail}</div>`;
      if (typeof p.value !== 'number') return '';
      const [mn, mx] = guessRange(p.key, p.value, p);
      const step = (mx - mn) > 100 ? 1 : (mx - mn) > 10 ? 0.1 : 0.01;
      return `<div class="param" data-fid="${n.id}" data-fkey="${esc(p.key)}"><div class="top">${head}
        <div><input type="range" min="${mn}" max="${mx}" step="${step}" value="${p.value}"></div>
        <div><input type="number" step="${step}" value="${+Number(p.value).toFixed(3)}" data-num="1"></div></div>${tail}</div>`;
    }).join('')}</details>`).join('');
}
const setParam = debounce((id, key, value) => api('/api/filter/set', { id, key, value }), 60);
$('filters').addEventListener('input', (e) => {
  const el = e.target, row = el.closest('.param'); if (!row) return;
  interacting = true; clearTimeout(window._ih); window._ih = setTimeout(() => (interacting = false), 1500);
  const id = Number(row.dataset.fid), key = row.dataset.fkey;
  const value = el.type === 'checkbox' ? el.checked : Number(el.value);
  row.querySelectorAll('input').forEach((o) => { if (o !== el && o.type !== 'checkbox') o.value = o.dataset.num ? +Number(value).toFixed(3) : value; });
  const h = paramHelp(key, value), now = row.querySelector('.now');
  if (h.now) { now.style.display = ''; setNow(now, 'دلوقتي: ' + h.now, h.lv); }
  setParam(id, key, value);
});

// ------------------------------------------------------------ engine
const PRESETS = MicPresets.EQ_PRESETS; // shared with the server: src/shared/presets.js
const PRESET_INFO = {
  flat: 'مسطح: الـ EQ مش بيغيّر أي حاجة، ودي نقطة البداية.',
  voice: 'وضوح الكلام: بيشيل الزن والكتمة وبيعلّي منطقة الحروف (2k–8k)، وده مناسب للاجتماعات.',
  podcast: 'بودكاست: بيشيل الرنين والزن والكتمة، وبيعلّي الوضوح والحضور (2k–4k) عشان الكلام يبقى صافي ومفهوم في التسجيل. مناسب للمايكات الـ USB والـ condenser.',
  warm: 'دافي: بيعلّي العمق (63–250Hz) وبيهدّي الحدة، زي صوت الراديو.',
  deess: 'تخفيف الحدة: بيوطّي 4k–16k عشان يهدّي السين والهسهسة والصوت الحاد.',
  laptop: 'مايك رخيص: بيشيل الزن والكتمة جامد وبيعلّي الوضوح، مناسب لمايك اللابتوب والكاميرا.',
};
function renderEngine() {
  const s = SETTINGS;
  $('engine').value = s.engine; $('makeDefault').checked = s.makeDefault; $('rnnoise').checked = s.rnnoise;
  ['vadThreshold', 'vadGrace', 'retroGrace', 'highpass', 'outputGainDb'].forEach((k) => ($(k).value = s[k]));
  $('w_ns').checked = s.webrtc.noiseSuppression; $('w_agc').checked = s.webrtc.gainControl; $('w_hp').checked = s.webrtc.highPass;
  $('eq').innerHTML = s.eq.map((b, i) => `<div class="band" title="${esc((EQ_INFO[b.freq] || [''])[0])}"><span class="g" id="eqg${i}">${b.gain > 0 ? '+' : ''}${b.gain}</span><input type="range" min="-12" max="12" step="0.5" value="${b.gain}" data-eq="${i}"><span class="f">${fmtHz(b.freq)}</span></div>`).join('');
  labels(); toggleEngineUI(); drawEqCurveCache();
}
function labels() {
  const n = (id) => Number($(id).value);
  $('vadV').textContent = n('vadThreshold') + '%';
  $('graceV').textContent = n('vadGrace') + ' ms';
  $('retroV').textContent = n('retroGrace') + ' ms';
  $('hpV').textContent = n('highpass') ? n('highpass') + ' Hz' : 'off';
  $('ogV').textContent = (n('outputGainDb') > 0 ? '+' : '') + n('outputGainDb') + ' dB';
  const rn = $('rnnoise').checked;
  let [d, lv] = describe.vad(n('vadThreshold')); setNow($('vadNow'), (rn ? '' : '(RNNoise مقفول، فالإعداد ده مش بيأثر) ') + d, rn ? lv : '');
  [d, lv] = describe.grace(n('vadGrace')); setNow($('graceNow'), d, rn ? lv : '');
  [d, lv] = describe.retro(n('retroGrace')); setNow($('retroNow'), d, rn ? lv : '');
  [d, lv] = describe.hp(n('highpass')); setNow($('hpNow'), d, lv);
  [d, lv] = describe.og(n('outputGainDb')); setNow($('ogNow'), d, lv);
}
function toggleEngineUI() {
  const pw = $('engine').value === 'pipewire';
  $('pwControls').style.display = pw ? '' : 'none';
  $('webrtcControls').style.display = pw ? 'none' : '';
}
function collect() {
  const s = SETTINGS;
  s.engine = $('engine').value; s.master = $('master').value; s.makeDefault = $('makeDefault').checked; s.rnnoise = $('rnnoise').checked;
  ['vadThreshold', 'vadGrace', 'retroGrace', 'highpass', 'outputGainDb'].forEach((k) => (s[k] = Number($(k).value)));
  document.querySelectorAll('[data-eq]').forEach((el) => (s.eq[Number(el.dataset.eq)].gain = Number(el.value)));
  s.webrtc = { noiseSuppression: $('w_ns').checked, gainControl: $('w_agc').checked, highPass: $('w_hp').checked };
  return s;
}
const pushUpdate = debounce(async () => {
  const r = await api('/api/clean/update', { settings: collect() });
  if (r.ok) $('applyInfo').textContent = r.applied === 'live' ? '✓ اتطبّق فورًا' : r.applied === 'restart' ? '↻ بيعيد تشغيل الفلتر (ثانية)…' : 'اتحفظ (المحرك متوقف، شغّله عشان تسمع)';
  if (r.applied === 'restart') setTimeout(refresh, 1500);
}, 120);
document.querySelector('#pwControls').addEventListener('input', (e) => {
  if (e.target.dataset.eq !== undefined) { const i = Number(e.target.dataset.eq); const v = Number(e.target.value); $('eqg' + i).textContent = (v > 0 ? '+' : '') + v; collect(); describeBand(i); }
  labels(); collect(); drawEqCurveCache(); pushUpdate();
});
$('eq').addEventListener('pointerdown', (e) => { const band = e.target.closest('.band'); if (band) describeBand([...band.parentNode.children].indexOf(band)); });
['engine', 'master', 'makeDefault', 'w_ns', 'w_agc', 'w_hp'].forEach((id) => $(id).addEventListener('change', () => { toggleEngineUI(); collect(); drawEqCurveCache(); pushUpdate(); }));
$('eqPreset').onchange = (e) => {
  const key = e.target.value, p = PRESETS[key]; if (!p) return;
  document.querySelectorAll('[data-eq]').forEach((el, i) => { el.value = p[i]; $('eqg' + i).textContent = (p[i] > 0 ? '+' : '') + p[i]; });
  e.target.value = ''; collect(); drawEqCurveCache(); pushUpdate();
  setNow($('eqNow'), PRESET_INFO[key], 'good');
};
$('startBtn').onclick = async () => {
  $('startBtn').disabled = true; $('applyInfo').textContent = 'بيشغّل…';
  const r = await api('/api/clean/start', { settings: collect() });
  $('startBtn').disabled = false; $('applyInfo').textContent = r.ok ? '✓ شغال' : '';
  if (r.ok) { toast('Mic Clean اشتغل. اختاره في زوم أو OBS، أو قارنه في «اسمع وقارن»'); setTimeout(listDevices, 800); }
  refresh();
};
$('stopBtn').onclick = async () => { await api('/api/clean/stop', {}); $('applyInfo').textContent = 'اتوقف'; refresh(); };
$('resetBtn').onclick = async () => { const r = await api('/api/clean/reset', {}); SETTINGS = r.settings; renderEngine(); fillMaster(STATUS); toast('رجعت الإعدادات الأصلية'); };

function fillMaster(st) {
  if (!st?.ok) return;
  const sel = $('master'), cur = SETTINGS?.master ?? '';
  const opts = st.sources.filter((s) => s.origin.kind !== 'monitor' && s.name !== 'mic_mohamed' && s.name !== 'mic_clean');
  // '' = the system's default mic (what the user picked in the OS sound settings)
  const defName = st.server?.defaultSource === 'mic_clean' ? (SETTINGS?.previousDefault || '') : (st.server?.defaultSource || '');
  const def = st.sources.find((s) => s.name === defName);
  const html = `<option value="">🎙 الافتراضي بتاع الجهاز${def ? ' — ' + esc(def.description) : ''}</option>` + opts.map((s) => `<option value="${esc(s.name)}">${esc(s.description)}${s.origin.kind === 'hardware' ? ' — مايك حقيقي' : ' — ' + esc(s.origin.label)}</option>`).join('');
  if (sel._html !== html) { sel.innerHTML = html; sel._html = html; }
  sel.value = cur;
}
function renderEngineState(c) {
  const b = $('engineState');
  b.textContent = c.running ? `شغال · ${c.engine === 'pipewire' ? 'RNNoise' : 'WebRTC'}` : 'متوقف';
  b.className = 'badge ' + (c.running ? 'b-hardware' : 'b-unknown');
  const cap = c.capabilities;
  $('rnnoiseInfo').innerHTML = cap.rnnoisePath ? `الملف: <span class="mono">${esc(cap.rnnoisePath)}</span>` : '<span style="color:var(--warn)">ملف RNNoise (LADSPA) مش موجود</span>، شوف README.';
  if (!cap.pipewire) $('engine').querySelector('[value=pipewire]').textContent = 'PipeWire (مش متاح على الجهاز ده)';
  $('engineMsg').innerHTML = c.lastError ? `<div class="status err">${esc(c.lastError)}</div>` : '';
  $('engineLog').textContent = c.log?.length ? c.log.join('\n') : '—';
}

// ------------------------------------------------------------ configs / raw
async function loadConfigs() {
  const r = await api('/api/configs');
  $('configs').innerHTML = (r.files?.length ? r.files.map((f) => `<details><summary class="mono">${esc(f.path)}</summary><pre>${esc(f.content)}</pre></details>`).join('') : '<span class="muted">مفيش ملفات فلاتر.</span>')
    + (r.services ? `<div class="small muted" style="margin-top:8px">خدمات الصوت الشغالة:</div><pre>${esc(r.services)}</pre>` : '');
}
$('rawBtn').onclick = async () => {
  const r = await api('/api/raw');
  $('raw').innerHTML = Object.entries(r).map(([k, v]) => `<details><summary class="mono">${esc(k)}</summary><pre>${esc(v)}</pre></details>`).join('');
};

// ------------------------------------------------------------ live monitor (Web Audio)
let ctx = null, streams = {}, chains = {}, active = 'A', analyser, monGain, recDest, running = false;
const FFT = 8192;

async function listDevices() {
  const devs = await navigator.mediaDevices.enumerateDevices();
  const ins = devs.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'communications');
  const opt = ins.map((d) => `<option value="${esc(d.deviceId)}">${esc(d.label || 'مايك (اسمح للبراوزر يوصل للمايك عشان تظهر الأسماء)')}</option>`).join('');
  for (const id of ['devA', 'devB']) { const cur = $(id).value; $(id).innerHTML = opt; if (cur && ins.some((d) => d.deviceId === cur)) $(id).value = cur; }
  if (!listDevices._init && ins.some((d) => d.label)) {
    listDevices._init = true;
    const clean = ins.find((d) => /mic clean|mohamed|clean|noise|rnnoise|filter/i.test(d.label) && d.deviceId !== 'default');
    const raw = ins.find((d) => d.deviceId !== 'default' && !/mohamed|clean|noise|rnnoise|filter|monitor/i.test(d.label));
    if (raw) $('devA').value = raw.deviceId;
    if (clean) $('devB').value = clean.deviceId;
  }
}
navigator.mediaDevices?.addEventListener?.('devicechange', listDevices);

async function openStream(deviceId) {
  return navigator.mediaDevices.getUserMedia({ audio: {
    deviceId: deviceId ? { exact: deviceId } : undefined,
    echoCancellation: $('bEC').checked, noiseSuppression: $('bNS').checked, autoGainControl: $('bAGC').checked,
    channelCount: { ideal: 1 },
  } }).catch((e) => {
    // saved device id no longer valid (e.g. after reset-audio.sh) → fall back to the default mic
    if (deviceId && (e.name === 'OverconstrainedError' || e.name === 'NotFoundError')) return openStream('');
    throw e;
  });
}
function micError(e) {
  const m = {
    NotAllowedError: 'البراوزر رافض يوصل للمايك. دوس على أيقونة القفل 🔒 جنب العنوان فوق ← الميكروفون ← سماح (Allow)، وبعدين دوس «ابدأ الاستماع» تاني.',
    SecurityError: 'البراوزر رافض يوصل للمايك. افتح الداشبورد على http://localhost:4747 بالظبط، مش بالـ IP.',
    NotFoundError: 'مش لاقي أي مايك. اتأكد إن المايك متوصل ومختار في إعدادات الصوت بتاعة الجهاز.',
    NotReadableError: 'المايك مشغول أو نظام الصوت واقف. اقفل أي برنامج تاني بيستخدم المايك، أو شغّل reset-audio.sh.',
    AbortError: 'فتح المايك اتلغى. جرب تاني.',
  }[e?.name];
  return new Error(m || ('مشكلة في المايك: ' + (e?.message || e)));
}
function showMonErr(msg) {
  let el = document.getElementById('monErr');
  if (!el) { el = document.createElement('div'); el.id = 'monErr'; el.className = 'status err'; el.style.marginTop = '10px'; $('micBtn').closest('.row').after(el); }
  el.innerHTML = msg ? '⚠ ' + msg : ''; el.style.display = msg ? '' : 'none';
}
async function startAudio() {
  showMonErr('');
  // 1) Ask for permission FIRST — before that, the browser hides device ids/names and nothing can open
  try { const probe = await navigator.mediaDevices.getUserMedia({ audio: true }); probe.getTracks().forEach((t) => t.stop()); }
  catch (e) { throw micError(e); }
  listDevices._init = false; // re-pick A (raw mic) / B (Mic Clean) now that names are visible
  ctx = new AudioContext({ latencyHint: 'interactive' }); // no forced sample rate (Firefox refuses mismatched rates)
  if (ctx.state === 'suspended') await ctx.resume();
  analyser = ctx.createAnalyser(); analyser.fftSize = FFT; analyser.smoothingTimeConstant = 0.55;
  monGain = ctx.createGain(); monGain.gain.value = 0;
  recDest = ctx.createMediaStreamDestination();
  analyser.connect(monGain); monGain.connect(ctx.destination); analyser.connect(recDest);
  await listDevices();
  await connectSides();
  if (!Object.keys(chains).length) { const err = connectSides.lastError; stopAudio(); throw err ? micError(err) : new Error('مقدرتش أفتح أي مايك. اختار مايك في A.'); }
  $('ctxInfo').textContent = `${ctx.sampleRate} Hz · ~${Math.round((ctx.baseLatency + (ctx.outputLatency || 0)) * 1000)} ms تأخير`;
  running = true; $('micBtn').textContent = '■ وقّف الاستماع'; $('micBtn').classList.remove('primary');
  applyMonitor(); requestAnimationFrame(draw);
}
async function connectSides() {
  for (const side of ['A', 'B']) {
    streams[side]?.getTracks().forEach((t) => t.stop()); chains[side]?.src.disconnect();
    const id = $('dev' + side).value;
    if (!id && side === 'B') continue; // A falls back to the default mic
    try {
      const st = await openStream(id); streams[side] = st;
      const src = ctx.createMediaStreamSource(st), g = ctx.createGain();
      g.gain.value = side === active ? 1 : 0; src.connect(g); g.connect(analyser); chains[side] = { src, g };
    } catch (e) { connectSides.lastError = e; showMonErr(`مقدرتش أفتح ${side}: ${micError(e).message}`); }
  }
  await listDevices();
}
function stopAudio() {
  running = false; Object.values(streams).forEach((s) => s.getTracks().forEach((t) => t.stop())); streams = {}; chains = {};
  ctx?.close(); ctx = null; $('micBtn').textContent = '▶ ابدأ الاستماع'; $('micBtn').classList.add('primary');
}
function setActive(side) {
  active = side; $('abA').classList.toggle('on', side === 'A'); $('abB').classList.toggle('on', side === 'B');
  if (!ctx) return;
  for (const s of ['A', 'B']) chains[s]?.g.gain.setTargetAtTime(s === side ? 1 : 0, ctx.currentTime, 0.01);
  stats.hist = [];
}
function applyMonitor() { if (monGain) monGain.gain.setTargetAtTime($('monitorOn').checked ? Number($('monVol').value) : 0, ctx.currentTime, 0.02); }
$('micBtn').onclick = () => (running ? stopAudio() : startAudio().catch((e) => { showMonErr(e.message); toast('⚠ ' + e.message, 6000); }));
$('abA').onclick = () => setActive('A'); $('abB').onclick = () => setActive('B');
$('monitorOn').onchange = applyMonitor; $('monVol').oninput = applyMonitor;
['devA', 'devB', 'bNS', 'bEC', 'bAGC'].forEach((id) => $(id).addEventListener('change', () => ctx && connectSides()));
document.addEventListener('keydown', (e) => { if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return; if (e.key === 'a') setActive('A'); if (e.key === 'b') setActive('B'); if (e.key === ' ') { e.preventDefault(); setActive(active === 'A' ? 'B' : 'A'); } });

// ---- visualization
const stats = { hist: [], peakHold: -100, peakT: 0, lastTip: 0 };
const td = new Float32Array(FFT), fd = new Float32Array(FFT / 2);
const toDb = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -120);
const pct = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
function sizeCanvas(c) { const r = c.getBoundingClientRect(), d = devicePixelRatio || 1; if (c.width !== Math.round(r.width * d)) { c.width = Math.round(r.width * d); c.height = Math.round(c.getAttribute('height') * d); c.style.height = c.getAttribute('height') + 'px'; } return c.getContext('2d'); }
const fx = (f, w) => (Math.log10(f / 20) / Math.log10(20000 / 20)) * w;

let eqCurve = null;
function drawEqCurveCache() {
  if (!SETTINGS) return;
  const N = 256, freqs = new Float32Array(N);
  for (let i = 0; i < N; i++) freqs[i] = 20 * Math.pow(1000, i / (N - 1));
  const oc = new OfflineAudioContext(1, 1, 48000), total = new Float32Array(N).fill(0);
  const add = (type, f, q, g) => { const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = g; const m = new Float32Array(N), p = new Float32Array(N); b.getFrequencyResponse(freqs, m, p); for (let i = 0; i < N; i++) total[i] += toDb(m[i]); };
  if (SETTINGS.engine === 'pipewire') {
    if (SETTINGS.highpass > 0) add('highpass', SETTINGS.highpass, 0.707, 0);
    SETTINGS.eq.forEach((b) => b.gain && add('peaking', b.freq, b.q || 1, b.gain));
    for (let i = 0; i < N; i++) total[i] += Number(SETTINGS.outputGainDb);
  }
  eqCurve = { freqs, total };
}

function levelAdvice(peakDb, floor, voice) {
  if (stats.hist.length < 120) return ['بيقيس… اتكلم شوية واسكت شوية.', ''];
  if (stats.peakHold > -1) return ['🔴 فيه تكسير (clipping): وطّي جين المايك الحقيقي لحد ما الـ Peak يفضل تحت −3 dB.', 'bad'];
  if (voice < -40) return ['صوتك واطي: علّي جين المايك الحقيقي لحد ما الكلام يوصل من −24 لـ −12 dB في الـ RMS.', 'warn'];
  if (floor > -45) return ['⚠ الضوضاء عالية وانت ساكت. جرّب B (Mic (clean)) أو علّي قوة البوابة (VAD).', 'warn'];
  if (voice - floor < 25) return ['النقاء ضعيف: الكلام قريب من الضوضاء. قرّب من المايك أو قوّي العزل.', 'warn'];
  if (floor < -65 && voice - floor > 40) return ['✔ ممتاز: الضوضاء واطية جدًا وصوتك واضح.', 'good'];
  return ['✔ كويس: المستوى والنقاء مقبولين.', 'good'];
}

function draw() {
  if (!running) return;
  requestAnimationFrame(draw);
  analyser.getFloatTimeDomainData(td);
  let peak = 0, sum = 0;
  for (let i = 0; i < td.length; i++) { const v = Math.abs(td[i]); if (v > peak) peak = v; sum += td[i] * td[i]; }
  const rmsDb = toDb(Math.sqrt(sum / td.length)), peakDb = toDb(peak);
  const now = performance.now();
  if (peakDb > stats.peakHold || now - stats.peakT > 1500) { stats.peakHold = peakDb; stats.peakT = now; }
  stats.hist.push(rmsDb); if (stats.hist.length > 300) stats.hist.shift();
  const sorted = [...stats.hist].sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? -120, voice = sorted[Math.floor(sorted.length * 0.95)] ?? -120;
  $('mPeak').textContent = peakDb.toFixed(1); $('mPeak').style.color = peakDb > -1 ? 'var(--bad)' : '';
  $('mRms').textContent = rmsDb.toFixed(1);
  $('mFloor').textContent = floor.toFixed(1); $('mFloor').style.color = floor > -50 ? 'var(--warn)' : floor < -65 ? 'var(--good)' : '';
  $('mSnr').textContent = `${voice.toFixed(0)} / ${(voice - floor).toFixed(0)}dB`;
  $('lvFill').style.width = pct(rmsDb) + '%'; $('lvPeak').style.left = pct(stats.peakHold) + '%'; $('lvFloor').style.left = pct(floor) + '%';
  if (now - stats.lastTip > 500) { stats.lastTip = now; const [t, lv] = levelAdvice(peakDb, floor, voice); setNow($('levelNow'), `<b>${active}:</b> ${t}`, lv); }

  if ($('freeze').checked) return;
  let g = sizeCanvas($('wave')); const W = g.canvas.width, H = g.canvas.height;
  g.clearRect(0, 0, W, H); g.strokeStyle = '#3a3631'; g.beginPath(); g.moveTo(0, H / 2); g.lineTo(W, H / 2); g.stroke();
  g.strokeStyle = active === 'A' ? '#5a9fd4' : '#d97b3d'; g.lineWidth = 1.5 * devicePixelRatio; g.beginPath();
  const step = td.length / W;
  for (let x = 0; x < W; x++) { let mn = 1, mx = -1; for (let j = Math.floor(x * step); j < (x + 1) * step; j++) { const v = td[j]; if (v < mn) mn = v; if (v > mx) mx = v; } g.moveTo(x, (1 - mx) * H / 2); g.lineTo(x, (1 - mn) * H / 2); }
  g.stroke();

  analyser.getFloatFrequencyData(fd);
  g = sizeCanvas($('spec')); const SW = g.canvas.width, SH = g.canvas.height, nyq = ctx.sampleRate / 2;
  g.clearRect(0, 0, SW, SH);
  const dpr = devicePixelRatio; g.font = `${10 * dpr}px system-ui`; g.fillStyle = '#5b6273'; g.strokeStyle = '#2a2a2a'; g.lineWidth = 1;
  [50, 100, 200, 500, 1000, 2000, 5000, 10000].forEach((f) => { const x = fx(f, SW); g.beginPath(); g.moveTo(x, 0); g.lineTo(x, SH); g.stroke(); g.fillText(f >= 1000 ? f / 1000 + 'k' : f, x + 3, SH - 4); });
  [-20, -40, -60, -80].forEach((d) => { const y = (-d / 100) * SH; g.beginPath(); g.moveTo(0, y); g.lineTo(SW, y); g.stroke(); g.fillText(d + ' dB', 3, y - 3); });
  const grad = g.createLinearGradient(0, 0, 0, SH); grad.addColorStop(0, active === 'A' ? 'rgba(90,159,212,.55)' : 'rgba(217,123,61,.55)'); grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.beginPath(); g.moveTo(0, SH);
  for (let x = 0; x < SW; x++) {
    const f0 = 20 * Math.pow(1000, x / SW), f1 = 20 * Math.pow(1000, (x + 1) / SW);
    let i0 = Math.floor(f0 / nyq * fd.length), i1 = Math.max(i0 + 1, Math.floor(f1 / nyq * fd.length)), m = -140;
    for (let i = i0; i < i1 && i < fd.length; i++) if (fd[i] > m) m = fd[i];
    g.lineTo(x, Math.min(SH, (-m / 100) * SH));
  }
  g.lineTo(SW, SH); g.closePath(); g.fillStyle = grad; g.fill();
  if (eqCurve && SETTINGS?.engine === 'pipewire') {
    g.strokeStyle = '#d97b3d'; g.lineWidth = 2 * dpr; g.setLineDash([6 * dpr, 4 * dpr]); g.beginPath();
    eqCurve.freqs.forEach((f, i) => { const y = SH / 2 - (eqCurve.total[i] / 24) * (SH / 2); i ? g.lineTo(fx(f, SW), y) : g.moveTo(fx(f, SW), y); });
    g.stroke(); g.setLineDash([]);
  }

  g = sizeCanvas($('sgram')); const GW = g.canvas.width, GH = g.canvas.height;
  g.drawImage(g.canvas, -2, 0);
  for (let y = 0; y < GH; y++) {
    const f = 20 * Math.pow(1000, 1 - y / GH), i = Math.min(fd.length - 1, Math.floor(f / nyq * fd.length));
    const v = Math.max(0, Math.min(1, (fd[i] + 100) / 80));
    g.fillStyle = `hsl(${260 - v * 230},90%,${v * 55}%)`; g.fillRect(GW - 2, y, 2, 1);
  }
}

// ---- record
$('recBtn').onclick = () => {
  if (!ctx) return toast('ابدأ الاستماع الأول');
  const mr = new MediaRecorder(recDest.stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '' });
  const chunks = []; mr.ondataavailable = (e) => chunks.push(e.data);
  mr.onstop = () => { const url = URL.createObjectURL(new Blob(chunks, { type: 'audio/webm' })); $('player').src = url; $('dl').href = url; $('dl').download = `mic-${active}-${Date.now()}.webm`; $('dl').style.display = ''; $('recBtn').disabled = false; $('recBtn').textContent = '⏺ سجّل 10 ثواني'; };
  mr.start(); $('recBtn').disabled = true;
  let s = 10; $('recBtn').textContent = `بيسجل ${s}…`;
  const t = setInterval(() => { s--; $('recBtn').textContent = `بيسجل ${s}…`; if (s <= 0) { clearInterval(t); mr.stop(); } }, 1000);
};

// ------------------------------------------------------------ boot
$('refreshBtn').onclick = () => { refresh(); loadConfigs(); };
refresh(); loadConfigs(); listDevices();
setInterval(() => $('autoRefresh').checked && refresh(), 3000);
