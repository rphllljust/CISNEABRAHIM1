/**
 * Native XLSX (OOXML) export for authorized report rows.
 *
 * Deliberately emits inline-string cells for database decimal strings and
 * user-provided text. Excel must never interpret a textual value beginning
 * with "=" as a formula, and decimal money cannot silently lose precision.
 * No spreadsheet library or lockfile changes are required.
 */
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';

type ArchiveEntry = { name: string; data: Buffer };
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let crc = n;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1);
  }
  return crc >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP method STORE, UTF-8 names, CRC32 and central directory per PKZIP. */
function packZip(entries: ArchiveEntry[]): Buffer {
  const fileParts: Buffer[] = [];
  const directoryParts: Buffer[] = [];
  let offset = 0;
  let directorySize = 0;
  if (entries.length > 65535) {
    throw new Error('XLSX_ZIP_TOO_MANY_PARTS');
  }
  for (const entry of entries) {
    if (!entry.name || entry.name.includes('..') || entry.name.startsWith('/') || entry.name.includes('\\')) {
      throw new Error('XLSX_ZIP_INVALID_PATH');
    }
    const filename = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const checksum = crc32(data);
    if (filename.length > 65535 || data.length > 0xffffffff ||
        offset + 30 + filename.length + data.length > 0xffffffff) {
      throw new Error('XLSX_ZIP_TOO_LARGE');
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(filename.length, 26);
    fileParts.push(local, filename, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(filename.length, 28);
    central.writeUInt32LE(offset, 42);
    directoryParts.push(central, filename);
    directorySize += central.length + filename.length;
    offset += local.length + filename.length + data.length;
  }

  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(entries.length, 8);
  footer.writeUInt16LE(entries.length, 10);
  footer.writeUInt32LE(directorySize, 12);
  footer.writeUInt32LE(offset, 16);
  return Buffer.concat([...fileParts, ...directoryParts, footer]);
}

function xmlEscape(value: string): string {
  // Reject XML 1.0 prohibited control points without rewriting the source row.
  const printable = [...value].filter((character) => {
    const point = character.codePointAt(0)!;
    return point === 0x09 || point === 0x0a || point === 0x0d ||
      (point >= 0x20 && point <= 0xd7ff) ||
      (point >= 0xe000 && point <= 0xfffd) ||
      (point >= 0x10000 && point <= 0x10ffff);
  }).join('');
  return printable.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function columnLetter(index: number): string {
  let value = index + 1;
  let letters = '';
  while (value > 0) {
    value -= 1;
    letters = String.fromCharCode(65 + value % 26) + letters;
    value = Math.floor(value / 26);
  }
  return letters;
}

function valueText(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? '';
}

function cell(ref: string, value: unknown): string {
  // String values remain text even if they look like formulas or monetary amounts.
  if (typeof value === 'number' && Number.isFinite(value)) {
    return '<c r="' + ref + '"><v>' + String(value) + '</v></c>';
  }
  if (typeof value === 'boolean') {
    return '<c r="' + ref + '" t="b"><v>' + (value ? '1' : '0') + '</v></c>';
  }
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' +
    xmlEscape(valueText(value)) + '</t></is></c>';
}

export function buildReportXlsx(headers: string[], rows: readonly (readonly unknown[])[]): Buffer {
  if (headers.length < 1 || headers.length > 16384 || rows.length > 1_048_575) {
    throw new Error('XLSX_SHEET_LIMIT_EXCEEDED');
  }
  const worksheetRows: string[] = [];
  const headerCells = headers.map((header, index) => cell(columnLetter(index) + '1', header));
  worksheetRows.push('<row r="1">' + headerCells.join('') + '</row>');
  for (let index = 0; index < rows.length; index += 1) {
    const rowNumber = index + 2;
    const cells = headers.map((_, columnIndex) =>
      cell(columnLetter(columnIndex) + rowNumber, rows[index]?.[columnIndex] ?? ''),
    );
    worksheetRows.push('<row r="' + rowNumber + '">' + cells.join('') + '</row>');
  }
  const worksheet = XML_DECLARATION + '<worksheet xmlns="' + XML_NS + '">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetData>' + worksheetRows.join('') + '</sheetData></worksheet>';
  const entries: Array<{ name: string; xml: string }> = [
    {
      name: '[Content_Types].xml',
      xml: XML_DECLARATION + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '</Types>',
    },
    {
      name: '_rels/.rels',
      xml: XML_DECLARATION + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>',
    },
    {
      name: 'xl/workbook.xml',
      xml: XML_DECLARATION + '<workbook xmlns="' + XML_NS + '" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>',
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      xml: XML_DECLARATION + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
        '</Relationships>',
    },
    { name: 'xl/worksheets/sheet1.xml', xml: worksheet },
  ];
  return packZip(entries.map(({ name, xml }) => ({ name, data: Buffer.from(xml, 'utf8') })));
}
