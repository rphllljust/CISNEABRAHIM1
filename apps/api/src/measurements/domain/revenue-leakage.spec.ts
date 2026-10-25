import { describe, expect, it } from 'vitest';
import {
  LEAKAGE_STAGES,
  LEAKAGE_STAGE_ORDER,
  buildLeakagePosition,
  classifyLeakageStage,
  projectRevenueLeakage,
  type LeakageOrderFacts,
} from './revenue-leakage';

/**
 * REVENUE LEAKAGE — a MESMA cadeia vista por estágio.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Um total de "R$ 1.120.000 em risco" somado no navegador a partir de listas
 * paginadas seria FALSO por construção: a página não contém todos os registros.
 * A projeção é calculada sobre o conjunto inteiro e o drill-down reconstrói
 * exatamente a mesma soma.
 *
 * Os testes afirmam:
 *
 *   - cada ordem cai em UM estágio — o MAIS ADIANTADO alcançado (sem dupla
 *     contagem do mesmo dinheiro);
 *   - ordem já faturada sai da projeção;
 *   - valor desconhecido é CONTADO em separado, nunca somado como zero;
 *   - a idade é determinística com relógio fixo;
 *   - o total é a soma das posições, e o drill-down reconstrói o total.
 */

function order(overrides: Partial<LeakageOrderFacts> = {}): LeakageOrderFacts {
  return {
    serviceOrderId: 'so-1',
    orderNumber: 'OS-1842',
    unitId: 'PVH',
    clientId: 'client-1',
    clientLabel: 'AMAGGI',
    completedAt: '2026-10-14T08:00:00.000Z',
    executionClosedAt: '2026-10-14T10:00:00.000Z',
    measurementId: null,
    measurementStatus: null,
    measurementUpdatedAt: null,
    measurementAmount: null,
    contractualAmount: '120000.0000',
    currencyCode: 'BRL',
    acceptanceRequired: true,
    acceptanceBlocked: true,
    eligibilityResult: null,
    eligibilityBlockingReason: null,
    eligibilityNextActionCode: null,
    billingPrepared: false,
    ...overrides,
  };
}

describe('classifyLeakageStage — um valor, um estágio', () => {
  it('execução fechada sem medição → EXECUTED_NOT_MEASURED', () => {
    expect(classifyLeakageStage(order())).toBe(LEAKAGE_STAGES.ExecutedNotMeasured);
  });

  it('medição em rascunho → MEASURED_NOT_APPROVED', () => {
    expect(
      classifyLeakageStage(
        order({
          measurementId: 'm-1',
          measurementStatus: 'DRAFT',
          measurementUpdatedAt: '2026-10-15T10:00:00.000Z',
        }),
      ),
    ).toBe(LEAKAGE_STAGES.MeasuredNotApproved);
  });

  it('medição em análise → MEASURED_NOT_APPROVED', () => {
    expect(
      classifyLeakageStage(order({ measurementId: 'm-1', measurementStatus: 'UNDER_REVIEW' })),
    ).toBe(LEAKAGE_STAGES.MeasuredNotApproved);
  });

  it('medição REJEITADA → MEASURED_NOT_APPROVED', () => {
    expect(classifyLeakageStage(order({ measurementId: 'm-1', measurementStatus: 'REJECTED' }))).toBe(
      LEAKAGE_STAGES.MeasuredNotApproved,
    );
  });

  it('medição aprovada com aceite pendente → APPROVED_NOT_ACCEPTED', () => {
    expect(
      classifyLeakageStage(
        order({
          measurementId: 'm-1',
          measurementStatus: 'APPROVED',
          acceptanceRequired: true,
          acceptanceBlocked: true,
        }),
      ),
    ).toBe(LEAKAGE_STAGES.ApprovedNotAccepted);
  });

  it('medição aprovada com aceite satisfeito e elegibilidade bloqueada → ACCEPTED_NOT_BILLABLE', () => {
    expect(
      classifyLeakageStage(
        order({
          measurementId: 'm-1',
          measurementStatus: 'APPROVED',
          acceptanceRequired: true,
          acceptanceBlocked: false,
          eligibilityResult: 'BLOCKED',
          eligibilityBlockingReason: 'PURCHASE_ORDER_REQUIRED',
        }),
      ),
    ).toBe(LEAKAGE_STAGES.AcceptedNotBillable);
  });

  it('elegibilidade READY → READY_NOT_PREPARED (o estágio mais adiantado)', () => {
    expect(
      classifyLeakageStage(
        order({
          measurementId: 'm-1',
          measurementStatus: 'APPROVED',
          acceptanceRequired: true,
          acceptanceBlocked: false,
          eligibilityResult: 'READY',
        }),
      ),
    ).toBe(LEAKAGE_STAGES.ReadyNotPrepared);
  });

  it('faturamento JÁ PREPARADO sai da projeção — null', () => {
    expect(
      classifyLeakageStage(
        order({
          measurementId: 'm-1',
          measurementStatus: 'APPROVED',
          acceptanceBlocked: false,
          eligibilityResult: 'READY',
          billingPrepared: true,
        }),
      ),
    ).toBeNull();
  });

  it('concluída SEM fechamento de execução não entra: não há base de valor', () => {
    expect(classifyLeakageStage(order({ executionClosedAt: null }))).toBeNull();
  });

  it('NÃO classifica pelo estágio mais antigo alcançado: aprovada não é "executada"', () => {
    // A ordem foi executada, medida, aprovada e está com aceite pendente. O estágio
    // honesto é APPROVED_NOT_ACCEPTED. Classificá-la como EXECUTED_NOT_MEASURED
    // inflaria o estágio antigo com dinheiro que já avançou.
    const stage = classifyLeakageStage(
      order({
        measurementId: 'm-1',
        measurementStatus: 'APPROVED',
        acceptanceBlocked: true,
      }),
    );
    expect(stage).toBe(LEAKAGE_STAGES.ApprovedNotAccepted);
    expect(stage).not.toBe(LEAKAGE_STAGES.ExecutedNotMeasured);
  });
});

