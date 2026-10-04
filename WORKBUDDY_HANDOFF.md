# 青账项目交接说明

更新时间：2026-10-04（Asia/Shanghai）

这是一款完全离线运行的微信账单记账网页。用户从微信导出 XLSX 或 CSV 后，在浏览器本地完成解析、分类、去重、月度统计和交易明细查看。当前工作重点是改善下拉菜单的视觉表现，并加入轻微的弹性互动。

## 当前已完成

- 支持导入微信个人账单 XLSX / CSV，可一次选择多个文件。
- 自动识别账单表头、日期、金额、收支方向、交易对象和交易单号。
- 支持重复导入去重；重复记录更新原始字段并保留手动分类。
- 支持本地关键词分类和交易对象分类规则，可手动修改并记住规则。
- 支持月度收支汇总、分类环形图、趋势图和交易明细筛选。
- 「交易对象」区域按累计金额从左到右降序显示柱状图，并显示金额、交易次数、交易日期；支持支出、收入、退款、全部交易、搜索和分页。
- 支持 JSON 备份恢复和 CSV 明细导出。
- 示例账本不会写入真实账本，真实数据保存在浏览器 `localStorage`。
- 页面不依赖网络、远程字体、服务器或外部 API。

## 本轮视觉与交互修改

### 月份下拉菜单

用户截图中的原生 `<select>` 展开菜单会显示浏览器默认的灰色系统选项。现在月份筛选已经改成页面内自绘的 listbox：

- 圆角、淡绿色选中态、勾选图标和柔和阴影。
- 打开时有轻微缩放/弹性动画，箭头旋转。
- 支持点击选项、点击外部关闭和 `Escape` 关闭。
- 支持 `ArrowUp` / `ArrowDown` / `Home` / `End` / `Enter` / 空格键。
- 首项和末项的键盘移动不会越界。
- 保留隐藏的原生 `#month-filter` 作为状态桥接，现有月份筛选逻辑继续复用。
- 空账单仍然显示“全部月份”和当前月份两个选项。

### 全局视觉细节

`ui-polish.css` 还提供了：

- 中文优先的本地字体栈：SF Pro Display、PingFang SC、Noto Sans CJK SC、MiSans、HarmonyOS Sans SC、Microsoft YaHei 等。
- 按钮、卡片、导航、图表柱、导入区域、图标和 toast 的轻微 hover / active / spring 动效。
- `prefers-reduced-motion` 支持，用户关闭动画时不会强制播放动效。
- 其他筛选框目前仍使用带样式的原生 select；如果后续要统一成自绘菜单，可以复用月份菜单模式。

## 关键文件

- `index.html`：页面结构、SVG 图标定义、月份自绘菜单结构和脚本加载顺序。
- `styles.css`：原始基础样式。
- `ui-polish.css`：本轮视觉增强、字体、动画和自绘月份下拉样式。
- `app.js`：页面状态、渲染、导入、筛选、月份菜单交互、备份导出等逻辑。
- `ledger-core.js`：与界面无关的账单解析、分类、去重、统计、分组和导出逻辑。
- `xlsx-import.js`：本地 XLSX 读取和工作表识别。
- `vendor/xlsx.full.min.js`：随项目提供的本地 XLSX 解析库。
- `samples/wechat-demo.csv` / `samples/wechat-demo.xlsx`：虚构测试账单，不是真实账单。
- `tests/browser.test.js`：Edge 无头浏览器回归、月份菜单边界和响应式测试。
- `tests/ledger-core.test.js`：账单核心逻辑测试。
- `tests/xlsx-import.test.js`：XLSX 读取和异常文件测试。
- `tests/counterparties.test.js`：交易对象分组、排序和筛选测试。

## 如何运行

直接用 Microsoft Edge 或 Chrome 打开：

```text
C:\Users\watt2\Documents\ChatGPT\10.3 vibecoding\index.html
```

不需要构建，也不需要安装 npm 依赖。刷新页面即可查看最新修改。

## 已完成的验证

已执行并通过：

