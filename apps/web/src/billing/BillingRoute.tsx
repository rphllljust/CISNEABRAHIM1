import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/context/AuthProvider';
import { useSessionMeta } from '../service-orders/context/SessionMetaProvider';

type BillingRouteProps = {
  children: ReactNode;
};

/**
 * GUARDA DE ROTA DO FATURAMENTO — projeção do grant publicado por `/me`.
 *
 * Antes esta guarda disparava POST num documento de faturamento com UUID sintético para decidir
 * se o operador podia entrar na tela. Isso mutava o backend na simples navegação e ainda podia
 * negar acesso a quem tinha a permissão (`canRead` dependia do resultado da sonda). A sessão já
 * publica `billing:billing-record:read`; a guarda apenas projeta esse contrato.
 */
export function BillingRoute({ children }: BillingRouteProps) {
  const location = useLocation();
  const { status } = useAuth();
  const session = useSessionMeta();

  const loading =
    status === 'loading' || (status === 'authenticated' && session.status !== 'ready');

  if (status === 'unauthenticated') {
    return <Navigate to="/login" replace state={{ reason: 'session_expired', from: location.pathname }} />;
  }

  if (loading) {
    return (
      <div className="shell-loading" aria-busy="true" aria-live="polite">
        <p>Verificando acesso…</p>
      </div>
    );
  }

  if (!session.can('billing:billing-record:read')) {
    return (
      <Navigate
        to="/app/no-access"
        replace
        state={{ from: location.pathname, capabilityId: 'billing:billing-record:read' }}
      />
    );
  }

  return children;
}
