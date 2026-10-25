/**
 * HOOKS DA CAPABILITY MEDIÇÃO → ACEITE → FATURAMENTO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * SERVER STATE vs LOCAL UI STATE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * SERVER STATE (vem do backend, nunca é editado localmente):
 *
 *   workbench       read model da estação de trabalho
 *   queue           fila de trabalho da unidade
 *   leakage         lacuna de receita por estágio
 *
 * LOCAL UI STATE (vive só na tela):
 *
 *   item selecionado na fila, diálogo aberto, aba, densidade, rascunho de filtro
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NÃO MUTAR O READ MODEL DEPOIS DO COMANDO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A tentação é, depois de um comando bem-sucedido, "ajustar" campos no objeto em
 * memória — aplicar o novo status, recalcular a elegibilidade, habilitar o
 * próximo botão. Isso é SIMULAR O BACKEND: dezesseis campos derivados passariam a
 * vir de duas fontes e divergiriam na primeira regra nova.
 *
 * O comando devolve o read model INTEIRO, já recomposto pelo backend — com a
 * elegibilidade REAVALIADA na mesma transação. A tela troca o objeto e não
 * toca em campo nenhum.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  MeasurementApiError,
  getMeasurementWorkbench,
  getMeasurementWorkQueue,
  getRevenueLeakage,
  recordCustomerAcceptance,
} from '../api/measurement-workbench-api';
import type {
  MeasurementWorkbenchReadModel,
  MeasurementWorkQueueReadModel,
  RecordAcceptancePayload,
  RevenueLeakageReadModel,
} from '../types/measurement-workbench.types';

/** Estado de UMA leitura: carga inicial, recarga e erro são distintos. */
export type QueryState<T> =
  | { readonly phase: 'loading' }
  | { readonly phase: 'ready'; readonly data: T }
  | { readonly phase: 'denied' }
  | { readonly phase: 'not_found' }
  | { readonly phase: 'error'; readonly message: string };

/**
 * Classifica o erro em ESTADO, não em texto.
 *
 * `denied` e `not_found` são estados de negócio: a tela mostra "sem acesso" e
 * "não encontrado", não "algo deu errado". Um 403 apresentado como falha técnica
 * faria o operador abrir chamado de infraestrutura para uma questão de
 * permissão.
 */
function toQueryState<T>(error: unknown): QueryState<T> {
  if (error instanceof MeasurementApiError) {
    if (error.kind === 'denied') {
      return { phase: 'denied' };
    }
    if (error.kind === 'not_found') {
      return { phase: 'not_found' };
    }
    return { phase: 'error', message: error.code ?? 'Falha ao carregar a medição.' };
  }
  return { phase: 'error', message: 'Falha ao carregar a medição.' };
}

/**
 * WORKBENCH de uma ordem.
 *
 * `refresh` recarrega SEM derrubar a tela para `loading`: o operador continua
 * vendo o caso que estava lendo enquanto o backend recompõe. Recarregar trocando
 * para esqueleto apagaria a decisão em curso.
 */
export function useMeasurementWorkbench(serviceOrderId: string) {
  const [state, setState] = useState<QueryState<MeasurementWorkbenchReadModel>>({
    phase: 'loading',
  });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const seq = ++requestSeq.current;
      if (mode === 'refresh') {
        setRefreshing(true);
      }
      try {
        const data = await getMeasurementWorkbench(serviceOrderId);
        if (seq === requestSeq.current) {
          setState({ phase: 'ready', data });
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          // Uma recarga que falha MANTÉM o dado anterior quando já havia dado:
          // perder o caso lido por uma falha de rede é pior que mostrá-lo com
          // aviso de desatualizado.
          setState((previous) =>
            previous.phase === 'ready' && mode === 'refresh' ? previous : toQueryState(error),
          );
        }
      } finally {
        if (seq === requestSeq.current) {
          setRefreshing(false);
        }
      }
    },
    [serviceOrderId],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  /** Substitui o read model por um já recomposto pelo backend (resultado de comando). */
  const replace = useCallback((data: MeasurementWorkbenchReadModel) => {
    setState({ phase: 'ready', data });
  }, []);

  return { state, refreshing, refresh, replace };
}

