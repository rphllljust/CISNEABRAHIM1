import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import {
  ENTERPRISE_CORE_PORT,
  type FinancePayablePort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  TAX_ASSESSMENT_EVENTS,
  TAX_ASSESSMENT_STATUSES,
  TaxAssessmentError,
  assertAssessmentAdjustable,
  assertAssessmentCancellable,
  assertAssessmentFinalizable,
  assertFiscalFinanceReconciled,
  assertNoDuplicateActiveAssessment,
  assertStoredCalculationValid,
  periodKeyFromEffectiveOn,
} from '../domain/tax-assessment';
import {
  TAX_PAYABLE_FAILURE_INJECTION,
  TAX_PAYABLE_FAILURE_STAGES,
  TaxPayableFailureInjection,
} from '../domain/tax-payable-failure-injection';
import {
  validateAdjustTaxAssessmentInput,
  validateCancelTaxAssessmentInput,
  validateCreateTaxAssessmentInput,
  validateFinalizePayableInput,
  validateTaxAssessmentListQuery,
  type AdjustTaxAssessmentInput,
  type CancelTaxAssessmentInput,
  type CreateTaxAssessmentInput,
  type FinalizeTaxAssessmentPayableInput,
} from '../domain/tax-assessment.validation';
import type { TaxCalculationInputs, TaxRuleVersionSnapshot } from '../domain/tax-engine';
import { TaxEngineError } from '../domain/tax-engine';
import { TaxAssessmentRepository } from '../repositories/tax-assessment.repository';
import type { TaxAssessmentAggregate } from '../repositories/tax-assessment.repository.types';
import { TaxEngineRepository } from '../repositories/tax-engine.repository';
import type { TaxCalculationAggregate } from '../repositories/tax-engine.repository.types';
import {
  toTaxAssessmentDetailResponse,
  toTaxAssessmentPageResponse,
  type TaxAssessmentDetailResponse,
  type TaxAssessmentPageResponse,
} from '../serializers/tax-assessment-response.serializer';
import { FiscalPeriodAccessService } from './fiscal-period-access.service';
import { TaxEngineAccessAuthz } from './tax-engine-access.authz';
import { mapTaxAssessmentDomainError } from './tax-assessment-access.errors';

