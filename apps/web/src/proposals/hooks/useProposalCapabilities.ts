import { useMemo } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';
import type { ProposalCapabilities } from '../api/proposals-api';

const EMPTY_CAPABILITIES: ProposalCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canIssue: false,
  canAccept: false,
  canReject: false,
  canExpire: false,
  canCancel: false,
};

export function useProposalCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<ProposalCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('commercial:proposal:list'),
      canCreate: session.can('commercial:proposal:create'),
      canRead: session.can('commercial:proposal:read'),
      canUpdate: session.can('commercial:proposal:update'),
      canIssue: session.can('commercial:proposal:issue'),
      canAccept: session.can('commercial:proposal:accept'),
      canReject: session.can('commercial:proposal:reject'),
      canExpire: session.can('commercial:proposal:expire'),
      canCancel: session.can('commercial:proposal:cancel'),
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
