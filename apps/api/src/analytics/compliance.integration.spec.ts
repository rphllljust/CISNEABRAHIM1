import {
  insertGrant,
  insertIdentity,
  insertScopeRef,
  truncateAccountingTables,
  truncateFiscalTables,
  truncateIdentityAndAuthorizationTables,
} from '@cisne/database';
import { Test, TestingModule } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyAuthTestEnv } from '../auth/test/auth-test-env';
import { AuthorizationModule } from '../authorization/authorization.module';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { DatabaseModule } from '../infrastructure/database/database.module';
import { AnalyticsHttpException } from './errors/analytics-http.exception';
import { ComplianceReadModelRepository } from './repositories/compliance-read-model.repository';
import { ComplianceAccessService } from './services/compliance-access.service';

const UNIT_A = 'unit-compliance-a';
const UNIT_B = 'unit-compliance-b';
const PERIOD_DAY = '2026-03-15';

/**
 * BI de conformidade contra PostgreSQL real: prova que o snapshot agrega os fatos persistidos
 * de fiscal e contabilidade, que a visibilidade por bloco vem das concessoes reais, que o
 * escopo de unidade e respeitado e que NO_DATA != 0 nas somas.
 */
describe('Compliance BI PostgreSQL integration', () => {
  let pool: Pool;
  let service: ComplianceAccessService;
  let repository: ComplianceReadModelRepository;
  let fiscalOnly: { identityId: string; sessionId: string };
  let accountingOnly: { identityId: string; sessionId: string };
  let stranger: { identityId: string; sessionId: string };
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for compliance integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [DatabaseModule, AuthorizationModule],
      providers: [ComplianceReadModelRepository, ComplianceAccessService],
    }).compile();
    service = module.get(ComplianceAccessService);
    repository = module.get(ComplianceReadModelRepository);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateAccountingTables(pool);
    await truncateFiscalTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_A });
    await insertScopeRef(pool, { scopeType: 'UNIT', refId: UNIT_B });

    fiscalOnly = await seedActor([
      { action: AUTHZ_ACTIONS.FiscalDocumentRead, resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument },
    ]);
    accountingOnly = await seedActor([
      {
        action: AUTHZ_ACTIONS.AccountingJournalRead,
        resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
      },
    ]);
    stranger = await seedActor([]);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(
    grants: Array<{ action: string; resourceType: string }>,
  ): Promise<{ identityId: string; sessionId: string }> {
    const suffix = crypto.randomUUID();
    const { identityId } = await insertIdentity(pool, `compliance-${suffix}@cisne.invalid`);
    for (const grant of grants) {
      await insertGrant(pool, {
        identityId,
        action: grant.action,
        resourceType: grant.resourceType,
        scopeType: AUTHZ_SCOPES.Unit,
        resourceId: UNIT_A,
        grantedByIdentityId: identityId,
      });
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedFiscalDocument(unitId: string, status: string, actorId: string): Promise<void> {
    await pool.query(
      `INSERT INTO fis.fiscal_documents (
         unit_id, status, source_kind, description, currency_code, issued_on, idempotency_key,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2::fis.fiscal_document_status, 'MANUAL', 'doc', 'BRL', $3::date, $4, $5, $5)`,
      [unitId, status, PERIOD_DAY, `fis-${crypto.randomUUID()}`, actorId],
    );
  }

  async function seedAccountingPeriod(
    unitId: string,
    status: string,
    actorId: string,
    code = '2026-03',
  ): Promise<string> {
    const chart = await pool.query<{ id: string }>(
      `INSERT INTO acc.charts_of_accounts (unit_id, code, name, status, created_by_identity_id, updated_by_identity_id)
       VALUES ($1, $2, 'Plano', 'ACTIVE', $3, $3) RETURNING id`,
      [unitId, `PLC-${crypto.randomUUID().slice(0, 8)}`, actorId],
    );
    const window =
      code === '2026-02'
        ? { startsOn: '2026-02-01', endsOn: '2026-02-28' }
        : { startsOn: '2026-03-01', endsOn: '2026-03-31' };
    const closed = status === 'CLOSED';
    const period = await pool.query<{ id: string }>(
      `INSERT INTO acc.accounting_periods (
         chart_id, unit_id, code, starts_on, ends_on, status,
         closed_at, closed_by_identity_id, close_reason,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, $4::date, $5::date, $6::acc.period_status,
         CASE WHEN $7 THEN now() ELSE NULL END,
         CASE WHEN $7 THEN $8::uuid ELSE NULL END,
         CASE WHEN $7 THEN 'fechamento de teste' ELSE NULL END,
         $8, $8)
       RETURNING id`,
      [chart.rows[0]!.id, unitId, code, window.startsOn, window.endsOn, status, closed, actorId],
    );
    return period.rows[0]!.id;
  }

  /**
   * Lancamento real: a regra de partidas dobradas e validada pelo banco, portanto o
   * lancamento nasce como rascunho com duas contas balanceadas e so entao e efetivado.
   */
  async function seedJournalEntry(
    unitId: string,
    periodId: string,
    status: string,
    actorId: string,
  ): Promise<void> {
    const chart = await pool.query<{ id: string }>(
      `SELECT chart_id AS id FROM acc.accounting_periods WHERE id = $1`,
      [periodId],
    );
    const chartId = chart.rows[0]!.id;
    const suffix = crypto.randomUUID().slice(0, 8);
    const accounts = await pool.query<{ id: string }>(
      `INSERT INTO acc.accounting_accounts (chart_id, code, name, class, status, created_by_identity_id, updated_by_identity_id)
       SELECT $1, code, name, 'ASSET', 'ACTIVE', $2, $2
       FROM (VALUES ($3, 'Conta A'), ($4, 'Conta B')) AS v(code, name)
       RETURNING id`,
      [chartId, actorId, `1.${suffix}`, `2.${suffix}`],
    );
    const entry = await pool.query<{ id: string }>(
      `INSERT INTO acc.journal_entries (
         chart_id, period_id, unit_id, status, kind, description, occurred_on, currency_code,
         source_kind, source_id, source_reference, idempotency_key,
         created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3, 'DRAFT'::acc.journal_status, 'ENTRY', 'lancamento', $4::date, 'BRL',
         'MANUAL', $5, 'MAN-1', $6, $7, $7)
       RETURNING id`,
      [chartId, periodId, unitId, PERIOD_DAY, crypto.randomUUID(), `je-${crypto.randomUUID()}`, actorId],
    );
    await pool.query(
      `INSERT INTO acc.journal_entry_lines (journal_entry_id, line_number, account_id, direction, amount, description)
       VALUES ($1, 1, $2, 'DEBIT', 10.0000, 'debito'), ($1, 2, $3, 'CREDIT', 10.0000, 'credito')`,
      [entry.rows[0]!.id, accounts.rows[0]!.id, accounts.rows[1]!.id],
    );
    if (status === 'POSTED') {
      await pool.query(
        `UPDATE acc.journal_entries
         SET status = 'POSTED'::acc.journal_status,
             posted_at = now(),
             posted_by_identity_id = $2::uuid,
             entry_number = nextval(pg_get_serial_sequence('acc.journal_entries', 'entry_number'))
         WHERE id = $1`,
        [entry.rows[0]!.id, actorId],
      );
    }
  }

  it('agrega documentos fiscais, periodos e lancamentos da unidade sem contaminar outra unidade', async () => {
    const actorId = fiscalOnly.identityId;
    await seedFiscalDocument(UNIT_A, 'DRAFT', actorId);
    await seedFiscalDocument(UNIT_A, 'READY', actorId);
    await seedFiscalDocument(UNIT_A, 'SUBMITTED', actorId);
    const periodId = await seedAccountingPeriod(UNIT_A, 'OPEN', actorId);
    await seedAccountingPeriod(UNIT_A, 'CLOSED', actorId, '2026-02');
    await seedJournalEntry(UNIT_A, periodId, 'POSTED', actorId);
    await seedJournalEntry(UNIT_A, periodId, 'DRAFT', actorId);

    // Outra unidade nao pode contaminar o agregado.
    await seedFiscalDocument(UNIT_B, 'READY', actorId);
    const otherPeriod = await seedAccountingPeriod(UNIT_B, 'OPEN', actorId);
    await seedJournalEntry(UNIT_B, otherPeriod, 'POSTED', actorId);

    const raw = await repository.summarize({
      unitId: UNIT_A,
      occurredFrom: '2026-03-01',
      occurredTo: '2026-03-31',
    });

    expect(raw.fiscalDocumentsByStatus.DRAFT).toBe(1);
    expect(raw.fiscalDocumentsByStatus.READY).toBe(1);
    expect(raw.fiscalDocumentsByStatus.SUBMITTED).toBe(1);
    // DRAFT/READY/SUBMITTED ainda nao foram autorizados nem cancelados.
    expect(raw.fiscalPendingTransmissionCount).toBe(3);
    expect(raw.accountingPeriodsOpenCount).toBe(1);
    expect(raw.accountingPeriodsClosedCount).toBe(1);
    expect(raw.journalEntriesPostedCount).toBe(1);
    expect(raw.journalEntriesDraftCount).toBe(1);
  });

  it('nao agrega documento fiscal fora da janela do periodo consultado', async () => {
    await seedFiscalDocument(UNIT_A, 'READY', fiscalOnly.identityId);
    const outside = await repository.summarize({
      unitId: UNIT_A,
      occurredFrom: '2026-04-01',
      occurredTo: '2026-04-30',
    });
    expect(outside.fiscalPendingTransmissionCount).toBe(0);
    // A distribuicao por situacao nao e Janela-dependent: reflete o estado da unidade.
    expect(outside.fiscalDocumentsByStatus.READY).toBe(1);
  });

  it('NO_DATA != 0: soma sem populacao elegivel devolve null, contagem devolve zero real', async () => {
    const raw = await repository.summarize({
      unitId: UNIT_A,
      occurredFrom: '2026-03-01',
      occurredTo: '2026-03-31',
    });
    expect(raw.taxObligationsOpenAmount).toBeNull();
    expect(raw.taxObligationsOpenCount).toBe(0);
    expect(raw.fiscalPendingTransmissionCount).toBe(0);
    expect(raw.accountingPeriodsOpenCount).toBe(0);
    expect(raw.journalEntriesPostedCount).toBe(0);
  });

  it('expoe somente os blocos autorizados e marca o bloco sem concessao como indisponivel', async () => {
    const fiscalSnapshot = await service.getComplianceSnapshot(fiscalOnly, {
      unitId: UNIT_A,
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(fiscalSnapshot.visibility).toEqual({ fiscal: true, accounting: false });
    expect(fiscalSnapshot.fiscal.available).toBe(true);
    expect(fiscalSnapshot.accounting.available).toBe(false);
    expect(fiscalSnapshot.accounting.metrics.every((metric) => metric.available === false)).toBe(true);
    expect(
      fiscalSnapshot.fiscal.metrics.some(
        (metric) => metric.metricId === 'fiscal.tax_obligations_open_amount' && metric.value === null,
      ),
    ).toBe(true);

    const accountingSnapshot = await service.getComplianceSnapshot(accountingOnly, {
      unitId: UNIT_A,
      from: '2026-03-01',
      to: '2026-03-31',
    });
    expect(accountingSnapshot.visibility).toEqual({ fiscal: false, accounting: true });
    expect(accountingSnapshot.accounting.available).toBe(true);
    expect(accountingSnapshot.fiscal.available).toBe(false);
  });

  it('nega a consulta para ator sem concessao fiscal nem contabil', async () => {
    await expect(
      service.getComplianceSnapshot(stranger, { unitId: UNIT_A }),
    ).rejects.toBeInstanceOf(AnalyticsHttpException);
  });

  it('exige unitId: nao agrega o tenant inteiro por omissao', async () => {
    await expect(service.getComplianceSnapshot(fiscalOnly, {})).rejects.toBeInstanceOf(
      AnalyticsHttpException,
    );
  });

  it('nega unidade sem concessao em vez de devolver bloco zerado', async () => {
    await expect(
      service.getComplianceSnapshot(fiscalOnly, { unitId: UNIT_B }),
    ).rejects.toBeInstanceOf(AnalyticsHttpException);
  });
});
