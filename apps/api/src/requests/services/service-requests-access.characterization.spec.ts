import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import type { ServiceRequestRow } from '../repositories/service-requests.repository.types';
import { ServiceRequestsAccessAudit } from './service-requests-access.audit';
import { ServiceRequestsAccessCommands } from './service-requests-access.commands';
import { ServiceRequestsAccessIdempotency } from './service-requests-access.idempotency';
import { ServiceRequestsAccessPersistence } from './service-requests-access.persistence';
import { ServiceRequestsAccessQuery } from './service-requests-access.query';
import { ServiceRequestsAccessService } from './service-requests-access.service';
import { ServiceRequestsAccessValidation } from './service-requests-access.validation';

const ACTOR: IdentityAuthzContext = {
  identityId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  sessionId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
};

function buildRow(overrides: Partial<ServiceRequestRow> = {}): ServiceRequestRow {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    request_code: 'SR-2026-TEST01',
    unit_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    status: 'DRAFT',
    origin_source: 'PHONE',
    external_contact: {},
    external_origin_reference: null,
    client_id: null,
    service_definition_id: null,
    service_definition_version_id: null,
    description: null,
    location: {},
    desired_start_at: null,
    desired_end_at: null,
    priority: null,
    operational_notes: null,
    proposal_id: null,
    purchase_order_id: null,
    submitted_at: null,
    submitted_by_identity_id: null,
    review_started_at: null,
    review_started_by_identity_id: null,
    approved_at: null,
    approved_by_identity_id: null,
    rejected_at: null,
    rejected_by_identity_id: null,
    rejection_reason: null,
    cancelled_at: null,
    cancelled_by_identity_id: null,
    cancellation_reason: null,
    converted_at: null,
    converted_by_identity_id: null,
    converted_service_order_id: null,
    idempotency_key: 'idem-key-1',
    row_version: 1,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    created_by_identity_id: ACTOR.identityId,
    updated_by_identity_id: ACTOR.identityId,
    ...overrides,
  };
}

