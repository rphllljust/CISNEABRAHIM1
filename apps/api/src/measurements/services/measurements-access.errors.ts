import { HttpStatus } from '@nestjs/common';
import { MeasurementError } from '../domain/measurement';
import { MEASUREMENTS_ERROR_CODES } from '../errors/measurements-error-codes';
import { MeasurementsHttpException } from '../errors/measurements-http.exception';

export function measurementsAccessDenied(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.FORBIDDEN,
    MEASUREMENTS_ERROR_CODES.DENIED,
    'Access denied.',
  );
}

export function measurementsAccessNotFound(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.NOT_FOUND,
    MEASUREMENTS_ERROR_CODES.NOT_FOUND,
    'Measurement not found.',
  );
}

export function measurementsServiceOrderNotFound(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.NOT_FOUND,
    MEASUREMENTS_ERROR_CODES.SERVICE_ORDER_NOT_FOUND,
    'Service order not found.',
  );
}

export function measurementsItemNotFound(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.NOT_FOUND,
    MEASUREMENTS_ERROR_CODES.ITEM_NOT_FOUND,
    'Measurement item not found.',
  );
}

export function measurementsValidationFailed(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.BAD_REQUEST,
    MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED,
    'Invalid request body.',
  );
}

export function measurementsInvalidState(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.CONFLICT,
    MEASUREMENTS_ERROR_CODES.INVALID_STATE,
    'Measurement is not in a valid state for this operation.',
  );
}

export function measurementsVersionConflict(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.CONFLICT,
    MEASUREMENTS_ERROR_CODES.VERSION_CONFLICT,
    'Measurement was updated by another request.',
  );
}

export function measurementsNotEditable(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.CONFLICT,
    MEASUREMENTS_ERROR_CODES.NOT_EDITABLE,
    'Measurement is not editable.',
  );
}

export function measurementsAlreadyExists(): MeasurementsHttpException {
  return new MeasurementsHttpException(
    HttpStatus.CONFLICT,
    MEASUREMENTS_ERROR_CODES.MEASUREMENT_ALREADY_EXISTS,
    'An active measurement already exists for this service order.',
  );
}

export function mapMeasurementDomainError(error: MeasurementError): MeasurementsHttpException {
  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * FALHA DE BASE É 409, NÃO 400
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * "A base de medição não foi publicada" não é corpo malformado: a requisição
   * está correta, a autorização passou, e o ESTADO do negócio impede. Devolver
   * 400 culparia o cliente por uma condição da operação — e o operador leria
   * "dados inválidos" para uma execução que ainda não fechou.
   *
   * `MEASUREMENT_BASIS_MALFORMED` é a exceção parcial: a origem é dado corrompido,
   * mas quem pode corrigir é quem escreveu a base, não quem pediu a medição.
   * Também 409, com código próprio.
   */
  const codeMap: Record<string, (typeof MEASUREMENTS_ERROR_CODES)[keyof typeof MEASUREMENTS_ERROR_CODES]> = {
    MEASUREMENT_BASIS_NOT_PUBLISHED: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_NOT_PUBLISHED,
    MEASUREMENT_BASIS_NOT_READY: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_NOT_READY,
    MEASUREMENT_BASIS_ORDER_MISMATCH: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_ORDER_MISMATCH,
    MEASUREMENT_BASIS_EMPTY: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_EMPTY,
    MEASUREMENT_BASIS_MALFORMED: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_MALFORMED,
    MEASUREMENT_BASIS_DUPLICATE_LINE: MEASUREMENTS_ERROR_CODES.MEASUREMENT_BASIS_DUPLICATE_LINE,
    MEASUREMENT_LEGACY_ORIGIN: MEASUREMENTS_ERROR_CODES.MEASUREMENT_LEGACY_ORIGIN,
    SERVICE_ORDER_NOT_COMPLETED: MEASUREMENTS_ERROR_CODES.SERVICE_ORDER_NOT_COMPLETED,
    COMMERCIAL_REFERENCE_MISSING: MEASUREMENTS_ERROR_CODES.COMMERCIAL_REFERENCE_MISSING,
    MEASUREMENT_ITEMS_REQUIRED: MEASUREMENTS_ERROR_CODES.MEASUREMENT_ITEMS_REQUIRED,
    UNIT_NOT_ALLOWED: MEASUREMENTS_ERROR_CODES.UNIT_NOT_ALLOWED,
    UNIT_MISMATCH: MEASUREMENTS_ERROR_CODES.UNIT_MISMATCH,
    INVALID_MEASURED_QUANTITY: MEASUREMENTS_ERROR_CODES.INVALID_MEASURED_QUANTITY,
    QUANTITY_PRECISION_EXCEEDED: MEASUREMENTS_ERROR_CODES.QUANTITY_PRECISION_EXCEEDED,
    MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED: MEASUREMENTS_ERROR_CODES.MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED,
    INVALID_ADJUSTMENT_QUANTITY: MEASUREMENTS_ERROR_CODES.INVALID_ADJUSTMENT_QUANTITY,
    SEPARATION_OF_DUTIES_VIOLATION: MEASUREMENTS_ERROR_CODES.SEPARATION_OF_DUTIES_VIOLATION,
    EXECUTION_ENTRY_ALREADY_MEASURED: MEASUREMENTS_ERROR_CODES.EXECUTION_ENTRY_ALREADY_MEASURED,
    DUPLICATE_EXECUTION_ENTRY_SELECTION: MEASUREMENTS_ERROR_CODES.DUPLICATE_EXECUTION_ENTRY_SELECTION,
    MEASUREMENT_NOT_EDITABLE: MEASUREMENTS_ERROR_CODES.NOT_EDITABLE,
  };
  const code = codeMap[error.code] ?? MEASUREMENTS_ERROR_CODES.VALIDATION_FAILED;
  const conflictCodes = new Set([
    'MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED',
    'EXECUTION_ENTRY_ALREADY_MEASURED',
    'MEASUREMENT_NOT_EDITABLE',
    // Base de medição: condição de ESTADO, não corpo inválido.
    'MEASUREMENT_BASIS_NOT_PUBLISHED',
    'MEASUREMENT_BASIS_NOT_READY',
    'MEASUREMENT_BASIS_ORDER_MISMATCH',
    'MEASUREMENT_BASIS_EMPTY',
    'MEASUREMENT_BASIS_MALFORMED',
    'MEASUREMENT_BASIS_DUPLICATE_LINE',
    'MEASUREMENT_LEGACY_ORIGIN',
  ]);
  const status = conflictCodes.has(error.code) ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;
  return new MeasurementsHttpException(status, code, error.code);
}
