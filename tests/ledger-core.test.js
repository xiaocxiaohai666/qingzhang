'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../ledger-core.js');
const sample = fs.readFileSync(path.join(__dirname, '../samples/wechat-demo.csv'), 'utf8');
const header = '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注';
const line = '2026-09-03 12:01:02,商户消费,面馆,午餐,支出,¥0.29,零钱,支付成功,420000000000000000001,SHOP-1,/';
const first = () => Core.parseBill(`${header}\n${line}`).records[0];

test('读取带说明行、BOM 和长单号的微信账单，保留原始信息', () => {
  const { records, skipped } = Core.parseBill('\uFEFF' + sample);
  assert.equal(records.length, 8); assert.equal(skipped, 0);
  assert.equal(records[0].transactionId, '420000000000000000001');
  assert.equal(records[1].item, '日用品,水果');
  assert.equal(records[0].amountCents, 3800); assert.equal(records[0].category, '餐饮美食');
  assert.equal(records[6].category, '账户转移');
});
test('解析逗号、转义引号、商品描述换行和 CRLF', () => {
  const text = `${header}\r\n2026-09-03 12:01:02,商户消费,"商家,分店","商品""名称\r\n第二行",支出,¥12.30,零钱,支付成功,ID1,/,/\r\n`;
  const record = Core.parseBill(text).records[0];
  assert.equal(record.counterparty, '商家,分店'); assert.equal(record.item, '商品"名称\r\n第二行');
  assert.throws(() => Core.parseCsv('a,"broken'), /引号不完整/);
});
test('支持表头空格、全角括号与日期简写', () => {
  const text = '交易时间,交易类型,交易对方,商品,收 / 支,金额（元）,支付方式,当前状态,交易单号\n2026/9/3 8:01,商户消费,超市,用品,支出,￥10.2,零钱,支付成功,ID2';
  const record = Core.parseBill(text).records[0]; assert.equal(record.date, '2026-09-03 08:01:00'); assert.equal(record.amountCents, 1020);
});
test('金额使用整数分，拒绝非法金额与超出精度的金额', () => {
  assert.equal(Core.toCents('¥1,234.56'), 123456); assert.equal(Core.toCents('0.10'), 10);
  assert.equal(Core.summarize([first(), { ...first(), amountCents: 10 }]).expense, 39);
  for (const amount of ['abc', '-1.00', '1.001', 'NaN', '1e9']) assert.throws(() => Core.toCents(amount), /金额/);
});
test('无效日期、收支类型与损坏记录会提示跳过，不污染汇总', () => {
  const badDate = line.replace('2026-09-03', '2026-02-30');
  const badDirection = line.replace(',支出,', ',未知,');
  const result = Core.parseBill(`${header}\n${line}\n${badDate}\n${badDirection}\n2026-09-03`);
  assert.equal(result.records.length, 1); assert.equal(result.skipped, 3); assert.equal(result.warnings.length, 3);
  assert.throws(() => Core.normalizeDate('2026-09-03 24:00:00'), /时间无效/);
  assert.equal(Core.normalizeDate('2024-02-29'), '2024-02-29 00:00:00');
  assert.throws(() => Core.parseBill('不是微信账单'), /表头/);
});
test('重复导入及同批重复交易去重，更新状态时保留手动分类', () => {
  const record = { ...first(), category: '学习成长', categorySource: 'manual' };
  const incoming = { ...first(), status: '已全额退款', category: '餐饮美食' };
  const result = Core.mergeRecords([record], [incoming, incoming]);
  assert.equal(result.records.length, 1); assert.equal(result.added, 0); assert.equal(result.repeated, 2);
  assert.equal(result.records[0].status, '已全额退款'); assert.equal(result.records[0].category, '学习成长');
  assert.equal(Core.mergeRecords([], [incoming, incoming]).added, 1);
  assert.equal(record.status, '支付成功');
});
test('无单号时以完整交易字段去重，付款方式不同的交易保留', () => {
  const text = `${header}\n${line.replace('420000000000000000001', '/')}`;
  const record = Core.parseBill(text).records[0];
  assert.equal(Core.mergeRecords([], [record, record]).records.length, 1);
  const second = Core.parseBill(text.replace(',零钱,', ',储蓄卡,')).records[0];
  assert.equal(Core.mergeRecords([record], [second]).records.length, 2);
});
test('独立退款单独统计，不作为收入，也不重复扣减原始支出', () => {
  const { records } = Core.parseBill(sample); const summary = Core.summarize(records);
  assert.equal(summary.expense, 23020); assert.equal(summary.income, 850000); assert.equal(summary.refund, 3900);
  assert.equal(summary.excluded, 2); assert.equal(summary.count, 8);
  assert.equal(records[4].direction, 'refund'); assert.equal(records[5].direction, 'expense');
});
test('向别人退还款项仍按支出记录，普通转账保留收支方向', () => {
  const refundOut = Core.parseBill(`${header}\n${line.replace('商户消费', '转账退还')}`).records[0];
  assert.equal(refundOut.direction, 'expense'); assert.equal(Core.summarize([refundOut]).expense, 29);
  const transfer = Core.parseBill(`${header}\n${line.replace('商户消费', '转账').replace('面馆', '好友')}`).records[0];
  assert.equal(Core.isCounted(transfer), true); assert.notEqual(transfer.category, '账户转移');
});
test('不计入、账户转移、失败和待完成状态不参与汇总', () => {
  const base = first();
  for (const status of ['支付失败', '已关闭', '已撤销', '待支付', '待收钱', '处理中']) assert.equal(Core.isCounted({ ...base, status }), false);
  for (const category of ['不计入', '账户转移']) assert.equal(Core.isCounted({ ...base, category }), false);
  assert.equal(Core.isCounted({ ...base, status: '已退款(￥0.10)' }), true);
  const card = Core.parseBill(`${header}\n${line.replace('商户消费', '信用卡还款')}`).records[0]; assert.equal(card.category, '账户转移');
});
test('商户规则优先于关键词，非法规则忽略', () => {
  assert.equal(Core.parseBill(`${header}\n${line}`, { 面馆: '学习成长' }).records[0].category, '学习成长');
  assert.equal(Core.parseBill(`${header}\n${line}`, { 面馆: '未知分类' }).records[0].category, '餐饮美食');
  const record = { ...first(), counterparty: '__proto__', item: '' };
  assert.equal(Core.inferCategory(record, {}), '其他支出');
});
test('月份、方向、分类和搜索筛选共同作用，包含交易单号搜索', () => {
  const records = Core.parseBill(sample).records;
  assert.equal(Core.filterRecords(records, { month: '2026-09', direction: 'expense', category: '餐饮美食', search: '晚餐' }).length, 1);
  assert.equal(Core.filterRecords(records, { month: '2026-10' }).length, 0);
  assert.equal(Core.filterRecords(records, { search: '00000003' }).length, 1);
});
test('趋势按周汇总，不计退款和转移，跨月不会混入', () => {
  const records = Core.parseBill(sample).records;
  const buckets = Core.getTrend([...records, { ...first(), date: '2026-10-01 00:00:00', amountCents: 99999 }], '2026-09');
  assert.deepEqual(buckets.map(bucket => bucket.expense), [0, 3900, 0, 19120]);
  assert.equal(buckets[2].income, 850000);
  const feb = Core.getTrend([], '2026-02'); assert.equal(feb[3].label, '22–28日');
});
test('备份校验、恢复分类和重建标识，拒绝损坏备份', () => {
  const data = { schemaVersion: 1, records: [{ ...first(), id: 'untrusted', category: '学习成长', categorySource: 'manual' }], rules: { 面馆: '学习成长', 错误: '无效分类' } };
  const restored = Core.validateBackup(JSON.parse(JSON.stringify(data)));
  assert.equal(restored.records[0].id, first().id); assert.equal(restored.records[0].category, '学习成长'); assert.deepEqual(restored.rules, { 面馆: '学习成长' });
  assert.throws(() => Core.validateBackup({ ...data, schemaVersion: 99 }), /备份/);
  assert.throws(() => Core.validateBackup({ ...data, records: [{ ...first(), amountCents: 12.5 }] }), /字段无效/);
  assert.throws(() => Core.validateBackup({ ...data, records: [{ ...first(), direction: 'malicious' }] }), /字段无效/);
});
test('CSV 导出防止公式执行，长单号按文本保留并可再次导入去重', () => {
  const record = { ...first(), counterparty: '=HYPERLINK("example")' };
  const csv = Core.exportCsv([record]);
  assert.equal(csv.charCodeAt(0), 0xfeff); assert.match(csv, /'=HYPERLINK/);
  assert.match(csv, /'420000000000000000001/);
  const roundTrip = Core.parseBill(csv).records[0]; assert.equal(roundTrip.transactionId, record.transactionId);
  assert.equal(Core.mergeRecords([record], [roundTrip]).records.length, 1);
});
test('示例账单是虚构数据，各月日期有效且独立于真实账本', () => {
  const records = Core.makeDemoRecords(new Date(2026, 2, 3)); assert.equal(records.length, 28);
  for (const record of records) { assert.ok(record.transactionId.startsWith('DEMO-')); assert.ok(record.date.startsWith('2026-02-')); assert.equal(Core.normalizeDate(record.date), record.date); }
  assert.doesNotThrow(() => Core.validateBackup({ schemaVersion: 1, records, rules: {} }));
});
