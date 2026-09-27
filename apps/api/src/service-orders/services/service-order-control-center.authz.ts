import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { hasPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { ServiceOrderControlCenterFacts } from '../repositories/service-order-control-center.persistence';
import type { ServiceOrderRow } from '../repositories/service-orders.repository.types';
import type { ServiceOrderTransition } from '../domain/service-order.state-machine';

/**
 * Autorizacao do Operations Control Center.
 *
 * `service-orders:service-order:read` NAO autoriza ler cliente, solicitacao, proposta, pedido de
 * compra, medicao, faturamento nem documentos: cada elo e cada bloco downstream e avaliado com a
 * acao e o resource type do MODULO DONO. Bloco negado e omitido em silencio.
 */
@Injectable()
export class ServiceOrderControlCenterAuthz {
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

  async canReadClient(actor: IdentityAuthzContext, clientId: string | null): Promise<boolean> {
    if (!clientId) {
      return false;
    }
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.ClientRead,
      resourceType: AUTHZ_RESOURCE_TYPES.Client,
      context: { resourceId: clientId, clientId },
    });
  }

  /** Leitura de um elo da cadeia, sempre com a acao e o resource type do modulo dono. */
  async canReadLink(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
    resourceId: string | null,
    row: ServiceOrderRow,
  ): Promise<boolean> {
    if (!resourceId) {
      return false;
    }
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action,
      resourceType,
      context: {
        resourceId,
        unitId: row.unit_id,
        clientId: row.client_id ?? undefined,
      },
    });
  }

  /** Medicao pertence a OS: lida com a acao de medicao sobre o contexto da OS dona. */
  async canReadMeasurement(actor: IdentityAuthzContext, row: ServiceOrderRow): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.MeasurementsMeasurementRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      context: {
        resourceId: row.id,
        unitId: row.unit_id,
        clientId: row.client_id ?? undefined,
      },
    });
  }

  /** Faturamento e autorizado contra a OS dona (mesmo caminho do modulo de billing). */
  async canReadBilling(actor: IdentityAuthzContext, row: ServiceOrderRow): Promise<boolean> {
    return hasPolicyAndGrantScope(this.deps, {
      actor,
      action: AUTHZ_ACTIONS.BillingBillingRecordRead,
      resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      context: {
        resourceId: row.id,
        unitId: row.unit_id,
        clientId: row.client_id ?? undefined,
      },
    });
  }

  /**
   * Transicoes que ESTE ator pode executar, avaliadas com a acao exata de cada comando real
   * (preparar, liberar, iniciar, pausar, retomar, concluir, cancelar, reabrir). Decisao memorizada
   * por acao, nunca por linha.
   */
  async availableTransitions(
    actor: IdentityAuthzContext,
    row: ServiceOrderRow,
    candidates: ServiceOrderTransition[],
  ): Promise<ServiceOrderTransition[]> {
    const granted: ServiceOrderTransition[] = [];
    for (const transition of candidates) {
      const action = TRANSITION_ACTIONS[transition];
      const allowed = await hasPolicyAndGrantScope(this.deps, {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: {
          resourceId: row.id,
          unitId: row.unit_id,
          clientId: row.client_id ?? undefined,
        },
      });
      if (allowed) {
        granted.push(transition);
      }
    }
    return granted;
  }
}

const TRANSITION_ACTIONS: Record<ServiceOrderTransition, (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS]> = {
  prepare: AUTHZ_ACTIONS.ServiceOrdersServiceOrderPrepare,
  release: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRelease,
  start: AUTHZ_ACTIONS.ServiceOrdersExecutionStart,
  pause: AUTHZ_ACTIONS.ServiceOrdersExecutionPause,
  resume: AUTHZ_ACTIONS.ServiceOrdersExecutionResume,
  complete: AUTHZ_ACTIONS.ServiceOrdersExecutionComplete,
  cancel: AUTHZ_ACTIONS.ServiceOrdersServiceOrderCancel,
};

/** Blocos downstream que o ator pode ver. */
export type ControlCenterVisibility = {
  client: boolean;
  request: boolean;
  proposal: boolean;
  purchaseOrder: boolean;
  measurement: boolean;
  billing: boolean;
};

export function maskedFacts(
  facts: ServiceOrderControlCenterFacts,
  visibility: ControlCenterVisibility,
): ServiceOrderControlCenterFacts {
  return {
    ...facts,
    measurement_count: visibility.measurement ? facts.measurement_count : 0,
    measurement_status: visibility.measurement ? facts.measurement_status : null,
    measurement_created_at: visibility.measurement ? facts.measurement_created_at : null,
    billing_count: visibility.billing ? facts.billing_count : 0,
    billing_status: visibility.billing ? facts.billing_status : null,
    billing_created_at: visibility.billing ? facts.billing_created_at : null,
    billing_total_amount: visibility.billing ? facts.billing_total_amount : null,
    billing_currency_code: visibility.billing ? facts.billing_currency_code : null,
  };
}

