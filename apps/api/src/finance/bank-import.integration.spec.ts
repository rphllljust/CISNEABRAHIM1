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
import { BANK_IMPORT_MAX_BYTES } from './domain/bank-import';
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_DIRECTIONS, TREASURY_ORIGIN_KINDS } from './domain/treasury';
import { FinanceHttpException } from './errors/finance-http.exception';
import { FinanceModule } from './finance.module';
import { BankReconciliationRepository } from './repositories/bank-reconciliation.repository';
import { BankReconciliationAccessService } from './services/bank-reconciliation-access.service';
import { TreasuryAccessService } from './services/treasury-access.service';

const UNIT = 'unit-fin-import-a';
const DAY = '2026-09-15';
const OCCURRED = '2026-09-15T15:00:00.000Z';

async function grantTreasuryAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FinanceTreasuryAccountOpen,
    AUTHZ_ACTIONS.FinanceTreasuryRead,
    AUTHZ_ACTIONS.FinanceTreasuryList,
    AUTHZ_ACTIONS.FinanceTreasuryPost,
    AUTHZ_ACTIONS.FinanceBankStatementImport,
    AUTHZ_ACTIONS.FinanceReconciliationMatch,
    AUTHZ_ACTIONS.FinanceReconciliationRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinanceTreasury,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

function cisneFile(
  lines: Array<{
    sourceLineKey: string;
    amount: string;
    direction?: string;
    externalReference?: string | null;
    description?: string;
  }>,
  sourceReference = 'STMT-IMPORT',
): string {
  return JSON.stringify({
    format: 'CISNE_STATEMENT_V1',
    periodStartsOn: DAY,
    periodEndsOn: DAY,
    currencyCode: 'BRL',
    sourceReference,
    lines: lines.map((line) => ({
      sourceLineKey: line.sourceLineKey,
      occurredOn: DAY,
      direction: line.direction ?? FINANCIAL_DIRECTIONS.Credit,
      amount: line.amount,
      description: line.description ?? line.sourceLineKey,
      externalReference: line.externalReference,
    })),
  });
}

