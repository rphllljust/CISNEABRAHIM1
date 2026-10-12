import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import { BackofficeApiError } from '../financial-ui/enterprise-api';
import { probeFixedAssetReadAccess } from './api/accounting-api';
import { probeExplicitCapability, probeSurfaceAccess, resolveAuthorizedUnit } from '../shell/surface-access';

type AccountingRouteAccess = 'journals' | 'fixed-assets';

const ACCOUNTING_ACCESS: Record<
  AccountingRouteAccess,
  {
    capabilityId: string;
    accessCheck: string;
  }
> = {
  journals: {
    capabilityId: 'accounting:journal:read',
    accessCheck: 'accounting-journal-read',
  },
  'fixed-assets': {
    capabilityId: 'accounting:fixed-asset:read',
    accessCheck: 'accounting-fixed-asset-read',
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
  const { expireSession, identityId } = useAuth();
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'session_expired'>('loading');
  const policy = ACCOUNTING_ACCESS[access];

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    async function resolveAccess() {
      if (!identityId) {
        if (!cancelled) {
          setState('denied');
        }
        return;
      }

      try {
        /*
         * Plano/lançamentos entram pela lista real de planos da unidade.
         * O probe antigo consultava um chart sintético e podia receber 403 antes de
         * alcançar a leitura que a própria tela usa.
         *
         * Ativo imobilizado não possui listagem de entrada sem um ativo concreto;
         * por isso mantém a sonda de capability já existente.
         */
        let allowed = false;
        if (access === 'fixed-assets') {
          allowed = await probeFixedAssetReadAccess(controller.signal);
        } else {
          const unitId = await resolveAuthorizedUnit(identityId, controller.signal);
          if (cancelled) {
            return;
          }
          let result = await probeSurfaceAccess(
            policy.accessCheck,
            unitId,
            controller.signal,
          );
          if (result.outcome === 'undetermined') {
            result = await probeExplicitCapability(
              identityId,
              policy.capabilityId,
              controller.signal,
            );
          }
          allowed = result.outcome === 'allowed';
        }

        if (!cancelled) {
          setState(allowed ? 'allowed' : 'denied');
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (
          (error instanceof Error && error.message === 'session_expired') ||
          (error instanceof BackofficeApiError && error.status === 401)
        ) {
          expireSession();
          setState('session_expired');
          return;
        }
        setState('denied');
      }
    }

    void resolveAccess();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    access,
    expireSession,
    identityId,
    location.pathname,
    policy.accessCheck,
  ]);

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
        state={{ from: location.pathname, capabilityId: policy.capabilityId }}
      />
    );
  }
  return children;
}
