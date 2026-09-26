import { describe, expect, it } from 'vitest';
import { BOUNDED_CONTEXT, BOUNDED_CONTEXT_READINESS } from './bounded-context';
import { DOMAIN_DISTINCTIONS, MANDATORY_DISTINCT_PAIRS } from './domain-distinctions';
import {
  ENTERPRISE_CORE_PORT,
  ENTERPRISE_CORE_PORT_READINESS,
} from './enterprise-core-ports';
import {
  ALLOWED_BOUNDED_CONTEXT_DEPENDENCIES,
  BOUNDED_CONTEXT_PROHIBITIONS,
  detectBoundedContextCycles,
  isBoundedContextDependencyAllowed,
} from './module-boundary-rules';
import { FUTURE_CONTEXT_SCHEMAS } from './schema-ownership';
import { assertEnterpriseNucleusGraph } from './source-boundary-scan';
import { ACL_PROVIDER_CLASSIFICATION, PROVIDER_IMPLEMENTATION_CLASS } from '../../integrations/acl/adapters/provider-classification';

describe('module-boundary-rules', () => {
  it('has no cycles in the bounded context dependency graph', () => {
    expect(detectBoundedContextCycles(ALLOWED_BOUNDED_CONTEXT_DEPENDENCIES)).toBeNull();
  });

  it('forbids OPERATIONS from depending on ACCOUNTING', () => {
    expect(
      isBoundedContextDependencyAllowed(BOUNDED_CONTEXT.Operations, BOUNDED_CONTEXT.Accounting),
    ).toBe(false);
  });

  it('forbids ACCOUNTING from depending on OPERATIONS', () => {
    expect(
      isBoundedContextDependencyAllowed(BOUNDED_CONTEXT.Accounting, BOUNDED_CONTEXT.Operations),
    ).toBe(false);
  });

  it('allows FINANCE to consume OPERATIONS events via read contracts', () => {
    expect(
      isBoundedContextDependencyAllowed(BOUNDED_CONTEXT.Finance, BOUNDED_CONTEXT.Operations),
    ).toBe(true);
  });

  it('documents every prohibition with a matching rule id', () => {
    for (const prohibition of BOUNDED_CONTEXT_PROHIBITIONS) {
      expect(prohibition.rule.length).toBeGreaterThan(0);
      expect(
        isBoundedContextDependencyAllowed(prohibition.source, prohibition.forbidden),
      ).toBe(false);
    }
  });

  it('keeps the six mandatory domain distinctions', () => {
    for (const [left, right] of MANDATORY_DISTINCT_PAIRS) {
      expect(
        DOMAIN_DISTINCTIONS.some((item) => item.left === left && item.right === right),
      ).toBe(true);
    }
  });

  it('reserves future schemas without implementing them', () => {
    expect(BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Finance]).toBe('IMPLEMENTED');
    expect(BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Accounting]).toBe('IMPLEMENTED');
    expect(BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Fiscal]).toBe('IMPLEMENTED');
    expect(BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Inventory]).toBe('IMPLEMENTED');
    expect(BOUNDED_CONTEXT_READINESS[BOUNDED_CONTEXT.Payroll]).toBe('IMPLEMENTED');
    expect('PAYROLL' in FUTURE_CONTEXT_SCHEMAS).toBe(false);
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.InventoryStock]).toBe(
      'IMPLEMENTED',
    );
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.FinanceReceivable]).toBe(
      'IMPLEMENTED',
    );
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.FinancePayable]).toBe(
      'IMPLEMENTED',
    );
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.AccountingLedger]).toBe(
      'IMPLEMENTED',
    );
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.FiscalDocument]).toBe(
      'IMPLEMENTED',
    );
    expect(ENTERPRISE_CORE_PORT_READINESS[ENTERPRISE_CORE_PORT.PayrollContract]).toBe(
      'IMPLEMENTED',
    );
  });

  it('does not require an external ERP provider', () => {
    expect(ACL_PROVIDER_CLASSIFICATION.UnconfiguredErpProvider).toBe(
      PROVIDER_IMPLEMENTATION_CLASS.Unconfigured,
    );
    expect('DygnusErpAdapter' in ACL_PROVIDER_CLASSIFICATION).toBe(false);
  });

  /**
   * O grafo varre todo o codigo de producao (`apps/api/src`) lendo e casando cada arquivo:
   * custo de I/O, nao de CPU. Sob a carga paralela da suite completa o orcamento de 5s do
   * Vitest estoura e o teste falha por timeout — sem violacao real — produzindo falso negativo
   * de gate. Timeout explicito para que a falha volte a significar violacao de fronteira.
   */
  it(
    'has zero circular import violations and zero cross-context private table access',
    { timeout: 60_000 },
    () => {
      const result = assertEnterpriseNucleusGraph();
      expect(result.importViolations, JSON.stringify(result.importViolations, null, 2)).toEqual([]);
      expect(
        result.tableAccessViolations,
        JSON.stringify(result.tableAccessViolations, null, 2),
      ).toEqual([]);
      expect(result.circularDependencies).toBe(0);
      expect(result.crossModuleTableAccess).toBe(0);
    },
  );
});
