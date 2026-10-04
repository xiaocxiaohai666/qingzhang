#!/usr/bin/env node
/**
 * 终极判定：页面到底能不能横向滚动？以及哪个修复能消掉它。
 *
 * 在 iframe 里加载 → 点「体验示例」渲染完整界面 → 
 *   1. 试着把页面横向滚到底，读回 scrollLeft（能滚就是真溢出）
 *   2. 依次注入候选修复，看哪个能把 scrollWidth 压回视口宽度
 *
 * 用法：node tools/verify-hscroll.mjs [html路径] [宽度]
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'dist', '青账.html');
const W = Number(process.argv[3] || 390);
const HEIGHT = 851;

const html = readFileSync(target, 'utf8');

const FIXES = [
  ['不修（基线）', ''],
  ['html{overflow-x:hidden!important}',
    `html{overflow-x:hidden!important}`],
  ['html,body{overflow-x:hidden!important;max-width:100vw!important}',
    `html,body{overflow-x:hidden!important;max-width:100vw!important}`],
  ['body{overflow-x:hidden!important;overflow-y:auto!important}',
    `body{overflow-x:hidden!important;overflow-y:auto!important}`],
  ['table{min-width:0!important;width:100%!important}',
    `table{min-width:0!important;width:100%!important}`],
  ['table{display:block!important;overflow-x:auto!important}',
    `table{display:block!important;overflow-x:auto!important}`],
  ['.table-scroll{overflow-x:auto!important;overflow-y:hidden!important;max-width:100%!important}',
    `.table-scroll{overflow-x:auto!important;overflow-y:hidden!important;max-width:100%!important}`],
  ['.ledger-panel{overflow:hidden!important;border-radius:13px!important}',
    `.ledger-panel{overflow:hidden!important;border-radius:13px!important}`],
  ['main{overflow-x:hidden!important}',
    `main{overflow-x:hidden!important}`],
  ['*{max-width:100vw}',
    `*{max-width:100vw}`],
  ['隐藏明细表（对照：确认它就是唯一来源）',
    `.ledger-panel{display:none!important}`],
];

const probe = `<script>
(function () {
  var lines = [];
  function snap(label) {
    var de = document.documentElement;
    var sc = document.scrollingElement || de;
    // ⚠️ html{scroll-behavior:smooth} 会让 scrollLeft 赋值变成动画，
    // 立刻读回永远是 0。必须先临时改成 auto 才能读到真实的滚动距离。
    var prevInline = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    sc.scrollLeft = 99999;
    var got = sc.scrollLeft;
    sc.scrollLeft = 0;
    de.style.scrollBehavior = prevInline;
    var hx = getComputedStyle(de).overflowX, bx = getComputedStyle(document.body).overflowX;
    lines.push(label);
    lines.push('      scrollWidth=' + de.scrollWidth + '  可滚动=' + got + 'px' +
      (got > 0 ? '  ★ 能滑开' : '  ✓ 滑不动') +
      '   html.ovx=' + hx + ' body.ovx=' + bx);
  }
  function run() {
    var names = ${JSON.stringify(FIXES.map((f) => f[0]))};
    var codes = ${JSON.stringify(FIXES.map((f) => f[1]))};
    snap('原始状态');
    for (var i = 1; i < names.length; i++) {
      var s = document.createElement('style');
      s.textContent = codes[i];
      document.head.appendChild(s);
      snap(names[i]);
      s.remove();
    }
    parent.postMessage(lines.join('\\n'), '*');
  }
  function go() {
    var d = document.getElementById('demo-button');
    if (d) d.click();
    setTimeout(run, 800);
  }
  if (document.readyState === 'complete') setTimeout(go, 150);
  else window.addEventListener('load', function () { setTimeout(go, 150); });
})();
</script>`;

function withProbe(doc) {
  const at = doc.lastIndexOf('</body>');
  if (at < 0) throw new Error('产物里找不到 </body>');
  return doc.slice(0, at) + probe + '\n' + doc.slice(at);
}

const dir = mkdtempSync(join(tmpdir(), 'qz-hscroll-'));
writeFileSync(join(dir, 'target.html'), withProbe(html), 'utf8');
writeFileSync(join(dir, 'wrap.html'), `<!doctype html><html><head><meta charset="utf-8"><title>WAITING</title></head>
<body style="margin:0;background:#888">
<iframe src="target.html" style="width:${W}px;height:${HEIGHT}px;border:0;display:block"></iframe>
<script>window.addEventListener('message', function (e) { document.title = 'HS|' + e.data; });</script>
</body></html>`, 'utf8');

const out = execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(dir, 'prof')}`,
  '--virtual-time-budget=15000',
  '--dump-dom', 'file:///' + join(dir, 'wrap.html').replace(/\\/g, '/'),
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(无)';
console.log('iframe 宽度 ' + W + 'px（页面实得视口 = −15px 滚动条）\n');
console.log(title.replace(/^HS\|/, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
console.log('\n临时目录：' + dir);
