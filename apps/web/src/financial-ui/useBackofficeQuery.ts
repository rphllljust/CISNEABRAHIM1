import { useCallback, useEffect, useRef, useState } from 'react';
import { BackofficeApiError } from './enterprise-api';

export type QueryState<T> =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean; kind: BackofficeApiError['kind'] }
  | { phase: 'ready'; data: T };

export function useBackofficeQuery<T>(options: {
  enabled?: boolean;
  loader: (signal?: AbortSignal) => Promise<T>;
  mapError: (code: string | undefined, status: number) => string;
  autoLoad?: boolean;
}): {
  state: QueryState<T>;
  reload: (signal?: AbortSignal) => Promise<void>;
  reset: () => void;
  setReady: (data: T) => void;
  /** Refresh em andamento com conteúdo antigo ainda na tela. */
  refreshing: boolean;
} {
  const { enabled = true, loader, mapError, autoLoad = true } = options;
  const [state, setState] = useState<QueryState<T>>(enabled && autoLoad ? { phase: 'loading' } : { phase: 'idle' });
  const [refreshing, setRefreshing] = useState(false);
  const loaderRef = useRef(loader);
  const mapErrorRef = useRef(mapError);
  loaderRef.current = loader;
  mapErrorRef.current = mapError;

  // Fluidez: quando já existe conteúdo, o refresh NÃO volta para `loading`.
  // Voltar para loading trocaria a tabela por um spinner de página inteira,
  // fazendo o layout pular e o filtro parecer resetado.
  const hasContentRef = useRef(false);
  hasContentRef.current = state.phase === 'ready';
  const stateRef = useRef(state);
  stateRef.current = state;

  const reload = useCallback(async (signal?: AbortSignal) => {
    const keepContent = stateRef.current.phase === 'ready';
    if (keepContent) {
      setRefreshing(true);
    } else {
      setState({ phase: 'loading' });
    }
    try {
      const data = await loaderRef.current(signal);
      setState({ phase: 'ready', data });
    } catch (error) {
      if (error instanceof BackofficeApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        setState({
          phase: 'error',
          message: mapErrorRef.current(error.code, error.status),
          retryable: error.kind === 'network' || error.kind === 'unknown',
          kind: error.kind,
        });
        return;
      }
      setState({
        phase: 'error',
        message: mapErrorRef.current(undefined, 0),
        retryable: true,
        kind: 'unknown',
      });
    } finally {
      setRefreshing(false);
    }
  }, []);

  const reset = useCallback(() => setState({ phase: 'idle' }), []);
  const setReady = useCallback((data: T) => setState({ phase: 'ready', data }), []);

  /*
   * RECARGA QUANDO A CONSULTA MUDA.
   *
   * `loader` é a identidade da consulta: quando a tela passa a pedir outro recorte
   * (filtro de status enviado ao servidor, paginação, escopo), o loader recebe uma
   * identidade nova. `reload` sozinho tem identidade ESTÁVEL de propósito, então
   * observá-lo não detecta nada — e o efeito abaixo nunca dispararia de novo: a tela
   * continuaria exibindo a página anterior com o filtro novo aplicado, mostrando
   * linhas que o servidor não devolveria para aquele recorte.
   *
   * Por isso o loader entra como dependência. Ele é `useCallback` nas telas; quem não
   * o memoizar provoca recarga a cada render, o mesmo comportamento que este hook já
   * tinha antes desta correção.
   */
  useEffect(() => {
    if (!enabled || !autoLoad) {
      return;
    }
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [autoLoad, enabled, loader, reload]);

  return { state, reload, reset, setReady, refreshing };
}
