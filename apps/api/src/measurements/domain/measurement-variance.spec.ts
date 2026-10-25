import { describe, expect, it } from 'vitest';
import {
  DEFAULT_VARIANCE_TOLERANCE_PERCENTAGE,
  SEVERITY_THRESHOLDS,
  TOLERANCE_SOURCES,
  VARIANCE_DECISIONS,
  VARIANCE_DIMENSIONS,
  VARIANCE_SEVERITIES,
  classifySeverity,
  detectMeasurementVariances,
  resolveTolerance,
  varianceSeverityWeight,
  type VarianceObservation,
} from './measurement-variance';

/**
 * VARIANCE ENGINE — a prova de que a regra vive no backend.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTES TESTES PROTEGEM
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Antes desta capability, a comparação PLANEJADO × REALIZADO × MEDIDO era feita
 * em `apps/web/src/service-orders/utils/measurement-variance.ts`, sem tolerância,
 * sem severidade e sem impacto financeiro. Ela respondia "igual ou diferente".
 *
 * Estes testes afirmam o CONTRÁRIO do que aquela implementação fazia:
 *
 *   - a tolerância tem fonte declarada, e o padrão é o ÚLTIMO recurso;
 *   - o percentual tem base declarada, e sem base o sistema devolve `null`;
 *   - severidade gradua a decisão exigida;
 *   - a decisão exigida BLOQUEIA a aprovação, com motivo em código;
 *   - `actual = measured` não é assumido em lugar nenhum.
 */

function observation(overrides: Partial<VarianceObservation> = {}): VarianceObservation {
  return {
    dimension: VARIANCE_DIMENSIONS.EquipmentHours,
    dimensionKey: 'H',
    plannedValue: '40',
    actualValue: '46',
    measuredValue: '46',
    unitOfMeasure: 'H',
    unitPrice: '1200',
    currencyCode: 'BRL',
    measurementItemId: 'item-1',
    ...overrides,
  };
}

function detect(observations: VarianceObservation[], overrides: {
  declaredTolerancePercentage?: number | null;
  declaredToleranceSource?: 'CONTRACT' | 'SERVICE' | 'DEFAULT' | null;
  hasAuthorizedAdjustment?: boolean;
} = {}) {
  return detectMeasurementVariances({
    measurementId: 'm-1',
    serviceOrderId: 'so-1',
    unitId: 'PVH',
    declaredTolerancePercentage: overrides.declaredTolerancePercentage ?? null,
    declaredToleranceSource: overrides.declaredToleranceSource ?? null,
    observations,
    hasAuthorizedAdjustment: overrides.hasAuthorizedAdjustment ?? false,
  });
}

describe('resolveTolerance', () => {
  it('aplica a tolerância padrão com fonte DEFAULT quando nenhuma fonte declarou', () => {
    const tolerance = resolveTolerance({ declaredPercentage: null, declaredSource: null });
    expect(tolerance).toEqual({
      percentage: DEFAULT_VARIANCE_TOLERANCE_PERCENTAGE,
      source: TOLERANCE_SOURCES.Default,
    });
  });

  it('respeita a tolerância declarada e sua fonte', () => {
    const tolerance = resolveTolerance({
      declaredPercentage: 2.5,
      declaredSource: TOLERANCE_SOURCES.Contract,
    });
    expect(tolerance).toEqual({ percentage: 2.5, source: TOLERANCE_SOURCES.Contract });
  });

  it('tolerância negativa NÃO é aceita como declaração: cai no padrão', () => {
    const tolerance = resolveTolerance({
      declaredPercentage: -10,
      declaredSource: TOLERANCE_SOURCES.Contract,
    });
    expect(tolerance.source).toBe(TOLERANCE_SOURCES.Default);
  });
});