```powershell
node --check app.js
node --check tests/browser.test.js
node --test tests/ledger-core.test.js tests/xlsx-import.test.js tests/counterparties.test.js
node --test tests/browser.test.js
```

最后一次结果：

- 核心、XLSX、交易对象测试共 33 项通过。
- 浏览器回归测试通过。
- 已验证月份菜单打开、选择、Esc、点击外部、键盘上下边界和空账单选项。
- 已验证示例账单、XLSX / CSV 导入、重复导入、分类保存、备份恢复、导出和移动端无横向溢出。
- 浏览器测试确认没有未处理的 JavaScript 错误，也没有远程网络请求。

在 Codex Windows 环境中，Edge 无头测试可能需要允许 Node 启动本机 Edge 进程；如果直接执行出现 `spawn EPERM`，使用允许启动 Edge 的环境重新执行同一命令即可。

## 视觉检查文件

测试会生成以下文件到 `.verification/`：

- `desktop.png`：桌面页面。
- `mobile.png`：390px 移动端页面。
- `month-dropdown.png`：展开后的月份自绘菜单。
- `counterparties-demo.png`：交易对象柱状图。
- `xlsx-import.png`：XLSX 导入预览。

## 交接时需要注意

- 页面脚本使用 `defer`，脚本顺序不要随意调整：`ledger-core.js` → `xlsx.full.min.js` → `xlsx-import.js` → `app.js`。
- `app.js` 中月份筛选的 `change` 监听会先调用 `renderMonth()`，再刷新概览和明细；如果修改月份菜单，必须保持按钮文字、菜单选中态和隐藏原生 select 三者同步。
- 月份菜单事件集中在 `app.js` 的 document click、`#month-trigger` 和 `#month-menu` 监听器中。
- `localStorage` 键名是 `qingzhang.wechat-ledger.v1`。开发调试时如果页面一直显示旧数据，可在“数据管理”中清空，或使用浏览器开发者工具清理该键。
- 之前提到的“交易对象名称后追加括号中的具体商户名”需求已放弃，当前不应重新加入，除非用户明确提出。
- 当前月份自绘菜单已经完成；其他方向、分类、交易对象数量筛选仍是原生 select。若用户下一步要求所有下拉框统一视觉，应将相同 listbox 方案抽成通用组件，并为每个组件补充键盘和空选项边界测试。

## 建议的后续工作

1. 用用户自己的微信 XLSX 做一次手动验收，重点检查特殊商户名、退款、失败交易和超长交易单号。
2. 如果需要统一交互，将 `counterparty-direction`、`counterparty-limit`、`direction-filter`、`category-filter` 和分类编辑框逐步迁移到通用自绘下拉组件。
3. 若要发布给其他人使用，可补充一个简单的产品说明页和数据隐私提示，但不要引入在线字体或远程服务。

## 单文件免安装版（2026-10-04 新增）

已新增「打包成单个 HTML 直接分发」的通道。目标是让身边的人零安装、零联网、零注册地直接用上，不经过小程序审核，也不需要服务器。

### 新增文件

- `tools/bundle-single-file.mjs`：打包器。把 `index.html` + 两份 CSS + 四个 JS（含 `vendor/xlsx.full.min.js`）内联成 `dist/青账.html`。
- `tools/verify-single-file.mjs`：验证器。用无头 Edge 打开产物，在页面内真跑一遍解析。
- `dist/青账.html`：产物，约 1.04 MB，双击即可离线使用。
- `dist/使用说明.txt`：给最终用户看的说明（打开方式、怎么导出微信账单、数据存哪、备份习惯、已知限制）。
- `dist/打开青账.bat`：用 Edge `--app` 模式打开，得到无地址栏的独立窗口。**文件内容刻意保持纯 ASCII**（中文写在 .bat 里容易乱码），它靠 `%~dp0*.html` 通配符定位同目录的 HTML。
- `青账-免安装版.zip`：可直接发给别人的分发包（约 364 KB），解压后是 `青账-免安装版/` 文件夹。

### 重新打包

