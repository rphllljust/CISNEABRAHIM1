/**
 * BIG WAVE 06 — BASELINE DE PERFORMANCE (medicao real, PostgreSQL real).
 *
 * Mede SOMENTE os alvos declarados na wave:
 *   - GET /finance/receivables  (ReceivablesAccessService.list)
 *   - GET /finance/payables     (PayablesAccessService.list)
 *
 * Para cada alvo registra: latencia (p50 de 5 execucoes), query count, distribuicao
 * de queries por origem (authz / audit / lista / filhos), linhas processadas e payload.
 *
 * Nao usa cache, nao usa mock de banco: o pool REAL e instrumentado no `query`.
 */
import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { FinanceModule } from '../finance/finance.module';
import { ReceivablesRepository } from '../finance/repositories/receivables.repository';
import { ReceivablesAccessService } from '../finance/services/receivables-access.service';
import { PayablesAccessService } from '../finance/services/payables-access.service';
import { DatabaseService } from '../infrastructure/database/database.service';

const UNIT_A = 'unit-perf-wave06';
const ROWS = Number.parseInt(process.env['PERF_WAVE06_ROWS'] ?? '50', 10);

type Bucket = 'authz-grants' | 'authz-roles' | 'authz-audit' | 'list' | 'children' | 'other';

function bucketOf(sql: string): Bucket {
  const text = sql.replace(/\s+/g, ' ');
  if (text.includes('decision_audits')) return 'authz-audit';
  if (text.includes('access_role_assignments')) return 'authz-roles';
  if (text.includes('"authorization".grants')) return 'authz-grants';
  if (/FROM fin\.(receivables|payables)( |$)/.test(text)) return 'list';
  if (text.includes('fin.receivable_installments')) return 'children';
  if (text.includes('fin.settlements')) return 'children';
  if (text.includes('fin.payable_installments')) return 'children';
  if (text.includes('fin.payments')) return 'children';
  return 'other';
}

type Counter = {
  total: number;
  byBucket: Record<Bucket, number>;
  texts: Map<string, number>;
};

type ObservableQuery = (
  config: string | { text: string },
  values?: unknown[],
  callback?: unknown,
) => Promise<unknown>;

function instrument(pool: Pool, counter: Counter): () => void {
  const target = pool as unknown as { query: ObservableQuery };
  const original = target.query;

  target.query = (config, values, callback) => {
    const sql = typeof config === 'string' ? config : config.text;
    counter.total += 1;
    counter.byBucket[bucketOf(sql)] += 1;
    const key = sql.replace(/\s+/g, ' ').trim().slice(0, 90);
    counter.texts.set(key, (counter.texts.get(key) ?? 0) + 1);
    return original.call(pool, config, values, callback);
  };

  return () => {
    target.query = original;
  };
}

function newCounter(): Counter {
  return {
    total: 0,
    byBucket: {
      'authz-grants': 0,
      'authz-roles': 0,
      'authz-audit': 0,
      list: 0,
      children: 0,
      other: 0,
    },
    texts: new Map(),
  };
}

async function measure<T>(fn: () => Promise<T>, runs = 5) {
  const durations: number[] = [];
  let value: T | undefined;
  for (let index = 0; index < runs; index += 1) {
    const started = performance.now();
    value = await fn();
    durations.push(performance.now() - started);
  }
  durations.sort((a, b) => a - b);
  return {
    p50: durations[Math.floor(durations.length / 2)] ?? 0,
    min: durations[0] ?? 0,
    max: durations[durations.length - 1] ?? 0,
    value: value as T,
  };
}

