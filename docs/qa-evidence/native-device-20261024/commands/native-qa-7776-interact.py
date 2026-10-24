#!/usr/bin/env python3
import json, re, sqlite3, subprocess, time
from pathlib import Path

ADB = "/Users/rrd/Library/Android/sdk/platform-tools/adb"
S = "emulator-5572"
EVID = Path("/tmp/native-qa-7776-evidence")
EVID.mkdir(parents=True, exist_ok=True)
STATUS = Path("/tmp/native-qa-7776-up.status")
results = {}

def say(msg):
    line = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()) + " " + msg
    print(line, flush=True)
    with STATUS.open("a") as f:
        f.write(line + "\n")

def adb(*args, timeout=30):
    return subprocess.run([ADB, "-s", S, *args], stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)

def shot(name):
    proc = subprocess.run([ADB, "-s", S, "exec-out", "screencap", "-p"], stdin=subprocess.DEVNULL, capture_output=True, timeout=20)
    path = EVID / f"{name}.png"
    path.write_bytes(proc.stdout)
    return path

def dump():
    adb("shell", "uiautomator", "dump", "/sdcard/native-qa-ui.xml", timeout=20)
    proc = adb("shell", "cat", "/sdcard/native-qa-ui.xml", timeout=20)
    xml = proc.stdout.decode("utf-8", "replace")
    (EVID / "last.xml").write_text(xml)
    return xml

def nodes(xml):
    found = []
    for m in re.finditer(r'resource-id="([^"]*)"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"', xml):
        found.append((m.group(1), tuple(map(int, m.group(2, 3, 4, 5)))))
    return found

def find(xml, needle):
    hits = [(rid, b) for rid, b in nodes(xml) if needle in rid]
    return hits

def center(bounds):
    x1, y1, x2, y2 = bounds
    return (x1 + x2) // 2, (y1 + y2) // 2

def storage():
    raw = subprocess.run([ADB, "-s", S, "exec-out", "run-as", "sh.paseo.debug", "cat", "databases/RKStorage"], stdin=subprocess.DEVNULL, capture_output=True, timeout=20).stdout
    path = EVID / "RKStorage"
    path.write_bytes(raw)
    con = sqlite3.connect(str(path))
    row = con.execute("select value from catalystLocalStorage where key='panel-state'").fetchone()
    con.close()
    if not row:
        return None
    data = json.loads(row[0])
    return data["state"]["sidebarWidth"]

def swipe(x1, y1, x2, y2, ms=700):
    adb("shell", "input", "swipe", str(x1), str(y1), str(x2), str(y2), str(ms))

def tap(x, y):
    adb("shell", "input", "tap", str(x), str(y))

def wait_id(needle, tries=8):
    for _ in range(tries):
        xml = dump()
        hits = find(xml, needle)
        if hits:
            return xml, hits
        time.sleep(1)
    return dump(), []

say("INTERACT_BEGIN")
# Prove only our serial is commanded. Record identities.
head = subprocess.check_output(["git", "-C", "/Users/rrd/workspace/rrd/paseo/.worktrees/pr-parallel-20261024-native-qa-7776", "rev-parse", "HEAD"], text=True).strip()
results["head"] = head
apk = Path("/Users/rrd/workspace/rrd/paseo/.worktrees/pr-7776-android-pad/packages/app/android/app/build/outputs/apk/debug/app-debug.apk")
if apk.exists():
    import hashlib
    h = hashlib.sha256()
    with apk.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    results["apk_sha256"] = h.hexdigest()
results["bundle_virtual_sha256"] = "52f7acede67ce38713150e91866bd530681be44b64592118cbfedeee1462c4a4"
results["width_before"] = storage()
say(f"WIDTH_BEFORE {results['width_before']}")
xml = dump()
main = find(xml, "left-sidebar-resize-handle")
grip = [h for h in main if h[0].endswith("-grip")]
handle = [h for h in main if h[0] == "left-sidebar-resize-handle"]
results["handle_before"] = handle[0][1] if handle else None
results["grip_before"] = grip[0][1] if grip else None
shot("01-before-drag")
say(f"HANDLE_BEFORE {results['handle_before']} GRIP {results['grip_before']}")

