/**
 * HML ONLY: authorized synthetic business commands, not persistence shortcuts.
 *
 * An execution can be complete while its financial posting is still PENDING.
 * Each cross-domain step has its own durable transaction / idempotency key.
 * Never delete a settled title or journal to "reset" the synthetic scenario.
 */
import { randomUUID } from 'node:crypto';
import { hashPassword, insertIdentity } from '@cisne/database';
import type { Pool } from 'pg';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AUTH_TEST_PASSWORD } from '../auth/test/auth-test-env';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES, type AuthzResourceType } from '../authorization/types/authz-resources';
import { enableCriticalSodFor, grantActions } from '../authorization/test/critical-sod-harness';
import { BANK_STATEMENT_SOURCE_KINDS } from '../finance/domain/bank-reconciliation';
import { FINANCIAL_ACCOUNT_KINDS, TREASURY_ORIGIN_KINDS } from '../finance/domain/treasury';
import { ACCOUNT_CLASSES } from '../accounting/domain/ledger';
import { POSTING_EVENTS, POSTING_ORIGINS } from '../accounting/domain/posting';
import type { UatActor, UatVerticalServices } from '../uat/uat-vertical-runner';

function assertHmlFinance(): void {
  if (process.env['CISNE_ENV'] !== 'hml' ||
      process.env['HML_INTEGRATIONS_SANDBOX'] !== 'true') {
    throw new Error('HML_SYNTHETIC_FINANCE_FORBIDDEN_OUTSIDE_ISOLATED_HML');
  }
}

async function createActor(
  pool: Pool, prefix: string,
  actions: Array<{ action: string; resourceType: AuthzResourceType }>,
): Promise<UatActor> {
  const login = normalizeLoginIdentifier(`${prefix}-${randomUUID()}@cisne.invalid`);
  const { identityId } = await insertIdentity(pool, login, await hashPassword(AUTH_TEST_PASSWORD));
  await grantActions(pool, identityId, actions);
  return { identityId, sessionId: `hml-${prefix}` };
}

const financeAction = (action: string, resourceType: AuthzResourceType) =>
  ({ action, resourceType });
const treasury = AUTHZ_RESOURCE_TYPES.FinanceTreasury;
const ledger = AUTHZ_RESOURCE_TYPES.AccountingLedger;
const receivableResource = AUTHZ_RESOURCE_TYPES.FinanceReceivable;

export type HmlFinanceActors = {
  accountant: UatActor;
  settler: UatActor;
  bankOfficer: UatActor;
  reconciliationApprover: UatActor;
};

export type SyntheticFinancialEvidence = {
  receivableId: string;
  settlementId: string;
  treasuryMovementId: string;
  reconciliationId: string;
  postingRequestId: string;
  journalEntryId: string;
};

export async function prepareHmlFinance(
  services: UatVerticalServices,
  unitId: string,
): Promise<HmlFinanceActors> {
  assertHmlFinance();
  const { pool, accountingAccess: accounting, approvalMatrices: matrices } = services;
  if (!accounting || !matrices) throw new Error('HML_FINANCE_PROVIDERS_UNAVAILABLE');

  const accountant = await createActor(pool, 'hml-accountant', [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingJournalRead,
    AUTHZ_ACTIONS.AccountingJournalList,
    AUTHZ_ACTIONS.AccountingPostingRuleManage,
    AUTHZ_ACTIONS.AccountingPostingRulePublish,
    AUTHZ_ACTIONS.AccountingPostingRequest,
  ].map((action) => financeAction(action, ledger)));

  const settler = await createActor(pool, 'hml-settler', [
    AUTHZ_ACTIONS.FinanceReceivableRead,
    AUTHZ_ACTIONS.FinanceReceivableSettle,
  ].map((action) => financeAction(action, receivableResource)));

  const bankOfficer = await createActor(pool, 'hml-bank-operator', [
    AUTHZ_ACTIONS.FinanceTreasuryAccountOpen,
    AUTHZ_ACTIONS.FinanceTreasuryRead,
    AUTHZ_ACTIONS.FinanceTreasuryPost,
    AUTHZ_ACTIONS.FinanceBankStatementImport,
    AUTHZ_ACTIONS.FinanceReconciliationMatch,
    AUTHZ_ACTIONS.FinanceReconciliationRead,
  ].map((action) => financeAction(action, treasury)));

  const reconciliationApprover = await createActor(pool, 'hml-reconciliation-approver', [
    AUTHZ_ACTIONS.FinanceTreasuryRead,
    AUTHZ_ACTIONS.FinanceReconciliationConfirm,
    AUTHZ_ACTIONS.FinanceReconciliationRead,
  ].map((action) => financeAction(action, treasury)));

  // Publish the SAME real approval matrix that integration tests exercise.
  // The originator, settlement author and reconciliation checker are distinct.
  await enableCriticalSodFor(pool, matrices, [
    settler.identityId,
    reconciliationApprover.identityId,
  ]);

  const active = await pool.query<{ id: string }>(
    `SELECT id FROM acc.accounting_posting_rules
      WHERE unit_id = $1 AND origin_kind = 'FINANCE'
        AND event_kind = 'SETTLEMENT_CONFIRMED' AND status = 'ACTIVE'`,
    [unitId],
  );
  if (active.rows.length > 1) throw new Error('HML_DUPLICATE_ACTIVE_SETTLEMENT_POSTING_RULE');
  if (active.rows.length === 0) {
    const chart = await accounting.createChart(accountant, {
      unitId, code: 'HML-SETTLEMENT-COA',
      name: 'HML — contas sintéticas de liquidação',
    });
    const debit = await accounting.createAccount(accountant, chart.id, {
      code: '1.1.05', name: 'Bancos movimento', class: ACCOUNT_CLASSES.Asset,
    });
    const credit = await accounting.createAccount(accountant, chart.id, {
      code: '1.1.08', name: 'Clientes a receber', class: ACCOUNT_CLASSES.Asset,
    });
    await accounting.createPeriod(accountant, {
      chartId: chart.id, unitId, code: '2026-10',
      startsOn: '2026-10-01', endsOn: '2026-10-31',
    });
    const rule = await accounting.createPostingRule(accountant, {
      unitId, code: 'HML-SETTLEMENT-CONFIRMED',
      name: 'HML — liquidação confirmada',
      originKind: POSTING_ORIGINS.Finance,
      eventKind: POSTING_EVENTS.SettlementConfirmed,
    });
    const draft = await accounting.createPostingRuleVersion(accountant, rule.id, {
      debitAccountId: debit.id,
      creditAccountId: credit.id,
      effectiveFrom: '2026-01-01', effectiveTo: null,
      sourceReference: 'HML-SETTLEMENT',
    });
    await accounting.publishPostingRuleVersion(accountant, draft.id, {
      rowVersion: draft.rowVersion,
    });
  }

  return { accountant, settler, bankOfficer, reconciliationApprover };
}

