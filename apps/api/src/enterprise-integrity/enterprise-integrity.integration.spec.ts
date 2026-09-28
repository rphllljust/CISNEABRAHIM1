import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ACCOUNT_CLASSES,
  JOURNAL_DIRECTIONS,
  JOURNAL_SOURCE_KINDS,
} from '../accounting/domain/ledger';
import { TEST_FIXTURE_RULE_CODE } from '../fiscal/domain/tax-engine';
import { FISCAL_SOURCE_KINDS, FISCAL_STATUSES } from '../fiscal/domain/fiscal-document';
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_DIRECTIONS, TREASURY_ORIGIN_KINDS } from '../finance/domain/treasury';
import { RECEIVABLE_STATUSES } from '../finance/domain/receivable';
import { moneyAmountsEqual } from '../platform/kernel/money-math';
import { assertFinancialReconciliation } from '../master-business/master-business-reconciliation';
import { runUatVerticalScenario } from '../uat/uat-vertical-runner';
import { UAT_SCENARIOS } from '../uat/uat-scenarios';
import {
  createEnterpriseIntegrityContext,
  MASTER_BUSINESS_UNIT,
  type EnterpriseIntegrityContext,
} from './enterprise-integrity-harness';

const OCCURRED_ON = '2026-09-15';
const OCCURRED_AT = '2026-09-15T15:00:00.000Z';

async function count(pool: EnterpriseIntegrityContext['pool'], sql: string, params: unknown[] = []) {
  const result = await pool.query<{ count: string }>(sql, params);
  return Number(result.rows[0]?.count ?? '0');
}

