import { Injectable } from '@nestjs/common';
import { OperationalUnitDirectoryService } from '../../establishments/services/operational-unit-directory.service';
import { AuthorizationRepository, type GrantRow } from '../../authorization/repositories/authorization.repository';
import { ScopeContextRepository } from '../../authorization/repositories/scope-context.repository';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import {
  toResourceContextFromProposal,
  toResourceContextFromPurchaseOrder,
  toResourceContextFromServiceOrder,
} from '../../authorization/scope/scope-matcher';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { PROPOSAL_VERSION_STATUSES } from '../../commercial/domain/proposal';
import { PURCHASE_ORDER_STATUSES } from '../../commercial/domain/purchase-order';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import { ServiceOrdersRepository } from '../repositories/service-orders.repository';
import {
  serviceOrdersAccessDenied,
  serviceOrdersInvalidState,
  serviceOrdersProposalNotFound,
  serviceOrdersPurchaseOrderNotFound,
} from './service-orders-access.errors';

/**
 * Direct-grant predicate used by the OS detail's record authorization.
 * Deliberately narrower than the generic scope matcher: this reproduces
 * the existing GLOBAL / UNIT / CLIENT / ASSIGNED semantics of assertRecordAction.
 * A role-only PDP allowance does not bypass the detail's direct-grant check.
 */
function grantCoversServiceOrderRecord(grant: GrantRow, identityId: string, row: ServiceOrderRow): boolean {
  if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
    return true;
  }
  if (grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === row.unit_id) {
    return true;
  }
  if (row.client_id && grant.scope_type === AUTHZ_SCOPES.Client && grant.resource_id === row.client_id) {
    return true;
  }
  if (grant.scope_type === AUTHZ_SCOPES.Assigned && row.assigned_identity_id === identityId) {
    return !grant.resource_id || grant.resource_id === row.id;
  }
  return false;
}

@Injectable()
export class ServiceOrdersAccessAuthz {
  constructor(
    private readonly repository: ServiceOrdersRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeContextRepository: ScopeContextRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
    private readonly operationalUnits: OperationalUnitDirectoryService,
  ) {}

  async getListScopeFilter(actor: IdentityAuthzContext) {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    return this.scopeEnforcement.buildServiceOrderListFilter(grants, actor.identityId);
  }

