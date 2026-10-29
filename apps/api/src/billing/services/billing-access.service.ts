import { HttpStatus, Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import { AuthorizationRepository } from '../../authorization/repositories/authorization.repository';
import { PolicyDecisionPointService } from '../../authorization/services/policy-decision-point.service';
import { ScopeEnforcementService } from '../../authorization/services/scope-enforcement.service';
import { toResourceContextFromServiceOrder } from '../../authorization/scope/scope-matcher';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import { AUTHZ_RESOURCE_TYPES } from '../../authorization/types/authz-resources';
import { AUTHZ_SCOPES } from '../../authorization/types/authz-scopes';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { assertUuid } from '../../catalog/domain/service-catalog.validation';
import { assertCurrencyCode } from '../../commercial/domain/money';
import { PurchaseOrderConsumptionPersistenceError } from '../../commercial/application/purchase-order-billing-consumption';
import { ADDRESS_PURPOSES } from '../../clients/domain/client-status';
import { ServiceOrdersRepository } from '../../service-orders/repositories/service-orders.repository';
import type { ServiceOrderRow } from '../../service-orders/repositories/service-orders.repository.types';
import {
  assertBillingItemsPresent,
  assertMeasurementApprovedForBilling,
  BillingError,
  PAYMENT_TERMS_SOURCES,
  type BillingAddressSnapshot,
} from '../domain/billing';
import {
  assertBillingRight,
  assertPurchaseOrderRequirement,
  BillingEntitlementError,
  requiresApprovedMeasurement,
  resolveBillingEntitlementPolicy,
  resolveContractualBillingLine,
} from '../domain/billing-entitlement';
import { buildBillingCostSummaryFromMeasurementItems } from '../domain/billing-cost-summary';
import {
  MeasurementBillingCurrencyError,
  resolveMeasurementBillingCurrency,
} from '../domain/measurement-billing-currency';
import {
  assertBillingItemsTraceable,
  buildBillingOriginSnapshot,
} from '../domain/billing-invariants';
import { moneyAmountsEqual, sumMoneyAmounts } from '../domain/billing-totals';
import {
  validatePrepareBillingRecordInput,
  validateVoidBillingRecordInput,
  type PrepareBillingRecordInput,
  type VoidBillingRecordInput,
} from '../domain/billing.validation';
import { detectCommercialTermsMismatch } from '../domain/payment-terms';
import { BILLING_ERROR_CODES } from '../errors/billing-error-codes';
import { BillingHttpException } from '../errors/billing-http.exception';
import { BillingRepository } from '../repositories/billing.repository';
import type { BillingRecordRow } from '../repositories/billing.repository.types';
import type { BillingWorklistSummary } from '../repositories/billing.repository';
import {
  toBillingRecordDetailResponse,
  type BillingRecordDetailResponse,
} from '../serializers/billing-response.serializer';

@Injectable()
export class BillingAccessService {
  constructor(
    private readonly billingRepository: BillingRepository,
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly authorizationRepository: AuthorizationRepository,
    private readonly policyDecisionPoint: PolicyDecisionPointService,
    private readonly securityAudit: SecurityAuditService,
    private readonly scopeEnforcement: ScopeEnforcementService,
  ) {}

  async listWorklist(
    actor: IdentityAuthzContext,
    input: { bucket?: string; search?: string; limit: number; offset: number },
  ): Promise<{
    items: Array<Record<string, unknown>>;
    total: number;
    page: { count: number; limit: number; offset: number; totalPages: number; hasMore: boolean };
    summary: { total: number; counts: Record<string, number>; amountsByCurrency: BillingWorklistSummary['amountsByCurrency'] };
  }> {
    const action = AUTHZ_ACTIONS.BillingBillingRecordRead;
    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const decision = await this.policyDecisionPoint.decide(
      actor,
      { action, resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder },
      { audit: true },
    );
    if (decision.result === 'DENY' && grants.length === 0) {
      throw new BillingHttpException(HttpStatus.FORBIDDEN, BILLING_ERROR_CODES.DENIED, 'Access denied.');
    }
    const scope = this.scopeEnforcement.buildServiceOrderListFilter(grants, actor.identityId);
    const [documentReadGrants, receivableReadGrants] = await Promise.all([
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.BillingBillingDocumentRead,
        AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      ),
      this.authorizationRepository.findActiveGrants(
        actor.identityId,
        AUTHZ_ACTIONS.FinanceReceivableRead,
        AUTHZ_RESOURCE_TYPES.FinanceReceivable,
      ),
    ]);
    const documentScope = this.scopeEnforcement.buildServiceOrderListFilter(documentReadGrants, actor.identityId);
    const result = await this.billingRepository.listWorklist({
      scopeClause: scope.clause,
      scopeParams: scope.params,
      documentScopeClause: documentScope.clause,
      documentScopeParams: documentScope.params,
      bucket: input.bucket,
      search: input.search,
      limit: input.limit,
      offset: input.offset,
    });
    return {
      items: result.items.map((row) => {
        const canReadDocument = row.can_read_document;
        const receivableId = row.receivable_id && this.scopeEnforcement.canAccessRecord(
          receivableReadGrants,
          actor.identityId,
          {
            resourceId: row.receivable_id,
            unitId: row.receivable_unit_id ?? undefined,
            clientId: row.receivable_client_id ?? undefined,
            isFinancial: true,
          },
        ) ? row.receivable_id : null;
        const nextAction = row.bucket === 'ready' ? 'prepare_billing'
          : row.bucket === 'prepared' ? 'issue_internal_document'
            : row.bucket === 'issued' ? receivableId ? 'review_receivable' : 'review_issued_document'
              : row.bucket === 'measurement_pending' ? 'complete_measurement'
                : row.bucket === 'billing_basis_missing' ? 'resolve_billing_basis'
                : row.bucket === 'terms_divergence' ? 'resolve_terms_divergence'
                  : row.bucket === 'document_state_unknown' ? 'review_billing_record'
                  : 'review_cancelled_document';
        return {
          serviceOrderId: row.service_order_id,
          orderNumber: row.order_number,
          clientLabel: row.client_label,
          origin: row.origin,
          serviceOrderStatus: row.service_order_status,
          serviceOrderVersion: row.service_order_version,
          completedAt: row.service_order_completed_at,
          measurementId: row.measurement_id,
          measurementStatus: row.measurement_status,
          measurementVersion: row.measurement_version,
          billingRecordId: row.billing_record_id,
          billingStatus: row.billing_status,
          billingVersion: row.billing_version,
          amount: row.amount,
          currencyCode: row.currency_code,
          bucket: row.bucket,
          exceptionCode: row.exception_code,
          exceptionDetail: row.exception_detail,
          authoritativeTerms: row.authoritative_terms,
          declaredTerms: row.declared_terms,
          billingDocumentId: canReadDocument ? row.billing_document_id : null,
          billingDocumentNumber: canReadDocument ? row.billing_document_number : null,
          billingDocumentStatus: canReadDocument ? row.billing_document_status : null,
          billingDocumentIssuedAt: canReadDocument ? row.billing_document_issued_at : null,
          receivableId,
          updatedAt: row.updated_at,
          nextAction,
        };
      }),
      total: result.summary.total,
      page: {
        count: result.items.length,
        limit: input.limit,
        offset: input.offset,
        totalPages: Math.ceil(result.summary.total / input.limit),
        hasMore: input.offset + result.items.length < result.summary.total,
      },
      summary: result.summary,
    };
  }

  async getByServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<BillingRecordDetailResponse | null> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.BillingBillingRecordRead);
    const billingRecord = await this.billingRepository.findByServiceOrderId(order.id);
    if (!billingRecord) {
      return null;
    }
    return this.loadDetail(billingRecord);
  }

  async getById(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    billingRecordId: string,
  ): Promise<BillingRecordDetailResponse> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.BillingBillingRecordRead);
    const billingRecord = await this.requireBillingRecordForOrder(billingRecordId, order.id);
    return this.loadDetail(billingRecord);
  }

  async prepare(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    input: PrepareBillingRecordInput,
  ): Promise<BillingRecordDetailResponse> {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.BillingBillingRecordPrepare,
    );

    let validated: PrepareBillingRecordInput;
    try {
      validated = validatePrepareBillingRecordInput(input);
    } catch {
      throw this.validationFailed();
    }

    const policy = resolveBillingEntitlementPolicy(order.service_snapshot);
    if (requiresApprovedMeasurement(policy) && !validated.measurementId) {
      throw this.mapBillingError(new BillingError('MEASUREMENT_NOT_FOUND'));
    }

    const clientRequirement = order.client_id
      ? await this.serviceOrdersRepository.findClientById(order.client_id)
      : null;
    try {
      assertPurchaseOrderRequirement({
        requirement: clientRequirement?.purchase_order_requirement,
        phase: 'BILLING',
        purchaseOrderId: order.purchase_order_id,
        catalogRequiresPurchaseOrder: order.service_snapshot?.['requiresPurchaseOrder'] === true,
      });
    } catch (error) {
      if (error instanceof BillingEntitlementError && error.code === 'PURCHASE_ORDER_REQUIRED') {
        throw new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.PURCHASE_ORDER_REQUIRED,
          'A purchase order is required before billing preparation.',
        );
      }
      throw error;
    }

    type ItemDraft = {
      measurementItemId: string | null;
      sourceExecutionEntryId: string | null;
      lineNumber: number;
      unitCode: string;
      quantity: string;
      unitPrice: string | null;
      lineAmount: string;
      pricingLineSnapshot: Record<string, unknown>;
      lineLabel: string;
    };

    let itemDrafts: ItemDraft[];
    let measurementId: string | null = validated.measurementId ?? null;
    let computedTotal: string;
    let currencyCode: string;
    let commercialReferenceSnapshot: Record<string, unknown>;

    if (requiresApprovedMeasurement(policy)) {
      const measurement = await this.billingRepository.findMeasurementForBilling(
        validated.measurementId!,
        order.id,
      );
      if (!measurement) {
        throw this.mapBillingError(new BillingError('MEASUREMENT_NOT_FOUND'));
      }

      try {
        assertMeasurementApprovedForBilling(measurement.status);
        assertBillingRight({
          policy,
          serviceOrderStatus: order.status,
          measurementStatus: measurement.status,
        });
      } catch (error) {
        throw this.mapBillingError(error);
      }

      const measurementItems = await this.billingRepository.listMeasurementItemsForBilling(measurement.id);
      try {
        assertBillingItemsPresent(measurementItems.length);
      } catch (error) {
        throw this.mapBillingError(error);
      }

      itemDrafts = measurementItems.map((item) => {
        if (!item.line_amount) {
          throw this.mapBillingError(new BillingError('BILLING_ITEMS_REQUIRED'));
        }
        return {
          measurementItemId: item.id,
          sourceExecutionEntryId: item.source_execution_entry_id,
          lineNumber: item.line_number,
          unitCode: item.unit_code,
          quantity: item.measured_quantity,
          unitPrice: item.unit_price,
          lineAmount: item.line_amount,
          pricingLineSnapshot: item.pricing_line_snapshot,
          lineLabel: `Linha ${item.line_number}`,
        };
      });

      try {
        assertBillingItemsTraceable(
          itemDrafts.map((item) => ({
            measurementItemId: item.measurementItemId,
            sourceExecutionEntryId: item.sourceExecutionEntryId,
            lineNumber: item.lineNumber,
            unitCode: item.unitCode,
            quantity: item.quantity,
            lineAmount: item.lineAmount,
          })),
        );
      } catch {
        throw this.mapBillingError(new BillingError('BILLING_ITEMS_REQUIRED'));
      }

      computedTotal = sumMoneyAmounts(itemDrafts.map((item) => item.lineAmount));
      try {
        currencyCode = resolveMeasurementBillingCurrency({
          pricingLines: itemDrafts,
          commercialReferenceSnapshot: measurement.commercial_reference_snapshot,
        });
      } catch (error) {
        if (error instanceof MeasurementBillingCurrencyError) {
          const code = error.code === 'BILLING_CURRENCY_MISMATCH'
            ? BILLING_ERROR_CODES.BILLING_CURRENCY_MISMATCH
            : BILLING_ERROR_CODES.BILLING_CURRENCY_UNVERIFIED;
          throw new BillingHttpException(
            HttpStatus.CONFLICT, code,
            'Approved measurement pricing currencies are missing or inconsistent.',
          );
        }
        throw error;
      }
      commercialReferenceSnapshot = {
        ...measurement.commercial_reference_snapshot,
        costSummary: buildBillingCostSummaryFromMeasurementItems(measurementItems),
        billingOrigin: buildBillingOriginSnapshot({
          serviceOrderId: order.id,
          measurementId: measurement.id,
          clientId: order.client_id!,
          proposalId: order.proposal_id,
          purchaseOrderId: order.purchase_order_id,
          contractReference: order.contract_reference,
          itemCount: itemDrafts.length,
          totalAmount: computedTotal,
          currencyCode,
          entitlementPolicy: policy,
        }),
      };
      measurementId = measurement.id;
    } else {
      try {
        assertBillingRight({
          policy,
          serviceOrderStatus: order.status,
        });
        const contractual = resolveContractualBillingLine({
          policy,
          serviceSnapshot: order.service_snapshot,
          proposalSnapshot: order.proposal_snapshot,
          purchaseOrderSnapshot: order.purchase_order_snapshot,
        });
        itemDrafts = [
          {
            measurementItemId: null,
            sourceExecutionEntryId: null,
            lineNumber: 1,
            unitCode: contractual.unitCode,
            quantity: contractual.quantity,
            unitPrice: contractual.unitPrice,
            lineAmount: contractual.lineAmount,
            pricingLineSnapshot: { source: 'CONTRACTUAL_ENTITLEMENT', policy },
            lineLabel: contractual.lineLabel,
          },
        ];
        assertBillingItemsTraceable(
          itemDrafts.map((item) => ({
            measurementItemId: item.measurementItemId,
            sourceExecutionEntryId: item.sourceExecutionEntryId,
            lineNumber: item.lineNumber,
            unitCode: item.unitCode,
            quantity: item.quantity,
            lineAmount: item.lineAmount,
          })),
          { requireMeasurementOrigin: false },
        );
        computedTotal = contractual.lineAmount;
        currencyCode = assertCurrencyCode(contractual.currencyCode);
        commercialReferenceSnapshot = {
          source: 'CONTRACTUAL_ENTITLEMENT',
          billingOrigin: buildBillingOriginSnapshot({
            serviceOrderId: order.id,
            measurementId: null,
            clientId: order.client_id!,
            proposalId: order.proposal_id,
            purchaseOrderId: order.purchase_order_id,
            contractReference: order.contract_reference,
            itemCount: 1,
            totalAmount: computedTotal,
            currencyCode,
            entitlementPolicy: policy,
          }),
        };
        measurementId = null;
      } catch (error) {
        throw this.mapBillingError(error);
      }
    }

    if (
      validated.assertedTotalAmount &&
      !moneyAmountsEqual(validated.assertedTotalAmount, computedTotal)
    ) {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.BILLING_AMOUNT_MISMATCH,
        'Asserted total amount does not match measurement line totals.',
      );
    }

    const termsResolution = await this.resolvePaymentTerms(order, validated.paymentTerms);
    if (termsResolution.mismatch) {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.COMMERCIAL_TERMS_MISMATCH,
        'Declared payment terms conflict with authoritative commercial source.',
      );
    }

    if (!order.client_id) {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.CLIENT_NOT_FOUND,
        'Service order has no client for billing preparation.',
      );
    }

    const client = await this.billingRepository.findClientBillingSnapshot(order.client_id);
    if (!client) {
      throw this.mapBillingError(new BillingError('CLIENT_NOT_FOUND'));
    }

    const addresses = await this.billingRepository.listClientAddresses(order.client_id);
    const billingAddressSnapshot = this.buildBillingAddressSnapshot(addresses, order);

    let result;
    try {
      result = await this.billingRepository.prepareBillingRecord({
        serviceOrderId: order.id,
        measurementId,
        entitlementPolicy: policy,
        clientId: order.client_id,
        unitId: order.unit_id,
        proposalId: order.proposal_id,
        purchaseOrderId: order.purchase_order_id,
        contractReference: order.contract_reference,
        clientLegalNameSnapshot: client.legal_name,
        clientTaxIdSnapshot: client.tax_id,
        billingAddressSnapshot,
        commercialReferenceSnapshot,
        currencyCode,
        paymentTerms: termsResolution.appliedTerms,
        paymentTermsSource: termsResolution.source,
        paymentTermsAuthoritative: termsResolution.authoritativeTerms,
        totalAmount: computedTotal,
        actorIdentityId: actor.identityId,
        items: itemDrafts,
        idempotencyKey: validated.idempotencyKey,
      });
    } catch (error) {
      throw this.mapPurchaseOrderConsumptionError(error);
    }

    if (result.outcome === 'already_exists') {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.BILLING_ALREADY_EXISTS,
        'A prepared billing record already exists for this measurement.',
      );
    }

    if (result.outcome === 'idempotent') {
      return this.loadDetail(result.billingRecord);
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.BillingBillingRecordPrepare, order.id, {
      billingRecordId: result.billingRecord.id,
      measurementId,
      totalAmount: computedTotal,
      entitlementPolicy: policy,
    });

    return this.loadDetail(result.billingRecord);
  }

  async voidRecord(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    billingRecordId: string,
    input: VoidBillingRecordInput,
  ): Promise<BillingRecordDetailResponse> {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.BillingBillingRecordVoid,
    );
    await this.requireBillingRecordForOrder(billingRecordId, order.id);

    let validated: VoidBillingRecordInput;
    try {
      validated = validateVoidBillingRecordInput(input);
    } catch {
      throw this.validationFailed();
    }

    let result;
    try {
      result = await this.billingRepository.voidBillingRecord({
        billingRecordId,
        rowVersion: validated.rowVersion,
        voidReason: validated.voidReason,
        actorIdentityId: actor.identityId,
        idempotencyKey: validated.idempotencyKey,
      });
    } catch (error) {
      throw this.mapPurchaseOrderConsumptionError(error);
    }

    if (result.outcome === 'invalid_state') {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.INVALID_STATE,
        'Billing record cannot be voided in its current state.',
      );
    }
    if (result.outcome === 'version_conflict') {
      throw new BillingHttpException(
        HttpStatus.CONFLICT,
        BILLING_ERROR_CODES.VERSION_CONFLICT,
        'Billing record version conflict.',
      );
    }

    if (result.outcome === 'voided') {
      await this.audit(actor, SECURITY_AUDIT_ACTIONS.BillingBillingRecordVoid, order.id, {
        billingRecordId,
        voidReason: validated.voidReason,
      });
    }

    return this.loadDetail(result.billingRecord);
  }

  private async resolvePaymentTerms(
    order: ServiceOrderRow,
    declaredTerms: string,
  ): Promise<{
    appliedTerms: string;
    source: string;
    authoritativeTerms: string | null;
    mismatch: boolean;
  }> {
    const { authoritativeTerms, source } = await this.resolveAuthoritativePaymentTerms(order);
    return {
      appliedTerms: declaredTerms,
      source,
      authoritativeTerms,
      mismatch: detectCommercialTermsMismatch(authoritativeTerms, declaredTerms),
    };
  }

  private async resolveAuthoritativePaymentTerms(
    order: ServiceOrderRow,
  ): Promise<{ authoritativeTerms: string | null; source: string }> {
    if (order.purchase_order_id) {
      const purchaseOrder = await this.billingRepository.findPurchaseOrderTerms(order.purchase_order_id);
      if (purchaseOrder?.payment_terms) {
        return {
          authoritativeTerms: purchaseOrder.payment_terms,
          source: PAYMENT_TERMS_SOURCES.PurchaseOrder,
        };
      }
    }

    const poSnapshot = order.purchase_order_snapshot as { paymentTerms?: string | null } | null;
    if (poSnapshot?.paymentTerms) {
      return {
        authoritativeTerms: poSnapshot.paymentTerms,
        source: PAYMENT_TERMS_SOURCES.PurchaseOrder,
      };
    }

    const proposalSnapshot = order.proposal_snapshot as { paymentTerms?: string | null } | null;
    if (proposalSnapshot?.paymentTerms) {
      return {
        authoritativeTerms: proposalSnapshot.paymentTerms,
        source: PAYMENT_TERMS_SOURCES.ProposalSnapshot,
      };
    }

    const contractSnapshot = order.contract_snapshot as { paymentTerms?: string | null } | null;
    if (contractSnapshot?.paymentTerms) {
      return {
        authoritativeTerms: contractSnapshot.paymentTerms,
        source: PAYMENT_TERMS_SOURCES.ContractSnapshot,
      };
    }

    return { authoritativeTerms: null, source: PAYMENT_TERMS_SOURCES.Declared };
  }

  private buildBillingAddressSnapshot(
    addresses: Array<{
      purpose: string;
      street: string | null;
      number: string | null;
      complement: string | null;
      district: string | null;
      city: string | null;
      state: string | null;
      postal_code: string | null;
      country: string | null;
    }>,
    order: ServiceOrderRow,
  ): BillingAddressSnapshot {
    const billingAddress =
      addresses.find((address) => address.purpose === ADDRESS_PURPOSES.Billing) ?? addresses[0];
    if (billingAddress) {
      return {
        purpose: billingAddress.purpose,
        street: billingAddress.street,
        number: billingAddress.number,
        complement: billingAddress.complement,
        district: billingAddress.district,
        city: billingAddress.city,
        state: billingAddress.state,
        postalCode: billingAddress.postal_code,
        countryCode: billingAddress.country,
      };
    }
    const location = order.location ?? {};
    return {
      purpose: 'service_order_location',
      street: typeof location.street === 'string' ? location.street : null,
      city: typeof location.city === 'string' ? location.city : null,
      state: typeof location.state === 'string' ? location.state : null,
      postalCode: typeof location.postalCode === 'string' ? location.postalCode : null,
      countryCode: typeof location.countryCode === 'string' ? location.countryCode : 'BR',
    };
  }

  private async loadDetail(billingRecord: BillingRecordRow): Promise<BillingRecordDetailResponse> {
    const [items, historyEvents] = await Promise.all([
      this.billingRepository.listItems(billingRecord.id),
      this.billingRepository.listHistoryEvents(billingRecord.id),
    ]);
    return toBillingRecordDetailResponse(billingRecord, items, historyEvents);
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    const order = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!order) {
      throw this.notFound();
    }
    await this.assertRecordAction(actor, action, order);
    return order;
  }

  private async requireBillingRecordForOrder(
    billingRecordId: string,
    serviceOrderId: string,
  ): Promise<BillingRecordRow> {
    try {
      assertUuid(billingRecordId, 'billingRecordId');
    } catch {
      throw this.notFound();
    }

    const billingRecord = await this.billingRepository.findById(billingRecordId);
    if (!billingRecord || billingRecord.service_order_id !== serviceOrderId) {
      throw this.notFound();
    }
    return billingRecord;
  }

  private async assertRecordAction(
    actor: IdentityAuthzContext,
    action: AuthzAction,
    row: ServiceOrderRow,
  ): Promise<void> {
    const decision = await this.policyDecisionPoint.decide(
      actor,
      {
        action,
        resourceType: AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
        context: toResourceContextFromServiceOrder(row),
      },
      { audit: true },
    );
    if (decision.result === 'DENY') {
      throw new BillingHttpException(HttpStatus.FORBIDDEN, BILLING_ERROR_CODES.DENIED, 'Access denied.');
    }

    const grants = await this.authorizationRepository.findActiveGrants(
      actor.identityId,
      action,
      AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder,
    );
    const hasAccess = grants.some((grant) => {
      if (grant.scope_type === AUTHZ_SCOPES.Global && grant.resource_id === null) {
        return true;
      }
      if (grant.scope_type === AUTHZ_SCOPES.Unit && grant.resource_id === row.unit_id) {
        return true;
      }
      if (row.client_id && grant.scope_type === AUTHZ_SCOPES.Client && grant.resource_id === row.client_id) {
        return true;
      }
      return false;
    });
    if (!hasAccess) {
      throw new BillingHttpException(HttpStatus.FORBIDDEN, BILLING_ERROR_CODES.DENIED, 'Access denied.');
    }
  }

  private async audit(
    actor: IdentityAuthzContext,
    action: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    serviceOrderId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.ServiceOrdersServiceOrder,
      resourceId: serviceOrderId,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      metadata,
    });
  }

  private validationFailed(): BillingHttpException {
    return new BillingHttpException(
      HttpStatus.BAD_REQUEST,
      BILLING_ERROR_CODES.VALIDATION_FAILED,
      'Invalid billing request.',
    );
  }

  private notFound(): BillingHttpException {
    return new BillingHttpException(
      HttpStatus.NOT_FOUND,
      BILLING_ERROR_CODES.NOT_FOUND,
      'Billing record not found.',
    );
  }

  private mapPurchaseOrderConsumptionError(error: unknown): BillingHttpException {
    if (!(error instanceof PurchaseOrderConsumptionPersistenceError)) {
      throw error;
    }

    switch (error.code) {
      case 'PURCHASE_ORDER_BALANCE_EXCEEDED':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.PURCHASE_ORDER_BALANCE_EXCEEDED,
          'Purchase order authorized balance exceeded.',
        );
      case 'PURCHASE_ORDER_INVALID_STATE':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.PURCHASE_ORDER_INVALID_STATE,
          'Purchase order is not in a billable state.',
        );
      case 'PURCHASE_ORDER_RELEASE_WITHOUT_CONSUMPTION':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.INVALID_STATE,
          'No purchase order consumption exists for this billing record to release.',
        );
      default:
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.INVALID_STATE,
          'Purchase order consumption could not be applied.',
        );
    }
  }

  private mapBillingError(error: unknown): BillingHttpException {
    if (error instanceof BillingEntitlementError) {
      return this.mapBillingError(new BillingError(error.code));
    }
    if (!(error instanceof BillingError)) {
      return new BillingHttpException(
        HttpStatus.INTERNAL_SERVER_ERROR,
        BILLING_ERROR_CODES.VALIDATION_FAILED,
        'Unexpected billing error.',
      );
    }

    switch (error.code) {
      case 'MEASUREMENT_NOT_APPROVED':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.MEASUREMENT_NOT_APPROVED,
          'Measurement must be approved before billing preparation.',
        );
      case 'MEASUREMENT_NOT_FOUND':
        return new BillingHttpException(
          HttpStatus.NOT_FOUND,
          BILLING_ERROR_CODES.MEASUREMENT_NOT_FOUND,
          'Measurement not found for service order.',
        );
      case 'BILLING_ITEMS_REQUIRED':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.BILLING_ITEMS_REQUIRED,
          'Billing preparation requires at least one measurement item.',
        );
      case 'CLIENT_NOT_FOUND':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.CLIENT_NOT_FOUND,
          'Client not found for billing preparation.',
        );
      case 'SERVICE_NOT_BILLABLE_YET':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.SERVICE_NOT_BILLABLE_YET,
          'Service order is not yet billable under its entitlement policy.',
        );
      case 'PURCHASE_ORDER_REQUIRED':
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.PURCHASE_ORDER_REQUIRED,
          'A purchase order is required before billing preparation.',
        );
      default:
        return new BillingHttpException(
          HttpStatus.CONFLICT,
          BILLING_ERROR_CODES.INVALID_STATE,
          'Billing operation is not allowed.',
        );
    }
  }
}
