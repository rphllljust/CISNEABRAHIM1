import type { ScopeSqlPredicate } from '../../authorization/services/scope-enforcement.service';
import { SEARCH_ENTITY_TYPES, type SearchEntityType } from '../domain/search-entity-type';
import type { NormalizedSearchQuery } from '../domain/search-query-normalizer';
import type { EntitySearchQuery, SearchFilters, SearchScopeFilters } from './search.repository.types';

export function scopeForSearchEntityType(
  scopes: SearchScopeFilters,
  entityType: SearchEntityType,
): ScopeSqlPredicate | null {
  switch (entityType) {
    case SEARCH_ENTITY_TYPES.Client:
      return scopes.clientScope;
    case SEARCH_ENTITY_TYPES.ServiceRequest:
      return scopes.serviceRequestScope;
    case SEARCH_ENTITY_TYPES.Proposal:
      return scopes.proposalScope;
    case SEARCH_ENTITY_TYPES.PurchaseOrder:
      return scopes.purchaseOrderScope;
    case SEARCH_ENTITY_TYPES.ServiceOrder:
      return scopes.serviceOrderScope;
    case SEARCH_ENTITY_TYPES.Asset:
      return scopes.assetScope;
    case SEARCH_ENTITY_TYPES.Document:
      return scopes.documentScope;
    case SEARCH_ENTITY_TYPES.Measurement:
      return scopes.measurementScope;
    case SEARCH_ENTITY_TYPES.BillingRecord:
      return scopes.billingScope;
    default:
      return null;
  }
}

export function buildEntitySearchQuery(
  entityType: SearchEntityType,
  query: NormalizedSearchQuery,
  filters: SearchFilters,
): EntitySearchQuery | null {
  const filterSql = buildSearchFilterSql(filters, entityType);
  const filterParams = filterSql.params;
  const filterClause = filterSql.clause;

  switch (entityType) {
    case SEARCH_ENTITY_TYPES.Client:
      return clientSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.ServiceRequest:
      return serviceRequestSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.Proposal:
      return proposalSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.PurchaseOrder:
      return purchaseOrderSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.ServiceOrder:
      return serviceOrderSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.Asset:
      return assetSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.Document:
      return documentSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.Measurement:
      return measurementSearchQuery(query, filterClause, filterParams);
    case SEARCH_ENTITY_TYPES.BillingRecord:
      return billingRecordSearchQuery(query, filterClause, filterParams);
    default:
      return null;
  }
}

function buildSearchFilterSql(
  filters: SearchFilters,
  entityType: SearchEntityType,
): { clause: string; params: unknown[] } {
  const alias = filterAliasForEntityType(entityType);
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (filters.status) {
    params.push(filters.status);
    clauses.push(`${alias.status} = $${params.length}`);
  }
  if (filters.clientId) {
    params.push(filters.clientId);
    clauses.push(`${alias.clientId} = $${params.length}::uuid`);
  }
  if (filters.serviceDefinitionId && entityType === SEARCH_ENTITY_TYPES.ServiceOrder) {
    params.push(filters.serviceDefinitionId);
    clauses.push(`${alias.serviceDefinitionId} = $${params.length}::uuid`);
  }
  if (filters.from) {
    params.push(filters.from);
    clauses.push(`${alias.createdAt} >= $${params.length}`);
  }
  if (filters.to) {
    params.push(filters.to);
    clauses.push(`${alias.createdAt} < $${params.length}`);
  }

  return {
    clause: clauses.length > 0 ? clauses.join(' AND ') : 'TRUE',
    params,
  };
}

function filterAliasForEntityType(entityType: SearchEntityType): {
  status: string;
  clientId: string;
  serviceDefinitionId: string;
  createdAt: string;
} {
  switch (entityType) {
    case SEARCH_ENTITY_TYPES.Client:
      return {
        status: 'c.status',
        clientId: 'c.id',
        serviceDefinitionId: 'c.id',
        createdAt: 'c.created_at',
      };
    case SEARCH_ENTITY_TYPES.ServiceRequest:
      return {
        status: 'sr.status',
        clientId: 'sr.client_id',
        serviceDefinitionId: 'sr.id',
        createdAt: 'sr.created_at',
      };
    case SEARCH_ENTITY_TYPES.Proposal:
      return {
        status: 'pv.status',
        clientId: 'p.client_id',
        serviceDefinitionId: 'p.id',
        createdAt: 'p.created_at',
      };
    case SEARCH_ENTITY_TYPES.PurchaseOrder:
      return {
        status: 'po.status',
        clientId: 'po.client_id',
        serviceDefinitionId: 'po.id',
        createdAt: 'po.created_at',
      };
    case SEARCH_ENTITY_TYPES.ServiceOrder:
      return {
        status: 'so.status',
        clientId: 'so.client_id',
        serviceDefinitionId: 'so.service_definition_id',
        createdAt: 'so.created_at',
      };
    case SEARCH_ENTITY_TYPES.Asset:
      return {
        status: 'a.lifecycle_status',
        clientId: 'a.id',
        serviceDefinitionId: 'a.id',
        createdAt: 'a.created_at',
      };
    case SEARCH_ENTITY_TYPES.Document:
      return {
        status: 'd.status',
        clientId: 'd.id',
        serviceDefinitionId: 'd.id',
        createdAt: 'd.created_at',
      };
    case SEARCH_ENTITY_TYPES.Measurement:
      return {
        status: 'm.status',
        clientId: 'so.client_id',
        serviceDefinitionId: 'so.service_definition_id',
        createdAt: 'm.created_at',
      };
    case SEARCH_ENTITY_TYPES.BillingRecord:
      return {
        status: 'br.status',
        clientId: 'br.client_id',
        serviceDefinitionId: 'so.service_definition_id',
        createdAt: 'br.created_at',
      };
    default:
      return {
        status: 'status',
        clientId: 'client_id',
        serviceDefinitionId: 'service_definition_id',
        createdAt: 'created_at',
      };
  }
}

