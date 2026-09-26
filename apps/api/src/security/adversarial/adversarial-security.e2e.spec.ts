import {
  ensureGrant,
  hashPassword,
  insertGrant,
  insertIdentity,
  insertScopeRef,
} from '@cisne/database';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AppModule } from '../../app.module';
import { configureApiTestApp } from '../../infrastructure/http/configure-api-test-app';
import { parseApiErrorCode } from '../../infrastructure/http/api-error-response';
import { normalizeLoginIdentifier } from '../../auth/crypto/token-crypto';
import { applyAuthTestEnv, AUTH_TEST_PASSWORD } from '../../auth/test/auth-test-env';
import { parseAuthTokenResponse } from '../../auth/test/auth-response-test-types';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import { CONTACT_PURPOSES } from '../../clients/domain/client-status';
import { loadDocumentStorageConfig } from '../../documents/config/document-storage.config';
import { DOCUMENT_CATEGORIES } from '../../documents/domain/document-categories';
import { minimalPdfBuffer } from '../../documents/domain/file-validation';
import { DOCUMENT_UPLOAD_LIMITS } from '../../documents/dto/documents.dto';
import { DOCUMENT_ERROR_CODES } from '../../documents/errors/document-error-codes';
import { ReportExportAccessService } from '../../reports/services/report-export-access.service';
import { REPORT_TYPES } from '../../reports/domain/report-type';
import {
  createMasterBusinessTestContext,
  MASTER_BUSINESS_UNIT,
  type MasterBusinessTestContext,
} from '../../master-business/master-business-harness';
import { nextSyntheticCnpj } from '../../master-business/synthetic-test-data';
import { grantUatProfile, runUatVerticalScenario } from '../../uat/uat-vertical-runner';
import { UAT_SCENARIOS } from '../../uat/uat-scenarios';
import type { UatActor } from '../../uat/uat-vertical-runner';
import {
  assertNoSensitiveLeak,
  buildExpiredDownloadToken,
  buildMultipartBody,
  buildTamperedDownloadToken,
  expectDeniedStatus,
  expectPrivilegedCommandDenied,
  MASS_ASSIGNMENT_REJECTED_FIELDS,
  SQL_INJECTION_PAYLOADS,
} from './adversarial-security.helpers';

const ADVERSARIAL_UNIT_B = 'unit-adversarial-b';

async function ensureReportExportsSchema(pool: Pool): Promise<void> {
  const exists = await pool.query<{ regclass: string | null }>(
    'SELECT to_regclass($1) AS regclass',
    ['rpt.report_exports'],
  );
  if (exists.rows[0]?.regclass !== null) {
    return;
  }

  const filePath = resolve(
    __dirname,
    '../../../../../packages/database/migrations/0034_report_exports.sql',
  );
  const sql = readFileSync(filePath, 'utf8');
  const statements = sql
    .split('--> statement-breakpoint')
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
  for (const statement of statements) {
    await pool.query(statement);
  }
}