describe('buildLeakagePosition — o número vem com dono, impeditivo e ação', () => {
  it('carrega dono por estágio, impeditivo em código e próxima ação', () => {
    const position = buildLeakagePosition(order(), '2026-10-20T12:00:00.000Z')!;

    expect(position.stage).toBe(LEAKAGE_STAGES.ExecutedNotMeasured);
    expect(position.ownerRole).toBe('OPERACOES');
    expect(position.blockerCode).toBe('MEASUREMENT_MISSING');
    expect(position.nextAction.code).toBe('CREATE_MEASUREMENT');
    expect(position.nextAction.label).toContain('Gerar a medição');
    expect(position.clientLabel).toBe('AMAGGI');
  });

  it('o aceite pendente tem dono COMERCIAL', () => {
    const position = buildLeakagePosition(
      order({ measurementId: 'm-1', measurementStatus: 'APPROVED', acceptanceBlocked: true }),
      '2026-10-20T12:00:00.000Z',
    )!;
    expect(position.ownerRole).toBe('COMERCIAL');
    expect(position.blockerCode).toBe('CUSTOMER_ACCEPTANCE_PENDING');
    expect(position.nextAction.code).toBe('OBTAIN_CUSTOMER_ACCEPTANCE');
  });

  it('a idade é determinística com relógio fixo', () => {
    const position = buildLeakagePosition(order(), '2026-10-20T12:00:00.000Z')!;
    // De 2026-10-14T10:00 a 2026-10-20T12:00 = 6 dias e 2 horas.
    expect(position.ageSeconds).toBe(6 * 24 * 3600 + 2 * 3600);
  });

  it('sem instante de origem a idade é null — nunca zero', () => {
    const position = buildLeakagePosition(
      order({ executionClosedAt: null, completedAt: null }),
      '2026-10-20T12:00:00.000Z',
    );
    expect(position).toBeNull();
  });

  it('valor da MEDIÇÃO prevalece sobre o contratual quando existe', () => {
    const position = buildLeakagePosition(
      order({ measurementAmount: '124880.0000', contractualAmount: '120000.0000' }),
      '2026-10-20T12:00:00.000Z',
    )!;
    expect(position.amount).toBe('124880.0000');
  });

  it('sem valor de medição usa o contratual como referência declarada', () => {
    const position = buildLeakagePosition(order(), '2026-10-20T12:00:00.000Z')!;
    expect(position.amount).toBe('120000.0000');
  });
});

