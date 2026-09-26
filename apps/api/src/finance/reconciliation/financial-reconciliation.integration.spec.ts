import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNT_CLASSES, JOURNAL_DIRECTIONS, JOURNAL_SOURCE_KINDS } from '../../accounting/domain/ledger';
import { FINANCIAL_ACCOUNT_KINDS, FINANCIAL_DIRECTIONS, TREASURY_ORIGIN_KINDS } from '../domain/treasury';
import {
  createEnterpriseIntegrityContext,
  type EnterpriseIntegrityContext,
} from '../../enterprise-integrity/enterprise-integrity-harness';
import { MASTER_BUSINESS_UNIT } from '../../master-business/master-business-harness';
import { runUatVerticalScenario } from '../../uat/uat-vertical-runner';
import { UAT_SCENARIOS } from '../../uat/uat-scenarios';
import { runFinancialReconciliation } from './financial-reconciliation.collector';

const OCCURRED_ON = '2026-09-15';
const OCCURRED_AT = '2026-09-15T15:00:00.000Z';

describe('Financial continuous reconciliation integration', () => {
  let ctx: EnterpriseIntegrityContext;

  beforeAll(async () => {
    ctx = await createEnterpriseIntegrityContext();
  });

  beforeEach(async () => {
    await ctx.resetDatabase();
    // resetDatabase clears the fiscal registry (issuer), so re-seed it for each
    // test; the journey needs a default issuing establishment with active CNPJ.
    await seedDefaultIssuer(ctx.pool);
  });

  afterAll(async () => {
    await ctx.module.close();
    await ctx.pool.end();
  });

  async function runJourney(options: {
    postSettlementJournal: boolean;
    duplicateSettlementJournal?: boolean;
    treasuryAmountOffsetCents?: number;
  }) {
    const actor = await ctx.seedAdminActor();
    const checker = await ctx.seedFinancialChecker();
    const scenario = UAT_SCENARIOS.find((item) => item.id === 'locacao')!;
    const journey = await runUatVerticalScenario(ctx.services, scenario, actor, MASTER_BUSINESS_UNIT, {
      captureArtifacts: true,
    });
    if (journey.status !== 'PASS') {
      throw new Error(`JOURNEY FAIL: ${journey.error}`);
    }
    expect(journey.status).toBe('PASS');
    const artifacts = journey.artifacts!;
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

    const paid = await ctx.services.receivablesAccess.settle(checker, receivable.id, {
      amount: receivable.principal,
      rowVersion: receivable.rowVersion,
      idempotencyKey: `settle-${receivable.id}`,
    });
    const settlementId = paid.settlements[0]!.id;
    const settlementAmount = paid.settlements[0]!.amount;

    const bank = await ctx.services.treasuryAccess.openAccount(actor, {
      unitId: MASTER_BUSINESS_UNIT,
      kind: FINANCIAL_ACCOUNT_KINDS.Bank,
      code: `BAN-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conta recon',
      currencyCode: 'BRL',
      bank: { bankCode: '001', agency: '0001', accountNumber: '9001-0' },
    });
    const treasuryAmount = subtractCents(settlementAmount, options.treasuryAmountOffsetCents ?? 0);
    const movementPayload = {
      direction: FINANCIAL_DIRECTIONS.Credit,
      amount: treasuryAmount,
      rowVersion: (await ctx.services.treasuryAccess.getById(actor, bank.id)).rowVersion,
      idempotencyKey: `tx-${settlementId}`,
      reference: `SETTLE-${settlementId}`,
      originKind: TREASURY_ORIGIN_KINDS.ReceivableSettlement,
      originId: settlementId,
      originReference: `SETTLE-${settlementId}`,
      occurredAt: OCCURRED_AT,
    };
    await ctx.services.treasuryAccess.postMovement(actor, bank.id, movementPayload);

    if (options.postSettlementJournal) {
      const chart = await ctx.services.accountingAccess.createChart(actor, {
        unitId: MASTER_BUSINESS_UNIT,
        code: `COA-${crypto.randomUUID().slice(0, 8)}`,
        name: 'Recon chart',
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
        { lineNumber: 1, accountId: cash.id, direction: JOURNAL_DIRECTIONS.Debit, amount: settlementAmount },
        { lineNumber: 2, accountId: revenue.id, direction: JOURNAL_DIRECTIONS.Credit, amount: settlementAmount },
      ];
      const journalBase = {
        sourceContext: JOURNAL_SOURCE_KINDS.Settlement,
        sourceId: settlementId,
        unitId: MASTER_BUSINESS_UNIT,
        sourceReference: `SETTLE-${settlementId}`,
        chartId: chart.id,
        periodId: period.id,
        description: 'Settlement posting',
        occurredOn: OCCURRED_ON,
        currencyCode: 'BRL',
        actorIdentityId: actor.identityId,
        lines,
      };
      await ctx.services.accountingAccess.postFromSource({ ...journalBase, idempotencyKey: `je-${settlementId}` });
      if (options.duplicateSettlementJournal) {
        await ctx.services.accountingAccess.postFromSource({
          ...journalBase,
          idempotencyKey: `je-dup-${settlementId}`,
        });
      }
    }

    return { receivable, settlementId, settlementAmount };
  }

  it('reports PASS for a fully reconciled billing -> receivable -> settlement -> treasury -> journal chain', async () => {
    await runJourney({ postSettlementJournal: true });
    const report = await runFinancialReconciliation(ctx.pool);
    if (report.status !== 'PASS') {
      throw new Error(`RECON FAILED: ${JSON.stringify(report.findings)}`);
    }
    expect(report.status).toBe('PASS');
    expect(report.duplicateEconomicEffects).toBe(0);
    expect(report.unbalancedPostings).toBe(0);
    expect(report.findings).toEqual([]);
  });

  it('detects a missing settlement posting', async () => {
    await runJourney({ postSettlementJournal: false });
    const report = await runFinancialReconciliation(ctx.pool);
    expect(report.status).toBe('FAIL');
    expect(report.findings.some((finding) => finding.kind === 'MISSING_POSTING')).toBe(true);
  });

  it('detects duplicate settlement postings', async () => {
    await runJourney({ postSettlementJournal: true, duplicateSettlementJournal: true });
    const report = await runFinancialReconciliation(ctx.pool);
    expect(report.status).toBe('FAIL');
    expect(report.duplicateEconomicEffects).toBeGreaterThan(0);
    expect(report.findings.some((finding) => finding.kind === 'DUPLICATE_POSTING')).toBe(true);
  });

  it('detects a divergent treasury amount against its settlement source', async () => {
    await runJourney({ postSettlementJournal: true, treasuryAmountOffsetCents: 1 });
    const report = await runFinancialReconciliation(ctx.pool);
    expect(report.findings.some((finding) => finding.kind === 'AMOUNT_DIVERGENT')).toBe(true);
  });
});

function subtractCents(amount: string, cents: number): string {
  const [whole = '0', fraction = '0000'] = amount.split('.');
  const value = BigInt(whole) * 10_000n + BigInt((fraction + '0000').slice(0, 4));
  const result = value - BigInt(cents);
  if (result <= 0n) {
    return amount;
  }
  const wholePart = (result / 10_000n).toString();
  const fractionPart = (result % 10_000n).toString().padStart(4, '0');
  return `${wholePart}.${fractionPart}`;
}

async function seedDefaultIssuer(pool: import('pg').Pool): Promise<void> {
  const legal = await pool.query<{ id: string }>(
    `SELECT id FROM pty.legal_entities WHERE legal_name = 'CISNE RONDONIA COMERCIO E SERVICOS LTDA' LIMIT 1`,
  );
  let legalEntityId = legal.rows[0]?.id;
  if (!legalEntityId) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO pty.legal_entities (legal_name, trade_name)
       VALUES ('CISNE RONDONIA COMERCIO E SERVICOS LTDA', 'CISNE RONDONIA')
       RETURNING id`,
    );
    legalEntityId = inserted.rows[0]!.id;
  }

  const establishment = await pool.query<{ id: string }>(
    `SELECT id FROM pty.establishments WHERE legal_entity_id = $1 AND code = 'MATRIZ' LIMIT 1`,
    [legalEntityId],
  );
  let establishmentId = establishment.rows[0]?.id;
  if (!establishmentId) {
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO pty.establishments (
         legal_entity_id, code, trade_name, is_default_issuer,
         street, number, district, city, state, postal_code, country
       ) VALUES ($1, 'MATRIZ', 'CISNE RONDONIA', true,
         'R DOS FARRAPOS', '5000', 'SAO FRANCISCO', 'PORTO VELHO', 'RO', '76813284', 'BR')
       RETURNING id`,
      [legalEntityId],
    );
    establishmentId = inserted.rows[0]!.id;
  }

  const existingTax = await pool.query(
    `SELECT 1 FROM pty.establishment_tax_registrations
     WHERE tax_kind = 'CNPJ' AND normalized_number = '11897171000181' AND status = 'ACTIVE' LIMIT 1`,
  );
  if ((existingTax.rowCount ?? 0) === 0) {
    await pool.query(
      `INSERT INTO pty.establishment_tax_registrations (establishment_id, tax_kind, normalized_number, status)
       VALUES ($1, 'CNPJ', '11897171000181', 'ACTIVE')`,
      [establishmentId],
    );
  }
}
