import { Injectable } from '@nestjs/common';
import { toResourceContextFromPayable } from '../../authorization/scope/scope-matcher';
import { assertListAccess, assertPolicyAndGrantScope, hasPolicyAndGrantScopeBatch } from '../../authorization/services/domain-grant-authz.helper';
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
   * Gate de LISTAGEM: capability valida + ao menos um grant aplicavel, sem exigir contexto.
   *
   * SIMETRIA COM RECEIVABLES: antes desta correcao a listagem de contas a pagar NAO tinha gate de
   * lista nenhum, de modo que um ator SEM concessao de lista recebia `{ items: [], total: 0 }` em
   * vez de 403 — lista vazia mascarando negacao como ausencia de dado. O gate passa a ser o mesmo
   * do outro lado do razao, e o escopo por unidade torna-se alcancavel pelo predicado SQL.
   * `assertPayableAction` (detail) mantem o `resourceContext` e nao foi enfraquecido.
   */
  async assertPayableList(actor: IdentityAuthzContext): Promise<void> {
    await assertListAccess(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinancePayableList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        onDenied: payableAccessDenied,
      },
    );
  }

  /**
   * Filtro de listagem: um veredito por conta a pagar, com as leituras de grants feitas uma vez.
   *
   * A decisao de LISTA ja foi auditada em `assertPayableList`; aqui o lote e NAO-auditado.
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