describe('ServiceRequestsAccessService characterization (orchestration)', () => {
  const repository = {
    findByIdempotencyKey: vi.fn(),
    listDocumentLinks: vi.fn(),
    listHistoryEvents: vi.fn(),
    findLinkedChain: vi.fn(),
    listClientLabels: vi.fn(),
    listServiceLabels: vi.fn(),
    listOperationalUnits: vi.fn(),
    isUnitRegistered: vi.fn(),
    create: vi.fn(),
    isIdempotencyViolation: vi.fn(),
    findById: vi.fn(),
    transition: vi.fn(),
    listServiceRequests: vi.fn(),
    countListSummary: vi.fn(),
  };
  const authz = {
    assertRecordAction: vi.fn(),
    assertCreateAction: vi.fn(),
    assertListAction: vi.fn(),
    canPerformRecordAction: vi.fn(),
    findListGrants: vi.fn(),
    filterAuthorizedClientIds: vi.fn(),
    filterAuthorizedLinkedChain: vi.fn(),
    canReadCatalogService: vi.fn(),
  };
  const referenceValidation = {
    assertActiveClient: vi.fn(),
    assertServiceDefinition: vi.fn(),
    assertProposalReference: vi.fn(),
    assertPurchaseOrderReference: vi.fn(),
  };
  const scopeEnforcement = {
    buildServiceRequestListFilter: vi.fn(),
  };
  const securityAudit = { record: vi.fn() };
  const conversionPort = { convert: vi.fn() };

  let service: ServiceRequestsAccessService;

  beforeEach(() => {
    vi.clearAllMocks();
    repository.listHistoryEvents.mockResolvedValue([]);
    /**
     * Colaboradores que a especificação de caracterização precisa repor para casar com a
     * orquestração vigente: a cadeia vinculada e o filtro de clientes autorizados foram
     * introduzidos depois desta especificação. Os valores padrão são neutros (sem elo, sem
     * cliente autorizado, sem catálogo legível) — nenhuma asserção é afrouxada por isso.
     */
    repository.findLinkedChain.mockResolvedValue([]);
    repository.listClientLabels.mockResolvedValue([]);
    repository.listServiceLabels.mockResolvedValue(new Map());
    repository.listOperationalUnits.mockResolvedValue([]);
    repository.countListSummary.mockResolvedValue(0);
    authz.filterAuthorizedClientIds.mockResolvedValue(new Set<string>());
    authz.filterAuthorizedLinkedChain.mockResolvedValue(new Set<string>());
    authz.canReadCatalogService.mockResolvedValue(false);
    authz.canPerformRecordAction.mockResolvedValue(true);
    const persistence = new ServiceRequestsAccessPersistence(repository as never);
    const validation = new ServiceRequestsAccessValidation(referenceValidation as never);
    const query = new ServiceRequestsAccessQuery(persistence, authz as never, scopeEnforcement as never);
    const audit = new ServiceRequestsAccessAudit(securityAudit as never);
    const idempotency = new ServiceRequestsAccessIdempotency(persistence, authz as never, query);
    const commands = new ServiceRequestsAccessCommands(
      authz as never,
      persistence,
      validation,
      idempotency,
      query,
      audit,
      conversionPort,
    );
    service = new ServiceRequestsAccessService(commands, query);
  });

  it('create replays existing idempotent record without persisting a new row', async () => {
    const existing = buildRow();
    repository.findByIdempotencyKey.mockResolvedValue(existing);
    repository.listDocumentLinks.mockResolvedValue([]);
    authz.assertRecordAction.mockResolvedValue(undefined);

    const result = await service.create(ACTOR, {
      unitId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      originSource: 'PHONE',
      idempotencyKey: 'idem-key-1',
    });

    expect(repository.create).not.toHaveBeenCalled();
    expect(authz.assertRecordAction).toHaveBeenCalledWith(
      ACTOR,
      AUTHZ_ACTIONS.RequestsServiceRequestRead,
      existing,
    );
    expect(result.serviceRequest.id).toBe(existing.id);
  });

  it('create records security audit after successful persistence', async () => {
    const created = buildRow({ idempotency_key: null });
    repository.findByIdempotencyKey.mockResolvedValue(null);
    repository.isUnitRegistered.mockResolvedValue(true);
    repository.create.mockResolvedValue(created);
    repository.isIdempotencyViolation.mockReturnValue(false);
    authz.assertCreateAction.mockResolvedValue(undefined);

    await service.create(ACTOR, {
      unitId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      originSource: 'PHONE',
      externalContact: { name: 'Caller' },
      description: 'Test intake',
    });

    expect(securityAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SECURITY_AUDIT_ACTIONS.RequestsServiceRequestCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.RequestsServiceRequest,
        resourceId: created.id,
      }),
    );
  });

  it('create maps idempotency violation to DUPLICATE_IDEMPOTENCY', async () => {
    repository.findByIdempotencyKey.mockResolvedValue(null);
    repository.isUnitRegistered.mockResolvedValue(true);
    repository.create.mockRejectedValue(new Error('duplicate'));
    repository.isIdempotencyViolation.mockReturnValue(true);
    authz.assertCreateAction.mockResolvedValue(undefined);

    await expect(
      service.create(ACTOR, {
        unitId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        originSource: 'PHONE',
        externalContact: { name: 'Caller' },
        description: 'Test intake',
        idempotencyKey: 'k1',
      }),
    ).rejects.toMatchObject({
      response: { error: { code: 'REQUESTS_DUPLICATE_IDEMPOTENCY' } },
    });
  });

  it('submit transition records audit after successful state change', async () => {
    const current = buildRow({ description: 'Demand minimum for submit' });
    const updated = buildRow({ description: 'Demand minimum for submit', status: 'SUBMITTED', row_version: 2 });
    repository.findById.mockResolvedValue(current);
    repository.transition.mockResolvedValue(updated);
    repository.listDocumentLinks.mockResolvedValue([]);
    authz.assertRecordAction.mockResolvedValue(undefined);

    await service.submit(ACTOR, current.id, { rowVersion: 1 });

    expect(securityAudit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: SECURITY_AUDIT_ACTIONS.RequestsServiceRequestSubmit,
        resourceId: current.id,
      }),
    );
  });

  it('list applies scope filter from authz grants', async () => {
    authz.findListGrants.mockResolvedValue([
      { scope_type: 'UNIT', resource_id: '6ba7b810-9dad-11d1-80b4-00c04fd430c8' },
    ]);
    scopeEnforcement.buildServiceRequestListFilter.mockReturnValue({
      clause: 'unit_id = $1',
      params: ['6ba7b810-9dad-11d1-80b4-00c04fd430c8'],
    });
    repository.listServiceRequests.mockResolvedValue([]);

    await service.list(ACTOR, {
      limit: 20,
      offset: 0,
      unitId: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    });

    /**
     * O contrato vigente da listagem inclui o predicado de escopo, os parâmetros do escopo e da
     * unidade informada, limite, deslocamento e a ordenação — esta última foi acrescentada depois
     * desta especificação.
     */
    expect(repository.listServiceRequests).toHaveBeenCalledWith(
      expect.stringContaining('unit_id = $'),
      expect.arrayContaining([
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
        '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
      ]),
      20,
      0,
      expect.stringContaining('created_at DESC'),
    );
  });
});