import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import {
  assertPurchaseOrderOverrunAuthorization,
  PurchaseOrderBalanceError,
} from '../domain/purchase-order-balance';
import {
  buildPurchaseOrderCommercialSnapshot,
  buildPurchaseOrderItemCommercialSnapshot,
} from '../domain/purchase-order-commercial-snapshot';
import { sumPurchaseOrderItemLineTotals } from '../domain/purchase-order-totals';
import type {
  CancelPurchaseOrderInput,
  CreatePurchaseOrderInput,
  LinkPurchaseOrderDocumentInput,
  UpdatePurchaseOrderDraftInput,
} from '../domain/purchase-order.validation';
import { PurchaseOrdersRepository } from '../repositories/purchase-orders.repository';
import type { PurchaseOrderRow } from '../repositories/purchase-orders.repository.types';
import {
  toPurchaseOrderDetailResponse,
  toPurchaseOrderListItemResponse,
  toPurchaseOrderResponse,
  type PurchaseOrderDetailResponse,
  type PurchaseOrderListItemResponse,
} from '../serializers/purchase-orders-response.serializer';
import { PurchaseOrdersAccessAuthz } from './purchase-orders-access.authz';
import {
  isDuplicatePoViolation,
  purchaseOrdersAccessNotFound,
  purchaseOrdersClientNotFound,
  purchaseOrdersDuplicatePo,
  purchaseOrdersInUse,
  purchaseOrdersInvalidState,
  purchaseOrdersOverrunAmountRequired,
  purchaseOrdersOverrunJustificationRequired,
  purchaseOrdersVersionConflict,
} from './purchase-orders-access.errors';
import {
  assertValidPurchaseOrderId,
  generatePurchaseOrderInternalCode,
  resolveCancelPurchaseOrderInput,
  resolveCreatePurchaseOrderInput,
  resolveLinkPurchaseOrderDocumentInput,
  resolveRegisterPurchaseOrderInput,
  resolveUpdatePurchaseOrderDraftInput,
} from './purchase-orders-input-resolution';
import { PurchaseOrdersReferenceValidationService } from './purchase-orders-reference-validation.service';

