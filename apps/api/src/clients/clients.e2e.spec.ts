import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateClientTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { CONTACT_PURPOSES } from './domain/client-status';
import { CLIENT_ERROR_CODES } from './errors/client-error-codes';

function parseClientError(body: string): { error: { code: string } } {
  return JSON.parse(body) as { error: { code: string } };
}

describe('Clients E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for clients E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 8_192 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  /**
   * O limitador de login da plataforma usa a chave `${ip}:${user-agent}`
   * (`auth.controller.ts`) em baldes EM MEMÓRIA por processo, compartilhados por todo o arquivo de
   * teste. Reusar um único user-agent faz o sexto login do arquivo ser recusado por limite, o que
   * apareceria como falha de autenticação sem relação com o que se está testando. Cada login
   * declara um cliente distinto, como fariam clientes reais.
   */
  async function loginWithClientGrants(): Promise<{ accessToken: string; identityId: string }> {
    const loginId = normalizeLoginIdentifier(`clients-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);

    for (const action of [
      AUTHZ_ACTIONS.ClientCreate,
      AUTHZ_ACTIONS.ClientRead,
      AUTHZ_ACTIONS.ClientList,
      AUTHZ_ACTIONS.ClientUpdate,
      AUTHZ_ACTIONS.ClientDeactivate,
      AUTHZ_ACTIONS.ClientActivate,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.Client,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': `vitest-clients-e2e/${crypto.randomUUID()}` },
    });
    const body = parseAuthTokenResponse(response.body);
    return { accessToken: body.accessToken, identityId };
  }

  it('denies anonymous access and supports full client lifecycle via HTTP', async () => {
    const anonymous = await app.inject({ method: 'GET', url: '/api/v1/clients' });
    expect(anonymous.statusCode).toBe(401);

    const { accessToken } = await loginWithClientGrants();

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        legalName: 'Cliente E2E LTDA',
        taxId: '11.222.333/0001-81',
        contacts: [
          {
            name: 'Operações',
            purpose: CONTACT_PURPOSES.Operational,
            email: 'e2e@client.invalid',
          },
        ],
      },
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as { id: string; version: number; taxId: string };
    expect(created.taxId).toBe('11222333000181');

    const getResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${created.id}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(getResponse.statusCode).toBe(200);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?limit=10&offset=0',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResponse.statusCode).toBe(200);
    const listBody = JSON.parse(listResponse.body) as { items: unknown[] };
    expect(listBody.items.length).toBeGreaterThan(0);

    const deactivateResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/clients/${created.id}/deactivate`,
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { version: created.version, reason: 'Teste E2E' },
    });
    expect(deactivateResponse.statusCode).toBe(200);
  });

  it('returns not found for unknown client without leaking existence to unauthorized user', async () => {
    const { accessToken } = await loginWithClientGrants();
    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/clients/${crypto.randomUUID()}`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(denied.statusCode).toBe(404);
    const body = parseClientError(denied.body);
    expect(body.error.code).toBe(CLIENT_ERROR_CODES.NOT_FOUND);
  });

  type ClientListBody = {
    items: Array<{
      id: string;
      legalName: string;
      tradeName: string | null;
      taxId: string;
      status: string;
    }>;
    limit: number;
    offset: number;
    total: number;
    totalPages: number;
  };

  async function seedClientsViaHttp(accessToken: string): Promise<void> {
    // CNPJs sintéticos: nunca o da operadora, que por BR-032 não é Cliente.
    const payloads = [
      { legalName: 'Alfa Madeira LTDA', taxId: '11222333000518', city: 'Porto Velho' },
      { legalName: 'Beta Logistica LTDA', taxId: '11222333000262', city: 'Vilhena' },
      { legalName: 'Gama Madeira EIRELI', taxId: '11222333000343', city: 'Cacoal' },
    ];
    for (const payload of payloads) {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${accessToken}` },
        payload: {
          legalName: payload.legalName,
          taxId: payload.taxId,
          contacts: [
            {
              name: 'Operações',
              purpose: CONTACT_PURPOSES.Operational,
              email: `ops-${payload.taxId}@client.invalid`,
            },
          ],
          addresses: [{ purpose: 'operational', city: payload.city, state: 'RO' }],
        },
      });
      expect(response.statusCode).toBe(201);
    }
  }

  it('lists clients with pagination metadata and a summary projection', async () => {
    const { accessToken } = await loginWithClientGrants();
    await seedClientsViaHttp(accessToken);

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?limit=2&offset=0',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(response.statusCode).toBe(200);

    const body = JSON.parse(response.body) as ClientListBody;
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
    // Metadados de paginação vêm na MESMA requisição: a UI não precisa de uma segunda consulta.
    expect(body.total).toBe(3);
    expect(body.totalPages).toBe(2);
    expect(body.items).toHaveLength(2);

    // Ordem padrão: razão social ascendente.
    expect(body.items.map((item) => item.legalName)).toEqual([
      'Alfa Madeira LTDA',
      'Beta Logistica LTDA',
    ]);

    // A lista é projeção de identificação, não o cadastro inteiro. Endereços (inclusive a
    // localidade) permanecem no detalhe, já que nenhuma regra confirmada elege um endereço
    // representativo entre vários.
    expect(body.items[0]).not.toHaveProperty('contacts');
    expect(body.items[0]).not.toHaveProperty('addresses');
    expect(body.items[0]).not.toHaveProperty('locality');
  });

  it('searches, filters, orders and pages clients through query parameters', async () => {
    const { accessToken } = await loginWithClientGrants();
    await seedClientsViaHttp(accessToken);
    const auth = { authorization: `Bearer ${accessToken}` };

    const byName = await app.inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent('Madeira')}`,
      headers: auth,
    });
    const byNameBody = JSON.parse(byName.body) as ClientListBody;
    expect(byNameBody.total).toBe(2);
    expect(byNameBody.items.map((item) => item.legalName)).toEqual([
      'Alfa Madeira LTDA',
      'Gama Madeira EIRELI',
    ]);

    // CNPJ formatado é normalizado no servidor antes da comparação (BR-029).
    const byDocument = await app.inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent('11.222.333/0002-62')}`,
      headers: auth,
    });
    const byDocumentBody = JSON.parse(byDocument.body) as ClientListBody;
    expect(byDocumentBody.items.map((item) => item.legalName)).toEqual(['Beta Logistica LTDA']);

    // Prefixo parcial de CNPJ: identificação por documento incompleto.
    const byPrefix = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?q=112223330003',
      headers: auth,
    });
    expect((JSON.parse(byPrefix.body) as ClientListBody).items.map((i) => i.legalName)).toEqual([
      'Gama Madeira EIRELI',
    ]);

    const descending = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?sort=legalName&direction=desc',
      headers: auth,
    });
    expect((JSON.parse(descending.body) as ClientListBody).items.map((i) => i.legalName)).toEqual([
      'Gama Madeira EIRELI',
      'Beta Logistica LTDA',
      'Alfa Madeira LTDA',
    ]);

    const secondPage = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?limit=2&offset=2',
      headers: auth,
    });
    const secondPageBody = JSON.parse(secondPage.body) as ClientListBody;
    expect(secondPageBody.items.map((item) => item.legalName)).toEqual(['Gama Madeira EIRELI']);
    expect(secondPageBody.total).toBe(3);

    // Busca sem resultado é distinguível de cadastro vazio: total 0 com Clientes existentes.
    const noResults = await app.inject({
      method: 'GET',
      url: `/api/v1/clients?q=${encodeURIComponent('Zinco Inexistente')}`,
      headers: auth,
    });
    const noResultsBody = JSON.parse(noResults.body) as ClientListBody;
    expect(noResultsBody.items).toEqual([]);
    expect(noResultsBody.total).toBe(0);

    const all = await app.inject({ method: 'GET', url: '/api/v1/clients', headers: auth });
    expect((JSON.parse(all.body) as ClientListBody).total).toBe(3);
  });

  it('rejects invalid list query parameters instead of silently ignoring them', async () => {
    const { accessToken } = await loginWithClientGrants();
    await seedClientsViaHttp(accessToken);
    const auth = { authorization: `Bearer ${accessToken}` };

    // Um filtro inválido ignorado em silêncio faria a UI exibir o cadastro inteiro como se o
    // filtro tivesse sido aplicado.
    for (const query of [
      'sort=createdAt',
      'sort=legalName%3B%20DROP%20TABLE%20pty.clients',
      'direction=sideways',
      'status=SUSPENDED',
      'purchaseOrderRequirement=WHENEVER',
      'limit=0',
      'limit=101',
      'offset=-1',
      'q=a',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/clients?${query}`,
        headers: auth,
      });
      expect(response.statusCode, `query ${query}`).toBe(400);
      expect(parseClientError(response.body).error.code).toBe(
        CLIENT_ERROR_CODES.VALIDATION_FAILED,
      );
    }

    // O banco continua íntegro e listável após as tentativas acima.
    const after = await app.inject({ method: 'GET', url: '/api/v1/clients', headers: auth });
    expect(after.statusCode).toBe(200);
    expect((JSON.parse(after.body) as ClientListBody).total).toBe(3);
  });

  it('denies listing to an identity without the client list capability', async () => {
    const { accessToken } = await loginWithClientGrants();
    await seedClientsViaHttp(accessToken);

    const outsiderLogin = normalizeLoginIdentifier(
      `clients-outsider-${crypto.randomUUID()}@cisne.invalid`,
    );
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    await insertIdentity(pool, outsiderLogin, passwordHash);

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: outsiderLogin, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': `vitest-clients-outsider/${crypto.randomUUID()}` },
    });
    const outsiderToken = parseAuthTokenResponse(loginResponse.body).accessToken;

    const denied = await app.inject({
      method: 'GET',
      url: '/api/v1/clients',
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(parseClientError(denied.body).error.code).toBe(CLIENT_ERROR_CODES.DENIED);

    // Nem com um termo de busca que casaria com Clientes existentes.
    const deniedWithSearch = await app.inject({
      method: 'GET',
      url: '/api/v1/clients?q=Madeira',
      headers: { authorization: `Bearer ${outsiderToken}` },
    });
    expect(deniedWithSearch.statusCode).toBe(403);
  });
});