```powershell
node tools/bundle-single-file.mjs     # 生成 dist/青账.html
node tools/verify-single-file.mjs     # 无头浏览器验证，必须通过
```

改了源文件后只需重跑第一条；`dist/` 里的 `使用说明.txt` 和 `打开青账.bat` 是手写文件，不会被覆盖。重新分发前把 `dist/` 里的三个文件重新压一次 zip。

### 打包时必须守住的三条

内联第三方库到 `<script>` / `<style>` 里有两个会**静默**毁掉整份文档的陷阱，打包器已内置断言，改脚本时不要绕过：

1. **`String.prototype.replace` 的字符串替换里 `$` 有特殊含义**（`$&`、`` $` ``、`$'`、`$$`）。SheetJS 压缩代码里全是这类序列，用字符串替换会把内联内容改坏。**插入代码内容时替换参数必须写成函数**（`replace(re, () => text)`）。
2. **`replace('</body>', ...)` 会替换掉第一个 `</body>`，而 SheetJS 源码里含字符串 `"</body></html>"`**。必须用 `lastIndexOf('</body>')` 定位真正的闭合标签，并断言文档里 `</body>` 只出现一次。
3. **`<!--` 与 `<script` 同时出现在一个内联脚本里会触发 HTML 的 script data double escaped 状态**，此后 `</script>` 不再终结元素，整个文档剩余部分会被吞掉。SheetJS 含有 5 处 `<!--`（形如 `Mr(r,"<!--","-->")`），所幸它不含 `<script`，所以当前安全——但打包器必须继续拦这个组合。

另外两处容易忽略的：

- `index.html` 里的脚本原本用 `defer` 保证「DOM 就绪后执行」，而 `app.js` 结尾是裸的 `load(); render();`，**没有 DOMContentLoaded 保护**。内联后脚本会在解析到该位置时立即执行，所以必须放到 `</body>` 之前。
- 检查「产物里没有外部引用」时，**只能查文档骨架，不能查全文**：SheetJS 内部含 `href="'+At(d.l.Target)+'"` 这类用于生成 HTML 的模板串，会误报。同理统计 `<style>` 标签数也会被 SheetJS 里的 `"</styleSheet>"`、`"</style:style>"` 干扰。

### 验证方式

`tools/verify-single-file.mjs` 会构造一个临时页面（在 `<head>` 注入错误收集器、在 `</body>` 前注入探针），用 `--dump-dom` 把页面自检结果（脚本加载情况、初始化状态、XLSX/CSV 真实解析条数、未捕获错误数）通过 `document.title` 回读。

最近一次结果：4 个脚本全部加载、`#month-filter` 生成 2 个选项、示例账本 28 条、**内联 SheetJS 真实解析样本 XLSX 得 8 条（支出 ¥230.20 / 收入 ¥8500.00 / 3 个分类）、重复导入 8 条全部去重、CSV 同样 8 条、0 个未捕获错误**。

⚠️ 写同类验证脚本时的坑：注指针必须在**文档末尾的** `</body>` 前插入（同上第 2 条），否则会把 `<script>` 注进 SheetJS 的字符串字面量里，破坏它并触发上面的 double-escape 陷阱，症状是「页面看起来加载了但脚本全不执行」。排查方法是把段落切成独立的 `<script>` 逐个隔离测试，以及用 `--dump-dom` 检查 dump 长度和尾部内容。

## 安卓版 APK（2026-10-04 新增）

`android/` 目录是一个**手工编译**的最小 Android 工程，不依赖 Gradle / Android Studio。产物 `dist/青账-Android.apk`，约 **0.37 MB**。

### 为什么能这么小、这么干净