@Injectable()
export class TaxAssessmentAccessService {
  constructor(
    private readonly assessments: TaxAssessmentRepository,
    private readonly taxEngine: TaxEngineRepository,
    private readonly authz: TaxEngineAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly fiscalPeriods: FiscalPeriodAccessService,
    private readonly sod: SodEnforcementService,
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.FinancePayable)
    private readonly payablePort?: FinancePayablePort,
    @Optional()
    @Inject(TAX_PAYABLE_FAILURE_INJECTION)
    private readonly failures?: TaxPayableFailureInjection,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreateTaxAssessmentInput,
  ): Promise<TaxAssessmentDetailResponse> {
    try {
      const validated = validateCreateTaxAssessmentInput(input);
      const calculation = await this.requireCalculation(validated.taxCalculationId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentCreate, {
        id: calculation.calculation.id,
        unitId: calculation.calculation.unit_id,
      });
      const assessedAmount = this.validateCalculation(calculation);
      const periodKey = periodKeyFromEffectiveOn(calculation.context.effective_on);
      if (!validated.supersedesAssessmentId) {
        await this.fiscalPeriods.assertOrdinaryWriteAllowed(calculation.calculation.unit_id, periodKey);
      }
      const existing = await this.assessments.findByIdempotency(
        calculation.calculation.unit_id,
        validated.idempotencyKey,
      );
      if (!existing) {
        const active = await this.assessments.findActiveByTaxPeriod(
          calculation.calculation.unit_id,
          calculation.calculation.tax_rule_id,
          periodKey,
        );
        assertNoDuplicateActiveAssessment(Boolean(active));
      }
      const created = await this.assessments.createDraft({
        unitId: calculation.calculation.unit_id,
        taxCalculationId: calculation.calculation.id,
        taxRuleId: calculation.calculation.tax_rule_id,
        taxRuleVersionId: calculation.calculation.tax_rule_version_id,
        taxComponent: calculation.rule.code,
        periodKey,
        currencyCode: calculation.context.currency_code,
        assessedAmount,
        supersedesAssessmentId: validated.supersedesAssessmentId ?? null,
        idempotencyKey: validated.idempotencyKey,
        actorIdentityId: actor.identityId,
      });
      if (!created.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxAssessmentCreate, created.aggregate.assessment.id, {
          taxCalculationId: calculation.calculation.id,
          periodKey,
          assessedAmount,
        });
      }
      return this.toDetail(created.aggregate);
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  async finalize(
    actor: IdentityAuthzContext,
    assessmentId: string,
    input: FinalizeTaxAssessmentPayableInput,
  ): Promise<TaxAssessmentDetailResponse> {
    assertUuid(assessmentId, 'assessmentId');
    try {
      const payableInput = validateFinalizePayableInput(input);
      const current = await this.requireAssessment(assessmentId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentFinalize, {
        id: current.assessment.id,
        unitId: current.assessment.unit_id,
      });
      if (current.assessment.status === TAX_ASSESSMENT_STATUSES.Finalized) {
        return this.toDetail(current);
      }
      const createdEvent = current.events.find((event) => event.event_type === TAX_ASSESSMENT_EVENTS.Created);
      const scope = resolveSodScope(current.assessment.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.TaxAssessmentFinalize,
        originatorIdentityId: createdEvent?.actor_identity_id,
        amount: current.assessment.assessed_amount,
        ...scope,
      });
      assertAssessmentFinalizable(current.assessment.status);
      if (!current.assessment.supersedes_assessment_id) {
        await this.fiscalPeriods.assertOrdinaryWriteAllowed(
          current.assessment.unit_id,
          current.assessment.period_key,
        );
      }
      this.requirePayablePort();
      const finalized = await this.assessments.finalize({
        assessmentId,
        actorIdentityId: actor.identityId,
      });
      if (!finalized.aggregate.obligation) {
        throw new TaxAssessmentError('TAX_OBLIGATION_NOT_FOUND');
      }
      this.failures?.consume(TAX_PAYABLE_FAILURE_STAGES.BeforePayableOpen);
      const payable = await this.payablePort!.openFromTaxObligation({
        taxObligationId: finalized.aggregate.obligation.id,
        taxAssessmentId: finalized.aggregate.assessment.id,
        unitId: finalized.aggregate.assessment.unit_id,
        counterpartyId: payableInput.counterpartyId,
        principal: finalized.aggregate.assessment.assessed_amount,
        currencyCode: finalized.aggregate.assessment.currency_code,
        dueDate: payableInput.dueDate,
        paymentTerms: payableInput.paymentTerms,
        expenseCategoryId: payableInput.expenseCategoryId,
        costCenterId: payableInput.costCenterId,
        costCenterCode: payableInput.costCenterCode,
        originReference: `TAX-${finalized.aggregate.assessment.tax_component}-${finalized.aggregate.assessment.period_key}`,
        externalReference: finalized.aggregate.assessment.id,
        actorIdentityId: actor.identityId,
      });
      const obligation = await this.assessments.attachPayableSnapshot({
        obligationId: finalized.aggregate.obligation.id,
        payableId: payable.payableId,
        payablePrincipal: payable.principal,
      });
      const finance = await this.payablePort!.findByTaxObligation(obligation.id);
      if (!finance) {
        throw new TaxAssessmentError('TAX_FISCAL_FINANCE_MISMATCH');
      }
      assertFiscalFinanceReconciled({
        assessedAmount: finalized.aggregate.assessment.assessed_amount,
        obligationAmount: obligation.amount,
        payablePrincipal: finance.principal,
      });
      if (!finalized.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxAssessmentFinalize, finalized.aggregate.assessment.id, {
          obligationId: obligation.id,
          payableId: payable.payableId,
          amount: obligation.amount,
        });
      }
      return this.toDetail({ ...finalized.aggregate, obligation }, finance);
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  async adjust(
    actor: IdentityAuthzContext,
    assessmentId: string,
    input: AdjustTaxAssessmentInput,
  ): Promise<TaxAssessmentDetailResponse> {
    assertUuid(assessmentId, 'assessmentId');
    try {
      const validated = validateAdjustTaxAssessmentInput(input);
      const current = await this.requireAssessment(assessmentId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentAdjust, {
        id: current.assessment.id,
        unitId: current.assessment.unit_id,
      });
      assertAssessmentAdjustable(current.assessment.status);
      this.requirePayablePort();
      if (current.obligation) {
        await this.payablePort!.cancelFromTaxObligation({
          taxObligationId: current.obligation.id,
          actorIdentityId: actor.identityId,
          reason: validated.reason,
        });
        await this.assessments.cancelObligation({
          obligationId: current.obligation.id,
          reason: validated.reason,
          actorIdentityId: actor.identityId,
        });
      }
      await this.assessments.markAdjusted(assessmentId, validated.reason, actor.identityId);
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxAssessmentAdjust, assessmentId, {
        reason: validated.reason,
      });
      const next = await this.create(actor, {
        taxCalculationId: validated.taxCalculationId,
        idempotencyKey: validated.idempotencyKey,
        supersedesAssessmentId: assessmentId,
      });
      return next;
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  async cancel(
    actor: IdentityAuthzContext,
    assessmentId: string,
    input: CancelTaxAssessmentInput,
  ): Promise<TaxAssessmentDetailResponse> {
    assertUuid(assessmentId, 'assessmentId');
    try {
      const validated = validateCancelTaxAssessmentInput(input);
      const current = await this.requireAssessment(assessmentId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentCancel, {
        id: current.assessment.id,
        unitId: current.assessment.unit_id,
      });
      assertAssessmentCancellable(current.assessment.status);
      if (
        current.assessment.status === TAX_ASSESSMENT_STATUSES.Cancelled ||
        current.assessment.status === TAX_ASSESSMENT_STATUSES.Adjusted
      ) {
        return this.toDetail(current);
      }
      if (current.obligation) {
        this.requirePayablePort();
        await this.payablePort!.cancelFromTaxObligation({
          taxObligationId: current.obligation.id,
          actorIdentityId: actor.identityId,
          reason: validated.reason,
        });
        await this.assessments.cancelObligation({
          obligationId: current.obligation.id,
          reason: validated.reason,
          actorIdentityId: actor.identityId,
        });
      }
      await this.assessments.markCancelled(assessmentId, validated.reason, actor.identityId);
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxAssessmentCancel, assessmentId, {
        reason: validated.reason,
      });
      return this.getById(actor, assessmentId);
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  async getById(actor: IdentityAuthzContext, assessmentId: string): Promise<TaxAssessmentDetailResponse> {
    assertUuid(assessmentId, 'assessmentId');
    try {
      const aggregate = await this.requireAssessment(assessmentId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentRead, {
        id: aggregate.assessment.id,
        unitId: aggregate.assessment.unit_id,
      });
      const payable = aggregate.obligation
        ? ((await this.payablePort?.findByTaxObligation(aggregate.obligation.id)) ?? null)
        : null;
      if (aggregate.assessment.status === TAX_ASSESSMENT_STATUSES.Finalized && aggregate.obligation && payable) {
        assertFiscalFinanceReconciled({
          assessedAmount: aggregate.assessment.assessed_amount,
          obligationAmount: aggregate.obligation.amount,
          payablePrincipal: payable.principal,
        });
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxAssessmentRead, aggregate.assessment.id, {
        status: aggregate.assessment.status,
      });
      return this.toDetail(aggregate, payable);
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  /**
   * Lista paginada de apuracoes da unidade com a obrigacao tributaria vinculada.
   * Substitui a consulta por identificador manual na superficie de apuracao.
   */
  async list(
    actor: IdentityAuthzContext,
    query: { unitId: string } & Record<string, unknown>,
  ): Promise<TaxAssessmentPageResponse> {
    try {
      const validated = validateTaxAssessmentListQuery(query);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxAssessmentRead, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.assessments.listAssessmentPage({
        unitId: validated.unitId,
        status: validated.status,
        periodKey: validated.periodKey,
        taxComponent: validated.taxComponent,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      return toTaxAssessmentPageResponse({
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        items: result.items,
      });
    } catch (error) {
      throw mapTaxAssessmentDomainError(error);
    }
  }

  private async toDetail(
    aggregate: TaxAssessmentAggregate,
    payable?: { payableId: string; principal: string; currencyCode: string; originKind: string; originId: string; lifecycle: string } | null,
  ): Promise<TaxAssessmentDetailResponse> {
    const finance =
      payable !== undefined
        ? payable
        : aggregate.obligation
          ? ((await this.payablePort?.findByTaxObligation(aggregate.obligation.id)) ?? null)
          : null;
    return toTaxAssessmentDetailResponse(aggregate, finance);
  }

  private requirePayablePort(): FinancePayablePort {
    if (!this.payablePort) {
      throw new TaxAssessmentError('TAX_PAYABLE_PORT_UNAVAILABLE');
    }
    return this.payablePort;
  }

  private async requireAssessment(assessmentId: string): Promise<TaxAssessmentAggregate> {
    const row = await this.assessments.findById(assessmentId);
    if (!row) {
      throw new TaxAssessmentError('TAX_ASSESSMENT_NOT_FOUND');
    }
    return row;
  }

  private async requireCalculation(calculationId: string): Promise<TaxCalculationAggregate> {
    const row = await this.taxEngine.findCalculationById(calculationId);
    if (!row) {
      throw new TaxEngineError('TAX_CALCULATION_NOT_FOUND');
    }
    return row;
  }

  private validateCalculation(calculation: TaxCalculationAggregate): string {
    return assertStoredCalculationValid({
      taxRuleVersionId: calculation.calculation.tax_rule_version_id,
      inputs: calculation.calculation.inputs as TaxCalculationInputs,
      resultAmount: calculation.calculation.result_amount,
      version: toVersionSnapshot(calculation.version),
    });
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
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FiscalTaxEngine,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }
}

function toVersionSnapshot(row: {
  id: string;
  tax_rule_id: string;
  version_number: number;
  status: string;
  calculation_method: string;
  rounding_mode: string;
  rate: string | null;
  fixed_amount: string | null;
  source_reference: string;
  effective_from: string;
  effective_to: string | null;
}): TaxRuleVersionSnapshot {
  return {
    id: row.id,
    taxRuleId: row.tax_rule_id,
    versionNumber: row.version_number,
    status: row.status,
    calculationMethod: row.calculation_method,
    roundingMode: row.rounding_mode,
    rate: row.rate,
    fixedAmount: row.fixed_amount,
    sourceReference: row.source_reference,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
  };
}
