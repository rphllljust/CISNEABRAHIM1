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
import type { BillingWorklistItem } from '../billing/types/billing.types';

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

/**
 * Lê um instante ISO opcional de um objeto de mock SEM assumir a forma.
 *
 * O mock não registra o ciclo de vida completo; devolver `null` para o que não foi
 * registrado é o comportamento honesto — inventar um instante faria a tela exibir
 * "iniciada" para uma ordem que o teste nunca iniciou.
 */
function readMockInstant(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') {
    return null;
  }
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
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

/**
 * Construtor de campo do metadata store para o mock.
 *
 * Existe para que o payload acima declare APENAS o que difere do padrão, em vez de repetir 13
 * chaves por campo — o ruído é o que faz um mock divergir do contrato sem ninguém notar.
 */
function metaField(
  name: string,
  label: string,
  type: string,
  overrides: {
    required?: boolean;
    readOnly?: boolean;
    permLevel?: number;
    options?: { options: Array<{ value: string; label: string }> };
    fieldOrder?: number;
    inForm?: boolean;
    inList?: boolean;
    listOrder?: number;
    inFilter?: boolean;
    inSearch?: boolean;
  } = {},
): Record<string, unknown> {
  return {
    name,
    label,
    type,
    required: overrides.required ?? false,
    readOnly: overrides.readOnly ?? false,
    permLevel: overrides.permLevel ?? 0,
    options: overrides.options ?? null,
    fieldOrder: overrides.fieldOrder ?? 0,
    inForm: overrides.inForm ?? false,
    inList: overrides.inList ?? false,
    listOrder: overrides.listOrder ?? 0,
    inFilter: overrides.inFilter ?? false,
    inSearch: overrides.inSearch ?? false,
  };
}

