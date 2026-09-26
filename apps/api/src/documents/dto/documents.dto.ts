import {
  parseClampedOffsetLimit,
  parsePositiveVersionNumberParam,
} from '../../infrastructure/http/contracts';
import {
  isDocumentCategory,
  isDocumentClassification,
  MAX_FILE_SIZE_BYTES,
  MAX_VERSIONS_PER_DOCUMENT,
} from '../domain/document-categories';

export type CreateDocumentUploadInput = {
  title: string;
  categoryCode: import('../domain/document-categories').DocumentCategory;
  classificationCode: string;
  unitId: string;
};

export type ListDocumentsQuery = {
  unitId?: string;
  categoryCode?: string;
  /**
   * Busca por titulo. Opcional e aditiva: ausente, a listagem devolve exatamente o que devolvia
   * antes desta frente (mesmos filtros, mesma ordem, mesma paginacao).
   */
  q?: string;
  limit: number;
  offset: number;
};

export type UploadedFileInput = {
  buffer: Buffer;
  filename: string;
  mimetype: string;
};

export function parseCreateDocumentUploadFields(
  fields: Record<string, string | undefined>,
): CreateDocumentUploadInput {
  const title = fields['title']?.trim();
  const categoryCode = fields['categoryCode']?.trim() ?? '';
  const classificationCode = fields['classificationCode']?.trim() ?? 'INTERNAL';
  const unitId = fields['unitId']?.trim() ?? '';

  if (!title) {
    throw new Error('title is required');
  }
  if (!isDocumentCategory(categoryCode)) {
    throw new Error('categoryCode is invalid');
  }
  if (!isDocumentClassification(classificationCode)) {
    throw new Error('classificationCode is invalid');
  }
  if (!unitId) {
    throw new Error('unitId is required');
  }

  return { title, categoryCode, classificationCode, unitId };
}

/**
 * Tetos da busca por titulo.
 *
 * O termo e aparado e limitado em comprimento — nunca interpolado: o `WHERE` recebe o valor como
 * parametro, e `escapeLikeWildcards` neutraliza `%` e `_` para que o que o operador digita seja
 * texto, e nao padrao de busca.
 */
export const DOCUMENT_SEARCH_MAX_LENGTH = 120;

export function parseListDocumentsQuery(query: Record<string, unknown>): ListDocumentsQuery {
  const { limit, offset } = parseClampedOffsetLimit(query);
  const unitId = typeof query['unitId'] === 'string' ? query['unitId'].trim() : undefined;
  const categoryCode =
    typeof query['categoryCode'] === 'string' ? query['categoryCode'].trim() : undefined;
  const rawSearch = typeof query['q'] === 'string' ? query['q'].trim() : '';
  const q =
    rawSearch.length > 0 ? rawSearch.slice(0, DOCUMENT_SEARCH_MAX_LENGTH) : undefined;

  return { unitId, categoryCode, q, limit, offset };
}

export function parseVersionNumberParam(value: string): number {
  try {
    return parsePositiveVersionNumberParam(value);
  } catch {
    throw new Error('versionNumber is invalid');
  }
}

export const DOCUMENT_UPLOAD_LIMITS = {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxVersionsPerDocument: MAX_VERSIONS_PER_DOCUMENT,
  maxFilesPerRequest: 1,
};
