import { Injectable } from '@nestjs/common';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { assertPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { resolveBusinessTimezone } from '../domain/business-timezone';
import {
  PRODUCTIVITY_PERIOD_PRESETS,
  ProductivityPeriodValidationError,
  resolveProductivityPeriod,
  type ProductivityPeriodPreset,
} from '../domain/productivity-period';
import { ANALYTICS_ERROR_CODES } from '../errors/analytics-error-codes';
import { AnalyticsHttpException } from '../errors/analytics-http.exception';
import { ComplianceReadModelRepository } from '../repositories/compliance-read-model.repository';
import {
  buildComplianceSnapshot,
  type ComplianceSnapshot,
} from '../serializers/compliance-response.serializer';

export type ComplianceQuery = {
  unitId?: string;
  period?: string;
  from?: string;
  to?: string;
};

/**
 * BI de conformidade fiscal e contabil.
 *
 * Visibilidade por bloco decidida no backend a partir das concessoes reais do ator:
 *   fiscal     -> fiscal:document:read     (recurso fiscal:document)
 *   contabil   -> accounting:journal:read  (recurso accounting:ledger)
 * Sem concessao em nenhum bloco a consulta e negada (403) — nunca devolvida zerada. O bloco
 * sem concessao e omitido do payload em vez de aparecer como zero fabricado.
 *
 * `unitId` e obrigatorio: a leitura e escopada por unidade, igual as listas de fiscal e
 * contabilidade. Nao existe agregacao de tenant inteiro por omissao.
 */
@Injectable()
export class ComplianceAccessService {
  constructor(
    private readonly repository: ComplianceReadModelRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
  ) {}

  async getComplianceSnapshot(
    actor: IdentityAuthzContext,
    query: ComplianceQuery,
  ): Promise<ComplianceSnapshot> {
    const unitId = query.unitId?.trim() ?? '';
    if (unitId === '') {
      throw new AnalyticsHttpException(
        400,
        ANALYTICS_ERROR_CODES.INVALID_PERIOD,
        'unitId is required for the compliance snapshot.',
      );
    }

    const fiscal = await this.authorize(
      actor,
      AUTHZ_ACTIONS.FiscalDocumentRead,
      AUTHZ_RESOURCE_TYPES.FiscalDocument,
      unitId,
    );
    const accounting = await this.authorize(
      actor,
      AUTHZ_ACTIONS.AccountingJournalRead,
      AUTHZ_RESOURCE_TYPES.AccountingLedger,
      unitId,
    );
    if (!fiscal && !accounting) {
      throw new AnalyticsHttpException(403, ANALYTICS_ERROR_CODES.ACCESS_DENIED, 'Access denied.');
    }

    const businessTimezone = resolveBusinessTimezone();
    const preset = parsePeriodPreset(query.period);
    let period;
    try {
      period = resolveProductivityPeriod({
        preset,
        customFrom: query.from,
        customTo: query.to,
        businessTimezone,
      });
    } catch (error) {
      if (error instanceof ProductivityPeriodValidationError) {
        throw new AnalyticsHttpException(400, ANALYTICS_ERROR_CODES.INVALID_PERIOD, 'Invalid period.');
      }
      throw error;
    }

    const raw = await this.repository.summarize({
      unitId,
      occurredFrom: period.labelFrom,
      occurredTo: period.labelTo,
    });

    return buildComplianceSnapshot({
      generatedAt: new Date().toISOString(),
      businessTimezone,
      unitId,
      period: { preset, from: period.labelFrom, to: period.labelTo },
      visibility: { fiscal, accounting },
      raw,
    });
  }

  private async authorize(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    resourceType: (typeof AUTHZ_RESOURCE_TYPES)[keyof typeof AUTHZ_RESOURCE_TYPES],
    unitId: string,
  ): Promise<boolean> {
    try {
      await assertPolicyAndGrantScope(
        {
          authorizationRepository: this.authorizationRepository,
          policyDecisionPoint: this.policyDecisionPoint,
        },
        {
          actor,
          action,
          resourceType,
          // Fiscal e contabil sao dados financeiros escopados por unidade.
          context: { resourceId: unitId, unitId, isFinancial: true },
          onDenied: () =>
            new AnalyticsHttpException(403, ANALYTICS_ERROR_CODES.ACCESS_DENIED, 'Access denied.'),
        },
      );
      return true;
    } catch (error) {
      if (error instanceof AnalyticsHttpException && error.getStatus() === 403) {
        return false;
      }
      throw error;
    }
  }
}

function parsePeriodPreset(value: string | undefined): ProductivityPeriodPreset {
  const normalized = value?.trim().toLowerCase();
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Week) {
    return PRODUCTIVITY_PERIOD_PRESETS.Week;
  }
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Month) {
    return PRODUCTIVITY_PERIOD_PRESETS.Month;
  }
  if (normalized === PRODUCTIVITY_PERIOD_PRESETS.Custom) {
    return PRODUCTIVITY_PERIOD_PRESETS.Custom;
  }
  return PRODUCTIVITY_PERIOD_PRESETS.Today;
}
