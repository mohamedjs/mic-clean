#!/usr/bin/env bash
# =====================================================================
#  install-mac.sh — Mic (Mohamed) على الماك (Apple Silicon M1/M2/M3 أو Intel)
#   • بيسطّب Node و BlackHole (مايك وهمي) و SwitchAudioSource بـ Homebrew
#   • بيشغّل السيرفر في الخلفية (LaunchAgent) ويقوم لوحده مع الدخول
#   • بيفتح الداشبورد في Chrome → دوس «⬇ ثبّت كتطبيق»
#
#  التشغيل:     bash install-mac.sh
#  الإلغاء:     bash install-mac.sh --uninstall
# =====================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LABEL="com.mohamed.mic"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/mic-mohamed.log"
PORT="${PORT:-4747}"
say() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()  { printf '   \033[32m✓\033[0m %s\n' "$*"; }
die() { printf '   \033[31m✗ %s\033[0m\n' "$*"; exit 1; }

[ "$(uname)" = "Darwin" ] || die "السكريبت ده للماك بس. على أوبونتو استخدم install-linux.sh"

if [ "${1:-}" = "--uninstall" ]; then
  say "بشيل الخدمة"
  launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
  rm -f "$PLIST"
  ok "اتشالت. (BlackHole تشيله لو عايز: brew uninstall blackhole-2ch)"
  exit 0
fi

say "1) Homebrew و Node"
if ! command -v brew >/dev/null; then
  for p in /opt/homebrew/bin/brew /usr/local/bin/brew; do [ -x "$p" ] && eval "$("$p" shellenv)"; done
fi
command -v brew >/dev/null || die 'Homebrew مش متسطب. سطّبه الأول:  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"  وبعدين شغّل السكريبت تاني'
ok "brew: $(brew --prefix) ($(uname -m))"
command -v node >/dev/null || brew install node
NODE="$(command -v node)"
ok "Node $("$NODE" -v)"

say "2) BlackHole (المايك الوهمي اللي الصوت النضيف بيطلع عليه)"
if system_profiler SPAudioDataType 2>/dev/null | grep -qi "BlackHole"; then
  ok "BlackHole متسطب"
else
  echo "   هيطلب باسورد الماك عشان يسطّب درايفر الصوت…"
  brew install blackhole-2ch
  echo "   بعيد تشغيل نظام الصوت عشان BlackHole يظهر…"
  sudo killall coreaudiod 2>/dev/null || true
  sleep 3
  system_profiler SPAudioDataType 2>/dev/null | grep -qi "BlackHole" && ok "BlackHole ظهر" || echo "   ⚠ لو BlackHole مظهرش، اعمل Restart للماك مرة واحدة"
fi
command -v SwitchAudioSource >/dev/null || brew install switchaudio-osx || true
command -v SwitchAudioSource >/dev/null && ok "SwitchAudioSource موجود (تغيير المايك الافتراضي من الداشبورد)"

say "3) السيرفر في الخلفية (بيقوم لوحده مع الدخول)"
mkdir -p "$(dirname "$PLIST")" "$(dirname "$LOG")"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$DIR/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>PATH</key><string>$(brew --prefix)/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict></plist>
EOF
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
sleep 2
curl -fsS "http://localhost:$PORT/api/status" >/dev/null && ok "السيرفر شغال على http://localhost:$PORT" || die "السيرفر مقامش — شوف السجل: tail -50 $LOG"

say "4) افتح وثبّت الأبلكيشن"
URL="http://localhost:$PORT"
if [ -d "/Applications/Google Chrome.app" ]; then open -a "Google Chrome" "$URL"; ok "فتحت الداشبورد في Chrome"
else open "$URL"; echo "   ⚠ Chrome مش موجود — الصوت لـ BlackHole والتثبيت كتطبيق محتاجين Chrome أو Edge (Safari مش بيدعم اختيار جهاز الخرج)"; fi
cat <<'TXT'

   بعد ما يفتح:
   ١. دوس «⬇ ثبّت كتطبيق» فوق → هيبقى ليه أيقونة في Launchpad والـ Dock.
   ٢. أول مرة: اسمح لـ Chrome يستخدم المايك (System Settings ← Privacy & Security ← Microphone).
   ٣. تاب «مايك نضيف جديد» ← المايك الحقيقي = مايك الـ USB، يطلع على = BlackHole 2ch ← «▶ شغّل».
   ٤. في زوم/OBS/ميت اختار «BlackHole 2ch» كمايك (أو اعمل Aggregate اسمه «Mic (Mohamed)» — الشرح جوه الداشبورد).
   ⚠ الأبلكيشن لازم يفضل مفتوح (ممكن تصغّره) عشان التنضيف يشتغل.

   أوامر مفيدة:
     launchctl kickstart -k gui/$(id -u)/com.mohamed.mic   # إعادة تشغيل السيرفر بعد تحديث
     tail -f ~/Library/Logs/mic-mohamed.log                # السجل
     bash install-mac.sh --uninstall                       # إلغاء
TXT
