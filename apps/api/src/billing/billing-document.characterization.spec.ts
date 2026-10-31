import { HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { BILLING_ERROR_CODES } from './errors/billing-error-codes';
import { BillingHttpException } from './errors/billing-http.exception';
import { requireBillingReceivablePort } from './services/billing-document-access.service';
import {
  billingDocumentAccessDenied,
  billingDocumentAccessNotFound,
  mapBillingDocumentRepositoryError,
} from './services/billing-document-access.errors';

describe('Billing document characterization (unit)', () => {

  it('MASTER 001-03: refuses financial document commands when receivable port is missing', () => {
    expect(() => requireBillingReceivablePort(undefined)).toThrow(ServiceUnavailableException);
    try {
      requireBillingReceivablePort(undefined);
      throw new Error('expected unavailable port failure');
    } catch (error) {
      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as ServiceUnavailableException).getStatus()).toBe(HttpStatus.SERVICE_UNAVAILABLE);
      expect((error as ServiceUnavailableException).message).toContain('BILLING_RECEIVABLE_PORT_UNAVAILABLE');
    }
  });

  it('MASTER 001-03: preserves the exact published finance port when configured', () => {
    const port = {
      openFromBilling: async () => ({ receivableId: 'receivable', idempotent: false }),
      cancelFromBilling: async () => {},
    };
    expect(requireBillingReceivablePort(port)).toBe(port);
  });

  it('maps authz denial to FORBIDDEN DENIED', () => {
    const error = billingDocumentAccessDenied();
    expect(error).toBeInstanceOf(BillingHttpException);
    expect(error.getStatus()).toBe(HttpStatus.FORBIDDEN);
    expect(error.getResponse()).toMatchObject({ error: { code: BILLING_ERROR_CODES.DENIED } });
  });

  it('maps missing billing record to NOT_FOUND', () => {
    const error = billingDocumentAccessNotFound();
    expect(error.getStatus()).toBe(HttpStatus.NOT_FOUND);
    expect(error.getResponse()).toMatchObject({ error: { code: BILLING_ERROR_CODES.NOT_FOUND } });
  });

  it('maps repository already-exists to BILLING_DOCUMENT_ALREADY_EXISTS', () => {
    const error = mapBillingDocumentRepositoryError(new Error('BILLING_DOCUMENT_ALREADY_EXISTS'));
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({
      error: { code: BILLING_ERROR_CODES.BILLING_DOCUMENT_ALREADY_EXISTS },
    });
  });

  it('maps repository version conflict to VERSION_CONFLICT', () => {
    const error = mapBillingDocumentRepositoryError(new Error('BILLING_VERSION_CONFLICT'));
    expect(error.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(error.getResponse()).toMatchObject({ error: { code: BILLING_ERROR_CODES.VERSION_CONFLICT } });
  });
});
