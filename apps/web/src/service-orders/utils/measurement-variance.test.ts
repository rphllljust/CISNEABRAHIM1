import { describe, expect, it } from 'vitest';
import { formatMoneyBrl, formatQuantity } from './measurement-format';
import {
  detectItemVariances,
  quantitiesEqual,
  VARIANCE_KINDS,
} from './measurement-variance';
import { buildMeasurementComparisonRows } from './measurement-comparison';

describe('measurement format', () => {
  it('formats monetary values in pt-BR', () => {
    expect(formatMoneyBrl('1000')).toMatch(/R\$\s*1\.000,00/);
    expect(formatMoneyBrl(null)).toBe('—');
  });

  it('formats quantities with unit', () => {
    expect(formatQuantity('10.5', 'M3')).toContain('M3');
  });
});

describe('measurement variance', () => {
  it('detects no divergence when quantities align', () => {
    const variances = detectItemVariances({
      plannedQuantity: '10',
      actualQuantity: '10',
      measuredQuantity: '10',
      unitCode: 'M3',
      expectedUnitCode: 'M3',
      unitPrice: null,
      snapshotSalePrice: '1000',
      lineAmount: '1000',
    });
    expect(variances).toEqual([VARIANCE_KINDS.Aligned]);
    expect(quantitiesEqual('10', '10.0')).toBe(true);
  });

  it('detects quantity divergence between actual and measured', () => {
    const variances = detectItemVariances({
      plannedQuantity: '10',
      actualQuantity: '10',
      measuredQuantity: '17',
      unitCode: 'M3',
      expectedUnitCode: 'M3',
      unitPrice: null,
      snapshotSalePrice: null,
      lineAmount: null,
    });
    expect(variances).toContain(VARIANCE_KINDS.QuantityDivergent);
  });

  it('builds comparison rows with planned, actual and measured columns', () => {
    const rows = buildMeasurementComparisonRows({
      items: [
        {
          id: 'item-1',
          lineNumber: 1,
          /**
           * ORIGEM AUTORITATIVA + AS TRÊS VERDADES.
           *
           * O fixture acompanha o contrato: o item novo carrega a base publicada
           * e a chave da linha, e `sourceExecutionEntryId` é `null` — o caminho
           * histórico não é preenchido em item derivado da base.
           */
          sourceMeasurementBasisId: 'basis-1',
          sourceBasisLineKey: 'SERVICE',
          sourceExecutionEntryId: null,
          unitCode: 'SERVICE',
          plannedQuantity: '1',
          plannedUnitOfMeasure: 'SERVICE',
          actualQuantity: '1',
          measuredQuantity: '1',
          unitPrice: null,
          lineAmount: '1000',
          pricingLineSnapshot: { salePrice: '1000' },
          notes: null,
        },
      ],
      planned: [
        {
          id: 'plan-1',
          serviceOrderId: 'so-1',
          requirementKind: 'PHYSICAL_RESOURCE',
          resourceTypeCode: 'TRUCK',
          laborTypeCode: null,
          plannedQuantity: '1',
          operationalStart: null,
          operationalEnd: null,
          notes: null,
          status: 'PLANNED',
          rowVersion: 1,
        },
      ],
      serviceSnapshot: {
        serviceCode: 'SVC',
        serviceName: 'Serviço',
        measurementModel: { mode: 'BY_EVENT', basis: 'GLOBAL_COMPLETION', defaultUnitCode: 'SERVICE' },
        allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
        requirements: { execution: [], resources: [], labor: [] },
      },
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.plannedQuantity).toBe('1');
    expect(rows[0]?.actualQuantity).toBe('1');
    expect(rows[0]?.measuredQuantity).toBe('1');
  });
});
