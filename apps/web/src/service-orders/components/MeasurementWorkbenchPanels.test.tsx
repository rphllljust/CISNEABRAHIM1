import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MeasurementKpiStrip } from '../components/MeasurementKpiStrip';
import { MeasurementQueue } from '../components/MeasurementQueue';
import { ActiveMeasurementPanel, MeasurementVariancePanel } from '../components/MeasurementWorkbenchPanels';
import {
  AcceptancePanel,
  BillingEligibilityPanel,
  NextActionPanel,
} from '../components/MeasurementDecisionContext';
import { MeasurementConcurrencyBanner } from '../components/MeasurementCommandDialogs';
import type {
  AvailableCommand,
  BillingEligibilityDecision,
  DetectedVariance,
  MeasurementWorkbenchReadModel,
  WorkQueueItem,
} from '../types/measurement-workbench.types';

/**
 * TESTES DE COMPONENTE — A TELA APRESENTA O QUE O BACKEND DECIDIU.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROVAM — E O QUE ELES **NÃO** PROVAM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * PROVAM:
 *
 *   - comando desabilitado RENDERIZA o motivo que veio do backend;
 *   - a próxima ação exibida é a do backend;
 *   - a variação é apresentada como veio (severidade, tolerância, impacto);
 *   - a elegibilidade mostra as dimensões e o motivo bloqueante;
 *   - o banner de concorrência oferece RECARREGAR e não reenvia sozinho;
 *   - a fila seleciona sem decidir nada.
 *
 * NÃO PROVAM — de propósito:
 *
 *   ✗ qual estado permite aprovar         (regra do backend)
 *   ✗ quando a variação está na tolerância (regra do backend)
 *   ✗ quando o aceite é exigível            (regra do backend)
 *
 * Testar essas regras no React seria TESTAR UMA SEGUNDA IMPLEMENTAÇÃO — e é
 * exatamente o que esta capability eliminou.
 */

function workbench(
  overrides: Partial<MeasurementWorkbenchReadModel> = {},
): MeasurementWorkbenchReadModel {
  return {
    identity: {
      measurementId: 'm-1',
      number: 'OS-1842-M3',
      serviceOrderId: 'so-1',
      orderNumber: 'OS-1842',
      rowVersion: 3,
    },
    businessContext: {
      company: 'CISNE',
      unit: 'CISNE-RO-PVH',
      customer: 'AMAGGI',
      customerId: 'client-1',
      contract: 'C-102',
      purchaseOrder: 'PO-8821',
      responsible: null,
    },
    statuses: {
      execution: 'CLOSED',
      measurement: 'UNDER_REVIEW',
      acceptance: 'PENDING',
      billingEligibility: 'BLOCKED',
      billing: 'NOT_PREPARED',
      accounting: 'NOT_APPLICABLE',
    },
    processContext: {
      milestones: [
        { stage: 'EXECUTION', label: 'Execução', state: 'COMPLETED', reachedAt: '2026-10-14T18:00:00.000Z' },
        { stage: 'MEASUREMENT', label: 'Medição', state: 'CURRENT', reachedAt: null },
        { stage: 'BILLING', label: 'Faturamento', state: 'FUTURE', reachedAt: null },
      ],
      completedMilestones: ['EXECUTION'],
      pendingMilestones: ['MEASUREMENT', 'BILLING'],
      health: {
        currentStage: 'MEASUREMENT',
        currentStageLabel: 'Medição',
        elapsedSeconds: 219_600,
        targetSeconds: 691_200,
        forecastSecondsRemaining: 471_600,
        risk: 'HIGH',
        riskReason: 'Aguardando decisão de terceiro.',
        ownerRole: 'COMERCIAL',
        blockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
        nextMilestone: 'Pronto para faturar',
      },
      nextMilestone: 'Preparar faturamento',
    },
    measurementBasis: {
      basisId: 'basis-1',
      executionClosureId: 'closure-1',
      preparedAt: '2026-10-14T19:00:00.000Z',
      lineCount: 2,
      lines: [
        { lineKey: 'M3', unitCode: 'M3', actualQuantity: '12.5', plannedQuantity: '10', recordCount: 1, source: 'EXECUTION_ACTUALS' },
      ],
    },
    quantities: {
      lines: [
        { dimensionKey: 'M3', label: 'M3', unitOfMeasure: 'M3', planned: '10', actual: '12.5', measured: '12.5' },
        { dimensionKey: 'HOUR', label: 'HOUR', unitOfMeasure: 'HOUR', planned: '4', actual: '4', measured: '4' },
      ],
      totals: { planned: 14, actual: 16.5, measured: 16.5 },
    },
    economics: {
      grossValue: '6730.0000',
      currency: 'BRL',
      financialVariance: '1250.0000',
      revenueExposure: '6730.0000',
    },
    commercialContext: {
      pricing: { source: 'PROPOSAL', lineCount: 2, currencyCode: 'BRL' },
      paymentTerms: '30 dias',
      tolerance: { percentage: 5, source: 'DEFAULT' },
      purchaseOrderRequirement: 'BEFORE_BILLING',
      billingPolicy: 'MEASUREMENT_APPROVED',
    },
    variances: [],
    varianceSummary: {
      highestSeverity: 'HIGH',
      decisionRequiredCount: 1,
      approvalClearable: false,
      summary: '1 divergência exige decisão.',
    },
    adjustments: [],
    items: [],
    evidence: [],
    acceptance: {
      policy: 'REQUIRED_BEFORE_BILLING',
      policySource: 'CONTRACT',
      policyReason: 'O contrato exige aceite formal de entrega antes do faturamento.',
      required: true,
      state: 'PENDING',
      blocksBilling: true,
      blockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
      latest: null,
      history: [],
      nextActionCode: 'OBTAIN_CUSTOMER_ACCEPTANCE',
      nextActionLabel: 'Registrar aceite do cliente',
    },
    billingEligibility: eligibility(),
    situations: [],
    relationships: [],
    documentFlow: [],
    timeline: [],
    nextAction: {
      code: 'AUTHORIZE_ADJUSTMENT',
      label: 'Autorizar ajuste',
      explanation: 'Existe variação acima da tolerância aguardando decisão.',
    },
    availableCommands: commands(),
    decisionExplanation: {
      measurement: 'Resumo',
      approval: 'Aprovação bloqueada',
      acceptance: 'Aceite exigido',
      billing: 'Faturamento bloqueado',
      onBilling: 'Consome a medição',
    },
    freshness: { readAt: '2026-10-24T15:00:00.000Z', authority: 'SERVER' },
    ...overrides,
  };
}

