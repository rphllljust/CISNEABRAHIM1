import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  TEST_FIXTURE_RULE_CODE,
  TaxEngineError,
  computeTaxResult,
  reproduceHistoricalCalculation,
  type TaxCalculationInputs,
  type TaxRuleVersionSnapshot,
} from '../domain/tax-engine';
import {
  validateCalculateTaxInput,
  validateCreateTaxRuleInput,
  validateCreateTaxRuleVersionInput,
  validateTaxRuleListQuery,
  type CalculateTaxInput,
  type CreateTaxRuleInput,
  type CreateTaxRuleVersionInput,
} from '../domain/tax-engine.validation';
import { TaxEngineRepository } from '../repositories/tax-engine.repository';
import type { TaxRuleVersionRow } from '../repositories/tax-engine.repository.types';
import {
  toTaxCalculationResponse,
  toTaxReproductionResponse,
  toTaxRulePageResponse,
  toTaxRuleResponse,
  toTaxRuleVersionResponse,
  type TaxCalculationResponse,
  type TaxReproductionResponse,
  type TaxRulePageResponse,
  type TaxRuleResponse,
  type TaxRuleVersionResponse,
} from '../serializers/tax-engine-response.serializer';
import { FiscalAccountingIntegrationService } from './fiscal-accounting-integration.service';
import { TaxEngineAccessAuthz } from './tax-engine-access.authz';
import { mapTaxEngineDomainError } from './tax-engine-access.errors';

@Injectable()
export class TaxEngineAccessService {
  constructor(
    private readonly repository: TaxEngineRepository,
    private readonly authz: TaxEngineAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly accountingIntegration: FiscalAccountingIntegrationService,
  ) {}

