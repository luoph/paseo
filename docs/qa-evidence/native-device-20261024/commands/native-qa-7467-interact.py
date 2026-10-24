#!/usr/bin/env python3
"""7467 font defaults on emulator-5572 only. Python 3.9."""
from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import subprocess
import time
from pathlib import Path

ADB = "/Users/rrd/Library/Android/sdk/platform-tools/adb"
S = "emulator-5572"
WT = "/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7467"
APK = Path(
    "/Users/rrd/workspace/rrd/paseo/.worktrees/pr-7776-android-pad/packages/app/android/app/build/outputs/apk/debug/app-debug.apk"
)
EVID = Path("/tmp/native-qa-7467-evidence")
STATUS = Path("/tmp/native-qa-7467-interact.status")
EXPECTED = "da5cd4ac52f48d36977c2788358b664ed04c872e"
URL = "exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081"
KEY = "@paseo:app-settings"
FIELDS = (
    ("uiBaseFontSize", "Interface font size", "17"),
    ("contentFontSize", "Content font size", "18"),
    ("codeFontSize", "Code font size", "19"),
)
DIGIT_KEY = {str(i): str(7 + i) for i in range(10)}

EVID.mkdir(parents=True, exist_ok=True)
results = {}


def say(msg: str) -> None:
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg
    print(line, flush=True)
    with STATUS.open("a") as handle:
        handle.write(line + "\n")


def adb(*args: str, timeout: int = 30) -> subprocess.CompletedProcess:
    if args and args[0] != "-s":
        cmd = [ADB, "-s", S, *args]
    else:
        cmd = [ADB, *args]
    return subprocess.run(cmd, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)


def shot(name: str) -> None:
    proc = adb("exec-out", "screencap", "-p", timeout=25)
    path = EVID / f"{name}.png"
    path.write_bytes(proc.stdout)
    say(f"SHOT {name} bytes={path.stat().st_size}")


def dump() -> str:
    adb("shell", "uiautomator", "dump", "/sdcard/native-qa-7467-ui.xml", timeout=25)
    proc = adb("shell", "cat", "/sdcard/native-qa-7467-ui.xml", timeout=20)
    xml = proc.stdout.decode("utf-8", "replace")
    (EVID / "last.xml").write_text(xml)
    return xml


def parse(xml: str) -> list[dict]:
    nodes = []
    for match in re.finditer(r"<node\s+([^>]*?)/?>", xml):
        attr = dict(re.findall(r'([A-Za-z0-9_:.-]+)="([^"]*)"', match.group(1)))
        bounds = attr.get("bounds", "")
        box = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", bounds)
        if not box:
            continue
        nodes.append(
            {
                "text": attr.get("text", ""),
                "desc": attr.get("content-desc", ""),
                "rid": attr.get("resource-id", ""),
                "cls": attr.get("class", ""),
                "bounds": tuple(int(part) for part in box.groups()),
                "selected": attr.get("selected", ""),
            }
        )
    return nodes


def center(bounds: tuple[int, int, int, int]) -> tuple[int, int]:
    x1, y1, x2, y2 = bounds
    return (x1 + x2) // 2, (y1 + y2) // 2


def tap(x: int, y: int) -> None:
    adb("shell", "input", "tap", str(x), str(y))


def rid_is(node: dict, needle: str) -> bool:
    rid = node["rid"]
    return rid == needle or rid.endswith("/" + needle)


def find_rid(nodes: list[dict], needle: str) -> list[dict]:
    return [node for node in nodes if rid_is(node, needle)]


def find_desc(nodes: list[dict], desc: str) -> list[dict]:
    return [node for node in nodes if node["desc"] == desc]


def find_text(nodes: list[dict], text: str) -> list[dict]:
    return [node for node in nodes if node["text"] == text]


def visible_texts(nodes: list[dict], limit: int = 25) -> str:
    texts = [node["text"] or node["desc"] for node in nodes if node["text"] or node["desc"]]
    return " | ".join(texts[:limit])


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
        timeout=20,
    )


def font_fields(raw: str | None) -> dict | None:
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        return {"raw_error": "json", "prefix": raw[:120]}
    return {
        "uiBaseFontSize": data.get("uiBaseFontSize"),
        "contentFontSize": data.get("contentFontSize"),
        "codeFontSize": data.get("codeFontSize"),
    }


