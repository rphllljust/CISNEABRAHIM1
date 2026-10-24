import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateAccountingTables,
  truncateFiscalTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AccountingModule } from '../accounting/accounting.module';
import { ACCOUNT_CLASSES } from '../accounting/domain/ledger';
import { POSTING_EVENTS, POSTING_ORIGINS } from '../accounting/domain/posting';
import { ACCOUNTING_ERROR_CODES } from '../accounting/errors/accounting-error-codes';
import { AccountingAccessService } from '../accounting/services/accounting-access.service';
import { EconomicPostingService } from '../accounting/services/economic-posting.service';
import { AccountingRepository } from '../accounting/repositories/accounting.repository';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { AUTH_TEST_PASSWORD, applyAuthTestEnv } from '../auth/test/auth-test-env';
import { normalizeLoginIdentifier } from '../auth/crypto/token-crypto';
import { AuthorizationModule } from '../authorization/authorization.module';
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import {
  POSTING_FAILURE_STAGES,
  PostingFailureInjection,
} from '../platform/kernel/posting-failure-injection';
import { FISCAL_SOURCE_KINDS, FISCAL_STATUSES } from './domain/fiscal-document';
import {
  TAX_CALCULATION_METHODS,
  TEST_FIXTURE_RULE_CODE,
  TEST_FIXTURE_SOURCE_REFERENCE,
} from './domain/tax-engine';
import { FiscalModule } from './fiscal.module';
import {
  FISCAL_CREDENTIALING_STATUSES,
  type FiscalCredentialingSnapshot,
} from './domain/fiscal-credentialing';
import {
  FISCAL_AUTHORIZATION_GATEWAY,
  type FiscalAuthorizationGateway,
  type FiscalGatewaySubmitResult,
} from './ports/fiscal-authorization-gateway.port';
import { FISCAL_CREDENTIALING_PORT, type FiscalCredentialingPort } from './ports/fiscal-credentialing.port';
import { FiscalAccessService } from './services/fiscal-access.service';
import { FiscalAccountingIntegrationService } from './services/fiscal-accounting-integration.service';
import { TaxEngineAccessService } from './services/tax-engine-access.service';

const UNIT = 'unit-fis-acc';

class ScriptedFiscalGateway implements FiscalAuthorizationGateway {
  readonly gatewayId = 'scripted-fiscal-accounting';
  next: FiscalGatewaySubmitResult = { outcome: 'AUTHORIZED', protocolCode: 'PROT-ACC-1' };

  async submit(): Promise<FiscalGatewaySubmitResult> {
    return this.next;
  }
}

class ScriptedFiscalCredentialing implements FiscalCredentialingPort {
  approved = true;

  snapshot(): FiscalCredentialingSnapshot {
    return {
      status: this.approved
        ? FISCAL_CREDENTIALING_STATUSES.Approved
        : FISCAL_CREDENTIALING_STATUSES.NotCredentialed,
      approved: this.approved,
      source: 'LAB',
    };
  }
}