/** Transição de workflow para o mock — `allowed` é resolvido pelo ator no servidor real. */
function metaTransition(
  command: string,
  label: string,
  fromStates: string[],
  toState: string,
  buttonOrder: number,
): Record<string, unknown> {
  return {
    command,
    label,
    fromStates,
    toState,
    permission: `service-orders:service-order:${command}`,
    requiresReason: false,
    buttonOrder,
    allowed: true,
  };
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

  /**
   * WORKBENCH DA MEDIÇÃO — O MOCK REPRESENTA O BACKEND AUTORITATIVO.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * POR QUE ESTE BUILDER EXISTE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * A tela de conferência passou a ler `availableCommands` do backend em vez de
   * compor permissão com status. Sem esta rota, o `fetch` cairia no `upstream` e
   * a página ficaria sem decisão — correto quando o backend não responde, mas
   * inútil para o teste.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * A DECISÃO É DERIVADA DO ESTADO, AQUI, PORQUE ESTE MOCK É O BACKEND
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * É legítimo que o MOCK aplique a regra: ele representa o servidor, e é o
   * servidor quem decide. O que o teste prova é que a TELA obedece a essa
   * decisão — se a tela recalculasse por conta própria, a asserção de botão
   * habilitado/desabilitado falharia.
   */
  function buildMeasurementWorkbench(
    orderId: string,
    opts: ServiceOrdersFetchMockOptions,
  ) {
    const order = getOrder(orderId);
    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * O ESTADO ATUAL, NÃO O SEED INICIAL
     * ─────────────────────────────────────────────────────────────────────────────
     *
     * O workbench é uma LEITURA do estado vigente. Ler `opts.seedMeasurement`
     * devolveria o estado INICIAL para sempre — e um fluxo que submete e espera
     * "iniciar análise" nunca veria a transição, porque o read model continuaria
     * respondendo DRAFT.
     *
     * O store `measurements` é a fonte viva que este mock já mantém para os
     * comandos. Ler dele é o que faz o read model refletir o MESMO estado que o
     * comando produziu — exatamente como no backend real, onde o read model é
     * reconstruído depois do commit.
     */
    const liveMeasurement: MockMeasurement | undefined = measurements.get(orderId);
    const status = liveMeasurement?.status ?? 'DRAFT';
    const hasMeasurement = liveMeasurement !== undefined || opts.seedMeasurement !== undefined;
    /**
     * A VARIÁVEL RESOLVIDA DO ESCOPO, NÃO O CAMPO CRU DA OPÇÃO.
     *
     * `measurementAllowed` já foi normalizado para `true` quando a opção é
     * omitida (linha ~312). Ler `opts.measurementAllowed` devolveria `undefined`
     * e desabilitaria TODOS os comandos por `NOT_AUTHORIZED` — o teste mediria
     * falta de permissão onde a intenção era medir o estado.
     */
    const measurementPermitted = measurementAllowed;
    const divergent = opts.seedMeasurement === 'draft-divergent';
    const items = buildMeasurementItems(orderId, divergent);
    const total = items.reduce((sum, item) => sum + Number(item.lineAmount ?? 0), 0);

    /**
     * Um comando com a decisão já tomada — como o BACKEND a publica.
     *
     * A autorização é tratada como um motivo a mais: sem permissão, o comando
     * fica desabilitado com `NOT_AUTHORIZED`, nunca oculto.
     */
    const command = (
      code: string,
      label: string,
      enabled: boolean,
      blockingReasons: string[] = [],
      reasonLabels: string[] = [],
      nextAction: string | null = null,
    ) => {
      const authorised = measurementPermitted;
      if (!authorised) {
        return {
          code,
          label,
          enabled: false,
          blockingReasons: ['NOT_AUTHORIZED'],
          reasonLabels: ['Sem permissão para este comando.'],
          nextAction: null,
          requiredPermission: `measurements:measurement:${code.toLowerCase()}`,
        };
      }
      return enabled
        ? {
            code,
            label,
            enabled: true,
            blockingReasons: [],
            reasonLabels: [],
            nextAction: null,
            requiredPermission: `measurements:measurement:${code.toLowerCase()}`,
          }
        : {
            code,
            label,
            enabled: false,
            blockingReasons,
            reasonLabels,
            nextAction,
            requiredPermission: `measurements:measurement:${code.toLowerCase()}`,
          };
    };

    const varianceRequiringDecision = divergent;
    const approvalBlockers = varianceRequiringDecision
      ? ['VARIANCE_REQUIRES_AUTHORIZATION']
      : [];

    const availableCommands = [
      command('CREATE_MEASUREMENT', 'Gerar medição', false, ['ALREADY_RECORDED'], ['Esta ordem já possui medição.']),
      command('REGENERATE_MEASUREMENT', 'Regerar itens', status === 'DRAFT'),
      command('AUTHORIZE_ADJUSTMENT', 'Autorizar ajuste', status === 'DRAFT' && varianceRequiringDecision),
      command('SUBMIT', 'Submeter medição', status === 'DRAFT' && !varianceRequiringDecision, varianceRequiringDecision ? ['VARIANCE_REQUIRES_AUTHORIZATION'] : [], varianceRequiringDecision ? ['Existe variação acima da tolerância sem decisão registrada.'] : [], varianceRequiringDecision ? 'AUTHORIZE_ADJUSTMENT' : null),
      command('START_REVIEW', 'Iniciar análise', status === 'SUBMITTED'),
      command(
        'APPROVE',
        'Aprovar medição',
        status === 'UNDER_REVIEW' && approvalBlockers.length === 0,
        approvalBlockers,
        approvalBlockers.length > 0
          ? ['Existe variação acima da tolerância sem decisão registrada.']
          : [],
        approvalBlockers.length > 0 ? 'AUTHORIZE_ADJUSTMENT' : null,
      ),
      command('REJECT', 'Rejeitar medição', status === 'UNDER_REVIEW'),
      command('RESUBMIT', 'Reenviar medição', status === 'REJECTED'),
    ];

    const nextActionCode = (() => {
      if (availableCommands.find((item) => item.code === 'AUTHORIZE_ADJUSTMENT')?.enabled) {
        return 'AUTHORIZE_ADJUSTMENT';
      }
      for (const code of ['CREATE_MEASUREMENT', 'RESUBMIT', 'SUBMIT', 'START_REVIEW', 'APPROVE']) {
        if (availableCommands.find((item) => item.code === code)?.enabled) {
          return code;
        }
      }
      return null;
    })();

    const nextActionLabel =
      availableCommands.find((item) => item.code === nextActionCode)?.label ?? null;

    return {
      identity: {
        measurementId: opts.seedMeasurement ? MOCK_MEASUREMENT_ID : null,
        number: opts.seedMeasurement ? `${order.orderNumber}-M1` : null,
        serviceOrderId: orderId,
        orderNumber: order.orderNumber,
        rowVersion: liveMeasurement?.rowVersion ?? 1,
      },
      businessContext: {
        company: 'CISNE',
        unit: order.unitId ?? 'CISNE-RO-PVH',
        customer: order.clientSnapshot?.tradeName ?? null,
        customerId: order.clientId ?? null,
        /**
         * `MockOrder` NÃO modela contrato comercial.
         *
         * Inventar uma referência aqui faria o read model afirmar um vínculo que
         * o mock não tem — e o teste passaria a exercitar um cenário que não
         * existe. `null` é a leitura honesta: "esta ordem sintética não declara
         * contrato".
         */
        contract: null,
        purchaseOrder: null,
        responsible: null,
      },
      statuses: {
        execution: 'CLOSED',
        measurement: hasMeasurement ? status : 'NOT_CREATED',
        acceptance: 'NOT_REQUIRED',
        billingEligibility: status === 'APPROVED' ? 'READY' : 'BLOCKED',
        billing: 'NOT_PREPARED',
        accounting: 'NOT_APPLICABLE',
      },
      processContext: {
        milestones: [
          { stage: 'EXECUTION', label: 'Execução', state: 'COMPLETED', reachedAt: null },
          { stage: 'MEASUREMENT', label: 'Medição', state: 'CURRENT', reachedAt: null },
          { stage: 'BILLING', label: 'Faturamento', state: 'FUTURE', reachedAt: null },
        ],
        completedMilestones: ['EXECUTION'],
        pendingMilestones: ['MEASUREMENT', 'BILLING'],
        health: {
          currentStage: 'MEASUREMENT',
          currentStageLabel: 'Medição',
          elapsedSeconds: 219_600,
          targetSeconds: 691_200,
          forecastSecondsRemaining: null,
          risk: 'MEDIUM',
          riskReason: 'Condição interna a resolver.',
          ownerRole: 'OPERACOES',
          blockingReason: null,
          nextMilestone: null,
        },
        nextMilestone: nextActionLabel,
      },
      measurementBasis: {
        basisId: 'basis-mock',
        executionClosureId: 'closure-mock',
        preparedAt: '2026-10-14T19:00:00.000Z',
        lineCount: 1,
        lines: [],
      },
      quantities: {
        lines: items.map((item) => ({
          dimensionKey: item.unitCode,
          label: item.unitCode,
          unitOfMeasure: item.unitCode,
          planned: item.actualQuantity,
          actual: item.actualQuantity,
          measured: item.measuredQuantity,
        })),
        totals: { planned: 0, actual: 0, measured: 0 },
      },
      economics: {
        grossValue: total > 0 ? total.toFixed(4) : null,
        currency: 'BRL',
        financialVariance: null,
        revenueExposure: total > 0 ? total.toFixed(4) : null,
      },
      commercialContext: {
        pricing: { source: 'SERVICE_CATALOG', lineCount: items.length, currencyCode: 'BRL' },
        paymentTerms: null,
        tolerance: { percentage: 5, source: 'DEFAULT' },
        purchaseOrderRequirement: null,
        billingPolicy: 'MEASUREMENT_APPROVED',
      },
      variances: divergent
        ? [
            {
              dimension: 'QUANTITY',
              dimensionKey: items[0]?.unitCode ?? 'SERVICE',
              measurementItemId: items[0]?.id ?? null,
              plannedValue: items[0]?.actualQuantity ?? null,
              actualValue: items[0]?.actualQuantity ?? null,
              measuredValue: items[0]?.measuredQuantity ?? null,
              unitOfMeasure: items[0]?.unitCode ?? 'SERVICE',
              absoluteDelta: '10',
              percentageDelta: 50,
              tolerancePercentage: 5,
              toleranceSource: 'DEFAULT',
              severity: 'HIGH',
              financialImpact: null,
              currencyCode: 'BRL',
              requiresDecision: true,
              decisionKind: 'AUTHORIZE_ADJUSTMENT',
              blockingReason: 'VARIANCE_REQUIRES_AUTHORIZATION',
              recommendedResolution: 'AUTHORIZE_ADJUSTMENT',
              explanation: 'Quantidade medido acima do planejado.',
            },
          ]
        : [],
      varianceSummary: {
        highestSeverity: divergent ? 'HIGH' : 'NONE',
        decisionRequiredCount: divergent ? 1 : 0,
        approvalClearable: !divergent,
        summary: divergent
          ? '1 divergência exige decisão.'
          : 'Nenhuma divergência entre planejado, realizado e medido.',
      },
      adjustments: [],
      items: items.map((item) => ({
        id: item.id,
        lineNumber: item.lineNumber,
        unitCode: item.unitCode,
        plannedQuantity: item.actualQuantity,
        actualQuantity: item.actualQuantity,
        measuredQuantity: item.measuredQuantity,
        unitPrice: item.unitPrice,
        lineAmount: item.lineAmount,
        origin: 'BASIS',
        sourceBasisLineKey: item.unitCode,
      })),
      evidence: [],
      acceptance: {
        policy: 'NOT_REQUIRED',
        policySource: 'DEFAULT',
        policyReason: 'Nenhuma fonte comercial declarou exigência de aceite.',
        required: false,
        state: 'NOT_REQUIRED',
        blocksBilling: false,
        blockingReason: null,
        latest: null,
        history: [],
        nextActionCode: null,
        nextActionLabel: null,
      },
      billingEligibility: {
        result: status === 'APPROVED' ? 'READY' : 'BLOCKED',
        dimensions: [
          {
            dimension: 'MEASUREMENT_APPROVED',
            label: 'Medição aprovada',
            status: status === 'APPROVED' ? 'SATISFIED' : 'BLOCKED',
            statusLabel: status === 'APPROVED' ? 'Atendido' : 'Bloqueado',
            reasonCode: status === 'APPROVED' ? null : 'MEASUREMENT_NOT_APPROVED',
            detail:
              status === 'APPROVED'
                ? 'A medição está aprovada.'
                : `A medição está em ${status}.`,
            nextActionCode: status === 'APPROVED' ? null : 'APPROVE_MEASUREMENT',
            nextActionLabel: status === 'APPROVED' ? null : 'Concluir a aprovação da medição',
            blocking: status !== 'APPROVED',
          },
        ],
        blockingReasons: status === 'APPROVED' ? [] : ['MEASUREMENT_NOT_APPROVED'],
        nextAction:
          status === 'APPROVED'
            ? null
            : { code: 'APPROVE_MEASUREMENT', label: 'Concluir a aprovação da medição' },
        totalAmount: total > 0 ? total.toFixed(4) : null,
        currencyCode: 'BRL',
        summary: status === 'APPROVED' ? 'Pronto para faturar.' : 'Faturamento bloqueado.',
        explanation:
          status === 'APPROVED'
            ? 'A medição aprovada libera o faturamento.'
            : 'O faturamento exige a medição aprovada.',
      },
      situations: [],
      relationships: [],
      documentFlow: [],
      timeline: [],
      nextAction: nextActionCode
        ? { code: nextActionCode, label: nextActionLabel, explanation: null }
        : null,
      availableCommands,
      decisionExplanation: {
        measurement: 'Resumo',
        approval: 'Decisão do backend',
        acceptance: 'Política do backend',
        billing: 'Elegibilidade do backend',
        onBilling: 'Consome a medição',
      },
      freshness: { readAt: new Date().toISOString(), authority: 'SERVER' },
    };
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

    /*
     * METADATA STORE — servido pelo mock porque a lista e o detalhe de OS passaram a ser
     * RENDERIZADOS PELA ENGINE. Sem esta rota, `MetadataProvider` não monta e a tela não
     * desenha nada: o mock deixaria de representar a aplicação real.
     *
     * O payload espelha o contrato de `GET /api/v1/meta/:entity` (apps/api/src/meta):
     * campos já filtrados por `allowedPermLevels`, views com `layout` e workflow com
     * `allowed` por transição. É uma CÓPIA do formato, não uma segunda fonte de verdade de
     * negócio — o seed canônico continua em `packages/database/migrations/0085`.
     */
    if (pathname === '/api/v1/meta/service-orders' && method === 'GET') {
      return jsonResponse({
        name: 'service-orders',
        label: 'Ordem de serviço',
        description: null,
        dataSchema: 'so',
        dataTable: 'service_orders',
        labelField: 'order_number',
        fields: [
          metaField('order_number', 'Número da OS', 'data', { inList: true, listOrder: 1 }),
          metaField('internal_code', 'Código interno', 'data', { inList: true, listOrder: 2 }),
          metaField('status', 'Situação', 'select', {
            inList: true,
            listOrder: 3,
            inFilter: true,
            options: {
              options: [
                { value: 'DRAFT', label: 'Rascunho' },
                { value: 'PREPARED', label: 'Preparada' },
                { value: 'RELEASED', label: 'Liberada' },
                { value: 'IN_EXECUTION', label: 'Em execução' },
                { value: 'PAUSED', label: 'Pausada' },
                { value: 'COMPLETED', label: 'Concluída' },
                { value: 'CANCELLED', label: 'Cancelada' },
              ],
            },
          }),
          metaField('unit_id', 'Unidade', 'link', { inForm: true, inList: true, listOrder: 4 }),
          metaField('origin', 'Origem', 'select', {
            inForm: true,
            inList: true,
            listOrder: 5,
            options: {
              options: [
                { value: 'SERVICE_REQUEST', label: 'Solicitação' },
                { value: 'PROPOSAL', label: 'Proposta' },
                { value: 'PURCHASE_ORDER', label: 'Pedido de compra' },
                { value: 'AUTHORIZED_DIRECT', label: 'Autorizada direta' },
              ],
            },
          }),
          metaField('description', 'Descrição', 'text', { inForm: true, fieldOrder: 6 }),
          metaField('priority', 'Prioridade', 'data', { inForm: true, fieldOrder: 7 }),
          metaField('row_version', 'Versão', 'integer', { readOnly: true, fieldOrder: 8 }),
          metaField('created_at', 'Criada em', 'datetime', {
            readOnly: true,
            inList: true,
            listOrder: 6,
            fieldOrder: 9,
          }),
          metaField('contract_reference', 'Contrato', 'data', { inForm: true, fieldOrder: 10 }),
          metaField('client_snapshot', 'Cliente', 'text', {
            readOnly: true,
            permLevel: 1,
            inForm: true,
            fieldOrder: 11,
          }),
        ],
        views: [
          {
            viewType: 'form',
            label: 'Formulário de ordem de serviço',
            layout: {
              sections: [
                {
                  title: 'Identificação',
                  fields: ['order_number', 'internal_code', 'status', 'origin'],
                },
                {
                  title: 'Execução',
                  fields: ['unit_id', 'description', 'priority', 'contract_reference'],
                },
                { title: 'Auditoria', fields: ['row_version', 'created_at', 'client_snapshot'] },
              ],
            },
            isDefault: true,
          },
          {
            viewType: 'list',
            label: 'Lista de ordens de serviço',
            layout: {
              columns: ['order_number', 'internal_code', 'status', 'unit_id', 'origin', 'created_at'],
            },
            isDefault: true,
          },
          {
            viewType: 'kanban',
            label: 'Kanban de ordens de serviço',
            layout: { groupBy: 'status', cardFields: ['order_number', 'unit_id', 'created_at'] },
            isDefault: true,
          },
        ],
        workflow: {
          stateField: 'status',
          states: [
            'DRAFT',
            'PREPARED',
            'RELEASED',
            'IN_EXECUTION',
            'PAUSED',
            'COMPLETED',
            'CANCELLED',
          ],
          transitions: [
            metaTransition('prepare', 'Preparar', ['DRAFT'], 'PREPARED', 1),
            metaTransition('release', 'Liberar', ['PREPARED'], 'RELEASED', 2),
            metaTransition('cancel', 'Cancelar', ['DRAFT', 'PREPARED', 'RELEASED'], 'CANCELLED', 3),
            metaTransition('start', 'Iniciar execução', ['RELEASED'], 'IN_EXECUTION', 4),
            metaTransition('pause', 'Pausar', ['IN_EXECUTION'], 'PAUSED', 5),
            metaTransition('resume', 'Retomar', ['PAUSED'], 'IN_EXECUTION', 6),
            metaTransition('complete', 'Concluir', ['IN_EXECUTION'], 'COMPLETED', 7),
          ],
        },
        permissions: [
          { action: 'read', permLevel: 0, requiredPermission: null, allowed: true },
        ],
        // `client_snapshot` é permLevel 1; o ator do mock não tem a permissão de custo, então
        // o nível 1 fica FORA — exatamente como o servidor faria (fail-closed).
        allowedPermLevels: [0],
      });
    }

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

    /*
      SESSAO — precisa vir ANTES do filtro de rotas de OS abaixo.

      O `AuthProvider` só sai de `loading` quando `/auth/session` responde; sem essa resposta ele
      nunca fica `authenticated`, o `SessionMetaBridge` não hidrata `/me`, `session.can()` responde
      sempre `false` e TODA action protegida por capability desaparece da tela — o teste falha por
      FIXTURE, não por defeito de produto.

      A posição importa: mais abaixo existe um `return upstream(...)` que desvia para a rede tudo
      que não é `/service-orders`, e o teste não tem rede. Estas duas rotas de sessão pertencem ao
      escopo do dublê porque são a fonte das capabilities que a tela de OS projeta.
    */
    if (pathname === '/api/v1/auth/session' && method === 'GET') {
      return jsonResponse({
        identityId: 'actor-demo',
        session: { id: 'sid', expiresAt: '2026-12-31T00:00:00.000Z', status: 'ACTIVE' },
      });
    }

    if (pathname === '/api/v1/me' && method === 'GET') {
      /*
        GRANTS EFETIVOS DA SESSAO — a fonte autoritativa das capabilities de UI.

        As telas de OS deixaram de sondar o backend com POST/PATCH para descobrir permissão; hoje
        projetam `can()` a partir daqui (SessionMetaProvider). Por isso este dublê declara os grants
        que cada fluxo testado exercita — antes bastava a permissão de leitura, porque a sonda
        respondia pelo status HTTP.

        `usuario_tem_permissao` da `available-actions` continua vindo do backend (state machine);
        aqui declaramos apenas os grants DA SESSÃO.
      */
      return jsonResponse({
        usuario: { id: 'actor-demo', nome: null, email: null, identity_id: 'actor-demo' },
        permissoes_efetivas: [
          'service-orders:service-order:read',
          'service-orders:service-order:list',
          'service-orders:service-order:create',
          'service-orders:service-order:prepare',
          'service-orders:service-order:release',
          'service-orders:service-order:cancel',
          'service-orders:service-order:reopen',
          'service-orders:service-order:update',
          'service-orders:planned-resource:read',
          'service-orders:planned-resource:plan',
          'service-orders:planned-resource:update',
          'service-orders:planned-resource:remove',
          'service-orders:resource-allocation:read',
          'service-orders:resource-allocation:allocate',
          'service-orders:resource-allocation:reallocate',
          'service-orders:resource-allocation:remove',
          'service-orders:execution:read',
          'service-orders:execution:start',
          'service-orders:execution:pause',
          'service-orders:execution:resume',
          'service-orders:execution:complete',
          'service-orders:execution:record',
          'service-orders:operational-cost:read',
          'service-orders:operational-cost:record',
          'measurements:measurement:read',
          'measurements:measurement:create',
          'measurements:measurement:update',
          'measurements:measurement:submit',
          'measurements:measurement:review',
          'measurements:measurement:approve',
          'measurements:measurement:reject',
          /*
            BILLING — espelha as flags DESTE dublê, que já são de faturamento.

            O mock responde `/api/v1/billing/worklist`, aceita `BillingSeedKind` e declara
            `billingAllowed`/`billingReadAllowed`/`billingDocumentAllowed` com default `true`. As
            telas projetam capability de `/me`; servir billing sem publicar o grant correspondente
            publica uma sessão incompleta do próprio contrato — a tela nega por falta de declaração,
            não por defeito. Cada grant abaixo é condicionado à MESMA flag que o handler já honra,
            então desligá-la continua produzindo negação real.
          */
          ...(billingReadAllowed !== false
            ? ['billing:billing-record:read', 'billing:billing-document:read']
            : []),
          ...(billingAllowed !== false
            ? ['billing:billing-record:prepare', 'billing:billing-record:void']
            : []),
          ...(billingDocumentAllowed !== false
            ? ['billing:billing-document:issue', 'billing:billing-document:download']
            : []),
        ],
        escopo_ativo: null,
        escopos_disponiveis: [{ tipo: 'GLOBAL', resource_id: null, label: 'Global' }],
      });
    }

    if (!pathname.startsWith('/api/v1/service-orders') && pathname !== '/api/v1/billing/worklist' && !pathname.startsWith('/api/v1/query/')) {
      return upstream(input, init);
    }

    const auth = init?.headers ? new Headers(init.headers).get('authorization') : null;
    if (!auth?.startsWith('Bearer ')) {
      return orderError('AUTH_UNAUTHORIZED', 401);
    }

    /**
     * OVERVIEW DE OPERAÇÕES — o read model que carrega o GATE DE CONCLUSÃO.
     *
     * A tela de execução passou a ler `completionGate.canComplete` do backend em
     * vez de calcular a conclusão a partir das evidências. Este mock responde o
     * contrato REAL do endpoint, para que o teste e2e exercite o caminho de
     * produção: sem esta rota, a tela não teria decisão alguma e a conclusão
     * ficaria indisponível — que é o comportamento correto quando o backend não
     * responde, mas não o que este teste quer provar.
     *
     * O gate é derivado das MESMAS condições que o teste controla (evidência
     * registrada), para que a asserção continue significando o mesmo.
     */
    /**
     * ───────────────────────────────────────────────────────────────────────────
     * WORKBENCH DA MEDIÇÃO — a SUPERFÍCIE DE COMANDOS que a tela lê.
     * ───────────────────────────────────────────────────────────────────────────
     *
     * A página de conferência deixou de decidir habilitação de comando em React:
     * ela lê `availableCommands` deste contrato. Sem esta rota, o fetch cairia no
     * `upstream` e a tela ficaria sem decisão — o comportamento CORRETO quando o
     * backend não responde, mas não o que este teste precisa exercitar.
     *
     * As decisões são derivadas do ESTADO que o próprio mock controla
     * (`seedMeasurement`), e não de uma regra nova: o mock aqui representa o
     * BACKEND, e é ele quem decide.
     */
    const workbenchMatch = pathname.match(
      /^\/api\/v1\/query\/measurements\/([^/]+)\/workbench$/,
    );
    if (workbenchMatch && method === 'GET') {
      const targetId = workbenchMatch[1]!;
      const order = getOrder(targetId);
      if (!order) {
        return orderError('MEASUREMENTS_NOT_FOUND', 404);
      }
      return jsonResponse(buildMeasurementWorkbench(targetId, options), 200);
    }

    const overviewMatch = pathname.match(
      /^\/api\/v1\/query\/service-orders\/([^/]+)\/overview$/,
    );
    if (overviewMatch && method === 'GET') {
      const targetId = overviewMatch[1]!;
      const order = getOrder(targetId);
      if (!order) {
        return orderError('SERVICE_ORDERS_NOT_FOUND', 404);
      }
      const orderEntries = entries.get(targetId) ?? [];
      const hasObservation = orderEntries.some(
        (entry: { entryType: string }) => entry.entryType === 'OBSERVATION',
      );
      const hasQuantity = orderEntries.some(
        (entry: { entryType: string }) => entry.entryType === 'QUANTITY',
      );
      const canComplete = hasObservation && hasQuantity;

      return jsonResponse({
        identity: {
          serviceOrderId: order.id,
          orderNumber: order.orderNumber,
          internalCode: order.internalCode ?? null,
          serviceLabel: order.serviceSnapshot?.serviceName ?? null,
          clientLabel: order.clientSnapshot?.tradeName ?? null,
          unitId: order.unitId,
          description: order.description ?? null,
          rowVersion: order.rowVersion,
        },
        businessContext: {
          origin: order.origin ?? null,
          contractReference: null,
          customerPurchaseOrderNumber: null,
          priority: null,
        },
        statuses: {
          operational: order.status,
          planning: 'CONFIRMED',
          reservation: 'CONFIRMED',
          dispatch: 'DISPATCHED',
          execution: order.status === 'PAUSED' ? 'PAUSED' : 'IN_PROGRESS',
          actuals: orderEntries.length ? 'PARTIAL' : 'NONE',
          measurement: 'NOT_READY',
          billing: 'NOT_ELIGIBLE',
          accounting: 'NOT_APPLICABLE',
        },
        process: [],
        currentStage: 'IN_EXECUTION',
        planning: { plannedResourceCount: 2, activeAllocationCount: 2, activeResources: [] },
        dispatch: {
          dispatchedAt: '2026-10-24T08:00:00.000Z',
          checkedInAt: '2026-10-24T08:10:00.000Z',
          windowStart: '2026-10-24T08:00:00.000Z',
          windowEnd: '2026-10-24T20:00:00.000Z',
          readiness: {
            ready: true,
            status: 'READY',
            blockingReasons: [],
            warnings: [],
            dimensions: [],
            nextAction: null,
            summary: 'Pronto para despachar.',
          },
        },
        execution: {
          /**
           * `MockOrder` não declara os instantes de ciclo; eles são opcionais no
           * contrato real. Lê-se via índice com fallback nulo para não afirmar um
           * instante que o mock nunca registrou — a diferença importa porque o
           * gate distingue "não iniciada" de "iniciada".
           */
          startedAt: readMockInstant(order, 'startedAt'),
          pausedAt: readMockInstant(order, 'pausedAt'),
          completedAt: readMockInstant(order, 'completedAt'),
          executionClosedAt: null,
          measurementBasisPreparedAt: null,
        },
        actuals: {
          comparison: { lines: [], substitutions: [], recordCount: 0, hasActuals: false, summary: '' },
          records: [],
          meters: [],
          fuel: [],
          evidence: [],
          signatures: [],
        },
        completionGate: {
          canComplete,
          blockingReasons: canComplete
            ? []
            : [
                {
                  reasonCode: 'REQUIRED_EVIDENCE_MISSING',
                  reason: 'Uma evidência exigida pelo serviço não foi anexada.',
                  resource: null,
                  missingCode: 'OBSERVATION',
                  resolution: 'ATTACH_EVIDENCE',
                  resolutionLabel: 'Anexar a evidência',
                },
              ],
          nextAction: canComplete ? null : 'ATTACH_EVIDENCE',
          nextActionLabel: canComplete ? null : 'Anexar a evidência',
          consequences: [
            { code: 'ACTUALS_FROZEN', label: 'Os dados reais de execução serão congelados.' },
          ],
          summary: canComplete
            ? 'Pronto para concluir: todos os requisitos de execução estão atendidos.'
            : 'Conclusão bloqueada.',
        },
        economics: { plannedRevenue: null, plannedCost: null, currencyCode: null },
        situations: [],
        timeline: [],
        nextAction: {
          code: canComplete ? 'COMPLETE' : 'ATTACH_EVIDENCE',
          label: canComplete ? 'Concluir' : 'Anexar a evidência',
          explanation: null,
        },
        availableCommands: [],
        decisionExplanation: {
          completionSummary: canComplete ? 'Pronto para concluir.' : 'Conclusão bloqueada.',
          onCompletion: [],
          dispatchSummary: 'Pronto para despachar.',
        },
        freshness: { readAt: new Date().toISOString(), authority: 'SERVER' },
      });
    }

    if (pathname === '/api/v1/billing/worklist' && method === 'GET') {
      if (!billingReadAllowed) return orderError('BILLING_DENIED', 403);
      const limit = Number(searchParams.get('limit') ?? '20');
      const offset = Number(searchParams.get('offset') ?? '0');
      const requestedBucket = searchParams.get('bucket');
      const q = (searchParams.get('q') ?? '').toLowerCase();
      const order = getOrder(MOCK_SERVICE_ORDER_ID);
      const measurement = measurements.get(MOCK_SERVICE_ORDER_ID);
      const billing = billings.get(MOCK_SERVICE_ORDER_ID);
      const bucket = billing?.status === 'PREPARED'
        ? (options.billingTermsMismatch ? 'terms_divergence' : 'prepared')
        : measurement?.status === 'APPROVED' ? 'ready' : 'measurement_pending';
      const labelSnapshot = order.clientSnapshot?.tradeName ?? order.clientSnapshot?.legalName;
      const clientLabel = typeof labelSnapshot === 'string' ? labelSnapshot : 'Cliente Demo LTDA';
      let rows: BillingWorklistItem[] = options.orderCompleted === true ? [{
        serviceOrderId: order.id,
        orderNumber: order.orderNumber,
        clientLabel,
        origin: order.origin,
        serviceOrderStatus: order.status,
        serviceOrderVersion: order.rowVersion,
        completedAt: order.status === SERVICE_ORDER_STATUSES.Completed ? order.updatedAt : null,
        measurementId: measurement?.id ?? null,
        measurementStatus: measurement?.status ?? null,
        measurementVersion: measurement?.rowVersion ?? null,
        billingRecordId: billing?.id ?? null,
        billingStatus: billing?.status ?? null,
        billingVersion: billing?.rowVersion ?? null,
        amount: billing?.totalAmount ?? (measurement?.status === 'APPROVED' ? '1000.0000' : null),
        currencyCode: billing?.currencyCode ?? (measurement ? 'BRL' : null),
        bucket,
        exceptionCode: options.billingTermsMismatch ? 'COMMERCIAL_TERMS_DIVERGE' : null,
        exceptionDetail: options.billingTermsMismatch ? 'Condição informada diverge da condição comercial de origem.' : null,
        authoritativeTerms: options.purchaseOrderPaymentTerms ?? null,
        declaredTerms: billing?.paymentTerms ?? null,
        billingDocumentId: null,
        billingDocumentNumber: null,
        billingDocumentStatus: null,
        billingDocumentIssuedAt: null,
        receivableId: null,
        updatedAt: order.updatedAt,
        nextAction: bucket === 'ready' ? 'prepare_billing' : bucket === 'prepared' ? 'issue_internal_document' : 'complete_measurement',
      }] : [];
      if (q && !`${rows[0]?.orderNumber ?? ''} ${rows[0]?.clientLabel ?? ''}`.toLowerCase().includes(q)) rows = [];
      if (requestedBucket) rows = rows.filter((row) => row.bucket === requestedBucket);
      const page = rows.slice(offset, offset + limit);
      const counts = {
        cancelled_document: 0,
        document_state_unknown: 0,
        terms_divergence: bucket === 'terms_divergence' && options.orderCompleted ? 1 : 0,
        measurement_pending: bucket === 'measurement_pending' && options.orderCompleted ? 1 : 0,
        ready: bucket === 'ready' && options.orderCompleted ? 1 : 0,
        prepared: bucket === 'prepared' && options.orderCompleted ? 1 : 0,
        issued: 0,
      };
      return jsonResponse({
        items: page,
        total: rows.length,
        page: {
          count: page.length,
          limit,
          offset,
          totalPages: Math.ceil(rows.length / limit),
          hasMore: offset + page.length < rows.length,
        },
        summary: {
          total: rows.length,
          counts,
          amountsByCurrency: rows[0]?.currencyCode ? [{ currencyCode: rows[0].currencyCode, knownAmount: rows[0].amount, knownAmountCount: rows[0].amount ? 1 : 0, unknownAmountCount: rows[0].amount ? 0 : 1 }] : [],
        },
      });
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
