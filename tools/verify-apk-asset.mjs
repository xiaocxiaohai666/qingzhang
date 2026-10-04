#!/usr/bin/env node
/**
 * APK 资产端到端校验
 *
 * 把 assets/index.html 从已签名的 APK 里解出来，检查：
 *   1. 与构建输入逐字节一致（确认打包没搞坏内容）
 *   2. 导出桥已注入；**没有**网页层启动动画（动画只保留原生闪屏那一层）
 *   3. 页面骨架里没有外部引用
 *   4. 无头浏览器里真跑：脚本加载、init 完成、XLSX 与 CSV 解析、0 个未捕获错误
 *   5. 整页横向拖动已被禁止（html 的 overflow-x 为 hidden）
 *   6. 两端隔离：桌面版不含任何安卓专属内容
 *
 * 用法：node tools/verify-apk-asset.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const PY = process.env.QZ_PY || 'C:/Users/watt2/.workbuddy/binaries/python/versions/3.13.12/python.exe';
const APK = join(ROOT, 'dist', '青账-Android.apk');
const W = 390;
const HEIGHT = 851;

const xlsxB64 = readFileSync(join(ROOT, 'samples', 'wechat-demo.xlsx')).toString('base64');
const csv = readFileSync(join(ROOT, 'samples', 'wechat-demo.csv'), 'utf8');

let failures = 0;
const check = (ok, label, detail) => {
  console.log(`  ${ok ? '✓' : '✗'} ${label}${detail ? '   ' + detail : ''}`);
  if (!ok) failures++;
};

// ---------------------------------------------------------------- 1. 解包
const dir = mkdtempSync(join(tmpdir(), 'qz-apk-'));
const assetPath = join(dir, 'index.html');
execFileSync(PY, ['-c', `
import zipfile
data = zipfile.ZipFile(${JSON.stringify(APK)}).read('assets/index.html')
open(${JSON.stringify(assetPath)}, 'wb').write(data)
print(len(data))
`], { encoding: 'utf8' });

const asset = readFileSync(assetPath, 'utf8');
const built = readFileSync(join(ROOT, 'android', 'build', 'assets', 'index.html'), 'utf8');

console.log('【1】APK 资产内容');
check(asset === built, '与构建输入逐字节一致', `${Buffer.byteLength(asset)} 字节`);
check(asset.includes('Android.saveFile'), '导出桥已注入');
check(!asset.includes('qz-splash'), '无网页层启动动画（动画只在原生闪屏那一层）');
check(!asset.includes('splash-leave'), '无网页层动画卸载脚本');
check(/overflow-x:\s*hidden/.test(asset), '整页横向滚动护栏已随样式内联');
// 原生闪屏仍然要在（它才是唯一的启动动画）
check(existsSync(join(ROOT, 'android', 'res', 'drawable', 'splash_background.xml')),
  '原生闪屏 drawable 仍在');
check(/android:windowBackground">@drawable\/splash_background/.test(
  readFileSync(join(ROOT, 'android', 'res', 'values', 'styles.xml'), 'utf8')),
  '主题仍把原生闪屏挂在 windowBackground 上');

// 骨架检查（摘掉内联块后再查外部引用，避免被 SheetJS 里的模板串误报）
let skeleton = asset;
for (const m of ['styles.css', 'ui-polish.css']) {
  const i = skeleton.indexOf(`<!-- inlined: ${m} -->`);
  const j = skeleton.indexOf('</style>', i);
  skeleton = skeleton.slice(0, i) + skeleton.slice(j + '</style>'.length);
}
for (const m of ['ledger-core.js', 'vendor/xlsx.full.min.js', 'xlsx-import.js', 'app.js']) {
  const i = skeleton.indexOf(`<!-- inlined: ${m} -->`);
  const j = skeleton.indexOf('</script>', i);
  skeleton = skeleton.slice(0, i) + skeleton.slice(j + '</script>'.length);
}
const leftovers = skeleton.match(/\b(?:src|href)="(?!data:|#)[^"]*"/g);
check(!leftovers, '骨架中无外部引用', leftovers ? leftovers.join(', ') : '');

// ---------------------------------------------------------------- 2. 浏览器实测
const probe = `<script>
window.__errs = [];
window.onerror = function (m, s, l) { window.__errs.push(m + ' @' + l); return false; };
window.addEventListener('unhandledrejection', function (e) { window.__errs.push('rej:' + e.reason); });
(function () {
  var snap = {};
  function grab() {
    snap.splashCount = document.querySelectorAll('#qz-splash').length;
    snap.ovx = getComputedStyle(document.documentElement).overflowX;
  }
  function later() {
    var out = [];
    out.push('网页层动画=' + (document.querySelectorAll('#qz-splash').length ? '有' : '无'));
    out.push('html.overflowX=' + getComputedStyle(document.documentElement).overflowX);
    out.push('根页面宽度=' + document.documentElement.clientWidth + '/' + document.documentElement.scrollWidth);
    var monthCustom = document.querySelector('.pretty-select');
    var monthNative = document.querySelector('#month-filter');
    out.push('月份控件=' + (monthCustom ? getComputedStyle(monthCustom).display : '缺少自定义') + '/' +
             (monthNative ? getComputedStyle(monthNative).display + ',' + getComputedStyle(monthNative).opacity + ',' + getComputedStyle(monthNative).pointerEvents : '缺少原生'));
    out.push('顶部手势=' + getComputedStyle(document.querySelector('main')).touchAction + '/' +
             getComputedStyle(document.querySelector('.welcome')).touchAction);
    var tableScroll = document.querySelector('.table-scroll');
    var table = tableScroll && tableScroll.querySelector('table');
    if (tableScroll && table) {
      tableScroll.scrollLeft = 99999;
      out.push('明细表横向滚动=' + getComputedStyle(tableScroll).overflowX +
               ' ' + tableScroll.scrollLeft + 'px/' + table.scrollWidth + 'px');
    } else {
      out.push('明细表横向滚动=缺少滚动容器');
    }
    out.push('XLSX=' + typeof XLSX + ' Ledger=' + typeof WechatLedger + ' Imp=' + typeof WechatXlsx);
    out.push('月份选项=' + document.querySelectorAll('#month-filter option').length);
    out.push('帮助按钮=' + document.querySelectorAll('.help-button[data-action=help]').length +
             ' 导航帮助项=' + document.querySelectorAll('.nav-item[data-action=help]').length);
    try {
      var b = atob(${JSON.stringify(xlsxB64)}), y = new Uint8Array(b.length);
      for (var i = 0; i < b.length; i++) y[i] = b.charCodeAt(i);
      var parsed = WechatXlsx.parseXlsx(y);
      var sum = WechatLedger.summarize(parsed.records);
      out.push('XLSX=' + parsed.records.length + '条 支出=' + (sum.expense / 100).toFixed(2) + '元');
      out.push('CSV=' + WechatLedger.parseBill(${JSON.stringify(csv)}).records.length + '条');
      var cp = WechatLedger.groupCounterparties(parsed.records, { direction: 'expense' });
      out.push('交易对象=' + (Array.isArray(cp) ? cp.length : cp.groups ? cp.groups.length : '?') + '个');
    } catch (e) { out.push('运行异常=' + e.message); }
    out.push('错误数=' + window.__errs.length + (window.__errs.length ? '[' + window.__errs.join(' ;; ') + ']' : ''));
    parent.postMessage(out.join('\\n'), '*');
  }
  function go() { grab();
    var d = document.getElementById('demo-button'); if (d) d.click();
    setTimeout(later, 1600);
  }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

const at = asset.lastIndexOf('</body>');
const page = asset.slice(0, at) + probe + '\n' + asset.slice(at);
writeFileSync(join(dir, 'target.html'), page, 'utf8');
writeFileSync(join(dir, 'wrap.html'), `<!doctype html><html><head><meta charset="utf-8"><title>WAITING</title></head>
<body style="margin:0;background:#888">
<iframe src="target.html" style="width:${W}px;height:${HEIGHT}px;border:0;display:block"></iframe>
<script>window.addEventListener('message', function (e) { document.title = 'OK|' + e.data; });</script>
</body></html>`, 'utf8');

const out = execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(dir, 'prof')}`,
  '--virtual-time-budget=15000',
  '--dump-dom', 'file:///' + join(dir, 'wrap.html').replace(/\\/g, '/'),
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const title = ((out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
const lines = title.replace(/^OK\|/, '').split('\n');
const body = lines.join('\n');
// 直接对全文做子串匹配：比按行切再取 "key 后面的值" 稳得多
// （多个字段会挤在同一行，例如"帮助按钮=1 导航帮助项=1"）
const has = (s) => body.includes(s);

console.log('\n【2】无头浏览器实测（页面内真实执行）');
for (const l of lines) console.log('     ' + l);
console.log('');
check(has('网页层动画=无'), '页面里没有网页层启动动画（只剩原生闪屏）');
check(has('html.overflowX=hidden'), '整页横向拖动已禁止');
check(/根页面宽度=(\d+)\/\1/.test(body), '导入后根页面没有横向溢出',
  (body.match(/根页面宽度=[^\r\n]*/) || [''])[0]);
