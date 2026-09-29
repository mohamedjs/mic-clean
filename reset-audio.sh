#!/usr/bin/env bash
# =====================================================================
#  reset-audio.sh — يرجّع الصوت في أوبونتو زي ما كان (من غير أي فلاتر)
#
#  بيعمل إيه:
#   1) يقفل الداشبورد وأي فلتر شغال (pipewire -c …, EasyEffects, NoiseTorch)
#   2) يشيل كل إعدادات الصوت الخاصة بيك (~/.config/pipewire, wireplumber, pulse)
#      وخدمات/برامج الـ autostart اللي بتعمل فلاتر
#   3) يمسح "ذاكرة" WirePlumber (الافتراضي القديم، الكتم، مستوى الصوت)
#   4) يعيد تشغيل PipeWire ويخلي مايك الـ USB هو الافتراضي على 100%
#   5) يختبر المايك 3 ثواني ويقولك الصوت واصل ولا لأ
#
#  مفيش حاجة بتتمسح نهائي: كله بيتنقل لـ ~/audio-backup-<التاريخ>
#  لو كله تمام امسح الفولدر ده بإيدك:  rm -rf ~/audio-backup-*
#
#  التشغيل:   bash reset-audio.sh
# =====================================================================
set -u
TS="$(date +%Y%m%d-%H%M%S)"
BK="$HOME/audio-backup-$TS"
mkdir -p "$BK"
say()  { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
ok()   { printf '   \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '   \033[33m⚠\033[0m %s\n' "$*"; }
KEYS='filter-chain|rnnoise|noise[_-]?suppress|echo-cancel|ladspa|deepfilter|noisetorch|easyeffects|mic-clean|mic_clean|mic_mohamed'

# ---------------------------------------------------------------- 1
say "1) بقفل الداشبورد وأي فلتر شغال"
HAS_SVC=0
if systemctl --user cat mic-mohamed.service >/dev/null 2>&1; then HAS_SVC=1; systemctl --user stop mic-mohamed.service && ok "وقفت خدمة الداشبورد مؤقتًا"; fi
DPID="$(ss -ltnp 2>/dev/null | grep ':4747 ' | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)"
if [ -n "${DPID:-}" ]; then kill "$DPID" 2>/dev/null && ok "قفلت الداشبورد (pid $DPID)"; sleep 1; else ok "الداشبورد مش شغالة"; fi
while read -r pid args; do
  [ -z "${pid:-}" ] && continue
  kill "$pid" 2>/dev/null && ok "قفلت فلتر: $args"
done < <(pgrep -u "$USER" -af 'pipewire -c ' | grep -vE 'pipewire-pulse\.conf|-c +pipewire\.conf|jack')
for app in easyeffects noisetorch; do
  if pgrep -u "$USER" -x "$app" >/dev/null; then pkill -u "$USER" -x "$app" && ok "قفلت $app"; fi
done

# ---------------------------------------------------------------- 2
say "2) بشيل إعدادات الصوت الخاصة (بتتنقل لـ $BK)"
for d in "$HOME/.config/pipewire" "$HOME/.config/wireplumber" "$HOME/.config/pulse"; do
  if [ -e "$d" ]; then mv "$d" "$BK/" && ok "اتنقل: $d"; fi
done
# the dashboard's own generated chain (settings.json stays — your saved sliders)
if [ -f "$HOME/.config/mic-clean-dashboard/mic-clean-chain.conf" ]; then
  mv "$HOME/.config/mic-clean-dashboard/mic-clean-chain.conf" "$BK/" && ok "اتنقل ملف فلتر الداشبورد القديم"
fi
# user services that start filters
if [ -d "$HOME/.config/systemd/user" ]; then
  mkdir -p "$BK/systemd-user"
  for f in "$HOME"/.config/systemd/user/*.service; do
    [ -f "$f" ] || continue
    [ "$(basename "$f")" = "mic-mohamed.service" ] && continue   # the dashboard itself — keep it
    if grep -Eqi "$KEYS|pipewire +-c|pactl +load-module" "$f"; then
      u="$(basename "$f")"
      systemctl --user disable --now "$u" >/dev/null 2>&1
      mv "$f" "$BK/systemd-user/" && ok "اتقفلت واتنقلت الخدمة: $u"
    fi
  done
  systemctl --user daemon-reload
fi
# autostart entries
if [ -d "$HOME/.config/autostart" ]; then
  mkdir -p "$BK/autostart"
  for f in "$HOME"/.config/autostart/*; do
    [ -f "$f" ] || continue
    if grep -Eqi "$KEYS|pipewire +-c|pactl +load-module" "$f"; then mv "$f" "$BK/autostart/" && ok "اتنقل من الـ autostart: $(basename "$f")"; fi
  done
fi
# system-wide files (need sudo) — only report + ask
SYS="$(grep -rlEi "$KEYS" /etc/pipewire /etc/wireplumber 2>/dev/null)"
if [ -n "$SYS" ]; then
  warn "فيه ملفات فلاتر في /etc (للجهاز كله):"
  echo "$SYS" | sed 's/^/      /'
  read -r -p "   أنقلهم للباك أب؟ (محتاج sudo) [y/N] " ans
  if [[ "${ans:-}" =~ ^[Yy]$ ]]; then
    mkdir -p "$BK/etc"
    while read -r f; do sudo mv "$f" "$BK/etc/" && ok "اتنقل: $f"; done <<< "$SYS"
  fi
fi

# ---------------------------------------------------------------- 3
say "3) بمسح ذاكرة WirePlumber (الافتراضي القديم والكتم ومستوى الصوت)"
if [ -d "$HOME/.local/state/wireplumber" ]; then mv "$HOME/.local/state/wireplumber" "$BK/wireplumber-state" && ok "اتمسحت"; else ok "مفيش ذاكرة قديمة"; fi

# ---------------------------------------------------------------- 4
say "4) بعيد تشغيل الصوت"
systemctl --user restart wireplumber pipewire pipewire-pulse 2>/dev/null \
  || systemctl --user restart pipewire pipewire-pulse 2>/dev/null
sleep 3
if ! pactl info >/dev/null 2>&1; then
  warn "الصوت لسه مقامش. استنى 5 ثواني وجرب تاني، أو اعمل logout/login."
  exit 1
fi
ok "$(pactl info | grep 'Server Name')"
SRC="$(pactl list sources short | awk '{print $2}' | grep '^alsa_input' | grep -i usb | head -1)"
[ -z "$SRC" ] && SRC="$(pactl list sources short | awk '{print $2}' | grep '^alsa_input' | head -1)"
if [ -z "$SRC" ]; then
  warn "مش لاقي أي مايك حقيقي! اتأكد إن مايك الـ USB متوصل، وشغّل: arecord -l"
  exit 1
fi
pactl set-default-source "$SRC"
pactl set-source-mute "$SRC" 0
pactl set-source-volume "$SRC" 100%
ok "المايك الافتراضي: $SRC  (مش مكتوم · 100%)"

# ---------------------------------------------------------------- 5
say "5) بختبر المايك — اتكلم دلوقتي 3 ثواني…"
if command -v parecord >/dev/null && command -v python3 >/dev/null; then
  RES="$(timeout 4 parecord -d "$SRC" --raw --format=s16le --rate=48000 --channels=1 2>/dev/null | head -c 288000 | python3 -c '
import sys, array, math
a = array.array("h"); a.frombytes(sys.stdin.buffer.read())
if not a: print("NODATA"); sys.exit()
pk = max(abs(x) for x in a) / 32768
rms = math.sqrt(sum(x * x for x in a) / len(a)) / 32768
db = lambda v: 20 * math.log10(v) if v > 0 else -120
print("%.1f %.1f" % (db(pk), db(rms)))')"
  if [ "$RES" = "NODATA" ] || [ -z "$RES" ]; then
    warn "مفيش صوت خالص جاي من المايك. جرّب تشيله وتوصله تاني، وبعدين شغّل السكريبت تاني."
  else
    read -r PK RMS <<< "$RES"
    ok "أعلى قمة: ${PK} dB · متوسط: ${RMS} dB"
    python3 - "$PK" <<'PY'
import sys
pk = float(sys.argv[1])
if pk < -40:  print("   ⚠ واطي جدًا — قرّب من المايك، أو اتأكد إنك اتكلمت وقت الاختبار")
elif pk > -1: print("   ⚠ عالي أوي (بيتكسر) — وطّي الجين من الداشبورد")
else:         print("   ✓ المايك شغال تمام")
PY
  fi
else
  warn "مقدرتش أختبر (parecord أو python3 مش موجود). جرّب من الإعدادات → الصوت."
fi

if [ "$HAS_SVC" = 1 ]; then systemctl --user start mic-mohamed.service && ok "رجّعت خدمة الداشبورد تشتغل"; fi

say "خلصنا ✓"
echo "   الباك أب في: $BK"
echo "   لو كله تمام وعايز تمسحه:  rm -rf ~/audio-backup-*"
echo "   دلوقتي شغّل الداشبورد:     node server.js   →  http://localhost:4747"
echo "   ومن التاب بتاع المايك النضيف اختار مايك الـ USB ودوس «شغّل» → هيظهر مايك اسمه «Mic (Mohamed)»"
