import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { AccessAdminApiError, probeAccessAdminAccess } from './api/access-admin-api';
import { useAuth } from '../auth/context/AuthProvider';

type AccessAdminRouteProps = {
  children: ReactNode;
};

/**
 * Gate de rota do módulo de administração de acesso.
 * Espelha `CatalogRoute`: sonda o endpoint, expira a sessão em 401 e
 * redireciona para `/app/no-access` quando negado.
 */
export function AccessAdminRoute({ children }: AccessAdminRouteProps) {
  const location = useLocation();
  const { expireSession } = useAuth();
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'session_expired' | 'error'>(
    'loading',
  );

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState('loading');

    void probeAccessAdminAccess(controller.signal)
      .then((allowed) => {
        if (!cancelled) {
          setState(allowed ? 'allowed' : 'denied');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof AccessAdminApiError && error.status === 401) {
          expireSession();
          setState('session_expired');
          return;
        }
        setState('error');
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [expireSession, location.pathname, retryNonce]);

  if (state === 'loading') {
    return (
      <div className="shell-loading" aria-busy="true" aria-live="polite">
        <p>Verificando acesso…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="shell-loading" role="alert" aria-live="polite">
        <p>Não foi possível verificar as permissões administrativas. O servidor pode estar indisponível.</p>
        <button type="button" onClick={() => setRetryNonce((value) => value + 1)}>
          Tentar novamente
        </button>
      </div>
    );
  }

  if (state === 'session_expired') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ reason: 'session_expired', from: location.pathname }}
      />
    );
  }

  if (state === 'denied') {
    return (
      <Navigate
        to="/app/no-access"
        replace
        state={{ from: location.pathname, capabilityId: 'authz:access-admin:read' }}
      />
    );
  }

  return children;
}