/** FILA DE TRABALHO da unidade. */
export function useMeasurementQueue(unitId: string, options: { limit?: number } = {}) {
  const [state, setState] = useState<QueryState<MeasurementWorkQueueReadModel>>({
    phase: 'loading',
  });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const seq = ++requestSeq.current;
      if (mode === 'refresh') {
        setRefreshing(true);
      }
      try {
        const data = await getMeasurementWorkQueue(unitId, { limit: options.limit });
        if (seq === requestSeq.current) {
          setState({ phase: 'ready', data });
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          setState((previous) =>
            previous.phase === 'ready' && mode === 'refresh' ? previous : toQueryState(error),
          );
        }
      } finally {
        if (seq === requestSeq.current) {
          setRefreshing(false);
        }
      }
    },
    [unitId, options.limit],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  return { state, refreshing, refresh };
}

/** LACUNA DE RECEITA por estágio. */
export function useRevenueLeakage(unitId: string, options: { limit?: number } = {}) {
  const [state, setState] = useState<QueryState<RevenueLeakageReadModel>>({ phase: 'loading' });
  const [refreshing, setRefreshing] = useState(false);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (mode: 'initial' | 'refresh') => {
      const seq = ++requestSeq.current;
      if (mode === 'refresh') {
        setRefreshing(true);
      }
      try {
        const data = await getRevenueLeakage(unitId, { limit: options.limit });
        if (seq === requestSeq.current) {
          setState({ phase: 'ready', data });
        }
      } catch (error) {
        if (seq === requestSeq.current) {
          setState((previous) =>
            previous.phase === 'ready' && mode === 'refresh' ? previous : toQueryState(error),
          );
        }
      } finally {
        if (seq === requestSeq.current) {
          setRefreshing(false);
        }
      }
    },
    [unitId, options.limit],
  );

  useEffect(() => {
    void load('initial');
  }, [load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  return { state, refreshing, refresh };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMANDO
// ═══════════════════════════════════════════════════════════════════════════════

export type CommandOutcome =
  | { readonly kind: 'success'; readonly data: MeasurementWorkbenchReadModel }
  | { readonly kind: 'conflict'; readonly message: string }
  | { readonly kind: 'business'; readonly code: string; readonly message: string }
  | { readonly kind: 'denied' }
  | { readonly kind: 'error'; readonly message: string };

/**
 * Executa um comando de medição e devolve o DESFECHO CLASSIFICADO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A CHAVE DE IDEMPOTÊNCIA É DO CHAMADOR
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A chave identifica o COMANDO, não o clique. Se este hook gerasse uma chave
 * nova a cada tentativa, um retry depois de timeout criaria uma SEGUNDA
 * decisão — e o backend, corretamente, aplicaria as duas.
 *
 * O chamador cria a chave quando ABRE o diálogo e a mantém enquanto o mesmo
 * comando lógico estiver em curso. Reabrir o diálogo gera outra chave, porque
 * então é outra decisão.
 */
export function useMeasurementCommand() {
  const [submitting, setSubmitting] = useState(false);

  const runRecordAcceptance = useCallback(
    async (
      serviceOrderId: string,
      measurementId: string,
      payload: RecordAcceptancePayload,
    ): Promise<CommandOutcome> => {
      setSubmitting(true);
      try {
        const data = await recordCustomerAcceptance(serviceOrderId, measurementId, payload);
        return { kind: 'success', data };
      } catch (error) {
        if (error instanceof MeasurementApiError) {
          if (error.kind === 'version_conflict') {
            return {
              kind: 'conflict',
              message: error.code ?? 'MEASUREMENTS_VERSION_CONFLICT',
            };
          }
          if (error.kind === 'denied') {
            return { kind: 'denied' };
          }
          if (error.kind === 'invalid_state' || error.kind === 'validation') {
            // Regra de negócio: o código É o motivo, e a tela o mostra.
            return {
              kind: 'business',
              code: error.code ?? 'MEASUREMENTS_INVALID_STATE',
              message: error.code ?? 'Operação não permitida neste estado.',
            };
          }
          return { kind: 'error', message: error.code ?? 'Falha ao executar o comando.' };
        }
        return { kind: 'error', message: 'Falha ao executar o comando.' };
      } finally {
        setSubmitting(false);
      }
    },
    [],
  );

  return { submitting, runRecordAcceptance };
}
