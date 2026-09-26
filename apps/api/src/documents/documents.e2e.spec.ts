import {
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateDocumentTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { DOCUMENT_ERROR_CODES } from './errors/document-error-codes';
import { minimalPdfBuffer } from './domain/file-validation';
import { DOCUMENT_UPLOAD_LIMITS } from './dto/documents.dto';

const UNIT_A = 'unit-doc-e2e';

function parseDocumentError(body: string): { error: { code: string } } {
  return JSON.parse(body) as { error: { code: string } };
}

function buildMultipartBody(
  fields: Record<string, string>,
  file: { name: string; mime: string; buffer: Buffer },
): { body: Buffer; contentType: string } {
  const boundary = `----CisneDocBoundary${crypto.randomUUID()}`;
  const chunks: Buffer[] = [];
  for (const [key, value] of Object.entries(fields)) {
    chunks.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`),
    );
  }
  chunks.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.mime}\r\n\r\n`,
    ),
  );
  chunks.push(file.buffer);
  chunks.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

describe('Documents E2E', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for documents E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-doc-e2e-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: DOCUMENT_UPLOAD_LIMITS.maxFileSizeBytes + 1024 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateDocumentTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
  });

  afterAll(async () => {
    await pool.end();
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function loginWithDocumentGrants(): Promise<{ accessToken: string; identityId: string }> {
    const loginId = normalizeLoginIdentifier(`docs-e2e-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, loginId, passwordHash);

    for (const action of [
      AUTHZ_ACTIONS.DocumentsDocumentCreate,
      AUTHZ_ACTIONS.DocumentsDocumentRead,
      AUTHZ_ACTIONS.DocumentsDocumentList,
      AUTHZ_ACTIONS.DocumentsDocumentUploadVersion,
      AUTHZ_ACTIONS.DocumentsDocumentDownload,
    ]) {
      await insertGrant(pool, {
        identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: loginId, password: AUTH_TEST_PASSWORD },
    });
    const tokens = parseAuthTokenResponse(loginResponse.body);
    return { accessToken: tokens.accessToken, identityId };
  }

  it('denies anonymous document upload', async () => {
    const multipart = buildMultipartBody(
      {
        title: 'Anon',
        categoryCode: 'GENERAL',
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { name: 'anon.pdf', mime: 'application/pdf', buffer: minimalPdfBuffer() },
    );

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { 'content-type': multipart.contentType },
      payload: multipart.body,
    });

    expect(response.statusCode).toBe(401);
  });

  it('answers 400 (validation) — never 500 — when upload is not multipart', async () => {
    const { accessToken } = await loginWithDocumentGrants();

    // Forma da sonda de capability do frontend: POST sem payload multipart.
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(createResponse.statusCode).toBe(400);
    expect(parseDocumentError(createResponse.body).error.code).toBe(
      DOCUMENT_ERROR_CODES.INVALID_INPUT,
    );

    const jsonResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      payload: {},
    });
    expect(jsonResponse.statusCode).toBe(400);

    const versionResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/00000000-0000-4000-8000-000000000050/versions`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(versionResponse.statusCode).toBeGreaterThanOrEqual(400);
    expect(versionResponse.statusCode).toBeLessThan(500);
  });

  it('answers 400 INVALID_INPUT — never 500 — for catalog, title and version-number input', async () => {
    const { accessToken } = await loginWithDocumentGrants();

    // Tipo de documento fora do catalogo e entrada invalida, nao filtro vazio: aceitar em silencio
    // devolveria conjunto vazio e a tela diria "nenhum documento corresponde aos filtros".
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/documents?categoryCode=NOT_A_CATEGORY',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(listResponse.statusCode).toBe(400);
    expect(parseDocumentError(listResponse.body).error.code).toBe(
      DOCUMENT_ERROR_CODES.INVALID_INPUT,
    );

    for (const versionParam of ['abc', '0', '-1']) {
      const invalidVersion = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/00000000-0000-4000-8000-000000000050/versions/${versionParam}`,
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(invalidVersion.statusCode).toBe(400);
      expect(parseDocumentError(invalidVersion.body).error.code).toBe(
        DOCUMENT_ERROR_CODES.INVALID_INPUT,
      );
    }

    const invalidCategory = buildMultipartBody(
      {
        title: 'Invalid category',
        categoryCode: 'NOT_A_CATEGORY',
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { name: 'invalid-category.pdf', mime: 'application/pdf', buffer: minimalPdfBuffer() },
    );
    const invalidCategoryResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': invalidCategory.contentType,
      },
      payload: invalidCategory.body,
    });
    expect(invalidCategoryResponse.statusCode).toBe(400);
    expect(parseDocumentError(invalidCategoryResponse.body).error.code).toBe(
      DOCUMENT_ERROR_CODES.INVALID_INPUT,
    );

    const missingTitle = buildMultipartBody(
      { title: '   ', categoryCode: 'GENERAL', classificationCode: 'INTERNAL', unitId: UNIT_A },
      { name: 'missing-title.pdf', mime: 'application/pdf', buffer: minimalPdfBuffer() },
    );
    const missingTitleResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': missingTitle.contentType,
      },
      payload: missingTitle.body,
    });
    expect(missingTitleResponse.statusCode).toBe(400);
    expect(parseDocumentError(missingTitleResponse.body).error.code).toBe(
      DOCUMENT_ERROR_CODES.INVALID_INPUT,
    );
  });

  it('uploads, downloads via authorized stream and signed token without leaking storage keys', async () => {
    const { accessToken } = await loginWithDocumentGrants();
    const multipart = buildMultipartBody(
      {
        title: 'E2E Document',
        categoryCode: 'GENERAL',
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { name: 'e2e.pdf', mime: 'application/pdf', buffer: minimalPdfBuffer() },
    );

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    });
    expect(createResponse.statusCode).toBe(201);
    const created = JSON.parse(createResponse.body) as {
      document: { id: string };
      version: { versionNumber: number; sha256Hash: string };
    };
    expect(createResponse.body.includes('storage_key')).toBe(false);
    expect(createResponse.body.includes('storageKey')).toBe(false);

    const contentResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${created.document.id}/versions/1/content`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(contentResponse.statusCode).toBe(200);
    expect(contentResponse.headers['x-content-sha256']).toBe(created.version.sha256Hash);

    const signedResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${created.document.id}/versions/1/download-url`,
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(signedResponse.statusCode).toBe(200);
    const signed = JSON.parse(signedResponse.body) as { downloadUrl: string };
    const tokenResponse = await app.inject({
      method: 'GET',
      url: signed.downloadUrl,
    });
    expect(tokenResponse.statusCode).toBe(200);
  });

  it('returns 403 when downloading a document outside unit scope', async () => {
    const owner = await loginWithDocumentGrants();
    const intruderLogin = normalizeLoginIdentifier(`docs-intruder-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId: intruderId } = await insertIdentity(pool, intruderLogin, passwordHash);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: 'unit-doc-other' });
    await insertGrant(pool, {
      identityId: intruderId,
      action: AUTHZ_ACTIONS.DocumentsDocumentRead,
      resourceType: AUTHZ_RESOURCE_TYPES.DocumentsDocument,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: 'unit-doc-other',
      grantedByIdentityId: intruderId,
    });
    const intruderLoginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: intruderLogin, password: AUTH_TEST_PASSWORD },
    });
    const intruderToken = parseAuthTokenResponse(intruderLoginResponse.body).accessToken;

    const multipart = buildMultipartBody(
      {
        title: 'Owner only',
        categoryCode: 'GENERAL',
        classificationCode: 'INTERNAL',
        unitId: UNIT_A,
      },
      { name: 'owner.pdf', mime: 'application/pdf', buffer: minimalPdfBuffer() },
    );
    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: {
        authorization: `Bearer ${owner.accessToken}`,
        'content-type': multipart.contentType,
      },
      payload: multipart.body,
    });
    const created = JSON.parse(createResponse.body) as { document: { id: string } };

    const denied = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${created.document.id}`,
      headers: { authorization: `Bearer ${intruderToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(parseDocumentError(denied.body).error.code).toBe(DOCUMENT_ERROR_CODES.DENIED);
  });
});
