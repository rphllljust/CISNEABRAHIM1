import { Injectable } from '@nestjs/common';
import { toResourceContextFromAccounting } from '../../authorization/scope/scope-matcher';
import {
  assertListAccess,
  assertPolicyAndGrantScope,
  hasPolicyAndGrantScope,
} from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { AUTHZ_ACTIONS, type AuthzAction } from '../../authorization/types/authz-actions';
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
   * Gate de LISTAGEM do registro de ativo imobilizado.
   *
   * A capacidade e `accounting:fixed-asset:read`, a MESMA da leitura por ativo — mas o gate e
   * `assertListAccess` (capacidade + ao menos um grant aplicavel) e nao
   * `assertAccountingAction`, porque nao existe um registro unico para compor contexto: a
   * listagem e anterior a escolha do registro. Usar `assertAccountingAction` aqui exigiria um
   * `id`/`unitId` de registro que o solicitante ainda nao tem.
   *
   * Sem este gate, quem nao tem concessao receberia `{ items: [], total: 0 }` em vez de 403 —
   * lista vazia mascarando negacao como ausencia de dado. E o mesmo defeito ja corrigido em
   * contas a pagar.
   */
  async assertFixedAssetList(actor: IdentityAuthzContext): Promise<void> {
    await assertListAccess(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.AccountingFixedAssetRead,
        resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
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
