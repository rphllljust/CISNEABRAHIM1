import { describe, expect, it } from 'vitest';
import {
  MILESTONE_STATES,
  PROCESS_RISKS,
  PROCESS_STAGES,
  PROCESS_STAGE_ORDER,
  projectProcessContext,
  type ProcessContextFacts,
} from './measurement-process-context';

/**
 * PROCESS CONTEXT — projeção sobre FATORES REAIS.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Um motor de processo genérico exigiria atividades e guardas para domínios que
 * ainda não têm fato. O que existe aqui é MENOS e mais útil: onde estou, há
 * quanto tempo, qual era a meta, quem é o dono e o que me impede.
 *
 * Os testes afirmam:
 *
 *   - o estágio atual é o marco MAIS ADIANTADO alcançado;
 *   - marco não aplicável é NOT_APPLICABLE, nunca "pendente";
 *   - sem fonte de prazo o risco é UNKNOWN — nunca LOW;
 *   - bloqueio por terceiro é HIGH, por condição interna é MEDIUM;
 *   - a idade é determinística com relógio fixo.
 */

function facts(overrides: Partial<ProcessContextFacts> = {}): ProcessContextFacts {
  return {
    serviceOrderId: 'so-1',
    orderNumber: 'OS-1842',
    unitId: 'PVH',
    contractReference: 'C-102',
    contractDueAt: '2026-10-22T08:00:00.000Z',
    planningConfirmedAt: '2026-10-12T08:00:00.000Z',
    reservationConfirmedAt: '2026-10-12T10:00:00.000Z',
    dispatchedAt: '2026-10-13T06:00:00.000Z',
    startedAt: '2026-10-13T08:00:00.000Z',
    completedAt: '2026-10-14T18:00:00.000Z',
    executionClosedAt: '2026-10-14T19:00:00.000Z',
    measurementCreatedAt: '2026-10-15T09:00:00.000Z',
    measurementApprovedAt: '2026-10-16T10:00:00.000Z',
    acceptanceRequired: true,
    acceptanceSatisfiedAt: null,
    billingPreparedAt: null,
    receivableOpenedAt: null,
    settledAt: null,
    blockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
    blockingOwnerRole: 'COMERCIAL',
    nextMilestoneLabel: 'Pronto para faturar',
    ...overrides,
  };
}

describe('projectProcessContext — estágio atual', () => {
  it('medição aprovada e aceite pendente → estágio ACEITE', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.currentStage).toBe(PROCESS_STAGES.Acceptance);
    expect(context.health.currentStageLabel).toBe('Aceite do cliente');
  });

  it('nunca reporta estágio ANTERIOR por já ter executado', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.currentStage).not.toBe(PROCESS_STAGES.Execution);
    expect(context.health.currentStage).not.toBe(PROCESS_STAGES.Measurement);
  });

  it('faturamento preparado: o processo passa a ESPERAR o recebível', () => {
    const context = projectProcessContext(
      facts({ billingPreparedAt: '2026-10-21T10:00:00.000Z', acceptanceSatisfiedAt: '2026-10-20T10:00:00.000Z', blockingReason: null }),
      '2026-10-22T12:00:00.000Z',
    );
    // O estágio é onde o processo ESPERA, não o último marco alcançado. Com o
    // faturamento preparado, o trabalho parado é abrir o recebível.
    expect(context.health.currentStage).toBe(PROCESS_STAGES.Receivable);
    expect(context.completedMilestones).toContain(PROCESS_STAGES.Billing);
  });

  it('recebível aberto e liquidação concluída chegam ao fim da cadeia', () => {
    const context = projectProcessContext(
      facts({
        acceptanceSatisfiedAt: '2026-10-20T10:00:00.000Z',
        billingPreparedAt: '2026-10-21T10:00:00.000Z',
        receivableOpenedAt: '2026-10-22T10:00:00.000Z',
        settledAt: '2026-10-30T10:00:00.000Z',
        blockingReason: null,
        nextMilestoneLabel: null,
      }),
      '2026-10-31T12:00:00.000Z',
    );
    expect(context.health.currentStage).toBe(PROCESS_STAGES.Settlement);
    expect(context.health.nextMilestone).toBeNull();
    expect(context.health.risk).toBe(PROCESS_RISKS.Low);
  });
});

