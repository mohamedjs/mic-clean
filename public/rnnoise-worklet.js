// RNNoise + VAD gate as an AudioWorklet — same controls as the Linux LADSPA plugin:
//   vad    : VAD threshold %  (0 = never gate, only denoise)
//   grace  : ms the gate stays open after voice stops
//   retro  : ms of look-back so the first syllable isn't cut (adds the same latency)
//   enabled: false = pass-through
// RNNoise works on 480-sample frames @ 48 kHz (10 ms); the AudioContext must run at 48 kHz.
import createRNNWasmModuleSync from './vendor/rnnoise-sync.js';

const FRAME = 480;
const FRAME_MS = 10;

class RNNoiseGate extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.cfg = { vad: 50, grace: 200, retro: 0, enabled: true, ...p };
    this.m = createRNNWasmModuleSync();
    this.state = this.m._rnnoise_create();
    this.inPtr = this.m._malloc(FRAME * 4);
    this.outPtr = this.m._malloc(FRAME * 4);
    this.acc = new Float32Array(FRAME); this.accN = 0;
    // output FIFO
    this.q = new Float32Array(FRAME * 64); this.qr = 0; this.qw = 0; this.qn = 0;
    this.pending = [];            // retro look-back frames: {data, open}
    this.graceLeft = 0;
    this.gain = 1;                // smoothed gate gain
    this.vadAvg = 0; this.lastPost = 0; this.frames = 0; this.openFrames = 0;
    this.port.onmessage = (e) => { Object.assign(this.cfg, e.data || {}); };
    // prime the FIFO with one frame so output never underruns
    for (let i = 0; i < FRAME; i++) this.push(0);
  }
  push(v) { this.q[this.qw] = v; this.qw = (this.qw + 1) % this.q.length; if (this.qn < this.q.length) this.qn++; else this.qr = (this.qr + 1) % this.q.length; }
  pop() { const v = this.q[this.qr]; this.qr = (this.qr + 1) % this.q.length; this.qn--; return v; }

  emit(frame, open) {
    const target = open ? 1 : 0;
    const start = this.gain, step = (target - start) / FRAME;   // 10 ms ramp → no clicks
    for (let i = 0; i < FRAME; i++) this.push(frame[i] * (start + step * (i + 1)));
    this.gain = target;
    this.frames++; if (open) this.openFrames++;
  }

  processFrame() {
    const H = this.m.HEAPF32, ib = this.inPtr >> 2, ob = this.outPtr >> 2;
    for (let i = 0; i < FRAME; i++) H[ib + i] = this.acc[i] * 32768;
    const vad = this.m._rnnoise_process_frame(this.state, this.outPtr, this.inPtr);
    const out = new Float32Array(FRAME);
    for (let i = 0; i < FRAME; i++) out[i] = H[ob + i] / 32768;
    this.vadAvg = this.vadAvg * 0.8 + vad * 0.2;

    const thr = Math.max(0, Math.min(99, Number(this.cfg.vad) || 0)) / 100;
    let open;
    if (thr === 0 || vad >= thr) {
      open = true; this.graceLeft = Number(this.cfg.grace) || 0;
      for (const f of this.pending) f.open = true;   // retroactive: open the look-back frames too
    } else if (this.graceLeft > 0) { open = true; this.graceLeft -= FRAME_MS; }
    else open = false;

    const D = Math.round((Number(this.cfg.retro) || 0) / FRAME_MS);
    this.pending.push({ data: out, open });
    while (this.pending.length > D) { const f = this.pending.shift(); this.emit(f.data, f.open); }
  }

  process(inputs, outputs) {
    const inp = inputs[0] && inputs[0][0];
    const out = outputs[0] && outputs[0][0];
    if (!out) return true;
    const n = out.length;
    if (!this.cfg.enabled) { // bypass (keep it simple: straight copy)
      if (inp) out.set(inp); else out.fill(0);
      for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
      return true;
    }
    if (inp) {
      for (let i = 0; i < n; i++) {
        this.acc[this.accN++] = inp[i];
        if (this.accN === FRAME) { this.processFrame(); this.accN = 0; }
      }
    }
    for (let i = 0; i < n; i++) out[i] = this.qn > 0 ? this.pop() : 0;
    for (let c = 1; c < outputs[0].length; c++) outputs[0][c].set(out);
    // report VAD to the page ~10×/s for the meters
    if (currentTime - this.lastPost > 0.1) {
      this.lastPost = currentTime;
      this.port.postMessage({ vad: this.vadAvg, open: this.gain > 0.5, openRatio: this.frames ? this.openFrames / this.frames : 0 });
    }
    return true;
  }
}
registerProcessor('rnnoise-gate', RNNoiseGate);
