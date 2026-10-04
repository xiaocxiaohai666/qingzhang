# 青账 Android 版 —— 构建环境搭建

本目录用手工方式编译 APK，**不需要 Gradle、不需要 Android Studio**。原因是工程只用 Android framework API，零 androidx 依赖，所以能把工具链压到最小（约 1.3 GB，全在一个目录里，删掉即可还原）。

如果 `D:\android-build` 已经存在，可以直接跳到最后一节跑构建。

## 1. 目录规划

全部装在 `D:\android-build`（放 D 盘是因为体积大，且方便整体删除）：

```
D:\android-build\
├─ jdk-17.0.2\                     JDK（javac / jar / keytool / java）
└─ sdk\
   ├─ cmdline-tools\latest\        sdkmanager
   ├─ build-tools\34.0.0\          aapt2 / zipalign / d8 / apksigner
   └─ platforms\android-34\        android.jar
```

## 2. JDK 17

```bash
mkdir -p /d/android-build && cd /d/android-build
curl -L --ssl-no-revoke -o jdk17.zip \
  "https://mirrors.huaweicloud.com/openjdk/17.0.2/openjdk-17.0.2_windows-x64_bin.zip"
```
解压到 `D:\android-build\`，会得到 `jdk-17.0.2\`。

> 华为云镜像实测约 9 MB/s。也可以用清华 Adoptium 镜像：
> `https://mirrors.tuna.tsinghua.edu.cn/Adoptium/17/jdk/x64/windows/`

**注意：必须用 JDK 而不是 JRE**——我们需要 `javac`、`keytool`、`jar`。

## 3. Android 命令行工具

```bash
curl -L --ssl-no-revoke -o cmdline-tools.zip \
  "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
```
解压后把 `cmdline-tools\` 整个挪到 `D:\android-build\sdk\cmdline-tools\latest\`
（**必须是 `latest` 这一层**，sdkmanager 靠这个目录名定位）。

`dl.google.com` 在国内可直连（实测 200）。

## 4. 安装 SDK 组件

```bash
export JAVA_HOME='D:\android-build\jdk-17.0.2'
SDKM="sdk/cmdline-tools/latest/bin/sdkmanager.bat"

# 先接受许可（一路 y）
printf 'y\ny\ny\ny\ny\ny\ny\ny\ny\ny\ny\n' | "$SDKM" --sdk_root="D:\android-build\sdk" --licenses

# 装构建工具与平台
"$SDKM" --sdk_root="D:\android-build\sdk" "build-tools;34.0.0" "platforms;android-34"
```

`sdkmanager` 依赖 `JAVA_HOME`，漏了会报找不到 java。

## 5. 构建

```bash
cd "C:/Users/watt2/Documents/ChatGPT/10.3 vibecoding"
node tools/bundle-single-file.mjs     # 先生成 dist/青账.html（Android 版以它为源）
node android/build.mjs                # 产出 青账-Android.apk
```

如果工具链装在别处，用环境变量覆盖：

```bash
QZ_JDK="D:/some/jdk" QZ_SDK="D:/some/sdk" node android/build.mjs
```

## 为什么要手工编译而不用 Gradle

| | Gradle / AGP | 本文的手工链路 |
|---|---|---|
| 下载量 | 1.5 GB+（Gradle 发行版 + AGP + Kotlin + androidx 依赖树） | ~1.3 GB（只有 JDK + SDK 必需件） |
| 首次构建 | 数分钟到十几分钟，且极度依赖 Maven 仓库连通性 | 秒级 |
| 依赖 | 需要联网拉依赖 | **完全离线**，只需要本地这几个工具 |
| 代价 | 自动化程度高 | 需要自己写 `build.mjs` 串流程；加第三方库（androidx）会变得麻烦 |

本项目是单 Activity + WebView，没有任何第三方依赖，所以手工链路明显更划算。**如果以后要引入 androidx（比如换成 `WebViewAssetLoader`）或 Kotlin，就该老老实实转 Gradle。**

## 手工链路的构建顺序（改 `build.mjs` 时别打乱）

```
aapt2 compile  ->  编译 res/ 成 res.zip
aapt2 link     ->  链接资源 + 写入 assets + 生成二进制 AndroidManifest，得到 base.apk
javac          ->  编译 java（classpath = android.jar）
d8             ->  class 转 dex
zipfile 追加   ->  把 classes.dex 塞进 base.apk
zipalign       ->  4 字节对齐
apksigner      ->  签名（必须在 zipalign 之后）
```

两个关键点：

1. **签名一定要在 zipalign 之后**。顺序反了，签名会因为对齐改动而失效。
2. `keytool` 生成的 `android/qingzhang.keystore`（口令 `qingzhang2026`）**必须保留**。Android 只允许"同签名"覆盖安装；换了签名，用户必须先卸载——而卸载会清掉 WebView 的本地存储，也就是**用户账本会被删掉**。

## 已知无法在本机验证的部分

本机没有 Android 设备也没有模拟器（装 emulator 镜像还要再下 ~1.5 GB 且本机未必能跑起硬件加速），所以构建脚本只能做到：

- `aapt2 dump badging` 检查包名 / 版本 / label / 权限列表
- `apksigner verify` 检查签名有效
- 解包确认 `classes.dex` 与 `assets/index.html` 就位、导出桥已注入

**真机行为（WebView 渲染、SAF 选文件、导出保存）需要装到手机上才能确认。**
