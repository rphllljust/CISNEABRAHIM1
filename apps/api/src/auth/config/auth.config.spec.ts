import { afterEach, describe, expect, it } from 'vitest';
import { loadAuthConfig } from './auth.config';

const originalEnv = { ...process.env };

describe('auth.config', () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses CORS_ORIGIN as comma-separated list and keeps local defaults', () => {
    process.env['JWT_SECRET'] = 'unit-test-jwt-secret-with-32-characters';
    process.env['CORS_ORIGIN'] = 'http://192.168.1.89:5177, http://localhost:6000/';

    const config = loadAuthConfig();

    expect(config.corsOrigins).toContain('http://192.168.1.89:5177');
    expect(config.corsOrigins).toContain('http://localhost:6000');
    expect(config.corsOrigins).toContain('http://localhost:5173');
    expect(config.corsOrigins).toContain('http://127.0.0.1:5174');
  });

  it('uses fallback local origins when CORS_ORIGIN is missing', () => {
    process.env['JWT_SECRET'] = 'unit-test-jwt-secret-with-32-characters';
    delete process.env['CORS_ORIGIN'];

    const config = loadAuthConfig();

    expect(config.corsOrigins).toEqual(
      expect.arrayContaining([
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:5174',
        'http://127.0.0.1:5174',
      ]),
    );
  });

  it('does not add localhost origins automatically in production', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['CISNE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'unit-test-jwt-secret-with-32-characters';
    process.env['CORS_ORIGIN'] = 'https://app.cisne.example';

    const config = loadAuthConfig();

    expect(config.corsOrigins).toEqual(['https://app.cisne.example']);
    expect(config.corsOrigins).not.toContain('http://localhost:5173');
    expect(config.corsOrigins).not.toContain('http://127.0.0.1:5174');
  });

});
