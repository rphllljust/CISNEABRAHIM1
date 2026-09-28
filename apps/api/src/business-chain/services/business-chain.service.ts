import { HttpException, Injectable } from '@nestjs/common';
import { AUTHZ_ACTIONS, type AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES, type AuthzResourceType } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import {
  buildBusinessChain,
  type BusinessChain,
  type BusinessChainNode,
  type BusinessChainNodeKind,
  type BusinessChainRelation,
} from '../contracts/business-chain.contract';
import {
  BusinessChainRepository,
  businessChainRoute,
  type ChainAnchorKind,
  type ChainNodeFactRow,
} from '../repositories/business-chain.repository';

/**
 * BUSINESS CHAIN — AUTORIZACAO E MONTAGEM.
 *
 * O BACKEND E A FRONTEIRA. A regra `read A != read B` e aplicada AQUI, no servidor:
 *
 * - cada no candidato e avaliado com a CAPABILITY DO PROPRIO DOMINIO e no escopo de
 *   unidade/cliente do PROPRIO registro (o mesmo `PolicyDecisionPointService` que os dominios
 *   usam — nenhuma politica paralela e inventada neste modulo);
 * - no NAO AUTORIZADO simplesmente NAO ENTRA na resposta: sem rotulo, sem contagem, sem
 *   placeholder, sem a palavra "oculto" e sem qualquer sinal de existencia;
 * - consequencia direta: se o ator le a OS mas nao le a contabilidade, a cadeia TERMINA na OS.
 *   O front nunca precisa esconder nada — ele nao recebe nada para esconder.
 *
 * PROVENIENCIA: cada no carrega a RELACAO com o no anterior, decidida pelo proprio caminho
 * resolvido no repositorio. Nao existe ligacao inferida por data, valor ou texto.
 *
 * AUDITORIA: a leitura do proprio ANCHOR e auditada pelo proprio `PolicyDecisionPointService`
 * (uma decisao auditada por requisicao = um evento de acesso). As decisoes dos demais nos sao
 * avaliacoes de escopo DENTRO do mesmo acesso e por isso nao geram um evento por no — a
 * auditoria existente e reusada, nenhuma acao de auditoria nova e inventada.
 */

const NODE_AUTHORIZATION: Record<
  BusinessChainNodeKind,
  { action: AuthzAction; resourceType: AuthzResourceType }
> = {
  CLIENT: { action: AUTHZ_ACTIONS.ClientRead, resourceType: AUTHZ_RESOURCE_TYPES.Client },
  SERVICE_REQUEST: {
    action: AUTHZ_ACTIONS.RequestsServiceRequestRead,
    resourceType: AUTHZ_RESOURCE_TYPES.RequestsServiceRequest,
  },
  PROPOSAL: {
    action: AUTHZ_ACTIONS.CommercialProposalRead,
    resourceType: AUTHZ_RESOURCE_TYPES.CommercialProposal,
  },
  PURCHASE_ORDER: {
    action: AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    resourceType: AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder,
  },
  SERVICE_ORDER: {
    action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  },
  MEASUREMENT: {
    action: AUTHZ_ACTIONS.MeasurementsMeasurementRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  },
  BILLING_DOCUMENT: {
    action: AUTHZ_ACTIONS.BillingBillingDocumentRead,
    resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
  },
  RECEIVABLE: {
    action: AUTHZ_ACTIONS.FinanceReceivableRead,
    resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
  },
  SETTLEMENT: {
    action: AUTHZ_ACTIONS.FinanceReceivableRead,
    resourceType: AUTHZ_RESOURCE_TYPES.FinanceReceivable,
  },
  FISCAL_DOCUMENT: {
    action: AUTHZ_ACTIONS.FiscalDocumentRead,
    resourceType: AUTHZ_RESOURCE_TYPES.FiscalDocument,
  },
  ACCOUNTING_ENTRY: {
    action: AUTHZ_ACTIONS.AccountingJournalRead,
    resourceType: AUTHZ_RESOURCE_TYPES.AccountingLedger,
  },
};

/** Ordem canonica de montagem: cada no e classificado pela posicao relativa ao anchor. */
const KIND_POSITION: Record<BusinessChainNodeKind, number> = {
  CLIENT: 0,
  SERVICE_REQUEST: 1,
  PROPOSAL: 2,
  PURCHASE_ORDER: 3,
  SERVICE_ORDER: 4,
  MEASUREMENT: 5,
  BILLING_DOCUMENT: 6,
  RECEIVABLE: 7,
  SETTLEMENT: 8,
  FISCAL_DOCUMENT: 9,
  ACCOUNTING_ENTRY: 10,
};

