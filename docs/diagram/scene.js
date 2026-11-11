// Mic Clean architecture as Excalidraw element skeletons. Render: node docs/diagram/render.mjs docs
const C = {
  user: ["#1e1e1e", "#ffec99"],
  pres: ["#1971c2", "#a5d8ff"],
  orch: ["#9c36b5", "#eebefa"],
  core: ["#2f9e44", "#b2f2bb"],
  base: ["#e8590c", "#ffd8a8"],
  kern: ["#495057", "#e9ecef"],
  ext:  ["#c2255c", "#fcc2d7"],
  store:["#0c8599", "#99e9f2"],
  root: ["#f08c00", "#fff3bf"],
};
const els = [];
function box(id, x, y, w, h, text, kind, opts = {}) {
  const [stroke, bg] = C[kind];
  B[id] = { x, y, w, h };
  els.push({
    type: opts.shape || "rectangle", id, x, y, width: w, height: h,
    strokeColor: stroke, backgroundColor: bg, fillStyle: "hachure",
    strokeWidth: 2, roughness: 1, roundness: { type: 3 },
    label: { text, fontSize: opts.fs || 18, fontFamily: 1, strokeColor: "#1e1e1e" },
  });
}
function frame(x, y, w, h, title, kind) {
  const [stroke] = C[kind];
  els.push({ type: "rectangle", x, y, width: w, height: h, strokeColor: stroke,
    backgroundColor: "transparent", strokeStyle: "dashed", strokeWidth: 1, roughness: 1,
    roundness: { type: 3 } });
  els.push({ type: "text", x: x + 14, y: y + 8, text: title, fontSize: 22, fontFamily: 1,
    strokeColor: stroke });
}
function text(x, y, t, fs = 20, color = "#1e1e1e") {
  els.push({ type: "text", x, y, text: t, fontSize: fs, fontFamily: 1, strokeColor: color });
}
const B = {};
function arrow(from, to, label, opts = {}) {
  const a0 = B[from], b0 = B[to], P = 6;
  let x1, y1, x2, y2;
  const ovX = Math.min(a0.x + a0.w, b0.x + b0.w) - Math.max(a0.x, b0.x);
  if (b0.y >= a0.y + a0.h || a0.y >= b0.y + b0.h) {        // vertical
    const down = b0.y >= a0.y + a0.h;
    const cx = ovX > 40 ? (Math.max(a0.x, b0.x) + Math.min(a0.x + a0.w, b0.x + b0.w)) / 2 : null;
    x1 = cx ?? a0.x + a0.w / 2; x2 = cx ?? b0.x + b0.w / 2;
    y1 = down ? a0.y + a0.h + P : a0.y - P; y2 = down ? b0.y - P : b0.y + b0.h + P;
  } else {                                                   // horizontal
    const right = b0.x >= a0.x + a0.w;
    const ovY = Math.min(a0.y + a0.h, b0.y + b0.h) - Math.max(a0.y, b0.y);
    const cy = ovY > 20 ? (Math.max(a0.y, b0.y) + Math.min(a0.y + a0.h, b0.y + b0.h)) / 2 : null;
    y1 = cy ?? a0.y + a0.h / 2; y2 = cy ?? b0.y + b0.h / 2;
    x1 = right ? a0.x + a0.w + P : a0.x - P; x2 = right ? b0.x - P : b0.x + b0.w + P;
  }
  if (opts.from) [x1, y1] = opts.from;
  if (opts.to) [x2, y2] = opts.to;
  const a = { type: "arrow", x: x1, y: y1, points: [[0, 0], [x2 - x1, y2 - y1]],
    width: Math.abs(x2 - x1), height: Math.abs(y2 - y1),
    strokeColor: opts.color || "#343a40", strokeWidth: 2, roughness: 1,
    strokeStyle: opts.dashed ? "dashed" : "solid", endArrowhead: "arrow" };
  if (opts.both) a.startArrowhead = "arrow";
  if (label) a.label = { text: label, fontSize: 15, fontFamily: 1 };
  els.push(a);
}

// ================================================================ Mic Clean
text(40, 20, "Mic Clean — architecture", 44);
text(40, 82, "any mic, studio clean · one process, modular monolith · Electron desktop app · deps flow downward", 20, "#495057");

// ---- you + the composition root (left column)
box("you", 30, 150, 260, 150, "🧑 You\ntalk into your\ndefault mic, press\n▶ Start, pick a scene", "user", { shape: "ellipse", fs: 18 });
box("root", 30, 350, 260, 150, "electron/main.js\nstarts src/server.js\nin-process, opens the\nwindow on 127.0.0.1", "root", { fs: 17 });
box("rule", 20, 545, 285, 300, "default-mic rule\nuse the system\ndefault mic,\nnever itself;\non stop, hand\nit back", "kern", { shape: "diamond", fs: 16 });

// ---- presentation
frame(320, 130, 1120, 170, "Presentation", "pres");
box("shell", 340, 175, 330, 105, "electron/  desktop shell\nwindow · tray · start at login\nmic permission · cleanup on quit", "pres", { fs: 16 });
box("win", 690, 175, 360, 105, "public/  the window (Arabic, RTL)\nHome · Tune · Listen & compare\nMics · Advanced · setup checklist", "pres", { fs: 16 });
box("webeng", 1070, 175, 350, 105, "js/engine-web.js  (macOS · Windows)\nWeb Audio + RNNoise WASM ×2\nEQ · compressor · limiter → setSinkId", "pres", { fs: 16 });