if not handle:
    say("FAILED no handle at start")
    (EVID / "results.json").write_text(json.dumps(results, indent=2))
    raise SystemExit(2)

# Screenrecord the drag, then swipe right from the grip center.
hx, hy = center(grip[0][1] if grip else handle[0][1])
rec = subprocess.Popen([ADB, "-s", S, "shell", "screenrecord", "--time-limit", "8", "/sdcard/native-qa-drag.mp4"], stdin=subprocess.DEVNULL)
time.sleep(1.2)
swipe(hx, hy, hx + 220, hy, 900)
time.sleep(1.5)
shot("02-after-main-drag")
xml = dump()
handle2 = [h for h in find(xml, "left-sidebar-resize-handle") if h[0] == "left-sidebar-resize-handle"]
results["handle_after_main_drag"] = handle2[0][1] if handle2 else None
results["width_after_main_drag"] = storage()
say(f"WIDTH_AFTER_MAIN {results['width_after_main_drag']} HANDLE {results['handle_after_main_drag']}")
rec.wait(timeout=15)
pull = subprocess.run([ADB, "-s", S, "pull", "/sdcard/native-qa-drag.mp4", str(EVID / "main-drag.mp4")], stdin=subprocess.DEVNULL, capture_output=True, text=True)
adb("shell", "rm", "-f", "/sdcard/native-qa-drag.mp4")
results["drag_video_bytes"] = (EVID / "main-drag.mp4").stat().st_size if (EVID / "main-drag.mp4").exists() else 0
say(f"DRAG_VIDEO {results['drag_video_bytes']} {pull.stdout.strip()} {pull.stderr.strip()}")

# Open settings.
settings = [h for h in find(xml, "sidebar-settings") if h[0] == "sidebar-settings"]
if not settings:
    xml = dump()
    settings = [h for h in find(xml, "sidebar-settings") if h[0] == "sidebar-settings"]
if settings:
    sx, sy = center(settings[0][1])
    tap(sx, sy)
else:
    say("FAILED no settings button")
xml, hits = wait_id("settings-sidebar-resize-handle", 10)
set_handle = [h for h in hits if h[0] == "settings-sidebar-resize-handle"]
set_side = [h for h in find(xml, "settings-sidebar") if h[0] == "settings-sidebar"]
results["settings_handle"] = set_handle[0][1] if set_handle else None
results["settings_sidebar"] = set_side[0][1] if set_side else None
results["width_in_settings"] = storage()
shot("03-settings")
say(f"SETTINGS handle={results['settings_handle']} sidebar={results['settings_sidebar']} width={results['width_in_settings']}")

if set_handle:
    gx = [h for h in hits if h[0].endswith("-grip")]
    cx, cy = center(gx[0][1] if gx else set_handle[0][1])
    swipe(cx, cy, cx - 180, cy, 900)
    time.sleep(1.2)
    xml, hits = wait_id("settings-sidebar-resize-handle", 4)
    set_handle2 = [h for h in hits if h[0] == "settings-sidebar-resize-handle"]
    results["settings_handle_after"] = set_handle2[0][1] if set_handle2 else None
    results["width_after_settings_drag"] = storage()
    shot("04-settings-dragged")
    say(f"SETTINGS_DRAG {results['width_after_settings_drag']} {results['settings_handle_after']}")
    back = [h for h in find(xml, "settings-back-to-workspace") if "settings-back-to-workspace" in h[0]]
    if back:
        bx, by = center(back[0][1])
        tap(bx, by)
    else:
        adb("shell", "input", "keyevent", "4")
    xml, hits = wait_id("left-sidebar-resize-handle", 8)
    main3 = [h for h in hits if h[0] == "left-sidebar-resize-handle"]
    results["handle_back_on_main"] = main3[0][1] if main3 else None
    results["width_back_on_main"] = storage()
    shot("05-back-on-main")
    say(f"BACK_MAIN {results['width_back_on_main']} {results['handle_back_on_main']}")

