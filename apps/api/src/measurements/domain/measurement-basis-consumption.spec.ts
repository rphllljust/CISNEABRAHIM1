import { describe, expect, it } from 'vitest';
import {
  MEASUREMENT_ITEM_ORIGINS,
  assertBasisConsumable,
  canRegenerateFromBasis,
  deriveItemsFromBasis,
  isLegacyMeasurementOrigin,
  parseMeasurementBasisActuals,
  parseMeasurementBasisLines,
  resolveDeclaredVarianceTolerance,
  type PublishedMeasurementBasis,
} from './measurement-basis-consumption';
import { MeasurementError } from './measurement';

/**
 * CONSUMO DA BASE DE MEDIÇÃO — UMA execução fechada, UMA verdade operacional.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTES TESTES TORNAM IMPOSSÍVEL DE REINTRODUZIR
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A vertical anterior publicou `so.measurement_basis` no fechamento da execução,
 * com evento e contrato de leitura. A vertical seguinte continuou derivando os
 * itens de `so.execution_entries` — a leitura INTERNA do domínio vizinho.
 *
 * O efeito: a base podia dizer 46h e a medição medir 40h, porque cada uma lia
 * uma fonte diferente do mesmo fato. Um handoff que ninguém consome não é
 * handoff; é a segunda verdade com documentação.
 */

function basis(overrides: Partial<PublishedMeasurementBasis> = {}): PublishedMeasurementBasis {
  return {
    id: 'basis-1',
    serviceOrderId: 'so-1',
    closureId: 'closure-1',
    unitId: 'PVH',
    status: 'READY',
    preparedAt: '2026-10-20T10:00:00.000Z',
    actuals: { H: '46', UN: '16' },
    lines: [
      {
        lineKey: 'H',
        unitCode: 'H',
        actualQuantity: '46',
        plannedQuantity: '40',
        recordCount: 3,
        source: 'EXECUTION_ACTUALS',
      },
      {
        lineKey: 'UN',
        unitCode: 'UN',
        actualQuantity: '16',
        plannedQuantity: '15',
        recordCount: 1,
        source: 'EXECUTION_ACTUALS',
      },
    ],
    ...overrides,
  };
}

describe('parseMeasurementBasisLines — coerção declarada de JSONB', () => {
  it('converte as linhas publicadas pelo fechamento', () => {
    const lines = parseMeasurementBasisLines([
      { unitCode: 'H', actualQuantity: '46', plannedQuantity: '40', recordCount: 3, source: 'EXECUTION_ACTUALS' },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      lineKey: 'H',
      unitCode: 'H',
      actualQuantity: '46',
      plannedQuantity: '40',
      recordCount: 3,
      source: 'EXECUTION_ACTUALS',
    });
  });

  it('aceita número na quantidade e devolve string — precisão preservada no contrato', () => {
    const lines = parseMeasurementBasisLines([
      { unitCode: 'H', actualQuantity: 46.5, recordCount: 1 },
    ]);
    expect(lines[0]!.actualQuantity).toBe('46.5');
  });

  it('não-array devolve lista vazia (base sem linhas, não base inválida)', () => {
    expect(parseMeasurementBasisLines(null)).toEqual([]);
    expect(parseMeasurementBasisLines('x')).toEqual([]);
  });

  it('linha SEM unidade é recusada — descartar em silêncio geraria medição menor', () => {
    expect(() =>
      parseMeasurementBasisLines([{ actualQuantity: '46', recordCount: 1 }]),
    ).toThrow(MeasurementError);
  });

  it('linha SEM quantidade é recusada', () => {
    expect(() =>
      parseMeasurementBasisLines([{ unitCode: 'H', recordCount: 1 }]),
    ).toThrow(MeasurementError);
  });

  it('linha SEM recordCount é recusada: sem procedência não há base verificável', () => {
    expect(() =>
      parseMeasurementBasisLines([{ unitCode: 'H', actualQuantity: '46' }]),
    ).toThrow(MeasurementError);
  });

  it('linha com chave DUPLICADA é recusada — deduplicação ficaria impossível', () => {
    expect(() =>
      parseMeasurementBasisLines([
        { unitCode: 'H', actualQuantity: '46', recordCount: 1 },
        { unitCode: 'H', actualQuantity: '10', recordCount: 1 },
      ]),
    ).toThrow(MeasurementError);
  });

  it('respeita lineKey declarada quando o produtor passa a publicá-la', () => {
    const lines = parseMeasurementBasisLines([
      { lineKey: 'EQUIP-H', unitCode: 'H', actualQuantity: '46', recordCount: 1 },
    ]);
    expect(lines[0]!.lineKey).toBe('EQUIP-H');
  });
});

