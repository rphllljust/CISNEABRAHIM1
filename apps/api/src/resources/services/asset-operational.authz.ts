import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { hasPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { PhysicalAssetDetail } from '../serializers/physical-assets-response.serializer';
import type {
  AssetAllocationUsageRow,
  AssetOccurrenceRow,
} from '../repositories/physical-asset-operational-lifecycle.persistence';

/**
 * Autorizacao da vida operacional do recurso.
 *
 * `resources:asset:read` NAO autoriza ler ordem de servico, execucao, cliente nem documento: cada
 * elo e avaliado com a acao e o resource type do MODULO DONO e, quando negado, e removido antes da
 * derivacao (o numero da OS, o status e a ocorrencia nao vao para a resposta).
 */
@Injectable()
export class AssetOperationalAuthz {
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

  /**
   * Filtra as utilizacoes cujo elo (ordem de servico) ESTE ator pode ler.
   *
   * A decisao e memorizada por OS: uma alocacao atual, um historico curto e a proxima alocacao
   * custam no maximo uma avaliacao por OS distinta — nunca uma por linha.
   */
  async filterAuthorizedUsage(
    actor: IdentityAuthzContext,
    asset: PhysicalAssetDetail,
    rows: AssetAllocationUsageRow[],
  ): Promise<AssetAllocationUsageRow[]> {
    const decisions = new Map<string, boolean>();
    const allowed: AssetAllocationUsageRow[] = [];
    for (const row of rows) {
      const cached = decisions.get(row.service_order_id);
      const granted =
        cached ??
        (await hasPolicyAndGrantScope(this.deps, {
          actor,
          action: AUTHZ_ACTIONS.ServiceOrdersServiceOrderRead,
          resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
          context: {
            resourceId: row.service_order_id,
            unitId: asset.unit_id,
          },
        }));
      decisions.set(row.service_order_id, granted);
      if (granted) {
        allowed.push(row);
      }
    }
    return allowed;
  }

  /** Ocorrencias pertencem a execucao da OS: exigem a acao de leitura de execucao. */
  async filterAuthorizedOccurrences(
    actor: IdentityAuthzContext,
    asset: PhysicalAssetDetail,
    rows: AssetOccurrenceRow[],
  ): Promise<AssetOccurrenceRow[]> {
    const decisions = new Map<string, boolean>();
    const allowed: AssetOccurrenceRow[] = [];
    for (const row of rows) {
      const cached = decisions.get(row.service_order_id);
      const granted =
        cached ??
        (await hasPolicyAndGrantScope(this.deps, {
          actor,
          action: AUTHZ_ACTIONS.ServiceOrdersExecutionRead,
          resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
          context: {
            resourceId: row.service_order_id,
            unitId: asset.unit_id,
          },
        }));
      decisions.set(row.service_order_id, granted);
      if (granted) {
        allowed.push(row);
      }
    }
    return allowed;
  }
}