#!/bin/bash
set -u
ADB=/Users/rrd/Library/Android/sdk/platform-tools/adb
S=emulator-5572
EVID=/tmp/native-qa-7776-evidence
mkdir -p "$EVID"
STATUS=/tmp/native-qa-7776-up.status
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }
"$ADB" devices </dev/null | awk '$1=="emulator-5572" && $2=="device"{ok=1} END{exit !ok}' || { say "FAILED no 5572"; exit 1; }
lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null || { say "FAILED daemon down"; exit 1; }
lsof -nP -iTCP:19081 -sTCP:LISTEN >/dev/null || { say "FAILED metro down"; exit 1; }
if grep -q "left-sidebar-resize-handle" /tmp/native-qa-virt.txt; then say "BUNDLE_HAS_HANDLE"; else say "FAILED bundle missing handle id"; exit 1; fi
# Source path in the dev bundle proves which tree Metro compiled.
grep -o "sidebar-resize-handle[^\"]*" /tmp/native-qa-virt.txt | head -3 | tee -a "$STATUS" || true
"$ADB" -s "$S" shell am force-stop sh.paseo.debug </dev/null
"$ADB" -s "$S" logcat -c </dev/null || true
"$ADB" -s "$S" shell am start -a android.intent.action.VIEW -d 'exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081' sh.paseo.debug </dev/null
say "APP_RESTART"
for i in $(seq 1 24); do
  sleep 8
  "$ADB" -s "$S" exec-out screencap -p </dev/null > "$EVID/open-$i.png" || true
  "$ADB" -s "$S" shell uiautomator dump /sdcard/native-qa-ui.xml </dev/null >/dev/null 2>&1 || true
  "$ADB" -s "$S" shell cat /sdcard/native-qa-ui.xml </dev/null > "$EVID/open-$i.xml" 2>/dev/null || true
  python3 - "$EVID/open-$i.xml" << 'PY'
import re,sys
t=open(sys.argv[1],errors="replace").read()
texts=[x for x in re.findall(r'text="([^"]+)"', t) if x.strip()]
ids=[x for x in re.findall(r'resource-id="([^"]+)"', t) if x and not x.endswith("action_bar_root") and "android:id" not in x]
print("TEXTS", " | ".join(texts[:12]))
print("IDS", " | ".join(ids[:12]))
open("/tmp/native-qa-7776-evidence/last-ui.txt","w").write("\n".join(texts[:40]))
PY
  if grep -q "left-sidebar-resize-handle" "$EVID/open-$i.xml"; then
    cp "$EVID/open-$i.png" "$EVID/handle.png"
    cp "$EVID/open-$i.xml" "$EVID/handle.xml"
    say "HANDLE_VISIBLE open=$i"
    exit 0
  fi
  if grep -E -q "Unable to load script|Bundling failed|Unable to resolve|Something went wrong" "$EVID/open-$i.xml"; then
    cp "$EVID/open-$i.png" "$EVID/bundle-error.png"
    say "UI_BUNDLE_ERROR open=$i"
    exit 2
  fi
  say "OPEN_WAIT $i"
done
"$ADB" -s "$S" logcat -d -t 250 </dev/null > "$EVID/logcat-open.txt" || true
say "FAILED no handle"
exit 3
