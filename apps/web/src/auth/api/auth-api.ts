import {
  AUTH_ERROR_CODES,
  type AuthErrorResponse,
  type AuthSessionResponse,
  type AuthSuccessResponse,
  type AuthTokenResponse,
  type AuthUserMessage,
} from '../types/auth.types';

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1']);
const DEV_DIRECT_API_PORTS = ['3000', '3001'] as const;
let preferredApiBaseUrl: string | null = null;

type ApiBaseUrlResolutionOptions = {
  isDev: boolean;
  browserHostname: string | null;
};

function isLoopbackHostname(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname.toLowerCase());
}

function getBrowserHostname(): string | null {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.location.hostname || null;
}

function sanitizeAbsoluteBaseUrl(baseUrl: string): string | null {
  try {
    return new URL(baseUrl).origin;
  } catch {
    return null;
  }
}

function adaptConfiguredBaseUrl(
  baseUrl: string,
  { isDev, browserHostname }: ApiBaseUrlResolutionOptions,
): string {
  if (!isDev || !browserHostname || isLoopbackHostname(browserHostname)) {
    return baseUrl;
  }

  const parsed = new URL(baseUrl);
  if (!isLoopbackHostname(parsed.hostname)) {
    return baseUrl;
  }

  parsed.hostname = browserHostname;
  return parsed.origin;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildApiBaseUrlCandidates(
  configuredBaseUrl: string | undefined,
  options: ApiBaseUrlResolutionOptions,
): string[] {
  const candidates: string[] = [];
  const preferProxyFirst =
    options.isDev &&
    options.browserHostname !== null &&
    !isLoopbackHostname(options.browserHostname);

  if (preferProxyFirst) {
    candidates.push('');
  }

  const configured = configuredBaseUrl?.trim();
  if (configured) {
    const sanitized = sanitizeAbsoluteBaseUrl(configured);
    if (sanitized) {
      candidates.push(adaptConfiguredBaseUrl(sanitized, options));
    }
  }

  if (options.isDev) {
    if (!candidates.includes('')) {
      candidates.push('');
    }
    if (options.browserHostname) {
      for (const port of DEV_DIRECT_API_PORTS) {
        candidates.push(`http://${options.browserHostname}:${port}`);
      }
    }
    for (const host of ['localhost', '127.0.0.1']) {
      for (const port of DEV_DIRECT_API_PORTS) {
        candidates.push(`http://${host}:${port}`);
      }
    }
  }

  if (candidates.length === 0) {
    candidates.push('http://localhost:3000');
  }

  return dedupe(candidates);
}

function getRuntimeApiBaseUrl(): string | undefined {
  if (typeof window !== 'undefined') {
    const runtimeConfig = (window as Window & {
      __CISNE_RUNTIME_CONFIG__?: { apiBaseUrl?: string };
    }).__CISNE_RUNTIME_CONFIG__;
    const runtimeApiBaseUrl = runtimeConfig?.apiBaseUrl?.trim();
    if (runtimeApiBaseUrl) {
      return runtimeApiBaseUrl;
    }
  }
  return import.meta.env.VITE_API_BASE_URL;
}

function getApiBaseUrlCandidatesFromRuntime(): string[] {
  return buildApiBaseUrlCandidates(getRuntimeApiBaseUrl(), {
    isDev: import.meta.env.DEV,
    browserHostname: getBrowserHostname(),
  });
}

export function getApiBaseUrl(): string {
  if (preferredApiBaseUrl) {
    return preferredApiBaseUrl;
  }
  return getApiBaseUrlCandidatesFromRuntime()[0] ?? 'http://localhost:3000';
}

export function resetApiBaseUrlCacheForTests(): void {
  preferredApiBaseUrl = null;
}

function shouldRetryWithNextCandidate(
  response: Response,
  baseUrl: string,
  hasNext: boolean,
  isDev: boolean,
): boolean {
  if (!hasNext || !isDev) {
    return false;
  }
  if (baseUrl === '' && response.status >= 500) {
    return true;
  }
  return response.status === 502 || response.status === 503 || response.status === 504;
}

async function fetchApi(path: string, init: RequestInit): Promise<Response> {
  const candidates = getApiBaseUrlCandidatesFromRuntime();
  const orderedCandidates = preferredApiBaseUrl
    ? [preferredApiBaseUrl, ...candidates.filter((candidate) => candidate !== preferredApiBaseUrl)]
    : candidates;

  const isDev = import.meta.env.DEV;
  let lastNetworkError: unknown = null;
  let lastResponse: Response | null = null;

  for (const [index, baseUrl] of orderedCandidates.entries()) {
    try {
      const response = await fetch(`${baseUrl}${path}`, init);
      const hasNext = index < orderedCandidates.length - 1;
      if (shouldRetryWithNextCandidate(response, baseUrl, hasNext, isDev)) {
        lastResponse = response;
        continue;
      }
      preferredApiBaseUrl = baseUrl;
      return response;
    } catch (error) {
      if (!isNetworkError(error)) {
        if (error instanceof Error) {
          throw error;
        }
        throw new TypeError('Falha na requisição à API.', { cause: error });
      }
      lastNetworkError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }
  if (lastNetworkError) {
    if (lastNetworkError instanceof Error) {
      throw lastNetworkError;
    }
    throw new TypeError('Não foi possível conectar ao endpoint da API.', {
      cause: lastNetworkError,
    });
  }
  throw new TypeError('Não foi possível conectar ao endpoint da API.');
}

export function mapAuthErrorToUserMessage(code: string | undefined): AuthUserMessage {
  switch (code) {
    case AUTH_ERROR_CODES.INVALID_CREDENTIALS:
      return 'invalid_credentials';
    case AUTH_ERROR_CODES.ACCOUNT_DISABLED:
      return 'account_disabled';
    case AUTH_ERROR_CODES.RATE_LIMITED:
      return 'rate_limited';
    case AUTH_ERROR_CODES.VALIDATION_FAILED:
      return 'validation_failed';
    case AUTH_ERROR_CODES.SESSION_EXPIRED:
    case AUTH_ERROR_CODES.SESSION_REVOKED:
    case AUTH_ERROR_CODES.REFRESH_REUSED:
    case AUTH_ERROR_CODES.UNAUTHORIZED:
      return 'session_expired';
    default:
      return 'generic';
  }
}

export function userMessageText(message: AuthUserMessage): string {
  switch (message) {
    case 'invalid_credentials':
      return 'Não foi possível entrar. Verifique suas credenciais e tente novamente.';
    case 'account_disabled':
      return 'Esta conta não está disponível.';
    case 'rate_limited':
      return 'Muitas tentativas. Aguarde e tente novamente.';
    case 'validation_failed':
      return 'Verifique os dados informados e tente novamente.';
    case 'session_expired':
      return 'Sua sessão expirou. Entre novamente.';
    case 'network_error':
      return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
    case 'service_unavailable':
      return 'O serviço está temporariamente indisponível.';
    default:
      return 'Algo deu errado. Tente novamente.';
  }
}

export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return true;
  }
  if (error instanceof DOMException && error.name === 'AbortError') {
    return false;
  }
  return false;
}

