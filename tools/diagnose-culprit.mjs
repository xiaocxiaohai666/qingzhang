#!/usr/bin/env node
/**
 * 溢出来源暴力定位
 *
 * 现象：加载数据后 documentElement.scrollWidth=527 而 clientWidth=375，
 * 但遍历所有"未被滚动容器裁剪"的元素，右边界最大只有 359 —— 没有任何元素超出视口。
 * 这是典型的「布局溢出」：某个元素的溢出被算进了根元素的 scrollWidth，但看不出来是谁。
 *
 * 办法：逐个把元素 display:none 掉，看 scrollWidth 是否随之回落到视口宽度。
 *
 * 用法：node tools/diagnose-culprit.mjs [html路径] [宽度]
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

const probe = `<script>
(function () {
  function describe(el) {
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '');
  }
  function run() {
    var de = document.documentElement;
    var vw = de.clientWidth;
    var before = de.scrollWidth;
    var lines = ['视口=' + vw + '  初始 scrollWidth=' + before + '  溢出=' + (before - vw) + 'px'];

    var all = Array.prototype.slice.call(document.querySelectorAll('*'));
    var hits = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      if (el === document.documentElement || el === document.body) continue;
      var prev = el.style.display;
      el.style.display = 'none';
      var after = de.scrollWidth;
      el.style.display = prev;
      if (after < before) {
        hits.push(describe(el) + '   隐藏后 scrollWidth ' + before + ' → ' + after);
        if (hits.length >= 12) break;
      }
    }
    lines.push('会把溢出消掉的元素（共 ' + hits.length + ' 个）：');
    if (!hits.length) lines.push('   （一个都没有 —— 不是单个元素造成的）');
    for (var k = 0; k < hits.length; k++) lines.push('  ' + hits[k]);

    // 顺便看看根元素自身的样式
    var hcs = getComputedStyle(document.documentElement);
    var bcs = getComputedStyle(document.body);
    lines.push('html:  width=' + hcs.width + ' overflowX=' + hcs.overflowX + ' zoom=' + (hcs.zoom || '1'));
    lines.push('body:  width=' + bcs.width + ' overflowX=' + bcs.overflowX + ' zoom=' + (bcs.zoom || '1'));

    // 明细表这条链
    var chain = ['.ledger-panel', '.table-scroll', 'table', 'thead', 'tr', 'th'];
    lines.push('明细表链路：');
    for (var c = 0; c < chain.length; c++) {
      var n = document.querySelector(chain[c]);
      if (!n) { lines.push('  ' + chain[c] + ' 不存在'); continue; }
      var rr = n.getBoundingClientRect(), ncs = getComputedStyle(n);
      lines.push('  ' + chain[c] +
        '  client=' + n.clientWidth + ' scroll=' + n.scrollWidth +
        '  L=' + Math.round(rr.left) + ' R=' + Math.round(rr.right) +
        '  width=' + ncs.width + ' display=' + ncs.display +
        ' ovx=' + ncs.overflowX + ' whiteSpace=' + ncs.whiteSpace);
    }
    parent.postMessage(lines.join('\\n'), '*');
  }
  function go() {
    var d = document.getElementById('demo-button');
    if (d) d.click();
    setTimeout(run, 700);
  }
  if (document.readyState === 'complete') setTimeout(go, 120);
  else window.addEventListener('load', function () { setTimeout(go, 120); });
})();
</script>`;

function withProbe(doc) {
  const at = doc.lastIndexOf('</body>');
  if (at < 0) throw new Error('产物里找不到 </body>');
  return doc.slice(0, at) + probe + '\n' + doc.slice(at);
}

const dir = mkdtempSync(join(tmpdir(), 'qz-culprit-'));
writeFileSync(join(dir, 'target.html'), withProbe(html), 'utf8');
writeFileSync(join(dir, 'wrap.html'), `<!doctype html><html><head><meta charset="utf-8"><title>WAITING</title></head>
<body style="margin:0;background:#888">
<iframe src="target.html" style="width:${W}px;height:${HEIGHT}px;border:0;display:block"></iframe>
<script>window.addEventListener('message', function (e) { document.title = 'CUL|' + e.data; });</script>
</body></html>`, 'utf8');

const out = execFileSync(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${join(dir, 'prof')}`,
  '--virtual-time-budget=15000',
  '--dump-dom', 'file:///' + join(dir, 'wrap.html').replace(/\\/g, '/'),
], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(无)';
console.log(title.replace(/^CUL\|/, '')
  .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
console.log('\n临时目录：' + dir);