describe('BIG WAVE 06 — baseline de performance (receivables / payables)', () => {
  let pool: Pool;
  let receivablesAccess: ReceivablesAccessService;
  let payablesAccess: PayablesAccessService;
  let receivablesRepository: ReceivablesRepository;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    receivablesAccess = module.get(ReceivablesAccessService);
    payablesAccess = module.get(PayablesAccessService);
    receivablesRepository = module.get(ReceivablesRepository);
    const databaseService = module.get(DatabaseService);
    const connection = databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    pool = connection.pool;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`perf-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    const grants: Array<{ action: string; resourceType: string }> = [
      { action: AUTHZ_ACTIONS.FinanceReceivableRead, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
      { action: AUTHZ_ACTIONS.FinanceReceivableList, resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable },
      { action: AUTHZ_ACTIONS.FinancePayableRead, resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable },
      { action: AUTHZ_ACTIONS.FinancePayableList, resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable },
      { action: AUTHZ_ACTIONS.FinancePayableOpen, resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable },
      {
        action: AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      },
    ];
    for (const grant of grants) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'perf-session' };
  }

  it('coleta o baseline dos alvos da wave', async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);

    const actor = await seedActor();

    // ---- seed: N recebiveis, cada um com 3 parcelas e 1 liquidacao -----------
    const seeded: string[] = [];
    for (let index = 0; index < ROWS; index += 1) {
      const opened = await receivablesAccess.openFromBilling({
        billingRecordId: crypto.randomUUID(),
        billingDocumentId: crypto.randomUUID(),
        serviceOrderId: crypto.randomUUID(),
        measurementId: crypto.randomUUID(),
        unitId: UNIT_A,
        clientId: crypto.randomUUID(),
        principal: '300.0000',
        currencyCode: 'BRL',
        dueDate: '2099-12-31',
        paymentTerms: '30 DDL',
        actorIdentityId: actor.identityId,
        installments: [
          { installmentNumber: 1, principal: '100.0000', dueDate: '2099-01-31' },
          { installmentNumber: 2, principal: '100.0000', dueDate: '2099-02-28' },
          { installmentNumber: 3, principal: '100.0000', dueDate: '2099-03-31' },
        ],
      });
      seeded.push(opened.receivableId);
    }

    // Liquidacoes reais via repositorio (sem authz) para que listSettlements nao volte vazio.
    for (const receivableId of seeded.slice(0, Math.floor(ROWS / 2))) {
      const row = await receivablesRepository.findById(receivableId);
      if (!row) continue;
      await receivablesRepository.settle({
        receivableId,
        amount: '100.0000',
        currencyCode: 'BRL',
        rowVersion: row.row_version,
        idempotencyKey: crypto.randomUUID(),
        settledAt: new Date().toISOString(),
        actorIdentityId: actor.identityId,
      });
    }

    // ---- seed: N contas a pagar, cada uma com 3 parcelas --------------------
    const payablesSeeded: string[] = [];
    const category = await payablesAccess.createExpenseCategory(actor, {
      code: `PERF-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Servicos',
    });
    for (let index = 0; index < ROWS; index += 1) {
      const opened = await payablesAccess.open(actor, {
        unitId: UNIT_A,
        counterpartyId: crypto.randomUUID(),
        originKind: 'SUPPLIER_INVOICE',
        originId: crypto.randomUUID(),
        originReference: `NFS-${index}`,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-OPS',
        principal: '300.0000',
        currencyCode: 'BRL',
        dueDate: '2099-12-31',
        paymentTerms: '30 DDL',
        installments: [
          { installmentNumber: 1, principal: '100.0000', dueDate: '2099-01-31' },
          { installmentNumber: 2, principal: '100.0000', dueDate: '2099-02-28' },
          { installmentNumber: 3, principal: '100.0000', dueDate: '2099-03-31' },
        ],
      });
      payablesSeeded.push(opened.id);
    }

    const rowsSeeded = seeded.length + payablesSeeded.length;
    expect(rowsSeeded).toBe(ROWS * 2);

    // ---- medicao: receivables ----------------------------------------------
    const receivablesCounter = newCounter();
    const restoreReceivables = instrument(pool, receivablesCounter);
    const receivablesRun = await measure(() => receivablesAccess.list(actor), 5);
    restoreReceivables();

    // ---- medicao: payables --------------------------------------------------
    const payablesCounter = newCounter();
    const restorePayables = instrument(pool, payablesCounter);
    const payablesRun = await measure(() => payablesAccess.list(actor), 5);
    restorePayables();

    const report = {
      rowsSeeded: ROWS,
      receivables: {
        p50Ms: Number(receivablesRun.p50.toFixed(2)),
        minMs: Number(receivablesRun.min.toFixed(2)),
        maxMs: Number(receivablesRun.max.toFixed(2)),
        queriesPerRequest: receivablesCounter.total,
        byBucket: receivablesCounter.byBucket,
        rowsReturned: receivablesRun.value.length,
        payloadBytes: Buffer.byteLength(JSON.stringify(receivablesRun.value), 'utf8'),
        topSql: [...receivablesCounter.texts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([text, count]) => `${count}x ${text}`),
      },
      payables: {
        p50Ms: Number(payablesRun.p50.toFixed(2)),
        minMs: Number(payablesRun.min.toFixed(2)),
        maxMs: Number(payablesRun.max.toFixed(2)),
        queriesPerRequest: payablesCounter.total,
        byBucket: payablesCounter.byBucket,
        rowsReturned: payablesRun.value.length,
        payloadBytes: Buffer.byteLength(JSON.stringify(payablesRun.value), 'utf8'),
        topSql: [...payablesCounter.texts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 6)
          .map(([text, count]) => `${count}x ${text}`),
      },
    };

    console.log(`\n=== BIG WAVE 06 BASELINE ===\n${JSON.stringify(report, null, 2)}\n=== END ===\n`);

    // ---- carga controlada: 30 requisicoes concorrentes por alvo ---------------
    const loadOf = async (label: string, fn: () => Promise<unknown>, concurrency: number) => {
      const durations: number[] = [];
      let errors = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          const started = performance.now();
          try {
            await fn();
          } catch {
            errors += 1;
          }
          durations.push(performance.now() - started);
        }),
      );
      durations.sort((a, b) => a - b);
      return {
        label,
        concurrency,
        errors,
        p50: Number((durations[Math.floor(durations.length / 2)] ?? 0).toFixed(2)),
        p95: Number((durations[Math.floor(durations.length * 0.95)] ?? durations[durations.length - 1] ?? 0).toFixed(2)),
        max: Number((durations[durations.length - 1] ?? 0).toFixed(2)),
      };
    };

    const loadCounter = newCounter();
    const restoreLoad = instrument(pool, loadCounter);
    const loadStarted = Date.now();
    const load = [
      await loadOf('receivables.list', () => receivablesAccess.list(actor), 30),
      await loadOf('payables.list', () => payablesAccess.list(actor), 30),
    ];
    restoreLoad();

    // ---- EXPLAIN dos planos das queries alteradas ---------------------------
    const planOf = async (sql: string, values: unknown[]) => {
      const result = await pool.query<Record<string, unknown>>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, values);
      return result.rows.map((row) => String(Object.values(row)[0])).join('\n');
    };
    const plans = {
      // ANTES: uma query por linha (WHERE receivable_id = $1) — plano de referencia.
      installmentsPerRowBefore: await planOf(
        `SELECT id, receivable_id, installment_number, principal::text AS principal, due_date::text AS due_date, created_at
         FROM fin.receivable_installments WHERE receivable_id = $1 ORDER BY installment_number`,
        [seeded[0]],
      ),
      settlementsPerRowBefore: await planOf(
        `SELECT id, receivable_id, installment_id, amount::text AS amount FROM fin.settlements
         WHERE receivable_id = $1 ORDER BY settled_at, created_at`,
        [seeded[0]],
      ),
      installmentsBatch: await planOf(
        `SELECT id, receivable_id, installment_number, principal::text AS principal, due_date::text AS due_date, created_at
         FROM fin.receivable_installments WHERE receivable_id = ANY($1::uuid[]) ORDER BY receivable_id, installment_number`,
        [seeded],
      ),
      settlementsBatch: await planOf(
        `SELECT id, receivable_id, installment_id, amount::text AS amount FROM fin.settlements
         WHERE receivable_id = ANY($1::uuid[]) ORDER BY receivable_id, settled_at, created_at`,
        [seeded],
      ),
      payablesInstallmentsBatch: await planOf(
        `SELECT id, payable_id, installment_number, principal::text AS principal FROM fin.payable_installments
         WHERE payable_id = ANY($1::uuid[]) ORDER BY payable_id, installment_number`,
        [payablesSeeded],
      ),
      paymentsBatch: await planOf(
        `SELECT id, payable_id, installment_id, amount::text AS amount FROM fin.payments
         WHERE payable_id = ANY($1::uuid[]) ORDER BY payable_id, paid_at, created_at`,
        [payablesSeeded],
      ),
    };

    console.log(
      `\n=== BIG WAVE 06 LOAD + PLAN ===\n${JSON.stringify(
        {
          load,
          loadWallClockMs: Date.now() - loadStarted,
          loadQueriesTotal: loadCounter.total,
          poolMax: process.env['DATABASE_POOL_MAX'] ?? '10',
          plans,
        },
        null,
        2,
      )}\n=== END ===\n`,
    );
  });
});
