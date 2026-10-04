#!/usr/bin/env node
/**
 * 青账 · 单文件产物验证
 *
 * 用无头 Edge 打开 dist/青账.html，在页面里真跑一遍：
 *   1. 四个脚本是否都加载成功（XLSX / WechatLedger / WechatXlsx）
 *   2. app.js 的初始化是否跑完（月份下拉是否被填上选项、侧栏是否渲染）
 *   3. 示例账单生成 + 汇总是否正常
 *   4. 用 samples/wechat-demo.xlsx 走一遍内联 SheetJS 的真实解析
 *   5. 用 samples/wechat-demo.csv 走一遍 CSV 解析
 *   6. 全程有没有未捕获的 JS 错误
 *
 * 结果写入 document.title，通过 --dump-dom 回读。
 *
 * 用法：node tools/verify-single-file.mjs [要验证的 html 路径]
 *   默认验证 dist/青账.html；
 *   也可以传从 APK 里解出来的 assets/index.html，用来确认注入 Android 导出桥后页面仍正常。
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'dist', '青账.html');
console.log('验证目标：' + target + '\n');

const html = readFileSync(target, 'utf8');
const xlsxB64 = readFileSync(join(ROOT, 'samples', 'wechat-demo.xlsx')).toString('base64');
const csv = readFileSync(join(ROOT, 'samples', 'wechat-demo.csv'), 'utf8');

const put = (text) => () => text;

/** 只替换文档末尾真正的 </body>，绝不能用 replace('</body>') —— SheetJS 源码里含 "</body></html>" 字符串 */
function appendBeforeBodyClose(doc, extra) {
  const at = doc.lastIndexOf('</body>');
  if (at < 0) throw new Error('产物中找不到 </body>');
  return doc.slice(0, at) + extra + '\n' + doc.slice(at);
}

// 错误收集器必须最早注入
const errorTrap = `<script>
window.__errs = [];
window.onerror = function (m, s, l) { window.__errs.push(m + ' @line' + l); return false; };
window.addEventListener('unhandledrejection', function (e) { window.__errs.push('rejection: ' + e.reason); });
</script>`;

const probe = `<script>
(function () {
  var out = [];
  try {
    out.push('XLSX=' + typeof XLSX);
    out.push('Ledger=' + typeof WechatLedger);
    out.push('Imp=' + typeof WechatXlsx);
    out.push('月份选项=' + document.querySelectorAll('#month-filter option').length);
    out.push('导航项=' + document.querySelectorAll('.nav-item').length);
    out.push('侧栏=' + (document.querySelector('.sidebar-note strong') ? '有' : '无'));
    // Android 版资产里注入了导出桥 shim；无壳环境下它应当整段不生效，
    // 且不能破坏 URL.createObjectURL 这条桌面端导出路径
    out.push('Android桥=' + typeof window.Android);
    out.push('createObjectURL=' + typeof URL.createObjectURL);

    out.push('示例条数=' + WechatLedger.makeDemoRecords().length);

    var b64 = ${JSON.stringify(xlsxB64)};
    var bin = atob(b64), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    var parsed = WechatXlsx.parseXlsx(bytes);
    out.push('XLSX=' + parsed.records.length + '条');

    // summarize 返回的是「分」，字段名是 expense / income
    var sum = WechatLedger.summarize(parsed.records);
    out.push('支出=' + (sum.expense / 100).toFixed(2) + '元');
    out.push('收入=' + (sum.income / 100).toFixed(2) + '元');
    out.push('分类=' + sum.categories.length + '类');

    // mergeRecords(existing, incoming) 返回 { records, added, repeated }
    var merged = WechatLedger.mergeRecords(parsed.records, parsed.records);
    out.push('去重后=' + merged.records.length + '条/重复' + merged.repeated);

    var cp = WechatLedger.groupCounterparties(parsed.records, { direction: 'expense' });
    out.push('交易对象=' + (Array.isArray(cp) ? cp.length : cp.groups ? cp.groups.length : '?') + '个');

    // parseBill(text) 是 CSV 全流程入口（内部 parseCsv -> parseBillRows）
    out.push('CSV=' + WechatLedger.parseBill(${JSON.stringify(csv)}).records.length + '条');
  } catch (e) {
    out.push('运行异常=' + e.message);
  }
  out.push('错误数=' + (window.__errs ? window.__errs.length : 'UNDEF') +
    (window.__errs && window.__errs.length ? '[' + window.__errs.join(' ;; ') + ']' : ''));
  document.title = 'PROBE|' + out.join(' | ');
})();
</script>`;

let page = html.replace('<head>', put(`<head>\n${errorTrap}`));
page = appendBeforeBodyClose(page, probe);
const tmp = mkdtempSync(join(tmpdir(), 'qz-verify-'));
const pagePath = join(tmp, 'verify.html');
writeFileSync(pagePath, page, 'utf8');

const dom = execFileSync(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${join(tmp, 'profile')}`,
    '--dump-dom',
    'file:///' + pagePath.replace(/\\/g, '/'),
  ],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] },
);

const title = (dom.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(未取到 title)';
const monthSelect = (dom.match(/id="month-filter"[\s\S]{0,800}?<\/select>/) || [''])[0];
const optCount = (monthSelect.match(/<option/g) || []).length;

console.log('页面自检结果：');
for (const part of title.split(' | ')) console.log('  ' + part);
console.log('\nDOM 里 #month-filter 的 option 数：' + optCount);
console.log('（上面这些数字来自页面内真实执行，不是静态检查）');

const problems = [];
if (!title.startsWith('PROBE|')) problems.push('探针脚本没有执行，页面可能在加载期就中断了');
if (/运行异常=/.test(title)) problems.push('脚本内容报错：' + (title.match(/运行异常=[^|]*/) || [''])[0]);
if (!/错误数=0\s*$/.test(title.trim())) problems.push('存在未捕获的 JS 错误：' + title);
if (!/XLSX=\d+条/.test(title)) problems.push('XLSX 没有被成功解析');
if (!/支出=[\d.]+元/.test(title)) problems.push('summarize 没有算出金额');
if (!/CSV=\d+条/.test(title)) problems.push('CSV 没有被成功解析');
if (optCount < 2) problems.push('#month-filter 没有生成选项，app.js 初始化可能未完成');

if (problems.length) {
  console.error('\n验证未通过：');
  problems.forEach((x) => console.error('  - ' + x));
  console.error('\n临时文件：' + pagePath);
  process.exit(1);
}
console.log('\n验证通过：脚本全部加载、初始化完成、XLSX 与 CSV 真实解析可用、无 JS 错误。');
