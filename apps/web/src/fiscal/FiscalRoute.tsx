import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import {
  probeExplicitCapability,
  probeSurfaceAccess,
  resolveAuthorizedUnit,
} from '../shell/surface-access';

type FiscalRouteAccess = 'documents' | 'tax' | 'period';

const FISCAL_ACCESS: Record<
  FiscalRouteAccess,
  {
    accessCheck: string;
    capabilityId: string;
  }
> = {
  documents: {
    accessCheck: 'fiscal-document-read',
    capabilityId: 'fiscal:document:read',
  },
  tax: {
    accessCheck: 'fiscal-tax-read',
    capabilityId: 'fiscal:tax:read',
  },
  period: {
    accessCheck: 'fiscal-period-read',
    capabilityId: 'fiscal:period:read',
  },
};

type FiscalRouteProps = {
  children: ReactNode;
  access: FiscalRouteAccess;
};

export function FiscalRoute({ children, access }: FiscalRouteProps) {
  const location = useLocation();
  const { expireSession, identityId } = useAuth();
  const [retryNonce, setRetryNonce] = useState(0);
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'session_expired' | 'error'>('loading');
  const accessPolicy = FISCAL_ACCESS[access];

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    setState('loading');

    async function resolveAccess() {
      if (!identityId) {
        if (!cancelled) {
          setState('denied');
        }
        return;
      }

      try {
        /*
         * A rota deve provar acesso pela MESMA leitura de entrada usada pelo menu e pela
         * própria tela. O probe antigo consultava um detalhe com UUID sintético; para
         * módulos por unidade isso podia devolver 403 mesmo para perfis FULL_ACCESS e
         * redirecionava uma conta válida para /app/no-access.
         */
        const unitId = await resolveAuthorizedUnit(identityId, controller.signal);
        if (cancelled) {
          return;
        }

        const result = unitId
          ? await probeSurfaceAccess(
              accessPolicy.accessCheck,
              unitId,
              controller.signal,
            )
          : await probeExplicitCapability(
              identityId,
              accessPolicy.capabilityId,
              controller.signal,
            );
        if (!cancelled) {
          setState(result.outcome === 'allowed' ? 'allowed' : result.outcome === 'denied' ? 'denied' : 'error');
        }
      } catch (error: unknown) {
        if (cancelled) {
          return;
        }
        if (error instanceof Error && error.message === 'session_expired') {
          expireSession();
          setState('session_expired');
          return;
        }
        setState('error');
      }
    }

    void resolveAccess();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [accessPolicy.accessCheck, expireSession, identityId, location.pathname, retryNonce]);

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
