import { describe, expect, it } from 'vitest';
import {
  ACCEPTANCE_POLICIES,
  ACCEPTANCE_POLICY_SOURCES,
  ACCEPTANCE_STATES,
  applyAcceptancePolicy,
  deriveAcceptanceState,
  requiresCustomerAcceptance,
  resolveAcceptancePolicy,
  type PersistedAcceptance,
} from './acceptance-policy';
import { ACCEPTANCE_RESULTS } from '../../service-orders/domain/service-acceptance';
import { ServiceAcceptanceError } from '../../service-orders/domain/service-acceptance-errors';

/**
 * ACEITE DO CLIENTE — de função pura a capability.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROVAM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * `service-acceptance.ts` já existia e já sabia registrar decisão. O que não
 * existia era a POLÍTICA: "o aceite é sequer aplicável a esta entrega?". Sem ela,
 * ou se exigia aceite de tudo (bloqueando contrato que nunca previu aceite) ou de
 * nada (liberando faturamento de entrega recusada).
 *
 * Estes testes afirmam:
 *
 *   - a política tem PRECEDÊNCIA declarada e FONTE explícita;
 *   - a ausência de fonte é declarada (`DEFAULT`), nunca silenciosa;
 *   - a política ADICIONAL não substitui a regra existente — ela compõe;
 *   - o estado do aceite é uma DIMENSÃO independente do status da medição.
 */

function acceptance(overrides: Partial<PersistedAcceptance> = {}): PersistedAcceptance {
  return {
    id: 'acc-1',
    cycleNumber: 1,
    result: 'ACCEPTED',
    observation: 'Entrega conferida em campo.',
    rejectionReason: null,
    evidenceId: 'doc-1',
    signatureId: 'sig-1',
    customerSignerName: 'João da Silva',
    acceptedByIdentityId: 'identity-1',
    occurredAt: '2026-10-20T12:00:00.000Z',
    ...overrides,
  };
}

describe('resolveAcceptancePolicy — precedência declarada', () => {
  it('o CONTRATO governa sobre tudo', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: { acceptanceRequired: true },
      serviceSnapshot: { acceptancePolicy: ACCEPTANCE_POLICIES.NotRequired },
      clientPurchaseOrderRequirement: 'BEFORE_BILLING',
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.RequiredBeforeBilling);
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.Contract);
  });

  it('o contrato pode declarar exigência COM evidência', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: { acceptanceRequired: true, acceptanceEvidenceRequired: true },
      serviceSnapshot: null,
      clientPurchaseOrderRequirement: null,
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.RequiredWithEvidence);
    expect(resolved.requiresEvidence).toBe(true);
  });

  it('o contrato pode NEGAR expressamente o aceite', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: { acceptanceRequired: false },
      serviceSnapshot: { acceptancePolicy: ACCEPTANCE_POLICIES.RequiredBeforeBilling },
      clientPurchaseOrderRequirement: 'BEFORE_BILLING',
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.NotRequired);
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.Contract);
  });

  it('sem contrato, o SERVIÇO governa', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: null,
      serviceSnapshot: { acceptancePolicy: ACCEPTANCE_POLICIES.RequiredBeforeBilling },
      clientPurchaseOrderRequirement: null,
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.RequiredBeforeBilling);
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.Service);
  });

  it('sem contrato nem serviço, a exigência do CLIENTE governa', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: null,
      serviceSnapshot: null,
      clientPurchaseOrderRequirement: 'BEFORE_BILLING',
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.RequiredBeforeBilling);
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.ClientRequirement);
  });

  it('cliente que exige PO só na execução NÃO implica aceite de entrega', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: null,
      serviceSnapshot: null,
      clientPurchaseOrderRequirement: 'BEFORE_EXECUTION',
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.NotRequired);
  });

  it('nenhuma fonte declara exigência: NOT_REQUIRED com fonte DEFAULT e motivo visível', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: null,
      serviceSnapshot: null,
      clientPurchaseOrderRequirement: null,
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.NotRequired);
    // A lacuna é um DADO, não uma suposição silenciosa.
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.Default);
    expect(resolved.reason).toContain('Nenhuma fonte comercial declarou');
  });

  it('número ou texto no lugar do booleano não vira exigência por coerção', () => {
    const resolved = resolveAcceptancePolicy({
      contractSnapshot: { acceptanceRequired: 'true' },
      serviceSnapshot: null,
      clientPurchaseOrderRequirement: null,
    });
    expect(resolved.policy).toBe(ACCEPTANCE_POLICIES.NotRequired);
    expect(resolved.source).toBe(ACCEPTANCE_POLICY_SOURCES.Default);
  });
});

describe('requiresCustomerAcceptance', () => {
  it('só NOT_REQUIRED dispensa o aceite', () => {
    expect(requiresCustomerAcceptance(ACCEPTANCE_POLICIES.NotRequired)).toBe(false);
    expect(requiresCustomerAcceptance(ACCEPTANCE_POLICIES.RequiredBeforeBilling)).toBe(true);
    expect(requiresCustomerAcceptance(ACCEPTANCE_POLICIES.RequiredWithEvidence)).toBe(true);
  });
});

