import { Injectable } from '@nestjs/common';
import { toResourceContextFromReceivable } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope, hasPolicyAndGrantScopeBatch } from '../../authorization/services/domain-grant-authz.helper';
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

  /**
   * Filtro de listagem: um veredito por recebivel, com as leituras de grants feitas uma vez.
   *
   * `audit: false` porque o acesso ja foi auditado uma vez em `assertReceivableList` — a leitura
   * do proprio recurso e UMA, e nao uma por linha da pagina.
   */
  async filterReceivableList(
    actor: IdentityAuthzContext,
    receivables: Array<{ id: string; unitId: string; clientId: string }>,
  ): Promise<boolean[]> {
    return hasPolicyAndGrantScopeBatch(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinanceReceivableList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
        contexts: receivables.map((receivable) => toResourceContextFromReceivable(receivable)),
        audit: false,
      },
    );
  }
}
