import { useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import { probeSurfaceAccess, resolveAuthorizedUnit } from '../shell/surface-access';

type FinanceAccess =
  | 'overview'
  | 'receivables'
  | 'payables'
  | 'treasury'
  | 'reconciliation'
  | 'expenses'
  | 'budgets'
  | 'forecast';

const FINANCE_ACCESS: Record<
  FinanceAccess,
  {
    accessCheck: string;
    capabilityId: string;
    requiresUnit: boolean;
  }
> = {
  overview: {
    accessCheck: 'finance-overview',
    capabilityId: 'finance:receivable:list',
    requiresUnit: false,
  },
  receivables: {
    accessCheck: 'finance-receivable-list',
    capabilityId: 'finance:receivable:list',
    requiresUnit: false,
  },
  payables: {
    accessCheck: 'finance-payable-list',
    capabilityId: 'finance:payable:list',
    requiresUnit: false,
  },
  treasury: {
    accessCheck: 'finance-treasury-list',
    capabilityId: 'finance:treasury:list',
    requiresUnit: false,
  },
  reconciliation: {
    accessCheck: 'finance-reconciliation-read',
    capabilityId: 'finance:reconciliation:read',
    requiresUnit: false,
  },
  expenses: {
    accessCheck: 'finance-expense-read',
    capabilityId: 'finance:expense:list',
    requiresUnit: false,
  },
  budgets: {
    accessCheck: 'finance-budget-read',
    capabilityId: 'finance:budget:list',
    requiresUnit: false,
  },
  forecast: {
    accessCheck: 'finance-forecast-read',
    capabilityId: 'finance:cash-forecast:read',
    requiresUnit: true,
  },
};

type FinanceRouteProps = {
  children: ReactNode;
  access: FinanceAccess;
};

export function FinanceRoute({ children, access }: FinanceRouteProps) {
  const location = useLocation();
  const { expireSession, identityId } = useAuth();
  const [state, setState] = useState<'loading' | 'allowed' | 'denied' | 'session_expired'>('loading');
  const policy = FINANCE_ACCESS[access];

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
         * A rota usa a MESMA leitura de entrada declarada no shell.
         *
         * O guard antigo sondava detalhes com UUID sintético para despesas/orçamentos
         * e uma unidade sintética para previsão de caixa. Em produção isso podia gerar
         * 403 mesmo para FULL_ACCESS, fazendo a rota divergir do menu.
         */
        const unitId = policy.requiresUnit
          ? await resolveAuthorizedUnit(identityId, controller.signal)
          : '';

        if (cancelled) {
          return;
        }

        const result = await probeSurfaceAccess(
          policy.accessCheck,
          unitId,
          controller.signal,
        );

        if (!cancelled) {
          setState(result.outcome === 'allowed' ? 'allowed' : 'denied');
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
        setState('denied');
      }
    }

    void resolveAccess();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [
    expireSession,
    identityId,
    location.pathname,
    policy.accessCheck,
    policy.requiresUnit,
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
