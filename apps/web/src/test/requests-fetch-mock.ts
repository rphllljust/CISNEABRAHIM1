import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createDocumentsFetchHandler, type DocumentsFetchMockOptions } from './documents-fetch-mock';
import { createClientsFetchMock } from './clients-fetch-mock';
import { MOCK_IDENTITY_ID } from './shell-fetch-mock';
import {
  SERVICE_REQUEST_ORIGINS,
  SERVICE_REQUEST_STATUSES,
  type ServiceRequest,
  type ServiceRequestDetail,
  type ServiceRequestLinked,
  type ServiceRequestNextStepCode,
  type ServiceRequestReadiness,
  type ServiceRequestStatus,
  type ServiceRequestTransition,
} from '../requests/types/service-request.types';

export type RequestsFetchMockOptions = {
  requestListAllowed?: boolean;
  requestCreateAllowed?: boolean;
  requestUpdateAllowed?: boolean;
  requestSubmitAllowed?: boolean;
  requestReviewAllowed?: boolean;
  requestApproveAllowed?: boolean;
  requestRejectAllowed?: boolean;
  requestCancelAllowed?: boolean;
  requestStatus?: ServiceRequest['status'];
  versionConflictOnUpdate?: boolean;
  clientListAllowed?: boolean;
  documents?: DocumentsFetchMockOptions;
  linkedChain?: ServiceRequestLinked[];
};

function requestError(code: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ code, message: 'error' }),
  } as Response;
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/**
 * Espelho da leitura do backend para o dublê de teste: transições permitidas pelo estado
 * (mesma tabela da máquina de estados) e o próximo passo derivado do estado.
 */
const STATUS_TRANSITIONS: Record<ServiceRequestStatus, ServiceRequestTransition[]> = {
  DRAFT: ['submit', 'cancel'],
  SUBMITTED: ['startReview', 'cancel'],
  UNDER_REVIEW: ['approve', 'reject', 'cancel'],
  APPROVED: ['convert', 'cancel'],
  CONVERTED: [],
  REJECTED: [],
  CANCELLED: [],
};

const NEXT_STEP: Record<ServiceRequestStatus, { step: ServiceRequestNextStepCode; transition: ServiceRequestTransition | null }> = {
  DRAFT: { step: 'SUBMIT_REQUEST', transition: 'submit' },
  SUBMITTED: { step: 'START_REVIEW', transition: 'startReview' },
  UNDER_REVIEW: { step: 'DECIDE', transition: 'approve' },
  APPROVED: { step: 'CONVERT_TO_SERVICE_ORDER', transition: 'convert' },
  CONVERTED: { step: 'OPEN_SERVICE_ORDER', transition: null },
  REJECTED: { step: 'CLOSED', transition: null },
  CANCELLED: { step: 'CLOSED', transition: null },
};

export type RequestsFetchMockOptionsResolved = {
  submitAllowed: boolean;
  reviewAllowed: boolean;
  approveAllowed: boolean;
  rejectAllowed: boolean;
  cancelAllowed: boolean;
};

function buildReadiness(
  request: ServiceRequest,
  allowed: RequestsFetchMockOptionsResolved,
): ServiceRequestReadiness {
  const permitted: Record<ServiceRequestTransition, boolean> = {
    submit: allowed.submitAllowed,
    startReview: allowed.reviewAllowed,
    approve: allowed.approveAllowed,
    reject: allowed.rejectAllowed,
    cancel: allowed.cancelAllowed,
    convert: true,
  };
  const availableTransitions = STATUS_TRANSITIONS[request.status].filter(
    (transition) => permitted[transition],
  );
  const nextStep = NEXT_STEP[request.status];
  return {
    nextStep: nextStep.step,
    nextStepTransition:
      nextStep.transition && availableTransitions.includes(nextStep.transition)
        ? nextStep.transition
        : null,
    availableTransitions,
    blockers:
      request.status === SERVICE_REQUEST_STATUSES.Draft &&
      !request.description?.trim() &&
      !request.serviceDefinitionId
        ? ['DESCRIPTION_OR_SERVICE_REQUIRED']
        : [],
  };
}

function toDetail(
  request: ServiceRequest,
  allowed: RequestsFetchMockOptionsResolved,
  documentLinks: Array<{
    id: string;
    documentId: string;
    linkPurpose: string;
    createdAt: string;
  }> = [],
  linkedChain: ServiceRequestLinked[] = [],
  historyEvents: ServiceRequestDetail['historyEvents'] = [],
): ServiceRequestDetail {
  return {
    serviceRequest: request,
    documentLinks,
    historyEvents,
    related: {
      client: request.clientId ? { id: request.clientId, name: 'Cliente Demo Ltda' } : null,
      service: null,
    },
    linkedChain,
    readiness: buildReadiness(request, allowed),
  };
}