describe('deriveAcceptanceState — dimensão independente', () => {
  it('política que não exige aceite resulta NOT_REQUIRED e não bloqueia', () => {
    const state = deriveAcceptanceState({
      policy: ACCEPTANCE_POLICIES.NotRequired,
      latestAcceptance: null,
    });
    expect(state.state).toBe(ACCEPTANCE_STATES.NotRequired);
    expect(state.blocksBilling).toBe(false);
    expect(state.blockingReason).toBeNull();
  });

  it('política que exige aceite sem decisão resulta PENDING e bloqueia', () => {
    const state = deriveAcceptanceState({
      policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
      latestAcceptance: null,
    });
    expect(state.state).toBe(ACCEPTANCE_STATES.Pending);
    expect(state.blocksBilling).toBe(true);
    expect(state.blockingReason).toBe('CUSTOMER_ACCEPTANCE_PENDING');
    expect(state.nextActionCode).toBe('OBTAIN_CUSTOMER_ACCEPTANCE');
  });

  it('aceite ACEITO satisfaz e libera', () => {
    const state = deriveAcceptanceState({
      policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
      latestAcceptance: acceptance(),
    });
    expect(state.state).toBe(ACCEPTANCE_STATES.Accepted);
    expect(state.blocksBilling).toBe(false);
  });

  it('aceite REJEITADO bloqueia e exige correção', () => {
    const state = deriveAcceptanceState({
      policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
      latestAcceptance: acceptance({ result: 'REJECTED', rejectionReason: 'Volume divergente' }),
    });
    expect(state.state).toBe(ACCEPTANCE_STATES.Rejected);
    expect(state.blocksBilling).toBe(true);
    expect(state.blockingReason).toBe('CUSTOMER_ACCEPTANCE_REJECTED');
    expect(state.nextActionCode).toBe('CORRECT_AND_REQUEST_ACCEPTANCE');
  });

  it('política COM EVIDÊNCIA recusa aceite sem documento anexado', () => {
    const state = deriveAcceptanceState({
      policy: ACCEPTANCE_POLICIES.RequiredWithEvidence,
      latestAcceptance: acceptance({ evidenceId: null }),
    });
    expect(state.state).toBe(ACCEPTANCE_STATES.Accepted);
    // A decisão existe, mas o documento que a sustenta não — e é o documento que
    // o cliente questiona depois.
    expect(state.blocksBilling).toBe(true);
    expect(state.blockingReason).toBe('CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING');
  });

  it('a MESMA decisão libera com política simples e bloqueia com política de evidência', () => {
    const withoutEvidence = acceptance({ evidenceId: null });
    expect(
      deriveAcceptanceState({
        policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
        latestAcceptance: withoutEvidence,
      }).blocksBilling,
    ).toBe(false);
    expect(
      deriveAcceptanceState({
        policy: ACCEPTANCE_POLICIES.RequiredWithEvidence,
        latestAcceptance: withoutEvidence,
      }).blocksBilling,
    ).toBe(true);
  });
});

describe('applyAcceptancePolicy — compõe com o domínio existente', () => {
  const base = {
    measurementId: 'm-1',
    serviceOrderId: 'so-1',
    executionStatus: 'COMPLETED',
    policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
    observation: 'Serviço conferido com o responsável do cliente.',
    evidenceId: 'doc-1',
    signatureId: null,
    customerSignerName: 'João da Silva',
    actorIdentityId: 'identity-1',
    occurredAt: '2026-10-24T16:00:00.000Z',
    currentCycle: 1,
    existingDecisionForCycle: null,
  } as const;

  it('registra aceite válido e publica o fato do fato (não o comando)', () => {
    const outcome = applyAcceptancePolicy({ ...base, result: ACCEPTANCE_RESULTS.Accepted });
    expect(outcome.acceptance.result).toBe('ACCEPTED');
    expect(outcome.auditEventType).toBe('SERVICE_ACCEPTED');
    expect(outcome.domainEventType).toBe('CUSTOMER_ACCEPTANCE_RECORDED');
    expect(outcome.pendingIssue).toBeNull();
    expect(outcome.cycleNumber).toBe(1);
  });

  it('rejeição abre pendência e publica o fato de rejeição', () => {
    const outcome = applyAcceptancePolicy({
      ...base,
      result: ACCEPTANCE_RESULTS.Rejected,
      rejectionReason: 'Volume medido não confere com o aferido em campo.',
    });
    expect(outcome.acceptance.result).toBe('REJECTED');
    expect(outcome.pendingIssue).not.toBeNull();
    expect(outcome.pendingIssue!.reason).toContain('Volume medido');
    expect(outcome.domainEventType).toBe('CUSTOMER_REJECTION_RECORDED');
    expect(outcome.rejectionReason).toContain('Volume medido');
  });

  it('RECUSA aceite quando a política diz que não se aplica', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        policy: ACCEPTANCE_POLICIES.NotRequired,
        result: ACCEPTANCE_RESULTS.Accepted,
      }),
    ).toThrow(ServiceAcceptanceError);
  });

  it('RECUSA rejeição sem motivo declarado', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        result: ACCEPTANCE_RESULTS.Rejected,
        rejectionReason: '   ',
      }),
    ).toThrow(ServiceAcceptanceError);
  });

  it('RECUSA aceite sem evidência quando a política exige evidência', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        policy: ACCEPTANCE_POLICIES.RequiredWithEvidence,
        result: ACCEPTANCE_RESULTS.Accepted,
        evidenceId: null,
      }),
    ).toThrow(ServiceAcceptanceError);
  });

  it('RECUSA segunda decisão no MESMO ciclo — reusa a regra existente', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        result: ACCEPTANCE_RESULTS.Accepted,
        existingDecisionForCycle: acceptance(),
      }),
    ).toThrow(ServiceAcceptanceError);
  });

  it('exige execução concluída — reusa a regra existente', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        executionStatus: 'IN_EXECUTION',
        result: ACCEPTANCE_RESULTS.Accepted,
      }),
    ).toThrow(ServiceAcceptanceError);
  });

  it('recusa resultado inválido — reusa a regra existente', () => {
    expect(() =>
      applyAcceptancePolicy({
        ...base,
        // `PENDING` é ESTADO da dimensão, não resultado de decisão.
        result: 'PENDING' as never,
      }),
    ).toThrow(ServiceAcceptanceError);
  });
});
