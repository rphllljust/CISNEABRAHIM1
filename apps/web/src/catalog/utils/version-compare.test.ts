import { describe, expect, it } from 'vitest';
import { compareServiceDefinitionVersions } from './version-compare';
import type { ServiceDefinitionVersion } from '../types/service-catalog.types';

function version(partial: Partial<ServiceDefinitionVersion>): ServiceDefinitionVersion {
  return {
    id: 'v-id',
    serviceDefinitionId: 'def-id',
    code: 'SVC-TEST',
    version: 1,
    status: 'DRAFT',
    categoryId: 'cat-id',
    categoryCode: 'CAT',
    categoryName: 'Categoria',
    archetype: 'RENTAL',
    name: 'Test',
    description: null,
    defaultUnitCode: 'DAY',
    measurementMode: 'BY_PERIOD',
    measurementBasis: 'TIME',
    billingEntitlementPolicy: 'MEASUREMENT_APPROVED',
    requiresPurchaseOrder: false,
    allowedUnits: [{ unitCode: 'DAY', isDefault: true, sortOrder: 0 }],
    resourceRequirements: [],
    laborRequirements: [],
    pricingModels: [
      {
        modelCode: 'DAILY',
        unitCode: 'DAY',
        salePrice: '100.00',
        internalCost: '80.00',
        currencyCode: 'BRL',
        sortOrder: 0,
      },
    ],
    executionRequirements: [],
    publishedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

describe('compareServiceDefinitionVersions', () => {
  it('reports field differences between versions', () => {
    const left = version({ version: 1, name: 'Versão 1' });
    const right = version({ version: 2, name: 'Versão 2', measurementBasis: 'UNIT' });

    const diffs = compareServiceDefinitionVersions(left, right);
    expect(diffs.some((diff) => diff.field === 'Nome')).toBe(true);
    expect(diffs.some((diff) => diff.field === 'Base de medição')).toBe(true);
  });

  it('returns empty diff list for identical snapshots', () => {
    const left = version({ version: 1 });
    const right = version({ version: 2 });
    expect(compareServiceDefinitionVersions(left, right)).toHaveLength(0);
  });
});
