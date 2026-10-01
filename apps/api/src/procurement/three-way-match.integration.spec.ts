import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
  truncateProcurementTables,
  truncateSupplierTables,
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
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { FinanceModule } from '../finance/finance.module';
import { PayablesAccessService } from '../finance/services/payables-access.service';
import { SupplierAccessService } from '../suppliers/services/supplier-access.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { THREE_WAY_MATCH_CLASSIFICATIONS, THREE_WAY_MATCH_REASONS } from './domain/three-way-match';
import { PROCUREMENT_ERROR_CODES } from './errors/procurement-error-codes';
import { ProcurementModule } from './procurement.module';
import { ProcurementAccessService } from './services/procurement-access.service';
import { SupplierInvoiceAccessService } from './services/supplier-invoice-access.service';
import { ThreeWayMatchAccessService } from './services/three-way-match-access.service';

const UNIT = 'unit-twm-1';
const SUPPLIER_CNPJ = '33444555000103';

async function grantMatchAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.ProcurementRequestCreate,
    AUTHZ_ACTIONS.ProcurementRequestRead,
    AUTHZ_ACTIONS.ProcurementRequestSubmit,
    AUTHZ_ACTIONS.ProcurementRequestApprove,
    AUTHZ_ACTIONS.ProcurementOrderIssue,
    AUTHZ_ACTIONS.ProcurementOrderRead,
    AUTHZ_ACTIONS.ProcurementOrderReceive,
    AUTHZ_ACTIONS.ProcurementInvoiceCreate,
    AUTHZ_ACTIONS.ProcurementInvoiceRead,
    AUTHZ_ACTIONS.ProcurementMatchCompute,
    AUTHZ_ACTIONS.ProcurementMatchRead,
    AUTHZ_ACTIONS.SupplierCreate,
    AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
    AUTHZ_ACTIONS.FinancePayableRead,
  ]) {
    const resourceType = action.startsWith('supplier:')
      ? AUTHZ_RESOURCE_TYPES.Supplier
      : action.startsWith('finance:')
        ? AUTHZ_RESOURCE_TYPES.FinancePayable
        : AUTHZ_RESOURCE_TYPES.Procurement;
    await insertGrant(pool, {
      identityId,
      action,
      resourceType,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: identityId,
    });
  }
}

