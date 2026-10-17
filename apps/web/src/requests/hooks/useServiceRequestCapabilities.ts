import { useMemo } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';
import type { ServiceRequestCapabilities } from '../api/service-requests-api';

const EMPTY_CAPABILITIES: ServiceRequestCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canSubmit: false,
  canReview: false,
  canApprove: false,
  canReject: false,
  canCancel: false,
};

/**
 * Projeta os grants reais de GET /me para conveniência de UI.
 *
 * O hook antigo inferia autorização enviando mutações inválidas para um UUID sintético e
 * interpretava 400/404 como sucesso de capability. Isso não era uma leitura de permissão. /me já
 * expõe os grants efetivos; ações de um REGISTRO continuam governadas pelo readiness do detalhe,
 * que inclui estado + autorização + escopo para aquele objeto.
 */
export function useServiceRequestCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<ServiceRequestCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('requests:service-request:list'),
      canCreate: session.can('requests:service-request:create'),
      canRead: session.can('requests:service-request:read'),
      canUpdate: session.can('requests:service-request:update'),
      canSubmit: session.can('requests:service-request:submit'),
      canReview: session.can('requests:service-request:review'),
      canApprove: session.can('requests:service-request:approve'),
      canReject: session.can('requests:service-request:reject'),
      canCancel: session.can('requests:service-request:cancel'),
    };
  }, [authStatus, session]);

  return {
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (session.status === 'idle' || session.status === 'loading')),
    capabilities,
    error: authStatus === 'authenticated' && session.status === 'error',
  };
}
