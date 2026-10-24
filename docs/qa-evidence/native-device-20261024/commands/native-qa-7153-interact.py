#!/usr/bin/env python3
"""7153 simulated resize on emulator-5572 only. Not a hardware-fold pass."""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import subprocess
import time
from pathlib import Path

ADB = "/Users/rrd/Library/Android/sdk/platform-tools/adb"
S = "emulator-5572"
WT = "/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7153"
APK = Path(WT) / "packages/app/android/app/build/outputs/apk/debug/app-debug.apk"
EVID = Path("/tmp/native-qa-7153-evidence")
STATUS = Path("/tmp/native-qa-7153-interact.status")
EXPECTED = "deb15d5b9f9cbcb30a500981a23aa09a57a411ec"
OLD_APK = "cb1ad96f72502ab457bfb2a399b4c20df1a108a19f31a665f6a458ab174a78eb"
URL = "exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081"
KEYS = ("@paseo:app-settings", "panel-state", "workspace-layout-state")

EVID.mkdir(parents=True, exist_ok=True)
results = {"hardware_fold": False, "simulated_resize_only": True}


def say(msg: str) -> None:
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg
    print(line, flush=True)
    with STATUS.open("a") as handle:
        handle.write(line + "\n")


def adb(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(
        [ADB, "-s", S, *args], stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout
    )


def shot(name: str) -> None:
    proc = adb("exec-out", "screencap", "-p", timeout=25)
    path = EVID / f"{name}.png"
    path.write_bytes(proc.stdout)
    say(f"SHOT {name} bytes={path.stat().st_size}")


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/native-qa-7153-ui.xml", timeout=25)
    proc = adb("shell", "cat", "/sdcard/native-qa-7153-ui.xml", timeout=20)
    xml = proc.stdout.decode("utf-8", "replace")
    (EVID / "last.xml").write_text(xml)
    return xml


def parse(xml: str) -> list[dict]:
    nodes = []
    for match in re.finditer(r"<node\s+([^>]*?)/?>", xml):
        attr = dict(re.findall(r'([A-Za-z0-9_:.-]+)="([^"]*)"', match.group(1)))
        box = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", attr.get("bounds", ""))
        if not box:
            continue
        nodes.append(
            {
                "text": attr.get("text", ""),
                "desc": attr.get("content-desc", ""),
                "rid": attr.get("resource-id", ""),
                "bounds": tuple(int(part) for part in box.groups()),
            }
        )
    return nodes


def rid_is(node: dict, needle: str) -> bool:
    rid = node["rid"]
    return rid == needle or rid.endswith("/" + needle)


def find_rid(nodes: list[dict], needle: str) -> list[dict]:
    return [node for node in nodes if rid_is(node, needle)]


def find_text(nodes: list[dict], text: str) -> list[dict]:
    return [node for node in nodes if node["text"] == text]


def center(bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    x1, y1, x2, y2 = bounds
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def visible_texts(nodes: list[dict], limit: int = 20) -> str:
    texts = [node["text"] or node["desc"] for node in nodes if node["text"] or node["desc"]]
    return " | ".join(texts[:limit])


def root_width(nodes: list[dict]) -> tuple[int, int, int]:
    best = max(nodes, key=lambda node: (node["bounds"][2] - node["bounds"][0]) * (node["bounds"][3] - node["bounds"][1]))
    x1, y1, x2, y2 = best["bounds"]
    return x2 - x1, y2 - y1, (x2 - x1) * (y2 - y1)


def density() -> int:
    text = adb("shell", "wm", "density").stdout.decode("utf-8", "replace")
    match = re.search(r"(\d+)", text)
    return int(match.group(1)) if match else 320


def shell_of(nodes: list[dict]) -> dict:
    return {
        "wide": bool(find_rid(nodes, "wide-shell")),
        "compact": bool(find_rid(nodes, "compact-shell")),
        "handle": bool(find_rid(nodes, "left-sidebar-resize-handle")),
        "settings_sidebar": bool(find_rid(nodes, "settings-sidebar")),
        "settings_detail": bool(find_rid(nodes, "settings-detail-pane")),
    }


def dismiss(nodes: list[dict]) -> bool:
    for needle in ("permission_deny_button", "permission_deny_and_dont_ask_again_button"):
        hits = [node for node in nodes if needle in node["rid"]]
        if hits:
            tap(*center(hits[0]["bounds"]))
            say(f"TAP_DENY {needle}")
            time.sleep(0.8)
            return True
    for label in ("Don't allow", "Don’t allow", "Deny"):
        hits = find_text(nodes, label)
        if hits:
            tap(*center(hits[0]["bounds"]))
            say(f"TAP_DENY_TEXT {label}")
            time.sleep(0.8)
            return True
    texts = {node["text"] for node in nodes}
    if "Go home" in texts or "Reload" in texts or any(text.startswith("This is the developer menu") for text in texts):
        hits = find_text(nodes, "Close")
        if hits:
            tap(*center(hits[0]["bounds"]))
            say("TAP_CLOSE")
            time.sleep(0.8)
            return True
        adb("shell", "input", "keyevent", "4")
        say("BACK_DEV_MENU")
        time.sleep(0.8)
        return True
    for node in nodes:
        if "10.0.2.2:19081" in (node["text"] or node["desc"]):
            tap(*center(node["bounds"]))
            say("TAP_SERVER")
            time.sleep(1.0)
            return True
    return False


def wait_shell(tries: int = 20):
    last_xml = ""
    last_nodes: list[dict] = []
    for attempt in range(tries):
        last_xml = dump()
        last_nodes = parse(last_xml)
        if dismiss(last_nodes):
            continue
        kind = shell_of(last_nodes)
        if kind["wide"] or kind["compact"]:
            return last_xml, last_nodes
        if attempt in (0, 4, 9):
            say(f"WAIT {attempt} {visible_texts(last_nodes)}")
        time.sleep(1.5)
    return last_xml, last_nodes


def measure(tag: str, tries: int = 18) -> dict:
    xml, nodes = wait_shell(tries)
    (EVID / f"{tag}.xml").write_text(xml)
    if not nodes:
        info = {"tag": tag, "error": "no-nodes"}
        say(f"MEASURE {json.dumps(info)}")
        return info
    width, height, _area = root_width(nodes)
    dpi = density()
    width_dp = round(width * 160 / dpi, 1)
    kind = shell_of(nodes)
    expected = "wide" if width_dp >= 600 else "compact"
    agrees = (expected == "wide" and kind["wide"] and not kind["compact"]) or (
        expected == "compact" and kind["compact"] and not kind["wide"]
    )
    info = {
        "tag": tag,
        "root": [width, height],
        "density": dpi,
        "width_dp": width_dp,
        "expected": expected,
        "shell": kind,
        "agrees": agrees,
    }
    say(f"MEASURE {json.dumps(info)}")
    shot(tag)
    return info


def set_size(width: int, height: int) -> None:
    adb("shell", "wm", "size", f"{width}x{height}")
    say(f"WM_SIZE {width}x{height}")
    time.sleep(1.4)


def focus_line() -> str:
    text = adb("shell", "dumpsys", "window").stdout.decode("utf-8", "replace")
    for line in text.splitlines():
        if "mCurrentFocus" in line or "mFocusedApp" in line:
            return line.strip()
    return ""


def background() -> str:
    adb("shell", "input", "keyevent", "3")
    time.sleep(1.2)
    line = focus_line()
    say(f"BACKGROUND {line}")
    return line


def foreground() -> bool:
    # adb treats a later -p as its own product flag, and MAIN/LAUNCHER did not resolve.
    # The manifest launcher is sh.paseo.debug/.MainActivity; -n brings that task forward.
    proc = adb("shell", "am", "start", "-W", "-n", "sh.paseo.debug/.MainActivity", timeout=40)
    text = (proc.stdout + proc.stderr).decode("utf-8", "replace").strip().replace("\n", " | ")
    say(f"FOREGROUND {text}")
    time.sleep(1.6)
    return proc.returncode == 0 and "Error" not in text


def read_storage(tag: str) -> dict:
    dest = EVID / tag
    dest.mkdir(parents=True, exist_ok=True)
    proc = adb("exec-out", "run-as", "sh.paseo.debug", "cat", "databases/RKStorage", timeout=20)
    blob = proc.stdout
    kept = {}
    if blob.startswith(b"SQLite format 3"):
        (dest / "RKStorage").write_bytes(blob)
        con = sqlite3.connect(str(dest / "RKStorage"))
        try:
            rows = con.execute(
                "select key, value from catalystLocalStorage where key in (?,?,?)",
                KEYS,
            ).fetchall()
        except sqlite3.DatabaseError as exc:
            con.close()
            info = {"error": str(exc)}
            say(f"STORAGE {tag} {info}")
            return info
        con.close()
        for key, value in rows:
            data = json.loads(value)
            if key == "@paseo:app-settings":
                kept[key] = {
                    "uiBaseFontSize": data.get("uiBaseFontSize"),
                    "contentFontSize": data.get("contentFontSize"),
                    "codeFontSize": data.get("codeFontSize"),
                }
            elif key == "panel-state":
                state = data.get("state", data)
                kept[key] = {"sidebarWidth": state.get("sidebarWidth") if isinstance(state, dict) else None}
            else:
                kept[key] = {"bytes": len(value)}
    else:
        kept["missing"] = True
    (dest / "kept.json").write_text(json.dumps(kept))
    say(f"STORAGE {tag} {json.dumps(kept)}")
    return kept


def launch() -> None:
    adb(
        "shell",
        "am",
        "start",
        "-a",
        "android.intent.action.VIEW",
        "-d",
        URL,
        "sh.paseo.debug",
    )


def main() -> int:
    STATUS.write_text("")
    say("INTERACT_BEGIN")
    head = subprocess.check_output(["git", "-C", WT, "rev-parse", "HEAD"], text=True).strip()
    results["head"] = head
    if head != EXPECTED:
        say(f"FAILED head {head}")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    digest = hashlib.sha256(APK.read_bytes()).hexdigest()
    results["apk_sha256"] = digest
    results["apk_is_old_cb1"] = digest == OLD_APK
    if digest == OLD_APK:
        say("FAILED apk is the old cb1 build")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    proof = Path("/tmp/native-qa-7153-apk-proof.txt")
    results["apk_proof"] = proof.read_text() if proof.exists() else ""
    bundle = Path("/tmp/native-qa-7153-bundle.sha256")
    results["bundle_sha256_line"] = bundle.read_text().strip() if bundle.exists() else ""
    installed = adb("shell", "pm", "path", "sh.paseo.debug").stdout.decode().strip()
    results["pm_path"] = installed
    device_apk = ""
    for line in installed.splitlines():
        if line.startswith("package:"):
            device_apk = line.split(":", 1)[1].strip()
    if device_apk:
        hashed = adb("shell", "sha256sum", device_apk, timeout=90)
        results["installed_apk_sha256"] = hashed.stdout.decode().strip()
    say(f"IDENTITY apk={digest} installed={results.get('installed_apk_sha256')}")
    if device_apk and digest not in results.get("installed_apk_sha256", ""):
        say("FAILED installed apk hash differs from the new build")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2

    cleared = adb("shell", "pm", "clear", "sh.paseo.debug", timeout=30)
    results["pm_clear"] = (cleared.stdout + cleared.stderr).decode().strip()
    say(f"PM_CLEAR {results['pm_clear']}")
    if "Success" not in results["pm_clear"]:
        say("FAILED pm clear")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    set_size(2560, 1600)
    adb("shell", "wm", "density", "320")
    launch()
    first = measure("01-wide-initial", tries=45)
    results["wide_initial"] = first
    if not first.get("agrees") or first.get("expected") != "wide":
        say("FAILED initial wide layout")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    results["storage_before"] = read_storage("storage-before")

    set_size(1100, 1600)
    foreground_narrow = measure("02-foreground-narrow")
    results["foreground_narrow"] = foreground_narrow
    set_size(2560, 1600)
    foreground_wide = measure("03-foreground-wide-restored")
    results["foreground_wide_restored"] = foreground_wide

    focus = background()
    results["background_focus"] = focus
    if "sh.paseo.debug" in focus:
        say("FAILED app still focused after HOME")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    set_size(1100, 1600)
    if not foreground():
        say("FAILED resume after background narrow")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    background_narrow = measure("04-background-narrow")
    results["background_narrow"] = background_narrow
    focus2 = background()
    results["background_focus_2"] = focus2
    set_size(2560, 1600)
    if not foreground():
        say("FAILED resume after background wide")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    background_wide = measure("05-background-wide-restored")
    results["background_wide_restored"] = background_wide

    set_size(1400, 1100)
    adb("shell", "settings", "put", "system", "user_rotation", "0")
    time.sleep(1.2)
    rot0 = measure("06-rotation-0")
    results["rotation_0"] = rot0
    adb("shell", "settings", "put", "system", "user_rotation", "1")
    time.sleep(1.4)
    rot1 = measure("07-rotation-1")
    results["rotation_1"] = rot1
    rotated = rot0.get("root") != rot1.get("root")
    results["rotation_changed_root"] = rotated
    if not rotated:
        set_size(1100, 1400)
        swapped = measure("08-swapped-size")
        results["swapped_size"] = swapped
        say("ROTATION_FALLBACK wm size swap")
    adb("shell", "settings", "put", "system", "user_rotation", "0")
    set_size(2560, 1600)
    adb("shell", "wm", "density", "320")
    final = measure("09-restored")
    results["restored"] = final
    results["storage_after"] = read_storage("storage-after")
    before = results["storage_before"]
    after = results["storage_after"]
    persisted = before == after or (
        "@paseo:app-settings" in before
        and before.get("@paseo:app-settings") == after.get("@paseo:app-settings")
        and before.get("panel-state") == after.get("panel-state")
    )
    results["storage_persisted"] = persisted
    checks = [
        foreground_narrow.get("agrees") and foreground_narrow.get("expected") == "compact",
        foreground_wide.get("agrees") and foreground_wide.get("expected") == "wide",
        background_narrow.get("agrees") and background_narrow.get("expected") == "compact",
        background_wide.get("agrees") and background_wide.get("expected") == "wide",
        rot0.get("agrees"),
        rot1.get("agrees") if rotated else results.get("swapped_size", {}).get("agrees"),
        final.get("agrees") and final.get("expected") == "wide",
        persisted,
    ]
    results["checks"] = checks
    (EVID / "results.json").write_text(json.dumps(results, indent=2))
    if not all(checks):
        say(f"FAILED checks {checks}")
        return 2
    say("INTERACT_OK")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        say(f"FAILED exception {type(exc).__name__}: {exc}")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        raise
