import { Injectable } from '@nestjs/common';
import type { GrantRow } from '../repositories/authorization.repository';
import { ScopeResolverService } from './scope-resolver.service';
import { AUTHZ_SCOPES } from '../types/authz-scopes';

const UUID_V4ISH = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ScopeSqlPredicate = {
  clause: string;
  params: unknown[];
};

@Injectable()
export class ScopeEnforcementService {
  constructor(private readonly scopeResolver: ScopeResolverService) {}

  assertValidClientResourceId(resourceId: string): void {
    if (!UUID_V4ISH.test(resourceId)) {
      throw new Error('INVALID_RESOURCE_ID');
    }
  }

  /**
   * Constrói filtro SQL obrigatório para listagem — nega por omissão (sem grant → 1=0).
   */
  buildScopedRecordListFilter(grants: GrantRow[], identityId: string): ScopeSqlPredicate {
    const clauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    for (const grant of grants) {
      switch (grant.scope_type) {
        case AUTHZ_SCOPES.Global:
          if (grant.resource_id === null) {
            return { clause: 'TRUE', params: [] };
          }
          break;
        case AUTHZ_SCOPES.Own:
          clauses.push(`owner_identity_id = $${paramIndex++}`);
          params.push(identityId);
          break;
        case AUTHZ_SCOPES.Assigned:
          clauses.push(`assigned_identity_id = $${paramIndex++}`);
          params.push(identityId);
          if (grant.resource_id) {
            clauses.push(`id::text = $${paramIndex++}`);
            params.push(grant.resource_id);
          }
          break;
        case AUTHZ_SCOPES.Unit:
          clauses.push(`unit_id = $${paramIndex++}`);
          params.push(grant.resource_id);
          break;
        case AUTHZ_SCOPES.Client:
          clauses.push(`client_id = $${paramIndex++}`);
          params.push(grant.resource_id);
          break;
        case AUTHZ_SCOPES.Contract:
          clauses.push(`contract_id = $${paramIndex++}`);
          params.push(grant.resource_id);
          break;
        case AUTHZ_SCOPES.Document:
          clauses.push(`document_id = $${paramIndex++}`);
          params.push(grant.resource_id);
          break;
        case AUTHZ_SCOPES.Financial:
          clauses.push(`is_financial = TRUE AND contract_id = $${paramIndex++}`);
          params.push(grant.resource_id);
          break;
        default:
          break;
      }
    }

    if (clauses.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    return {
      clause: `(${clauses.join(' OR ')})`,
      params,
    };
  }

  buildClientListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    const hasGlobalListGrant = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobalListGrant) {
      return { clause: 'TRUE', params: [] };
    }

    const clientIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Client && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    if (clientIds.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    return {
      clause: 'id = ANY($1::uuid[])',
      params: [clientIds],
    };
  }

  buildPersonListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    const hasGlobalListGrant = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobalListGrant) {
      return { clause: 'TRUE', params: [] };
    }
    return { clause: 'FALSE', params: [] };
  }

  assertValidPersonResourceId(resourceId: string): void {
    if (!UUID_V4ISH.test(resourceId)) {
      throw new Error('INVALID_RESOURCE_ID');
    }
  }

  buildPhysicalAssetListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    const hasGlobal = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobal) {
      return { clause: 'TRUE', params: [] };
    }

    const unitIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    if (unitIds.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    return {
      clause: 'a.unit_id = ANY($1::text[])',
      params: [unitIds],
    };
  }

  buildDocumentListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    const hasGlobal = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobal) {
      return { clause: 'TRUE', params: [] };
    }

    const unitIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    const documentIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Document && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (unitIds.length > 0) {
      params.push(unitIds);
      clauses.push(`unit_id = ANY($${params.length}::text[])`);
    }
    if (documentIds.length > 0) {
      params.push(documentIds);
      clauses.push(`id::text = ANY($${params.length}::text[])`);
    }

    if (clauses.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    return {
      clause: `(${clauses.join(' OR ')})`,
      params,
    };
  }

  buildProposalListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    return this.buildCommercialRecordListFilter(grants);
  }

  buildPurchaseOrderListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    return this.buildCommercialRecordListFilter(grants);
  }

  buildContractListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    return this.buildCommercialRecordListFilter(grants);
  }

  buildServiceRequestListFilter(grants: GrantRow[]): ScopeSqlPredicate {
    return this.buildCommercialRecordListFilter(grants);
  }

  buildServiceOrderListFilter(grants: GrantRow[], identityId?: string): ScopeSqlPredicate {
    return this.buildCommercialRecordListFilter(grants, {
      assignedIdentityId: identityId,
      tableAlias: 'so',
    });
  }

  private buildCommercialRecordListFilter(
    grants: GrantRow[],
    options?: { assignedIdentityId?: string; tableAlias?: string },
  ): ScopeSqlPredicate {
    const hasGlobal = grants.some(
      (grant) => grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null,
    );
    if (hasGlobal) {
      return { clause: 'TRUE', params: [] };
    }

    const unitIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    const clientIds = grants
      .filter(
        (grant) => grant.scope_type === AUTHZ_SCOPES.Client && grant.resource_id !== null,
      )
      .map((grant) => grant.resource_id as string);

    const clauses: string[] = [];
    const params: unknown[] = [];

    if (unitIds.length > 0) {
      params.push(unitIds);
      clauses.push(`unit_id = ANY($${params.length}::text[])`);
    }
    if (clientIds.length > 0) {
      params.push(clientIds);
      clauses.push(`client_id = ANY($${params.length}::uuid[])`);
    }
    const assignedGrants = grants.filter((grant) => grant.scope_type === AUTHZ_SCOPES.Assigned);
    if (assignedGrants.length > 0 && options?.assignedIdentityId) {
      params.push(options.assignedIdentityId);
      const identityParam = params.length;
      const alias = options.tableAlias ? `${options.tableAlias}.` : '';
      const assignedClause = `EXISTS (
        SELECT 1
        FROM res.resource_allocations ra
        INNER JOIN wrk.workforce_members wm ON wm.id = ra.workforce_member_id
        WHERE ra.service_order_id = ${alias}id
          AND ra.status = 'ACTIVE'::res.resource_allocation_status
          AND wm.status = 'ACTIVE'::wrk.workforce_member_status
          AND wm.identity_id = $${identityParam}::uuid
      )`;
      const assignedResourceIds = assignedGrants
        .filter((grant) => grant.resource_id !== null)
        .map((grant) => grant.resource_id as string);
      if (assignedResourceIds.length > 0) {
        params.push(assignedResourceIds);
        clauses.push(`(${assignedClause} AND ${alias}id::text = ANY($${params.length}::text[]))`);
      }
      if (assignedGrants.some((grant) => grant.resource_id === null)) {
        clauses.push(assignedClause);
      }
    }

    if (clauses.length === 0) {
      return { clause: 'FALSE', params: [] };
    }

    return {
      clause: `(${clauses.join(' OR ')})`,
      params,
    };
  }

  canAccessRecord(
    grants: GrantRow[],
    identityId: string,
    context: Parameters<ScopeResolverService['hasEffectiveAccess']>[2],
  ): boolean {
    return this.scopeResolver.hasEffectiveAccess(grants, identityId, context);
  }
}
