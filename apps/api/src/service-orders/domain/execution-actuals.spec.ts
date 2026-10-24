import { describe, expect, it } from 'vitest';
import {
  ACTUAL_KINDS,
  buildActualsComparison,
  buildResourceSubstitutions,
  canonicalUnitForActualKind,
  isActualKind,
  sumDecimal,
  type ActualFact,
  type ExecutedResourceFact,
} from './execution-actuals';

/**
 * ACTUALS — PLANEJADO vs REALIZADO.
 *
 * O contrato que estes testes fixam:
 *
 *   1. O planejado NUNCA é sobrescrito pelo realizado.
 *   2. Ausência de realizado NÃO é zero — é ausência.
 *   3. Variação é aritmética decimal exata, sem ponto flutuante.
 *   4. Variação sem causa registrada é declarada como "sem causa", nunca
 *      preenchida com texto genérico.
 */

function actual(overrides: Partial<ActualFact> = {}): ActualFact {
  return {
    id: 'a-1',
    actualKind: ACTUAL_KINDS.LaborHours,
    physicalAssetId: null,
    workforceMemberId: 'wm-1',
    resourceLabel: 'Carlos',
    actualValue: '9.2',
    unitOfMeasure: 'H',
    plannedValue: '8',
    plannedUnitOfMeasure: 'H',
    source: 'MANUAL',
    occurredAt: '2026-10-24T14:00:00.000Z',
    notes: null,
    ...overrides,
  };
}

describe('sumDecimal — aritmética sem ponto flutuante', () => {
  it('soma decimais exatamente', () => {
    expect(sumDecimal(['0.1', '0.2'])).toBe('0.3');
  });

  it('não perde precisão em muitos lançamentos', () => {
    const values = Array.from({ length: 100 }, () => '0.01');
    expect(sumDecimal(values)).toBe('1');
  });

  it('trata vazio e nulo como zero sem quebrar', () => {
    expect(sumDecimal([])).toBe('0');
    expect(sumDecimal([null, undefined, ''])).toBe('0');
  });

  it('preserva sinal negativo', () => {
    expect(sumDecimal(['-5', '2'])).toBe('-3');
  });

  it('mantém até 6 casas decimais', () => {
    expect(sumDecimal(['1.123456', '1.123456'])).toBe('2.246912');
  });
});

describe('buildActualsComparison — ausência não é zero', () => {
  it('grupo SEM realizado tem actualValue NULL, não zero', () => {
    const comparison = buildActualsComparison({
      actuals: [],
      planned: { [ACTUAL_KINDS.VehicleDistance]: { quantity: '420', unitOfMeasure: 'KM' } },
      substitutions: [],
    });
    const distance = comparison.lines.find((line) => line.group === 'DISTANCE');
    expect(distance?.actualValue).toBeNull();
    expect(distance?.direction).toBe('UNKNOWN');
    expect(distance?.recordCount).toBe(0);
  });

  it('sem nenhum realizado, o resumo DIZ que não há medição', () => {
    const comparison = buildActualsComparison({ actuals: [], planned: {}, substitutions: [] });
    expect(comparison.hasActuals).toBe(false);
    expect(comparison.summary).toContain('Nenhum realizado registrado');
  });

  it('o planejado continua exposto mesmo sem realizado', () => {
    const comparison = buildActualsComparison({
      actuals: [],
      planned: { [ACTUAL_KINDS.VehicleDistance]: { quantity: '420', unitOfMeasure: 'KM' } },
      substitutions: [],
    });
    const distance = comparison.lines.find((line) => line.group === 'DISTANCE');
    expect(distance?.plannedValue).toBe('420');
  });
});

