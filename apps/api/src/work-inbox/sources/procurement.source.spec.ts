import { HttpException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { GrantRow } from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { ScopeResolverService } from '../../authorization/services/scope-resolver.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import {
  PURCHASE_REQUEST_STATUSES,
  SUPPLIER_PURCHASE_ORDER_STATUSES,
} from '../../procurement/domain/procurement';
import type {
  PurchaseRequestSummaryResponse,
  SupplierPurchaseOrderSummaryResponse,
} from '../../procurement/serializers/procurement-response.serializer';
import {
  PROCUREMENT_READ_PAGE_SIZE,
  ProcurementWorkSource,
  toPurchaseRequestWorkItem,
  toSupplierOrderWorkItem,
} from './procurement.source';

/**
 * FONTE SUPRIMENTOS — comportamento vinculante.
 *
 * O que estes testes protegem (sem banco):
 * - so entram estados com proximo passo real: `PENDING_APPROVAL` (decisao humana) e
 *   `ISSUED`/`PARTIALLY_RECEIVED` (recebimento pendente); `RECEIVED`/`CANCELLED` nao sao trabalho;
 * - chaves logicas `SUPRIMENTOS:PURCHASE_REQUEST:<id>` e `SUPRIMENTOS:SUPPLIER_ORDER:<id>`, com rota
 *   real do detalhe e referencia humana (justificativa / fornecedor), nunca uuid;
 * - ESCOPO DE UNIDADE: a listagem de compras nao filtra unidade, entao a fonte aplica a restricao
 *   com o matcher do modulo de autorizacao — linha de unidade fora do escopo NAO aparece;
 * - sem autorizacao (403 do dominio dono) a lista e VAZIA, sem contagem e sem item anonimizado;
 * - leitura em lote (concessoes lidas uma vez por lista, paginas no teto do dominio), sem N+1.
 */

const ACTOR = { identityId: 'identity-1', sessionId: 'session-1' };
const REQUEST_ID = '11111111-2222-4333-8444-555555555555';
const OTHER_REQUEST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const ORDER_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';
const OTHER_ORDER_ID = 'ffffffff-1111-4222-8333-444444444444';
const PARTIAL_ORDER_ID = '11111111-aaaa-4bbb-8ccc-dddddddddddd';
const OTHER_PARTIAL_ORDER_ID = '22222222-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const SUPPLIER_ID = '99999999-1111-4222-8333-444444444444';