def read_storage(tag: str) -> dict:
    dest = EVID / tag
    dest.mkdir(parents=True, exist_ok=True)
    pulled = {}
    for name in ("RKStorage", "RKStorage-wal", "RKStorage-shm"):
        proc = adb("exec-out", "run-as", "sh.paseo.debug", "cat", f"databases/{name}", timeout=20)
        blob = proc.stdout
        ok = proc.returncode == 0 and blob.startswith(b"SQLite format 3" if name == "RKStorage" else b"\x37\x7f\x06")
        if name == "RKStorage":
            ok = proc.returncode == 0 and blob.startswith(b"SQLite format 3")
        elif name.endswith("-wal"):
            ok = proc.returncode == 0 and len(blob) > 32 and blob[:4] in (b"\x37\x7f\x06\x82", b"\x37\x7f\x06\x83")
        else:
            ok = proc.returncode == 0 and len(blob) > 0 and b"No such file" not in blob[:80]
        if ok:
            (dest / name).write_bytes(blob)
            pulled[name] = len(blob)
        else:
            pulled[name] = 0
    query = adb(
        "shell",
        "run-as",
        "sh.paseo.debug",
        "sqlite3",
        "databases/RKStorage",
        f"select value from catalystLocalStorage where key='{KEY}';",
        timeout=20,
    )
    device_raw = query.stdout.decode("utf-8", "replace").strip()
    device_err = query.stderr.decode("utf-8", "replace").strip()
    (dest / "device-query.txt").write_text(device_raw + "\n")
    local_raw = ""
    local_err = ""
    db_path = dest / "RKStorage"
    if db_path.exists() and db_path.stat().st_size > 0:
        try:
            con = sqlite3.connect(str(db_path))
            row = con.execute(
                "select value from catalystLocalStorage where key=?",
                (KEY,),
            ).fetchone()
            con.close()
            local_raw = row[0] if row else ""
        except sqlite3.DatabaseError as exc:
            local_err = str(exc)
    chosen = device_raw or local_raw
    (dest / "settings.json").write_text(chosen)
    parsed = font_fields(chosen if chosen else None)
    info = {
        "pulled": pulled,
        "device_query_len": len(device_raw),
        "device_err": device_err[:300],
        "local_len": len(local_raw),
        "local_err": local_err[:300],
        "fonts": parsed,
        "source": "device" if device_raw else ("local" if local_raw else "missing"),
    }
    say(f"STORAGE {tag} {json.dumps(info, ensure_ascii=False)}")
    return info


def save(name: str, xml: str) -> None:
    (EVID / f"{name}.xml").write_text(xml)


def wait_until(predicate, tries: int, pause: float = 2.0):
    last_xml = ""
    last_nodes: list[dict] = []
    for attempt in range(tries):
        last_xml = dump()
        last_nodes = parse(last_xml)
        if dismiss_system_dialog(last_nodes) or advance_launcher(last_nodes):
            time.sleep(1.0)
            continue
        if predicate(last_nodes):
            return last_xml, last_nodes
        if attempt in (0, 4, 9, 14):
            say(f"WAIT {attempt} {visible_texts(last_nodes)}")
        time.sleep(pause)
    return last_xml, last_nodes


def app_ready(nodes: list[dict]) -> bool:
    if find_rid(nodes, "sidebar-settings") or find_rid(nodes, "welcome-open-settings"):
        return True
    if find_rid(nodes, "settings-sidebar"):
        return True
    texts = " ".join(node["text"] for node in nodes)
    if "LogBox" in texts or "Console Error" in texts:
        return True
    return False


def dev_menu_open(nodes: list[dict]) -> bool:
    texts = {node["text"] for node in nodes}
    if "Go home" in texts or "Reload" in texts:
        return True
    return any(text.startswith("This is the developer menu") for text in texts)


