import {
  hashPassword,
  insertIdentity,
  insertScopeRef,
  truncateBillingTables,
  truncateClientTables,
  truncateCommercialPurchaseOrderTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { PurchaseOrdersRepository } from './repositories/purchase-orders.repository';
import {
  consumePurchaseOrderBalanceForBilling,
  releasePurchaseOrderBalanceForBillingVoid,
} from './repositories/purchase-order-consumption.persistence';

/**
 * Prova do ledger do pedido de compra — producao real, ledger real, cadeia real.
 *
 * O ledger NAO e escrito a mao: os lancamentos nascem de
 * `consumePurchaseOrderBalanceForBilling` / `releasePurchaseOrderBalanceForBillingVoid`, as
 * funcoes de persistencia que a producao usa. E a cadeia e lida por
 * `PurchaseOrdersRepository.findLinkedChain`, a mesma consulta que alimenta o detalhe.
 *
 * Cadeia provada: producao -> ledger -> cadeia.
 *
 * Fixture deliberadamente minima (so o que as FKs e as views exigem): identidade, escopo de
 * unidade, cliente, pedido REGISTERED, uma OS e um registro de faturamento. Sem solicitacao,
 * sem proposta, sem medicao, sem itens — nada disso entra nos elos provados.
 */
const UNIT_A = 'unit-ledger-a';
const TEST_CNPJ = '11222333000199';

describe('Purchase order ledger chain — billing prepare/void (P0)', () => {
  let pool: Pool;
  let repository: PurchaseOrdersRepository;
  let purchaseOrderId: string;
  let billingRecordId: string;
  let identityId: string;

  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for purchase order ledger tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    pool = new Pool({ connectionString: testDatabaseUrl });
    // O repositorio so depende do pool da aplicacao.
    repository = new PurchaseOrdersRepository({
      getConnection: () => ({ pool }),
    } as never);
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateCommercialPurchaseOrderTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);

    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });

    const loginId = normalizeLoginIdentifier(`ledger-${crypto.randomUUID()}@cisne.invalid`);
    identityId = (await insertIdentity(pool, loginId, await hashPassword('Ledger1!'))).identityId;

    const client = await pool.query<{ id: string }>(
      `INSERT INTO pty.clients (legal_name, normalized_tax_id)
       VALUES ($1, $2) RETURNING id`,
      [`Cliente Ledger ${crypto.randomUUID()}`, TEST_CNPJ],
    );
    const clientId = client.rows[0]!.id;

    const po = await pool.query<{ id: string }>(
      `INSERT INTO com.purchase_orders (
         internal_code, client_id, unit_id, po_number, pricing_structure, total_amount,
         currency_code, status, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4, 'HEADER_TOTAL', $5, 'BRL', 'REGISTERED', $6, $6)
       RETURNING id`,
      [
        `PC-LEDGER-${crypto.randomUUID().slice(0, 8)}`,
        clientId,
        UNIT_A,
        `PO-LEDGER-${crypto.randomUUID().slice(0, 8)}`,
        '50000.0000',
        identityId,
      ],
    );
    purchaseOrderId = po.rows[0]!.id;

    const so = await pool.query<{ id: string }>(
      `INSERT INTO so.service_orders (
         internal_code, order_number, unit_id, origin, purchase_order_id, status,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'PURCHASE_ORDER', $4, 'DRAFT', $5, $5)
       RETURNING id`,
      [
        `OS-LEDGER-${crypto.randomUUID().slice(0, 8)}`,
        `OS-2026-L${crypto.randomUUID().slice(0, 5).toUpperCase()}`,
        UNIT_A,
        purchaseOrderId,
        identityId,
      ],
    );

    const record = await pool.query<{ id: string }>(
      `INSERT INTO bil.billing_records (
         service_order_id, client_id, unit_id, status, purchase_order_id, currency_code,
         client_legal_name_snapshot, payment_terms, payment_terms_source, total_amount,
         prepared_by_identity_id, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'PREPARED', $4, 'BRL', $5, '30 dias', 'PURCHASE_ORDER', $6, $7, $7, $7)
       RETURNING id`,
      [so.rows[0]!.id, clientId, UNIT_A, purchaseOrderId, 'Cliente Ledger LTDA', '7500.0000', identityId],
    );
    billingRecordId = record.rows[0]!.id;
  });

  async function withTransaction<T>(run: (client: import('pg').PoolClient) => Promise<T>): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async function consumedAmount(): Promise<string> {
    const result = await pool.query<{ consumed_amount: string }>(
      `SELECT consumed_amount::text AS consumed_amount FROM com.purchase_orders WHERE id = $1`,
      [purchaseOrderId],
    );
    return result.rows[0]!.consumed_amount;
  }

  async function ledgerEntries(): Promise<Array<{ entry_type: string; amount: string }>> {
    const result = await pool.query<{ entry_type: string; amount: string }>(
      `SELECT entry_type::text AS entry_type, amount::text AS amount
         FROM com.purchase_order_consumption_entries
        WHERE purchase_order_id = $1
        ORDER BY created_at ASC`,
      [purchaseOrderId],
    );
    return result.rows;
  }

  async function billingLinks() {
    const chain = await repository.findLinkedChain(purchaseOrderId);
    return chain.filter((row) => row.kind === 'BILLING_RECORD');
  }

  it('1. PREPARE consome o saldo, registra o ledger e a cadeia expoe o impacto vigente', async () => {
    await withTransaction((client) =>
      consumePurchaseOrderBalanceForBilling(client, {
        purchaseOrderId,
        billingRecordId,
        amount: '7500.0000',
        actorIdentityId: identityId,
      }),
    );

    // 1. o pedido passou a consumir exatamente o valor preparado
    expect(await consumedAmount()).toBe('7500.0000');

    // 2. existe exatamente 1 lancamento, do tipo PREPARE, com o valor preparado
    const entries = await ledgerEntries();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ entry_type: 'BILLING_PREPARE' });
    expect(Number(entries[0]!.amount)).toBe(7500);

    // 3. a cadeia devolve o BILLING_RECORD com o impacto liquido do ledger
    const links = await billingLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ id: billingRecordId, kind: 'BILLING_RECORD' });
    expect(Number(links[0]!.amount)).toBe(7500);

    // 4. o valor exposto pela cadeia e coerente com consumed_amount
    expect(Number(links[0]!.amount)).toBe(Number(await consumedAmount()));
  });

  it('2. VOID devolve o saldo e a cadeia deixa de apresentar o consumo vigente', async () => {
    await withTransaction((client) =>
      consumePurchaseOrderBalanceForBilling(client, {
        purchaseOrderId,
        billingRecordId,
        amount: '7500.0000',
        actorIdentityId: identityId,
      }),
    );
    await withTransaction((client) =>
      releasePurchaseOrderBalanceForBillingVoid(client, {
        purchaseOrderId,
        billingRecordId,
        amount: '7500.0000',
        actorIdentityId: identityId,
      }),
    );

    // 1. o consumo volta a zero
    expect(Number(await consumedAmount())).toBe(0);

    // 2. o ledger guarda os DOIS lancamentos (nao apaga historico)
    const entries = await ledgerEntries();
    expect(entries.map((entry) => entry.entry_type)).toEqual([
      'BILLING_PREPARE',
      'BILLING_VOID',
    ]);
    expect(Number(entries[0]!.amount)).toBe(7500);
    expect(Number(entries[1]!.amount)).toBe(7500);

    // 3. impacto liquido zero
    const net = entries.reduce(
      (total, entry) =>
        entry.entry_type === 'BILLING_PREPARE'
          ? total + Number(entry.amount)
          : total - Number(entry.amount),
      0,
    );
    expect(net).toBe(0);

    // 4. a cadeia NAO apresenta o lancamento estornado como consumo vigente
    expect(await billingLinks()).toHaveLength(0);
  });

  it('3. idempotencia: repetir PREPARE nao duplica e repetir VOID nao libera duas vezes', async () => {
    const prepare = (client: import('pg').PoolClient) =>
      consumePurchaseOrderBalanceForBilling(client, {
        purchaseOrderId,
        billingRecordId,
        amount: '7500.0000',
        actorIdentityId: identityId,
      });
    const release = (client: import('pg').PoolClient) =>
      releasePurchaseOrderBalanceForBillingVoid(client, {
        purchaseOrderId,
        billingRecordId,
        amount: '7500.0000',
        actorIdentityId: identityId,
      });

    await withTransaction(prepare);
    await withTransaction(prepare);
    expect(Number(await consumedAmount())).toBe(7500);
    expect(await ledgerEntries()).toHaveLength(1);

    await withTransaction(release);
    await withTransaction(release);
    expect(Number(await consumedAmount())).toBe(0);
    expect((await ledgerEntries()).map((entry) => entry.entry_type)).toEqual([
      'BILLING_PREPARE',
      'BILLING_VOID',
    ]);
    expect(await billingLinks()).toHaveLength(0);
  });
});