// ---- orchestration
frame(320, 330, 1120, 150, "Orchestration", "orch");
box("srv", 340, 375, 1080, 85, "src/server.js   picks the routes for this OS:  linux (PipeWire)  ·  darwin  ·  win32  ·  web (no pactl)\ncore/http on 127.0.0.1:4747 · same-origin writes only · JSON API /api/*  · autostart the clean mic", "orch", { fs: 17 });

// ---- core modules
frame(320, 510, 1120, 215, "Modules", "core");
const mods = [
  ["settings", "settings/\nload · save · reset\nv3: follow the\nsystem default mic"],
  ["linux", "linux/\npactl · default-mic\nchain-conf · engine\ngraph · legacy filters"],
  ["mac", "mac/\nCore Audio devices\ninput volume\nBlackHole"],
  ["windows", "windows/\nPowerShell devices\nVB-CABLE\n(+ Linux w/o pactl)"],
  ["deps", "deps/\nGET /api/deps\nwhat's missing +\nthe fix for each"],
  ["migrate", "migrate/\nswitches off the old\nMic (Mohamed)\nautostart"],
];
const mw = 170, mg = 14;
mods.forEach(([id, t], i) => box(id, 336 + i * (mw + mg), 555, mw, 150, t, "core", { fs: 15 }));

// ---- shared + kernel + storage
box("presets", 340, 755, 1080, 55, "shared/presets.js   Podcast (default) · Lecture · Meetings · Stream · Noisy · Natural  — server + window", "base", { fs: 17 });
box("core", 340, 835, 1080, 55, "core/   config (name, paths, OS mode) · exec (run, which — no shell) · http (routes + static) · fsutil", "kern", { fs: 17 });
box("cfg", 340, 925, 520, 85, "~/.config/mic-clean-dashboard/\nsettings.json · mic-clean-chain.conf", "store", { fs: 17 });
box("res", 900, 925, 520, 85, "app resources/\nladspa/librnnoise_ladspa.so (Linux) · licenses", "store", { fs: 17 });

// ---- outside the process
frame(1490, 130, 400, 880, "Outside the process", "ext");
box("pw", 1510, 175, 360, 135, "used by linux/\nPipeWire · PulseAudio\npactl · pw-cli · pw-dump\npipewire -c (filter-chain)", "ext", { fs: 16 });
box("ladspa", 1510, 335, 360, 120, "used by the chain\nLADSPA plugins\nRNNoise (bundled)\nswh-plugins sc4m", "ext", { fs: 16 });
box("cable", 1510, 480, 360, 120, "used by engine-web\nvirtual cables\nBlackHole 2ch (macOS)\nVB-CABLE (Windows)", "ext", { fs: 16 });
box("apps", 1510, 625, 360, 120, "your apps record\n“Mic Clean” / BlackHole\n/ CABLE Output\nZoom · Meet · OBS · Discord", "ext", { fs: 16 });
box("gh", 1510, 770, 360, 120, "GitHub\nActions: build 3 OSes\nReleases · Pages\nHomebrew cask", "ext", { fs: 16 });

// ---- arrows
arrow("you", "shell", "", { from: [296, 225], to: [334, 225] });
arrow("root", "srv", "", { color: "#f08c00", dashed: true, from: [296, 420], to: [334, 420] });
arrow("win", "srv", "JSON /api", { both: true, from: [870, 286], to: [870, 369] });
arrow("srv", "linux", "", { from: [520, 466], to: [520, 549] });
arrow("srv", "mac", "", { from: [704, 466], to: [704, 549] });
arrow("srv", "windows", "", { from: [888, 466], to: [888, 549] });
arrow("srv", "deps", "", { from: [1072, 466], to: [1072, 549] });
arrow("rule", "linux", "lives in linux/", { dashed: true, color: "#495057", from: [240, 770], to: [600, 715] });
arrow("settings", "cfg", "", { color: "#0c8599", dashed: true, from: [352, 711], to: [352, 919] });
for (const [id, y] of [["pw", 242], ["ladspa", 395], ["cable", 540], ["apps", 685], ["gh", 830]]) {
  arrow(id, id, "", { color: "#c2255c", from: [1446, y], to: [1504, y] });
}

// ---- the audio path
frame(30, 1050, 1860, 300, "Your voice, start to finish (Linux: PipeWire filter-chain, 48 kHz mono)", "orch");
const steps = [
  ["s1", "🎙 system\ndefault mic"],
  ["s2", "high-pass\n90 Hz"],
  ["s3", "RNNoise #1 gate\nRNNoise #2 polish"],
  ["s4", "10-band EQ\n(podcast curve)"],
  ["s5", "compressor sc4m\n+ make-up gain"],
  ["s6", "limiter\n−2 dB"],
  ["s7", "“Mic Clean”\n→ Zoom · OBS"],
];
const pw = 215, pg = 45;
steps.forEach(([id, t], i) => box(id, 60 + i * (pw + pg), 1110, pw, 90, t, "orch", { fs: 17 }));
for (let i = 0; i < steps.length - 1; i++) arrow(steps[i][0], steps[i + 1][0], "");
box("webpath", 60, 1240, 1000, 60, "macOS · Windows: the same chain runs inside the window (Web Audio) → setSinkId → BlackHole / CABLE Input", "core", { fs: 16 });
text(1100, 1250, "stop or quit: the virtual mic goes away and your default mic comes back", 17, "#9c36b5");

window.SCENE = els;
