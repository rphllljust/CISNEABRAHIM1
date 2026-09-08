import type { Pool } from 'pg';
import { buildReceivablePositionsSql } from '../domain/receivable-aging-sql';

/**
 * Fixture deterministica da cadeia persistida (FIN-SEM-001):
 * service order -> billing record -> billing document -> receivable -> settlements.
 * Datas relativas a uma data de referencia explicita (nao NOW()) para classificacao.
 * Nenhum numero em TS para dinheiro: valores sao sempre string numerica (numeric).
 */
export const FINANCIAL_REF = '2026-09-15';

export type ChainLifecycle = 'ACTIVE' | 'CANCELLED';

export type ChainInput = {
  unit: string;
  principal: string;
  dueDate: string;
  settlements?: string[];
  lifecycle?: ChainLifecycle;
};

export type BoundFinancialChain = {
  newClient: (unit: string) => Promise<string>;
  newServiceOrder: (unit: string) => Promise<string>;
  newMeasurement: (soId: string, unit: string) => Promise<string>;
  billingRecord: (soId: string, clientId: string, unit: string, amount: string) => Promise<string>;
  billingDocument: (
    recordId: string,
    soId: string,
    measurementId: string,
    clientId: string,
    unit: string,
    amount: string,
    dueDate: string,
  ) => Promise<string>;
  receivable: (
    docId: string,
    recordId: string,
    soId: string,
    measurementId: string,
    clientId: string,
    unit: string,
    principal: string,
    dueDate: string,
    lifecycle?: ChainLifecycle,
  ) => Promise<string>;
  settle: (receivableId: string, amount: string) => Promise<void>;
  removeSettlements: (receivableId: string) => Promise<void>;
  chain: (input: ChainInput) => Promise<string>;
  positions: (receivableId: string) => Promise<{ status: string; remaining: string } | undefined>;
  /** Conta recebiveis na posicao canonica de uma unidade (0 = nenhum recebivel persistido). */
  positionsCountForUnit: (unit: string) => Promise<number>;
};

export function bindFinancialChain(pool: Pool, actorId: string, run: string): BoundFinancialChain {
  async function newClient(unit: string): Promise<string> {
    const tax = String(Math.floor(1e13 + Math.random() * 9e13));
    const row = await pool.query<{ id: string }>(
      `INSERT INTO pty.clients (legal_name, normalized_tax_id) VALUES ($1, $2) RETURNING id`,
      [`Cliente ${unit}`, tax],
    );
    return row.rows[0]!.id;
  }

  async function newServiceOrder(unit: string): Promise<string> {
    const code = `SO-CH-${run}-${unit}-${crypto.randomUUID().slice(0, 4)}`;
    const row = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, status, origin, service_snapshot,
         client_snapshot, started_at, completed_at, row_version,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'COMPLETED', 'AUTHORIZED_DIRECT', '{}'::jsonb,
                 '{}'::jsonb, NOW() - interval '2 hours', NOW() - interval '1 hour', 1, $4, $4)
       RETURNING id`,
      [code, code, unit, actorId],
    );
    return row.rows[0]!.id;
  }

  async function newMeasurement(soId: string, unit: string): Promise<string> {
    const row = await pool.query<{ id: string }>(
      `INSERT INTO msr.measurements (
         service_order_id, unit_id, status, row_version, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, 'APPROVED', 1, $3, $3) RETURNING id`,
      [soId, unit, actorId],
    );
    return row.rows[0]!.id;
  }

  async function billingRecord(
    soId: string,
    clientId: string,
    unit: string,
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
      [soId, clientId, unit, amount, actorId],
    );
    return row.rows[0]!.id;
  }

  async function billingDocument(
    recordId: string,
    soId: string,
    measurementId: string,
    clientId: string,
    unit: string,
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
      [recordId, soId, measurementId, clientId, unit, `NF-${seq}`, seq, amount, dueDate, actorId],
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
    principal: string,
    dueDate: string,
    lifecycle: ChainLifecycle = 'ACTIVE',
  ): Promise<string> {
    // receivables_cancelled_consistency_chk: CANCELLED exige cancelled_at + cancel_reason.
    const cancelColumns = lifecycle === 'CANCELLED' ? ', cancelled_at, cancel_reason' : '';
    const cancelValues = lifecycle === 'CANCELLED' ? ', NOW(), $11' : '';
    const params: string[] = [unit, clientId, docId, recordId, soId, measurementId, principal, dueDate, lifecycle, actorId];
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

  async function removeSettlements(receivableId: string): Promise<void> {
    await pool.query('DELETE FROM fin.settlements WHERE receivable_id = $1', [receivableId]);
  }

  async function chain(input: ChainInput): Promise<string> {
    const clientId = await newClient(input.unit);
    const soId = await newServiceOrder(input.unit);
    const mId = await newMeasurement(soId, input.unit);
    const brId = await billingRecord(soId, clientId, input.unit, input.principal);
    const docId = await billingDocument(brId, soId, mId, clientId, input.unit, input.principal, input.dueDate);
    const recId = await receivable(
      docId,
      brId,
      soId,
      mId,
      clientId,
      input.unit,
      input.principal,
      input.dueDate,
      input.lifecycle,
    );
    for (const amount of input.settlements ?? []) {
      await settle(recId, amount);
    }
    return recId;
  }

  async function positions(receivableId: string) {
    const positionSql: string = buildReceivablePositionsSql({
      scopeClause: 'TRUE',
      tzParam: "'America/Porto_Velho'",
      asOfParam: `'${FINANCIAL_REF}'`,
    });
    const result = await pool.query<{ status: string; remaining: string }>(
      `SELECT status, remaining::text AS remaining
       FROM (${positionSql}) p
       WHERE p.id = $1::uuid`,
      [receivableId],
    );
    return result.rows[0];
  }

  async function positionsCountForUnit(unit: string): Promise<number> {
    const positionSql: string = buildReceivablePositionsSql({
      scopeClause: 'TRUE',
      tzParam: "'America/Porto_Velho'",
      asOfParam: `'${FINANCIAL_REF}'`,
    });
    const result = await pool.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count
       FROM (${positionSql}) p
       WHERE p.unit_id = $1`,
      [unit],
    );
    return result.rows[0]!.count;
  }

  return {
    newClient,
    newServiceOrder,
    newMeasurement,
    billingRecord,
    billingDocument,
    receivable,
    settle,
    removeSettlements,
    chain,
    positions,
    positionsCountForUnit,
  };
}
