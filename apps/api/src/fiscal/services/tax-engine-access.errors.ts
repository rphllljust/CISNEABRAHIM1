import { HttpStatus } from '@nestjs/common';
import { TaxEngineError } from '../domain/tax-engine';
import { TaxEngineValidationError } from '../domain/tax-engine.validation';
import { FISCAL_ERROR_CODES } from '../errors/fiscal-error-codes';
import { FiscalHttpException } from '../errors/fiscal-http.exception';

export function mapTaxEngineDomainError(error: unknown): FiscalHttpException {
  if (error instanceof FiscalHttpException) {
    return error;
  }
  if (error instanceof TaxEngineValidationError) {
    return new FiscalHttpException(
      HttpStatus.BAD_REQUEST,
      FISCAL_ERROR_CODES.VALIDATION_FAILED,
      'Invalid tax engine request.',
    );
  }
  if (!(error instanceof TaxEngineError)) {
    // ERRO INESPERADO — a CAUSA PRIMÁRIA é preservada (mesmo padrão do INVENTORY).
    // Sem isto, um teste de integração relatava apenas `Fiscal Http Exception`, o NOME
    // da classe, e a causa real era descartada exatamente onde ela existia.
    return new FiscalHttpException(
      HttpStatus.INTERNAL_SERVER_ERROR,
      FISCAL_ERROR_CODES.VALIDATION_FAILED,
      'Unexpected tax engine error.',
      { cause: error },
    );
  }
  switch (error.code) {
    case 'TAX_RULE_NOT_CONFIGURED':
      return new FiscalHttpException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        FISCAL_ERROR_CODES.TAX_RULE_NOT_CONFIGURED,
        'Required tax rule is not configured. Calculation will not assume a rate.',
      );
    case 'TAX_INVALID_CONTEXT':
      return new FiscalHttpException(
        HttpStatus.BAD_REQUEST,
        FISCAL_ERROR_CODES.TAX_INVALID_CONTEXT,
        'Tax context is invalid.',
      );
    case 'TAX_VERSION_IMMUTABLE':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.TAX_VERSION_IMMUTABLE,
        'Published tax rule versions are immutable. Register a new version for new legislation.',
      );
    case 'TAX_VERSION_OVERLAP':
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.TAX_VERSION_OVERLAP,
        'Published tax rule versions cannot overlap. Create a new version for the new window.',
      );
    case 'TAX_CALCULATION_NOT_FOUND':
      return new FiscalHttpException(
        HttpStatus.NOT_FOUND,
        FISCAL_ERROR_CODES.TAX_CALCULATION_NOT_FOUND,
        'Tax calculation not found.',
      );
    default:
      return new FiscalHttpException(
        HttpStatus.CONFLICT,
        FISCAL_ERROR_CODES.VALIDATION_FAILED,
        'Tax engine operation is not allowed.',
      );
  }
}