describe('projectProcessContext — marcos', () => {
  it('todos os marcos da cadeia são publicados, na ordem', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.milestones.map((item) => item.stage)).toEqual([...PROCESS_STAGE_ORDER]);
  });

  it('aceite NÃO exigido é NOT_APPLICABLE, nunca FUTURE', () => {
    const context = projectProcessContext(
      facts({ acceptanceRequired: false, blockingReason: null }),
      '2026-10-20T12:00:00.000Z',
    );
    const acceptance = context.milestones.find(
      (item) => item.stage === PROCESS_STAGES.Acceptance,
    )!;
    // Um marco que NUNCA vai acontecer não pode ser mostrado como "pendente".
    expect(acceptance.state).toBe(MILESTONE_STATES.NotApplicable);
    expect(context.pendingMilestones).not.toContain(PROCESS_STAGES.Acceptance);
  });

  it('o estágio ATUAL é CURRENT mesmo estando alcançado: a duração conta daqui', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    const current = context.milestones.find(
      (item) => item.stage === context.health.currentStage,
    )!;
    expect(current.state).toBe(MILESTONE_STATES.Current);
  });

  it('marcos à frente do atual são FUTURE', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    const billing = context.milestones.find((item) => item.stage === PROCESS_STAGES.Billing)!;
    expect(billing.state).toBe(MILESTONE_STATES.Future);
    expect(billing.reachedAt).toBeNull();
  });

  it('completedMilestones e pendingMilestones são complementares', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    const total =
      context.completedMilestones.length + context.pendingMilestones.length;
    const notApplicable = context.milestones.filter(
      (item) => item.state === MILESTONE_STATES.NotApplicable,
    ).length;
    expect(total + notApplicable).toBe(context.milestones.length);
  });
});

describe('projectProcessContext — saúde do processo', () => {
  it('a idade do estágio é determinística com relógio fixo', () => {
    // Estágio ACEITE começou quando a medição foi APROVADA: 2026-10-16T10:00.
    // Até 2026-10-20T12:00 = 4 dias e 2 horas.
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.elapsedSeconds).toBe(4 * 24 * 3600 + 2 * 3600);
  });

  it('a META vem do prazo do CONTRATO, não da janela operacional', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.targetSeconds).not.toBeNull();
  });

  it('sem prazo contratual a meta é null — o sistema não inventa SLA', () => {
    const context = projectProcessContext(
      facts({ contractDueAt: null }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(context.health.targetSeconds).toBeNull();
    expect(context.health.forecastSecondsRemaining).toBeNull();
  });

  it('sem meta o risco é UNKNOWN — não saber não é estar bem', () => {
    const context = projectProcessContext(
      facts({ contractDueAt: null, blockingReason: null }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(context.health.risk).toBe(PROCESS_RISKS.Unknown);
    expect(context.health.riskReason).toContain('não é julgável');
  });

  it('bloqueio por TERCEIRO (aceite) é HIGH', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.risk).toBe(PROCESS_RISKS.High);
    expect(context.health.riskReason).toContain('terceiro');
  });

  it('bloqueio INTERNO é MEDIUM: há ação disponível', () => {
    const context = projectProcessContext(
      facts({ blockingReason: 'PURCHASE_ORDER_REQUIRED', blockingOwnerRole: 'COMERCIAL' }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(context.health.risk).toBe(PROCESS_RISKS.Medium);
    expect(context.health.riskReason).toContain('interna');
  });

  it('sem bloqueio e acima da meta é HIGH', () => {
    const context = projectProcessContext(
      facts({
        blockingReason: null,
        contractDueAt: '2026-10-10T00:00:00.000Z',
      }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(context.health.risk).toBe(PROCESS_RISKS.High);
    expect(context.health.riskReason).toContain('meta contratual');
  });

  it('o dono do bloqueio é publicado pelo backend, em papel', () => {
    const context = projectProcessContext(facts(), '2026-10-20T12:00:00.000Z');
    expect(context.health.ownerRole).toBe('COMERCIAL');
    expect(context.health.blockingReason).toBe('CUSTOMER_ACCEPTANCE_PENDING');
    expect(context.health.nextMilestone).toBe('Pronto para faturar');
  });

  it('sem bloqueio, o dono vem do estágio atual', () => {
    const context = projectProcessContext(
      facts({
        blockingReason: null,
        blockingOwnerRole: null,
        acceptanceRequired: false,
        measurementApprovedAt: null,
        measurementCreatedAt: null,
      }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(context.health.ownerRole).toBe('OPERACOES');
    expect(context.health.blockingReason).toBeNull();
  });

  it('é determinística: mesma entrada, mesma saída', () => {
    expect(JSON.stringify(projectProcessContext(facts(), '2026-10-20T12:00:00.000Z'))).toBe(
      JSON.stringify(projectProcessContext(facts(), '2026-10-20T12:00:00.000Z')),
    );
  });
});
