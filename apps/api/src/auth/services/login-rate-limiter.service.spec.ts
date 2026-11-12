import { afterEach, describe, expect, it } from 'vitest';
import { LoginRateLimiterService } from './login-rate-limiter.service';
import { EndpointRateLimitService } from '../../security/services/endpoint-rate-limit.service';
import { RateLimitExceededError } from '../../security/errors/rate-limit-exceeded.error';

describe('LoginRateLimiterService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('allows requests within the limit', async () => {
    process.env['SECURITY_RATE_LOGIN_MAX'] = '3';
    const limiter = new LoginRateLimiterService(new EndpointRateLimitService(null));
    await expect(limiter.assertAllowed('client-a')).resolves.toBeUndefined();
    await expect(limiter.assertAllowed('client-a')).resolves.toBeUndefined();
    await expect(limiter.assertAllowed('client-a')).resolves.toBeUndefined();
  });

  it('blocks repeated abuse for the same client key', async () => {
    process.env['SECURITY_RATE_LOGIN_MAX'] = '3';
    const limiter = new LoginRateLimiterService(new EndpointRateLimitService(null));
    await limiter.assertAllowed('client-b');
    await limiter.assertAllowed('client-b');
    await limiter.assertAllowed('client-b');
    await expect(limiter.assertAllowed('client-b')).rejects.toThrow(RateLimitExceededError);
  });

  it('isolates buckets per client key', async () => {
    process.env['SECURITY_RATE_LOGIN_MAX'] = '3';
    const limiter = new LoginRateLimiterService(new EndpointRateLimitService(null));
    await limiter.assertAllowed('client-c');
    await limiter.assertAllowed('client-c');
    await limiter.assertAllowed('client-c');
    await expect(limiter.assertAllowed('client-d')).resolves.toBeUndefined();
  });
});
