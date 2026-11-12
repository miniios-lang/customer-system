/*!
 * xlsx-writer-lite —— 零依赖的 .xlsx 生成器（Store 方式打包 ZIP + OOXML）
 * 支持：单表、表头样式（浅蓝底 B4C6E7 / 加粗 / 居中 / 边框）、列宽、冻结首行、自动筛选、数字格式
 * 浏览器：XLSXW.download(spec) / XLSXW.build(spec) 返回 Uint8Array
 * Node：module.exports.build(spec) 返回 Uint8Array
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.XLSXW = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* ---------------- CRC32 ---------------- */
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xffffffff;
    for (var i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }

  var encoder = new TextEncoder();

  function u8(str) {
    return encoder.encode(str);
  }

  /* ---------------- ZIP (store) ---------------- */
  function zip(files) {
    var parts = [], central = [], offset = 0;

    files.forEach(function (f) {
      var nameBytes = u8(f.name);
      var data = f.data;
      var crc = crc32(data);
      var size = data.length;

      var lh = new Uint8Array(30 + nameBytes.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true); // UTF-8 文件名
      dv.setUint16(8, 0, true); // 0 = store
      dv.setUint16(10, 0, true);
      dv.setUint16(12, 0x21, true); // 1980-01-01
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      parts.push(lh, data);

      var ch = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);

      offset += lh.length + size;
    });

    var centralSize = central.reduce(function (a, b) { return a + b.length; }, 0);
    var eocd = new Uint8Array(22);
    var ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    var all = parts.concat(central, [eocd]);
    var total = all.reduce(function (a, b) { return a + b.length; }, 0);
    var out = new Uint8Array(total);
    var pos = 0;
    all.forEach(function (b) { out.set(b, pos); pos += b.length; });
    return out;
  }

  /* ---------------- XML 工具 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\r?\n/g, '&#10;');
  }

  function colName(n) {
    var s = '';
    while (n > 0) {
      var m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function isNum(v) {
    return typeof v === 'number' && isFinite(v);
  }

  /* ---------------- 各部件 ---------------- */
  function contentTypes(nSheets) {
    var sheets = '';
    for (var i = 1; i <= nSheets; i++) {
      sheets += '<Override PartName="/xl/worksheets/sheet' + i + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>';
    }
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      sheets +
      '</Types>';
  }

  function rootRels() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '</Relationships>';
  }

  function workbookXml(sheetNames) {
    var s = '';
    sheetNames.forEach(function (n, i) {
      s += '<sheet name="' + esc(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>';
    });
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' + s + '</sheets>' +
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
      "'" + esc(sheetNames[0]) + "'!$A$1:$" + colName(colCount || 1) + '$1' +
      '</definedName></definedNames>' +
      '</workbook>';
  }

  var colCount = 0;

  function workbookRels(nSheets) {
    var s = '';
    for (var i = 1; i <= nSheets; i++) {
      s += '<Relationship Id="rId' + i + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + i + '.xml"/>';
    }
    s += '<Relationship Id="rId' + (nSheets + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>';
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + s + '</Relationships>';
  }

  /* 样式索引：0 默认 / 1 表头 / 2 文本 / 3 数字 / 4 居中 */
  function stylesXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="1"><numFmt numFmtId="176" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="3">' +
      '<font><sz val="11"/><color theme="1"/><name val="微软雅黑"/><family val="2"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1F3864"/><name val="微软雅黑"/><family val="2"/></font>' +
      '<font><sz val="11"/><color theme="1"/><name val="微软雅黑"/><family val="2"/></font>' +
      '</fonts>' +
      '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFB4C6E7"/><bgColor indexed="64"/></patternFill></fill>' +
      '</fills>' +
      '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border>' +
      '<left style="thin"><color rgb="FFD0D7E5"/></left>' +
      '<right style="thin"><color rgb="FFD0D7E5"/></right>' +
      '<top style="thin"><color rgb="FFD0D7E5"/></top>' +
      '<bottom style="thin"><color rgb="FFD0D7E5"/></bottom>' +
      '<diagonal/></border>' +
      '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="5">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="center" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="left" vertical="center"/></xf>' +
      '<xf numFmtId="176" fontId="2" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="right" vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1">' +
      '<alignment horizontal="center" vertical="center"/></xf>' +
      '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>';
  }

  function sheetXml(sheet) {
    var cols = sheet.columns || [];
    var rows = sheet.rows || [];
    var width = cols.length || (rows[0] ? rows[0].length : 1);
    var lastCol = colName(width);
    var lastRow = rows.length + 1;

    var colsXml = '<cols>';
    for (var i = 0; i < width; i++) {
      var w = (cols[i] && cols[i].width) || 16;
      colsXml += '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>';
    }
    colsXml += '</cols>';

    var out = [];
    // 表头
    out.push('<row r="1" ht="26" customHeight="1">');
    for (var c = 0; c < width; c++) {
      var title = cols[c] ? cols[c].title : '';
      out.push('<c r="' + colName(c + 1) + '1" s="1" t="inlineStr"><is><t xml:space="preserve">' + esc(title) + '</t></is></c>');
    }
    out.push('</row>');

    // 数据
    for (var r = 0; r < rows.length; r++) {
      var rowArr = rows[r] || [];
      var rn = r + 2;
      out.push('<row r="' + rn + '" ht="20" customHeight="1">');
      for (var k = 0; k < width; k++) {
        var v = rowArr[k];
        var ref = colName(k + 1) + rn;
        if (isNum(v)) {
          out.push('<c r="' + ref + '" s="3"><v>' + v + '</v></c>');
        } else if (v === null || v === undefined || v === '') {
          out.push('<c r="' + ref + '" s="2" t="inlineStr"><is><t></t></is></c>');
        } else {
          out.push('<c r="' + ref + '" s="2" t="inlineStr"><is><t xml:space="preserve">' + esc(v) + '</t></is></c>');
        }
      }
      out.push('</row>');
    }

    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<dimension ref="A1:' + lastCol + lastRow + '"/>' +
      '<sheetViews><sheetView tabSelected="1" workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '</sheetView></sheetViews>' +
      '<sheetFormatPr defaultRowHeight="20"/>' +
      colsXml +
      '<sheetData>' + out.join('') + '</sheetData>' +
      '<autoFilter ref="A1:' + lastCol + lastRow + '"/>' +
      '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>' +
      '</worksheet>';
  }

  /* ---------------- 对外 ---------------- */
  function build(spec) {
    var sheets = spec.sheets || [{ name: 'Sheet1', columns: spec.columns, rows: spec.rows }];
    colCount = (sheets[0].columns || []).length;

    var files = [
      { name: '[Content_Types].xml', data: u8(contentTypes(sheets.length)) },
      { name: '_rels/.rels', data: u8(rootRels()) },
      { name: 'xl/workbook.xml', data: u8(workbookXml(sheets.map(function (s) { return s.name || 'Sheet1'; }))) },
      { name: 'xl/_rels/workbook.xml.rels', data: u8(workbookRels(sheets.length)) },
      { name: 'xl/styles.xml', data: u8(stylesXml()) }
    ];

    sheets.forEach(function (s, i) {
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: u8(sheetXml(s)) });
    });

    return zip(files);
  }

  function download(spec) {
    var bytes = build(spec);
    var blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = spec.fileName || 'export.xlsx';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    return bytes.length;
  }

  function toCSV(columns, rows) {
    var lines = [columns.map(function (c) { return '"' + String(c.title).replace(/"/g, '""') + '"'; }).join(',')];
    rows.forEach(function (r) {
      lines.push((r || []).map(function (v) {
        var s = v == null ? '' : String(v);
        return '"' + s.replace(/"/g, '""') + '"';
      }).join(','));
    });
    return '\ufeff' + lines.join('\r\n');
  }

  return { build: build, download: download, toCSV: toCSV, crc32: crc32 };
});
