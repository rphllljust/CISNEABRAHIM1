import { useMemo } from 'react';
import type { BillingCapabilities } from '../types/billing.types';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo descobria permissão disparando POST num documento de faturamento com UUID
 * sintético e interpretava a resposta como autorização. Isso gerava BILLING_* reais em produção
 * a cada montagem da tela, sem representar tentativa do operador — e abria GET de PDF para
 * inferir `canDownloadDocument`. `/me` já publica os grants efetivos da sessão; a UI apenas
 * projeta esse contrato. O backend continua sendo a barreira autoritativa.
 */
const DEFAULT_CAPABILITIES: BillingCapabilities = {
  canRead: false,
  canPrepare: false,
  canVoid: false,
  canIssueDocument: false,
  canReadDocument: false,
  canDownloadDocument: false,
};

export function useBillingCapabilities(): { capabilities: BillingCapabilities; loading: boolean } {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<BillingCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return DEFAULT_CAPABILITIES;
    }
    return {
      canRead: session.can('billing:billing-record:read'),
      canPrepare: session.can('billing:billing-record:prepare'),
      canVoid: session.can('billing:billing-record:void'),
      canIssueDocument: session.can('billing:billing-document:issue'),
      canReadDocument: session.can('billing:billing-document:read'),
      canDownloadDocument: session.can('billing:billing-document:download'),
    };
  }, [authStatus, session]);

  return {
    capabilities,
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (session.status === 'idle' || session.status === 'loading')),
  };
}
