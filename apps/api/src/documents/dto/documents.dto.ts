import { HttpStatus } from '@nestjs/common';
import {
  parseClampedOffsetLimit,
  parsePositiveVersionNumberParam,
} from '../../infrastructure/http/contracts';
import { DOCUMENT_ERROR_CODES } from '../errors/document-error-codes';
import { DocumentHttpException } from '../errors/document-http.exception';
import {
  isDocumentCategory,
  isDocumentClassification,
  MAX_FILE_SIZE_BYTES,
  MAX_VERSIONS_PER_DOCUMENT,
} from '../domain/document-categories';

/**
 * Entrada invalida do cliente e 400, nunca 500.
 *
 * O contrato HTTP da plataforma so mapeia `HttpException` (e `InvalidUuidError`); um `Error` cru
 * atravessa o filtro catch-all e vira 500, escondendo do operador a causa real ("campo invalido")
 * atras de "erro inesperado" — que a UI ainda oferece como regravavel. Por isso o DTO rejeita no
 * mesmo canal de erro do modulo, com o codigo que o cliente ja sabe interpretar.
 */
function invalidDocumentInput(message: string): DocumentHttpException {
  return new DocumentHttpException(
    HttpStatus.BAD_REQUEST,
    DOCUMENT_ERROR_CODES.INVALID_INPUT,
    message,
  );
}

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
    throw invalidDocumentInput('title is required');
  }
  if (!isDocumentCategory(categoryCode)) {
    throw invalidDocumentInput('categoryCode is invalid');
  }
  if (!isDocumentClassification(classificationCode)) {
    throw invalidDocumentInput('classificationCode is invalid');
  }
  if (!unitId) {
    throw invalidDocumentInput('unitId is required');
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
  // Tipo de documento fora do catalogo e ENTRADA invalida, e nao um filtro vazio: aceitar em
  // silencio devolveria conjunto vazio e a tela afirmaria "nenhum documento corresponde aos
  // filtros" para um valor que nunca existiu. Mesma regra do upload, que ja valida o catalogo.
  if (categoryCode && !isDocumentCategory(categoryCode)) {
    throw invalidDocumentInput('categoryCode is invalid');
  }
  const rawSearch = typeof query['q'] === 'string' ? query['q'].trim() : '';
  const q =
    rawSearch.length > 0 ? rawSearch.slice(0, DOCUMENT_SEARCH_MAX_LENGTH) : undefined;

  return { unitId, categoryCode, q, limit, offset };
}

export function parseVersionNumberParam(value: string): number {
  try {
    return parsePositiveVersionNumberParam(value);
  } catch {
    throw invalidDocumentInput('versionNumber is invalid');
  }
}

export const DOCUMENT_UPLOAD_LIMITS = {
  maxFileSizeBytes: MAX_FILE_SIZE_BYTES,
  maxVersionsPerDocument: MAX_VERSIONS_PER_DOCUMENT,
  maxFilesPerRequest: 1,
};
