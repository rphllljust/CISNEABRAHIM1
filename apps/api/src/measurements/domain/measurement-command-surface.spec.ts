import { describe, expect, it } from 'vitest';
import {
  MEASUREMENT_SURFACE_COMMANDS,
  buildMeasurementCommandSurface,
  labelForMeasurementReason,
  type MeasurementCommandFacts,
} from './measurement-command-surface';
import {
  VARIANCE_DECISIONS,
  VARIANCE_DIMENSIONS,
  VARIANCE_SEVERITIES,
  type DetectedVariance,
} from './measurement-variance';
import type { EligibilityDimensionResult } from './billing-eligibility';

/**
 * COMMAND SURFACE — o BACKEND decide, a tela representa.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O CÓDIGO QUE ESTES TESTES TORNAM IMPOSSÍVEL
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A tela fazia exatamente isto:
 *
 *     const canApprove = capabilities.canApprove && status === 'UNDER_REVIEW';
 *
 * Uma regra empresarial implementada em React. Quando a variação passou a
 * bloquear a aprovação, a tela continuou habilitando o botão — e o operador
 * recebia 409 de um comando que a própria tela disse que era possível.
 *
 * Estes testes afirmam o contrário: `enabled` é decidido AQUI, cada bloqueio
 * carrega código e rótulo, e existe SEMPRE uma próxima ação quando algo impede.
 */

function variance(overrides: Partial<DetectedVariance> = {}): DetectedVariance {
  return {
    dimension: VARIANCE_DIMENSIONS.EquipmentHours,
    dimensionKey: 'H',
    measurementItemId: 'item-1',
    plannedValue: '40',
    actualValue: '46',
    measuredValue: '46',
    unitOfMeasure: 'H',
    absoluteDelta: '6',
    percentageDelta: 15,
    tolerancePercentage: 5,
    toleranceSource: 'DEFAULT',
    severity: VARIANCE_SEVERITIES.High,
    financialImpact: '7200.0000',
    currencyCode: 'BRL',
    requiresDecision: true,
    decisionKind: VARIANCE_DECISIONS.AuthorizeAdjustment,
    blockingReason: 'VARIANCE_REQUIRES_AUTHORIZATION',
    recommendedResolution: 'AUTHORIZE_ADJUSTMENT',
    explanation:
      'Horas de equipamento: planejado 40, medido 46; 15% acima do planejado (tolerância 5%); impacto BRL 7200; severidade HIGH.',
    ...overrides,
  };
}

function eligibilityBlocker(): EligibilityDimensionResult {
  return {
    dimension: 'CUSTOMER_ACCEPTANCE',
    label: 'Aceite do cliente',
    status: 'PENDING',
    statusLabel: 'Pendente',
    reasonCode: 'CUSTOMER_ACCEPTANCE_PENDING',
    detail: 'A política comercial exige aceite do cliente e nenhuma decisão foi registrada.',
    nextActionCode: 'OBTAIN_CUSTOMER_ACCEPTANCE',
    nextActionLabel: 'Registrar aceite do cliente',
    blocking: true,
  };
}

function facts(overrides: Partial<MeasurementCommandFacts> = {}): MeasurementCommandFacts {
  return {
    serviceOrderId: 'so-1',
    measurementId: 'm-1',
    measurementStatus: 'UNDER_REVIEW',
    basisAvailable: true,
    measurementLegacyOrigin: false,
    itemCount: 3,
    itemCountWithoutAmount: 0,
    variancesRequiringDecision: [],
    acceptanceRequired: true,
    acceptanceBlocked: true,
    acceptanceBlockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
    acceptanceAlreadyRecordedForCycle: false,
    eligibilityResult: null,
    eligibilityBlockingDimensions: [],
    hasPermission: () => true,
    ...overrides,
  };
}

function command(
  surface: ReturnType<typeof buildMeasurementCommandSurface>,
  code: string,
) {
  return surface.availableCommands.find((item) => item.code === code)!;
}

