import {
  hashPassword,
  insertGrant,
  insertIdentity,
  truncateClientTables,
  truncateFinanceTables,
  truncateIdentityAndAuthorizationTables,
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
import { AUTHZ_ACTIONS } from '../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../authorization/types/authz-scopes';
import { ClientsModule } from '../clients/clients.module';
import { CONTACT_PURPOSES } from '../clients/domain/client-status';
import { ClientAccessService } from '../clients/services/client-access.service';
import { PAYABLE_ORIGIN_KINDS, PAYABLE_STATUSES } from '../finance/domain/payable';
import { FINANCE_ERROR_CODES } from '../finance/errors/finance-error-codes';
import { FinanceModule } from '../finance/finance.module';
import { PayablesAccessService } from '../finance/services/payables-access.service';
import { SUPPLIER_ERROR_CODES } from './errors/supplier-error-codes';
import { SupplierAccessService } from './services/supplier-access.service';
import { SuppliersModule } from './suppliers.module';

const TEST_CNPJ = '33444555000103';
const CLIENT_CNPJ = '11222333000181';
const UNIT_ID = 'unit-sup-1';

async function grantSupplierAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.SupplierCreate,
    AUTHZ_ACTIONS.SupplierRead,
    AUTHZ_ACTIONS.SupplierList,
    AUTHZ_ACTIONS.SupplierUpdate,
    AUTHZ_ACTIONS.SupplierDeactivate,
    AUTHZ_ACTIONS.SupplierActivate,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.Supplier,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

async function grantClientCreate(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  await insertGrant(pool, {
    identityId,
    action: AUTHZ_ACTIONS.ClientCreate,
    resourceType: AUTHZ_RESOURCE_TYPES.Client,
    scopeType: AUTHZ_SCOPES.Global,
    grantedByIdentityId: grantedBy,
  });
}

async function grantFinanceAdmin(pool: Pool, identityId: string, grantedBy: string): Promise<void> {
  const actions = [
    AUTHZ_ACTIONS.FinancePayableOpen,
    AUTHZ_ACTIONS.FinancePayableRead,
    AUTHZ_ACTIONS.FinanceExpenseCategoryCreate,
  ];
  for (const action of actions) {
    await insertGrant(pool, {
      identityId,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: grantedBy,
    });
  }
}

function supplierPayload(overrides?: { taxId?: string; legalName?: string }) {
  return {
    legalName: overrides?.legalName ?? 'Fornecedor Master LTDA',
    taxId: overrides?.taxId ?? TEST_CNPJ,
    tradeName: 'Fornecedor Master',
    paymentTerms: '30 DDL',
    currencyCode: 'BRL',
    contacts: [
      {
        name: 'Compras',
        purpose: CONTACT_PURPOSES.Operational,
        email: 'compras@supplier.invalid',
      },
    ],
    addresses: [
      {
        purpose: 'operational' as const,
        city: 'Porto Velho',
        state: 'RO',
      },
    ],
  };
}

describe('Supplier master PostgreSQL integration', () => {
  let pool: Pool;
  let supplierAccess: SupplierAccessService;
  let clientAccess: ClientAccessService;
  let payablesAccess: PayablesAccessService;
  const testDatabaseUrl = process.env['TEST_DATABASE_URL'];

  beforeAll(async () => {
    if (!testDatabaseUrl) {
      throw new Error('TEST_DATABASE_URL is required for supplier integration tests.');
    }
    applyAuthTestEnv(testDatabaseUrl);
    const module: TestingModule = await Test.createTestingModule({
      imports: [AuthModule, AuditModule, AuthorizationModule, ClientsModule, SuppliersModule, FinanceModule],
    }).compile();
    supplierAccess = module.get(SupplierAccessService);
    clientAccess = module.get(ClientAccessService);
    payablesAccess = module.get(PayablesAccessService);
    pool = new Pool({ connectionString: testDatabaseUrl });
  });

  beforeEach(async () => {
    await truncateFinanceTables(pool);
    await truncateSupplierTables(pool);
    await truncateClientTables(pool);
    await truncateIdentityAndAuthorizationTables(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  async function seedActor(options?: {
    supplier?: boolean;
    finance?: boolean;
    client?: boolean;
  }): Promise<{ identityId: string; sessionId: string }> {
    const login = normalizeLoginIdentifier(`supplier-${crypto.randomUUID()}@cisne.invalid`);
    const passwordHash = await hashPassword(AUTH_TEST_PASSWORD);
    const { identityId } = await insertIdentity(pool, login, passwordHash);
    if (options?.supplier !== false) {
      await grantSupplierAdmin(pool, identityId, identityId);
    }
    if (options?.finance) {
      await grantFinanceAdmin(pool, identityId, identityId);
    }
    if (options?.client) {
      await grantClientCreate(pool, identityId, identityId);
    }
    return { identityId, sessionId: 'test-session' };
  }

  it('rejects duplicate CNPJ and keeps a single supplier row', async () => {
    const actor = await seedActor();
    await supplierAccess.create(actor, supplierPayload());
    await expect(supplierAccess.create(actor, supplierPayload({ legalName: 'Outro Fornecedor LTDA' }))).rejects
      .toMatchObject({
        code: SUPPLIER_ERROR_CODES.TAX_ID_CONFLICT,
      });
    const count = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pty.suppliers WHERE normalized_tax_id = $1`,
      [TEST_CNPJ],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('rejects CPF because PF is not in release 1', async () => {
    const actor = await seedActor();
    await expect(
      supplierAccess.create(actor, supplierPayload({ taxId: '12345678901', legalName: 'Pessoa Fisica' })),
    ).rejects.toMatchObject({ code: SUPPLIER_ERROR_CODES.TAX_ID_INVALID });
  });

  it('keeps Supplier distinct from Client for the same CNPJ', async () => {
    const actor = await seedActor({ client: true });
    const client = await clientAccess.create(actor, {
      legalName: 'Cliente Distinto LTDA',
      taxId: TEST_CNPJ,
      contacts: [
        {
          name: 'Ops',
          purpose: CONTACT_PURPOSES.Operational,
          email: 'ops@client.invalid',
        },
      ],
    });
    const supplier = await supplierAccess.create(actor, supplierPayload());
    expect(supplier.id).not.toBe(client.id);
    expect(supplier.taxId).toBe(client.taxId);
    const clients = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pty.clients WHERE id = $1`,
      [supplier.id],
    );
    expect(clients.rows[0]?.count).toBe('0');
  });

  it('records history and detects version conflict', async () => {
    const actor = await seedActor();
    const created = await supplierAccess.create(actor, supplierPayload());
    const updated = await supplierAccess.update(actor, created.id, {
      version: created.version,
      tradeName: 'Fornecedor V2',
    });
    expect(updated.tradeName).toBe('Fornecedor V2');
    await expect(
      supplierAccess.update(actor, created.id, { version: created.version, tradeName: 'Stale' }),
    ).rejects.toMatchObject({ code: SUPPLIER_ERROR_CODES.VERSION_CONFLICT });
    const deactivated = await supplierAccess.deactivate(actor, created.id, updated.version, 'Encerramento');
    expect(deactivated.status).toBe('INACTIVE');
    const history = await supplierAccess.history(actor, created.id);
    expect(history.map((item) => item.eventKind)).toEqual(['CREATED', 'UPDATED', 'DEACTIVATED']);
  });

  it('denies supplier access without grants', async () => {
    const admin = await seedActor();
    const created = await supplierAccess.create(admin, supplierPayload());
    const stranger = await seedActor({ supplier: false });
    await expect(supplierAccess.getById(stranger, created.id)).rejects.toMatchObject({
      code: SUPPLIER_ERROR_CODES.DENIED,
    });
  });

  it('lists suppliers with human references, search, status filter and pagination', async () => {
    const actor = await seedActor();
    const alfa = await supplierAccess.create(
      actor,
      supplierPayload({ legalName: 'Alfa Servicos LTDA', taxId: '11222333000181' }),
    );
    await supplierAccess.create(
      actor,
      supplierPayload({ legalName: 'Beta Locacoes LTDA', taxId: '33444555000103' }),
    );

    const page = await supplierAccess.list(actor, { limit: 1, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items).toHaveLength(1);
    // A linha de lista identifica o fornecedor por referência humana, nunca por identificador.
    expect(page.items[0]).toMatchObject({ legalName: 'Alfa Servicos LTDA', taxId: '11222333000181' });
    expect(Object.keys(page.items[0] ?? {}).sort()).toEqual(
      ['currencyCode', 'id', 'legalName', 'paymentTerms', 'status', 'taxId', 'tradeName', 'updatedAt', 'version'].sort(),
    );

    const secondPage = await supplierAccess.list(actor, { limit: 1, offset: 1 });
    expect(secondPage.items[0]?.legalName).toBe('Beta Locacoes LTDA');

    const searched = await supplierAccess.list(actor, { limit: 20, offset: 0, q: 'beta' });
    expect(searched.total).toBe(1);
    expect(searched.items[0]?.id).not.toBe(alfa.id);

    const searchedByTaxId = await supplierAccess.list(actor, { limit: 20, offset: 0, q: '11222333' });
    expect(searchedByTaxId.total).toBe(1);
    expect(searchedByTaxId.items[0]?.id).toBe(alfa.id);

    await supplierAccess.deactivate(actor, alfa.id, alfa.version, 'Encerramento');
    const active = await supplierAccess.list(actor, { limit: 20, offset: 0, status: 'ACTIVE' });
    expect(active.total).toBe(1);
    expect(active.items[0]?.legalName).toBe('Beta Locacoes LTDA');
    const inactive = await supplierAccess.list(actor, { limit: 20, offset: 0, status: 'INACTIVE' });
    expect(inactive.items.map((item) => item.id)).toEqual([alfa.id]);
  });

  it('denies the list without the list grant', async () => {
    const admin = await seedActor();
    await supplierAccess.create(admin, supplierPayload());
    const stranger = await seedActor({ supplier: false });
    await insertGrant(pool, {
      identityId: stranger.identityId,
      action: AUTHZ_ACTIONS.SupplierRead,
      resourceType: AUTHZ_RESOURCE_TYPES.Supplier,
      scopeType: AUTHZ_SCOPES.Global,
      grantedByIdentityId: stranger.identityId,
    });
    // Somente `read` não autoriza listar: a listagem exige a concessão de lista.
    await expect(supplierAccess.list(stranger, { limit: 20, offset: 0 })).rejects.toMatchObject({
      code: SUPPLIER_ERROR_CODES.DENIED,
    });
  });

  it('opens a payable from an active supplier and blocks inactive supplier reference', async () => {
    const actor = await seedActor({ finance: true });
    const supplier = await supplierAccess.create(actor, supplierPayload());
    const category = await payablesAccess.createExpenseCategory(actor, {
      code: `CAT-${crypto.randomUUID().slice(0, 8)}`,
      name: 'Servicos',
    });
    const opened = await payablesAccess.open(actor, {
      unitId: UNIT_ID,
      supplierId: supplier.id,
      originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
      originId: crypto.randomUUID(),
      originReference: 'NFS-SUP-001',
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-OPS',
      principal: '100.0000',
      currencyCode: 'BRL',
      dueDate: '2099-12-31',
      paymentTerms: '30 DDL',
    });
    expect(opened.status).toBe(PAYABLE_STATUSES.Open);
    expect(opened.counterpartyId).toBe(supplier.id);

    const opaque = await payablesAccess.open(actor, {
      unitId: UNIT_ID,
      counterpartyId: crypto.randomUUID(),
      originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
      originId: crypto.randomUUID(),
      originReference: 'NFS-OPAQUE-001',
      expenseCategoryId: category.id,
      costCenterId: crypto.randomUUID(),
      costCenterCode: 'CC-OPS',
      principal: '50.0000',
      currencyCode: 'BRL',
      dueDate: '2099-12-31',
      paymentTerms: '30 DDL',
    });
    expect(opaque.status).toBe(PAYABLE_STATUSES.Open);

    const inactivated = await supplierAccess.deactivate(actor, supplier.id, supplier.version, 'Inativacao');
    await expect(
      payablesAccess.open(actor, {
        unitId: UNIT_ID,
        supplierId: inactivated.id,
        originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
        originId: crypto.randomUUID(),
        originReference: 'NFS-SUP-INACTIVE',
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-OPS',
        principal: '10.0000',
        currencyCode: 'BRL',
        dueDate: '2099-12-31',
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.SUPPLIER_INACTIVE });

    await expect(
      payablesAccess.open(actor, {
        unitId: UNIT_ID,
        supplierId: crypto.randomUUID(),
        originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
        originId: crypto.randomUUID(),
        originReference: 'NFS-SUP-MISSING',
        expenseCategoryId: category.id,
        costCenterId: crypto.randomUUID(),
        costCenterCode: 'CC-OPS',
        principal: '10.0000',
        currencyCode: 'BRL',
        dueDate: '2099-12-31',
        paymentTerms: '30 DDL',
      }),
    ).rejects.toMatchObject({ code: FINANCE_ERROR_CODES.SUPPLIER_NOT_FOUND });
  });

  it('does not persist a client row when creating a supplier', async () => {
    const actor = await seedActor();
    await supplierAccess.create(actor, supplierPayload({ taxId: CLIENT_CNPJ }));
    const clients = await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM pty.clients`);
    expect(clients.rows[0]?.count).toBe('0');
  });
});
