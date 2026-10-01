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

const UNIT = 'unit-prc-1';
const SUPPLIER_CNPJ = '33444555000103';

async function grantProcurementAdmin(pool: Pool, identityId: string): Promise<void> {
  for (const action of [
    AUTHZ_ACTIONS.ProcurementRequestCreate,
    AUTHZ_ACTIONS.ProcurementRequestRead,
    AUTHZ_ACTIONS.ProcurementRequestList,
    AUTHZ_ACTIONS.ProcurementRequestSubmit,
    AUTHZ_ACTIONS.ProcurementRequestApprove,
    AUTHZ_ACTIONS.ProcurementRequestReject,
    AUTHZ_ACTIONS.ProcurementRequestCancel,
    AUTHZ_ACTIONS.ProcurementOrderIssue,
    AUTHZ_ACTIONS.ProcurementOrderRead,
    AUTHZ_ACTIONS.ProcurementOrderList,
    AUTHZ_ACTIONS.ProcurementOrderReceive,
    AUTHZ_ACTIONS.ProcurementOrderCancel,
    AUTHZ_ACTIONS.SupplierCreate,
    AUTHZ_ACTIONS.SupplierRead,
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

describe('Procurement core PostgreSQL integration', () => {
  let pool: Pool;
  let procurement: ProcurementAccessService;
  let suppliers: SupplierAccessService;
  let payables: PayablesAccessService;
  let failures: ProcurementFailureInjection;
  let matrices: ApprovalMatrixAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for procurement integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, SuppliersModule, FinanceModule, ProcurementModule],
    }).compile();
    procurement = module.get(ProcurementAccessService);
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
    const login = normalizeLoginIdentifier(`prc-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (withGrant) {
      await grantProcurementAdmin(pool, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  async function seedSupplier(actor: { identityId: string; sessionId: string }) {
    return suppliers.create(actor, {
      legalName: 'Fornecedor Compras LTDA',
      taxId: SUPPLIER_CNPJ,
      paymentTerms: '30 DDL',
      contacts: [{ name: 'Compras', purpose: CONTACT_PURPOSES.Operational, email: 'ops@sup.invalid' }],
    }, '22222222-2222-4222-8222-222222222222');
  }

  async function approvedRequest(actor: { identityId: string; sessionId: string }, quantity = '100') {
    const checker = await seedActor();
    await enableCriticalSodFor(pool, matrices, checker.identityId);
    const created = await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Reposicao operacional',
      lines: [{ description: 'Servico contratado', quantity, unitAmount: '1' }],
    });
    const submitted = await procurement.submitRequest(actor, created.id, { version: created.version });
    return procurement.approveRequest(checker, created.id, { version: submitted.version });
  }

  it('lists purchase requests with search, status filter and pagination', async () => {
    const actor = await seedActor();
    const alfa = await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Alfa reposicao',
      lines: [{ description: 'Item A', quantity: '10', unitAmount: '2' }],
    });
    await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Beta reposicao',
      lines: [{ description: 'Item B', quantity: '5', unitAmount: '4' }],
    });

    const first = await procurement.listRequests(actor, { limit: 1, offset: 0 });
    expect(first.total).toBe(2);
    expect(first.totalPages).toBe(2);
    expect(first.items).toHaveLength(1);
    // A linha traz valor e contagem persistidos pelo servidor, não um total informado.
    expect(first.items[0]).toMatchObject({ lineCount: 1 });
    expect(Number(first.items[0]?.totalAmount)).toBeGreaterThan(0);

    const searched = await procurement.listRequests(actor, { limit: 20, offset: 0, q: 'Beta' });
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.id).not.toBe(alfa.id);

    await procurement.submitRequest(actor, alfa.id, { version: alfa.version });
    const drafts = await procurement.listRequests(actor, { limit: 20, offset: 0, status: 'DRAFT' });
    expect(drafts.items.map((item) => item.id)).not.toContain(alfa.id);
    const pending = await procurement.listRequests(actor, {
      limit: 20,
      offset: 0,
      status: 'PENDING_APPROVAL',
    });
    expect(pending.items.map((item) => item.id)).toEqual([alfa.id]);
  });

  it('lists supplier orders with the supplier resolved as a human reference', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const request = await approvedRequest(actor);
    const order = await procurement.issueOrder(actor, request.id, {
      version: request.version,
      supplierId: supplier.id,
    });

    const page = await procurement.listOrders(actor, { limit: 20, offset: 0 });
    expect(page.total).toBe(1);
    const row = page.items[0];
    expect(row?.id).toBe(order.id);
    // Referência humana: o operador identifica o fornecedor por nome/CNPJ, não por identificador.
    expect(row?.supplierName).toBe('Fornecedor Compras LTDA');
    expect(row?.supplierTaxId).toBe(SUPPLIER_CNPJ);
    expect(row?.lineCount).toBe(1);

    const byName = await procurement.listOrders(actor, { limit: 20, offset: 0, q: 'Compras' });
    expect(byName.total).toBe(1);
    const byTaxId = await procurement.listOrders(actor, { limit: 20, offset: 0, q: '33444555' });
    expect(byTaxId.total).toBe(1);
    const wrongName = await procurement.listOrders(actor, { limit: 20, offset: 0, q: 'Inexistente' });
    expect(wrongName.total).toBe(0);

    // O detalhe também devolve a referência humana, em vez de expor apenas o identificador.
    const detail = await procurement.getOrder(actor, order.id);
    expect(detail.supplierName).toBe('Fornecedor Compras LTDA');
    expect(detail.supplierTaxId).toBe(SUPPLIER_CNPJ);
  });

  it('denies the procurement lists without the list grants', async () => {
    const actor = await seedActor();
    await procurement.listRequests(actor, { limit: 20, offset: 0 });

    const outsider = await seedActor(false);
    await expect(procurement.listRequests(outsider, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });
    await expect(procurement.listOrders(outsider, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });

    // Somente `read` não autoriza listar.
    const reader = await seedActor(false);
    for (const action of [AUTHZ_ACTIONS.ProcurementRequestRead, AUTHZ_ACTIONS.ProcurementOrderRead]) {
      await insertGrant(pool, {
        identityId: reader.identityId,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.Procurement,
        scopeType: AUTHZ_SCOPES.Global,
        grantedByIdentityId: reader.identityId,
      });
    }
    await expect(procurement.listRequests(reader, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });
    await expect(procurement.listOrders(reader, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });
  });

  it('requires approval before issuing a supplier purchase order', async () => {    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const draft = await procurement.createRequest(actor, {
      unitId: UNIT,
      justification: 'Sem aprovacao',
      lines: [{ description: 'Item', quantity: '10', unitAmount: '2' }],
    });
    await expect(
      procurement.issueOrder(actor, draft.id, { version: draft.version, supplierId: supplier.id }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.NOT_APPROVED });
    const approved = await approvedRequest(actor, '10');
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    expect(order.status).toBe('ISSUED');
    expect(order.requestId).toBe(approved.id);
    const customerPos = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM com.purchase_orders`);
    expect(customerPos.rows[0]?.count).toBe('0');
  });

  it('receives partially, then completes without duplicating payables or stock', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const approved = await approvedRequest(actor, '100');
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    const receiveInput = {
      version: order.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-PRC',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: order.lines[0]!.id, quantity: '40' }],
    };
    const partial = await procurement.receiveOrder(actor, order.id, {
      ...receiveInput,
      idempotencyKey: `rcv-${crypto.randomUUID()}`,
    });
    expect(partial.status).toBe('PARTIALLY_RECEIVED');
    expect(partial.lines[0]?.receivedQuantity).toBe('40.0000');
    const completed = await procurement.receiveOrder(actor, order.id, {
      ...receiveInput,
      version: partial.version,
      lines: [{ spoLineId: order.lines[0]!.id, quantity: '60' }],
      idempotencyKey: `rcv-${crypto.randomUUID()}`,
    });
    expect(completed.status).toBe('RECEIVED');
    const payablesCount = await pool.query<{ count: string; principal: string }>(
      `SELECT count(*)::text AS count, coalesce(sum(principal), 0)::text AS principal
       FROM fin.payables WHERE origin_kind = $1`,
      [PAYABLE_ORIGIN_KINDS.Purchase],
    );
    expect(payablesCount.rows[0]?.count).toBe('2');
    expect(payablesCount.rows[0]?.principal).toBe('100.0000');
    const payments = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM fin.payments`);
    expect(payments.rows[0]?.count).toBe('0');
    const stock = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM inv.stock_movements`);
    expect(stock.rows[0]?.count).toBe('0');
  });

  it('replays the same receipt idempotency key without a second payable', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const approved = await approvedRequest(actor, '50');
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    const key = `rcv-${crypto.randomUUID()}`;
    const payload = {
      version: order.version,
      idempotencyKey: key,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-PRC',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: order.lines[0]!.id, quantity: '50' }],
    };
    const first = await procurement.receiveOrder(actor, order.id, payload);
    const replay = await procurement.receiveOrder(actor, order.id, { ...payload, version: first.version });
    expect(replay.receipts).toHaveLength(1);
    expect(replay.receipts[0]?.id).toBe(first.receipts[0]?.id);
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = $1`,
      [PAYABLE_ORIGIN_KINDS.Purchase],
    );
    expect(payablesCount.rows[0]?.count).toBe('1');
    const currentRequest = await procurement.getRequest(actor, approved.id);
    await expect(
      procurement.issueOrder(actor, approved.id, { version: currentRequest.version, supplierId: supplier.id }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.DUPLICATE_ORDER });
  });

  it('serializes concurrent receipts so ordered quantity is not exceeded twice', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const approved = await approvedRequest(actor, '100');
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    const payload = {
      version: order.version,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-PRC',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: order.lines[0]!.id, quantity: '100' }],
    };
    const results = await Promise.allSettled([
      procurement.receiveOrder(actor, order.id, { ...payload, idempotencyKey: `c1-${crypto.randomUUID()}` }),
      procurement.receiveOrder(actor, order.id, { ...payload, idempotencyKey: `c2-${crypto.randomUUID()}` }),
    ]);
    const fulfilled = results.filter((item) => item.status === 'fulfilled');
    const rejected = results.filter((item) => item.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = $1`,
      [PAYABLE_ORIGIN_KINDS.Purchase],
    );
    expect(payablesCount.rows[0]?.count).toBe('1');
  });

  it('cancels an issued order without receipts and blocks cancel after receipt', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const first = await approvedRequest(actor, '10');
    const cancellable = await procurement.issueOrder(actor, first.id, {
      version: first.version,
      supplierId: supplier.id,
    });
    const cancelled = await procurement.cancelOrder(actor, cancellable.id, {
      version: cancellable.version,
      reason: 'Demanda encerrada',
    });
    expect(cancelled.status).toBe('CANCELLED');
    const secondApproved = await approvedRequest(actor, '10');
    const receivedOrder = await procurement.issueOrder(actor, secondApproved.id, {
      version: secondApproved.version,
      supplierId: supplier.id,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    const posted = await procurement.receiveOrder(actor, receivedOrder.id, {
      version: receivedOrder.version,
      idempotencyKey: `rcv-${crypto.randomUUID()}`,
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-PRC',
      dueDate: '2099-12-31',
      lines: [{ spoLineId: receivedOrder.lines[0]!.id, quantity: '10' }],
    });
    await expect(
      procurement.cancelOrder(actor, receivedOrder.id, { version: posted.version, reason: 'Tarde demais' }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.HAS_RECEIPTS });
  });

  it('rolls back a failed receipt so no leftover receipt or payable remains', async () => {
    const actor = await seedActor();
    const supplier = await seedSupplier(actor);
    const approved = await approvedRequest(actor, '25');
    const order = await procurement.issueOrder(actor, approved.id, {
      version: approved.version,
      supplierId: supplier.id,
    });
    const category = await payables.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Compras',
    });
    failures.stage = PROCUREMENT_FAILURE_STAGES.AfterReceiptInsert;
    await expect(
      procurement.receiveOrder(actor, order.id, {
        version: order.version,
        idempotencyKey: `rcv-${crypto.randomUUID()}`,
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-PRC',
        dueDate: '2099-12-31',
        lines: [{ spoLineId: order.lines[0]!.id, quantity: '25' }],
      }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.VALIDATION_FAILED });
    const receipts = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM prc.goods_receipts`);
    const payablesCount = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM fin.payables WHERE origin_kind = $1`,
      [PAYABLE_ORIGIN_KINDS.Purchase],
    );
    expect(receipts.rows[0]?.count).toBe('0');
    expect(payablesCount.rows[0]?.count).toBe('0');
    const refreshed = await procurement.getOrder(actor, order.id);
    expect(refreshed.status).toBe('ISSUED');
    expect(refreshed.lines[0]?.receivedQuantity).toBe('0.0000');
  });

  it('denies procurement actions without grants', async () => {
    const admin = await seedActor();
    const stranger = await seedActor(false);
    const created = await procurement.createRequest(admin, {
      unitId: UNIT,
      justification: 'Somente admin',
      lines: [{ description: 'Item', quantity: '1', unitAmount: '1' }],
    });
    await expect(procurement.getRequest(stranger, created.id)).rejects.toMatchObject({
      code: PROCUREMENT_ERROR_CODES.DENIED,
    });
    await expect(
      procurement.approveRequest(stranger, created.id, { version: created.version }),
    ).rejects.toMatchObject({ code: PROCUREMENT_ERROR_CODES.DENIED });
  });
});
