import { describe, expect, it } from 'vitest';
import {
  REPORT_TYPES,
  ReportFilterValidationError,
  validateAndResolveReportFilters,
} from './report-type';

describe('REPORT FILTER CONTRACT (allowlist antes do SQL)', () => {
  it('aceita filtros válidos por tipo', () => {
    const out = validateAndResolveReportFilters(REPORT_TYPES.ServiceOrdersByPeriod, {
      unitId: 'unit-a',
      from: '2026-09-01',
      to: '2026-09-30',
      status: 'COMPLETED',
    });
    expect(out.unitId).toBe('unit-a');
    expect(out.from).toBe('2026-09-01');
  });

  it('rejeita filtro fora da allowlist (ex.: serviceDefinitionId não declarado)', () => {
    expect(() =>
      validateAndResolveReportFilters(REPORT_TYPES.AssetUtilization, { unitId: 'u', clientId: 'x' }),
    ).toThrow(ReportFilterValidationError);
  });

  it('FinancialAging não aceita filtro (não ignora silenciosamente)', () => {
    expect(() =>
      validateAndResolveReportFilters(REPORT_TYPES.FinancialAging, { unitId: 'u' }),
    ).toThrow(ReportFilterValidationError);
  });

  it('exige par from/to, formato ISO e ordem correta (anti SQL injection)', () => {
    const type = REPORT_TYPES.Billing;
    expect(() => validateAndResolveReportFilters(type, { from: '2026-09-01' })).toThrow(
      ReportFilterValidationError,
    );
    expect(() => validateAndResolveReportFilters(type, { from: '2026-09-30', to: '2026-09-01' })).toThrow(
      ReportFilterValidationError,
    );
    expect(() =>
      validateAndResolveReportFilters(type, { from: "2026-01-01') OR 1=1 --", to: '2026-02-01' }),
    ).toThrow(ReportFilterValidationError);
  });

  it('period válido em tipo temporal vira from/to (sem no-op)', () => {
    const out = validateAndResolveReportFilters(REPORT_TYPES.ServiceOrdersByPeriod, { period: 'month' });
    expect(out.from).toBeDefined();
    expect(out.to).toBeDefined();
    expect(out.period).toBeUndefined();
  });

  it('rejeita period em tipo não temporal', () => {
    expect(() =>
      validateAndResolveReportFilters(REPORT_TYPES.ServiceOrdersOverdue, { period: 'month' }),
    ).toThrow(ReportFilterValidationError);
  });
});
