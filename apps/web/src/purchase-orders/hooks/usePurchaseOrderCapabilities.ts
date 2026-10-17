import { useMemo } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';
import type { PurchaseOrderCapabilities } from '../api/purchase-orders-api';

const EMPTY_CAPABILITIES: PurchaseOrderCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canRegister: false,
  canCancel: false,
};

export function usePurchaseOrderCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<PurchaseOrderCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('commercial:purchase-order:list'),
      canCreate: session.can('commercial:purchase-order:create'),
      canRead: session.can('commercial:purchase-order:read'),
      canUpdate: session.can('commercial:purchase-order:update'),
      canRegister: session.can('commercial:purchase-order:register'),
      canCancel: session.can('commercial:purchase-order:cancel'),
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
