import { describe, expect, it } from 'vitest';
import { extractPdfText } from '../../billing/domain/pdf-text-extractor';
import { renderReportPdf } from './pdf-export';

const AT = '2026-11-05T04:00:00.000Z';

describe('PDF report export', () => {
  it('renders authorized data as actual PDF bytes with no fabricated totals', async () => {
    const buffer = await renderReportPdf(
      'Ordens por período',
      ['Número OS', 'Valor contratual'],
      [['OS-2026-001', '123456789.1234']],
      AT,
    );
    expect(buffer.subarray(0, 4).toString('ascii')).toBe('%PDF');
    const text = extractPdfText(buffer);
    expect(text).toContain('Ordens por período');
    expect(text).toContain('OS-2026-001');
    expect(text).toContain('123456789.1234');
    expect(text).toContain('REGISTRO 1');
    expect(text).toContain('Gerado em');
  });

  it('preserves every record across PDF page breaks', async () => {
    const rows = Array.from({ length: 75 }, (_, index) => ['SO-' + String(index + 1)]);
    const buffer = await renderReportPdf('OS', ['Código'], rows, AT);
    const text = extractPdfText(buffer);
    expect(text).toContain('SO-1');
    expect(text).toContain('SO-75');
    expect(buffer.toString('latin1')).toMatch(/\/Count [2-9]/);
  });

  it('displays absence without inventing values', async () => {
    const buffer = await renderReportPdf('Sem dados', ['Cliente'], [[null]], AT);
    expect(extractPdfText(buffer)).toContain('—');
  });
});
