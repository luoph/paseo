#!/usr/bin/env python3
import json
import subprocess

home = "/tmp/native-qa-7539-paseo-home"
paseo = "/Users/rrd/.nvm/versions/node/v24.15.0/lib/node_modules/@getpaseo/cli/bin/paseo"
fix = "/tmp/native-qa-7539-fixture"
raw = json.load(open("/tmp/native-qa-7539-workspace.json"))
data = raw.get("data", raw)
ws = data.get("workspaceId") or data.get("id")
sid = open(f"{home}/server-id").read().strip()
titles = [
    "FIRST long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
    "FILLER alpha crowded tablet tab title used only to push the row past the point where unselected labels shrink",
    "MIDDLE long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
    "LAST long selected tablet tab title that must stay wider than its neighbors and reveal every word after a long press on the pad",
]
def parse_json(text: str):
    start = min((index for index, char in enumerate(text) if char in "{["), default=-1)
    if start < 0:
        raise SystemExit(f"SEED_FAIL no json {text[:300]}")
    return json.loads(text[start:])

existing = subprocess.run(
    [paseo, "--home", home, "--json", "ls"],
    stdin=subprocess.DEVNULL,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True,
)
print("LS", existing.returncode, existing.stdout[:400].replace("\n", " "))
have = {}
if existing.returncode == 0 and ("{" in existing.stdout or "[" in existing.stdout):
    listed = parse_json(existing.stdout)
    rows = listed
    if isinstance(listed, dict):
        rows = listed.get("data", listed)
        if isinstance(rows, dict):
            rows = rows.get("agents") or rows.get("items") or []
    if isinstance(rows, list):
        for row in rows:
            if not isinstance(row, dict):
                continue
            title_value = row.get("title") or row.get("name")
            agent_value = row.get("agentId") or row.get("id")
            if title_value and agent_value:
                have[title_value] = agent_value

agents = []
for title in titles:
    if title in have:
        print("SKIP", have[title])
        agents.append({"id": have[title], "title": title, "role": title.split()[0]})
        continue
    proc = subprocess.run(
        [
            paseo, "--home", home, "--json", "run", "--background",
            "--provider", "mock", "--model", "e2e-fast-stream", "--mode", "load-test",
            "--cwd", fix, "--workspace", ws, "--title", title, "ping",
        ],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
    )
    print("RUN", proc.returncode, proc.stdout[:600].replace("\n", " "))
    if proc.returncode != 0:
        raise SystemExit("SEED_FAIL run")
    payload = parse_json(proc.stdout)
    row = payload.get("data", payload)
    agent_id = row.get("agentId") or row.get("id")
    if not agent_id:
        raise SystemExit("SEED_FAIL no agent id")
    agents.append({"id": agent_id, "title": title, "role": title.split()[0]})
out = {"serverId": sid, "workspaceId": ws, "agents": agents}
json.dump(out, open("/tmp/native-qa-7539-agents.json", "w"), indent=2)
print("SEED_OK", len(agents), ws, sid)