describe('Enterprise financial integrity gate', () => {
  let ctx: EnterpriseIntegrityContext;

  beforeAll(async () => {
    ctx = await createEnterpriseIntegrityContext();
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
  });

  afterAll(async () => {
    await ctx.module.close();
    await ctx.pool.end();
  });

  it('walks Client→Accounting, keeps economic equality, recovers failed hops without duplicates', async () => {
    const actor = await ctx.seedAdminActor();
    const checker = await ctx.seedFinancialChecker();
    const locacao = UAT_SCENARIOS.find((scenario) => scenario.id === 'locacao');
    expect(locacao).toBeDefined();
    const journey = await runUatVerticalScenario(ctx.services, locacao!, actor, MASTER_BUSINESS_UNIT, {
      captureArtifacts: true,
    });
    expect(journey.status).toBe('PASS');
    expect(journey.artifacts).toBeDefined();
    const artifacts = journey.artifacts!;
    await assertFinancialReconciliation(ctx.services, actor, artifacts);

    const billing = await ctx.services.billingDocumentAccess.getById(
      actor,
      artifacts.serviceOrderId,
      artifacts.billingRecordId,
      artifacts.billingDocumentId,
    );
    const opened = await ctx.services.receivablesAccess.openFromBilling({
      billingRecordId: artifacts.billingRecordId,
      billingDocumentId: artifacts.billingDocumentId,
      serviceOrderId: artifacts.serviceOrderId,
      measurementId: artifacts.measurementId,
      unitId: MASTER_BUSINESS_UNIT,
      clientId: artifacts.clientId,
      principal: billing.totalAmount,
      currencyCode: billing.currencyCode,
      dueDate: billing.dueDate ?? OCCURRED_ON,
      paymentTerms: billing.paymentTerms,
      externalReference: billing.documentNumber,
      actorIdentityId: actor.identityId,
    });
    expect(opened.idempotent).toBe(true);
    const receivable = await ctx.services.receivablesAccess.getById(actor, opened.receivableId);
    expect(receivable.origin.kind).toBe('BILLING_DOCUMENT');
    expect(moneyAmountsEqual(receivable.principal, billing.totalAmount)).toBe(true);
    expect(
      await count(
        ctx.pool,
        `SELECT COUNT(*)::text AS count FROM fin.receivables WHERE origin_billing_document_id = $1`,
        [artifacts.billingDocumentId],
      ),
    ).toBe(1);

    const settleKey = `settle-${artifacts.billingDocumentId}`;
    const paid = await ctx.services.receivablesAccess.settle(checker, receivable.id, {
      amount: receivable.principal,
      rowVersion: receivable.rowVersion,
      idempotencyKey: settleKey,
    });
    const paidAgain = await ctx.services.receivablesAccess.settle(checker, receivable.id, {
      amount: receivable.principal,
      rowVersion: paid.rowVersion,
      idempotencyKey: settleKey,
    });
    expect(paid.status).toBe(RECEIVABLE_STATUSES.Paid);
    expect(paidAgain.settlements).toHaveLength(1);
    expect(paidAgain.settlements[0]?.id).toBe(paid.settlements[0]?.id);
    expect(
      await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`, [
        receivable.id,
      ]),
    ).toBe(1);

    const settlementId = paid.settlements[0]!.id;
    const autoTreasury = await count(
      ctx.pool,
      `SELECT COUNT(*)::text AS count FROM fin.financial_transactions
       WHERE origin_kind = $1 AND origin_id = $2`,
      [TREASURY_ORIGIN_KINDS.ReceivableSettlement, settlementId],
    );
    expect(autoTreasury).toBe(0);

    const bank = await ctx.services.treasuryAccess.openAccount(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conta integridade',
      currencyCode: 'BRL',
      bank: { bankCode: '001', agency: '0001', accountNumber: '1001-0' },
    });
    const treasuryKey = `tx-set-${settlementId}`;
    const treasuryPayload = {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: paid.settlements[0]!.amount,
      rowVersion: (await ctx.services.treasuryAccess.getById(actor, bank.id)).rowVersion,
      idempotencyKey: treasuryKey,
      reference: `SETTLE-${settlementId}`,
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: settlementId,
      originReference: `SETTLE-${settlementId}`,
      occurredAt: OCCURRED_AT,
    };
    await ctx.services.treasuryAccess.postMovement(actor, bank.id, treasuryPayload);
    await ctx.services.treasuryAccess.postMovement(actor, bank.id, {
      ...treasuryPayload,
      rowVersion: (await ctx.services.treasuryAccess.getById(actor, bank.id)).rowVersion,
    });
    expect(
      await count(
        ctx.pool,
        `SELECT COUNT(*)::text AS count FROM fin.financial_transactions
         WHERE origin_kind = $1 AND origin_id = $2`,
        [TREASURY_ORIGIN_KINDS.ReceivableSettlement, settlementId],
      ),
    ).toBe(1);
    const settlementSum = await ctx.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM fin.settlements WHERE receivable_id = $1`,
      [receivable.id],
    );
    const treasurySum = await ctx.pool.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total FROM fin.financial_transactions
       WHERE origin_kind = $1 AND origin_id = $2`,
      [TREASURY_ORIGIN_KINDS.ReceivableSettlement, settlementId],
    );
    expect(moneyAmountsEqual(settlementSum.rows[0]!.total, treasurySum.rows[0]!.total)).toBe(true);

    expect(await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM acc.journal_entries`)).toBe(0);

    const chart = await ctx.services.accountingAccess.createChart(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Integrity chart',
    });
    const cash = await ctx.services.accountingAccess.createAccount(actor, chart.id, {
      code: '1.1.01',
      name: 'Cash',
      class: ACCOUNT_CLASSES.Asset,
    });
    const revenue = await ctx.services.accountingAccess.createAccount(actor, chart.id, {
      code: '4.1.01',
      name: 'Revenue',
      class: ACCOUNT_CLASSES.Revenue,
    });
    const period = await ctx.services.accountingAccess.createPeriod(actor, {
      chartId: chart.id,
      unitId: MASTER_BUSINESS_UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    const balancedLines = [
      {
        lineNumber: 1,
        accountId: cash.id,
        direction: JOURNAL_DIRECTIONS.Debit,
        amount: billing.totalAmount,
      },
      {
        lineNumber: 2,
        accountId: revenue.id,
        direction: JOURNAL_DIRECTIONS.Credit,
        amount: billing.totalAmount,
      },
    ];
    const treasuryJournalKey = `je-tx-${settlementId}`;
    const firstJournal = await ctx.services.accountingAccess.postFromSource({
      sourceContext: JOURNAL_SOURCE_KINDS.Settlement,
      sourceId: settlementId,
      unitId: MASTER_BUSINESS_UNIT,
      sourceReference: `SETTLE-${settlementId}`,
      chartId: chart.id,
      periodId: period.id,
      description: 'Recovered treasury settlement',
      occurredOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: treasuryJournalKey,
      actorIdentityId: actor.identityId,
      lines: balancedLines,
    });
    const replayJournal = await ctx.services.accountingAccess.postFromSource({
      sourceContext: JOURNAL_SOURCE_KINDS.Settlement,
      sourceId: settlementId,
      unitId: MASTER_BUSINESS_UNIT,
      sourceReference: `SETTLE-${settlementId}`,
      chartId: chart.id,
      periodId: period.id,
      description: 'Recovered treasury settlement',
      occurredOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: treasuryJournalKey,
      actorIdentityId: actor.identityId,
      lines: balancedLines,
    });
    expect(replayJournal.journalEntryId).toBe(firstJournal.journalEntryId);
    expect(replayJournal.idempotent).toBe(true);

    const journalsBeforeFiscal = await count(
      ctx.pool,
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`,
    );

    const fiscalKey = `fis-${artifacts.billingDocumentId}`;
    const fiscalPayload = {
      unitId: MASTER_BUSINESS_UNIT,
      sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
      sourceId: artifacts.billingDocumentId,
      billingDocumentId: artifacts.billingDocumentId,
      description: 'Official fiscal document from billing',
      currencyCode: billing.currencyCode,
      issuedOn: OCCURRED_ON,
      idempotencyKey: fiscalKey,
      parties: [
        { role: 'ISSUER', legalName: 'Issuer Co', taxIdentifier: 'ISSUER-REF' },
        { role: 'RECIPIENT', legalName: artifacts.clientLegalNameAtCreate, taxIdentifier: artifacts.clientTaxIdAtCreate },
      ],
      items: [
        {
          lineNumber: 1,
          description: billing.items[0]?.lineLabel || 'Billing commercial snapshot',
          quantity: '1.0000',
          unitAmount: billing.totalAmount,
          lineAmount: billing.totalAmount,
        },
      ],
      taxDetails: [
        {
          lineNumber: 1,
          componentLabel: 'TAX_SNAPSHOT',
          amount: '10.0000',
          detailSnapshot: { suppliedBy: 'caller', notComputedByCisne: true },
        },
      ],
    };
    const fiscalCreated = await ctx.services.fiscalAccess.createDraft(actor, fiscalPayload);
    const fiscalReplay = await ctx.services.fiscalAccess.createDraft(actor, fiscalPayload);
    expect(fiscalReplay.id).toBe(fiscalCreated.id);

    const ready = await ctx.services.fiscalAccess.markReady(actor, fiscalCreated.id, {
      rowVersion: fiscalCreated.rowVersion,
    });
    const authorized = await ctx.services.fiscalAccess.submit(checker, ready.id, { rowVersion: ready.rowVersion });
    const authorizedAgain = await ctx.services.fiscalAccess.submit(actor, authorized.id, {
      rowVersion: authorized.rowVersion,
    });
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    expect(authorizedAgain.id).toBe(authorized.id);
    expect(
      await count(
        ctx.pool,
        `SELECT COUNT(*)::text AS count FROM fis.fiscal_documents WHERE source_id = $1`,
        [artifacts.billingDocumentId],
      ),
    ).toBe(1);
    expect(await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`)).toBe(
      journalsBeforeFiscal,
    );

    const fiscalJournal = await ctx.services.accountingAccess.postFromSource({
      sourceContext: JOURNAL_SOURCE_KINDS.Tax,
      sourceId: authorized.id,
      unitId: MASTER_BUSINESS_UNIT,
      sourceReference: `FIS-${authorized.id}`,
      chartId: chart.id,
      periodId: period.id,
      description: 'Recovered fiscal accounting consequence',
      occurredOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: `je-fis-${authorized.id}`,
      actorIdentityId: actor.identityId,
      lines: balancedLines,
    });
    const fiscalJournalReplay = await ctx.services.accountingAccess.postFromSource({
      sourceContext: JOURNAL_SOURCE_KINDS.Tax,
      sourceId: authorized.id,
      unitId: MASTER_BUSINESS_UNIT,
      sourceReference: `FIS-${authorized.id}`,
      chartId: chart.id,
      periodId: period.id,
      description: 'Recovered fiscal accounting consequence',
      occurredOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: `je-fis-${authorized.id}`,
      actorIdentityId: actor.identityId,
      lines: balancedLines,
    });
    expect(fiscalJournalReplay.journalEntryId).toBe(fiscalJournal.journalEntryId);

    const totals = await ctx.pool.query<{ debit: string; credit: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'DEBIT' THEN amount ELSE 0 END), 0)::text AS debit,
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE 0 END), 0)::text AS credit
       FROM acc.journal_entry_lines`,
    );
    expect(moneyAmountsEqual(totals.rows[0]!.debit, totals.rows[0]!.credit)).toBe(true);
    expect(await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`)).toBe(
      2,
    );

    const after = await ctx.services.billingDocumentAccess.getById(
      actor,
      artifacts.serviceOrderId,
      artifacts.billingRecordId,
      artifacts.billingDocumentId,
    );
    expect(String(after.issuedAt)).toBe(String(billing.issuedAt));
    expect(after.totalAmount).toBe(billing.totalAmount);
    expect(after.rowVersion).toBe(billing.rowVersion);
    expect(after.documentNumber).toBe(billing.documentNumber);
  });

  it('serializes double settlement, posting, reconciliation and fiscal submission', async () => {
    const actor = await ctx.seedAdminActor();
    const checker = await ctx.seedFinancialChecker();
    const locacao = UAT_SCENARIOS.find((scenario) => scenario.id === 'locacao')!;
    const journey = await runUatVerticalScenario(ctx.services, locacao, actor, MASTER_BUSINESS_UNIT, {
      captureArtifacts: true,
    });
    expect(journey.status).toBe('PASS');
    const artifacts = journey.artifacts!;
    const billing = await ctx.services.billingDocumentAccess.getById(
      actor,
      artifacts.serviceOrderId,
      artifacts.billingRecordId,
      artifacts.billingDocumentId,
    );
    const listed = await ctx.services.receivablesAccess.list(actor, { limit: 100, offset: 0 });
    const receivable = listed.items.find(
      (item) => item.origin.billingDocumentId === artifacts.billingDocumentId,
    );
    expect(receivable).toBeDefined();

    const concurrentSettle = await Promise.allSettled([
      ctx.services.receivablesAccess.settle(checker, receivable!.id, {
        amount: receivable!.principal,
        rowVersion: receivable!.rowVersion,
        idempotencyKey: `c1-${crypto.randomUUID()}`,
      }),
      ctx.services.receivablesAccess.settle(checker, receivable!.id, {
        amount: receivable!.principal,
        rowVersion: receivable!.rowVersion,
        idempotencyKey: `c2-${crypto.randomUUID()}`,
      }),
    ]);
    const settled = concurrentSettle.filter((item) => item.status === 'fulfilled');
    expect(settled).toHaveLength(1);
    expect(
      await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM fin.settlements WHERE receivable_id = $1`, [
        receivable!.id,
      ]),
    ).toBe(1);
    const settlementId = (settled[0] as PromiseFulfilledResult<{ settlements: Array<{ id: string; amount: string }> }>)
      .value.settlements[0]!.id;

    const bank = await ctx.services.treasuryAccess.openAccount(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conta concorrencia',
      currencyCode: 'BRL',
      bank: { bankCode: '001', agency: '0002', accountNumber: '2002-0' },
    });
    const rowVersion = (await ctx.services.treasuryAccess.getById(actor, bank.id)).rowVersion;
    await ctx.services.treasuryAccess.postMovement(actor, bank.id, {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: billing.totalAmount,
      rowVersion,
      idempotencyKey: `tx-${settlementId}`,
      reference: `SETTLE-${settlementId}`,
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: settlementId,
      originReference: `SETTLE-${settlementId}`,
      occurredAt: OCCURRED_AT,
    });

    const chart = await ctx.services.accountingAccess.createChart(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Concurrency chart',
    });
    const cash = await ctx.services.accountingAccess.createAccount(actor, chart.id, {
      code: '1.1.01',
      name: 'Cash',
      class: ACCOUNT_CLASSES.Asset,
    });
    const revenue = await ctx.services.accountingAccess.createAccount(actor, chart.id, {
      code: '4.1.01',
      name: 'Revenue',
      class: ACCOUNT_CLASSES.Revenue,
    });
    const period = await ctx.services.accountingAccess.createPeriod(actor, {
      chartId: chart.id,
      unitId: MASTER_BUSINESS_UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    const lines = [
      { lineNumber: 1, accountId: cash.id, direction: JOURNAL_DIRECTIONS.Debit, amount: billing.totalAmount },
      { lineNumber: 2, accountId: revenue.id, direction: JOURNAL_DIRECTIONS.Credit, amount: billing.totalAmount },
    ];
    const journalPayload = {
      sourceContext: JOURNAL_SOURCE_KINDS.Settlement,
      sourceId: settlementId,
      unitId: MASTER_BUSINESS_UNIT,
      sourceReference: `SETTLE-${settlementId}`,
      chartId: chart.id,
      periodId: period.id,
      description: 'Concurrent post',
      occurredOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: `je-${settlementId}`,
      actorIdentityId: actor.identityId,
      lines,
    };
    const [postA, postB] = await Promise.all([
      ctx.services.accountingAccess.postFromSource(journalPayload),
      ctx.services.accountingAccess.postFromSource(journalPayload),
    ]);
    expect(postA.journalEntryId).toBe(postB.journalEntryId);
    expect(
      await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE source_id = $1`, [
        settlementId,
      ]),
    ).toBe(1);

    const statement = await ctx.services.bankReconciliationAccess.importStatement(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      financialAccountId: bank.id,
      sourceKind: 'AUTHORIZED_FILE',
      sourceReference: 'INTEGRITY',
      periodStartsOn: OCCURRED_ON,
      periodEndsOn: OCCURRED_ON,
      currencyCode: 'BRL',
      idempotencyKey: `stmt-${crypto.randomUUID()}`,
      lines: [
        {
          sourceLineKey: 'FIT-1',
          occurredOn: OCCURRED_ON,
          direction: FINANCIAL_DIRECTIONS.Credit,
          amount: billing.totalAmount,
          description: 'Settlement',
        },
      ],
    });
    const proposed = await ctx.services.bankReconciliationAccess.autoMatch(actor, statement.id);
    const draftId = proposed.suggested[0]?.id as string;
    expect(draftId).toBeTruthy();
    const concurrentConfirm = await Promise.allSettled([
      ctx.services.bankReconciliationAccess.confirm(checker, draftId),
      ctx.services.bankReconciliationAccess.confirm(checker, draftId),
    ]);
    expect(concurrentConfirm.filter((item) => item.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(
      await count(
        ctx.pool,
        `SELECT COUNT(*)::text AS count FROM fin.reconciliations
         WHERE bank_statement_line_id = $1 AND status = 'CONFIRMED'`,
        [statement.lines[0]!.id],
      ),
    ).toBe(1);

    const fiscal = await ctx.services.fiscalAccess.createDraft(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
      sourceId: artifacts.billingDocumentId,
      billingDocumentId: artifacts.billingDocumentId,
      description: 'Concurrent fiscal',
      currencyCode: billing.currencyCode,
      issuedOn: OCCURRED_ON,
      idempotencyKey: `fis-con-${artifacts.billingDocumentId}`,
      parties: [
        { role: 'ISSUER', legalName: 'Issuer Co', taxIdentifier: 'ISSUER-REF' },
        { role: 'RECIPIENT', legalName: artifacts.clientLegalNameAtCreate, taxIdentifier: artifacts.clientTaxIdAtCreate },
      ],
      items: [
        {
          lineNumber: 1,
          description: billing.items[0]?.lineLabel || 'Billing commercial snapshot',
          quantity: '1.0000',
          unitAmount: billing.totalAmount,
          lineAmount: billing.totalAmount,
        },
      ],
      taxDetails: [
        {
          lineNumber: 1,
          componentLabel: 'TAX_SNAPSHOT',
          amount: '10.0000',
          detailSnapshot: { suppliedBy: 'caller', notComputedByCisne: true },
        },
      ],
    });
    const ready = await ctx.services.fiscalAccess.markReady(actor, fiscal.id, {
      rowVersion: fiscal.rowVersion,
    });
    const concurrentSubmit = await Promise.allSettled([
      ctx.services.fiscalAccess.submit(checker, ready.id, { rowVersion: ready.rowVersion }),
      ctx.services.fiscalAccess.submit(checker, ready.id, { rowVersion: ready.rowVersion }),
    ]);
    expect(concurrentSubmit.filter((item) => item.status === 'fulfilled').length).toBeGreaterThanOrEqual(1);
    expect(
      await count(ctx.pool, `SELECT COUNT(*)::text AS count FROM fis.fiscal_documents WHERE source_id = $1`, [
        artifacts.billingDocumentId,
      ]),
    ).toBe(1);
    expect(
      await count(
        ctx.pool,
        `SELECT COUNT(*)::text AS count FROM fis.fiscal_authorizations WHERE fiscal_document_id = $1`,
        [ready.id],
      ),
    ).toBeLessThanOrEqual(1);
  });

  it('denies operational user access to accounting, payroll and taxation', async () => {
    const ops = await ctx.seedOperationalActor();
    await expect(
      ctx.services.accountingAccess.createChart(ops, {
        unitId: MASTER_BUSINESS_UNIT,
        code: 'OPS-DENIED',
        name: 'Should fail',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ctx.services.payrollAccess.listResults(ops, crypto.randomUUID(), MASTER_BUSINESS_UNIT),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ctx.services.taxEngineAccess.calculate(ops, {
        unitId: MASTER_BUSINESS_UNIT,
        ruleCode: TEST_FIXTURE_RULE_CODE,
        currencyCode: 'BRL',
        baseAmount: '10.0000',
        effectiveOn: '2026-03-01',
        idempotencyKey: `deny-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      ctx.services.fiscalAccess.createDraft(ops, {
        unitId: MASTER_BUSINESS_UNIT,
        sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
        sourceId: crypto.randomUUID(),
        description: 'Denied',
        currencyCode: 'BRL',
        issuedOn: OCCURRED_ON,
        idempotencyKey: `deny-fis-${crypto.randomUUID()}`,
        parties: [
          { role: 'ISSUER', legalName: 'Issuer Co', taxIdentifier: 'ISSUER-REF' },
          { role: 'RECIPIENT', legalName: 'Recipient Co', taxIdentifier: 'RECIPIENT-REF' },
        ],
        items: [
          {
            lineNumber: 1,
            description: 'Line',
            quantity: '1.0000',
            unitAmount: '10.0000',
            lineAmount: '10.0000',
          },
        ],
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
