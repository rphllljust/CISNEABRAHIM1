import PDFDocument from 'pdfkit';

/**
 * PDF representation of the report owner output.
 *
 * This is a read-only projection, not a fiscal document or a new reporting
 * calculation. Every displayed value comes from the authorized query rows.
 * PDFKit handles page breaks for long values without silently discarding rows.
 */
function present(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' ||
      typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  return JSON.stringify(value) ?? '—';
}

export async function renderReportPdf(
  title: string,
  headers: readonly string[],
  rows: readonly (readonly unknown[])[],
  generatedAt: string,
): Promise<Buffer> {
  if (!headers.length || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error('REPORT_PDF_INVALID_INPUT');
  }

  return new Promise<Buffer>((resolve, reject) => {
    const buffers: Buffer[] = [];
    const doc = new PDFDocument({
      size: 'A4',
      layout: 'portrait',
      margins: { top: 54, right: 45, bottom: 50, left: 45 },
      compress: false,
      info: {
        Title: title,
        Author: 'CISNE',
        Subject: 'Relatório empresarial',
        CreationDate: new Date(generatedAt),
      },
    });
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const pageHeader = () => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor('#6b7280')
        .text('CISNE · RELATÓRIO EMPRESARIAL', 45, 30, { width: 500 });
      doc.moveTo(45, 43).lineTo(550, 43).strokeColor('#d1d5db').lineWidth(0.6).stroke();
      doc.fillColor('#111827');
    };
    doc.on('pageAdded', pageHeader);
    pageHeader();

    doc.font('Helvetica-Bold').fontSize(17).fillColor('#111827').text(title, { lineGap: 2 });
    doc.moveDown(0.4);
    doc.font('Helvetica').fontSize(8).fillColor('#4b5563')
      .text('Gerado em ' + generatedAt + ' · Registros: ' + rows.length);
    doc.moveDown(0.8);

    // Each record is rendered in full as labelled fields; unlike a fixed-width
    // table, long descriptions cannot disappear due to column clipping.
    for (const [index, row] of rows.entries()) {
      doc.font('Helvetica-Bold').fontSize(9).fillColor('#111827')
        .text('REGISTRO ' + String(index + 1), { paragraphGap: 4 });
      for (const [columnIndex, header] of headers.entries()) {
        doc.font('Helvetica-Bold').fontSize(8).fillColor('#374151')
          .text(header + ': ', { continued: true });
        doc.font('Helvetica').fontSize(8).fillColor('#111827')
          .text(present(row[columnIndex]), { paragraphGap: 2 });
      }
      doc.moveDown(0.6);
      doc.moveTo(45, doc.y).lineTo(550, doc.y)
        .strokeColor('#e5e7eb').lineWidth(0.4).stroke();
      doc.moveDown(0.4);
    }
    doc.end();
  });
}
