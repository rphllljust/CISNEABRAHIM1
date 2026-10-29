import { useEffect, useState } from 'react';
import {
  getServiceOrderCostEvidence,
  ServiceOrdersApiError,
  type ServiceOrderCostEvidence,
} from '../api/service-orders-api';

export type ServiceOrderCostEvidenceState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; data: ServiceOrderCostEvidence };

/**
 * Query state is separate from the enterprise Object Page presentation.
 * Denial and network failure cannot be represented as an empty cost ledger.
 */
export function useServiceOrderCostEvidence(serviceOrderId: string): {
  state: ServiceOrderCostEvidenceState;
  reload: () => void;
} {
  const [state, setState] = useState<ServiceOrderCostEvidenceState>({ phase: 'loading' });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void Promise.resolve()
      .then(() => getServiceOrderCostEvidence(serviceOrderId, controller.signal))
      .then((data) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', data });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
        } else {
          setState({ phase: 'error' });
        }
      });
    return () => controller.abort();
  }, [serviceOrderId, revision]);
  return { state, reload: () => setRevision((value) => value + 1) };
}
