import { Injectable } from '@nestjs/common';
import {
  SECURITY_AUDIT_ACTIONS,
  SECURITY_AUDIT_CLASSIFICATIONS,
  SECURITY_AUDIT_OUTCOMES,
  SECURITY_AUDIT_RESOURCE_TYPES,
} from '../../audit/types/security-audit.types';
import { SecurityAuditService } from '../../audit/services/security-audit.service';
import type { AuthzAction } from '../../authorization/types/authz-actions';
import { AUTHZ_ACTIONS } from '../../authorization/types/authz-actions';
import type { IdentityAuthzContext } from '../../authorization/types/authz-decision';
import { normalizeMoneyAmount } from '../../commercial/domain/money';
import { SERVICE_ORDER_STATUSES } from '../../service-orders/domain/service-order';
import type { ServiceOrderServiceSnapshot } from '../../service-orders/domain/service-order-snapshot';
import { ServiceOrdersRepository } from '../../service-orders/repositories/service-orders.repository';
import type { ServiceOrderRow } from '../../service-orders/repositories/service-orders.repository.types';
import {
  MEASUREMENT_COMMANDS,
  MEASUREMENT_STATUSES,
  MeasurementError,
  assertMeasurementEditable,
  type CommercialPricingLineSnapshot,
  type MeasurementCommercialReferenceSnapshot,
} from '../domain/measurement';
import {
  canRegenerateFromBasis,
  isLegacyMeasurementOrigin,
} from '../domain/measurement-basis-consumption';
import { computeLineAmount } from '../domain/measurement-quantity';
import { assertTransition, MeasurementStateError } from '../domain/measurement.state-machine';
import {
  assertApprovePreconditions,
  assertSubmitPreconditions,
  validateAuthorizeMeasurementAdjustmentInput,
  validateAdjustmentQuantity,
  validateItemMeasuredQuantity,
  validateRejectMeasurementInput,
  validateRowVersionCommandInput,
  validateUpdateMeasurementItemInput,
  type AuthorizeMeasurementAdjustmentInput,
  type RejectMeasurementInput,
  type RowVersionCommandInput,
  type UpdateMeasurementItemInput,
} from '../domain/measurement.validation';
import { MeasurementCapabilityRepository } from '../repositories/measurement-capability.repository';
import { MeasurementsRepository } from '../repositories/measurements.repository';
import type { MeasurementRow } from '../repositories/measurements.repository.types';
import {
  toMeasurementDetailResponse,
  type MeasurementDetailResponse,
} from '../serializers/measurements-response.serializer';
import { MeasurementsAccessAuthz } from './measurements-access.authz';
import {
  mapMeasurementDomainError,
  measurementsAccessNotFound,
  measurementsAlreadyExists,
  measurementsInvalidState,
  measurementsItemNotFound,
  measurementsNotEditable,
  measurementsServiceOrderNotFound,
  measurementsValidationFailed,
  measurementsVersionConflict,
} from './measurements-access.errors';
import { MeasurementsCommercialResolutionService } from './measurements-commercial-resolution.service';
import { assertValidMeasurementId } from './measurements-input-resolution';

@Injectable()
export class MeasurementsAccessService {
  constructor(
    private readonly measurementsRepository: MeasurementsRepository,
    private readonly capabilityRepository: MeasurementCapabilityRepository,
    private readonly serviceOrdersRepository: ServiceOrdersRepository,
    private readonly authz: MeasurementsAccessAuthz,
    private readonly commercialResolution: MeasurementsCommercialResolutionService,
    private readonly securityAudit: SecurityAuditService,
  ) {}

