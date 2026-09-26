import { Injectable } from '@nestjs/common';
import { toResourceContextFromReceivable } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { AUTHZ_ACTIONS, type AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { financeAccessDenied } from './receivables-access.errors';

@Injectable()
export class ReceivablesAccessAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async assertReceivableList(actor: IdentityAuthzContext): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinanceReceivableList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
        onDenied: financeAccessDenied,
      },
    );
  }

  async assertReceivableAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    receivable: { id: string; unitId: string; clientId: string },
  ): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
        context: toResourceContextFromReceivable(receivable),
        onDenied: financeAccessDenied,
      },
    );
  }
}
