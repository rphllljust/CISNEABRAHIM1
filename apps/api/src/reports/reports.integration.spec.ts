import {
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateClientTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuditModule } from '../audit/audit.module';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DocumentsModule } from '../documents/documents.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { REPORT_TYPES } from './domain/report-type';
import { ReportHttpException } from './errors/report-http.exception';
import { ReportsModule } from './reports.module';
import { ReportExportAccessService } from './services/report-export-access.service';

const UNIT_A = 'unit-report-a';
const UNIT_B = 'unit-report-b';

async function insertServiceOrder(
  pool: Pool,
  input: {
    orderNumber: string;
    unitId: string;
    identityId: string;
    clientSnapshot?: Record<string, string>;
  },
): Promise<void> {
  await pool.query(
    `INSERT INTO so.service_orders (
       internal_code, order_number, unit_id, status, origin, service_snapshot,
       client_snapshot, row_version, created_by_identity_id, updated_by_identity_id
     ) VALUES ($1, $2, $3, 'PREPARED', 'AUTHORIZED_DIRECT', '{}'::jsonb, $4::jsonb, 1, $5, $5)`,
    [
      `SO-INT-${input.orderNumber}`,
      input.orderNumber,
      input.unitId,
      JSON.stringify(input.clientSnapshot ?? { legalName: 'Cliente padrão' }),
      input.identityId,
    ],
  );
}

