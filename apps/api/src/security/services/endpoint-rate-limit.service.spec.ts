import { afterEach, describe, expect, it } from 'vitest';
import { EndpointRateLimitService } from './endpoint-rate-limit.service';
import { RateLimitExceededError } from '../errors/rate-limit-exceeded.error';

describe('EndpointRateLimitService', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('blocks after max requests in window', async () => {
    process.env['SECURITY_RATE_LOGIN_MAX'] = '2';
    process.env['SECURITY_RATE_LOGIN_WINDOW_MS'] = '60000';
    // Sem executor o store cai em memoria — e o modo que estes testes cobrem.
    const limiter = new EndpointRateLimitService(null);
    await limiter.assertAllowed('login', 'client-1');
    await limiter.assertAllowed('login', 'client-1');
    await expect(limiter.assertAllowed('login', 'client-1')).rejects.toThrow(
      RateLimitExceededError,
    );
  });

  it('isolates buckets per surface and key', async () => {
    process.env['SECURITY_RATE_SEARCH_MAX'] = '1';
    const limiter = new EndpointRateLimitService(null);
    await limiter.assertAllowed('search', 'user-a');
    await expect(limiter.assertAllowed('search', 'user-a')).rejects.toThrow(
      RateLimitExceededError,
    );
    await expect(limiter.assertAllowed('search', 'user-b')).resolves.toBeUndefined();
    await expect(limiter.assertAllowed('upload', 'user-a')).resolves.toBeUndefined();
  });

  it('reports memory mode when no executor is supplied', () => {
    const limiter = new EndpointRateLimitService(null);
    expect(limiter.mode).toBe('memory');
  });

  it('reports shared mode when an executor is supplied', () => {
    const limiter = new EndpointRateLimitService({
      query: async () => ({ rows: [{ count: 1, window_started_at: new Date() }] }),
    });
    expect(limiter.mode).toBe('shared');
  });
});
