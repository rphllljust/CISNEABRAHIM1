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
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import { assertUuid } from '../../platform/kernel/uuid';
import {
  BudgetError,
  asBudgetIsoDate,
  assertBudgetHasApprovingContent,
  assertBudgetPeriodsDoNotOverlap,
  assertBudgetVersionCanApprove,
  assertBudgetVersionEditable,
  compareBudgetLine,
  summarizeBudgetComparison,
} from '../domain/budget';
import {
  validateCreateBudgetInput,
  validateCreateBudgetLineInput,
  validateCreateBudgetPeriodInput,
  type CreateBudgetInput,
  type CreateBudgetLineInput,
  type CreateBudgetPeriodInput,
} from '../domain/budget.validation';
import { BudgetRepository } from '../repositories/budget.repository';
import {
  toBudgetResponse,
  toBudgetSummaryResponse,
  type BudgetComparisonResponse,
  type BudgetListResponse,
  type BudgetResponse,
} from '../serializers/budget-response.serializer';
import { BudgetAccessAuthz } from './budget-access.authz';
import { budgetAccessDenied, mapBudgetDomainError } from './budget-access.errors';

@Injectable()
export class BudgetAccessService {
  constructor(
    private readonly repository: BudgetRepository,
    private readonly authz: BudgetAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
  ) {}

