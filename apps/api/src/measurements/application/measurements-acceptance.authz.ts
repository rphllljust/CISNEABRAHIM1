import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { toResourceContextFromServiceOrder } from '../../authorization/scope/scope-matcher';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import type { ServiceOrderRow } from '../../service-orders/repositories/service-orders.repository.types';
import { measurementsAccessDenied } from '../services/measurements-access.errors';

/**
 * AUTORIZAÇÃO DA CAPABILITY MEDIÇÃO → ACEITE → FATURAMENTO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE NÃO REUTILIZA `MeasurementsAccessAuthz`
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * `MeasurementsAccessAuthz` já implementa exatamente a mesma regra: decisão do
 * PDP MAIS a conferência de escopo sobre as concessões ativas. Reutilizá-lo
 * seria a escolha óbvia — e é impossível a partir de fora, porque ele não é
 * exportado pelo `MeasurementsModule`.
 *
 * A alternativa era EXPORTAR o serviço existente. Isso o tornaria dependência
 * pública do módulo, e o próximo consumidor passaria a depender de uma classe
 * concreta em vez de um contrato. A duplicação aqui é de TRÊS linhas de
 * conferência de escopo, e o teste de fitness afirma que as duas implementações
 * aplicam a MESMA regra.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ELE NÃO FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não decide política própria. `PolicyDecisionPointService` decide; este serviço
 * aplica a decisão e o escopo, e RECUSA quando qualquer uma falha. Não há
 * caminho em que um comando passe sem PDP nem sem escopo.
 */
@Injectable()
export class MeasurementsAcceptanceAuthz {
  constructor(
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  /**
   * Ação sobre a MEDIÇÃO de uma ordem.
   *
   * O recurso autorizado é a ORDEM DE SERVIÇO, não a medição: a medição é filha
   * da ordem e herda o escopo dela. Autorizar por id de medição exigiria um
   * segundo modelo de concessão para o mesmo dado.
   */
  async assertMeasurementAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    row: ServiceOrderRow,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: toResourceContextFromServiceOrder(row),
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw measurementsAccessDenied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      if (grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === row.unit_id) {
        return true;
      }
      if (
        row.client_id &&
        grant.scope_type === AUTHZ_SCOPES.Client &&
        grant.resource_id === row.client_id
      ) {
        return true;
      }
      return false;
    });
    if (!hasAccess) {
      throw measurementsAccessDenied();
    }
  }

  /**
   * Escopo de LEITURA de uma UNIDADE.
   *
   * As leituras de work queue e control tower agregam ordens de uma unidade
   * inteira. Sem esta conferência, um ator com escopo de CLIENTE receberia a
   * projeção da unidade completa — e os valores de outros clientes iriam junto.
   *
   * A regra é a MESMA das concessões: global libera tudo, unidade libera aquela
   * unidade, cliente NÃO libera a unidade (ele não é escopo de unidade).
   */
  async assertUnitReadScope(actor: IdentityAuthzContext, unitId: string): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action: AUTHZ_ACTIONS.MeasurementsMeasurementRead,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: { unitId },
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw measurementsAccessDenied();
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.MeasurementsMeasurementRead,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      return grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === unitId;
    });
    if (!hasAccess) {
      throw measurementsAccessDenied();
    }
  }

  /**
   * Permissões EFETIVAS do ator, para a superfície de comandos.
   *
   * A superfície precisa saber QUAIS comandos o ator pode executar para publicar
   * `enabled` com o motivo `NOT_AUTHORIZED`. O conjunto vem das mesmas
   * concessões que o PDP consulta — não de uma lista própria.
   */
  async getEffectivePermissions(actor: IdentityAuthzContext): Promise<Set<string>> {
    const measurementActions = Object.values(AUTHZ_ACTIONS).filter((action) =>
      action.startsWith('measurements:'),
    );
    const permissions = new Set<string>();

    for (const action of measurementActions) {
      const grants = await this.authorizationRepository.findActiveGrants(
        actor.identityId,
        action,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      );
      if (grants.length > 0) {
        permissions.add(action);
      }
    }

    // Faturamento: preparar é a ação que atravessa a fronteira desta capability.
    const billingGrants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.BillingBillingRecordPrepare,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    if (billingGrants.length > 0) {
      permissions.add(AUTHZ_ACTIONS.BillingBillingRecordPrepare);
    }

    return permissions;
  }
}