# Restart the dev client. Width must survive process death.
saved = results.get("width_back_on_main") or results.get("width_after_settings_drag")
adb("shell", "am", "force-stop", "sh.paseo.debug")
time.sleep(1)
adb("shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", "exp+voice-mobile://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A19081", "sh.paseo.debug")
xml, hits = wait_id("left-sidebar-resize-handle", 15)
main4 = [h for h in hits if h[0] == "left-sidebar-resize-handle"]
results["width_after_restart"] = storage()
results["handle_after_restart"] = main4[0][1] if main4 else None
shot("06-after-restart")
say(f"RESTART {results['width_after_restart']} {results['handle_after_restart']} saved={saved}")

# Light/dark. adaptiveThemes follows the system night mode.
adb("shell", "cmd", "uimode", "night", "yes")
time.sleep(1.5)
xml, hits = wait_id("left-sidebar-resize-handle", 6)
results["handle_dark"] = ([h[1] for h in hits if h[0] == "left-sidebar-resize-handle"] or [None])[0]
shot("07-dark")
adb("shell", "cmd", "uimode", "night", "no")
time.sleep(1.5)
xml, hits = wait_id("left-sidebar-resize-handle", 6)
results["handle_light"] = ([h[1] for h in hits if h[0] == "left-sidebar-resize-handle"] or [None])[0]
shot("08-light")
say(f"THEME dark={results['handle_dark']} light={results['handle_light']}")

# 600dp width: 1200px at 320dpi. Open settings first so the detail pane exists.
settings = [h for h in find(dump(), "sidebar-settings") if h[0] == "sidebar-settings"]
if settings:
    tap(*center(settings[0][1]))
    wait_id("settings-sidebar", 8)
adb("shell", "wm", "size", "1200x1600")
time.sleep(2)
xml = dump()
results["at_600dp"] = {
    "settings_sidebar": ([h[1] for h in find(xml, "settings-sidebar") if h[0] == "settings-sidebar"] or [None])[0],
    "settings_handle": ([h[1] for h in find(xml, "settings-sidebar-resize-handle") if h[0] == "settings-sidebar-resize-handle"] or [None])[0],
    "detail": ([h[1] for h in find(xml, "settings-detail-pane") if "settings-detail" in h[0]] or [None])[0],
    "main_handle": ([h[1] for h in find(xml, "left-sidebar-resize-handle") if h[0] == "left-sidebar-resize-handle"] or [None])[0],
    "width": storage(),
}
shot("09-600dp")
say(f"DP600 {results['at_600dp']}")

# Compact: 550dp wide (1100px). Handle should leave.
adb("shell", "wm", "size", "1100x1600")
time.sleep(2)
xml = dump()
results["compact"] = {
    "main_handle": ([h[1] for h in find(xml, "left-sidebar-resize-handle") if h[0] == "left-sidebar-resize-handle"] or [None])[0],
    "settings_handle": ([h[1] for h in find(xml, "settings-sidebar-resize-handle") if h[0] == "settings-sidebar-resize-handle"] or [None])[0],
    "width": storage(),
}
shot("10-compact")
say(f"COMPACT {results['compact']}")

adb("shell", "wm", "size", "reset")
adb("shell", "cmd", "uimode", "night", "no")
time.sleep(2)
xml, hits = wait_id("left-sidebar-resize-handle", 8)
if not hits:
    # Settings may still be up; back out.
    adb("shell", "input", "keyevent", "4")
    time.sleep(1)
    xml, hits = wait_id("left-sidebar-resize-handle", 6)
results["restored"] = {
    "main_handle": ([h[1] for h in hits if h[0] == "left-sidebar-resize-handle"] or [None])[0],
    "width": storage(),
}
shot("11-restored")
say(f"RESTORED {results['restored']}")
wm = adb("shell", "wm", "size").stdout.decode()
results["wm_size_end"] = wm.strip()
(EVID / "results.json").write_text(json.dumps(results, indent=2))
say("INTERACT_DONE")
