import { useMemo } from 'react';
import type { CatalogCapabilities } from '../api/service-catalog-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo inferia autorização enviando POST/PATCH inválidos contra o catálogo e
 * interpretava 400/404 como "tem permissão". Isso gerava CATALOG_VALIDATION_FAILED real em
 * produção sem representar uma tentativa de criação. /me já é a fonte autoritativa dos grants
 * efetivos da sessão; a UI apenas projeta esse contrato. O backend continua revalidando cada ação.
 */
const EMPTY_CAPABILITIES: CatalogCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canPublish: false,
  canDeactivate: false,
  canActivate: false,
};

export function catalogCapabilitiesFromPermissions(
  can: (permission: string) => boolean,
): CatalogCapabilities {
  return {
    canList: can('catalog:service:list'),
    canCreate: can('catalog:service:create'),
    canRead: can('catalog:service:read'),
    canUpdate: can('catalog:service:update'),
    canPublish: can('catalog:service:publish'),
    canDeactivate: can('catalog:service:deactivate'),
    canActivate: can('catalog:service:activate'),
  };
}

export function useCatalogCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<CatalogCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return catalogCapabilitiesFromPermissions(session.can);
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
