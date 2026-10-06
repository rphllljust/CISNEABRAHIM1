/**
 * BUSINESS CONTEXT BUS — PROVIDER E HOOKS
 *
 * Um unico provider montado no shell publica o foco; qualquer modulo le e reage. Nenhum modulo
 * precisa conhecer os outros, que e exatamente o que o relatorio pede na Pagina 12 ("publicado uma
 * vez e consumido por varios widgets ou aplicacoes").
 *
 * ---------------------------------------------------------------------------------------------
 * POR QUE O HISTORICO EXISTE (e nao e so um array de vaidade)
 * ---------------------------------------------------------------------------------------------
 *
 * `history` guarda os focos anteriores. Ele sustenta a promessa concreta do modulo — "sem navegar
 * por 5 modulos" — em dois pontos:
 *
 *   1. VOLTAR AO FOCO ANTERIOR. O operador salta Cliente -> Recebiveis -> OS e precisa retornar ao
 *      cliente. Sem historico, voltar significa refazer a busca.
 *   2. PROVA DE QUE O CONTEXTO ATRAVESSOU FRONTEIRA. Um consumidor pode reportar "este modulo ja
 *      respondeu para 3 focos sem recarregar a pagina", que e a evidencia do ganho.
 *
 * O limite de profundidade e deliberado: historico ilimitado em sessao longa vira vazamento de
 * memoria e, pior, um "voltar" que leva a um objeto que o operador nem lembra ter aberto.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  focusKey,
  type BusinessContextConsumerReport,
  type BusinessContextConsumerState,
  type BusinessContextEntity,
  type BusinessContextFocus,
  type BusinessContextValue,
} from './types';

/** Profundidade maxima do historico de foco. */
export const MAX_FOCUS_HISTORY = 12;

export type BusinessContextBus = BusinessContextValue & {
  /** Publica um novo foco. Substitui o anterior. */
  publish: (focus: BusinessContextFocus, publisherId?: string) => void;
  /** Limpa o foco. Estado legitimo: o operador saiu da visao 360. */
  clear: (publisherId?: string) => void;
  /** Volta ao foco anterior. `false` = nao ha historico. */
  back: () => boolean;
  /** Foco em foco com uma entidade especifica? */
  isFocused: (entity: BusinessContextEntity, id?: string) => boolean;
  /** Estado reportado pelos consumidores, por id. */
  reports: Record<string, BusinessContextConsumerReport>;
  /** Publica (ou remove) o estado de um consumidor. */
  reportConsumer: (report: BusinessContextConsumerReport | null, consumerId: string) => void;
};

const NOOP_BUS: BusinessContextBus = {
  focus: null,
  publishedBy: null,
  publishedAt: null,
  history: [],
  publish: () => undefined,
  clear: () => undefined,
  back: () => false,
  isFocused: () => false,
  reports: {},
  reportConsumer: () => undefined,
};

const BusinessContextBusContext = createContext<BusinessContextBus>(NOOP_BUS);

/**
 * O provider do bus.
 *
 * O default do contexto e um NOOP funcional, e nao `undefined` com erro no hook. Motivo: um widget
 * de contexto pode ser renderizado fora do shell (página de erro, storybook, teste de unidade de
 * um modulo isolado). Lancar ali transformaria "contexto nao montado" em tela branca — o oposto do
 * que um barramento de contexto deve fazer quando ninguem publicou nada. O modo degradado e
 * simplesmente "sem foco", que e um estado que toda tela ja sabe exibir.
 */