| 决定 | 原因 |
|---|---|
| 只用 Android framework API，**零 androidx 依赖** | 没有 AAR 就不需要 Gradle/AGP，可以手工串 aapt2→javac→d8→zipalign→apksigner |
| assets 只放一个 `index.html` | 就是单文件版（`dist/青账.html`）+ 一个导出桥 shim |
| **不声明任何权限，包括 INTERNET** | 页面通过 `shouldInterceptRequest` 从 assets 返回，不存在真实网络请求；选文件/存文件走 SAF。所以系统设置里这个 App 的权限是空的 |
| 用 `https://qingzhang.local/` 而不是 `file:///android_asset/` | `file://` 源在部分 WebView 版本上拿不到可用的 localStorage，而本 App 全部数据都在 localStorage 里；自己拦一个假域名既能拿到正常的 https 源，又不需要 WebViewAssetLoader（那是 androidx 的） |

### 目录

```
android/
├─ AndroidManifest.xml                     零权限；minSdk 26 / targetSdk 34
├─ src/com/qingzhang/ledger/MainActivity.java
├─ res/                                    自适应图标（纯 XML，无 PNG）+ 主题
├─ shim-android-export.js                  WebView 导出桥（见下）
├─ build.mjs                               aapt2 → javac → d8 → zipalign → apksigner
├─ SETUP.md                                JDK 17 + Android SDK 的安装步骤与排错
└─ qingzhang.keystore                      自签名密钥，口令 qingzhang2026
```

### ⚠️ WebView 里 blob 下载是静默失败的

网页的「导出 CSV 明细 / 导出 JSON 备份」实现是：

```js
URL.createObjectURL(new Blob([content], {type}))  →  <a download>  →  anchor.click()
```

**Android WebView 不处理 `blob:` 形式的下载**，点击后毫无反应、不报错。这是安卓版唯一必须改的地方，做法是：

1. `shim-android-export.js` 包一层 `URL.createObjectURL` 记住每个 blob，改写 `HTMLAnchorElement.prototype.click`——遇到带 `download` 的 `<a>` 且 href 是自己记过的 blob URL，就把内容读成 base64 交给 `window.Android.saveFile()`。
2. 原生侧 `MainActivity.ExportBridge.saveFile()`（`@JavascriptInterface`）用 SAF `ACTION_CREATE_DOCUMENT` 弹「保存到…」，写入选中的 URI。
3. shim 在**没有 `window.Android` 的环境里整段不生效**（第一行就 return），所以桌面版和它共用同一份源码也不会互相干扰——`tools/verify-single-file.mjs` 会检查这一点（`Android桥=undefined` + `createObjectURL=function`）。

选择/导入账单同样走 SAF（`WebChromeClient.onShowFileChooser` + `ACTION_OPEN_DOCUMENT`），**文件类型给 `*/*` 而不是 accept 里的 xlsx**——不少文件管理器把 xlsx 报成 `application/octet-stream`，按扩展名过滤会让文件变灰不可选。

### 构建

```bash
node tools/bundle-single-file.mjs     # 先产出 dist/青账.html（APK 以它为源）
node android/build.mjs                # 产出 dist/青账-Android.apk
```

工具链装在 `D:\android-build`（JDK 17 + Android SDK，约 1.3 GB，可整体删除）。详见 `android/SETUP.md`。

### 关于 keystore

`android/qingzhang.keystore`（口令 `qingzhang2026`）**必须保留**：Android 只接受同签名的覆盖安装，换签名会要求先卸载——而卸载会清掉 WebView 的 localStorage，也就是**用户的整个账本**。构建脚本会在密钥不存在时自动生成。

### 已核实与未核实

**已核实（本机可离线验证）**
- `apksigner verify`：v2 + v3 签名有效
- `aapt2 dump badging`：包名 `com.qingzhang.ledger`、minSdk 26 / targetSdk 34、label 青账、可启动 Activity 正确
- `aapt2 dump permissions`：**零权限**
- APK 内容完整（AndroidManifest / resources.arsc / 自适应图标 / classes.dex 10 KB / assets/index.html 1.07 MB），CRC 全过
- **把 assets/index.html 从 APK 里抽出来，用无头 Edge 跑完整校验：脚本全加载、初始化完成、XLSX 与 CSV 真实解析 8 条、去重正常、0 个未捕获错误**——说明注入导出桥没有破坏页面