  async assertListAction(actor: IdentityAuthzContext): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      const grants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      );
      // The batch PDP has no UNIT context here; permit only a scoped-list
      // mismatch backed by a real direct grant. The SQL scope filter still
      // constrains every returned OS. Other DENY reasons remain fail-closed.
      const scopedGrant = grants.some((grant) =>
        grant.scope_type === AUTHZ_SCOPES.Unit ||
        grant.scope_type === AUTHZ_SCOPES.Client ||
        grant.scope_type === AUTHZ_SCOPES.Assigned
      );
      if (decision.reasonCode !== 'SCOPE_MISMATCH' || !scopedGrant) {
        throw serviceOrdersAccessDenied();
      }
    }
  }

  /**
   * Unidades registradas que o ator pode usar no comando de criação de OS.
   *
   * A decisão é a MESMA do POST de criação: PDP + capability `service-order:create` + contexto
   * da unidade. O endpoint não reaproveita a listagem de Requests e não trata scope_ref global
   * como autorização do usuário.
   */
  async listCreateAuthorizedUnitIds(actor: IdentityAuthzContext): Promise<string[]> {
    const [directGrants, roleDerived, registeredUnitIds] = await Promise.all([
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.authorizationRepository.findRoleDerivedActionRows(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
      ),
      this.scopeContextRepository.listUnitScopeRefs(),
    ]);

    if (directGrants.length === 0 && roleDerived.length === 0) {
      throw serviceOrdersAccessDenied();
    }
    if (registeredUnitIds.length === 0) {
      return [];
    }

    const decisions = await this.policyDecisionPoint.decideBatch(
      actor,
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      },
      registeredUnitIds.map((unitId) => ({ unitId })),
      { audit: false },
    );

    return registeredUnitIds.filter((_, index) => decisions[index]?.result === 'ALLOW');
  }

  /** Authorization is evaluated per UNIT before directory metadata is read. */
  async listCreateAuthorizedUnitOptions(actor: IdentityAuthzContext): Promise<{
    items: string[];
    details: Array<{ id: string; code: string | null; name: string | null; configured: boolean }>;
  }> {
    const items = await this.listCreateAuthorizedUnitIds(actor);
    const directory = await this.operationalUnits.listDetails(items);
    const byId = new Map(directory.map((unit) => [unit.id, unit]));
    return {
      items,
      details: items.map((id) => {
        const unit = byId.get(id);
        return { id, code: unit?.code ?? null, name: unit?.name ?? null, configured: unit !== undefined };
      }),
    };
  }

  /** Operational discovery uses LIST/read grants, NEVER create or dispatch grants. */
  async listOperationAuthorizedUnitOptions(actor: IdentityAuthzContext): Promise<{
    items: string[];
    details: Array<{ id: string; code: string | null; name: string | null; configured: boolean }>;
  }> {
    const [direct, roleDerived, registered] = await Promise.all([
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.authorizationRepository.findRoleDerivedActionRows(
        actor.identityId,
        AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
      ),
      this.scopeContextRepository.listUnitScopeRefs(),
    ]);
    if (direct.length === 0 && roleDerived.length === 0) throw serviceOrdersAccessDenied();
    const decisions = await this.policyDecisionPoint.decideBatch(
      actor,
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderList,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      },
      registered.map(unitId => ({ unitId })),
      { audit: false },
    );
    const items = registered.filter((_, i) => decisions[i]?.result === 'ALLOW');
    const directory = await this.operationalUnits.listDetails(items);
    const byId = new Map(directory.map(unit => [unit.id, unit]));
    return {
      items,
      details: items.map(id => {
        const unit = byId.get(id);
        return { id, code: unit?.code ?? null, name: unit?.name ?? null, configured: unit !== undefined };
      }),
    };
  }

  async assertCreateAction(
    actor: IdentityAuthzContext,
    unitId: string,
    clientId?: string,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: {
          unitId,
          ...(clientId ? { clientId } : {}),
        },
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw serviceOrdersAccessDenied();
    }
  }

  async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    row: ServiceOrderRow,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: toResourceContextFromServiceOrder(row),
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw serviceOrdersAccessDenied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const hasAccess = grants.some((grant) =>
      grantCoversServiceOrderRecord(grant, actor.identityId, row),
    );
    if (!hasAccess) {
      throw serviceOrdersAccessDenied();
    }
  }

  /**
   * Batch read-visibility for Work Inbox, using the very same record-READ
   * authorization semantics as getById. LIST is not proof of READ.
   * One PDP batch and one direct-grant fetch per page (no per-row queries).
   * This method returns no denied rows or metadata to the caller.
   */
  async filterReadableRows(
    actor: IdentityAuthzContext,
    rows: ServiceOrderRow[],
  ): Promise<ServiceOrderRow[]> {
    if (rows.length === 0) return [];
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    if (grants.length === 0) return [];

    const decisions = await this.policyDecisionPoint.decideBatch(
      actor,
      {
        action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      },
      rows.map(toResourceContextFromServiceOrder),
      { audit: false },
    );
    return rows.filter(
      (row, index) =>
        decisions[index]?.result === 'ALLOW' &&
        grants.some((grant) => grantCoversServiceOrderRecord(grant, actor.identityId, row)),
    );
  }

  async assertProposalOrigin(
    actor: IdentityAuthzContext,
    proposalId: string,
    unitId: string,
  ): Promise<void> {
    const proposal = await this.repository.findProposalById(proposalId);
    if (!proposal) {
      throw serviceOrdersProposalNotFound();
    }
    if (proposal.unit_id !== unitId) {
      throw serviceOrdersAccessDenied();
    }
    if (proposal.status !== PROPOSAL_VERSION_STATUSES.Accepted) {
      throw serviceOrdersInvalidState();
    }
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action: AUTHZ_ACTIONS.CommercialProposalRead,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
        context: toResourceContextFromProposal(proposal),
      },
      { audit: false },
    );
    if (decision.result === 'DENY') {
      throw serviceOrdersAccessDenied();
    }
  }

  async assertPurchaseOrderOrigin(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    unitId: string,
    clientId?: string | null,
  ): Promise<void> {
    const purchaseOrder = await this.repository.findPurchaseOrderById(purchaseOrderId);
    if (!purchaseOrder) {
      throw serviceOrdersPurchaseOrderNotFound();
    }
    if (purchaseOrder.unit_id !== unitId) {
      throw serviceOrdersAccessDenied();
    }
    if (purchaseOrder.status !== PURCHASE_ORDER_STATUSES.Registered) {
      throw serviceOrdersInvalidState('Purchase order must be registered.');
    }
    if (!clientId || clientId !== purchaseOrder.client_id) {
      throw serviceOrdersInvalidState('Service order client must match the purchase order client.');
    }
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action: AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
        resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
        context: toResourceContextFromPurchaseOrder(purchaseOrder),
      },
      { audit: false },
    );
    if (decision.result === 'DENY') {
      throw serviceOrdersAccessDenied();
    }
  }
}
