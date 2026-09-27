import { Injectable } from '@nestjs/common';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { ServiceRequestStatus, ServiceRequestTransition } from '../domain/service-request';
import {
  allowedTransitionsFrom,
  nextStepForStatus,
  readinessBlockers,
} from '../domain/service-request-readiness';
import { ServiceRequestValidationError } from '../domain/service-request.validation';
import {
  buildServiceRequestListOrderClause,
  buildServiceRequestListWhere,
  type ServiceRequestListDirection,
  type ServiceRequestListSort,
} from '../repositories/service-request-list-sql';
import type { ServiceRequestListSummaryCounts } from '../repositories/service-requests.repository';
import type { ServiceRequestRow } from '../repositories/service-requests.repository.types';
import {
  toServiceRequestDetailResponse,
  toServiceRequestListItemResponse,
  type ServiceRequestDetailResponse,
  type ServiceRequestEnrichment,
  type ServiceRequestListItemResponse,
  type ServiceRequestReadinessResponse,
} from '../serializers/service-requests-response.serializer';
import { ServiceRequestsAccessAuthz } from './service-requests-access.authz';
import {
  serviceRequestsAccessNotFound,
  serviceRequestsValidationFailed,
} from './service-requests-access.errors';
import { assertValidServiceRequestId } from './service-requests-input-resolution';
import { ServiceRequestsAccessPersistence } from './service-requests-access.persistence';

export type ServiceRequestListSummaryResponse = {
  total: number;
  pending: number;
  underReview: number;
  converted: number;
  cancelled: number;
};

export type ServiceRequestListQuery = {
  clientId?: string;
  unitId?: string;
  status?: string;
  priority?: string;
  originSource?: string;
  desiredFrom?: string;
  desiredTo?: string;
  search?: string;
  sort?: ServiceRequestListSort;
  direction?: ServiceRequestListDirection;
  limit: number;
  offset: number;
};

/** Acao de autorizacao que o modulo dono exige para cada transicao da maquina de estados. */
const TRANSITION_ACTIONS: Record<ServiceRequestTransition, AuthzAction> = {
  submit: AUTHZ_ACTIONS.RequestsServiceRequestSubmit,
  startReview: AUTHZ_ACTIONS.RequestsServiceRequestReview,
  approve: AUTHZ_ACTIONS.RequestsServiceRequestApprove,
  reject: AUTHZ_ACTIONS.RequestsServiceRequestReject,
  cancel: AUTHZ_ACTIONS.RequestsServiceRequestCancel,
  convert: AUTHZ_ACTIONS.RequestsServiceRequestConvert,
};

function toServiceRequestListSummaryResponse(
  counts: ServiceRequestListSummaryCounts,
): ServiceRequestListSummaryResponse {
  return {
    total: counts.total,
    pending: counts.pending,
    underReview: counts.underReview,
    converted: counts.converted,
    cancelled: counts.cancelled,
  };
}

function displayName(legalName: string, tradeName: string | null): string {
  return tradeName?.trim() ? tradeName : legalName;
}

@Injectable()
export class ServiceRequestsAccessQuery {
  constructor(
    private readonly persistence: ServiceRequestsAccessPersistence,
    private readonly authz: ServiceRequestsAccessAuthz,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async toDetail(
    actor: IdentityAuthzContext,
    row: ServiceRequestRow,
  ): Promise<ServiceRequestDetailResponse> {
    const [links, historyEvents, chain] = await Promise.all([
      this.persistence.listDocumentLinks(row.id),
      this.persistence.listHistoryEvents(row.id),
      this.persistence.findLinkedChain(row.id),
    ]);

    const [enrichment, allowedLinked, readiness] = await Promise.all([
      this.buildEnrichment(actor, [row]),
      this.authz.filterAuthorizedLinkedChain(actor, chain),
      this.buildReadiness(actor, row),
    ]);

    return toServiceRequestDetailResponse(row, links, historyEvents, {
      enrichment,
      linkedChain: chain.filter((link) => allowedLinked.has(`${link.kind}:${link.id}`)),
      readiness,
    });
  }

  async requireRecord(
    actor: IdentityAuthzContext,
    serviceRequestId: string,
    action: AuthzAction,
  ): Promise<ServiceRequestRow> {
    const row = await this.persistence.findById(serviceRequestId);
    if (!row) {
      throw serviceRequestsAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, row);
    return row;
  }

  async listOperationalUnits(actor: IdentityAuthzContext): Promise<{ items: string[] }> {
    await this.authz.assertListAction(actor);
    return { items: await this.persistence.listOperationalUnits() };
  }

  async registerOperationalUnit(
    actor: IdentityAuthzContext,
    refId: string,
  ): Promise<{ items: string[] }> {
    const normalized = refId.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(normalized)) {
      throw serviceRequestsValidationFailed();
    }
    await this.authz.assertListAction(actor);
    await this.persistence.registerOperationalUnit(normalized);
    return { items: await this.persistence.listOperationalUnits() };
  }

  async getById(actor: IdentityAuthzContext, serviceRequestId: string): Promise<ServiceRequestDetailResponse> {
    assertValidServiceRequestId(serviceRequestId);
    const row = await this.requireRecord(actor, serviceRequestId, AUTHZ_ACTIONS.RequestsServiceRequestRead);
    return this.toDetail(actor, row);
  }

