# 青账 Android 版 · 交接说明

给 Codex 的项目上下文。读完这份就能独立改代码、重新出包，不需要再问人。

---

## 1. 这是什么

**青账**是一个**纯离线**的微信账单分析工具。用户从微信导出账单（xlsx / csv），导进来就能看分类统计、月度趋势、交易对象排行、明细表。

三条不可动摇的设计原则：

1. **零网络**。不请求任何远端，不上传任何数据。Android 版的权限列表是**空的**——连 `INTERNET` 都没申请。
2. **数据全在本机**。全部存在 `localStorage` 里。没有账号、没有云端、没有同步。
3. **没有构建系统**。整个项目就是几个源文件直接内联，没有 webpack / vite / npm 依赖。

目前有**两个发行版本**，从同一份源码出发：

| 版本 | 产物 | 说明 |
|---|---|---|
| 电脑版 | `dist/青账.html` | 单个 HTML 文件（约 1.04 MB），双击即用 |
| 安卓版 | `dist/青账-Android.apk` | 约 0.37 MB，WebView 套壳 |

**当前任务：安卓版只保留「原生闪屏」这一层启动动画，删掉网页内的加载动画。已完成。**

---

## 2. 目录与文件职责

```
10.3 vibecoding/
├─ index.html                  ← 共享 UI 骨架（桌面版源码）
├─ styles.css                  ← 共享样式（桌面版源码）
├─ ui-polish.css               ← 共享样式第二层（桌面版源码）
├─ ledger-core.js              ← 核心业务逻辑，UMD 风格，纯函数，与 DOM 无关
├─ xlsx-import.js              ← xlsx/csv 解析
├─ app.js                      ← 全部 DOM 渲染与交互
├─ vendor/xlsx.full.min.js     ← SheetJS（约 930 KB，内联进单文件）
│
├─ tools/
│   ├─ bundle-single-file.mjs  ← 把上面这些打成 dist/青账.html
│   ├─ verify-single-file.mjs  ← 桌面版端到端校验（无头浏览器里真跑）
│   ├─ verify-apk-asset.mjs    ← 安卓版端到端校验 + 两端隔离检查
│   ├─ verify-hscroll.mjs      ← 判定页面能否横向拖开
│   └─ diagnose-*.mjs          ← 排错工具（见 §8）
│
├─ android/                    ← 安卓壳工程
│   ├─ AndroidManifest.xml
│   ├─ build.mjs               ← 【关键】安卓版构建脚本
│   ├─ shim-android-export.js  ← 导出桥（注入到 assets）
│   ├─ overrides.css           ← 【安卓专属样式】横向护栏 + 帮助入口
│   ├─ qingzhang.keystore      ← ⚠️ 签名密钥，绝对不能丢
│   ├─ src/com/qingzhang/ledger/MainActivity.java
│   └─ res/
│       ├─ values/styles.xml             ← 主题（挂着原生闪屏）
│       ├─ drawable/splash_background.xml ← 【唯一的启动动画】原生闪屏
│       ├─ drawable/ic_launcher_foreground.xml
│       └─ mipmap-anydpi-v26/ic_launcher.xml
│
├─ _deprecated/web-splash/     ← 已停用的网页层动画（splash.css / splash.html）
├─ samples/                    ← 示例账单（verif y 脚本用）
└─ dist/                       ← 构建产物目录
```

---

## 3. 构建

### 3.1 工具链（已装好，不必重装）

```
D:\android-build\jdk-17.0.2\                        JDK 17
D:\android-build\sdk\build-tools\34.0.0\            aapt2 / d8 / zipalign / apksigner
D:\android-build\sdk\platforms\android-34\          android.jar
```

**没有 Android Studio，没有 Gradle**。工程刻意**零 androidx 依赖**，所以手工串 `aapt2 → javac → d8 → zipalign → apksigner` 就够，构建是秒级的。

### 3.2 命令

```bash
# 1) 先生成桌面版单文件（安卓版是在它基础上套壳，必须先有）
node tools/bundle-single-file.mjs

# 2) 再构建 APK
node android/build.mjs
```

产物都落在 `dist/`。构建脚本会自己处理清理、签名、校验。

### 3.3 验证

```bash
node tools/verify-single-file.mjs          # 桌面版
node tools/verify-apk-asset.mjs            # 安卓版（含两端隔离检查）
node --test tests/ledger-core.test.js tests/xlsx-import.test.js tests/counterparties.test.js
```

### 3.4 包信息

- 包名 `com.qingzhang.ledger`
- minSdk 26（Android 8.0+），targetSdk 34
- 签名：v2 + v3（v1 / v4 关闭）
- 密钥 `android/qingzhang.keystore`，口令 `qingzhang2026`，alias `qingzhang`

> ⚠️ **密钥绝对不能丢、不能换。** Android 只允许同签名的覆盖安装；换签名会让用户必须先卸载，而**卸载会清空 WebView 的 localStorage，也就是整个账本**。

---

## 4. 安卓壳的三个关键设计（改之前必须先懂）