describe('projectRevenueLeakage — o total é a soma do drill-down', () => {
  it('soma valores conhecidos e CONTA os desconhecidos em separado', () => {
    const projection = projectRevenueLeakage({
      at: '2026-10-20T12:00:00.000Z',
      orders: [
        order({ serviceOrderId: 'so-1', orderNumber: 'OS-1' }),
        order({
          serviceOrderId: 'so-2',
          orderNumber: 'OS-2',
          measurementId: 'm-2',
          measurementStatus: 'APPROVED',
          measurementAmount: '180000.0000',
          acceptanceBlocked: true,
        }),
        // Sem valor apurado E sem valor contratual: desconhecido.
        order({
          serviceOrderId: 'so-3',
          orderNumber: 'OS-3',
          contractualAmount: null,
          measurementAmount: null,
        }),
      ],
    });

    expect(projection.total.count).toBe(3);
    expect(projection.total.amount).toBe('300000.0000');
    // O desconhecido NÃO foi somado como zero.
    expect(projection.total.unknownAmountCount).toBe(1);
    expect(projection.total.currencyCode).toBe('BRL');
  });

  it('o total é EXATAMENTE a soma das posições publicadas', () => {
    const projection = projectRevenueLeakage({
      at: '2026-10-20T12:00:00.000Z',
      orders: [
        order({ serviceOrderId: 'so-1', orderNumber: 'OS-1', contractualAmount: '100.0000' }),
        order({ serviceOrderId: 'so-2', orderNumber: 'OS-2', contractualAmount: '250.5000' }),
      ],
    });

    const sumOfPositions = projection.positions
      .map((item) => Number(item.amount ?? 0))
      .reduce((sum, value) => sum + value, 0);

    expect(Number(projection.total.amount)).toBeCloseTo(sumOfPositions, 4);
  });

  it('cada estágio da cadeia aparece, MESMO com contagem zero', () => {
    const projection = projectRevenueLeakage({
      at: '2026-10-20T12:00:00.000Z',
      orders: [order()],
    });
    expect(projection.stages.map((item) => item.stage)).toEqual([...LEAKAGE_STAGE_ORDER]);
    const empty = projection.stages.filter((item) => item.count === 0);
    expect(empty.length).toBe(LEAKAGE_STAGE_ORDER.length - 1);
    for (const stage of empty) {
      expect(stage.amount).toBeNull();
      expect(stage.unknownAmountCount).toBe(0);
    }
  });

  it('ordem já faturada não entra na projeção', () => {
    const projection = projectRevenueLeakage({
      at: '2026-10-20T12:00:00.000Z',
      orders: [order({ billingPrepared: true })],
    });
    expect(projection.total.count).toBe(0);
    expect(projection.positions).toHaveLength(0);
  });

  it('ordena por estágio mais adiantado, depois idade, depois valor', () => {
    const projection = projectRevenueLeakage({
      at: '2026-10-20T12:00:00.000Z',
      orders: [
        // Executado, antigo.
        order({
          serviceOrderId: 'so-old',
          orderNumber: 'OS-OLD',
          completedAt: '2026-10-01T00:00:00.000Z',
          executionClosedAt: '2026-10-01T00:00:00.000Z',
        }),
        // Pronto para faturar, recente: vem primeiro.
        order({
          serviceOrderId: 'so-ready',
          orderNumber: 'OS-READY',
          measurementId: 'm-1',
          measurementStatus: 'APPROVED',
          acceptanceBlocked: false,
          eligibilityResult: 'READY',
        }),
        // Executado, recente.
        order({
          serviceOrderId: 'so-new',
          orderNumber: 'OS-NEW',
          completedAt: '2026-10-19T00:00:00.000Z',
          executionClosedAt: '2026-10-19T00:00:00.000Z',
        }),
      ],
    });

    expect(projection.positions.map((item) => item.serviceOrderId)).toEqual([
      'so-ready',
      'so-old',
      'so-new',
    ]);
  });

  it('é determinística: mesma entrada, mesma saída', () => {
    const input = {
      at: '2026-10-20T12:00:00.000Z',
      orders: [order(), order({ serviceOrderId: 'so-2', orderNumber: 'OS-2' })],
    };
    expect(JSON.stringify(projectRevenueLeakage(input))).toBe(
      JSON.stringify(projectRevenueLeakage(input)),
    );
  });

  it('projeção vazia declara total null, não R$ 0,00', () => {
    const projection = projectRevenueLeakage({ at: '2026-10-20T12:00:00.000Z', orders: [] });
    expect(projection.total.count).toBe(0);
    expect(projection.total.amount).toBeNull();
  });
});
