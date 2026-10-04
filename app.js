(() => {
  'use strict';
  const Core = window.WechatLedger;
  const $ = id => document.getElementById(id);
  const STORAGE_KEY = 'qingzhang.wechat-ledger.v1';
  const PAGE_SIZE = 10;
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const state = { records: [], rules: {}, demo: false, demoRecords: [], demoRules: {}, filters: { month: currentMonth, direction: 'all', category: 'all', search: '', counterparty: null, countedOnly: false }, page: 1, counterpartyChart: { direction: 'expense', limit: '10', search: '', page: 1, selected: null } };
  let storageAvailable = true, unreadableStorage = null, toastTimer, pendingImport, importGeneration = 0, editingId;
  let counterpartyGroups = [];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const activeRecords = () => state.demo ? state.demoRecords : state.records;
  const monthLabel = month => `${month.slice(0, 4)}年${Number(month.slice(5))}月`;
  function toast(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500); }
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(STORAGE_KEY);
      if (raw) { const saved = Core.validateBackup(JSON.parse(raw)); state.records = saved.records; state.rules = saved.rules; }
    } catch (error) {
      storageAvailable = false;
      if (raw) { unreadableStorage = raw; $('storage-warning').textContent = '已有本地账本无法读取。目前使用临时账本；请在「数据管理」导出原始备份，再恢复有效备份或清空损坏的数据。'; }
    }
    if (state.records.length) state.filters.month = state.records[0].date.slice(0, 7);
    $('storage-warning').hidden = storageAvailable;
  }
  function snapshot() { return { schemaVersion: 1, records: state.records, rules: state.rules, savedAt: new Date().toISOString() }; }
  function persist() {
    if (unreadableStorage !== null) return false;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot())); storageAvailable = true; }
    catch (error) { storageAvailable = false; }
    $('storage-warning').hidden = storageAvailable;
    return storageAvailable;
  }
  function renderMonth() {
    const months = [...new Set([currentMonth, ...activeRecords().map(record => record.date.slice(0, 7))])].sort().reverse();
    if (state.filters.month !== 'all' && !months.includes(state.filters.month)) state.filters.month = months[0];
    $('month-filter').innerHTML = '<option value="all">全部月份</option>' + months.map(month => `<option value="${month}">${monthLabel(month)}</option>`).join('');
    $('month-filter').value = state.filters.month;
    $('month-trigger-label').textContent = state.filters.month === 'all' ? '全部月份' : monthLabel(state.filters.month);
    $('month-menu').innerHTML = ['all', ...months].map(month => {
      const label = month === 'all' ? '全部月份' : monthLabel(month);
      const selected = month === state.filters.month;
      const check = selected ? icon('check') : '';
      return '<button type="button" class="pretty-select-option' + (selected ? ' selected' : '') + '" role="option" aria-selected="' + selected + '" data-month-value="' + month + '"><span>' + label + '</span>' + check + '</button>';
    }).join('');
  }

  function setMonthMenu(open) {
    const menu = $('month-menu');
    const trigger = $('month-trigger');
    menu.hidden = !open;
    trigger.setAttribute('aria-expanded', String(open));
    $('month-picker').classList.toggle('is-open', open);
    if (open) {
      const selected = menu.querySelector('.pretty-select-option.selected');
      selected?.scrollIntoView({ block: 'nearest' });
    }
  }
  function renderOverview() {
    const records = Core.filterRecords(activeRecords(), { month: state.filters.month });
    const summary = Core.summarize(records);
    $('expense-total').textContent = `¥${Core.money(summary.expense)}`;
    $('income-total').textContent = `¥${Core.money(summary.income)}`;
    $('refund-total').textContent = `¥${Core.money(summary.refund)}`;
    $('record-count').innerHTML = `${summary.count.toLocaleString('zh-CN')} <small>笔</small>`;
    $('record-caption').textContent = summary.excluded ? `其中 ${summary.excluded} 笔不参与金额汇总` : '包括账户转移与不计入记录';
    renderDonut(summary);
    renderTrend(records);
    renderCounterparties();
  }
  function renderDonut(summary) {
    const radius = 77, circumference = 2 * Math.PI * radius;
    if (!summary.expense) {
      $('donut').innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="暂无支出记录"><circle cx="100" cy="100" r="${radius}" fill="none" stroke="#edf2e8" stroke-width="21"/></svg><div class="donut-center"><span>账单支出</span><strong>¥0.00</strong></div>`;
      $('category-legend').innerHTML = '<div class="muted small">还没有支出记录<br>导入后，看看钱花在哪里。</div>';
      return;
    }
    let offset = 0;
    const circles = summary.categories.map((category, index) => {
      const length = category.amount / summary.expense * circumference;
      const segment = `<circle cx="100" cy="100" r="${radius}" fill="none" stroke="${Core.COLORS[index % Core.COLORS.length]}" stroke-width="21" stroke-dasharray="${Math.max(.5, length - 2.8)} ${circumference - Math.max(.5, length - 2.8)}" stroke-dashoffset="${-offset}"><title>${escape(category.name)}：¥${Core.money(category.amount)}</title></circle>`;
      offset += length; return segment;
    }).join('');
    $('donut').innerHTML = `<svg viewBox="0 0 200 200" role="img" aria-label="支出分类分布">${circles}</svg><div class="donut-center"><span>账单支出</span><strong>¥${Core.money(summary.expense)}</strong></div>`;
    let legend = summary.categories.slice(0, 6).map((category, index) => `<button class="legend-row" data-category="${escape(category.name)}" title="查看${escape(category.name)}明细"><i class="legend-dot" style="background:${Core.COLORS[index % Core.COLORS.length]}"></i><span>${escape(category.name)}</span><strong>¥${Core.money(category.amount)}</strong><span class="legend-percent">${Math.round(category.amount / summary.expense * 100)}%</span></button>`).join('');
    if (summary.categories.length > 6) { const amount = summary.categories.slice(6).reduce((total, category) => total + category.amount, 0); legend += `<span class="legend-row"><i class="legend-dot" style="background:#b6c693"></i><span>其余 ${summary.categories.length - 6} 类</span><strong>¥${Core.money(amount)}</strong></span>`; }
    $('category-legend').innerHTML = legend;
  }
  function renderTrend(records) {
    const buckets = Core.getTrend(records, state.filters.month);
    $('trend-caption').textContent = state.filters.month === 'all' ? '最近 6 个有记录月份 · 退款单独统计' : '按周查看原始账单金额 · 退款单独统计';
    const maximum = Math.max(0, ...buckets.map(bucket => Math.max(bucket.expense, bucket.income)));
    if (!maximum) { $('trend-chart').innerHTML = `<div class="chart-empty">${icon('grid')}<span>导入账单，让收支的节奏浮现</span></div>`; return; }
    const magnitude = 10 ** Math.floor(Math.log10(maximum / 100));
    const scale = Math.ceil(maximum / 100 / magnitude / 2) * magnitude * 2 * 100;
    const width = 460, height = 188, left = 54, right = 12, base = 159, top = 18, graphHeight = base - top;
    const axisMoney = cents => cents >= 1000000 ? `${+(cents / 1000000).toFixed(1)}万` : (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
    let svg = '';
    for (let i = 0; i <= 3; i++) { const value = scale * i / 3, y = base - graphHeight * i / 3; svg += `<line x1="${left}" y1="${y}" x2="${width - right}" y2="${y}" stroke="#edf1e8" stroke-dasharray="3 4"/><text x="${left - 10}" y="${y + 3}" text-anchor="end" fill="#a7b098" font-size="9">${axisMoney(value)}</text>`; }
    const step = (width - left - right) / buckets.length;
    buckets.forEach((bucket, index) => {
      const center = left + step * (index + .5), barWidth = Math.min(20, step * .2);
      for (const [direction, x, color] of [['expense', center - barWidth - 3, '#69985b'], ['income', center + 3, '#c7d7ad']]) {
        const barHeight = bucket[direction] / scale * graphHeight;
        svg += `<rect x="${x}" y="${base - barHeight}" width="${barWidth}" height="${barHeight}" rx="3" fill="${color}"><title>${escape(bucket.fullLabel || bucket.label)}${direction === 'expense' ? '支出' : '收入'}：¥${Core.money(bucket[direction])}</title></rect>`;
      }
      svg += `<text x="${center}" y="${base + 22}" text-anchor="middle" fill="#98a38a" font-size="10">${escape(bucket.label)}</text>`;
    });
    $('trend-chart').innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="支出和收入趋势图">${svg}</svg>`;
  }
  function renderCounterparties() {
    const chart = state.counterpartyChart;
    counterpartyGroups = Core.groupCounterparties(activeRecords(), { month: state.filters.month, direction: chart.direction, search: chart.search });
    const pool = chart.limit === 'all' ? counterpartyGroups : counterpartyGroups.slice(0, Number(chart.limit));
    const pages = chart.limit === 'all' ? Math.max(1, Math.ceil(pool.length / 20)) : 1;
    chart.page = Math.max(1, Math.min(chart.page, pages));
    const start = chart.limit === 'all' ? (chart.page - 1) * 20 : 0;
    const shown = chart.limit === 'all' ? pool.slice(start, start + 20) : pool;
    const directionNames = { expense: '支出', income: '收入', refund: '退款', all: '全部交易' };
    const scope = chart.direction === 'all' ? '金额相加，不做收支抵消' : chart.direction === 'expense' ? '原始付款金额，含已退款原单' : chart.direction === 'income' ? '不含退款' : '仅独立退款记录';
    $('counterparty-caption').textContent = `${state.filters.month === 'all' ? '全部月份' : monthLabel(state.filters.month)} · ${counterpartyGroups.length} 个交易对象 · ${scope}`;
    $('counterparty-direction').value = chart.direction; $('counterparty-limit').value = chart.limit;
    $('counterparty-empty').hidden = !!shown.length; $('counterparty-chart').hidden = !shown.length; $('counterparty-swipe-hint').hidden = !shown.length;
    $('counterparty-pagination').hidden = pages < 2;
    $('counterparty-page-info').textContent = `按全局金额排名显示第 ${start + 1}–${start + shown.length} 个，共 ${pool.length} 个对象`;
    $('counterparty-previous').disabled = chart.page <= 1; $('counterparty-next').disabled = chart.page >= pages;
    if (!shown.length) {
      chart.selected = null; $('counterparty-detail').hidden = true; $('counterparty-chart').innerHTML = '';
      $('counterparty-empty').querySelector('p').textContent = !activeRecords().length ? '导入账单后，这里会显示交易对象、累计金额、次数和日期。' : chart.search ? '没有找到匹配的交易对象，试试其他关键词。' : '这个月份没有参与汇总的此类交易，可以切换月份或收支类型。';
      return;
    }
    if (!shown.some(group => group.counterparty === chart.selected)) chart.selected = shown[0].counterparty;
    // 所有分页使用同一纵轴，翻页不会夸大小额交易的柱高。
    const maximum = Math.max(0, counterpartyGroups[0].amountCents);
    const magnitude = maximum ? 10 ** Math.floor(Math.log10(maximum)) : 100;
    const scale = maximum ? Math.ceil(maximum / magnitude / 2) * magnitude * 2 : 100;
    const axisMoney = cents => cents >= 1000000 ? `${+(cents / 1000000).toFixed(1)}万` : (cents / 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
    const columns = shown.map((group, index) => {
      const height = group.amountCents / scale * 184;
      const firstDay = group.firstDate.slice(0, 10), lastDay = group.lastDate.slice(0, 10);
      const dateLabel = firstDay === lastDay ? firstDay : `${firstDay} 至 ${lastDay}`;
      const selected = group.counterparty === chart.selected;
      return `<button class="counterparty-column${selected ? ' selected' : ''}" data-counterparty="${escape(group.counterparty)}" data-amount-cents="${group.amountCents}" data-count="${group.count}" data-first-date="${group.firstDate}" data-last-date="${group.lastDate}" aria-pressed="${selected}" aria-label="${escape(group.name)}，累计${directionNames[chart.direction]} ${Core.money(group.amountCents)} 元，${group.count} 笔交易，日期 ${dateLabel}" title="${escape(group.name)} · ¥${Core.money(group.amountCents)} · ${group.count} 笔 · ${dateLabel}"><span class="counterparty-bar-stage"><span class="counterparty-bar-amount" style="bottom:${(height + 24).toFixed(3)}px">¥${Core.money(group.amountCents)}</span><span class="counterparty-bar-fill" style="height:${height.toFixed(3)}px"></span></span><span class="counterparty-name"><i>${start + index + 1}</i><span>${escape(group.name)}</span></span><span class="counterparty-count">${group.count} 笔交易</span><span class="counterparty-date">${firstDay}${firstDay === lastDay ? '' : `<span>至 ${lastDay}</span>`}</span></button>`;
    }).join('');
    $('counterparty-chart').innerHTML = `<div class="counterparty-axis" aria-hidden="true"><span class="axis-unit">金额 / 元</span><span class="axis-top">${axisMoney(scale)}</span><span class="axis-middle">${axisMoney(scale / 2)}</span><span class="axis-bottom">0</span></div><div class="counterparty-chart-scroll" tabindex="0" aria-label="交易对象柱状图，可左右滚动"><div class="counterparty-plot" style="grid-template-columns:repeat(${shown.length},minmax(100px,1fr));min-width:${shown.length * 100}px"><div class="counterparty-grid-lines" aria-hidden="true"><i></i><i></i><i></i></div>${columns}</div></div>`;
    renderCounterpartyDetail(counterpartyGroups.find(group => group.counterparty === chart.selected));
  }
  function renderCounterpartyDetail(group) {
    $('counterparty-detail').hidden = !group; if (!group) return;
    const chart = state.counterpartyChart;
    const directionNames = { expense: '累计支出', income: '累计收入', refund: '累计退款', all: '累计交易金额' };
    const chips = group.dates.slice(0, 6).map(date => `<span>${date}</span>`).join('');
    $('counterparty-detail').innerHTML = `<div class="counterparty-detail-heading"><div><span class="eyebrow">当前交易对象</span><h3>${escape(group.name)}</h3></div><button class="button subtle" data-counterparty-detail="${escape(group.counterparty)}">查看全部 ${group.count} 笔交易 ${icon('arrow')}</button></div><div class="counterparty-detail-metrics"><div><span>${directionNames[chart.direction]}</span><strong>¥${Core.money(group.amountCents)}</strong></div><div><span>交易次数</span><strong>${group.count} <small>笔</small></strong></div><div><span>交易日期</span><strong>${group.dates.length} <small>天</small></strong></div><div class="counterparty-time-range"><span>首笔 → 最近一笔</span><p>${group.firstDate}${group.firstDate === group.lastDate ? '' : `<br>→ ${group.lastDate}`}</p></div></div><div class="counterparty-date-list"><span class="counterparty-date-label">发生交易的日期</span>${chips}${group.dates.length > 6 ? `<span class="muted">还有 ${group.dates.length - 6} 天，可在明细查看</span>` : ''}</div><p class="counterparty-detail-note">只统计参与金额汇总的交易。点击任意柱子切换对象；完整交易时间和商品信息可在明细查看。</p>`;
  }
  function renderTable() {
    const records = activeRecords();
    const filtered = Core.filterRecords(records, state.filters);
    const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)); state.page = Math.max(1, Math.min(state.page, pages));
    const shown = filtered.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    $('category-filter').innerHTML = '<option value="all">全部分类</option>' + Core.CATEGORIES.map(category => `<option value="${category}">${category}</option>`).join('');
    $('category-filter').value = state.filters.category;
    $('direction-filter').value = state.filters.direction;
    $('search').value = state.filters.search;
    const filtersActive = state.filters.direction !== 'all' || state.filters.category !== 'all' || !!state.filters.search || state.filters.counterparty !== null;
    $('reset-filters').hidden = !filtersActive;
    $('counterparty-filter-chip').hidden = state.filters.counterparty === null;
    $('counterparty-filter-label').textContent = `交易对象：${state.filters.counterparty || '未提供交易对象'}${state.filters.countedOnly ? ' · 图表内交易' : ''}`;
    $('ledger-caption').textContent = `${state.filters.month === 'all' ? '全部月份' : monthLabel(state.filters.month)} · ${filtered.length} 笔记录${filtersActive ? ' · 以下筛选仅作用于明细' : ' · 点击分类可修改'}`;
    $('ledger-body').innerHTML = shown.map(record => {
      const counted = Core.isCounted(record);
      const sign = record.direction === 'expense' ? '−' : ['income', 'refund'].includes(record.direction) ? '+' : '';
      return `<tr><td><div class="merchant-cell"><span class="merchant-avatar" aria-hidden="true">${Core.ICONS[record.category] || '◈'}</span><div><strong title="${escape(record.counterparty)}">${escape(record.counterparty || record.type || '未提供交易对象')}</strong><small title="${escape(record.item)}">${escape(record.item || record.type || '无商品描述')}</small></div></div></td><td><button class="category-tag" data-record-id="${escape(record.id)}" aria-label="修改${escape(record.counterparty)}的分类">${escape(record.category)}</button></td><td class="date-cell">${record.date.slice(5, 10).replace('-', ' / ')}<span>${record.date.slice(0, 4)} · ${record.date.slice(11, 16)}</span></td><td class="amount-cell ${record.direction}">${sign}¥${Core.money(record.amountCents)}</td><td class="status-cell ${counted ? '' : 'excluded'}"><span class="dot"></span>${escape(counted ? record.status || '已记录' : '不计入汇总')}</td><td><button class="view-button" data-record-id="${escape(record.id)}">详情</button></td></tr>`;
    }).join('');
    $('ledger-empty').hidden = filtered.length > 0;
    if (!filtered.length) {
      $('ledger-empty').innerHTML = records.length ? `<div class="empty-icon">${icon('search')}</div><h3>这次筛选没有找到记录</h3><p>换一个月份、关键词，或清除明细筛选试试。</p><button class="button subtle" data-action="reset">查看全部交易</button>` : `<div class="empty-icon">${icon('file')}</div><h3>你的账本，等第一笔日常</h3><p>直接导入微信 XLSX 账单，分类和汇总交给青账。</p><button class="button primary" data-action="import">导入第一份账单 ${icon('arrow')}</button><button class="link-button" data-action="demo">先看看示例账本</button>`;
    }
    $('table-footer').hidden = !filtered.length;
    $('page-info').textContent = `显示 ${(state.page - 1) * PAGE_SIZE + 1}–${Math.min(state.page * PAGE_SIZE, filtered.length)} 笔，共 ${filtered.length} 笔`;
    $('page-number').textContent = `${state.page} / ${pages}`;
    $('previous-page').disabled = state.page === 1;
    $('next-page').disabled = state.page === pages;
    $('export-csv').disabled = !filtered.length;
  }
  function render() { renderMonth(); renderOverview(); renderTable(); $('demo-banner').hidden = !state.demo; $('mode-badge').hidden = !state.demo; $('demo-button').textContent = state.demo ? '退出示例' : '体验示例'; }
  function resetFilters(allMonths = false) { state.filters.direction = 'all'; state.filters.category = 'all'; state.filters.search = ''; state.filters.counterparty = null; state.filters.countedOnly = false; if (allMonths) state.filters.month = 'all'; state.page = 1; render(); }
  function switchDemo(value) { state.demo = value; if (value) { state.demoRecords = Core.makeDemoRecords(); state.demoRules = {}; } const records = activeRecords(); state.filters.month = records[0]?.date.slice(0, 7) || currentMonth; resetFilters(); }
  function openImport() { $('import-dialog').showModal(); }
  async function decodeFile(file) {
    if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请按较短时间范围导出账单。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
    if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (error) { return new TextDecoder('gb18030', { fatal: true }).decode(bytes); }
  }
  async function prepareImport(files) {
    if (!files?.length) return;
    const generation = ++importGeneration;
    pendingImport = null; $('confirm-import').disabled = true; $('import-error').hidden = true; $('import-preview').hidden = true;
    $('dropzone-title').textContent = '正在读取账单…';
    const allRecords = [], details = [], errors = []; let skipped = 0;
    for (const file of Array.from(files)) {
      try {
        if (/\.zip$/i.test(file.name)) throw new Error('请先解压 ZIP，再导入其中的 XLSX 或 CSV 文件。');
        if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error('请选择 XLSX 或 CSV 账单文件。');
        if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB，请按较短时间范围导出账单。');
        const result = /\.xlsx$/i.test(file.name) ? window.WechatXlsx.parseXlsx(await file.arrayBuffer(), state.rules) : Core.parseBill(await decodeFile(file), state.rules);
        for (const record of result.records) allRecords.push(record);
        skipped += result.skipped;
        details.push(`${file.name}：${result.records.length} 条有效交易${result.sheets ? `，工作表：${result.sheets.join('、')}` : ''}${result.skipped ? `，${result.skipped} 行无法识别` : ''}`);
        details.push(...result.warnings);
      } catch (error) { errors.push(`${file.name}：${error.message}`); }
    }
    if (generation !== importGeneration) return;
    $('dropzone-title').textContent = `${files.length} 个文件已读取 · 点击可重新选择`;
    if (errors.length) { $('import-error').textContent = errors.join('\n'); $('import-error').hidden = false; }
    if (!allRecords.length) return;
    let merged;
    try { merged = Core.mergeRecords(state.records, allRecords); }
    catch (error) { $('import-error').textContent = error.message; $('import-error').hidden = false; return; }
    pendingImport = { records: merged.records, added: merged.added, repeated: merged.repeated, skipped };
    $('import-preview').innerHTML = `<strong>将新增 ${merged.added} 笔记录</strong>，识别到 ${merged.repeated} 条重复记录。<br>重复记录更新账单字段，并保留已有手动分类。${state.demo ? '<br>导入后将回到你的真实账本，示例数据不会混入。' : ''}${skipped ? `<br><strong>${skipped} 行无法识别，将跳过；请检查下方原因。</strong>` : ''}<ul>${details.map(detail => `<li>${escape(detail)}</li>`).join('')}</ul>`;
    $('import-preview').hidden = false; $('confirm-import').disabled = false;
  }
  function confirmImport() {
    if (!pendingImport) return;
    const result = pendingImport;
    state.records = result.records; state.demo = false; persist();
    state.filters.month = state.records[0]?.date.slice(0, 7) || currentMonth; resetFilters();
    $('import-dialog').close();
    toast(`已导入：新增 ${result.added} 笔，重复 ${result.repeated} 条${result.skipped ? `，跳过 ${result.skipped} 行` : ''}${storageAvailable ? '' : '。当前无法本地保存，请导出备份'}`);
  }
  function openRecord(id) {
    const record = activeRecords().find(item => item.id === id); if (!record) return;
    editingId = id; $('record-title').textContent = record.counterparty || record.type || '交易记录';
    const labels = { expense: '支出', income: '收入', refund: '退款', neutral: '其他 / 转移' };
    const fields = [['交易时间', record.date], ['交易类型', `${labels[record.direction]} · ${record.type || '未提供'}`], ['商品', record.item || '未提供'], ['支付方式', record.paymentMethod || '未提供'], ['原始状态', record.status || '未提供'], ['交易单号', record.transactionId || '未提供'], ['商户单号', record.merchantId || '未提供'], ['备注', record.remark || '无'], ['统计口径', Core.isCounted(record) ? record.direction === 'refund' ? '独立退款，不计入收入，不从支出中扣减' : '按账单原始金额参与汇总' : '不参与金额汇总']];
    $('record-detail').innerHTML = `<div class="detail-amount">¥${Core.money(record.amountCents)}</div><dl class="detail-grid">${fields.map(([label, value]) => `<dt>${label}</dt><dd>${escape(value)}</dd>`).join('')}</dl>`;
    $('edit-category').innerHTML = Core.CATEGORIES.map(category => `<option value="${category}">${category}</option>`).join(''); $('edit-category').value = record.category;
    $('remember-rule').disabled = !record.counterparty; $('remember-rule').checked = !!record.counterparty;
    $('record-edit-note').textContent = state.demo ? '示例修改不会保存到真实账本' : '手动分类会在重复导入时保留';
    $('record-dialog').showModal();
  }
  function saveRecord(event) {
    event.preventDefault(); const record = activeRecords().find(item => item.id === editingId); if (!record) return;
    record.category = $('edit-category').value; record.categorySource = 'manual';
    if ($('remember-rule').checked && record.counterparty) {
      const rules = state.demo ? state.demoRules : state.rules;
      Object.defineProperty(rules, record.counterparty.toLocaleLowerCase(), { value: record.category, enumerable: true, configurable: true, writable: true });
    }
    if (!state.demo) persist(); render(); $('record-dialog').close(); toast(state.demo ? '已修改示例分类，仅用于体验' : '分类已保存');
  }
  function download(content, name, type) {
    const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function openManage() {
    $('manage-caption').textContent = `真实账本有 ${state.records.length} 笔记录、${Object.keys(state.rules).length} 条分类规则。${state.demo ? '此处管理真实账本，不包含当前示例。' : '建议定期备份，方便迁移到其他浏览器。'}`;
    $('backup-button').disabled = !state.records.length && unreadableStorage === null; $('clear-button').disabled = !state.records.length && !Object.keys(state.rules).length && unreadableStorage === null;
    $('manage-dialog').showModal();
  }
  async function restoreBackup(file) {
    if (!file) return;
    try {
      if (file.size > 30 * 1024 * 1024) throw new Error('备份文件超过 30 MB。');
      if (unreadableStorage !== null) throw new Error('请先导出已有原始备份，再通过清空账本移除无法读取的数据。');
      const backup = Core.validateBackup(JSON.parse(await file.text())); const merged = Core.mergeRecords(state.records, backup.records);
      state.records = merged.records; state.rules = { ...backup.rules, ...state.rules }; state.demo = false; persist();
      state.filters.month = state.records[0]?.date.slice(0, 7) || currentMonth; resetFilters(); $('manage-dialog').close(); toast(`备份已合并，新增 ${merged.added} 笔记录${storageAvailable ? '' : '；当前无法本地保存，请重新备份'}`);
    } catch (error) { toast(`恢复失败：${error.message}`); }
    finally { $('backup-input').value = ''; }
  }
  document.addEventListener('click', event => {
    if (!event.target.closest('#month-picker')) setMonthMenu(false);
    const close = event.target.closest('[data-close]'); if (close) { $(close.dataset.close).close(); return; }
    const action = event.target.closest('[data-action]');
    if (action) {
      if (action.dataset.action === 'import') openImport();
      if (action.dataset.action === 'help') $('help-dialog').showModal();
      if (action.dataset.action === 'manage') openManage();
      if (action.dataset.action === 'demo') switchDemo(true);
      if (action.dataset.action === 'reset') resetFilters(true);
      return;
    }
    const detail = event.target.closest('[data-record-id]'); if (detail) { openRecord(detail.dataset.recordId); return; }
    const bar = event.target.closest('button[data-counterparty]'); if (bar) { state.counterpartyChart.selected = bar.dataset.counterparty; document.querySelectorAll('.counterparty-column').forEach(column => { const selected = column.dataset.counterparty === bar.dataset.counterparty; column.classList.toggle('selected', selected); column.setAttribute('aria-pressed', String(selected)); }); renderCounterpartyDetail(counterpartyGroups.find(group => group.counterparty === bar.dataset.counterparty)); return; }
    const counterpartyDetail = event.target.closest('button[data-counterparty-detail]'); if (counterpartyDetail) { state.filters.counterparty = counterpartyDetail.dataset.counterpartyDetail; state.filters.countedOnly = true; state.filters.direction = state.counterpartyChart.direction; state.filters.category = 'all'; state.filters.search = ''; state.page = 1; renderTable(); $('ledger').scrollIntoView({ behavior: 'smooth' }); return; }
    const category = event.target.closest('button[data-category]'); if (category) { state.filters.category = category.dataset.category; state.filters.direction = 'expense'; state.filters.counterparty = null; state.filters.countedOnly = false; state.page = 1; renderTable(); $('ledger').scrollIntoView({ behavior: 'smooth' }); return; }
    const monthOption = event.target.closest('[data-month-value]'); if (monthOption) { $('month-filter').value = monthOption.dataset.monthValue; $('month-filter').dispatchEvent(new Event('change', { bubbles: true })); setMonthMenu(false); return; }
    const nav = event.target.closest('.nav-item[href]'); if (nav) document.querySelectorAll('.nav-item[href]').forEach(item => item.classList.toggle('active', item === nav));
  });
  $('demo-button').addEventListener('click', () => switchDemo(!state.demo)); $('exit-demo').addEventListener('click', () => switchDemo(false));
  $('month-trigger').addEventListener('click', () => setMonthMenu($('month-menu').hidden));
  $('month-trigger').addEventListener('keydown', event => {
    const options = [...$('month-menu').querySelectorAll('.pretty-select-option')];
    const selectedIndex = Math.max(0, options.findIndex(option => option.getAttribute('aria-selected') === 'true'));
    if (event.key === 'Escape') { setMonthMenu(false); return; }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault(); setMonthMenu(true);
      options[Math.max(0, Math.min(options.length - 1, selectedIndex + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus();
    } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setMonthMenu($('month-menu').hidden); }
  });
  $('month-menu').addEventListener('keydown', event => {
    const options = [...$('month-menu').querySelectorAll('.pretty-select-option')];
    const currentIndex = options.indexOf(document.activeElement);
    if (event.key === 'Escape') { event.preventDefault(); setMonthMenu(false); $('month-trigger').focus(); }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); options[Math.max(0, Math.min(options.length - 1, currentIndex + (event.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); options[event.key === 'Home' ? 0 : options.length - 1]?.focus(); }
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); document.activeElement?.click(); }
  });
  $('month-filter').addEventListener('change', event => { state.filters.month = event.target.value; state.page = 1; state.counterpartyChart.page = 1; renderMonth(); renderOverview(); renderTable(); });
  $('counterparty-direction').addEventListener('change', event => { state.counterpartyChart.direction = event.target.value; state.counterpartyChart.page = 1; state.counterpartyChart.selected = null; renderCounterparties(); });
  $('counterparty-limit').addEventListener('change', event => { state.counterpartyChart.limit = event.target.value; state.counterpartyChart.page = 1; renderCounterparties(); });
  $('counterparty-search').addEventListener('input', event => { state.counterpartyChart.search = event.target.value; state.counterpartyChart.page = 1; renderCounterparties(); });
  $('counterparty-previous').addEventListener('click', () => { state.counterpartyChart.page--; renderCounterparties(); });
  $('counterparty-next').addEventListener('click', () => { state.counterpartyChart.page++; renderCounterparties(); });
  $('clear-counterparty-filter').addEventListener('click', () => { state.filters.counterparty = null; state.filters.countedOnly = false; state.page = 1; renderTable(); });
  $('direction-filter').addEventListener('change', event => { state.filters.direction = event.target.value; state.page = 1; renderTable(); });
  $('category-filter').addEventListener('change', event => { state.filters.category = event.target.value; state.page = 1; renderTable(); });
  $('search').addEventListener('input', event => { state.filters.search = event.target.value; state.page = 1; renderTable(); });
  $('reset-filters').addEventListener('click', () => resetFilters());
  $('previous-page').addEventListener('click', () => { state.page--; renderTable(); }); $('next-page').addEventListener('click', () => { state.page++; renderTable(); });
  $('bill-input').addEventListener('change', event => prepareImport(event.target.files)); $('confirm-import').addEventListener('click', confirmImport);
  $('import-dialog').addEventListener('close', () => { importGeneration++; pendingImport = null; $('bill-input').value = ''; $('confirm-import').disabled = true; $('import-preview').hidden = true; $('import-error').hidden = true; $('dropzone-title').textContent = '点击选择，或把账单拖到这里'; });
  $('dropzone').addEventListener('dragover', event => { event.preventDefault(); $('dropzone').classList.add('drag-over'); });
  $('dropzone').addEventListener('dragleave', () => $('dropzone').classList.remove('drag-over'));
  $('dropzone').addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('drag-over'); prepareImport(event.dataTransfer.files); });
  $('record-form').addEventListener('submit', saveRecord);
  $('export-csv').addEventListener('click', () => { const records = Core.filterRecords(activeRecords(), state.filters); download(Core.exportCsv(records), `${state.demo ? '示例-' : ''}青账明细-${state.filters.month}.csv`, 'text/csv;charset=utf-8'); toast(`已导出筛选后的 ${records.length} 笔明细，完整恢复请使用 JSON 备份`); });
  $('backup-button').addEventListener('click', () => { download(unreadableStorage ?? JSON.stringify(snapshot(), null, 2), `${unreadableStorage !== null ? '原始-' : ''}青账备份-${currentMonth}.json`, 'application/json;charset=utf-8'); toast('备份已下载，请妥善保存'); });
  $('backup-input').addEventListener('change', event => restoreBackup(event.target.files[0]));
  $('clear-button').addEventListener('click', () => {
    if (!window.confirm('清空当前浏览器中的真实账本和分类规则？此操作无法撤销，请确认已经导出备份。')) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { toast('无法清空本地存储，请在浏览器设置中处理。'); return; }
    state.records = []; state.rules = {}; unreadableStorage = null; storageAvailable = true; $('storage-warning').hidden = true; state.demo = false; state.filters.month = currentMonth; resetFilters(); $('manage-dialog').close(); toast('本机账本已清空');
  });
  load(); render();
})();
