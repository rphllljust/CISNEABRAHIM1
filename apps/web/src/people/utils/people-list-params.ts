import { PERSON_STATUSES, type PersonStatus } from '../types/person.types';

/**
 * Os links compartilhados podem carregar parametros invalidos ou antigos.
 * Apenas status reconhecidos pelo dominio atravessam a fronteira HTTP.
 */
export function parsePeopleStatusParam(raw: string | null): '' | PersonStatus {
  return raw === PERSON_STATUSES.Active || raw === PERSON_STATUSES.Inactive ? raw : '';
}

/**
 * Nao enviar NaN, infinito, fracao, negativo ou valor impreciso ao backend.
 * A lista continua usando a paginacao server-side existente, sem inferir total.
 */
export function parsePeopleOffsetParam(raw: string | null): number {
  if (raw === null || !/^(0|[1-9]\d*)$/.test(raw)) return 0;
  const offset = Number(raw);
  return Number.isSafeInteger(offset) ? offset : 0;
}