function commands(overrides: Partial<AvailableCommand>[] = []): AvailableCommand[] {
  const base: AvailableCommand[] = [
    {
      code: 'AUTHORIZE_ADJUSTMENT',
      label: 'Autorizar ajuste',
      enabled: true,
      blockingReasons: [],
      reasonLabels: [],
      nextAction: null,
      requiredPermission: 'measurements:measurement:update',
    },
    {
      code: 'APPROVE',
      label: 'Aprovar medição',
      enabled: false,
      blockingReasons: ['VARIANCE_REQUIRES_AUTHORIZATION'],
      reasonLabels: ['Existe variação acima da tolerância sem decisão registrada.'],
      nextAction: 'AUTHORIZE_ADJUSTMENT',
      requiredPermission: 'measurements:measurement:approve',
    },
    {
      code: 'RECORD_ACCEPTANCE',
      label: 'Registrar aceite do cliente',
      enabled: false,
      blockingReasons: ['MEASUREMENT_NOT_APPROVED'],
      reasonLabels: ['A medição precisa estar aprovada para faturar.'],
      nextAction: 'APPROVE',
      requiredPermission: 'measurements:measurement:accept',
    },
  ];
  return base.map((command, index) => ({ ...command, ...(overrides[index] ?? {}) }));
}

