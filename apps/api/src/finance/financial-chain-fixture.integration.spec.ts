import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { bindFinancialChain, FINANCIAL_REF, type BoundFinancialChain } from './testing/financial-chain.fixture';

/**
 * STEP 3 — fixture deterministica da cadeia persistida:
 * service order -> billing record -> billing document -> receivable -> settlements.
 * Datas relativas a uma data de referencia explicita (nao NOW()).
 */
describe('FINANCIAL fixture chain (billing -> receivable -> settlements)', () => {
  let pool: Pool;
  let actorId: string;
  let chain: BoundFinancialChain;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    applyAuthTestEnv(url);
    pool = new Pool({ connectionString: url });
    const run = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const identity = await pool.query<{ id: string }>(
      `INSERT INTO identity.identities (id, status) VALUES (gen_random_uuid(), 'active') RETURNING id`,
    );
    actorId = identity.rows[0]!.id;
    chain = bindFinancialChain(pool, actorId, run);
  });

  afterAll(async () => {
    await pool?.end();
  });

  it('classifica a cadeia completa (10 cenarios) pela posicao canonica', async () => {
    const open = await chain.chain({ unit: 'unit-open', principal: '1000.0000', dueDate: '2026-09-16' });
    const partial = await chain.chain({ unit: 'unit-partial', principal: '1000.0000', dueDate: '2026-09-16', settlements: ['400.0000'] });
    const paid = await chain.chain({ unit: 'unit-paid', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['1000.0000'] });
    const overdue = await chain.chain({ unit: 'unit-overdue', principal: '1000.0000', dueDate: '2026-09-14' });
    const overduePartial = await chain.chain({ unit: 'unit-overdue-partial', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['300.0000'] });
    const cancelled = await chain.chain({ unit: 'unit-cancelled', principal: '900.0000', dueDate: '2026-09-14', lifecycle: 'CANCELLED' });
    const multiple = await chain.chain({ unit: 'unit-multi', principal: '1000.0000', dueDate: '2026-09-16', settlements: ['200.0000', '300.0000'] });
    // reversao: paga depois estorna (DELETE do settlement) -> volta a overdue integral
    const reversal = await chain.chain({ unit: 'unit-reversal', principal: '1000.0000', dueDate: '2026-09-14', settlements: ['1000.0000'] });
    await chain.removeSettlements(reversal);
    // documento sem recebivel: apenas doc/record criados (sem receivable) -> ausente da posicao
    const clientId = await chain.newClient('unit-norec');
    const soId = await chain.newServiceOrder('unit-norec');
    const mId = await chain.newMeasurement(soId, 'unit-norec');
    const brId = await chain.billingRecord(soId, clientId, 'unit-norec', '500.0000');
    await chain.billingDocument(brId, soId, mId, clientId, 'unit-norec', '500.0000', '2026-09-14');

    expect(await chain.positionsCountForUnit('unit-norec')).toBe(0);

    expect((await chain.positions(open))?.status).toBe('OPEN');
    expect((await chain.positions(partial))?.status).toBe('PARTIALLY_PAID');
    expect((await chain.positions(partial))?.remaining).toBe('600.0000');
    expect((await chain.positions(paid))?.status).toBe('PAID');
    expect((await chain.positions(overdue))?.status).toBe('OVERDUE');
    expect((await chain.positions(overdue))?.remaining).toBe('1000.0000');
    expect((await chain.positions(overduePartial))?.status).toBe('OVERDUE');
    expect((await chain.positions(overduePartial))?.remaining).toBe('700.0000');
    expect((await chain.positions(cancelled))?.status).toBe('CANCELLED');
    expect((await chain.positions(multiple))?.status).toBe('PARTIALLY_PAID');
    expect((await chain.positions(multiple))?.remaining).toBe('500.0000');
    expect((await chain.positions(reversal))?.status).toBe('OVERDUE'); // estorno => saldo integral volta
    expect((await chain.positions(reversal))?.remaining).toBe('1000.0000');
  });

  // Semantica canonica (deriveReceivableStatus e posicao SQL): overdue somente quando
  // due_date < asOf (estrito). No proprio dia do vencimento o recebivel ainda esta a vencer.
  it('limite exato do vencimento: vencido apenas apos o dia (due == REF a vencer)', async () => {
    const dayBefore = await chain.chain({ unit: 'unit-boundary-before', principal: '100.0000', dueDate: '2026-09-14' });
    const onDue = await chain.chain({ unit: 'unit-boundary-due', principal: '100.0000', dueDate: FINANCIAL_REF });
    const afterDue = await chain.chain({ unit: 'unit-boundary-after', principal: '100.0000', dueDate: '2026-09-16' });
    expect((await chain.positions(dayBefore))?.status).toBe('OVERDUE'); // REF-1: vencido
    expect((await chain.positions(onDue))?.status).toBe('OPEN'); // vence em REF: ainda a vencer
    expect((await chain.positions(afterDue))?.status).toBe('OPEN'); // REF+1: a vencer
  });
});
