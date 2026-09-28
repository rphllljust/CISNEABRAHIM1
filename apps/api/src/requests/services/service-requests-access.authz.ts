import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import {
  assertPolicyAndGrantScope,
  hasPolicyAndGrantScope,
} from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import {
  toResourceContextFromClient,
  toResourceContextFromServiceRequest,
} from '../../authorization/scope/scope-matcher';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type {
  ServiceRequestLinkedRow,
  ServiceRequestRow,
} from '../repositories/service-requests.repository.types';
import { serviceRequestsAccessDenied } from './service-requests-access.errors';

@Injectable()
export class ServiceRequestsAccessAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  private get deps() {
    return {
      authorizationRepository: this.authorizationRepository,
      policyDecisionPoint: this.policyDecisionPoint,
    };
  }

  async assertCreateAction(
    actor: IdentityAuthzContext,
    clientId: string | undefined,
    unitId: string,
  ): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.RequestsServiceRequestCreate,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      context: { clientId: clientId ?? undefined, unitId },
      onDenied: serviceRequestsAccessDenied,
    });
  }

  async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    row: ServiceRequestRow,
  ): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      context: toResourceContextFromServiceRequest(row),
      onDenied: serviceRequestsAccessDenied,
    });
  }

  async assertListAction(actor: IdentityAuthzContext): Promise<void> {
    await assertPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.RequestsServiceRequestList,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      onDenied: serviceRequestsAccessDenied,
    });
  }

  /**
   * Avalia uma acao de registro SEM lancar — usada para montar a prontidao do workbench
   * (quais transicoes ESTE ator pode executar) sem negar a leitura do detalhe.
   */
  async canPerformRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    row: ServiceRequestRow,
  ): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
      context: toResourceContextFromServiceRequest(row),
    });
  }

  /**
   * Filtra, entre os clientes citados por solicitacoes que o ator ja pode ler, aqueles que o ator
   * tambem pode ler no modulo CLIENTES (`client:client:read` + contexto do cliente).
   *
   * `requests:service-request:read` NAO autoriza ler cliente: sem essa concessao a solicitacao
   * continua visivel, mas o nome do cliente nao e devolvido. A decisao e memorizada por cliente,
   * entao uma pagina inteira custa no maximo uma avaliacao por cliente distinto.
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
   * Filtra a cadeia empresarial da solicitacao pelo que ESTE ator pode ler, elo por elo.
   *
   * `requests:service-request:read` NAO autoriza ler proposta, pedido de compra nem ordem de
   * servico. Cada elo e avaliado com a MESMA acao, o MESMO resource type e o MESMO contexto que o
   * modulo dono usa para ler aquela entidade:
   *
   * - PROPOSAL        -> `commercial:proposal:read` / `commercial:proposal`
   * - PURCHASE_ORDER  -> `commercial:purchase-order:read` / `commercial:purchase-order`
   * - SERVICE_ORDER   -> `service-orders:service-order:read` / `service-orders:service-order`
   *
   * Elo sem autorizacao e REMOVIDO — nao vai numero, status, rotulo, data nem link. A decisao e
   * memorizada por sujeito de autorizacao, entao a cadeia custa no maximo uma avaliacao por elo.
   */
  async filterAuthorizedLinkedChain(
    actor: IdentityAuthzContext,
    rows: ServiceRequestLinkedRow[],
  ): Promise<Set<string>> {
    const allowed = new Set<string>();
    const decisions = new Map<string, boolean>();

    for (const row of rows) {
      let action: AuthzAction | null = null;
      let resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES] | null =
        null;
      if (row.kind === 'PROPOSAL') {
        action = AUTHZ_ACTIONS.CommercialProposalRead;
        resourceType = AUTHZ_RESOURCE_TYPES.CommercialProposal;
      } else if (row.kind === 'PURCHASE_ORDER') {
        action = AUTHZ_ACTIONS.CommercialPurchaseOrderRead;
        resourceType = AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;
      } else if (row.kind === 'SERVICE_ORDER') {
        action = AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead;
        resourceType = AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
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

  async findListGrants(actor: IdentityAuthzContext) {
    await this.assertListAction(actor);
    return this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.RequestsServiceRequestList,
      AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
    );
  }
}