  /**
   * Listagem operacional de orçamentos. Exige concessão ativa de `finance:budget:list` no recurso
   * FinanceBudget: sem ela nada é listado, e a tela não depende de identificador digitado.
   */
  async list(
    actor: IdentityAuthzContext,
    query: { limit: number; offset: number; status?: string; unitId?: string; q?: string },
  ): Promise<BudgetListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.FinanceBudgetList,
      AUTHZ_RESOURCE_TYPES.FinanceBudget,
    );
    if (grants.length === 0) {
      throw mapBudgetDomainError(budgetAccessDenied());
    }
    try {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        whereParts.push(`status = $${params.length + 1}::fin.budget_status`);
        params.push(query.status);
      }
      if (query.unitId) {
        whereParts.push(`unit_id = $${params.length + 1}`);
        params.push(query.unitId);
      }
      if (query.q) {
        whereParts.push(`(code ILIKE $${params.length + 1} OR name ILIKE $${params.length + 1})`);
        params.push(`%${query.q}%`);
      }
      const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

      const rows = await this.repository.listBudgetPage({
        whereClause,
        params,
        limit: query.limit,
        offset: query.offset,
      });
      const total =
        query.offset === 0 && rows.length < query.limit
          ? rows.length
          : await this.repository.countBudgetList(whereClause, params);

      return {
        items: rows.map(toBudgetSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async create(actor: IdentityAuthzContext, input: CreateBudgetInput): Promise<BudgetResponse> {
    try {
      const validated = validateCreateBudgetInput(input);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetCreate, {
        id: actor.identityId,
        unitId: validated.unitId,
      });
      const created = await this.repository.createBudget({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FinanceBudgetCreate, created.budget.id, {
        code: created.budget.code,
      });
      return this.assemble(created.budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async addPeriod(
    actor: IdentityAuthzContext,
    budgetId: string,
    input: CreateBudgetPeriodInput,
  ): Promise<BudgetResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const validated = validateCreateBudgetPeriodInput(input);
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetUpdate, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      const draft = await this.requireDraft(budget.id);
      assertBudgetVersionEditable(draft.status);
      const existing = await this.repository.listPeriods(draft.id);
      assertBudgetPeriodsDoNotOverlap([
        ...existing.map((item) => ({
          startsOn: asBudgetIsoDate(item.starts_on),
          endsOn: asBudgetIsoDate(item.ends_on),
        })),
        { startsOn: validated.startsOn, endsOn: validated.endsOn },
      ]);
      await this.repository.addPeriod({
        versionId: draft.id,
        ...validated,
        actorIdentityId: actor.identityId,
      });
      return this.assemble(budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async addLine(
    actor: IdentityAuthzContext,
    budgetId: string,
    input: CreateBudgetLineInput,
  ): Promise<BudgetResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const validated = validateCreateBudgetLineInput(input);
      assertUuid(validated.periodId, 'periodId');
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetUpdate, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      const period = await this.repository.findPeriodById(validated.periodId);
      if (!period) {
        throw new BudgetError('BUDGET_PERIOD_INVALID');
      }
      const version = await this.repository.findVersionById(period.budget_version_id);
      if (!version || version.budget_id !== budget.id) {
        throw new BudgetError('BUDGET_INVALID');
      }
      assertBudgetVersionEditable(version.status);
      await this.repository.addLine({
        periodId: period.id,
        amount: validated.amount,
        currencyCode: budget.currency_code,
        costCenterCode: validated.costCenterCode ?? null,
        expenseCategoryId: validated.expenseCategoryId ?? null,
        accountId: validated.accountId ?? null,
        actorIdentityId: actor.identityId,
      });
      return this.assemble(budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async approve(actor: IdentityAuthzContext, budgetId: string): Promise<BudgetResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetApprove, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      const draft = await this.requireDraft(budget.id);
      assertBudgetVersionCanApprove(draft.status);
      const periods = await this.repository.listPeriods(draft.id);
      const lines = [];
      for (const period of periods) {
        lines.push(...(await this.repository.listLines(period.id)));
      }
      assertBudgetHasApprovingContent(periods.length, lines.length);
      const scope = resolveSodScope(budget.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.BudgetApprove,
        originatorIdentityId: draft.created_by_identity_id,
        ...scope,
      });
      await this.repository.approveVersion({
        versionId: draft.id,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FinanceBudgetApprove, budget.id, {
        versionId: draft.id,
        versionNumber: draft.version_number,
      });
      return this.assemble(budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async createVersion(actor: IdentityAuthzContext, budgetId: string): Promise<BudgetResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetUpdate, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      await this.repository.createNextVersion({
        budgetId: budget.id,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FinanceBudgetVersion, budget.id, {});
      return this.assemble(budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async getById(actor: IdentityAuthzContext, budgetId: string): Promise<BudgetResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetRead, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      return this.assemble(budget);
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  async compare(actor: IdentityAuthzContext, budgetId: string): Promise<BudgetComparisonResponse> {
    assertUuid(budgetId, 'budgetId');
    try {
      const budget = await this.requireBudget(budgetId);
      await this.authz.assertBudgetAction(actor, AUTHZ_ACTIONS.FinanceBudgetRead, {
        id: budget.id,
        unitId: budget.unit_id,
      });
      const version =
        (await this.repository.findLatestApprovedVersion(budget.id)) ??
        (await this.repository.findDraftVersion(budget.id));
      if (!version) {
        throw new BudgetError('BUDGET_NOT_FOUND');
      }
      const periods = await this.repository.listPeriods(version.id);
      const lines = [];
      for (const period of periods) {
        const periodLines = await this.repository.listLines(period.id);
        for (const line of periodLines) {
          let actual = '0';
          let actualSource: 'POSTED_JOURNAL' | 'NONE' = 'NONE';
          if (line.account_id) {
            actual = await this.repository.postedActualForAccount({
              unitId: budget.unit_id,
              accountId: line.account_id,
              currencyCode: budget.currency_code,
              startsOn: asBudgetIsoDate(period.starts_on),
              endsOn: asBudgetIsoDate(period.ends_on),
            });
            actualSource = 'POSTED_JOURNAL';
          }
          lines.push(
            compareBudgetLine({
              lineId: line.id,
              periodKey: period.period_key,
              budgeted: line.amount,
              actual,
              actualSource,
            }),
          );
        }
      }
      const totals = summarizeBudgetComparison(lines);
      return {
        budgetId: budget.id,
        versionId: version.id,
        versionNumber: version.version_number,
        currencyCode: budget.currency_code,
        ...totals,
        lines,
      };
    } catch (error) {
      throw mapBudgetDomainError(error);
    }
  }

  private async requireBudget(budgetId: string) {
    const budget = await this.repository.findBudgetById(budgetId);
    if (!budget) {
      throw new BudgetError('BUDGET_NOT_FOUND');
    }
    return budget;
  }

  private async requireDraft(budgetId: string) {
    const draft = await this.repository.findDraftVersion(budgetId);
    if (!draft) {
      throw new BudgetError('BUDGET_NOT_DRAFT');
    }
    return draft;
  }

  private async assemble(budget: { id: string }): Promise<BudgetResponse> {
    const current = await this.requireBudget(budget.id);
    const versions = await this.repository.listVersions(current.id);
    const assembled = [];
    for (const version of versions) {
      const periods = await this.repository.listPeriods(version.id);
      const periodItems = [];
      for (const period of periods) {
        periodItems.push({ period, lines: await this.repository.listLines(period.id) });
      }
      assembled.push({ version, periods: periodItems });
    }
    return toBudgetResponse(current, assembled);
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
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceBudget,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      metadata,
    });
  }
}
