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
import {
  ENTERPRISE_CORE_PORT,
  type CommercialSupplierPort,
  type FinancePayablePort,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { SupplierError } from '../../suppliers/domain/supplier';
import { ProcurementError } from '../domain/procurement';
import { ProcurementFailureInjection } from '../domain/procurement-failure-injection';
import {
  validateCreateSupplierInvoiceInput,
  validateValidateSupplierInvoiceInput,
  type CreateSupplierInvoiceInput,
  type ValidateSupplierInvoiceInput,
} from '../domain/supplier-invoice.validation';
import { SupplierInvoiceRepository } from '../repositories/supplier-invoice.repository';
import {
  toSupplierInvoiceResponse,
  toSupplierInvoiceSummaryResponse,
  type SupplierInvoiceListResponse,
  type SupplierInvoiceResponse,
} from '../serializers/supplier-invoice-response.serializer';
import type { SupplierInvoiceListQuery } from '../dto/procurement-list.dto';
import { ProcurementAccessAuthz } from './procurement-access.authz';
import { mapProcurementDomainError, procurementAccessDenied } from './procurement-access.errors';

@Injectable()
export class SupplierInvoiceAccessService {
  constructor(
    private readonly repository: SupplierInvoiceRepository,
    private readonly authz: ProcurementAccessAuthz,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly securityAudit: SecurityAuditService,
    private readonly failures: ProcurementFailureInjection,
    @Inject(ENTERPRISE_CORE_PORT.CommercialSupplier)
    private readonly suppliers: CommercialSupplierPort,
    @Optional()
    @Inject(ENTERPRISE_CORE_PORT.FinancePayable)
    private readonly payables?: FinancePayablePort,
  ) {}

  async create(actor: IdentityAuthzContext, input: CreateSupplierInvoiceInput): Promise<SupplierInvoiceResponse> {
    try {
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementInvoiceCreate, {
        id: actor.identityId,
      });
      const validated = validateCreateSupplierInvoiceInput(input);
      await this.requireActiveSupplier(validated.supplierId);
      await this.assertRelatedDocuments(validated);
      const existing = await this.repository.findByIdempotencyKey(validated.idempotencyKey);
      if (existing) {
        return toSupplierInvoiceResponse(existing);
      }
      const created = await this.repository.create(validated);
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementInvoiceCreate, created.id);
      return toSupplierInvoiceResponse(created);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  /**
   * Listagem operacional de notas do fornecedor. Exige concessão ativa de
   * `procurement:invoice:list`; a linha identifica o fornecedor por nome/CNPJ resolvido pelo
   * servidor, então a nota não precisa ser encontrada por identificador digitado.
   */
  async list(
    actor: IdentityAuthzContext,
    query: SupplierInvoiceListQuery,
  ): Promise<SupplierInvoiceListResponse> {
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      AUTHZ_ACTIONS.ProcurementInvoiceList,
      AUTHZ_RESOURCE_TYPES.Procurement,
    );
    if (grants.length === 0) {
      throw mapProcurementDomainError(procurementAccessDenied());
    }
    try {
      const whereParts: string[] = [];
      const params: unknown[] = [];
      if (query.status) {
        whereParts.push(`i.status = $${params.length + 1}::prc.supplier_invoice_status`);
        params.push(query.status);
      }
      if (query.supplierId) {
        whereParts.push(`i.supplier_id = $${params.length + 1}::uuid`);
        params.push(query.supplierId);
      }
      if (query.q) {
        whereParts.push(
          `(i.invoice_number ILIKE $${params.length + 1} OR s.legal_name ILIKE $${params.length + 1} OR s.trade_name ILIKE $${params.length + 1} OR s.normalized_tax_id ILIKE $${params.length + 1})`,
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
        items: rows.map(toSupplierInvoiceSummaryResponse),
        limit: query.limit,
        offset: query.offset,
        total,
        totalPages: Math.ceil(total / query.limit),
      };
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async get(actor: IdentityAuthzContext, invoiceId: string): Promise<SupplierInvoiceResponse> {
    assertUuid(invoiceId, 'invoiceId');
    try {
      const row = await this.repository.findById(invoiceId);
      if (!row) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementInvoiceRead, { id: row.id });
      return toSupplierInvoiceResponse(row);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  async validate(
    actor: IdentityAuthzContext,
    invoiceId: string,
    input: ValidateSupplierInvoiceInput,
  ): Promise<SupplierInvoiceResponse> {
    assertUuid(invoiceId, 'invoiceId');
    try {
      const validated = validateValidateSupplierInvoiceInput(input);
      const current = await this.repository.findById(invoiceId);
      if (!current) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      await this.authz.assertProcurementAction(actor, AUTHZ_ACTIONS.ProcurementInvoiceValidate, {
        id: current.id,
      });
      await this.requireActiveSupplier(current.supplier_id);

      const prepared = await this.repository.prepareValidation({
        invoiceId,
        expectedVersion: validated.version,
        failures: this.failures,
      });
      if (prepared === null) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (prepared === 'VERSION_CONFLICT') {
        throw new ProcurementError('PROCUREMENT_VERSION_CONFLICT');
      }
      if (prepared.kind === 'REPLAY' || prepared.kind === 'ATTACH_EXISTING') {
        if (prepared.kind === 'ATTACH_EXISTING') {
          await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementInvoiceValidate, invoiceId);
        }
        return toSupplierInvoiceResponse(prepared.invoice);
      }

      if (!this.payables) {
        throw new ProcurementError('PROCUREMENT_INVALID');
      }
      const opened = await this.payables.openFromSupplierInvoice({
        invoiceId: prepared.invoice.id,
        unitId: prepared.invoice.unit_id,
        supplierId: prepared.invoice.supplier_id,
        principal: prepared.invoice.total_amount,
        currencyCode: prepared.invoice.currency_code,
        dueDate: String(prepared.invoice.due_date).slice(0, 10),
        paymentTerms: prepared.invoice.payment_terms,
        expenseCategoryId: validated.expenseCategoryId,
        costCenterId: validated.costCenterId,
        costCenterCode: validated.costCenterCode,
        originReference: `SINV-${prepared.invoice.invoice_number}`,
        externalReference: prepared.invoice.supplier_purchase_order_id,
        actorIdentityId: actor.identityId,
      });
      const attached =
        (await this.repository.attachPayable(prepared.invoice.id, opened.payableId)) ??
        (await this.attachExistingPayable(prepared.invoice.id));
      if (prepared.invoice.goods_receipt_id) {
        await this.repository.attachPayableToReceipt(prepared.invoice.goods_receipt_id, opened.payableId);
      }
      if (!opened.idempotent) {
        await this.audit(actor, SECURITY_AUDIT_ACTIONS.ProcurementInvoiceValidate, invoiceId);
      }
      return toSupplierInvoiceResponse(attached);
    } catch (error) {
      throw mapProcurementDomainError(error);
    }
  }

  private async attachExistingPayable(invoiceId: string) {
    const existing = await this.payables?.findBySupplierInvoice(invoiceId);
    if (!existing) {
      throw new ProcurementError('PROCUREMENT_INVALID');
    }
    const attached = await this.repository.attachPayable(invoiceId, existing.payableId);
    if (!attached) {
      throw new ProcurementError('PROCUREMENT_NOT_FOUND');
    }
    return attached;
  }

  private async requireActiveSupplier(supplierId: string): Promise<void> {
    try {
      await this.suppliers.requireActive(supplierId);
    } catch (error) {
      if (error instanceof SupplierError) {
        throw new ProcurementError('PROCUREMENT_INVALID');
      }
      throw error;
    }
  }

  private async assertRelatedDocuments(input: {
    supplierId: string;
    unitId: string;
    currencyCode: string;
    supplierPurchaseOrderId: string | null;
    goodsReceiptId: string | null;
  }): Promise<void> {
    if (input.goodsReceiptId) {
      const receipt = await this.repository.findReceiptById(input.goodsReceiptId);
      if (!receipt) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (input.supplierPurchaseOrderId && receipt.supplier_purchase_order_id !== input.supplierPurchaseOrderId) {
        throw new ProcurementError('PROCUREMENT_INVALID');
      }
      const order = await this.repository.findOrderById(receipt.supplier_purchase_order_id);
      if (!order) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (order.supplier_id !== input.supplierId || order.unit_id !== input.unitId) {
        throw new ProcurementError('PROCUREMENT_INVALID');
      }
      return;
    }
    if (input.supplierPurchaseOrderId) {
      const order = await this.repository.findOrderById(input.supplierPurchaseOrderId);
      if (!order) {
        throw new ProcurementError('PROCUREMENT_NOT_FOUND');
      }
      if (order.supplier_id !== input.supplierId || order.unit_id !== input.unitId) {
        throw new ProcurementError('PROCUREMENT_INVALID');
      }
    }
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
