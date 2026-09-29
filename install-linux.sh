#!/usr/bin/env bash
# =====================================================================
#  install-linux.sh — يخلي Mic (Mohamed) شغال على أوبونتو كأبلكيشن
#   • السيرفر بيشتغل في الخلفية كخدمة (systemd --user) ويقوم لوحده مع الجهاز
#   • بتفتح الداشبورد في Chrome وتدوس «⬇ ثبّت كتطبيق» → أيقونة في القائمة
#
#  التشغيل:           bash install-linux.sh
#  الإلغاء:           bash install-linux.sh --uninstall
# =====================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
UNIT="mic-mohamed.service"
UNIT_FILE="$HOME/.config/systemd/user/$UNIT"
PORT="${PORT:-4747}"
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '   \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

if [ "${1:-}" = "--uninstall" ]; then
  say "بشيل الخدمة"
  systemctl --user disable --now "$UNIT" 2>/dev/null || true
  rm -f "$UNIT_FILE"; systemctl --user daemon-reload
  ok "اتشالت. (الأبلكيشن نفسه تشيله من Chrome: chrome://apps ← كليك يمين ← Remove)"
  exit 0
fi

say "1) بتأكد من المتطلبات"
NODE="$(command -v node || true)"
[ -z "$NODE" ] && die "Node مش متسطب:  sudo apt install nodejs   (نسخة 18 أو أحدث)"
MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$MAJOR" -lt 18 ] && die "Node نسخته قديمة ($("$NODE" -v)). محتاج 18 أو أحدث."
ok "Node $("$NODE" -v)"
command -v pactl >/dev/null || die "pactl مش موجود:  sudo apt install pulseaudio-utils"
ok "pactl موجود"
command -v pw-cli >/dev/null && ok "PipeWire tools موجودة" || echo "   ⚠ pw-cli مش موجود (sudo apt install pipewire-bin) — التحكم اللحظي هيبقى أبطأ"
ls /usr/lib/ladspa/sc4m_1916.so >/dev/null 2>&1 && ok "الضاغط والليميتر (swh-plugins) موجودين" || echo "   ⚠ الضاغط مش متسطب:  sudo apt install swh-plugins"

say "2) بعمل خدمة تشغّل السيرفر في الخلفية"
mkdir -p "$(dirname "$UNIT_FILE")"
cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Mic (Mohamed) — mic dashboard & noise cancellation
After=pipewire.service pipewire-pulse.service wireplumber.service
Wants=pipewire-pulse.service

[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $DIR/server.js
Environment=PORT=$PORT
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now "$UNIT"
sleep 2
systemctl --user is-active --quiet "$UNIT" && ok "الخدمة شغالة، وهتقوم لوحدها كل ما تفتح الجهاز" || die "الخدمة مقامتش: journalctl --user -u $UNIT -n 50"

say "3) افتح وثبّت الأبلكيشن"
URL="http://localhost:$PORT"
for b in google-chrome google-chrome-stable chromium chromium-browser microsoft-edge; do
  if command -v "$b" >/dev/null; then (nohup "$b" "$URL" >/dev/null 2>&1 &); ok "فتحت $URL في $b"; OPENED=1; break; fi
done
[ -z "${OPENED:-}" ] && { xdg-open "$URL" >/dev/null 2>&1 || true; echo "   ⚠ Chrome مش موجود — التثبيت كتطبيق محتاج Chrome أو Edge أو Chromium (فايرفوكس مش بيدعمه)"; }
echo "   دوس زرار «⬇ ثبّت كتطبيق» فوق في الداشبورد، أو من Chrome: ⋮ ← Cast, save and share ← Install page as app"
echo
echo "   أوامر مفيدة:"
echo "     systemctl --user restart mic-mohamed    # بعد أي تحديث للكود"
echo "     journalctl --user -u mic-mohamed -f     # السجل"
echo "     bash install-linux.sh --uninstall       # إلغاء"