describe('parseMeasurementBasisActuals', () => {
  it('converte o mapa unidade → quantidade', () => {
    expect(parseMeasurementBasisActuals({ H: '46', UN: 16 })).toEqual({ H: '46', UN: '16' });
  });

  it('valor inválido é OMITIDO — nunca coagido a zero', () => {
    expect(parseMeasurementBasisActuals({ H: 'abc', UN: '16' })).toEqual({ UN: '16' });
  });

  it('não-objeto devolve mapa vazio', () => {
    expect(parseMeasurementBasisActuals(null)).toEqual({});
    expect(parseMeasurementBasisActuals([1, 2])).toEqual({});
  });
});

describe('assertBasisConsumable', () => {
  it('base READY da MESMA ordem com linhas é consumível', () => {
    expect(() => assertBasisConsumable({ basis: basis(), serviceOrderId: 'so-1' })).not.toThrow();
  });

  it('sem base publicada, a medição não pode ser criada', () => {
    expect(() => assertBasisConsumable({ basis: null, serviceOrderId: 'so-1' })).toThrow(
      MeasurementError,
    );
  });

  it('base SUPERSEDED é passado, não fonte', () => {
    expect(() =>
      assertBasisConsumable({ basis: basis({ status: 'SUPERSEDED' }), serviceOrderId: 'so-1' }),
    ).toThrow(MeasurementError);
  });

  it('base de OUTRA ordem não pode ser consumida', () => {
    expect(() =>
      assertBasisConsumable({ basis: basis({ serviceOrderId: 'so-2' }), serviceOrderId: 'so-1' }),
    ).toThrow(MeasurementError);
  });

  it('base VAZIA impediria medir: recusada antes de criar medição vazia', () => {
    expect(() =>
      assertBasisConsumable({ basis: basis({ lines: [] }), serviceOrderId: 'so-1' }),
    ).toThrow(MeasurementError);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * SERVIÇO DE PREÇO GLOBAL: BASE VAZIA, QUANTIDADE COMERCIAL PRESENTE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `GLOBAL_COMPLETION` cobra o serviço entregue, não quantidade por recurso: não
   * há `execution_actuals` a agregar e a base publica `lines: []`. Exigir linha de
   * base tornaria não medível a venda que esse modo de medição descreve.
   */
  it('base vazia COM quantidade na unidade do contrato é consumível (preço global)', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: 'SERVICE', quantity: '1' }],
        contractUnits: new Set(['SERVICE']),
      }),
    ).not.toThrow();
  });

  it('base vazia com quantidade ZERO continua recusada', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: 'SERVICE', quantity: '0' }],
        contractUnits: new Set(['SERVICE']),
      }),
    ).toThrow(MeasurementError);
  });

  it('base vazia com quantidade em unidade VAZIA continua recusada', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: '   ', quantity: '1' }],
        contractUnits: new Set(['SERVICE']),
      }),
    ).toThrow(MeasurementError);
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * FATO FÍSICO NÃO É QUANTIDADE COMERCIAL
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * `7.8 HOUR` executadas não são `7.8 DAY` contratados; `420 KM` não são `420
   * TRIP`. Aceitar o fato físico como quantidade comercial inventaria a taxa de
   * conversão, e o valor faturado sairia de uma suposição. A recusa é a resposta
   * honesta: sem regra de conversão declarada, não há como medir.
   */
  it('base vazia com realizado em HOUR e contrato em DAY é RECUSADA', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: 'HOUR', quantity: '7.8' }],
        contractUnits: new Set(['DAY']),
      }),
    ).toThrow(MeasurementError);
  });

  it('base vazia com realizado em KM e contrato em TRIP é RECUSADA', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: 'KM', quantity: '420' }],
        contractUnits: new Set(['TRIP']),
      }),
    ).toThrow(MeasurementError);
  });

  it('quantidade comercial presente ao lado de fatos físicos é consumível', () => {
    // O contrato declara DAY; o operador registrou 3 DAY (comercial) e 7.8 HOUR
    // (físico). O comercial supre a medição; o físico não entra.
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [
          { unitCode: 'DAY', quantity: '3' },
          { unitCode: 'HOUR', quantity: '7.8' },
        ],
        contractUnits: new Set(['DAY']),
      }),
    ).not.toThrow();
  });

  it('sem unidade contratual declarada, base vazia é recusada', () => {
    expect(() =>
      assertBasisConsumable({
        basis: basis({ lines: [] }),
        serviceOrderId: 'so-1',
        executionQuantities: [{ unitCode: 'DAY', quantity: '3' }],
      }),
    ).toThrow(MeasurementError);
  });
});

