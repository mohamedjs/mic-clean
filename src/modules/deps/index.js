'use strict';
// What this computer needs for the clean mic, what is missing and how to get it.
// GET /api/deps → { platform, items: [{ id, name, ok, level, why, fix }], ready }
//   level: 'required' (nothing works without it) | 'recommended' | 'optional'
//   fix:   { cmd } a command to copy · { url } a download page · { action } a button the app handles
const { MODE } = require('../../core/config');
const { run, which, has } = require('../../core/exec');

function pkgCmd(pkgs) {
  if (which('apt-get')) return 'sudo apt install ' + pkgs.apt;
  if (which('dnf')) return 'sudo dnf install ' + pkgs.dnf;
  if (which('pacman')) return 'sudo pacman -S ' + pkgs.pacman;
  if (which('zypper')) return 'sudo zypper install ' + pkgs.zypper;
  return 'sudo apt install ' + pkgs.apt;
}

async function linuxDeps() {
  const plugins = require('../linux/plugins');
  const info = await run('pactl', ['info']);
  const isPipeWire = /pipewire/i.test(info.out);
  return [
    { id: 'pactl', name: 'pactl (PulseAudio / PipeWire)', ok: info.ok, level: 'required',
      why: 'بيه الأبلكيشن بيشوف المايكات ويعمل المايك النضيف.',
      fix: { cmd: pkgCmd({ apt: 'pulseaudio-utils', dnf: 'pulseaudio-utils', pacman: 'libpulse', zypper: 'pulseaudio-utils' }) } },
    { id: 'pipewire', name: 'PipeWire', ok: isPipeWire && (await has('pipewire')), level: 'recommended',
      why: 'محرك RNNoise المزدوج محتاج PipeWire. من غيره بيشتغل محرك WebRTC الأبسط.',
      fix: { cmd: pkgCmd({ apt: 'pipewire pipewire-pulse wireplumber', dnf: 'pipewire pipewire-pulseaudio wireplumber', pacman: 'pipewire pipewire-pulse wireplumber', zypper: 'pipewire pipewire-pulseaudio wireplumber' }) } },
    { id: 'pwcli', name: 'pw-cli', ok: await has('pw-cli'), level: 'optional',
      why: 'بيخلي التعديلات تتطبق فورًا من غير ما المايك يقطع.',
      fix: { cmd: pkgCmd({ apt: 'pipewire-bin', dnf: 'pipewire-utils', pacman: 'pipewire', zypper: 'pipewire-tools' }) } },
    { id: 'rnnoise', name: 'RNNoise (عزل الضوضاء)', ok: !!plugins.findRnnoise(), level: 'required',
      why: 'الشبكة العصبية اللي بتشيل الضوضاء. النسخة المتسطبة من الأبلكيشن جواها نسخة جاهزة.',
      fix: { action: 'rnnoise', cmd: 'sudo apt install noise-suppression-for-voice' } },
    { id: 'swh', name: 'swh-plugins (الضاغط والليميتر)', ok: !!plugins.findComp(), level: 'recommended',
      why: 'بيخلي علو صوتك ثابت ويمنع التكسير. من غيره كل حاجة تانية شغالة.',
      fix: { action: 'comp', cmd: plugins.compPkg()?.cmd || 'sudo apt install swh-plugins' } },
  ];
}

async function macDeps() {
  const { macDevices } = require('../mac');
  const names = (await macDevices()).map((d) => d._name || '');
  return [
    { id: 'blackhole', name: 'BlackHole 2ch (المايك الوهمي)', ok: names.some((n) => /blackhole/i.test(n)), level: 'required',
      why: 'الصوت النضيف بيطلع عليه، وزوم وOBS بيسجلوا منه. بعد التسطيب ممكن تحتاج Restart مرة.',
      fix: { cmd: 'brew install --cask blackhole-2ch', url: 'https://existential.audio/blackhole/' } },
    { id: 'switchaudio', name: 'SwitchAudioSource', ok: await has('SwitchAudioSource'), level: 'optional',
      why: 'عشان تغيّر المايك الافتراضي من جوه الأبلكيشن.',
      fix: { cmd: 'brew install switchaudio-osx' } },
  ];
}

async function winDeps() {
  const { winDevices } = require('../windows');
  const names = (await winDevices()).map((d) => d.Name || '');
  return [
    { id: 'vbcable', name: 'VB-CABLE (المايك الوهمي)', ok: names.some((n) => /cable (output|input)|vb-audio/i.test(n)), level: 'required',
      why: 'الصوت النضيف بيطلع على CABLE Input، وزوم وOBS بيسجلوا من CABLE Output. بعد التسطيب اعمل Restart.',
      fix: { url: 'https://vb-audio.com/Cable/' } },
  ];
}

async function webDeps() {
  return [
    { id: 'pactl', name: 'pactl (PulseAudio / PipeWire)', ok: false, level: 'recommended',
      why: 'من غيره التنضيف شغال جوه الشباك، ومحتاج كابل وهمي تطلّع عليه.',
      fix: { cmd: pkgCmd({ apt: 'pulseaudio-utils pipewire-pulse', dnf: 'pulseaudio-utils pipewire-pulseaudio', pacman: 'libpulse pipewire-pulse', zypper: 'pulseaudio-utils pipewire-pulseaudio' }) } },
  ];
}

async function check() {
  const items = MODE === 'linux' ? await linuxDeps() : MODE === 'darwin' ? await macDeps() : MODE === 'win32' ? await winDeps() : await webDeps();
  return { ok: true, platform: MODE, items, ready: items.every((i) => i.ok || i.level !== 'required') };
}

module.exports = { check, routes: { 'GET /api/deps': check } };
