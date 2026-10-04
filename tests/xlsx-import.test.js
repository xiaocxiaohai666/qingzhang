'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../ledger-core.js');
const { parseXlsx } = require('../xlsx-import.js');
const { XLSX, makeWorkbook, encodeWorkbook } = require('./xlsx-fixtures.js');
const csv = fs.readFileSync(path.join(__dirname, '../samples/wechat-demo.csv'), 'utf8');
function cell(fixture, row, field) { return fixture.sheet[XLSX.utils.encode_cell({ r: fixture.transactionRows[row], c: fixture.columns[field] })]; }
function read(fixture, options) { return parseXlsx(encodeWorkbook(fixture.workbook, options)); }

test('读取实际 XLSX 文件，跳过说明工作表，识别金额、日期和长文本单号', () => {
  const result = parseXlsx(fs.readFileSync(path.join(__dirname, '../samples/wechat-demo.xlsx')));
  assert.equal(result.records.length, 8); assert.equal(result.skipped, 0); assert.deepEqual(result.sheets, ['微信支付账单']);
  assert.deepEqual(result.records, Core.parseBill(csv).records);
  const summary = Core.summarize(result.records); assert.equal(summary.expense, 23020); assert.equal(summary.income, 850000); assert.equal(summary.refund, 3900);
});
test('Excel 数字日期保留原始时间，不受电脑时区影响，兼容 1904 日期系统', () => {
  const result = read(makeWorkbook({ date1904: true }));
  assert.equal(result.records[0].date, '2026-09-27 18:26:08');
  assert.equal(result.records[3].date, '2026-09-15 10:00:00');
  const fixture = makeWorkbook(); Object.assign(cell(fixture, 0, 'date'), { t: 's', v: '2026/9/27 18:26:08' });
  assert.equal(read(fixture).records[0].date, '2026-09-27 18:26:08');
});
test('金额按原始数值读取，显示格式不会把分位金额或零金额改掉', () => {
  const fixture = makeWorkbook(); Object.assign(cell(fixture, 0, 'amount'), { t: 'n', v: 0.29, z: '"¥"#,##0' });
  Object.assign(cell(fixture, 1, 'amount'), { t: 'n', v: 0 });
  const records = read(fixture).records; assert.equal(records[0].amountCents, 29); assert.equal(records[1].amountCents, 0);
});
test('同一账单跨 CSV / XLSX 去重，并保留手动分类', () => {
  const existing = Core.parseBill(csv).records; existing[0].category = '学习成长'; existing[0].categorySource = 'manual';
  const fixture = makeWorkbook(); cell(fixture, 0, 'status').v = '已全额退款';
  const merged = Core.mergeRecords(existing, read(fixture).records);
  assert.equal(merged.added, 0); assert.equal(merged.repeated, 8); assert.equal(merged.records.length, 8);
  const record = merged.records.find(item => item.id === existing[0].id); assert.equal(record.category, '学习成长'); assert.equal(record.status, '已全额退款');
});
test('多个账单工作表均能读取，重复数据交由公共合并逻辑去重', () => {
  const fixture = makeWorkbook(); XLSX.utils.book_append_sheet(fixture.workbook, structuredClone(fixture.sheet), '第二份账单');
  const result = read(fixture); assert.equal(result.records.length, 16); assert.equal(result.sheets.length, 2);
  assert.equal(Core.mergeRecords([], result.records).records.length, 8);
});
test('支持 XLSX 共享字符串和普通字符串存储', () => {
  for (const bookSST of [true, false]) {
    const result = read(makeWorkbook(), { bookSST }); assert.equal(result.records[1].item, '日用品,水果'); assert.equal(result.records[0].transactionId, '420000000000000000001');
  }
});
test('损坏文件、伪装成 XLSX 的 CSV 和没有账单表头的工作簿提供错误', () => {
  assert.throws(() => parseXlsx(Buffer.from(csv)), /不是有效的 XLSX/);
  assert.throws(() => parseXlsx(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x01])), /无法读取/);
  const workbook = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['普通表格', '金额'], ['商品', 10]]), '普通表格');
  assert.throws(() => parseXlsx(encodeWorkbook(workbook)), /未找到微信个人账单表头/);
});
test('日期和金额损坏的交易明确提示跳过，其余交易可以预览', () => {
  const fixture = makeWorkbook(); Object.assign(cell(fixture, 0, 'date'), { t: 's', v: '2026-02-30' });
  cell(fixture, 1, 'amount').v = 12.345;
  const result = read(fixture); assert.equal(result.records.length, 6); assert.equal(result.skipped, 2);
  assert.match(result.warnings[0], /微信支付账单.*交易时间无效/); assert.match(result.warnings[1], /金额无效/);
});
test('超过 15 位的数字单号不能悄悄变成错误的去重标识', () => {
  const fixture = makeWorkbook(); Object.assign(cell(fixture, 0, 'transactionId'), { t: 'n', v: 420000000000000000001 });
  const result = read(fixture); assert.equal(result.records.length, 7); assert.equal(result.skipped, 1); assert.match(result.warnings[0], /超过 15 位/);
});
test('金额等关键字段的公式缓存值不作为原始交易导入', () => {
  const fixture = makeWorkbook(); Object.assign(cell(fixture, 0, 'amount'), { f: '1+2', v: 3 });
  const result = read(fixture); assert.equal(result.skipped, 1); assert.match(result.warnings[0], /金额包含公式/);
});
test('XLSX 同样应用已记住的商户分类规则', () => {
  const fixture = makeWorkbook(); const result = parseXlsx(encodeWorkbook(fixture.workbook), { 街角面馆: '学习成长' });
  assert.equal(result.records[0].category, '学习成长');
});