export function BusinessContextProvider({
  children,
  initialFocus = null,
}: {
  children: ReactNode;
  initialFocus?: BusinessContextFocus | null;
}) {
  const [value, setValue] = useState<BusinessContextValue>({
    focus: initialFocus,
    publishedBy: null,
    publishedAt: null,
    history: [],
  });
  const [reports, setReports] = useState<Record<string, BusinessContextConsumerReport>>({});

  const publish = useCallback((focus: BusinessContextFocus, publisherId = 'unknown') => {
    setValue((current) => {
      // Republicar o MESMO foco nao deve inflar o historico: o efeito de montagem de uma pagina
      // publica de novo o que ja estava em foco, e o historico encheria de repeticoes.
      if (focusKey(current.focus) === focusKey(focus)) {
        return current;
      }
      const history = current.focus
        ? [current.focus, ...current.history].slice(0, MAX_FOCUS_HISTORY)
        : current.history;
      return {
        focus,
        publishedBy: publisherId,
        publishedAt: new Date().toISOString(),
        history,
      };
    });
  }, []);

  const clear = useCallback((publisherId = 'unknown') => {
    setValue((current) => {
      if (!current.focus) {
        return current;
      }
      return {
        focus: null,
        publishedBy: publisherId,
        publishedAt: new Date().toISOString(),
        history: [current.focus, ...current.history].slice(0, MAX_FOCUS_HISTORY),
      };
    });
  }, []);

  const back = useCallback((): boolean => {
    let moved = false;
    setValue((current) => {
      const [previous, ...rest] = current.history;
      if (!previous) {
        return current;
      }
      moved = true;
      return {
        focus: previous,
        publishedBy: 'history',
        publishedAt: new Date().toISOString(),
        history: rest,
      };
    });
    return moved;
  }, []);

  const isFocused = useCallback(
    (entity: BusinessContextEntity, id?: string) =>
      value.focus?.entity === entity && (id === undefined || value.focus.id === id),
    [value.focus],
  );

  const reportConsumer = useCallback(
    (report: BusinessContextConsumerReport | null, consumerId: string) => {
      setReports((current) => {
        if (!report) {
          if (!(consumerId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[consumerId];
          return next;
        }
        const existing = current[consumerId];
        // Evita re-render em loop quando o consumidor reporta o mesmo estado a cada render.
        if (
          existing &&
          existing.state === report.state &&
          existing.count === report.count &&
          existing.hint === report.hint &&
          existing.to === report.to &&
          existing.label === report.label
        ) {
          return current;
        }
        return { ...current, [consumerId]: report };
      });
    },
    [],
  );

  const bus = useMemo<BusinessContextBus>(
    () => ({ ...value, publish, clear, back, isFocused, reports, reportConsumer }),
    [value, publish, clear, back, isFocused, reports, reportConsumer],
  );

  return (
    <BusinessContextBusContext.Provider value={bus}>
      {children}
    </BusinessContextBusContext.Provider>
  );
}

/** Le o bus completo. */
export function useBusinessContext(): BusinessContextBus {
  return useContext(BusinessContextBusContext);
}

/** Le apenas o foco atual. */
export function useBusinessContextFocus(): BusinessContextFocus | null {
  return useContext(BusinessContextBusContext).focus;
}

/**
 * PUBLICA o foco enquanto o componente estiver montado.
 *
 * LIMPA AO DESMONTAR, e isso e essencial: sem a limpeza, sair da visao 360 do cliente X deixaria X
 * em foco, e a proxima tela abriria recortada por um objeto que o operador nao escolheu. Contexto
 * que sobrevive a sua origem e contexto FANTASMA.
 *
 * Dependencias por VALOR (`entity`, `id`, `label`), nunca pelo objeto `focus`: um literal de objeto
 * recriado a cada render republicaria eternamente.
 */
export function usePublishBusinessContext(
  focus: BusinessContextFocus | null,
  publisherId: string,
): void {
  const bus = useContext(BusinessContextBusContext);
  const { publish, clear } = bus;
  const hasFocus = focus !== null;
  const entity = focus?.entity;
  const id = focus?.id;
  const label = focus?.label;
  const unitId = focus?.unitId;
  const attributes = focus?.attributes;

  useEffect(() => {
    if (!hasFocus || !entity || !id) {
      return;
    }
    publish({ entity, id, label: label ?? '', ...(unitId ? { unitId } : {}), ...(attributes ? { attributes } : {}) }, publisherId);
    return () => {
      clear(publisherId);
    };
  }, [publish, clear, hasFocus, entity, id, label, unitId, attributes, publisherId]);
}

/**
 * CONSOME o foco: chama `onFocus` sempre que o objeto em foco mudar.
 *
 * `entities` filtra os focos que este consumidor sabe interpretar. Sem o filtro, todo modulo
 * reagiria a todo foco, e um widget de recebiveis entraria em `loading` para um periodo contabil.
 *
 * O CALLBACK VEM EM REF. Se entrasse nas dependencias, um callback inline no pai (o caso comum)
 * reiniciaria o efeito a cada render — e a consulta do modulo dispararia em loop.
 */
export function useBusinessContextConsumer(
  consumerId: string,
  label: string,
  entities: BusinessContextEntity[] | undefined,
  onFocus: (focus: BusinessContextFocus) => void | Promise<void>,
): BusinessContextFocus | null {
  const bus = useContext(BusinessContextBusContext);
  const focus = bus.focus;
  const { reportConsumer } = bus;

  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  const entityKey = entities ? [...entities].sort().join(',') : '*';
  const key = focusKey(focus);

  useEffect(() => {
    if (!focus) {
      reportConsumer(null, consumerId);
      return;
    }
    if (entities && !entities.includes(focus.entity)) {
      // O modulo NAO acompanha esta entidade. `idle` e a verdade: ele nao esta vazio, esta fora.
      reportConsumer({ consumerId, label, state: 'idle' }, consumerId);
      return;
    }
    reportConsumer({ consumerId, label, state: 'loading' }, consumerId);
    let cancelled = false;
    void Promise.resolve(onFocusRef.current(focus)).catch(() => {
      if (!cancelled) {
        reportConsumer(
          {
            consumerId,
            label,
            state: 'denied',
            hint: 'Não foi possível consultar este módulo para o objeto em foco.',
          },
          consumerId,
        );
      }
    });
    return () => {
      cancelled = true;
    };
  }, [key, entityKey, consumerId, label, reportConsumer]);

  return focus && (!entities || entities.includes(focus.entity)) ? focus : null;
}

/** Relatorio de um consumidor para o cabecalho do contexto. */
export function useContextConsumerReport(
  consumerId: string,
): BusinessContextConsumerReport | undefined {
  return useContext(BusinessContextBusContext).reports[consumerId];
}

/**
 * Registra um consumidor DECLARATIVO, sem consulta.
 *
 * Serve para modulos que ja carregaram o proprio dado e so precisam DECLARAR o resultado
 * (`matched`/`empty`/`denied`) para a visao 360. Separado de `useBusinessContextConsumer` porque
 * aquele dispara busca; este apenas reporta um fato ja conhecido.
 */
export function useDeclareContextConsumer(
  report: BusinessContextConsumerReport | null,
): void {
  const { reportConsumer } = useContext(BusinessContextBusContext);
  const consumerId = report?.consumerId;
  const state = report?.state;
  const count = report?.count;
  const hint = report?.hint;
  const to = report?.to;
  const label = report?.label;

  useEffect(() => {
    if (!consumerId || !label || !state) {
      return;
    }
    reportConsumer(
      { consumerId, label, state, count: count ?? null, ...(hint ? { hint } : {}), ...(to ? { to } : {}) },
      consumerId,
    );
    return () => {
      reportConsumer(null, consumerId);
    };
  }, [consumerId, label, state, count, hint, to, reportConsumer]);
}

export type { BusinessContextConsumerState, BusinessContextConsumerReport };
