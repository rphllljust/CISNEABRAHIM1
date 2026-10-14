import { useEffect, useState } from 'react';
import {
  ClientsApiError,
  getClientDataQuality,
  getClientFinancialContext,
} from '../api/clients-api';
import type { ClientDataQuality, ClientFinancialContext } from '../types/client.types';

/**
 * CONTEXTO AMPLIADO DO CLIENTE SELECIONADO NA FILA.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE A QUALIDADE E O FINANCEIRO TÊM CARREGAMENTO PRÓPRIO
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A fila precisa abrir contexto RÁPIDO. Buscar qualidade e financeiro para as 20 linhas da página
 * seria N+1 no caminho de leitura mais usado do módulo — e o dado só é necessário para o registro
 * que o operador de fato abriu.
 *
 * Este hook busca os dois SOMENTE quando há um Cliente selecionado, e cada um resolve de forma
 * independente: a falha do financeiro (ex.: 403 por falta de concessão) NÃO impede a qualidade de
 * aparecer, e vice-versa. Uma seção indisponível não pode derrubar o contexto inteiro.
 *
 * NENHUM DOS DOIS É OBRIGATÓRIO. `null` significa "não carregado / não autorizado", e as seções
 * que os consomem sabem declarar essa diferença — elas não imprimem zero no lugar da ausência.
 */

export type ClientContextPhase = 'idle' | 'loading' | 'ready' | 'denied' | 'error';

export type ClientExtendedContext = {
  quality: ClientDataQuality | null;
  qualityPhase: ClientContextPhase;
  financial: ClientFinancialContext | null;
  financialPhase: ClientContextPhase;
};

const IDLE: ClientExtendedContext = {
  quality: null,
  qualityPhase: 'idle',
  financial: null,
  financialPhase: 'idle',
};

/**
 * Classifica o erro de cada leitura.
 *
 * `denied` é tratado SEPARADAMENTE de `error` porque significam coisas diferentes para o operador:
 * negação é uma restrição de acesso permanente (não adianta tentar de novo), falha é temporária.
 * Colapsar os dois faria a UI oferecer "tentar novamente" para algo que nunca vai passar.
 */
function classifyPhase(error: unknown): ClientContextPhase {
  if (error instanceof ClientsApiError && error.kind === 'denied') {
    return 'denied';
  }
  return 'error';
}

export function useClientExtendedContext(clientId: string | null): ClientExtendedContext {
  const [state, setState] = useState<ClientExtendedContext>(IDLE);

  useEffect(() => {
    if (!clientId) {
      setState(IDLE);
      return;
    }

    const controller = new AbortController();
    let active = true;
    setState({
      quality: null,
      qualityPhase: 'loading',
      financial: null,
      financialPhase: 'loading',
    });

    /*
     * DUAS LEITURAS INDEPENDENTES, CADA UMA COM O SEU PRÓPRIO DESFECHO.
     *
     * `Promise.allSettled` e não `Promise.all`: com `all`, uma negação financeira descartaria
     * também o resultado da qualidade, que chegou bem. O operador perderia informação disponível
     * por causa de uma restrição que não tem nada a ver com ela.
     */
    void Promise.allSettled([
      getClientDataQuality(clientId, controller.signal),
      getClientFinancialContext(clientId, controller.signal),
    ]).then(([qualityResult, financialResult]) => {
      if (!active || controller.signal.aborted) {
        return;
      }
      setState({
        quality: qualityResult.status === 'fulfilled' ? qualityResult.value : null,
        qualityPhase:
          qualityResult.status === 'fulfilled' ? 'ready' : classifyPhase(qualityResult.reason),
        financial: financialResult.status === 'fulfilled' ? financialResult.value : null,
        financialPhase:
          financialResult.status === 'fulfilled'
            ? 'ready'
            : classifyPhase(financialResult.reason),
      });
    });

    return () => {
      active = false;
      controller.abort();
    };
  }, [clientId]);

  return state;
}
