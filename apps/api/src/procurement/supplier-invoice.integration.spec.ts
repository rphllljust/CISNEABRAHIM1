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
import { PAYABLE_ORIGIN_KINDS } from '../finance/domain/payable';
import { FinanceModule } from '../finance/finance.module';
import { PayablesAccessService } from '../finance/services/payables-access.service';
import { SupplierAccessService } from '../suppliers/services/supplier-access.service';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PROCUREMENT_FAILURE_STAGES } from './domain/procurement-failure-injection';
import { PROCUREMENT_ERROR_CODES } from './errors/procurement-error-codes';
import { ProcurementFailureInjection } from './domain/procurement-failure-injection';
import { ProcurementModule } from './procurement.module';
import { ProcurementAccessService } from './services/procurement-access.service';
import { SupplierInvoiceAccessService } from './services/supplier-invoice-access.service';

const UNIT = 'unit-sinv-1';
const SUPPLIER_CNPJ = '33444555000103';

async function grantInvoiceAdmin(pool: Pool, identityId: string): Promise<void> {
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
    AUTHZ_ACTIONS.ProcurementInvoiceValidate,
    AUTHZ_ACTIONS.SupplierCreate,
    AUTHZ_ACTIONS.SupplierRead,
    AUTHZ_ACTIONS.SupplierDeactivate,
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

describe('Supplier invoice PostgreSQL integration', () => {
  let pool: Pool;
  let procurement: ProcurementAccessService;
  let invoices: SupplierInvoiceAccessService;
  let suppliers: SupplierAccessService;
  let payables: PayablesAccessService;
  let failures: ProcurementFailureInjection;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for supplier invoice integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, SuppliersModule, FinanceModule, ProcurementModule],
    }).compile();
    procurement = module.get(ProcurementAccessService);
    invoices = module.get(SupplierInvoiceAccessService);
    suppliers = module.get(SupplierAccessService);
    payables = module.get(PayablesAccessService);
    failures = module.get(ProcurementFailureInjection);
    matrices = module.get(ApprovalMatrixAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    failures.reset();
    await truncateFinanceTables(pool);
    await truncateProcurementTables(pool);
    await truncateSupplierTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(withGrant = true) {
    const login = normalizeLoginIdentifier(`sinv-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantInvoiceAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSupplier(actor: { identityId: string; sessionId: string }) {
    return suppliers.create(actor, {
      legalName: 'Fornecedor Fatura LTDA',
      taxId: SUPPLIER_CNPJ,
      paymentTerms: '30 DDL',
      contacts: [{ name: 'Fiscal', purpose: CONTACT_PURPOSES.Operational, email: 'fiscal@sup.invalid' }],
    }, '22222222-2222-4222-8222-222222222222');
  }

  async function approvedOrder(actor: { identityId: string; sessionId: string }, quantity = '100') {
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    const created = await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Compra faturada',
      lines: [{ description: 'Servico contratado', quantity, unitAmount: '1' }],
    });
    const submitted = await procurement.submitRequest(actor, created.id, { version: created.version });
    const approved = await procurement.approveRequest(checker, created.id, { version: submitted.version });
    const supplier = await seedSupplier(actor);
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    return { supplier, order };
  }

  async function receiveFull(
    actor: { identityId: string; sessionId: string },
    order: Awaited<ReturnType<typeof approvedOrder>>['order'],
  ) {
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    const received = await procurement.receiveOrder(actor, order.id, {
      version: order.version,
      idempotencyKey: `rcv-${crypto.randomUUID()}`,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-SINV',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: order.lines[0]!.id, quantity: order.lines[0]!.orderedQuantity }],
    });
    return { category, received };
  }

  async function countPayables() {
    const result = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM fin.payables`);
    return Number(result.rows[0]?.count ?? '0');
  }

  it('validates a standalone invoice into exactly one payable', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Despesa',
    });
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-1001',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '250',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.payableId).toBeNull();
    const validated = await invoices.validate(actor, draft.id, {
      version: draft.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-SINV',
    });
    expect(validated.status).toBe('VALIDATED');
    expect(validated.payableId).toBeTruthy();
    const replay = await invoices.validate(actor, draft.id, {
      version: validated.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-SINV',
    });
    expect(replay.payableId).toBe(validated.payableId);
    expect(await countPayables()).toBe(1);
    const opened = await pool.query<{ origin_kind: string }>(
      `SELECT origin_kind::text AS origin_kind FROM fin.payables WHERE id = $1`,
      [validated.payableId],
    );
    expect(opened.rows[0]?.origin_kind).toBe(PAYABLE_ORIGIN_KINDS.SupplierInvoice);
  });

  it('rejects a duplicate invoice number for the same supplier', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-DUP',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '10',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    await expect(
      invoices.create(actor, {
        unitId: UNIT,
        supplierId: supplier.id,
        invoiceNumber: 'NF-DUP',
        issuedOn: '2026-09-02',
        dueDate: '2026-10-02',
        totalAmount: '10',
        paymentTerms: '30 DDL',
        idempotencyKey: `inv-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.INVOICE_DUPLICATE });
    expect(await countPayables()).toBe(0);
  });

  it('rejects a divergent amount against the related receipt and does not open a payable', async () => {
    const actor = await seedActor();
    const { supplier, order } = await approvedOrder(actor, '100');
    const { received } = await receiveFull(actor, order);
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-DIV',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '80',
      paymentTerms: '30 DDL',
      supplierPurchaseOrderId: order.id,
      goodsReceiptId: received.receipts[0]!.id,
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Divergente',
    });
    await expect(
      invoices.validate(actor, draft.id, {
        version: draft.version,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-SINV',
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.INVOICE_AMOUNT_MISMATCH });
    const refreshed = await invoices.get(actor, draft.id);
    expect(refreshed.status).toBe('DRAFT');
    expect(refreshed.payableId).toBeNull();
    expect(await countPayables()).toBe(1);
  });

  it('attaches the existing receipt payable instead of opening a second one', async () => {
    const actor = await seedActor();
    const { supplier, order } = await approvedOrder(actor, '40');
    const { received, category } = await receiveFull(actor, order);
    expect(await countPayables()).toBe(1);
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-ATT',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '40',
      paymentTerms: '30 DDL',
      supplierPurchaseOrderId: order.id,
      goodsReceiptId: received.receipts[0]!.id,
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    const validated = await invoices.validate(actor, draft.id, {
      version: draft.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-SINV',
    });
    expect(validated.payableId).toBe(received.receipts[0]!.payableId);
    expect(await countPayables()).toBe(1);
    await expect(
      invoices.create(actor, {
        unitId: UNIT,
        supplierId: supplier.id,
        invoiceNumber: 'NF-ATT-2',
        issuedOn: '2026-09-01',
        dueDate: '2026-10-01',
        totalAmount: '40',
        paymentTerms: '30 DDL',
        goodsReceiptId: received.receipts[0]!.id,
        idempotencyKey: `inv-${crypto.randomUUID()}`,
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.INVOICE_DUPLICATE });
  });

  it('rejects validation when the supplier is inactive and leaves zero new payables', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Inativo',
    });
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-INA',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '15',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    await suppliers.deactivate(actor, supplier.id, supplier.version, 'Encerramento contratual', '22222222-2222-4222-8222-222222222222');
    await expect(
      invoices.validate(actor, draft.id, {
        version: draft.version,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-SINV',
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.VALIDATION_FAILED });
    expect(await countPayables()).toBe(0);
    const refreshed = await invoices.get(actor, draft.id);
    expect(refreshed.status).toBe('DRAFT');
  });

  it('serializes concurrent validation to a single payable', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Concorrencia',
    });
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-CON',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '70',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    const payload = {
      version: draft.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-SINV',
    };
    const results = await Promise.allSettled([
      invoices.validate(actor, draft.id, payload),
      invoices.validate(actor, draft.id, payload),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(await countPayables()).toBe(1);
  });

  it('rolls back injected validation failure without opening a payable', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Rollback',
    });
    const draft = await invoices.create(actor, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-RB',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '33',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    failures.stage = PROCUREMENT_FAILURE_STAGES.AfterInvoiceValidation;
    await expect(
      invoices.validate(actor, draft.id, {
        version: draft.version,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-SINV',
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.VALIDATION_FAILED });
    const refreshed = await invoices.get(actor, draft.id);
    expect(refreshed.status).toBe('DRAFT');
    expect(refreshed.payableId).toBeNull();
    expect(await countPayables()).toBe(0);
  });

  it('denies invoice actions without grants', async () => {
    const admin = await seedActor();
    const stranger = await seedActor(false);
    const supplier = await seedSupplier(admin);
    const draft = await invoices.create(admin, {
      unitId: UNIT,
      supplierId: supplier.id,
      invoiceNumber: 'NF-AUTH',
      issuedOn: '2026-09-01',
      dueDate: '2026-10-01',
      totalAmount: '5',
      paymentTerms: '30 DDL',
      idempotencyKey: `inv-${crypto.randomUUID()}`,
    });
    await expect(invoices.get(stranger, draft.id)).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });
    const category = await payables.createExpenseCategory(admin, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Auth',
    });
    await expect(
      invoices.validate(stranger, draft.id, {
        version: draft.version,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-SINV',
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.DENIED });
    expect(await countPayables()).toBe(0);
  });
});
