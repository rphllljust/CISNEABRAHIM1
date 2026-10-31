import { Inject, Injectable } from '@nestjs/common';
import { BACKGROUND_JOB_KINDS } from '../../platform/background-jobs/domain/background-job-kind';
import { PermanentJobError } from '../../platform/background-jobs/domain/job-errors';
import type { BackgroundJobHandler, JobHandlerContext } from '../../platform/background-jobs/domain/job-handler.types';
import { ENTERPRISE_CORE_PORT, type FinanceReceivablePort } from '../../platform/bounded-contexts/enterprise-core-ports';
import { BILLING_DOCUMENT_STATUSES } from '../domain/billing-document';
import { BillingDocumentRepository } from '../repositories/billing-document.repository';

/**
 * Durable reversal fence for a canceled/replaced Nota Fatura.
 * The job is committed with the Billing document's CANCELLED transition,
 * so a failed synchronous Finance cancel never loses the compensation.
 */
@Injectable()
export class BillingReceivableCancelJobHandler implements BackgroundJobHandler {
  readonly jobKind = BACKGROUND_JOB_KINDS.BillingReceivableCancel;

  constructor(
    private readonly billingDocuments: BillingDocumentRepository,
    @Inject(ENTERPRISE_CORE_PORT.FinanceReceivable)
    private readonly receivables: FinanceReceivablePort,
  ) {}

  async handle(context: JobHandlerContext): Promise<void> {
    const { schemaVersion, billingDocumentId, actorIdentityId, reason } = context.payload;
    if (
      schemaVersion !== 1 ||
      typeof billingDocumentId !== 'string' ||
      !/^[0-9a-fA-F-]{36}$/.test(billingDocumentId) ||
      typeof actorIdentityId !== 'string' ||
      actorIdentityId.length === 0 ||
      typeof reason !== 'string' ||
      reason.length < 3
    ) {
      throw new PermanentJobError('BILLING_RECEIVABLE_CANCEL_PAYLOAD_INVALID');
    }
    const document = await this.billingDocuments.findById(billingDocumentId);
    if (!document) {
      throw new PermanentJobError('BILLING_RECEIVABLE_CANCEL_DOCUMENT_NOT_FOUND');
    }
    if (document.status !== BILLING_DOCUMENT_STATUSES.Cancelled) {
      throw new PermanentJobError('BILLING_RECEIVABLE_CANCEL_DOCUMENT_NOT_CANCELLED');
    }
    await this.receivables.cancelFromBilling({
      billingDocumentId: document.id,
      actorIdentityId,
      reason,
    });
  }
}
