import { useMemo } from 'react';
import type { PersonCapabilities } from '../api/people-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../../service-orders/context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo disparava POST/PATCH/activate/deactivate contra um UUID sintético a cada montagem
 * da tela. Isso gerava PERSON_VALIDATION_FAILED e PERSON_NOT_FOUND reais em produção sem
 * representar tentativa do operador, e tratava 400/404 como "tem permissão". `/me` já publica os
 * grants efetivos da sessão; a UI apenas projeta esse contrato. O backend continua autoritativo.
 */
const EMPTY_CAPABILITIES: PersonCapabilities = {
  canList: false,
  canCreate: false,
  canRead: false,
  canUpdate: false,
  canDeactivate: false,
  canActivate: false,
};

export function usePersonCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<PersonCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY_CAPABILITIES;
    }
    return {
      canList: session.can('people:person:list'),
      canCreate: session.can('people:person:create'),
      canRead: session.can('people:person:read'),
      canUpdate: session.can('people:person:update'),
      canDeactivate: session.can('people:person:deactivate'),
      canActivate: session.can('people:person:activate'),
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
