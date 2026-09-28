import { describe, expect, it } from 'vitest';
import { AUTHZ_SCOPES } from '../types/authz-scopes';
import type { GrantRow } from '../repositories/authorization.repository';
import { ScopeEnforcementService } from './scope-enforcement.service';

/**
 * P0 — ESCOPO DE UNIDADE NAS LISTAS DE SUPRIMENTOS.
 *
 * Achado da auditoria: `listRequests`/`listOrders` verificavam apenas a PRESENÇA de concessão.
 * Uma concessão ancorada na unidade A devolvia linhas da unidade B — leitura cruzada entre
 * unidades. A correção é no DOMÍNIO DONO (`ProcurementAccessService` + este predicado), não
 * na fila de trabalho: assim qualquer consumidor da lista fica coberto.
 *
 * O que estes testes travam:
 * - concessão de unidade A não lê B;
 * - ausência de concessão não lê nada (fail-closed explícito);
 * - concessão GLOBAL sem âncora continua valendo, porque o contrato prevê leitura ampla;
 * - concessão de outra natureza (cliente/documento) NÃO amplia leitura de unidade.
 */

function grant(overrides: Partial<GrantRow>): GrantRow {
  return {
    scope_type: AUTHZ_SCOPES.Unit,
    resource_id: 'UN-A',
    ...overrides,
  } as GrantRow;
}

/**
 * Os builders de lista são puros (só leem as concessões), então o resolvedor de escopo não é
 * exercitado aqui — ele é injetado apenas para satisfazer o construtor do serviço.
 */
const service = new ScopeEnforcementService({} as never);

describe('escopo de leitura de suprimentos', () => {
  it('concessão da unidade A restringe a consulta à unidade A', () => {
    const predicate = service.buildProcurementListFilter([grant({ resource_id: 'UN-A' })], 'r');

    expect(predicate.clause).toBe('r.unit_id = ANY($1::text[])');
    expect(predicate.params).toEqual([['UN-A']]);
  });

  it('nunca produz cláusula que libere outra unidade', () => {
    const predicate = service.buildProcurementListFilter(
      [grant({ resource_id: 'UN-A' }), grant({ resource_id: 'UN-C' })],
      'o',
    );

    expect(predicate.clause).not.toBe('TRUE');
    expect(predicate.params[0]).toEqual(['UN-A', 'UN-C']);
    // A lista de unidades concedidas é o único critério: nada além dela entra no predicado.
    expect(predicate.params).toHaveLength(1);
  });

  it('sem concessão alguma devolve FALSE (fail-closed, nada é lido)', () => {
    expect(service.buildProcurementListFilter([])).toEqual({ clause: 'FALSE', params: [] });
  });

  it('concessão de outra natureza não libera leitura de unidade', () => {
    const predicate = service.buildProcurementListFilter([
      grant({ scope_type: AUTHZ_SCOPES.Client, resource_id: null }),
    ]);

    expect(predicate).toEqual({ clause: 'FALSE', params: [] });
  });

  it('concessão UNIT sem âncora não libera nada', () => {
    const predicate = service.buildProcurementListFilter([grant({ resource_id: null })]);

    expect(predicate).toEqual({ clause: 'FALSE', params: [] });
  });

  it('concessão GLOBAL sem âncora mantém a leitura ampla prevista no contrato', () => {
    const predicate = service.buildProcurementListFilter([
      grant({ scope_type: AUTHZ_SCOPES.Global, resource_id: null }),
    ]);

    expect(predicate).toEqual({ clause: 'TRUE', params: [] });
  });

  it('GLOBAL sem âncora prevalece sobre concessões de unidade (mesma semântica dos demais builders)', () => {
    const predicate = service.buildProcurementListFilter([
      grant({ resource_id: 'UN-A' }),
      grant({ scope_type: AUTHZ_SCOPES.Global, resource_id: null }),
    ]);

    expect(predicate).toEqual({ clause: 'TRUE', params: [] });
  });

  it('aplica o alias da tabela para não colidir com joins da consulta', () => {
    const withAlias = service.buildProcurementListFilter([grant({})], 'o');
    expect(withAlias.clause.startsWith('o.unit_id')).toBe(true);

    const withoutAlias = service.buildProcurementListFilter([grant({})]);
    expect(withoutAlias.clause.startsWith('unit_id')).toBe(true);
  });
});

describe('escopo de leitura de despesas (mesmo achado, domínio financeiro)', () => {
  it('concessão da unidade A restringe a consulta à unidade A', () => {
    const predicate = service.buildExpenseListFilter([grant({ resource_id: 'UN-A' })]);

    expect(predicate.clause).toBe('unit_id = ANY($1::text[])');
    expect(predicate.params).toEqual([['UN-A']]);
  });

  it('sem unidade coberta devolve FALSE em vez de liberar a consulta', () => {
    expect(service.buildExpenseListFilter([])).toEqual({ clause: 'FALSE', params: [] });
    expect(
      service.buildExpenseListFilter([grant({ scope_type: AUTHZ_SCOPES.Client, resource_id: null })]),
    ).toEqual({ clause: 'FALSE', params: [] });
  });

  it('GLOBAL sem âncora mantém leitura ampla', () => {
    expect(
      service.buildExpenseListFilter([
        grant({ scope_type: AUTHZ_SCOPES.Global, resource_id: null }),
      ]),
    ).toEqual({ clause: 'TRUE', params: [] });
  });
});