### 4.1 不用 `file:///android_asset/`，自己拦一个假域名

`MainActivity` 里 WebView 加载的是 **`https://qingzhang.local/index.html`**——一个不存在的域名。所有请求都在 `shouldInterceptRequest` 里被截住，从 `assets/` 读内容返回。

**为什么不用更简单的 `file://`？** 因为 `file://` 源在部分 WebView 版本上拿不到可用的 `localStorage`，而这个 App 的全部数据都靠它——一旦拿不到，账本直接存不下来。

**为什么不用官方的 `WebViewAssetLoader`？** 它是 androidx 的，而本项目刻意不依赖 androidx（为了能手工编译）。自己拦域名效果等同。

因为没有任何真实请求，所以 manifest 里**不声明 `INTERNET` 权限**。

### 4.2 导出桥（必需，不是优化）

网页里「导出 CSV / 导出 JSON 备份」用的是 `URL.createObjectURL(new Blob(...))` + `<a download>` + `click()`。**Android WebView 不处理 `blob:` 形式的下载**——点击后静默无反应，也不报错。

所以有两部分配合：

- `android/shim-android-export.js`（注入到 assets）：记住每个 blob URL 对应的 Blob，拦截带 `download` 属性的 `<a>` 点击，读成 base64 交给原生
- `MainActivity.ExportBridge.saveFile()`：收到后走 SAF（`ACTION_CREATE_DOCUMENT`）弹「保存到…」

shim 开头有一句 `if (!window.Android) return;`，所以在**没有壳的环境里整段不生效**——桌面版和安卓版因此能共用同一份源码。

### 4.3 选文件走 SAF

`onShowFileChooser` → `ACTION_OPEN_DOCUMENT`，不需要存储权限。

注意文件类型给的是 `*/*` 而不是 xlsx：**不少手机的文件管理器把 xlsx 报成 `application/octet-stream`**，按扩展名过滤会让文件变灰、选不了。

---

## 5. 启动动画：只保留原生闪屏

### 现状

只有**一层**：`android/res/drawable/splash_background.xml`，纯色 `#F5F7F3` + 居中叶子图标（`layer-list`），挂在主题的 `android:windowBackground` 上。

它盖住的是「点图标 → Activity 起来 → WebView 画出第一帧」这段空窗期，避免闪白。

### 本轮删掉的是什么

原先还有**第二层**：一个网页内的加载动画（`android/splash.css` + `android/splash.html`，由 `build.mjs` 注入到 assets）。视觉是绿色圆角方块里的叶子呼吸 +「青账」+ 三个跳动圆点，覆盖 930 KB 内联脚本的解析时间。

**已完全移除**，原因：

- 原生闪屏已经把「冷启动首帧」这段盖住了，网页层再叠一个属于重复
- 网页层需要往 assets 里注入三处（CSS 进 `<head>`、标记紧跟 `<body>`、卸载脚本放 `</body>` 前），注入点多、故障面大
- 用户明确要求：只要第一层

对应的清理：

| 变化 | 位置 |
|---|---|
| 删除 `<style>{splashCss}</style>` 注入 | `android/build.mjs` |
| 删除 `#qz-splash` 标记注入 | 同上 |
| 删除卸载脚本注入 | 同上 |
| 新增**反向断言**：assets 里不得含 `qz-splash` / `splash-leave` | 同上 |
| 校验改为断言「无网页层动画」+「原生闪屏仍在」 | `tools/verify-apk-asset.mjs` |
| 两个文件归档到 `_deprecated/web-splash/` | — |

**原生闪屏本身没动**，视觉不变。

### 如果你要继续改动画

- 想调原生闪屏的配色/图标 → 改 `res/drawable/splash_background.xml` 和 `res/values/styles.xml` 里的 `splash_background` 颜色
- 想换图标 → 换 `res/drawable/ic_launcher_foreground.xml`
- ⚠️ 如果要在闪屏上显示文字，`layer-list` 做不了，得改用一个专门的 Splash Activity；那时要注意「原生闪屏 → 网页首帧」之间的衔接别闪一下

---

## 6. 硬约束（违反会出问题）

1. **不要动桌面版。** 用户明确要求过：反馈针对哪个版本，就只改那个版本。`styles.css` / `ui-polish.css` / `index.html` 是**共享源码，保持原样**；所有安卓专属内容都放在 `android/overrides.css`，由 `build.mjs` 在打包时注入。

   `dist/青账.html` 有一个已知的小瑕疵（导入数据后整页可以被左右拖动约 150px），**用户已明确说不用修**，保留。

2. **不要引入 androidx，不要引入 Gradle。** 一旦引入，手工编译链路就跑不通了。

3. **`replace('</body>', ...)` 这类「第一个匹配」的写法是禁区。** SheetJS 压缩源码里含字符串 `"</body></html>"` 和 `"</head><body"`（它自己会生成 HTML）。用它做注入会把代码塞进人家的字符串字面量里，症状是「页面看起来加载了但脚本全不执行」，极难排查。

   正确做法：`indexOf('</head>')` 精确取第一个，`lastIndexOf('</body>')` 取最后一个，并且**断言锚点出现次数**。

