/* Mic (Mohamed) — in-browser audio engine (used on macOS; optional on Linux)
 *
 * mic → input gain → high-pass → RNNoise ① → RNNoise ② → 10-band EQ → compressor
 *     → make-up → output gain → limiter → output device (BlackHole on Mac)
 *
 * Other apps (Zoom/OBS/Meet) then pick "BlackHole 2ch" (or the "Mic (Mohamed)"
 * aggregate you make in Audio MIDI Setup) as their microphone.
 * Settings are the same object the dashboard already edits (global SETTINGS).
 */
(() => {
  'use strict';
  const G = (n) => { try { return eval(n); } catch { return undefined; } }; // read other scripts' let/const globals
  const EQ_DEFAULT = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

  // ---------------------------------------------------------------- DSP chain
  async function buildChain(ctx, s) {
    await ctx.audioWorklet.addModule(new URL('rnnoise-worklet.js', document.baseURI).href);
    const n = {};
    n.input = ctx.createGain();
    n.hp = ctx.createBiquadFilter(); n.hp.type = 'highpass'; n.hp.Q.value = 0.707;
    const rnOpts = (vad, grace, retro, enabled) => ({ numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit', processorOptions: { vad, grace, retro, enabled } });
    n.rn1 = new AudioWorkletNode(ctx, 'rnnoise-gate', rnOpts(s.vadThreshold, s.vadGrace, s.retroGrace, !!s.rnnoise));
    n.rn2 = new AudioWorkletNode(ctx, 'rnnoise-gate', rnOpts(s.vad2Threshold, s.vad2Grace, s.retro2Grace, !!(s.rnnoise && s.rnnoise2)));
    n.eq = (s.eq || EQ_DEFAULT.map((f) => ({ freq: f, gain: 0, q: 1 }))).map(() => { const b = ctx.createBiquadFilter(); b.type = 'peaking'; return b; });
    n.comp = ctx.createDynamicsCompressor();
    n.makeup = ctx.createGain();
    n.out = ctx.createGain();
    n.limiter = ctx.createDynamicsCompressor();
    n.clip = ctx.createWaveShaper(); n.clip.oversample = '4x'; // hard safety ceiling after the limiter
    n.output = ctx.createGain(); // final node
    const chain = [n.input, n.hp, n.rn1, n.rn2, ...n.eq, n.comp, n.makeup, n.out, n.limiter, n.clip, n.output];
    for (let i = 0; i < chain.length - 1; i++) chain[i].connect(chain[i + 1]);
    n.vad = [0, 0];
    n.rn1.port.onmessage = (e) => { n.vad[0] = e.data.vad; n.gate1 = e.data.open; };
    n.rn2.port.onmessage = (e) => { n.vad[1] = e.data.vad; n.gate2 = e.data.open; };
    n.apply = (st) => apply(ctx, n, st);
    n.apply(s);
    return n;
  }
  const db = (d) => Math.pow(10, (Number(d) || 0) / 20);
  function apply(ctx, n, s) {
    const t = ctx.currentTime, set = (p, v) => p.setTargetAtTime(v, t, 0.02);
    set(n.input.gain, db(s.webInputGainDb || 0));
    const hp = Number(s.highpass) || 0;
    set(n.hp.frequency, hp > 0 ? hp : 1);                     // 1 Hz ≈ off
    n.rn1.port.postMessage({ vad: s.vadThreshold, grace: s.vadGrace, retro: s.retroGrace, enabled: !!s.rnnoise });
    n.rn2.port.postMessage({ vad: s.vad2Threshold, grace: s.vad2Grace, retro: s.retro2Grace, enabled: !!(s.rnnoise && s.rnnoise2) });
    (s.eq || []).forEach((b, i) => { const f = n.eq[i]; if (!f) return; set(f.frequency, b.freq); set(f.Q, b.q || 1); set(f.gain, Number(b.gain) || 0); });
    if (s.comp) {
      set(n.comp.threshold, Math.max(-100, Math.min(0, Number(s.compThreshold))));
      set(n.comp.ratio, Math.max(1, Math.min(20, Number(s.compRatio))));
      set(n.comp.attack, Math.max(0, Number(s.compAttack) / 1000));
      set(n.comp.release, Math.max(0.01, Number(s.compRelease) / 1000));
      set(n.comp.knee, 6);
      set(n.makeup.gain, db(s.compMakeup));
    } else { set(n.comp.threshold, 0); set(n.comp.ratio, 1); set(n.comp.knee, 0); set(n.makeup.gain, 1); }
    set(n.out.gain, db(s.outputGainDb));
    if (s.limiter !== false) {
      set(n.limiter.threshold, Math.min(0, Number(s.limiterCeiling ?? -2))); set(n.limiter.ratio, 20);
      set(n.limiter.attack, 0.001); set(n.limiter.release, 0.06); set(n.limiter.knee, 0);
    } else { set(n.limiter.threshold, 0); set(n.limiter.ratio, 1); set(n.limiter.knee, 0); }
    // soft-knee clipper: linear up to 80% of the ceiling, then bends smoothly into it — never above
    const ceil = s.limiter !== false ? db(Math.min(-0.1, Number(s.limiterCeiling ?? -2))) : 1;
    if (n.clipCeil !== ceil) {
      n.clipCeil = ceil;
      const N = 4096, c = new Float32Array(N), k = 0.8 * ceil;
      for (let i = 0; i < N; i++) {
        const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x);
        const y = a <= k ? a : k + (ceil - k) * Math.tanh((a - k) / (ceil - k));
        c[i] = Math.sign(x) * Math.min(y, ceil);
      }
      n.clip.curve = c;
    }
  }

  // ---------------------------------------------------------------- live engine
  const E = { ctx: null, nodes: null, stream: null, running: false, monitorEl: null, monitorDest: null, error: '' };
  async function start({ inputId, outputId } = {}) {
    await stop();
    const s = G('SETTINGS'); if (!s) throw new Error('الإعدادات لسه بتحمّل. جرب كمان ثانية.');
    // permission first (device ids are hidden until then)
    try { const p = await navigator.mediaDevices.getUserMedia({ audio: true }); p.getTracks().forEach((t) => t.stop()); }
    catch (e) { throw new Error(e.name === 'NotAllowedError' ? 'البراوزر رافض المايك. اسمح بالميكروفون من أيقونة القفل 🔒 جنب العنوان.' : 'مقدرتش أفتح المايك: ' + e.message); }
    const ctx = new AudioContext({ sampleRate: 48000, latencyHint: 'interactive' });
    E.ctx = ctx;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: {
      deviceId: inputId ? { exact: inputId } : undefined, channelCount: { ideal: 1 },
      echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    E.stream = stream;
    const src = ctx.createMediaStreamSource(stream);
    const n = await buildChain(ctx, s);
    src.connect(n.input);
    n.output.connect(ctx.destination);
    // extra tap for "hear myself" + recording
    E.monitorDest = ctx.createMediaStreamDestination(); n.output.connect(E.monitorDest);
    E.nodes = n;
    if (outputId) {
      if (typeof ctx.setSinkId !== 'function') throw new Error('البراوزر ده مش بيقدر يطلّع الصوت على BlackHole. افتح الداشبورد في Google Chrome.');
      await ctx.setSinkId(outputId);
    }
    if (ctx.state === 'suspended') await ctx.resume();
    E.running = true; E.error = '';
    return E;
  }
  async function stop() {
    E.running = false;
    try { E.stream?.getTracks().forEach((t) => t.stop()); } catch {}
    try { if (E.monitorEl) { E.monitorEl.pause(); E.monitorEl.srcObject = null; } } catch {}
    try { await E.ctx?.close(); } catch {}
    E.ctx = E.nodes = E.stream = null;
  }
  async function setMonitor(on, sinkId) {
    if (!E.running) return;
    if (!E.monitorEl) { E.monitorEl = new Audio(); E.monitorEl.autoplay = true; }
    if (!on) { E.monitorEl.pause(); E.monitorEl.srcObject = null; return; }
    E.monitorEl.srcObject = E.monitorDest.stream;
    if (sinkId && E.monitorEl.setSinkId) { try { await E.monitorEl.setSinkId(sinkId); } catch {} }
    await E.monitorEl.play().catch(() => {});
  }
  window.MicWebEngine = { buildChain, apply, start, stop, setMonitor, state: E };

  // ---------------------------------------------------------------- UI (only when the platform needs it)
  const qs = new URLSearchParams(location.search);
  function platform() { const st = G('STATUS'); return qs.get('engine') === 'web' ? 'web' : st?.platform === 'darwin' ? 'darwin' : st ? 'linux' : null; }

  const CARD = `
  <section class="card clay we-card" id="weCard" style="margin-bottom:22px">
    <h2><span class="emo bg-sky">🍏</span>Mic (Mohamed) على الماك <span class="sp"></span><span class="badge b-unknown" id="weBadge">متوقف</span></h2>
    <p class="lead">على الماك التنضيف بيحصل <b>جوه الصفحة دي</b>، وبعدين الصوت بيطلع على <b>BlackHole</b>. في زوم أو OBS أو ميت اختار <b>BlackHole 2ch</b> كمايك (أو «Mic (Mohamed)» لو عملته من Audio MIDI Setup). <b>لازم الأبلكيشن يفضل مفتوح</b>، وممكن تصغّره عادي.</p>
    <div class="grid g2" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">
      <div><div class="small muted" style="font-weight:800;margin-bottom:6px">🎤 المايك الحقيقي (الدخل)</div><select id="weIn" style="width:100%"></select></div>
      <div><div class="small muted" style="font-weight:800;margin-bottom:6px">🔊 يطلع على (الخرج)</div><select id="weOut" style="width:100%"></select></div>
    </div>
    <div id="weWarn" style="margin-top:10px"></div>
    <div class="row" style="margin-top:14px">
      <button class="btn primary" id="weStart">▶ شغّل Mic (Mohamed)</button>
      <button class="btn danger" id="weStop">■ وقّف</button>
      <label class="chk small"><input type="checkbox" class="switch" id="weMon"> 🎧 اسمع الصوت النضيف (بالهيدفون)</label>
    </div>
    <div class="row small" style="margin-top:12px;gap:18px">
      <span>RNNoise ١: <b class="ltr" id="weV1">–</b></span>
      <span>RNNoise ٢: <b class="ltr" id="weV2">–</b></span>
      <span>الضاغط شايل: <b class="ltr" id="weGR">–</b></span>
      <span>الليميتر: <b class="ltr" id="weLR">–</b></span>
    </div>
    <div id="weMsg" style="margin-top:8px"></div>
    <details class="hint" style="margin-top:10px"><summary>ⓘ أعمل مايك اسمه «Mic (Mohamed)» على الماك (مرة واحدة)</summary><div class="help">
      ١. افتح <b>Audio MIDI Setup</b> (من Spotlight).<br>
      ٢. دوس <b>+</b> تحت على الشمال ← <b>Create Aggregate Device</b>.<br>
      ٣. علّم على <b>BlackHole 2ch</b> بس، ودوس دبل كليك على الاسم وسمّيه <b>Mic (Mohamed)</b>.<br>
      دلوقتي زوم وOBS هيظهرلهم مايك اسمه «Mic (Mohamed)»، وهو نفس الصوت النضيف اللي طالع من هنا.
    </div></details>
  </section>`;

  let mounted = false;
  async function fillDevices() {
    let devs = [];
    try { devs = await navigator.mediaDevices.enumerateDevices(); } catch {}
    const ins = devs.filter((d) => d.kind === 'audioinput' && !/blackhole|mohamed/i.test(d.label) && d.deviceId !== 'communications');
    const outs = devs.filter((d) => d.kind === 'audiooutput');
    const s = G('SETTINGS') || {};
    const inSel = document.getElementById('weIn'), outSel = document.getElementById('weOut');
    const keepIn = inSel.value || s.webInputId || '', keepOut = outSel.value || s.webOutputId || '';
    inSel.innerHTML = ins.map((d) => `<option value="${d.deviceId}">${d.label || 'مايك (اسمح للبراوزر يشوف الأسماء)'}</option>`).join('') || '<option value="">مفيش مايك</option>';
    outSel.innerHTML = outs.map((d) => `<option value="${d.deviceId}">${d.label || 'خرج'}</option>`).join('') || '<option value="">الافتراضي</option>';
    if (keepIn && ins.some((d) => d.deviceId === keepIn)) inSel.value = keepIn;
    else { const usb = ins.find((d) => /usb/i.test(d.label) && d.deviceId !== 'default'); if (usb) inSel.value = usb.deviceId; }
    const bh = outs.find((d) => /blackhole/i.test(d.label) || /mohamed/i.test(d.label));
    if (keepOut && outs.some((d) => d.deviceId === keepOut)) outSel.value = keepOut; else if (bh) outSel.value = bh.deviceId;
    const warn = document.getElementById('weWarn');
    const labelsHidden = devs.length && devs.every((d) => !d.label);
    warn.innerHTML = labelsHidden ? '<div class="status">دوس «شغّل» مرة وهيطلب إذن المايك، وبعدها الأسماء هتظهر.</div>'
      : !bh && platform() === 'darwin' ? '<div class="status err">⚠ مش لاقي BlackHole. سطّبه مرة واحدة: <span class="mono">brew install blackhole-2ch</span> (أو شغّل <span class="mono">bash install-mac.sh</span>)، وبعدين اعمل ريستارت للماك.</div>'
      : typeof AudioContext.prototype.setSinkId !== 'function' ? '<div class="status err">⚠ البراوزر ده مش بيقدر يختار جهاز الخرج. افتح الداشبورد في <b>Google Chrome</b>.</div>' : '';
  }
  function mount() {
    if (mounted) return;
    const pw = document.getElementById('pwControls'); if (!pw) return;
    const holder = document.createElement('div'); holder.innerHTML = CARD;
    const scenes = document.getElementById('dnScenes');
    (scenes || pw).parentNode.insertBefore(holder.firstElementChild, scenes || pw);
    mounted = true;
    // Linux-only bits make no sense on the Mac
    ['legacyCard'].forEach((id) => { const el = document.getElementById(id); if (el) el.style.display = 'none'; });
    const eng = document.getElementById('engine'); if (eng) { eng.value = 'pipewire'; eng.closest('div')?.style && (eng.disabled = true); }
    document.getElementById('weStart').onclick = async () => {
      const b = document.getElementById('weStart'); b.disabled = true; msg('');
      try {
        const s = G('SETTINGS');
        s.webInputId = document.getElementById('weIn').value; s.webOutputId = document.getElementById('weOut').value;
        await start({ inputId: s.webInputId, outputId: s.webOutputId });
        const pu = G('pushUpdate'); if (typeof pu === 'function') pu();   // saves the chosen devices
        await fillDevices();
        if (document.getElementById('weMon').checked) setMonitor(true);
        const outName = document.getElementById('weOut').selectedOptions[0]?.text || '';
        if (/blackhole|mohamed/i.test(outName)) msg('✓ Mic (Mohamed) شغال. اختار <b>' + outName + '</b> كمايك في البرنامج اللي هتسجل بيه.', 'ok');
        else msg('شغال، بس الخرج مش BlackHole (<b>' + (outName || 'الافتراضي') + '</b>)، فالبرامج التانية مش هتشوف الصوت النضيف. اختار BlackHole 2ch في «يطلع على».', 'err');
      } catch (e) { msg(e.message, 'err'); await stop(); }
      b.disabled = false; badge();
    };
    document.getElementById('weStop').onclick = async () => { await stop(); msg('اتوقف.'); badge(); };
    document.getElementById('weMon').onchange = (e) => setMonitor(e.target.checked);
    document.getElementById('weIn').onchange = () => E.running && document.getElementById('weStart').click();
    document.getElementById('weOut').onchange = async (e) => { if (E.running && E.ctx.setSinkId) { try { await E.ctx.setSinkId(e.target.value); msg('✓ الخرج اتغيّر.', 'ok'); } catch (err) { msg(err.message, 'err'); } } };
    // The main «شغّل/وقّف» buttons drive the in-browser engine here
    const hook = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener('click', (ev) => { ev.stopImmediatePropagation(); ev.preventDefault(); fn(); }, true); };
    hook('startBtn', () => document.getElementById('weStart').click());
    hook('stopBtn', () => document.getElementById('weStop').click());
    navigator.mediaDevices?.addEventListener?.('devicechange', fillDevices);
    fillDevices();
    setInterval(meters, 150);
  }
  function msg(t, kind) { const el = document.getElementById('weMsg'); if (el) el.innerHTML = t ? `<div class="status ${kind === 'err' ? 'err' : ''}">${kind === 'err' ? '⚠ ' : ''}${t}</div>` : ''; }
  function badge() {
    const b = document.getElementById('weBadge'); if (!b) return;
    b.textContent = E.running ? 'شغال' : 'متوقف'; b.className = 'badge ' + (E.running ? 'b-hardware' : 'b-unknown');
    const es = document.getElementById('engineState'); if (es && platform() !== 'linux') es.textContent = E.running ? 'Mic (Mohamed) شغال · في البراوزر' : 'Mic (Mohamed) متوقف';
  }
  function meters() {
    const n = E.nodes; if (!n) { ['weV1', 'weV2', 'weGR', 'weLR'].forEach((id) => { const el = document.getElementById(id); if (el) el.textContent = '–'; }); return; }
    const s = G('SETTINGS') || {};
    const v = (x, on, gate) => on ? `${Math.round(x * 100)}% ${gate ? '🟢' : '⚫'}` : 'مقفول';
    document.getElementById('weV1').textContent = v(n.vad[0], s.rnnoise, n.gate1);
    document.getElementById('weV2').textContent = v(n.vad[1], s.rnnoise && s.rnnoise2, n.gate2);
    document.getElementById('weGR').textContent = s.comp ? `${n.comp.reduction.toFixed(1)} dB` : 'مقفول';
    document.getElementById('weLR').textContent = s.limiter !== false ? `${n.limiter.reduction.toFixed(1)} dB` : 'مقفول';
  }

  // re-apply settings whenever anything on the page is edited (after the page's own handlers ran)
  let pend = false;
  const schedule = () => { if (pend) return; pend = true; setTimeout(() => { pend = false; const s = G('SETTINGS'); if (E.nodes && s) apply(E.ctx, E.nodes, s); }, 30); };
  ['input', 'change', 'click'].forEach((t) => document.addEventListener(t, schedule, true));

  const boot = setInterval(() => { const p = platform(); if (!p) return; clearInterval(boot); if (p !== 'linux') mount(); }, 300);
})();
