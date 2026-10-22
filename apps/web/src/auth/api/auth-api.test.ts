import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_ERROR_CODES } from '../types/auth.types';
import {
  buildApiBaseUrlCandidates,
  getApiBaseUrl,
  loginRequest,
  mapAuthErrorToUserMessage,
  resetApiBaseUrlCacheForTests,
  userMessageText,
} from './auth-api';

describe('auth-api', () => {
  afterEach(() => {
    resetApiBaseUrlCacheForTests();
    delete (window as Window & {
      __CISNE_RUNTIME_CONFIG__?: { apiBaseUrl?: string };
    }).__CISNE_RUNTIME_CONFIG__;
    vi.unstubAllGlobals();
  });

  it('maps invalid credentials to a single safe message', () => {
    expect(mapAuthErrorToUserMessage(AUTH_ERROR_CODES.INVALID_CREDENTIALS)).toBe(
      'invalid_credentials',
    );
    expect(userMessageText('invalid_credentials')).toBe(
      'Não foi possível entrar. Verifique suas credenciais e tente novamente.',
    );
  });

  it('loginRequest surfaces backend auth errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: AUTH_ERROR_CODES.INVALID_CREDENTIALS, message: 'Invalid credentials.' },
        }),
      }),
    );

    await expect(loginRequest('user', 'wrong')).rejects.toMatchObject({
      userMessage: 'invalid_credentials',
    });
  });

  it('prefers runtime API URL over build-time configuration', () => {
    (window as Window & {
      __CISNE_RUNTIME_CONFIG__?: { apiBaseUrl?: string };
    }).__CISNE_RUNTIME_CONFIG__ = {
      apiBaseUrl: 'https://api.runtime.example',
    };

    expect(getApiBaseUrl()).toBe('https://api.runtime.example');
  });

  it('prefers vite proxy for LAN browser access before direct API host', () => {
    const candidates = buildApiBaseUrlCandidates('http://localhost:3000', {
      isDev: true,
      browserHostname: '192.168.1.89',
    });
    expect(candidates[0]).toBe('');
    expect(candidates).toContain('http://192.168.1.89:3000');
  });

  it('retries another API candidate on network failure', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: { code: AUTH_ERROR_CODES.INVALID_CREDENTIALS, message: 'Invalid credentials.' },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    await expect(loginRequest('user', 'wrong')).rejects.toMatchObject({
      userMessage: 'invalid_credentials',
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
