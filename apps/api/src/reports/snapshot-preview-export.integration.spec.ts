import {
  insertGrant,
  insertIdentity,
  truncateBillingTables,
  truncateClientTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AnalyticsModule } from '../analytics/analytics.module';
import { toBusinessCalendarDate } from '../analytics/domain/business-timezone';
import { AuditModule } from '../audit/audit.module';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DocumentsModule } from '../documents/documents.module';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { BackgroundJobsModule } from '../platform/background-jobs/background-jobs.module';
import { bindFinancialChain, type BoundFinancialChain } from '../test/financial-chain.fixture';
import { REPORT_TYPES } from './domain/report-type';
import { ReportsModule } from './reports.module';
import { ReportExportAccessService } from './services/report-export-access.service';

/**
 * ANALYTICS SNAPSHOT SEMANTICS — provas de comportamento (PostgreSQL real):
 * - PREVIEW = LIVE_REQUEST: reflete o banco no instante do request.
 * - EXPORT (CSV) = artefato imutavel gerado no instante da geracao: para FinancialAging
 *   (FROZEN_SNAPSHOT) o arquivo nao muda quando o banco muda APOS a criacao; re-download
 *   reproduz os mesmos dados. Preview subsequente mostra os dados novos (LIVE) -> drift
 *   preview/export e documentado (janelas distintas), nunca silencioso.
 * Nenhuma materialized view / tabela paralela / cache. Dinheiro somente string numeric.
 */

const TZ = 'America/Porto_Velho';

function relDate(offsetDays: number): string {
  const base = new Date(`${toBusinessCalendarDate(new Date(), TZ)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

describe('SNAPSHOT SEMANTICS - preview LIVE x export FROZEN (PostgreSQL real)', () => {
  let pool: Pool;
  let moduleRef: TestingModule;
  let access: ReportExportAccessService;
  let chain: BoundFinancialChain;
  let actorId: string;
  let sessionId: string;
  let storageRoot: string;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(testDatabaseUrl);
    storageRoot = await mkdtemp(join(tmpdir(), 'cisne-snap-export-'));
    process.env['OBJECT_STORAGE_ROOT'] = storageRoot;
    process.env['OBJECT_STORAGE_PROVIDER'] = 'filesystem';
    moduleRef = await Test.createTestingModule({
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
    access = moduleRef.get(ReportExportAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `snapx-${suffix}`);
    actorId = identity.identityId;
    sessionId = `sid-snapx-${suffix}`;
    await insertGrant(pool, {
      identityId: actorId,
      action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actorId,
    });
    await insertGrant(pool, {
      identityId: actorId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actorId,
    });
    chain = bindFinancialChain(pool, actorId, suffix);
  }, 60_000);

  afterAll(async () => {
    delete process.env['OBJECT_STORAGE_ROOT'];
    delete process.env['OBJECT_STORAGE_PROVIDER'];
    if (pool) {
      await truncateFinanceTables(pool);
      await truncateBillingTables(pool);
      await truncateServiceOrderTables(pool);
      await truncateClientTables(pool);
      await truncateIdentityAndAuthorizationTables(pool);
    }
    await pool?.end();
    await rm(storageRoot, { recursive: true, force: true });
    await moduleRef?.close();
  });

  async function previewOverdueCount(): Promise<number> {
    const result = await access.preview(
      { identityId: actorId, sessionId },
      { reportType: REPORT_TYPES.FinancialAging, filters: {} },
    );
    const overdue = result.preview.find((row) => row['bucket'] === 'overdue_receivables');
    return (overdue?.['count'] as number) ?? 0;
  }

  it('preview e LIVE no request; export FinancialAging e FROZEN no instante da geracao (artefato imutavel apos mutacao)', async () => {
    await chain.chain({ unit: 'snap-o1', principal: '100.0000', dueDate: relDate(-3) });
    await chain.chain({ unit: 'snap-o2', principal: '100.0000', dueDate: relDate(-3) });
    expect(await previewOverdueCount()).toBe(2); // LIVE antes de qualquer mutacao

    // mutacao A APOS o preview (janela do preview ja fechada)
    await chain.chain({ unit: 'snap-o3', principal: '100.0000', dueDate: relDate(-3) });

    // export gerado AGORA: captura o estado no instante da geracao (contem o 3o recebivel)
    const created = await access.createExport(
      { identityId: actorId, sessionId },
      { reportType: REPORT_TYPES.FinancialAging, format: 'CSV', filters: {} },
    );
    expect(created.status).toBe('COMPLETED'); // 4 linhas <= syncRowThreshold -> sync
    const firstDownload = await access.downloadExport({ identityId: actorId, sessionId }, created.id);
    const csvAtGeneration = firstDownload.buffer.toString('utf8');
    expect(csvAtGeneration).toContain('overdue_receivables');
    expect(csvAtGeneration).toContain('3');

    // mutacao B APOS a geracao do export: preview reflete (LIVE = 4), artefato NAO muda (FROZEN)
    await chain.chain({ unit: 'snap-o4', principal: '100.0000', dueDate: relDate(-3) });
    expect(await previewOverdueCount()).toBe(4); // LIVE: ve a mutacao B

    const secondDownload = await access.downloadExport({ identityId: actorId, sessionId }, created.id);
    const csvAfterMutation = secondDownload.buffer.toString('utf8');
    expect(csvAfterMutation).toBe(csvAtGeneration); // artefato imutavel: reproduz o estado da geracao
    expect(csvAfterMutation).toContain('3'); // nunca contamina com a mutacao posterior

    // mesma consulta sem alteracao entre dois previews consecutivos: LIVE estavel (mesma contagem)
    expect(await previewOverdueCount()).toBe(4);
    expect(await previewOverdueCount()).toBe(4);
  });
});