function eligibility(
  overrides: Partial<BillingEligibilityDecision> = {},
): BillingEligibilityDecision {
  return {
    result: 'BLOCKED',
    dimensions: [
      {
        dimension: 'EXECUTION_CLOSED',
        label: 'Execução fechada',
        status: 'SATISFIED',
        statusLabel: 'Atendido',
        reasonCode: null,
        detail: 'A execução foi fechada.',
        nextActionCode: null,
        nextActionLabel: null,
        blocking: false,
      },
      {
        dimension: 'CUSTOMER_ACCEPTANCE',
        label: 'Aceite do cliente',
        status: 'PENDING',
        statusLabel: 'Pendente',
        reasonCode: 'CUSTOMER_ACCEPTANCE_PENDING',
        detail: 'A política comercial exige aceite do cliente.',
        nextActionCode: 'OBTAIN_CUSTOMER_ACCEPTANCE',
        nextActionLabel: 'Registrar aceite do cliente',
        blocking: true,
      },
    ],
    blockingReasons: ['CUSTOMER_ACCEPTANCE_PENDING'],
    nextAction: { code: 'OBTAIN_CUSTOMER_ACCEPTANCE', label: 'Registrar aceite do cliente' },
    totalAmount: '6730.0000',
    currencyCode: 'BRL',
    summary: '1 condição impede o faturamento.',
    explanation: 'O faturamento está bloqueado por condição conhecida.',
    ...overrides,
  };
}

function variance(overrides: Partial<DetectedVariance> = {}): DetectedVariance {
  return {
    dimension: 'QUANTITY',
    dimensionKey: 'M3',
    measurementItemId: 'item-1',
    plannedValue: '10',
    actualValue: '12.5',
    measuredValue: '12.5',
    unitOfMeasure: 'M3',
    absoluteDelta: '2.5',
    percentageDelta: 25,
    tolerancePercentage: 5,
    toleranceSource: 'DEFAULT',
    severity: 'HIGH',
    financialImpact: '1250.0000',
    currencyCode: 'BRL',
    requiresDecision: true,
    decisionKind: 'AUTHORIZE_ADJUSTMENT',
    blockingReason: 'VARIANCE_REQUIRES_AUTHORIZATION',
    recommendedResolution: 'AUTHORIZE_ADJUSTMENT',
    explanation:
      'M3: planejado 10, medido 12.5; 25% acima do planejado (tolerância 5%); impacto BRL 1250; severidade HIGH.',
    ...overrides,
  };
}