def advance_launcher(nodes: list[dict]) -> bool:
    if dev_menu_open(nodes):
        attempt = getattr(advance_launcher, "attempts", 0)
        advance_launcher.attempts = attempt + 1
        if attempt % 3 == 0:
            hits = find_text(nodes, "Close")
            if hits:
                x, y = center(hits[0]["bounds"])
                tap(x, y)
                say(f"TAP_CLOSE {x},{y}")
                time.sleep(1.0)
                return True
        if attempt % 3 == 1:
            tap(400, 200)
            say("TAP_OUTSIDE_DEV_MENU")
            time.sleep(1.0)
            return True
        adb("shell", "input", "keyevent", "4")
        say("BACK_DEV_MENU")
        time.sleep(1.0)
        return True
    for node in nodes:
        blob = node["text"] or node["desc"]
        if "10.0.2.2:19081" in blob:
            tap(*center(node["bounds"]))
            say(f"TAP_SERVER {blob[:80]}")
            time.sleep(1.2)
            return True
    return False


def dismiss_system_dialog(nodes: list[dict]) -> bool:
    deny_ids = (
        "permission_deny_button",
        "permission_deny_and_dont_ask_again_button",
    )
    for needle in deny_ids:
        hits = [node for node in nodes if needle in node["rid"]]
        if hits:
            tap(*center(hits[0]["bounds"]))
            say(f"TAP_DENY {needle}")
            time.sleep(0.8)
            return True
    for label in ("Don’t allow", "Don't allow", "Deny"):
        hits = find_text(nodes, label)
        if hits:
            tap(*center(hits[0]["bounds"]))
            say(f"TAP_DENY {label}")
            time.sleep(0.8)
            return True
    return False


def open_settings(nodes: list[dict]) -> tuple[str, list[dict]]:
    xml = ""
    for needle in ("sidebar-settings", "welcome-open-settings"):
        hits = find_rid(nodes, needle)
        if hits:
            tap(*center(hits[0]["bounds"]))
            say(f"TAP {needle}")
            xml, nodes = wait_until(lambda found: bool(find_rid(found, "settings-sidebar") or find_text(found, "Appearance")), 12)
            return xml, nodes
    appearance = find_text(nodes, "Appearance")
    if appearance and find_rid(nodes, "settings-sidebar"):
        return dump(), nodes
    say("NO_SETTINGS_ENTRY")
    return dump(), nodes