describe('buildMeasurementCommandSurface — aprovação governada pela variação', () => {
  it('sem variação pendente, aprovação fica HABILITADA em UNDER_REVIEW', () => {
    const surface = buildMeasurementCommandSurface(facts());
    expect(command(surface, MEASUREMENT_SURFACE_COMMANDS.Approve).enabled).toBe(true);
  });

  it('com variação exigindo decisão, aprovação fica BLOQUEADA com motivo e próxima ação', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ variancesRequiringDecision: [variance()] }),
    );
    const approve = command(surface, MEASUREMENT_SURFACE_COMMANDS.Approve);

    expect(approve.enabled).toBe(false);
    expect(approve.blockingReasons).toContain('VARIANCE_REQUIRES_AUTHORIZATION');
    // A próxima ação é o comando que DESTRAVA, não um texto solto.
    expect(approve.nextAction).toBe(MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment);
    // O motivo é o MESMO texto que o domínio produziu — a tela não redige.
    expect(approve.reasonLabels[0]).toContain('Horas de equipamento');
  });

  it('ajuste já autorizado mas não aplicado muda a próxima ação', () => {
    const surface = buildMeasurementCommandSurface(
      facts({
        variancesRequiringDecision: [
          variance({ blockingReason: 'VARIANCE_ADJUSTMENT_NOT_APPLIED' }),
        ],
      }),
    );
    const approve = command(surface, MEASUREMENT_SURFACE_COMMANDS.Approve);
    expect(approve.enabled).toBe(false);
    expect(approve.nextAction).toBe(
      MEASUREMENT_SURFACE_COMMANDS.UpdateItemMeasuredQuantity,
    );
  });

  it('a próxima ação GERAL é o ajuste quando ele está disponível', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'DRAFT', variancesRequiringDecision: [variance()] }),
    );
    expect(surface.nextAction?.code).toBe(MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment);
    expect(surface.nextAction?.explanation).toContain('Horas de equipamento');
  });

  it('SUBMIT também é bloqueado por variação: submeter para falhar seria trabalho perdido', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'DRAFT', variancesRequiringDecision: [variance()] }),
    );
    const submit = command(surface, MEASUREMENT_SURFACE_COMMANDS.Submit);
    expect(submit.enabled).toBe(false);
    expect(submit.nextAction).toBe(MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment);
  });
});

describe('buildMeasurementCommandSurface — acceptance governance', () => {
  it('aceite disponível só com medição APROVADA', () => {
    const surface = buildMeasurementCommandSurface(facts({ measurementStatus: 'APPROVED' }));
    expect(command(surface, MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance).enabled).toBe(true);
  });

  it('aceite bloqueado com medição não aprovada, apontando a aprovação', () => {
    const surface = buildMeasurementCommandSurface(facts({ measurementStatus: 'UNDER_REVIEW' }));
    const accept = command(surface, MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance);
    expect(accept.enabled).toBe(false);
    expect(accept.nextAction).toBe(MEASUREMENT_SURFACE_COMMANDS.Approve);
  });

  it('aceite não aplicável quando a política não exige', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ acceptanceRequired: false, acceptanceBlocked: false, acceptanceBlockingReason: null }),
    );
    const accept = command(surface, MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance);
    expect(accept.enabled).toBe(false);
    expect(accept.blockingReasons).toContain('ACCEPTANCE_POLICY_NOT_APPLICABLE');
  });

  it('segunda decisão no mesmo ciclo é barrada', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'APPROVED', acceptanceAlreadyRecordedForCycle: true }),
    );
    const accept = command(surface, MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance);
    expect(accept.enabled).toBe(false);
    expect(accept.blockingReasons).toContain('ALREADY_RECORDED');
  });
});

describe('buildMeasurementCommandSurface — facturamento liberado só por READY', () => {
  it('PREPARE_BILLING habilitado SOMENTE quando a elegibilidade é READY', () => {
    const ready = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'APPROVED', eligibilityResult: 'READY' }),
    );
    expect(command(ready, MEASUREMENT_SURFACE_COMMANDS.PrepareBilling).enabled).toBe(true);
    // Preparar faturamento é o próximo trabalho quando está liberado.
    expect(ready.nextAction?.code).toBe(MEASUREMENT_SURFACE_COMMANDS.PrepareBilling);
  });

  it('PREPARE_BILLING bloqueado com os MOTIVOS das dimensões avaliadas', () => {
    const surface = buildMeasurementCommandSurface(
      facts({
        measurementStatus: 'APPROVED',
        eligibilityResult: 'PENDING',
        eligibilityBlockingDimensions: [eligibilityBlocker()],
      }),
    );
    const prepare = command(surface, MEASUREMENT_SURFACE_COMMANDS.PrepareBilling);
    expect(prepare.enabled).toBe(false);
    expect(prepare.blockingReasons).toContain('CUSTOMER_ACCEPTANCE_PENDING');
    // O detalhe vem da dimensão, não de uma tradução local.
    expect(prepare.reasonLabels[0]).toContain('aceite do cliente');
  });

  it('sem elegibilidade avaliada, PREPARE_BILLING fica bloqueado', () => {
    const surface = buildMeasurementCommandSurface(facts({ measurementStatus: 'APPROVED' }));
    expect(command(surface, MEASUREMENT_SURFACE_COMMANDS.PrepareBilling).enabled).toBe(false);
  });
});