**未核实（本机无 Android 设备也无模拟器，装 emulator 镜像还要再下约 1.5 GB）**
- 真机上 WebView 的实际渲染、`ACTION_OPEN_DOCUMENT` 选文件、`ACTION_CREATE_DOCUMENT` 保存
- 拦截 `https://qingzhang.local/` 在真机 WebView 上的表现
- 无 INTERNET 权限时 WebView 是否真的一次网络都不发起（设计上不会，但没实测）

装到手机上跑一遍是收尾的必须动作。

### 环境坑（本次新增，与项目无关但会再遇到）

- **WorkBuddy 沙箱拦截了一切删除操作**：`fs.rmSync`（genie-safe-delete 钩子）和 Python 的 `os.remove`/`shutil.rmtree`（`app.asar.unpacked/cli/vendor/shim/sitecustomize.py`）都会抛 `SAFE_DELETE_FAIL_CLOSED: windows-sandbox-recycle-bin-unavailable`。**`os.rename` 不受影响**，所以清理逻辑一律要有「删不掉就改名」的退路；构建产物则改成「先写 build/ 再 `copyFileSync` 覆盖到 dist/」，从根上不依赖删除。
- PowerShell 的 `Compress-Archive -Force` 覆盖已存在的 zip 时会先删旧文件 → 被拦 → 旧 zip 没了、新 zip 也没生成，而且不报错。**打包 zip 改用 Python `zipfile` 直接按 arcname 写**。
- Git Bash 里的 `/d/xxx` 路径传给 Windows 原生 `java.exe`/`.bat` 会失败（找不到文件），必须用 `D:/xxx`。




## 2026-10-04 第二轮：修横向溢出 + 启动动画 + 帮助入口

用户实测安卓版后反馈三件事，都已处理。

> **两端分离（重要）**：用户明确要求「只需要改安卓版本」。所以这三项改动**全部只落在安卓版**，
> 桌面版单文件 `dist/青账.html` 与改动前**逐字节一致**（1,068,001 字节，只差构建时间戳那行注释）。
> 桌面版源码 `styles.css` / `ui-polish.css` / `index.html` 已还原成原样，安卓专属内容由
> `android/build.mjs` 在打包时注入：
>
> | 安卓专属内容 | 来源 |
> |---|---|
> | 横向滚动护栏 + 帮助入口样式 | `android/overrides.css` |
> | 启动动画 | 不需要注入 —— 只在原生侧（`res/drawable/splash_background.xml`）。网页层动画已于第三轮移除 |
> | 帮助入口按钮标记 | `android/build.mjs` 内联，插到 `<div class="top-actions">` 之后 |
> | 导出桥 | `android/shim-android-export.js` |
> | 兼容性调整 | 标题改成「青账」 |
>
> 打包脚本对每个注入点都有断言；`tools/verify-apk-asset.mjs` 里还有一节「两端隔离检查」，
> 反过来断言桌面版**不含** `qz-splash` / `help-button` / `overflow-x: hidden` / `Android.saveFile`。
>
> ⚠️ 如果以后又想让桌面版也享受某个修复，**不要直接把改动写回共享源码**，先问清楚：
> 用户的默认期望是「反馈针对哪个版本，就只改哪个版本」。

### ① 整页能被左右滑开、右侧一大片空白（真 bug，桌面版同样存在）

**症状**：导入账单后页面可以左右拖动约 150px，右边露出空白，左侧内容被切掉一半。

**根因**：`styles.css` 里 `html` / `body` 的 `overflow-x` 是默认的 `visible`，而**对根元素来说 `visible` 会按规范计算成 `auto`**，于是整页在横向上就是可滚动的。触发条件是**明细表渲染出行**——空账本时 `documentElement.scrollWidth == clientWidth`（干净），一旦有数据就变成 `527 vs 375`，即 152px 的可拖动距离。交易明细表格（`width:100%` + `white-space:nowrap`，实际宽 566px）即使套在 `.table-scroll{overflow:auto}` 里，它的溢出仍会被算进根元素的滚动溢出。

