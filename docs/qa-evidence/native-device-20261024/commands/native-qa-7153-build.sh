#!/bin/bash
# Build PR 7153 arm64 debug from the exact head. Does not install or boot an emulator.
set -u
MAIN=/Users/rrd/workspace/rrd/paseo
WT=$MAIN/.worktrees/pr-parallel-20261024-native-qa-7153
LANE=$MAIN/.dev/pr-parallel-20261024/remote-heavy-lane/owner
LEASE=$MAIN/.dev/pr-parallel-20261024/git-hooks-lease
STATUS=/tmp/native-qa-7153-build.status
EXPECTED=deb15d5b9f9cbcb30a500981a23aa09a57a411ec
export PATH="/Users/rrd/.nvm/versions/node/v24.22.1/bin:$PATH"
export ANDROID_HOME="$HOME/Library/Android/sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export NODE_OPTIONS="--max-old-space-size=4096"
export EXPO_NO_TELEMETRY=1
export EXPO_NO_DOTENV=1
export APP_VARIANT=development
say() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" | tee -a "$STATUS"; }
: > "$STATUS"

release_lease() {
  if [ -f "$LEASE/owner" ] && [ "$(head -n 1 "$LEASE/owner" 2>/dev/null || true)" = "native-qa" ]; then
    rm -f "$LEASE/owner"
    rmdir "$LEASE" 2>/dev/null || true
    say "LEASE_RELEASED"
  fi
}
trap release_lease EXIT

say "BUILD_START"
if [ ! -f "$LANE" ] || [ "$(head -n 1 "$LANE")" != "native-qa" ]; then
  say "FAILED lane is not owned by native-qa"
  exit 1
fi
cat > "$LANE" << EOF
native-qa
pid=$$
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
task=7153-gradle-deb15d5b
emu=none
EOF

MAIN_HEAD=$(git -C "$MAIN" rev-parse HEAD)
MAIN_PORCELAIN=$(git -C "$MAIN" status --porcelain | wc -l | tr -d ' ')
say "MAIN_BEFORE $MAIN_HEAD porcelain=$MAIN_PORCELAIN"
if [ "$MAIN_HEAD" != "c1b257b8f4bb389357a5006e1f217d7e383b40ff" ] || [ "$MAIN_PORCELAIN" != "6035" ]; then
  say "FAILED main checkout changed before build"
  exit 1
fi

cd "$WT"
BEFORE=$(git rev-parse HEAD)
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
say "WORKTREE_BEFORE $BEFORE dirty=$DIRTY"
if [ "$DIRTY" != "0" ]; then
  say "FAILED 7153 worktree dirty before checkout"
  exit 1
fi
git checkout --detach "$EXPECTED"
HEAD=$(git rev-parse HEAD)
say "HEAD $HEAD"
if [ "$HEAD" != "$EXPECTED" ]; then
  say "FAILED head drift after checkout"
  exit 1
fi
DIRTY=$(git status --porcelain | wc -l | tr -d ' ')
if [ "$DIRTY" != "0" ]; then
  say "FAILED worktree dirty after checkout"
  exit 1
fi

if ! mkdir "$LEASE" 2>/dev/null; then
  say "FAILED git-hooks lease busy"
  exit 1
fi
cat > "$LEASE/owner" << EOF
native-qa
pid=$$
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
task=7153-npm-ci
emu=none
EOF
say "LEASE_ACQUIRED"

nice -n 19 npm ci
ci_exit=$?
say "NPM_CI_EXIT $ci_exit"
if [ "$ci_exit" != "0" ]; then
  say "FAILED npm ci"
  exit 1
fi

python3 - << 'PY'
from pathlib import Path
root = Path("/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7153/node_modules/react-native-unistyles")
hits = []
for path in root.rglob("*"):
    if not path.is_file():
        continue
    if path.suffix not in {".kt", ".java", ".cpp", ".h", ".m", ".mm"}:
        continue
    try:
        text = path.read_text(errors="replace")
    except OSError:
        continue
    if "startWindowLayoutListener" in text:
        hits.append(path)
out = Path("/tmp/native-qa-7153-listener-readback.txt")
lines = []
if len(hits) != 1:
    lines.append(f"HIT_COUNT {len(hits)}")
    for path in hits:
        lines.append(str(path))
    out.write_text("\n".join(lines) + "\n")
    raise SystemExit(2)