describe('Bank statement import PostgreSQL integration', () => {
  let pool: Pool;
  let treasury: TreasuryAccessService;
  let recon: BankReconciliationAccessService;
  let repository: BankReconciliationRepository;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for bank import integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FinanceModule],
    }).compile();
    treasury = module.get(TreasuryAccessService);
    recon = module.get(BankReconciliationAccessService);
    repository = module.get(BankReconciliationRepository);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`bi-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantTreasuryAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function openBank(actor: { identityId: string; sessionId: string }) {
    return treasury.openAccount(actor, {
      unitId: UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conta importacao',
      currencyCode: 'BRL',
      openingAmount: '500.0000',
      bank: { bankCode: '001', agency: '0001', accountNumber: '7788-0' },
    });
  }

  async function countStatements(): Promise<number> {
    const result = await pool.query<{ count: string }>('SELECT COUNT(*)::text AS count FROM fin.bank_statements');
    return Number(result.rows[0]?.count ?? '0');
  }

  async function countLines(): Promise<number> {
    const result = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fin.bank_statement_lines',
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async function assertNoPartialOrDuplicateRows(): Promise<void> {
    const emptyStatements = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM fin.bank_statements s
       WHERE NOT EXISTS (
         SELECT 1 FROM fin.bank_statement_lines l WHERE l.bank_statement_id = s.id
       )`,
    );
    const duplicateFingerprints = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM (
         SELECT fingerprint
         FROM fin.bank_statement_lines
         WHERE identity_kind = 'SUFFICIENT' AND fingerprint IS NOT NULL
         GROUP BY fingerprint
         HAVING COUNT(*) > 1
       ) d`,
    );
    expect(emptyStatements.rows[0]?.count).toBe('0');
    expect(duplicateFingerprints.rows[0]?.count).toBe('0');
  }

  it('rejects USD file content for an authorized BRL bank account before replay or persistence', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const validShape = JSON.parse(cisneFile([{
      sourceLineKey: 'FOREIGN-1',
      amount: '100.0000',
      externalReference: 'FITID-FOREIGN-1',
    }])) as Record<string, unknown>;
    const content = JSON.stringify({ ...validShape, currencyCode: 'USD' });

    await expect(recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'foreign-currency.json',
      content,
    })).rejects.toMatchObject({ code: 'FINANCE_CURRENCY_MISMATCH' });

    expect(await countStatements()).toBe(0);
    expect(await countLines()).toBe(0);
    const imports = await pool.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM fin.bank_statement_imports',
    );
    expect(imports.rows[0]?.count).toBe('0');
  });

  it('imports a valid documented file and reconciles exact movements', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    await treasury.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: '80.0000',
      rowVersion: (await treasury.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `imp-set-${crypto.randomUUID()}`,
      reference: 'SETTLE-80',
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: crypto.randomUUID(),
      originReference: 'SETTLE-80',
      occurredAt: OCCURRED,
    });
    const imported = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'setembro.json',
      content: cisneFile([
        {
          sourceLineKey: 'L1',
          amount: '80.0000',
          externalReference: 'FITID-80',
        },
      ]),
    });
    expect(imported.idempotent).toBe(false);
    expect(imported.status).toBe('IMPORTED');
    expect(imported.importedLineCount).toBe(1);
    expect(imported.statement?.lines).toHaveLength(1);
    expect(imported.reconciliation?.suggested).toHaveLength(1);
    expect(imported.reconciliation?.unmatched).toHaveLength(0);
    await assertNoPartialOrDuplicateRows();
  });

  it('rejects invalid, undocumented, malformed and empty files without creating a statement', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const before = await countStatements();
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'notes.txt',
        content: 'not-a-statement',
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_INVALID_FILE' });
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'extract.ofx',
        content: 'OFXHEADER:100\nDATA:OFXSGML\n<OFX>',
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_LAYOUT_NOT_DOCUMENTED' });
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'retorno.ret',
        content: '00000000',
        declaredFormat: 'CNAB',
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_LAYOUT_NOT_DOCUMENTED' });
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'broken.json',
        content: '{ "format": "CISNE_STATEMENT_V1", "lines": [',
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_MALFORMED' });
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'empty.json',
        content: '   ',
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_EMPTY' });
    expect(await countStatements()).toBe(before);
    expect(await countLines()).toBe(0);
  });

  it('replays the same file without duplicating lines', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const content = cisneFile([
      { sourceLineKey: 'L1', amount: '10.0000', externalReference: 'FITID-10' },
      { sourceLineKey: 'L2', amount: '20.0000', externalReference: 'FITID-20' },
    ]);
    const first = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'dup.json',
      content,
    });
    const second = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'dup.json',
      content,
    });
    expect(second.idempotent).toBe(true);
    expect(second.statement?.id).toBe(first.statement?.id);
    expect(await countStatements()).toBe(1);
    expect(await countLines()).toBe(2);
    await assertNoPartialOrDuplicateRows();
  });

  it('detects the same identified launch across two files and keeps one line', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const first = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'a.json',
      content: cisneFile(
        [
          { sourceLineKey: 'A1', amount: '33.0000', externalReference: 'FITID-33' },
          { sourceLineKey: 'A2', amount: '44.0000', externalReference: 'FITID-44' },
        ],
        'FILE-A',
      ),
    });
    const second = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'b.json',
      content: cisneFile(
        [
          { sourceLineKey: 'B1', amount: '33.0000', externalReference: 'FITID-33' },
          { sourceLineKey: 'B2', amount: '55.0000', externalReference: 'FITID-55' },
        ],
        'FILE-B',
      ),
    });
    expect(first.importedLineCount).toBe(2);
    expect(second.importedLineCount).toBe(1);
    expect(second.duplicateLineCount).toBeGreaterThanOrEqual(1);
    expect(await countLines()).toBe(3);
    await assertNoPartialOrDuplicateRows();
  });

  it('collapses duplicate lines inside one file', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const imported = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'inside.json',
      content: cisneFile([
        { sourceLineKey: 'L1', amount: '12.0000', externalReference: 'FITID-12' },
        { sourceLineKey: 'L1-DUP', amount: '12.0000', externalReference: 'FITID-12' },
      ]),
    });
    expect(imported.importedLineCount).toBe(1);
    expect(imported.duplicateLineCount).toBe(1);
    expect(await countLines()).toBe(1);
    await assertNoPartialOrDuplicateRows();
  });

  it('rolls back a failed persist so no partial BankStatement remains', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const before = await countStatements();
    await expect(
      repository.withTransaction(async (client) => {
        await repository.insertStatement(
          {
            unitId: UNIT,
            financialAccountId: bank.id,
            sourceKind: 'AUTHORIZED_FILE',
            sourceReference: 'ROLLBACK',
            periodStartsOn: DAY,
            periodEndsOn: DAY,
            currencyCode: 'BRL',
            idempotencyKey: `rb-${crypto.randomUUID()}`,
            actorIdentityId: actor.identityId,
            fileChecksum: 'c'.repeat(64),
          },
          client,
        );
        throw new Error('forced-rollback');
      }),
    ).rejects.toThrow('forced-rollback');
    expect(await countStatements()).toBe(before);
    expect(await countLines()).toBe(0);
  });

  it('imports a large documented file and rejects an oversized upload', async () => {
    const actor = await seedActor();
    const bank = await openBank(actor);
    const largeLines = Array.from({ length: 800 }, (_, index) => ({
      sourceLineKey: `L${index + 1}`,
      amount: '1.0000',
      externalReference: `FITID-LARGE-${index + 1}`,
    }));
    const large = await recon.importFile(actor, {
      unitId: UNIT,
      financialAccountId: bank.id,
      fileName: 'large.json',
      content: cisneFile(largeLines, 'LARGE'),
    });
    expect(large.importedLineCount).toBe(800);
    expect(await countLines()).toBe(800);
    const beforeStatements = await countStatements();
    await expect(
      recon.importFile(actor, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'huge.json',
        content: 'x'.repeat(BANK_IMPORT_MAX_BYTES + 1),
      }),
    ).rejects.toMatchObject({ code: 'FINANCE_BANK_IMPORT_TOO_LARGE' });
    expect(await countStatements()).toBe(beforeStatements);
    await assertNoPartialOrDuplicateRows();
  });

  it('denies import without FinanceBankStatementImport', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const bank = await openBank(admin);
    await expect(
      recon.importFile(stranger, {
        unitId: UNIT,
        financialAccountId: bank.id,
        fileName: 'denied.json',
        content: cisneFile([{ sourceLineKey: 'L1', amount: '9.0000', externalReference: 'FITID-9' }]),
      }),
    ).rejects.toBeInstanceOf(FinanceHttpException);
    expect(await countStatements()).toBe(0);
  });
});