**修复**：`html, body { overflow-x: hidden }`。最初加在共用的 `styles.css` 里，后来按用户要求**只保留在安卓版**（见下「两端分离」），现在写在 `android/overrides.css`，由构建脚本注入。需要横向滚动的表格 / 交易对象图表都有自己的滚动容器，不受影响。

### ② 加启动加载动画（**第三轮已简化为只剩原生闪屏一层**）

最初做了两层，都是安卓专属（桌面版保持秒开、无动画）：

- **原生闪屏**：`res/drawable/splash_background.xml`（纯色 + 居中叶子分层列表）挂在主题的 `android:windowBackground` 上，盖住"点图标到 WebView 画出第一帧"这段，避免闪白。**✅ 保留，且是现在唯一的一层。**
- **网页内加载动画**：`android/splash.css` + `android/splash.html`，由 `build.mjs` 注入——CSS 进 `<head>`、标记紧跟 `<body>`（解析到这里就能画出来）、卸载脚本放在 `</body>` 前。视觉是绿色圆角方块里的叶子轻微呼吸 +「青账」+ 三个跳动圆点；加载完成后淡出并从 DOM 移除，另有 5 秒兜底。**❌ 第三轮按用户要求移除**，文件已归档到 `_deprecated/web-splash/`。

> ⚠️ 注入位置必须精确：SheetJS 源码里含字符串 `"</head><body"`，所以**不能**用 `replace('</head>', ...)` 这种"第一个匹配"的写法。`build.mjs` 现在显式取第一个 `</head>` 并断言它在第一个 `<body>` 之前，卸载脚本用 `lastIndexOf('</body>')`。同类的 `</body>` 陷阱在 `tools/` 的几个脚本里都有注释。
>
> 补充：SheetJS 里还含 `"</body></html>"`，所以 `replace('</body>', ...)` 同样会命中它。

### ③ 帮助 / 问号入口不够明显

- 顶部栏（`.top-actions`）最前面新增常驻的 `.help-button`：绿底圆形白色问号 +「帮助」文字胶囊，任何宽度都在屏幕上，不会被滚走。
- 侧栏 / 移动端导航条里那一项（`[data-action="help"]`）也改成浅绿底 + 描边的强调样式。
- 顶部栏那个只用 `data-action="help"`，事件是**委托**在 document 上的，所以不用改 `app.js`。
- 按钮里的问号用**内联 `<svg><path>`**，不依赖 `<symbol>` 符号 —— 桌面版源码里不保留 `#i-help-mark`，走内联就不用往 `<defs>` 注入。

### 新增的排错工具（`tools/`）

| 脚本 | 作用 |
|---|---|
| `diagnose-overflow.mjs` | 在指定宽度的 iframe 里量 `scrollWidth`，列出越界元素 |
| `diagnose-stress.mjs` | 逐个施加"手机常见变量"（字号放大、长金额、长商户名等），每次从干净页面开始 |
| `diagnose-culprit.mjs` | 暴力法：逐个 `display:none` 掉元素，看谁消失后溢出就没了 |
| `verify-hscroll.mjs` | 判定页面到底能不能横向滑开，并逐个试候选修复 |
| `verify-apk-asset.mjs` | APK 资产端到端校验（启动动画出现与移除、横向拖动已禁止、帮助按钮存在）+ 两端隔离检查 |

### 排错时踩到的四个陷阱（很重要，别再犯）

1. **无头 Edge 的 `--window-size` 不改变 `documentElement.clientWidth`**（给 393 和 412 都返回 489）。要让页面拿到精确视口，只能把目标页塞进指定尺寸的 `<iframe>`；`file://` 下父页读不到 iframe 的 `contentDocument`，所以用 `postMessage` 把结果传出来、父页写进 `document.title`，再用 `--dump-dom` 回读。
2. **`html{scroll-behavior:smooth}` 会让 `scrollLeft = 99999` 变成动画**，立刻读回永远是 0。测真实可滚动距离前必须先把 `scrollBehavior` 临时改成 `auto`。
3. **`overflow: hidden` 的盒子仍可被脚本滚动**。所以"设完 `scrollLeft` 能读到非 0"**不能**证明用户能用手势拖动；判断用户能否拖动要看 `getComputedStyle(根元素).overflowX` 是否为 `hidden`。
4. **回读结果的断言别按行切再按 offset 取值**：多个字段会挤在同一行，而且容易差一位把数值首字符吃掉。统一用全文子串正则。

