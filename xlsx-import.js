(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/xlsx.full.min.js'), require('./ledger-core.js'));
  else root.WechatXlsx = factory(root.XLSX, root.WechatLedger);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (XLSX, Core) {
  'use strict';
  function excelDate(value, date1904) {
    const date = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!date) return String(value);
    // Excel 日期没有时区，按原始年月日时分秒转换，避免跟随电脑时区偏移。
    const stamp = new Date(Date.UTC(date.y, date.m - 1, date.d, date.H, date.M, Math.round(date.S + date.u)));
    return stamp.toISOString().slice(0, 19).replace('T', ' ');
  }
  function parseXlsx(input, rules = {}) {
    if (!XLSX?.read || !Core?.parseBillRows) throw new Error('Excel 读取组件未加载，请重新打开页面，并确保 vendor 文件夹完整。');
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
    const compound = bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0;
    if (!zip && !compound) throw new Error('文件不是有效的 XLSX 工作簿，请选择微信原始导出的 .xlsx 文件。');
    let workbook;
    try { workbook = XLSX.read(bytes, { type: 'array', cellDates: false, cellNF: true, sheetRows: 100001 }); }
    catch (error) {
      if (/password|encrypt|ECMA-376/i.test(error.message)) throw new Error('这个 Excel 文件受密码保护。请先在 Excel 或 WPS 中用密码打开，再另存为不带打开密码的 XLSX 文件后导入。');
      throw new Error('无法读取 XLSX 文件，文件可能损坏。请重新下载微信账单。');
    }
    const records = [], warnings = [], sheets = [], sheetErrors = []; let skipped = 0, recognized = false;
    const date1904 = !!workbook.Workbook?.WBProps?.date1904;
    for (const name of workbook.SheetNames) {
      const sheet = workbook.Sheets[name]; if (!sheet?.['!ref']) continue;
      const extent = XLSX.utils.decode_range(sheet['!ref']);
      const firstRows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: { r: Math.min(99, extent.e.r), c: Math.min(127, extent.e.c) } } });
      const header = Core.findBillHeader(firstRows); if (!header) continue;
      recognized = true;
      const fullExtent = XLSX.utils.decode_range(sheet['!fullref'] || sheet['!ref']);
      if (fullExtent.e.r >= 100000) throw new Error(`工作表「${name}」超过 10 万行，请分段导出账单。`);
      const columns = header.columns;
      const lastColumn = Math.max(...Object.values(columns));
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '', blankrows: true, range: { s: { r: 0, c: 0 }, e: { r: extent.e.r, c: lastColumn } } });
      const rowErrors = new Map();
      for (let rowIndex = header.headerIndex + 1; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];
        for (const [field, label] of [['date', '交易时间'], ['amount', '金额'], ['transactionId', '交易单号'], ['merchantId', '商户单号']]) {
          const column = columns[field]; if (column < 0) continue;
          const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: column })];
          // sheet_to_json 会根据日期格式生成本地 Date，关键字段必须直接使用单元格原值。
          row[column] = cell?.v ?? '';
          if (cell?.f) { rowErrors.set(rowIndex, `${label}包含公式，请使用微信原始导出文件`); continue; }
          if (field === 'date' && typeof row[column] === 'number') row[column] = excelDate(row[column], date1904);
          if (['transactionId', 'merchantId'].includes(field) && typeof row[column] === 'number') {
            if (!Number.isSafeInteger(row[column]) || Math.abs(row[column]) >= 1e15) rowErrors.set(rowIndex, `${label}以超过 15 位的数字保存，可能已丢失精度，请使用微信原始导出文件`);
            else row[column] = String(row[column]);
          }
        }
      }
      try {
        const result = Core.parseBillRows(rows, rules, { rowErrors });
        for (const record of result.records) records.push(record);
        if (records.length > 100000) throw new Error('工作簿超过 10 万笔交易，请分段导出账单。');
        skipped += result.skipped; warnings.push(...result.warnings.map(warning => `「${name}」${warning}`)); sheets.push(name);
      } catch (error) { sheetErrors.push(`工作表「${name}」：${error.message}`); }
    }
    if (!records.length) throw new Error(sheetErrors[0] || (recognized ? '工作簿中没有有效的交易记录。' : '未找到微信个人账单表头。需要包含「交易时间」「收/支」「金额」列，请选择用于个人对账的 XLSX。'));
    if (records.length > 100000) throw new Error('工作簿超过 10 万笔交易，请分段导出账单。');
    warnings.push(...sheetErrors);
    return { records, skipped, warnings, sheets };
  }
  return { parseXlsx };
});
