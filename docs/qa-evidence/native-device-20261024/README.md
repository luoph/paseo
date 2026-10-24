# Mac Studio native QA evidence, 2026-10-24

Host is the Mac Studio. Device is AVD `paseo-pr7776-pad`, serial `emulator-5572`, 2560x1600 at 320 dpi unless a section says the size changed, night mode off. These runs were not repeated for publication.

7776, 7539, and 7467 reused one debug APK: `sh.paseo.debug`, versionName `0.13.0`, versionCode `13000`, arm64-v8a, sha256 `cb1ad96f72502ab457bfb2a399b4c20df1a108a19f31a665f6a458ab174a78eb`, built from source `0eb6c2dfec82d48a7919e578452f9303e236f098`. That binary was not built from those PR heads. Native-input manifests record why it was reused. JS came from each head's Metro bundle.

7153 did not reuse that APK. Its arm64 debug APK sha256 is `ddc29ab9fea9080fcd266d1143d0d452f8eb86f5e0fd59d07a8ceab3998f96a0`, package `sh.paseo.debug`, versionName `0.13.0`, versionCode `13000`, built from head `deb15d5b9f9cbcb30a500981a23aa09a57a411ec`. `classes2.dex` contains `startWindowLayoutListener`. The device run is a simulated `wm size` resize. It is not a hardware-fold pass.

No daemon keypair, auth token, or private user directory is in this tree. The agent ids and server id in the 7539 result are fixture records created in an isolated temporary daemon home for this run.

## 7776 `325fd53cdfd57aa0c255fe61d62bd7c32be803af`

Branch `fix/tablet-sidebar-width-affordance`. Virtual Metro bundle sha256 `52f7acede67ce38713150e91866bd530681be44b64592118cbfedeee1462c4a4`. The bundle identifies worktree `pr-parallel-20261024-native-qa-7776`.

`7776-325fd53/results.json` is the storage readback of `panel-state.sidebarWidth` from device `RKStorage`, plus handle bounds. The passing width after restart is `440.67919921875`. `main-drag.mp4` is the real touch drag. Screenshots `01` through `11` are before drag, after main drag, settings, settings drag, back on main, after restart, dark, light, 600 dp, compact, and restored.

## 7539 `9cb99aca728a8192938fb17b70a510dc9644a182`

Branch `fix/pad-active-tab-title`. Virtual Metro bundle sha256 `7cad3ecfddeb2e0b218bb1d4d69bda780fbafc5181103a8bb15ccc5bf940af67`, 51895576 bytes. The bundle contains worktree `pr-parallel-20261024-native-qa-7539`.

`7539-9cb99aca/results.json` is the accessibility readback. On the 2560x1600 root, selecting each of the four tabs makes that tab 240 dp and `selected=true`, and the other three 160 dp. `longpress.mp4` is the real long-press. Portrait is judged by the root bounds `[0,0][1600,2560]`, not by the `wm size` line, which still printed 2560x1600. The long-press menu text is the full fixture title.

## 7467 `da5cd4ac52f48d36977c2788358b664ed04c872e`

Branch `fix/android-default-font-size-13`. Virtual Metro bundle sha256 `e48bde1e1ae7fea522f87bc4f3d4b38ffa579390396885d01b5a41b2e001de3f`. The bundle identifies worktree `pr-parallel-20261024-native-qa-7467` and contains the three `Platform.OS === "android" ? 13` defaults for interface, content, and code font size.

`7467-da5cd4ac/results.json` is the UI and SQLite readback. After `pm clear`, the stored and visible interface, content, and code sizes were 13. They were then set to 17, 18, and 19. After force-stop and reopen they were still 17, 18, and 19. `settings-*.json` are the `@paseo:app-settings` objects. The raw `RKStorage` databases are not included.

## 7153 `deb15d5b9f9cbcb30a500981a23aa09a57a411ec`

Branch `fix/android-pad-layout`. The new APK file and the installed `base.apk` both hash to `ddc29ab9fea9080fcd266d1143d0d452f8eb86f5e0fd59d07a8ceab3998f96a0`. Virtual Metro bundle sha256 `58676e65db707e1d27cb273d1c33c258a5d0da330ffc8b79a8cdab52cb2143c4`, 51895254 bytes. The bundle identifies worktree `pr-parallel-20261024-native-qa-7153`, with `requestedExplorerSidebarWidth` and `compact-shell` present. `readback/listener-readback.txt` is the `startWindowLayoutListener` function from the patched `NativePlatform+android.kt` after `npm ci`. `readback/apk-proof.txt` is the zip search that found that symbol in `classes2.dex`.

Breakpoint is 600 dp. Agreement means the root width in dp is at least 600 exactly when `wide-shell` is present and `compact-shell` is absent.

Foreground, density 320: root 2560x1600 is 1280 dp with `wide-shell` and `left-sidebar-resize-handle`; root 1100x1600 is 550 dp with `compact-shell`; restoring 2560x1600 returns `wide-shell` and the handle.

Background: Home moved focus to the launcher. `wm size` changed while the activity was paused. Resume used `am start -n sh.paseo.debug/.MainActivity`, which brought the existing task forward. 1100x1600 came back as `compact-shell`. Restoring 2560x1600 while paused came back as `wide-shell` with the handle.

`user_rotation` 0 and 1 did not change the root. Both reads were 825x1100 (412.5 dp) after `wm size` 1400x1100, with `compact-shell`. That is not a rotation pass. A later `wm size` 1100x1400 produced root 1100x1400 (550 dp) and `compact-shell`. That is a simulated dimension swap. There is no hinge result.

After the sequence, `@paseo:app-settings` was still interface 15, content 16, code 12, and `panel-state.sidebarWidth` was still 320. Those are the values this head wrote after a fresh clear. They are not the 7467 Android defaults of 13.

## Commands and manifests

`commands/` holds the scripts that produced these artifacts. `native-inputs/` holds the blob and lock comparison against APK source `0eb6c2dfec82d48a7919e578452f9303e236f098`. The 7776 and 7539 manifests were regenerated on the Mac Studio at 2026-10-24T13:59Z. The 7467 and 7153 manifests are from that same comparison. `SHA256SUMS` covers the other files in this directory.
