// Presets, the second RNNoise pass and the compressor/limiter controls.
(() => {
  'use strict';
  const $$ = (id) => document.getElementById(id);
  const pw = $$('pwControls');
  if (!pw) return;
  const L = (s) => `<span class="ltr">${s}</span>`;
  const put = (tplId, where) => { const n = $$(tplId).content.firstElementChild.cloneNode(true); where(n); return n; };
  put('dnScenesTpl', (n) => ($$('scenesSlot') || pw.parentNode).appendChild(n));
  put('dnStage2Tpl', (n) => { // right after the stage-1 sliders block
    const g = document.getElementById('vadThreshold')?.closest('#pwControls > *');
    pw.insertBefore(n, g ? g.nextSibling : (pw.children[1] || null));
  });
  put('dnCompTpl', (n) => pw.appendChild(n));

  const SCENES = MicPresets.SCENES; // src/shared/presets.js
  const PNAME = Object.fromEntries(Object.entries(SCENES).map(([k, v]) => [k, v.e + ' ' + v.t]));
  $$('dnSceneList').innerHTML = Object.entries(SCENES).map(([k, v]) => `<button class="dn-scene" data-scene="${k}"><div class="e">${v.e}</div><div class="t">${v.t}</div><div class="d">${v.d}</div></button>`).join('');

  const S = () => window.SETTINGS || (typeof SETTINGS !== 'undefined' ? SETTINGS : null);
  const push = () => { if (typeof pushUpdate === 'function') pushUpdate(); };
  const hasComp = () => { try { return !!STATUS?.clean?.capabilities?.compPath; } catch { return false; } };

  const D = {
    v2: (v) => v === 0 ? ['تنضيف بس، مفيش كتم. أنعم حاجة.', 'good'] : v <= 30 ? ['خفيفة، ودي الموصى بيها للمرحلة التانية.', 'good'] : v <= 55 ? ['متوسطة: خد بالك من تقطيع آخر الكلام.', 'warn'] : ['قوية: مع المرحلة الأولى غالبًا هتقطع كلام.', 'bad'],
    g2: (v, g1) => v < 150 ? ['قصير: ممكن يقطع آخر الكلام.', 'warn'] : v < g1 ? [`أقصر من المرحلة الأولى (${g1} ms). الأحسن تبقى أطول منها.`, 'warn'] : ['كويس: أطول من الأولى، فمش هيقطع حاجة.', 'good'],
    rt2: (v) => v === 0 ? ['مفيش تأخير زيادة.', 'good'] : [`بيزود تأخير ${L(v + ' ms')}.`, v > 60 ? 'warn' : 'good'],
    ct: (v) => v >= -8 ? ['بيضغط الصوت العالي أوي بس، وتأثيره خفيف.', ''] : v >= -24 ? ['متوازن، ومناسب للبودكاست.', 'good'] : ['ضغط على كل الكلام تقريبًا، وممكن يبان مخنوق.', 'warn'],
    cr: (v) => v <= 1 ? ['مفيش ضغط.', ''] : v <= 2 ? ['ضغط خفيف وطبيعي.', 'good'] : v <= 4 ? ['ضغط بودكاست: الصوت ثابت وقريب.', 'good'] : v <= 6 ? ['قوي، زي صوت الراديو.', 'warn'] : ['قوي جدًا، وبيبان مضغوط.', 'bad'],
    ca: (v) => v < 5 ? ['سريع جدًا: بيمسك كل حاجة، والكلام ممكن يبان باهت.', 'warn'] : v <= 30 ? ['طبيعي للكلام.', 'good'] : ['بطيء: أول الحروف هيعدي بقوته.', ''],
    crl: (v) => v < 80 ? ['سريع: ممكن تسمع الخلفية بتتنفس (pumping).', 'warn'] : v <= 400 ? ['ناعم وطبيعي.', 'good'] : ['بطيء: ضغط مستمر.', ''],
    lc: (v) => v >= -0.5 ? ['مفيش هامش تقريبًا، وممكن يحصل تكسير بسيط في التحويل.', 'warn'] : v >= -3 ? ['موصى بيه: صوت عالي ومحمي.', 'good'] : ['أمان زيادة، بس القمم هتتسطح شوية.', ''],
    cm: (v) => v === 0 ? ['مفيش تعويض.', ''] : v <= 8 ? [`بيعلّي ${L('+' + v + ' dB')} بعد الضغط.`, 'good'] : [`تعلية كبيرة ${L('+' + v + ' dB')}. راقب الـ Peak.`, 'warn'],
  };
  const setN = (id, [t, lv]) => { const el = $$(id); el.innerHTML = t; el.className = 'now' + (lv ? ' ' + lv : ''); };

  const MAP = [ // [inputId, settingKey, fmt, describeKey]
    ['dnV2', 'vad2Threshold', (v) => v + '%', 'v2'], ['dnG2', 'vad2Grace', (v) => v + ' ms', 'g2'], ['dnRt2', 'retro2Grace', (v) => v + ' ms', 'rt2'],
    ['dnCt', 'compThreshold', (v) => v + ' dB', 'ct'], ['dnCr', 'compRatio', (v) => v + ':1', 'cr'], ['dnCa', 'compAttack', (v) => v + ' ms', 'ca'],
    ['dnCrl', 'compRelease', (v) => v + ' ms', 'crl'], ['dnCm', 'compMakeup', (v) => '+' + v + ' dB', 'cm'],
    ['dnLc', 'limiterCeiling', (v) => v + ' dB', 'lc'],
  ];
  function labelsAll() {
    const s = S(); if (!s) return;
    for (const [id, key, fmt, dk] of MAP) { const v = Number($$(id).value); $$(id + 'v').textContent = fmt(v); setN(id + 'n', D[dk](v, Number(s.vadGrace))); }
    const r1 = !!s.rnnoise;
    $$('dnStage2').classList.toggle('dn-off', !r1);
    $$('dnR2Fields').classList.toggle('dn-off', !$$('dnR2').checked);
    $$('dnCFields').classList.toggle('dn-off', !$$('dnC').checked || !hasComp());
    $$('dnLc').classList.toggle('dn-off', !$$('dnL').checked || !hasComp()); $$('dnLimBox').classList.toggle('dn-off', !hasComp());
    const cap = (() => { try { return STATUS?.clean?.capabilities || {}; } catch { return {}; } })();
    const dg = cap.compDiag || {};
    const why = () => {
      if (dg.install?.running) return '⏳ بيسطّب swh-plugins دلوقتي… (لو ظهرلك مربع باسورد اكتب باسورد الجهاز)';
      if (dg.sandbox) return `السيرفر شغال جوه بيئة معزولة (<b>${dg.sandbox}</b>)، زي تيرمنال VS Code المتسطّب Flatpak أو Snap، فمش شايف ملفات النظام حتى لو الباكدج متسطب. شغّله من <b>التيرمنال العادي</b> بتاع أوبونتو، أو شغّله كخدمة: <span class="mono">bash install-linux.sh</span>`;
      if (dg.swhPlugins) return `الباكدج <span class="mono">swh-plugins</span> متسطب، بس ملف <span class="mono">sc4m_1916.so</span> مش موجود. جرّب: <span class="mono">${(dg.installCmd || 'sudo apt install swh-plugins').replace(' install ', ' install --reinstall ')}</span>`;
      if (dg.swhLv2) return 'انت مسطّب <b>swh-lv2</b> (نسخة LV2)، والفلتر محتاج <b>swh-plugins</b> (نسخة LADSPA). الاتنين ممكن يتسطّبوا مع بعض عادي:';
      return 'الباكدج <span class="mono">swh-plugins</span> مش متسطب لسه' + ((dg.searched || []).some((x) => x.p === '/usr/lib/ladspa' && !x.exists) ? ' (فولدر <span class="mono">/usr/lib/ladspa</span> مش موجود أصلًا)' : '') + '.';
    };
    const lastLog = dg.install && dg.install.ok === false && dg.install.log ? `<pre>${dg.install.log.replace(/</g, '&lt;')}</pre>` : '';
    const canBtn = !dg.sandbox && !dg.install?.running && !dg.swhPlugins && dg.pkexec && !!dg.pm;
    $$('dnCompMissing').innerHTML = hasComp() ? `<div class="small muted">✓ الضاغط متسطب: <span class="mono">${cap.compPath}</span></div>`
      : cap.compStatus === 'failed' ? `<div class="status">⚠ الضاغط متسطب (<span class="mono">${cap.compFound}</span>)، بس المايك مشتغلش بيه المرة اللي فاتت، فاشتغل من غيره. دوس «▶ شغّل» تاني وأنا هجرّبه من الأول، ولو فضل كده ابعتلي «سجل المحرك» من تاب متقدم.</div>`
      : `<div class="status">⚠ الضاغط والليميتر مش شغالين: ${why()}
          ${canBtn ? `<div class="row" style="margin-top:10px"><button class="btn primary" id="dnCompInstall">📦 سطّب swh-plugins دلوقتي</button><span class="small muted">هيطلب باسورد الجهاز، أو نفّذ بنفسك: <span class="mono">${dg.installCmd || 'sudo apt install swh-plugins'}</span></span></div>` : ''}
          ${lastLog ? '<div class="small" style="margin-top:8px">آخر محاولة تسطيب فشلت:</div>' + lastLog : ''}
          <details class="hint"><summary>ⓘ اتأكد بنفسك</summary><div class="help">نفّذ في التيرمنال العادي وابعتلي النتيجة لو لسه مش شغال:<pre>dpkg -l swh-plugins swh-lv2 | tail -2; ls /usr/lib/ladspa | grep sc4m; which node</pre>دوّرت في: ${(dg.searched || []).map((x) => `<span class="mono">${x.p}</span> ${x.exists ? '✓' : '✗'}`).join(' · ')}</div></details>
        </div>`;
    const ib = $$('dnCompInstall');
    if (ib && !ib._bound) { ib._bound = true; ib.onclick = async () => {
      ib.disabled = true; ib.textContent = '⏳ بيسطّب…';
      const r = await fetch('/api/comp/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then((x) => x.json()).catch(() => ({ ok: false, error: 'السيرفر مردش' }));
      if (!r.ok) { ib.disabled = false; ib.textContent = '📦 سطّب swh-plugins دلوقتي'; alert(r.error); return; }
      const ref = (() => { try { return refresh; } catch { return null; } })();
      const iv = setInterval(async () => { if (ref) await ref(); labelsAll(); const d = STATUS?.clean?.capabilities; if (d?.compPath || d?.compDiag?.install?.ok === false) clearInterval(iv); }, 2500);
    }; }
    const p = s.profile || 'custom';
    $$('dnProfile').textContent = PNAME[p] || '✏️ مخصص';
    document.querySelectorAll('.dn-scene').forEach((b) => b.classList.toggle('on', b.dataset.scene === p));
    // pipeline
    const chip = (on, t, sub) => `<span class="dn-chip ${on ? 'on' : ''}">${t}<small>${sub}</small></span>`;
    const eqOn = (s.eq || []).some((b) => Number(b.gain) !== 0);
    const parts = [
      chip(true, '🎤 المايك', 'الافتراضي'),
      chip(Number(s.highpass) > 0, 'قص الواطي', Number(s.highpass) > 0 ? s.highpass + ' Hz' : 'مقفول'),
      chip(r1, 'RNNoise ١', r1 ? 'بوابة ' + s.vadThreshold + '%' : 'مقفول'),
      chip(r1 && s.rnnoise2, 'RNNoise ٢', r1 && s.rnnoise2 ? 'بوابة ' + s.vad2Threshold + '%' : 'مقفول'),
      chip(eqOn, 'EQ', eqOn ? 'متعدّل' : 'مسطح'),
      chip(s.comp && hasComp(), 'ضاغط', s.comp ? (hasComp() ? s.compRatio + ':1' : 'مش متسطب') : 'مقفول'),
      chip(true, 'تعلية', (Number(s.outputGainDb) > 0 ? '+' : '') + s.outputGainDb + ' dB'),
      chip(s.limiter !== false && hasComp(), '🛡 ليميتر', s.limiter !== false ? (hasComp() ? s.limiterCeiling + ' dB' : 'مش متسطب') : 'مقفول'),
      chip(true, '📥 Mic Clean', 'للبرامج'),
    ];
    $$('dnPipe').innerHTML = parts.join('<span class="dn-arrow">←</span>');
  }
  function sync() {
    const s = S(); if (!s) return;
    $$('dnR2').checked = !!s.rnnoise2; $$('dnC').checked = !!s.comp; $$('dnL').checked = s.limiter !== false;
    for (const [id, key] of MAP) if (document.activeElement !== $$(id)) $$(id).value = s[key];
    labelsAll();
  }
  // keep in sync whenever the main page re-renders the engine UI
  if (typeof renderEngine === 'function') { const orig = renderEngine; window.renderEngine = function () { orig.apply(this, arguments); sync(); }; }

  const markCustom = () => { const s = S(); if (s && s.profile !== 'custom') { s.profile = 'custom'; } };
  for (const [id, key] of MAP) $$(id).addEventListener('input', () => { const s = S(); if (!s) return; s[key] = Number($$(id).value); markCustom(); labelsAll(); push(); });
  $$('dnR2').addEventListener('change', () => { const s = S(); if (!s) return; s.rnnoise2 = $$('dnR2').checked; markCustom(); labelsAll(); push(); });
  $$('dnL').addEventListener('change', () => { const s = S(); if (!s) return; s.limiter = $$('dnL').checked; markCustom(); labelsAll(); push(); });
  $$('dnC').addEventListener('change', () => { const s = S(); if (!s) return; s.comp = $$('dnC').checked; markCustom(); labelsAll(); push(); });
  // main controls edited by hand → custom
  pw.addEventListener('input', (e) => { if (!e.target.closest('.dn-wrap')) { markCustom(); setTimeout(labelsAll, 0); } }, true);
  pw.addEventListener('change', (e) => { if (!e.target.closest('.dn-wrap')) { markCustom(); setTimeout(labelsAll, 0); } }, true);

  $$('dnSceneList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-scene]'); if (!b) return;
    const s = S(); if (!s) return;
    const sc = SCENES[b.dataset.scene];
    const { eq, ...rest } = sc.s;
    Object.assign(s, rest, { profile: b.dataset.scene, engine: 'pipewire' });
    s.eq.forEach((band, i) => (band.gain = eq[i] ?? 0));
    if (typeof renderEngine === 'function') renderEngine(); else sync();
    push();
    const info = document.getElementById('applyInfo'); if (info) info.textContent = `✓ اتطبّق وضع ${sc.t}`;
  });

  // wait for first status load
  const wait = setInterval(() => { if (S()) { clearInterval(wait); sync(); } }, 300);
  setInterval(labelsAll, 3000); // capability (compressor installed?) may change after refresh
})();
