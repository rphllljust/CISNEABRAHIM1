import { useMemo } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';
import type { ContractCapabilities } from '../api/contracts-api';

const EMPTY_CAPABILITIES: ContractCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canActivate: false,
  canClose: false,
  canExpire: false,
};

export function useContractCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<ContractCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('commercial:contract:list'),
      canCreate: session.can('commercial:contract:create'),
      canRead: session.can('commercial:contract:read'),
      canUpdate: session.can('commercial:contract:update'),
      canActivate: session.can('commercial:contract:activate'),
      canClose: session.can('commercial:contract:close'),
      canExpire: session.can('commercial:contract:expire'),
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
