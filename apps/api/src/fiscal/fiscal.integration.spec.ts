import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFiscalTables,
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
import { ApprovalMatrixAccessService } from '../authorization/services/approval-matrix-access.service';
import { enableCriticalSodFor } from '../authorization/test/critical-sod-harness';
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { FISCAL_SOURCE_KINDS, FISCAL_STATUSES } from './domain/fiscal-document';
import {
  FISCAL_CREDENTIALING_STATUSES,
  FISCAL_VALIDITY_LEGENDS,
  OFFICIAL_DANFE,
  type FiscalCredentialingSnapshot,
} from './domain/fiscal-credentialing';
import { FISCAL_ERROR_CODES } from './errors/fiscal-error-codes';
import { FiscalHttpException } from './errors/fiscal-http.exception';
import { FiscalModule } from './fiscal.module';
import {
  FISCAL_AUTHORIZATION_GATEWAY,
  type FiscalAuthorizationGateway,
  type FiscalGatewaySubmitResult,
} from './ports/fiscal-authorization-gateway.port';
import { FISCAL_CREDENTIALING_PORT, type FiscalCredentialingPort } from './ports/fiscal-credentialing.port';
import { FiscalAccessService } from './services/fiscal-access.service';
import { FiscalRepository } from './repositories/fiscal.repository';

const UNIT = 'unit-fis-a';

