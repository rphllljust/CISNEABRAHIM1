import { describe, expect, it } from 'vitest';
import { buildReportXlsx } from './xlsx-export';

function readUncompressedEntries(archive: Buffer): Map<string, string> {
  const entries = new Map<string, string>();
  let cursor = 0;
  while (archive.readUInt32LE(cursor) === 0x04034b50) {
    const compression = archive.readUInt16LE(cursor + 8);
    expect(compression).toBe(0);
    const compressedSize = archive.readUInt32LE(cursor + 18);
    const filenameLength = archive.readUInt16LE(cursor + 26);
    const extraLength = archive.readUInt16LE(cursor + 28);
    const filename = archive.subarray(cursor + 30, cursor + 30 + filenameLength).toString('utf8');
    const start = cursor + 30 + filenameLength + extraLength;
    entries.set(filename, archive.subarray(start, start + compressedSize).toString('utf8'));
    cursor = start + compressedSize;
  }
  expect(archive.readUInt32LE(cursor)).toBe(0x02014b50);
  expect(archive.readUInt32LE(archive.length - 22)).toBe(0x06054b50);
  return entries;
}

describe('XLSX report export', () => {
  it('produces an OOXML workbook with a real worksheet and preserved precision', () => {
    const archive = buildReportXlsx(
      ['OS', 'Valor', 'Contagem', 'Ativo'],
      [['SO-123', '12345678901234567890.123456', 12, true]],
    );
    const entries = readUncompressedEntries(archive);
    expect([...entries.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);
    const sheet = entries.get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('r="A2" t="inlineStr"');
    expect(sheet).toContain('SO-123');
    expect(sheet).toContain('12345678901234567890.123456');
    expect(sheet).toContain('<c r="C2"><v>12</v></c>');
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(sheet).toContain('state="frozen"');
  });

  it('preserves adversarial strings as text rather than formulas or XML markup', () => {
    const archive = buildReportXlsx(
      ['Comentário', 'Contato'],
      [['=HYPERLINK("https://example.test")', '<script>&"\'']],
    );
    const sheet = readUncompressedEntries(archive).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('t="inlineStr"');
    expect(sheet).toContain('=HYPERLINK(&quot;https://example.test&quot;)');
    expect(sheet).toContain('&lt;script&gt;&amp;&quot;&apos;');
    expect(sheet).not.toContain('<f>');
    expect(sheet).not.toContain('<script>');
  });

  it('maintains headers and cells for empty exports', () => {
    const sheet = readUncompressedEntries(buildReportXlsx(['Unidade'], [])).get(
      'xl/worksheets/sheet1.xml',
    )!;
    expect(sheet).toContain('r="A1"');
    expect(sheet).not.toContain('r="A2" t="inlineStr"');
  });

  it('rejects the Excel worksheet row and column limits', () => {
    expect(() => buildReportXlsx([], [])).toThrow('XLSX_SHEET_LIMIT_EXCEEDED');
    expect(() => buildReportXlsx(Array.from({ length: 16385 }, () => 'header'), []))
      .toThrow('XLSX_SHEET_LIMIT_EXCEEDED');
  });
});
