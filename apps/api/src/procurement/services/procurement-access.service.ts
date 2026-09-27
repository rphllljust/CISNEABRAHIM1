import { Inject, Injectable, Optional } from '@nestjs/common';
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
import {
  ENTERPRISE_CORE_PORT,
  type CommercialSupplierPort,
  type FinancePayablePort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { sumMoneyAmounts } from '../../platform/kernel/money-math';
import { assertUuid } from '../../platform/kernel/uuid';
import { SupplierError } from '../../suppliers/domain/supplier';
import {
  APPROVAL_DECISIONS,
  PURCHASE_REQUEST_STATUSES,
  ProcurementError,
  assertOrderCanCancel,
  assertRequestCanApprove,
  assertRequestCanCancel,
  assertRequestCanIssue,
  assertRequestCanSubmit,
} from '../domain/procurement';
import { ProcurementFailureInjection } from '../domain/procurement-failure-injection';
import {
  validateCancelReason,
  validateCreatePurchaseRequestInput,
  validateIssueInput,
  validateReceiveInput,
  validateVersionedInput,
  type CreatePurchaseRequestInput,
  type IssueSupplierPurchaseOrderInput,
  type ReceiveSupplierPurchaseOrderInput,
  type VersionedProcurementInput,
} from '../domain/procurement.validation';
import { ProcurementRepository } from '../repositories/procurement.repository';
import {
  toPurchaseRequestResponse,
  toPurchaseRequestSummaryResponse,
  toSupplierPurchaseOrderResponse,
  toSupplierPurchaseOrderSummaryResponse,
  type PurchaseRequestListResponse,
  type PurchaseRequestResponse,
  type SupplierPurchaseOrderListResponse,
  type SupplierPurchaseOrderResponse,
} from '../serializers/procurement-response.serializer';
import type {
  PurchaseRequestListQuery,
  SupplierPurchaseOrderListQuery,
} from '../dto/procurement-list.dto';
import { ProcurementAccessAuthz } from './procurement-access.authz';
import { mapProcurementDomainError, procurementAccessDenied } from './procurement-access.errors';

@Injectable()
export class ProcurementAccessService {
  constructor(
    private readonly repository: ProcurementRepository,
    private readonly authz: ProcurementAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
    private readonly failures: ProcurementFailureInjection,
    @Inject(ENTERPRISE_CORE_PORT.CommercialSupplier)
    private readonly suppliers: CommercialSupplierPort,
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.FinancePayable)
    private readonly payables?: FinancePayablePort,
  ) {}

  async createRequest(
    actor: IdentityAuthzContext,
    input: CreatePurchaseRequestInput,
  ): Promise<PurchaseRequestResponse> {
    try {
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementRequestCreate, {
        id: actor.identityId,
      });
      const validated = validateCreatePurchaseRequestInput(input);
      const created = await this.repository.createRequest({
        ...validated,
        requesterIdentityId: actor.identityId,
      });
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementRequestCreate, created.id);
      return this.assembleRequest(created.id);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  /**
   * Listagem operacional de solicitações de compra. Exige concessão ativa de
   * `procurement:request:list`: sem ela, nada é listado (a listagem nunca mostra o que o ator
   * não pode ler). A tela deixa de depender de um identificador digitado para encontrar a
   * solicitação.
   */
  async listRequests(
    actor: IdentityAuthzContext,
    query: PurchaseRequestListQuery,
  ): Promise<PurchaseRequestListResponse> {
    await this.assertList(actor, AUTHZ_ACTIONS.ProcurementRequestList);
    try {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        whereParts.push(`r.status = $${params.length + 1}::prc.purchase_request_status`);
        params.push(query.status);
      }
      if (query.q) {
        whereParts.push(`r.justification ILIKE $${params.length + 1}`);
        params.push(`%${query.q}%`);
      }
      const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

      const rows = await this.repository.listRequestPage({
        whereClause,
        params,
        limit: query.limit,
        offset: query.offset,
      });
      const total =
        query.offset === 0 && rows.length < query.limit
          ? rows.length
          : await this.repository.countRequestList(whereClause, params);

      return {
        items: rows.map(toPurchaseRequestSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  /**
   * Listagem operacional de pedidos ao fornecedor. A referência do fornecedor vem resolvida pelo
   * servidor, então a linha identifica o fornecedor por nome/CNPJ em vez de exigir o
   * identificador técnico.
   */
  async listOrders(
    actor: IdentityAuthzContext,
    query: SupplierPurchaseOrderListQuery,
  ): Promise<SupplierPurchaseOrderListResponse> {
    await this.assertList(actor, AUTHZ_ACTIONS.ProcurementOrderList);
    try {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        whereParts.push(`o.status = $${params.length + 1}::prc.supplier_purchase_order_status`);
        params.push(query.status);
      }
      if (query.supplierId) {
        whereParts.push(`o.supplier_id = $${params.length + 1}::uuid`);
        params.push(query.supplierId);
      }
      if (query.q) {
        whereParts.push(
          `(s.legal_name ILIKE $${params.length + 1} OR s.trade_name ILIKE $${params.length + 1} OR s.normalized_tax_id ILIKE $${params.length + 1})`,
        );
        params.push(`%${query.q}%`);
      }
      const whereClause = whereParts.length > 0 ? whereParts.join(' AND ') : 'TRUE';

      const rows = await this.repository.listOrderPage({
        whereClause,
        params,
        limit: query.limit,
        offset: query.offset,
      });
      const total =
        query.offset === 0 && rows.length < query.limit
          ? rows.length
          : await this.repository.countOrderList(whereClause, params);

      return {
        items: rows.map(toSupplierPurchaseOrderSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  private async assertList(
    actor: IdentityAuthzContext,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
  ): Promise<void> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.Procurement,
    );
    if (grants.length === 0) {
      throw mapProcurementDomainError(procurementAccessDenied());
    }
  }

  async getRequest(actor: IdentityAuthzContext, requestId: string): Promise<PurchaseRequestResponse> {
    assertUuid(requestId, 'requestId');
    try {
      const row = await this.repository.findRequestById(requestId);
      if (!row) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementRequestRead, { id: row.id });
      return this.assembleRequest(row.id);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async submitRequest(
    actor: IdentityAuthzContext,
    requestId: string,
    input: VersionedProcurementInput,
  ): Promise<PurchaseRequestResponse> {
    return this.transitionRequest(actor, requestId, input, AUTHZ_ACTIONS.ProcurementRequestSubmit, (status) => {
      assertRequestCanSubmit(status);
      return { status: PURCHASE_REQUEST_STATUSES.PendingApproval, submitted: true };
    });
  }

  async approveRequest(
    actor: IdentityAuthzContext,
    requestId: string,
    input: VersionedProcurementInput,
  ): Promise<PurchaseRequestResponse> {
    return this.transitionRequest(actor, requestId, input, AUTHZ_ACTIONS.ProcurementRequestApprove, (status) => {
      assertRequestCanApprove(status);
      return {
        status: PURCHASE_REQUEST_STATUSES.Approved,
        approval: { actorIdentityId: actor.identityId, decision: APPROVAL_DECISIONS.Approved, reason: input.reason },
      };
    });
  }

  async rejectRequest(
    actor: IdentityAuthzContext,
    requestId: string,
    input: VersionedProcurementInput,
  ): Promise<PurchaseRequestResponse> {
    return this.transitionRequest(actor, requestId, input, AUTHZ_ACTIONS.ProcurementRequestReject, (status) => {
      assertRequestCanApprove(status);
      return {
        status: PURCHASE_REQUEST_STATUSES.Rejected,
        approval: { actorIdentityId: actor.identityId, decision: APPROVAL_DECISIONS.Rejected, reason: input.reason },
      };
    });
  }

  async cancelRequest(
    actor: IdentityAuthzContext,
    requestId: string,
    input: VersionedProcurementInput,
  ): Promise<PurchaseRequestResponse> {
    return this.transitionRequest(actor, requestId, input, AUTHZ_ACTIONS.ProcurementRequestCancel, async (status) => {
      const existingOrder = await this.repository.findOrderByRequestId(requestId);
      assertRequestCanCancel(status, Boolean(existingOrder));
      return {
        status: PURCHASE_REQUEST_STATUSES.Cancelled,
        cancelled: true,
        cancelReason: validateCancelReason(input.reason),
      };
    });
  }

  async issueOrder(
    actor: IdentityAuthzContext,
    requestId: string,
    input: IssueSupplierPurchaseOrderInput,
  ): Promise<SupplierPurchaseOrderResponse> {
    assertUuid(requestId, 'requestId');
    try {
      const validated = validateIssueInput(input);
      const request = await this.repository.findRequestById(requestId);
      if (!request) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderIssue, { id: request.id });
      assertRequestCanIssue(request.status);
      let supplier;
      try {
        supplier = await this.suppliers.requireActive(validated.supplierId);
      } catch (error) {
        if (error instanceof SupplierError) {
          throw new ProcurementError('PROCUREMENT_INVALID');
        }
        throw error;
      }
      const issued = await this.repository.issueOrder({
        requestId,
        expectedRequestVersion: validated.version,
        supplierId: supplier.id,
        paymentTerms: validated.paymentTerms ?? supplier.paymentTerms ?? '30 DDL',
      });
      if (issued === 'VERSION_CONFLICT') {
        throw new ProcurementError('PROCUREMENT_VERSION_CONFLICT');
      }
      if (issued === 'DUPLICATE') {
        throw new ProcurementError('PROCUREMENT_DUPLICATE_ORDER');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementOrderIssue, issued.id);
      return this.assembleOrder(issued.id);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async getOrder(actor: IdentityAuthzContext, orderId: string): Promise<SupplierPurchaseOrderResponse> {
    assertUuid(orderId, 'orderId');
    try {
      const row = await this.repository.findOrderById(orderId);
      if (!row) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderRead, { id: row.id });
      return this.assembleOrder(row.id);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async receiveOrder(
    actor: IdentityAuthzContext,
    orderId: string,
    input: ReceiveSupplierPurchaseOrderInput,
  ): Promise<SupplierPurchaseOrderResponse> {
    assertUuid(orderId, 'orderId');
    try {
      const validated = validateReceiveInput(input);
      const order = await this.repository.findOrderById(orderId);
      if (!order) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderReceive, { id: order.id });
      const received = await this.repository.receive({
        orderId,
        expectedVersion: validated.version,
        actorIdentityId: actor.identityId,
        idempotencyKey: validated.idempotencyKey,
        lines: validated.lines,
        failures: this.failures,
      });
      if (received === null) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (received === 'VERSION_CONFLICT') {
        throw new ProcurementError('PROCUREMENT_VERSION_CONFLICT');
      }
      if (!received.receipt.payable_id) {
        const existingInvoicePayable = await this.repository.findValidatedInvoicePayableForOrder(
          received.order.id,
        );
        if (existingInvoicePayable) {
          await this.repository.attachPayable(received.receipt.id, existingInvoicePayable);
        } else {
          if (!this.payables) {
            throw new ProcurementError('PROCUREMENT_INVALID');
          }
          const principal = await this.repository.receiptPrincipal(received.receipt.id);
          const opened = await this.payables.openFromProcurementReceipt({
            receiptId: received.receipt.id,
            supplierPurchaseOrderId: received.order.id,
            unitId: received.order.unit_id,
            supplierId: received.order.supplier_id,
            principal,
            currencyCode: received.order.currency_code,
            dueDate: validated.dueDate,
            paymentTerms: received.order.payment_terms,
            expenseCategoryId: validated.expenseCategoryId,
            costCenterId: validated.costCenterId,
            costCenterCode: validated.costCenterCode,
            originReference: `SPO-${received.order.id}`,
            actorIdentityId: actor.identityId,
          });
          await this.repository.attachPayable(received.receipt.id, opened.payableId);
        }
      }
      if (!received.replay) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementOrderReceive, received.receipt.id);
      }
      return this.assembleOrder(orderId);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async cancelOrder(
    actor: IdentityAuthzContext,
    orderId: string,
    input: VersionedProcurementInput,
  ): Promise<SupplierPurchaseOrderResponse> {
    assertUuid(orderId, 'orderId');
    try {
      const validated = validateVersionedInput(input);
      const order = await this.repository.findOrderById(orderId);
      if (!order) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementOrderCancel, { id: order.id });
      const lines = await this.repository.listOrderLines(order.id);
      assertOrderCanCancel(order.status, sumMoneyAmounts(lines.map((line) => line.received_quantity)));
      const cancelled = await this.repository.cancelOrder({
        orderId,
        expectedVersion: validated.version,
        reason: validateCancelReason(validated.reason),
      });
      if (cancelled === null) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (cancelled === 'VERSION_CONFLICT') {
        throw new ProcurementError('PROCUREMENT_VERSION_CONFLICT');
      }
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementOrderCancel, orderId);
      return this.assembleOrder(orderId);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  private async transitionRequest(
    actor: IdentityAuthzContext,
    requestId: string,
    input: VersionedProcurementInput,
    action: (typeof AUTHZ_ACTIONS)[keyof typeof AUTHZ_ACTIONS],
    next: (status: string) =>
      | {
          status: string;
          submitted?: boolean;
          cancelled?: boolean;
          cancelReason?: string;
          approval?: { actorIdentityId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string };
        }
      | Promise<{
          status: string;
          submitted?: boolean;
          cancelled?: boolean;
          cancelReason?: string;
          approval?: { actorIdentityId: string; decision: 'APPROVED' | 'REJECTED'; reason?: string };
        }>,
  ): Promise<PurchaseRequestResponse> {
    assertUuid(requestId, 'requestId');
    try {
      const validated = validateVersionedInput(input);
      const current = await this.repository.findRequestById(requestId);
      if (!current) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, action, { id: current.id });
      if (
        action === AUTHZ_ACTIONS.ProcurementRequestApprove ||
        action === AUTHZ_ACTIONS.ProcurementRequestReject
      ) {
        const lines = await this.repository.listRequestLines(requestId);
        const amount = sumMoneyAmounts(lines.map((line) => line.line_amount));
        const scope = resolveSodScope(current.unit_id);
        await this.sod.enforce(actor, {
          duty: SOD_DUTIES.PurchaseApprove,
          originatorIdentityId: current.requester_identity_id,
          amount,
          ...scope,
        });
      }
      const transition = await next(current.status);
      const updated = await this.repository.transitionRequest({
        requestId,
        expectedVersion: validated.version,
        ...transition,
      });
      if (updated === null) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (updated === 'VERSION_CONFLICT') {
        throw new ProcurementError('PROCUREMENT_VERSION_CONFLICT');
      }
      await this.audit(actor, auditActionFor(action), requestId);
      return this.assembleRequest(requestId);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  private async assembleRequest(requestId: string): Promise<PurchaseRequestResponse> {
    const row = await this.repository.findRequestById(requestId);
    if (!row) {
      throw new ProcurementError('PROCUREMENT_NOT_FOUND');
    }
    return toPurchaseRequestResponse(row, await this.repository.listRequestLines(requestId));
  }

  private async assembleOrder(orderId: string): Promise<SupplierPurchaseOrderResponse> {
    const row = await this.repository.findOrderById(orderId);
    if (!row) {
      throw new ProcurementError('PROCUREMENT_NOT_FOUND');
    }
    const [lines, receipts, supplier] = await Promise.all([
      this.repository.listOrderLines(orderId),
      this.repository.listReceipts(orderId),
      this.repository.findSupplierReference(row.supplier_id),
    ]);
    return toSupplierPurchaseOrderResponse(row, lines, receipts, supplier);
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
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.Procurement,
      resourceId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });
  }
}

function auditActionFor(
  action: string,
): (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS] {
  switch (action) {
    case AUTHZ_ACTIONS.ProcurementRequestSubmit:
      return SECURITY_AUDIT_ACTIONS.ProcurementRequestSubmit;
    case AUTHZ_ACTIONS.ProcurementRequestApprove:
      return SECURITY_AUDIT_ACTIONS.ProcurementRequestApprove;
    case AUTHZ_ACTIONS.ProcurementRequestReject:
      return SECURITY_AUDIT_ACTIONS.ProcurementRequestReject;
    case AUTHZ_ACTIONS.ProcurementRequestCancel:
      return SECURITY_AUDIT_ACTIONS.ProcurementRequestCancel;
    default:
      return SECURITY_AUDIT_ACTIONS.ProcurementRequestCreate;
  }
}
