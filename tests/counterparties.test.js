'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Core = require('../ledger-core.js');
const base = Core.makeDemoRecords(new Date(2026, 9, 3))[0];
function record(counterparty, amountCents, date, extra = {}) { return { ...base, counterparty, amountCents, date, direction: 'expense', status: '支付成功', category: '其他支出', ...extra }; }

test('同一对象多笔交易累加金额、次数，日期排序并按天去重', () => {
  const rows = [record('超市', 1001, '2026-09-12 18:01:00'), record('超市', 29, '2026-09-03 12:00:00'), record('超市', 200, '2026-09-12 08:00:00')];
  const before = JSON.stringify(rows);
  const [group] = Core.groupCounterparties(rows);
  assert.equal(group.amountCents, 1230); assert.equal(group.count, 3);
  assert.equal(group.firstDate, '2026-09-03 12:00:00'); assert.equal(group.lastDate, '2026-09-12 18:01:00');
  assert.deepEqual(group.dates, ['2026-09-03', '2026-09-12']); assert.equal(JSON.stringify(rows), before);
});
test('金额从大到小排列，金额相同时次数更多的对象优先', () => {
  const rows = [record('少次数', 3000, '2026-09-01 00:00:00'), record('最多金额', 9000, '2026-09-02 00:00:00'), record('多次数', 1000, '2026-09-01 00:00:00'), record('多次数', 2000, '2026-09-02 00:00:00')];
  assert.deepEqual(Core.groupCounterparties(rows).map(group => group.name), ['最多金额', '多次数', '少次数']);
});
test('失败、待完成和账户转移不计入对象金额或交易次数', () => {
  const rows = [record('商家', 100, '2026-09-01 00:00:00'), record('商家', 200, '2026-09-02 00:00:00', { status: '支付失败' }), record('商家', 300, '2026-09-03 00:00:00', { status: '待支付' }), record('商家', 400, '2026-09-04 00:00:00', { category: '账户转移' }), record('商家', 500, '2026-09-05 00:00:00', { category: '不计入' })];
  const [group] = Core.groupCounterparties(rows); assert.equal(group.amountCents, 100); assert.equal(group.count, 1); assert.equal(group.lastDate, rows[0].date);
});
test('月份和收支口径筛选独立，全部交易金额相加而非相互抵消', () => {
  const rows = [record('对象', 1200, '2026-09-01 00:00:00'), record('对象', 1000, '2026-09-02 00:00:00', { direction: 'income' }), record('对象', 200, '2026-09-03 00:00:00', { direction: 'refund' }), record('对象', 9999, '2026-10-01 00:00:00')];
  assert.equal(Core.groupCounterparties(rows, { month: '2026-09' })[0].amountCents, 1200);
  assert.equal(Core.groupCounterparties(rows, { month: '2026-09', direction: 'income' })[0].amountCents, 1000);
  assert.equal(Core.groupCounterparties(rows, { month: '2026-09', direction: 'refund' })[0].amountCents, 200);
  assert.equal(Core.groupCounterparties(rows, { month: '2026-09', direction: 'all' })[0].amountCents, 2400);
});
test('按对象精确筛选明细，金额和次数与图表一致，不混入相似名称', () => {
  const rows = [record(' 超市 ', 100, '2026-09-01 00:00:00'), record('超市', 200, '2026-09-02 00:00:00'), record('超市分店', 300, '2026-09-03 00:00:00'), record('超市', 400, '2026-09-04 00:00:00', { status: '支付失败' })];
  const group = Core.groupCounterparties(rows).find(item => item.counterparty === '超市');
  const details = Core.filterRecords(rows, { counterparty: '超市', direction: 'expense', countedOnly: true });
  assert.equal(details.length, group.count); assert.equal(Core.summarize(details).expense, group.amountCents);
  assert.equal(Core.filterRecords(rows, { counterparty: '超市' }).length, 3);
});
test('空对象、零金额、搜索和特殊名称都能安全分组', () => {
  const rows = [record('', 0, '2026-09-01 00:00:00'), record('__proto__', 29, '2026-09-02 00:00:00'), record('Coffee 商家', 100, '2026-09-03 00:00:00')];
  const groups = Core.groupCounterparties(rows); assert.equal(groups.length, 3); assert.equal(groups[2].name, '未提供交易对象'); assert.equal(groups[2].count, 1);
  assert.equal(Core.groupCounterparties(rows, { search: 'coffee' })[0].amountCents, 100);
  assert.equal(Core.filterRecords(rows, { counterparty: '' }).length, 1); assert.deepEqual(Core.groupCounterparties([]), []);
});