path = hits[0]
text = path.read_text()
start = text.find("private fun startWindowLayoutListener")
stop = text.find("private fun stopWindowLayoutListener")
end = text.find("override fun registerPlatformListener", stop if stop >= 0 else start)
chunk = text[start:end if end > start else start + 1200]
lines.append(f"FILE {path}")
lines.append(chunk)
required = [
    "startWindowLayoutListener",
    "stopWindowLayoutListener",
    "addOnLayoutChangeListener",
    "removeOnLayoutChangeListener",
    "onConfigChange",
    "The fold may change window metrics while the host is paused",
]
missing = [item for item in required if item not in chunk]
lines.append("MISSING " + ",".join(missing))
out.write_text("\n".join(lines) + "\n")
if missing or start < 0:
    raise SystemExit(3)
PY
read_exit=$?
say "LISTENER_READBACK_EXIT $read_exit"
if [ "$read_exit" != "0" ]; then
  say "FAILED listener readback"
  exit 1
fi
release_lease

nice -n 19 npm run build:app-deps
deps_exit=$?
say "APP_DEPS_EXIT $deps_exit"
if [ "$deps_exit" != "0" ]; then
  say "FAILED build:app-deps"
  exit 1
fi

cd "$WT/packages/app"
nice -n 19 npx expo prebuild --platform android --clean --non-interactive
pre_exit=$?
say "PREBUILD_EXIT $pre_exit"
if [ "$pre_exit" != "0" ]; then
  say "FAILED prebuild"
  exit 1
fi

cd "$WT/packages/app/android"
nice -n 19 ./gradlew :app:assembleDebug \
  -PreactNativeArchitectures=arm64-v8a \
  --max-workers=1 \
  -Dorg.gradle.parallel=false \
  -Dorg.gradle.workers.max=1 \
  --no-daemon
gradle_exit=$?
say "GRADLE_EXIT $gradle_exit"
if [ "$gradle_exit" != "0" ]; then
  say "FAILED gradle"
  exit 1
fi

APK=$WT/packages/app/android/app/build/outputs/apk/debug/app-debug.apk
if [ ! -f "$APK" ]; then
  say "FAILED apk missing"
  exit 1
fi
shasum -a 256 "$APK" | tee /tmp/native-qa-7153-apk.sha256 | tee -a "$STATUS"
python3 - << 'PY'
import hashlib, zipfile
from pathlib import Path
apk = Path("/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7153/packages/app/android/app/build/outputs/apk/debug/app-debug.apk")
digest = hashlib.sha256(apk.read_bytes()).hexdigest()
old = "cb1ad96f72502ab457bfb2a399b4c20df1a108a19f31a665f6a458ab174a78eb"
z = zipfile.ZipFile(apk)
hits = []
abis = []
for info in z.infolist():
    name = info.filename
    if name.startswith("lib/") and name.endswith(".so"):
        abi = name.split("/")[1]
        if abi not in abis:
            abis.append(abi)
    if info.file_size > 140_000_000:
        continue
    data = z.read(name)
    if b"startWindowLayoutListener" in data:
        hits.append(name)
out = Path("/tmp/native-qa-7153-apk-proof.txt")
out.write_text(
    "\n".join(
        [
            f"sha256 {digest}",
            f"bytes {apk.stat().st_size}",
            f"same_as_cb1 {digest == old}",
            f"abis {','.join(abis)}",
            f"symbol_hits {len(hits)}",
            *hits,
        ]
    )
    + "\n"
)
if digest == old or not hits or abis != ["arm64-v8a"]:
    raise SystemExit(4)
PY
proof_exit=$?
say "APK_PROOF_EXIT $proof_exit"
if [ "$proof_exit" != "0" ]; then
  say "FAILED apk proof"
  cat /tmp/native-qa-7153-apk-proof.txt >> "$STATUS"
  exit 1
fi
AAPT=$(ls -d "$ANDROID_HOME/build-tools/"*/aapt | sort | tail -n 1)
"$AAPT" dump badging "$APK" | awk '/package:|native-code|sdkVersion|targetSdkVersion/' | tee -a "$STATUS"

MAIN_HEAD2=$(git -C "$MAIN" rev-parse HEAD)
MAIN_PORCELAIN2=$(git -C "$MAIN" status --porcelain | wc -l | tr -d ' ')
say "MAIN_AFTER $MAIN_HEAD2 porcelain=$MAIN_PORCELAIN2"
HEAD2=$(git -C "$WT" rev-parse HEAD)
say "HEAD_AFTER $HEAD2"
if [ "$MAIN_HEAD2" != "c1b257b8f4bb389357a5006e1f217d7e383b40ff" ] || [ "$MAIN_PORCELAIN2" != "6035" ]; then
  say "FAILED main checkout changed during build"
  exit 1
fi
if [ "$HEAD2" != "$EXPECTED" ]; then
  say "FAILED head changed during build"
  exit 1
fi
say "BUILD_OK"
