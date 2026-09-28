import { Inject, Injectable } from '@nestjs/common';
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
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import type {
  CommercialSupplierPort,
  FinancePayablePort,
  OpenPayableFromProcurementReceiptInput,
  OpenPayableFromSupplierInvoiceInput,
  OpenPayableFromTaxObligationInput,
  TaxObligationPayableView,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { ENTERPRISE_CORE_PORT } from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { PAYABLE_LIFECYCLES, PAYABLE_ORIGIN_KINDS, PayableError, summarizePayableAging, type PostedPayment } from '../domain/payable';
import {
  validateCancelPayableInput,
  validateCreateExpenseCategoryInput,
  validateOpenPayableInput,
  validatePayPayableInput,
  validateReversePaymentInput,
  type CancelPayableInput,
  type CreateExpenseCategoryInput,
  type OpenPayableInput,
  type PayPayableInput,
  type ReversePaymentInput,
} from '../domain/payable.validation';
import { PayablesRepository } from '../repositories/payables.repository';
import type { PayableRow } from '../repositories/payables.repository.types';
import {
  toExpenseCategoryResponse,
  toPayableDetailResponse,
  type ExpenseCategoryResponse,
  type PayableDetailResponse,
} from '../serializers/payables-response.serializer';
import { PayablesAccessAuthz } from './payables-access.authz';
import { mapPayableDomainError, payableNotFound } from './payables-access.errors';

/**
 * Pagina de contas a pagar.
 *
 * CONTRATO IDENTICO ao de recebiveis e ao `BudgetListResponse` canonico do modulo:
 * `{ items, limit, offset, total, totalPages }`. Simetria deliberada entre os dois lados
 * do razao — mesma paginacao, mesmos filtros, mesmo shape, mesmos erros.
 */
export type PayableListResponse = {
  items: PayableDetailResponse[];
  limit: number;
  offset: number;
  total: number;
  totalPages: number;
};

function buildPayablePage(
  items: PayableDetailResponse[],
  limit: number,
  offset: number,
  total: number,
): PayableListResponse {
  return { items, limit, offset, total, totalPages: limit > 0 ? Math.ceil(total / limit) : 0 };
}

/** Maior lote aceito por `parseFinanceListQuery` — usado por agregacoes sobre a carteira. */
const AGING_SCAN_LIMIT = 100;

/**
 * Ordenacao por allow-list: nenhum nome de coluna vem do cliente.
 *
 * Apenas colunas REAIS de `fin.payables`. `remaining_balance` NAO existe como coluna —
 * o saldo e derivado de `principal` menos pagamentos —, entao ordenar por ele exigiria
 * expressao em SQL; nao foi pedido e nao foi inventado aqui.
 */
function normalizePayableSortBy(value: string | undefined): 'due_date' | 'created_at' {
  return value === 'due_date' ? 'due_date' : 'created_at';
}

@Injectable()
export class PayablesAccessService implements FinancePayablePort {
  constructor(
    private readonly repository: PayablesRepository,
    private readonly authz: PayablesAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
    @Inject(ENTERPRISE_CORE_PORT.CommercialSupplier)
    private readonly suppliers: CommercialSupplierPort,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async createExpenseCategory(
    actor: IdentityAuthzContext,
    input: CreateExpenseCategoryInput,
  ): Promise<ExpenseCategoryResponse> {
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinanceExpenseCategoryCreate, {
      id: actor.identityId,
      unitId: 'global',
    });
    try {
      const validated = validateCreateExpenseCategoryInput(input);
      const row = await this.repository.createExpenseCategory({
        ...validated,
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceExpenseCategoryCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
        resourceId: row.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { code: row.code },
      });
      return toExpenseCategoryResponse(row);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async open(actor: IdentityAuthzContext, input: OpenPayableInput): Promise<PayableDetailResponse> {
    let validated: ReturnType<typeof validateOpenPayableInput>;
    try {
      validated = validateOpenPayableInput(input);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinancePayableOpen, {
      id: validated.originId,
      unitId: validated.unitId,
    });
    try {
      if (validated.supplierId) {
        await this.suppliers.requireActive(validated.supplierId);
      } else {
        await this.suppliers.assertNotInactive(validated.counterpartyId);
      }
      const opened = await this.repository.open({
        unitId: validated.unitId,
        counterpartyId: validated.counterpartyId,
        originKind: validated.originKind,
        originId: validated.originId,
        originReference: validated.originReference,
        expenseCategoryId: validated.expenseCategoryId,
        costCenterId: validated.costCenterId,
        costCenterCode: validated.costCenterCode,
        principal: validated.principal,
        currencyCode: validated.currencyCode,
        dueDate: validated.dueDate,
        paymentTerms: validated.paymentTerms,
        externalReference: validated.externalReference ?? null,
        actorIdentityId: actor.identityId,
        installments: validated.installments ?? [],
      });
      if (!opened.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: SECURITY_AUDIT_ACTIONS.FinancePayableOpen,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
          resourceId: opened.payable.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            originKind: validated.originKind,
            originId: validated.originId,
            originReference: validated.originReference,
            principal: validated.principal,
          },
        });
      }
      return this.toDetail(opened.payable);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  /**
   * Lista paginada de contas a pagar.
   *
   * ANTES: `listAll()` carregava a tabela inteira e decidia autorizacao em memoria.
   * AGORA: escopo derivado das concessoes do ator vai para o SQL, junto com filtro e
   * paginacao; `total` conta sob o mesmo `WHERE`. A confirmacao por linha permanece como
   * segunda barreira, restrita a pagina.
   */
  async list(
    actor: IdentityAuthzContext,
    query: { limit: number; offset: number; status?: string; q?: string; dueFrom?: string; dueTo?: string; sortBy?: string; sortDir?: string },
  ): Promise<PayableListResponse> {
    // Gate de LISTA (capability + grant aplicavel). Sem ele a negacao virava lista vazia.
    await this.authz.assertPayableList(actor);

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.FinancePayableList,
      AUTHZ_RESOURCE_TYPES.FinancePayable,
    );

    const scope = this.scopeEnforcement.buildFinancialTitleListFilter(grants);
    if (scope.clause === 'FALSE') {
      return buildPayablePage([], query.limit, query.offset, 0);
    }

    const page = await this.repository.listPage({
      scopeClause: scope.clause,
      scopeParams: scope.params,
      status: query.status,
      dueFrom: query.dueFrom,
      dueTo: query.dueTo,
      search: query.q,
      limit: query.limit,
      offset: query.offset,
      sortBy: normalizePayableSortBy(query.sortBy),
      sortDir: query.sortDir === 'asc' ? 'asc' : 'desc',
    });

    if (page.rows.length === 0) {
      return buildPayablePage([], query.limit, query.offset, page.total);
    }

    // Segunda barreira: mesma decisao por linha, agora apenas sobre a PAGINA.
    const allowed = await this.authz.filterPayableList(
      actor,
      page.rows.map((row) => ({ id: row.id, unitId: row.unit_id })),
    );
    const visible = page.rows.filter((_, index) => allowed[index] === true);

    // Filhos em DUAS queries para a pagina inteira (nunca por linha).
    const ids = visible.map((row) => row.id);
    const [installments, payments] = await Promise.all([
      this.repository.listInstallmentsByPayableIds(ids),
      this.repository.listPaymentsByPayableIds(ids),
    ]);

    const installmentsByPayable = new Map<string, typeof installments>();
    for (const row of installments) {
      const bucket = installmentsByPayable.get(row.payable_id) ?? [];
      bucket.push(row);
      installmentsByPayable.set(row.payable_id, bucket);
    }
    const paymentsByPayable = new Map<string, typeof payments>();
    for (const row of payments) {
      const bucket = paymentsByPayable.get(row.payable_id) ?? [];
      bucket.push(row);
      paymentsByPayable.set(row.payable_id, bucket);
    }

    return buildPayablePage(
      visible.map((row) =>
        toPayableDetailResponse(
          row,
          installmentsByPayable.get(row.id) ?? [],
          paymentsByPayable.get(row.id) ?? [],
        ),
      ),
      query.limit,
      query.offset,
      page.total,
    );
  }

  async aging(actor: IdentityAuthzContext, asOf?: Date) {
    // Aging agrega sobre a carteira inteira do ator, nao sobre uma pagina: usa o maior
    // lote permitido, com o mesmo escopo e filtro aplicados no SQL.
    const details = (await this.list(actor, { limit: AGING_SCAN_LIMIT, offset: 0 })).items;
    const items = details.map((item) => ({
      lifecycle: item.lifecycle,
      principal: item.principal,
      dueDate: item.dueDate,
      payments: item.payments.map(
        (payment): PostedPayment => ({
          kind: payment.kind,
          amount: payment.amount,
          installmentId: payment.installmentId,
          reversesPaymentId: payment.reversesPaymentId,
        }),
      ),
    }));
    return {
      asOf: (asOf ?? new Date()).toISOString(),
      buckets: summarizePayableAging(items, asOf),
    };
  }

  async getById(actor: IdentityAuthzContext, payableId: string): Promise<PayableDetailResponse> {
    assertUuid(payableId, 'payableId');
    const row = await this.repository.findById(payableId);
    if (!row) {
      throw payableNotFound();
    }
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinancePayableRead, {
      id: row.id,
      unitId: row.unit_id,
    });
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.FinancePayableRead,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
      resourceId: row.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });
    return this.toDetail(row);
  }

  async pay(
    actor: IdentityAuthzContext,
    payableId: string,
    input: PayPayableInput,
  ): Promise<PayableDetailResponse> {
    assertUuid(payableId, 'payableId');
    const row = await this.repository.findById(payableId);
    if (!row) {
      throw payableNotFound();
    }
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinancePayablePay, {
      id: row.id,
      unitId: row.unit_id,
    });
    try {
      const validated = validatePayPayableInput(input);
      const originatorIdentityId =
        row.origin_kind === PAYABLE_ORIGIN_KINDS.OperationalExpense
          ? row.counterparty_id
          : row.created_by_identity_id;
      const scope = resolveSodScope(row.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.PayablePay,
        originatorIdentityId,
        amount: validated.amount,
        ...scope,
      });
      const paid = await this.repository.pay({
        payableId,
        amount: validated.amount,
        currencyCode: row.currency_code,
        rowVersion: validated.rowVersion,
        idempotencyKey: validated.idempotencyKey,
        paymentReference: validated.paymentReference,
        installmentId: validated.installmentId,
        paidAt: validated.paidAt ?? new Date().toISOString(),
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinancePayablePay,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
        resourceId: payableId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          amount: validated.amount,
          paymentReference: validated.paymentReference,
          paymentId: paid.payment.id,
          originKind: paid.payment.origin_kind,
          originId: paid.payment.origin_id,
        },
      });
      return this.toDetail(paid.payable);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async reverse(
    actor: IdentityAuthzContext,
    payableId: string,
    paymentId: string,
    input: ReversePaymentInput,
  ): Promise<PayableDetailResponse> {
    assertUuid(payableId, 'payableId');
    assertUuid(paymentId, 'paymentId');
    const row = await this.repository.findById(payableId);
    if (!row) {
      throw payableNotFound();
    }
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinancePayableReverse, {
      id: row.id,
      unitId: row.unit_id,
    });
    try {
      const validated = validateReversePaymentInput(input);
      const payments = await this.repository.listPayments(payableId);
      const source = payments.find((payment) => payment.id === paymentId);
      const scope = resolveSodScope(row.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.PayableReverse,
        originatorIdentityId: source?.actor_identity_id,
        amount: validated.amount ?? source?.amount,
        ...scope,
      });
      const reversed = await this.repository.reverse({
        payableId,
        paymentId,
        amount: validated.amount,
        rowVersion: validated.rowVersion,
        idempotencyKey: validated.idempotencyKey,
        paymentReference: validated.paymentReference,
        reason: validated.reason,
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinancePayableReverse,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
        resourceId: payableId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          paymentId,
          reversalId: reversed.payment.id,
          amount: reversed.payment.amount,
          paymentReference: validated.paymentReference,
          reason: validated.reason,
        },
      });
      return this.toDetail(reversed.payable);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async cancel(
    actor: IdentityAuthzContext,
    payableId: string,
    input: CancelPayableInput,
  ): Promise<PayableDetailResponse> {
    assertUuid(payableId, 'payableId');
    const row = await this.repository.findById(payableId);
    if (!row) {
      throw payableNotFound();
    }
    await this.authz.assertPayableAction(actor, AUTHZ_ACTIONS.FinancePayableCancel, {
      id: row.id,
      unitId: row.unit_id,
    });
    try {
      const validated = validateCancelPayableInput(input);
      const cancelled = await this.repository.cancel({
        payableId,
        rowVersion: validated.rowVersion,
        cancelReason: validated.cancelReason,
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinancePayableCancel,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
        resourceId: cancelled.payable.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });
      return this.toDetail(cancelled.payable);
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async openFromTaxObligation(
    input: OpenPayableFromTaxObligationInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }> {
    try {
      const validated = validateOpenPayableInput({
        unitId: input.unitId,
        counterpartyId: input.counterpartyId,
        originKind: PAYABLE_ORIGIN_KINDS.TaxObligation,
        originId: input.taxObligationId,
        originReference: input.originReference,
        expenseCategoryId: input.expenseCategoryId,
        costCenterId: input.costCenterId,
        costCenterCode: input.costCenterCode,
        principal: input.principal,
        currencyCode: input.currencyCode,
        dueDate: input.dueDate,
        paymentTerms: input.paymentTerms,
        externalReference: input.externalReference ?? input.taxAssessmentId,
      });
      const opened = await this.repository.open({
        unitId: validated.unitId,
        counterpartyId: validated.counterpartyId,
        originKind: validated.originKind,
        originId: validated.originId,
        originReference: validated.originReference,
        expenseCategoryId: validated.expenseCategoryId,
        costCenterId: validated.costCenterId,
        costCenterCode: validated.costCenterCode,
        principal: validated.principal,
        currencyCode: validated.currencyCode,
        dueDate: validated.dueDate,
        paymentTerms: validated.paymentTerms,
        externalReference: validated.externalReference ?? null,
        actorIdentityId: input.actorIdentityId,
        installments: validated.installments ?? [],
      });
      if (!opened.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: input.actorIdentityId,
          action: SECURITY_AUDIT_ACTIONS.FinancePayableOpen,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
          resourceId: opened.payable.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            originKind: PAYABLE_ORIGIN_KINDS.TaxObligation,
            originId: input.taxObligationId,
            taxAssessmentId: input.taxAssessmentId,
            principal: validated.principal,
          },
        });
      }
      return {
        payableId: opened.payable.id,
        principal: opened.payable.principal,
        currencyCode: opened.payable.currency_code,
        idempotent: opened.idempotent,
      };
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async cancelFromTaxObligation(input: {
    taxObligationId: string;
    actorIdentityId: string;
    reason: string;
  }): Promise<void> {
    try {
      const row = await this.repository.findByOrigin(PAYABLE_ORIGIN_KINDS.TaxObligation, input.taxObligationId);
      if (!row) {
        return;
      }
      if (row.lifecycle === PAYABLE_LIFECYCLES.Cancelled) {
        return;
      }
      await this.repository.cancel({
        payableId: row.id,
        rowVersion: row.row_version,
        cancelReason: input.reason,
        actorIdentityId: input.actorIdentityId,
      });
    } catch (error) {
      if (error instanceof PayableError && error.code === 'PAYABLE_NOT_FOUND') {
        return;
      }
      throw mapPayableDomainError(error);
    }
  }

  async openFromProcurementReceipt(
    input: OpenPayableFromProcurementReceiptInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }> {
    try {
      const validated = validateOpenPayableInput({
        unitId: input.unitId,
        supplierId: input.supplierId,
        originKind: PAYABLE_ORIGIN_KINDS.Purchase,
        originId: input.receiptId,
        originReference: input.originReference,
        expenseCategoryId: input.expenseCategoryId,
        costCenterId: input.costCenterId,
        costCenterCode: input.costCenterCode,
        principal: input.principal,
        currencyCode: input.currencyCode,
        dueDate: input.dueDate,
        paymentTerms: input.paymentTerms,
        externalReference: input.supplierPurchaseOrderId,
      });
      if (validated.supplierId) {
        await this.suppliers.requireActive(validated.supplierId);
      }
      const opened = await this.repository.open({
        unitId: validated.unitId,
        counterpartyId: validated.counterpartyId,
        originKind: validated.originKind,
        originId: validated.originId,
        originReference: validated.originReference,
        expenseCategoryId: validated.expenseCategoryId,
        costCenterId: validated.costCenterId,
        costCenterCode: validated.costCenterCode,
        principal: validated.principal,
        currencyCode: validated.currencyCode,
        dueDate: validated.dueDate,
        paymentTerms: validated.paymentTerms,
        externalReference: validated.externalReference ?? null,
        actorIdentityId: input.actorIdentityId,
        installments: validated.installments ?? [],
      });
      if (!opened.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: input.actorIdentityId,
          action: SECURITY_AUDIT_ACTIONS.FinancePayableOpen,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
          resourceId: opened.payable.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            originKind: PAYABLE_ORIGIN_KINDS.Purchase,
            originId: input.receiptId,
            supplierPurchaseOrderId: input.supplierPurchaseOrderId,
            principal: validated.principal,
          },
        });
      }
      return {
        payableId: opened.payable.id,
        principal: opened.payable.principal,
        currencyCode: opened.payable.currency_code,
        idempotent: opened.idempotent,
      };
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async findByProcurementReceipt(receiptId: string): Promise<TaxObligationPayableView | null> {
    const row = await this.repository.findByOrigin(PAYABLE_ORIGIN_KINDS.Purchase, receiptId);
    if (!row) {
      return null;
    }
    return {
      payableId: row.id,
      principal: row.principal,
      currencyCode: row.currency_code,
      originKind: row.origin_kind,
      originId: row.origin_id,
      lifecycle: row.lifecycle,
    };
  }

  async openFromSupplierInvoice(
    input: OpenPayableFromSupplierInvoiceInput,
  ): Promise<{ payableId: string; principal: string; currencyCode: string; idempotent: boolean }> {
    try {
      const validated = validateOpenPayableInput({
        unitId: input.unitId,
        supplierId: input.supplierId,
        originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
        originId: input.invoiceId,
        originReference: input.originReference,
        expenseCategoryId: input.expenseCategoryId,
        costCenterId: input.costCenterId,
        costCenterCode: input.costCenterCode,
        principal: input.principal,
        currencyCode: input.currencyCode,
        dueDate: input.dueDate,
        paymentTerms: input.paymentTerms,
        externalReference: input.externalReference ?? null,
      });
      if (validated.supplierId) {
        await this.suppliers.requireActive(validated.supplierId);
      }
      const opened = await this.repository.open({
        unitId: validated.unitId,
        counterpartyId: validated.counterpartyId,
        originKind: validated.originKind,
        originId: validated.originId,
        originReference: validated.originReference,
        expenseCategoryId: validated.expenseCategoryId,
        costCenterId: validated.costCenterId,
        costCenterCode: validated.costCenterCode,
        principal: validated.principal,
        currencyCode: validated.currencyCode,
        dueDate: validated.dueDate,
        paymentTerms: validated.paymentTerms,
        externalReference: validated.externalReference ?? null,
        actorIdentityId: input.actorIdentityId,
        installments: validated.installments ?? [],
      });
      if (!opened.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: input.actorIdentityId,
          action: SECURITY_AUDIT_ACTIONS.FinancePayableOpen,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinancePayable,
          resourceId: opened.payable.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            originKind: PAYABLE_ORIGIN_KINDS.SupplierInvoice,
            originId: input.invoiceId,
            principal: validated.principal,
          },
        });
      }
      return {
        payableId: opened.payable.id,
        principal: opened.payable.principal,
        currencyCode: opened.payable.currency_code,
        idempotent: opened.idempotent,
      };
    } catch (error) {
      throw mapPayableDomainError(error);
    }
  }

  async findBySupplierInvoice(invoiceId: string): Promise<TaxObligationPayableView | null> {
    const row = await this.repository.findByOrigin(PAYABLE_ORIGIN_KINDS.SupplierInvoice, invoiceId);
    if (!row) {
      return null;
    }
    return {
      payableId: row.id,
      principal: row.principal,
      currencyCode: row.currency_code,
      originKind: row.origin_kind,
      originId: row.origin_id,
      lifecycle: row.lifecycle,
    };
  }

  async findByTaxObligation(taxObligationId: string): Promise<TaxObligationPayableView | null> {
    const row = await this.repository.findByOrigin(PAYABLE_ORIGIN_KINDS.TaxObligation, taxObligationId);
    if (!row) {
      return null;
    }
    return {
      payableId: row.id,
      principal: row.principal,
      currencyCode: row.currency_code,
      originKind: row.origin_kind,
      originId: row.origin_id,
      lifecycle: row.lifecycle,
    };
  }

  private async toDetail(row: PayableRow): Promise<PayableDetailResponse> {
    const [installments, payments] = await Promise.all([
      this.repository.listInstallments(row.id),
      this.repository.listPayments(row.id),
    ]);
    return toPayableDetailResponse(row, installments, payments);
  }
}
