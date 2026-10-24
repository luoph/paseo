#!/bin/bash
set -u
WT=/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7539
MAIN=/Users/rrd/workspace/rrd/paseo
LANE=$MAIN/.dev/pr-parallel-20261024/remote-heavy-lane/owner
STATUS=/tmp/native-qa-7539-up.status
export PATH="/Users/rrd/.nvm/versions/node/v24.22.1/bin:$WT/node_modules/.bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }
: > "$STATUS"
HEAD=$(git -C "$WT" rev-parse HEAD)
say "SERVE_START head=$HEAD"
if [ "$HEAD" != "9cb99aca728a8192938fb17b70a510dc9644a182" ]; then
  say "FAILED head drift"
  exit 1
fi
test -f "$WT/packages/client/dist/index.js" || { say "FAILED no client dist"; exit 1; }
test -d "$WT/packages/protocol/dist" || { say "FAILED no protocol dist"; exit 1; }
test -f "$WT/packages/expo-two-way-audio/build/index.js" || { say "FAILED no audio build"; exit 1; }
ADB="$HOME/Library/Android/sdk/platform-tools/adb"
if ! kill -0 10636 2>/dev/null; then
  say "FAILED emulator pid 10636 gone"
  exit 1
fi
boot=$("$ADB" -s emulator-5572 shell getprop sys.boot_completed </dev/null 2>/dev/null | tr -d '\r')
say "BOOT $boot"
if [ "$boot" != "1" ]; then
  say "FAILED emulator not booted"
  exit 1
fi
if lsof -nP -iTCP:6767 -sTCP:LISTEN >/dev/null 2>&1; then
  say "FAILED 6767 is listening; refusing to continue"
  exit 1
fi
if lsof -nP -iTCP:19081 -sTCP:LISTEN >/dev/null 2>&1; then
  say "FAILED 19081 busy"
  exit 1
fi
if lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null 2>&1; then
  say "FAILED 19082 busy"
  exit 1
fi
cat > "$LANE" << OWNER
native-qa
pid=10636
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
task=7539-serve-9cb99aca
emu=10636
OWNER
HOME_DIR=/tmp/native-qa-7539-paseo-home
rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" /tmp/native-qa-empty-models
cat > "$HOME_DIR/config.json" << 'CFG'
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:19082",
    "relay": { "enabled": false },
    "cors": { "allowedOrigins": ["*"] }
  },
  "features": {
    "dictation": { "enabled": false },
    "voiceMode": { "enabled": false }
  }
}
CFG
cd "$WT/packages/app"
nohup env \
  APP_VARIANT=development \
  EXPO_NO_TELEMETRY=1 \
  EXPO_NO_DOTENV=1 \
  REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:19082 \
  PATH="$PATH" \
  nice -n 19 npx expo start --dev-client --port 19081 --host lan --clear \
  >> /tmp/native-qa-7539-metro.log 2>&1 < /dev/null &
echo $! > /tmp/native-qa-7539-metro.pid
say "METRO_PID $(cat /tmp/native-qa-7539-metro.pid)"
cd "$WT/packages/server"
nohup env \
  PASEO_HOME="$HOME_DIR" \
  PASEO_LISTEN=127.0.0.1:19082 \
  PASEO_RELAY_ENABLED=false \
  PASEO_DICTATION_ENABLED=false \
  PASEO_VOICE_MODE_ENABLED=false \
  PASEO_NODE_ENV=development \
  PASEO_CORS_ORIGINS='*' \
  PASEO_LOCAL_MODELS_DIR=/tmp/native-qa-empty-models \
  PASEO_LOG_FORMAT=json \
  PATH="$PATH" \
  NODE_OPTIONS="$NODE_OPTIONS" \
  nice -n 19 node --import tsx scripts/dev-runner.ts \
  >> /tmp/native-qa-7539-daemon.log 2>&1 < /dev/null &
echo $! > /tmp/native-qa-7539-daemon.pid
say "DAEMON_PID $(cat /tmp/native-qa-7539-daemon.pid)"
for i in $(seq 1 60); do
  metro_up=0
  daemon_up=0
  curl -fsS -m 2 http://127.0.0.1:19081/status >/dev/null 2>&1 && metro_up=1
  lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null 2>&1 && daemon_up=1
  if [ "$metro_up" = 1 ] && [ "$daemon_up" = 1 ]; then
    say "BOTH_UP"
    break
  fi
  if ! kill -0 "$(cat /tmp/native-qa-7539-metro.pid)" 2>/dev/null; then
    say "FAILED metro exited"
    tail -n 40 /tmp/native-qa-7539-metro.log
    exit 1
  fi
  if ! kill -0 "$(cat /tmp/native-qa-7539-daemon.pid)" 2>/dev/null; then
    say "FAILED daemon exited"
    tail -n 40 /tmp/native-qa-7539-daemon.log
    exit 1
  fi
  sleep 2
done
curl -fsS -m 2 http://127.0.0.1:19081/status >/dev/null 2>&1 || { say "FAILED metro v4"; tail -n 30 /tmp/native-qa-7539-metro.log; exit 1; }
lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null 2>&1 || { say "FAILED daemon port"; tail -n 30 /tmp/native-qa-7539-daemon.log; exit 1; }
code=$(curl -sS -m 240 -o /tmp/native-qa-7539-virt.txt -w "%{http_code}" "http://127.0.0.1:19081/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false" || echo ERR)
say "VIRTUAL $code bytes=$(wc -c < /tmp/native-qa-7539-virt.txt | tr -d ' ')"
if [ "$code" != "200" ]; then
  say "FAILED virtual bundle"
  exit 1
fi
shasum -a 256 /tmp/native-qa-7539-virt.txt | tee -a "$STATUS"
hits=$(grep -c "pr-parallel-20261024-native-qa-7539" /tmp/native-qa-7539-virt.txt || true)
title_hits=$(grep -c "workspace-tab-title-" /tmp/native-qa-7539-virt.txt || true)
width_hits=$(grep -c "TOUCH_ACTIVE_TAB_MAX_WIDTH" /tmp/native-qa-7539-virt.txt || true)
say "BUNDLE_HITS worktree=$hits title=$title_hits width=$width_hits"
if [ "$hits" -lt 1 ]; then
  say "FAILED bundle is not the 7539 worktree"
  exit 1
fi
say "SERVE_OK"
