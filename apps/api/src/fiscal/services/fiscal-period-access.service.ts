import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { toResourceContextFromAccounting } from '../../authorization/scope/scope-matcher';
import { assertPolicyAndGrantScope } from '../../authorization/services/domain-grant-authz.helper';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  FiscalPeriodError,
  assertFiscalPeriodAcceptsOrdinaryChange,
  assertFiscalPeriodKey,
  fiscalPeriodKeyFromDate,
} from '../domain/fiscal-period';
import {
  validateFiscalPeriodListQuery,
  validateOpenFiscalPeriodInput,
  validateReopenFiscalPeriodInput,
  type OpenFiscalPeriodInput,
  type ReopenFiscalPeriodInput,
} from '../domain/fiscal-period.validation';
import { FiscalPeriodRepository } from '../repositories/fiscal-period.repository';
import {
  toFiscalPeriodPageResponse,
  toFiscalPeriodResponse,
  type FiscalPeriodPageResponse,
  type FiscalPeriodResponse,
} from '../serializers/fiscal-period-response.serializer';
import { fiscalAccessDenied } from './fiscal-access.errors';
import { mapFiscalPeriodDomainError } from './fiscal-period-access.errors';

@Injectable()
export class FiscalPeriodAccessService {
  constructor(
    private readonly repository: FiscalPeriodRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
  ) {}

  async open(actor: IdentityAuthzContext, input: OpenFiscalPeriodInput): Promise<FiscalPeriodResponse> {
    try {
      const validated = validateOpenFiscalPeriodInput(input);
      assertFiscalPeriodKey(validated.periodKey);
      await this.assertPeriodAction(actor, AUTHZ_ACTIONS.FiscalPeriodOpen, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const opened = await this.repository.open({
        unitId: validated.unitId,
        periodKey: validated.periodKey,
        actorIdentityId: actor.identityId,
      });
      if (!opened.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalPeriodOpen, opened.period.id, {
          periodKey: opened.period.period_key,
        });
      }
      return toFiscalPeriodResponse(opened.period);
    } catch (error) {
      throw mapFiscalPeriodDomainError(error);
    }
  }

  async close(actor: IdentityAuthzContext, periodId: string): Promise<FiscalPeriodResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const current = await this.requirePeriod(periodId);
      await this.assertPeriodAction(actor, AUTHZ_ACTIONS.FiscalPeriodClose, {
        id: current.id,
        unitId: current.unit_id,
      });
      const closed = await this.repository.close({
        periodId,
        actorIdentityId: actor.identityId,
      });
      if (!closed.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalPeriodClose, closed.period.id, {
          periodKey: closed.period.period_key,
          status: closed.period.status,
        });
      }
      return toFiscalPeriodResponse(closed.period, closed.checks);
    } catch (error) {
      throw mapFiscalPeriodDomainError(error);
    }
  }

  async reopen(
    actor: IdentityAuthzContext,
    periodId: string,
    input: ReopenFiscalPeriodInput,
  ): Promise<FiscalPeriodResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const validated = validateReopenFiscalPeriodInput(input);
      const current = await this.requirePeriod(periodId);
      await this.assertPeriodAction(actor, AUTHZ_ACTIONS.FiscalPeriodReopen, {
        id: current.id,
        unitId: current.unit_id,
      });
      const scope = resolveSodScope(current.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.FiscalPeriodReopen,
        originatorIdentityId: current.closed_by_identity_id,
        ...scope,
      });
      const reopened = await this.repository.reopen({
        periodId,
        reason: validated.reason,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalPeriodReopen, reopened.id, {
        reason: validated.reason,
      });
      return toFiscalPeriodResponse(reopened);
    } catch (error) {
      throw mapFiscalPeriodDomainError(error);
    }
  }

  async getById(actor: IdentityAuthzContext, periodId: string): Promise<FiscalPeriodResponse> {
    assertUuid(periodId, 'periodId');
    try {
      const period = await this.requirePeriod(periodId);
      await this.assertPeriodAction(actor, AUTHZ_ACTIONS.FiscalPeriodRead, {
        id: period.id,
        unitId: period.unit_id,
      });
      const checks = await this.repository.listCloseChecks(period.id);
      return toFiscalPeriodResponse(period, checks);
    } catch (error) {
      throw mapFiscalPeriodDomainError(error);
    }
  }

  async assertOrdinaryWriteAllowed(unitId: string, issuedOnOrPeriodKey: string): Promise<void> {
    const periodKey = /^\d{4}-\d{2}$/.test(issuedOnOrPeriodKey.trim())
      ? issuedOnOrPeriodKey.trim()
      : fiscalPeriodKeyFromDate(issuedOnOrPeriodKey);
    const period = await this.repository.findByUnitPeriod(unitId, periodKey);
    assertFiscalPeriodAcceptsOrdinaryChange(period?.status);
  }

  /**
   * Lista paginada de periodos fiscais da unidade. Superficie de consulta do fechamento
   * fiscal (antes era necessario informar o identificador do periodo manualmente).
   */
  async listPeriods(
    actor: IdentityAuthzContext,
    query: { unitId: string } & Record<string, unknown>,
  ): Promise<FiscalPeriodPageResponse> {
    try {
      const validated = validateFiscalPeriodListQuery(query);
      await this.assertPeriodAction(actor, AUTHZ_ACTIONS.FiscalPeriodRead, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.repository.listPeriodPage({
        unitId: validated.unitId,
        status: validated.status,
        periodKeyFrom: validated.periodKeyFrom,
        periodKeyTo: validated.periodKeyTo,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      return toFiscalPeriodPageResponse({
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        items: result.items,
      });
    } catch (error) {
      throw mapFiscalPeriodDomainError(error);
    }
  }

  private async requirePeriod(periodId: string) {
    const row = await this.repository.findById(periodId);
    if (!row) {
      throw new FiscalPeriodError('FISCAL_PERIOD_NOT_FOUND');
    }
    return row;
  }

  private async assertPeriodAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    resource: { id: string; unitId: string },
  ): Promise<void> {
    await assertPolicyAndGrantScope(
      {
        authorizationRepository: this.authorizationRepository,
        policyDecisionPoint: this.policyDecisionPoint,
      },
      {
        actor,
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.FiscalPeriod,
        context: toResourceContextFromAccounting(resource),
        onDenied: fiscalAccessDenied,
      },
    );
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FiscalPeriod,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      metadata,
    });
  }
}
