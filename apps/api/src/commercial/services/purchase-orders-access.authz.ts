import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import {
  assertPolicyAndGrantScope,
  hasPolicyAndGrantScope,
} from '../../authorization/services/domain-grant-authz.helper';
import { toResourceContextFromPurchaseOrder } from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { PurchaseOrderRow } from '../repositories/purchase-orders.repository.types';
import { purchaseOrdersAccessDenied } from './purchase-orders-access.errors';

@Injectable()
export class PurchaseOrdersAccessAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  private get deps() {
    return {
      authorizationRepository: this.authorizationRepository,
      policyDecisionPoint: this.policyDecisionPoint,
    };
  }

  async assertCreateAction(
    actor: IdentityAuthzContext,
    clientId: string,
    unitId: string,
  ): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.CommercialPurchaseOrderCreate,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      context: { clientId, unitId },
      onDenied: purchaseOrdersAccessDenied,
    });
  }

  async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    purchaseOrder: PurchaseOrderRow,
  ): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      context: toResourceContextFromPurchaseOrder(purchaseOrder),
      onDenied: purchaseOrdersAccessDenied,
    });
  }

  async buildListScopeFilter(actor: IdentityAuthzContext): Promise<{
    clause: string;
    params: unknown[];
  }> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.CommercialPurchaseOrderList,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
      onDenied: purchaseOrdersAccessDenied,
    });

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.CommercialPurchaseOrderList,
      AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
    );
    return this.scopeEnforcement.buildPurchaseOrderListFilter(grants);
  }

  /**
   * Filtra a cadeia relacionada pelo que ESTE ator pode ler, elo por elo.
   *
   * `commercial:purchase-order:read` NAO autoriza ler solicitacao, OS, medicao ou faturamento.
   * Cada elo e avaliado com a MESMA acao, o MESMO resource type e o MESMO contexto que o modulo
   * dono usa para ler aquela entidade:
   *
   * - REQUEST           -> `requests:service-request:read` / `requests:service-request`
   * - SERVICE_ORDER     -> `service-orders:service-order:read` / `service-orders:service-order`
   * - MEASUREMENT       -> a medicao pertence a OS: avaliada como leitura da OS dona
   * - BILLING_RECORD    -> o faturamento e autorizado contra a OS dona (mesmo caminho do modulo
   * - BILLING_DOCUMENT     de billing: acao de billing + resource type da OS + contexto da OS)
   *
   * Elo sem autorizacao e REMOVIDO — nao vai nome, status, valor, numero nem link. A decisao e
   * memorizada por sujeito de autorizacao (id da solicitacao ou da OS), entao a cadeia inteira
   * custa no maximo uma avaliacao por documento, nunca uma por linha crua.
   */
  async filterAuthorizedLinkedChain(
    actor: IdentityAuthzContext,
    rows: Array<{
      kind: string;
      id: string;
      parent_id: string | null;
      unit_id: string;
      client_id: string | null;
    }>,
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    const decisions = new Map<string, boolean>();

    const decide = async (
      subjectId: string,
      action: AuthzAction,
      resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
      row: { unit_id: string; client_id: string | null },
    ): Promise<boolean> => {
      const cacheKey = `${action}:${subjectId}`;
      const cached = decisions.get(cacheKey);
      if (cached !== undefined) {
        return cached;
      }
      const granted = await hasPolicyAndGrantScope(this.deps, {
        actor,
        action,
        resourceType,
        context: { resourceId: subjectId, unitId: row.unit_id, clientId: row.client_id ?? undefined },
      });
      decisions.set(cacheKey, granted);
      return granted;
    };

    for (const row of rows) {
      // Billing e medicao sao lidos no contexto da OS dona (parent_id); sem OS conhecida, nega.
      const serviceOrderId = row.parent_id;
      let granted = false;
      if (row.kind === 'REQUEST') {
        granted = await decide(
          row.id,
          AUTHZ_ACTIONS.RequestsServiceRequestRead,
          AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
          row,
        );
      } else if (row.kind === 'SERVICE_ORDER') {
        granted = await decide(
          row.id,
          AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
          AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
          row,
        );
      } else if (row.kind === 'MEASUREMENT') {
        granted =
          serviceOrderId !== null &&
          (await decide(
            serviceOrderId,
            AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            row,
          ));
      } else if (row.kind === 'BILLING_RECORD') {
        granted =
          serviceOrderId !== null &&
          (await decide(
            serviceOrderId,
            AUTHZ_ACTIONS.BillingBillingRecordRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            row,
          ));
      } else if (row.kind === 'BILLING_DOCUMENT') {
        granted =
          serviceOrderId !== null &&
          (await decide(
            serviceOrderId,
            AUTHZ_ACTIONS.BillingBillingDocumentRead,
            AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
            row,
          ));
      }

      if (granted) {
        allowed.add(`${row.kind}:${row.id}`);
      }
    }

    return allowed;
  }
}
