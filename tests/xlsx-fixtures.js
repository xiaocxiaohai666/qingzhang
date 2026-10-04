'use strict';
const fs = require('node:fs');
const path = require('node:path');
const Core = require('../ledger-core.js');
const XLSX = require('../vendor/xlsx.full.min.js');
const sample = fs.readFileSync(path.join(__dirname, '../samples/wechat-demo.csv'), 'utf8');

function makeWorkbook(options = {}) {
  const rows = Core.parseCsv(sample);
  const { headerIndex, columns } = Core.findBillHeader(rows);
  const transactionRows = [];
  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]; if (!row[columns.date]) continue;
    const parts = Core.normalizeDate(row[columns.date]).match(/\d+/g).map(Number);
    row[columns.date] = (Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]) - Date.UTC(1899, 11, 30)) / 86400000 - (options.date1904 ? 1462 : 0);
    row[columns.amount] = Core.toCents(row[columns.amount]) / 100;
    row[columns.transactionId] = Core.clean(row[columns.transactionId]); row[columns.merchantId] = Core.clean(row[columns.merchantId]);
    transactionRows.push(rowIndex);
  }
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  for (const rowIndex of transactionRows) {
    sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columns.date })].z = 'yyyy-mm-dd hh:mm:ss';
    sheet[XLSX.utils.encode_cell({ r: rowIndex, c: columns.amount })].z = '"¥"#,##0.00';
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['虚构测试账单，请勿混入真实账本'], ['此工作表不包含交易明细']]), '说明');
  XLSX.utils.book_append_sheet(workbook, sheet, '微信支付账单');
  if (options.date1904) workbook.Workbook = { WBProps: { date1904: true } };
  return { workbook, sheet, headerIndex, columns, transactionRows };
}
function encodeWorkbook(workbook, options = {}) { return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true, bookSST: true, ...options }); }
if (require.main === module) {
  const { workbook } = makeWorkbook();
  const target = path.join(__dirname, '../samples/wechat-demo.xlsx');
  fs.writeFileSync(target, encodeWorkbook(workbook));
  console.log('已生成虚构的 XLSX 导入测试账单。');
}
module.exports = { XLSX, makeWorkbook, encodeWorkbook };