async function grantAll(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.FiscalDocumentDraft,
    AUTHZ_ACTIONS.FiscalDocumentSubmit,
    AUTHZ_ACTIONS.FiscalDocumentCancel,
    AUTHZ_ACTIONS.FiscalDocumentRead,
    AUTHZ_ACTIONS.FiscalDocumentList,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.FiscalTaxRuleManage,
    AUTHZ_ACTIONS.FiscalTaxCalculate,
    AUTHZ_ACTIONS.FiscalTaxRead,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FiscalTaxEngine,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
  for (const action of [
    AUTHZ_ACTIONS.AccountingChartManage,
    AUTHZ_ACTIONS.AccountingPeriodOpen,
    AUTHZ_ACTIONS.AccountingPeriodClose,
    AUTHZ_ACTIONS.AccountingJournalDraft,
    AUTHZ_ACTIONS.AccountingJournalPost,
    AUTHZ_ACTIONS.AccountingJournalReverse,
    AUTHZ_ACTIONS.AccountingJournalRead,
    AUTHZ_ACTIONS.AccountingJournalList,
    AUTHZ_ACTIONS.AccountingPostingRuleManage,
    AUTHZ_ACTIONS.AccountingPostingRulePublish,
    AUTHZ_ACTIONS.AccountingPostingRequest,
  ]) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Fiscal to accounting integration PostgreSQL', () => {
  let pool: Pool;
  let fiscal: FiscalAccessService;
  let tax: TaxEngineAccessService;
  let accounting: AccountingAccessService;
  let economicPosting: EconomicPostingService;
  let integration: FiscalAccountingIntegrationService;
  let repository: AccountingRepository;
  let failures: PostingFailureInjection;
  let gateway: ScriptedFiscalGateway;
  let credentialing: ScriptedFiscalCredentialing;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for fiscal-accounting integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    gateway = new ScriptedFiscalGateway();
    credentialing = new ScriptedFiscalCredentialing();
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FiscalModule, AccountingModule],
    })
      .overrideProvider(FISCAL_AUTHORIZATION_GATEWAY)
      .useValue(gateway)
      .overrideProvider(FISCAL_CREDENTIALING_PORT)
      .useValue(credentialing)
      .compile();
    fiscal = module.get(FiscalAccessService);
    tax = module.get(TaxEngineAccessService);
    accounting = module.get(AccountingAccessService);
    economicPosting = module.get(EconomicPostingService);
    integration = module.get(FiscalAccountingIntegrationService);
    repository = module.get(AccountingRepository);
    failures = module.get(PostingFailureInjection);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFiscalTables(pool);
    await truncateAccountingTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    /*
     * F1.2 — O LEDGER DO FATO E O TRANSPORTE NÃO SÃO TRUNCADOS PELOS HELPERS.
     *
     * `truncateFiscalTables`/`truncateAccountingTables` não conhecem `plt.economic_events`
     * nem `evt.outbox_events`. Como este bloco trunca `identity.identities`, um fato
     * publicado por um teste anterior fica apontando para um ATOR QUE NÃO EXISTE MAIS.
     * Ao entregar a outbox, o posting tentava gravar `created_by_identity_id` órfão e
     * violava a FK de `acc.journal_entries` — um erro que parecia contábil e era, na
     * verdade, estado residual entre testes.
     *
     * Limpar os dois aqui mantém cada teste isolado: só os fatos DESTE teste existem.
     */
    await pool.query('DELETE FROM evt.outbox_events');
    await pool.query('DELETE FROM plt.economic_events');
    gateway.next = { outcome: 'AUTHORIZED', protocolCode: 'PROT-ACC-1' };
    credentialing.approved = true;
    failures.reset();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`fisacc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantAll(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedLedger(actor: { identityId: string; sessionId: string }) {
    const chart = await accounting.createChart(actor, {
      unitId: UNIT,
      code: `COA-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Fiscal posting chart',
    });
    const debit = await accounting.createAccount(actor, chart.id, {
      code: '1.1.20',
      name: 'Fiscal receivable',
      class: ACCOUNT_CLASSES.Asset,
    });
    const credit = await accounting.createAccount(actor, chart.id, {
      code: '2.1.20',
      name: 'Fiscal obligation',
      class: ACCOUNT_CLASSES.Liability,
    });
    await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-09',
      startsOn: '2026-09-01',
      endsOn: '2026-09-30',
    });
    await accounting.createPeriod(actor, {
      chartId: chart.id,
      unitId: UNIT,
      code: '2026-03',
      startsOn: '2026-03-01',
      endsOn: '2026-03-31',
    });
    return { chart, debit, credit };
  }

  async function publishEventRule(
    actor: { identityId: string; sessionId: string },
    eventKind: string,
    debitAccountId: string,
    creditAccountId: string,
  ) {
    const rule = await accounting.createPostingRule(actor, {
      unitId: UNIT,
      code: `RULE-${eventKind}-${crypto.randomUUID().slice(0, 6)}`,
      name: eventKind,
      originKind: POSTING_ORIGINS.Fiscal,
      eventKind,
    });
    const draft = await accounting.createPostingRuleVersion(actor, rule.id, {
      debitAccountId,
      creditAccountId,
      effectiveFrom: '2026-01-01',
      effectiveTo: null,
      sourceReference: 'TEST-FISCAL-POSTING',
    });
    return accounting.publishPostingRuleVersion(actor, draft.id, { rowVersion: draft.rowVersion });
  }

  function draftInput() {
    const billingDocumentId = crypto.randomUUID();
    return {
      unitId: UNIT,
      sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
      sourceId: billingDocumentId,
      billingDocumentId,
      description: 'Official fiscal document',
      currencyCode: 'BRL',
      issuedOn: '2026-09-10',
      idempotencyKey: `fis-acc-${crypto.randomUUID()}`,
      parties: [
        { role: 'ISSUER', legalName: 'Issuer Co', taxIdentifier: 'ISSUER-REF' },
        { role: 'RECIPIENT', legalName: 'Recipient Co', taxIdentifier: 'RECIPIENT-REF' },
      ],
      items: [
        {
          lineNumber: 1,
          description: 'Commercial snapshot line',
          quantity: '1.0000',
          unitAmount: '100.0000',
          lineAmount: '100.0000',
        },
      ],
    };
  }

  async function authorizeDocument(originator: { identityId: string; sessionId: string }) {
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    const created = await fiscal.createDraft(originator, draftInput());
    const ready = await fiscal.markReady(originator, created.id, { rowVersion: created.rowVersion });
    return fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });
  }

  async function countPosted() {
    const result = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.journal_entries WHERE status = 'POSTED'`,
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  /**
   * F1.2 — ENTREGA A OUTBOX DO FATO FISCAL.
   *
   * FISCAL não contabiliza mais dentro do comando: ele publica o FATO econômico na
   * outbox, na mesma transação da autorização/cancelamento/cálculo. Quem contabiliza é
   * o consumidor, de forma retentável e observável. Portanto "existe journal?" só pode
   * ser respondido depois de entregar o evento.
   *
   * Isto não enfraquece asserção alguma: o que se prova continua sendo que a origem
   * fiscal gera UM journal por fato, com a origem correta, e que FISCAL nunca escreve
   * em `acc.*`.
   */
  async function drainEconomicFacts(): Promise<void> {
    const events = await pool.query<{ payload: unknown }>(
      `SELECT payload FROM evt.outbox_events
        WHERE event_type IN (
          'FISCAL_DOCUMENT_AUTHORIZED','FISCAL_DOCUMENT_CANCELLED','TAX_CALCULATION_CONFIRMED'
        )
          AND payload->>'unitId' = $1
        ORDER BY created_at`,
      [UNIT],
    );
    for (const row of events.rows) {
      await economicPosting.consume(row.payload);
    }
  }

  it('posts FiscalDocumentAuthorized through the accounting port without fiscal writing acc.*', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(actor);
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    await drainEconomicFacts();
    expect(await countPosted()).toBe(1);
    const posted = await integration.postAuthorizedDocument(actor, authorized.id);
    expect(posted.idempotent).toBe(true);
    const journal = await accounting.getJournal(actor, posted.journalEntryId);
    expect(journal.balanced).toBe(true);
    expect(journal.debitTotal).toBe(journal.creditTotal);
  });

  it('posts TaxCalculationConfirmed only when a published accounting rule exists', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.TaxCalculationConfirmed, debit.id, credit.id);
    const rule = await tax.createRule(actor, {
      unitId: UNIT,
      code: TEST_FIXTURE_RULE_CODE,
      name: 'Configured test percent fixture',
    });
    const draft = await tax.createVersion(actor, rule.id, {
      calculationMethod: TAX_CALCULATION_METHODS.PercentOfBase,
      rate: '5.0000',
      sourceReference: TEST_FIXTURE_SOURCE_REFERENCE,
      effectiveFrom: '2026-01-01',
      effectiveTo: '2026-06-30',
    });
    const published = await tax.publishVersion(actor, draft.id);
    const calculated = await tax.calculate(actor, {
      unitId: UNIT,
      ruleVersionId: published.id,
      currencyCode: 'BRL',
      baseAmount: '80.0000',
      effectiveOn: '2026-03-10',
      idempotencyKey: `tax-acc-${crypto.randomUUID()}`,
    });
    await drainEconomicFacts();
    expect(await countPosted()).toBe(1);
    const replay = await integration.postConfirmedTaxCalculation(actor, calculated.id);
    expect(replay.idempotent).toBe(true);
    expect(await countPosted()).toBe(1);
  });

  it('rejects an operational user from requesting fiscal accounting posting', async () => {
    const admin = await seedActor(true);
    const stranger = await seedActor(false);
    const { debit, credit } = await seedLedger(admin);
    await publishEventRule(admin, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(admin);
    await expect(integration.postAuthorizedDocument(stranger, authorized.id)).rejects.toMatchObject({
      status: 403,
    });
  });

  it('replays a duplicate authorized fiscal document as one posted journal', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(actor);
    const first = await integration.postAuthorizedDocument(actor, authorized.id);
    const second = await integration.postAuthorizedDocument(actor, authorized.id);
    expect(second.journalEntryId).toBe(first.journalEntryId);
    expect(second.idempotent).toBe(true);
    await drainEconomicFacts();
    expect(await countPosted()).toBe(1);
    expect(await repository.countDuplicatePostings()).toBe(0);
  });

  it('serializes concurrent workers of the same fiscal authorization to one journal', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(actor);
    const results = await Promise.allSettled([
      integration.postAuthorizedDocument(actor, authorized.id),
      integration.postAuthorizedDocument(actor, authorized.id),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    const ids = fulfilled.map((item) =>
      item.status === 'fulfilled' ? item.value.journalEntryId : '',
    );
    expect(new Set(ids.filter(Boolean)).size).toBe(1);
    expect(await countPosted()).toBe(1);
  });

  it('returns ACCOUNTING_RULE_NOT_CONFIGURED when the fiscal event has no published rule', async () => {
    const actor = await seedActor();
    await seedLedger(actor);
    const authorized = await authorizeDocument(actor);
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    expect(await countPosted()).toBe(0);
    await expect(integration.postAuthorizedDocument(actor, authorized.id)).rejects.toMatchObject({
      code: ACCOUNTING_ERROR_CODES.RULE_NOT_CONFIGURED,
    });
    expect(await countPosted()).toBe(0);
  });

  it('cancels an authorized document with a corresponding accounting reversal', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(actor);
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    const cancelled = await fiscal.cancel(actor, authorized.id, {
      rowVersion: authorized.rowVersion,
      reason: 'Cancel official document',
    });
    expect(cancelled.status).toBe(FISCAL_STATUSES.Cancelled);
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    const replay = await integration.reverseCancelledDocument(
      actor,
      cancelled.id,
      'Cancel official document',
    );
    expect(replay.idempotent).toBe(true);
    await drainEconomicFacts();
    expect(await countPosted()).toBe(2);
    const kinds = await pool.query<{ kind: string }>(
      `SELECT kind::text AS kind FROM acc.journal_entries WHERE status = 'POSTED' ORDER BY created_at`,
    );
    expect(kinds.rows.map((row) => row.kind)).toEqual(['ENTRY', 'REVERSAL']);
  });

  it('rolls back injected failures so no partial journal remains and the fiscal document stays authorized', async () => {
    const actor = await seedActor();
    const { debit, credit } = await seedLedger(actor);
    const authorized = await authorizeDocument(actor);
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    expect(await countPosted()).toBe(0);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);

    failures.stage = POSTING_FAILURE_STAGES.AfterFiscalEvent;
    await expect(integration.postAuthorizedDocument(actor, authorized.id)).rejects.toThrow(
      /ACCOUNTING_POSTING_INJECTED_FAILURE/,
    );
    expect(await countPosted()).toBe(0);

    failures.stage = POSTING_FAILURE_STAGES.BeforeJournal;
    await expect(integration.postAuthorizedDocument(actor, authorized.id)).rejects.toThrow(
      /ACCOUNTING_POSTING_INJECTED_FAILURE/,
    );
    expect(await countPosted()).toBe(0);

    failures.stage = POSTING_FAILURE_STAGES.DuringPosting;
    await expect(integration.postAuthorizedDocument(actor, authorized.id)).rejects.toBeTruthy();
    expect(await countPosted()).toBe(0);
    const leftoverRequests = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM acc.accounting_posting_requests`,
    );
    expect(leftoverRequests.rows[0]?.count).toBe('0');
    expect((await fiscal.getDocument(actor, authorized.id)).status).toBe(FISCAL_STATUSES.Authorized);
  });

  it('reconstructs the ledger as SUM(DEBIT) = SUM(CREDIT) after fiscal postings and reversal', async () => {
    const actor = await seedActor();
    const { chart, debit, credit } = await seedLedger(actor);
    await publishEventRule(actor, POSTING_EVENTS.FiscalDocumentAuthorized, debit.id, credit.id);
    const authorized = await authorizeDocument(actor);
    await fiscal.cancel(actor, authorized.id, {
      rowVersion: authorized.rowVersion,
      reason: 'Cancel official document',
    });
    // Autorizacao e cancelamento publicaram seus fatos; a contabilizacao acontece
    // na entrega da outbox — inclusive o estorno compensatorio.
    await drainEconomicFacts();
    const ledger = await accounting.reconstructLedger(actor, chart.id);
    expect(ledger.balanced).toBe(true);
    expect(ledger.totalDebits).toBe(ledger.totalCredits);
    expect(await repository.countPostedUnbalanced()).toBe(0);
    expect(await repository.countDuplicatePostings()).toBe(0);
  });
});