describe('buildMeasurementCommandSurface — base de medição', () => {
  it('criação de medição exige base publicada', () => {
    const withoutBasis = buildMeasurementCommandSurface(
      facts({ measurementId: null, measurementStatus: null, basisAvailable: false }),
    );
    const create = command(withoutBasis, MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement);
    expect(create.enabled).toBe(false);
    expect(create.blockingReasons).toContain('MEASUREMENT_BASIS_NOT_PUBLISHED');

    const withBasis = buildMeasurementCommandSurface(
      facts({ measurementId: null, measurementStatus: null, basisAvailable: true }),
    );
    expect(command(withBasis, MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement).enabled).toBe(true);
    expect(withBasis.nextAction?.code).toBe(MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement);
  });

  it('medição histórica não pode ser regenerada: a origem não é trocada', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'DRAFT', measurementLegacyOrigin: true }),
    );
    const regenerate = command(surface, MEASUREMENT_SURFACE_COMMANDS.RegenerateMeasurement);
    expect(regenerate.enabled).toBe(false);
    expect(regenerate.blockingReasons).toContain('MEASUREMENT_LEGACY_ORIGIN');
  });
});

describe('buildMeasurementCommandSurface — autorização e transparência', () => {
  it('sem permissão, o comando fica DESABILITADO e VISÍVEL — nunca oculto', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ hasPermission: (permission) => permission !== 'measurements:measurement:approve' }),
    );
    const approve = command(surface, MEASUREMENT_SURFACE_COMMANDS.Approve);

    expect(approve.enabled).toBe(false);
    expect(approve.blockingReasons).toContain('NOT_AUTHORIZED');
    expect(approve.reasonLabels[0]).toContain('Sem permissão');
    // O comando continua na LISTA: ocultar faria o operador concluir que ele não
    // existe, quando na verdade ele existe e ele não pode.
    expect(surface.availableCommands.length).toBeGreaterThan(0);
  });

  it('todo comando publica a permissão exigida — a tela não recalcula RBAC', () => {
    const surface = buildMeasurementCommandSurface(facts());
    for (const item of surface.availableCommands) {
      expect(item.requiredPermission.length).toBeGreaterThan(0);
    }
  });

  it('comando habilitado NÃO carrega motivo; desabilitado SEMPRE carrega', () => {
    const surface = buildMeasurementCommandSurface(
      facts({ measurementStatus: 'UNDER_REVIEW', variancesRequiringDecision: [variance()] }),
    );
    for (const item of surface.availableCommands) {
      if (item.enabled) {
        expect(item.blockingReasons).toEqual([]);
        expect(item.reasonLabels).toEqual([]);
      } else {
        expect(item.blockingReasons.length).toBeGreaterThan(0);
        // A mesma quantidade de motivos e de rótulos, na mesma ordem.
        expect(item.reasonLabels.length).toBe(item.blockingReasons.length);
      }
    }
  });
});

describe('labelForMeasurementReason', () => {
  it('traduz os códigos conhecidos desta capability', () => {
    expect(labelForMeasurementReason('VARIANCE_REQUIRES_AUTHORIZATION')).toContain('variação');
    expect(labelForMeasurementReason('CUSTOMER_ACCEPTANCE_PENDING')).toContain('aceite');
    expect(labelForMeasurementReason('MEASUREMENT_BASIS_NOT_PUBLISHED')).toContain('base');
  });

  it('código DESCONHECIDO aparece como o próprio código, nunca em branco', () => {
    // Um código novo na tela do operador é visível; um rótulo vazio esconderia o
    // motivo.
    expect(labelForMeasurementReason('CODIGO_NOVO_QUALQUER')).toBe('CODIGO_NOVO_QUALQUER');
  });
});
