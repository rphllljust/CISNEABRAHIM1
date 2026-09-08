import {
  truncateBillingTables,
  truncateClientTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { toBusinessCalendarDate } from '../analytics/domain/business-timezone';
import { compareMoneyAmounts } from '../platform/kernel/money-math';
import {
  buildAwaitingReceivableAggregateSql,
  buildOverdueReceivableAggregateSql,
} from './domain/receivable-aging-sql';
import { bindFinancialChain, type BoundFinancialChain } from './testing/financial-chain.fixture';

/**
 * FINANCIAL AGING CONSISTENCY — fechamento.
 * - Concorrencia pagamento x leitura canonica (FIN-SEM-001): saldo nunca negativo,
 *   sequencia monotona nao-crescente e exclusao apos pagamento integral (zero real).
 * - Invariante de schema: settlement_status so possui POSTED; builder canonicos filtram
 *   s.status = 'POSTED' (defesa em profundidade; nao-POSTED nao e representavel).
 * Dinheiro somente string numeric. Base PostgreSQL real.
 */

const TZ = 'America/Porto_Velho';

function relDate(offsetDays: number): string {
  const base = new Date(`${toBusinessCalendarDate(new Date(), TZ)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

const OVERDUE_SQL = buildOverdueReceivableAggregateSql({ scopeClause: 'TRUE', tzParam: '$1' });
const AWAITING_SQL = buildAwaitingReceivableAggregateSql({ scopeClause: 'TRUE', tzParam: '$1' });

describe('FINANCIAL AGING CONSISTENCY - concorrencia e invariante POSTED (PostgreSQL real)', () => {
  let pool: Pool;
  let chain: BoundFinancialChain;
  let actorId: string;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    pool = new Pool({ connectionString: url });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateBillingTables(pool);
    await truncateServiceOrderTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    const run = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.identities (id, status) VALUES (gen_random_uuid(), 'active') RETURNING id`,
    );
    actorId = identity.rows[0]!.id;
    chain = bindFinancialChain(pool, actorId, run);
  }, 60_000);

  afterAll(async () => {
    if (pool) {
      await truncateFinanceTables(pool);
      await truncateBillingTables(pool);
      await truncateServiceOrderTables(pool);
      await truncateClientTables(pool);
      await truncateIdentityAndAuthorizationTables(pool);
    }
    await pool?.end();
  });

  it('pagamentos intercalados com leitura canonica: saldo nunca negativo, monotono e exclusao no integral (zero real)', async () => {
    const overdueRec = await chain.chain({ unit: 'fc-overdue', principal: '1000.0000', dueDate: relDate(-1) });
    // controle a vencer: permanece inalterado durante os pagamentos do recebivel vencido
    await chain.chain({ unit: 'fc-control', principal: '500.0000', dueDate: relDate(10) });

    const observed: string[] = [];
    for (let step = 1; step <= 10; step += 1) {
      await chain.settle(overdueRec, '100.0000');
      const read = await pool.query<{ count: number; total_amount: string }>(OVERDUE_SQL, [TZ]);
      if ((read.rows[0]?.count ?? 0) > 0) {
        observed.push(read.rows[0]!.total_amount);
      }
    }

    // 10 pagamentos de 100: leituras intermediarias 900..100 (estritamente decrescente), nunca < 0
    expect(observed.length).toBe(9);
    const expected = ['900.0000', '800.0000', '700.0000', '600.0000', '500.0000', '400.0000', '300.0000', '200.0000', '100.0000'];
    observed.forEach((value, index) => {
      expect(compareMoneyAmounts(value, expected[index]!)).toBe(0);
      if (index > 0) {
        expect(compareMoneyAmounts(value, observed[index - 1]!)).toBeLessThan(0);
      }
    });

    // apos pagamento integral: recebivel vencido some do overdue (saldo = 0) e o controle a vencer permanece
    const overdueFinal = await pool.query<{ count: number; total_amount: string }>(OVERDUE_SQL, [TZ]);
    expect(overdueFinal.rows[0]?.count ?? 0).toBe(0);
    const awaitingFinal = await pool.query<{ count: number; total_amount: string }>(AWAITING_SQL, [TZ]);
    expect(awaitingFinal.rows[0]?.count ?? 0).toBe(1);
    expect(compareMoneyAmounts(awaitingFinal.rows[0]!.total_amount, '500.0000')).toBe(0);

    // verificacao direta no banco: saldo = principal - SUM(settlements POSTED) = 0
    const direct = await pool.query<{ remaining: string }>(
      `SELECT (r.principal - COALESCE((SELECT SUM(s.amount)
               FROM fin.settlements s WHERE s.receivable_id = r.id AND s.status = 'POSTED'), 0))::text AS remaining
       FROM fin.receivables r WHERE r.id = $1`,
      [overdueRec],
    );
    expect(compareMoneyAmounts(direct.rows[0]!.remaining, '0')).toBe(0);
  });

  it('invariante: settlement_status so POSTED (nao-POSTED nao representavel) e builders filtram POSTED', async () => {
    const labels = await pool.query<{ enumlabel: string }>(
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'settlement_status'
       ORDER BY e.enumsortorder`,
    );
    expect(labels.rows.map((row) => row.enumlabel)).toEqual(['POSTED']);
    expect(OVERDUE_SQL).toContain("s.status = 'POSTED'");
    expect(AWAITING_SQL).toContain("s.status = 'POSTED'");
  });
});
