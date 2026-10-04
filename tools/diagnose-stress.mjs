#!/usr/bin/env node
/**
 * 溢出压力测试：在固定宽度的 iframe 里，逐个施加"手机常见变量"，
 * 每次都从干净页面开始，看哪种会把页面撑宽。
 *
 * 用来区分「CSS 潜在缺陷」和「WebView 视口问题」——
 * 如果某个变量能稳定复现溢出，那就是真 bug，改 CSS 就能修。
 *
 * 用法：node tools/diagnose-stress.mjs [html路径] [宽度]
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

const SCENARIOS = [
  ['基线（什么都不改）', ''],

  ['字号放大 130%（-webkit-text-size-adjust）',
    `document.documentElement.style.setProperty('-webkit-text-size-adjust','130%','important');`],

  ['字号放大 150%',
    `document.documentElement.style.setProperty('-webkit-text-size-adjust','150%','important');`],

  ['页面缩放 130%（body zoom，模拟"显示大小"变大）',
    `document.body.style.zoom='1.3';`],

  ['金额 ¥123,456.78（6 位）',
    `['expense-total','income-total','refund-total'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='¥123,456.78';});
     var r=document.getElementById('record-count');if(r)r.innerHTML='123,456 <small>笔</small>';`],

  ['金额 ¥123,456,789.00（9 位）',
    `['expense-total','income-total','refund-total'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='¥123,456,789.00';});`],

  ['超长交易对象名（无空格）',
    `var c=document.getElementById('counterparty-caption');
     if(c)c.textContent='微信支付某某某科技有限责任公司某某分公司第二业务事业部';`],

  ['基线 + 真实导入数据（示例账本渲染完整图表）',
    `document.getElementById('demo-button').click();`],

  ['示例账本 + 金额 6 位 + 字号 150%',
    `document.getElementById('demo-button').click();
     document.documentElement.style.setProperty('-webkit-text-size-adjust','150%','important');
     setTimeout(function(){['expense-total','income-total'].forEach(function(id){var e=document.getElementById(id);if(e)e.textContent='¥123,456.78';});},200);`],
];

const makeProbe = (code) => `<script>
(function () {
  function report() {
    var de = document.documentElement;
    var vw = de.clientWidth, sw = de.scrollWidth;
    var lines = ['视口' + vw + ' · scrollWidth=' + sw + ' · 溢出 ' + (sw - vw) + 'px'];

    // 按右边界从大到小排，最宽的 8 个（能直接看出谁把页面撑开）
    // 关键：被某个 overflow 容器裁剪掉的元素不会撑开页面，
    // 必须把它们排除，否则排序会被"滚动容器里的宽内容"占满，看不到真凶。
    function clippedByAncestor(el) {
      var p = el.parentElement;
      while (p && p !== document.body) {
        var pcs = getComputedStyle(p);
        if (/auto|scroll|hidden|clip/.test(pcs.overflowX)) return true;
        p = p.parentElement;
      }
      return false;
    }

    var all = document.querySelectorAll('*');
    var ranked = [];
    for (var i = 0; i < all.length; i++) {
      var el = all[i], cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      var r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (clippedByAncestor(el)) continue;
      ranked.push({ el: el, right: Math.round(r.right), left: Math.round(r.left),
                    w: Math.round(r.width), cs: cs });
    }
    ranked.sort(function (a, b) { return b.right - a.right; });
    lines.push('  未被裁剪、右边界最大的 10 个元素（真凶在这里）：');
    for (var k = 0; k < Math.min(ranked.length, 10); k++) {
      var o = ranked[k], e = o.el;
      lines.push('    ' + (e.tagName.toLowerCase()) + (e.id ? '#' + e.id : '') +
        (typeof e.className === 'string' && e.className.trim()
          ? '.' + e.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') +
        '  L=' + o.left + ' R=' + o.right + ' W=' + o.w +
        '  ovx=' + o.cs.overflowX + ' minW=' + o.cs.minWidth +
        (o.right > vw + 0.5 ? '   <<< 超出视口' : ''));
    }

    // 交易对象图表这条链的几何关系
    var chain = ['.counterparty-panel', '.counterparty-chart', '.counterparty-chart-scroll', '.counterparty-plot'];
    lines.push('  交易对象图表链路：');
    for (var c = 0; c < chain.length; c++) {
      var n = document.querySelector(chain[c]);
      if (!n) { lines.push('    ' + chain[c] + ' 不存在'); continue; }
      var rr = n.getBoundingClientRect(), ncs = getComputedStyle(n);
      lines.push('    ' + chain[c] + '  client=' + n.clientWidth + ' scroll=' + n.scrollWidth +
        '  R=' + Math.round(rr.right) + '  ovx=' + ncs.overflowX +
        ' flex=' + ncs.flex + ' minW=' + ncs.minWidth + ' display=' + ncs.display);
    }
    return lines.join('\\n');
  }
  function go() {
    try {
      var code = ${JSON.stringify(code)};
      if (code) (new Function(code))();
    } catch (e) { }
    setTimeout(function () { parent.postMessage(report(), '*'); }, 260);
  }
  if (document.readyState === 'complete') setTimeout(go, 100);
  else window.addEventListener('load', function () { setTimeout(go, 100); });
})();
</script>`;

function withProbe(doc, code) {
  const at = doc.lastIndexOf('</body>');
  if (at < 0) throw new Error('产物里找不到 </body>');
  return doc.slice(0, at) + makeProbe(code) + '\n' + doc.slice(at);
}

const dir = mkdtempSync(join(tmpdir(), 'qz-stress-'));

console.log('iframe 宽度 ' + W + 'px（页面实得视口宽 = 该值 − 15px 滚动条）\n');

for (let i = 0; i < SCENARIOS.length; i++) {
  const [name, code] = SCENARIOS[i];
  writeFileSync(join(dir, `t${i}.html`), withProbe(html, code), 'utf8');
  const wrapper = `<!doctype html><html><head><meta charset="utf-8"><title>WAITING</title></head>
<body style="margin:0;background:#888">
<iframe src="t${i}.html" style="width:${W}px;height:${HEIGHT}px;border:0;display:block"></iframe>
<script>window.addEventListener('message', function (e) { document.title = 'OVF|' + e.data; });</script>
</body></html>`;
  writeFileSync(join(dir, `w${i}.html`), wrapper, 'utf8');

  const out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${join(dir, 'p' + i)}`,
    '--virtual-time-budget=7000',
    '--dump-dom', 'file:///' + join(dir, `w${i}.html`).replace(/\\/g, '/'),
  ], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });

  const title = (out.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '(无)';
  const body = title.replace(/^OVF\|/, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  console.log('◆ ' + name);
  console.log('     ' + body.trim());
  console.log('');
}
console.log('临时目录：' + dir);
