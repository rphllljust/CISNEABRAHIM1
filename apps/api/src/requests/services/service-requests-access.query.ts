import { Injectable } from '@nestjs/common';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { isServiceRequestStatus } from '../domain/service-request';
import type { ServiceRequestListSummaryCounts } from '../repositories/service-requests.repository';
import type { ServiceRequestRow } from '../repositories/service-requests.repository.types';
import {
  toServiceRequestDetailResponse,
  toServiceRequestResponse,
  type ServiceRequestDetailResponse,
} from '../serializers/service-requests-response.serializer';
import { ServiceRequestsAccessAuthz } from './service-requests-access.authz';
import { serviceRequestsAccessNotFound, serviceRequestsValidationFailed } from './service-requests-access.errors';
import { assertValidServiceRequestId } from './service-requests-input-resolution';
import { ServiceRequestsAccessPersistence } from './service-requests-access.persistence';

export type ServiceRequestListSummaryResponse = {
  total: number;
  pending: number;
  underReview: number;
  converted: number;
  cancelled: number;
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

function buildServiceRequestListWhere(
  scopeFilter: ReturnType<ScopeEnforcementService['buildServiceRequestListFilter']>,
  query: { clientId?: string; unitId?: string; status?: string },
): { clause: string; params: unknown[] } {
  const clauses = [scopeFilter.clause];
  const params = [...scopeFilter.params];

  if (query.clientId) {
    params.push(query.clientId);
    clauses.push(`client_id = $${params.length}::uuid`);
  }
  if (query.unitId) {
    params.push(query.unitId);
    clauses.push(`unit_id = $${params.length}`);
  }
  if (query.status) {
    if (!isServiceRequestStatus(query.status)) {
      throw serviceRequestsValidationFailed();
    }
    params.push(query.status);
    clauses.push(`status = $${params.length}::sr.service_request_status`);
  }

  return { clause: clauses.join(' AND '), params };
}

@Injectable()
export class ServiceRequestsAccessQuery {
  constructor(
    private readonly persistence: ServiceRequestsAccessPersistence,
    private readonly authz: ServiceRequestsAccessAuthz,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async toDetail(row: ServiceRequestRow): Promise<ServiceRequestDetailResponse> {
    const [links, historyEvents] = await Promise.all([
      this.persistence.listDocumentLinks(row.id),
      this.persistence.listHistoryEvents(row.id),
    ]);
    return toServiceRequestDetailResponse(row, links, historyEvents);
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
    return this.toDetail(row);
  }

  async list(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string; status?: string; limit: number; offset: number },
  ): Promise<{ items: ReturnType<typeof toServiceRequestResponse>[]; limit: number; offset: number }> {
    const grants = await this.authz.findListGrants(actor);
    const scopeFilter = this.scopeEnforcement.buildServiceRequestListFilter(grants);
    const { clause, params } = buildServiceRequestListWhere(scopeFilter, query);

    const rows = await this.persistence.listServiceRequests(clause, params, query.limit, query.offset);

    return {
      items: rows.map(toServiceRequestResponse),
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
}
