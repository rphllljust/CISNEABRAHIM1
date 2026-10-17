import { useMemo } from 'react';
import type { CatalogCapabilities } from '../api/service-catalog-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

const EMPTY_CAPABILITIES: CatalogCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canPublish: false,
  canDeactivate: false,
  canActivate: false,
};

export function useCatalogCapabilities() {
  const { status: authStatus } = useAuth();
  const sessionMeta = useSessionMeta();

  const capabilities = useMemo<CatalogCapabilities>(() => {
    if (authStatus !== 'authenticated' || sessionMeta.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: sessionMeta.can('catalog:service:list'),
      canCreate: sessionMeta.can('catalog:service:create'),
      canRead: sessionMeta.can('catalog:service:read'),
      canUpdate: sessionMeta.can('catalog:service:update'),
      canPublish: sessionMeta.can('catalog:service:publish'),
      canDeactivate: sessionMeta.can('catalog:service:deactivate'),
      canActivate: sessionMeta.can('catalog:service:activate'),
    };
  }, [authStatus, sessionMeta]);

  return {
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (sessionMeta.status === 'idle' || sessionMeta.status === 'loading')),
    capabilities,
    error: authStatus === 'authenticated' && sessionMeta.status === 'error',
  };
}
