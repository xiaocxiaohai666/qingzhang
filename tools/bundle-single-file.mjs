#!/usr/bin/env node
/**
 * 青账 · 单文件打包器
 *
 * 把 index.html / styles.css / ui-polish.css / ledger-core.js /
 * vendor/xlsx.full.min.js / xlsx-import.js / app.js 合并成一个自包含的
 * HTML 文件，双击即可离线使用。
 *
 * 用法：node tools/bundle-single-file.mjs
 * 产物：dist/青账.html
 *
 * 脚本顺序与 index.html 保持一致，不要随意调整：
 *   ledger-core -> xlsx.full.min -> xlsx-import -> app
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'dist');
const OUT_FILE = join(OUT_DIR, '青账.html');

const CSS_FILES = ['styles.css', 'ui-polish.css'];
const JS_FILES = ['ledger-core.js', 'vendor/xlsx.full.min.js', 'xlsx-import.js', 'app.js'];

const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

// ---- 安全检查：每种宿主元素只关心会终结它自己的序列 ----
// 内联进 <style> 的 CSS：只有 </style 会硬性终结元素
function assertSafeStyle(label, code) {
  if (/<\/style/i.test(code)) {
    throw new Error(`[不安全] ${label} 包含 </style 序列，无法直接内联进 <style>。`);
  }
}

// 内联进 <script> 的 JS：只有 </script 会硬性终结元素。
// 另外，<!-- 会让解析器进入 script data escaped 状态；该状态下 <script 会把解析器带进
// script data double escaped 状态，此后 </script> 将不再终结元素 —— 这是唯一会静默吞掉
// 文档剩余部分的组合，必须拦下。
// 注意：</style 和 </styleSheet> 之类的序列出现在 <script> 里完全无害，不要误报。
function assertSafeScript(label, code) {
  const problems = [];
  if (/<\/script/i.test(code)) problems.push('包含 </script 序列');
  if (/<!--/.test(code) && /<script/i.test(code)) {
    problems.push('同时包含 <!-- 与 <script，会触发 script data double escaped 陷阱');
  }
  if (problems.length) {
    throw new Error(`[不安全] ${label} ${problems.join('；')}，无法直接内联进 <script>。`);
  }
}

const css = CSS_FILES.map((f) => ({ name: f, code: read(f) }));
const js = JS_FILES.map((f) => ({ name: f, code: read(f) }));
for (const { name, code } of css) assertSafeStyle(name, code);
for (const { name, code } of js) assertSafeScript(name, code);

// ---- 改写 index.html ----
let html = read('index.html');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// ⚠️ 关键：凡是要把「代码内容」插进文档的 replace，替换参数必须写成函数。
// String.prototype.replace 的字符串替换里 $& / $` / $' / $$ 有特殊含义，
// 而 SheetJS 压缩代码与 CSS 里大量出现 $ 序列，用字符串替换会静默改坏内联内容。
const put = (text) => () => text;

// 1) 外链样式 -> 内联 <style>
for (const { name, code } of css) {
  const re = new RegExp(`\\s*<link rel="stylesheet" href="${escapeRe(name)}">`);
  if (!re.test(html)) {
    throw new Error(`index.html 中没有找到 <link rel="stylesheet" href="${name}">，结构与预期不符。`);
  }
  html = html.replace(re, put(`\n  <!-- inlined: ${name} -->\n  <style>\n${code.trim()}\n  </style>`));
}

// 2) 外链脚本 -> 内联 <script>，位置从 <head> 移到 </body> 之前
//    原本依赖 defer 保证“DOM 就绪后再执行”；内联脚本会在解析到该位置时立即执行，
//    所以必须放到 body 末尾（app.js 结尾是裸的 load(); render();，没有 DOMContentLoaded 保护）
for (const { name } of js) {
  const re = new RegExp(`\\s*<script src="${escapeRe(name)}" defer><\\/script>`);
  if (!re.test(html)) {
    throw new Error(`index.html 中没有找到 <script src="${name}" defer>，结构与预期不符。`);
  }
  html = html.replace(re, '');
}

const inlineScripts = js
  .map(({ name, code }) => `<!-- inlined: ${name} -->\n<script>\n${code.trim()}\n</script>`)
  .join('\n');

// ⚠️ 必须替换「最后一个」</body>，不能用 replace('</body>', ...)。
// SheetJS 源码里含有字符串 "</body></html>"（它自己会生成 HTML），而此时的 html 里
// 恰好还没内联脚本，所以第一个 </body> 目前仍是真正的闭合标签 —— 但这依赖执行顺序，
// 太脆弱。显式按 lastIndexOf 定位，并断言只有一个 </body>。
const bodyCloseCount = (html.match(/<\/body>/gi) || []).length;
if (bodyCloseCount !== 1) {
  throw new Error(`index.html 里 </body> 出现 ${bodyCloseCount} 次，预期恰好 1 次。`);
}
const bodyAt = html.lastIndexOf('</body>');
if (bodyAt < 0) throw new Error('index.html 缺少 </body> 闭合标签。');
html = html.slice(0, bodyAt) + inlineScripts + '\n</body>' + html.slice(bodyAt + '</body>'.length);

// 3) 加一个内联 SVG 图标，避免浏览器标签页显示空白文档图标
const favicon =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E" +
  "%3Crect width='24' height='24' rx='5' fill='%23f5f7f3'/%3E" +
  "%3Cpath d='M20 4C9 2 3 7 5 15s15 4 15-11Z' fill='none' stroke='%2368945a' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E" +
  "%3Cpath d='M4 21 15 10' fill='none' stroke='%2368945a' stroke-width='1.8' stroke-linecap='round'/%3E" +
  '%3C/svg%3E';
html = html.replace(
  '<meta charset="UTF-8">',
  `<meta charset="UTF-8">\n  <link rel="icon" href="${favicon}">`,
);

// 4) 打包标记
const stamp = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
html = html.replace(
  '<meta name="theme-color" content="#f5f7f3">',
  `<meta name="theme-color" content="#f5f7f3">\n  <!-- 单文件构建 · ${stamp} · 源文件见项目根目录，不要直接编辑本文件 -->`,
);

// ---- 产物自检 ----
// 注意：不能直接在整份文档上数 <style / <script 标签 —— SheetJS 内部有
// "</styleSheet>"、"</style:style>" 这类字符串，会被误统计。
// 正确做法：先把「刚刚插入的那些脚本块」按原样摘出去，再检查文档骨架。
let skeleton = html;
for (const { name, code } of js) {
  const block = `<!-- inlined: ${name} -->\n<script>\n${code.trim()}\n</script>`;
  if (!skeleton.includes(block)) throw new Error(`产物自检失败：未找到 ${name} 的内联脚本块。`);
  skeleton = skeleton.replace(block, '');
}
for (const { name, code } of css) {
  const block = `<!-- inlined: ${name} -->\n  <style>\n${code.trim()}\n  </style>`;
  if (!skeleton.includes(block)) throw new Error(`产物自检失败：未找到 ${name} 的内联样式块。`);
  skeleton = skeleton.replace(block, '');
}

const count = (re) => (skeleton.match(re) || []).length;
const found = {
  script: count(/<script\b/gi),
  scriptEnd: count(/<\/script>/gi),
  style: count(/<style\b/gi),
  styleEnd: count(/<\/style>/gi),
};
if (Object.values(found).some((n) => n !== 0)) {
  throw new Error(
    `产物骨架里残留了未内联的标签：<script> ${found.script} / </script> ${found.scriptEnd} ` +
      `/ <style> ${found.style} / </style> ${found.styleEnd}。`,
  );
}

// 内联内容本身必须成对
const openTags = (html.match(/<script>/gi) || []).length;
const closeTags = (html.match(/<\/script>/gi) || []).length;
if (openTags !== closeTags || openTags !== JS_FILES.length) {
  throw new Error(`内联脚本标签不配对：<script> ${openTags} 个 / </script> ${closeTags} 个。`);
}
const inlineStyleOpen = (html.match(/<!-- inlined: [^>]*\.css -->\n  <style>/gi) || []).length;
const inlineStyleClose = (html.match(/\n  <\/style>/g) || []).length;
if (inlineStyleOpen !== CSS_FILES.length || inlineStyleClose !== CSS_FILES.length) {
  throw new Error(`内联样式标签不配对：<style> ${inlineStyleOpen} 个 / </style> ${inlineStyleClose} 个。`);
}

// 除 data: 与 #fragment 外不得残留任何外部引用。
// 同样只能查骨架 —— SheetJS 里含有用于生成 HTML 的模板串（如 href="'+...+'"），会误报。
const leftovers = skeleton.match(/\b(?:src|href)="(?!data:|#)[^"]*"/g);
if (leftovers) throw new Error(`产物中仍存在外部引用：${leftovers.join(', ')}`);

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_FILE, html, 'utf8');

const kb = (n) => (n / 1024).toFixed(1) + ' KB';
console.log('青账单文件打包完成');
console.log('  输出      ' + OUT_FILE);
console.log('  总大小    ' + kb(Buffer.byteLength(html)));
console.log('  内联样式  ' + css.map(({ name }) => `${name} ${kb(Buffer.byteLength(read(name)))}`).join(' | '));
console.log('  内联脚本  ' + js.map(({ name }) => `${name} ${kb(Buffer.byteLength(read(name)))}`).join(' | '));
console.log('  外部引用  无');