export async function closeSyntheticFinancialChain(
  services: UatVerticalServices,
  actors: HmlFinanceActors,
  input: { key: string; unitId: string; billingDocumentId: string; serviceOrderId: string },
): Promise<SyntheticFinancialEvidence> {
  assertHmlFinance();
  const { pool, receivablesAccess: receivables, treasuryAccess: treasuryService,
    bankReconciliationAccess: reconciliation, economicPosting } = services;
  if (!receivables || !treasuryService || !reconciliation || !economicPosting) {
    throw new Error('HML_FINANCE_PROVIDERS_UNAVAILABLE');
  }
  const result = await pool.query<{ id: string; principal: string; currency_code: string }>(
    `SELECT id, principal::text AS principal, currency_code
       FROM fin.receivables
      WHERE origin_billing_document_id = $1 AND origin_service_order_id = $2`,
    [input.billingDocumentId, input.serviceOrderId],
  );
  if (result.rows.length !== 1) throw new Error('HML_BILLING_RECEIVABLE_ORIGIN_MISSING_OR_DUPLICATED');
  const source = result.rows[0]!;
  const stage = input.key.toUpperCase().replace(/[^A-Z0-9]+/g, '-');
  const settledAt = '2026-10-15T12:00:00.000Z';

  const before = await receivables.getById(actors.settler, source.id);
  await receivables.settle(actors.settler, source.id, {
    amount: source.principal,
    rowVersion: before.rowVersion,
    idempotencyKey: `HML-SETTLE-${stage}`,
    externalReference: `HML-${stage}`,
    settledAt,
  });
  const settlement = await pool.query<{ id: string }>(
    `SELECT id FROM fin.settlements WHERE receivable_id = $1
      AND idempotency_key = $2 AND status = 'POSTED'`,
    [source.id, `HML-SETTLE-${stage}`],
  );
  if (settlement.rows.length !== 1) throw new Error('HML_SETTLEMENT_NOT_POSTED');
  const settlementId = settlement.rows[0]!.id;

  const existingAccount = await pool.query<{ id: string }>(
    'SELECT id FROM fin.financial_accounts WHERE unit_id = $1 AND code = $2',
    [input.unitId, `HML-BANK-${stage}`],
  );
  if (existingAccount.rows.length > 1) throw new Error('HML_BANK_ACCOUNT_NOT_UNIQUE');
  const account = existingAccount.rows.length === 1
    ? await treasuryService.getById(actors.bankOfficer, existingAccount.rows[0]!.id)
    : await treasuryService.openAccount(actors.bankOfficer, {
        unitId: input.unitId, kind: FINANCIAL_ACCOUNT_KINDS.Bank,
        code: `HML-BANK-${stage}`, name: `HML Banco - ${stage}`,
        currencyCode: source.currency_code, overdraftAllowed: false,
        bank: { bankCode: '999', agency: '0001', accountNumber: `HML-${stage}` },
      });
  if (account.currencyCode !== source.currency_code || account.kind !== FINANCIAL_ACCOUNT_KINDS.Bank) {
    throw new Error('HML_BANK_ACCOUNT_ORIGIN_MISMATCH');
  }
  const existingMovement = await pool.query<{ id: string; amount: string }>(
    `SELECT id, amount::text AS amount FROM fin.financial_transactions
      WHERE account_id = $1 AND origin_kind = 'RECEIVABLE_SETTLEMENT'
        AND origin_id = $2 AND idempotency_key = $3`,
    [account.id, settlementId, `HML-MOV-${stage}`],
  );
  if (existingMovement.rows.length > 1 ||
      (existingMovement.rows.length === 1 &&
       existingMovement.rows[0]!.amount !== source.principal)) {
    throw new Error('HML_DUPLICATE_OR_MISMATCHED_BANK_MOVEMENT');
  }
  if (existingMovement.rows.length === 0) {
    await treasuryService.postMovement(actors.bankOfficer, account.id, {
      rowVersion: account.rowVersion,
      direction: 'CREDIT', amount: source.principal,
      idempotencyKey: `HML-MOV-${stage}`,
      reference: `HML-RECEIPT-${stage}`,
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: settlementId, originReference: input.billingDocumentId,
      occurredAt: settledAt,
    });
  }

  const movement = await pool.query<{ id: string }>(
    `SELECT id FROM fin.financial_transactions
      WHERE account_id = $1 AND origin_kind = 'RECEIVABLE_SETTLEMENT'
        AND origin_id = $2 AND idempotency_key = $3`,
    [account.id, settlementId, `HML-MOV-${stage}`],
  );
  if (movement.rows.length !== 1) throw new Error('HML_TREASURY_MOVEMENT_MISSING');

  const statement = await reconciliation.importStatement(actors.bankOfficer, {
    unitId: input.unitId, financialAccountId: account.id,
    sourceKind: BANK_STATEMENT_SOURCE_KINDS.Manual,
    sourceReference: `HML-STATEMENT-${stage}`,
    periodStartsOn: '2026-10-01', periodEndsOn: '2026-10-31',
    currencyCode: source.currency_code,
    idempotencyKey: `HML-STATEMENT-${stage}`,
    lines: [{
      sourceLineKey: `HML-RECEIPT-${stage}`, occurredOn: '2026-10-15',
      direction: 'CREDIT', amount: source.principal,
      description: `HML — recebimento sintético ${stage}`,
      externalReference: input.billingDocumentId,
    }],
  });
  if (statement.lines.length !== 1) throw new Error('HML_BANK_STATEMENT_LINES_INVALID');
  const existingReconciliation = await pool.query<{ id: string }>(
    `SELECT r.id FROM fin.reconciliations r
      JOIN fin.reconciliation_matches m ON m.reconciliation_id = r.id
     WHERE r.bank_statement_line_id = $1 AND m.financial_transaction_id = $2
       AND m.is_active = true AND r.status = 'CONFIRMED'`,
    [statement.lines[0]!.id, movement.rows[0]!.id],
  );
  if (existingReconciliation.rows.length > 1) throw new Error('HML_RECONCILIATION_DUPLICATED');
  const reconciliationId = existingReconciliation.rows.length === 1
    ? existingReconciliation.rows[0]!.id
    : (await reconciliation.matchManual(actors.bankOfficer, {
        bankStatementLineId: statement.lines[0]!.id,
        financialTransactionId: movement.rows[0]!.id,
      })).id;
  const confirmed = await reconciliation.confirm(actors.reconciliationApprover, reconciliationId);
  if (confirmed.status !== 'CONFIRMED' ||
      confirmed.match?.financialTransactionId !== movement.rows[0]!.id) {
    throw new Error('HML_RECONCILIATION_NOT_CONFIRMED');
  }

  const event = await pool.query<{ outbox_event_id: string | null }>(
    `SELECT outbox_event_id FROM plt.economic_events
      WHERE event_kind = 'SETTLEMENT_CONFIRMED' AND source_id = $1`,
    [settlementId],
  );
  if (event.rows.length !== 1 || !event.rows[0]?.outbox_event_id) {
    throw new Error('HML_SETTLEMENT_ECONOMIC_OUTBOX_MISSING');
  }
  const posted = await economicPosting.retryFromOutbox(
    actors.accountant, event.rows[0].outbox_event_id,
  );
  if (!posted.journalEntryId || !posted.postingRequestId) {
    throw new Error('HML_ACCOUNTING_POSTING_NOT_COMPLETED');
  }
  return {
    receivableId: source.id, settlementId,
    treasuryMovementId: movement.rows[0]!.id,
    reconciliationId: confirmed.id,
    postingRequestId: posted.postingRequestId,
    journalEntryId: posted.journalEntryId,
  };
}
