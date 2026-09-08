import { describe, expect, it } from 'vitest';
import { REPORT_TYPES, reportExportMode } from './report-type';

describe('REPORT execution modes (LIVE vs FROZEN_SNAPSHOT)', () => {
  it('FinancialAging declara EXPORT = FROZEN_SNAPSHOT; demais EXPORT = LIVE', () => {
    expect(reportExportMode(REPORT_TYPES.FinancialAging)).toBe('EXPORT = FROZEN_SNAPSHOT');
    expect(reportExportMode(REPORT_TYPES.ServiceOrdersByPeriod)).toBe('EXPORT = LIVE');
    expect(reportExportMode(REPORT_TYPES.Billing)).toBe('EXPORT = LIVE');
    expect(reportExportMode(REPORT_TYPES.Measurements)).toBe('EXPORT = LIVE');
  });
});