describe('MeasurementKpiStrip', () => {
  it('apresenta os fatos publicados pelo backend, sem recalcular nada', () => {
    render(<MeasurementKpiStrip workbench={workbench()} />);

    // O VALOR BRUTO é o que veio; a tela não soma itens.
    expect(screen.getByText('BRL 6.730,00')).toBeInTheDocument();
    expect(screen.getByText('Valor bruto')).toBeInTheDocument();
    // A SEVERIDADE vem decidida e é exibida como rótulo de negócio.
    expect(screen.getByText('Alta')).toBeInTheDocument();
    // Os cinco eixos independentes aparecem separados.
    expect(screen.getByText('Em análise')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    // A idade do estágio é formatada a partir dos SEGUNDOS publicados.
    expect(screen.getByText('2d 13h')).toBeInTheDocument();
  });

  it('mostra "Não apurado" quando o backend não conhece o valor — nunca R$ 0,00', () => {
    render(
      <MeasurementKpiStrip
        workbench={workbench({
          economics: {
            grossValue: null,
            currency: null,
            financialVariance: null,
            revenueExposure: null,
          },
        })}
      />,
    );
    expect(screen.getByText('Não apurado')).toBeInTheDocument();
    expect(screen.queryByText('R$ 0,00')).not.toBeInTheDocument();
  });
});

describe('MeasurementVariancePanel', () => {
  it('apresenta as três quantidades, delta, tolerância com fonte e impacto', () => {
    render(<MeasurementVariancePanel variances={[variance()]} />);

    expect(screen.getByText('M3')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    // Realizado e medido são campos distintos na mesma linha.
    expect(screen.getAllByText('12,5').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('+25,00%')).toBeInTheDocument();
    // A TOLERÂNCIA carrega a FONTE — um número sem origem é inventado.
    expect(screen.getByText('5% (DEFAULT)')).toBeInTheDocument();
    expect(screen.getByText(/BRL 1\.250,00/)).toBeInTheDocument();
    // A EXPLICAÇÃO é a do backend, não uma redação local.
    expect(screen.getByText(/planejado 10, medido 12\.5/)).toBeInTheDocument();
    expect(screen.getByText(/Exige decisão/)).toBeInTheDocument();
  });

  it('sem variação, declara a ausência em vez de mostrar uma linha vazia', () => {
    render(<MeasurementVariancePanel variances={[]} />);
    expect(
      screen.getByText('Nenhuma divergência entre planejado, realizado e medido.'),
    ).toBeInTheDocument();
  });
});

describe('ActiveMeasurementPanel', () => {
  it('separa PLANEJADO, REALIZADO e MEDIDO em colunas distintas', () => {
    render(<ActiveMeasurementPanel workbench={workbench()} />);

    const table = screen.getByRole('table');
    const headers = within(table).getAllByRole('columnheader').map((cell) => cell.textContent);
    expect(headers).toContain('Planejado');
    expect(headers).toContain('Realizado');
    expect(headers).toContain('Medido');

    // A linha de M3 mantém as três grandezas separadas.
    const row = within(table).getByRole('rowheader', { name: 'M3' }).closest('tr')!;
    const cells = within(row).getAllByRole('cell').map((cell) => cell.textContent);
    // Planejado ≠ Realizado: o atalho `actual = measured` não é assumido.
    expect(cells[0]).toBe('10');
    expect(cells[1]).toBe('12,5');
  });
});

describe('NextActionPanel — a decisão é do backend', () => {
  it('comando desabilitado RENDERIZA o motivo publicado', () => {
    render(
      <NextActionPanel
        nextAction={workbench().nextAction}
        commands={commands()}
        submitting={false}
        onExecute={() => {}}
      />,
    );

    const approve = screen.getByRole('button', { name: /Aprovar medição/ });
    expect(approve).toBeDisabled();
    // O MOTIVO é visível, não apenas tooltip. O bullet é parte do texto do item.
    expect(
      screen.getByText(/Existe variação acima da tolerância sem decisão registrada\./),
    ).toBeInTheDocument();
  });

  it('comando habilitado executa a ação do backend', async () => {
    const onExecute = vi.fn();
    render(
      <NextActionPanel
        nextAction={workbench().nextAction}
        commands={commands()}
        submitting={false}
        onExecute={onExecute}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Autorizar ajuste/ }));
    expect(onExecute).toHaveBeenCalledWith('AUTHORIZE_ADJUSTMENT');
  });

  it('a próxima ação exibida é exatamente a do backend', () => {
    render(
      <NextActionPanel
        nextAction={{ code: 'OBTAIN_CUSTOMER_ACCEPTANCE', label: 'Obter aceite do cliente', explanation: 'A política exige.' }}
        commands={commands()}
        submitting={false}
        onExecute={() => {}}
      />,
    );
    expect(screen.getByText('Obter aceite do cliente')).toBeInTheDocument();
    expect(screen.getByText('A política exige.')).toBeInTheDocument();
  });
});

describe('AcceptancePanel — reflete a semântica do backend', () => {
  it('mostra o ciclo publicado e NÃO o incrementa', () => {
    render(
      <AcceptancePanel
        workbench={workbench({
          acceptance: {
            ...workbench().acceptance,
            // O ESTADO derivado acompanha a última decisão — é o backend que o
            // deriva, e o teste o recebe pronto.
            state: 'REJECTED',
            latest: {
              id: 'acc-1',
              cycleNumber: 2,
              result: 'REJECTED',
              observation: 'Conferido.',
              rejectionReason: 'Volume divergente.',
              evidenceId: null,
              customerSignerName: null,
              acceptedByIdentityId: 'identity-1',
              occurredAt: '2026-10-20T10:00:00.000Z',
            },
          },
        })}
        commands={commands()}
        onRecordAcceptance={() => {}}
        onRecordRejection={() => {}}
      />,
    );

    // O ciclo é o DO BACKEND (2), não `1 + 1` calculado aqui.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Recusado')).toBeInTheDocument();
    expect(screen.getByText(/Motivo da recusa: Volume divergente\./)).toBeInTheDocument();
  });

  it('botões desabilitados quando o backend não habilitou o comando', () => {
    render(
      <AcceptancePanel
        workbench={workbench()}
        commands={commands()}
        onRecordAcceptance={() => {}}
        onRecordRejection={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Registrar aceite' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Registrar recusa' })).toBeDisabled();
  });

  it('declara quando a política não exige aceite', () => {
    render(
      <AcceptancePanel
        workbench={workbench({
          acceptance: {
            ...workbench().acceptance,
            required: false,
            state: 'NOT_REQUIRED',
            blocksBilling: false,
            blockingReason: null,
          },
        })}
        commands={commands()}
        onRecordAcceptance={() => {}}
        onRecordRejection={() => {}}
      />,
    );
    expect(
      screen.getByText('A política comercial não exige aceite para esta entrega.'),
    ).toBeInTheDocument();
  });
});

