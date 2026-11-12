import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  SEARCH_ENTITY_TYPES,
  parseSearchEntityTypes,
  type SearchEntityType,
} from '../domain/search-entity-type';
import { SEARCH_POLICY } from '../domain/search-policy';
import { normalizeSearchQuery } from '../domain/search-query-normalizer';
import type { SearchResponse } from '../domain/search-result';
import { prefixAlias } from '../domain/search-sql.helper';
import { SEARCH_ERROR_CODES } from '../errors/search-error-codes';
import { SearchHttpException } from '../errors/search-http.exception';
import { SearchRepository, type SearchScopeFilters } from '../repositories/search.repository';
import { EndpointRateLimitService } from '../../security/services/endpoint-rate-limit.service';

export type SearchQueryInput = {
  q?: string;
  types?: string;
  status?: string;
  clientId?: string;
  serviceDefinitionId?: string;
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
};

@Injectable()
export class SearchAccessService {
  constructor(
    private readonly repository: SearchRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly endpointRateLimit: EndpointRateLimitService,
  ) {}

  async search(actor: IdentityAuthzContext, query: SearchQueryInput): Promise<SearchResponse> {
    await this.endpointRateLimit.assertAllowed('search', actor.identityId);
    const normalized = query.q ? normalizeSearchQuery(query.q) : null;
    if (!normalized) {
      throw new SearchHttpException(400, SEARCH_ERROR_CODES.INVALID_QUERY, 'Invalid search query.');
    }

    const allowedTypes = await this.resolveAllowedTypes(actor);
    if (allowedTypes.length === 0) {
      throw new SearchHttpException(403, SEARCH_ERROR_CODES.ACCESS_DENIED, 'Access denied.');
    }

    const requestedTypes = parseSearchEntityTypes(query.types) ?? allowedTypes;
    const types = requestedTypes.filter((type) => allowedTypes.includes(type));
    if (types.length === 0) {
      throw new SearchHttpException(403, SEARCH_ERROR_CODES.ACCESS_DENIED, 'Access denied.');
    }

    const limit = parseLimit(query.limit);
    const offset = parseOffset(query.offset);
    const filters = {
      status: sanitizeFilter(query.status),
      clientId: parseUuid(query.clientId),
      serviceDefinitionId: parseUuid(query.serviceDefinitionId),
      from: parseDate(query.from),
      to: parseDate(query.to),
    };

    const scopes = await this.resolveScopeFilters(actor, allowedTypes);
    const { groups } = await this.repository.search(
      normalized,
      scopes,
      types,
      limit,
      offset,
      filters,
    );

    const responseGroups = types
      .map((entityType) => {
        const group = groups.get(entityType);
        if (!group || group.items.length === 0) {
          return null;
        }
        return {
          entityType,
          total: group.total,
          items: group.items,
        };
      })
      .filter((group): group is NonNullable<typeof group> => group !== null);

    const hasMore = responseGroups.some((group) => group.total > offset + group.items.length);

    return {
      query: {
        raw: normalized.raw,
        kind: normalized.kind,
      },
      groups: responseGroups,
      pagination: {
        limit,
        offset,
        hasMore,
      },
      allowedTypes,
    };
  }

