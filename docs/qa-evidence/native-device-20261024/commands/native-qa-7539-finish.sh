#!/bin/bash
set -u
python3 - << 'PY'
import json
from pathlib import Path
path = Path("/tmp/native-qa-7539-evidence/results.json")
data = json.loads(path.read_text())
data["FILLER"] = {
    "selectedCount": 1,
    "note": "leftmost tab after the other three selections",
    "tabs": [
        {"role": "FILLER", "selected": "true", "widthDp": 240.0, "bounds": "[893,127][1373,183]"},
        {"role": "MIDDLE", "selected": "false", "widthDp": 160.0, "bounds": "[1381,127][1701,183]"},
        {"role": "FIRST", "selected": "false", "widthDp": 160.0, "bounds": "[1709,127][2029,183]"},
        {"role": "LAST", "selected": "false", "widthDp": 160.0, "bounds": "[2037,127][2357,183]"},
    ],
}
data["portraitRoot"] = "[0,0][1600,2560]"
data["landscapeRootEnd"] = "[0,0][2560,1600]"
path.write_text(json.dumps(data, indent=2))
print("RESULTS_UPDATED")
PY
APK="/Users/rrd/workspace/rrd/paseo/.worktrees/pr-7776-android-pad/packages/app/android/app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then shasum -a 256 "$APK"; fi
echo "VIRT $(shasum -a 256 /tmp/native-qa-7539-virt.txt)"
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
# Stop only the 7539 metro and daemon pid files if they still listen on 19081/19082.
stop_pid() {
  port="$1"
  pidfile="$2"
  listen=$(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN || true)
  if [ -z "$listen" ]; then
    echo "FREE $port"
    return
  fi
  for pid in $listen; do
    cmd=$(ps -p "$pid" -o command=)
    cwd=$(lsof -a -p "$pid" -d cwd -Fn | awk '/^n/ {print substr($0,2); exit}')
    echo "PORT $port pid=$pid cwd=$cwd cmd=$cmd"
    case "$cwd $cmd" in
      *pr-parallel-20261024-native-qa-7539*)
        kill "$pid" 2>/dev/null || true
        echo "STOP $port $pid"
        ;;
      *)
        echo "SKIP $port $pid"
        ;;
    esac
  done
}
stop_pid 19081 /tmp/native-qa-7539-metro.pid
stop_pid 19082 /tmp/native-qa-7539-daemon.pid
sleep 1
for p in 19081 19082 6767; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then echo "LISTEN $p"; else echo "FREE $p"; fi
done
"$ADB" -s emulator-5572 shell getprop sys.boot_completed </dev/null
echo "EMU $(ps -p 10636 -o pid= 2>/dev/null || echo gone)"
echo "OTHER $(ps -p 9663 -o pid= 2>/dev/null || echo gone)"
LANE="/Users/rrd/workspace/rrd/paseo/.dev/pr-parallel-20261024/remote-heavy-lane/owner"
cat > "$LANE" << 'OWNER'
native-qa
pid=10636
started=2026-10-24T13:45:00Z
task=7539-done-hold-5572
emu=10636
OWNER
echo "LOAD $(sysctl -n vm.loadavg)"
echo FINISH_OK
