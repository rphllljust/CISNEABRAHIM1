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
import { SodEnforcementService } from '../../authorization/services/sod-enforcement.service';
import { SOD_DUTIES, resolveSodScope } from '../../authorization/domain/segregation-of-duties';
import {
  type FinanceReceivablePort,
  type OpenReceivableFromBillingInput,
} from '../../platform/bounded-contexts/enterprise-core-ports';
import { assertUuid } from '../../platform/kernel/uuid';
import { ReceivableError } from '../domain/receivable';
import {
  normalizeOpenReceivableMoney,
  resolveOpenInstallments,
  validateCancelReceivableInput,
  validateReverseSettlementInput,
  validateSettleReceivableInput,
  type CancelReceivableInput,
  type ReverseSettlementInput,
  type SettleReceivableInput,
} from '../domain/receivable.validation';
import { ReceivablesRepository } from '../repositories/receivables.repository';
import {
  toReceivableDetailResponse,
  type ReceivableDetailResponse,
} from '../serializers/receivables-response.serializer';
import { ReceivablesAccessAuthz } from './receivables-access.authz';
import { financeNotFound, mapReceivableDomainError } from './receivables-access.errors';

@Injectable()
export class ReceivablesAccessService implements FinanceReceivablePort {
  constructor(
    private readonly repository: ReceivablesRepository,
    private readonly authz: ReceivablesAccessAuthz,
    private readonly securityAudit: SecurityAuditService,
    private readonly sod: SodEnforcementService,
  ) {}

