#!/usr/bin/env python3
"""Drive emulator-5572 for PR 7539 selected-tab and long-press proof."""

from __future__ import annotations

import json
import re
import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

ADB = "/Users/rrd/Library/Android/sdk/platform-tools/adb"
SERIAL = "emulator-5572"
OUT = Path("/tmp/native-qa-7539-evidence")
AGENTS = json.loads(Path("/tmp/native-qa-7539-agents.json").read_text())
DPI = 320


def adb(*args: str, binary: bool = False, check: bool = True, timeout: int = 40) -> bytes | str:
    result = subprocess.run(
        [ADB, "-s", SERIAL, *args],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
        check=False,
    )
    if check and result.returncode != 0:
        raise RuntimeError(result.stderr.decode(errors="replace")[:600])
    if binary:
        return result.stdout
    return result.stdout.decode(errors="replace")


def rect(bounds: str) -> tuple[int, int, int, int]:
    left, top, right, bottom = (int(value) for value in re.findall(r"\d+", bounds))
    return left, top, right, bottom


def dump(label: str) -> list[dict[str, str]]:
    remote = f"/sdcard/native-qa-7539-{label}.xml"
    adb("shell", "uiautomator", "dump", remote, timeout=30)
    xml = adb("exec-out", "cat", remote)
    png = adb("exec-out", "screencap", "-p", binary=True, timeout=20)
    (OUT / f"{label}.xml").write_text(xml)
    (OUT / f"{label}.png").write_bytes(png)  # type: ignore[arg-type]
    nodes: list[dict[str, str]] = []
    for node in ET.fromstring(xml).iter("node"):
        attrib = node.attrib
        nodes.append(
            {
                "resource-id": attrib.get("resource-id", ""),
                "text": attrib.get("text", ""),
                "content-desc": attrib.get("content-desc", ""),
                "bounds": attrib.get("bounds", ""),
                "selected": attrib.get("selected", ""),
                "clickable": attrib.get("clickable", ""),
            }
        )
    (OUT / f"{label}.json").write_text(json.dumps(nodes, indent=2))
    return nodes


def tail(node: dict[str, str]) -> str:
    return node.get("resource-id", "").split("/")[-1]


def find_tab(nodes: list[dict[str, str]], agent_id: str) -> dict[str, str] | None:
    needle = f"workspace-tab-agent_{agent_id}"
    for node in nodes:
        if needle in tail(node) and "tooltip" not in tail(node) and "title" not in tail(node) and "modified" not in tail(node) and "close" not in tail(node):
            return node
    return None


def center(node: dict[str, str]) -> tuple[int, int]:
    left, top, right, bottom = rect(node["bounds"])
    return (left + right) // 2, (top + bottom) // 2


def tap_node(node: dict[str, str]) -> None:
    x, y = center(node)
    adb("shell", "input", "tap", str(x), str(y))


def long_press(node: dict[str, str]) -> None:
    x, y = center(node)
    adb("shell", "input", "swipe", str(x), str(y), str(x), str(y + 2), "1200", timeout=20)


def launch_metro() -> None:
    url = "exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", url, "sh.paseo.debug")


def client_server_id(nodes: list[dict[str, str]]) -> str:
    workspace = AGENTS["workspaceId"]
    for node in nodes:
        resource = node.get("resource-id", "")
        marker = "sidebar-workspace-row-"
        if marker in resource and workspace in resource:
            return resource.split(marker, 1)[1].split(":", 1)[0]
    return AGENTS["serverId"]


def open_agent(agent_id: str, server_id: str) -> None:
    workspace = AGENTS["workspaceId"]
    route = f"paseo://h/{server_id}/workspace/{workspace}?open=agent%3A{agent_id}"
    adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", route, "sh.paseo.debug")


def tap_matching(nodes: list[dict[str, str]], needle: str) -> bool:
    for node in nodes:
        blob = " ".join((node.get("resource-id", ""), node.get("text", ""), node.get("content-desc", "")))
        if needle in blob and node.get("bounds"):
            tap_node(node)
            return True
    return False


def wait_for(predicate, label: str, seconds: int = 90):
    deadline = time.time() + seconds
    last = []
    while time.time() < deadline:
        last = dump(label)
        if predicate(last):
            return last
        time.sleep(3)
    return last


def shell_ready(nodes: list[dict[str, str]]) -> bool:
    blob = " ".join(f"{n['text']} {n['content-desc']} {n['resource-id']}" for n in nodes)
    if "catalyst_redbox_title" in blob or "EventEmitter" in blob:
        raise SystemExit("REDBOX")
    return "New workspace" in blob or "native-qa-7539-tabs" in blob


def tab_width_dp(node: dict[str, str]) -> float:
    left, _top, right, _bottom = rect(node["bounds"])
    return (right - left) / (DPI / 160)


def measure(label: str, nodes: list[dict[str, str]]) -> dict:
    tabs = []
    for agent in AGENTS["agents"]:
        node = find_tab(nodes, agent["id"])
        if node is None:
            tabs.append({"role": agent["role"], "id": agent["id"], "present": False})
            continue
        tabs.append(
            {
                "role": agent["role"],
                "id": agent["id"],
                "present": True,
                "selected": node.get("selected"),
                "widthDp": round(tab_width_dp(node), 1),
                "bounds": node["bounds"],
                "desc": node.get("content-desc", "")[:80],
            }
        )
    return {"label": label, "tabs": tabs}


