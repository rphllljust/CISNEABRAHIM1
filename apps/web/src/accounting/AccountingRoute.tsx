import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import { BackofficeApiError } from '../financial-ui/enterprise-api';
import { probeAccountingReadAccess, probeFixedAssetReadAccess } from './api/accounting-api';

type AccountingRouteAccess = 'journals' | 'fixed-assets';

const ACCOUNTING_ACCESS: Record<
  AccountingRouteAccess,
  {
    capabilityId: string;
    probe: (signal?: AbortSignal) => Promise<boolean>;
  }
> = {
  journals: {
    capabilityId: 'accounting:journal:read',
    probe: probeAccountingReadAccess,
  },
  'fixed-assets': {
    capabilityId: 'accounting:fixed-asset:read',
    probe: probeFixedAssetReadAccess,
  },
};

export function AccountingRoute({
  children,
  access = 'journals',
}: {
  children: ReactNode;
  access?: AccountingRouteAccess;
}) {
  const location = useLocation();
  const { expireSession } = useAuth();
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'session_expired'>('loading');
  const accessPolicy = ACCOUNTING_ACCESS[access];

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void accessPolicy.probe(controller.signal)
      .then((allowed) => {
        if (!cancelled) {
          setState(allowed ? 'allowed' : 'denied');
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof BackofficeApiError && error.status === 401) {
          expireSession();
          setState('session_expired');
          return;
        }
        setState('denied');
      });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessPolicy, expireSession, location.pathname]);

  if (state === 'loading') {
    return (
      <div className="shell-loading" aria-busy="true" aria-live="polite">
        <p>Verificando acesso…</p>
      </div>
    );
  }
  if (state === 'session_expired') {
    return <Navigate to="/login" replace state={{ reason: 'session_expired', from: location.pathname }} />;
  }
  if (state === 'denied') {
    return (
      <Navigate
        to="/app/no-access"
        replace
        state={{ from: location.pathname, capabilityId: accessPolicy.capabilityId }}
      />
    );
  }
  return children;
}
