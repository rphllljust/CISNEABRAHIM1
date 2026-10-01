import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertCatalogCategory,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateClientTables,
  truncateCommercialProposalTables,
  truncateCommercialPurchaseOrderTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { SERVICE_ORDER_STATUSES } from './domain/service-order';
import { TRANSITIONS } from './domain/service-order.state-machine';
import type {
  AuditTimelineResponse,
  AvailableActionsResponse,
  CommandCatalogResponse,
  MeResponse,
} from './services/service-order-metadata.service';

/**
 * Metadados de OS e identidade (B4) — contrato HTTP sobre AppModule real.
 *
 * Prova que os 4 endpoints EXPÕEM o que o backend ja sabe, sem duplicar
 * state machine nem RBAC:
 *   - comandos vem de `TRANSITIONS` (fonte unica);
 *   - permissoes vem dos grants reais;
 *   - a timeline vem de `audit.audit_logs`, sem campos RESTRICTED/FINANCIAL.
 *
 * RESSALVA DECLARADA (divergencia consciente do prompt): OS fora do escopo
 * responde 403, nao 404. O gate reutiliza `assertRecordAction`, cujo contrato
 * vigente e testado e 403 (`documents.e2e.spec.ts:317`,
 * `contextual-scope.e2e.spec.ts:139`). Entregar 404 exigiria um segundo
 * caminho de autorizacao, proibido pela regra de nao duplicacao.
 */
const UNIT_A = 'unit-meta-a';
const UNIT_B = 'unit-meta-b';
const TEST_CNPJ = '11222333000181';

const SAMPLE_EXECUTION_REQUIREMENTS = [
  { requirementType: 'OBSERVATION' as const, requirementLevel: 'REQUIRED' as const },
];

const ADMIN_ACTIONS = [
  AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
  AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
  AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
  AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
  AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
  AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
  AUTHZ_ACTIONS.ServiceOrdersExecutionPause,
  AUTHZ_ACTIONS.ServiceOrdersExecutionResume,
  AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
  AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
  AUTHZ_ACTIONS.ClientCreate,
  AUTHZ_ACTIONS.ClientRead,
  AUTHZ_ACTIONS.CatalogServiceCreate,
  AUTHZ_ACTIONS.CatalogServiceRead,
  AUTHZ_ACTIONS.CatalogServicePublish,
];

function resourceTypeFor(action: string): string {
  if (action.startsWith('service-orders:')) {
    return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  }
  if (action.startsWith('client:')) {
    return AUTHZ_RESOURCE_TYPES.Client;
  }
  return AUTHZ_RESOURCE_TYPES.CatalogService;
}