check(has('月份控件=none/block,1,auto'), '安卓版月份选择使用原生弹窗控件',
  (body.match(/月份控件=[^\r\n]*/) || [''])[0]);
check(has('顶部手势=pan-y/pan-y'), '顶部区域只允许上下滑动',
  (body.match(/顶部手势=[^\r\n]*/) || [''])[0]);
check(/明细表横向滚动=auto \d+px\/\d+px/.test(body), '明细表仍可在自身容器内横向滚动',
  (body.match(/明细表横向滚动=[^\r\n]*/) || [''])[0]);
check(has('XLSX=object Ledger=object Imp=object'), '四个脚本全部加载');
check(/月份选项=\d+/.test(body), 'app 初始化完成（月份下拉已填充）', (body.match(/月份选项=\d+/) || [''])[0]);
check(/帮助按钮=1\b/.test(body), '顶部帮助按钮已注入', (body.match(/帮助按钮=\d+/) || [''])[0]);
check(/导航帮助项=1\b/.test(body), '导航里的帮助项仍在', (body.match(/导航帮助项=\d+/) || [''])[0]);
check(/XLSX=\d+条 支出=[\d.]+元/.test(body), 'XLSX 真实解析成功', (body.match(/XLSX=\d+条 支出=[\d.]+元/) || [''])[0]);
check(/CSV=\d+条/.test(body), 'CSV 真实解析成功', (body.match(/CSV=\d+条/) || [''])[0]);
check(/交易对象=\d+个/.test(body), '交易对象分组正常', (body.match(/交易对象=\d+个/) || [''])[0]);
check(has('错误数=0'), '无未捕获 JS 错误', (body.match(/错误数=[^\s]*/) || [''])[0]);

console.log('\n【3】两端隔离检查（桌面版应当不含任何安卓专属内容）');
const desktop = readFileSync(join(ROOT, 'dist', '青账.html'), 'utf8');
for (const [needle, label] of [
  ['qz-splash', '网页层启动动画'],
  ['help-button', '帮助入口按钮'],
  ['overflow-x: hidden', '横向滚动护栏'],
  ['Android.saveFile', '导出桥'],
]) {
  check(!desktop.includes(needle), `桌面版不含「${label}」`);
}

console.log('\n' + (failures ? `✗ 有 ${failures} 项未通过` : '✓ 全部通过'));
console.log('临时目录：' + dir);
process.exit(failures ? 1 : 0);