def open_appearance(nodes: list[dict]) -> tuple[str, list[dict]]:
    hits = find_text(nodes, "Appearance")
    if not hits:
        sidebar = find_rid(nodes, "settings-sidebar")
        if sidebar:
            x1, y1, x2, y2 = sidebar[0]["bounds"]
            adb("shell", "input", "swipe", str((x1 + x2) // 2), str(y2 - 40), str((x1 + x2) // 2), str(y1 + 40), "300")
            time.sleep(0.6)
            nodes = parse(dump())
            hits = find_text(nodes, "Appearance")
    if hits:
        tap(*center(hits[0]["bounds"]))
        say("TAP Appearance")
        time.sleep(1.0)
    return dump(), parse(dump())


def scroll_detail() -> None:
    xml = dump()
    nodes = parse(xml)
    pane = find_rid(nodes, "settings-detail-pane")
    if pane:
        x1, y1, x2, y2 = pane[0]["bounds"]
        cx = (x1 + x2) // 2
        adb("shell", "input", "swipe", str(cx), str(y2 - 120), str(cx), str(y1 + 160), "450")
    else:
        adb("shell", "input", "swipe", "1800", "1200", "1800", "500", "450")
    time.sleep(0.7)


def ensure_fonts_visible() -> tuple[str, list[dict]]:
    xml, nodes = dump(), []
    for _ in range(6):
        xml = dump()
        nodes = parse(xml)
        if find_desc(nodes, "Interface font size") and find_desc(nodes, "Code font size"):
            return xml, nodes
        scroll_detail()
    xml = dump()
    return xml, parse(xml)


def field_node(nodes: list[dict], desc: str) -> dict | None:
    hits = [node for node in find_desc(nodes, desc) if "EditText" in node["cls"] or node["text"]]
    if hits:
        return hits[0]
    hits = find_desc(nodes, desc)
    return hits[0] if hits else None


def field_text(desc: str) -> str | None:
    nodes = parse(dump())
    node = field_node(nodes, desc)
    return node["text"] if node else None


def type_digits(value: str) -> None:
    keys = [DIGIT_KEY[ch] for ch in value]
    adb("shell", "input", "keyevent", *keys)


def clear_and_type(desc: str, value: str) -> str | None:
    xml, nodes = ensure_fonts_visible()
    node = field_node(nodes, desc)
    if node is None:
        say(f"MISSING_FIELD {desc}")
        return None
    tap(*center(node["bounds"]))
    time.sleep(0.5)
    adb("shell", "input", "keyevent", "67")
    time.sleep(0.2)
    type_digits(value)
    time.sleep(0.3)
    seen = field_text(desc)
    say(f"TYPED {desc} want={value} seen={seen}")
    if seen != value:
        adb("shell", "input", "keyevent", "123")
        adb("shell", "input", "keyevent", "67", "67", "67", "67", "67", "67")
        time.sleep(0.2)
        type_digits(value)
        time.sleep(0.3)
        seen = field_text(desc)
        say(f"RETYPED {desc} want={value} seen={seen}")
    adb("shell", "input", "keyevent", "66")
    time.sleep(0.4)
    titles = find_text(parse(dump()), "Interface size" if "Interface" in desc else "Fonts")
    if titles:
        tap(*center(titles[0]["bounds"]))
        time.sleep(0.5)
    return seen


def dismiss_keyboard() -> None:
    shown = adb("shell", "dumpsys", "input_method").stdout.decode("utf-8", "replace")
    if "mInputShown=true" in shown:
        adb("shell", "input", "keyevent", "4")
        time.sleep(0.4)
        say("DISMISS_IME")


def main() -> int:
    STATUS.write_text("")
    say("INTERACT_BEGIN")
    head = subprocess.check_output(["git", "-C", WT, "rev-parse", "HEAD"], text=True).strip()
    results["head"] = head
    if head != EXPECTED:
        say(f"FAILED head {head}")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2
    digest = hashlib.sha256()
    with APK.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    results["apk_sha256"] = digest.hexdigest()
    bundle_meta = Path("/tmp/native-qa-7467-bundle.sha256")
    results["bundle_sha256_line"] = bundle_meta.read_text().strip() if bundle_meta.exists() else ""
    status_text = Path("/tmp/native-qa-7467-up.status").read_text() if Path("/tmp/native-qa-7467-up.status").exists() else ""
    hit_line = [line for line in status_text.splitlines() if "BUNDLE_HITS" in line]
    results["bundle_hits_line"] = hit_line[-1] if hit_line else ""
    pkg = adb("shell", "dumpsys", "package", "sh.paseo.debug").stdout.decode("utf-8", "replace")
    version = [line.strip() for line in pkg.splitlines() if "versionName=" in line or "versionCode=" in line]
    results["package"] = version[:4]
    path_proc = adb("shell", "pm", "path", "sh.paseo.debug")
    results["pm_path"] = path_proc.stdout.decode().strip()
    device_apk = ""
    for line in results["pm_path"].splitlines():
        if line.startswith("package:"):
            device_apk = line.split(":", 1)[1].strip()
            break
    if device_apk:
        hashed = adb("shell", "sha256sum", device_apk, timeout=60)
        results["installed_apk_sha256"] = hashed.stdout.decode().strip()
    wm = adb("shell", "wm", "size").stdout.decode().strip()
    density = adb("shell", "wm", "density").stdout.decode().strip()
    results["wm_size"] = wm
    results["wm_density"] = density
    say(f"IDENTITY head={head} apk={results['apk_sha256']} installed={results.get('installed_apk_sha256')} {wm} {density}")

    if os.environ.get("SKIP_CLEAR") == "1":
        results["pm_clear"] = "Success at 2026-10-24T14:24:25Z; not repeated"
        say("SKIP_CLEAR existing post-clear session")
    else:
        cleared = adb("shell", "pm", "clear", "sh.paseo.debug", timeout=30)
        results["pm_clear"] = (cleared.stdout + cleared.stderr).decode("utf-8", "replace").strip()
        say(f"PM_CLEAR {results['pm_clear']}")
        if "Success" not in results["pm_clear"]:
            say("FAILED pm clear")
            (EVID / "results.json").write_text(json.dumps(results, indent=2))
            return 2
        launch()
    xml, nodes = wait_until(app_ready, 25, 2.0)
    save("01-launch", xml)
    shot("01-launch")
    results["launch_texts"] = visible_texts(nodes, 40)
    if not (find_rid(nodes, "sidebar-settings") or find_rid(nodes, "welcome-open-settings") or find_rid(nodes, "settings-sidebar")):
        say(f"FAILED app chrome missing {results['launch_texts']}")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2

    # The settings hook writes defaults on first load. Read before and after opening Appearance.
    time.sleep(2)
    results["storage_after_launch"] = read_storage("storage-after-launch")
    xml, nodes = open_settings(nodes)
    save("02-settings", xml)
    shot("02-settings")
    xml, nodes = open_appearance(nodes)
    xml, nodes = ensure_fonts_visible()
    save("03-fonts-default", xml)
    shot("03-fonts-default")
    ui_default = {}
    for _key, desc, _value in FIELDS:
        node = field_node(nodes, desc)
        ui_default[desc] = node["text"] if node else None
    results["ui_default"] = ui_default
    results["storage_default"] = read_storage("storage-default")
    say(f"DEFAULT_UI {ui_default}")
    fonts = (results["storage_default"].get("fonts") or {})
    default_ok = ui_default == {
        "Interface font size": "13",
        "Content font size": "13",
        "Code font size": "13",
    } and fonts.get("uiBaseFontSize") == 13 and fonts.get("contentFontSize") == 13 and fonts.get("codeFontSize") == 13
    results["default_ok"] = default_ok
    if not default_ok:
        say("FAILED defaults are not 13")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2

    typed = {}
    for _key, desc, value in FIELDS:
        typed[desc] = clear_and_type(desc, value)
        dismiss_keyboard()
    xml, nodes = ensure_fonts_visible()
    save("04-fonts-custom", xml)
    shot("04-fonts-custom")
    ui_custom = {}
    for _key, desc, _value in FIELDS:
        node = field_node(parse(dump()), desc)
        ui_custom[desc] = node["text"] if node else None
    results["typed"] = typed
    results["ui_custom"] = ui_custom
    time.sleep(1.0)
    results["storage_custom"] = read_storage("storage-custom")
    say(f"CUSTOM_UI {ui_custom}")
    custom_fonts = results["storage_custom"].get("fonts") or {}
    custom_ok = (
        ui_custom.get("Interface font size") == "17"
        and ui_custom.get("Content font size") == "18"
        and ui_custom.get("Code font size") == "19"
        and custom_fonts.get("uiBaseFontSize") == 17
        and custom_fonts.get("contentFontSize") == 18
        and custom_fonts.get("codeFontSize") == 19
    )
    results["custom_ok"] = custom_ok
    if not custom_ok:
        say("FAILED custom values did not stick before restart")
        (EVID / "results.json").write_text(json.dumps(results, indent=2))
        return 2

    adb("shell", "am", "force-stop", "sh.paseo.debug")
    say("FORCE_STOP")
    time.sleep(1.5)
    launch()
    xml, nodes = wait_until(app_ready, 25, 2.0)
    save("05-relaunch", xml)
    shot("05-relaunch")
    results["storage_relaunch_early"] = read_storage("storage-relaunch-early")
    xml, nodes = open_settings(nodes)
    xml, nodes = open_appearance(nodes)
    xml, nodes = ensure_fonts_visible()
    save("06-fonts-relaunch", xml)
    shot("06-fonts-relaunch")
    ui_relaunch = {}
    for _key, desc, _value in FIELDS:
        node = field_node(nodes, desc)
        ui_relaunch[desc] = node["text"] if node else None
    results["ui_relaunch"] = ui_relaunch
    results["storage_relaunch"] = read_storage("storage-relaunch")
    say(f"RELAUNCH_UI {ui_relaunch}")
    kept = results["storage_relaunch"].get("fonts") or {}
    relaunch_ok = (
        ui_relaunch.get("Interface font size") == "17"
        and ui_relaunch.get("Content font size") == "18"
        and ui_relaunch.get("Code font size") == "19"
        and kept.get("uiBaseFontSize") == 17
        and kept.get("contentFontSize") == 18
        and kept.get("codeFontSize") == 19
    )
    results["relaunch_ok"] = relaunch_ok
    (EVID / "results.json").write_text(json.dumps(results, indent=2))
    if not relaunch_ok:
        say("FAILED custom values were not kept")
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
