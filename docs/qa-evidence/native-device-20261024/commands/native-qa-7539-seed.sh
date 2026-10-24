#!/bin/bash
set -u
HOME_DIR=/tmp/native-qa-7539-paseo-home
FIX=/tmp/native-qa-7539-fixture
PASEO="/Users/rrd/.nvm/versions/node/v24.15.0/lib/node_modules/@getpaseo/cli/bin/paseo"
OUT=/tmp/native-qa-7539-agents.json
test -x "$PASEO" || { echo "SEED_FAIL no cli"; exit 1; }
test -f "$HOME_DIR/paseo.pid" || { echo "SEED_FAIL no pid"; exit 1; }
rm -rf "$FIX"
mkdir -p "$FIX"
git -C "$FIX" init -q
git -C "$FIX" config user.email "native-qa@example.com"
git -C "$FIX" config user.name "native-qa"
echo "fixture" > "$FIX/README.md"
git -C "$FIX" add README.md
git -C "$FIX" commit -q -m "fixture"
echo "CLI $($PASEO --version 2>/dev/null || true)"
"$PASEO" --home "$HOME_DIR" --json workspace create --isolation local --path "$FIX" --title "native-qa-7539-tabs" > /tmp/native-qa-7539-workspace.json || {
  echo "SEED_FAIL workspace"
  cat /tmp/native-qa-7539-workspace.json
  exit 1
}
python3 - << 'PY'
import json
raw=json.load(open("/tmp/native-qa-7539-workspace.json"))
print(json.dumps(raw)[:800])
PY
WS=$(python3 - << 'PY'
import json
raw=json.load(open("/tmp/native-qa-7539-workspace.json"))
data=raw.get("data", raw)
print(data.get("id") or data.get("workspaceId") or "")
PY
)
echo "WORKSPACE $WS"
if [ -z "$WS" ]; then
  echo "SEED_FAIL no workspace id"
  exit 1
fi
SID=$(tr -d '\r\n' < "$HOME_DIR/server-id")
echo "SERVER $SID"
python3 - "$WS" "$SID" << 'PY'
import json, subprocess, sys
ws, sid = sys.argv[1], sys.argv[2]
home = "/tmp/native-qa-7539-paseo-home"
paseo = "/Users/rrd/.nvm/versions/node/v24.15.0/lib/node_modules/@getpaseo/cli/bin/paseo"
fix = "/tmp/native-qa-7539-fixture"
titles = [
    "FIRST long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
    "FILLER alpha crowded tablet tab title used only to push the row past the point where unselected labels shrink",
    "MIDDLE long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
    "LAST long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
]
agents = []
for title in titles:
    proc = subprocess.run(
        [paseo, "--home", home, "--json", "run", "--background",
         "--provider", "mock", "--model", "e2e-fast-stream", "--mode", "load-test",
         "--cwd", fix, "--workspace", ws, "--title", title, "ping"],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True,
    )
    print("RUN", proc.returncode, proc.stdout[:500].replace("\n", " "))
    if proc.returncode != 0:
        raise SystemExit("SEED_FAIL run")
    raw = json.loads(proc.stdout)
    data = raw.get("data", raw)
    agent_id = data.get("agentId") or data.get("id")
    if not agent_id:
        raise SystemExit("SEED_FAIL no agent id")
    agents.append({"id": agent_id, "title": title, "role": title.split()[0]})
out = {"serverId": sid, "workspaceId": ws, "agents": agents}
json.dump(out, open("/tmp/native-qa-7539-agents.json", "w"), indent=2)
print("SEED_OK", len(agents))
PY
