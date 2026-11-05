import { sanitizeUploadFilename } from '../../security/domain/safe-filename';

export const DOCUMENT_BATCH_MAX_FILES = 20;
export const DOCUMENT_BATCH_MAX_BYTES = 25 * 1024 * 1024;

export type DocumentBatchItem = { documentId: string; versionNumber: number };
export type DocumentBatchFile = { filename: string; buffer: Buffer };

export class DocumentBatchValidationError extends Error {
  constructor() {
    super('INVALID_DOCUMENT_BATCH');
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseDocumentBatch(input: unknown): DocumentBatchItem[] {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new DocumentBatchValidationError();
  }
  const entries = (input as { documents?: unknown }).documents;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > DOCUMENT_BATCH_MAX_FILES) {
    throw new DocumentBatchValidationError();
  }

  const seen = new Set<string>();
  return entries.map((entry: unknown) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new DocumentBatchValidationError();
    }
    const { documentId, versionNumber } = entry as Record<string, unknown>;
    if (
      typeof documentId !== 'string' ||
      !UUID_PATTERN.test(documentId) ||
      typeof versionNumber !== 'number' ||
      !Number.isSafeInteger(versionNumber) ||
      versionNumber < 1
    ) {
      throw new DocumentBatchValidationError();
    }
    const key = `${documentId.toLowerCase()}:${versionNumber}`;
    if (seen.has(key)) {
      throw new DocumentBatchValidationError();
    }
    seen.add(key);
    return { documentId, versionNumber };
  });
}

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n += 1) {
  let c = n;
  for (let k = 0; k < 8; k += 1) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]!;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * A bounded PKZIP "stored" archive. No archive dependency and no file writes.
 * All input buffers must already have passed per-document authorization.
 */
export function buildAuthorizedDocumentZip(files: DocumentBatchFile[]): Buffer {
  if (files.length < 1 || files.length > DOCUMENT_BATCH_MAX_FILES) {
    throw new DocumentBatchValidationError();
  }
  let totalBytes = 0;
  const payload: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  let centralBytes = 0;

  for (const [index, file] of files.entries()) {
    totalBytes += file.buffer.byteLength;
    if (totalBytes > DOCUMENT_BATCH_MAX_BYTES) {
      throw new DocumentBatchValidationError();
    }
    const safeName = sanitizeUploadFilename(file.filename);
    const name = Buffer.from(`${String(index + 1).padStart(2, '0')}_${safeName}`, 'utf8');
    const size = file.buffer.length;
    const hash = crc32(file.buffer);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8
    local.writeUInt16LE(0, 8); // STORE (no compression)
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x0021, 12); // 1980-01-01
    local.writeUInt32LE(hash, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    payload.push(local, name, file.buffer);

    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50, 0);
    directory.writeUInt16LE(20, 4);
    directory.writeUInt16LE(20, 6);
    directory.writeUInt16LE(0x0800, 8);
    directory.writeUInt16LE(0, 10);
    directory.writeUInt16LE(0, 12);
    directory.writeUInt16LE(0x0021, 14);
    directory.writeUInt32LE(hash, 16);
    directory.writeUInt32LE(size, 20);
    directory.writeUInt32LE(size, 24);
    directory.writeUInt16LE(name.length, 28);
    directory.writeUInt16LE(0, 30);
    directory.writeUInt16LE(0, 32);
    directory.writeUInt16LE(0, 34);
    directory.writeUInt16LE(0, 36);
    directory.writeUInt32LE(0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    centralBytes += directory.length + name.length;
    offset += local.length + name.length + size;
  }

  const footer = Buffer.alloc(22);
  footer.writeUInt32LE(0x06054b50, 0);
  footer.writeUInt16LE(0, 4);
  footer.writeUInt16LE(0, 6);
  footer.writeUInt16LE(files.length, 8);
  footer.writeUInt16LE(files.length, 10);
  footer.writeUInt32LE(centralBytes, 12);
  footer.writeUInt32LE(offset, 16);
  footer.writeUInt16LE(0, 20);
  return Buffer.concat([...payload, ...central, footer]);
}
