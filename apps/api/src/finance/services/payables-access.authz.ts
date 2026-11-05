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
   * Gate de LISTAGEM de categorias de despesa.
   *
   * `fin.expense_categories` e cadastro GLOBAL: nao possui `unit_id` e a leitura nao e escopada
   * por unidade. Por isso usa `assertListAccess` (capability valida + ao menos um grant
   * aplicavel), o MESMO helper das demais listagens do modulo — nao se cria um caminho de
   * autorizacao paralelo so porque a entidade e um catalogo.
   *
   * A acao e `finance:expense-category:list`, distinta de `:create`: separar cadastro de uso
   * operacional e o que permite a segregacao de funcoes distinguir as duas coisas.
   */
  async assertExpenseCategoryList(actor: IdentityAuthzContext): Promise<void> {
    await assertListAccess(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinanceExpenseCategoryList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        onDenied: payableAccessDenied,
      },
    );
  }

  /**
   * Gate de LISTAGEM de centro de custo.
   *
   * MESMO helper (`assertListAccess`) das demais listagens do Financeiro. O centro de custo e um
   * cadastro de referencia: nao possui unidade propria, entao a leitura nao recebe recorte de
   * unidade — o escopo organizacional do dado nao e inventado aqui.
   */
  async assertCostCenterList(actor: IdentityAuthzContext): Promise<void> {
    await assertListAccess(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinanceCostCenterList,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        onDenied: payableAccessDenied,
      },
    );
  }

  /** Gate de CADASTRO de centro de custo — acao propria, separada da listagem. */
  async assertCostCenterCreate(actor: IdentityAuthzContext): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action: AUTHZ_ACTIONS.FinanceCostCenterCreate,
        resourceType: AUTHZ_RESOURCE_TYPES.FinancePayable,
        context: { unitId: 'global', ownerIdentityId: actor.identityId },
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
