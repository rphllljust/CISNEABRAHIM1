import { describe, expect, it } from 'vitest';
import {
  ELIGIBILITY_DIMENSIONS,
  ELIGIBILITY_RESULTS,
  ELIGIBILITY_STATUSES,
  evaluateBillingEligibility,
  transitionedAwayFromReady,
  transitionedToReady,
  type BillingEligibilityFacts,
} from './billing-eligibility';
import { BILLING_ENTITLEMENT_POLICIES } from '../../billing/domain/billing-entitlement';

/**
 * BILLING ELIGIBILITY — o `READY_TO_BILL` como MODELO DE DECISÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Antes, a elegibilidade era um FILTRO SQL dentro da worklist de faturamento:
 * `m.status = 'APPROVED'` e totais de item. Duas consequências medidas:
 *
 *   1. o operador via `measurement_pending` sem saber POR QUÊ;
 *   2. o ACEITE DO CLIENTE não participava — entrega recusada podia aparecer
 *      como `ready`.
 *
 * Estes testes afirmam o contrário:
 *
 *   - o resultado é DERIVADO das dimensões, nunca declarado à parte;
 *   - toda dimensão bloqueante traz motivo em CÓDIGO e próxima ação;
 *   - `null` (desconhecido) nunca libera faturamento;
 *   - a política `MEASUREMENT_APPROVED` continua sendo a única que exige
 *     aprovação — nenhuma segunda regra de entitlement foi criada.
 */

function facts(overrides: Partial<BillingEligibilityFacts> = {}): BillingEligibilityFacts {
  return {
    serviceOrderId: 'so-1',
    measurementId: 'm-1',
    unitId: 'PVH',
    executionClosed: true,
    executionClosedAt: '2026-10-20T10:00:00.000Z',
    measurementStatus: 'APPROVED',
    measurementApprovedAt: '2026-10-21T10:00:00.000Z',
    measurementTotalAmount: '124880.0000',
    measurementCurrencyCode: 'BRL',
    measurementItemCount: 3,
    acceptanceRequired: true,
    acceptanceState: 'ACCEPTED',
    acceptanceBlockingReason: null,
    variancesRequiringDecision: 0,
    varianceBlockingReason: null,
    policy: BILLING_ENTITLEMENT_POLICIES.MeasurementApproved,
    purchaseOrderRequired: false,
    purchaseOrderPresent: false,
    commercialTermsAuthoritative: '30 dias',
    commercialTermsDeclared: '30 dias',
    commercialTermsMismatch: false,
    billingRecordPrepared: false,
    ...overrides,
  };
}

describe('evaluateBillingEligibility — READY é o único liberador', () => {
  it('cadeia completa resulta READY com valor e sem próxima ação', () => {
    const decision = evaluateBillingEligibility(facts());

    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Ready);
    expect(decision.blockingReasons).toEqual([]);
    expect(decision.nextAction).toBeNull();
    expect(decision.totalAmount).toBe('124880.0000');
    expect(decision.currencyCode).toBe('BRL');
    expect(decision.summary).toContain('Pronto para faturar');
  });

  it('toda dimensão declara status, rótulo e detalhe — a tela não redige', () => {
    const decision = evaluateBillingEligibility(facts());
    expect(decision.dimensions.length).toBeGreaterThan(0);
    for (const dimension of decision.dimensions) {
      expect(dimension.label.length).toBeGreaterThan(0);
      expect(dimension.statusLabel.length).toBeGreaterThan(0);
      expect(dimension.detail.length).toBeGreaterThan(0);
    }
  });
});

describe('evaluateBillingEligibility — aceite do cliente participa', () => {
  it('aceite PENDENTE impede o faturamento com motivo e ação', () => {
    const decision = evaluateBillingEligibility(
      facts({
        acceptanceState: 'PENDING',
        acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
      }),
    );

    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Pending);
    expect(decision.blockingReasons).toContain('CUSTOMER_ACCEPTANCE_PENDING');
    expect(decision.nextAction).toEqual({
      code: 'OBTAIN_CUSTOMER_ACCEPTANCE',
      label: 'Registrar aceite do cliente',
    });

    const acceptanceDimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
    )!;
    // PENDING é dependência de FATO FUTURO, não bloqueio interno.
    expect(acceptanceDimension.status).toBe(ELIGIBILITY_STATUSES.Pending);
    expect(acceptanceDimension.blocking).toBe(true);
  });

  it('aceite REJEITADO é BLOCKED (não PENDING): exige ação, não espera', () => {
    const decision = evaluateBillingEligibility(
      facts({
        acceptanceState: 'REJECTED',
        acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_REJECTED',
      }),
    );

    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
    const acceptanceDimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
    )!;
    expect(acceptanceDimension.status).toBe(ELIGIBILITY_STATUSES.Blocked);
    expect(acceptanceDimension.nextActionCode).toBe('CORRECT_AND_REQUEST_ACCEPTANCE');
  });

  it('política que não exige aceite resulta NOT_APPLICABLE e não bloqueia', () => {
    const decision = evaluateBillingEligibility(
      facts({ acceptanceRequired: false, acceptanceState: 'NOT_REQUIRED' }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Ready);
    const acceptanceDimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
    )!;
    expect(acceptanceDimension.status).toBe(ELIGIBILITY_STATUSES.NotApplicable);
    expect(acceptanceDimension.blocking).toBe(false);
  });

  it('aceite registrado SEM a evidência exigida ainda bloqueia', () => {
    const decision = evaluateBillingEligibility(
      facts({
        acceptanceState: 'ACCEPTED',
        acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING',
      }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
    expect(decision.blockingReasons).toContain('CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING');
  });
});

