import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createClientsFetchMock } from './clients-fetch-mock';
import { MOCK_IDENTITY_ID } from './shell-fetch-mock';
import {
  PROPOSAL_PRICING_STRUCTURES,
  PROPOSAL_VERSION_STATUSES,
  type Proposal,
  type ProposalDetail,
  type ProposalVersion,
} from '../proposals/types/proposal.types';
import {
  PURCHASE_ORDER_PRICING_STRUCTURES,
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrder,
  type PurchaseOrderDetail,
} from '../purchase-orders/types/purchase-order.types';

export type CommercialFetchMockOptions = {
  proposalListAllowed?: boolean;
  proposalCreateAllowed?: boolean;
  proposalUpdateAllowed?: boolean;
  proposalIssueAllowed?: boolean;
  proposalAcceptAllowed?: boolean;
  proposalRejectAllowed?: boolean;
  proposalExpireAllowed?: boolean;
  proposalCancelAllowed?: boolean;
  proposalVersionConflict?: boolean;
  /** Cadeia comercial simulada (elos ja autorizados pelo modulo dono). */
  proposalLinkedChain?: ProposalDetail['linkedChain'];
  purchaseOrderListAllowed?: boolean;
  purchaseOrderCreateAllowed?: boolean;
  purchaseOrderUpdateAllowed?: boolean;
  purchaseOrderRegisterAllowed?: boolean;
  purchaseOrderCancelAllowed?: boolean;
  purchaseOrderVersionConflict?: boolean;
  clientListAllowed?: boolean;
};

function requestError(code: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ error: { code, message: 'error' } }),
  } as Response;
}

function parseBody(init?: RequestInit): Record<string, unknown> {
  const rawBody = init?.body;
  if (typeof rawBody === 'string') {
    return JSON.parse(rawBody) as Record<string, unknown>;
  }
  return {};
}