  async getByServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
  ): Promise<MeasurementDetailResponse | null> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.MeasurementsMeasurementRead);
    const measurement = await this.measurementsRepository.findByServiceOrderId(order.id);
    if (!measurement) {
      return null;
    }
    return this.loadDetail(measurement);
  }

  async getById(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
  ): Promise<MeasurementDetailResponse> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, AUTHZ_ACTIONS.MeasurementsMeasurementRead);
    const measurement = await this.requireMeasurementForOrder(measurementId, order.id);
    return this.loadDetail(measurement);
  }

  async create(actor: IdentityAuthzContext, serviceOrderId: string): Promise<MeasurementDetailResponse> {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.MeasurementsMeasurementCreate,
    );

    if (order.status !== SERVICE_ORDER_STATUSES.Completed) {
      throw mapMeasurementDomainError(new MeasurementError('SERVICE_ORDER_NOT_COMPLETED'));
    }

    // ── ORIGEM AUTORITATIVA: A BASE PUBLICADA ────────────────────────────────
    //
    // A medição nova nasce da BASE que o fechamento da execução publicou, via
    // contrato `rpt.read_measurement_basis`. Ela NÃO lê `so.execution_entries`:
    // eram duas verdades para a mesma execução fechada, e a base publicada
    // existia justamente para ser a única. A recusa de base ausente, substituída,
    // de outra ordem ou vazia é do domínio, com código próprio por motivo.
    const commercialSnapshot = await this.commercialResolution.buildCommercialSnapshot(order);
    const items = await this.commercialResolution.buildItemsFromBasis(order, commercialSnapshot);

    const result = await this.measurementsRepository.createMeasurement({
      serviceOrderId: order.id,
      unitId: order.unit_id,
      actorIdentityId: actor.identityId,
      commercialReferenceSnapshot: commercialSnapshot,
      items,
    });

    if (result.outcome === 'already_exists') {
      throw measurementsAlreadyExists();
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementCreate, order.id, {
      measurementId: result.measurement.id,
    });

    return this.loadDetail(result.measurement);
  }

  async regenerate(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
  ): Promise<MeasurementDetailResponse> {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
    );
    const measurement = await this.requireMeasurementForOrder(measurementId, order.id);
    try {
      assertMeasurementEditable(measurement.status);
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }

    let validated: RowVersionCommandInput;
    try {
      validated = validateRowVersionCommandInput(input);
    } catch {
      throw measurementsValidationFailed();
    }

    const commercialSnapshot = measurement.commercial_reference_snapshot as MeasurementCommercialReferenceSnapshot;

    /**
     * QUAL CAMINHO REGENERAR — DECIDIDO PELO DOMÍNIO, NÃO AQUI.
     *
     * Medição criada pela BASE regenera da base. Medição HISTÓRICA (criada antes
     * desta capability, com itens apontando para `execution_entries`) regenera
     * pelo caminho que ela já usava: trocar a origem de um registro no meio da
     * vida dele reescreveria passado.
     *
     * A decisão vem de `canRegenerateFromBasis`, e a razão da recusa é declarada.
     */
    const existingItems = await this.measurementsRepository.listItems(measurement.id);
    const legacyOrigin = existingItems.some((row) =>
      isLegacyMeasurementOrigin({
        sourceMeasurementBasisId:
          (row as unknown as { source_measurement_basis_id?: string | null })
            .source_measurement_basis_id ?? null,
        sourceExecutionEntryId: row.source_execution_entry_id ?? null,
      }),
    );
    const basisRetrieval = await this.capabilityRepository.findLatestBasis(order.id);

    /**
     * MEDIÇÃO HISTÓRICA REGENERA PELO CAMINHO QUE ELA JÁ USAVA.
     *
     * A regra `canRegenerateFromBasis` produz a decisão; o que muda é o CONJUNTO
     * de itens aplicado. Uma medição histórica NÃO pode passar pelo caminho da
     * base (a origem não existe no registro dela), e uma medição nova NÃO pode
     * passar pelo caminho histórico (seria reintroduzir a segunda verdade).
     */
    let items;
    if (legacyOrigin) {
      items = await this.commercialResolution.buildItemsFromExecutionHistory(
        order,
        commercialSnapshot,
      );
    } else {
      const regenerateDecision = canRegenerateFromBasis({
        hasBasis: basisRetrieval !== null && basisRetrieval.status === 'READY',
        measurementCreatedByLegacyPath: false,
      });
      if (!regenerateDecision.allowed) {
        throw mapMeasurementDomainError(
          new MeasurementError(regenerateDecision.reason ?? 'MEASUREMENT_BASIS_NOT_PUBLISHED'),
        );
      }
      items = await this.commercialResolution.buildItemsFromBasis(order, commercialSnapshot);
    }

    const result = await this.measurementsRepository.regenerateItems({
      measurementId: measurement.id,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      items,
    });

    if (result.outcome === 'version_conflict') {
      throw measurementsVersionConflict();
    }
    if (result.outcome === 'not_editable') {
      throw measurementsNotEditable();
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementUpdate, order.id, {
      measurementId,
      action: 'regenerate',
    });

    const refreshed = await this.measurementsRepository.findById(measurementId);
    return this.loadDetail(refreshed!);
  }

  async updateItem(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    itemId: string,
    input: UpdateMeasurementItemInput,
  ) {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
    );
    const measurement = await this.requireMeasurementForOrder(measurementId, order.id);
    try {
      assertMeasurementEditable(measurement.status);
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }
    const items = await this.measurementsRepository.listItems(measurement.id);
    const item = items.find((row) => row.id === itemId);
    if (!item) {
      throw measurementsItemNotFound();
    }

    let validated: UpdateMeasurementItemInput;
    try {
      validated = validateUpdateMeasurementItemInput(input);
    } catch {
      throw measurementsValidationFailed();
    }

    const authorizedAdjustmentTotal = await this.measurementsRepository.sumAdjustmentsForItem(itemId);
    const unit = await this.measurementsRepository.loadUnitOfMeasure(item.unit_code);
    if (!unit) {
      throw mapMeasurementDomainError(new MeasurementError('UNIT_NOT_ALLOWED'));
    }

    const serviceSnapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;
    let measuredQuantity: string;
    try {
      measuredQuantity = validateItemMeasuredQuantity({
        measuredQuantity: validated.measuredQuantity,
        actualQuantity: item.actual_quantity,
        authorizedAdjustmentTotal,
        unitCode: item.unit_code,
        unitDecimalScale: unit.decimal_scale,
        serviceSnapshot,
      });
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }

    const pricingSnapshot = item.pricing_line_snapshot as CommercialPricingLineSnapshot;
    const lineAmount = computeLineAmount({
      modelCode: pricingSnapshot.modelCode,
      measuredQuantity,
      unitPrice: item.unit_price,
      salePrice: pricingSnapshot.salePrice,
    });

    const result = await this.measurementsRepository.updateItemMeasuredQuantity({
      measurementId: measurement.id,
      itemId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      measuredQuantity,
      lineAmount: lineAmount ? normalizeMoneyAmount(lineAmount) : null,
    });

    if (result.outcome === 'version_conflict') {
      throw measurementsVersionConflict();
    }
    if (result.outcome === 'not_editable') {
      throw measurementsNotEditable();
    }
    if (result.outcome === 'item_not_found') {
      throw measurementsItemNotFound();
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementUpdate, order.id, {
      measurementId,
      itemId,
    });

    const refreshed = await this.measurementsRepository.findById(measurementId);
    return this.loadDetail(refreshed!);
  }

  async authorizeAdjustment(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: AuthorizeMeasurementAdjustmentInput,
  ) {
    const order = await this.requireServiceOrder(
      actor,
      serviceOrderId,
      AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
    );
    const measurement = await this.requireMeasurementForOrder(measurementId, order.id);
    try {
      assertMeasurementEditable(measurement.status);
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }

    let validated: AuthorizeMeasurementAdjustmentInput;
    try {
      validated = validateAuthorizeMeasurementAdjustmentInput(input);
    } catch {
      throw measurementsValidationFailed();
    }

    const items = await this.measurementsRepository.listItems(measurement.id);
    const item = items.find((row) => row.id === validated.measurementItemId);
    if (!item) {
      throw measurementsItemNotFound();
    }

    const unit = await this.measurementsRepository.loadUnitOfMeasure(item.unit_code);
    if (!unit) {
      throw mapMeasurementDomainError(new MeasurementError('UNIT_NOT_ALLOWED'));
    }

    let adjustmentQuantity: string;
    try {
      adjustmentQuantity = validateAdjustmentQuantity({
        adjustmentQuantity: validated.adjustmentQuantity,
        unitCode: item.unit_code,
        itemUnitCode: item.unit_code,
        unitDecimalScale: unit.decimal_scale,
      });
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }

    const result = await this.measurementsRepository.authorizeAdjustment({
      measurementId: measurement.id,
      itemId: item.id,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      adjustmentQuantity,
      unitCode: item.unit_code,
      reason: validated.reason,
    });

    if (result.outcome === 'version_conflict') {
      throw measurementsVersionConflict();
    }
    if (result.outcome === 'not_editable') {
      throw measurementsNotEditable();
    }
    if (result.outcome === 'item_not_found') {
      throw measurementsItemNotFound();
    }

    await this.audit(actor, SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementUpdate, order.id, {
      measurementId,
      adjustmentId: result.adjustment.id,
    });

    const refreshed = await this.measurementsRepository.findById(measurementId);
    return this.loadDetail(refreshed!);
  }

  async submit(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
  ) {
    return this.runTransition(
      actor,
      serviceOrderId,
      measurementId,
      input,
      'submit',
      AUTHZ_ACTIONS.MeasurementsMeasurementSubmit,
      SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementSubmit,
      async (order, measurement) => {
        const items = await this.measurementsRepository.listItems(measurement.id);
        assertSubmitPreconditions({
          serviceOrderStatus: order.status,
          commercialSnapshot: measurement.commercial_reference_snapshot,
          itemCount: items.length,
        });
      },
    );
  }

  async startReview(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
  ) {
    return this.runTransition(
      actor,
      serviceOrderId,
      measurementId,
      input,
      'startReview',
      AUTHZ_ACTIONS.MeasurementsMeasurementReview,
      SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementReview,
    );
  }

  async approve(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
  ) {
    return this.runTransition(
      actor,
      serviceOrderId,
      measurementId,
      input,
      'approve',
      AUTHZ_ACTIONS.MeasurementsMeasurementApprove,
      SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementApprove,
      async (_order, measurement) => {
        const items = await this.measurementsRepository.listItems(measurement.id);
        assertApprovePreconditions({
          commercialSnapshot: measurement.commercial_reference_snapshot,
          itemCount: items.length,
          submittedByIdentityId: measurement.submitted_by_identity_id,
          decidedByIdentityId: actor.identityId,
        });
      },
    );
  }

  async reject(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RejectMeasurementInput,
  ) {
    let validated: RejectMeasurementInput;
    try {
      validated = validateRejectMeasurementInput(input);
    } catch {
      throw measurementsValidationFailed();
    }

    return this.runTransition(
      actor,
      serviceOrderId,
      measurementId,
      validated,
      'reject',
      AUTHZ_ACTIONS.MeasurementsMeasurementReject,
      SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementReject,
      undefined,
      validated.rejectionReason,
    );
  }

  async resubmit(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
  ) {
    return this.runTransition(
      actor,
      serviceOrderId,
      measurementId,
      input,
      'resubmit',
      AUTHZ_ACTIONS.MeasurementsMeasurementUpdate,
      SECURITY_AUDIT_ACTIONS.MeasurementsMeasurementUpdate,
    );
  }

  private async runTransition(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    measurementId: string,
    input: RowVersionCommandInput,
    transition: 'submit' | 'startReview' | 'approve' | 'reject' | 'resubmit',
    action: AuthzAction,
    auditAction: (typeof SECURITY_AUDIT_ACTIONS)[keyof typeof SECURITY_AUDIT_ACTIONS],
    precondition?: (order: ServiceOrderRow, measurement: MeasurementRow) => Promise<void> | void,
    rejectionReason?: string,
  ): Promise<MeasurementDetailResponse> {
    const order = await this.requireServiceOrder(actor, serviceOrderId, action);
    const measurement = await this.requireMeasurementForOrder(measurementId, order.id);

    let validated: RowVersionCommandInput;
    try {
      validated = validateRowVersionCommandInput(input);
    } catch {
      throw measurementsValidationFailed();
    }

    const commandName =
      transition === 'submit'
        ? MEASUREMENT_COMMANDS.Submit
        : transition === 'startReview'
          ? MEASUREMENT_COMMANDS.StartReview
          : transition === 'approve'
            ? MEASUREMENT_COMMANDS.Approve
            : transition === 'resubmit'
              ? MEASUREMENT_COMMANDS.Resubmit
              : MEASUREMENT_COMMANDS.Reject;

    if (validated.idempotencyKey) {
      const existing = await this.measurementsRepository.findIdempotency(
        measurementId,
        commandName,
        validated.idempotencyKey,
      );
      if (existing) {
        const refreshed = await this.measurementsRepository.findById(measurementId);
        return this.loadDetail(refreshed!);
      }
    }

    let nextStatus: string;
    try {
      nextStatus = assertTransition(
        measurement.status as (typeof MEASUREMENT_STATUSES)[keyof typeof MEASUREMENT_STATUSES],
        transition,
      );
    } catch (error) {
      if (error instanceof MeasurementStateError) {
        throw measurementsInvalidState();
      }
      throw error;
    }

    if (precondition) {
      try {
        await precondition(order, measurement);
      } catch (error) {
        if (error instanceof MeasurementError) {
          throw mapMeasurementDomainError(error);
        }
        throw error;
      }
    }

    const result = await this.measurementsRepository.transitionMeasurement({
      measurementId,
      rowVersion: validated.rowVersion,
      actorIdentityId: actor.identityId,
      currentStatus: measurement.status,
      nextStatus,
      transition,
      commandName,
      idempotencyKey: validated.idempotencyKey,
      rejectionReason,
    });

    if (result.outcome === 'version_conflict') {
      throw measurementsVersionConflict();
    }
    if (result.outcome === 'invalid_state') {
      throw measurementsInvalidState();
    }

    await this.audit(actor, auditAction, order.id, { measurementId, rowVersion: result.rowVersion });

    const refreshed = await this.measurementsRepository.findById(measurementId);
    return this.loadDetail(refreshed!);
  }

  private async loadDetail(measurement: MeasurementRow): Promise<MeasurementDetailResponse> {
    const [items, adjustments, historyEvents] = await Promise.all([
      this.measurementsRepository.listItems(measurement.id),
      this.measurementsRepository.listAdjustments(measurement.id),
      this.measurementsRepository.listHistoryEvents(measurement.id),
    ]);
    return toMeasurementDetailResponse(measurement, items, adjustments, historyEvents);
  }

  private async requireMeasurementForOrder(
    measurementId: string,
    serviceOrderId: string,
  ): Promise<MeasurementRow> {
    assertValidMeasurementId(measurementId);
    const measurement = await this.measurementsRepository.findById(measurementId);
    if (!measurement || measurement.service_order_id !== serviceOrderId) {
      throw measurementsAccessNotFound();
    }
    return measurement;
  }

  private async requireServiceOrder(
    actor: IdentityAuthzContext,
    serviceOrderId: string,
    action: AuthzAction,
  ): Promise<ServiceOrderRow> {
    const row = await this.serviceOrdersRepository.findById(serviceOrderId);
    if (!row) {
      throw measurementsServiceOrderNotFound();
    }
    await this.authz.assertServiceOrderAction(actor, action, row);
    return row;
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
}
