import { describe, expect, it } from 'vitest';
import type { BillingRecordDetail } from '../types/billing.types';
import {
  BILLING_DOCUMENT_PREVIEW_LABELS,
  buildBillingDocumentPreview,
  hasActiveFinalizedDocument,
  resolveBillingRecordTermsDivergence,
} from './billing-document-preview';

function buildBillingFixture(overrides: Partial<BillingRecordDetail> = {}): BillingRecordDetail {
  return {
    id: 'billing-1',
    serviceOrderId: 'order-1',
    measurementId: 'measurement-1',
    clientId: 'client-1',
    unitId: 'unit-1',
    status: 'PREPARED',
    proposalId: null,
    purchaseOrderId: 'po-1',
    contractReference: 'CTR-2026',
    clientLegalNameSnapshot: 'Cliente Demo LTDA',
    clientTaxIdSnapshot: '11222333000181',
    billingAddressSnapshot: { city: 'Porto Velho', state: 'RO', postalCode: '76801000' },
    commercialReferenceSnapshot: { label: 'PO Demo' },
    currencyCode: 'BRL',
    paymentTerms: '30 DDL',
    paymentTermsSource: 'PURCHASE_ORDER',
    paymentTermsAuthoritative: '30 DDL',
    totalAmount: '1000.0000',
    preparedAt: '2026-01-15T10:00:00.000Z',
    preparedByIdentityId: 'actor-1',
    voidedAt: null,
    voidedByIdentityId: null,
    voidReason: null,
    rowVersion: 1,
    createdAt: '2026-01-15T10:00:00.000Z',
    updatedAt: '2026-01-15T10:00:00.000Z',
    items: [
      {
        id: 'item-1',
        lineNumber: 1,
        measurementItemId: 'mi-1',
        sourceExecutionEntryId: null,
        unitCode: 'SERVICE',
        quantity: '1',
        unitPrice: '1000.0000',
        lineAmount: '1000.0000',
        pricingLineSnapshot: {},
        lineLabel: 'Serviço demo',
      },
    ],
    historyEvents: [],
    ...overrides,
  };
}

describe('buildBillingDocumentPreview', () => {
  it('builds preview from billing snapshots without arbitrary text fields', () => {
    const billing = buildBillingFixture();
    const preview = buildBillingDocumentPreview(billing, {
      dueDate: '2026-02-14',
      documentNumber: null,
      purchaseOrderNumber: 'PO-DEMO-01',
      commercialReferenceLabel: 'Pedido PO-DEMO-01',
      emitter: {
        legalName: 'EMPRESA EMISSORA PILOTO LTDA',
        taxId: '11222333000181',
        addressLine: 'Rua Demo, 100, Centro, Porto Velho, RO, 76801000',
      },
    });

    expect(preview.documentCategory).toBe(BILLING_DOCUMENT_PREVIEW_LABELS.documentCategory);
    expect(preview.documentNumberLabel).toBe('Atribuído na emissão');
    expect(preview.clientLegalName).toBe('Cliente Demo LTDA');
    expect(preview.emitterLegalName).toBe('EMPRESA EMISSORA PILOTO LTDA');
    expect(preview.emitterAddressLine).toBe('Rua Demo, 100, Centro, Porto Velho, RO, 76801000');
    expect(preview.dueDate).toBe('2026-02-14');
    expect(preview.purchaseOrderNumber).toBe('PO-DEMO-01');
    expect(preview.items).toHaveLength(1);
    // O rodapé declara o que o documento é. Antes dizia "Não constitui NF-e"; a declaração
    // passou a nomear o que o documento É (documento comercial interno) e o que ele NÃO
    // substitui, sem citar sigla de documento fiscal que poderia sugerir emissão oficial.
    expect(preview.fiscalDisclaimer).toContain('Documento comercial interno');
    expect(preview.fiscalDisclaimer).toContain('não substitui documento fiscal eletrônico');
  });

  it('never fabricates an issuer when no emitted document exists', () => {
    const preview = buildBillingDocumentPreview(buildBillingFixture(), {
      commercialReferenceLabel: 'Ref',
    });
    expect(preview.emitterLegalName).toBe('');
    expect(preview.emitterTaxId).toBe('');
    expect(preview.emitterAddressLine).toBe('');
  });

  it('uses issued document number when available', () => {
    const preview = buildBillingDocumentPreview(buildBillingFixture(), {
      documentNumber: 'NF-2026-000042',
      commercialReferenceLabel: 'Ref',
    });
    expect(preview.documentNumberLabel).toBe('NF-2026-000042');
  });
});

describe('resolveBillingRecordTermsDivergence', () => {
  it('returns null when terms match authoritative source', () => {
    expect(resolveBillingRecordTermsDivergence(buildBillingFixture())).toBeNull();
  });

  it('detects mismatch between declared and authoritative terms', () => {
    const divergence = resolveBillingRecordTermsDivergence(
      buildBillingFixture({
        paymentTerms: 'À vista',
        paymentTermsAuthoritative: '07 DDL',
      }),
    );
    expect(divergence).toEqual({
      authoritativeValue: '07 DDL',
      declaredValue: 'À vista',
    });
  });
});

describe('hasActiveFinalizedDocument', () => {
  it('returns true when a finalized document exists', () => {
    expect(hasActiveFinalizedDocument([{ status: 'CANCELLED' }, { status: 'FINALIZED' }])).toBe(true);
  });

  it('returns false when no finalized document exists', () => {
    expect(hasActiveFinalizedDocument([{ status: 'CANCELLED' }])).toBe(false);
  });
});
