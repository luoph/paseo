#!/usr/bin/env python3
import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ADB = "/Users/rrd/Library/Android/sdk/platform-tools/adb"
SERIAL = "emulator-5572"
OUT = Path("/tmp/native-qa-7539-evidence")
AGENT = "45c0ce7c-b41f-496f-919b-505002fff099"


def adb(*args, binary=False, timeout=30):
    result = subprocess.run(
        [ADB, "-s", SERIAL, *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.decode(errors="replace")[:400])
    return result.stdout if binary else result.stdout.decode(errors="replace")


def dump(label):
    remote = f"/sdcard/native-qa-7539-{label}.xml"
    adb("shell", "uiautomator", "dump", remote)
    xml = adb("exec-out", "cat", remote)
    png = adb("exec-out", "screencap", "-p", binary=True)
    (OUT / f"{label}.xml").write_text(xml)
    (OUT / f"{label}.png").write_bytes(png)
    return list(ET.fromstring(xml).iter("node"))


def bounds(node):
    return [int(value) for value in re.findall(r"\d+", node.attrib.get("bounds", ""))]


nodes = dump("orient-now")
root = bounds(nodes[0])
print("ROOT", root)
if root[2] < root[3]:
    adb("shell", "settings", "put", "system", "user_rotation", "0")
    time.sleep(2)
    nodes = dump("orient-restored")
    print("RESTORED", bounds(nodes[0]))
needle = f"workspace-tab-agent_{AGENT}"
target = None
for node in nodes:
    resource = node.attrib.get("resource-id", "")
    if needle in resource and "title" not in resource and "tooltip" not in resource and "close" not in resource and "modified" not in resource:
        target = node
        break
if target is None:
    raise SystemExit("FILLER_TAB_MISSING")
left, top, right, bottom = bounds(target)
adb("shell", "input", "tap", str((left + right) // 2), str((top + bottom) // 2))
time.sleep(1.2)
nodes = dump("selected-FILLER")
rows = []
for node in nodes:
    resource = node.attrib.get("resource-id", "")
    if "workspace-tab-agent_" not in resource:
        continue
    if any(part in resource for part in ("title", "tooltip", "close", "modified")):
        continue
    left, top, right, bottom = bounds(node)
    rows.append(
        {
            "id": resource.split("agent_")[-1][:8],
            "selected": node.attrib.get("selected"),
            "widthDp": round((right - left) / 2, 1),
            "bounds": node.attrib.get("bounds"),
        }
    )
print(json.dumps(rows, indent=2))
adb("shell", "input", "keyevent", "4")
print("FILLER_DONE")