describe('buildActualsComparison — variação', () => {
  it('realizado acima do planejado gera OVER e variância positiva', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({
          actualKind: ACTUAL_KINDS.VehicleDistance,
          actualValue: '468',
          unitOfMeasure: 'KM',
        }),
      ],
      planned: { [ACTUAL_KINDS.VehicleDistance]: { quantity: '420', unitOfMeasure: 'KM' } },
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'DISTANCE');
    expect(line?.direction).toBe('OVER');
    expect(line?.variance).toBe('48');
    expect(line?.actualValue).toBe('468');
    expect(line?.plannedValue).toBe('420');
  });

  it('realizado abaixo do planejado gera UNDER', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({ actualKind: ACTUAL_KINDS.FuelVolume, actualValue: '100', unitOfMeasure: 'L' }),
      ],
      planned: { [ACTUAL_KINDS.FuelVolume]: { quantity: '130', unitOfMeasure: 'L' } },
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'FUEL');
    expect(line?.direction).toBe('UNDER');
    expect(line?.variance).toBe('-30');
  });

  it('realizado igual ao planejado gera EQUAL e variância zero', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({ actualKind: ACTUAL_KINDS.FuelVolume, actualValue: '130', unitOfMeasure: 'L' }),
      ],
      planned: { [ACTUAL_KINDS.FuelVolume]: { quantity: '130', unitOfMeasure: 'L' } },
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'FUEL');
    expect(line?.direction).toBe('EQUAL');
    expect(line?.variance).toBe('0');
    expect(line?.explainable).toBe(false);
  });

  it('vários lançamentos do mesmo grupo são somados', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({
          id: 'a1',
          actualKind: ACTUAL_KINDS.LaborHours,
          actualValue: '4',
          workforceMemberId: 'wm-1',
        }),
        actual({
          id: 'a2',
          actualKind: ACTUAL_KINDS.LaborHours,
          actualValue: '5.2',
          workforceMemberId: 'wm-2',
        }),
      ],
      planned: { [ACTUAL_KINDS.LaborHours]: { quantity: '8', unitOfMeasure: 'H' } },
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'LABOR');
    expect(line?.actualValue).toBe('9.2');
    expect(line?.recordCount).toBe(2);
    expect(line?.variance).toBe('1.2');
  });

  it('planejado ausente deixa a variação UNKNOWN em vez de assumir zero', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({
          actualKind: ACTUAL_KINDS.MaterialQuantity,
          actualValue: '5',
          unitOfMeasure: 'UNIT',
        }),
      ],
      planned: {},
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'MATERIAL');
    expect(line?.actualValue).toBe('5');
    expect(line?.plannedValue).toBeNull();
    expect(line?.variance).toBeNull();
    expect(line?.direction).toBe('UNKNOWN');
  });
});

describe('explicabilidade da variação', () => {
  it('troca de veículo explica a variação de distância', () => {
    const substitutions = buildResourceSubstitutions([
      {
        role: 'VEHICLE',
        resourceId: 'v1',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        origin: 'PLANNED',
      },
      {
        role: 'VEHICLE',
        resourceId: 'v2',
        resourceCode: 'VEH-031',
        resourceLabel: null,
        origin: 'ACTUAL',
      },
    ]);

    const comparison = buildActualsComparison({
      actuals: [
        actual({
          actualKind: ACTUAL_KINDS.VehicleDistance,
          actualValue: '468',
          unitOfMeasure: 'KM',
        }),
      ],
      planned: { [ACTUAL_KINDS.VehicleDistance]: { quantity: '420', unitOfMeasure: 'KM' } },
      substitutions,
    });

    const line = comparison.lines.find((item) => item.group === 'DISTANCE');
    expect(line?.explainable).toBe(true);
    expect(line?.explanation).toContain('VEH-031');
    expect(line?.explanation).toContain('VEH-027');
  });

  it('troca de condutor explica a variação de mão de obra', () => {
    const substitutions = buildResourceSubstitutions([
      {
        role: 'DRIVER',
        resourceId: 'd1',
        resourceCode: 'DRV-019',
        resourceLabel: null,
        origin: 'PLANNED',
      },
      {
        role: 'DRIVER',
        resourceId: 'd2',
        resourceCode: 'DRV-044',
        resourceLabel: null,
        origin: 'ACTUAL',
      },
    ]);

    const comparison = buildActualsComparison({
      actuals: [actual({ actualKind: ACTUAL_KINDS.LaborHours, actualValue: '9.2' })],
      planned: { [ACTUAL_KINDS.LaborHours]: { quantity: '8', unitOfMeasure: 'H' } },
      substitutions,
    });

    const line = comparison.lines.find((item) => item.group === 'LABOR');
    expect(line?.explainable).toBe(true);
    expect(line?.explanation).toContain('DRV-044');
  });

  it('variação SEM causa registrada é declarada como sem causa', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({ actualKind: ACTUAL_KINDS.FuelVolume, actualValue: '151', unitOfMeasure: 'L' }),
      ],
      planned: { [ACTUAL_KINDS.FuelVolume]: { quantity: '130', unitOfMeasure: 'L' } },
      substitutions: [],
    });
    const line = comparison.lines.find((item) => item.group === 'FUEL');
    expect(line?.direction).toBe('OVER');
    expect(line?.explainable).toBe(false);
    // Nenhum texto inventado: sem causa, o campo é nulo.
    expect(line?.explanation).toBeNull();
    expect(comparison.summary).toContain('Sem causa registrada');
  });

  it('o resumo nomeia os grupos acima e abaixo do planejado', () => {
    const comparison = buildActualsComparison({
      actuals: [
        actual({
          id: 'a1',
          actualKind: ACTUAL_KINDS.VehicleDistance,
          actualValue: '500',
          unitOfMeasure: 'KM',
        }),
        actual({
          id: 'a2',
          actualKind: ACTUAL_KINDS.FuelVolume,
          actualValue: '90',
          unitOfMeasure: 'L',
        }),
      ],
      planned: {
        [ACTUAL_KINDS.VehicleDistance]: { quantity: '420', unitOfMeasure: 'KM' },
        [ACTUAL_KINDS.FuelVolume]: { quantity: '130', unitOfMeasure: 'L' },
      },
      substitutions: [],
    });
    expect(comparison.summary).toContain('Acima do planejado');
    expect(comparison.summary).toContain('distância');
    expect(comparison.summary).toContain('Abaixo do planejado');
    expect(comparison.summary).toContain('combustível');
  });
});

