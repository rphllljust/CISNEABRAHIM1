import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { buildReceivablePositionsSql } from './domain/receivable-aging-sql';

/**
 * STEP 3 — fixture deterministica da cadeia persistida:
 * service order -> billing record -> billing document -> receivable -> settlements.
 * Datas relativas a uma data de referencia explicita (nao NOW()).
 */
const REF = '2026-09-15'; // data de referencia fixa p/ classificacao

describe('FINANCIAL fixture chain (billing -> receivable -> settlements)', () => {
  let pool: Pool;
  let actorId: string;
  let run: string;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(url);
    pool = new Pool({ connectionString: url });
    run = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.identities (id, status) VALUES (gen_random_uuid(), 'active') RETURNING id`,
    );
    actorId = identity.rows[0]!.id;
  });

  afterAll(async () => {
    await pool?.end();
  });

  async function newClient(unit: string): Promise<string> {
    const tax = String(Math.floor(1e13 + Math.random() * 9e13));
    const row = await pool.query<{ id: string }>(
      `INSERT INTO pty.clients (legal_name, normalized_tax_id) VALUES ($1, $2) RETURNING id`,
      [`Cliente ${unit}`, tax],
    );
    return row.rows[0]!.id;
  }

  async function newServiceOrder(unit: string, actor: string): Promise<string> {
    const code = `SO-CH-${run}-${unit}-${crypto.randomUUID().slice(0, 4)}`;
    const row = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, started_at, completed_at, row_version,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'COMPLETED', 'AUTHORIZED_DIRECT', '{}'::jsonb,
                 '{}'::jsonb, NOW() - interval '2 hours', NOW() - interval '1 hour', 1, $4, $4)
       RETURNING id`,
      [code, code, unit, actor],
    );
    return row.rows[0]!.id;
  }

  async function newMeasurement(soId: string, unit: string, actor: string): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO msr.measurements (
         service_order_id, unit_id, status, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, 'APPROVED', 1, $3, $3) RETURNING id`,
      [soId, unit, actor],
    );
    return row.rows[0]!.id;
  }

  async function billingRecord(
    soId: string,
    clientId: string,
    unit: string,
    actor: string,
    amount: string,
  ): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO bil.billing_records (
         service_order_id, client_id, unit_id, status, client_legal_name_snapshot,
         billing_address_snapshot, commercial_reference_snapshot, currency_code,
         payment_terms, payment_terms_source, total_amount, prepared_at,
         prepared_by_identity_id, row_version, entitlement_policy,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'PREPARED', 'Cliente', '{}'::jsonb, '{}'::jsonb, 'BRL',
                 '30 DDL', 'DECLARED', $4, NOW(), $5, 1, 'MEASUREMENT_APPROVED', $5, $5)
       RETURNING id`,
      [soId, clientId, unit, amount, actor],
    );
    return row.rows[0]!.id;
  }

  async function billingDocument(
    recordId: string,
    soId: string,
    measurementId: string,
    clientId: string,
    unit: string,
    actor: string,
    amount: string,
    dueDate: string,
  ): Promise<string> {
    const seq = Math.floor(Math.random() * 1_000_000);
    const row = await pool.query<{ id: string }>(
      `INSERT INTO bil.billing_documents (
         billing_record_id, service_order_id, measurement_id, client_id, unit_id,
         document_number, sequence_year, sequence_number, version_number, status,
         document_category, emitter_legal_name, emitter_tax_id,
         emitter_address_snapshot, client_legal_name_snapshot, billing_address_snapshot,
         commercial_reference_snapshot, currency_code, payment_terms, total_amount,
         due_date, issued_at, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, $5, $6, 2026, $7, 1, 'CANCELLED', 'FATURA',
                 'CISNE', '00.000.000/0000-00', '{}'::jsonb, 'Cliente', '{}'::jsonb,
                 '{}'::jsonb, 'BRL', '30 DDL', $8, $9::date, NOW(), 1, $10, $10)
       RETURNING id`,
      [recordId, soId, measurementId, clientId, unit, `NF-${seq}`, seq, amount, dueDate, actor],
    );
    return row.rows[0]!.id;
  }

  async function receivable(
    docId: string,
    recordId: string,
    soId: string,
    measurementId: string,
    clientId: string,
    unit: string,
    actor: string,
    principal: string,
    dueDate: string,
    lifecycle: 'ACTIVE' | 'CANCELLED' = 'ACTIVE',
  ): Promise<string> {
    // receivables_cancelled_consistency_chk: CANCELLED exige cancelled_at + cancel_reason.
    const cancelColumns = lifecycle === 'CANCELLED' ? ', cancelled_at, cancel_reason' : '';
    const cancelValues = lifecycle === 'CANCELLED' ? ', NOW(), $11' : '';
    const params: string[] = [unit, clientId, docId, recordId, soId, measurementId, principal, dueDate, lifecycle, actor];
    if (lifecycle === 'CANCELLED') {
      params.push('CANCELADO EM TESTE');
    }
    const row = await pool.query<{ id: string }>(
      `INSERT INTO fin.receivables (
         unit_id, client_id, origin_kind, origin_billing_document_id,
         origin_billing_record_id, origin_service_order_id, origin_measurement_id,
         principal, currency_code, due_date, payment_terms, lifecycle, row_version,
         created_by_identity_id, updated_by_identity_id${cancelColumns}
       ) VALUES ($1, $2, 'BILLING_DOCUMENT', $3, $4, $5, $6, $7, 'BRL', $8::date,
                 '30 DDL', $9, 1, $10, $10${cancelValues})
       RETURNING id`,
      params,
    );
    return row.rows[0]!.id;
  }

  async function settle(receivableId: string, amount: string): Promise<void> {
    await pool.query(
      `INSERT INTO fin.settlements (
         receivable_id, amount, currency_code, status, settled_at, actor_identity_id, idempotency_key
       ) VALUES ($1, $2, 'BRL', 'POSTED', NOW(), $3, $4)`,
      [receivableId, amount, actorId, crypto.randomUUID()],
    );
  }

  async function chain(input: {
    unit: string;
    principal: string;
    dueDate: string;
    settlements?: string[];
    lifecycle?: 'ACTIVE' | 'CANCELLED';
  }): Promise<string> {
    const clientId = await newClient(input.unit);
    const soId = await newServiceOrder(input.unit, actorId);
    const mId = await newMeasurement(soId, input.unit, actorId);
    const brId = await billingRecord(soId, clientId, input.unit, actorId, input.principal);
    const docId = await billingDocument(
      brId,
      soId,
      mId,
      clientId,
      input.unit,
      actorId,
      input.principal,
      input.dueDate,
    );
    const recId = await receivable(
      docId,
      brId,
      soId,
      mId,
      clientId,
      input.unit,
      actorId,
      input.principal,
      input.dueDate,
      input.lifecycle,
    );
    for (const amount of input.settlements ?? []) {
      await settle(recId, amount);
    }
    return recId;
  }

  async function positions(recId: string) {
    const positionSql: string = buildReceivablePositionsSql({
      scopeClause: 'TRUE',
      tzParam: "'America/Porto_Velho'",
      asOfParam: `'${REF}'`,
    });
    const result = await pool.query<{ status: string; remaining: string }>(
      `SELECT status, remaining::text AS remaining
       FROM (${positionSql}) p
       WHERE p.id = $1::uuid`,
      [recId],
    );
    return result.rows[0];
  }

  it('classifica a cadeia completa (10 cenarios) pela posicao canonica', async () => {
    const open = await chain({ unit: 'unit-open', principal: '1000.0000', dueDate: '2026-09-16' });
    const partial = await chain({ unit: 'unit-partial', principal: '1000.0000', dueDate: '2026-09-16', settlements: ['400.0000'] });
    const paid = await chain({ unit: 'unit-paid', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['1000.0000'] });
    const overdue = await chain({ unit: 'unit-overdue', principal: '1000.0000', dueDate: '2026-09-14' });
    const overduePartial = await chain({ unit: 'unit-overdue-partial', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['300.0000'] });
    const cancelled = await chain({ unit: 'unit-cancelled', principal: '900.0000', dueDate: '2026-09-14', lifecycle: 'CANCELLED' });
    const multiple = await chain({ unit: 'unit-multi', principal: '1000.0000', dueDate: '2026-09-16', settlements: ['200.0000', '300.0000'] });
    // reversao: paga depois estorna (DELETE do settlement) -> volta a overdue integral
    const reversal = await chain({ unit: 'unit-reversal', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['1000.0000'] });
    await pool.query('DELETE FROM fin.settlements WHERE receivable_id = $1', [reversal]);
    // documento sem recebivel: apenas doc/record criados (sem receivable) -> ausente da posicao
    const clientId = await newClient('unit-norec');
    const soId = await newServiceOrder('unit-norec', actorId);
    const mId = await newMeasurement(soId, 'unit-norec', actorId);
    const brId = await billingRecord(soId, clientId, 'unit-norec', actorId, '500.0000');
    await billingDocument(brId, soId, mId, clientId, 'unit-norec', actorId, '500.0000', '2026-09-14');

    const norecCount = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM (${buildReceivablePositionsSql({
         scopeClause: 'TRUE',
         tzParam: "'America/Porto_Velho'",
         asOfParam: `'${REF}'`,
       })}) p
       WHERE p.unit_id = 'unit-norec'`,
    );
    expect(norecCount.rows[0]!.count).toBe(0);

    expect((await positions(open))?.status).toBe('OPEN');
    expect((await positions(partial))?.status).toBe('PARTIALLY_PAID');
    expect((await positions(partial))?.remaining).toBe('600.0000');
    expect((await positions(paid))?.status).toBe('PAID');
    expect((await positions(overdue))?.status).toBe('OVERDUE');
    expect((await positions(overdue))?.remaining).toBe('1000.0000');
    expect((await positions(overduePartial))?.status).toBe('OVERDUE');
    expect((await positions(overduePartial))?.remaining).toBe('700.0000');
    expect((await positions(cancelled))?.status).toBe('CANCELLED');
    expect((await positions(multiple))?.status).toBe('PARTIALLY_PAID');
    expect((await positions(multiple))?.remaining).toBe('500.0000');
    expect((await positions(reversal))?.status).toBe('OVERDUE'); // estorno => saldo integral volta
    expect((await positions(reversal))?.remaining).toBe('1000.0000');
  });

  // Semantica canonica (deriveReceivableStatus e posicao SQL): overdue somente quando
  // due_date < asOf (estrito). No proprio dia do vencimento o recebivel ainda esta a vencer.
  it('limite exato do vencimento: vencido apenas apos o dia (due == REF a vencer)', async () => {
    const dayBefore = await chain({ unit: 'unit-boundary-before', principal: '100.0000', dueDate: '2026-09-14' });
    const onDue = await chain({ unit: 'unit-boundary-due', principal: '100.0000', dueDate: REF });
    const afterDue = await chain({ unit: 'unit-boundary-after', principal: '100.0000', dueDate: '2026-09-16' });
    expect((await positions(dayBefore))?.status).toBe('OVERDUE'); // REF-1: vencido
    expect((await positions(onDue))?.status).toBe('OPEN'); // vence em REF: ainda a vencer
    expect((await positions(afterDue))?.status).toBe('OPEN'); // REF+1: a vencer
  });
});
