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

  /*
   * LOOP DE PROBE (P0) — a sonda de acesso disparava a cada render.
   *
   * `accessPolicy` e um elemento de `ACCOUNTING_ACCESS`, mas o objeto em si e recriado a cada
   * render do modulo. Como ele estava na lista de dependencias, cada `setState` produzia uma
   * referencia nova, o efeito rodava de novo e a tela ficava chamando
   * `/accounting/charts/<id>` em ciclo — sem nunca estabilizar. O 404 e a resposta CORRETA do
   * probe (recurso inexistente com leitura autorizada), mas repetido dezenas de vezes por
   * segundo polui o console e martela a API.
   *
   * Depender dos VALORES usados dentro do efeito (`access`, `expireSession`, rota) mantem a
   * semantica — revalidar ao trocar de rota e ao expirar sessao — sem o ciclo.
   */
  const { probe, capabilityId } = accessPolicy;

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void probe(controller.signal)
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
  }, [probe, expireSession, location.pathname]);

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
        state={{ from: location.pathname, capabilityId }}
      />
    );
  }
  return children;
}