describe('evaluateBillingEligibility — dimensões preservam regras existentes', () => {
  it('execução não fechada bloqueia', () => {
    const decision = evaluateBillingEligibility(
      facts({ executionClosed: false, executionClosedAt: null }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
    expect(decision.blockingReasons).toContain('EXECUTION_NOT_CLOSED');
    expect(decision.nextAction?.code).toBe('CLOSE_EXECUTION');
  });

  it('medição ausente bloqueia com motivo próprio', () => {
    const decision = evaluateBillingEligibility(facts({ measurementId: null, measurementStatus: null }));
    expect(decision.blockingReasons).toContain('MEASUREMENT_MISSING');
    expect(decision.nextAction?.code).toBe('CREATE_MEASUREMENT');
  });

  it('medição não aprovada bloqueia', () => {
    const decision = evaluateBillingEligibility(facts({ measurementStatus: 'UNDER_REVIEW' }));
    expect(decision.blockingReasons).toContain('MEASUREMENT_NOT_APPROVED');
    expect(decision.nextAction?.code).toBe('APPROVE_MEASUREMENT');
  });

  it('FIXED_PRICE não exige aprovação de medição — entitlemente preservado', () => {
    const decision = evaluateBillingEligibility(
      facts({
        policy: BILLING_ENTITLEMENT_POLICIES.FixedPrice,
        measurementStatus: null,
        measurementId: null,
      }),
    );
    const dimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.MeasurementApproved,
    )!;
    expect(dimension.status).toBe(ELIGIBILITY_STATUSES.NotApplicable);
    expect(dimension.blocking).toBe(false);
  });

  it('PERIODIC também dispensa aprovação de medição', () => {
    const decision = evaluateBillingEligibility(
      facts({
        policy: BILLING_ENTITLEMENT_POLICIES.Periodic,
        acceptanceRequired: false,
        acceptanceState: 'NOT_REQUIRED',
      }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Ready);
    // O valor NÃO é declarado aqui: a base contratada é resolvida no ato de
    // preparar. Um número a mais seria uma segunda conta do mesmo dinheiro.
    expect(decision.totalAmount).toBeNull();
  });

  it('ordem de compra exigida e ausente bloqueia', () => {
    const decision = evaluateBillingEligibility(
      facts({ purchaseOrderRequired: true, purchaseOrderPresent: false }),
    );
    expect(decision.blockingReasons).toContain('PURCHASE_ORDER_REQUIRED');
    expect(decision.nextAction?.code).toBe('REGISTER_PURCHASE_ORDER');
  });

  it('ordem de compra exigida e PRESENTE satisfaz', () => {
    const decision = evaluateBillingEligibility(
      facts({ purchaseOrderRequired: true, purchaseOrderPresent: true }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Ready);
  });

  it('divergência de condições comerciais bloqueia', () => {
    const decision = evaluateBillingEligibility(facts({ commercialTermsMismatch: true }));
    expect(decision.blockingReasons).toContain('COMMERCIAL_TERMS_DIVERGENCE');
  });

  it('sem fonte comercial não há divergência a declarar', () => {
    const decision = evaluateBillingEligibility(
      facts({
        commercialTermsAuthoritative: null,
        commercialTermsDeclared: null,
        commercialTermsMismatch: false,
      }),
    );
    const dimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.CommercialTerms,
    )!;
    expect(dimension.status).toBe(ELIGIBILITY_STATUSES.NotApplicable);
  });
});

describe('evaluateBillingEligibility — variação e base de preço', () => {
  it('variação que exige decisão bloqueia a elegibilidade', () => {
    const decision = evaluateBillingEligibility(
      facts({ variancesRequiringDecision: 2, varianceBlockingReason: 'VARIANCE_REQUIRES_AUTHORIZATION' }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
    expect(decision.blockingReasons).toContain('VARIANCE_REQUIRES_AUTHORIZATION');
    expect(decision.nextAction?.code).toBe('RESOLVE_VARIANCE');
  });

  it('medição sem itens é base de preço ausente', () => {
    const decision = evaluateBillingEligibility(
      facts({ measurementItemCount: 0, measurementTotalAmount: null }),
    );
    expect(decision.blockingReasons).toContain('BILLING_BASIS_MISSING');
  });

  it('item sem preço apurado é base INCOMPLETA, motivo distinto', () => {
    const decision = evaluateBillingEligibility(facts({ measurementTotalAmount: null }));
    expect(decision.blockingReasons).toContain('BILLING_BASIS_INCOMPLETE');
  });
});

describe('evaluateBillingEligibility — precedência e derivação', () => {
  it('vários bloqueios: o resultado é BLOCKED e a próxima ação é a PRIMEIRA por gravidade', () => {
    const decision = evaluateBillingEligibility(
      facts({
        executionClosed: false,
        measurementStatus: 'DRAFT',
        acceptanceState: 'PENDING',
        acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
      }),
    );

    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
    // Execução fechada vem primeiro: sem ela nada adiante importa.
    expect(decision.nextAction?.code).toBe('CLOSE_EXECUTION');
    expect(decision.dimensions[0]!.dimension).toBe(ELIGIBILITY_DIMENSIONS.ExecutionClosed);
  });

  it('só dependências pendentes → resultado PENDING (não BLOCKED)', () => {
    const decision = evaluateBillingEligibility(
      facts({
        acceptanceState: 'PENDING',
        acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
      }),
    );
    expect(decision.result).toBe(ELIGIBILITY_RESULTS.Pending);
    expect(decision.explanation).toContain('fato que ainda não ocorreu');
  });

  it('o resultado é DERIVADO: nunca discorda das dimensões', () => {
    const scenarios: BillingEligibilityFacts[] = [
      facts(),
      facts({ executionClosed: false }),
      facts({ acceptanceState: 'PENDING', acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_PENDING' }),
      facts({ measurementStatus: 'REJECTED' }),
      facts({ variancesRequiringDecision: 1 }),
    ];
    for (const scenario of scenarios) {
      const decision = evaluateBillingEligibility(scenario);
      const blocking = decision.dimensions.filter((item) => item.blocking);
      if (blocking.length === 0) {
        expect(decision.result).toBe(ELIGIBILITY_RESULTS.Ready);
      } else if (blocking.some((item) => item.status === ELIGIBILITY_STATUSES.Blocked)) {
        expect(decision.result).toBe(ELIGIBILITY_RESULTS.Blocked);
      } else {
        expect(decision.result).toBe(ELIGIBILITY_RESULTS.Pending);
      }
    }
  });

  it('é determinística: mesma entrada, mesma saída', () => {
    expect(JSON.stringify(evaluateBillingEligibility(facts()))).toBe(
      JSON.stringify(evaluateBillingEligibility(facts())),
    );
  });

  it('faturamento já preparado sai da capability e não bloqueia', () => {
    const decision = evaluateBillingEligibility(facts({ billingRecordPrepared: true }));
    const dimension = decision.dimensions.find(
      (item) => item.dimension === ELIGIBILITY_DIMENSIONS.BillingRecordAbsent,
    )!;
    expect(dimension.status).toBe(ELIGIBILITY_STATUSES.NotApplicable);
    expect(dimension.blocking).toBe(false);
  });
});

describe('transições de elegibilidade', () => {
  it('publica liberação apenas na ENTRADA em READY', () => {
    expect(transitionedToReady(null, ELIGIBILITY_RESULTS.Ready)).toBe(true);
    expect(transitionedToReady(ELIGIBILITY_RESULTS.Blocked, ELIGIBILITY_RESULTS.Ready)).toBe(true);
    expect(transitionedToReady(ELIGIBILITY_RESULTS.Ready, ELIGIBILITY_RESULTS.Ready)).toBe(false);
  });

  it('publica bloqueio apenas quando HAVIA liberação', () => {
    expect(transitionedAwayFromReady(ELIGIBILITY_RESULTS.Ready, ELIGIBILITY_RESULTS.Blocked)).toBe(
      true,
    );
    // Um impeditivo estável não pode virar fluxo de eventos: o consumidor
    // trataria ruído como mudança.
    expect(transitionedAwayFromReady(ELIGIBILITY_RESULTS.Blocked, ELIGIBILITY_RESULTS.Blocked)).toBe(
      false,
    );
    expect(transitionedAwayFromReady(null, ELIGIBILITY_RESULTS.Blocked)).toBe(false);
  });
});