  private async resolveAllowedTypes(actor: IdentityAuthzContext): Promise<SearchEntityType[]> {
    const checks = await Promise.all([
      this.hasGrant(actor, AUTHZ_ACTIONS.ClientList, AUTHZ_RESOURCE_TYPES.Client),
      this.hasGrant(
        actor,
        AUTHZ_ACTIONS.RequestsServiceRequestList,
        AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      ),
      this.hasGrant(actor, AUTHZ_ACTIONS.CommercialProposalList, AUTHZ_RESOURCE_TYPES.CommercialProposal),
      this.hasGrant(
        actor,
        AUTHZ_ACTIONS.CommercialPurchaseOrderList,
        AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      ),
      this.hasGrant(
        actor,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.hasGrant(actor, AUTHZ_ACTIONS.ResourcesAssetList, AUTHZ_RESOURCE_TYPES.ResourcesAsset),
      this.hasGrant(actor, AUTHZ_ACTIONS.DocumentsDocumentList, AUTHZ_RESOURCE_TYPES.DocumentsDocument),
      this.hasGrant(
        actor,
        AUTHZ_ACTIONS.MeasurementsMeasurementRead,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.hasGrant(
        actor,
        AUTHZ_ACTIONS.BillingBillingRecordRead,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
    ]);

    const types: SearchEntityType[] = [];
    if (checks[0]) types.push(SEARCH_ENTITY_TYPES.Client);
    if (checks[1]) types.push(SEARCH_ENTITY_TYPES.ServiceRequest);
    if (checks[2]) types.push(SEARCH_ENTITY_TYPES.Proposal);
    if (checks[3]) types.push(SEARCH_ENTITY_TYPES.PurchaseOrder);
    if (checks[4]) types.push(SEARCH_ENTITY_TYPES.ServiceOrder);
    if (checks[5]) types.push(SEARCH_ENTITY_TYPES.Asset);
    if (checks[6]) types.push(SEARCH_ENTITY_TYPES.Document);
    if (checks[7]) types.push(SEARCH_ENTITY_TYPES.Measurement);
    if (checks[8]) types.push(SEARCH_ENTITY_TYPES.BillingRecord);
    return types;
  }

  private async resolveScopeFilters(
    actor: IdentityAuthzContext,
    allowedTypes: SearchEntityType[],
  ): Promise<SearchScopeFilters> {
    const includes = (type: SearchEntityType) => allowedTypes.includes(type);

    const clientScope = includes(SEARCH_ENTITY_TYPES.Client)
      ? await this.scopeFor(actor, AUTHZ_ACTIONS.ClientList, AUTHZ_RESOURCE_TYPES.Client, 'client')
      : null;
    const serviceRequestScope = includes(SEARCH_ENTITY_TYPES.ServiceRequest)
      ? await this.scopeFor(
          actor,
          AUTHZ_ACTIONS.RequestsServiceRequestList,
          AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
          'commercial',
        )
      : null;
    const proposalScope = includes(SEARCH_ENTITY_TYPES.Proposal)
      ? await this.scopeFor(
          actor,
          AUTHZ_ACTIONS.CommercialProposalList,
          AUTHZ_RESOURCE_TYPES.CommercialProposal,
          'commercial',
        )
      : null;
    const purchaseOrderScope = includes(SEARCH_ENTITY_TYPES.PurchaseOrder)
      ? await this.scopeFor(
          actor,
          AUTHZ_ACTIONS.CommercialPurchaseOrderList,
          AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
          'commercial',
        )
      : null;
    const serviceOrderScope = includes(SEARCH_ENTITY_TYPES.ServiceOrder)
      ? await this.scopeFor(
          actor,
          AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
          AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
          'commercial',
        )
      : null;
    const assetScope = includes(SEARCH_ENTITY_TYPES.Asset)
      ? await this.scopeFor(actor, AUTHZ_ACTIONS.ResourcesAssetList, AUTHZ_RESOURCE_TYPES.ResourcesAsset, 'asset')
      : null;
    const documentScope = includes(SEARCH_ENTITY_TYPES.Document)
      ? await this.scopeFor(
          actor,
          AUTHZ_ACTIONS.DocumentsDocumentList,
          AUTHZ_RESOURCE_TYPES.DocumentsDocument,
          'document',
        )
      : null;
    const measurementScope = includes(SEARCH_ENTITY_TYPES.Measurement)
      ? prefixAlias(
          await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.MeasurementsMeasurementRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            'commercial',
          ) ?? { clause: 'FALSE', params: [] },
          'so',
        )
      : null;
    const billingScope = includes(SEARCH_ENTITY_TYPES.BillingRecord)
      ? prefixAlias(
          await this.scopeFor(
            actor,
            AUTHZ_ACTIONS.BillingBillingRecordRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            'commercial',
          ) ?? { clause: 'FALSE', params: [] },
          'br',
        )
      : null;

    return {
      clientScope,
      serviceRequestScope,
      proposalScope,
      purchaseOrderScope,
      serviceOrderScope,
      assetScope,
      documentScope,
      measurementScope,
      billingScope,
    };
  }

  private async scopeFor(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
    kind: 'client' | 'commercial' | 'asset' | 'document',
  ): Promise<ScopeSqlPredicate> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      resourceType,
    );
    if (grants.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    switch (kind) {
      case 'client':
        return this.scopeEnforcement.buildClientListFilter(grants);
      case 'asset':
        return this.scopeEnforcement.buildPhysicalAssetListFilter(grants);
      case 'document':
        return prefixAlias(this.scopeEnforcement.buildDocumentListFilter(grants), 'd');
      case 'commercial':
        if (resourceType === AUTHZ_RESOURCE_TYPES.RequestsServiceRequest) {
          return prefixAlias(this.scopeEnforcement.buildServiceRequestListFilter(grants), 'sr');
        }
        if (resourceType === AUTHZ_RESOURCE_TYPES.CommercialProposal) {
          return prefixAlias(this.scopeEnforcement.buildProposalListFilter(grants), 'p');
        }
        if (resourceType === AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder) {
          return prefixAlias(this.scopeEnforcement.buildPurchaseOrderListFilter(grants), 'po');
        }
        return prefixAlias(this.scopeEnforcement.buildServiceOrderListFilter(grants), 'so');
      default:
        return { clause: 'FALSE', params: [] };
    }
  }

  private async hasGrant(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
  ): Promise<boolean> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      resourceType,
    );
    return grants.length > 0;
  }
}

function parseLimit(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : SEARCH_POLICY.defaultLimit;
  if (!Number.isFinite(parsed) || parsed < 1) {
    return SEARCH_POLICY.defaultLimit;
  }
  return Math.min(parsed, SEARCH_POLICY.maxLimit);
}

function parseOffset(value: string | undefined): number {
  const parsed = value ? Number.parseInt(value, 10) : 0;
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
}

function sanitizeFilter(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  return value.trim().slice(0, 64);
}

function parseUuid(value: string | undefined): string | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const trimmed = value.trim();
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(trimmed)
  ) {
    return undefined;
  }
  return trimmed.toLowerCase();
}

function parseDate(value: string | undefined): Date | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}