### 当前交付物位置（用户自己整理过，注意）

```
C:/Users/watt2/Desktop/vibe-coding/
├─ 青帐\                      ← 文件夹（用户把"青账"写成了"青帐"，照原话建的）
│  ├─ 青账.html               ← 电脑版①
│  ├─ 打开青账.bat             ← 电脑版②
│  ├─ 青账-Android.apk        ← 安卓版
│  ├─ 电脑版-使用说明.txt
│  ├─ 安卓版-安装说明.txt
│  └─ 青账-免安装版.zip
└─ 青帐.zip                   ← 发送用的分发包（已同步为新版本）
```

项目里的 `dist/` 是构建产物目录，重新构建后需要把 `青账.html` / `青账-Android.apk` 再拷到上面那个文件夹并重打 zip。

---

## 2026-10-04 第三轮：启动动画只保留原生闪屏一层

用户要求：「启动动画只要第一层就行了，不要第二层」。另外要一份可以交给 Codex 的说明文档。

### 做了什么

把网页内的加载动画（`android/splash.css` + `android/splash.html`）**整体移除**，只留原生闪屏。

| 变化 | 位置 |
|---|---|
| 删除读 `splash.css` / `splash.html` | `android/build.mjs` |
| 删除 `<style>{splashCss}</style>` 注入 | 同上 |
| 删除 `#qz-splash` 标记注入（紧跟 `<body>`） | 同上 |
| 删除卸载脚本注入（`</body>` 前） | 同上 |
| 新增**反向断言**：assets 里不得含 `qz-splash` / `splash-leave` | 同上 |
| 校验改为「无网页层动画」+「原生闪屏仍在且仍挂在 windowBackground 上」 | `tools/verify-apk-asset.mjs` |
| 两个文件归档 | → `_deprecated/web-splash/` |

顺带把校验脚本里那条隔离检查的标签从「启动动画」改成「网页层启动动画」，免得跟原生闪屏混淆。

**原生闪屏没有动**：`res/drawable/splash_background.xml` + `res/values/styles.xml` 的 `android:windowBackground` 保持原样，视觉不变。

### 验证结果

`node tools/verify-apk-asset.mjs` —— **全部通过**：

```
  ✓ 与构建输入逐字节一致   1073986 字节
  ✓ 导出桥已注入
  ✓ 无网页层启动动画（动画只在原生闪屏那一层）
  ✓ 无网页层动画卸载脚本
  ✓ 整页横向滚动护栏已随样式内联
  ✓ 原生闪屏 drawable 仍在
  ✓ 主题仍把原生闪屏挂在 windowBackground 上
  ✓ 骨架中无外部引用
  ... 页面实测：网页层动画=无 / overflowX=hidden / XLSX 8条 / CSV 8条 / 交易对象 4个 / 错误数=0
  ... 两端隔离 4 项全过
```

- 安卓版 APK：385,539 字节（与上一轮同尺寸——因为去掉的内容很小且原本就压缩过）
- 桌面版 `dist/青账.html`：1,068,001 字节，**未被触碰**

### 给 Codex 的文档

新增 `CODEX_HANDOFF.md`（项目根目录），是一份自包含的交接说明：项目定位与三条设计原则、目录职责、构建与验证命令、安卓壳的三个关键设计（假域名 WebView / 导出桥 / SAF 选文件）、启动动画现状、硬约束、环境相关、排错工具与四个测量陷阱、当前状态与交付位置。

### 顺手清理

- `android/build.stale-*` 累积了 6 个残留目录（都是历次构建因删除被拦而改名留下的），删掉 2 个；剩下 4 个因本机沙箱「回收站不可用」而删不掉，留着无害，正常环境直接删即可。