async function parseJson<T>(response: Response): Promise<T | null> {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
}

export class AuthApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly userMessage: AuthUserMessage;

  constructor(status: number, code: string | undefined, userMessage: AuthUserMessage) {
    super(userMessage);
    this.status = status;
    this.code = code;
    this.userMessage = userMessage;
  }
}

export async function loginRequest(
  login: string,
  password: string,
  signal?: AbortSignal,
): Promise<AuthTokenResponse> {
  const response = await fetchApi('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ login, password }),
    signal,
  });

  if (!response.ok) {
    const body = await parseJson<AuthErrorResponse>(response);
    throw new AuthApiError(
      response.status,
      body?.error.code,
      mapAuthErrorToUserMessage(body?.error.code),
    );
  }

  return (await response.json()) as AuthTokenResponse;
}

export async function refreshRequest(
  refreshToken: string,
  signal?: AbortSignal,
): Promise<AuthTokenResponse> {
  const response = await fetchApi('/api/v1/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ refreshToken }),
    signal,
  });

  if (!response.ok) {
    const body = await parseJson<AuthErrorResponse>(response);
    throw new AuthApiError(
      response.status,
      body?.error.code,
      mapAuthErrorToUserMessage(body?.error.code),
    );
  }

  return (await response.json()) as AuthTokenResponse;
}

export async function sessionRequest(
  accessToken: string,
  signal?: AbortSignal,
): Promise<AuthSessionResponse> {
  const response = await fetchApi('/api/v1/auth/session', {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });

  if (!response.ok) {
    const body = await parseJson<AuthErrorResponse>(response);
    throw new AuthApiError(
      response.status,
      body?.error.code,
      mapAuthErrorToUserMessage(body?.error.code),
    );
  }

  return (await response.json()) as AuthSessionResponse;
}

export async function logoutRequest(
  accessToken: string,
  signal?: AbortSignal,
): Promise<AuthSuccessResponse> {
  const response = await fetchApi('/api/v1/auth/logout', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });

  if (!response.ok) {
    const body = await parseJson<AuthErrorResponse>(response);
    throw new AuthApiError(
      response.status,
      body?.error.code,
      mapAuthErrorToUserMessage(body?.error.code),
    );
  }

  return (await response.json()) as AuthSuccessResponse;
}

export async function logoutAllRequest(
  accessToken: string,
  signal?: AbortSignal,
): Promise<AuthSuccessResponse> {
  const response = await fetchApi('/api/v1/auth/logout-all', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    signal,
  });

  if (!response.ok) {
    const body = await parseJson<AuthErrorResponse>(response);
    throw new AuthApiError(
      response.status,
      body?.error.code,
      mapAuthErrorToUserMessage(body?.error.code),
    );
  }

  return (await response.json()) as AuthSuccessResponse;
}