/**
 * Relacao do no com a linhagem.
 *
 * O no do proprio anchor e `ROOT`; um no a montante e `ORIGIN`; um no a jusante e `RESULT`
 * (ou a relacao especializada que o dominio declara: `SETTLEMENT`, `FISCAL`, `ACCOUNTING`).
 * O estorno de uma liquidacao e `REVERSAL` — o fato original continua na cadeia.
 */
export function resolveRelation(
  kind: BusinessChainNodeKind,
  status: string,
  anchorKind: BusinessChainNodeKind,
): BusinessChainRelation {
  if (kind === anchorKind) {
    return 'ROOT';
  }
  if (kind === 'SETTLEMENT') {
    return status === 'REVERSED' ? 'REVERSAL' : 'SETTLEMENT';
  }
  if (kind === 'FISCAL_DOCUMENT') {
    return 'FISCAL';
  }
  if (kind === 'ACCOUNTING_ENTRY') {
    return 'ACCOUNTING';
  }
  return KIND_POSITION[kind] < KIND_POSITION[anchorKind] ? 'ORIGIN' : 'RESULT';
}

@Injectable()
export class BusinessChainService {
  constructor(
    private readonly repository: BusinessChainRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async getChain(
    actor: IdentityAuthzContext,
    anchorKind: ChainAnchorKind,
    anchorId: string,
  ): Promise<BusinessChain> {
    const spine = await this.repository.resolveSpine(anchorKind, anchorId);
    const facts = await this.repository.loadNodeFacts(spine.map((entry) => entry.entityId));

    const receivableScope = new Map<string, { unitId: string | null; clientId: string | null }>();
    for (const row of facts) {
      if (row.kind === 'RECEIVABLE') {
        receivableScope.set(row.entity_id, { unitId: row.unit_id, clientId: row.client_id });
      }
    }

    const authorized: BusinessChainNode[] = [];
    let anchorAuthorized = false;

    for (const row of facts) {
      const authorization = NODE_AUTHORIZATION[row.kind];
      // A liquidacao herda o escopo do RECEBIVEL ao qual pertence — a FK `receivable_id`.
      const inherited = row.kind === 'SETTLEMENT' ? receivableScope.get(row.context_id ?? '') : undefined;
      const unitId = row.unit_id ?? inherited?.unitId ?? null;
      const clientId = row.client_id ?? inherited?.clientId ?? null;
      const isAnchor = row.kind === anchorKind && row.entity_id === anchorId;

      const decision = await this.policyDecisionPoint.decide(
        actor,
        {
          action: authorization.action,
          resourceType: authorization.resourceType,
          context: {
            resourceId: row.entity_id,
            unitId: unitId ?? undefined,
            clientId: clientId ?? undefined,
            isFinancial:
              row.kind === 'RECEIVABLE' ||
              row.kind === 'SETTLEMENT' ||
              row.kind === 'FISCAL_DOCUMENT' ||
              row.kind === 'ACCOUNTING_ENTRY',
          },
        },
        // O acesso e auditado uma vez, no proprio anchor; os demais nos sao o mesmo acesso.
        { audit: isAnchor },
      );

      if (decision.result !== 'ALLOW') {
        // No nao autorizado NAO EXISTE: nao entra, nao conta, nao avisa.
        continue;
      }

      if (isAnchor) {
        anchorAuthorized = true;
      }

      authorized.push({
        id: row.entity_id,
        kind: row.kind,
        businessReference: row.business_reference,
        status: row.status,
        occurredAt: row.occurred_at,
        route: businessChainRoute(row.kind, row.entity_id, row.context_id),
        relation: resolveRelation(row.kind, row.status, anchorKind),
        summary: row.summary,
        unitId,
        clientId,
      });
    }

    if (!anchorAuthorized) {
      // Sem leitura do proprio anchor nao existe cadeia a apresentar — nem a partir dele.
      throw new HttpException({ code: 'BUSINESS_CHAIN_ANCHOR_FORBIDDEN' }, 403);
    }

    const chain = buildBusinessChain({ kind: anchorKind, id: anchorId }, authorized);
    return chain;
  }
}

export type { ChainNodeFactRow };
