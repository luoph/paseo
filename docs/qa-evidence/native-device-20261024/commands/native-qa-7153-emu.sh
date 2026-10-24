#!/bin/bash
# Boot only the owned pad AVD on port 5572. Refuse if that port is already taken.
set -u
STATUS=/tmp/native-qa-7153-emu.status
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
EMU="$HOME/Library/Android/sdk/emulator/emulator"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }
: > "$STATUS"
say "EMU_START"
say "MEM $(memory_pressure 2>/dev/null | awk '/free percentage/ {print; exit}')"
if "$ADB" devices | awk 'NR>1 && $1=="emulator-5572" {found=1} END{exit !found}'; then
  say "FAILED emulator-5572 already attached"
  exit 1
fi
if ps -ax -o command | awk '/qemu-system/ && /5572|paseo-pr7776-pad/ && !/awk/ {found=1} END{exit !found}'; then
  say "FAILED qemu already using 5572 or paseo-pr7776-pad"
  exit 1
fi
nohup nice -n 19 "$EMU" \
  -avd paseo-pr7776-pad \
  -port 5572 \
  -no-window -no-audio -no-boot-anim \
  -no-snapshot-load -no-snapshot-save \
  -gpu swiftshader_indirect \
  -cores 2 \
  -memory 3072 \
  >> /tmp/native-qa-7153-emu-console.log 2>&1 < /dev/null &
echo $! > /tmp/native-qa-7153-emu.pid
say "EMU_PID $(cat /tmp/native-qa-7153-emu.pid)"
for i in $(seq 1 90); do
  boot=$("$ADB" -s emulator-5572 shell getprop sys.boot_completed </dev/null 2>/dev/null | tr -d '\r')
  if [ "$boot" = "1" ]; then
    say "BOOT 1"
    break
  fi
  if ! kill -0 "$(cat /tmp/native-qa-7153-emu.pid)" 2>/dev/null; then
    say "FAILED emulator process exited"
    exit 1
  fi
  sleep 2
done
boot=$("$ADB" -s emulator-5572 shell getprop sys.boot_completed </dev/null 2>/dev/null | tr -d '\r')
if [ "$boot" != "1" ]; then
  say "FAILED boot timeout"
  exit 1
fi
"$ADB" -s emulator-5572 shell wm size 2560x1600 </dev/null
"$ADB" -s emulator-5572 shell wm density 320 </dev/null
"$ADB" -s emulator-5572 shell cmd uimode night no </dev/null
"$ADB" -s emulator-5572 shell settings put system accelerometer_rotation 0 </dev/null
"$ADB" -s emulator-5572 shell settings put system user_rotation 0 </dev/null
QEMU=$(ps -ax -o pid=,command= | awk '/qemu-system/ && /paseo-pr7776-pad/ && /-port 5572/ {print $1; exit}')
LANE=/Users/rrd/workspace/rrd/paseo/.dev/pr-parallel-20261024/remote-heavy-lane/owner
if [ -z "$QEMU" ]; then
  say "FAILED owned qemu missing after boot"
  exit 1
fi
cat > "$LANE" << EOF
native-qa
pid=$QEMU
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
task=7153-emu-deb15d5b
emu=$QEMU
EOF
say "LANE_QEMU $QEMU"
say "EMU_READY"
ps -ax -o pid,command | awk '/qemu-system/ && /5572|paseo-pr7776-pad/ && !/awk/ {print}'
