import { vi } from 'vitest';
import { parseRequestPath } from './request-url';
import { createAssetsFetchMock } from './assets-fetch-mock';
import {
  ASSET_ALLOCATION_STATUSES,
  ASSET_LIFECYCLE_STATUSES,
  VEHICLE_CLASSIFICATION,
  type PhysicalAsset,
} from '../assets/types/physical-asset.types';
import type { PlannedResource, ResourceAllocation } from '../service-orders/types/resource-planning.types';
import { SERVICE_ORDER_STATUSES } from '../service-orders/types/service-order.types';
import { PERSON_STATUSES, type Person } from '../people/types/person.types';

export const MOCK_SERVICE_ORDER_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
export const MOCK_PLANNED_RESOURCE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
export const MOCK_MEASUREMENT_ID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
export const MOCK_BILLING_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
export const MOCK_BILLING_DOCUMENT_ID = '11111111-1111-4111-8111-111111111112';
export const MOCK_ASSET_A_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
export const MOCK_ASSET_B_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
export const MOCK_WORKFORCE_MEMBER_ID = '99999999-9999-4999-8999-999999999999';
const PROBE_SERVICE_ORDER_ID = '00000000-0000-4000-8000-000000000010';
const PROBE_MEASUREMENT_ID = '00000000-0000-4000-8000-000000000020';
const TRUCK_TYPE_ID = '11111111-1111-4111-8111-111111111111';

export type MeasurementSeedKind =
  | 'draft-aligned'
  | 'draft-divergent'
  | 'submitted'
  | 'under_review'
  | 'approved'
  | 'rejected';

export type BillingSeedKind = 'none' | 'prepared' | 'voided';

export type ServiceOrdersFetchMockOptions = {
  serviceOrderListAllowed?: boolean;
  serviceOrderReadAllowed?: boolean;
  planAllowed?: boolean;
  allocateAllowed?: boolean;
  removeAllocationAllowed?: boolean;
  assetListAllowed?: boolean;
  executionAllowed?: boolean;
  executionNetworkFailure?: boolean;
  executionVersionConflict?: boolean;
  executionDelayedStartMs?: number;
  measurementAllowed?: boolean;
  measurementVersionConflict?: boolean;
  orderCompleted?: boolean;
  orderStatus?: string;
  statusBeforeCancel?: string;
  lifecycleVersionConflict?: boolean;
  seedMeasurement?: MeasurementSeedKind;
  billingAllowed?: boolean;
  billingReadAllowed?: boolean;
  billingTermsMismatch?: boolean;
  billingVersionConflict?: boolean;
  billingDocumentAllowed?: boolean;
  billingDocumentReadAllowed?: boolean;
  billingDocumentAlreadyExists?: boolean;
  billingDocumentDelayedIssueMs?: number;
  billingDocumentTermsMismatch?: boolean;
  seedBilling?: BillingSeedKind;
  purchaseOrderPaymentTerms?: string;
  preparedPaymentTerms?: string;
  /** Eventos de historico devolvidos pelo detalhe da OS (linha do tempo). */
  orderHistoryEvents?: Array<Record<string, unknown>>;
  /** Operations Control Center devolvido pelo detalhe da OS (projecao do backend). */
  controlCenter?: import('../service-orders/types/service-order.types').ServiceOrderControlCenter;
  /** Comparacao planejado x realizado devolvida pelo bundle de execucao. */
  executionComparison?: Record<string, unknown>;
};

function orderError(code: string, status: number): Response {
  return {
    ok: false,
    status,
    json: async () => ({ code, message: 'error' }),
  } as Response;
}

/**
 * Catálogo de comandos servido pelo mock (B5).
 *
 * Espelha o `/command-catalog` real: são os 7 comandos da state machine, com rótulos PT-BR.
 * O front testado NÃO mantém esta lista — ele a recebe.
 */
type CatalogFixtureEntry = {
  nome: string;
  label: string;
  status_origem: string[];
  status_destino: string;
  requer_justificativa: boolean;
};

const COMMAND_CATALOG_FIXTURE: CatalogFixtureEntry[] = [
  { nome: 'prepare', label: 'Preparar', status_origem: ['DRAFT'], status_destino: 'PREPARED', requer_justificativa: false },
  { nome: 'release', label: 'Liberar', status_origem: ['PREPARED'], status_destino: 'RELEASED', requer_justificativa: false },
  { nome: 'cancel', label: 'Cancelar', status_origem: ['DRAFT', 'PREPARED', 'RELEASED'], status_destino: 'CANCELLED', requer_justificativa: false },
  { nome: 'start', label: 'Iniciar execução', status_origem: ['RELEASED'], status_destino: 'IN_EXECUTION', requer_justificativa: false },
  { nome: 'pause', label: 'Pausar', status_origem: ['IN_EXECUTION'], status_destino: 'PAUSED', requer_justificativa: false },
  { nome: 'resume', label: 'Retomar', status_origem: ['PAUSED'], status_destino: 'IN_EXECUTION', requer_justificativa: false },
  { nome: 'complete', label: 'Concluir', status_origem: ['IN_EXECUTION'], status_destino: 'COMPLETED', requer_justificativa: false },
];

/** Trilha de auditoria servida pelo mock (B5), em ordem cronológica. */
const AUDIT_TIMELINE_FIXTURE = [
  {
    id: '11111111-1111-4111-8111-111111111101',
    data: '2026-01-01T08:00:00.000Z',
    usuario_id: 'actor-demo',
    usuario_nome: null,
    acao: 'CREATE',
    status_anterior: null,
    status_novo: 'DRAFT',
    comando: null,
    correlation_id: '11111111-1111-4111-8111-111111111102',
  },
  {
    id: '11111111-1111-4111-8111-111111111103',
    data: '2026-01-01T09:00:00.000Z',
    usuario_id: 'actor-demo',
    usuario_nome: null,
    acao: 'TRANSITION',
    status_anterior: 'DRAFT',
    status_novo: 'PREPARED',
    comando: 'prepare',
    correlation_id: '11111111-1111-4111-8111-111111111104',
  },
];

/**
 * Deriva `available-actions` do status, reproduzindo a state machine do BACKEND.
 *
 * Existe apenas no dublê de teste. O código de produção consumido por estes testes não
 * contém nenhuma regra de transição — é justamente o que B5 removeu.
 */