class ScriptedFiscalGateway implements FiscalAuthorizationGateway {
  readonly gatewayId = 'scripted-fiscal-authorization';
  next: FiscalGatewaySubmitResult = { outcome: 'AUTHORIZED', protocolCode: 'PROT-1' };

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

async function grantFiscalAdmin(pool: Pool, identityId: string): Promise<void> {
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
}

describe('Fiscal core PostgreSQL integration', () => {
  let pool: Pool;
  let fiscal: FiscalAccessService;
  let repository: FiscalRepository;
  let gateway: ScriptedFiscalGateway;
  let credentialing: ScriptedFiscalCredentialing;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for fiscal integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    gateway = new ScriptedFiscalGateway();
    credentialing = new ScriptedFiscalCredentialing();
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, FiscalModule],
    })
      .overrideProvider(FISCAL_AUTHORIZATION_GATEWAY)
      .useValue(gateway)
      .overrideProvider(FISCAL_CREDENTIALING_PORT)
      .useValue(credentialing)
      .compile();
    fiscal = module.get(FiscalAccessService);
    repository = module.get(FiscalRepository);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFiscalTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
    gateway.next = { outcome: 'AUTHORIZED', protocolCode: 'PROT-1' };
    credentialing.approved = true;
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`fis-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantFiscalAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedFiscalPair() {
    const originator = await seedActor();
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, [originator.identityId, checker.identityId]);
    return { originator, checker };
  }

  function draftInput(overrides: Record<string, unknown> = {}) {
    const billingDocumentId = crypto.randomUUID();
    return {
      unitId: UNIT,
      sourceKind: FISCAL_SOURCE_KINDS.BillingDocument,
      sourceId: billingDocumentId,
      billingDocumentId,
      description: 'Official fiscal document',
      currencyCode: 'BRL',
      issuedOn: '2026-09-01',
      idempotencyKey: `fis-${crypto.randomUUID()}`,
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
      taxDetails: [
        {
          lineNumber: 1,
          componentLabel: 'TAX_SNAPSHOT',
          amount: '10.0000',
          detailSnapshot: { suppliedBy: 'caller', notComputedByCisne: true },
        },
      ],
      ...overrides,
    };
  }

  async function readyDocument(actor: { identityId: string; sessionId: string }) {
    const created = await fiscal.createDraft(actor, draftInput());
    return fiscal.markReady(actor, created.id, { rowVersion: created.rowVersion });
  }

  it('walks draft/ready/submit/authorized and keeps BillingDocument as a reference only', async () => {
    const { originator: actor, checker } = await seedFiscalPair();
    const ready = await readyDocument(actor);
    expect(ready.status).toBe(FISCAL_STATUSES.Ready);
    expect(ready.billingDocumentId).toBeTruthy();
    const authorized = await fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });
    expect(authorized.status).toBe(FISCAL_STATUSES.Authorized);
    expect(authorized.authorizations[0]?.outcome).toBe('AUTHORIZED');
    expect(authorized.officialDanfe).toBe(OFFICIAL_DANFE.Allowed);
    const table = await pool.query<{ relname: string }>(
      `SELECT relname FROM pg_class WHERE relname = 'fiscal_documents'`,
    );
    expect(table.rows[0]?.relname).toBe('fiscal_documents');
    const cross = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM information_schema.table_constraints
       WHERE table_schema = 'fis'
         AND constraint_type = 'FOREIGN KEY'
         AND constraint_name ILIKE '%billing%'`,
    );
    expect(cross.rows[0]?.count).toBe('0');
  });

  it('is idempotent on create and on resubmit of an authorized document', async () => {
    const { originator: actor, checker } = await seedFiscalPair();
    const payload = draftInput();
    const first = await fiscal.createDraft(actor, payload);
    const second = await fiscal.createDraft(actor, payload);
    expect(second.id).toBe(first.id);
    const ready = await fiscal.markReady(actor, first.id, { rowVersion: first.rowVersion });
    const authorized = await fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });
    const again = await fiscal.submit(actor, authorized.id, { rowVersion: authorized.rowVersion });
    expect(again.id).toBe(authorized.id);
    expect(again.status).toBe(FISCAL_STATUSES.Authorized);
    expect(again.rowVersion).toBe(authorized.rowVersion);
  });

  it('denies unauthorized submission and records rejection plus timeout recovery', async () => {
    const { originator: admin, checker } = await seedFiscalPair();
    const stranger = await seedActor(false);
    const ready = await readyDocument(admin);
    await expect(
      fiscal.submit(stranger, ready.id, { rowVersion: ready.rowVersion }),
    ).rejects.toBeInstanceOf(FiscalHttpException);

    gateway.next = { outcome: 'REJECTED', message: 'gateway-rejected' };
    const rejected = await fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });
    expect(rejected.status).toBe(FISCAL_STATUSES.Rejected);
    const revised = await fiscal.revise(admin, rejected.id, { rowVersion: rejected.rowVersion });
    expect(revised.status).toBe(FISCAL_STATUSES.Draft);
    const readyAgain = await fiscal.markReady(admin, revised.id, { rowVersion: revised.rowVersion });
    gateway.next = { outcome: 'TIMEOUT' };
    const timedOut = await fiscal.submit(checker, readyAgain.id, { rowVersion: readyAgain.rowVersion });
    expect(timedOut.status).toBe(FISCAL_STATUSES.Submitted);
    expect(timedOut.authorizations.some((item) => item.outcome === 'TIMEOUT')).toBe(true);
    gateway.next = { outcome: 'AUTHORIZED', protocolCode: 'PROT-RECOVER' };
    const recovered = await fiscal.recover(checker, timedOut.id, { rowVersion: timedOut.rowVersion });
    expect(recovered.status).toBe(FISCAL_STATUSES.Authorized);
  });

  it('forbids silent mutation of an authorized document and keeps an audit trail', async () => {
    const { originator: actor, checker } = await seedFiscalPair();
    const ready = await readyDocument(actor);
    const authorized = await fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });
    await expect(
      fiscal.replaceSnapshots(actor, authorized.id, {
        rowVersion: authorized.rowVersion,
        parties: authorized.parties,
        items: authorized.items.map((item) => ({
          lineNumber: item.lineNumber,
          description: 'mutated',
          quantity: '1.0000',
          unitAmount: '1.0000',
          lineAmount: '1.0000',
        })),
      }),
    ).rejects.toMatchObject({ code: FISCAL_ERROR_CODES.DOCUMENT_IMMUTABLE });
    await expect(
      pool.query(`UPDATE fis.fiscal_documents SET description = 'silent' WHERE id = $1`, [
        authorized.id,
      ]),
    ).rejects.toThrow(/FISCAL_DOCUMENT_IMMUTABLE/);
    const stored = await repository.findById(authorized.id);
    expect(stored?.document.description).toBe('Official fiscal document');
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit.security_audit_events
       WHERE resource_id = $1
       ORDER BY occurred_at`,
      [authorized.id],
    );
    expect(audit.rows.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        'security:fiscal:document:draft',
        'security:fiscal:document:authorize',
      ]),
    );
  });

  it('blocks transmission when credentialing is not approved even if the gateway would authorize', async () => {
    credentialing.approved = false;
    const { originator: actor, checker } = await seedFiscalPair();
    const ready = await readyDocument(actor);
    expect(ready.validityLegend).toBe(FISCAL_VALIDITY_LEGENDS.NoFiscalValidity);
    expect(ready.officialDanfe).toBe(OFFICIAL_DANFE.Blocked);
    await expect(fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion })).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.TRANSMISSION_BLOCKED,
    });
    const stored = await repository.findById(ready.id);
    expect(stored?.document.status).toBe(FISCAL_STATUSES.Ready);
  });

  it('refuses AUTHORIZED without a SEFAZ protocol', async () => {
    const { originator: actor, checker } = await seedFiscalPair();
    const ready = await readyDocument(actor);
    gateway.next = { outcome: 'AUTHORIZED', protocolCode: null };
    await expect(fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion })).rejects.toMatchObject({
      code: FISCAL_ERROR_CODES.OFFICIAL_AUTHORIZATION_BLOCKED,
    });
    const stored = await repository.findById(ready.id);
    expect(stored?.document.status).toBe(FISCAL_STATUSES.Submitted);
  });

  describe('list surface', () => {
    // O controller injeta page/pageSize por padrao; aqui repetimos o contrato real do servico.
    const listQuery = (overrides: Record<string, unknown> = {}) => ({
      unitId: UNIT,
      page: 0,
      pageSize: 20,
      ...overrides,
    });

    it('paginates by unit and filters by situational status without manual identifier lookup', async () => {
      const actor = await seedActor();
      const draft = await fiscal.createDraft(actor, draftInput());
      const ready = await fiscal.createDraft(actor, draftInput());
      const marked = await fiscal.markReady(actor, ready.id, { rowVersion: ready.rowVersion });

      const all = await fiscal.listDocuments(actor, listQuery());
      expect(all.total).toBe(2);
      expect(all.page).toBe(0);
      expect(all.pageSize).toBeGreaterThan(0);
      expect(all.items.map((item) => item.id).sort()).toEqual([draft.id, marked.id].sort());

      const readyOnly = await fiscal.listDocuments(actor, listQuery({ status: 'READY' }));
      expect(readyOnly.total).toBe(1);
      expect(readyOnly.items[0]?.id).toBe(marked.id);
      expect(readyOnly.items[0]?.status).toBe(FISCAL_STATUSES.Ready);

      const draftOnly = await fiscal.listDocuments(actor, listQuery({ status: 'DRAFT' }));
      expect(draftOnly.items.map((item) => item.id)).toEqual([draft.id]);

      const otherUnit = await fiscal.listDocuments(actor, listQuery({ unitId: 'unit-fis-other' }));
      expect(otherUnit.total).toBe(0);
      expect(otherUnit.items).toEqual([]);
    });

    it('exposes the latest authorization protocol and outcome in the list row', async () => {
      const { originator: actor, checker } = await seedFiscalPair();
      const ready = await readyDocument(actor);
      const authorized = await fiscal.submit(checker, ready.id, { rowVersion: ready.rowVersion });

      const page = await fiscal.listDocuments(actor, listQuery());
      const row = page.items.find((item) => item.id === authorized.id);
      expect(row?.lastProtocolCode).toBe('PROT-1');
      expect(row?.lastAuthorizationOutcome).toBe('AUTHORIZED');
    });

    it('denies the list to an actor without the list action', async () => {
      const stranger = await seedActor(false);
      const actor = await seedActor();
      await fiscal.createDraft(actor, draftInput());
      await expect(fiscal.listDocuments(stranger, listQuery())).rejects.toBeInstanceOf(
        FiscalHttpException,
      );
    });

    it('rejects an invalid list query instead of silently ignoring it', async () => {
      const actor = await seedActor();
      await expect(
        fiscal.listDocuments(actor, listQuery({ status: 'NOPE' })),
      ).rejects.toBeInstanceOf(FiscalHttpException);
      await expect(
        fiscal.listDocuments(
          actor,
          listQuery({ issuedFrom: '2026-09-10', issuedTo: '2026-09-01' }),
        ),
      ).rejects.toBeInstanceOf(FiscalHttpException);
      await expect(
        fiscal.listDocuments(actor, listQuery({ pageSize: '9999' })),
      ).rejects.toBeInstanceOf(FiscalHttpException);
    });
  });
});