describe('Three-way match PostgreSQL integration', () => {
  let pool: Pool;
  let procurement: ProcurementAccessService;
  let invoices: SupplierInvoiceAccessService;
  let matches: ThreeWayMatchAccessService;
  let suppliers: SupplierAccessService;
  let payables: PayablesAccessService;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for three-way match integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, SuppliersModule, FinanceModule, ProcurementModule],
    }).compile();
    procurement = module.get(ProcurementAccessService);
    invoices = module.get(SupplierInvoiceAccessService);
    matches = module.get(ThreeWayMatchAccessService);
    suppliers = module.get(SupplierAccessService);
    payables = module.get(PayablesAccessService);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateProcurementTables(pool);
    await truncateSupplierTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`twm-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantMatchAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedOrder(
    actor: { identityId: string; sessionId: string },
    quantity: string,
  ) {
    const supplier = await suppliers.create(actor, {
      legalName: 'Fornecedor Conferencia LTDA',
      taxId: SUPPLIER_CNPJ,
      paymentTerms: '30 DDL',
      contacts: [{ name: 'Compras', purpose: CONTACT_PURPOSES.Operational, email: 'twm@sup.invalid' }],
    }, '22222222-2222-4222-8222-222222222222');
    const created = await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Conferencia three-way',
      lines: [{ description: 'Item conferido', quantity, unitAmount: '1' }],
    });
    const submitted = await procurement.submitRequest(actor, created.id, { version: created.version });
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    const approved = await procurement.approveRequest(checker, created.id, { version: submitted.version });
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    return { supplier, order };
  }

  async function receive(
    actor: { identityId: string; sessionId: string },
    order: Awaited<ReturnType<typeof seedOrder>>['order'],
    quantity: string,
  ) {
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Conferencia',
    });
    const received = await procurement.receiveOrder(actor, order.id, {
      version: order.version,
      idempotencyKey: `rcv-${crypto.randomUUID()}`,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-TWM',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: order.lines[0]!.id, quantity }],
    });
    return received;
  }

  async function createInvoice(
    actor: { identityId: string; sessionId: string },
    input: {
      supplierId: string;
      amount: string;
      number: string;
      orderId?: string;
      receiptId?: string;
    },
  ) {
    return invoices.create(actor, {
      unitId: UNIT,
      supplierId: input.supplierId,
      invoiceNumber: input.number,
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: input.amount,
      paymentTerms: '30 DDL',
      supplierPurchaseOrderId: input.orderId,
      goodsReceiptId: input.receiptId,
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
  }

  async function originFingerprint(orderId: string) {
    const order = await pool.query<{ version: number; updated_at: Date }>(
      `SELECT version, updated_at FROM prc.supplier_purchase_orders WHERE id = $1`,
      [orderId],
    );
    const receipts = await pool.query<{ id: string; payable_id: string | null }>(
      `SELECT id, payable_id FROM prc.goods_receipts WHERE supplier_purchase_order_id = $1 ORDER BY id`,
      [orderId],
    );
    const invoiceRows = await pool.query<{ id: string; status: string; version: number; total_amount: string }>(
      `SELECT id, status::text AS status, version, total_amount::text AS total_amount
       FROM prc.supplier_invoices
       WHERE supplier_purchase_order_id = $1
          OR goods_receipt_id IN (SELECT id FROM prc.goods_receipts WHERE supplier_purchase_order_id = $1)
       ORDER BY id`,
      [orderId],
    );
    return {
      order: order.rows[0],
      receipts: receipts.rows,
      invoices: invoiceRows.rows,
    };
  }

  it('classifies a complete PO, receipt and invoice as MATCHED without changing origin documents', async () => {
    const actor = await seedActor();
    const { supplier, order } = await seedOrder(actor, '100');
    const received = await receive(actor, order, '100');
    const invoice = await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '100',
      number: 'NF-TWM-OK',
      orderId: order.id,
      receiptId: received.receipts[0]!.id,
    });
    const before = await originFingerprint(order.id);
    const conference = await matches.compute(actor, order.id, {
      idempotencyKey: `twm-${crypto.randomUUID()}`,
    });
    expect(conference.classification).toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Matched);
    expect(conference.reasons).toEqual([]);
    expect(conference.supplierPurchaseOrderId).toBe(order.id);
    expect(conference.supplierInvoiceId).toBe(invoice.id);
    const after = await originFingerprint(order.id);
    expect(after).toEqual(before);
    expect(after.invoices[0]?.status).toBe('DRAFT');
  });

  it('classifies a partial receipt with a matching invoice as PARTIAL, never MATCHED', async () => {
    const actor = await seedActor();
    const { supplier, order } = await seedOrder(actor, '100');
    const received = await receive(actor, order, '40');
    await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '40',
      number: 'NF-TWM-PART',
      orderId: order.id,
      receiptId: received.receipts[0]!.id,
    });
    const conference = await matches.compute(actor, order.id, {
      idempotencyKey: `twm-${crypto.randomUUID()}`,
    });
    expect(conference.classification).toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Partial);
    expect(conference.reasons).toContain(THREE_WAY_MATCH_REASONS.IncompleteReceipt);
    expect(conference.classification).not.toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Matched);
  });

  it('does not auto-approve a divergent invoice price or amount', async () => {
    const actor = await seedActor();
    const { supplier, order } = await seedOrder(actor, '100');
    const received = await receive(actor, order, '100');
    const invoice = await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '120',
      number: 'NF-TWM-PRICE',
      orderId: order.id,
      receiptId: received.receipts[0]!.id,
    });
    const before = await originFingerprint(order.id);
    const conference = await matches.compute(actor, order.id, {
      idempotencyKey: `twm-${crypto.randomUUID()}`,
    });
    expect(conference.classification).toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Divergent);
    expect(conference.reasons).toContain(THREE_WAY_MATCH_REASONS.AmountMismatch);
    expect(conference.classification).not.toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Matched);
    const after = await originFingerprint(order.id);
    expect(after).toEqual(before);
    expect(after.invoices[0]?.total_amount).toBe(invoice.totalAmount);
  });

  it('does not auto-approve a divergent billed quantity', async () => {
    const actor = await seedActor();
    const { supplier, order } = await seedOrder(actor, '100');
    const received = await receive(actor, order, '100');
    await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '80',
      number: 'NF-TWM-QTY',
      orderId: order.id,
      receiptId: received.receipts[0]!.id,
    });
    const conference = await matches.compute(actor, order.id, {
      idempotencyKey: `twm-${crypto.randomUUID()}`,
    });
    expect(conference.classification).toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Divergent);
    expect(conference.reasons).toContain(THREE_WAY_MATCH_REASONS.QuantityMismatch);
    expect(conference.classification).not.toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Matched);
  });

  it('sends duplicate invoices to REVIEW_REQUIRED and replays the same conference without a second MATCHED', async () => {
    const actor = await seedActor();
    const { supplier, order } = await seedOrder(actor, '100');
    const received = await receive(actor, order, '100');
    await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '100',
      number: 'NF-TWM-DUP-1',
      orderId: order.id,
      receiptId: received.receipts[0]!.id,
    });
    await createInvoice(actor, {
      supplierId: supplier.id,
      amount: '100',
      number: 'NF-TWM-DUP-2',
      orderId: order.id,
    });
    const key = `twm-${crypto.randomUUID()}`;
    const first = await matches.compute(actor, order.id, { idempotencyKey: key });
    const replay = await matches.compute(actor, order.id, { idempotencyKey: key });
    expect(first.classification).toBe(THREE_WAY_MATCH_CLASSIFICATIONS.ReviewRequired);
    expect(first.reasons).toContain(THREE_WAY_MATCH_REASONS.DuplicateInvoice);
    expect(first.classification).not.toBe(THREE_WAY_MATCH_CLASSIFICATIONS.Matched);
    expect(replay.id).toBe(first.id);
    const stored = await pool.query<{ count: string; matched: string }>(
      `SELECT count(*)::text AS count,
              count(*) FILTER (WHERE classification = 'MATCHED')::text AS matched
       FROM prc.three_way_matches
       WHERE supplier_purchase_order_id = $1`,
      [order.id],
    );
    expect(stored.rows[0]?.count).toBe('1');
    expect(stored.rows[0]?.matched).toBe('0');
  });

  it('denies conference without grants', async () => {
    const admin = await seedActor();
    const stranger = await seedActor(false);
    const { order } = await seedOrder(admin, '10');
    await expect(
      matches.compute(stranger, order.id, { idempotencyKey: `twm-${crypto.randomUUID()}` }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.DENIED });
  });
});
