import { Inject, Injectable, Optional } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  buildControlCenter,
  CONTROL_CENTER_TRANSITION_ORDER,
  type ControlCenterControl,
} from '../domain/operations-control-center';
import { maskedFacts, ServiceOrderControlCenterAuthz } from './service-order-control-center.authz';
import type { ServiceOrderControlCenterFacts } from '../repositories/service-order-control-center.persistence';

import { canTransition } from '../domain/service-order.state-machine';
import { FAULT_HOOKS } from '../../platform/fault-injection/fault-hook.ids';
import { FAULT_INJECTION_PORT, type FaultInjectionPort } from '../../platform/fault-injection/fault-injection.port';
import { maybeInjectFault } from '../../platform/fault-injection/fault-injection.util';
import type { ClientStatus } from '../../clients/domain/client-status';
import {
  buildServiceOrderContractSnapshot,
} from '../../requests/domain/service-request-contract';
import { ContractsOperationalValidationService } from '../../commercial/services/contracts-operational-validation.service';
import { SERVICE_ORDER_HISTORY_EVENTS, SERVICE_ORDER_ORIGINS } from '../domain/service-order';
import {
  assertServiceOrderPreparePreconditions,
  assertServiceOrderReleasePreconditions,
  ServiceOrderReleaseError,
} from '../domain/service-order-release';
import { assertPurchaseOrderRequirement, BillingEntitlementError } from '../../billing/domain/billing-entitlement';
import {
  assertTransition,
  assertReopenJustification,
  resolveReopenStatus,
  ServiceOrderStateError,
  type ServiceOrderTransition,
} from '../domain/service-order.state-machine';
import {
  buildServiceOrderClientSnapshot,
  buildServiceOrderProposalSnapshot,
  buildServiceOrderPurchaseOrderSnapshot,
  buildServiceOrderServiceSnapshot,
  type ServiceOrderProposalSnapshot,
} from '../domain/service-order-snapshot';
import type { ListServiceOrdersQuery } from '../domain/service-order-list.query';
import type {
  CancelServiceOrderInput,
  CreateServiceOrderInput,
  ReopenServiceOrderInput,
  UpdateServiceOrderInput,
} from '../domain/service-order.validation';
import { ServiceOrderValidationError } from '../domain/service-order.validation';
import type { ServiceOrderStatus } from '../domain/service-order';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import {
  toServiceOrderDetailResponse,
  toServiceOrderListResponse,
  type ServiceOrderDetailResponse,
} from '../serializers/service-orders-response.serializer';
import { ServiceOrdersAccessAuthz } from './service-orders-access.authz';
import {
  mapServiceOrderReleaseError,
  serviceOrdersAccessNotFound,
  serviceOrdersClientNotFound,
  serviceOrdersInvalidState,
  serviceOrdersPurchaseOrderRequired,
  serviceOrdersReopenJustificationRequired,
  serviceOrdersServiceNotFound,
  serviceOrdersVersionConflict,
} from './service-orders-access.errors';
import {
  assertValidServiceOrderId,
  resolveCancelServiceOrderInput,
  resolveCreateServiceOrderInput,
  resolveReopenServiceOrderInput,
  resolveRowVersionInput,
  resolveServiceOrderListQuery,
  resolveUpdateServiceOrderInput,
} from './service-orders-input-resolution';
import { ServiceOrdersReferenceValidationService } from './service-orders-reference-validation.service';

