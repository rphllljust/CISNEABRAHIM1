import { useMemo } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';
import type { ClientCapabilities } from '../api/clients-api';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * Antes este hook descobria permissão disparando POST/PATCH contra payload inválido e UUID
 * sintético. Isso poluía produção e tratava 400/404 como "tem permissão". O backend já publica os
 * grants efetivos uma vez por sessão; a UI apenas projeta esse contrato. O servidor continua sendo
 * a barreira autoritativa e revalida cada comando com escopo.
 */
const EMPTY_CAPABILITIES: ClientCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDeactivate: false,
  canActivate: false,
  canManageContacts: false,
  canManageUnits: false,
  canManageHierarchy: false,
  canReadAudit: false,
};

export function useClientCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<ClientCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('client:client:list'),
      canCreate: session.can('client:client:create'),
      canRead: session.can('client:client:read'),
      canUpdate: session.can('client:client:update'),
      canDeactivate: session.can('client:client:deactivate'),
      canActivate: session.can('client:client:activate'),
      canManageContacts: session.can('client:contact:manage'),
      canManageUnits: session.can('client:unit:manage'),
      canManageHierarchy: session.can('client:hierarchy:manage'),
      canReadAudit: session.can('client:audit:read'),
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
