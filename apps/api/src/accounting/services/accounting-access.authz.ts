import { Injectable } from '@nestjs/common';
import { toResourceContextFromAccounting } from '../../authorization/scope/scope-matcher';
import {
  assertPolicyAndGrantScope,
  hasPolicyAndGrantScope,
} from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { accountingAccessDenied } from './accounting-access.errors';

@Injectable()
export class AccountingAccessAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async assertAccountingAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    resource: { id: string; unitId: string },
  ): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
        context: toResourceContextFromAccounting(resource),
        onDenied: accountingAccessDenied,
      },
    );
  }

  /**
   * Avaliação NÃO lançante da mesma decisão.
   *
   * F1.1 — existe para FILTRAR `availableCommands` em vez de negar a leitura inteira
   * da trilha. Quem pode ver o fato mas não pode reprocessar posting continua vendo a
   * trilha completa; simplesmente não recebe o comando de reprocessar. Usa o MESMO
   * caminho autoritativo (PDP + grants) — nenhuma segunda regra de autorização.
   */
  async hasAccountingAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    resource?: { id: string; unitId: string },
  ): Promise<boolean> {
    return hasPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
        context: resource ? toResourceContextFromAccounting(resource) : undefined,
      },
    );
  }
}