describe('deriveItemsFromBasis — três verdades preservadas', () => {
  it('cada linha vira um item com PLANEJADO, REALIZADO e MEDIDO separados', () => {
    const items = deriveItemsFromBasis(basis());

    expect(items).toHaveLength(2);
    const equipment = items[0]!;
    expect(equipment.plannedQuantity).toBe('40');
    expect(equipment.actualQuantity).toBe('46');
    // O MEDIDO nasce do realizado congelado: é ponto de partida de conferência,
    // não identidade permanente.
    expect(equipment.measuredQuantity).toBe('46');
    // As três colunas são CAMPOS distintos — nunca um só.
    expect(equipment.plannedQuantity).not.toBe(equipment.actualQuantity);
  });

  it('a origem é a BASE, com identidade imutável — não a entrada de execução', () => {
    const items = deriveItemsFromBasis(basis());
    for (const item of items) {
      expect(item.origin).toBe(MEASUREMENT_ITEM_ORIGINS.Basis);
      expect(item.sourceMeasurementBasisId).toBe('basis-1');
      expect(item.sourceBasisLineKey).toBe(item.unitCode);
      // O caminho antigo NÃO é preenchido em item novo.
      expect(item.sourceExecutionEntryId).toBeNull();
    }
  });

  it('linha sem planejamento publica plannedQuantity null — nunca zero', () => {
    const items = deriveItemsFromBasis(
      basis({
        lines: [
          {
            lineKey: 'H',
            unitCode: 'H',
            actualQuantity: '46',
            plannedQuantity: null,
            recordCount: 1,
            source: 'EXECUTION_ACTUALS',
          },
        ],
      }),
    );
    expect(items[0]!.plannedQuantity).toBeNull();
    expect(items[0]!.plannedUnitOfMeasure).toBeNull();
  });

  /**
   * ─────────────────────────────────────────────────────────────────────────────
   * FALLBACK DA QUANTIDADE COMERCIAL DE EXECUÇÃO
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A base vazia continua sendo a ORIGEM do item: `sourceMeasurementBasisId`
   * preenchido e `sourceExecutionEntryId` nulo. O que a execução supre é o
   * REALIZADO que a base não trouxe — não a procedência.
   */
  it('base vazia deriva o item do realizado comercial, preservando a ORIGEM na base', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [{ unitCode: 'SERVICE', quantity: '1' }],
      new Set(['SERVICE']),
    );

    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.origin).toBe(MEASUREMENT_ITEM_ORIGINS.Basis);
    expect(item.sourceMeasurementBasisId).toBe('basis-1');
    expect(item.sourceBasisLineKey).toBe('SERVICE');
    // Não é o caminho histórico: a entrada de execução NÃO vira identidade.
    expect(item.sourceExecutionEntryId).toBeNull();
    expect(item.unitCode).toBe('SERVICE');
    expect(item.actualQuantity).toBe('1');
    expect(item.measuredQuantity).toBe('1');
    // Sem linha na base não há planejado congelado; preencher com o realizado
    // afirmaria um plano que não existiu.
    expect(item.plannedQuantity).toBeNull();
    expect(item.plannedUnitOfMeasure).toBeNull();
  });

  it('quantidades de execução da MESMA unidade somam numa única linha', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [
        { unitCode: 'SERVICE', quantity: '1' },
        { unitCode: 'SERVICE', quantity: '2' },
      ],
      new Set(['SERVICE']),
    );

    expect(items).toHaveLength(1);
    expect(items[0]!.actualQuantity).toBe('3');
  });

  it('unidades contratuais diferentes geram linhas distintas', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [
        { unitCode: 'SERVICE', quantity: '1' },
        { unitCode: 'DAY', quantity: '2' },
      ],
      new Set(['SERVICE', 'DAY']),
    );

    expect(items).toHaveLength(2);
    const units = items.map((item) => item.unitCode).sort();
    expect(units).toEqual(['DAY', 'SERVICE']);
  });

  /**
   * O FATO FÍSICO NÃO CONTAMINA O VALOR FATURÁVEL.
   *
   * `3 DAY` contratados com `7.8 HOUR` executadas medem `3 DAY`. As horas ficam no
   * realizado de custo e não viram quantidade comercial — somá-las ao dia seria
   * somar unidades diferentes, e convertê-las seria inventar a taxa.
   */
  it('fatos físicos NÃO entram na derivação comercial', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [
        { unitCode: 'DAY', quantity: '3' },
        { unitCode: 'HOUR', quantity: '7.8' },
      ],
      new Set(['DAY']),
    );

    expect(items).toHaveLength(1);
    expect(items[0]!.unitCode).toBe('DAY');
    expect(items[0]!.actualQuantity).toBe('3');
  });

  it('sem nenhuma unidade contratual presente, não deriva linha alguma', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [{ unitCode: 'HOUR', quantity: '7.8' }],
      new Set(['DAY']),
    );

    expect(items).toHaveLength(0);
  });

  it('quantidade ZERO não produz linha — medição de valor zero não é medição', () => {
    const items = deriveItemsFromBasis(
      basis({ lines: [] }),
      [{ unitCode: 'SERVICE', quantity: '0' }],
      new Set(['SERVICE']),
    );

    expect(items).toHaveLength(0);
  });

  it('base COM realizado nunca é substituída pela quantidade de execução', () => {
    // `basis()` traz 2 linhas com realizado congelado; o fallback não entra.
    const items = deriveItemsFromBasis(basis(), [{ unitCode: 'SERVICE', quantity: '999' }]);

    expect(items).toHaveLength(2);
    expect(items.map((item) => item.unitCode)).not.toContain('SERVICE');
  });
});