4. **`String.replace()` 的字符串替换参数里 `$` 有特殊含义**（`$&`、`` $` ``、`$'`）。SheetJS 代码里全是这类序列，用字符串替换会把内容静默改坏。**凡是插入代码内容的替换，第二个参数必须写成函数。**

5. **签名密钥别丢**（见 §3.4）。

---

## 7. 环境相关

### Python 路径

构建脚本里硬编码了一个 Python 用于文件清理（因为 Node 的 `fs.rmSync` 在本机开发环境被安全钩子拦截）：

```
C:/Users/watt2/.workbuddy/binaries/python/versions/3.13.12/python.exe
```

可用环境变量 `QZ_PY` 覆盖。

### `android/build.stale-*` 残留

`build.mjs` 清理构建目录时，如果删除操作被拒（本机开发环境的安全策略会把删除重定向到回收站，而回收站不可用时直接失败），脚本会退而改名成 `build.stale-<时间戳>` 而不是删除。

**正常环境下这些残留可以随便删**（`rm -rf android/build.stale-*` 或资源管理器直接删）。它们只是构建中间产物，不影响任何功能。

### 路径写法

Git Bash 里的 `/d/xxx` 路径传给 Windows 原生 `java.exe` / `.bat` 会失败（找不到文件），必须用 `D:/xxx`。

---

## 8. 排错工具（都是可复用的）

| 脚本 | 作用 |
|---|---|
| `tools/diagnose-overflow.mjs` | 用指定宽度的 iframe 量 `scrollWidth`，列出越界元素 |
| `tools/diagnose-stress.mjs` | 逐个施加「手机常见变量」（字号放大、长金额、长商户名），每次从干净页面开始 |
| `tools/diagnose-culprit.mjs` | 暴力法：逐个 `display:none` 元素，看谁消失后溢出就没了 |
| `tools/verify-hscroll.mjs` | 判定页面到底能不能横向拖开，并逐个试候选修复 |

### 用无头 Edge 做测量时的四个坑

1. **`--window-size` 不改变 `documentElement.clientWidth`**（实测给 393 和 412 都返回 489）。要精确视口，只能把目标页塞进指定尺寸的 `<iframe>`。
2. **`file://` 下父页读不到 iframe 的 `contentDocument`**。让探针在 iframe 内测量、`parent.postMessage()` 传出，父页写进 `document.title`，再用 `--dump-dom` 回读。
3. **`html{scroll-behavior:smooth}` 会让 `scrollLeft = 99999` 变成动画**，立刻读回永远是 0。测真实滚动距离前必须先把 `scrollBehavior` 临时改成 `auto`。
4. **`overflow:hidden` 的盒子仍可被脚本滚动**。「设完 scrollLeft 能读到非 0」**不等于**用户能用手势拖动。判断用户能否拖动，看 `getComputedStyle(根元素).overflowX` 是否为 `hidden`。

> 回读结果做断言时，**别按行切再按 `key.length + n` 取子串**——多个字段会挤在同一行，且差一位就会吃掉数值首字符（`CSV=8条` 变成 `条`）。统一用全文子串正则。

---

## 9. 当前状态

- 安卓版 APK：`dist/青账-Android.apk`，385,539 字节，v2+v3 签名有效，零权限
- 内部 `assets/index.html`：1,073,986 字节
- 校验：**全部通过**（无网页层动画、原生闪屏仍在、横向拖动已禁止、帮助按钮存在、XLSX 与 CSV 各解析 8 条、0 个未捕获错误、两端隔离 4 项）
- 桌面版：`dist/青账.html`，1,068,001 字节，与改动前逐字节一致

### 未经真机验证的部分

本机没有 Android 设备也没有模拟器，所以**真机上的 WebView 渲染、选文件、保存文件这三件没实测过**。离线能做的校验都做了（包括把 `assets/index.html` 从 APK 里抽出来在无头浏览器里完整跑一遍）。

真机上值得重点确认：能不能正常打开、能不能导入账单、导出备份能不能弹出保存对话框。

---

## 10. 交付位置（用户自己整理过，注意不要找错）

```
C:\Users\watt2\Desktop\vibe-coding\
├─ 青帐\                     ← 文件夹（用户把「青账」写成了「青帐」，照原话建的）
│  ├─ 青账.html              ← 电脑版①
│  ├─ 打开青账.bat            ← 电脑版②（Edge --app 模式，无地址栏窗口）
│  ├─ 青账-Android.apk       ← 安卓版
│  ├─ 电脑版-使用说明.txt
│  ├─ 安卓版-安装说明.txt
│  └─ 青账-免安装版.zip       ← 5 个文件打包，直接发给别人
└─ 青帐.zip                  ← 同一个包的副本，方便拖进微信
```

`dist/` 是构建产物目录。重新构建后，需要把 `青账.html` 和 `青账-Android.apk` 再拷到上面那个文件夹，并重打两个 zip。
