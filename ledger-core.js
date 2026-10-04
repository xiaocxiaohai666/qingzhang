(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.WechatLedger = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CATEGORIES = ['餐饮美食', '日用购物', '交通出行', '生活缴费', '住房居住', '医疗健康', '学习成长', '休闲娱乐', '人情往来', '工资收入', '其他收入', '其他支出', '退款', '账户转移', '不计入'];
  const COLORS = ['#68945a', '#a6bb83', '#d6bc82', '#7daaa1', '#abb29c', '#c8a894', '#b6c693'];
  const ICONS = { '餐饮美食': '🍜', '日用购物': '🛍', '交通出行': '🚗', '生活缴费': '💡', '住房居住': '🏡', '医疗健康': '✚', '学习成长': '📚', '休闲娱乐': '🎬', '人情往来': '🎁', '工资收入': '💼', '其他收入': '↙', '其他支出': '◈', '退款': '↶', '账户转移': '⇄', '不计入': '−' };
  const HEADERS = {
    date: ['交易时间', '交易日期'], type: ['交易类型'], counterparty: ['交易对方', '交易对象', '对方'], item: ['商品', '商品名称', '商品说明'],
    direction: ['收/支', '收支', '收支类型'], amount: ['金额(元)', '金额（元）', '金额'], paymentMethod: ['支付方式', '收/付款方式'],
    status: ['当前状态', '交易状态'], transactionId: ['交易单号', '微信交易单号', '微信订单号'], merchantId: ['商户单号', '商户订单号'], remark: ['备注']
  };
  function clean(value) { return String(value ?? '').replace(/^[\s\uFEFF`]+/, '').trim(); }
  function headerKey(value) { return clean(value).replace(/[\s\uFEFF]/g, '').replace(/（/g, '(').replace(/）/g, ')'); }
  function parseCsv(text) {
    if (typeof text !== 'string') throw new Error('账单内容必须是文本。');
    const rows = []; let row = []; let field = ''; let quoted = false;
    text = text.replace(/^\uFEFF/, '');
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (char === '"') {
        if (quoted && text[i + 1] === '"') { field += '"'; i++; }
        else if (quoted) quoted = false;
        else if (!field.trim()) { quoted = true; field = ''; }
        else field += char;
      } else if (char === ',' && !quoted) { row.push(field); field = ''; }
      else if ((char === '\n' || char === '\r') && !quoted) {
        row.push(field); rows.push(row); row = []; field = '';
        if (char === '\r' && text[i + 1] === '\n') i++;
        if (rows.length > 100000) throw new Error('单个文件超过 10 万行，请分段导出账单。');
      } else field += char;
    }
    if (quoted) throw new Error('CSV 引号不完整，文件可能损坏。请重新从微信导出。');
    if (field || row.length) { row.push(field); rows.push(row); }
    return rows;
  }
  function normalizeDate(value) {
    const match = clean(value).match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match) throw new Error('交易时间无法识别');
    const [, ys, ms, ds, hs = '0', mins = '0', ss = '0'] = match;
    const [year, month, day, hour, minute, second] = [ys, ms, ds, hs, mins, ss].map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (year < 2000 || year > 2100 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day || hour > 23 || minute > 59 || second > 59) throw new Error('交易时间无效');
    return `${ys}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${mins.padStart(2, '0')}:${ss.padStart(2, '0')}`;
  }
  function toCents(value) {
    const amount = clean(value).replace(/[¥￥,\s]/g, '');
    if (!/^\+?\d+(?:\.\d{1,2})?$/.test(amount)) throw new Error('金额无效');
    const [whole, fraction = ''] = amount.replace(/^\+/, '').split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (!Number.isSafeInteger(cents) || cents > 10000000000) throw new Error('金额超出支持范围');
    return cents;
  }
  function normalizeDirection(value) {
    const direction = clean(value);
    if (direction === '支出') return 'expense';
    if (direction === '收入') return 'income';
    if (['/', '-', '—', '不计收支', '其他', ''].includes(direction)) return 'neutral';
    throw new Error(`未知收支类型「${direction}」`);
  }
  function isPendingOrFailed(status) { return /(失败|已关闭|交易关闭|已取消|已撤销|未支付|待支付|待收款|待收钱|待确认|处理中|等待收款|等待收钱)/.test(status); }
  function isTransfer(record) {
    return /(零钱提现|零钱充值|充值零钱|零钱通转入|零钱通转出|零钱通提现|零钱通充值|信用卡还款|还信用卡|理财通转入|理财通转出)/.test(record.type);
  }
  function inferCategory(record, rules = {}) {
    const ruleKey = record.counterparty.toLocaleLowerCase();
    if (Object.prototype.hasOwnProperty.call(rules, ruleKey) && CATEGORIES.includes(rules[ruleKey])) return rules[ruleKey];
    if (record.direction === 'refund') return '退款';
    if (isTransfer(record)) return '账户转移';
    if (record.direction === 'neutral') return '不计入';
    const content = `${record.counterparty} ${record.item} ${record.type}`;
    if (record.direction === 'income') return /工资|薪资|薪酬|奖金|发薪/.test(content) ? '工资收入' : '其他收入';
    if (/房租|租金|物业|房贷|公寓/.test(content)) return '住房居住';
    if (/医院|药房|药店|诊所|医疗|挂号|体检/.test(content)) return '医疗健康';
    if (/水费|电费|燃气|话费|宽带|通信|通讯|移动充值|联通充值|电信充值/.test(content)) return '生活缴费';
    if (/滴滴|地铁|公交|高铁|铁路|火车|打车|出租车|停车|加油|出行|机票/.test(content)) return '交通出行';
    if (/餐|饭|面馆|咖啡|奶茶|茶饮|瑞幸|星巴克|肯德基|麦当劳|汉堡|火锅|烧烤|外卖|饺子|披萨|甜品|早餐|食堂/.test(content)) return '餐饮美食';
    if (/书店|课程|学费|培训|教材|学习|教育|考试/.test(content)) return '学习成长';
    if (/电影|影院|游戏|演出|音乐|KTV|健身|门票|游乐|视频会员/i.test(content)) return '休闲娱乐';
    if (/红包|礼物|礼金|份子/.test(content)) return '人情往来';
    if (/超市|便利店|商店|购物|京东|淘宝|拼多多|服饰|百货|商场|生活用品|日用品/.test(content)) return '日用购物';
    return '其他支出';
  }
  function fingerprint(record) {
    // 使用完整字段作为无单号记录的标识，避免短哈希碰撞导致漏记。
    return `row:${JSON.stringify([record.date, record.type, record.counterparty, record.item, record.direction, record.amountCents, record.paymentMethod, record.merchantId, record.remark])}`;
  }
  function identify(record) { return record.transactionId && !['/', '-', '—'].includes(record.transactionId) ? `wechat:${record.transactionId}` : fingerprint(record); }
  function findBillHeader(rows) {
    for (let i = 0; i < Math.min(rows.length, 100); i++) {
      const keys = rows[i].map(headerKey); const candidate = {};
      for (const [field, aliases] of Object.entries(HEADERS)) candidate[field] = keys.findIndex(key => aliases.some(alias => headerKey(alias) === key));
      if (candidate.date >= 0 && candidate.amount >= 0 && candidate.direction >= 0) return { headerIndex: i, columns: candidate };
    }
    return null;
  }
  function parseBill(text, rules = {}) { return parseBillRows(parseCsv(text), rules); }
  function parseBillRows(rows, rules = {}, options = {}) {
    if (!Array.isArray(rows) || rows.length > 100000) throw new Error('单个账单超过 10 万行，请分段导出。');
    const header = findBillHeader(rows);
    if (!header) throw new Error('未找到微信个人账单表头。需要包含「交易时间」「收/支」「金额」列，请选择用于个人对账的 XLSX 或 CSV。');
    const { headerIndex, columns } = header;
    const records = []; const warnings = []; let skipped = 0;
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row.some(cell => clean(cell))) continue;
      if (/^(说明|注[:：]|温馨提示|[-=]{3,})/.test(clean(row[0])) || row.map(headerKey).includes('交易时间')) continue;
      const get = field => columns[field] >= 0 ? clean(row[columns[field]]) : '';
      try {
        if (options.rowErrors?.has(i)) throw new Error(options.rowErrors.get(i));
        if (row.length <= Math.max(columns.date, columns.amount, columns.direction)) throw new Error('列数不足');
        const record = { date: normalizeDate(get('date')), amountCents: toCents(get('amount')), direction: normalizeDirection(get('direction')) };
        for (const field of ['type', 'counterparty', 'item', 'paymentMethod', 'status', 'transactionId', 'merchantId', 'remark']) record[field] = get(field);
        for (const field of ['transactionId', 'merchantId']) record[field] = record[field].replace(/^'/, '');
        if ((record.direction !== 'expense' && /退款|退还/.test(record.type)) || (record.direction === 'income' && /退款|退还/.test(record.item))) record.direction = 'refund';
        record.id = identify(record); record.category = inferCategory(record, rules); record.categorySource = 'auto';
        records.push(record);
      } catch (error) { skipped++; if (warnings.length < 8) warnings.push(`第 ${i + 1} 行：${error.message}`); }
    }
    if (!records.length) throw new Error(skipped ? `没有可导入的有效交易，${skipped} 行无法识别。${warnings[0] ? ` ${warnings[0]}` : ''}` : '账单中没有交易记录。');
    return { records, skipped, warnings };
  }
  function mergeRecords(existing, incoming) {
    const map = new Map(existing.map(record => [record.id, { ...record }])); let added = 0; let repeated = 0;
    for (const raw of incoming) {
      const record = { ...raw }; const old = map.get(record.id);
      if (old) {
        repeated++;
        if (old.categorySource === 'manual') { record.category = old.category; record.categorySource = 'manual'; }
      } else added++;
      map.set(record.id, record);
      if (map.size > 100000) throw new Error('本机账本最多支持 10 万笔记录，请分账本保存。');
    }
    return { records: [...map.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)), added, repeated };
  }
  function isCounted(record) { return !['账户转移', '不计入'].includes(record.category) && record.direction !== 'neutral' && !isPendingOrFailed(record.status); }
  function summarize(records) {
    const result = { expense: 0, income: 0, refund: 0, count: records.length, excluded: 0, categories: [] }; const categories = new Map();
    for (const record of records) {
      if (!isCounted(record)) { result.excluded++; continue; }
      result[record.direction] += record.amountCents;
      if (record.direction === 'expense') categories.set(record.category, (categories.get(record.category) || 0) + record.amountCents);
    }
    result.categories = [...categories].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
    return result;
  }
  function filterRecords(records, filters = {}) {
    const search = String(filters.search || '').trim().toLocaleLowerCase();
    return records.filter(record => (!filters.month || filters.month === 'all' || record.date.startsWith(filters.month)) && (!filters.direction || filters.direction === 'all' || record.direction === filters.direction) && (!filters.category || filters.category === 'all' || record.category === filters.category) && (filters.counterparty == null || record.counterparty.trim() === String(filters.counterparty).trim()) && (!filters.countedOnly || isCounted(record)) && (!search || [record.counterparty, record.item, record.transactionId, record.remark, record.type].some(value => value.toLocaleLowerCase().includes(search))));
  }
  function groupCounterparties(records, options = {}) {
    const groups = new Map();
    const search = String(options.search || '').trim().toLocaleLowerCase();
    for (const record of filterRecords(records, { month: options.month, direction: options.direction || 'expense' })) {
      if (!isCounted(record)) continue;
      const counterparty = record.counterparty.trim();
      const name = counterparty || '未提供交易对象';
      if (search && !name.toLocaleLowerCase().includes(search)) continue;
      let group = groups.get(counterparty);
      if (!group) { group = { counterparty, name, amountCents: 0, count: 0, firstDate: record.date, lastDate: record.date, dates: new Set() }; groups.set(counterparty, group); }
      group.amountCents += record.amountCents; group.count++;
      if (record.date < group.firstDate) group.firstDate = record.date;
      if (record.date > group.lastDate) group.lastDate = record.date;
      group.dates.add(record.date.slice(0, 10));
    }
    return [...groups.values()].map(group => ({ ...group, dates: [...group.dates].sort() })).sort((a, b) => b.amountCents - a.amountCents || b.count - a.count || a.name.localeCompare(b.name, 'zh-CN'));
  }
  function getTrend(records, month) {
    let buckets;
    if (month && month !== 'all') {
      const [year, number] = month.split('-').map(Number); const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
      buckets = [{ key: '1', label: '1–7日' }, { key: '2', label: '8–14日' }, { key: '3', label: '15–21日' }, { key: '4', label: `22–${days}日` }];
    } else buckets = [...new Set(records.map(record => record.date.slice(0, 7)))].sort().slice(-6).map(key => ({ key, label: `${Number(key.slice(5))}月`, fullLabel: key }));
    buckets = buckets.map(bucket => ({ ...bucket, expense: 0, income: 0 })); const map = new Map(buckets.map(bucket => [bucket.key, bucket]));
    for (const record of records) {
      if (!isCounted(record) || !['expense', 'income'].includes(record.direction)) continue;
      if (month && month !== 'all' && !record.date.startsWith(month)) continue;
      const key = month && month !== 'all' ? String(Math.min(4, Math.ceil(Number(record.date.slice(8, 10)) / 7))) : record.date.slice(0, 7);
      const bucket = map.get(key); if (bucket) bucket[record.direction] += record.amountCents;
    }
    return buckets;
  }
  function money(cents) { return (cents / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function csvCell(value) {
    let text = String(value ?? '');
    if (/^[\s]*[=+@-]/.test(text) || /^[\t\r]/.test(text) || /^\d{15,}$/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }
  function exportCsv(records) {
    const headers = ['交易时间', '交易类型', '交易对方', '商品', '收/支', '金额(元)', '支付方式', '当前状态', '交易单号', '商户单号', '备注', '青账分类', '参与金额汇总'];
    const names = { expense: '支出', income: '收入', refund: '收入', neutral: '/' };
    return '\uFEFF' + [headers, ...records.map(record => [record.date, record.type, record.counterparty, record.item, names[record.direction], (record.amountCents / 100).toFixed(2), record.paymentMethod, record.status, record.transactionId, record.merchantId, record.remark, record.category, isCounted(record) ? '是' : '否'])].map(row => row.map(csvCell).join(',')).join('\r\n');
  }
  function validateBackup(data) {
    if (!data || data.schemaVersion !== 1 || !Array.isArray(data.records) || data.records.length > 100000) throw new Error('不是受支持的青账备份文件。');
    const stringFields = ['type', 'counterparty', 'item', 'paymentMethod', 'status', 'transactionId', 'merchantId', 'remark'];
    const records = data.records.map((source, index) => {
      if (!source || typeof source !== 'object') throw new Error(`备份的第 ${index + 1} 条记录无效。`);
      const record = { date: normalizeDate(source.date), amountCents: source.amountCents, direction: source.direction, category: source.category, categorySource: source.categorySource };
      if (!Number.isSafeInteger(record.amountCents) || record.amountCents < 0 || record.amountCents > 10000000000 || !['expense', 'income', 'refund', 'neutral'].includes(record.direction) || !CATEGORIES.includes(record.category) || !['auto', 'manual'].includes(record.categorySource)) throw new Error(`备份的第 ${index + 1} 条记录字段无效。`);
      for (const field of stringFields) { if (typeof source[field] !== 'string' || source[field].length > 20000) throw new Error(`备份的第 ${index + 1} 条记录字段无效。`); record[field] = source[field]; }
      record.id = identify(record); return record;
    });
    const rules = Object.fromEntries(Object.entries(data.rules && typeof data.rules === 'object' && !Array.isArray(data.rules) ? data.rules : {}).filter(([key, category]) => key.length < 20000 && CATEGORIES.includes(category)));
    return { schemaVersion: 1, records: mergeRecords([], records).records, rules };
  }
  function makeDemoRecords(now = new Date()) {
    const base = new Date(now.getFullYear(), now.getMonth() - 1, 1); const month = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}`;
    const rows = [
      ['27','18:26:08','街角面馆','晚餐','expense',3800,'餐饮美食'],['27','08:42:16','瑞幸咖啡','拿铁 · 美好的一天','expense',990,'餐饮美食'],['26','21:15:30','城市生活超市','日用品与水果','expense',12860,'日用购物'],['26','19:07:44','滴滴出行','下班回家','expense',2460,'交通出行'],
      ['25','12:11:09','小满食堂','午餐','expense',2600,'餐饮美食'],['24','16:30:12','独立书店','阅读计划 · 两本新书','expense',9600,'学习成长'],['23','20:18:29','光影电影院','周末电影','expense',7800,'休闲娱乐'],['22','09:12:05','中国移动','手机话费','expense',5000,'生活缴费'],
      ['21','18:43:16','青禾火锅','和朋友的晚餐','expense',18600,'餐饮美食'],['20','10:09:11','城市地铁','乘车码','expense',600,'交通出行'],['19','14:27:51','生活用品商店','收纳盒','expense',6900,'日用购物'],['18','12:05:33','小满食堂','午餐','expense',2600,'餐饮美食'],
      ['17','19:01:27','好友小林','生日红包','expense',20000,'人情往来'],['16','08:20:01','瑞幸咖啡','冰美式','expense',990,'餐饮美食'],['15','10:00:00','示例工作室','工资收入','income',850000,'工资收入'],['14','17:50:33','城市生活超市','本周食材','expense',16320,'日用购物'],
      ['13','11:02:07','社区药房','常备药品','expense',4580,'医疗健康'],['12','09:22:08','城市地铁','乘车码','expense',600,'交通出行'],['11','12:26:11','街角面馆','午餐','expense',3200,'餐饮美食'],['10','20:32:56','电力公司','电费缴纳','expense',8760,'生活缴费'],
      ['09','17:02:18','生活用品商店','商品退款','refund',3900,'退款'],['08','15:15:00','生活用品商店','水杯 · 后续退款','expense',3900,'日用购物'],['07','18:20:43','花园披萨','周末晚餐','expense',8800,'餐饮美食'],['06','10:45:00','微信支付','零钱提现','neutral',100000,'账户转移'],
      ['05','14:55:10','城市公交','乘车码','expense',200,'交通出行'],['04','09:15:20','好友小周','聚餐分摊收款','income',6800,'其他收入'],['03','13:02:41','城市生活超市','洗衣液与零食','expense',8350,'日用购物'],['02','18:10:05','小满食堂','晚餐','expense',2800,'餐饮美食']
    ];
    return rows.map((row, index) => { const [day, time, counterparty, item, direction, amountCents, category] = row; const record = { date: `${month}-${day} ${time}`, counterparty, item, direction, amountCents, category, categorySource: 'auto', type: direction === 'refund' ? '商户消费退款' : category === '账户转移' ? '零钱提现' : direction === 'income' ? '转账' : '商户消费', paymentMethod: direction === 'expense' ? '招商银行储蓄卡' : '零钱', status: direction === 'refund' ? '退款成功' : index === 21 ? '已全额退款' : direction === 'income' ? '已收钱' : '支付成功', transactionId: `DEMO-${month}-${index + 1}`, merchantId: '', remark: '虚构示例数据' }; record.id = identify(record); return record; }).sort((a, b) => b.date.localeCompare(a.date));
  }
  return { CATEGORIES, COLORS, ICONS, clean, parseCsv, normalizeDate, toCents, normalizeDirection, inferCategory, findBillHeader, parseBill, parseBillRows, mergeRecords, isCounted, summarize, filterRecords, groupCounterparties, getTrend, money, exportCsv, validateBackup, makeDemoRecords };
});
