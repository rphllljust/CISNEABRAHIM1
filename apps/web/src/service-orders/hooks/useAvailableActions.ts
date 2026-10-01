import { useCallback, useEffect, useState } from 'react';
import { fetchAvailableActions, ServiceOrderMetaApiError } from '../api/service-order-meta-api';
import type { AvailableAction, AvailableActionsResponse } from '../types/service-order-meta.types';

export type AvailableActionsState = {
  data: AvailableActionsResponse | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
};

/**
 * Comandos válidos de UMA OS, conforme o backend.
 *
 * Substitui a decisão local que existia no front (`resolveServiceOrderNextAction`, que
 * mantinha um mapa status→comando). Agora quem diz quais comandos existem é o backend;
 * o componente apenas renderiza o que recebeu.
 *
 * `usuario_tem_permissao` já vem resolvido pelo backend, então a UI não precisa cruzar
 * com o RBAC para decidir se desabilita o botão.
 */
export function useAvailableActions(
  serviceOrderId: string | null,
  enabled: boolean,
  /**
   * Gatilho de recarga. Quando o backend muda o estado do registro (prepare, release,
   * cancel, reopen), os comandos válidos mudam junto — passar o status atual aqui faz a
   * linha buscar o novo conjunto em vez de continuar exibindo o anterior.
   */
  refreshKey?: string | number,
): AvailableActionsState & { reload: () => void } {
  const [state, setState] = useState<AvailableActionsState>({ data: null, status: 'idle' });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!serviceOrderId || !enabled) {
      setState({ data: null, status: 'idle' });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState({ data: null, status: 'loading' });

    void fetchAvailableActions(serviceOrderId, controller.signal)
      .then((data) => {
        if (!cancelled) {
          setState({ data, status: 'ready' });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        // 403 (fora de escopo) e 404 (inexistente) deixam a lista de comandos vazia:
        // a UI não inventa ações que o backend negou.
        if (error instanceof ServiceOrderMetaApiError) {
          setState({ data: null, status: 'error' });
          return;
        }
        setState({ data: null, status: 'error' });
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [serviceOrderId, enabled, nonce, refreshKey]);

  return { ...state, reload };
}

/**
 * Busca um comando pelo nome na resposta do backend.
 * Devolve `null` quando o comando não é válido no status atual — a UI não deve
 * reimplementar essa checagem.
 */
export function findCommand(
  state: AvailableActionsState,
  command: string,
): AvailableAction | null {
  return state.data?.comandos_validos.find((entry) => entry.comando === command) ?? null;
}
