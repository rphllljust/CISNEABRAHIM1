import { HttpStatus } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { InvalidUuidError } from '../../platform/kernel/uuid';
import { PayrollError } from '../domain/payroll';
import { PayrollValidationError } from '../domain/payroll.validation';
import { PAYROLL_ERROR_CODES } from '../errors/payroll-error-codes';
import { PayrollHttpException } from '../errors/payroll-http.exception';
import { mapPayrollDomainError } from './payroll-access.errors';

/**
 * MAPEAMENTO HTTP DOS ERROS DE FOLHA
 *
 * DEFEITO QUE ESTES TESTES TRAVAM (registrado 2026-09-29):
 *
 * `assertUuid` lança `InvalidUuidError`, que não é `PayrollError` nem `PayrollValidationError`.
 * Sem um ramo explícito, o erro caía no catch-all de `mapPayrollDomainError` e um identificador
 * malformado — erro de CLIENTE — era servido como **HTTP 500** `PAYROLL_VALIDATION_FAILED`.
 *
 * Convenção já estabelecida no repositório, aplicada aqui: `accounting-access.errors.ts` e
 * `bank-reconciliation-access.errors.ts` mapeiam `InvalidUuidError` para 400. Este arquivo
 * garante que folha siga a mesma convenção e que a regressão não volte.
 */

/**
 * `mapPayrollDomainError` RETORNA a exceção mapeada (o `throw` fica no chamador, dentro dos
 * `catch` do serviço), mas REPLANÇA (`throw`) os erros que não deve envolver — `AuthzHttpException`
 * e `HttpException`. Por isso a captura também é necessária: a função tem as duas saídas.
 */
function mapped(error: unknown): PayrollHttpException {
  try {
    return mapPayrollDomainError(error);
  } catch (rethrown) {
    if (rethrown instanceof PayrollHttpException) {
      return rethrown;
    }
    throw rethrown;
  }
}

function statusOf(error: unknown): number {
  return mapped(error).getStatus();
}

function codeOf(error: unknown): string {
  return mapped(error).code;
}

describe('mapPayrollDomainError — identificador inválido', () => {
  it('mapeia InvalidUuidError para 400, nunca 500', () => {
    const status = statusOf(new InvalidUuidError('payrollPeriodId'));
    expect(status).toBe(HttpStatus.BAD_REQUEST);
    expect(status).not.toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('preserva o código de erro do domínio', () => {
    expect(codeOf(new InvalidUuidError('payrollPeriodId'))).toBe(
      PAYROLL_ERROR_CODES.VALIDATION_FAILED,
    );
  });

  it('mapeia PayrollValidationError para 400', () => {
    expect(statusOf(new PayrollValidationError('PAYROLL_VALIDATION_FAILED'))).toBe(
      HttpStatus.BAD_REQUEST,
    );
  });
});

describe('mapPayrollDomainError — erros de domínio conhecidos', () => {
  it('PAYROLL_NOT_FOUND é 404, não 500', () => {
    expect(statusOf(new PayrollError('PAYROLL_NOT_FOUND'))).toBe(HttpStatus.NOT_FOUND);
  });

  it('PAYROLL_INVALID_AMOUNT é 400', () => {
    expect(statusOf(new PayrollError('PAYROLL_INVALID_AMOUNT'))).toBe(HttpStatus.BAD_REQUEST);
  });

  it('período fechado é 409 (conflito de estado, não erro de servidor)', () => {
    expect(statusOf(new PayrollError('PAYROLL_PERIOD_CLOSED'))).toBe(HttpStatus.CONFLICT);
  });

  it('fórmula não decidida é 422 — regra legal não é inventada', () => {
    expect(statusOf(new PayrollError('PAYROLL_FORMULA_NOT_DECIDED'))).toBe(
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  });
});

describe('mapPayrollDomainError — fronteira do 500', () => {
  it('erro verdadeiramente inesperado continua 500', () => {
    // O 500 não é proibido: é reservado para o que realmente não é conhecido. O defeito era
    // usá-lo para entrada inválida, não a existência do ramo.
    expect(statusOf(new TypeError('boom'))).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
  });

  it('nenhum caminho de erro de cliente produz 500', () => {
    const clientErrors: unknown[] = [
      new InvalidUuidError('payrollPeriodId'),
      new InvalidUuidError('unitId'),
      new PayrollValidationError('PAYROLL_VALIDATION_FAILED'),
      new PayrollError('PAYROLL_NOT_FOUND'),
      new PayrollError('PAYROLL_INVALID_AMOUNT'),
      new PayrollError('PAYROLL_INVALID_EVENT_KIND'),
      new PayrollError('PAYROLL_PERIOD_CLOSED'),
      new PayrollError('PAYROLL_PERIOD_NOT_OPEN'),
      new PayrollError('PAYROLL_PERIOD_NOT_CALCULATED'),
      new PayrollError('PAYROLL_PERIOD_NOT_CLOSED'),
      new PayrollError('PAYROLL_FORMULA_NOT_DECIDED'),
      new PayrollError('PAYROLL_OPERATIONS_COUPLING_FORBIDDEN'),
    ];

    for (const error of clientErrors) {
      const status = statusOf(error);
      expect(
        status,
        `${error instanceof Error ? error.constructor.name : typeof error} (${(error as { code?: string }).code}) mapeou para ${status}`,
      ).toBeLessThan(500);
    }
  });
});