describe('compatibilidade com medição histórica', () => {
  it('item histórico tem origem antiga e nenhuma base', () => {
    expect(
      isLegacyMeasurementOrigin({
        sourceMeasurementBasisId: null,
        sourceExecutionEntryId: 'entry-1',
      }),
    ).toBe(true);
  });

  it('item novo NÃO é histórico', () => {
    expect(
      isLegacyMeasurementOrigin({
        sourceMeasurementBasisId: 'basis-1',
        sourceExecutionEntryId: null,
      }),
    ).toBe(false);
  });

  it('regenerar medição histórica é RECUSADO: trocaria a origem no meio da vida', () => {
    const result = canRegenerateFromBasis({
      hasBasis: true,
      measurementCreatedByLegacyPath: true,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MEASUREMENT_LEGACY_ORIGIN');
  });

  it('sem base publicada a regeneração é recusada com motivo próprio', () => {
    const result = canRegenerateFromBasis({
      hasBasis: false,
      measurementCreatedByLegacyPath: false,
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('MEASUREMENT_BASIS_NOT_PUBLISHED');
  });

  it('medição nova com base pode ser regenerada', () => {
    expect(
      canRegenerateFromBasis({ hasBasis: true, measurementCreatedByLegacyPath: false }).allowed,
    ).toBe(true);
  });
});

describe('resolveDeclaredVarianceTolerance', () => {
  it('o CONTRATO governa sobre o serviço', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: { varianceTolerance: 2 },
      serviceSnapshot: { varianceTolerance: 10 },
    });
    expect(resolved).toEqual({ percentage: 2, source: 'CONTRACT' });
  });

  it('sem contrato, o SERVIÇO governa', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: null,
      serviceSnapshot: { varianceTolerance: 10 },
    });
    expect(resolved).toEqual({ percentage: 10, source: 'SERVICE' });
  });

  it('nenhuma fonte declara: null com fonte null (o domínio aplica o padrão)', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: {},
      serviceSnapshot: {},
    });
    expect(resolved).toEqual({ percentage: null, source: null });
  });

  it('texto percentual é convertido de forma DECLARADA', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: { varianceTolerance: '7,5%' },
      serviceSnapshot: null,
    });
    expect(resolved).toEqual({ percentage: 7.5, source: 'CONTRACT' });
  });

  it('texto inválido NÃO vira número inventado: cai para null', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: { varianceTolerance: 'tolerância razoável' },
      serviceSnapshot: null,
    });
    expect(resolved).toEqual({ percentage: null, source: null });
  });

  it('tolerância negativa é recusada como declaração', () => {
    const resolved = resolveDeclaredVarianceTolerance({
      contractSnapshot: { varianceTolerance: -5 },
      serviceSnapshot: null,
    });
    expect(resolved).toEqual({ percentage: null, source: null });
  });
});
