#!/bin/bash
set -u
ADB=/Users/rrd/Library/Android/sdk/platform-tools/adb
S=emulator-5572
EVID=/tmp/native-qa-7776-evidence
STATUS=/tmp/native-qa-7776-up.status
mkdir -p "$EVID"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }

# Only touch our serial.
if ! "$ADB" devices </dev/null | awk '$1=="emulator-5572" && $2=="device" {found=1} END{exit !found}'; then
  say "FAILED emulator-5572 not online"
  exit 1
fi

if ! curl -fsS -m 3 http://127.0.0.1:19081/status >/dev/null 2>&1; then
  if ! curl -fsS -m 3 -g http://[::1]:19081/status >/dev/null 2>&1; then
    say "FAILED metro down"
    exit 1
  fi
  nohup node /tmp/native-qa-7776-proxy.js >> /tmp/native-qa-7776-proxy.log 2>&1 &
  echo $! > /tmp/native-qa-7776-proxy.pid
  sleep 0.4
fi
V4=$(curl -fsS -m 5 http://127.0.0.1:19081/status || echo FAIL)
say "METRO_V4 $V4"

# Connectivity from the emulator to the host alias. Do not use other serials.
EMU_STATUS=$("$ADB" -s "$S" shell 'toybox nc -w 3 10.0.2.2 19081 </dev/null; echo NC:$?' </dev/null | tr -d '\r' | tail -1)
say "EMU_NC $EMU_STATUS"
printf 'GET /status HTTP/1.1\r\nHost: 10.0.2.2:19081\r\nConnection: close\r\n\r\n' | "$ADB" -s "$S" shell 'toybox nc -w 4 10.0.2.2 19081' </dev/null > "$EVID/emu-metro-status.txt" 2>&1 || true
head -5 "$EVID/emu-metro-status.txt" | tee -a "$STATUS"

DAEMON_FROM_EMU=$(printf 'GET / HTTP/1.1\r\nHost: 10.0.2.2:19082\r\nConnection: close\r\n\r\n' | "$ADB" -s "$S" shell 'toybox nc -w 4 10.0.2.2 19082' </dev/null | tr -d '\r' | head -1)
say "EMU_DAEMON $DAEMON_FROM_EMU"

curl -fsS -m 10 http://127.0.0.1:19081/ > "$EVID/metro-root.txt" 2>"$EVID/metro-root.err" || true
say "METRO_ROOT_BYTES $(wc -c < "$EVID/metro-root.txt" | tr -d ' ')"

"$ADB" -s "$S" shell am force-stop sh.paseo.debug </dev/null
"$ADB" -s "$S" logcat -c </dev/null || true
"$ADB" -s "$S" shell am start -a android.intent.action.VIEW -d 'exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081' sh.paseo.debug </dev/null
say "APP_STARTED"

for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18; do
  sleep 10
  "$ADB" -s "$S" exec-out screencap -p </dev/null > "$EVID/screen-$i.png" || true
  "$ADB" -s "$S" shell uiautomator dump /sdcard/native-qa-ui.xml </dev/null >/dev/null 2>&1 || true
  "$ADB" -s "$S" shell cat /sdcard/native-qa-ui.xml </dev/null > "$EVID/ui-$i.xml" 2>/dev/null || true
  if grep -q "left-sidebar-resize-handle" "$EVID/ui-$i.xml" 2>/dev/null; then
    say "HANDLE_VISIBLE shot=$i"
    cp "$EVID/screen-$i.png" "$EVID/handle-visible.png"
    cp "$EVID/ui-$i.xml" "$EVID/handle-visible.xml"
    exit 0
  fi
  # Surface obvious failures without claiming a pass.
  if grep -E -q "Unable to load script|Could not connect|Failed to connect|Something went wrong|Bundling failed" "$EVID/ui-$i.xml" 2>/dev/null; then
    say "UI_ERROR shot=$i"
    cp "$EVID/screen-$i.png" "$EVID/ui-error.png"
    exit 2
  fi
  say "WAIT shot=$i bytes=$(wc -c < "$EVID/screen-$i.png" | tr -d ' ') ui=$(wc -c < "$EVID/ui-$i.xml" | tr -d ' ')"
done
say "FAILED handle not visible after wait"
"$ADB" -s "$S" logcat -d -t 200 </dev/null > "$EVID/logcat-tail.txt" || true
exit 3
