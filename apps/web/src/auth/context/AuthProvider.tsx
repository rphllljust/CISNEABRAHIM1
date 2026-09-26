import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  AuthApiError,
  isNetworkError,
  loginRequest,
  logoutAllRequest,
  logoutRequest,
  refreshRequest,
  sessionRequest,
} from '../api/auth-api';
import { tokenStore } from '../storage/token-store';
import type { AuthUserMessage } from '../types/auth.types';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'unavailable';

export type AuthState = {
  status: AuthStatus;
  identityId: string | null;
  sessionId: string | null;
};

type AuthContextValue = AuthState & {
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshSession: () => Promise<void>;
  expireSession: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

let refreshInFlight: Promise<void> | null = null;

async function runRefresh(): Promise<void> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) {
    throw new AuthApiError(401, 'AUTH_UNAUTHORIZED', 'session_expired');
  }
  const tokens = await refreshRequest(refreshToken);
  tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
}

async function refreshWithMutex(): Promise<void> {
  if (!refreshInFlight) {
    refreshInFlight = runRefresh().finally(() => {
      refreshInFlight = null;
    });
  }
  await refreshInFlight;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    identityId: null,
    sessionId: null,
  });
  const bootstrapController = useRef<AbortController | null>(null);

  const clearSession = useCallback(() => {
    tokenStore.clear();
    setState({ status: 'unauthenticated', identityId: null, sessionId: null });
  }, []);

  const applySession = useCallback((identityId: string, sessionId: string) => {
    setState({ status: 'authenticated', identityId, sessionId });
  }, []);

  const expireSession = useCallback(() => {
    tokenStore.clear();
    setState({ status: 'unauthenticated', identityId: null, sessionId: null });
  }, []);

  const bootstrap = useCallback(async () => {
    bootstrapController.current?.abort();
    const controller = new AbortController();
    bootstrapController.current = controller;
    setState((current) => ({ ...current, status: 'loading' }));

    try {
      const existingAccess = tokenStore.getAccessToken();
      if (!existingAccess && tokenStore.getRefreshToken()) {
        await refreshWithMutex();
      }

      const accessToken = tokenStore.getAccessToken();
      if (!accessToken) {
        clearSession();
        return;
      }

      const session = await sessionRequest(accessToken, controller.signal);
      applySession(session.identityId, session.session.id);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      if (isNetworkError(error)) {
        setState({ status: 'unavailable', identityId: null, sessionId: null });
        return;
      }
      // Rate limit no bootstrap NAO invalida a sessao: o refresh token continua no
      // sessionStorage e a sessao pode ser retomada quando a janela reabrir. Limitar
      // (429) e condicao transitoria/de infraestrutura, nao credencial invalida; destruir
      // a sessao aqui deslogaria o usuario por excesso de recargas/navegacao (o limite e
      // por IP+user-agent). Reaproveita o estado `unavailable` ja tratado pelo ProtectedRoute.
      if (error instanceof AuthApiError && error.status === 429) {
        setState({ status: 'unavailable', identityId: null, sessionId: null });
        return;
      }
      clearSession();
    }
  }, [applySession, clearSession]);

  useEffect(() => {
    void bootstrap();
    return () => {
      bootstrapController.current?.abort();
    };
  }, [bootstrap]);

  const login = useCallback(
    async (login: string, password: string) => {
      const controller = new AbortController();
      const tokens = await loginRequest(login, password, controller.signal);
      tokenStore.setTokens(tokens.accessToken, tokens.refreshToken);
      const session = await sessionRequest(tokens.accessToken, controller.signal);
      applySession(session.identityId, session.session.id);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    const accessToken = tokenStore.getAccessToken();
    try {
      if (accessToken) {
        await logoutRequest(accessToken);
      }
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const logoutAll = useCallback(async () => {
    const accessToken = tokenStore.getAccessToken();
    try {
      if (accessToken) {
        await logoutAllRequest(accessToken);
      }
    } finally {
      clearSession();
    }
  }, [clearSession]);

  const refreshSession = useCallback(async () => {
    await refreshWithMutex();
    const accessToken = tokenStore.getAccessToken();
    if (!accessToken) {
      clearSession();
      return;
    }
    const session = await sessionRequest(accessToken);
    applySession(session.identityId, session.session.id);
  }, [applySession, clearSession]);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      login,
      logout,
      logoutAll,
      refreshSession,
      expireSession,
    }),
    [state, login, logout, logoutAll, refreshSession, expireSession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}

export function mapLoginError(error: unknown): AuthUserMessage {
  if (error instanceof AuthApiError) {
    return error.userMessage;
  }
  if (isNetworkError(error)) {
    return 'network_error';
  }
  return 'generic';
}
