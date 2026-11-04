import {
  ensureOperationalLaborTypesBaseline,
  ensurePhysicalResourceTypesBaseline,
  ensureUnitsOfMeasureBaseline,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateCatalogTables,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
  truncatePhysicalAssetTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../app.module';
import { configureApiTestApp } from '../infrastructure/http/configure-api-test-app';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { parseAuthTokenResponse } from '../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DocumentsAccessService } from '../documents/services/documents-access.service';
import { DOCUMENT_CATEGORIES } from '../documents/domain/document-categories';
import { minimalPdfBuffer } from '../documents/domain/file-validation';

const UNIT_A = 'e05-e06-http-a';
const UNIT_B = 'e05-e06-http-b';

type TestActor = { accessToken: string; identityId: string };
type ActorOptions = {
  assetRead?: boolean;
  assetUpdate?: boolean;
  documentRead?: boolean;
};

describe('E05/E06 GED ↔ Ativos/Frota HTTP E2E (synthetic isolated DB)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let storageRoot: string;
  let documents: DocumentsAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) throw new Error('TEST_DATABASE_URL is required for GED asset E2E');
    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-ged-assets-http-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';
    const module = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = module.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: 8_192 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    documents = app.get(DocumentsAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateDocumentTables(pool);
    await truncatePhysicalAssetTables(pool);
    await truncateCatalogTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await ensureUnitsOfMeasureBaseline(pool);
    await ensurePhysicalResourceTypesBaseline(pool);
    await ensureOperationalLaborTypesBaseline(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function login(options: ActorOptions = {}): Promise<TestActor> {
    const loginId = normalizeLoginIdentifier(`ged-asset-http-${crypto.randomUUID()}@cisne.invalid`);
    const { identityId } = await insertIdentity(
      pool, loginId, await hashPassword(AUTH_TEST_PASSWORD),
    );
    const assetActions = [
      AUTHZ_ACTIONS.ResourcesAssetCreate,
      AUTHZ_ACTIONS.ResourcesAssetList,
      ...(options.assetRead === false ? [] : [AUTHZ_ACTIONS.ResourcesAssetRead]),
      ...(options.assetUpdate === false ? [] : [AUTHZ_ACTIONS.ResourcesAssetUpdate]),
    ];
    const documentActions = [
      AUTHZ_ACTIONS.DocumentsDocumentCreate,
      AUTHZ_ACTIONS.DocumentsDocumentList,
      AUTHZ_ACTIONS.DocumentsDocumentUploadVersion,
      ...(options.documentRead === false ? [] : [AUTHZ_ACTIONS.DocumentsDocumentRead]),
    ];
    for (const action of assetActions) {
      await insertGrant(pool, {
        identityId, grantedByIdentityId: identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.ResourcesAsset,
        scopeType: AUTHZ_SCOPES.Global,
      });
    }
    for (const action of documentActions) {
      await insertGrant(pool, {
        identityId, grantedByIdentityId: identityId, action,
        resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
        scopeType: AUTHZ_SCOPES.Global,
      });
    }
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'user-agent': `ged-asset-http-${crypto.randomUUID()}` },
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    const token = parseAuthTokenResponse(response.body);
    return { accessToken: token.accessToken, identityId };
  }

  async function makeAsset(a: TestActor) {
    const resourceType = await pool.query<{ id: string }>(
      "SELECT id FROM cat.physical_resource_types WHERE code = 'TRUCK' LIMIT 1",
    );
    const resourceTypeId = resourceType.rows[0]?.id;
    if (!resourceTypeId) throw new Error('TRUCK type missing');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/resources/physical-assets',
      headers: { authorization: `Bearer ${a.accessToken}` },
      payload: {
        assetCode: `TEST-${crypto.randomUUID().slice(0,8)}`,
        resourceTypeId,
        name: 'Caminhão de teste E05-E06',
        unitId: UNIT_A,
        vehicle: { plate: 'E2E-1A23', chassis: 'CH-E05-001', model: 'Caminhão de teste' },
      },
    });
    expect(res.statusCode).toBe(201);
    return (JSON.parse(res.body) as { id: string }).id;
  }

  async function makeDocument(a: TestActor, unitId: string) {
    const created = await documents.createWithUpload(
      { identityId: a.identityId, sessionId: 'synthetic-e2e' },
      {
        title: 'CRLV sintético para vínculo autorizado',
        categoryCode: DOCUMENT_CATEGORIES.General,
        classificationCode: 'INTERNAL',
        unitId,
      },
      { buffer: minimalPdfBuffer(), filename: 'crlv-test.pdf', mimetype: 'application/pdf' },
    );
    return created.document.id;
  }

  function endpoint(assetId: string) {
    return `/api/v1/resources/physical-assets/${assetId}/documents`;
  }

  it('requires JWT and performs an idempotent authorized HTTP attach and list', async () => {
    const anonymous = await app.inject({
      method: 'GET', url: endpoint('11111111-1111-4111-8111-111111111111'),
    });
    expect(anonymous.statusCode).toBe(401);

    const owner = await login();
    const assetId = await makeAsset(owner);
    const documentId = await makeDocument(owner, UNIT_A);
    const headers = { authorization: `Bearer ${owner.accessToken}` };
    const before = await app.inject({ method: 'GET', url: endpoint(assetId), headers });
    expect(before.statusCode).toBe(200);
    expect(JSON.parse(before.body)).toEqual({ items: [], scope: 'RECENT_WINDOW' });

    const first = await app.inject({
      method: 'POST', url: endpoint(assetId), headers, payload: { documentId },
    });
    expect(first.statusCode).toBe(200);
    expect((JSON.parse(first.body) as { attached: boolean }).attached).toBe(true);
    const repeated = await app.inject({
      method: 'POST', url: endpoint(assetId), headers, payload: { documentId },
    });
    expect(repeated.statusCode).toBe(200);
    expect((JSON.parse(repeated.body) as { attached: boolean }).attached).toBe(false);

    const listed = await app.inject({ method: 'GET', url: endpoint(assetId), headers });
    expect(listed.statusCode).toBe(200);
    const response = JSON.parse(listed.body) as {
      items: Array<{ id: string; currentVersionNumber: number }>;
      scope: string;
    };
    expect(response.items.map((doc) => doc.id)).toEqual([documentId]);
    expect(response.items[0]?.currentVersionNumber).toBe(1);
    expect(listed.body).not.toContain('storageKey');
  });

  it('rejects cross-unit links and does not expose denied GED metadata', async () => {
    const owner = await login();
    const assetId = await makeAsset(owner);
    const otherUnitDocument = await makeDocument(owner, UNIT_B);
    const headers = { authorization: `Bearer ${owner.accessToken}` };
    const denied = await app.inject({
      method: 'POST', url: endpoint(assetId), headers,
      payload: { documentId: otherUnitDocument },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.body).not.toContain(otherUnitDocument);

    const allowedDocument = await makeDocument(owner, UNIT_A);
    const allowed = await app.inject({
      method: 'POST', url: endpoint(assetId), headers,
      payload: { documentId: allowedDocument },
    });
    expect(allowed.statusCode).toBe(200);

    const viewer = await login({ documentRead: false });
    const listed = await app.inject({
      method: 'GET', url: endpoint(assetId),
      headers: { authorization: `Bearer ${viewer.accessToken}` },
    });
    expect(listed.statusCode).toBe(200);
    expect((JSON.parse(listed.body) as { items: unknown[] }).items).toEqual([]);
    expect(listed.body).not.toContain(allowedDocument);
    expect(listed.body).not.toContain('CRLV sintético');
  });

  it('denies association before GED mutation when asset write grant is absent', async () => {
    const owner = await login();
    const assetId = await makeAsset(owner);
    const documentId = await makeDocument(owner, UNIT_A);
    const viewer = await login({ assetUpdate: false });
    const res = await app.inject({
      method: 'POST', url: endpoint(assetId),
      headers: { authorization: `Bearer ${viewer.accessToken}` },
      payload: { documentId },
    });
    expect(res.statusCode).toBe(403);
    const count = await pool.query<{ total: string }>(
      'SELECT COUNT(*)::text AS total FROM doc.physical_asset_document_links WHERE physical_asset_id = $1',
      [assetId],
    );
    expect(count.rows[0]?.total).toBe('0');
  });
});