describe('classifySeverity', () => {
  it('desvio dentro da tolerância é LOW', () => {
    expect(
      classifySeverity({ percentageDelta: 3, tolerancePercentage: 5, financialImpact: 500 }),
    ).toBe(VARIANCE_SEVERITIES.Low);
  });

  it('desvio de até 2x a tolerância é MEDIUM', () => {
    expect(
      classifySeverity({ percentageDelta: 8, tolerancePercentage: 5, financialImpact: 500 }),
    ).toBe(VARIANCE_SEVERITIES.Medium);
  });

  it('desvio de até 4x a tolerância é HIGH', () => {
    expect(
      classifySeverity({ percentageDelta: 15, tolerancePercentage: 5, financialImpact: 500 }),
    ).toBe(VARIANCE_SEVERITIES.High);
  });

  it('desvio acima de 4x a tolerância é CRITICAL', () => {
    expect(
      classifySeverity({ percentageDelta: 40, tolerancePercentage: 5, financialImpact: 500 }),
    ).toBe(VARIANCE_SEVERITIES.Critical);
  });

  it('a tolerância é a ESCALA: o mesmo percentual muda de severidade com outro contrato', () => {
    // 15% é HIGH contra tolerância de 5%...
    expect(
      classifySeverity({ percentageDelta: 15, tolerancePercentage: 5, financialImpact: null }),
    ).toBe(VARIANCE_SEVERITIES.High);
    // ...e LOW contra tolerância de 20%. A decisão segue o contrato, não um
    // número fixo escolhido em código.
    expect(
      classifySeverity({ percentageDelta: 15, tolerancePercentage: 20, financialImpact: null }),
    ).toBe(VARIANCE_SEVERITIES.Low);
  });

  it('exposição acima do limiar escala MEDIUM/HIGH para CRITICAL', () => {
    expect(
      classifySeverity({ percentageDelta: 8, tolerancePercentage: 5, financialImpact: 75_000 }),
    ).toBe(VARIANCE_SEVERITIES.Critical);
  });

  it('exposição alta NÃO escala um desvio LOW: diferença pequena continua pequena', () => {
    expect(
      classifySeverity({ percentageDelta: 2, tolerancePercentage: 5, financialImpact: 900_000 }),
    ).toBe(VARIANCE_SEVERITIES.Low);
  });

  it('sem percentual calculável a severidade é LOW, nunca CRITICAL por ausência de dado', () => {
    expect(
      classifySeverity({ percentageDelta: null, tolerancePercentage: 5, financialImpact: null }),
    ).toBe(VARIANCE_SEVERITIES.Low);
  });
});

