import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import {
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AgingAccessService } from '../analytics/services/aging-access.service';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';

describe('FINANCIAL AGING — fonte financeira e NO_DATA (PostgreSQL)', () => {
  let pool: Pool;
  let aging: AgingAccessService;
  let actor: { identityId: string; sessionId: string };
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule, AnalyticsModule],
    }).compile();
    aging = module.get(AgingAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const suffix = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await insertIdentity(pool, `finaging-${suffix}`);
    actor = { identityId: identity.identityId, sessionId: 'sid-finaging' };
    await insertGrant(pool, {
      identityId: actor.identityId,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: actor.identityId,
    });
  }, 30_000);

  afterAll(async () => {
    await pool?.end();
  });

  it('sem dado não inventa 0: awaitingPreparation.totalAmount e overdueReceivables.totalAmount são NO_DATA (null)', async () => {
    const snap = await aging.getAgingSnapshot(actor);
    expect(snap.financial.awaitingPreparation.count).toBe(0);
    expect(snap.financial.awaitingPreparation.totalAmount).toBeNull();
    expect(snap.financial.overdueReceivables.count).toBe(0);
    expect(snap.financial.overdueReceivables.totalAmount).toBeNull();
  });
});