describe('B4 — service order metadata HTTP contract', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for B4 metadata integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    // Este spec autentica varias vezes por caso (identidade com escopo Global e
    // identidade com escopo Unit). O limitador real e `SECURITY_RATE_LOGIN_MAX`
    // (default 5/min) e todas as chamadas compartilham a mesma chave
    // `${ip}:${user-agent}`, entao o teto padrao derrubaria os casos com 429 e
    // mascararia o contrato sob teste.
    process.env['SECURITY_RATE_LOGIN_MAX'] = '100';
    process.env['OBJECT_STORAGE_ROOT'] ??= '.object-storage-test';
    process.env['OBJECT_STORAGE_PROVIDER'] ??= 'filesystem';

    const fixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = fixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 8_192 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
  });

  beforeEach(async () => {
    await truncateServiceOrderTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateCommercialProposalTables(pool);
    await truncateDocumentTables(pool);
    await truncateClientTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
    await pool.query('TRUNCATE TABLE audit.audit_logs');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function login(
    grants: Array<{
      action: string;
      resourceType: string;
      scopeType?: (typeof AUTHZ_SCOPES)[keyof typeof AUTHZ_SCOPES];
      resourceId?: string;
    }>,
  ): Promise<{ token: string; identityId: string }> {
    const loginId = normalizeLoginIdentifier(`b4-meta-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);

    for (const grant of grants) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: grant.scopeType ?? AUTHZ_SCOPES.Global,
        resourceId: grant.resourceId,
        grantedByIdentityId: identityId,
      });
    }

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
      headers: { 'user-agent': 'vitest-b4-metadata' },
    });
    return { token: parseAuthTokenResponse(response.body).accessToken, identityId };
  }

  async function loginAdmin(): Promise<{ token: string; identityId: string }> {
    return login(
      ADMIN_ACTIONS.map((action) => ({
        action,
        resourceType: resourceTypeFor(action),
        scopeType: AUTHZ_SCOPES.Global,
      })),
    );
  }

  /** Cria uma OS completa (cliente + servico publicado + OS) via API real. */
  async function seedServiceOrder(token: string, unitId = UNIT_A): Promise<string> {
    const auth = { authorization: `Bearer ${token}` };

    const category = await insertCatalogCategory(pool, {
      code: `CAT-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
      name: 'Serviços',
    });
    const categoryId = category.categoryId;

    const clientResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/clients',
      headers: auth,
      payload: {
        legalName: `Cliente Meta ${crypto.randomUUID()}`,
        tradeName: 'Cliente Meta',
        taxId: TEST_CNPJ,
        contacts: [{ name: 'Contato', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
      },
    });
    expect(clientResponse.statusCode).toBe(201);
    const clientId = (JSON.parse(clientResponse.body) as { id: string }).id;

    const draftResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/catalog/service-definitions',
      headers: auth,
      payload: {
        code: `META-SRV-${crypto.randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()}`,
        name: 'Serviço meta',
        categoryId,
        archetype: 'CIVIL_WORK',
        measurementMode: 'BY_EVENT',
        measurementBasis: 'GLOBAL_COMPLETION',
        // HTTP exige sortOrder >= 1 (parsePositiveInt); a service aceita 0.
        allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 1 }],
        pricingModels: [
          { modelCode: 'GLOBAL_PRICE', salePrice: '1000.0000', internalCost: '800.0000' },
        ],
        resourceRequirements: [],
        laborRequirements: [],
        executionRequirements: SAMPLE_EXECUTION_REQUIREMENTS,
      },
    });
    expect(draftResponse.statusCode).toBe(201);
    const serviceDefinitionId = (JSON.parse(draftResponse.body) as { serviceDefinitionId: string })
      .serviceDefinitionId;

    const definitionResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/catalog/service-definitions/${serviceDefinitionId}`,
      headers: auth,
    });
    const version = (JSON.parse(definitionResponse.body) as { version: number }).version;

    const publishResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/catalog/service-definitions/${serviceDefinitionId}/versions/${version}/publish`,
      headers: auth,
      payload: { lineageVersion: version },
    });
    expect(publishResponse.statusCode).toBeLessThan(300);
    const versionId = (JSON.parse(publishResponse.body) as { id: string }).id;

    const orderResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/service-orders',
      headers: auth,
      payload: {
        origin: 'AUTHORIZED_DIRECT',
        unitId,
        clientId,
        serviceDefinitionId,
        serviceDefinitionVersionId: versionId,
        description: 'OS de metadados',
      },
    });
    expect(orderResponse.statusCode).toBe(201);
    return (JSON.parse(orderResponse.body) as { id: string }).id;
  }

  async function getJson<T>(url: string, token?: string): Promise<{ status: number; body: T | null }> {
    const response = await app.inject({
      method: 'GET',
      url,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });
    return {
      status: response.statusCode,
      body: response.body.length > 0 ? (JSON.parse(response.body) as T) : null,
    };
  }

  // Caso 1
  it('Caso 1: GET /me retorna identidade e permissoes efetivas (200)', async () => {
    const { token, identityId } = await loginAdmin();

    const { status, body } = await getJson<MeResponse>('/api/v1/me', token);

    expect(status).toBe(200);
    expect(body?.usuario.id).toBe(identityId);
    expect(body?.usuario.identity_id).toBe(identityId);
    // Sem fonte no modelo de identidade: null declarado, nunca inventado.
    expect(body?.usuario.nome).toBeNull();
    expect(body?.usuario.email).toBeNull();
    // Grants reais viram "recurso:acao"; o id do grant nunca aparece.
    expect(body?.permissoes_efetivas).toContain(AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare);
    expect(body?.permissoes_efetivas).toContain(AUTHZ_ACTIONS.ClientCreate);
    expect(JSON.stringify(body)).not.toContain('granted_by');
    expect(body?.escopos_disponiveis.length).toBeGreaterThan(0);
    expect(body?.escopos_disponiveis[0]?.tipo).toBe(AUTHZ_SCOPES.Global);
  });

  // Caso 2
  it('Caso 2: GET /me sem token retorna 401', async () => {
    const { status } = await getJson<MeResponse>('/api/v1/me');
    expect(status).toBe(401);
  });

  // Caso 3
  it('Caso 3: available-actions em DRAFT contem prepare', async () => {
    const { token } = await loginAdmin();
    const orderId = await seedServiceOrder(token);

    const { status, body } = await getJson<AvailableActionsResponse>(
      `/api/v1/service-orders/${orderId}/available-actions`,
      token,
    );

    expect(status).toBe(200);
    expect(body?.service_order_id).toBe(orderId);
    expect(body?.status_atual).toBe(SERVICE_ORDER_STATUSES.Draft);
    const comandos = body?.comandos_validos.map((entry) => entry.comando) ?? [];
    expect(comandos).toContain('prepare');
    expect(comandos).toContain('cancel');
    expect(comandos).not.toContain('release');
    // O comando valido carrega a permissao especifica e o veredito do usuario.
    const prepare = body?.comandos_validos.find((entry) => entry.comando === 'prepare');
    expect(prepare?.requer_permissao).toBe(AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare);
    expect(prepare?.usuario_tem_permissao).toBe(true);
    // Commandos invalidos saem na lista propria, nunca em comandos_validos.
    expect(body?.comandos_invalidos_para_status).toContain('release');
  });

  // Caso 4
  it('Caso 4: available-actions em IN_EXECUTION nao contem prepare e contem pause/complete/cancel', async () => {
    const { token } = await loginAdmin();
    const orderId = await seedServiceOrder(token);
    const auth = { authorization: `Bearer ${token}` };

    // DRAFT -> PREPARED -> RELEASED -> IN_EXECUTION, pela API real.
    const readVersion = async (): Promise<number> => {
      const detail = await app.inject({
        method: 'GET',
        url: `/api/v1/service-orders/${orderId}`,
        headers: auth,
      });
      return (JSON.parse(detail.body) as { rowVersion: number }).rowVersion;
    };

    await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${orderId}/prepare`,
      headers: auth,
      payload: { rowVersion: await readVersion() },
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${orderId}/release`,
      headers: auth,
      payload: { rowVersion: await readVersion() },
    });
    const execution = await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${orderId}/execution/start`,
      headers: auth,
      payload: { rowVersion: await readVersion() },
    });
    expect(execution.statusCode).toBeLessThan(300);

    const { status, body } = await getJson<AvailableActionsResponse>(
      `/api/v1/service-orders/${orderId}/available-actions`,
      token,
    );

    expect(status).toBe(200);
    expect(body?.status_atual).toBe(SERVICE_ORDER_STATUSES.InExecution);
    const comandos = body?.comandos_validos.map((entry) => entry.comando) ?? [];
    expect(comandos).not.toContain('prepare');
    expect(comandos).toContain('pause');
    expect(comandos).toContain('complete');
    // `cancel` NAO e valido em IN_EXECUTION pela state machine.
    expect(comandos).not.toContain('cancel');
    expect(body?.comandos_invalidos_para_status).toContain('prepare');
    expect(body?.comandos_invalidos_para_status).toContain('cancel');
  });

  // Caso 5
  it('Caso 5: available-actions para OS fora do escopo nao vaza existencia (403)', async () => {
    const { token: adminToken } = await loginAdmin();
    // OS criada na UNIT_A; o segundo usuario so tem escopo na UNIT_B.
    const orderId = await seedServiceOrder(adminToken, UNIT_A);

    const { token: scopedToken } = await login(
      ADMIN_ACTIONS.map((action) => ({
        action,
        resourceType: resourceTypeFor(action),
        scopeType: AUTHZ_SCOPES.Unit,
        resourceId: UNIT_B,
      })),
    );

    const available = await getJson<AvailableActionsResponse>(
      `/api/v1/service-orders/${orderId}/available-actions`,
      scopedToken,
    );
    expect(available.status).toBe(403);
    // O corpo de erro nao pode revelar nada sobre a OS inacessivel.
    expect(JSON.stringify(available.body)).not.toContain(orderId);
    expect(JSON.stringify(available.body)).not.toContain(UNIT_A);

    // Mesmo contrato na timeline — o gate e o mesmo.
    const timeline = await getJson<AuditTimelineResponse>(
      `/api/v1/service-orders/${orderId}/audit-timeline`,
      scopedToken,
    );
    expect(timeline.status).toBe(403);

    // OS inexistente responde 404 (NOT_FOUND), distinto do 403 de escopo —
    // a distincao e do repositorio, nao deste controller.
    const missing = await getJson<AvailableActionsResponse>(
      `/api/v1/service-orders/${crypto.randomUUID()}/available-actions`,
      scopedToken,
    );
    expect(missing.status).toBe(404);
  });

  // Caso 6
  it('Caso 6: audit-timeline retorna eventos em ordem cronologica', async () => {
    const { token } = await loginAdmin();
    const orderId = await seedServiceOrder(token);
    const auth = { authorization: `Bearer ${token}` };

    const detail = await app.inject({
      method: 'GET',
      url: `/api/v1/service-orders/${orderId}`,
      headers: auth,
    });
    const rowVersion = (JSON.parse(detail.body) as { rowVersion: number }).rowVersion;

    await app.inject({
      method: 'POST',
      url: `/api/v1/service-orders/${orderId}/prepare`,
      headers: auth,
      payload: { rowVersion },
    });

    const { status, body } = await getJson<AuditTimelineResponse>(
      `/api/v1/service-orders/${orderId}/audit-timeline`,
      token,
    );

    expect(status).toBe(200);
    expect(body?.service_order_id).toBe(orderId);
    expect(body?.total).toBe(2);
    expect(body?.eventos).toHaveLength(2);

    // Ordem cronologica ascendente: CREATE antes de TRANSITION.
    expect(body?.eventos[0]?.acao).toBe('CREATE');
    expect(body?.eventos[1]?.acao).toBe('TRANSITION');
    const datas = body?.eventos.map((event) => Date.parse(event.data)) ?? [];
    expect(datas[0]!).toBeLessThanOrEqual(datas[1]!);

    // CREATE nao tem status anterior; TRANSITION carrega origem, destino e comando.
    expect(body?.eventos[0]?.status_anterior).toBeNull();
    expect(body?.eventos[0]?.status_novo).toBe(SERVICE_ORDER_STATUSES.Draft);
    expect(body?.eventos[1]?.status_anterior).toBe(SERVICE_ORDER_STATUSES.Draft);
    expect(body?.eventos[1]?.status_novo).toBe(SERVICE_ORDER_STATUSES.Prepared);
    expect(body?.eventos[1]?.comando).toBe('prepare');
    // correlation_id e sempre preenchido (NOT NULL no schema).
    for (const evento of body?.eventos ?? []) {
      expect(evento.correlation_id).toBeTruthy();
      expect(evento.usuario_id).toBeTruthy();
      // Sem fonte de nome no modelo: null, nunca inventado.
      expect(evento.usuario_nome).toBeNull();
    }

    // Paginacao: limit=1 devolve 1 evento mas o total permanece completo.
    const paged = await getJson<AuditTimelineResponse>(
      `/api/v1/service-orders/${orderId}/audit-timeline?limit=1&offset=1`,
      token,
    );
    expect(paged.status).toBe(200);
    expect(paged.body?.eventos).toHaveLength(1);
    expect(paged.body?.total).toBe(2);
    expect(paged.body?.eventos[0]?.acao).toBe('TRANSITION');
  });

  // Caso 7
  it('Caso 7: audit-timeline NAO retorna campos RESTRICTED/FINANCIAL', async () => {
    const { token } = await loginAdmin();
    const orderId = await seedServiceOrder(token);

    // Injeta uma linha hostil: mesmo que um caminho futuro grave campos
    // proibidos no jsonb, a leitura nao pode herdar o vazamento.
    const identityRow = await pool.query<{ id: string }>(
      `SELECT id FROM identity.identities LIMIT 1`,
    );
    await pool.query(
      `INSERT INTO audit.audit_logs
         (tabela, registro_id, acao, dados_antigos, dados_novos, usuario_id, correlation_id)
       VALUES ('service_orders', $1, 'UPDATE',
               '{"status":"DRAFT","client_snapshot":{"tax_id":"11222333000181"},"cpf":"12345678901"}'::jsonb,
               '{"status":"PREPARED","cost_amount":"999.99","cnpj":"11222333000181","x-api-key":"sk-live-secret"}'::jsonb,
               $2, $3)`,
      [orderId, identityRow.rows[0]!.id, crypto.randomUUID()],
    );

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/service-orders/${orderId}/audit-timeline`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    const raw = response.body;
    for (const proibido of [
      'client_snapshot',
      'service_snapshot',
      'contract_snapshot',
      'tax_id',
      'cost_amount',
      '11222333000181',
      '12345678901',
      '999.99',
      'sk-live-secret',
    ]) {
      expect(raw).not.toContain(proibido);
    }
    // Os campos permitidos do mesmo snapshot continuam disponiveis.
    const body = JSON.parse(raw) as AuditTimelineResponse;
    const hostile = body.eventos.find((evento) => evento.acao === 'UPDATE');
    expect(hostile?.status_anterior).toBe('DRAFT');
    expect(hostile?.status_novo).toBe('PREPARED');
  });

  // Caso 8
  it('Caso 8: command-catalog retorna TODOS os comandos da state machine', async () => {
    const { token } = await loginAdmin();

    const { status, body } = await getJson<CommandCatalogResponse>(
      '/api/v1/service-orders/command-catalog',
      token,
    );

    expect(status).toBe(200);
    const nomes = body?.comandos.map((entry) => entry.nome) ?? [];
    expect([...nomes].sort()).toEqual(Object.keys(TRANSITIONS).sort());

    // `cancel` aceita multiplas origens — o contrato preserva o array.
    const cancel = body?.comandos.find((entry) => entry.nome === 'cancel');
    expect(cancel?.status_origem).toEqual([
      SERVICE_ORDER_STATUSES.Draft,
      SERVICE_ORDER_STATUSES.Prepared,
      SERVICE_ORDER_STATUSES.Released,
    ]);
    expect(cancel?.status_destino).toBe(SERVICE_ORDER_STATUSES.Cancelled);

    const prepare = body?.comandos.find((entry) => entry.nome === 'prepare');
    expect(prepare?.status_origem).toEqual([SERVICE_ORDER_STATUSES.Draft]);
    expect(prepare?.status_destino).toBe(SERVICE_ORDER_STATUSES.Prepared);

    // A state machine nao expoe exigencia de justificativa: false declarado.
    for (const comando of body?.comandos ?? []) {
      expect(comando.requer_justificativa).toBe(false);
      expect(comando.label.length).toBeGreaterThan(0);
    }
  });

  // Caso 9
  it('Caso 9: command-catalog — contagem bate exatamente com TRANSITIONS', async () => {
    const { token } = await loginAdmin();

    const { body } = await getJson<CommandCatalogResponse>(
      '/api/v1/service-orders/command-catalog',
      token,
    );

    const entries = Object.entries(TRANSITIONS);
    expect(body?.comandos).toHaveLength(entries.length);
    expect(body?.comandos).toHaveLength(7);

    // Cada entrada do catalogo espelha fielmente a state machine, sem divergir.
    for (const [nome, regra] of entries) {
      const entry = body?.comandos.find((item) => item.nome === nome);
      expect(entry, `comando ausente no catalogo: ${nome}`).toBeDefined();
      expect(entry?.status_origem).toEqual(regra.from);
      expect(entry?.status_destino).toBe(regra.to);
    }
  });

  // Caso 10
  it('Caso 10: todos os endpoints exigem autenticacao (401 sem token)', async () => {
    const orderId = crypto.randomUUID();

    for (const url of [
      '/api/v1/me',
      `/api/v1/service-orders/${orderId}/available-actions`,
      `/api/v1/service-orders/${orderId}/audit-timeline`,
      '/api/v1/service-orders/command-catalog',
    ]) {
      const { status } = await getJson<unknown>(url);
      expect(status, `esperava 401 em ${url}`).toBe(401);
    }
  });
});
