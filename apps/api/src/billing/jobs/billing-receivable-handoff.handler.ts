import { Inject, Injectable } from '@nestjs/common';
import { BillingDocumentRepository } from '../repositories/billing-document.repository';
import { BILLING_DOCUMENT_STATUSES } from '../domain/billing-document';
import { ENTERPRISE_CORE_PORT, type FinanceReceivablePort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { BACKGROUND_JOB_KINDS } from '../../platform/background-jobs/domain/background-job-kind';
import { PermanentJobError } from '../../platform/background-jobs/domain/job-errors';
import type { BackgroundJobHandler, JobHandlerContext } from '../../platform/background-jobs/domain/job-handler.types';

/**
 * MASTER 001-03: durable handoff to the published Finance boundary.
 * The job is staged in the same transaction as the FINALIZED billing document.
 * Finance owns uniqueness by origin_billing_document_id; reruns must be idempotent.
 */
@Injectable()
export class BillingReceivableHandoffJobHandler implements BackgroundJobHandler {
  readonly jobKind = BACKGROUND_JOB_KINDS.BillingReceivableHandoff;

  constructor(
    private readonly billingDocuments: BillingDocumentRepository,
    @Inject(ENTERPRISE_CORE_PORT.FinanceReceivable)
    private readonly receivables: FinanceReceivablePort,
  ) {}

  async handle(context: JobHandlerContext): Promise<void> {
    const billingDocumentId = context.payload['billingDocumentId'];
    if (context.payload['schemaVersion'] !== 1 ||
      typeof billingDocumentId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(billingDocumentId)) {
      throw new PermanentJobError('BILLING_RECEIVABLE_HANDOFF_PAYLOAD_INVALID');
    }

    await this.billingDocuments.withHandoffLock(billingDocumentId, async () => {
      // Re-read AFTER obtaining the lock: the API may have issued a cancellation
      // while this job was waiting. Never trust a pre-lock status snapshot.
      const document = await this.billingDocuments.findById(billingDocumentId);
      if (!document) {
        throw new PermanentJobError('BILLING_RECEIVABLE_HANDOFF_DOCUMENT_NOT_FOUND');
      }
      if (document.status === BILLING_DOCUMENT_STATUSES.Cancelled) {
        // Both the OPEN job and the CANCEL job converge on the same final state.
        await this.receivables.cancelFromBilling({
          billingDocumentId: document.id,
          actorIdentityId: document.cancelled_by_identity_id ?? document.created_by_identity_id,
          reason: document.cancel_reason ?? 'Billing document cancelled',
        });
        return;
      }
      if (document.status !== BILLING_DOCUMENT_STATUSES.Finalized) {
        throw new PermanentJobError('BILLING_RECEIVABLE_HANDOFF_INVALID_DOCUMENT_STATE');
      }
      if (context.payload['action'] === 'CANCEL') {
        throw new PermanentJobError('BILLING_RECEIVABLE_CANCEL_REQUIRES_CANCELLED_DOCUMENT');
      }

      const issued = new Date(document.issued_at);
      if (Number.isNaN(issued.getTime())) {
        throw new PermanentJobError('BILLING_RECEIVABLE_HANDOFF_ISSUE_DATE_INVALID');
      }
      const due = document.due_date ? new Date(document.due_date) : issued;
      if (Number.isNaN(due.getTime())) {
        throw new PermanentJobError('BILLING_RECEIVABLE_HANDOFF_DUE_DATE_INVALID');
      }

      await this.receivables.openFromBilling({
        billingRecordId: document.billing_record_id,
        billingDocumentId: document.id,
        serviceOrderId: document.service_order_id,
        measurementId: document.measurement_id,
        unitId: document.unit_id,
        clientId: document.client_id,
        principal: document.total_amount,
        currencyCode: document.currency_code,
        dueDate: due.toISOString().slice(0, 10),
        paymentTerms: document.payment_terms,
        externalReference: document.document_number,
        actorIdentityId: document.created_by_identity_id,
      });
    });
  }
}