  async openFromBilling(
    input: OpenReceivableFromBillingInput,
  ): Promise<{ receivableId: string; idempotent: boolean }> {
    try {
      const money = normalizeOpenReceivableMoney(input.principal, input.currencyCode);
      const installments = resolveOpenInstallments(money.principal, input.dueDate, input.installments);
      const opened = await this.repository.openFromBilling({
        unitId: input.unitId,
        clientId: input.clientId,
        originBillingDocumentId: input.billingDocumentId,
        originBillingRecordId: input.billingRecordId,
        originServiceOrderId: input.serviceOrderId,
        originMeasurementId: input.measurementId,
        principal: money.principal,
        currencyCode: money.currencyCode,
        dueDate: input.dueDate.slice(0, 10),
        paymentTerms: input.paymentTerms.trim(),
        externalReference: input.externalReference ?? null,
        actorIdentityId: input.actorIdentityId,
        installments,
      });
      if (!opened.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: input.actorIdentityId,
          action: SECURITY_AUDIT_ACTIONS.FinanceReceivableOpen,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceReceivable,
          resourceId: opened.receivable.id,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
          metadata: {
            billingDocumentId: input.billingDocumentId,
            billingRecordId: input.billingRecordId,
          },
        });
      }
      return { receivableId: opened.receivable.id, idempotent: opened.idempotent };
    } catch (error) {
      throw mapReceivableDomainError(error);
    }
  }

  async cancelFromBilling(input: {
    billingDocumentId: string;
    actorIdentityId: string;
    reason: string;
  }): Promise<void> {
    try {
      await this.repository.cancel({
        originBillingDocumentId: input.billingDocumentId,
        cancelReason: input.reason,
        actorIdentityId: input.actorIdentityId,
      });
    } catch (error) {
      if (error instanceof ReceivableError && error.code === 'RECEIVABLE_NOT_FOUND') {
        return;
      }
      throw mapReceivableDomainError(error);
    }
  }

  async list(actor: IdentityAuthzContext): Promise<ReceivableDetailResponse[]> {
    await this.authz.assertReceivableList(actor);
    const rows = await this.repository.listAll();

    // Autorizacao EM LOTE: a decisao por linha e a mesma, com as leituras de grants hoisted.
    const allowed = await this.authz.filterReceivableList(
      actor,
      rows.map((row) => ({ id: row.id, unitId: row.unit_id, clientId: row.client_id })),
    );
    const visible = rows.filter((_, index) => allowed[index] === true);

    // Filhos em DUAS queries para a pagina inteira (antes: duas por linha).
    const ids = visible.map((row) => row.id);
    const [installments, settlements] = await Promise.all([
      this.repository.listInstallmentsByReceivableIds(ids),
      this.repository.listSettlementsByReceivableIds(ids),
    ]);

    const installmentsByReceivable = new Map<string, typeof installments>();
    for (const row of installments) {
      const bucket = installmentsByReceivable.get(row.receivable_id) ?? [];
      bucket.push(row);
      installmentsByReceivable.set(row.receivable_id, bucket);
    }
    const settlementsByReceivable = new Map<string, typeof settlements>();
    for (const row of settlements) {
      const bucket = settlementsByReceivable.get(row.receivable_id) ?? [];
      bucket.push(row);
      settlementsByReceivable.set(row.receivable_id, bucket);
    }

    return visible.map((row) =>
      toReceivableDetailResponse(
        row,
        installmentsByReceivable.get(row.id) ?? [],
        settlementsByReceivable.get(row.id) ?? [],
      ),
    );
  }

  async getById(actor: IdentityAuthzContext, receivableId: string): Promise<ReceivableDetailResponse> {
    assertUuid(receivableId, 'receivableId');
    const row = await this.repository.findById(receivableId);
    if (!row) {
      throw financeNotFound();
    }
    await this.authz.assertReceivableAction(actor, AUTHZ_ACTIONS.FinanceReceivableRead, {
      id: row.id,
      unitId: row.unit_id,
      clientId: row.client_id,
    });
    const [installments, settlements] = await Promise.all([
      this.repository.listInstallments(row.id),
      this.repository.listSettlements(row.id),
    ]);
    await this.securityAudit.record({
      actorIdentityId: actor.identityId,
      actorSessionId: actor.sessionId,
      action: SECURITY_AUDIT_ACTIONS.FinanceReceivableRead,
      resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceReceivable,
      resourceId: row.id,
      outcome: SECURITY_AUDIT_OUTCOMES.Success,
      classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
    });
    return toReceivableDetailResponse(row, installments, settlements);
  }

  async settle(
    actor: IdentityAuthzContext,
    receivableId: string,
    input: SettleReceivableInput,
  ): Promise<ReceivableDetailResponse> {
    assertUuid(receivableId, 'receivableId');
    const row = await this.repository.findById(receivableId);
    if (!row) {
      throw financeNotFound();
    }
    await this.authz.assertReceivableAction(actor, AUTHZ_ACTIONS.FinanceReceivableSettle, {
      id: row.id,
      unitId: row.unit_id,
      clientId: row.client_id,
    });
    try {
      const validated = validateSettleReceivableInput(input);
      const scope = resolveSodScope(row.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.ReceivableSettle,
        originatorIdentityId: row.created_by_identity_id,
        amount: validated.amount,
        ...scope,
      });
      const settled = await this.repository.settle({
        receivableId,
        amount: validated.amount,
        currencyCode: row.currency_code,
        rowVersion: validated.rowVersion,
        idempotencyKey: validated.idempotencyKey,
        installmentId: validated.installmentId,
        externalReference: validated.externalReference,
        settledAt: validated.settledAt ?? new Date().toISOString(),
        actorIdentityId: actor.identityId,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceReceivableSettle,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceReceivable,
        resourceId: receivableId,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
        metadata: { amount: validated.amount, idempotencyKey: validated.idempotencyKey },
      });
      return this.toDetail(settled.receivable);
    } catch (error) {
      throw mapReceivableDomainError(error);
    }
  }

  async reverseSettlement(
    actor: IdentityAuthzContext,
    receivableId: string,
    settlementId: string,
    input: ReverseSettlementInput,
  ): Promise<ReceivableDetailResponse> {
    assertUuid(receivableId, 'receivableId');
    assertUuid(settlementId, 'settlementId');
    const row = await this.repository.findById(receivableId);
    if (!row) {
      throw financeNotFound();
    }
    await this.authz.assertReceivableAction(actor, AUTHZ_ACTIONS.FinanceReceivableReverse, {
      id: row.id,
      unitId: row.unit_id,
      clientId: row.client_id,
    });
    try {
      const validated = validateReverseSettlementInput(input);
      const settlements = await this.repository.listSettlements(receivableId);
      const source = settlements.find((item) => item.id === settlementId);
      const scope = resolveSodScope(row.unit_id);
      await this.sod.enforce(actor, {
        duty: SOD_DUTIES.ReceivableReverse,
        originatorIdentityId: source?.actor_identity_id,
        amount: source?.amount ?? '0',
        ...scope,
      });
      const reversed = await this.repository.reverseSettlement({
        receivableId,
        settlementId,
        reason: validated.reason,
        idempotencyKey: validated.idempotencyKey,
        actorIdentityId: actor.identityId,
      });
      if (!reversed.idempotent) {
        await this.securityAudit.record({
          actorIdentityId: actor.identityId,
          actorSessionId: actor.sessionId,
          action: SECURITY_AUDIT_ACTIONS.FinanceReceivableSettlementReverse,
          resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceReceivable,
          resourceId: receivableId,
          outcome: SECURITY_AUDIT_OUTCOMES.Success,
          classification: SECURITY_AUDIT_CLASSIFICATIONS.Critical,
          metadata: {
            settlementId: reversed.settlement.id,
            amount: reversed.settlement.amount,
            reason: validated.reason,
            reversedAt: reversed.settlement.reversed_at,
          },
        });
      }
      return this.toDetail(reversed.receivable);
    } catch (error) {
      throw mapReceivableDomainError(error);
    }
  }

  async cancel(
    actor: IdentityAuthzContext,
    receivableId: string,
    input: CancelReceivableInput,
  ): Promise<ReceivableDetailResponse> {
    assertUuid(receivableId, 'receivableId');
    const row = await this.repository.findById(receivableId);
    if (!row) {
      throw financeNotFound();
    }
    await this.authz.assertReceivableAction(actor, AUTHZ_ACTIONS.FinanceReceivableCancel, {
      id: row.id,
      unitId: row.unit_id,
      clientId: row.client_id,
    });
    try {
      const validated = validateCancelReceivableInput(input);
      const cancelled = await this.repository.cancel({
        receivableId,
        rowVersion: validated.rowVersion,
        cancelReason: validated.cancelReason,
        actorIdentityId: actor.identityId,
        idempotencyKey: validated.idempotencyKey,
      });
      await this.securityAudit.record({
        actorIdentityId: actor.identityId,
        actorSessionId: actor.sessionId,
        action: SECURITY_AUDIT_ACTIONS.FinanceReceivableCancel,
        resourceType: SECURITY_AUDIT_RESOURCE_TYPES.FinanceReceivable,
        resourceId: cancelled.receivable.id,
        outcome: SECURITY_AUDIT_OUTCOMES.Success,
        classification: SECURITY_AUDIT_CLASSIFICATIONS.Standard,
      });
      return this.toDetail(cancelled.receivable);
    } catch (error) {
      throw mapReceivableDomainError(error);
    }
  }

  private async toDetail(row: {
    id: string;
    unit_id: string;
    client_id: string;
    origin_kind: string;
    origin_billing_document_id: string;
    origin_billing_record_id: string;
    origin_service_order_id: string;
    origin_measurement_id: string;
    principal: string;
    currency_code: string;
    due_date: string;
    payment_terms: string;
    external_reference: string | null;
    lifecycle: string;
    cancelled_at: string | null;
    cancelled_by_identity_id: string | null;
    cancel_reason: string | null;
    row_version: number;
    created_at: string;
    updated_at: string;
    created_by_identity_id: string;
    updated_by_identity_id: string;
  }): Promise<ReceivableDetailResponse> {
    const [installments, settlements] = await Promise.all([
      this.repository.listInstallments(row.id),
      this.repository.listSettlements(row.id),
    ]);
    return toReceivableDetailResponse(row, installments, settlements);
  }
}
