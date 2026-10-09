# iOS 12 legacy Web UI

`npm run build:legacy-web-ui` 产出一份能在 Safari 12（停在 iOS 12 的 iPad / iPhone，例如 iPad mini 2）上运行的 Web UI，放在 `packages/app/dist-legacy`。它只存在于 `luoph/paseo` fork，跟随官方更新见 [fork-sync.md](fork-sync.md)。测试机部署脚本在 ideashell-deploy 仓库的 `script/shell/deploy-paseo-web.sh`。

## 兼容层分三层

| 层         | 位置                               | 负责                                                                               |
| ---------- | ---------------------------------- | ---------------------------------------------------------------------------------- |
| 语法       | `scripts/build-legacy-web-ui.mjs`  | Babel 降级、正则后行断言与 BigInt 改为运行时 helper、按 ES2019 校验                |
| 运行时 API | `scripts/legacy-web/shims.js`      | core-js 之外缺的 API：`element.animate`、`ResizeObserver`、`screen.orientation` 等 |
| CSS        | `scripts/legacy-web/css-compat.js` | 样式表与内联样式里的逻辑属性、`:is()`、`prefers-color-scheme`、flex `gap`          |

每个 shim 旁边的注释写了它为什么存在、在哪台设备上踩到的。新增 shim 前先确认调用处没有存在性判断：有判断的会自己降级，不用补。

CSS 有两条路径，都要覆盖。Unistyles 和 react-native-web 写样式表；app 代码和库会直接写内联样式（例如 `overlay-root.ts` 的 `el.style.inset = "0"`），这条路径不经过样式表改写，漏掉时整层弹窗会落到屏幕外。

flex `gap` 用子元素 margin 近似：子元素自己在同一侧设了 margin 时两者不会叠加，间距会比新浏览器小；react-native-web 用内联 `display: contents` 包装的子元素，margin 落在它的第一个子元素上。

这个构建也会被新浏览器加载（daemon 的 `app.baseUrl` 指向它时，扫码打开的都是它）。每条兼容都要先探测特性缺失再生效，改动后在新浏览器里也截图对比。

## 真机调试

Safari 12 能被 Mac 远程调试，不需要拍照看屏幕上的错误面板。

1. iPad：设置 → Safari → 高级 → 打开"Web 检查器"；接线并信任电脑；调试期间把"自动锁定"设为永不，锁屏会断开检查器。
2. Mac：`brew install ios-webkit-debug-proxy`，然后

   ```bash
   idevice_id -l                                   # 拿到 UDID
   ios_webkit_debug_proxy -c <UDID>:9222 --no-frontend
   curl -s http://127.0.0.1:9222/json              # 列出可调试的页面
   ```

3. 用页面的 `webSocketDebuggerUrl` 发 WebKit 检查器协议命令（`Runtime.evaluate`、`Page.snapshotRect` 截图、`Console.enable` 读日志）。

协议上的坑：

- iOS 12.2 起命令要包在 `Target.sendMessageToTarget` 里，连接后先等 `Target.targetCreated` 拿到 targetId。
- 页面跳转会换 target，发给旧 target 的命令永远不返回。跳转后重新连接，所有命令都加超时。
- `Timeline` 记录的时间戳全是 0，用不了；改用 `ScriptProfiler` 采样，或在页面里自己计时。页面进程死掉时，`ScriptProfiler` 的结果拿不回来。
- 主线程被长任务占满时，`Runtime.evaluate` 不返回，`Debugger.pause` 也打断不了原生代码（样式、布局）。
- `Memory.startTracking` 能按 JavaScript / 页面 / 图层分类看内存，但开久了 iPad 上的 `webinspectord` 自己会因内存超限被杀，随后可能出现莫名的页面恢复。只短时间用。
- iPad 用 USB 充电时会发热降频，连续测几个小时后数据会慢好几倍。对比性能时两组交替测，不要和几小时前的数据比。

## 页面崩溃与"旧版本页面"

Safari 显示"……重复出现问题"，说明页面进程被系统杀了。用 `idevicecrashreport -u <UDID> -k -f JetsamEvent <目录>` 拉日志：`com.apple.WebKit.WebContent` 的 `reason` 为 `highwater` 是内存超限，iPad mini 2 的上限约 840 MB。拉取时带 `-k`，不删设备上的日志。进程被杀后 Safari 会自己打开同一个地址，所以一条超长会话会看起来像"加载报错然后不停刷新"。Safari 12 只挂载对话尾部，并且每条助手消息只解析末尾 12 000 字、代码高亮不超过 4 000 字、不加载 Mermaid iframe。

崩溃或某些导航后，Safari 会从后退缓存恢复标签页历史里更早的页面，可能是几个版本之前的构建，它引用的文件已被部署脚本清理，于是报 `[load error]`。覆盖层对同一个 `/_expo/static/` 地址只强制刷新一次，拉当前的 `index.html`；同一个地址再失败就停在错误面板上，不再转圈。排查前先确认 `performance.navigation.type`（2 表示后退/前进恢复）和页面加载的 `legacy-polyfills-*.js` 是不是线上版本。

崩溃后调试器连不上，需要的数据先写进 `localStorage`，页面恢复后再读。

## 带主机连接的测试

连上 daemon 后才会出现的问题（侧边栏状态环、实时更新）在欢迎页测不出来。测试可能崩溃的改动时：

- 配对链接用 `paseo daemon pair --json` 在本机生成，校验格式后再用，不从剪贴板拿。
- 先拦截 `localStorage` 对 `@paseo:daemon-registry` 的写入再确认配对。主机不落盘，崩溃后页面恢复时不会自动重连、反复崩溃，也不用去清网站数据。
- relay 链接配对不会在 daemon 上留下设备记录，测试用的无头浏览器关闭后无需清理。