describe('buildResourceSubstitutions', () => {
  it('recurso igual não é marcado como trocado', () => {
    const result = buildResourceSubstitutions([
      {
        role: 'VEHICLE',
        resourceId: 'v1',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        origin: 'PLANNED',
      },
      {
        role: 'VEHICLE',
        resourceId: 'v1',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        origin: 'ACTUAL',
      },
    ]);
    const vehicle = result.find((item) => item.role === 'VEHICLE');
    expect(vehicle?.changed).toBe(false);
  });

  it('recurso diferente é marcado como trocado', () => {
    const result = buildResourceSubstitutions([
      {
        role: 'VEHICLE',
        resourceId: 'v1',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        origin: 'PLANNED',
      },
      {
        role: 'VEHICLE',
        resourceId: 'v2',
        resourceCode: 'VEH-031',
        resourceLabel: null,
        origin: 'ACTUAL',
      },
    ]);
    expect(result.find((item) => item.role === 'VEHICLE')?.changed).toBe(true);
  });

  it('sem realizado de recurso, o planejado é preservado e não marcado como trocado', () => {
    const result = buildResourceSubstitutions([
      {
        role: 'VEHICLE',
        resourceId: 'v1',
        resourceCode: 'VEH-027',
        resourceLabel: null,
        origin: 'PLANNED',
      },
    ]);
    const vehicle = result.find((item) => item.role === 'VEHICLE');
    expect(vehicle?.plannedCode).toBe('VEH-027');
    expect(vehicle?.actualCode).toBeNull();
    expect(vehicle?.changed).toBe(false);
  });

  it('papel sem planejado e sem realizado não aparece', () => {
    const result = buildResourceSubstitutions([]);
    expect(result).toHaveLength(0);
  });
});

describe('vocabulário', () => {
  it('reconhece apenas os tipos declarados', () => {
    expect(isActualKind('LABOR_HOURS')).toBe(true);
    expect(isActualKind('NOT_A_KIND')).toBe(false);
  });

  it('todo tipo tem unidade canônica declarada', () => {
    for (const kind of Object.values(ACTUAL_KINDS)) {
      expect(canonicalUnitForActualKind(kind)).toBeTruthy();
    }
  });

  it('não muta os fatos recebidos', () => {
    const actuals = [actual()];
    const snapshot = JSON.stringify(actuals);
    buildActualsComparison({ actuals, planned: {}, substitutions: [] });
    expect(JSON.stringify(actuals)).toBe(snapshot);
  });

  it('as linhas cobrem todos os grupos de comparação declarados', () => {
    const comparison = buildActualsComparison({ actuals: [], planned: {}, substitutions: [] });
    expect(comparison.lines.map((line) => line.group)).toEqual([
      'LABOR',
      'VEHICLE',
      'DISTANCE',
      'FUEL',
      'EQUIPMENT',
      'MATERIAL',
      'THIRD_PARTY',
      'WAITING',
      'DOWNTIME',
    ]);
  });
});

describe('substituições tipadas', () => {
  it('ExecutedResourceFact exige origem explícita', () => {
    const fact: ExecutedResourceFact = {
      role: 'EQUIPMENT',
      resourceId: 'e1',
      resourceCode: 'EQP-1',
      resourceLabel: 'Betoneira',
      origin: 'ACTUAL',
    };
    expect(fact.origin).toBe('ACTUAL');
  });
});
