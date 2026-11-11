import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listServiceDefinitions } from '../../catalog/api/service-catalog-api';
import type { ServiceDefinition } from '../../catalog/types/service-catalog.types';
import { searchPublishedServicesForLookup } from './service-order-relation-lookup';

vi.mock('../../catalog/api/service-catalog-api', () => ({
  listServiceDefinitions: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

describe('Busca de serviços elegíveis para OS DRAFT', () => {
  it('consulta lista ativa/publicada do servidor sem oferecer rascunhos nem inativos', async () => {
    vi.mocked(listServiceDefinitions).mockResolvedValue({
      items: [
        { id: 'service-active', code: 'SVC-001', name: 'Manutenção', status: 'ACTIVE', latestPublishedVersion: 2 },
        { id: 'service-draft', code: 'SVC-002', name: 'Sem publicação', status: 'ACTIVE', latestPublishedVersion: null },
        { id: 'service-inactive', code: 'SVC-003', name: 'Inativo', status: 'INACTIVE', latestPublishedVersion: 1 },
      ] as ServiceDefinition[],
      limit: 20, offset: 0, total: 3, asOf: '2026-11-07T00:00:00.000Z',
    });
    const result = await searchPublishedServicesForLookup('  manutenção  ');
    expect(listServiceDefinitions).toHaveBeenCalledWith({
      limit: 20, offset: 0, status: 'ACTIVE', versionFilter: 'HAS_PUBLISHED', search: 'manutenção',
    }, undefined);
    expect(result).toEqual([
      { id: 'service-active', label: 'Manutenção', support: 'SVC-001 · versão 2' },
    ]);
  });
});
