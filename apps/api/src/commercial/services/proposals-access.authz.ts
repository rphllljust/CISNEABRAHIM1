import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import {
  assertPolicyAndGrantScope,
  hasPolicyAndGrantScope,
} from '../../authorization/services/domain-grant-authz.helper';
import {
  toResourceContextFromClient,
  toResourceContextFromProposal,
} from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { ProposalLinkedRow, ProposalRow } from '../repositories/proposals.repository.types';
import { proposalsAccessDenied } from './proposals-access.errors';

@Injectable()
export class ProposalsAccessAuthz {
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
      action: AUTHZ_ACTIONS.CommercialProposalCreate,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      context: { clientId, unitId },
      onDenied: proposalsAccessDenied,
    });
  }

  async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    proposal: ProposalRow,
  ): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      context: toResourceContextFromProposal(proposal),
      onDenied: proposalsAccessDenied,
    });
  }

  async buildListScopeFilter(actor: IdentityAuthzContext): Promise<{
    clause: string;
    params: unknown[];
  }> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.CommercialProposalList,
      AUTHZ_RESOURCE_TYPES.CommercialProposal,
    );
    if (grants.length === 0) {
      throw proposalsAccessDenied();
    }

    const scopeFilter = this.scopeEnforcement.buildProposalListFilter(grants);
    if (scopeFilter.clause === 'FALSE') {
      throw proposalsAccessDenied();
    }

    return scopeFilter;
  }

  /**
   * Visibilidade de custo interno da proposta.
   *
   * `commercial:proposal:read` NAO autoriza custo: esta decisao e avaliada pela MESMA trilha
   * autoritativa das demais acoes (PDP + grants ativos casados contra o contexto da proposta —
   * recurso, unidade e cliente), com a acao propria `commercial:proposal:read-cost`.
   *
   * Nao ha bypass de capability, nao ha usuario/perfil hardcoded e nao se reutiliza
   * `service-orders:operational-cost:read`, que governa custo operacional da OS em outro dominio.
   */
  async canReadInternalCost(actor: IdentityAuthzContext, proposal: ProposalRow): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.CommercialProposalReadCost,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      context: toResourceContextFromProposal(proposal),
    });
  }

  /**
   * Avalia uma acao de registro SEM lancar — usada para montar a prontidao do workbench (quais
   * transicoes ESTE ator pode executar) sem negar a leitura da proposta.
   */
  async canPerformRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    proposal: ProposalRow,
  ): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
      context: toResourceContextFromProposal(proposal),
    });
  }

  /**
   * Filtra, entre os clientes citados por propostas que o ator ja pode ler, aqueles que o ator
   * tambem pode ler no modulo CLIENTES (`client:client:read` + contexto do cliente).
   *
   * `commercial:proposal:read` NAO autoriza ler cliente: sem essa concessao a proposta continua
   * visivel, mas o nome do cliente nao e devolvido. A decisao e memorizada por cliente, entao uma
   * pagina inteira custa no maximo uma avaliacao por cliente distinto.
   */
  async filterAuthorizedClientIds(
    actor: IdentityAuthzContext,
    clientIds: string[],
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    const decisions = new Map<string, boolean>();
    for (const clientId of clientIds) {
      const cached = decisions.get(clientId);
      const granted =
        cached ??
        (await hasPolicyAndGrantScope(this.deps, {
          actor,
          action: AUTHZ_ACTIONS.ClientRead,
          resourceType: AUTHZ_RESOURCE_TYPES.Client,
          context: toResourceContextFromClient({ id: clientId }),
        }));
      decisions.set(clientId, granted);
      if (granted) {
        allowed.add(clientId);
      }
    }
    return allowed;
  }

  /**
   * Leitura do catalogo de servicos e uma acao global (`catalog:service:read` sem contexto de
   * recurso): UMA avaliacao cobre a pagina inteira.
   */
  async canReadCatalogService(actor: IdentityAuthzContext): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.CatalogServiceRead,
      resourceType: AUTHZ_RESOURCE_TYPES.CatalogService,
    });
  }

  /**
   * Filtra a cadeia comercial pelo que ESTE ator pode ler, elo por elo.
   *
   * `commercial:proposal:read` NAO autoriza ler solicitacao, ordem de servico nem pedido de compra.
   * Cada elo e avaliado com a MESMA acao, o MESMO resource type e o MESMO contexto que o modulo dono
   * usa para ler aquela entidade:
   *
   * - REQUEST        -> `requests:service-request:read` / `requests:service-request`
   * - SERVICE_ORDER  -> `service-orders:service-order:read` / `service-orders:service-order`
   * - PURCHASE_ORDER -> `commercial:purchase-order:read` / `commercial:purchase-order`
   *
   * Elo sem autorizacao e REMOVIDO — nao vai numero, status, rotulo, data nem link. A decisao e
   * memorizada por sujeito de autorizacao.
   */
  async filterAuthorizedLinkedChain(
    actor: IdentityAuthzContext,
    rows: ProposalLinkedRow[],
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    const decisions = new Map<string, boolean>();

    for (const row of rows) {
      let action: AuthzAction | null = null;
      let resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES] | null =
        null;
      if (row.kind === 'REQUEST') {
        action = AUTHZ_ACTIONS.RequestsServiceRequestRead;
        resourceType = AUTHZ_RESOURCE_TYPES.RequestsServiceRequest;
      } else if (row.kind === 'SERVICE_ORDER') {
        action = AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead;
        resourceType = AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
      } else if (row.kind === 'PURCHASE_ORDER') {
        action = AUTHZ_ACTIONS.CommercialPurchaseOrderRead;
        resourceType = AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;
      }

      if (!action || !resourceType) {
        continue;
      }

      const cacheKey = `${action}:${row.id}`;
      const cached = decisions.get(cacheKey);
      const granted =
        cached ??
        (await hasPolicyAndGrantScope(this.deps, {
          actor,
          action,
          resourceType,
          context: {
            resourceId: row.id,
            unitId: row.unit_id,
            clientId: row.client_id ?? undefined,
          },
        }));
      decisions.set(cacheKey, granted);
      if (granted) {
        allowed.add(`${row.kind}:${row.id}`);
      }
    }

    return allowed;
  }
}