async function withDeadlockRetry<T>(run: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      const code = (error as { code?: string }).code;
      if ((code === '40P01' || code === '23503' || code === '23001') && attempt < attempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
  throw new Error('withDeadlockRetry exhausted attempts without returning.');
}

describe('Adversarial security regression (E2E HTTP)', () => {
  let app: NestFastifyApplication;
  let ctx: MasterBusinessTestContext;
  let storageRoot: string;
  let adminToken: string;
  let intruderToken: string;
  let adminActor: UatActor;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for adversarial security E2E tests.');
    }

    applyAuthTestEnv(testDatabaseUrl);
    process.env['AUTH_LOGIN_RATE_LIMIT_PER_MINUTE'] = '100000';
    process.env['SECURITY_RATE_LOGIN_MAX'] = '100000';
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-advsec-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';

    ctx = await createMasterBusinessTestContext();
    await ensureReportExportsSchema(ctx.pool);
    await insertScopeRef(ctx.pool, { scopeType: 'UNIT', refId: ADVERSARIAL_UNIT_B });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter({ bodyLimit: DOCUMENT_UPLOAD_LIMITS.maxFileSizeBytes + 1024 }),
    );
    configureApiTestApp(app);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  }, 180_000);

  async function httpLogin(login: string, userAgent: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'user-agent': userAgent },
      payload: { login, password: AUTH_TEST_PASSWORD },
    });
    expect(response.statusCode).toBe(200);
    return parseAuthTokenResponse(response.body).accessToken;
  }

  async function seedAdminWithLogin(): Promise<{ actor: UatActor; login: string }> {
    const login = normalizeLoginIdentifier(`advsec-admin-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(ctx.pool, login, passwordHash);
    await grantUatProfile(ctx.pool, identityId, identityId, 'control_admin');
    return { actor: { identityId, sessionId: 'sid-admin' }, login };
  }

  async function seedIntruder(grantedBy: string): Promise<{ actor: UatActor; login: string }> {
    const login = normalizeLoginIdentifier(`advsec-intruder-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(ctx.pool, login, passwordHash);
    await insertGrant(ctx.pool, {
      identityId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: ADVERSARIAL_UNIT_B,
      grantedByIdentityId: grantedBy,
    });
    return { actor: { identityId, sessionId: 'sid-intruder' }, login };
  }

  beforeEach(async () => {
    await withDeadlockRetry(async () => {
      await ctx.resetDatabase();
      await ctx.pool.query('DELETE FROM rpt.report_exports');
      await insertScopeRef(ctx.pool, { scopeType: 'UNIT', refId: ADVERSARIAL_UNIT_B });
      const admin = await seedAdminWithLogin();
      const intruder = await seedIntruder(admin.actor.identityId);
      adminActor = admin.actor;
      const agentSuffix = crypto.randomUUID().slice(0, 8);
      adminToken = await httpLogin(admin.login, `cisne-advsec-admin-${agentSuffix}`);
      intruderToken = await httpLogin(intruder.login, `cisne-advsec-intruder-${agentSuffix}`);
    });
  }, 180_000);

  afterAll(async () => {
    await ctx.pool.end();
    await app.close();
    await rm(storageRoot, { recursive: true, force: true });
  });

  async function seedReleasedOrder() {
    return withDeadlockRetry(async () => {
      const result = await runUatVerticalScenario(ctx.services, UAT_SCENARIOS[0]!, adminActor, MASTER_BUSINESS_UNIT, {
        stopAfter: 'prepared',
      });
      expect(result.status, result.error).toBe('PASS');
      expect(result.serviceOrderId).toBeTruthy();
      return result;
    });
  }

  async function seedBillableOrder() {
    return withDeadlockRetry(async () => {
      const result = await runUatVerticalScenario(ctx.services, UAT_SCENARIOS[2]!, adminActor, MASTER_BUSINESS_UNIT, {
        stopAfter: 'measurement_approved',
      });
      expect(result.status, result.error).toBe('PASS');
      expect(result.serviceOrderId).toBeTruthy();
      expect(result.measurementId).toBeTruthy();
      return result;
    });
  }

  async function seedCompletedOrder() {
    return withDeadlockRetry(async () => {
      const result = await runUatVerticalScenario(ctx.services, UAT_SCENARIOS[1]!, adminActor, MASTER_BUSINESS_UNIT, {
        stopAfter: 'completed_execution',
      });
      expect(result.status, result.error).toBe('PASS');
      expect(result.serviceOrderId).toBeTruthy();
      return result;
    });
  }

  describe('BOLA / IDOR', () => {
    it('denies cross-actor GET, UPDATE, COMMAND and DOWNLOAD on service orders', async () => {
      const victim = await seedReleasedOrder();
      const order = await ctx.services.serviceOrdersAccess.getById(adminActor, victim.serviceOrderId!);

      const getDenied = await app.inject({
        method: 'GET',
        url: `/api/v1/service-orders/${victim.serviceOrderId}`,
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(getDenied.statusCode);
      assertNoSensitiveLeak(getDenied.body);

      const patchDenied = await app.inject({
        method: 'PATCH',
        url: `/api/v1/service-orders/${victim.serviceOrderId}`,
        headers: { authorization: `Bearer ${intruderToken}` },
        payload: { rowVersion: order.rowVersion, description: 'IDOR attempt' },
      });
      expectDeniedStatus(patchDenied.statusCode);

      const releaseDenied = await app.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${victim.serviceOrderId}/release`,
        headers: { authorization: `Bearer ${intruderToken}` },
        payload: { rowVersion: order.rowVersion },
      });
      expectDeniedStatus(releaseDenied.statusCode);

      const completeDenied = await app.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${victim.serviceOrderId}/execution/complete`,
        headers: { authorization: `Bearer ${intruderToken}` },
        payload: { rowVersion: order.rowVersion },
      });
      expectDeniedStatus(completeDenied.statusCode);
    });

    it('denies cross-actor billing finalize and export download', async () => {
      const victim = await seedBillableOrder();
      const billing = await ctx.services.billingAccess.prepare(adminActor, victim.serviceOrderId!, {
        measurementId: victim.measurementId!,
        paymentTerms: '30 DDL',
      });

      const finalizeDenied = await app.inject({
        method: 'POST',
        url: `/api/v1/service-orders/${victim.serviceOrderId}/billing-records/${billing.id}/documents`,
        headers: { authorization: `Bearer ${intruderToken}` },
        payload: { dueDate: '2026-12-31' },
      });
      expectPrivilegedCommandDenied(finalizeDenied.statusCode);

      await ensureGrant(ctx.pool, {
        identityId: adminActor.identityId,
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: adminActor.identityId,
      });

      const reportAccess = app.get(ReportExportAccessService);
      const created = await reportAccess.createExport(adminActor, {
        reportType: REPORT_TYPES.ServiceOrdersByPeriod,
        format: 'CSV',
        filters: {},
      });

      const exportDenied = await app.inject({
        method: 'GET',
        url: `/api/v1/reports/exports/${created.id}/download`,
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(exportDenied.statusCode);
      assertNoSensitiveLeak(exportDenied.body);
    });

    it('denies cross-unit document GET and content download', async () => {
      const pdf = minimalPdfBuffer();
      const created = await ctx.services.documentsAccess.createWithUpload(
        adminActor,
        {
          title: 'Victim document',
          categoryCode: DOCUMENT_CATEGORIES.General,
          classificationCode: 'INTERNAL',
          unitId: MASTER_BUSINESS_UNIT,
        },
        { buffer: pdf, filename: 'victim.pdf', mimetype: 'application/pdf' },
      );

      const getDenied = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${created.document.id}`,
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(getDenied.statusCode);

      const contentDenied = await app.inject({
        method: 'GET',
        url: `/api/v1/documents/${created.document.id}/versions/1/content`,
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(contentDenied.statusCode);
      expect(parseApiErrorCode(contentDenied.body)).toBe(DOCUMENT_ERROR_CODES.DENIED);
    });
  });

  describe('BFLA', () => {
    it('denies privileged commands for under-privileged users', async () => {
      const victim = await seedCompletedOrder();
      const order = await ctx.services.serviceOrdersAccess.getById(adminActor, victim.serviceOrderId!);
      const measurement = await ctx.services.measurementsAccess.create(adminActor, victim.serviceOrderId!);
      const submitted = await ctx.services.measurementsAccess.submit(
        adminActor,
        victim.serviceOrderId!,
        measurement.id,
        { rowVersion: measurement.rowVersion },
      );
      const reviewed = await ctx.services.measurementsAccess.startReview(
        adminActor,
        victim.serviceOrderId!,
        measurement.id,
        { rowVersion: submitted.rowVersion },
      );

      const attempts: Array<{ method: 'POST' | 'PATCH'; url: string; payload?: Record<string, unknown> }> = [
        {
          method: 'POST',
          url: '/api/v1/clients',
          payload: {
            legalName: 'Intruder Client',
            taxId: nextSyntheticCnpj(),
            contacts: [{ name: 'Ops', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
          },
        },
        {
          method: 'POST',
          url: `/api/v1/service-orders/${victim.serviceOrderId}/release`,
          payload: { rowVersion: order.rowVersion },
        },
        {
          method: 'POST',
          url: `/api/v1/service-orders/${victim.serviceOrderId}/execution/complete`,
          payload: { rowVersion: order.rowVersion },
        },
        {
          method: 'POST',
          url: `/api/v1/service-orders/${victim.serviceOrderId}/measurements/${measurement.id}/approve`,
          payload: { rowVersion: reviewed.rowVersion },
        },
        {
          method: 'POST',
          url: '/api/v1/reports/exports?reportType=SERVICE_ORDERS_BY_PERIOD&format=CSV',
        },
      ];

      for (const attempt of attempts) {
        const response = await app.inject({
          method: attempt.method,
          url: attempt.url,
          headers: { authorization: `Bearer ${intruderToken}` },
          payload: attempt.payload,
        });
        expectPrivilegedCommandDenied(response.statusCode);
        assertNoSensitiveLeak(response.body);
      }
    });
  });

  describe('mass assignment', () => {
    it('rejects privileged fields on client create via HTTP', async () => {
      for (const field of MASS_ASSIGNMENT_REJECTED_FIELDS) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/v1/clients',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: {
            legalName: 'Mass Assignment Test',
            taxId: nextSyntheticCnpj(),
            contacts: [{ name: 'Ops', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
            [field]: 'forged-value',
          },
        });
        expect([400, 422]).toContain(response.statusCode);
        assertNoSensitiveLeak(response.body);
      }
    });

    it('does not persist ignored privileged-looking fields that pass DTO parsing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/clients',
        headers: { authorization: `Bearer ${adminToken}` },
        payload: {
          legalName: 'Ignored Fields Client',
          taxId: nextSyntheticCnpj(),
          contacts: [{ name: 'Ops', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
          permissions: ['ADMIN'],
          margin: '9999',
          billingStatus: 'PAID',
        },
      });
      expect(response.statusCode).toBe(201);
      const created = JSON.parse(response.body) as { id: string; status: string };
      expect(created.status).toBe('ACTIVE');

      const row = await ctx.pool.query<{ status: string }>(
        `SELECT status::text AS status FROM pty.clients WHERE id = $1`,
        [created.id],
      );
      expect(row.rows[0]?.status).toBe('ACTIVE');
    });
  });

  describe('enumeration', () => {
    it('does not expose cross-scope clients or dashboard metrics to intruder', async () => {
      await ctx.services.clientAccess.create(adminActor, {
        legalName: 'Scoped Victim',
        taxId: nextSyntheticCnpj(),
        contacts: [{ name: 'Ops', purpose: CONTACT_PURPOSES.Operational, phone: '69999990000' }],
      });

      const listDenied = await app.inject({
        method: 'GET',
        url: '/api/v1/clients?limit=50&offset=0',
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(listDenied.statusCode);

      const dashboardDenied = await app.inject({
        method: 'GET',
        url: '/api/v1/dashboard/executive',
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(dashboardDenied.statusCode);

      const search = await app.inject({
        method: 'GET',
        url: `/api/v1/search?q=${encodeURIComponent('Scoped Victim')}`,
        headers: { authorization: `Bearer ${intruderToken}` },
      });
      expectDeniedStatus(search.statusCode);
    });
  });

  describe('SQL injection', () => {
    it('treats injection payloads safely in search and list filters', async () => {
      const beforeCount = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pty.clients`,
      );

      for (const payload of SQL_INJECTION_PAYLOADS) {
        const search = await app.inject({
          method: 'GET',
          url: `/api/v1/search?q=${encodeURIComponent(payload)}&types=CLIENT`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(search.statusCode).not.toBe(500);
        // O payload e ecoado pelo proprio endpoint (campo de consulta); isso nao e vazamento
        // do servidor, portanto o eco e excluido da varredura de seguranca.
        assertNoSensitiveLeak(search.body, { reflectedInput: [payload] });

        const clients = await app.inject({
          method: 'GET',
          url: `/api/v1/clients?status=${encodeURIComponent(payload)}&limit=10&offset=0`,
          headers: { authorization: `Bearer ${adminToken}` },
        });
        expect(clients.statusCode).not.toBe(500);
        assertNoSensitiveLeak(clients.body);
      }

      const afterCount = await ctx.pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM pty.clients`,
      );
      expect(afterCount.rows[0]?.count).toBe(beforeCount.rows[0]?.count);
    });
  });

  describe('document access', () => {
    it('rejects tampered and expired signed download tokens', async () => {
      const pdf = minimalPdfBuffer();
      const created = await ctx.services.documentsAccess.createWithUpload(
        adminActor,
        {
          title: 'Token test',
          categoryCode: DOCUMENT_CATEGORIES.Evidence,
          classificationCode: 'RESTRICTED',
          unitId: MASTER_BUSINESS_UNIT,
        },
        { buffer: pdf, filename: 'token.pdf', mimetype: 'application/pdf' },
      );

      const config = loadDocumentStorageConfig();
      const tampered = buildTamperedDownloadToken(
        config.downloadTokenSecret,
        created.document.id,
        1,
      );
      const expired = buildExpiredDownloadToken(config.downloadTokenSecret, created.document.id, 1);

      for (const token of [tampered, expired, 'not-a-valid-token']) {
        const response = await app.inject({
          method: 'GET',
          url: `/api/v1/documents/download?token=${encodeURIComponent(token)}`,
        });
        expect([403, 400, 404]).toContain(response.statusCode);
        assertNoSensitiveLeak(response.body);
      }
    });

    it('does not expose storage keys in document API responses', async () => {
      const pdf = minimalPdfBuffer();
      const multipart = buildMultipartBody(
        {
          title: 'No leak',
          categoryCode: 'GENERAL',
          classificationCode: 'INTERNAL',
          unitId: MASTER_BUSINESS_UNIT,
        },
        { name: 'safe.pdf', mime: 'application/pdf', buffer: pdf },
      );

      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: {
          authorization: `Bearer ${adminToken}`,
          'content-type': multipart.contentType,
        },
        payload: multipart.body,
      });
      expect(response.statusCode).toBe(201);
      assertNoSensitiveLeak(response.body);
    });
  });

  describe('upload security', () => {
    it('rejects fake mime, oversize, path traversal and empty uploads', async () => {
      const baseFields = {
        title: 'Upload security',
        categoryCode: 'GENERAL',
        classificationCode: 'INTERNAL',
        unitId: MASTER_BUSINESS_UNIT,
      };

      const fakeMime = buildMultipartBody(baseFields, {
        name: 'fake.pdf',
        mime: 'application/pdf',
        buffer: Buffer.from('plain-text-not-pdf'),
      });
      const fakeResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': fakeMime.contentType },
        payload: fakeMime.body,
      });
      expect(fakeResponse.statusCode).toBe(400);
      expect(parseApiErrorCode(fakeResponse.body)).toBe(DOCUMENT_ERROR_CODES.MAGIC_BYTES_MISMATCH);

      const dangerousExt = buildMultipartBody(baseFields, {
        name: 'payload.exe',
        mime: 'application/pdf',
        buffer: minimalPdfBuffer(),
      });
      const dangerousResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': dangerousExt.contentType },
        payload: dangerousExt.body,
      });
      expect(dangerousResponse.statusCode).toBe(400);
      expect(parseApiErrorCode(dangerousResponse.body)).toBe(DOCUMENT_ERROR_CODES.INVALID_EXTENSION);

      const traversal = buildMultipartBody(baseFields, {
        name: '../../etc/passwd.pdf',
        mime: 'application/pdf',
        buffer: minimalPdfBuffer(),
      });
      const traversalResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': traversal.contentType },
        payload: traversal.body,
      });
      expect(traversalResponse.statusCode).toBe(201);
      expect(traversalResponse.body).not.toContain('../');
      expect(traversalResponse.body).not.toMatch(/etc[/\\]passwd/i);

      const empty = buildMultipartBody(baseFields, {
        name: 'empty.pdf',
        mime: 'application/pdf',
        buffer: Buffer.alloc(0),
      });
      const emptyResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': empty.contentType },
        payload: empty.body,
      });
      expect(emptyResponse.statusCode).toBe(400);

      const huge = buildMultipartBody(baseFields, {
        name: 'huge.pdf',
        mime: 'application/pdf',
        buffer: Buffer.concat([minimalPdfBuffer(), Buffer.alloc(26 * 1024 * 1024)]),
      });
      const hugeResponse = await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: { authorization: `Bearer ${adminToken}`, 'content-type': huge.contentType },
        payload: huge.body,
      });
      expect(hugeResponse.statusCode).not.toBe(201);
      assertNoSensitiveLeak(hugeResponse.body);
    });
  });

  describe('error leakage', () => {
    it('does not leak SQL, stack traces, paths or secrets in error responses', async () => {
      const probes = [
        { method: 'GET' as const, url: '/api/v1/clients/not-a-uuid' },
        { method: 'GET' as const, url: '/api/v1/service-orders/00000000-0000-4000-8000-000000009999' },
        {
          method: 'POST' as const,
          url: '/api/v1/clients',
          payload: { legalName: '', taxId: 'invalid', contacts: [] },
        },
      ];

      for (const probe of probes) {
        const response = await app.inject({
          method: probe.method,
          url: probe.url,
          headers: probe.method === 'POST' ? { authorization: `Bearer ${adminToken}` } : undefined,
          payload: probe.payload,
        });
        assertNoSensitiveLeak(response.body);
      }
    });
  });
});