describe('BillingEligibilityPanel — modelo de decisão', () => {
  it('mostra cada dimensão com seu status e o motivo bloqueante', () => {
    render(<BillingEligibilityPanel decision={eligibility()} />);

    expect(screen.getByText('Execução fechada')).toBeInTheDocument();
    expect(screen.getByText('Aceite do cliente')).toBeInTheDocument();
    expect(screen.getByText('Bloqueado')).toBeInTheDocument();
    expect(screen.getByText('CUSTOMER_ACCEPTANCE_PENDING')).toBeInTheDocument();
  });

  it('quando READY, expõe o valor elegível — o READY_TO_BILL', () => {
    render(
      <BillingEligibilityPanel
        decision={eligibility({ result: 'READY', blockingReasons: [], nextAction: null })}
      />,
    );

    expect(screen.getByText('Liberado')).toBeInTheDocument();
    expect(screen.getByText('Valor elegível')).toBeInTheDocument();
    expect(screen.getByText('BRL 6.730,00')).toBeInTheDocument();
  });
});

describe('MeasurementQueue', () => {
  const items: WorkQueueItem[] = [
    {
      measurementId: 'm-1',
      serviceOrderId: 'so-1',
      orderNumber: 'OS-1842',
      customerLabel: 'AMAGGI',
      statuses: { measurement: 'APPROVED', acceptance: 'PENDING', billingEligibility: 'PENDING' },
      stage: 'APPROVED_NOT_ACCEPTED',
      stageLabel: 'Aprovado, aguardando aceite',
      reasonCode: 'CUSTOMER_ACCEPTANCE_PENDING',
      reasonLabel: 'Registrar aceite do cliente',
      severity: 'P2',
      amount: '124880.0000',
      currencyCode: 'BRL',
      ageSeconds: 8_040,
      ownerRole: 'COMERCIAL',
      nextAction: { code: 'OBTAIN_CUSTOMER_ACCEPTANCE', label: 'Registrar aceite do cliente' },
    },
  ];

  it('mostra dono, idade, valor, motivo e próxima ação', () => {
    render(
      <MeasurementQueue items={items} selectedServiceOrderId={null} onSelect={() => {}} />,
    );

    expect(screen.getByText('AMAGGI')).toBeInTheDocument();
    expect(screen.getByText(/OS-1842/)).toBeInTheDocument();
    expect(screen.getByText('Aprovado, aguardando aceite')).toBeInTheDocument();
    expect(screen.getByText('Dono: COMERCIAL')).toBeInTheDocument();
    expect(screen.getByText(/2h 14m/)).toBeInTheDocument();
    expect(screen.getByText('BRL 124.880,00')).toBeInTheDocument();
  });

  it('seleciona sem decidir nada', async () => {
    const onSelect = vi.fn();
    render(
      <MeasurementQueue items={items} selectedServiceOrderId={null} onSelect={onSelect} />,
    );
    await userEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(items[0]);
  });

  it('fila vazia declara ausência de trabalho', () => {
    render(<MeasurementQueue items={[]} selectedServiceOrderId={null} onSelect={() => {}} />);
    expect(screen.getByText('Nenhum trabalho pendente')).toBeInTheDocument();
  });
});

describe('MeasurementConcurrencyBanner', () => {
  it('mostra as versões e oferece RECARREGAR — nunca reenvia sozinho', async () => {
    const onReload = vi.fn();
    render(
      <MeasurementConcurrencyBanner
        open
        expectedVersion={12}
        submitting={false}
        onReload={onReload}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('A medição foi alterada')).toBeInTheDocument();
    expect(within(alert).getByText(/sua versão: 12/)).toBeInTheDocument();
    // A única saída é RECARREGAR: não existe "tentar de novo" silencioso.
    await userEvent.click(within(alert).getByRole('button', { name: 'Recarregar estado atual' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('não renderiza nada quando não há conflito', () => {
    render(
      <MeasurementConcurrencyBanner open={false} expectedVersion={12} submitting={false} onReload={() => {}} />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
