import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
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

@Injectable()
export class ServiceOrdersAccessAuthz {
  constructor(
    private readonly repository: ServiceOrdersRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
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
      if (!grants.some((grant) => grant.scope_type === AUTHZ_SCOPES.Assigned)) {
        throw serviceOrdersAccessDenied();
      }
    }
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
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw serviceOrdersAccessDenied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ServiceOrdersServiceOrderCreate,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      if (grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === unitId) {
        return true;
      }
      if (clientId && grant.scope_type === AUTHZ_SCOPES.Client && grant.resource_id === clientId) {
        return true;
      }
      return false;
    });
    if (!hasAccess) {
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
    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      if (grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === row.unit_id) {
        return true;
      }
      if (
        row.client_id &&
        grant.scope_type === AUTHZ_SCOPES.Client &&
        grant.resource_id === row.client_id
      ) {
        return true;
      }
      if (grant.scope_type === AUTHZ_SCOPES.Assigned && row.assigned_identity_id === actor.identityId) {
        return !grant.resource_id || grant.resource_id === row.id;
      }
      return false;
    });
    if (!hasAccess) {
      throw serviceOrdersAccessDenied();
    }
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
