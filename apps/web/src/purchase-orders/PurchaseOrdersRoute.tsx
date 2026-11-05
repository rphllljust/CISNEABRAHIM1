import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import {
  PurchaseOrdersApiError,
  probePurchaseOrderListAccess,
} from './api/purchase-orders-api';

type PurchaseOrdersRouteProps = {
  children: ReactNode;
};

export function PurchaseOrdersRoute({ children }: PurchaseOrdersRouteProps) {
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

    void probePurchaseOrderListAccess(controller.signal)
      .then((allowed) => {
        if (!cancelled) {
          setState(allowed ? 'allowed' : 'denied');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof PurchaseOrdersApiError && error.status === 401) {
          expireSession();
          setState('session_expired');
          return;
        }
        if (error instanceof PurchaseOrdersApiError && error.status === 403) {
          setState('denied');
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
        <p>Não foi possível verificar o acesso. O serviço pode estar indisponível.</p>
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
        state={{ from: location.pathname, capabilityId: 'commercial:purchase-order:list' }}
      />
    );
  }

  return children;
}
