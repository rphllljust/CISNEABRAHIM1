import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { parseCreateClientInput } from '../clients/dto/client.dto';
import { parseCreatePurchaseOrderInput } from '../commercial/dto/purchase-orders.dto';
import { parseCreateProposalInput } from '../commercial/dto/proposals.dto';
import { PrivilegedFieldError } from './domain/forbidden-payload-fields';
import { loadSecurityConfig } from './config/security.config';
import { sanitizeUploadFilename } from './domain/safe-filename';
import { EndpointRateLimitService } from './services/endpoint-rate-limit.service';
import { RateLimitExceededError } from './errors/rate-limit-exceeded.error';

describe('security regression suite', () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    process.env = { ...envBackup };
  });

  afterEach(() => {
    process.env = { ...envBackup };
  });

  describe('mass assignment', () => {
    it('rejects status on client create', () => {
      expect(() =>
        parseCreateClientInput({
          legalName: 'ACME',
          taxId: '12345678000199',
          contacts: [{ name: 'Ana', purpose: 'COMMERCIAL' }],
          status: 'ACTIVE',
        }),
      ).toThrow(PrivilegedFieldError);
    });

    it('rejects createdBy on purchase order create', () => {
      expect(() =>
        parseCreatePurchaseOrderInput({
          clientId: '00000000-0000-4000-8000-000000000001',
          unitId: '00000000-0000-4000-8000-000000000002',
          poNumber: 'PO-1',
          pricingStructure: 'ITEMIZED',
          items: [],
          createdBy: 'attacker',
        }),
      ).toThrow(PrivilegedFieldError);
    });

    it('rejects role on proposal create', () => {
      expect(() =>
        parseCreateProposalInput({
          clientId: '00000000-0000-4000-8000-000000000001',
          unitId: '00000000-0000-4000-8000-000000000002',
          title: 'Proposal',
          pricingStructure: 'ITEMIZED',
          items: [],
          role: 'ADMIN',
        }),
      ).toThrow(PrivilegedFieldError);
    });
  });

  describe('web security config', () => {
    it('enables HSTS in production', () => {
      const config = loadSecurityConfig({ NODE_ENV: 'production' });
      expect(config.hstsEnabled).toBe(true);
      expect(config.contentSecurityPolicy).toContain("default-src 'none'");
    });

    it('does not enable HSTS in development by default', () => {
      const config = loadSecurityConfig({ NODE_ENV: 'development' });
      expect(config.hstsEnabled).toBe(false);
    });
  });

  describe('file security', () => {
    it('neutralizes malicious upload filenames', () => {
      expect(sanitizeUploadFilename('../../../etc/passwd')).not.toContain('..');
    });
  });

  describe('rate limiting', () => {
    it('limits refresh surface independently from login', async () => {
      process.env['SECURITY_RATE_REFRESH_MAX'] = '1';
      const limiter = new EndpointRateLimitService(null);
      await limiter.assertAllowed('refresh', 'ip:ua');
      await expect(limiter.assertAllowed('refresh', 'ip:ua')).rejects.toThrow(
        RateLimitExceededError,
      );
      await expect(limiter.assertAllowed('login', 'ip:ua')).resolves.toBeUndefined();
    });
  });
});
