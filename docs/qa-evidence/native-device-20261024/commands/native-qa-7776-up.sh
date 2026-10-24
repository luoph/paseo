#!/bin/bash
set -u
WT=/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7776
MAIN=/Users/rrd/workspace/rrd/paseo
LANE=$MAIN/.dev/pr-parallel-20261024/remote-heavy-lane
STATUS=/tmp/native-qa-7776-up.status
LOG=/tmp/native-qa-7776-up.out
export PATH="/Users/rrd/.nvm/versions/node/v24.22.1/bin:$WT/node_modules/.bin:$PATH"
export NODE_OPTIONS="--max-old-space-size=4096"
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }

say "START pid=$$"
if [ ! -d "$LANE" ]; then
  say "FAILED lane missing"
  exit 1
fi
owner=$(cat "$LANE/owner" 2>/dev/null || true)
case "$owner" in
  native-qa*) ;;
  *) say "FAILED lane owner is not native-qa"; printf '%s\n' "$owner"; exit 1 ;;
esac
cat > "$LANE/owner" << OWNER
native-qa
pid=$$
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
task=7776-325fd53
emu=10636
OWNER

HEAD=$(git -C "$WT" rev-parse HEAD)
say "HEAD $HEAD"
if [ "$HEAD" != "325fd53cdfd57aa0c255fe61d62bd7c32be803af" ]; then
  say "FAILED head drift $HEAD"
  exit 1
fi

# Remote main has staged deletions including .gitignore, so .dev is untracked.
# Do not git-add or edit tracked files. Daemon home stays in /tmp.
say "MAIN_UNTOUCHED home=/tmp/native-qa-7776-paseo-home"

cd "$WT"
say "PATCH_BEGIN"
if node scripts/postinstall-patches.mjs >> "$LOG" 2>&1; then
  say "PATCH_OK"
else
  say "FAILED patches exit $?"
  exit 1
fi
for p in packages/app/node_modules/react-native-svg packages/app/node_modules/react-native-enriched-markdown packages/server/node_modules/@opencode-ai/sdk node_modules/react-native-unistyles; do
  if [ -d "$p" ]; then say "PKG_OK $p"; else say "FAILED missing $p"; exit 1; fi
done

say "BUILD_BEGIN mem=$(memory_pressure 2>/dev/null | awk '/Pages free:/ {print $3}') load=$(sysctl -n vm.loadavg)"
cd "$WT"
if ! nice -n 19 npm run build --workspace=@getpaseo/client >> /tmp/native-qa-7776-build.log 2>&1; then
  say "FAILED client build"
  exit 1
fi
say "BUILD_CLIENT_OK"
if ! nice -n 19 npm run build --workspace=@getpaseo/highlight >> /tmp/native-qa-7776-build.log 2>&1; then
  say "FAILED highlight build"
  exit 1
fi
say "BUILD_HIGHLIGHT_OK"
if ! nice -n 19 npm run build --workspace=@getpaseo/plugin >> /tmp/native-qa-7776-build.log 2>&1; then
  say "FAILED plugin build"
  exit 1
fi
say "BUILD_PLUGIN_OK"
test -f "$WT/packages/client/dist/index.js" || { say "FAILED no client dist"; exit 1; }
test -f "$WT/packages/protocol/dist/index.js" || { say "FAILED no protocol dist"; exit 1; }
say "BUILD_OK"

HOME_DIR=/tmp/native-qa-7776-paseo-home
rm -rf "$HOME_DIR"
mkdir -p "$HOME_DIR" /tmp/native-qa-empty-models
cat > "$HOME_DIR/config.json" << 'CFG'
{
  "version": 1,
  "daemon": {
    "listen": "127.0.0.1:19082",
    "cors": { "allowedOrigins": ["*"] }
  },
  "features": {
    "dictation": { "enabled": false },
    "voiceMode": { "enabled": false }
  }
}
CFG

# Metro
if lsof -nP -iTCP:19081 -sTCP:LISTEN >/dev/null 2>&1; then
  say "FAILED 19081 busy before metro"
  exit 1
fi
cd "$WT/packages/app"
nohup env \
  APP_VARIANT=development \
  CI=1 \
  EXPO_NO_TELEMETRY=1 \
  EXPO_NO_DOTENV=1 \
  REACT_NATIVE_PACKAGER_HOSTNAME=10.0.2.2 \
  EXPO_PUBLIC_LOCAL_DAEMON=10.0.2.2:19082 \
  PATH="$PATH" \
  nice -n 19 npx expo start --dev-client --port 19081 --host localhost --clear \
  >> /tmp/native-qa-7776-metro.log 2>&1 &
echo $! > /tmp/native-qa-7776-metro.pid
say "METRO_PID $(cat /tmp/native-qa-7776-metro.pid)"

# Daemon. Never 6767.
if lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null 2>&1; then
  say "FAILED 19082 busy before daemon"
  exit 1
fi
if lsof -nP -iTCP:6767 -sTCP:LISTEN >/dev/null 2>&1; then
  say "NOTE 6767 already listening, will not touch it"
fi
cd "$WT/packages/server"
nohup env \
  PASEO_HOME="$HOME_DIR" \
  PASEO_LISTEN=127.0.0.1:19082 \
  PASEO_DICTATION_ENABLED=false \
  PASEO_VOICE_MODE_ENABLED=false \
  PASEO_NODE_ENV=development \
  PASEO_CORS_ORIGINS='*' \
  PASEO_LOCAL_MODELS_DIR=/tmp/native-qa-empty-models \
  PASEO_LOG_FORMAT=json \
  PATH="$PATH" \
  NODE_OPTIONS="$NODE_OPTIONS" \
  nice -n 19 node --import tsx scripts/dev-runner.ts \
  >> /tmp/native-qa-7776-daemon.log 2>&1 &
echo $! > /tmp/native-qa-7776-daemon.pid
say "DAEMON_PID $(cat /tmp/native-qa-7776-daemon.pid)"

# Wait until both listen, or a process dies.
for i in $(seq 1 60); do
  metro_up=0
  daemon_up=0
  lsof -nP -iTCP:19081 -sTCP:LISTEN >/dev/null 2>&1 && metro_up=1
  lsof -nP -iTCP:19082 -sTCP:LISTEN >/dev/null 2>&1 && daemon_up=1
  if [ "$metro_up" = 1 ] && [ "$daemon_up" = 1 ]; then
    say "BOTH_UP"
    exit 0
  fi
  if ! kill -0 "$(cat /tmp/native-qa-7776-metro.pid)" 2>/dev/null; then
    say "FAILED metro process exited"
    exit 1
  fi
  if ! kill -0 "$(cat /tmp/native-qa-7776-daemon.pid)" 2>/dev/null; then
    say "FAILED daemon process exited"
    exit 1
  fi
  sleep 5
done
say "FAILED timeout waiting for ports metro=$metro_up daemon=$daemon_up"
exit 1
