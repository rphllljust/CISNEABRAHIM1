import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../platform/kernel/uuid';
import { ExpenseError, assertExpenseNotSelfApproval } from '../domain/expense';
import { ExpenseFailureInjection } from '../domain/expense-failure-injection';
import {
  validateCreateExpenseInput,
  validateExpenseVersionInput,
  validateRejectExpenseInput,
  type CreateExpenseInput,
  type ExpenseVersionInput,
  type RejectExpenseInput,
} from '../domain/expense.validation';
import { ExpenseRepository } from '../repositories/expense.repository';
import { toExpenseResponse, toExpenseSummaryResponse, type ExpenseListResponse, type ExpenseResponse } from '../serializers/expense-response.serializer';
import { ExpenseAccessAuthz } from './expense-access.authz';
import { expenseAccessDenied, mapExpenseError } from './expense-access.errors';

@Injectable()
export class ExpenseAccessService {
  constructor(
    private readonly repository: ExpenseRepository,
    private readonly authz: ExpenseAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
    private readonly failures: ExpenseFailureInjection,
  ) {}

  async create(actor: IdentityAuthzContext, input: CreateExpenseInput): Promise<ExpenseResponse> {
    try {
      await this.authz.assertExpenseAction(actor, AUTHZ_ACTIONS.FinanceExpenseCreate, {
        id: actor.identityId,
        unitId: input.unitId,
      });
      const validated = validateCreateExpenseInput(input);
      if (validated.receiptDocumentId) {
        const exists = await this.repository.documentExists(validated.receiptDocumentId);
        if (!exists) {
          throw new ExpenseError('EXPENSE_RECEIPT_NOT_FOUND');
        }
      }
      // Replay only an expense previously created by THIS requester in THIS
      // unit — a globally-reused idempotency key must never disclose another
      // requester's expense (idempotency-key IDOR).
      const existing = await this.repository.findOwnedByIdempotencyKey(
        validated.idempotencyKey,
        actor.identityId,
        validated.unitId,
      );
      if (existing) {
        return toExpenseResponse(existing);
      }
      const created = await this.repository.create({
        ...validated,
        requesterIdentityId: actor.identityId,
        actorIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FinanceExpenseCreate, created.expense.id);
      return toExpenseResponse(created);
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  /**
   * Listagem operacional de despesas. Exige concessão ativa de `finance:expense:list` no recurso
   * FinanceExpense: sem ela nada é listado. A tela deixa de depender de um identificador digitado.
   */
  async list(
    actor: IdentityAuthzContext,
    query: { limit: number; offset: number; status?: string; unitId?: string; q?: string },
  ): Promise<ExpenseListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.FinanceExpenseList,
      AUTHZ_RESOURCE_TYPES.FinanceExpense,
    );
    if (grants.length === 0) {
      throw mapExpenseError(expenseAccessDenied());
    }
    try {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        whereParts.push(`status = $${params.length + 1}::fin.expense_status`);
        params.push(query.status);
      }
      if (query.unitId) {
        whereParts.push(`unit_id = $${params.length + 1}`);
        params.push(query.unitId);
      }
      if (query.q) {
        whereParts.push(
          `(description ILIKE $${params.length + 1} OR cost_center_code ILIKE $${params.length + 1})`,
        );
        params.push(`%${query.q}%`);
      }
      const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

      const rows = await this.repository.listPage({
        whereClause,
        params,
        limit: query.limit,
        offset: query.offset,
      });
      const total =
        query.offset === 0 && rows.length < query.limit
          ? rows.length
          : await this.repository.countList(whereClause, params);

      return {
        items: rows.map(toExpenseSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  async get(actor: IdentityAuthzContext, expenseId: string): Promise<ExpenseResponse> {
    assertUuid(expenseId, 'expenseId');
    try {
      const current = await this.repository.findById(expenseId);
      if (!current) {
        throw new ExpenseError('EXPENSE_NOT_FOUND');
      }
      await this.authz.assertExpenseAction(actor, AUTHZ_ACTIONS.FinanceExpenseRead, {
        id: current.expense.id,
        unitId: current.expense.unit_id,
      });
      return toExpenseResponse(current);
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  async submit(
    actor: IdentityAuthzContext,
    expenseId: string,
    input: ExpenseVersionInput,
  ): Promise<ExpenseResponse> {
    assertUuid(expenseId, 'expenseId');
    try {
      const validated = validateExpenseVersionInput(input);
      const current = await this.requireExpense(expenseId);
      await this.authz.assertExpenseAction(actor, AUTHZ_ACTIONS.FinanceExpenseSubmit, {
        id: current.expense.id,
        unitId: current.expense.unit_id,
      });
      const submitted = await this.repository.submit(expenseId, validated.version);
      if (submitted === null) {
        throw new ExpenseError('EXPENSE_NOT_FOUND');
      }
      if (submitted === 'VERSION_CONFLICT') {
        throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.FinanceExpenseSubmit, expenseId);
      return toExpenseResponse(submitted);
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  async approve(
    actor: IdentityAuthzContext,
    expenseId: string,
    input: ExpenseVersionInput,
  ): Promise<ExpenseResponse> {
    assertUuid(expenseId, 'expenseId');
    try {
      const validated = validateExpenseVersionInput(input);
      const current = await this.requireExpense(expenseId);
      await this.authz.assertExpenseAction(actor, AUTHZ_ACTIONS.FinanceExpenseApprove, {
        id: current.expense.id,
        unitId: current.expense.unit_id,
      });
      assertExpenseNotSelfApproval(actor.identityId, current.expense.requester_identity_id);
      const scope = resolveSodScope(current.expense.unit_id);
      const decision = await this.sod.enforce(actor, {
        duty: SOD_DUTIES.ExpenseApprove,
        originatorIdentityId: current.expense.requester_identity_id,
        amount: current.expense.total_amount,
        ...scope,
      });
      const decided = await this.repository.decide(
        {
          expenseId,
          expectedVersion: validated.version,
          decision: 'APPROVED',
          actorIdentityId: actor.identityId,
          approvalRuleId: decision.ruleId,
          reason: null,
          openPayable: {
            unitId: current.expense.unit_id,
            counterpartyId: current.expense.requester_identity_id,
            expenseCategoryId: current.expense.expense_category_id,
            costCenterId: current.expense.cost_center_id,
            costCenterCode: current.expense.cost_center_code,
            principal: current.expense.total_amount,
            currencyCode: current.expense.currency_code,
            dueDate: String(current.expense.due_date).slice(0, 10),
            paymentTerms: current.expense.payment_terms,
          },
        },
        this.failures,
      );
      return this.finishDecision(actor, expenseId, decided, SECURITY_AUDIT_ACTIONS.FinanceExpenseApprove);
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  async reject(
    actor: IdentityAuthzContext,
    expenseId: string,
    input: RejectExpenseInput,
  ): Promise<ExpenseResponse> {
    assertUuid(expenseId, 'expenseId');
    try {
      const validated = validateRejectExpenseInput(input);
      const current = await this.requireExpense(expenseId);
      await this.authz.assertExpenseAction(actor, AUTHZ_ACTIONS.FinanceExpenseReject, {
        id: current.expense.id,
        unitId: current.expense.unit_id,
      });
      assertExpenseNotSelfApproval(actor.identityId, current.expense.requester_identity_id);
      const decided = await this.repository.decide({
        expenseId,
        expectedVersion: validated.version,
        decision: 'REJECTED',
        actorIdentityId: actor.identityId,
        approvalRuleId: null,
        reason: validated.reason,
      });
      return this.finishDecision(actor, expenseId, decided, SECURITY_AUDIT_ACTIONS.FinanceExpenseReject);
    } catch (error) {
      throw mapExpenseError(error);
    }
  }

  private async finishDecision(
    actor: IdentityAuthzContext,
    expenseId: string,
    decided: Awaited<ReturnType<ExpenseRepository['decide']>>,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
  ): Promise<ExpenseResponse> {
    if (decided === null) {
      throw new ExpenseError('EXPENSE_NOT_FOUND');
    }
    if (decided === 'VERSION_CONFLICT') {
      throw new ExpenseError('EXPENSE_VERSION_CONFLICT');
    }
    if (decided === 'REPLAY') {
      const current = await this.requireExpense(expenseId);
      return toExpenseResponse(current);
    }
    await this.audit(actor, action, expenseId);
    return toExpenseResponse(decided);
  }

  private async requireExpense(expenseId: string) {
    const current = await this.repository.findById(expenseId);
    if (!current) {
      throw new ExpenseError('EXPENSE_NOT_FOUND');
    }
    return current;
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    resourceId: string,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceExpense,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
      metadata: {},
    });
  }
}
