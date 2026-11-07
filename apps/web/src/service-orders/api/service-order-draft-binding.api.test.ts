import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetApiBaseUrlCacheForTests } from '../../auth/api/auth-api';
import { resetTokenStoreForTests, tokenStore } from '../../auth/storage/token-store';
import { linkPublishedServiceToDraftOrder } from './service-orders-api';

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const DEFINITION_ID = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  resetTokenStoreForTests();
  tokenStore.setTokens('test-access', 'test-refresh');
});
afterEach(() => {
  vi.unstubAllGlobals();
  resetTokenStoreForTests();
  resetApiBaseUrlCacheForTests();
});

describe('DRAFT OS — contrato HTTP de PATCH de serviço publicado', () => {
  it('envia somente campos aceitos com versão otimista e token existente', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      id: ORDER_ID, status: 'DRAFT', rowVersion: 5,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const response = await linkPublishedServiceToDraftOrder(ORDER_ID, 4, DEFINITION_ID);
    expect(response.rowVersion).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/api/v1/service-orders/' + ORDER_ID);
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(String(init.body))).toEqual({ rowVersion: 4, serviceDefinitionId: DEFINITION_ID });
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-access' });
  });

  it('propaga VERSION_CONFLICT 409 sem declarar PATCH como sucesso', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      error: { code: 'SERVICE_ORDERS_VERSION_CONFLICT' },
    }), { status: 409, headers: { 'Content-Type': 'application/json' } })));
    await expect(linkPublishedServiceToDraftOrder(ORDER_ID, 4, DEFINITION_ID)).rejects.toMatchObject({
      status: 409, code: 'SERVICE_ORDERS_VERSION_CONFLICT', kind: 'version_conflict',
    });
  });
});
