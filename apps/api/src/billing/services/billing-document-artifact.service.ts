import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { DownloadTokenService } from '../../documents/storage/download-token.service';
import { ObjectStorageService } from '../../documents/storage/object-storage.service';
import type { BillingDocumentPdfSnapshot } from '../domain/billing-document';
import { renderBillingDocumentPdf } from '../domain/billing-document-pdf';
import type { BillingItemRow, BillingRecordRow } from '../repositories/billing.repository.types';
import type {
  AllocatedDocumentNumber,
  PersistedBillingArtifact,
} from '../repositories/billing-document.repository.types';

/**
 * Rótulos do documento interno de cobrança (Release 1). Não contêm dados de
 * identidade fiscal da empresa emissora — esses vêm do registro (registry).
 */
const BILLING_DOCUMENT_LABEL = 'NOTA FATURA';
const FISCAL_DISCLAIMER =
  'Faturamento interno da Release 1. Documento de cobrança operacional. Não constitui NF-e, NFS-e nem documento fiscal oficial autorizado.';

export type BillingEmitterReference = {
  legalName: string;
  taxId: string;
  address: {
    street?: string | null;
    number?: string | null;
    complement?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
    postalCode?: string | null;
    countryCode?: string | null;
  };
};

@Injectable()
export class BillingDocumentArtifactService {
  constructor(
    private readonly objectStorage: ObjectStorageService,
    private readonly downloadTokens: DownloadTokenService,
  ) {}

  async persistArtifact(input: {
    allocation: AllocatedDocumentNumber;
    emitter: BillingEmitterReference;
    billingRecord: BillingRecordRow;
    billingItems: BillingItemRow[];
    purchaseOrderNumber: string | null;
    customerPurchaseOrderNumber: string | null;
    dueDate: string | null;
    issuedAt: string;
    actorIdentityId: string;
  }): Promise<PersistedBillingArtifact> {
    const snapshot = this.buildPdfSnapshot({
      ...input,
      documentNumber: input.allocation.documentNumber,
    });
    const { buffer, sha256 } = await renderBillingDocumentPdf(snapshot);
    const verifiedSha256 = createHash('sha256').update(buffer).digest('hex');
    if (verifiedSha256 !== sha256) {
      throw new Error('BILLING_DOCUMENT_ARTIFACT_HASH_MISMATCH');
    }
    const storageKey = this.downloadTokens.generateStorageKey();
    const storedDocumentId = randomUUID();
    const storedObjectId = randomUUID();
    const originalFilename = `nota-fatura-${input.allocation.documentNumber}.pdf`;
    const title = `${BILLING_DOCUMENT_LABEL} ${input.allocation.documentNumber}`;

    await this.objectStorage.putObject({
      storageKey,
      buffer,
      mimeType: 'application/pdf',
    });

    return {
      storedDocumentId,
      storedObjectId,
      storageKey,
      sha256,
      byteSize: buffer.byteLength,
      originalFilename,
      title,
    };
  }

  buildPdfSnapshot(input: {
    documentNumber: string;
    emitter: BillingEmitterReference;
    billingRecord: BillingRecordRow;
    billingItems: BillingItemRow[];
    purchaseOrderNumber: string | null;
    customerPurchaseOrderNumber: string | null;
    dueDate: string | null;
    issuedAt: string;
  }): BillingDocumentPdfSnapshot {
    return {
      documentNumber: input.documentNumber,
      documentCategory: BILLING_DOCUMENT_LABEL,
      fiscalDisclaimer: FISCAL_DISCLAIMER,
      issuedAt: input.issuedAt,
      dueDate: input.dueDate,
      emitterLegalName: input.emitter.legalName,
      emitterTaxId: input.emitter.taxId,
      emitterAddress: input.emitter.address,
      clientLegalName: input.billingRecord.client_legal_name_snapshot,
      clientTaxId: input.billingRecord.client_tax_id_snapshot,
      billingAddress: input.billingRecord.billing_address_snapshot,
      paymentTerms: input.billingRecord.payment_terms,
      currencyCode: input.billingRecord.currency_code,
      totalAmount: input.billingRecord.total_amount,
      purchaseOrderNumber: input.purchaseOrderNumber,
      contractReference: input.billingRecord.contract_reference,
      commercialReference: input.billingRecord.commercial_reference_snapshot,
      items: input.billingItems.map((item) => ({
        lineNumber: item.line_number,
        billingItemId: item.id,
        measurementItemId: item.measurement_item_id,
        unitCode: item.unit_code,
        quantity: item.quantity,
        unitPrice: item.unit_price,
        lineAmount: item.line_amount,
        lineLabel: item.line_label,
        pricingLineSnapshot: item.pricing_line_snapshot,
      })),
    };
  }

  async compensateStorage(error: unknown): Promise<void> {
    if (!error || typeof error !== 'object' || !('storageKey' in error)) {
      return;
    }
    const storageKey = (error as { storageKey?: string }).storageKey;
    if (storageKey) {
      await this.objectStorage.deleteObject(storageKey);
    }
  }
}
