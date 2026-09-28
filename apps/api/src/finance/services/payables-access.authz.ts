import { Injectable } from '@nestjs/common';
import { toResourceContextFromPayable } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope, hasPolicyAndGrantScopeBatch } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { AUTHZ_ACTIONS, type AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { payableAccessDenied } from './payables-access.errors';

@Injectable()
export class PayablesAccessAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async assertPayableAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    payable: { id: string; unitId: string },
  ): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        context: toResourceContextFromPayable(payable),
        onDenied: payableAccessDenied,
      },
    );
  }

  /**
   * Filtro de listagem: um veredito por conta a pagar, com as leituras de grants feitas uma vez.
   *
   * Aqui NAO existe uma checagem de lista separada, entao a auditoria da decisao acontece uma
   * unica vez para o lote (o default de `decideBatch`) em vez de uma por linha.
   */
  async filterPayableList(
    actor: IdentityAuthzContext,
    payables: Array<{ id: string; unitId: string }>,
  ): Promise<boolean[]> {
    return hasPolicyAndGrantScopeBatch(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinancePayableList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        contexts: payables.map((payable) => toResourceContextFromPayable(payable)),
      },
    );
  }
}
