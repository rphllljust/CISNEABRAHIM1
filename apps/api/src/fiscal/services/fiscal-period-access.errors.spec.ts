import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { validateFiscalDocumentListQuery } from '../domain/fiscal-document.validation';
import { validateFiscalPeriodListQuery } from '../domain/fiscal-period.validation';
import { FISCAL_ERROR_CODES } from '../errors/fiscal-error-codes';
import { FiscalHttpException } from '../errors/fiscal-http.exception';
import { mapFiscalPeriodDomainError } from './fiscal-period-access.errors';

/**
 * Regressao do 500 em `GET /fiscal/periods`.
 *
 * `validateFiscalPeriodListQuery` reutiliza `requireFiscalPage`/`requireFiscalPageSize` e
 * `optionalFiscalWhitelist` de `fiscal-document.validation`, que lancam `FiscalValidationError`.
 * Como o mapper de periodo so reconhecia `FiscalPeriodValidationError`, uma query de listagem
 * malformada caia no ramo "Unexpected fiscal period error" e virava 500 em producao, enquanto
 * `/fiscal/documents` (mesmo elo, mapper correto) respondia 400. O contrato correto e 400:
 * a requisicao e invalida, o servidor nao falhou.
 */
describe('mapFiscalPeriodDomainError', () => {
  function statusOf(error: unknown): number {
    const mapped = mapFiscalPeriodDomainError(error);
    if (!(mapped instanceof FiscalHttpException)) {
      throw new Error('expected the mapper to return a FiscalHttpException');
    }
    return mapped.getStatus();
  }

  function catchValidation(run: () => unknown): unknown {
    try {
      run();
    } catch (error) {
      return error;
    }
    throw new Error('expected the list validation to reject the input');
  }

  it('maps a missing page from the shared list guard to 400, not 500', () => {
    const validationError = catchValidation(() =>
      validateFiscalPeriodListQuery({ unitId: 'CISNE-RO-PVH' }),
    );
    expect(statusOf(validationError)).toBe(HttpStatus.BAD_REQUEST);
  });

  it('maps an out-of-range pageSize from the shared list guard to 400', () => {
    const validationError = catchValidation(() =>
      validateFiscalPeriodListQuery({ unitId: 'CISNE-RO-PVH', page: 0, pageSize: 500 }),
    );
    expect(statusOf(validationError)).toBe(HttpStatus.BAD_REQUEST);
  });

  it('maps an unknown status filter from the shared whitelist to 400', () => {
    const validationError = catchValidation(() =>
      validateFiscalPeriodListQuery({
        unitId: 'CISNE-RO-PVH',
        page: 0,
        pageSize: 20,
        status: 'NOPE',
      }),
    );
    expect(statusOf(validationError)).toBe(HttpStatus.BAD_REQUEST);
  });

  it('keeps the document list guard on 400 as the reference behaviour', () => {
    const validationError = catchValidation(() =>
      validateFiscalDocumentListQuery({ unitId: 'CISNE-RO-PVH' }),
    );
    expect(statusOf(validationError)).toBe(HttpStatus.BAD_REQUEST);
  });

  it('still reports an unexpected error as 500', () => {
    expect(statusOf(new Error('boom'))).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('keeps the validation error code stable for the client contract', () => {
    const validationError = catchValidation(() =>
      validateFiscalPeriodListQuery({ unitId: 'CISNE-RO-PVH' }),
    );
    const mapped = mapFiscalPeriodDomainError(validationError) as FiscalHttpException;
    expect(mapped.code).toBe(FISCAL_ERROR_CODES.VALIDATION_FAILED);
  });
});
