#!/usr/bin/env python3
import json
import re
from pathlib import Path

def rect(bounds):
    return [int(value) for value in re.findall(r"\d+", bounds)]

for label in ("selected-FIRST", "selected-MIDDLE", "selected-LAST"):
    path = Path(f"/tmp/native-qa-7539-evidence/{label}.json")
    if not path.exists():
        print(label, "missing")
        continue
    nodes = json.loads(path.read_text())
    tabs = []
    for node in nodes:
        resource = node.get("resource-id", "")
        if "workspace-tab-agent_" not in resource:
            continue
        if any(part in resource for part in ("title", "tooltip", "modified", "close")):
            continue
        tabs.append(node)
    print("==", label, "tabs", len(tabs))
    for node in tabs:
        left, _top, right, _bottom = rect(node["bounds"])
        width = (right - left) / 2
        tail = node.get("resource-id", "").split("/")[-1]
        desc = node.get("content-desc", "")[:36]
        print(f"  {width:.1f}dp sel={node.get('selected')} {tail[-24:]} {desc}")
