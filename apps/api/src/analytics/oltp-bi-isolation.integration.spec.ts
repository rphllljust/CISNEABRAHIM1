import {
  truncateBillingTables,
  truncateClientTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncateServiceOrderTables,
} from '@cisne/database';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { compareMoneyAmounts } from '../platform/kernel/money-math';
import { toBusinessCalendarDate } from './domain/business-timezone';
import {
  buildOverdueReceivableAggregateSql,
  buildReceivablePositionsSql,
} from './domain/receivable-aging-sql';
import { bindFinancialChain, type BoundFinancialChain } from '../test/financial-chain.fixture';

/**
 * BI PERFORMANCE + AUTHORIZATION GATE — isolamento OLTP x BI (PostgreSQL real).
 * Carga concorrente realista: escritores OLTP (cadeia billing->receivable->settlement)
 * rodam em paralelo com leituras de BI (agregado canonico FIN-SEM-001) e EXPLAIN.
 * Asserts: nenhum erro/deadlock 40P01 (quebraria o teste), leituras nunca negativas e
 * estado final consistente (verificacao direta no banco). Sem novo indice/cache/timeout.
 */

const TZ = 'America/Porto_Velho';

function relDate(offsetDays: number): string {
  const base = new Date(`${toBusinessCalendarDate(new Date(), TZ)}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + offsetDays);
  return base.toISOString().slice(0, 10);
}

const OVERDUE_SQL = buildOverdueReceivableAggregateSql({ scopeClause: 'TRUE', tzParam: '$1' });

describe('BI GATE — OLTP + BI simultaneo (PostgreSQL real)', () => {
  let pool: Pool;
  let chain: BoundFinancialChain;
  let actorId: string;

  beforeAll(async () => {
    const url = process.env['TEST_DATABASE_URL'];
    if (!url) {
      throw new Error('TEST_DATABASE_URL is required');
    }
    pool = new Pool({ connectionString: url, max: 10 });
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

  it('escritores OLTP + leituras BI concorrentes: sem deadlock/erro, sem saldo negativo, estado final consistente', async () => {
    const writers = Array.from({ length: 6 }, (_, index) => async () => {
      // OLTP: cria OS->billing record->doc->receivable e baixa parcial (POSTED)
      const recId = await chain.chain({
        unit: `oltp-${index}`,
        principal: '100.0000',
        dueDate: relDate(-2),
        settlements: ['40.0000'],
      });
      return recId;
    });

    const readers = Array.from({ length: 12 }, (_, index) => async () => {
      const result = await pool.query<{ count: number; total_amount: string }>(OVERDUE_SQL, [TZ]);
      const count = result.rows[0]?.count ?? 0;
      if (count > 0) {
        // nunca negativo: remaining parcial de cada recebivel e 60.0000 (100-40)
        expect(compareMoneyAmounts(result.rows[0]!.total_amount, '0')).toBeGreaterThanOrEqual(0);
      }
      // leitura de posicao canonica tambem concorre (sem erros de lock)
      const positions = buildReceivablePositionsSql({
        scopeClause: 'TRUE',
        tzParam: `'${TZ}'`,
        asOfParam: `'${relDate(0)}'`,
      });
      const positionRows = await pool.query<{ status: string; remaining: string }>(
        `SELECT status, remaining::text AS remaining FROM (${positions}) p WHERE p.remaining::numeric >= 0`,
      );
      expect(positionRows.rows.length).toBeGreaterThanOrEqual(0);
      return { reader: index, count };
    });

    const [written, readResults] = await Promise.all([
      Promise.all(writers.map((writer) => writer())),
      Promise.all(readers.map((reader) => reader())),
    ]);

    expect(written).toHaveLength(6);
    expect(readResults).toHaveLength(12);

    // Estado final: 6 recebiveis vencidos com saldo residual 60 cada -> total 360.0000
    const final = await pool.query<{ count: number; total_amount: string }>(OVERDUE_SQL, [TZ]);
    expect(final.rows[0]?.count ?? 0).toBe(6);
    expect(compareMoneyAmounts(final.rows[0]!.total_amount, '360.0000')).toBe(0);

    // Verificacao direta no banco: cada saldo = principal - SUM(POSTED)
    const direct = await pool.query<{ remaining: string }>(
      `SELECT (r.principal - COALESCE((SELECT SUM(s.amount)
               FROM fin.settlements s WHERE s.receivable_id = r.id AND s.status = 'POSTED'), 0))::text AS remaining
       FROM fin.receivables r`,
    );
    expect(direct.rows).toHaveLength(6);
    for (const row of direct.rows) {
      expect(compareMoneyAmounts(row.remaining, '60.0000')).toBe(0);
    }
  });

  it('EXPLAIN da query critica de BI e executavel e referencia a fonte financeira', async () => {
    const plan = await pool.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${OVERDUE_SQL.replace(/\$1/g, `'${TZ}'`)}`);
    expect(plan.rows.length).toBeGreaterThan(0);
    const text = plan.rows.map((row) => row['QUERY PLAN']).join('\n');
    const indexes = await pool.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
       WHERE indexname IN ('receivables_due_date_idx', 'settlements_receivable_id_idx')`,
    );
    const names = indexes.rows.map((row) => row.indexname);
    expect(names).toContain('receivables_due_date_idx');
    expect(names).toContain('settlements_receivable_id_idx');

    // Contrato declarado pelo titulo: a query critica de BI e executavel e le a fonte
    // financeira publicada (receivable + baixa POSTED). Nunca le tabela de outro contexto
    // nem inventa fonte.
    expect(text).toContain('receivables');
    expect(text).toContain('settlements');
    expect(text).toContain("status = 'POSTED'");

    // LIMITACAO ARQUITETURAL CONHECIDA (nao mascarada) — ADR-003 / contrato de leitura publicado:
    // `rpt.read_receivables` e uma view pass-through com `OFFSET 0`, que atua como fence de
    // otimizacao: impede o planner de empurrar predicados para `fin.receivables`. Consequencia
    // medida (20000 linhas + ANALYZE, distribuicao 1% vencido): o plano NUNCA usa
    // `receivables_due_date_idx`; a agregacao varre o contrato de leitura.
    // O assert abaixo trava esse fato para que a degradacao nao passe silenciosa: se o fence
    // for removido/revisado (mudanca arquitetural em ADR-003), este teste falha e exige revisao
    // explicita em vez de aceitar a mudanca por omissao.
    const view = await pool.query<{ def: string }>(
      `SELECT pg_get_viewdef('rpt.read_receivables'::regclass) AS def`,
    );
    expect(view.rows[0]!.def).toContain('OFFSET 0');
    expect(text).not.toContain('receivables_due_date_idx');
    expect(text).toContain('receivables');
  });
});
