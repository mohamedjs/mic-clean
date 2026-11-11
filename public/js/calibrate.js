// Gain calibration: listen 8 s, then raise mic gain first and digital gain after RNNoise.
(() => {
  'use strict';
  const $$ = (id) => document.getElementById(id);
  const mic = $$('micBtn'); if (!mic) return;
  const panel = mic.closest('.panel, .tab-panel') || mic.parentNode;
  panel.insertBefore($$('cbTpl').content.firstElementChild.cloneNode(true), panel.firstElementChild);

  const post = async (p, b) => { const r = await fetch(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }); return r.json().catch(() => ({ ok: false })); };
  const L = (s) => `<span class="ltr">${s}</span>`;
  const toDb = (x) => (x > 1e-9 ? 20 * Math.log10(x) : -120);
  const pos = (db) => Math.max(0, Math.min(100, ((db + 60) / 60) * 100));
  $$('cbZone').style.left = pos(-24) + '%'; $$('cbZone').style.width = (pos(-16) - pos(-24)) + '%';
  const TARGET_VOICE = -20, TARGET_PEAK = -6, MAX_POST = 12;
  const G = (name) => { try { return eval(name); } catch { return undefined; } }; // read other script's globals (let/const)
  const step = (n, cls) => { const e = $$('cbS' + n); e.classList.remove('on', 'done'); if (cls) e.classList.add(cls); };
  const badge = (t, cls) => { $$('cbBadge').textContent = t; $$('cbBadge').className = 'badge ' + cls; };

  function hwSource() {
    const st = G('STATUS'), s = G('SETTINGS'); if (!st?.sources) return null;
    return st.sources.find((x) => x.name === s?.master && x.origin.kind === 'hardware') || st.sources.find((x) => x.name === s?.previousDefault && x.origin.kind === 'hardware') || st.sources.find((x) => x.origin.kind === 'hardware' && x.isDefault) || st.sources.find((x) => x.origin.kind === 'hardware');
  }
  async function ensureListening(side) {
    if (!G('running')) { mic.click(); for (let i = 0; i < 40 && !G('running'); i++) await new Promise((r) => setTimeout(r, 150)); }
    const setActive = G('setActive'); if (typeof setActive === 'function') setActive(side);
    await new Promise((r) => setTimeout(r, 400));
  }
  async function measure(seconds) {
    const an = G('analyser'); if (!an) throw new Error('الاستماع مشتغلش');
    const buf = new Float32Array(an.fftSize), rms = [], peaks = [];
    $$('cbLive').style.display = '';
    const t0 = performance.now();
    await new Promise((done) => {
      const iv = setInterval(() => {
        an.getFloatTimeDomainData(buf);
        let pk = 0, sum = 0; for (let i = 0; i < buf.length; i++) { const v = Math.abs(buf[i]); if (v > pk) pk = v; sum += buf[i] * buf[i]; }
        const r = toDb(Math.sqrt(sum / buf.length)); rms.push(r); peaks.push(toDb(pk));
        $$('cbFill').style.width = pos(r) + '%';
        const left = Math.max(0, Math.ceil(seconds - (performance.now() - t0) / 1000)); $$('cbCount').textContent = left;
        if (performance.now() - t0 > seconds * 1000) { clearInterval(iv); done(); }
      }, 50);
    });
    $$('cbLive').style.display = 'none';
    const sr = [...rms].sort((a, b) => a - b), sp = [...peaks].sort((a, b) => a - b);
    return { voice: sr[Math.floor(sr.length * 0.9)], floor: sr[Math.floor(sr.length * 0.1)], peak: sp[Math.floor(sp.length * 0.995)] };
  }
  const pctToDb = (p) => 60 * Math.log10(Math.max(1, p) / 100);  // pactl cubic volume curve
  const dbToPct = (d) => 100 * Math.pow(10, d / 60);

  let plan = null;
  $$('cbStart').onclick = async () => {
    const src = hwSource();
    if (!src) { $$('cbResult').innerHTML = '<div class="status err">مش لاقي المايك الحقيقي. افتح تاب «المايكات» واتأكد إنه ظاهر.</div>'; return; }
    $$('cbStart').disabled = true; $$('cbResult').innerHTML = ''; badge('بيقيس…', 'b-filter'); step(1, 'on'); step(2); step(3);
    try {
      await ensureListening('A');
      const m = await measure(8);
      if (m.voice - m.floor < 8) {
        badge('مسمعتش كلام', 'b-filter');
        $$('cbResult').innerHTML = `<div class="status err">مسمعتش كلام واضح (الفرق بين الكلام والسكوت ${m.voice - m.floor < 0 ? 0 : (m.voice - m.floor).toFixed(0)} dB بس). اتأكد إن A = المايك الـ USB، واتكلم بصوت عادي طول الـ 8 ثواني.</div>`;
        return;
      }
      const need = Math.min(TARGET_VOICE - m.voice, TARGET_PEAK - m.peak);   // dB to add (neg = too loud)
      const curPct = src.volumePercent ?? 100, curDb = pctToDb(curPct);
      let newPct = Math.round(Math.max(20, Math.min(100, dbToPct(curDb + need))));
      if (need > 0 && newPct < curPct) newPct = curPct;
      const hwGain = pctToDb(newPct) - curDb;
      const rest = Math.max(0, need - hwGain);
      const post = Math.min(MAX_POST, Math.round(rest * 2) / 2);
      plan = { src, curPct, newPct, hwGain, post, need, m, short: rest - post };
      badge('جاهز للتطبيق', 'b-filter'); step(1, 'done');
      const verdict = need > 1 ? `صوتك <b>واطي</b> بحوالي ${L(need.toFixed(1) + ' dB')}.` : need < -1 ? `صوتك <b>عالي</b> بحوالي ${L((-need).toFixed(1) + ' dB')}، وممكن يتكسر.` : 'صوتك <b>مظبوط</b> تقريبًا.';
      $$('cbResult').innerHTML = `
        <div class="status" style="margin-top:12px">📊 كلامك عند ${L(m.voice.toFixed(1) + ' dB')} (المثالي حوالي ${L(TARGET_VOICE + ' dB')})، وأعلى قمة ${L(m.peak.toFixed(1) + ' dB')}، والضوضاء وانت ساكت ${L(m.floor.toFixed(1) + ' dB')}.<br>${verdict}</div>
        <div class="cb-plan">
          <div class="it"><span class="n">١</span><div>جين <b>${src.description}</b>: من <span class="cb-big">${curPct}%</span> لـ <span class="cb-big">${newPct}%</span> (${L((hwGain >= 0 ? '+' : '') + hwGain.toFixed(1) + ' dB')}).<div class="small muted">${newPct >= 100 && need > hwGain + 0.5 ? 'وصلنا لأقصى تعلية نضيفة من المايك نفسه.' : 'تعلية من المايك نفسه، ودي أنضف حاجة.'}</div></div></div>
          <div class="it"><span class="n">٢</span><div>تعلية بعد عزل الضوضاء: <span class="cb-big">${L('+' + post + ' dB')}</span><div class="small muted">${post > 0 ? 'بتعلّي صوتك بعد ما الضوضاء اتشالت، فالنقاء بيفضل زي ما هو.' : 'مش محتاجين.'}</div></div></div>
          <div class="it"><span class="n">٣</span><div>الليميتر: سقف عند ${L('-2 dB')}.<div class="small muted">لو علّيت صوتك فجأة، مش هيحصل تكسير.</div></div></div>
          ${plan.short > 1 ? `<div class="status err">⚠ لسه ناقص ${L(plan.short.toFixed(1) + ' dB')} بعد أقصى تعلية آمنة. <b>قرّب من المايك</b> (10–15 سم) أو اتأكد إنه مش متوجّه بعيد عنك، وبعدين عيد المعايرة. التعلية الزيادة هتعلّي الهسهسة.</div>` : ''}
        </div>
        <div class="row" style="margin-top:14px"><button class="btn mint big" id="cbApply">✓ طبّق</button><button class="btn" id="cbAgain">↻ عيد القياس</button></div>`;
      $$('cbApply').onclick = apply; $$('cbAgain').onclick = () => $$('cbStart').click();
    } catch (e) {
      badge('مشكلة', 'b-filter'); $$('cbResult').innerHTML = `<div class="status err">${e.message}</div>`;
    } finally { $$('cbStart').disabled = false; }
  };

  async function apply() {
    const s = G('SETTINGS'); if (!s || !plan) return;
    $$('cbApply').disabled = true; step(2, 'on');
    await post('/api/source/volume', { name: plan.src.name, percent: plan.newPct });
    if ($$('cbLecture').checked) { const b = document.querySelector('[data-scene="lecture"]'); if (b) b.click(); }
    s.outputGainDb = plan.post; s.limiter = true; s.limiterCeiling = -2;
    if (!s.master) s.master = plan.src.name;
    const re = G('renderEngine'); if (typeof re === 'function') re();
    const pu = G('pushUpdate'); if (typeof pu === 'function') pu();
    const ref = G('refresh'); if (typeof ref === 'function') setTimeout(ref, 600);
    step(2, 'done'); step(3, 'done'); badge('اتطبّق ✓', 'b-hardware');
    const st = G('STATUS'); const running = st?.clean?.running;
    $$('cbResult').innerHTML += `<div class="status" style="margin-top:12px">✓ اتطبّق. ${running ? '' : '<b>شغّل المايك النضيف</b> من «الرئيسية» عشان التعلية بعد العزل تشتغل. '}دوس «اختبر النتيجة» واتكلم 5 ثواني على Mic Clean (B).</div>
      <div class="row" style="margin-top:10px"><button class="btn primary" id="cbVerify">🎧 اختبر النتيجة على B</button></div>`;
    $$('cbVerify').onclick = verify;
  }
  async function verify() {
    $$('cbVerify').disabled = true; badge('بيختبر…', 'b-filter');
    await ensureListening('B');
    const m = await measure(5);
    const okV = m.voice >= -24 && m.voice <= -14, okP = m.peak < -1, okF = m.floor < -55;
    badge(okV && okP ? 'ممتاز ✓' : 'محتاج لمسة', okV && okP ? 'b-hardware' : 'b-filter');
    $$('cbResult').innerHTML += `<div class="status" style="margin-top:12px">
      ${okV ? '✅' : '⚠'} الكلام: ${L(m.voice.toFixed(1) + ' dB')} ${okV ? '(مثالي للشرح)' : m.voice < -24 ? '(لسه واطي. علّي «التعلية النهائية» شوية، أو قرّب من المايك)' : '(عالي شوية. وطّي «التعلية النهائية»)'}<br>
      ${okP ? '✅' : '⚠'} أعلى قمة: ${L(m.peak.toFixed(1) + ' dB')} ${okP ? '(مفيش تكسير)' : '(قريب من التكسير. وطّي التعلية)'}<br>
      ${okF ? '✅' : '⚠'} الضوضاء وانت ساكت: ${L(m.floor.toFixed(1) + ' dB')} ${okF ? '(نضيف)' : '(فيه ضوضاء. علّي بوابة RNNoise ١ أو شغّل المرحلة التانية)'}
    </div>`;
  }
})();
