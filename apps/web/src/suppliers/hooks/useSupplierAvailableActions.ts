import { useCallback, useEffect, useState } from 'react';
import {
  fetchSupplierAvailableActions,
  SupplierMetaApiError,
} from '../api/supplier-meta-api';
import type {
  SupplierAvailableAction,
  SupplierAvailableActionsResponse,
} from '../types/supplier-meta.types';

export type SupplierAvailableActionsState = {
  data: SupplierAvailableActionsResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

/**
 * Comandos válidos de UM fornecedor, conforme o backend.
 *
 * Espelha `useAvailableActions` de service-orders, com a mesma assinatura e a mesma
 * semântica — inclusive o `refreshKey`, que recarrega quando o backend muda o estado do
 * registro (ativar, inativar, arquivar mudam os comandos válidos).
 */
export function useSupplierAvailableActions(
  supplierId: string | null,
  enabled: boolean,
  refreshKey?: string | number,
): SupplierAvailableActionsState & { reload: () => void } {
  const [state, setState] = useState<SupplierAvailableActionsState>({ data: null, status: 'idle' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!supplierId || !enabled) {
      setState({ data: null, status: 'idle' });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState({ data: null, status: 'loading' });

    void fetchSupplierAvailableActions(supplierId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setState({ data, status: 'ready' });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // 403 (fora de escopo) e 404 (inexistente) deixam a lista vazia: a UI não inventa
        // comandos que o backend negou.
        if (error instanceof SupplierMetaApiError) {
          setState({ data: null, status: 'error' });
          return;
        }
        setState({ data: null, status: 'error' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [supplierId, enabled, nonce, refreshKey]);

  return { ...state, reload };
}

/** Busca um comando pelo nome. `null` quando não é válido no status atual. */
export function findSupplierCommand(
  state: SupplierAvailableActionsState,
  command: string,
): SupplierAvailableAction | null {
  return state.data?.comandos_validos.find((entry) => entry.comando === command) ?? null;
}