function readString(body: Record<string, unknown>, key: string, fallback: string): string {
  const value = body[key];
  return typeof value === 'string' ? value : fallback;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

const DEMO_CLIENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const DEMO_PROPOSAL_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DEMO_PO_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const DEMO_REQUEST_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function buildProposalVersion(
  proposalId: string,
  versionNumber: number,
  status: string,
  rowVersion: number,
): ProposalVersion {
  return {
    id: `${proposalId}-v${versionNumber}`,
    proposalId,
    versionNumber,
    status: status as ProposalVersion['status'],
    pricingStructure: PROPOSAL_PRICING_STRUCTURES.GlobalPrice,
    currencyCode: 'BRL',
    globalSalePrice: '15000.0000',
    globalInternalCost: null,
    itemsSaleTotal: null,
    itemsInternalCostTotal: null,
    commercialTerms: {},
    clientSnapshot: { tradeName: 'Cliente Demo' },
    validUntil: '2026-12-31T23:59:59.000Z',
    notes: 'Proposta de demonstração',
    issuedAt: status !== PROPOSAL_VERSION_STATUSES.Draft ? '2026-01-02T10:00:00.000Z' : null,
    issuedByIdentityId: MOCK_IDENTITY_ID,
    supersededAt: null,
    acceptedAt: null,
    acceptedByIdentityId: null,
    acceptanceOriginCode: null,
    acceptanceEvidenceDocumentId: null,
    rejectedAt: null,
    rejectionReason: null,
    expiredAt: null,
    cancelledAt: null,
    cancellationReason: null,
    rowVersion,
    items: [],
    documents: [],
  };
}

const PROPOSAL_TRANSITIONS: Record<string, ProposalDetail['readiness']['availableTransitions']> = {
  DRAFT: ['issue', 'cancel'],
  ISSUED: ['accept', 'reject', 'expire', 'cancel'],
  ACCEPTED: ['revise'],
  REJECTED: ['revise'],
  EXPIRED: ['revise'],
  CANCELLED: ['revise'],
};

const PROPOSAL_NEXT_STEP: Record<
  string,
  {
    step: ProposalDetail['readiness']['nextStep'];
    transition: ProposalDetail['readiness']['nextStepTransition'];
  }
> = {
  DRAFT: { step: 'COMPLETE_AND_ISSUE', transition: 'issue' },
  ISSUED: { step: 'AWAIT_CLIENT_DECISION', transition: 'accept' },
  ACCEPTED: { step: 'FOLLOW_COMMERCIAL_FLOW', transition: null },
  REJECTED: { step: 'CREATE_NEW_REVISION', transition: 'revise' },
  EXPIRED: { step: 'CREATE_NEW_REVISION', transition: 'revise' },
  CANCELLED: { step: 'CREATE_NEW_REVISION', transition: 'revise' },
};

/** Concessoes simuladas pelo dublê — a prontidão só oferece o que o ator pode executar. */
export type ProposalMockPermissions = {
  issue: boolean;
  accept: boolean;
  reject: boolean;
  expire: boolean;
  cancel: boolean;
  revise: boolean;
};

/** Espelho da derivacao do backend: transicoes reais do estado ∩ permissões do ator. */
function buildProposalReadiness(
  status: string,
  permissions: ProposalMockPermissions,
): ProposalDetail['readiness'] {
  const permitted: Record<string, boolean> = {
    issue: permissions.issue,
    accept: permissions.accept,
    reject: permissions.reject,
    expire: permissions.expire,
    cancel: permissions.cancel,
    revise: permissions.revise,
  };
  const availableTransitions = (PROPOSAL_TRANSITIONS[status] ?? []).filter(
    (transition) => permitted[transition] ?? false,
  );
  const next = PROPOSAL_NEXT_STEP[status] ?? { step: 'CLOSED' as const, transition: null };
  return {
    nextStep: next.step,
    nextStepTransition:
      next.transition && availableTransitions.includes(next.transition) ? next.transition : null,
    availableTransitions,
    blockers: [],
  };
}

/**
 * Detalhe do dublê com a MESMA composição do backend: cliente autorizado, revisões, comparação,
 * cadeia e prontidão derivada dos estados reais da máquina de estados.
 */
function toProposalDetail(
  proposal: Proposal,
  version: ProposalVersion,
  permissions: ProposalMockPermissions,
  linkedChain: ProposalDetail['linkedChain'] = [],
): ProposalDetail {
  return {
    proposal,
    currentVersion: version,
    related: { client: { id: proposal.clientId, name: 'Cliente Demo' } },
    revisions: [
      {
        versionNumber: version.versionNumber,
        status: version.status,
        saleTotal: version.globalSalePrice,
        currencyCode: version.currencyCode,
        validUntil: version.validUntil,
        createdAt: '2026-01-01T12:00:00.000Z',
        issuedAt: version.issuedAt,
        acceptedAt: version.acceptedAt,
        rejectedAt: version.rejectedAt,
        expiredAt: version.expiredAt,
        cancelledAt: version.cancelledAt,
        supersededAt: version.supersededAt,
        isCurrent: true,
        supersedesVersionNumber: version.versionNumber > 1 ? version.versionNumber - 1 : null,
        itemCount: version.items.length,
      },
    ],
    revisionComparison: null,
    linkedChain,
    readiness: buildProposalReadiness(version.status, permissions),
  };
}

export function createCommercialFetchMock(options: CommercialFetchMockOptions = {}) {
  const clientsMock = createClientsFetchMock({
    clientListAllowed: options.clientListAllowed ?? true,
    probeAllowed: true,
  });

  const proposalListAllowed = options.proposalListAllowed ?? true;
  const proposalCreateAllowed = options.proposalCreateAllowed ?? true;
  const proposalUpdateAllowed = options.proposalUpdateAllowed ?? true;
  const proposalIssueAllowed = options.proposalIssueAllowed ?? true;
  const proposalAcceptAllowed = options.proposalAcceptAllowed ?? true;
  const proposalRejectAllowed = options.proposalRejectAllowed ?? true;
  const proposalExpireAllowed = options.proposalExpireAllowed ?? true;
  const proposalCancelAllowed = options.proposalCancelAllowed ?? true;
  const proposalPermissions: ProposalMockPermissions = {
    issue: proposalIssueAllowed,
    accept: proposalAcceptAllowed,
    reject: proposalRejectAllowed,
    expire: proposalExpireAllowed,
    cancel: proposalCancelAllowed,
    revise: proposalUpdateAllowed,
  };
  const detail = (proposal: Proposal, version: ProposalVersion) =>
    toProposalDetail(proposal, version, proposalPermissions, options.proposalLinkedChain ?? []);

  const poListAllowed = options.purchaseOrderListAllowed ?? true;
  const poCreateAllowed = options.purchaseOrderCreateAllowed ?? true;
  const poUpdateAllowed = options.purchaseOrderUpdateAllowed ?? true;
  const poRegisterAllowed = options.purchaseOrderRegisterAllowed ?? true;
  const poCancelAllowed = options.purchaseOrderCancelAllowed ?? true;

  const proposals: Proposal[] = [
    {
      id: DEMO_PROPOSAL_ID,
      proposalCode: 'PROP-2026-DEMO01',
      clientId: DEMO_CLIENT_ID,
      unitId: 'unit-demo',
      title: 'Proposta de serviços',
      currentVersionNumber: 1,
      rowVersion: 1,
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
      currentVersionStatus: PROPOSAL_VERSION_STATUSES.Draft,
      currencyCode: 'BRL',
      saleTotal: '96000',
      validUntil: '2026-12-31T00:00:00.000Z',
    },
  ];

  const proposalVersions = new Map<string, ProposalVersion[]>([
    [
      DEMO_PROPOSAL_ID,
      [buildProposalVersion(DEMO_PROPOSAL_ID, 1, PROPOSAL_VERSION_STATUSES.Draft, 1)],
    ],
  ]);

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: DEMO_PO_ID,
      internalCode: 'PO-2026-DEMO01',
      clientId: DEMO_CLIENT_ID,
      unitId: 'unit-demo',
      poNumber: 'PO-CLIENTE-001',
      rcNumber: 'RC-001',
      issueDate: '2026-01-05',
      buyerContact: { name: 'Comprador Demo' },
      serviceManager: 'Gestor Demo',
      deliveryLocation: {},
      billingLocation: {},
      currencyCode: 'BRL',
      pricingStructure: PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
      totalAmount: '15000.0000',
      itemsLineTotal: null,
      paymentTerms: '30 dias',
      paymentMethod: 'Boleto',
      clientSnapshot: { tradeName: 'Cliente Demo' },
      commercialSnapshot: null,
      originalDocumentId: null,
      status: PURCHASE_ORDER_STATUSES.Draft,
      registeredAt: null,
      cancelledAt: null,
      cancellationReason: null,
      rowVersion: 1,
      createdAt: '2026-01-05T12:00:00.000Z',
      updatedAt: '2026-01-05T12:00:00.000Z',
      consumedAmount: '2500',
      authorizedOverrunAmount: '0',
      balance: {
        authorizedAmount: '15000',
        consumedAmount: '2500',
        authorizedOverrunAmount: '0',
        availableBalance: '12500',
      },
    },
  ];

  function currentVersion(proposalId: string): ProposalVersion | undefined {
    const versions = proposalVersions.get(proposalId) ?? [];
    const proposal = proposals.find((p) => p.id === proposalId);
    if (!proposal?.currentVersionNumber) {
      return versions[versions.length - 1];
    }
    return versions.find((v) => v.versionNumber === proposal.currentVersionNumber);
  }

  function toPoDetail(po: PurchaseOrder): PurchaseOrderDetail {
    return {
      purchaseOrder: po,
      items:
        po.pricingStructure === PURCHASE_ORDER_PRICING_STRUCTURES.LineItems
          ? [
              {
                id: 'po-item-1',
                lineNumber: 1,
                description: 'Serviço demo',
                serviceDefinitionId: null,
                serviceDefinitionVersionId: null,
                serviceSnapshot: null,
                commercialSnapshot: null,
                quantity: '1.0000',
                unitCode: 'UN',
                unitPrice: '15000.0000',
                lineTotal: '15000.0000',
                rcLineReference: null,
              },
            ]
          : [],
      billingRules: [],
      documentLinks: [],
    };
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname.startsWith('/api/v1/commercial/proposals')) {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return requestError('COMMERCIAL_DENIED', 401);
      }

      if (pathname === '/api/v1/commercial/proposals' && method === 'GET') {
        if (!proposalListAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        return jsonResponse({ items: proposals, limit: 20, offset: 0 });
      }

      if (pathname === '/api/v1/commercial/proposals' && method === 'POST') {
        if (!proposalCreateAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        const body = parseBody(init);
        const id = crypto.randomUUID();
        const proposal: Proposal = {
          id,
          proposalCode: `PROP-2026-${id.slice(0, 8).toUpperCase()}`,
          clientId: readString(body, 'clientId', DEMO_CLIENT_ID),
          unitId: readString(body, 'unitId', 'unit-demo'),
          title: readString(body, 'title', 'Nova proposta'),
          currentVersionNumber: 1,
          rowVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          currentVersionStatus: PROPOSAL_VERSION_STATUSES.Draft,
          currencyCode: 'BRL',
          saleTotal: null,
          validUntil: null,
        };
        const version = buildProposalVersion(
          id,
          1,
          PROPOSAL_VERSION_STATUSES.Draft,
          1,
        );
        if (body.pricingStructure === PROPOSAL_PRICING_STRUCTURES.GlobalPrice) {
          version.globalSalePrice = readString(body, 'globalSalePrice', '0');
        }
        proposals.unshift(proposal);
        proposalVersions.set(id, [version]);
        return jsonResponse(detail(proposal, version), 201);
      }

      const proposalMatch = pathname.match(/^\/api\/v1\/commercial\/proposals\/([^/]+)$/);
      if (proposalMatch && method === 'GET') {
        const proposal = proposals.find((p) => p.id === proposalMatch[1]);
        if (!proposal) {
          return requestError('COMMERCIAL_PROPOSAL_NOT_FOUND', 404);
        }
        const version = currentVersion(proposal.id);
        return jsonResponse(detail(proposal, version!));
      }

      const versionsMatch = pathname.match(
        /^\/api\/v1\/commercial\/proposals\/([^/]+)\/versions$/,
      );
      if (versionsMatch && method === 'GET') {
        return jsonResponse(proposalVersions.get(versionsMatch[1]!) ?? []);
      }

      const issueMatch = pathname.match(
        /^\/api\/v1\/commercial\/proposals\/([^/]+)\/versions\/(\d+)\/issue$/,
      );
      if (issueMatch && method === 'POST') {
        if (!proposalIssueAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        const version = currentVersion(issueMatch[1]!);
        if (!version) {
          return requestError('COMMERCIAL_PROPOSAL_VERSION_NOT_FOUND', 404);
        }
        version.status = PROPOSAL_VERSION_STATUSES.Issued;
        version.issuedAt = new Date().toISOString();
        version.rowVersion += 1;
        return jsonResponse(version);
      }

      const acceptMatch = pathname.match(
        /^\/api\/v1\/commercial\/proposals\/([^/]+)\/versions\/(\d+)\/accept$/,
      );
      if (acceptMatch && method === 'POST') {
        if (!proposalAcceptAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        const version = currentVersion(acceptMatch[1]!);
        if (!version) {
          return requestError('COMMERCIAL_PROPOSAL_VERSION_NOT_FOUND', 404);
        }
        version.status = PROPOSAL_VERSION_STATUSES.Accepted;
        version.acceptedAt = new Date().toISOString();
        version.rowVersion += 1;
        return jsonResponse(version);
      }

      const patchMatch = pathname.match(
        /^\/api\/v1\/commercial\/proposals\/([^/]+)\/versions\/(\d+)$/,
      );
      if (patchMatch && method === 'PATCH') {
        if (!proposalUpdateAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        if (options.proposalVersionConflict) {
          return requestError('COMMERCIAL_PROPOSAL_VERSION_CONFLICT', 409);
        }
        const proposal = proposals.find((p) => p.id === patchMatch[1]);
        const version = currentVersion(patchMatch[1]!);
        if (!proposal || !version) {
          return requestError('COMMERCIAL_PROPOSAL_NOT_FOUND', 404);
        }
        version.rowVersion += 1;
        proposal.updatedAt = new Date().toISOString();
        return jsonResponse(detail(proposal, version));
      }

      if (!proposalListAllowed && method !== 'GET') {
        return requestError('COMMERCIAL_DENIED', 403);
      }

      if (pathname.includes('/reject') && method === 'POST' && !proposalRejectAllowed) {
        return requestError('COMMERCIAL_DENIED', 403);
      }
      if (pathname.includes('/expire') && method === 'POST' && !proposalExpireAllowed) {
        return requestError('COMMERCIAL_DENIED', 403);
      }
      if (pathname.includes('/cancel') && method === 'POST' && !proposalCancelAllowed) {
        return requestError('COMMERCIAL_DENIED', 403);
      }

      return requestError('COMMERCIAL_PROPOSAL_NOT_FOUND', 404);
    }

    if (pathname.startsWith('/api/v1/commercial/purchase-orders')) {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return requestError('COMMERCIAL_DENIED', 401);
      }

      if (pathname === '/api/v1/commercial/purchase-orders' && method === 'GET') {
        if (!poListAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        return jsonResponse({ items: purchaseOrders, limit: 20, offset: 0 });
      }

      if (pathname === '/api/v1/commercial/purchase-orders' && method === 'POST') {
        if (!poCreateAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        const body = parseBody(init);
        const id = crypto.randomUUID();
        const po: PurchaseOrder = {
          id,
          internalCode: `PO-2026-${id.slice(0, 8).toUpperCase()}`,
          clientId: readString(body, 'clientId', DEMO_CLIENT_ID),
          unitId: readString(body, 'unitId', 'unit-demo'),
          poNumber: readString(body, 'poNumber', 'PO-NEW'),
          rcNumber: null,
          issueDate: null,
          buyerContact: {},
          serviceManager: null,
          deliveryLocation: {},
          billingLocation: {},
          currencyCode: 'BRL',
          pricingStructure: (body.pricingStructure as PurchaseOrder['pricingStructure']) ??
            PURCHASE_ORDER_PRICING_STRUCTURES.HeaderTotal,
          totalAmount: readString(body, 'totalAmount', '0'),
          itemsLineTotal: null,
          paymentTerms: null,
          paymentMethod: null,
          clientSnapshot: { tradeName: 'Cliente Demo' },
          commercialSnapshot: null,
          originalDocumentId: null,
          status: PURCHASE_ORDER_STATUSES.Draft,
          registeredAt: null,
          cancelledAt: null,
          cancellationReason: null,
          rowVersion: 1,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          consumedAmount: '0',
          authorizedOverrunAmount: '0',
          balance: {
            authorizedAmount: readString(body, 'totalAmount', '0'),
            consumedAmount: '0',
            authorizedOverrunAmount: '0',
            availableBalance: readString(body, 'totalAmount', '0'),
          },
        };
        purchaseOrders.unshift(po);
        return jsonResponse(toPoDetail(po), 201);
      }

      const poMatch = pathname.match(/^\/api\/v1\/commercial\/purchase-orders\/([^/]+)$/);
      if (poMatch && method === 'GET') {
        const po = purchaseOrders.find((p) => p.id === poMatch[1]);
        if (!po) {
          return requestError('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', 404);
        }
        return jsonResponse(toPoDetail(po));
      }

      const registerMatch = pathname.match(
        /^\/api\/v1\/commercial\/purchase-orders\/([^/]+)\/register$/,
      );
      if (registerMatch && method === 'POST') {
        if (!poRegisterAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        const po = purchaseOrders.find((p) => p.id === registerMatch[1]);
        if (!po) {
          return requestError('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', 404);
        }
        po.status = PURCHASE_ORDER_STATUSES.Registered;
        po.registeredAt = new Date().toISOString();
        po.rowVersion += 1;
        return jsonResponse(toPoDetail(po));
      }

      if (poMatch && method === 'PATCH') {
        if (!poUpdateAllowed) {
          return requestError('COMMERCIAL_DENIED', 403);
        }
        if (options.purchaseOrderVersionConflict) {
          return requestError('COMMERCIAL_PURCHASE_ORDER_VERSION_CONFLICT', 409);
        }
        const po = purchaseOrders.find((p) => p.id === poMatch[1]);
        if (!po) {
          return requestError('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', 404);
        }
        po.rowVersion += 1;
        po.updatedAt = new Date().toISOString();
        return jsonResponse(toPoDetail(po));
      }

      if (pathname.includes('/cancel') && method === 'POST' && !poCancelAllowed) {
        return requestError('COMMERCIAL_DENIED', 403);
      }

      return requestError('COMMERCIAL_PURCHASE_ORDER_NOT_FOUND', 404);
    }

    return clientsMock(input, init);
  });
}

export const COMMERCIAL_DEMO_IDS = {
  DEMO_CLIENT_ID,
  DEMO_PROPOSAL_ID,
  DEMO_PO_ID,
  DEMO_REQUEST_ID,
};
