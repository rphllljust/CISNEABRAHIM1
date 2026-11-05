import { describe, expect, it } from 'vitest';
import {
  buildAuthorizedDocumentZip,
  DocumentBatchValidationError,
  parseDocumentBatch,
  DOCUMENT_BATCH_MAX_BYTES,
} from './document-batch-zip';

const ID = '11111111-1111-4111-8111-111111111111';

describe('GED authorized document batch', () => {
  it('accepts only unique, versioned UUID selections within the batch cap', () => {
    expect(parseDocumentBatch({ documents: [{ documentId: ID, versionNumber: 1 }] }))
      .toEqual([{ documentId: ID, versionNumber: 1 }]);
    expect(() => parseDocumentBatch({ documents: [] })).toThrow(DocumentBatchValidationError);
    expect(() => parseDocumentBatch({ documents: [{ documentId: ID, versionNumber: 0 }] }))
      .toThrow(DocumentBatchValidationError);
    expect(() => parseDocumentBatch({ documents: [
      { documentId: ID, versionNumber: 1 },
      { documentId: ID, versionNumber: 1 },
    ] })).toThrow(DocumentBatchValidationError);
    expect(() => parseDocumentBatch({ documents: Array.from({ length: 21 }, (_, i) => ({
      documentId: ID, versionNumber: i + 1,
    })) })).toThrow(DocumentBatchValidationError);
  });

  it('builds a valid two-entry stored ZIP without path traversal', () => {
    const payload = buildAuthorizedDocumentZip([
      { filename: '../../private.txt', buffer: Buffer.from('one') },
      { filename: 'comprovante.pdf', buffer: Buffer.from('two') },
    ]);
    expect(payload.readUInt32LE(0)).toBe(0x04034b50);
    const firstNameLen = payload.readUInt16LE(26);
    const name = payload.subarray(30, 30 + firstNameLen).toString();
    expect(name).toBe('01_private.txt');
    expect(name).not.toContain('../');
    const firstStart = 30 + firstNameLen;
    expect(payload.subarray(firstStart, firstStart + 3).toString()).toBe('one');
    const secondOffset = firstStart + 3;
    expect(payload.readUInt32LE(secondOffset)).toBe(0x04034b50);
    const secondNameLength = payload.readUInt16LE(secondOffset + 26);
    expect(payload.subarray(secondOffset + 30, secondOffset + 30 + secondNameLength).toString())
      .toBe('02_comprovante.pdf');
    expect(payload.readUInt32LE(payload.length - 22)).toBe(0x06054b50);
    expect(payload.readUInt16LE(payload.length - 14)).toBe(2);
  });

  it('rejects a combined payload above the maximum before returning an archive', () => {
    expect(() => buildAuthorizedDocumentZip([
      { filename: 'large.bin', buffer: Buffer.alloc(DOCUMENT_BATCH_MAX_BYTES + 1) },
    ])).toThrow(DocumentBatchValidationError);
  });
});