function buildAvailableActionsResponse(serviceOrderId: string, status: string) {
  const permissionByCommand: Record<string, string> = {
    prepare: 'service-orders:service-order:prepare',
    release: 'service-orders:service-order:release',
    cancel: 'service-orders:service-order:cancel',
    start: 'service-orders:execution:start',
    pause: 'service-orders:execution:pause',
    resume: 'service-orders:execution:resume',
    complete: 'service-orders:execution:complete',
  };
  const entryByCommand = new Map(COMMAND_CATALOG_FIXTURE.map((entry) => [entry.nome, entry]));

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const entry of COMMAND_CATALOG_FIXTURE) {
    // `reopen` não está no catálogo de transições: é fluxo próprio (COMPLETED/CANCELLED).
    if ((entry.status_origem as readonly string[]).includes(status)) {
      valid.push(entry.nome);
    } else {
      invalid.push(entry.nome);
    }
  }
  if (status === 'COMPLETED' || status === 'CANCELLED') {
    valid.push('reopen');
    const reopenIndex = invalid.indexOf('reopen');
    if (reopenIndex >= 0) {
      invalid.splice(reopenIndex, 1);
    }
    entryByCommand.set('reopen', {
      nome: 'reopen',
      label: 'Reabrir',
      status_origem: ['COMPLETED', 'CANCELLED'],
      status_destino: 'IN_EXECUTION',
      requer_justificativa: false,
    });
  }

  return {
    service_order_id: serviceOrderId,
    status_atual: status,
    comandos_validos: valid.map((comando) => ({
      comando,
      label: entryByCommand.get(comando)!.label,
      requer_permissao: permissionByCommand[comando] ?? 'service-orders:service-order:read',
      usuario_tem_permissao: true,
    })),
    comandos_invalidos_para_status: invalid,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** No da cadeia de negocio no formato REAL do read model (`BusinessChainNode`). */
function chainNode(
  kind: string,
  id: string,
  reference: string,
  isAnchor: boolean,
): Record<string, unknown> {
  return {
    id,
    kind,
    businessReference: reference,
    status: 'ACTIVE',
    occurredAt: '2026-02-02T12:00:00.000Z',
    route: `/app/chain/${kind.toLowerCase()}/${id}`,
    relation: isAnchor ? 'ROOT' : kind === 'CLIENT' ? 'ORIGIN' : 'RESULT',
    summary: reference,
    unitId: null,
    clientId: 'client-1',
  };
}

function parseInterval(start: string, end: string): { startMs: number; endMs: number } {
  return { startMs: Date.parse(start), endMs: Date.parse(end) };
}

function intervalsOverlap(
  a: { startMs: number; endMs: number },
  b: { startMs: number; endMs: number },
): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

export function createServiceOrdersFetchMock(options: ServiceOrdersFetchMockOptions = {}) {
  const upstream = createAssetsFetchMock({ assetListAllowed: options.assetListAllowed });
  const listAllowed = options.serviceOrderListAllowed ?? true;
  const readAllowed = options.serviceOrderReadAllowed ?? true;
  const planAllowed = options.planAllowed ?? true;
  const allocateAllowed = options.allocateAllowed ?? true;
  const removeAllocationAllowed = options.removeAllocationAllowed ?? true;
  const executionAllowed = options.executionAllowed ?? true;
  const measurementAllowed = options.measurementAllowed ?? true;
  const billingAllowed = options.billingAllowed ?? true;
  const billingReadAllowed = options.billingReadAllowed ?? true;
  const billingDocumentAllowed = options.billingDocumentAllowed ?? true;
  const billingDocumentReadAllowed = options.billingDocumentReadAllowed ?? true;
  const people: Person[] = [
    {
      id: MOCK_WORKFORCE_MEMBER_ID,
      memberCode: 'EMP-DEV-001',
      legalName: 'Empregado Dev Um',
      preferredName: 'Dev Um',
      defaultLaborTypeCode: 'OPERATOR',
      defaultLaborTypeName: 'Operador',
      externalErpId: null,
      status: PERSON_STATUSES.Active,
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deactivatedAt: null,
      deactivationReason: null,
      serviceOrderAllocationSupported: true,
    },
  ];

  type MockMeasurementItem = {
    id: string;
    lineNumber: number;
    sourceExecutionEntryId: string;
    unitCode: string;
    actualQuantity: string;
    measuredQuantity: string;
    unitPrice: string | null;
    lineAmount: string | null;
    pricingLineSnapshot: Record<string, unknown>;
    notes: string | null;
  };

  type MockMeasurement = {
    id: string;
    serviceOrderId: string;
    unitId: string;
    status: string;
    commercialReferenceSnapshot: Record<string, unknown>;
    submittedAt: string | null;
    submittedByIdentityId: string | null;
    reviewStartedAt: string | null;
    reviewStartedByIdentityId: string | null;
    decidedAt: string | null;
    decidedByIdentityId: string | null;
    rejectionReason: string | null;
    rowVersion: number;
    createdAt: string;
    updatedAt: string;
    items: MockMeasurementItem[];
    adjustments: unknown[];
    historyEvents: unknown[];
  };

  type MockOrder = {
    id: string;
    internalCode: string;
    orderNumber: string;
    unitId: string;
    status: string;
    origin: string;
    clientId: string | null;
    clientSnapshot: Record<string, unknown> | null;
    serviceDefinitionId: string | null;
    serviceDefinitionVersionId: string | null;
    serviceSnapshot: {
      serviceCode: string;
      serviceName: string;
      measurementModel?: {
        mode: string;
        basis: string;
        defaultUnitCode: string | null;
      };
      allowedUnits?: Array<{ unitCode: string; isDefault?: boolean; sortOrder?: number }>;
      requirements: {
        resources: Array<{
          physicalResourceTypeCode: string;
          requirementLevel: string;
          minQuantity: string | null;
          sortOrder: number;
        }>;
        labor: Array<{
          laborTypeCode: string;
          requirementLevel: string;
          minQuantity: string | null;
          sortOrder: number;
        }>;
        execution: Array<{
          evidenceKind: string;
          requirementLevel: string;
          config: Record<string, unknown> | null;
          sortOrder: number;
        }>;
      };
    };
    description: string | null;
    rowVersion: number;
    preparedAt: string | null;
    releasedAt: string | null;
    cancelledAt: string | null;
    updatedAt: string;
    /** Operations Control Center devolvido pelo detalhe da OS (projecao do backend). */
    controlCenter?: import('../service-orders/types/service-order.types').ServiceOrderControlCenter;
    purchaseOrderSnapshot?: Record<string, unknown> | null;
    proposalSnapshot?: Record<string, unknown> | null;
    contractSnapshot?: Record<string, unknown> | null;
    statusBeforeCancel: string | null;
    historyEvents: unknown[];
  };
  type MockEntry = {
    id: string;
    serviceOrderId: string;
    entryType: string;
    evidenceKind: string | null;
    quantityValue: string | null;
    quantityUnitCode: string | null;
    textValue: string | null;
    context: Record<string, unknown>;
    actorIdentityId: string;
    recordedAt: string;
    rowVersion: number;
  };
  type MockEvidence = {
    id: string;
    serviceOrderId: string;
    evidenceKind: string;
    payload: Record<string, unknown>;
    actorIdentityId: string;
    recordedAt: string;
  };
  type MockOccurrence = {
    id: string;
    serviceOrderId: string;
    occurrenceCode: string;
    description: string;
    payload: Record<string, unknown>;
    actorIdentityId: string;
    recordedAt: string;
  };

  const orders = new Map<string, MockOrder>();
  const entries = new Map<string, MockEntry[]>();
  const evidence = new Map<string, MockEvidence[]>();
  const occurrences = new Map<string, MockOccurrence[]>();
  const idempotency = new Map<string, unknown>();

  function buildOrderDetail(id: string): MockOrder {
    return {
      id,
      internalCode: 'OS-INT-001',
      orderNumber: 'OS-2026-DEMO01',
      unitId: 'unit-demo',
      status: SERVICE_ORDER_STATUSES.Released,
      origin: 'SERVICE_REQUEST',
      clientId: 'client-demo',
      clientSnapshot: {
        legalName: 'Cliente Demo LTDA',
        tradeName: 'Cliente Demo',
      },
      serviceDefinitionId: null,
      serviceDefinitionVersionId: null,
      serviceSnapshot: {
        serviceCode: 'SVC-DEMO',
        serviceName: 'Serviço Demo',
        measurementModel: {
          mode: 'UNIT',
          basis: 'SERVICE',
          defaultUnitCode: 'SERVICE',
        },
        allowedUnits: [{ unitCode: 'SERVICE', isDefault: true, sortOrder: 0 }],
        requirements: {
          resources: [
            {
              physicalResourceTypeCode: 'TRUCK',
              requirementLevel: 'REQUIRED',
              minQuantity: '2',
              sortOrder: 1,
            },
          ],
          labor: [
            {
              laborTypeCode: 'OPERATOR',
              requirementLevel: 'REQUIRED',
              minQuantity: '1',
              sortOrder: 1,
            },
          ],
          execution: [
            {
              evidenceKind: 'OBSERVATION',
              requirementLevel: 'REQUIRED',
              config: null,
              sortOrder: 1,
            },
            {
              evidenceKind: 'QUANTITY',
              requirementLevel: 'REQUIRED',
              config: null,
              sortOrder: 2,
            },
          ],
        },
      },
      description: 'Local: pátio central',
      rowVersion: 1,
      preparedAt: '2026-01-01T08:00:00.000Z',
      releasedAt: '2026-01-01T09:00:00.000Z',
      cancelledAt: null,
      statusBeforeCancel: null,
      updatedAt: '2026-01-01T10:00:00.000Z',
      historyEvents: options.orderHistoryEvents ?? [],
      controlCenter: options.controlCenter ?? {
        progression: [
          { code: 'DEMAND', state: 'DONE', at: '2026-01-01T07:00:00.000Z', detail: 'Ordem criada diretamente', ownerStatus: 'RELEASED' },
          { code: 'PLANNING', state: 'DONE', at: '2026-01-01T08:00:00.000Z', detail: '1 recurso(s) planejado(s)', ownerStatus: 'RELEASED' },
          { code: 'RELEASE', state: 'DONE', at: '2026-01-01T09:00:00.000Z', detail: null, ownerStatus: 'RELEASED' },
          { code: 'EXECUTION', state: 'CURRENT', at: null, detail: 'Nenhum apontamento registrado', ownerStatus: 'RELEASED' },
          { code: 'COMPLETION', state: 'PENDING', at: null, detail: null, ownerStatus: 'RELEASED' },
          { code: 'MEASUREMENT', state: 'PENDING', at: null, detail: null, ownerStatus: null },
          { code: 'BILLING', state: 'PENDING', at: null, detail: null, ownerStatus: null },
        ],
        plannedVsActual: {
          plannedResources: 1,
          activeAllocations: 1,
          executionEntries: 0,
          executedQuantityTotal: null,
          divergences: [],
        },
        downstream: {
          measurement: { count: 0, status: null, createdAt: null },
          billing: { count: 0, status: null, createdAt: null, totalAmount: null, currencyCode: null },
        },
        nextAction: {
          step: 'START_EXECUTION',
          transition: 'start',
          availableTransitions: ['start', 'cancel'],
          blockers: [],
        },
      },
    };
  }

  function getOrder(id: string): MockOrder {
    if (!orders.has(id)) {
      orders.set(id, buildOrderDetail(id));
      entries.set(id, []);
      evidence.set(id, []);
      occurrences.set(id, []);
    }
    return { ...orders.get(id)! };
  }

  function saveOrder(order: MockOrder): MockOrder {
    orders.set(order.id, order);
    return order;
  }

  function executionBundle(orderId: string) {
    const order = getOrder(orderId);
    const bundleEntries = entries.get(orderId) ?? [];
    const bundleOccurrences = occurrences.get(orderId) ?? [];
    return {
      serviceOrderId: orderId,
      status: order.status,
      entries: bundleEntries,
      evidence: evidence.get(orderId) ?? [],
      occurrences: bundleOccurrences,
      comparison: options.executionComparison ?? {
        quantities: [],
        resources: [],
        periods: [],
        occurrenceCount: bundleOccurrences.length,
        entryCount: bundleEntries.length,
      },
    };
  }

  function serviceOrderDetail(id: string) {
    return getOrder(id);
  }

  function serviceOrderSummary(id: string) {
    const order = getOrder(id);
    const activeAllocation = allocations.find(
      (item) => item.serviceOrderId === id && item.status === 'ACTIVE',
    );
    const member = activeAllocation?.workforceMemberId
      ? people.find((item) => item.id === activeAllocation.workforceMemberId)
      : undefined;
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      unitId: order.unitId,
      status: order.status,
      clientId: order.clientId,
      clientSnapshot: order.clientSnapshot,
      description: order.description,
      rowVersion: order.rowVersion,
      updatedAt: order.updatedAt,
      assignedWorkforceMember: member
        ? {
            id: member.id,
            memberCode: member.memberCode,
            displayName: member.preferredName || member.legalName,
          }
        : null,
      deadlineAt: activeAllocation?.operationalEnd ?? null,
    };
  }

  const planningAssets: PhysicalAsset[] = [
    {
      id: MOCK_ASSET_A_ID,
      assetCode: 'TRK-DEMO',
      resourceTypeId: TRUCK_TYPE_ID,
      resourceTypeCode: 'TRUCK',
      resourceTypeClassification: VEHICLE_CLASSIFICATION,
      name: 'Caminhão demo',
      lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
      allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
      unitId: 'unit-demo',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deactivatedAt: null,
      vehicle: { plate: 'DEM-0A12', chassis: 'CH-001', model: 'Volvo' },
      currentAllocation: null,
    },
    {
      id: MOCK_ASSET_B_ID,
      assetCode: 'TRK-ALT',
      resourceTypeId: TRUCK_TYPE_ID,
      resourceTypeCode: 'TRUCK',
      resourceTypeClassification: VEHICLE_CLASSIFICATION,
      name: 'Caminhão reserva',
      lifecycleStatus: ASSET_LIFECYCLE_STATUSES.Active,
      allocationStatus: ASSET_ALLOCATION_STATUSES.Available,
      unitId: 'unit-demo',
      version: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deactivatedAt: null,
      vehicle: { plate: 'ALT-0B34', chassis: 'CH-002', model: 'Mercedes' },
      currentAllocation: null,
    },
  ];

  const planned: PlannedResource[] = [];
  const allocations: ResourceAllocation[] = [];
  const measurements = new Map<string, MockMeasurement>();

  type MockBillingItem = {
    id: string;
    lineNumber: number;
    measurementItemId: string;
    sourceExecutionEntryId: string | null;
    unitCode: string;
    quantity: string;
    unitPrice: string | null;
    lineAmount: string;
    pricingLineSnapshot: Record<string, unknown>;
    lineLabel: string;
  };

  type MockBilling = {
    id: string;
    serviceOrderId: string;
    measurementId: string;
    clientId: string;
    unitId: string;
    status: string;
    proposalId: string | null;
    purchaseOrderId: string | null;
    contractReference: string | null;
    clientLegalNameSnapshot: string;
    clientTaxIdSnapshot: string | null;
    billingAddressSnapshot: Record<string, unknown>;
    commercialReferenceSnapshot: Record<string, unknown>;
    currencyCode: string;
    paymentTerms: string;
    paymentTermsSource: string;
    paymentTermsAuthoritative: string | null;
    totalAmount: string;
    preparedAt: string;
    preparedByIdentityId: string;
    voidedAt: string | null;
    voidedByIdentityId: string | null;
    voidReason: string | null;
    rowVersion: number;
    createdAt: string;
    updatedAt: string;
    items: MockBillingItem[];
    historyEvents: unknown[];
  };

  const billings = new Map<string, MockBilling>();
  const billingDocuments = new Map<string, Array<Record<string, unknown>>>();
  let billingDocumentSequence = 1;

  function buildBillingDocument(orderId: string, billing: MockBilling, dueDate: string | null) {
    const number = `NF-2026-${String(billingDocumentSequence++).padStart(6, '0')}`;
    const now = new Date().toISOString();
    return {
      id: MOCK_BILLING_DOCUMENT_ID,
      billingRecordId: billing.id,
      serviceOrderId: orderId,
      measurementId: billing.measurementId,
      clientId: billing.clientId,
      unitId: billing.unitId,
      documentNumber: number,
      sequenceYear: 2026,
      sequenceNumber: billingDocumentSequence - 1,
      versionNumber: 1,
      replacesDocumentId: null,
      status: 'FINALIZED',
      documentCategory: 'NOTA_FATURA',
      emitterLegalName: 'EMPRESA EMISSORA PILOTO LTDA',
      emitterTaxId: '11222333000181',
      emitterAddressSnapshot: {},
      clientLegalNameSnapshot: billing.clientLegalNameSnapshot,
      clientTaxIdSnapshot: billing.clientTaxIdSnapshot,
      billingAddressSnapshot: billing.billingAddressSnapshot,
      commercialReferenceSnapshot: billing.commercialReferenceSnapshot,
      proposalId: billing.proposalId,
      purchaseOrderId: billing.purchaseOrderId,
      purchaseOrderNumberSnapshot: options.purchaseOrderPaymentTerms ? 'PO-DEMO' : null,
      contractReference: billing.contractReference,
      currencyCode: billing.currencyCode,
      paymentTerms: billing.paymentTerms,
      dueDate,
      totalAmount: billing.totalAmount,
      issuedAt: now,
      storedDocumentId: 'doc-demo',
      artifactSha256: 'a'.repeat(64),
      artifactByteSize: 1024,
      cancelledAt: null,
      cancelledByIdentityId: null,
      cancelReason: null,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now,
      items: billing.items.map((item) => ({
        ...item,
        billingItemId: item.id,
        measurementItemId: item.measurementItemId,
      })),
      historyEvents: [],
    };
  }

  async function handleBillingDocumentsRoute(
    orderId: string,
    billing: MockBilling,
    docSuffix: string,
    method: string,
    init?: RequestInit,
  ): Promise<Response | null> {
    if (!billingDocumentReadAllowed) {
      return orderError('BILLING_DENIED', 403);
    }
    const body = parseBody(init);

    if (docSuffix === '' && method === 'GET') {
      return jsonResponse(billingDocuments.get(orderId) ?? []);
    }

    if (docSuffix === '' && method === 'POST') {
      if (!billingDocumentAllowed) {
        return orderError('BILLING_DENIED', 403);
      }
      if (options.billingDocumentTermsMismatch) {
        return orderError('BILLING_COMMERCIAL_TERMS_MISMATCH', 409);
      }
      const issueIdempotencyKey =
        typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
      if (issueIdempotencyKey) {
        const cached = idempotency.get(`${orderId}:documents:${issueIdempotencyKey}`);
        if (cached) {
          return jsonResponse(cached, 201);
        }
      }
      const existing = (billingDocuments.get(orderId) ?? []).some((doc) => doc.status === 'FINALIZED');
      if (existing || options.billingDocumentAlreadyExists) {
        return orderError('BILLING_DOCUMENT_ALREADY_EXISTS', 409);
      }
      if (options.billingDocumentDelayedIssueMs) {
        await new Promise((resolve) => setTimeout(resolve, options.billingDocumentDelayedIssueMs));
      }
      const dueDate = readString(body.dueDate) || null;
      const created = buildBillingDocument(orderId, billing, dueDate);
      billingDocuments.set(orderId, [created]);
      if (issueIdempotencyKey) {
        idempotency.set(`${orderId}:documents:${issueIdempotencyKey}`, created);
      }
      return jsonResponse(created, 201);
    }

    const pdfMatch = docSuffix.match(/^\/([^/]+)\/pdf$/);
    if (pdfMatch && method === 'GET') {
      if (!billingDocumentAllowed) {
        return orderError('BILLING_DENIED', 403);
      }
      return {
        ok: true,
        status: 200,
        headers: new Headers({
          'Content-Type': 'application/pdf',
          'Content-Disposition': 'attachment; filename="nota-fatura-demo.pdf"',
          'X-Content-Sha256': 'a'.repeat(64),
        }),
        blob: async () => new Blob(['%PDF-1.4 demo'], { type: 'application/pdf' }),
      } as unknown as Response;
    }

    const docIdMatch = docSuffix.match(/^\/([^/]+)$/);
    if (docIdMatch && method === 'GET') {
      const doc = (billingDocuments.get(orderId) ?? []).find((entry) => entry.id === docIdMatch[1]);
      return doc ? jsonResponse(doc) : orderError('BILLING_DOCUMENT_NOT_FOUND', 404);
    }

    return null;
  }

  function buildBillingRecord(orderId: string, measurement: MockMeasurement, status: string): MockBilling {
    const order = getOrder(orderId);
    const now = new Date().toISOString();
    return {
      id: MOCK_BILLING_ID,
      serviceOrderId: orderId,
      measurementId: measurement.id,
      clientId: order.clientId ?? 'client-demo',
      unitId: order.unitId,
      status,
      proposalId: null,
      purchaseOrderId: null,
      contractReference: null,
      clientLegalNameSnapshot:
        typeof order.clientSnapshot?.legalName === 'string'
          ? order.clientSnapshot.legalName
          : 'Cliente Demo LTDA',
      clientTaxIdSnapshot: '11222333000181',
      billingAddressSnapshot: { city: 'Porto Velho', state: 'RO' },
      commercialReferenceSnapshot: measurement.commercialReferenceSnapshot,
      currencyCode: 'BRL',
      paymentTerms: options.purchaseOrderPaymentTerms ?? '30 DDL',
      paymentTermsSource: options.purchaseOrderPaymentTerms ? 'PURCHASE_ORDER' : 'DECLARED',
      paymentTermsAuthoritative: options.purchaseOrderPaymentTerms ?? null,
      totalAmount: '1000.0000',
      preparedAt: now,
      preparedByIdentityId: 'actor-demo',
      voidedAt: status === 'VOIDED' ? now : null,
      voidedByIdentityId: status === 'VOIDED' ? 'actor-demo' : null,
      voidReason: status === 'VOIDED' ? 'Teste' : null,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now,
      items: measurement.items.map((item, index) => ({
        id: crypto.randomUUID(),
        lineNumber: item.lineNumber ?? index + 1,
        measurementItemId: item.id,
        sourceExecutionEntryId: item.sourceExecutionEntryId,
        unitCode: item.unitCode,
        quantity: item.measuredQuantity,
        unitPrice: item.unitPrice,
        lineAmount: item.lineAmount ?? '1000.0000',
        pricingLineSnapshot: item.pricingLineSnapshot,
        lineLabel: `Linha ${item.lineNumber ?? index + 1}`,
      })),
      historyEvents: [],
    };
  }

  function measurementStatusForSeed(seed: MeasurementSeedKind): string {
    switch (seed) {
      case 'submitted':
        return 'SUBMITTED';
      case 'under_review':
        return 'UNDER_REVIEW';
      case 'approved':
        return 'APPROVED';
      case 'rejected':
        return 'REJECTED';
      default:
        return 'DRAFT';
    }
  }

  function buildMeasurementItems(orderId: string, divergent: boolean): MockMeasurementItem[] {
    const order = getOrder(orderId);
    const defaultUnit = order.serviceSnapshot.measurementModel?.defaultUnitCode ?? 'SERVICE';
    const quantityEntries = (entries.get(orderId) ?? []).filter((item) => item.entryType === 'QUANTITY');
    if (quantityEntries.length > 0) {
      return quantityEntries.map((entry, index) => ({
        id: crypto.randomUUID(),
        lineNumber: index + 1,
        sourceExecutionEntryId: entry.id,
        unitCode: entry.quantityUnitCode ?? defaultUnit,
        actualQuantity: entry.quantityValue ?? '1',
        measuredQuantity: divergent ? '2' : (entry.quantityValue ?? '1'),
        unitPrice: '1000.0000',
        lineAmount: divergent ? '2000.0000' : '1000.0000',
        pricingLineSnapshot: { salePrice: '1000.0000' },
        notes: null,
      }));
    }
    const entryId = crypto.randomUUID();
    return [
      {
        id: crypto.randomUUID(),
        lineNumber: 1,
        sourceExecutionEntryId: entryId,
        unitCode: defaultUnit,
        actualQuantity: '1',
        measuredQuantity: divergent ? '2' : '1',
        unitPrice: '1000.0000',
        lineAmount: divergent ? '2000.0000' : '1000.0000',
        pricingLineSnapshot: { salePrice: '1000.0000' },
        notes: null,
      },
    ];
  }

  function createMockMeasurement(
    orderId: string,
    status: string,
    divergent = false,
    measurementId = MOCK_MEASUREMENT_ID,
  ): MockMeasurement {
    const now = new Date().toISOString();
    return {
      id: measurementId,
      serviceOrderId: orderId,
      unitId: 'unit-demo',
      status,
      commercialReferenceSnapshot: { capturedAt: now },
      submittedAt: status === 'SUBMITTED' || status === 'UNDER_REVIEW' ? now : null,
      submittedByIdentityId: status === 'SUBMITTED' || status === 'UNDER_REVIEW' ? 'actor-demo' : null,
      reviewStartedAt: status === 'UNDER_REVIEW' ? now : null,
      reviewStartedByIdentityId: status === 'UNDER_REVIEW' ? 'actor-demo' : null,
      decidedAt: status === 'APPROVED' || status === 'REJECTED' ? now : null,
      decidedByIdentityId: status === 'APPROVED' || status === 'REJECTED' ? 'actor-demo' : null,
      rejectionReason:
        status === 'REJECTED' ? 'Divergência de quantidade não justificada na revisão.' : null,
      rowVersion: 1,
      createdAt: now,
      updatedAt: now,
      items: buildMeasurementItems(orderId, divergent),
      adjustments: [],
      historyEvents: [
        {
          id: 'measurement-event-created',
          eventType: 'CREATED',
          payload: { itemCount: 1 },
          actorIdentityId: 'actor-demo',
          occurredAt: '2026-01-02T08:00:00.000Z',
        },
        ...(status === 'REJECTED'
          ? [
              {
                id: 'measurement-event-rejected',
                eventType: 'REJECTED',
                payload: {
                  fromStatus: 'UNDER_REVIEW',
                  toStatus: 'REJECTED',
                  rejectionReason: 'Divergência de quantidade não justificada na revisão.',
                },
                actorIdentityId: 'actor-demo',
                occurredAt: '2026-01-02T10:00:00.000Z',
              },
            ]
          : []),
        ...(status === 'APPROVED'
          ? [
              {
                id: 'measurement-event-approved',
                eventType: 'APPROVED',
                payload: { fromStatus: 'UNDER_REVIEW', toStatus: 'APPROVED', rejectionReason: null },
                actorIdentityId: 'actor-demo',
                occurredAt: '2026-01-02T10:00:00.000Z',
              },
            ]
          : []),
      ],
    };
  }

  function saveMeasurement(measurement: MockMeasurement): MockMeasurement {
    measurements.set(measurement.serviceOrderId, measurement);
    return measurement;
  }

  if (options.orderCompleted) {
    saveOrder({
      ...getOrder(MOCK_SERVICE_ORDER_ID),
      status: SERVICE_ORDER_STATUSES.Completed,
    });
    entries.set(MOCK_SERVICE_ORDER_ID, [
      {
        id: crypto.randomUUID(),
        serviceOrderId: MOCK_SERVICE_ORDER_ID,
        entryType: 'OBSERVATION',
        evidenceKind: 'OBSERVATION',
        quantityValue: null,
        quantityUnitCode: null,
        textValue: 'Execução concluída para medição.',
        context: {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
        rowVersion: 1,
      },
      {
        id: crypto.randomUUID(),
        serviceOrderId: MOCK_SERVICE_ORDER_ID,
        entryType: 'QUANTITY',
        evidenceKind: 'QUANTITY',
        quantityValue: '1',
        quantityUnitCode: 'SERVICE',
        textValue: null,
        context: {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
        rowVersion: 1,
      },
    ]);
  }

  if (options.seedMeasurement) {
    const divergent = options.seedMeasurement === 'draft-divergent';
    const status = measurementStatusForSeed(options.seedMeasurement);
    saveMeasurement(createMockMeasurement(MOCK_SERVICE_ORDER_ID, status, divergent));
    if (!planned.some((item) => item.serviceOrderId === MOCK_SERVICE_ORDER_ID)) {
      planned.push({
        id: MOCK_PLANNED_RESOURCE_ID,
        serviceOrderId: MOCK_SERVICE_ORDER_ID,
        requirementKind: 'PHYSICAL_RESOURCE',
        resourceTypeCode: 'TRUCK',
        laborTypeCode: null,
        plannedQuantity: '1',
        operationalStart: null,
        operationalEnd: null,
        notes: null,
        status: 'ACTIVE',
        rowVersion: 1,
      });
    }
  }

  if (options.orderStatus) {
    const current = getOrder(MOCK_SERVICE_ORDER_ID);
    saveOrder({
      ...current,
      status: options.orderStatus,
      statusBeforeCancel:
        options.orderStatus === SERVICE_ORDER_STATUSES.Cancelled
          ? (options.statusBeforeCancel ?? SERVICE_ORDER_STATUSES.Prepared)
          : null,
    });
  }

  if (options.purchaseOrderPaymentTerms) {
    saveOrder({
      ...getOrder(MOCK_SERVICE_ORDER_ID),
      purchaseOrderSnapshot: {
        paymentTerms: options.purchaseOrderPaymentTerms,
        poNumber: 'PO-DEMO-01',
      },
    });
  }

  if (options.seedBilling && options.seedBilling !== 'none') {
    const measurement =
      measurements.get(MOCK_SERVICE_ORDER_ID) ??
      saveMeasurement(createMockMeasurement(MOCK_SERVICE_ORDER_ID, 'APPROVED'));
    const record = buildBillingRecord(
      MOCK_SERVICE_ORDER_ID,
      measurement,
      options.seedBilling === 'voided' ? 'VOIDED' : 'PREPARED',
    );
    if (options.preparedPaymentTerms) {
      record.paymentTerms = options.preparedPaymentTerms;
    }
    billings.set(MOCK_SERVICE_ORDER_ID, record);
  }

  function readString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
  }

  function parseBody(init?: RequestInit): Record<string, unknown> {
    return JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as Record<string, unknown>;
  }

  function satisfiedKinds(orderId: string): Set<string> {
    const kinds = new Set<string>();
    for (const item of evidence.get(orderId) ?? []) {
      kinds.add(item.evidenceKind);
    }
    for (const entry of entries.get(orderId) ?? []) {
      if (entry.evidenceKind) {
        kinds.add(entry.evidenceKind);
      }
      if (entry.entryType === 'QUANTITY') {
        kinds.add('QUANTITY');
      }
      if (entry.entryType === 'OBSERVATION') {
        kinds.add('OBSERVATION');
      }
    }
    return kinds;
  }

  async function handleExecutionRoute(
    orderId: string,
    suffix: string,
    method: string,
    init?: RequestInit,
  ): Promise<Response | null> {
    if (!executionAllowed) {
      return orderError('SERVICE_ORDERS_DENIED', 403);
    }
    if (orderId !== MOCK_SERVICE_ORDER_ID && orderId !== PROBE_SERVICE_ORDER_ID) {
      return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
    }
    if (options.executionNetworkFailure && method === 'POST') {
      throw new TypeError('Failed to fetch');
    }

    if (suffix === '' && method === 'GET') {
      return jsonResponse(executionBundle(orderId));
    }

    const body = parseBody(init);
    const rowVersion = Number(body.rowVersion);
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const order = getOrder(orderId);

    if (idempotencyKey) {
      const cached = idempotency.get(`${orderId}:${suffix}:${idempotencyKey}`);
      if (cached) {
        return jsonResponse(cached);
      }
    }

    if (options.executionVersionConflict && suffix !== '') {
      return orderError('SERVICE_ORDERS_VERSION_CONFLICT', 409);
    }

    if (suffix === '/start' && method === 'POST') {
      if (order.status !== SERVICE_ORDER_STATUSES.Released) {
        return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
      }
      if (options.executionDelayedStartMs) {
        await new Promise((resolve) => setTimeout(resolve, options.executionDelayedStartMs));
      }
      const updated = saveOrder({
        ...order,
        status: SERVICE_ORDER_STATUSES.InExecution,
        rowVersion: rowVersion + 1,
      });
      const response = updated;
      if (idempotencyKey) {
        idempotency.set(`${orderId}:${suffix}:${idempotencyKey}`, response);
      }
      return jsonResponse(response);
    }

    if (suffix === '/pause' && method === 'POST') {
      if (order.status !== SERVICE_ORDER_STATUSES.InExecution) {
        return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
      }
      const updated = saveOrder({
        ...order,
        status: SERVICE_ORDER_STATUSES.Paused,
        rowVersion: rowVersion + 1,
      });
      return jsonResponse(updated);
    }

    if (suffix === '/resume' && method === 'POST') {
      if (order.status !== SERVICE_ORDER_STATUSES.Paused) {
        return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
      }
      const updated = saveOrder({
        ...order,
        status: SERVICE_ORDER_STATUSES.InExecution,
        rowVersion: rowVersion + 1,
      });
      return jsonResponse(updated);
    }

    if (suffix === '/complete' && method === 'POST') {
      if (order.status !== SERVICE_ORDER_STATUSES.InExecution) {
        return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
      }
      const required = order.serviceSnapshot.requirements.execution.filter(
        (item: { requirementLevel: string }) => item.requirementLevel === 'REQUIRED',
      );
      const missing = required.some(
        (item: { evidenceKind: string }) => !satisfiedKinds(orderId).has(item.evidenceKind),
      );
      if (missing) {
        return orderError('SERVICE_ORDERS_REQUIRED_EVIDENCE_MISSING', 409);
      }
      const updated = saveOrder({
        ...order,
        status: SERVICE_ORDER_STATUSES.Completed,
        rowVersion: rowVersion + 1,
      });
      return jsonResponse(updated);
    }

    if (suffix === '/entries/observation' && method === 'POST') {
      const entry: MockEntry = {
        id: crypto.randomUUID(),
        serviceOrderId: orderId,
        entryType: 'OBSERVATION',
        evidenceKind: 'OBSERVATION',
        quantityValue: null,
        quantityUnitCode: null,
        textValue: readString(body.text),
        context: {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
        rowVersion: 1,
      };
      entries.set(orderId, [...(entries.get(orderId) ?? []), entry]);
      const updated = saveOrder({ ...order, rowVersion: rowVersion + 1 });
      return jsonResponse({ entry, rowVersion: updated.rowVersion }, 201);
    }

    if (suffix === '/entries/quantity' && method === 'POST') {
      const entry: MockEntry = {
        id: crypto.randomUUID(),
        serviceOrderId: orderId,
        entryType: 'QUANTITY',
        evidenceKind: 'QUANTITY',
        quantityValue: readString(body.quantityValue),
        quantityUnitCode: readString(body.unitCode),
        textValue: null,
        context: {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
        rowVersion: 1,
      };
      entries.set(orderId, [...(entries.get(orderId) ?? []), entry]);
      const updated = saveOrder({ ...order, rowVersion: rowVersion + 1 });
      return jsonResponse({ entry, rowVersion: updated.rowVersion }, 201);
    }

    if (suffix === '/occurrences' && method === 'POST') {
      const occurrence: MockOccurrence = {
        id: crypto.randomUUID(),
        serviceOrderId: orderId,
        occurrenceCode: readString(body.occurrenceCode),
        description: readString(body.description),
        payload: {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
      };
      occurrences.set(orderId, [...(occurrences.get(orderId) ?? []), occurrence]);
      const updated = saveOrder({ ...order, rowVersion: rowVersion + 1 });
      return jsonResponse({ occurrence, rowVersion: updated.rowVersion }, 201);
    }

    if (suffix === '/evidence' && method === 'POST') {
      const item: MockEvidence = {
        id: crypto.randomUUID(),
        serviceOrderId: orderId,
        evidenceKind: readString(body.evidenceKind, 'PHOTO'),
        payload: (body.payload as Record<string, unknown>) ?? {},
        actorIdentityId: 'actor-demo',
        recordedAt: new Date().toISOString(),
      };
      evidence.set(orderId, [...(evidence.get(orderId) ?? []), item]);
      const updated = saveOrder({ ...order, rowVersion: rowVersion + 1 });
      return jsonResponse({ evidence: item, rowVersion: updated.rowVersion }, 201);
    }

    return null;
  }

  async function handleLifecycleAction(
    orderId: string,
    action: string,
    init?: RequestInit,
  ): Promise<Response> {
    if (orderId !== MOCK_SERVICE_ORDER_ID && orderId !== PROBE_SERVICE_ORDER_ID) {
      return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
    }
    if (options.lifecycleVersionConflict) {
      return orderError('SERVICE_ORDERS_VERSION_CONFLICT', 409);
    }
    const body = parseBody(init);
    const rowVersion = Number(body.rowVersion);
    const order = getOrder(orderId);
    if (Number.isFinite(rowVersion) && rowVersion > 0 && rowVersion !== order.rowVersion) {
      return orderError('SERVICE_ORDERS_VERSION_CONFLICT', 409);
    }

    const now = new Date().toISOString();
    switch (action) {
      case 'prepare': {
        if (order.status !== SERVICE_ORDER_STATUSES.Draft) {
          return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
        }
        const updated = saveOrder({
          ...order,
          status: SERVICE_ORDER_STATUSES.Prepared,
          preparedAt: now,
          rowVersion: order.rowVersion + 1,
          updatedAt: now,
        });
        return jsonResponse(updated);
      }
      case 'release': {
        if (order.status !== SERVICE_ORDER_STATUSES.Prepared) {
          return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
        }
        const updated = saveOrder({
          ...order,
          status: SERVICE_ORDER_STATUSES.Released,
          releasedAt: now,
          rowVersion: order.rowVersion + 1,
          updatedAt: now,
        });
        return jsonResponse(updated);
      }
      case 'cancel': {
        const reason = readString(body.cancellationReason).trim();
        if (!reason) {
          return orderError('SERVICE_ORDERS_VALIDATION_FAILED', 400);
        }
        if (
          order.status !== SERVICE_ORDER_STATUSES.Draft &&
          order.status !== SERVICE_ORDER_STATUSES.Prepared &&
          order.status !== SERVICE_ORDER_STATUSES.Released
        ) {
          return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
        }
        const updated = saveOrder({
          ...order,
          status: SERVICE_ORDER_STATUSES.Cancelled,
          cancelledAt: now,
          statusBeforeCancel: order.status,
          rowVersion: order.rowVersion + 1,
          updatedAt: now,
        });
        return jsonResponse(updated);
      }
      case 'reopen': {
        const reason = readString(body.reopenReason).trim();
        if (!reason) {
          return orderError('SERVICE_ORDERS_VALIDATION_FAILED', 400);
        }
        let nextStatus: string;
        if (order.status === SERVICE_ORDER_STATUSES.Cancelled) {
          if (!order.statusBeforeCancel) {
            return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
          }
          nextStatus = order.statusBeforeCancel;
        } else if (order.status === SERVICE_ORDER_STATUSES.Completed) {
          nextStatus = SERVICE_ORDER_STATUSES.InExecution;
        } else {
          return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
        }
        const updated = saveOrder({
          ...order,
          status: nextStatus,
          statusBeforeCancel: null,
          rowVersion: order.rowVersion + 1,
          updatedAt: now,
        });
        return jsonResponse(updated);
      }
      default:
        return orderError('SERVICE_ORDERS_INVALID_STATE', 409);
    }
  }

  async function handleMeasurementRoute(
    orderId: string,
    suffix: string,
    method: string,
    init?: RequestInit,
  ): Promise<Response | null> {
    if (!measurementAllowed) {
      return orderError('MEASUREMENTS_DENIED', 403);
    }
    if (orderId !== MOCK_SERVICE_ORDER_ID && orderId !== PROBE_SERVICE_ORDER_ID) {
      return orderError('MEASUREMENTS_SERVICE_ORDER_NOT_FOUND', 404);
    }

    const body = parseBody(init);
    const rowVersion = Number(body.rowVersion);
    const measurementIdFromPath = suffix.match(/^\/([^/]+)/)?.[1];
    const actionSuffix = measurementIdFromPath
      ? suffix.slice(measurementIdFromPath.length + 1)
      : suffix;

    if (suffix === '' && method === 'GET') {
      const measurement = measurements.get(orderId);
      return jsonResponse(measurement ?? null);
    }

    if (suffix === '' && method === 'POST') {
      const order = getOrder(orderId);
      if (order.status !== SERVICE_ORDER_STATUSES.Completed) {
        return orderError('MEASUREMENTS_SERVICE_ORDER_NOT_COMPLETED', 409);
      }
      if (measurements.has(orderId)) {
        return orderError('MEASUREMENTS_MEASUREMENT_ALREADY_EXISTS', 409);
      }
      const created = saveMeasurement(
        createMockMeasurement(orderId, 'DRAFT', false, crypto.randomUUID()),
      );
      return jsonResponse(created, 201);
    }

    if (!measurementIdFromPath) {
      return null;
    }

    const existing =
      orderId === PROBE_SERVICE_ORDER_ID
        ? createMockMeasurement(orderId, 'DRAFT', false, PROBE_MEASUREMENT_ID)
        : measurements.get(orderId);

    if (!existing && orderId !== PROBE_SERVICE_ORDER_ID) {
      return orderError('MEASUREMENTS_NOT_FOUND', 404);
    }

    const measurement =
      existing ?? createMockMeasurement(orderId, 'DRAFT', false, PROBE_MEASUREMENT_ID);

    if (actionSuffix === '' && method === 'GET') {
      return jsonResponse(measurement);
    }

    if (method !== 'POST') {
      return null;
    }

    if (options.measurementVersionConflict && actionSuffix !== '') {
      return orderError('MEASUREMENTS_VERSION_CONFLICT', 409);
    }

    if (
      orderId !== PROBE_SERVICE_ORDER_ID &&
      Number.isFinite(rowVersion) &&
      rowVersion > 0 &&
      rowVersion !== measurement.rowVersion
    ) {
      return orderError('MEASUREMENTS_VERSION_CONFLICT', 409);
    }

    if (actionSuffix === '/submit') {
      if (measurement.status !== 'DRAFT') {
        return orderError('MEASUREMENTS_INVALID_STATE', 409);
      }
      const updated = saveMeasurement({
        ...measurement,
        status: 'SUBMITTED',
        submittedAt: new Date().toISOString(),
        submittedByIdentityId: 'actor-demo',
        rowVersion: measurement.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse(updated);
    }

    if (actionSuffix === '/start-review') {
      if (measurement.status !== 'SUBMITTED') {
        return orderError('MEASUREMENTS_INVALID_STATE', 409);
      }
      const updated = saveMeasurement({
        ...measurement,
        status: 'UNDER_REVIEW',
        reviewStartedAt: new Date().toISOString(),
        reviewStartedByIdentityId: 'actor-demo',
        rowVersion: measurement.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse(updated);
    }

    if (actionSuffix === '/approve') {
      if (measurement.status !== 'UNDER_REVIEW') {
        return orderError('MEASUREMENTS_INVALID_STATE', 409);
      }
      const updated = saveMeasurement({
        ...measurement,
        status: 'APPROVED',
        decidedAt: new Date().toISOString(),
        decidedByIdentityId: 'actor-demo',
        rowVersion: measurement.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse(updated);
    }

    if (actionSuffix === '/reject') {
      if (measurement.status !== 'UNDER_REVIEW') {
        return orderError('MEASUREMENTS_INVALID_STATE', 409);
      }
      const reason = readString(body.rejectionReason);
      if (reason.trim().length < 3) {
        return orderError('MEASUREMENTS_VALIDATION_FAILED', 400);
      }
      const updated = saveMeasurement({
        ...measurement,
        status: 'REJECTED',
        decidedAt: new Date().toISOString(),
        decidedByIdentityId: 'actor-demo',
        rejectionReason: reason.trim(),
        rowVersion: measurement.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse(updated);
    }

    if (actionSuffix === '/resubmit') {
      if (measurement.status !== 'REJECTED') {
        return orderError('MEASUREMENTS_INVALID_STATE', 409);
      }
      const updated = saveMeasurement({
        ...measurement,
        status: 'DRAFT',
        submittedAt: null,
        submittedByIdentityId: null,
        reviewStartedAt: null,
        reviewStartedByIdentityId: null,
        decidedAt: null,
        decidedByIdentityId: null,
        rejectionReason: null,
        rowVersion: measurement.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      });
      return jsonResponse(updated);
    }

    if (actionSuffix === '/regenerate') {
      return jsonResponse(measurement);
    }

    return null;
  }

  async function handleBillingRoute(
    orderId: string,
    suffix: string,
    method: string,
    init?: RequestInit,
  ): Promise<Response | null> {
    if (!billingReadAllowed) {
      return orderError('BILLING_DENIED', 403);
    }

    if (!billingAllowed && orderId !== PROBE_SERVICE_ORDER_ID) {
      return orderError('BILLING_DENIED', 403);
    }

    const body = parseBody(init);
    const billingIdFromPath = suffix.match(/^\/([^/]+)/)?.[1];
    const actionSuffix = billingIdFromPath ? suffix.slice(billingIdFromPath.length + 1) : suffix;

    if (suffix === '' && method === 'GET') {
      const billing = billings.get(orderId);
      return jsonResponse(billing ?? null);
    }

    if (suffix === '' && method === 'POST') {
      if (!billingAllowed) {
        return orderError('BILLING_DENIED', 403);
      }
      const measurement = measurements.get(orderId);
      if (!measurement || measurement.status !== 'APPROVED') {
        return orderError('BILLING_MEASUREMENT_NOT_APPROVED', 409);
      }
      const paymentTerms = readString(body.paymentTerms);
      if (options.billingTermsMismatch) {
        return orderError('BILLING_COMMERCIAL_TERMS_MISMATCH', 409);
      }
      if (billings.get(orderId)?.status === 'PREPARED') {
        return orderError('BILLING_BILLING_ALREADY_EXISTS', 409);
      }
      const created = buildBillingRecord(orderId, measurement, 'PREPARED');
      created.paymentTerms = paymentTerms || created.paymentTerms;
      billings.set(orderId, created);
      return jsonResponse(created, 201);
    }

    if (!billingIdFromPath) {
      return null;
    }

    const billing =
      billings.get(orderId) ??
      (orderId === PROBE_SERVICE_ORDER_ID
        ? buildBillingRecord(orderId, createMockMeasurement(orderId, 'APPROVED', false, PROBE_MEASUREMENT_ID), 'PREPARED')
        : undefined);

    if (!billing) {
      return orderError('BILLING_NOT_FOUND', 404);
    }

    if (actionSuffix === '' && method === 'GET') {
      return jsonResponse(billing);
    }

    if (actionSuffix === '/void' && method === 'POST') {
      if (!billingAllowed) {
        return orderError('BILLING_DENIED', 403);
      }
      if (options.billingVersionConflict) {
        return orderError('BILLING_VERSION_CONFLICT', 409);
      }
      const rowVersion = Number(body.rowVersion);
      if (rowVersion !== billing.rowVersion) {
        return orderError('BILLING_VERSION_CONFLICT', 409);
      }
      const voided = {
        ...billing,
        status: 'VOIDED',
        voidedAt: new Date().toISOString(),
        voidedByIdentityId: 'actor-demo',
        voidReason: readString(body.voidReason) || null,
        rowVersion: billing.rowVersion + 1,
        updatedAt: new Date().toISOString(),
      };
      billings.set(orderId, voided);
      return jsonResponse(voided);
    }

    const documentsMatch = actionSuffix.match(/^\/documents(\/.*)?$/);
    if (documentsMatch) {
      return await handleBillingDocumentsRoute(
        orderId,
        billing,
        documentsMatch[1] ?? '',
        method,
        init,
      );
    }

    return null;
  }

  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname, searchParams } = parseRequestPath(input);
    const method = init?.method ?? 'GET';

    if (pathname === '/api/v1/resources/physical-assets' && method === 'GET') {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return orderError('AUTH_UNAUTHORIZED', 401);
      }
      if (options.assetListAllowed === false) {
        return orderError('ASSET_DENIED', 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const resourceTypeId = searchParams.get('resourceTypeId');
      let items = [...planningAssets];
      if (resourceTypeId) {
        items = items.filter((asset) => asset.resourceTypeId === resourceTypeId);
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit),
        limit,
        offset,
        total: items.length,
      });
    }

    if (pathname.startsWith('/api/v1/resources/physical-assets/') && method === 'GET') {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return orderError('AUTH_UNAUTHORIZED', 401);
      }
      if (options.assetListAllowed === false) {
        return orderError('ASSET_DENIED', 403);
      }
      const assetId = pathname.slice('/api/v1/resources/physical-assets/'.length);
      const asset = planningAssets.find((item) => item.id === assetId);
      if (!asset) {
        return orderError('ASSET_NOT_FOUND', 404);
      }
      return jsonResponse(asset);
    }

    if (pathname === '/api/v1/people' && method === 'GET') {
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return orderError('AUTH_UNAUTHORIZED', 401);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const defaultLaborTypeCode = searchParams.get('defaultLaborTypeCode');
      let items = [...people];
      if (status) {
        items = items.filter((person) => person.status === status);
      }
      if (defaultLaborTypeCode) {
        items = items.filter((person) => person.defaultLaborTypeCode === defaultLaborTypeCode);
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit),
        limit,
        offset,
      });
    }

    /*
     * CADEIA EMPRESARIAL — o read model real devolve a linhagem ja autorizada e
     * ordenada. Precisa vir ANTES do desvio para `upstream`, que captura tudo o que
     * nao esta sob `/api/v1/service-orders` (o repositorio da cadeia nao esta).
     */
    const chainMatch = pathname.match(/^\/api\/v1\/business-chain\/([^/]+)\/([^/]+)$/);
    if (chainMatch && method === 'GET') {
      const anchorKind = chainMatch[1]!;
      const anchorId = chainMatch[2]!;
      const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
      if (!auth?.startsWith('Bearer ')) {
        return orderError('AUTH_UNAUTHORIZED', 401);
      }
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      return jsonResponse({
        anchor: { kind: anchorKind, id: anchorId },
        nodes: [
          chainNode('CLIENT', 'client-1', 'Cliente HML', anchorKind === 'CLIENT'),
          chainNode('SERVICE_ORDER', MOCK_SERVICE_ORDER_ID, 'OS-2026-DEMO01', anchorKind === 'SERVICE_ORDER'),
          chainNode('MEASUREMENT', 'measurement-1', 'MED-2026-0001', anchorKind === 'MEASUREMENT'),
          chainNode('BILLING_DOCUMENT', 'billing-1', 'FAT-2026-0001', anchorKind === 'BILLING_DOCUMENT'),
          chainNode('RECEIVABLE', 'receivable-1', 'AR-0001', anchorKind === 'RECEIVABLE'),
        ],
        milestones: [],
      });
    }

    if (!pathname.startsWith('/api/v1/service-orders')) {
      return upstream(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return orderError('AUTH_UNAUTHORIZED', 401);
    }

    if (pathname === '/api/v1/service-orders' && method === 'GET') {
      if (!listAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const status = searchParams.get('status');
      const filter = searchParams.get('filter');
      const q = searchParams.get('q');
      let items = [serviceOrderSummary(MOCK_SERVICE_ORDER_ID)];
      if (status === 'active') {
        const activeStatuses = new Set<string>([
          SERVICE_ORDER_STATUSES.Released,
          SERVICE_ORDER_STATUSES.InExecution,
          SERVICE_ORDER_STATUSES.Paused,
        ]);
        items = items.filter((item) => activeStatuses.has(getOrder(item.id).status));
      } else if (status) {
        items = items.filter((item) => getOrder(item.id).status === status);
      }
      if (filter === 'overdue') {
        items = [serviceOrderSummary(MOCK_SERVICE_ORDER_ID)];
      }
      if (q && !items.some((item) => item.orderNumber.includes(q))) {
        items = [];
      }
      return jsonResponse({
        items: items.slice(offset, offset + limit),
        limit,
        offset,
      });
    }

    /*
     * ENDPOINTS META (sessão B5) — antes só existiam no backend; agora o front consome.
     *
     * O mock precisa servi-los porque `ServiceOrderRowActions`, `ServiceOrderDetailPage` e
     * o `SessionMetaProvider` chamam a API real. Sem estas rotas, o `fetch` cairia no
     * `upstream` e devolveria algo inesperado, travando os testes por timeout.
     *
     * A resposta de `available-actions` é DERIVADA do status atual do pedido no mock,
     * reproduzindo a state machine do backend. Isso é dublê de teste, não lógica de
     * produção: o código de front exercitado por estes testes não contém essas regras.
     */
    if (pathname === '/api/v1/service-orders/command-catalog' && method === 'GET') {
      return jsonResponse({ comandos: COMMAND_CATALOG_FIXTURE });
    }

    if (pathname === '/api/v1/me' && method === 'GET') {
      return jsonResponse({
        usuario: { id: 'actor-demo', nome: null, email: null, identity_id: 'actor-demo' },
        permissoes_efetivas: ['service-orders:service-order:read'],
        escopo_ativo: null,
        escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
      });
    }

    const availableActionsMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/available-actions$/,
    );
    if (availableActionsMatch && method === 'GET') {
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const targetId = availableActionsMatch[1]!;
      if (targetId !== MOCK_SERVICE_ORDER_ID && targetId !== PROBE_SERVICE_ORDER_ID) {
        return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
      }
      return jsonResponse(buildAvailableActionsResponse(targetId, getOrder(targetId).status));
    }

    const auditTimelineMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/audit-timeline$/,
    );
    if (auditTimelineMatch && method === 'GET') {
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const targetId = auditTimelineMatch[1]!;
      if (targetId !== MOCK_SERVICE_ORDER_ID && targetId !== PROBE_SERVICE_ORDER_ID) {
        return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
      }
      const limit = Number(searchParams.get('limit') ?? '100');
      const offset = Number(searchParams.get('offset') ?? '0');
      return jsonResponse({
        service_order_id: targetId,
        eventos: AUDIT_TIMELINE_FIXTURE.slice(offset, offset + limit),
        total: AUDIT_TIMELINE_FIXTURE.length,
      });
    }

    const orderMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)$/);
    if (orderMatch && method === 'GET') {
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const orderId = orderMatch[1];
      if (orderId !== MOCK_SERVICE_ORDER_ID && orderId !== PROBE_SERVICE_ORDER_ID) {
        return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
      }
      return jsonResponse(serviceOrderDetail(orderId));
    }

    const plannedListMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)\/planned-resources$/);
    if (plannedListMatch && method === 'GET') {
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      return jsonResponse(planned.filter((item) => item.serviceOrderId === plannedListMatch[1]));
    }

    if (plannedListMatch && method === 'POST') {
      if (!planAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        requirementKind?: string;
        resourceTypeCode?: string;
        laborTypeCode?: string;
        plannedQuantity?: string;
      };
      const created: PlannedResource = {
        id: crypto.randomUUID(),
        serviceOrderId: plannedListMatch[1]!,
        requirementKind: (body.requirementKind as PlannedResource['requirementKind']) ?? 'PHYSICAL_RESOURCE',
        resourceTypeCode: body.resourceTypeCode ?? null,
        laborTypeCode: body.laborTypeCode ?? null,
        plannedQuantity: body.plannedQuantity ?? '1',
        operationalStart: null,
        operationalEnd: null,
        notes: null,
        status: 'ACTIVE',
        rowVersion: 1,
      };
      planned.push(created);
      return jsonResponse(created, 201);
    }

    const plannedItemMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/planned-resources\/([^/]+)(?:\/remove)?$/,
    );
    if (plannedItemMatch && (method === 'PATCH' || method === 'POST')) {
      if (!planAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
    }

    const allocationsListMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)\/allocations$/);
    if (allocationsListMatch && method === 'GET') {
      if (!readAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      return jsonResponse(allocations.filter((item) => item.serviceOrderId === allocationsListMatch[1]));
    }

    if (allocationsListMatch && method === 'POST') {
      if (!allocateAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const body = JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
        plannedResourceId?: string;
        physicalAssetId?: string;
        workforceMemberId?: string;
        operationalStart?: string;
        operationalEnd?: string;
      };
      const plannedResource = planned.find((item) => item.id === body.plannedResourceId);
      const isLabor = plannedResource?.requirementKind === 'LABOR';
      const asset = body.physicalAssetId
        ? planningAssets.find((item) => item.id === body.physicalAssetId)
        : null;
      const person = body.workforceMemberId
        ? people.find((item) => item.id === body.workforceMemberId)
        : null;
      if (isLabor) {
        if (!person) {
          return orderError('SERVICE_ORDERS_WORKFORCE_MEMBER_NOT_FOUND', 404);
        }
        if (person.status !== PERSON_STATUSES.Active) {
          return orderError('SERVICE_ORDERS_WORKFORCE_MEMBER_INACTIVE', 409);
        }
        if (person.defaultLaborTypeCode !== plannedResource?.laborTypeCode) {
          return orderError('SERVICE_ORDERS_WORKFORCE_MEMBER_LABOR_TYPE_MISMATCH', 409);
        }
      } else {
        if (!asset) {
          return orderError('SERVICE_ORDERS_ASSET_NOT_FOUND', 404);
        }
        if (asset.lifecycleStatus !== ASSET_LIFECYCLE_STATUSES.Active) {
          return orderError('SERVICE_ORDERS_ASSET_INACTIVE', 409);
        }
      }
      const interval = parseInterval(body.operationalStart ?? '', body.operationalEnd ?? '');
      const conflict = allocations.some(
        (item) =>
          item.status === 'ACTIVE' &&
          (isLabor
            ? item.workforceMemberId === body.workforceMemberId
            : item.physicalAssetId === body.physicalAssetId) &&
          intervalsOverlap(interval, parseInterval(item.operationalStart, item.operationalEnd)),
      );
      if (conflict) {
        return orderError('SERVICE_ORDERS_ALLOCATION_CONFLICT', 409);
      }
      const created: ResourceAllocation = {
        id: crypto.randomUUID(),
        serviceOrderId: allocationsListMatch[1]!,
        plannedResourceId: body.plannedResourceId ?? null,
        physicalAssetId: body.physicalAssetId ?? null,
        workforceMemberId: body.workforceMemberId ?? null,
        resourceTypeCode: isLabor ? plannedResource?.laborTypeCode ?? 'LABOR' : asset!.resourceTypeCode,
        operationalStart: body.operationalStart!,
        operationalEnd: body.operationalEnd!,
        status: 'ACTIVE',
        rowVersion: 1,
        allocatedAt: new Date().toISOString(),
        removedAt: null,
      };
      allocations.push(created);
      return jsonResponse({ ...created, historyEvents: [] }, 201);
    }

    const allocationRemoveMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/allocations\/([^/]+)\/remove$/,
    );
    if (allocationRemoveMatch && method === 'POST') {
      if (!removeAllocationAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      const allocation = allocations.find((item) => item.id === allocationRemoveMatch[2]);
      if (!allocation) {
        return orderError('SERVICE_ORDERS_ALLOCATION_NOT_FOUND', 404);
      }
      allocation.status = 'REMOVED';
      allocation.removedAt = new Date().toISOString();
      allocation.rowVersion += 1;
      return jsonResponse({ ...allocation, historyEvents: [] });
    }

    const reallocateMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/allocations\/([^/]+)\/reallocate$/,
    );
    if (reallocateMatch && method === 'POST') {
      if (!allocateAllowed) {
        return orderError('SERVICE_ORDERS_DENIED', 403);
      }
      return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
    }

    const lifecycleActionMatch = pathname.match(
      /^\/api\/v1\/service-orders\/([^/]+)\/(prepare|release|cancel|reopen)$/,
    );
    if (lifecycleActionMatch && method === 'POST') {
      return await handleLifecycleAction(lifecycleActionMatch[1]!, lifecycleActionMatch[2]!, init);
    }

    const executionMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)\/execution(\/.*)?$/);
    if (executionMatch) {
      const response = await handleExecutionRoute(
        executionMatch[1]!,
        executionMatch[2] ?? '',
        method,
        init,
      );
      if (response) {
        return response;
      }
    }

    const measurementMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)\/measurements(\/.*)?$/);
    if (measurementMatch) {
      const response = await handleMeasurementRoute(
        measurementMatch[1]!,
        measurementMatch[2] ?? '',
        method,
        init,
      );
      if (response) {
        return response;
      }
    }

    const billingMatch = pathname.match(/^\/api\/v1\/service-orders\/([^/]+)\/billing-records(\/.*)?$/);
    if (billingMatch) {
      const response = await handleBillingRoute(
        billingMatch[1]!,
        billingMatch[2] ?? '',
        method,
        init,
      );
      if (response) {
        return response;
      }
    }

    return upstream(input, init);
  });
}
