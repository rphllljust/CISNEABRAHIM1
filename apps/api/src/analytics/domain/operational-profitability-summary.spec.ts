import { describe, expect, it } from 'vitest';
import {
  PROFITABILITY_GROUP_BY,
  buildProfitabilitySummary,
  groupProfitabilityRows,
  resolveSupportedDimensions,
  type ProfitabilityServiceOrderRaw,
} from './operational-profitability-summary';

const BASE_ROW: ProfitabilityServiceOrderRaw = {
  serviceOrderId: 'so-1',
  serviceOrderCode: 'OS-001',
  clientId: 'client-1',
  contractReference: 'CTR-001',
  serviceType: 'TRANSPORT',
  operationalRevenue: '1000.0000',
  realizedCost: '300.0000',
  revenueLineCount: 1,
  costEntryCount: 2,
  currencyCode: 'BRL',
};

describe('operational-profitability-summary', () => {
  it('builds auditable margin summary from projected rows', () => {
    const summary = buildProfitabilitySummary([BASE_ROW], 'BRL');

    expect(summary.operationalRevenue).toBe('1000');
    expect(summary.realizedCost).toBe('300');
    expect(summary.operationalMargin).toBe('700');
    expect(summary.formula).toContain('operational_margin');
    expect(summary.disclaimer).toContain('not official accounting');
  });

  it('groups by client only when client data exists', () => {
    const groups = groupProfitabilityRows(
      [
        BASE_ROW,
        {
          ...BASE_ROW,
          serviceOrderId: 'so-2',
          clientId: null,
          operationalRevenue: '200.0000',
          realizedCost: '50.0000',
        },
      ],
      PROFITABILITY_GROUP_BY.Client,
      'BRL',
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('client-1');
    expect(groups[0]?.summary.operationalMargin).toBe('700');
  });

  it('reports supported dimensions from available data', () => {
    const supported = resolveSupportedDimensions([
      BASE_ROW,
      { ...BASE_ROW, serviceOrderId: 'so-3', contractReference: null },
    ]);

    expect(supported.serviceOrder).toBe(true);
    expect(supported.client).toBe(true);
    expect(supported.contract).toBe(true);
    expect(supported.period).toBe(true);
  });
  it('refuses to sum BRL and USD operational balances without an approved FX conversion', () => {
    const another = {
      ...BASE_ROW,
      serviceOrderId: 'so-usd',
      currencyCode: 'USD',
      operationalRevenue: '2000.0000',
      realizedCost: '900.0000',
    };
    const summary = buildProfitabilitySummary([BASE_ROW, another], 'BRL');
    expect(summary.currencyMixed).toBe(true);
    expect(summary.operationalRevenue).toBeNull();
    expect(summary.realizedCost).toBeNull();
    expect(summary.operationalMargin).toBeNull();
    expect(summary.serviceOrderCount).toBe(2);

    const groups = groupProfitabilityRows([BASE_ROW, another], PROFITABILITY_GROUP_BY.Client, 'BRL');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.supported).toBe(false);
    expect(groups[0]?.summary.currencyMixed).toBe(true);
  });

  it('preserves independent currency-homogeneous groups without converting them', () => {
    const another = {
      ...BASE_ROW,
      serviceOrderId: 'so-usd',
      clientId: 'client-usd',
      currencyCode: 'USD',
      operationalRevenue: '2000.0000',
      realizedCost: '900.0000',
    };
    const groups = groupProfitabilityRows([BASE_ROW, another], PROFITABILITY_GROUP_BY.Client, 'BRL');
    expect(groups).toHaveLength(2);
    expect(groups[0]?.supported).toBe(true);
    expect(groups[0]?.summary.currencyCode).toBe('BRL');
    expect(groups[0]?.summary.operationalMargin).toBe('700');
    expect(groups[1]?.supported).toBe(true);
    expect(groups[1]?.summary.currencyCode).toBe('USD');
    expect(groups[1]?.summary.operationalMargin).toBe('1100');
  });

  it('does not publish money for an OS whose persisted cost entries mix currencies', () => {
    const summary = buildProfitabilitySummary([
      { ...BASE_ROW, currencyAmbiguous: true, realizedCost: null },
    ], 'BRL');
    expect(summary.currencyMixed).toBe(true);
    expect(summary.operationalRevenue).toBeNull();
    expect(summary.realizedCost).toBeNull();
    expect(summary.operationalMargin).toBeNull();
  });

});