describe('detectMeasurementVariances — as três verdades', () => {
  it('EXEMPLO DO REQUISITO: 40h planejadas, 46h realizadas e medidas vira HIGH com impacto', () => {
    const result = detect([observation()]);

    expect(result.variances).toHaveLength(1);
    const variance = result.variances[0]!;

    // TRÊS campos distintos, nunca um só.
    expect(variance.plannedValue).toBe('40');
    expect(variance.actualValue).toBe('46');
    expect(variance.measuredValue).toBe('46');

    // Delta de 6h sobre 40h = 15%.
    expect(variance.absoluteDelta).toBe('6');
    expect(variance.percentageDelta).toBe(15);

    // 6h × R$ 1.200 = R$ 7.200.
    expect(variance.financialImpact).toBe('7200.0000');
    expect(variance.currencyCode).toBe('BRL');

    expect(variance.tolerancePercentage).toBe(5);
    expect(variance.toleranceSource).toBe(TOLERANCE_SOURCES.Default);
    expect(variance.severity).toBe(VARIANCE_SEVERITIES.High);

    expect(variance.requiresDecision).toBe(true);
    expect(variance.decisionKind).toBe(VARIANCE_DECISIONS.AuthorizeAdjustment);
    expect(variance.blockingReason).toBe('VARIANCE_REQUIRES_AUTHORIZATION');
    expect(variance.recommendedResolution).toBe('AUTHORIZE_ADJUSTMENT');

    expect(result.approvalClearable).toBe(false);
    expect(result.highestSeverity).toBe(VARIANCE_SEVERITIES.High);
    expect(result.financialExposure).toBe('7200.0000');
  });

  it('diferença zero NÃO gera linha de variação', () => {
    const result = detect([
      observation({ plannedValue: '40', actualValue: '40', measuredValue: '40' }),
    ]);
    expect(result.variances).toHaveLength(0);
    expect(result.approvalClearable).toBe(true);
    expect(result.summary).toContain('Nenhuma divergência');
  });

  it('medido MENOR que o realizado É variação — o atalho actual = measured não existe', () => {
    // Executou 46h, reconheceu 40h no comercial. Contra o PLANO de 40h o desvio é
    // ZERO; contra o REALIZADO é -6h. Sem a comparação REALIZADO ↔ MEDIDO, 6h de
    // serviço executado deixariam de ser cobrados em silêncio.
    const result = detect([
      observation({ plannedValue: '40', actualValue: '46', measuredValue: '40' }),
    ]);

    expect(result.variances).toHaveLength(1);
    const variance = result.variances[0]!;
    expect(variance.actualValue).toBe('46');
    expect(variance.measuredValue).toBe('40');
    expect(variance.absoluteDelta).toBe('-6');
    expect(variance.explanation).toContain('abaixo do realizado');
    expect(variance.explanation).toContain('difere do medido');
    // 6h × R$ 1.200 de serviço executado e não reconhecido.
    expect(variance.financialImpact).toBe('7200.0000');
    expect(result.approvalClearable).toBe(false);
  });

  it('medido MAIOR que o realizado também é variação (reconhecimento acima do feito)', () => {
    const result = detect([
      observation({ plannedValue: '46', actualValue: '40', measuredValue: '46' }),
    ]);
    const variance = result.variances[0]!;
    expect(variance.absoluteDelta).toBe('6');
    expect(variance.explanation).toContain('acima do realizado');
  });

  it('a comparação de MAIOR magnitude governa severidade e bloqueio', () => {
    // Contra o plano: 16 vs 15 = +6,7%. Contra o realizado: 16 vs 20 = -20%.
    // A maior distância é a do realizado, e é ela que gradua.
    const result = detect([
      observation({
        dimension: VARIANCE_DIMENSIONS.Quantity,
        dimensionKey: 'UN',
        plannedValue: '15',
        actualValue: '20',
        measuredValue: '16',
        unitPrice: '100',
      }),
    ]);
    const variance = result.variances[0]!;
    expect(variance.percentageDelta).toBe(-20);
    expect(variance.severity).toBe(VARIANCE_SEVERITIES.High);
    expect(result.approvalClearable).toBe(false);
  });

  it('sem planejamento a base passa a ser o REALIZADO, declarada na explicação', () => {
    const result = detect([
      observation({ plannedValue: null, actualValue: '46', measuredValue: '46' }),
    ]);
    expect(result.variances).toHaveLength(1);
    // Sem plano: contra o realizado não há desvio, mas contra o plano inexistente
    // existe consumo não planejado. O delta é contra zero e o percentual é null.
    const variance = result.variances[0]!;
    expect(variance.absoluteDelta).toBe('46');
    expect(variance.percentageDelta).toBeNull();
    expect(variance.explanation).toContain('sem base para percentual');
  });

  it('sem NENHUMA referência o delta é contra zero, e o percentual é null', () => {
    const result = detect([
      observation({ plannedValue: null, actualValue: null, measuredValue: '10' }),
    ]);

    const variance = result.variances[0]!;
    expect(variance.absoluteDelta).toBe('10');
    expect(variance.percentageDelta).toBeNull();
    expect(variance.explanation).toContain('sem base para percentual');
  });

  it('sem preço unitário o impacto financeiro é null — não zero', () => {
    const result = detect([observation({ unitPrice: null })]);
    const variance = result.variances[0]!;
    expect(variance.financialImpact).toBeNull();
    expect(variance.currencyCode).toBeNull();
  });

  it('posse de ajuste autorizado troca o motivo do bloqueio', () => {
    const result = detect([observation()], { hasAuthorizedAdjustment: true });
    expect(result.variances[0]!.blockingReason).toBe('VARIANCE_ADJUSTMENT_NOT_APPLIED');
  });

  it('tolerância contratual de 20% libera a MESMA variação de 15%', () => {
    const result = detect([observation()], {
      declaredTolerancePercentage: 20,
      declaredToleranceSource: 'CONTRACT',
    });

    expect(result.tolerance).toEqual({ percentage: 20, source: TOLERANCE_SOURCES.Contract });
    expect(result.variances[0]!.severity).toBe(VARIANCE_SEVERITIES.Low);
    expect(result.approvalClearable).toBe(true);
    expect(result.financialExposure).toBeNull();
  });

  it('ordena por severidade e depois por exposição', () => {
    const result = detect([
      observation({
        dimension: VARIANCE_DIMENSIONS.Quantity,
        dimensionKey: 'UN',
        plannedValue: '15',
        actualValue: '16',
        measuredValue: '16',
        unitPrice: '5000',
      }),
      observation({
        dimension: VARIANCE_DIMENSIONS.EquipmentHours,
        dimensionKey: 'H',
        plannedValue: '40',
        actualValue: '46',
        measuredValue: '46',
        unitPrice: '1200',
      }),
    ]);

    expect(result.variances[0]!.dimension).toBe(VARIANCE_DIMENSIONS.EquipmentHours);
    expect(result.variances[1]!.dimension).toBe(VARIANCE_DIMENSIONS.Quantity);
  });

  it('exposição soma SÓ o que exige decisão', () => {
    const result = detect([
      observation(), // HIGH, R$ 7.200
      observation({
        dimension: VARIANCE_DIMENSIONS.Quantity,
        dimensionKey: 'UN',
        plannedValue: '100',
        actualValue: '101',
        measuredValue: '101',
        unitPrice: '1000',
      }), // 1% → LOW, fora da exposição
    ]);

    expect(result.variances).toHaveLength(2);
    expect(result.decisionRequired).toHaveLength(1);
    expect(result.financialExposure).toBe('7200.0000');
  });

  it('é determinística: mesma entrada, mesma saída', () => {
    const first = detect([observation()]);
    const second = detect([observation()]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('a explicação é produzida pelo backend e não depende da tela', () => {
    const result = detect([observation()]);
    const explanation = result.variances[0]!.explanation;
    expect(explanation).toContain('Horas de equipamento');
    expect(explanation).toContain('planejado 40');
    expect(explanation).toContain('medido 46');
    expect(explanation).toContain('tolerância 5');
    expect(explanation).toContain('severidade HIGH');
  });
});

describe('varianceSeverityWeight', () => {
  it('CRITICAL vem antes de HIGH, e NONE por último', () => {
    expect(varianceSeverityWeight('CRITICAL')).toBeLessThan(varianceSeverityWeight('HIGH'));
    expect(varianceSeverityWeight('HIGH')).toBeLessThan(varianceSeverityWeight('MEDIUM'));
    expect(varianceSeverityWeight('NONE')).toBeGreaterThan(varianceSeverityWeight('LOW'));
  });
});

describe('limiares declarados', () => {
  it('os múltiplos de severidade são crescentes e declarados', () => {
    expect(SEVERITY_THRESHOLDS.MEDIUM_MULTIPLE).toBeLessThan(SEVERITY_THRESHOLDS.HIGH_MULTIPLE);
    expect(SEVERITY_THRESHOLDS.HIGH_MULTIPLE).toBeLessThan(SEVERITY_THRESHOLDS.CRITICAL_MULTIPLE);
  });
});