@Injectable()
export class ServiceOrdersAccessService {
  constructor(
    private readonly repository: ServiceOrdersRepository,
    private readonly authz: ServiceOrdersAccessAuthz,
    private readonly referenceValidation: ServiceOrdersReferenceValidationService,
    private readonly contractOperationalValidation: ContractsOperationalValidationService,
    private readonly securityAudit: SecurityAuditService,
    private readonly controlCenterAuthz: ServiceOrderControlCenterAuthz,
    @Optional() @Inject(FAULT_INJECTION_PORT) private readonly faultInjection?: FaultInjectionPort,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateServiceOrderInput,
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    const validated = resolveCreateServiceOrderInput(input);

    await this.referenceValidation.assertUnitRegistered(validated.unitId);
    await this.authz.assertCreateAction(actor, validated.unitId, validated.clientId);

    if (validated.clientId) {
      await this.referenceValidation.assertClientActive(validated.clientId);
    }

    if (validated.origin === SERVICE_ORDER_ORIGINS.Proposal) {
      await this.authz.assertProposalOrigin(actor, validated.proposalId!, validated.unitId);
    }
    if (validated.origin === SERVICE_ORDER_ORIGINS.PurchaseOrder) {
      await this.authz.assertPurchaseOrderOrigin(
        actor,
        validated.purchaseOrderId!,
        validated.unitId,
        validated.clientId,
      );
    }

    let serviceSnapshot: Record<string, unknown> = {};
    let serviceDefinitionId: string | null = null;
    let serviceDefinitionVersionId: string | null = null;
    if (validated.serviceDefinitionId) {
      const snapshot = await this.buildServiceSnapshot(
        validated.serviceDefinitionId,
        validated.serviceDefinitionVersionId,
      );
      if (!snapshot) {
        throw serviceOrdersServiceNotFound();
      }
      serviceSnapshot = snapshot;
      serviceDefinitionId = validated.serviceDefinitionId;
      serviceDefinitionVersionId =
        validated.serviceDefinitionVersionId ?? (serviceSnapshot.serviceDefinitionVersionId as string);
    }

    let clientSnapshot: Record<string, unknown> | null = null;
    if (validated.clientId) {
      const client = await this.repository.findClientById(validated.clientId);
      if (client) {
        clientSnapshot = buildServiceOrderClientSnapshot(client);
      }
    }

    let proposalSnapshot: Record<string, unknown> | null = null;
    let proposalId: string | null = null;
    if (validated.proposalId) {
      const proposal = await this.repository.findProposalById(validated.proposalId);
      if (proposal) {
        proposalSnapshot = buildServiceOrderProposalSnapshot(proposal);
        proposalId = proposal.id;
      }
    }

    let purchaseOrderSnapshot: Record<string, unknown> | null = null;
    let purchaseOrderId: string | null = null;
    let rcNumber = validated.rcNumber ?? null;
    if (validated.purchaseOrderId) {
      const purchaseOrder = await this.repository.findPurchaseOrderById(validated.purchaseOrderId);
      if (purchaseOrder) {
        purchaseOrderSnapshot = buildServiceOrderPurchaseOrderSnapshot(purchaseOrder);
        purchaseOrderId = purchaseOrder.id;
        rcNumber = rcNumber ?? purchaseOrder.rc_number;
      }
    }

    const proposalBuilt = proposalSnapshot as ServiceOrderProposalSnapshot | null;
    const contractReference =
      validated.contractReference?.trim() || proposalBuilt?.contractReference || null;

    let contractId: string | null = null;
    let contractSnapshot: Record<string, unknown> | null = null;
    if (contractReference && validated.clientId) {
      const resolved = await this.contractOperationalValidation.tryResolveContractForOperationalUse(
        validated.clientId,
        contractReference,
      );
      if (resolved) {
        contractId = resolved.contract.id;
        contractSnapshot = { ...resolved.snapshot };
      }
    }
    if (!contractSnapshot && contractReference) {
      contractSnapshot = buildServiceOrderContractSnapshot({
        contractReference,
        paymentTerms: proposalBuilt?.paymentTerms ?? null,
      });
    }

    const created = await this.repository.create({
      internalCode: this.generateInternalCode(),
      orderNumber: this.generateOrderNumber(),
      unitId: validated.unitId,
      origin: validated.origin,
      clientId: validated.clientId ?? null,
      clientSnapshot,
      serviceDefinitionId,
      serviceDefinitionVersionId,
      serviceSnapshot,
      description: validated.description ?? null,
      location: validated.location ?? {},
      priority: validated.priority ?? null,
      operationalNotes: validated.operationalNotes ?? null,
      proposalId,
      proposalSnapshot,
      purchaseOrderId,
      purchaseOrderSnapshot,
      rcNumber,
      contractId,
      contractReference: contractId
        ? (contractSnapshot as { contractNumber?: string }).contractNumber ?? contractReference
        : contractReference,
      contractSnapshot,
      actorIdentityId: actor.identityId,
      historyEventType: SERVICE_ORDER_HISTORY_EVENTS.Created,
      historyPayload: { origin: validated.origin },
      correlationId,
    });

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderCreate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: created.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { orderNumber: created.order_number, origin: created.origin },
    });

    const history = await this.repository.listHistoryEvents(created.id);
    return toServiceOrderDetailResponse(created, history);
  }

  async getById(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<ServiceOrderDetailResponse> {
    assertValidServiceOrderId(serviceOrderId);
    const row = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead);
    const [history, facts] = await Promise.all([
      this.repository.listHistoryEvents(serviceOrderId),
      this.repository.findControlCenterFacts(serviceOrderId),
    ]);
    const controlCenter = await this.buildControlCenter(actor, row, facts);
    return toServiceOrderDetailResponse(row, history, controlCenter);
  }

  /**
   * Operations Control Center: composicao dos dominios existentes.
   *
   * Progressao, planejado x realizado e proximo passo vem do que ja esta persistido; os blocos de
   * medicao e faturamento so entram quando o ator tem autorizacao no MODULO DONO. Bloco negado e
   * omitido em silencio (sem contagem, status, valor ou metadata).
   */
  private async buildControlCenter(
    actor: IdentityAuthzContext,
    row: ServiceOrderRow,
    facts: ServiceOrderControlCenterFacts,
  ): Promise<ControlCenterControl> {
    const status = row.status as ServiceOrderStatus;
    const candidates = CONTROL_CENTER_TRANSITION_ORDER.filter((transition) =>
      canTransition(status, transition),
    );
    const [availableTransitions, measurement, billing] = await Promise.all([
      this.controlCenterAuthz.availableTransitions(actor, row, candidates),
      this.controlCenterAuthz.canReadMeasurement(actor, row),
      this.controlCenterAuthz.canReadBilling(actor, row),
    ]);

    const visible = maskedFacts(facts, {
      client: false,
      request: false,
      proposal: false,
      purchaseOrder: false,
      measurement,
      billing,
    });

    return buildControlCenter({
      status,
      createdAt: row.created_at,
      preparedAt: row.prepared_at,
      releasedAt: row.released_at,
      startedAt: row.started_at,
      pausedAt: row.paused_at,
      completedAt: row.completed_at,
      reopenedAt: row.reopened_at,
      serviceRequestId: row.service_request_id,
      facts: visible,
      availableTransitions,
    });
  }

  async list(
    actor: IdentityAuthzContext,
    query: ListServiceOrdersQuery,
  ): Promise<{
    items: ReturnType<typeof toServiceOrderListResponse>[];
    limit: number;
    offset: number;
  }> {
    await this.authz.assertListAction(actor);
    const scopeFilter = await this.authz.getListScopeFilter(actor);
    const parts = resolveServiceOrderListQuery(query, scopeFilter.clause, scopeFilter.params, {
      actorIdentityId: actor.identityId,
    });
    const rows = await this.repository.listServiceOrders(parts, query.limit, query.offset);

    return {
      items: rows.map(toServiceOrderListResponse),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async update(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: UpdateServiceOrderInput,
  ): Promise<ServiceOrderDetailResponse> {
    assertValidServiceOrderId(serviceOrderId);
    const current = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderUpdate,
    );

    const validated = resolveUpdateServiceOrderInput(input, current.status as ServiceOrderStatus);

    const persistence: Parameters<ServiceOrdersRepository['update']>[0] = {
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      description: validated.description,
      location: validated.location,
      priority: validated.priority,
      operationalNotes: validated.operationalNotes,
      clientId: validated.clientId,
      serviceDefinitionId: validated.serviceDefinitionId,
      serviceDefinitionVersionId: validated.serviceDefinitionVersionId,
      proposalId: validated.proposalId,
      purchaseOrderId: validated.purchaseOrderId,
      rcNumber: validated.rcNumber,
      contractReference: validated.contractReference,
    };

    if (validated.clientId) {
      await this.referenceValidation.assertClientActive(validated.clientId);
      const client = await this.repository.findClientById(validated.clientId);
      if (!client) {
        throw serviceOrdersClientNotFound();
      }
      persistence.clientSnapshot = buildServiceOrderClientSnapshot(client);
    } else if (validated.clientId === null) {
      persistence.clientSnapshot = null;
    }

    const serviceDefinitionId =
      validated.serviceDefinitionId ?? current.service_definition_id ?? undefined;
    const serviceDefinitionVersionId =
      validated.serviceDefinitionVersionId ?? current.service_definition_version_id ?? undefined;
    if (validated.serviceDefinitionId || validated.serviceDefinitionVersionId) {
      if (!serviceDefinitionId) {
        throw serviceOrdersServiceNotFound();
      }
      const snapshot = await this.buildServiceSnapshot(
        serviceDefinitionId,
        serviceDefinitionVersionId ?? undefined,
      );
      if (!snapshot) {
        throw serviceOrdersServiceNotFound();
      }
      persistence.serviceDefinitionId = serviceDefinitionId;
      persistence.serviceDefinitionVersionId =
        validated.serviceDefinitionVersionId ?? (snapshot.serviceDefinitionVersionId as string);
      persistence.serviceSnapshot = snapshot;
    }

    if (validated.proposalId) {
      await this.authz.assertProposalOrigin(actor, validated.proposalId, current.unit_id);
      const proposal = await this.repository.findProposalById(validated.proposalId);
      if (proposal) {
        persistence.proposalSnapshot = buildServiceOrderProposalSnapshot(proposal);
      }
    } else if (validated.proposalId === null) {
      persistence.proposalSnapshot = null;
    }

    if (validated.purchaseOrderId) {
      const effectiveClientId =
        validated.clientId !== undefined ? validated.clientId : current.client_id;
      await this.authz.assertPurchaseOrderOrigin(
        actor,
        validated.purchaseOrderId,
        current.unit_id,
        effectiveClientId,
      );
      const purchaseOrder = await this.repository.findPurchaseOrderById(validated.purchaseOrderId);
      if (purchaseOrder) {
        persistence.purchaseOrderSnapshot = buildServiceOrderPurchaseOrderSnapshot(purchaseOrder);
      }
    } else if (validated.purchaseOrderId === null) {
      persistence.purchaseOrderSnapshot = null;
    }

    if (validated.contractReference !== undefined) {
      const effectiveClientId =
        validated.clientId !== undefined ? validated.clientId : current.client_id;
      if (validated.contractReference && effectiveClientId) {
        const resolved = await this.contractOperationalValidation.tryResolveContractForOperationalUse(
          effectiveClientId,
          validated.contractReference,
        );
        if (resolved) {
          persistence.contractId = resolved.contract.id;
          persistence.contractSnapshot = { ...resolved.snapshot };
          persistence.contractReference =
            resolved.snapshot.contractNumber ?? validated.contractReference;
        } else {
          persistence.contractId = null;
          persistence.contractSnapshot = buildServiceOrderContractSnapshot({
            contractReference: validated.contractReference,
            paymentTerms: null,
          });
        }
      } else {
        persistence.contractSnapshot = validated.contractReference
          ? buildServiceOrderContractSnapshot({
              contractReference: validated.contractReference,
              paymentTerms: null,
            })
          : null;
        if (validated.contractReference === null || validated.contractReference === '') {
          persistence.contractId = null;
        }
      }
    }

    const updated = await this.repository.update(persistence);
    if (updated === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceOrdersInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderUpdate,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { rowVersion: updated.row_version },
    });

    const history = await this.repository.listHistoryEvents(serviceOrderId);
    return toServiceOrderDetailResponse(updated, history);
  }

  async prepare(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { rowVersion: number },
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    return this.transitionWithCorrelation(
      actor,
      serviceOrderId,
      input,
      'prepare',
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
      undefined,
      correlationId,
    );
  }

  async release(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { rowVersion: number },
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    assertValidServiceOrderId(serviceOrderId);
    const current = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
    );

    let validated: { rowVersion: number };
    let nextStatus: ServiceOrderStatus;
    try {
      validated = resolveRowVersionInput(input);
      nextStatus = assertTransition(current.status as ServiceOrderStatus, 'release');
    } catch (error) {
      if (error instanceof ServiceOrderStateError) {
        throw serviceOrdersInvalidState();
      }
      throw error;
    }

    const client = current.client_id ? await this.repository.findClientById(current.client_id) : null;
    try {
      assertServiceOrderReleasePreconditions(
        current,
        client ? { id: client.id, status: client.status as ClientStatus } : null,
      );
      assertPurchaseOrderRequirement({
        requirement: client?.purchase_order_requirement,
        phase: 'EXECUTION',
        purchaseOrderId: current.purchase_order_id,
        catalogRequiresPurchaseOrder: current.service_snapshot?.['requiresPurchaseOrder'] === true,
      });
    } catch (error) {
      if (error instanceof ServiceOrderReleaseError) {
        throw mapServiceOrderReleaseError(error);
      }
      if (error instanceof BillingEntitlementError && error.code === 'PURCHASE_ORDER_REQUIRED') {
        throw serviceOrdersPurchaseOrderRequired();
      }
      throw error;
    }

    const clientSnapshot = client ? buildServiceOrderClientSnapshot(client) : null;
    const updated = await this.repository.transition({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: current.status,
      nextStatus,
      transition: 'release',
      clientSnapshot,
      correlationId,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceOrdersInvalidState();
    }

    await maybeInjectFault(this.faultInjection, FAULT_HOOKS.ServiceOrderReleaseAfterCommitBeforeAudit);
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderRelease,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { fromStatus: current.status, toStatus: nextStatus },
    });

    const history = await this.repository.listHistoryEvents(serviceOrderId);
    return toServiceOrderDetailResponse(updated, history);
  }

  async cancel(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: CancelServiceOrderInput,
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    const validated = resolveCancelServiceOrderInput(input);
    return this.transitionWithCorrelation(
      actor,
      serviceOrderId,
      validated,
      'cancel',
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
      validated.cancellationReason,
      correlationId,
    );
  }

  async reopen(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: ReopenServiceOrderInput,
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    assertValidServiceOrderId(serviceOrderId);
    const current = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderReopen,
    );

    let validated: ReopenServiceOrderInput;
    let nextStatus: ServiceOrderStatus;
    let reopenReason: string;
    try {
      validated = resolveReopenServiceOrderInput(input);
      reopenReason = assertReopenJustification(validated.reopenReason);
      nextStatus = resolveReopenStatus({
        currentStatus: current.status as ServiceOrderStatus,
        statusBeforeCancel: current.status_before_cancel as ServiceOrderStatus | null,
      });
    } catch (error) {
      if (error instanceof ServiceOrderValidationError) {
        throw serviceOrdersReopenJustificationRequired();
      }
      if (error instanceof ServiceOrderStateError) {
        if (error.code === 'REOPEN_JUSTIFICATION_REQUIRED') {
          throw serviceOrdersReopenJustificationRequired();
        }
        throw serviceOrdersInvalidState();
      }
      throw error;
    }

    const updated = await this.repository.transition({
      serviceOrderId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: current.status,
      nextStatus,
      transition: 'reopen',
      reopenReason,
      correlationId,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceOrdersInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderReopen,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: {
        fromStatus: current.status,
        toStatus: nextStatus,
        reopenReason,
      },
    });

    const history = await this.repository.listHistoryEvents(serviceOrderId);
    return toServiceOrderDetailResponse(updated, history);
  }

  private async transition(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { rowVersion: number },
    transition: ServiceOrderTransition,
    action: AuthzAction,
    cancellationReason?: string,
  ): Promise<ServiceOrderDetailResponse> {
    return this.transitionWithCorrelation(
      actor,
      serviceOrderId,
      input,
      transition,
      action,
      cancellationReason,
    );
  }

  /**
   * Mesma transicao, com correlacao explicita para a trilha AUDIT_TRAIL.
   * Separado para nao alterar a assinatura publica de `transition` nem o tipo
   * compartilhado IdentityAuthzContext (usado por todo o backend).
   */
  private async transitionWithCorrelation(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: { rowVersion: number },
    transition: ServiceOrderTransition,
    action: AuthzAction,
    cancellationReason?: string,
    correlationId?: string | null,
  ): Promise<ServiceOrderDetailResponse> {
    assertValidServiceOrderId(serviceOrderId);
    const current = await this.requireServiceOrder(actor, serviceOrderId, action);

    let nextStatus: ServiceOrderStatus;
    try {
      resolveRowVersionInput(input);
      nextStatus = assertTransition(current.status as ServiceOrderStatus, transition);
      if (transition === 'prepare') {
        assertServiceOrderPreparePreconditions(current);
      }
    } catch (error) {
      if (error instanceof ServiceOrderStateError || error instanceof ServiceOrderReleaseError) {
        throw error instanceof ServiceOrderReleaseError
          ? mapServiceOrderReleaseError(error)
          : serviceOrdersInvalidState();
      }
      throw error;
    }

    const updated = await this.repository.transition({
      serviceOrderId,
      rowVersion: input.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: current.status,
      nextStatus,
      transition,
      cancellationReason,
      correlationId,
    });

    if (updated === 'VERSION_CONFLICT') {
      throw serviceOrdersVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw serviceOrdersInvalidState();
    }

    const auditAction =
      transition === 'prepare'
        ? SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderPrepare
        : SECURITY_AUDIT_ACTIONS.ServiceOrdersServiceOrderCancel;
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: auditAction,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { fromStatus: current.status, toStatus: nextStatus },
    });

    const history = await this.repository.listHistoryEvents(serviceOrderId);
    return toServiceOrderDetailResponse(updated, history);
  }

  private async buildServiceSnapshot(
    serviceDefinitionId: string,
    serviceDefinitionVersionId?: string,
  ): Promise<Record<string, unknown> | null> {
    const source = await this.repository.findServiceSnapshotSource(
      serviceDefinitionId,
      serviceDefinitionVersionId,
    );
    if (!source) {
      return null;
    }
    const parts = await this.repository.loadServiceSnapshotParts(source.service_definition_version_id);
    return buildServiceOrderServiceSnapshot({ source, ...parts });
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    const row = await this.repository.findById(serviceOrderId);
    if (!row) {
      throw serviceOrdersAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, row);
    return row;
  }

  private generateInternalCode(): string {
    return `SO-INT-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }

  private generateOrderNumber(): string {
    return `OS-${new Date().getUTCFullYear()}-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}