  async list(
    actor: IdentityAuthzContext,
    query: ServiceRequestListQuery,
  ): Promise<{ items: ServiceRequestListItemResponse[]; limit: number; offset: number }> {
    const grants = await this.authz.findListGrants(actor);
    const scopeFilter = this.scopeEnforcement.buildServiceRequestListFilter(grants);

    let whereClause: { clause: string; params: unknown[] };
    let orderClause: string;
    try {
      whereClause = buildServiceRequestListWhere(scopeFilter, query);
      orderClause = buildServiceRequestListOrderClause(query.sort, query.direction);
    } catch (error) {
      if (error instanceof ServiceRequestValidationError) {
        throw serviceRequestsValidationFailed();
      }
      throw error;
    }

    const rows = await this.persistence.listServiceRequests(
      whereClause.clause,
      whereClause.params,
      query.limit,
      query.offset,
      orderClause,
    );

    const enrichmentByRow = await this.enrichmentByClient(actor, rows);

    return {
      items: rows.map((row) =>
        toServiceRequestListItemResponse(row, {
          clientName: row.client_id ? (enrichmentByRow.clientNames.get(row.client_id) ?? null) : null,
          serviceLabel: row.service_definition_id
            ? (enrichmentByRow.serviceLabels.get(row.service_definition_id) ?? null)
            : null,
        }),
      ),
      limit: query.limit,
      offset: query.offset,
    };
  }

  async summary(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string },
  ): Promise<ServiceRequestListSummaryResponse> {
    const grants = await this.authz.findListGrants(actor);
    const scopeFilter = this.scopeEnforcement.buildServiceRequestListFilter(grants);
    const { clause, params } = buildServiceRequestListWhere(scopeFilter, query);
    const counts = await this.persistence.countListSummary(clause, params);
    return toServiceRequestListSummaryResponse(counts);
  }

  /**
   * Prontidao derivada das regras reais: transicoes permitidas pelo estado (maquina de estados) e
   * autorizadas para ESTE ator, bloqueios impostos pelo backend e o proximo passo do estado.
   * Nenhuma regra nova e criada aqui.
   */
  private async buildReadiness(
    actor: IdentityAuthzContext,
    row: ServiceRequestRow,
  ): Promise<ServiceRequestReadinessResponse> {
    const status = row.status as ServiceRequestStatus;
    const allowed = allowedTransitionsFrom(status);
    const granted = await Promise.all(
      allowed.map(async (transition) => ({
        transition,
        allowed: await this.authz.canPerformRecordAction(
          actor,
          TRANSITION_ACTIONS[transition],
          row,
        ),
      })),
    );
    const availableTransitions = granted
      .filter((entry) => entry.allowed)
      .map((entry) => entry.transition);
    const nextStep = nextStepForStatus(status);

    return {
      nextStep: nextStep.step,
      nextStepTransition:
        nextStep.transition && availableTransitions.includes(nextStep.transition)
          ? nextStep.transition
          : null,
      availableTransitions,
      blockers: readinessBlockers({
        status,
        description: row.description,
        serviceDefinitionId: row.service_definition_id,
      }),
    };
  }

  private async buildEnrichment(
    actor: IdentityAuthzContext,
    rows: ServiceRequestRow[],
  ): Promise<ServiceRequestEnrichment> {
    const row = rows[0];
    if (!row) {
      return { clientName: null, serviceLabel: null };
    }
    const enrichment = await this.enrichmentByClient(actor, rows);
    return {
      clientName: row.client_id ? (enrichment.clientNames.get(row.client_id) ?? null) : null,
      serviceLabel: row.service_definition_id
        ? (enrichment.serviceLabels.get(row.service_definition_id) ?? null)
        : null,
    };
  }

  /**
   * Enriquecimento em lote: uma consulta para nomes de cliente e ate duas para rotulos de servico,
   * independentemente do numero de linhas — nunca um lookup por linha. Cada conjunto e sempre o
   * subconjunto que o modulo dono autorizou.
   */
  private async enrichmentByClient(
    actor: IdentityAuthzContext,
    rows: ServiceRequestRow[],
  ): Promise<{ clientNames: Map<string, string>; serviceLabels: Map<string, string> }> {
    const clientIds = [
      ...new Set(rows.map((row) => row.client_id).filter((id): id is string => Boolean(id))),
    ];
    const serviceRefs = new Map<string, { serviceDefinitionId: string; serviceDefinitionVersionId: string | null }>();
    for (const row of rows) {
      if (row.service_definition_id && !serviceRefs.has(row.service_definition_id)) {
        serviceRefs.set(row.service_definition_id, {
          serviceDefinitionId: row.service_definition_id,
          serviceDefinitionVersionId: row.service_definition_version_id,
        });
      }
    }

    const [allowedClients, canReadCatalog] = await Promise.all([
      this.authz.filterAuthorizedClientIds(actor, clientIds),
      this.authz.canReadCatalogService(actor),
    ]);

    const [clientRows, serviceLabels] = await Promise.all([
      allowedClients.size === 0
        ? Promise.resolve([])
        : this.persistence.listClientLabels([...allowedClients]),
      canReadCatalog && serviceRefs.size > 0
        ? this.persistence.listServiceLabels([...serviceRefs.values()])
        : Promise.resolve(new Map<string, string>()),
    ]);

    return {
      clientNames: new Map(
        clientRows.map((client) => [client.id, displayName(client.legal_name, client.trade_name)]),
      ),
      serviceLabels,
    };
  }
}
