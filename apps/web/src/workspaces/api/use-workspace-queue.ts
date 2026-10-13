import { useCallback, useEffect, useState } from 'react';
import {
  WorkInboxApiError,
  getWorkInbox,
  type WorkInboxPage,
  type WorkItem,
} from '../../work-inbox/api/work-inbox-api';
import { workspaceQueueQuery, type WorkspaceQueueScope } from './workspace-queue-model';

/**
 * LEITURA DA FILA DE UM WORKSPACE — uma vez, para todas as superficies.
 *
 * O financeiro, os workspaces de dominio e a propria Central de trabalho leem o MESMO read model
 * (`GET /work-inbox`). O que cada um tem de proprio e o ESCOPO; o que todos tem de igual e o
 * CONTRATO DE HONESTIDADE da leitura:
 *
 *   - o recorte (`domain`, `kind`, `overdue`) e aplicado no SERVIDOR. O navegador nao filtra a
 *     pagina recebida: filtrar no cliente esconderia itens que ficaram fora da pagina e
 *     apresentaria uma amostra como se fosse o conjunto;
 *   - `total` e o numero do servidor sob o MESMO filtro — a pagina nunca e promovida a dominio;
 *   - falha de leitura NAO vira zero. `denied` e `error` sao estados proprios, com frase propria,
 *     e a fila nao e desenhada vazia por causa deles;
 *   - `unavailableDomains` e propagado inteiro: fila incompleta apresentada como completa e pior
 *     que um erro visivel.
 *
 * `reload` reexecuta a MESMA leitura, preservando recorte e selecao. `refreshKey` permite que o
 * chamador force uma releitura (troca de recorte) sem reescrever o efeito.
 */

export type WorkspaceQueueState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; page: WorkInboxPage; items: WorkItem[] };

function failureState(reason: unknown): { phase: 'denied' | 'error'; message: string } {
  if (reason instanceof WorkInboxApiError && reason.kind === 'denied') {
    return { phase: 'denied', message: 'Você não tem permissão para ler esta fila de trabalho.' };
  }
  if (reason instanceof WorkInboxApiError && reason.kind === 'network') {
    return {
      phase: 'error',
      message:
        'Não foi possível falar com o servidor. Esta fila é desconhecida nesta leitura — não é vazia.',
    };
  }
  return { phase: 'error', message: 'Não foi possível ler esta fila de trabalho.' };
}

export function useWorkspaceQueue({
  scope,
  limit,
  offset = 0,
}: {
  scope: WorkspaceQueueScope;
  limit: number;
  offset?: number;
}): { state: WorkspaceQueueState; reload: () => void } {
  const [state, setState] = useState<WorkspaceQueueState>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);

  /*
   * O ESCOPO ENTRA NO EFEITO PELOS SEUS VALORES, nunca pela identidade do objeto: um chamador que
   * recria o objeto a cada render — o caso normal quando o recorte vem dos parametros de URL —
   * dispararia leitura infinita se a identidade fosse a dependencia.
   */
  const { domain, kind, overdue, unitId } = scope;

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function load() {
      setState({ phase: 'loading' });
      try {
        const page = await getWorkInbox(
          workspaceQueueQuery({ domain, kind, overdue, unitId }, { limit, offset }),
          controller.signal,
        );
        if (active) {
          setState({ phase: 'ready', page, items: page.items });
        }
      } catch (error) {
        if (active && !controller.signal.aborted) {
          setState(failureState(error));
        }
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
    };
  }, [domain, kind, overdue, unitId, limit, offset, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { state, reload };
}