export function createRequestsFetchMock(options: RequestsFetchMockOptions = {}) {
  const clientsMock = createClientsFetchMock({
    clientListAllowed: options.clientListAllowed,
    probeAllowed: true,
  });
  const listAllowed = options.requestListAllowed ?? true;
  const createAllowed = options.requestCreateAllowed ?? true;
  const updateAllowed = options.requestUpdateAllowed ?? true;
  const submitAllowed = options.requestSubmitAllowed ?? true;
  const reviewAllowed = options.requestReviewAllowed ?? true;
  const approveAllowed = options.requestApproveAllowed ?? true;
  const rejectAllowed = options.requestRejectAllowed ?? true;
  const cancelAllowed = options.requestCancelAllowed ?? true;

  const store: ServiceRequest[] = [
    {
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      requestCode: 'SR-2026-DEMO01',
      unitId: 'unit-demo',
      status: SERVICE_REQUEST_STATUSES.Draft,
      originSource: SERVICE_REQUEST_ORIGINS.Email,
      externalContact: { name: 'Contato Demo', email: 'demo@invalid' },
      externalOriginReference: null,
      clientId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      serviceDefinitionId: null,
      serviceDefinitionVersionId: null,
      description: 'Solicitação de demonstração',
      location: { city: 'Porto Velho' },
      desiredStartAt: null,
      desiredEndAt: null,
      priority: null,
      operationalNotes: null,
      proposalId: null,
      purchaseOrderId: null,
      submittedAt: null,
      reviewStartedAt: null,
      approvedAt: null,
      rejectedAt: null,
      rejectionReason: null,
      cancelledAt: null,
      cancellationReason: null,
      convertedAt: null,
      convertedServiceOrderId: null,
      rowVersion: 1,
      createdByIdentityId: MOCK_IDENTITY_ID,
      createdAt: '2026-01-01T12:00:00.000Z',
      updatedAt: '2026-01-01T12:00:00.000Z',
    },
  ];

  const seededRequest = store[0]!;
  if (options.requestStatus && options.requestStatus !== seededRequest.status) {
    seededRequest.status = options.requestStatus;
    if (options.requestStatus === SERVICE_REQUEST_STATUSES.Approved) {
      seededRequest.approvedAt = '2026-01-01T12:30:00.000Z';
    }
  }

  function findRequest(id: string): ServiceRequest | undefined {
    return store.find((item) => item.id === id);
  }

  function bump(request: ServiceRequest, patch: Partial<ServiceRequest>): ServiceRequest {
    const next = {
      ...request,
      ...patch,
      rowVersion: request.rowVersion + 1,
      updatedAt: new Date().toISOString(),
    };
    const index = store.findIndex((item) => item.id === request.id);
    store[index] = next;
    return next;
  }

  const documentLinksByRequest = new Map<
    string,
    Array<{ id: string; documentId: string; linkPurpose: string; createdAt: string }>
  >();
  const documentsMock = createDocumentsFetchHandler(options.documents);

  function linksFor(requestId: string) {
    return documentLinksByRequest.get(requestId) ?? [];
  }

  const allowed: RequestsFetchMockOptionsResolved = {
    submitAllowed,
    reviewAllowed,
    approveAllowed,
    rejectAllowed,
    cancelAllowed,
  };

  const linkedChain = options.linkedChain ?? [];

  /** Historico coerente com o estado atual — o dublê registra os mesmos eventos do domínio. */
  function historyFor(request: ServiceRequest): ServiceRequestDetail['historyEvents'] {
    const events: ServiceRequestDetail['historyEvents'] = [
      {
        id: `${request.id}-created`,
        eventType: 'CREATED',
        payload: { status: SERVICE_REQUEST_STATUSES.Draft },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.createdAt,
      },
    ];
    if (request.submittedAt) {
      events.push({
        id: `${request.id}-submitted`,
        eventType: 'SUBMITTED',
        payload: {
          fromStatus: SERVICE_REQUEST_STATUSES.Draft,
          toStatus: SERVICE_REQUEST_STATUSES.Submitted,
        },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.submittedAt,
      });
    }
    if (request.reviewStartedAt) {
      events.push({
        id: `${request.id}-review`,
        eventType: 'REVIEW_STARTED',
        payload: {
          fromStatus: SERVICE_REQUEST_STATUSES.Submitted,
          toStatus: SERVICE_REQUEST_STATUSES.UnderReview,
        },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.reviewStartedAt,
      });
    }
    if (request.rejectedAt) {
      events.push({
        id: `${request.id}-rejected`,
        eventType: 'REJECTED',
        payload: { rejectionReason: request.rejectionReason },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.rejectedAt,
      });
    }
    if (request.approvedAt) {
      events.push({
        id: `${request.id}-approved`,
        eventType: 'APPROVED',
        payload: {
          fromStatus: SERVICE_REQUEST_STATUSES.UnderReview,
          toStatus: SERVICE_REQUEST_STATUSES.Approved,
          priority: request.priority,
        },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.approvedAt,
      });
    }
    if (request.cancelledAt) {
      events.push({
        id: `${request.id}-cancelled`,
        eventType: 'CANCELLED',
        payload: { cancellationReason: request.cancellationReason },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.cancelledAt,
      });
    }
    if (request.convertedAt) {
      events.push({
        id: `${request.id}-converted`,
        eventType: 'CONVERTED',
        payload: { serviceOrderId: request.convertedServiceOrderId },
        actorIdentityId: MOCK_IDENTITY_ID,
        occurredAt: request.convertedAt,
      });
    }
    return events;
  }

  function detail(
    request: ServiceRequest,
    links: Array<{ id: string; documentId: string; linkPurpose: string; createdAt: string }> = [],
  ): ServiceRequestDetail {
    return toDetail(request, allowed, links, linkedChain, historyFor(request));
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    const documentsResponse = documentsMock.handle(pathname, method, init, searchParams);
    if (documentsResponse) {
      return documentsResponse;
    }

    if (!pathname.startsWith('/api/v1/requests/service-requests')) {
      return clientsMock(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return requestError('REQUESTS_DENIED', 401);
    }

    if (pathname === '/api/v1/requests/service-requests/summary' && method === 'GET') {
      if (!listAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      const unitId = searchParams.get('unitId');
      let items = [...store];
      if (unitId) {
        items = items.filter((item) => item.unitId === unitId);
      }
      return jsonResponse({
        total: items.length,
        pending: items.filter((item) => item.status === SERVICE_REQUEST_STATUSES.Submitted).length,
        underReview: items.filter((item) => item.status === SERVICE_REQUEST_STATUSES.UnderReview).length,
        converted: items.filter((item) => item.status === SERVICE_REQUEST_STATUSES.Converted).length,
        cancelled: items.filter((item) => item.status === SERVICE_REQUEST_STATUSES.Cancelled).length,
      });
    }

    if (pathname === '/api/v1/requests/service-requests' && method === 'GET') {
      if (!listAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const unitId = searchParams.get('unitId');
      let items = [...store];
      if (status) {
        items = items.filter((item) => item.status === status);
      }
      if (unitId) {
        items = items.filter((item) => item.unitId === unitId);
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit).map((item) => ({
          ...item,
          // O nome do cliente só vem quando o módulo CLIENTES autoriza — igual ao backend.
          clientName:
            item.clientId && options.clientListAllowed !== false ? 'Cliente Demo Ltda' : null,
          serviceLabel: null,
        })),
        limit,
        offset,
      });
    }

    if (pathname === '/api/v1/requests/service-requests' && method === 'POST') {
      if (!createAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        unitId?: string;
        originSource?: string;
        description?: string;
        clientId?: string;
        externalContact?: { name?: string; email?: string; phone?: string };
      };
      if (!body.unitId || !body.originSource) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      if (!body.clientId && !body.externalContact?.name && !body.externalContact?.email && !body.externalContact?.phone) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      if (!body.description) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      const created: ServiceRequest = {
        id: crypto.randomUUID(),
        requestCode: `SR-2026-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
        unitId: body.unitId,
        status: SERVICE_REQUEST_STATUSES.Draft,
        originSource: body.originSource as ServiceRequest['originSource'],
        externalContact: body.externalContact ?? {},
        externalOriginReference: null,
        clientId: body.clientId ?? null,
        serviceDefinitionId: null,
        serviceDefinitionVersionId: null,
        description: body.description,
        location: {},
        desiredStartAt: null,
        desiredEndAt: null,
        priority: null,
        operationalNotes: null,
        proposalId: null,
        purchaseOrderId: null,
        submittedAt: null,
        reviewStartedAt: null,
        approvedAt: null,
        rejectedAt: null,
        rejectionReason: null,
        cancelledAt: null,
        cancellationReason: null,
        convertedAt: null,
        convertedServiceOrderId: null,
        rowVersion: 1,
        createdByIdentityId: MOCK_IDENTITY_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      store.push(created);
      return jsonResponse(detail(created), 201);
    }

    const match = pathname.match(/^\/api\/v1\/requests\/service-requests\/([^/]+)(?:\/(.+))?$/);
    if (!match) {
      return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
    }

    const requestId = match[1]!;
    const action = match[2];
    const current = findRequest(requestId);

    if (!action && method === 'GET') {
      if (!current) {
        return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
      }
      return jsonResponse(detail(current, linksFor(requestId)));
    }

    if (action === 'documents' && method === 'POST') {
      if (!current) {
        return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        documentId?: string;
        linkPurpose?: string;
      };
      if (!body.documentId || !body.linkPurpose) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      const links = linksFor(requestId);
      links.push({
        id: crypto.randomUUID(),
        documentId: body.documentId,
        linkPurpose: body.linkPurpose,
        createdAt: new Date().toISOString(),
      });
      documentLinksByRequest.set(requestId, links);
      return jsonResponse(detail(current, links), 201);
    }

    if (action === undefined && method === 'PATCH') {
      if (!updateAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (!current) {
        return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        rowVersion?: number;
        description?: string | null;
      };
      if (body.rowVersion !== current.rowVersion) {
        return requestError('REQUESTS_SERVICE_REQUEST_VERSION_CONFLICT', 409);
      }
      if (options.versionConflictOnUpdate) {
        return requestError('REQUESTS_SERVICE_REQUEST_VERSION_CONFLICT', 409);
      }
      if (current.status !== SERVICE_REQUEST_STATUSES.Draft) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      const updated = bump(current, {
        description: body.description ?? current.description,
      });
      return jsonResponse(detail(updated));
    }

    const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
      rowVersion?: number;
      rejectionReason?: string;
      cancellationReason?: string;
      priority?: string;
    };

    if (!current) {
      if (method === 'POST' && action) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
    }

    if (body.rowVersion !== undefined && body.rowVersion !== current.rowVersion) {
      return requestError('REQUESTS_SERVICE_REQUEST_VERSION_CONFLICT', 409);
    }

    if (action === 'submit' && method === 'POST') {
      if (!submitAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (current.status !== SERVICE_REQUEST_STATUSES.Draft) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.Submitted,
            submittedAt: new Date().toISOString(),
          }),
        ),
      );
    }

    if (action === 'review' && method === 'POST') {
      if (!reviewAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (current.status !== SERVICE_REQUEST_STATUSES.Submitted) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.UnderReview,
            reviewStartedAt: new Date().toISOString(),
          }),
        ),
      );
    }

    if (action === 'approve' && method === 'POST') {
      if (!approveAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (current.status !== SERVICE_REQUEST_STATUSES.UnderReview) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.Approved,
            approvedAt: new Date().toISOString(),
            priority: (body.priority as ServiceRequest['priority']) ?? 'NORMAL',
          }),
        ),
      );
    }

    if (action === 'reject' && method === 'POST') {
      if (!rejectAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (!body.rejectionReason) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      if (current.status !== SERVICE_REQUEST_STATUSES.UnderReview) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.Rejected,
            rejectedAt: new Date().toISOString(),
            rejectionReason: body.rejectionReason,
          }),
        ),
      );
    }

    if (action === 'cancel' && method === 'POST') {
      if (!cancelAllowed) {
        return requestError('REQUESTS_DENIED', 403);
      }
      if (!body.cancellationReason) {
        return requestError('REQUESTS_VALIDATION_FAILED', 400);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.Cancelled,
            cancelledAt: new Date().toISOString(),
            cancellationReason: body.cancellationReason,
          }),
        ),
      );
    }

    if (action === 'convert' && method === 'POST') {
      if (current.status !== SERVICE_REQUEST_STATUSES.Approved) {
        return requestError('REQUESTS_SERVICE_REQUEST_INVALID_STATE', 409);
      }
      return jsonResponse(
        detail(
          bump(current, {
            status: SERVICE_REQUEST_STATUSES.Converted,
            convertedAt: new Date().toISOString(),
            convertedServiceOrderId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          }),
        ),
      );
    }

    if (method === 'POST' || method === 'PATCH') {
      return requestError('REQUESTS_DENIED', 403);
    }

    return requestError('REQUESTS_SERVICE_REQUEST_NOT_FOUND', 404);
  });
}
