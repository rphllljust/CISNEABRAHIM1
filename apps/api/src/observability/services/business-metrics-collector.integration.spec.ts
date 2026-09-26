import {
  insertIdentity,
  truncateBillingTables,
  truncateClientTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../../auth/test/auth-test-env';
import { DatabaseModule } from '../../infrastructure/database/database.module';
import { BusinessMetricsCollectorService } from './business-metrics-collector.service';

const UNIT = 'unit-metrics-a';

/**
 * Regressao de contrato contra PostgreSQL real.
 *
 * O coletor de metrica `billingAging` ja carregou um literal de enum invalido
 * (`bil.billing_record_status = 'AWAITING_PAYMENT'`) que a unidade (com pool mockado) nao
 * detectava. Esse teste semeia billing records reais e prova que o SQL casa com o enum
 * publicado — qualquer drift de enum falha aqui, nao no smoke de HML.
 */
describe('BusinessMetricsCollectorService — integração PostgreSQL', () => {
  let pool: Pool;
  let collector: BusinessMetricsCollectorService;
  let actorId: string;
  let taxIdCounter = 0;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for business metrics integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [BusinessMetricsCollectorService],
    }).compile();
    collector = module.get(BusinessMetricsCollectorService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateClientTables(pool);
    taxIdCounter = 0;
    actorId = (await insertIdentity(pool, `metrics-${crypto.randomUUID()}@cisne.invalid`)).identityId;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedBillingRecord(status: string, preparedAgoDays: number): Promise<void> {
    const serviceOrderId = crypto.randomUUID();
    const clientId = crypto.randomUUID();
    const suffix = crypto.randomUUID().slice(0, 8);
    taxIdCounter += 1;
    const normalizedTaxId = String(11_222_333_000_000 + taxIdCounter).padStart(14, '0');
    await pool.query(
      `INSERT INTO pty.clients (id, legal_name, normalized_tax_id, status, version)
       VALUES ($1::uuid, 'Cliente Metricas', $2, 'ACTIVE', 1)`,
      [clientId, normalizedTaxId],
    );
    await pool.query(
      `INSERT INTO so.service_orders (
         id, internal_code, order_number, unit_id, status, origin, service_snapshot,
         row_version, created_by_identity_id, updated_by_identity_id, created_at, prepared_at
       ) VALUES (
         $1, $2, $3, $4, 'PREPARED', 'AUTHORIZED_DIRECT', '{}'::jsonb,
         1, $5, $5, NOW() - INTERVAL '9 days', NOW() - ($6 * interval '1 day')
       )`,
      [serviceOrderId, `SO-INT-${suffix}`, `SO-NUM-${suffix}`, UNIT, actorId, preparedAgoDays],
    );
    await pool.query(
      `INSERT INTO bil.billing_records (
         id, service_order_id, client_id, unit_id, status, client_legal_name_snapshot,
         billing_address_snapshot, commercial_reference_snapshot, currency_code, payment_terms,
         payment_terms_source, total_amount, prepared_at, prepared_by_identity_id,
         entitlement_policy, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES (
         $1, $2, $3, $4, $5::bil.billing_record_status, 'Cliente', '{}'::jsonb, '{}'::jsonb,
         'BRL', '30 DDL', 'DECLARED', 100.0000, now() - ($6 * interval '1 day'), $7, 'STANDARD', 1, $7, $7
       )`,
      [crypto.randomUUID(), serviceOrderId, clientId, UNIT, status, preparedAgoDays, actorId],
    );
  }

  it('conta billing records PREPARED com mais de 7 dias e ignora VOIDED', async () => {
    await seedBillingRecord('PREPARED', 8);
    await seedBillingRecord('PREPARED', 2);
    await seedBillingRecord('VOIDED', 9);

    const snap = await collector.collect();
    expect(snap.billingAging).toBe(1);
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('zero real quando nao ha billing record PREPARED envelhecido', async () => {
    await seedBillingRecord('PREPARED', 1);
    await seedBillingRecord('VOIDED', 9);

    const snap = await collector.collect();
    expect(snap.billingAging).toBe(0);
    expect(collector.getLastCollectionError()).toBeNull();
  });

  it('nao falha com enum invalido: o SQL usa somente o vocabulario publicado de bil.billing_record_status', async () => {
    await seedBillingRecord('PREPARED', 8);
    const snap = await collector.collect();
    expect(snap.billingAging).toBe(1);
    expect(collector.getLastCollectionError()).toBeNull();
  });
});