function grant(overrides: Partial<GrantRow> = {}): GrantRow {
  return {
    id: 'grant-1',
    identity_id: ACTOR.identityId,
    action: AUTHZ_ACTIONS.ProcurementRequestList,
    resource_type: AUTHZ_RESOURCE_TYPES.Procurement,
    resource_id: 'UN-A',
    scope_type: AUTHZ_SCOPES.Unit,
    constraints: null,
    granted_by_identity_id: 'admin-1',
    version: 1,
    valid_from: '2026-01-01T00:00:00.000Z',
    valid_until: null,
    revoked_at: null,
    revoked_by_identity_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function purchaseRequest(
  overrides: Partial<PurchaseRequestSummaryResponse> = {},
): PurchaseRequestSummaryResponse {
  return {
    id: REQUEST_ID,
    unitId: 'UN-A',
    justification: 'Reposição de filtros da frota',
    currencyCode: 'BRL',
    status: PURCHASE_REQUEST_STATUSES.PendingApproval,
    version: 2,
    lineCount: 3,
    totalAmount: '1200',
    createdAt: '2026-01-02T09:00:00.000Z',
    updatedAt: '2026-01-03T10:00:00.000Z',
    ...overrides,
  };
}

function supplierOrder(
  overrides: Partial<SupplierPurchaseOrderSummaryResponse> = {},
): SupplierPurchaseOrderSummaryResponse {
  return {
    id: ORDER_ID,
    requestId: REQUEST_ID,
    supplierId: SUPPLIER_ID,
    supplierName: 'Fornecedor Alfa',
    supplierTaxId: '12345678000199',
    unitId: 'UN-A',
    currencyCode: 'BRL',
    paymentTerms: '30 DDL',
    status: SUPPLIER_PURCHASE_ORDER_STATUSES.Issued,
    version: 1,
    lineCount: 2,
    totalAmount: '800',
    receivedQuantity: '0',
    issuedAt: '2026-01-06T08:00:00.000Z',
    updatedAt: '2026-01-06T08:00:00.000Z',
    ...overrides,
  };
}

describe('procurement source — apenas trabalho pendente de verdade', () => {
  it('solicitacao aguardando aprovacao entra como APPROVAL com chave logica, referencia e rota reais', () => {
    const item = toPurchaseRequestWorkItem(purchaseRequest());

    expect(item).toMatchObject({
      id: `SUPRIMENTOS:PURCHASE_REQUEST:${REQUEST_ID}`,
      domain: 'SUPRIMENTOS',
      kind: 'APPROVAL',
      businessReference: 'Reposição de filtros da frota',
      status: PURCHASE_REQUEST_STATUSES.PendingApproval,
      occurredAt: '2026-01-03T10:00:00.000Z',
      dueAt: null,
      actionLabel: 'Abrir a solicitação de compra para aprovação',
      targetRoute: `/app/procurement/requests/${REQUEST_ID}`,
      unitId: 'UN-A',
    });
    expect(item?.businessReference).not.toContain(REQUEST_ID);
  });

  it.each([
    PURCHASE_REQUEST_STATUSES.Draft,
    PURCHASE_REQUEST_STATUSES.Approved,
    PURCHASE_REQUEST_STATUSES.Rejected,
    PURCHASE_REQUEST_STATUSES.Cancelled,
  ])('solicitacao em %s nao entra na fila', (status) => {
    expect(toPurchaseRequestWorkItem(purchaseRequest({ status }))).toBeNull();
  });

  it('pedido emitido (recebimento pendente) entra como CONTINUITY, referenciado pelo fornecedor', () => {
    const item = toSupplierOrderWorkItem(supplierOrder());

    expect(item).toMatchObject({
      id: `SUPRIMENTOS:SUPPLIER_ORDER:${ORDER_ID}`,
      domain: 'SUPRIMENTOS',
      kind: 'CONTINUITY',
      businessReference: 'Fornecedor Alfa',
      status: SUPPLIER_PURCHASE_ORDER_STATUSES.Issued,
      occurredAt: '2026-01-06T08:00:00.000Z',
      dueAt: null,
      actionLabel: 'Abrir o pedido ao fornecedor para recebimento',
      targetRoute: `/app/procurement/orders/${ORDER_ID}`,
      unitId: 'UN-A',
    });
    expect(item?.businessReference).not.toContain(SUPPLIER_ID);
    expect(item?.businessReference).not.toContain(ORDER_ID);
  });

  it('recebimento parcial usa o ultimo fato persistido (recebimento), nao a emissao', () => {
    const item = toSupplierOrderWorkItem(
      supplierOrder({
        status: SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived,
        receivedQuantity: '4',
        updatedAt: '2026-01-09T15:00:00.000Z',
      }),
    );

    expect(item?.occurredAt).toBe('2026-01-09T15:00:00.000Z');
    expect(item?.status).toBe(SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived);
    expect(item?.reason).toContain('4');
  });

  it.each([SUPPLIER_PURCHASE_ORDER_STATUSES.Received, SUPPLIER_PURCHASE_ORDER_STATUSES.Cancelled])(
    'pedido em %s nao entra na fila',
    (status) => {
      expect(toSupplierOrderWorkItem(supplierOrder({ status }))).toBeNull();
    },
  );

  it('sem cadastro de fornecedor resolvido a referencia cai para CNPJ e depois para a emissao', () => {
    expect(toSupplierOrderWorkItem(supplierOrder({ supplierName: null }))?.businessReference).toBe(
      'Fornecedor 12345678000199',
    );
    expect(
      toSupplierOrderWorkItem(supplierOrder({ supplierName: null, supplierTaxId: null }))
        ?.businessReference,
    ).toBe('Pedido ao fornecedor emitido em 2026-01-06T08:00:00.000Z');
  });
});

describe('procurement source — leitura, escopo de unidade e autorizacao', () => {
  function build(input: {
    grants?: (action: string) => GrantRow[];
    listRequests?: (query: {
      status?: string;
      limit: number;
      offset: number;
    }) => Promise<{ items: PurchaseRequestSummaryResponse[] }>;
    listOrders?: (query: {
      status?: string;
      limit: number;
      offset: number;
    }) => Promise<{ items: SupplierPurchaseOrderSummaryResponse[] }>;
  }) {
    const authorization = {
      findActiveGrants: vi.fn(async (_identityId: string, action: string) =>
        input.grants ? input.grants(action) : [grant({ action })],
      ),
    };
    const procurement = {
      listRequests: vi.fn(
        (_actor: unknown, query: { status?: string; limit: number; offset: number }) =>
          input.listRequests
            ? input.listRequests(query)
            : Promise.resolve({ items: [purchaseRequest()] }),
      ),
      listOrders: vi.fn(
        (_actor: unknown, query: { status?: string; limit: number; offset: number }) =>
          input.listOrders ? input.listOrders(query) : Promise.resolve({ items: [] }),
      ),
    };
    return {
      authorization,
      procurement,
      source: new ProcurementWorkSource(
        procurement as never,
        authorization as never,
        new ScopeEnforcementService(new ScopeResolverService()),
      ),
    };
  }

  it('le pelas autoridades de lista do dominio, com o estado pendente e sem consulta por item', async () => {
    const { authorization, procurement, source } = build({});

    const items = await source.collect(ACTOR);

    expect(procurement.listRequests).toHaveBeenCalledWith(ACTOR, {
      status: PURCHASE_REQUEST_STATUSES.PendingApproval,
      limit: PROCUREMENT_READ_PAGE_SIZE,
      offset: 0,
    });
    expect(procurement.listOrders).toHaveBeenNthCalledWith(1, ACTOR, {
      status: SUPPLIER_PURCHASE_ORDER_STATUSES.Issued,
      limit: PROCUREMENT_READ_PAGE_SIZE,
      offset: 0,
    });
    expect(procurement.listOrders).toHaveBeenNthCalledWith(2, ACTOR, {
      status: SUPPLIER_PURCHASE_ORDER_STATUSES.PartiallyReceived,
      limit: PROCUREMENT_READ_PAGE_SIZE,
      offset: 0,
    });
    // Concessoes lidas UMA vez por lista, nunca por linha.
    expect(authorization.findActiveGrants).toHaveBeenCalledTimes(2);
    expect(authorization.findActiveGrants).toHaveBeenCalledWith(
      ACTOR.identityId,
      AUTHZ_ACTIONS.ProcurementRequestList,
      AUTHZ_RESOURCE_TYPES.Procurement,
    );
    expect(items.map((item) => item.id)).toEqual([`SUPRIMENTOS:PURCHASE_REQUEST:${REQUEST_ID}`]);
  });

  it('linha de unidade FORA do escopo do ator nao aparece — a listagem do dominio nao filtra unidade', async () => {
    const { source } = build({
      grants: (action) => [grant({ action, resource_id: 'UN-A' })],
      listRequests: async () => ({
        items: [
          purchaseRequest({ id: REQUEST_ID, unitId: 'UN-A' }),
          purchaseRequest({ id: OTHER_REQUEST_ID, unitId: 'UN-B' }),
        ],
      }),
      listOrders: async (query) => ({
        items: [
          supplierOrder({
            id:
              query.status === SUPPLIER_PURCHASE_ORDER_STATUSES.Issued
                ? ORDER_ID
                : PARTIAL_ORDER_ID,
            unitId: 'UN-A',
            status: query.status,
          }),
          supplierOrder({
            id:
              query.status === SUPPLIER_PURCHASE_ORDER_STATUSES.Issued
                ? OTHER_ORDER_ID
                : OTHER_PARTIAL_ORDER_ID,
            unitId: 'UN-B',
            status: query.status,
          }),
        ],
      }),
    });

    const items = await source.collect(ACTOR);

    expect(items.map((item) => item.id)).toEqual([
      `SUPRIMENTOS:PURCHASE_REQUEST:${REQUEST_ID}`,
      `SUPRIMENTOS:SUPPLIER_ORDER:${ORDER_ID}`,
      `SUPRIMENTOS:SUPPLIER_ORDER:${PARTIAL_ORDER_ID}`,
    ]);
    expect(items.every((item) => item.unitId === 'UN-A')).toBe(true);
    expect(items.some((item) => item.id.includes(OTHER_REQUEST_ID))).toBe(false);
    expect(items.some((item) => item.id.includes(OTHER_ORDER_ID))).toBe(false);
    expect(items.some((item) => item.id.includes(OTHER_PARTIAL_ORDER_ID))).toBe(false);
  });

  it('concessao GLOBAL sem ancora enxerga todas as unidades, sem inventar escopo', async () => {
    const { source } = build({
      grants: (action) => [grant({ action, scope_type: AUTHZ_SCOPES.Global, resource_id: null })],
      listRequests: async () => ({
        items: [
          purchaseRequest({ id: REQUEST_ID, unitId: 'UN-A' }),
          purchaseRequest({ id: OTHER_REQUEST_ID, unitId: 'UN-B' }),
        ],
      }),
    });

    const items = await source.collect(ACTOR);

    expect(items.map((item) => item.id)).toEqual([
      `SUPRIMENTOS:PURCHASE_REQUEST:${REQUEST_ID}`,
      `SUPRIMENTOS:PURCHASE_REQUEST:${OTHER_REQUEST_ID}`,
    ]);
  });

  it('sem concessao utilizavel na unidade a lista fica VAZIA, mesmo com linhas devolvidas pelo dominio', async () => {
    const { source } = build({
      grants: (action) => [grant({ action, resource_id: 'UN-Z' })],
    });

    await expect(source.collect(ACTOR)).resolves.toEqual([]);
  });

  it('sem autorizacao de lista (403 do dominio) devolve lista VAZIA, sem contagem e sem sinal', async () => {
    const { source } = build({
      listRequests: async () => {
        throw new HttpException('Access denied.', 403);
      },
      listOrders: async () => {
        throw new HttpException('Access denied.', 403);
      },
    });

    await expect(source.collect(ACTOR)).resolves.toEqual([]);
  });

  it('lista vazia continua vazia — a fila nao inventa pendencia de compra', async () => {
    const { source } = build({
      listRequests: async () => ({ items: [] }),
      listOrders: async () => ({ items: [] }),
    });

    await expect(source.collect(ACTOR)).resolves.toEqual([]);
  });

  it('falha real do dominio nao vira fila vazia', async () => {
    const { source } = build({
      listRequests: async () => {
        throw new HttpException('Unexpected procurement error.', 500);
      },
    });

    await expect(source.collect(ACTOR)).rejects.toThrow('Unexpected procurement error.');
  });
});