def title_text(nodes: list[dict[str, str]], agent_id: str) -> str:
    needle = f"workspace-tab-title-agent_{agent_id}"
    texts = []
    for node in nodes:
        if needle in tail(node) or needle in node.get("content-desc", ""):
            if node.get("text"):
                texts.append(node["text"])
            if node.get("content-desc"):
                texts.append(node["content-desc"])
    # Also keep any text node that equals a full title.
    return " | ".join(dict.fromkeys(texts))


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    adb("shell", "am", "force-stop", "sh.paseo.debug")
    time.sleep(1)
    launch_metro()
    nodes = wait_for(shell_ready, "shell", 180)
    if not shell_ready(nodes):
        raise SystemExit("SHELL_NOT_READY")
    server_id = client_server_id(nodes)
    results_server = server_id
    for index, agent in enumerate(AGENTS["agents"]):
        open_agent(agent["id"], server_id)
        found = wait_for(
            lambda current, agent_id=agent["id"]: find_tab(current, agent_id) is not None,
            f"open-{index}",
            18,
        )
        if find_tab(found, agent["id"]) is None:
            if not tap_matching(found, "sidebar-sessions") and not tap_matching(found, "History"):
                raise SystemExit(f"TAB_MISSING no-history {agent['role']}")
            time.sleep(1.5)
            listed = dump(f"history-{index}")
            if not tap_matching(listed, agent["id"]) and not tap_matching(listed, agent["title"][:24]):
                raise SystemExit(f"TAB_MISSING {agent['role']} {agent['id']} server={server_id}")
            found = wait_for(
                lambda current, agent_id=agent["id"]: find_tab(current, agent_id) is not None,
                f"opened-{index}",
                20,
            )
        if find_tab(found, agent["id"]) is None:
            raise SystemExit(f"TAB_MISSING {agent['role']} {agent['id']} server={server_id}")
        time.sleep(0.8)
    results = {
        "head": "9cb99aca728a8192938fb17b70a510dc9644a182",
        "clientServerId": results_server,
        "agents": AGENTS["agents"],
    }
    order = ["FIRST", "MIDDLE", "LAST"]
    by_role = {agent["role"]: agent for agent in AGENTS["agents"]}
    for role in order:
        agent = by_role[role]
        nodes = dump(f"before-{role}")
        node = find_tab(nodes, agent["id"])
        if node is None:
            raise SystemExit(f"LOST {role}")
        tap_node(node)
        time.sleep(1.5)
        nodes = dump(f"selected-{role}")
        results[role] = measure(role, nodes)
        selected = [tab for tab in results[role]["tabs"] if tab.get("selected") == "true"]
        widths = [tab.get("widthDp") for tab in results[role]["tabs"] if tab.get("present")]
        results[role]["selectedCount"] = len(selected)
        results[role]["widths"] = widths
    # Long-press the middle tab, which carries a full sentence.
    mid = by_role["MIDDLE"]
    nodes = dump("before-longpress")
    node = find_tab(nodes, mid["id"])
    if node is None:
        raise SystemExit("LONGPRESS_TAB_MISSING")
    record = subprocess.Popen(
        [ADB, "-s", SERIAL, "shell", "screenrecord", "--time-limit", "8", "/sdcard/native-qa-7539-longpress.mp4"],
        stdin=subprocess.DEVNULL,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(1.0)
    long_press(node)
    time.sleep(1.2)
    nodes = dump("longpress-middle")
    results["longpress"] = {
        "expected": mid["title"],
        "seen": title_text(nodes, mid["id"]),
        "containsExpected": mid["title"] in json.dumps(nodes),
    }
    try:
        record.wait(timeout=15)
    except subprocess.TimeoutExpired:
        record.kill()
    video = adb("exec-out", "cat", "/sdcard/native-qa-7539-longpress.mp4", binary=True, check=False, timeout=30)
    if isinstance(video, bytes) and video[:8] == b"\x00\x00\x00\x18ftyp":
        (OUT / "longpress.mp4").write_bytes(video)
        results["longpress"]["videoBytes"] = len(video)
    adb("shell", "rm", "-f", "/sdcard/native-qa-7539-longpress.mp4", check=False)
    adb("shell", "input", "keyevent", "4", check=False)
    time.sleep(0.6)
    # Portrait.
    adb("shell", "settings", "put", "system", "accelerometer_rotation", "0")
    adb("shell", "settings", "put", "system", "user_rotation", "1")
    time.sleep(2)
    results["wm_portrait"] = adb("shell", "wm", "size").strip()
    last = by_role["LAST"]
    nodes = dump("portrait-before")
    node = find_tab(nodes, last["id"])
    if node is not None:
        tap_node(node)
        time.sleep(1.5)
        nodes = dump("portrait-selected-last")
        results["portraitLast"] = measure("portrait-last", nodes)
        node = find_tab(nodes, last["id"])
        if node is not None:
            long_press(node)
            time.sleep(1.2)
            nodes = dump("portrait-longpress-last")
            results["portraitLongpress"] = {
                "expected": last["title"],
                "containsExpected": last["title"] in json.dumps(nodes),
                "seen": title_text(nodes, last["id"]),
            }
            adb("shell", "input", "keyevent", "4", check=False)
    else:
        results["portraitLast"] = "TAB_MISSING"
    adb("shell", "settings", "put", "system", "user_rotation", "0")
    time.sleep(1.5)
    results["wm_end"] = adb("shell", "wm", "size").strip()
    results["density_end"] = adb("shell", "wm", "density").strip()
    results["night_end"] = adb("shell", "cmd", "uimode", "night").strip()
    (OUT / "results.json").write_text(json.dumps(results, indent=2))
    print("INTERACT_DONE")
    print(json.dumps(results, indent=2)[:4000])


if __name__ == "__main__":
    main()