  async createRule(actor: IdentityAuthzContext, input: CreateTaxRuleInput): Promise<TaxRuleResponse> {
    try {
      const validated = validateCreateTaxRuleInput(input);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRuleManage, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const row = await this.repository.createRule({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return toTaxRuleResponse(row);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async createVersion(
    actor: IdentityAuthzContext,
    taxRuleId: string,
    input: CreateTaxRuleVersionInput,
  ): Promise<TaxRuleVersionResponse> {
    assertUuid(taxRuleId, 'taxRuleId');
    try {
      const rule = await this.requireRule(taxRuleId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRuleManage, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const validated = validateCreateTaxRuleVersionInput(input);
      const row = await this.repository.createDraftVersion({
        taxRuleId,
        calculationMethod: validated.calculationMethod,
        roundingMode: validated.roundingMode ?? 'HALF_UP',
        rate: validated.rate ?? null,
        fixedAmount: validated.fixedAmount ?? null,
        sourceReference: validated.sourceReference,
        effectiveFrom: validated.effectiveFrom,
        effectiveTo: validated.effectiveTo ?? null,
        specification: validated.specification ?? {},
        actorIdentityId: actor.identityId,
      });
      return toTaxRuleVersionResponse(row);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async publishVersion(
    actor: IdentityAuthzContext,
    versionId: string,
  ): Promise<TaxRuleVersionResponse> {
    assertUuid(versionId, 'versionId');
    try {
      const version = await this.requireVersion(versionId);
      const rule = await this.requireRule(version.tax_rule_id);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRuleManage, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      const published = await this.repository.publishVersion({
        versionId,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxRulePublish, published.id, {
        taxRuleId: published.tax_rule_id,
        versionNumber: published.version_number,
      });
      return toTaxRuleVersionResponse(published);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async getRule(actor: IdentityAuthzContext, taxRuleId: string): Promise<TaxRuleResponse> {
    assertUuid(taxRuleId, 'taxRuleId');
    try {
      const rule = await this.requireRule(taxRuleId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRead, {
        id: rule.id,
        unitId: rule.unit_id,
      });
      return toTaxRuleResponse(rule);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  /**
   * Lista paginada de regras tributarias da unidade com a versao publicada vigente.
   * Substitui a consulta por identificador manual na superficie de tributos.
   */
  async listRules(
    actor: IdentityAuthzContext,
    query: { unitId: string } & Record<string, unknown>,
  ): Promise<TaxRulePageResponse> {
    try {
      const validated = validateTaxRuleListQuery(query);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRead, {
        id: validated.unitId,
        unitId: validated.unitId,
      });
      const result = await this.repository.listRulePage({
        unitId: validated.unitId,
        status: validated.status,
        page: validated.page,
        pageSize: validated.pageSize,
      });
      return toTaxRulePageResponse({
        page: validated.page,
        pageSize: validated.pageSize,
        total: result.total,
        items: result.items,
      });
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async calculate(actor: IdentityAuthzContext, input: CalculateTaxInput): Promise<TaxCalculationResponse> {
    try {
      const validated = validateCalculateTaxInput(input);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxCalculate, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const existing = await this.repository.findCalculationByIdempotency(
        validated.unitId,
        validated.idempotencyKey,
      );
      if (existing) {
        return toTaxCalculationResponse(existing);
      }
      const version = await this.resolvePublishedVersionForNewCalculation(validated);
      const rule = await this.requireRule(version.tax_rule_id);
      const calculationInputs: TaxCalculationInputs = {
        ruleVersionId: version.id,
        ruleCode: validated.ruleCode ?? rule.code,
        currencyCode: validated.currencyCode,
        baseAmount: validated.baseAmount,
        effectiveOn: validated.effectiveOn,
        attributes: validated.attributes ?? {},
      };
      const computed = computeTaxResult(toVersionSnapshot(version), calculationInputs);
      const aggregate = await this.repository.persistCalculation({
        unitId: validated.unitId,
        taxRuleId: rule.id,
        taxRuleVersionId: version.id,
        currencyCode: validated.currencyCode,
        baseAmount: computed.baseAmount,
        effectiveOn: validated.effectiveOn,
        attributes: validated.attributes ?? {},
        inputs: computed.inputs,
        rate: computed.rate,
        resultAmount: computed.resultAmount,
        componentLabel: rule.code === TEST_FIXTURE_RULE_CODE ? TEST_FIXTURE_RULE_CODE : 'CONFIGURED_COMPONENT',
        idempotencyKey: validated.idempotencyKey,
        sourceKind: validated.sourceKind ?? null,
        sourceId: validated.sourceId ?? null,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FiscalTaxCalculate, aggregate.calculation.id, {
        ruleVersionId: version.id,
        resultAmount: computed.resultAmount,
      });
      await this.accountingIntegration.tryPostConfirmedTaxCalculation(actor, aggregate.calculation.id);
      return toTaxCalculationResponse(aggregate);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async getCalculation(
    actor: IdentityAuthzContext,
    calculationId: string,
  ): Promise<TaxCalculationResponse> {
    assertUuid(calculationId, 'calculationId');
    try {
      const aggregate = await this.requireCalculation(calculationId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRead, {
        id: aggregate.calculation.id,
        unitId: aggregate.calculation.unit_id,
      });
      return toTaxCalculationResponse(aggregate);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  async reproduce(
    actor: IdentityAuthzContext,
    calculationId: string,
  ): Promise<TaxReproductionResponse> {
    assertUuid(calculationId, 'calculationId');
    try {
      const aggregate = await this.requireCalculation(calculationId);
      await this.authz.assertTaxEngineAction(actor, AUTHZ_ACTIONS.FiscalTaxRead, {
        id: aggregate.calculation.id,
        unitId: aggregate.calculation.unit_id,
      });
      const storedInputs = aggregate.calculation.inputs as TaxCalculationInputs;
      const replay = reproduceHistoricalCalculation(
        {
          taxRuleVersionId: aggregate.calculation.tax_rule_version_id,
          inputs: {
            ...storedInputs,
            ruleVersionId: aggregate.calculation.tax_rule_version_id,
          },
          resultAmount: aggregate.calculation.result_amount,
        },
        toVersionSnapshot(aggregate.version),
      );
      return toTaxReproductionResponse(aggregate, replay.recomputed, replay.matches);
    } catch (error) {
      throw mapTaxEngineDomainError(error);
    }
  }

  private async resolvePublishedVersionForNewCalculation(input: CalculateTaxInput) {
    if (input.ruleVersionId) {
      const version = await this.repository.findVersionById(input.ruleVersionId);
      if (!version || version.status !== 'PUBLISHED') {
        throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
      }
      return version;
    }
    if (!input.ruleCode) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    const version = await this.repository.findPublishedVersionForEffectiveOn(
      input.unitId,
      input.ruleCode,
      input.effectiveOn,
    );
    if (!version) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    return version;
  }

  private async requireRule(taxRuleId: string) {
    const row = await this.repository.findRuleById(taxRuleId);
    if (!row) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  private async requireVersion(versionId: string) {
    const row = await this.repository.findVersionById(versionId);
    if (!row) {
      throw new TaxEngineError('TAX_RULE_NOT_CONFIGURED');
    }
    return row;
  }

  private async requireCalculation(calculationId: string) {
    const row = await this.repository.findCalculationById(calculationId);
    if (!row) {
      throw new TaxEngineError('TAX_CALCULATION_NOT_FOUND');
    }
    return row;
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

function toVersionSnapshot(row: TaxRuleVersionRow): TaxRuleVersionSnapshot {
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
