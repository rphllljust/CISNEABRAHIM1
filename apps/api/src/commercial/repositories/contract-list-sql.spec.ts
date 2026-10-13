import { describe, expect, it } from 'vitest';
import {
  buildContractListOrderClause,
  buildContractListWhere,
  isContractListDirection,
  isContractListSort,
  parseContractAdvancedFilter,
  ContractListQueryError,
  type ContractListFilters,
} from './contract-list-sql';
import { CONTRACT_STATUSES } from '../domain/contract';

/**
 * A área de trabalho de contratos ganhou sua camada de listagem nesta sessão: antes o serviço
 * montava o predicado inline e conhecia apenas cliente e unidade.
 *
 * O recorte mais delicado do domínio é a VIGÊNCIA: `valid_to` é opcional, e `NULL` significa prazo
 * INDETERMINADO. Tratá-lo como "sem data" excluiria do recorte de vigência justamente o contrato
 * que segue regendo o trabalho — por isso há teste dedicado a esse caso.
 */

const SCOPE = { clause: 'unit_id = $1', params: ['UNIDADE-1'] as unknown[] };

function resolved(overrides: Record<string, unknown> = {}): ContractListFilters {
  return overrides;
}

describe('buildContractListWhere', () => {
  it('keeps the authorization scope as the FIRST predicate term', () => {
    const where = buildContractListWhere(SCOPE, resolved());
    expect(where.clause).toBe('unit_id = $1');
    expect(where.params).toEqual(['UNIDADE-1']);
  });

  it('binds enumerated status through the real Postgres type and rejects the rest', () => {
    const where = buildContractListWhere(SCOPE, resolved({ status: CONTRACT_STATUSES.Active }));
    expect(where.clause).toContain('status = $2::com.contract_status');
    expect(() => buildContractListWhere(SCOPE, resolved({ status: 'SUSPENDED' }))).toThrow(
      ContractListQueryError,
    );
  });

  it('treats an open-ended contract as still effective, not as a missing date', () => {
    // `valid_to IS NULL` é prazo indeterminado: o contrato segue vigente e NÃO pode ser excluído
    // de um recorte "vigente a partir de X".
    const where = buildContractListWhere(SCOPE, resolved({ effectiveFrom: '2026-01-01' }));
    expect(where.clause).toContain('valid_to IS NULL OR valid_to >= $2::date');
  });

  it('bounds the effective window on both sides', () => {
    const where = buildContractListWhere(
      SCOPE,
      resolved({ effectiveFrom: '2026-01-01', effectiveTo: '2026-12-31' }),
    );
    expect(where.clause).toContain('valid_to IS NULL OR valid_to >= $2::date');
    expect(where.clause).toContain('valid_from <= $3::date');
  });

  it('searches the three identifying fields and escapes LIKE metacharacters', () => {
    const where = buildContractListWhere(SCOPE, resolved({ search: 'CT%_' }));
    expect(where.clause).toContain('contract_number ILIKE $2');
    expect(where.clause).toContain('internal_code ILIKE $2');
    expect(where.clause).toContain('title ILIKE $2');
    expect(where.params[1]).toBe('%CT\\%\\_%');
  });

  it('conjoins the advanced predicate with the other recortes in ONE query', () => {
    const where = buildContractListWhere(
      SCOPE,
      resolved({
        status: CONTRACT_STATUSES.Active,
        search: 'CT-2026',
        advanced: parseContractAdvancedFilter({
          connector: 'AND',
          groups: [{ conditions: [{ field: 'currencyCode', operator: 'eq', value: 'BRL' }] }],
        }),
      }),
    );
    expect(where.clause).toContain('status = $2');
    expect(where.clause).toContain('contract_number ILIKE $3');
    expect(where.clause).toContain('currency_code = $4');
  });
});

describe('parseContractAdvancedFilter', () => {
  it('accepts the published shape and the URL string form', () => {
    const shape = {
      connector: 'AND' as const,
      groups: [{ conditions: [{ field: 'status', operator: 'eq', value: 'ACTIVE' }] }],
    };
    expect(parseContractAdvancedFilter(shape)?.groups).toHaveLength(1);
    expect(parseContractAdvancedFilter(JSON.stringify(shape))?.groups).toHaveLength(1);
  });

  it('rejects a field outside the allow-list and an operator the kind does not admit', () => {
    expect(() =>
      parseContractAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'closure_reason', operator: 'eq', value: 'x' }] }],
      }),
    ).toThrow();
    expect(() =>
      parseContractAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'status', operator: 'contains', value: 'ACT' }] }],
      }),
    ).toThrow();
  });

  it('rejects an invalid date and malformed JSON', () => {
    expect(() =>
      parseContractAdvancedFilter({
        connector: 'AND',
        groups: [{ conditions: [{ field: 'validFrom', operator: 'after', value: 'ontem' }] }],
      }),
    ).toThrow();
    expect(() => parseContractAdvancedFilter('{oops')).toThrow();
  });

  it('treats an empty filter as absence rather than an error', () => {
    expect(parseContractAdvancedFilter(undefined)).toBeUndefined();
    expect(parseContractAdvancedFilter({ connector: 'OR', groups: [] })).toBeUndefined();
  });
});

describe('buildContractListOrderClause', () => {
  it('defaults to the current validity first, which is the operational question of the domain', () => {
    expect(buildContractListOrderClause()).toBe('valid_from DESC, id DESC');
  });

  it('keeps open-ended validity last, because it is not the one that ends soonest', () => {
    expect(buildContractListOrderClause('validTo', 'asc')).toContain('NULLS LAST');
  });

  it('refuses values outside the allow-list instead of interpolating them', () => {
    expect(() => buildContractListOrderClause('valid_from; DROP TABLE' as never)).toThrow(
      ContractListQueryError,
    );
    expect(isContractListSort('validFrom')).toBe(true);
    expect(isContractListSort('title')).toBe(false);
    expect(isContractListDirection('up')).toBe(false);
  });
});
