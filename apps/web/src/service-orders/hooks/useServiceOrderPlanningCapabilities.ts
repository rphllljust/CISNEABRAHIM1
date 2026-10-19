import { useMemo } from 'react';
import type { ServiceOrderPlanningCapabilities } from '../api/service-orders-api';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo disparava POST/PATCH/remove em planned-resources e allocations com IDs sintéticos
 * a cada montagem da tela. Isso gerava falhas reais em produção sem tentativa do operador, e
 * tratava 400/404 como "tem permissão". `/me` já publica os grants efetivos da sessão; a UI
 * apenas projeta esse contrato. O backend continua sendo a barreira autoritativa.
 */
const EMPTY: ServiceOrderPlanningCapabilities = {
  canRead: false,
  canPlan: false,
  canUpdatePlan: false,
  canRemovePlan: false,
  canAllocate: false,
  canReallocate: false,
  canRemoveAllocation: false,
  canListAllocations: false,
};

export function useServiceOrderPlanningCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<ServiceOrderPlanningCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return EMPTY;
    }
    return {
      canRead:
        session.can('service-orders:planned-resource:read') ||
        session.can('service-orders:resource-allocation:read'),
      canPlan: session.can('service-orders:planned-resource:plan'),
      canUpdatePlan: session.can('service-orders:planned-resource:update'),
      canRemovePlan: session.can('service-orders:planned-resource:remove'),
      canAllocate: session.can('service-orders:resource-allocation:allocate'),
      canReallocate: session.can('service-orders:resource-allocation:reallocate'),
      canRemoveAllocation: session.can('service-orders:resource-allocation:remove'),
      canListAllocations: session.can('service-orders:resource-allocation:read'),
    };
  }, [authStatus, session]);

  return {
    loading:
      authStatus === 'loading' ||
      (authStatus === 'authenticated' &&
        (session.status === 'idle' || session.status === 'loading')),
    capabilities,
  };
}
