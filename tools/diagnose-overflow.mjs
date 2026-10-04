#!/usr/bin/env node
/**
 * 横向溢出诊断：精确控制视口宽度，找出把页面撑宽的元素
 *
 * 为什么要这么绕：
 *   无头 Edge 的 --window-size 不改变 documentElement.clientWidth（实测给 393 和 412 都返回 489）。
 *   所以用一个包装页把目标页放进指定尺寸的 <iframe>，iframe 内部就是精确的视口。
 *   file:// 下父页读不到 iframe 的 contentDocument（跨源），于是让 iframe 里的探针
 *   用 postMessage 把结果传出来，父页写进自己的 document.title，再用 --dump-dom 回读。
 *
 * 用法：node tools/diagnose-overflow.mjs [html路径] [宽度,宽度,...]
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const target = process.argv[2] ? resolve(process.argv[2]) : join(ROOT, 'dist', '青账.html');
const widths = (process.argv[3] || '393,412').split(',').map(Number);
const HEIGHT = 851;

const html = readFileSync(target, 'utf8');

const probe = `<script>
(function () {
  function measure() {
    var de = document.documentElement;
    var vw = de.clientWidth;
    var sw = de.scrollWidth;
    var lines = [];
    lines.push('视口=' + vw + '  scrollWidth=' + sw + '  横向溢出=' + (sw - vw) + 'px');
    lines.push('body宽度=' + Math.round(document.body.getBoundingClientRect().width) +
               '  main宽度=' + Math.round((document.querySelector('main') || document.body).getBoundingClientRect().width));
    var out = [];
    var all = document.querySelectorAll('*');
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > vw + 0.5 || r.left < -0.5) {
        out.push('  ' + el.tagName.toLowerCase() +
          (el.id ? '#' + el.id : '') +
          (typeof el.className === 'string' && el.className.trim()
            ? '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.') : '') +
          '  L=' + Math.round(r.left) + ' R=' + Math.round(r.right) + ' W=' + Math.round(r.width) +
          (cs.position !== 'static' ? '  pos=' + cs.position : '') +
          (cs.overflowX === 'auto' || cs.overflowX === 'scroll' ? '  (可横向滚动)' : ''));
      }
    }
    lines.push('越界元素 ' + out.length + ' 个：');
    lines = lines.concat(out.slice(0, 25));
    return lines.join('\\n');
  }
  function go() { try { parent.postMessage(measure(), '*'); } catch (e) { parent.postMessage('ERR ' + e.message, '*'); } }
  if (document.readyState === 'complete') setTimeout(go, 60);
  else window.addEventListener('load', function () { setTimeout(go, 60); });
})();
</script>`;

// ⚠️ 只能替换文档末尾真正的 </body>：SheetJS 源码里含字符串 "</body></html>"，
// 用 replace('</body>', ...) 会把探针注进人家的字符串字面量里，导致脚本全不执行。
function withProbe(doc) {
  const at = doc.lastIndexOf('</body>');
  if (at < 0) throw new Error('产物里找不到 </body>');
  return doc.slice(0, at) + probe + '\n' + doc.slice(at);
}

const dir = mkdtempSync(join(tmpdir(), 'qz-ovf-'));
writeFileSync(join(dir, 'target.html'), withProbe(html), 'utf8');

for (const w of widths) {
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>WAITING</title></head>
<body style="margin:0;background:#888">
<iframe src="target.html" style="width:${w}px;height:${HEIGHT}px;border:0;display:block"></iframe>
<script>
window.addEventListener('message', function (e) { document.title = 'OVF|' + e.data; });
</script>
</body></html>`;
  const wp = join(dir, `wrap-${w}.html`);
  writeFileSync(wp, wrapper, 'utf8');

  const out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(dir, 'prof' + w)}`,
    '--virtual-time-budget=6000',
    '--dump-dom', 'file:///' + wp.replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

  const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(无)';
  console.log('════════ 视口宽度 ' + w + ' ════════');
  console.log(title.replace(/^OVF\|/, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'));
  console.log('');
}
console.log('临时目录：' + dir);
