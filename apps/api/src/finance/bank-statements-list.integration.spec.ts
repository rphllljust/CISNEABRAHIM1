import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_DIRECTIONS } from './domain/treasury';
import { parseBankStatementListQuery } from './dto/bank-statement-list.dto';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { BankReconciliationAccessService } from './services/bank-reconciliation-access.service';
import { TreasuryAccessService } from './services/treasury-access.service';

const UNIT_A = 'unit-stmt-a';
const UNIT_B = 'unit-stmt-b';
const DAY = '2026-09-15';

function cisneFile(
  sourceReference: string,
  lines: Array<{ sourceLineKey: string; amount: string; direction?: string }>,
  periodStartsOn = DAY,
  periodEndsOn = DAY,
): string {
  return JSON.stringify({
    format: 'CISNE_STATEMENT_V1',
    periodStartsOn,
    periodEndsOn,
    currencyCode: 'BRL',
    sourceReference,
    lines: lines.map((line) => ({
      sourceLineKey: line.sourceLineKey,
      occurredOn: periodStartsOn,
      direction: line.direction ?? FINANCIAL_DIRECTIONS.Credit,
      amount: line.amount,
      description: line.sourceLineKey,
      externalReference: null,
    })),
  });
}

async function grantRecon(pool: Pool, identityId: string, scope: string, unitId?: string) {
  for (const action of [
    AUTHZ_ACTIONS.FinanceTreasuryAccountOpen,
    AUTHZ_ACTIONS.FinanceTreasuryRead,
    AUTHZ_ACTIONS.FinanceTreasuryList,
    AUTHZ_ACTIONS.FinanceBankStatementImport,
    AUTHZ_ACTIONS.FinanceReconciliationMatch,
    AUTHZ_ACTIONS.FinanceReconciliationRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury,
      resourceId: unitId,
      scopeType: scope,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Bank statement discovery PostgreSQL integration', () => {
  let pool: Pool;
  let treasury: TreasuryAccessService;
  let recon: BankReconciliationAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for bank statement discovery tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    treasury = module.get(TreasuryAccessService);
    recon = module.get(BankReconciliationAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(scope: string = AUTHZ_SCOPES.Global, unitId?: string) {
    const login = normalizeLoginIdentifier(`bs-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    await grantRecon(pool, identityId, scope, unitId);
    return { identityId, sessionId: 'test-session' };
  }

  async function seedDeniedActor() {
    const login = normalizeLoginIdentifier(`bsx-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    return { identityId, sessionId: 'test-session' };
  }

  async function openBank(actor: { identityId: string; sessionId: string }, unitId: string) {
    return treasury.openAccount(actor, {
      unitId,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: `Conta ${unitId}`,
      currencyCode: 'BRL',
      openingAmount: '500.0000',
      bank: { bankCode: '001', agency: '0001', accountNumber: '7788-0' },
    });
  }

  async function importStatement(
    actor: { identityId: string; sessionId: string },
    unitId: string,
    accountId: string,
    sourceReference: string,
    lines: Array<{ sourceLineKey: string; amount: string; direction?: string }>,
    periodStartsOn = DAY,
    periodEndsOn = DAY,
  ) {
    return recon.importFile(actor, {
      unitId,
      financialAccountId: accountId,
      fileName: `${sourceReference}.json`,
      content: cisneFile(sourceReference, lines, periodStartsOn, periodEndsOn),
    });
  }

  it('lists statements with account, period, status and persisted line totals, newest period first', async () => {
    const actor = await seedActor();
    const bankA = await openBank(actor, UNIT_A);
    const bankB = await openBank(actor, UNIT_A);
    await importStatement(
      actor,
      UNIT_A,
      bankA.id,
      'STMT-OLDER',
      [{ sourceLineKey: 'O1', amount: '10.0000' }],
      '2026-08-01',
      '2026-08-31',
    );
    const newer = await importStatement(
      actor,
      UNIT_A,
      bankB.id,
      'STMT-NEWER',
      [
        { sourceLineKey: 'N1', amount: '25.0000' },
        { sourceLineKey: 'N2', amount: '5.0000', direction: FINANCIAL_DIRECTIONS.Debit },
      ],
      '2026-09-01',
      '2026-09-30',
    );

    const page = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ limit: '10', offset: '0' }),
    );

    expect(page.total).toBe(2);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]?.sourceReference).toBe('STMT-NEWER');
    expect(page.items[1]?.sourceReference).toBe('STMT-OLDER');

    const latest = page.items[0];
    expect(latest?.id).toBe(newer.statement?.id);
    expect(latest?.unitId).toBe(UNIT_A);
    expect(latest?.financialAccountId).toBe(bankB.id);
    // Referência humana da conta, não o identificador técnico.
    expect(latest?.financialAccount.label).toContain(latest?.financialAccount.code ?? '');
    expect(latest?.periodStartsOn).toBe('2026-09-01');
    expect(latest?.periodEndsOn).toBe('2026-09-30');
    expect(latest?.status).toBe('OPEN');
    expect(latest?.lineCount).toBe(2);
    // Totais agregados das linhas persistidas, no formato de dinheiro da API (zeros à direita
    // removidos por `formatMoneyAmountForApi`, a mesma autoridade das demais respostas do Financeiro).
    expect(latest?.creditTotal).toBe('25');
    expect(latest?.debitTotal).toBe('5');
    expect(latest?.unreconciledLineCount).toBe(2);
    expect(latest?.matchedLineCount).toBe(0);
  });

  it('filters by account, status and period window with server-side pagination', async () => {
    const actor = await seedActor();
    const bankA = await openBank(actor, UNIT_A);
    const bankB = await openBank(actor, UNIT_A);
    await importStatement(actor, UNIT_A, bankA.id, 'STMT-A1', [
      { sourceLineKey: 'A1', amount: '10.0000' },
    ]);
    await importStatement(
      actor,
      UNIT_A,
      bankB.id,
      'STMT-B1',
      [{ sourceLineKey: 'B1', amount: '20.0000' }],
      '2026-10-01',
      '2026-10-31',
    );

    const byAccount = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ financialAccountId: bankB.id }),
    );
    expect(byAccount.total).toBe(1);
    expect(byAccount.items[0]?.sourceReference).toBe('STMT-B1');

    const inWindow = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ dateFrom: '2026-10-01', dateTo: '2026-10-31' }),
    );
    expect(inWindow.total).toBe(1);
    expect(inWindow.items[0]?.sourceReference).toBe('STMT-B1');

    const outOfWindow = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ dateFrom: '2027-01-01', dateTo: '2027-12-31' }),
    );
    expect(outOfWindow.total).toBe(0);
    expect(outOfWindow.items).toHaveLength(0);

    const byStatus = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ status: 'CLOSED' }),
    );
    expect(byStatus.total).toBe(0);

    // Paginação server-side real: a página 2 devolve o extrato restante, sem duplicar a página 1.
    const firstPage = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ limit: '1', offset: '0' }),
    );
    const secondPage = await recon.listStatements(
      actor,
      parseBankStatementListQuery({ limit: '1', offset: '1' }),
    );
    expect(firstPage.items).toHaveLength(1);
    expect(secondPage.items).toHaveLength(1);
    expect(firstPage.total).toBe(2);
    expect(secondPage.total).toBe(2);
    expect(firstPage.items[0]?.id).not.toBe(secondPage.items[0]?.id);
    expect(firstPage.totalPages).toBe(2);
  });

  it('denies discovery entirely without a reconciliation read grant (no existence metadata leaks)', async () => {
    const owner = await seedActor();
    const bank = await openBank(owner, UNIT_A);
    await importStatement(owner, UNIT_A, bank.id, 'STMT-SECRET', [
      { sourceLineKey: 'S1', amount: '10.0000' },
    ]);

    const denied = await seedDeniedActor();
    await expect(
      recon.listStatements(denied, parseBankStatementListQuery({})),
    ).rejects.toBeInstanceOf(FinanceHttpException);

    // O extrato existe no banco; a negação é da autorização, e a mensagem não revela contagem nem existência.
    const persisted = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fin.bank_statements',
    );
    expect(Number(persisted.rows[0]?.count ?? '0')).toBe(1);
  });

  it('does not leak statements of units outside the actor grant scope', async () => {
    const globals = await seedActor(AUTHZ_SCOPES.Global);
    const bankA = await openBank(globals, UNIT_A);
    const bankB = await openBank(globals, UNIT_B);
    await importStatement(globals, UNIT_A, bankA.id, 'STMT-UNIT-A', [
      { sourceLineKey: 'UA', amount: '10.0000' },
    ]);
    await importStatement(globals, UNIT_B, bankB.id, 'STMT-UNIT-B', [
      { sourceLineKey: 'UB', amount: '30.0000' },
    ]);

    const unitScoped = await seedActor(AUTHZ_SCOPES.Unit, UNIT_A);
    const scoped = await recon.listStatements(unitScoped, parseBankStatementListQuery({}));
    expect(scoped.total).toBe(1);
    expect(scoped.items).toHaveLength(1);
    expect(scoped.items[0]?.unitId).toBe(UNIT_A);
    expect(scoped.items[0]?.sourceReference).toBe('STMT-UNIT-A');

    // Mesmo pedindo explicitamente a conta da outra unidade, o escopo vence o filtro.
    const cross = await recon.listStatements(
      unitScoped,
      parseBankStatementListQuery({ financialAccountId: bankB.id }),
    );
    expect(cross.total).toBe(0);
    expect(cross.items).toHaveLength(0);
  });

  it('rejects a status that is not a persisted bank statement status', async () => {
    const actor = await seedActor();
    await expect(
      recon.listStatements(actor, parseBankStatementListQuery({ status: 'RECONCILED' })),
    ).rejects.toMatchObject({ status: 400 });
  });
});