function matchClause(
  query: NormalizedSearchQuery,
  templates: Record<NormalizedSearchQuery['kind'], string>,
): { clause: string; params: unknown[] } | null {
  const template = templates[query.kind];
  if (!template || template === 'FALSE') {
    return null;
  }

  if (query.kind === 'text') {
    const usesSecondParam = template.includes('$2');
    if (usesSecondParam) {
      return { clause: template, params: [query.term, query.prefixTerm] };
    }
    return { clause: template, params: [query.prefixTerm] };
  }

  if (query.kind === 'code') {
    return { clause: template, params: [query.prefixTerm] };
  }

  return { clause: template, params: [query.term] };
}

function clientSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'c.id = $1::uuid',
    cnpj: 'c.normalized_tax_id = $1',
    code: 'c.external_erp_id ILIKE $1',
    plate: 'FALSE',
    text: '(c.legal_name % $1::text OR c.trade_name % $1::text OR c.legal_name ILIKE $2 OR c.trade_name ILIKE $2)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT c.id::text AS entity_id,
                          COALESCE(NULLIF(c.trade_name, ''), c.legal_name) AS title,
                          c.legal_name AS subtitle,
                          c.status::text AS status,
                          c.created_at AS occurred_at,
                          '/app/clients/' || c.id::text AS entity_href,
                          COALESCE(NULLIF(c.trade_name, ''), c.legal_name) AS highlight`,
    fromClause: 'rpt.read_clients c',
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'c.created_at DESC, c.id DESC',
  };
}

function serviceRequestSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'sr.id = $1::uuid',
    cnpj: 'FALSE',
    code: '(sr.request_code ILIKE $1 OR sr.external_origin_reference ILIKE $1)',
    plate: 'FALSE',
    text: '(sr.description ILIKE $1 OR sr.request_code ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT sr.id::text AS entity_id,
                          sr.request_code AS title,
                          sr.description AS subtitle,
                          sr.status::text AS status,
                          sr.created_at AS occurred_at,
                          '/app/requests/' || sr.id::text AS entity_href,
                          sr.request_code AS highlight`,
    fromClause: 'rpt.read_service_requests sr',
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'sr.created_at DESC, sr.id DESC',
  };
}

function proposalSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'p.id = $1::uuid',
    cnpj: "pv.client_snapshot->>'normalizedTaxId' = $1",
    code: 'p.proposal_code ILIKE $1',
    plate: 'FALSE',
    text: '(p.title ILIKE $1 OR p.proposal_code ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT p.id::text AS entity_id,
                          p.proposal_code AS title,
                          p.title AS subtitle,
                          pv.status::text AS status,
                          p.created_at AS occurred_at,
                          '/app/proposals/' || p.id::text AS entity_href,
                          p.proposal_code AS highlight`,
    fromClause: `rpt.read_proposals p
                 INNER JOIN LATERAL (
                   SELECT status, client_snapshot
                   FROM rpt.read_proposal_versions
                   WHERE proposal_id = p.id
                   ORDER BY version_number DESC
                   LIMIT 1
                 ) pv ON TRUE`,
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'p.created_at DESC, p.id DESC',
  };
}

function purchaseOrderSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'po.id = $1::uuid',
    cnpj: "po.client_snapshot->>'normalizedTaxId' = $1",
    code: '(po.internal_code ILIKE $1 OR po.po_number ILIKE $1 OR po.rc_number ILIKE $1)',
    plate: 'FALSE',
    text: '(po.po_number ILIKE $1 OR po.rc_number ILIKE $1 OR po.internal_code ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT po.id::text AS entity_id,
                          COALESCE(po.po_number, po.internal_code) AS title,
                          po.rc_number AS subtitle,
                          po.status::text AS status,
                          po.created_at AS occurred_at,
                          '/app/purchase-orders/' || po.id::text AS entity_href,
                          COALESCE(po.po_number, po.internal_code) AS highlight`,
    fromClause: 'rpt.read_purchase_orders po',
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'po.created_at DESC, po.id DESC',
  };
}

function serviceOrderSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'so.id = $1::uuid',
    cnpj: "so.client_snapshot->>'normalizedTaxId' = $1",
    code: '(so.order_number ILIKE $1 OR so.internal_code ILIKE $1 OR so.rc_number ILIKE $1)',
    plate: 'FALSE',
    text: '(so.order_number ILIKE $1 OR so.internal_code ILIKE $1 OR so.description ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT so.id::text AS entity_id,
                          so.order_number AS title,
                          so.description AS subtitle,
                          so.status::text AS status,
                          so.created_at AS occurred_at,
                          '/app/service-orders/' || so.id::text || '/planning' AS entity_href,
                          so.order_number AS highlight`,
    fromClause: 'rpt.read_service_orders so',
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'so.created_at DESC, so.id DESC',
  };
}

function assetSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'a.id = $1::uuid',
    cnpj: 'FALSE',
    code: 'a.asset_code ILIKE $1',
    plate: 'vp.normalized_plate = $1',
    text: '(a.name % $1::text OR a.asset_code ILIKE $2)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT a.id::text AS entity_id,
                          a.asset_code AS title,
                          a.name AS subtitle,
                          a.lifecycle_status::text AS status,
                          a.created_at AS occurred_at,
                          '/app/assets/' || a.id::text AS entity_href,
                          a.asset_code AS highlight`,
    fromClause: `rpt.read_physical_assets a
                 LEFT JOIN rpt.read_vehicle_profiles vp ON vp.asset_id = a.id`,
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'a.created_at DESC, a.id DESC',
  };
}

function documentSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'd.id = $1::uuid',
    cnpj: 'FALSE',
    code: 'so.original_filename ILIKE $1',
    plate: 'FALSE',
    text: '(d.title % $1::text OR d.title ILIKE $2 OR so.original_filename ILIKE $2)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT d.id::text AS entity_id,
                          d.title AS title,
                          so.original_filename AS subtitle,
                          d.status::text AS status,
                          d.created_at AS occurred_at,
                          '/app/requests' AS entity_href,
                          d.title AS highlight`,
    fromClause: `rpt.read_documents d
                 LEFT JOIN LATERAL (
                   SELECT so.original_filename
                   FROM rpt.read_document_versions dv
                   INNER JOIN rpt.read_stored_objects so ON so.id = dv.stored_object_id
                   WHERE dv.document_id = d.id
                   ORDER BY dv.version_number DESC
                   LIMIT 1
                 ) so ON TRUE`,
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'd.created_at DESC, d.id DESC',
  };
}

function measurementSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'm.id = $1::uuid',
    cnpj: 'FALSE',
    code: '(so.order_number ILIKE $1 OR so.internal_code ILIKE $1)',
    plate: 'FALSE',
    text: '(so.order_number ILIKE $1 OR so.internal_code ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT m.id::text AS entity_id,
                          so.order_number AS title,
                          m.status::text AS subtitle,
                          m.status::text AS status,
                          m.created_at AS occurred_at,
                          '/app/service-orders/' || m.service_order_id::text || '/measurement' AS entity_href,
                          so.order_number AS highlight`,
    fromClause: `rpt.read_measurements m
                 INNER JOIN rpt.read_service_orders so ON so.id = m.service_order_id`,
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'm.created_at DESC, m.id DESC',
  };
}

function billingRecordSearchQuery(
  query: NormalizedSearchQuery,
  filterClause: string,
  filterParams: unknown[],
): EntitySearchQuery | null {
  const match = matchClause(query, {
    uuid: 'br.id = $1::uuid',
    cnpj: 'br.client_tax_id_snapshot = $1',
    code: '(so.order_number ILIKE $1 OR so.internal_code ILIKE $1 OR br.contract_reference ILIKE $1)',
    plate: 'FALSE',
    text: '(br.client_legal_name_snapshot ILIKE $1 OR so.order_number ILIKE $1)',
  });
  if (!match) {
    return null;
  }

  return {
    selectClause: `SELECT br.id::text AS entity_id,
                          COALESCE(so.order_number, br.id::text) AS title,
                          br.client_legal_name_snapshot AS subtitle,
                          br.status::text AS status,
                          br.created_at AS occurred_at,
                          '/app/service-orders/' || br.service_order_id::text || '/billing' AS entity_href,
                          COALESCE(so.order_number, br.client_legal_name_snapshot) AS highlight`,
    fromClause: `rpt.read_billing_records br
                 INNER JOIN rpt.read_service_orders so ON so.id = br.service_order_id`,
    predicate: `(${match.clause}) AND (${filterClause})`,
    params: [...match.params, ...filterParams],
    orderBy: 'br.created_at DESC, br.id DESC',
  };
}
