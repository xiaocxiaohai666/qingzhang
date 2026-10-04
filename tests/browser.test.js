'use strict';
// 使用本机 Edge 的无界面模式；独立临时配置不会访问日常浏览器的数据。
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawn } = require('node:child_process');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const edgePaths = ['C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe', 'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'];

test('浏览器验证：示例隔离、导入去重、分类保存、备份恢复、导出及响应式布局', { timeout: 90000 }, async t => {
  const executable = edgePaths.find(file => fs.existsSync(file));
  if (!executable) { t.skip('本机未安装 Microsoft Edge；可独立运行账单逻辑测试。'); return; }
  const artifacts = path.join(root, '.verification'); fs.mkdirSync(artifacts, { recursive: true });
  const profile = fs.mkdtempSync(path.join(artifacts, 'edge-profile-'));
  const downloads = fs.mkdtempSync(path.join(artifacts, 'downloads-'));
  const browser = spawn(executable, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-extensions', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let startupError, stderr = '', socket, sessionId;
  browser.on('error', error => { startupError = error; }); browser.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-4000); });
  const errors = [], remoteRequests = [], pending = new Map(); let sequence = 0;
  try {
    const portFile = path.join(profile, 'DevToolsActivePort');
    for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) { if (startupError) throw startupError; await wait(100); }
    if (!fs.existsSync(portFile)) throw new Error(`Edge 未启动调试端口：${stderr}`);
    const [port, endpoint] = fs.readFileSync(portFile, 'utf8').trim().split(/\r?\n/);
    socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data);
      if (message.id) { const request = pending.get(message.id); if (!request) return; pending.delete(message.id); clearTimeout(request.timer); message.error ? request.reject(new Error(JSON.stringify(message.error))) : request.resolve(message.result); }
      if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
      if (message.method === 'Network.requestWillBeSent' && /^https?:/i.test(message.params.request.url)) remoteRequests.push(message.params.request.url);
    });
    function send(method, params = {}, session = sessionId) {
      return new Promise((resolve, reject) => { const id = ++sequence; const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) })); });
    }
    const target = await send('Target.createTarget', { url: pathToFileURL(path.join(root, 'index.html')).href }, null);
    const attached = await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null); sessionId = attached.sessionId;
    await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable');
    await send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloads }, null);
    async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text); return result.result.value; }
    async function until(expression) { for (let i = 0; i < 80; i++) { if (await evaluate(expression)) return; await wait(100); } throw new Error(`未满足界面条件：${expression}`); }
    async function click(id) { return evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
    async function chooseFile(selector, file) { const dom = await send('DOM.getDocument'); const node = await send('DOM.querySelector', { nodeId: dom.root.nodeId, selector }); await send('DOM.setFileInputFiles', { nodeId: node.nodeId, files: Array.isArray(file) ? file : [file] }); }
    async function screenshot(name, width) { const metrics = await send('Page.getLayoutMetrics'); const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.ceil(metrics.cssContentSize.height), scale: 1 } }); fs.writeFileSync(path.join(artifacts, name), Buffer.from(image.data, 'base64')); }
    async function screenshotElement(selector, name) { const bounds = await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x:r.left+scrollX, y:r.top+scrollY, width:r.width, height:r.height, scale:1 }; })()`); const image = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, clip: bounds }); fs.writeFileSync(path.join(artifacts, name), Buffer.from(image.data, 'base64')); }
    async function importSample(file = path.join(root, 'samples', 'wechat-demo.csv')) { await wait(100); await evaluate("document.querySelector('[data-action=import]').click()"); await wait(100); await chooseFile('#bill-input', file); await until("!document.getElementById('confirm-import').disabled"); }
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await until("document.readyState === 'complete' && document.getElementById('record-count').textContent.trim() === '0 笔'");
    await screenshot('empty-desktop.png', 1440);
    await click('demo-button'); await until("document.getElementById('record-count').textContent.trim() === '28 笔'");
    assert.equal(await evaluate("localStorage.getItem('qingzhang.wechat-ledger.v1')"), null);
    const bars = await evaluate("Array.from(document.querySelectorAll('.counterparty-column')).map(bar => ({ name:bar.dataset.counterparty, amount:Number(bar.dataset.amountCents), count:Number(bar.dataset.count) }))");
    assert.equal(bars.length, 10); assert.equal(bars[0].name, '城市生活超市'); assert.equal(bars[0].amount, 37530); assert.equal(bars[0].count, 3);
    assert.ok(bars.every((bar, index) => !index || bars[index-1].amount >= bar.amount), '柱子按累计金额从左到右降序排列');
    const chartMonth = await evaluate("document.getElementById('month-filter').value");
    assert.ok((await evaluate("document.getElementById('counterparty-detail').textContent")).includes(`${chartMonth}-03`));
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), true);
    await click('month-trigger');
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), false);
    await screenshotElement('#month-menu', 'month-dropdown.png');
    assert.equal(await evaluate("document.querySelectorAll('#month-menu [data-month-value]').length"), await evaluate("document.getElementById('month-filter').options.length"));
    assert.equal(await evaluate("document.querySelector('#month-menu [data-month-value].selected').dataset.monthValue"), chartMonth);
    await evaluate("document.querySelector('#month-menu [data-month-value=all]').click()");
    assert.equal(await evaluate("document.getElementById('month-filter').value"), 'all');
    assert.equal(await evaluate("document.getElementById('month-trigger-label').textContent"), '全部月份');
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), true);
    await evaluate("document.getElementById('month-trigger').click(); document.getElementById('month-trigger').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), true, 'Esc 可以关闭月份菜单');
    await evaluate("document.getElementById('month-trigger').click(); document.querySelector('#month-menu [data-month-value]').focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))");
    assert.equal(await evaluate("document.activeElement.dataset.monthValue"), 'all', 'ArrowUp 在首项不会越界');
    await evaluate("const options = [...document.querySelectorAll('#month-menu [data-month-value]')]; options.at(-1).focus(); document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }))");
    assert.equal(await evaluate("document.activeElement.dataset.monthValue"), await evaluate("document.querySelector('#month-menu [data-month-value]:last-child').dataset.monthValue"), 'ArrowDown 在末项不会越界');
    await evaluate("document.body.click()");
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), true, '点击组件外部可以关闭月份菜单');
    await evaluate(`document.getElementById('month-trigger').click(); document.querySelector('#month-menu [data-month-value="${chartMonth}"]').click()`);
    assert.equal(await evaluate("document.getElementById('month-filter').value"), chartMonth);
    assert.equal(await evaluate("document.getElementById('month-trigger-label').textContent"), await evaluate(`document.querySelector('#month-menu [data-month-value="${chartMonth}"]').textContent.trim()`));
    assert.equal(await evaluate("document.getElementById('month-menu').hidden"), true);
    await screenshotElement('#counterparties', 'counterparties-demo.png');
    await evaluate("document.querySelector('.counterparty-column').click(); document.querySelector('[data-counterparty-detail]').click()");
    assert.equal(await evaluate("document.querySelectorAll('#ledger-body tr').length"), 3);
    assert.equal(await evaluate("Array.from(document.querySelectorAll('#ledger-body tr')).every(row => row.textContent.includes('城市生活超市'))"), true);
    assert.equal(await evaluate("document.getElementById('counterparty-filter-chip').hidden"), false); await click('reset-filters');
    await evaluate("document.getElementById('counterparty-direction').value='income'; document.getElementById('counterparty-direction').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelector('.counterparty-column').dataset.counterparty"), '示例工作室');
    assert.equal(await evaluate("document.querySelector('.counterparty-column').dataset.amountCents"), '850000');
    await evaluate("document.getElementById('counterparty-direction').value='expense'; document.getElementById('counterparty-direction').dispatchEvent(new Event('change'))");
    const emptyMonth = await evaluate("Array.from(document.getElementById('month-filter').options).find(option => option.value !== 'all' && option.value !== document.getElementById('month-filter').value).value");
    await evaluate(`document.getElementById('month-filter').value=${JSON.stringify(emptyMonth)}; document.getElementById('month-filter').dispatchEvent(new Event('change'))`);
    assert.equal(await evaluate("document.getElementById('counterparty-empty').hidden"), false);
    await evaluate(`document.getElementById('month-filter').value=${JSON.stringify(chartMonth)}; document.getElementById('month-filter').dispatchEvent(new Event('change'))`);
    await evaluate("document.getElementById('counterparty-search').value='不会存在的交易对象'; document.getElementById('counterparty-search').dispatchEvent(new Event('input'))");
    assert.equal(await evaluate("document.getElementById('counterparty-empty').hidden"), false);
    await evaluate("document.getElementById('counterparty-search').value=''; document.getElementById('counterparty-search').dispatchEvent(new Event('input'))");
    await evaluate('window.scrollTo(0, 0)');
    await screenshot('desktop.png', 1440);
    await evaluate("document.querySelector('.category-tag').click()");
    await evaluate("document.getElementById('edit-category').value = '学习成长'; document.getElementById('record-form').requestSubmit()");
    assert.equal(await evaluate("localStorage.getItem('qingzhang.wechat-ledger.v1')"), null);
    await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    assert.equal(await evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1'), true, '手机页面不应横向溢出');
    await screenshot('mobile.png', 390);
    await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1100, deviceScaleFactor: 1, mobile: false });
    await click('exit-demo'); assert.equal(await evaluate("document.getElementById('record-count').textContent.trim()"), '0 笔');
    assert.equal(await evaluate("document.querySelectorAll('#month-menu [data-month-value]').length"), 2, '空账单仍保留全部月份和当前月份选项');
    assert.equal(await evaluate("document.querySelector('#month-menu [data-month-value].selected').dataset.monthValue"), await evaluate("document.getElementById('month-filter').value"));
    assert.match(await evaluate("document.getElementById('bill-input').accept"), /\.xlsx/);
    await importSample(path.join(root, 'samples', 'wechat-demo.xlsx')); assert.match(await evaluate("document.getElementById('import-preview').textContent"), /新增 8 笔/);
    await screenshot('xlsx-import.png', 1440); await click('confirm-import');
    assert.equal(await evaluate("document.getElementById('expense-total').textContent"), '¥230.20');
    assert.equal(await evaluate("document.getElementById('income-total').textContent"), '¥8,500.00');
    assert.equal(await evaluate("document.getElementById('refund-total').textContent"), '¥39.00');
    await evaluate("Array.from(document.querySelectorAll('tbody tr')).find(row => row.textContent.includes('街角面馆')).querySelector('.category-tag').click()");
    await evaluate("document.getElementById('edit-category').value = '学习成长'; document.getElementById('record-form').requestSubmit()");
    let saved = await evaluate("JSON.parse(localStorage.getItem('qingzhang.wechat-ledger.v1'))");
    assert.equal(saved.records.find(record => record.counterparty === '街角面馆').category, '学习成长'); assert.equal(saved.rules['街角面馆'], '学习成长');
    await evaluate("document.getElementById('search').value='不会存在的商户'; document.getElementById('search').dispatchEvent(new Event('input', { bubbles:true }))");
    assert.equal(await evaluate("document.getElementById('ledger-empty').hidden"), false); await click('reset-filters');
    await importSample(); assert.match(await evaluate("document.getElementById('import-preview').textContent"), /新增 0 笔.*8 条重复/); await click('confirm-import');
    await importSample([path.join(root, 'samples', 'wechat-demo.xlsx'), path.join(root, 'samples', 'wechat-demo.csv')]);
    assert.match(await evaluate("document.getElementById('import-preview').textContent"), /新增 0 笔.*16 条重复/); await click('confirm-import');
    await send('Page.reload'); await until("document.readyState === 'complete' && document.getElementById('record-count').textContent.trim() === '8 笔'");
    saved = await evaluate("JSON.parse(localStorage.getItem('qingzhang.wechat-ledger.v1'))"); assert.equal(saved.records.find(record => record.counterparty === '街角面馆').category, '学习成长');
    const backup = path.join(artifacts, 'restore-fixture.json'); fs.writeFileSync(backup, JSON.stringify(saved));
    await evaluate("localStorage.removeItem('qingzhang.wechat-ledger.v1')"); await send('Page.reload'); await until("document.readyState === 'complete' && document.getElementById('record-count').textContent.trim() === '0 笔'");
    await evaluate("document.querySelector('[data-action=manage]').click()"); await chooseFile('#backup-input', backup); await until("document.getElementById('record-count').textContent.trim() === '8 笔' && !document.getElementById('manage-dialog').open");
    assert.equal(await evaluate("JSON.parse(localStorage.getItem('qingzhang.wechat-ledger.v1')).rules['街角面馆']"), '学习成长');
    const invalid = path.join(artifacts, 'invalid.csv'); fs.writeFileSync(invalid, '不是账单\n错误数据');
    await evaluate("document.querySelector('[data-action=import]').click()"); await chooseFile('#bill-input', invalid); await until("!document.getElementById('import-error').hidden");
    assert.equal(await evaluate("document.getElementById('confirm-import').disabled"), true); assert.equal(await evaluate("JSON.parse(localStorage.getItem('qingzhang.wechat-ledger.v1')).records.length"), 8);
    await evaluate("document.querySelector('[data-close=import-dialog]').click()");
    const invalidXlsx = path.join(artifacts, 'invalid.xlsx'); fs.writeFileSync(invalidXlsx, '不是 Excel 文件');
    await wait(100); await evaluate("document.querySelector('[data-action=import]').click()"); await wait(100); await chooseFile('#bill-input', invalidXlsx); await until("!document.getElementById('import-error').hidden");
    assert.match(await evaluate("document.getElementById('import-error').textContent"), /不是有效的 XLSX/);
    assert.equal(await evaluate("document.getElementById('confirm-import').disabled"), true); assert.equal(await evaluate("JSON.parse(localStorage.getItem('qingzhang.wechat-ledger.v1')).records.length"), 8);
    await evaluate("document.querySelector('[data-close=import-dialog]').click()");
    const utf16 = path.join(artifacts, 'utf16.csv'); fs.writeFileSync(utf16, Buffer.from('\ufeff' + fs.readFileSync(path.join(root, 'samples/wechat-demo.csv'), 'utf8'), 'utf16le'));
    await importSample(utf16); assert.match(await evaluate("document.getElementById('import-preview').textContent"), /新增 0 笔/); await click('confirm-import');
    await click('export-csv');
    for (let i = 0; i < 50 && !fs.readdirSync(downloads).some(name => name.endsWith('.csv')); i++) await wait(100);
    const exported = fs.readdirSync(downloads).find(name => name.endsWith('.csv')); assert.ok(exported, '可以下载 CSV 明细');
    const csv = fs.readFileSync(path.join(downloads, exported), 'utf8'); assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv, /学习成长/);
    const paginationBackup = { ...saved, records: [...saved.records, ...Array.from({ length: 27 }, (_, index) => ({ ...saved.records.find(record => record.direction === 'expense'), counterparty: `分页测试商户${String(index).padStart(2, '0')}`, transactionId: `PAGE-TEST-${index}`, amountCents: 10000 + index, category: '其他支出', categorySource: 'auto', status: '支付成功' }))] };
    const paginationFile = path.join(artifacts, 'counterparty-pagination.json'); fs.writeFileSync(paginationFile, JSON.stringify(paginationBackup));
    await evaluate("document.querySelector('[data-action=manage]').click()"); await chooseFile('#backup-input', paginationFile); await until("!document.getElementById('manage-dialog').open");
    await evaluate("document.getElementById('counterparty-limit').value='all'; document.getElementById('counterparty-limit').dispatchEvent(new Event('change'))");
    assert.equal(await evaluate("document.querySelectorAll('.counterparty-column').length"), 20);
    const firstPageLastAmount = await evaluate("Number(Array.from(document.querySelectorAll('.counterparty-column')).at(-1).dataset.amountCents)");
    const axisScale = await evaluate("document.querySelector('.counterparty-axis .axis-top').textContent");
    await click('counterparty-next');
    assert.equal(await evaluate("document.querySelectorAll('.counterparty-column').length"), 11);
    assert.ok(await evaluate(`Number(document.querySelector('.counterparty-column').dataset.amountCents) <= ${firstPageLastAmount}`));
    assert.equal(await evaluate("document.querySelector('.counterparty-axis .axis-top').textContent"), axisScale, '分页使用相同纵轴');
    await click('counterparty-previous'); assert.equal(await evaluate("document.querySelectorAll('.counterparty-column').length"), 20);
    assert.deepEqual(errors, [], '浏览器没有未处理的 JavaScript 错误'); assert.deepEqual(remoteRequests, [], '账单界面没有远程网络请求');
    t.diagnostic('已验证对象金额排序、次数日期、点击精确明细、月份/类型/搜索联动、全对象分页及一致纵轴，以及 XLSX / CSV 导入、去重、保存、备份和响应式布局。');
    t.diagnostic('截图保存在 .verification/desktop.png、.verification/mobile.png。');
    await send('Browser.close', {}, null).catch(() => {});
  } finally {
    if (socket) socket.close();
    for (const request of pending.values()) { clearTimeout(request.timer); request.reject(new Error('Browser test ended')); }
    if (browser.exitCode === null) browser.kill();
  }
});