@Injectable()
export class PurchaseOrdersAccessService {
  constructor(
    private readonly purchaseOrdersRepository: PurchaseOrdersRepository,
    private readonly authz: PurchaseOrdersAccessAuthz,
    private readonly referenceValidation: PurchaseOrdersReferenceValidationService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async create(
    actor: IdentityAuthzContext,
    input: CreatePurchaseOrderInput,
  ): Promise<PurchaseOrderDetailResponse> {
    const validated = resolveCreatePurchaseOrderInput(input);

    await this.authz.assertCreateAction(actor, input.clientId, input.unitId);
    await this.referenceValidation.assertUnitRegistered(input.unitId);
    await this.referenceValidation.assertClientActive(input.clientId);

    if (input.originalDocumentId) {
      await this.referenceValidation.assertDocumentAccessible(
        actor,
        input.originalDocumentId,
        input.unitId,
      );
    }

    await this.referenceValidation.assertServiceReferences(validated.items);

    try {
      const created = await this.purchaseOrdersRepository.createPurchaseOrder({
        internalCode: generatePurchaseOrderInternalCode(),
        clientId: input.clientId,
        unitId: input.unitId,
        poNumber: validated.poNumber,
        rcNumber: input.rcNumber?.trim() || null,
        issueDate: input.issueDate ?? null,
        buyerContact: validated.buyerContact,
        serviceManager: input.serviceManager?.trim() || null,
        deliveryLocation: validated.deliveryLocation,
        billingLocation: validated.billingLocation,
        currencyCode: validated.currencyCode,
        pricingStructure: validated.pricingStructure,
        totalAmount: validated.totalAmount,
        paymentTerms: input.paymentTerms?.trim() || null,
        paymentMethod: input.paymentMethod?.trim() || null,
        originalDocumentId: input.originalDocumentId ?? null,
        items: validated.items,
        billingRules: validated.billingRules,
        actorIdentityId: actor.identityId,
      });

      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.CommercialPurchaseOrderCreate,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialPurchaseOrder,
        resourceId: created.purchaseOrder.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: {
          poNumber: created.purchaseOrder.po_number,
          internalCode: created.purchaseOrder.internal_code,
        },
      });

      return toPurchaseOrderDetailResponse(
        created.purchaseOrder,
        created.items,
        created.billingRules,
        [],
      );
    } catch (error) {
      if (isDuplicatePoViolation(error)) {
        throw purchaseOrdersDuplicatePo();
      }
      throw error;
    }
  }

  async updateDraft(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    input: UpdatePurchaseOrderDraftInput,
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    await this.requirePurchaseOrder(actor, purchaseOrderId, AUTHZ_ACTIONS.CommercialPurchaseOrderUpdate);

    const validated = resolveUpdatePurchaseOrderDraftInput(input);

    if (validated.items) {
      await this.referenceValidation.assertServiceReferences(validated.items);
    }

    try {
      const updated = await this.purchaseOrdersRepository.updateDraft({
        purchaseOrderId,
        rowVersion: validated.rowVersion,
        poNumber: validated.poNumber,
        rcNumber: validated.rcNumber,
        issueDate: validated.issueDate,
        buyerContact: validated.buyerContact,
        serviceManager: validated.serviceManager,
        deliveryLocation: validated.deliveryLocation,
        billingLocation: validated.billingLocation,
        currencyCode: validated.currencyCode,
        pricingStructure: validated.pricingStructure,
        totalAmount: validated.totalAmount,
        paymentTerms: validated.paymentTerms,
        paymentMethod: validated.paymentMethod,
        originalDocumentId: validated.originalDocumentId,
        items: validated.items,
        billingRules: validated.billingRules,
        actorIdentityId: actor.identityId,
      });

      if (updated === 'VERSION_CONFLICT') {
        throw purchaseOrdersVersionConflict();
      }
      if (updated === 'INVALID_STATE') {
        throw purchaseOrdersInvalidState();
      }

      const documentLinks = await this.purchaseOrdersRepository.listDocumentLinks(purchaseOrderId);
      return toPurchaseOrderDetailResponse(
        updated.purchaseOrder,
        updated.items,
        updated.billingRules,
        documentLinks,
      );
    } catch (error) {
      if (isDuplicatePoViolation(error)) {
        throw purchaseOrdersDuplicatePo();
      }
      throw error;
    }
  }

  async register(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    input: { rowVersion: number },
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    const purchaseOrder = await this.requirePurchaseOrder(
      actor,
      purchaseOrderId,
      AUTHZ_ACTIONS.CommercialPurchaseOrderRegister,
    );

    const validated = resolveRegisterPurchaseOrderInput(input);
    await this.referenceValidation.assertRegisterReady(purchaseOrder);

    const client = await this.purchaseOrdersRepository.findClientById(purchaseOrder.client_id);
    if (!client) {
      throw purchaseOrdersClientNotFound();
    }

    const items = await this.purchaseOrdersRepository.listItems(purchaseOrderId);
    const snapshottedAt = new Date().toISOString();
    const itemSnapshots = await Promise.all(
      items.map(async (item) => {
        const serviceSnapshot = !item.service_definition_id
          ? null
          : await this.purchaseOrdersRepository
              .findServiceSnapshot(
                item.service_definition_id,
                item.service_definition_version_id ?? undefined,
              )
              .then((service) =>
                service
                  ? {
                      serviceDefinitionId: service.service_definition_id,
                      serviceDefinitionVersionId: service.service_definition_version_id,
                      code: service.code,
                      name: service.name,
                      version: service.version,
                      versionStatus: service.version_status,
                    }
                  : null,
              );

        return {
          lineNumber: item.line_number,
          serviceSnapshot,
          commercialSnapshot: buildPurchaseOrderItemCommercialSnapshot(item, snapshottedAt),
        };
      }),
    );

    const registered = await this.purchaseOrdersRepository.register({
      purchaseOrderId,
      rowVersion: validated.rowVersion,
      clientSnapshot: {
        clientId: client.id,
        legalName: client.legal_name,
        tradeName: client.trade_name,
        normalizedTaxId: client.normalized_tax_id,
        status: client.status,
        snapshottedAt,
      },
      commercialSnapshot: buildPurchaseOrderCommercialSnapshot(purchaseOrder, snapshottedAt),
      itemsLineTotal: sumPurchaseOrderItemLineTotals(items),
      itemSnapshots,
      actorIdentityId: actor.identityId,
    });

    if (registered === 'VERSION_CONFLICT') {
      throw purchaseOrdersVersionConflict();
    }
    if (registered === 'INVALID_STATE') {
      throw purchaseOrdersInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialPurchaseOrderRegister,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialPurchaseOrder,
      resourceId: purchaseOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { poNumber: registered.po_number },
    });

    const billingRules = await this.purchaseOrdersRepository.listBillingRules(purchaseOrderId);
    const documentLinks = await this.purchaseOrdersRepository.listDocumentLinks(purchaseOrderId);
    const registeredItems = await this.purchaseOrdersRepository.listItems(purchaseOrderId);
    return toPurchaseOrderDetailResponse(registered, registeredItems, billingRules, documentLinks);
  }

  async cancel(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    input: CancelPurchaseOrderInput,
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    await this.requirePurchaseOrder(actor, purchaseOrderId, AUTHZ_ACTIONS.CommercialPurchaseOrderCancel);

    const validated = resolveCancelPurchaseOrderInput(input);

    if (await this.purchaseOrdersRepository.hasBlockingReferences(purchaseOrderId)) {
      throw purchaseOrdersInUse();
    }

    const cancelled = await this.purchaseOrdersRepository.cancel(
      purchaseOrderId,
      validated.rowVersion,
      actor.identityId,
      validated.cancellationReason,
    );

    if (cancelled === 'VERSION_CONFLICT') {
      throw purchaseOrdersVersionConflict();
    }
    if (cancelled === 'INVALID_STATE') {
      throw purchaseOrdersInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialPurchaseOrderCancel,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialPurchaseOrder,
      resourceId: purchaseOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });

    const items = await this.purchaseOrdersRepository.listItems(purchaseOrderId);
    const billingRules = await this.purchaseOrdersRepository.listBillingRules(purchaseOrderId);
    const documentLinks = await this.purchaseOrdersRepository.listDocumentLinks(purchaseOrderId);
    return toPurchaseOrderDetailResponse(cancelled, items, billingRules, documentLinks);
  }

  async authorizeOverrun(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    input: { rowVersion: number; amount: string; justification: string },
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    await this.requirePurchaseOrder(
      actor,
      purchaseOrderId,
      AUTHZ_ACTIONS.CommercialPurchaseOrderAuthorizeOverrun,
    );

    let amount: string;
    try {
      amount = assertPurchaseOrderOverrunAuthorization({
        amount: input.amount,
        justification: input.justification,
      });
    } catch (error) {
      if (error instanceof PurchaseOrderBalanceError) {
        if (error.code === 'OVERRUN_JUSTIFICATION_REQUIRED') {
          throw purchaseOrdersOverrunJustificationRequired();
        }
        throw purchaseOrdersOverrunAmountRequired();
      }
      throw error;
    }

    const updated = await this.purchaseOrdersRepository.authorizeOverrun({
      purchaseOrderId,
      rowVersion: input.rowVersion,
      amount,
      justification: input.justification.trim(),
      actorIdentityId: actor.identityId,
    });
    if (updated === 'VERSION_CONFLICT') {
      throw purchaseOrdersVersionConflict();
    }
    if (updated === 'INVALID_STATE') {
      throw purchaseOrdersInvalidState();
    }

    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.CommercialPurchaseOrderAuthorizeOverrun,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.CommercialPurchaseOrder,
      resourceId: purchaseOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata: { authorizedOverrunAmount: amount, justification: input.justification.trim() },
    });

    const items = await this.purchaseOrdersRepository.listItems(purchaseOrderId);
    const billingRules = await this.purchaseOrdersRepository.listBillingRules(purchaseOrderId);
    const documentLinks = await this.purchaseOrdersRepository.listDocumentLinks(purchaseOrderId);
    return toPurchaseOrderDetailResponse(updated, items, billingRules, documentLinks);
  }

  async linkDocument(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    input: LinkPurchaseOrderDocumentInput,
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    const purchaseOrder = await this.requirePurchaseOrder(
      actor,
      purchaseOrderId,
      AUTHZ_ACTIONS.CommercialPurchaseOrderUpdate,
    );

    const validated = resolveLinkPurchaseOrderDocumentInput(input);

    await this.referenceValidation.assertDocumentUnitMatch(validated.documentId, purchaseOrder.unit_id);

    await this.purchaseOrdersRepository.linkDocument(
      purchaseOrderId,
      validated.documentId,
      validated.linkPurpose,
      actor.identityId,
    );

    return this.getById(actor, purchaseOrderId);
  }

  async getById(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
  ): Promise<PurchaseOrderDetailResponse> {
    assertValidPurchaseOrderId(purchaseOrderId);
    const purchaseOrder = await this.requirePurchaseOrder(
      actor,
      purchaseOrderId,
      AUTHZ_ACTIONS.CommercialPurchaseOrderRead,
    );
    const items = await this.purchaseOrdersRepository.listItems(purchaseOrderId);
    const billingRules = await this.purchaseOrdersRepository.listBillingRules(purchaseOrderId);
    const documentLinks = await this.purchaseOrdersRepository.listDocumentLinks(purchaseOrderId);
    // Cadeia relacionada: explica de onde vem o valor consumido do pedido. Uma consulta a mais
    // no detalhe; a autorizacao acima permanece identica.
    const linked = await this.purchaseOrdersRepository.findLinkedChain(purchaseOrderId);
    return toPurchaseOrderDetailResponse(
      purchaseOrder,
      items,
      billingRules,
      documentLinks,
      linked,
    );
  }

  async list(
    actor: IdentityAuthzContext,
    query: { clientId?: string; unitId?: string; limit: number; offset: number },
  ): Promise<{ items: PurchaseOrderListItemResponse[]; limit: number; offset: number }> {
    const scopeFilter = await this.authz.buildListScopeFilter(actor);

    const clauses = [scopeFilter.clause];
    const params = [...scopeFilter.params];
    if (query.clientId) {
      params.push(query.clientId);
      clauses.push(`client_id = $${params.length}::uuid`);
    }
    if (query.unitId) {
      params.push(query.unitId);
      clauses.push(`unit_id = $${params.length}`);
    }

    const rows = await this.purchaseOrdersRepository.listPurchaseOrders(
      clauses.join(' AND '),
      params,
      query.limit,
      query.offset,
    );

    // Aditivo: a listagem passa a expor consumo e saldo. Nenhuma consulta nova — os campos ja
    // vinham em PO_SELECT — e a autorizacao permanece exatamente como estava.
    return {
      items: rows.map(toPurchaseOrderListItemResponse),
      limit: query.limit,
      offset: query.offset,
    };
  }

  private async requirePurchaseOrder(
    actor: IdentityAuthzContext,
    purchaseOrderId: string,
    action: AuthzAction,
  ): Promise<PurchaseOrderRow> {
    const purchaseOrder = await this.purchaseOrdersRepository.findById(purchaseOrderId);
    if (!purchaseOrder) {
      throw purchaseOrdersAccessNotFound();
    }
    await this.authz.assertRecordAction(actor, action, purchaseOrder);
    return purchaseOrder;
  }
}
