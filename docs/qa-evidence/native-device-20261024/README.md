# Mac Studio native QA evidence, 2026-10-24

Host is the Mac Studio. Device is AVD `paseo-pr7776-pad`, serial `emulator-5572`, 2560x1600, 320 dpi, night mode off. These runs were not repeated for publication.

The installed debug APK is `sh.paseo.debug`, versionName `0.13.0`, versionCode `13000`, arm64-v8a. Its sha256 is `cb1ad96f72502ab457bfb2a399b4c20df1a108a19f31a665f6a458ab174a78eb`. It was built from source `0eb6c2dfec82d48a7919e578452f9303e236f098`. It is not a binary built from either PR head below. Native-input manifests record why that binary was reused. JS came from each head's Metro bundle.

No daemon keypair, auth token, or private user directory is in this tree. The agent ids and server id in the 7539 result are fixture records created in an isolated temporary daemon home for this run.

## 7776 `325fd53cdfd57aa0c255fe61d62bd7c32be803af`

Branch `fix/tablet-sidebar-width-affordance`. Virtual Metro bundle sha256 `52f7acede67ce38713150e91866bd530681be44b64592118cbfedeee1462c4a4`. The bundle identifies worktree `pr-parallel-20261024-native-qa-7776`.

`7776-325fd53/results.json` is the storage readback of `panel-state.sidebarWidth` from device `RKStorage`, plus handle bounds. The passing width after restart is `440.67919921875`. `main-drag.mp4` is the real touch drag. Screenshots `01` through `11` are before drag, after main drag, settings, settings drag, back on main, after restart, dark, light, 600 dp, compact, and restored.

## 7539 `9cb99aca728a8192938fb17b70a510dc9644a182`

Branch `fix/pad-active-tab-title`. Virtual Metro bundle sha256 `7cad3ecfddeb2e0b218bb1d4d69bda780fbafc5181103a8bb15ccc5bf940af67`, 51895576 bytes. The bundle contains worktree `pr-parallel-20261024-native-qa-7539`.

`7539-9cb99aca/results.json` is the accessibility readback. On the 2560x1600 root, selecting each of the four tabs makes that tab 240 dp and `selected=true`, and the other three 160 dp. `longpress.mp4` is the real long-press. Portrait is judged by the root bounds `[0,0][1600,2560]`, not by the `wm size` line, which still printed 2560x1600. The long-press menu text is the full fixture title.

## Commands and manifests

`commands/` holds the scripts that produced these artifacts. `native-inputs/` holds the blob and lock comparison against APK source `0eb6c2dfec82d48a7919e578452f9303e236f098`, regenerated on the Mac Studio at 2026-10-24T13:59Z from the fetched GitHub heads. `SHA256SUMS` covers the other files in this directory.