describe('Reports PostgreSQL integration', () => {
  let pool: Pool;
  let access: ReportExportAccessService;
  let identityA: string;
  let identityB: string;
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for reports integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-report-storage-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        DatabaseModule,
        AuthorizationModule,
        AnalyticsModule,
        AuditModule,
        DocumentsModule,
        BackgroundJobsModule,
        ReportsModule,
      ],
    }).compile();

    access = module.get(ReportExportAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM rpt.report_exports');
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });

    const suffix = crypto.randomUUID();
    identityA = (await insertIdentity(pool, `report-a-${suffix}`)).identityId;
    identityB = (await insertIdentity(pool, `report-b-${suffix}`)).identityId;

    await insertGrant(pool, {
      identityId: identityA,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityA,
    });
    await insertGrant(pool, {
      identityId: identityB,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Unit,
      resourceId: UNIT_A,
      grantedByIdentityId: identityB,
    });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
    await rm(storageRoot, { recursive: true, force: true });
  });

  it('scopes service orders by unit grant', async () => {
    await insertServiceOrder(pool, {
      orderNumber: 'SO-SCOPED-A',
      unitId: UNIT_A,
      identityId: identityA,
    });
    await insertServiceOrder(pool, {
      orderNumber: 'SO-SCOPED-B',
      unitId: UNIT_B,
      identityId: identityA,
    });

    const preview = await access.preview(
      { identityId: identityB, sessionId: 's-b' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, filters: {} },
    );

    expect(preview.total).toBe(1);
    expect(preview.preview[0]?.orderNumber).toBe('SO-SCOPED-A');
  });

  it('limits preview rows while exposing total count', async () => {
    for (let index = 0; index < 25; index += 1) {
      await insertServiceOrder(pool, {
        orderNumber: `SO-PREVIEW-${index}`,
        unitId: UNIT_A,
        identityId: identityA,
      });
    }

    const preview = await access.preview(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, filters: {} },
    );

    expect(preview.preview.length).toBeLessThanOrEqual(20);
    expect(preview.total).toBe(25);
  });

  it('sanitizes CSV formula injection in generated export', async () => {
    await insertServiceOrder(pool, {
      orderNumber: 'SO-CSV-INJECT',
      unitId: UNIT_A,
      identityId: identityA,
      clientSnapshot: { legalName: '=1+1' },
    });

    const created = await access.createExport(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'CSV', filters: {} },
    );
    expect(created.status).toBe('COMPLETED');

    const file = await access.downloadExport(
      { identityId: identityA, sessionId: 's-a' },
      created.id,
    );
    const csv = file.buffer.toString('utf8');
    expect(csv).toContain(`"'=1+1"`);
    expect(csv).not.toMatch(/,=1\+1/);
  });

  it('denies cross-actor export download (IDOR)', async () => {
    await insertServiceOrder(pool, {
      orderNumber: 'SO-IDOR',
      unitId: UNIT_A,
      identityId: identityA,
    });

    const created = await access.createExport(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'CSV', filters: {} },
    );

    await expect(
      access.downloadExport({ identityId: identityB, sessionId: 's-b' }, created.id),
    ).rejects.toBeInstanceOf(ReportHttpException);
  });

  it('lists only the actor own exports with pagination, newest first', async () => {
    for (let index = 0; index < 3; index += 1) {
      await access.createExport(
        { identityId: identityA, sessionId: 's-a' },
        { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'CSV', filters: {} },
      );
    }

    const first = await access.listExports(
      { identityId: identityA, sessionId: 's-a' },
      { page: 0, pageSize: 2 },
    );
    expect(first.items).toHaveLength(2);
    expect(first.total).toBe(3);
    expect(first.page).toBe(0);
    expect(first.pageSize).toBe(2);

    const second = await access.listExports(
      { identityId: identityA, sessionId: 's-a' },
      { page: 1, pageSize: 2 },
    );
    expect(second.items).toHaveLength(1);

    const otherActor = await access.listExports(
      { identityId: identityB, sessionId: 's-b' },
      { page: 0, pageSize: 10 },
    );
    expect(otherActor.items).toHaveLength(0);
    expect(otherActor.total).toBe(0);
  });

  it('filters export history by status and rejects invalid filters', async () => {
    await access.createExport(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'CSV', filters: {} },
    );
    await access.createExport(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'CSV', filters: {} },
    );

    const completed = await access.listExports(
      { identityId: identityA, sessionId: 's-a' },
      { status: 'COMPLETED' },
    );
    expect(completed.total).toBe(2);

    await expect(
      access.listExports(
        { identityId: identityA, sessionId: 's-a' },
        { status: 'BOGUS' },
      ),
    ).rejects.toBeInstanceOf(ReportHttpException);
    await expect(
      access.listExports(
        { identityId: identityA, sessionId: 's-a' },
        { reportType: 'NOPE' },
      ),
    ).rejects.toBeInstanceOf(ReportHttpException);
    await expect(
      access.listExports(
        { identityId: identityA, sessionId: 's-a' },
        { page: -1 },
      ),
    ).rejects.toBeInstanceOf(ReportHttpException);
  });

  it('denies export history list without any report access (fail closed)', async () => {
    const suffix = crypto.randomUUID();
    const identityNoAccess = (await insertIdentity(pool, `report-denied-${suffix}`)).identityId;

    await expect(
      access.listExports({ identityId: identityNoAccess, sessionId: 's-n' }, {}),
    ).rejects.toBeInstanceOf(ReportHttpException);
  });

  it('includes business timezone in report contract', async () => {
    await insertServiceOrder(pool, {
      orderNumber: 'SO-TZ',
      unitId: UNIT_A,
      identityId: identityA,
    });

    const preview = await access.preview(
      { identityId: identityA, sessionId: 's-a' },
      { reportType: REPORT_TYPES.ServiceOrdersByPeriod, filters: {} },
    );

    expect(preview.contract.timezone).toBeTruthy();
    expect(preview.contract.name).toBe('OS por período');
  });

  it('rejects unsupported export formats', async () => {
    await expect(
      access.createExport(
        { identityId: identityA, sessionId: 's-a' },
        { reportType: REPORT_TYPES.ServiceOrdersByPeriod, format: 'XLSX', filters: {} },
      ),
    ).rejects.toBeInstanceOf(ReportHttpException);
  });
});
