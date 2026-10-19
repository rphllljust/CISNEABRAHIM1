import { useMemo } from 'react';
import type { MeasurementCapabilities } from '../types/measurement.types';
import { useAuth } from '../../auth/context/AuthProvider';
import { useSessionMeta } from '../context/SessionMetaProvider';

/**
 * CAPABILITIES DE UI — projeção dos grants efetivos já publicados por GET /me.
 *
 * O hook antigo disparava POST/regenerate/submit/start-review/approve/reject contra uma medição
 * com UUID sintético a cada montagem da tela. Isso gerava falhas reais em produção sem tentativa
 * do operador, e tratava 400/404 como "tem permissão". `/me` já publica os grants efetivos da
 * sessão; a UI apenas projeta esse contrato. O backend continua sendo a barreira autoritativa.
 */
const DEFAULT_CAPABILITIES: MeasurementCapabilities = {
  canRead: false,
  canCreate: false,
  canUpdate: false,
  canSubmit: false,
  canReview: false,
  canApprove: false,
  canReject: false,
};

export function useMeasurementCapabilities() {
  const { status: authStatus } = useAuth();
  const session = useSessionMeta();

  const capabilities = useMemo<MeasurementCapabilities>(() => {
    if (authStatus !== 'authenticated' || session.status !== 'ready') {
      return DEFAULT_CAPABILITIES;
    }
    return {
      canRead: session.can('measurements:measurement:read'),
      canCreate: session.can('measurements:measurement:create'),
      canUpdate: session.can('measurements:measurement:update'),
      canSubmit: session.can('measurements:measurement:submit'),
      canReview: session.can('measurements:measurement:review'),
      canApprove: session.can('measurements:measurement:approve'),
      canReject: session.can('measurements:measurement:reject'),
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
