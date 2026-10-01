import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { fetchCommandCatalog, fetchMe } from '../api/service-order-meta-api';
import type {
  CommandCatalogEntry,
  CommandName,
  MeResponse,
  PermissionLabel,
} from '../types/service-order-meta.types';

/**
 * Sessão de metadados: identidade, permissões efetivas e catálogo de comandos.
 *
 * Hidrata UMA vez no boot (e re-hidrata quando `enabled` muda), nunca por componente.
 * Antes desta sessão, cada componente que precisava saber "o usuário pode X?" ou
 * "qual o rótulo do comando Y?" mantinha sua própria cópia da resposta.
 *
 * Fonte única de autorização DE UI: `can()`. Isso é conveniência de interface —
 * a decisão real continua no backend, que revalida toda ação.
 */
export type SessionMetaState = {
  me: MeResponse | null;
  permissions: ReadonlySet<PermissionLabel>;
  catalog: CommandCatalogEntry[];
  status: 'idle' | 'loading' | 'ready' | 'error';
};

type SessionMetaContextValue = SessionMetaState & {
  /** `true` quando o usuário possui a permissão `recurso:acao`. */
  can: (permission: PermissionLabel) => boolean;
  /** Rótulo PT-BR de um comando, vindo do `/command-catalog`. */
  commandLabel: (command: CommandName) => string;
  reload: () => void;
};

const SessionMetaContext = createContext<SessionMetaContextValue | null>(null);

const EMPTY_PERMISSIONS: ReadonlySet<PermissionLabel> = new Set();

export function SessionMetaProvider({
  enabled,
  children,
}: {
  /** Habilita a hidratação. Deve ser `true` apenas com sessão autenticada. */
  enabled: boolean;
  children: ReactNode;
}) {
  const [state, setState] = useState<SessionMetaState>({
    me: null,
    permissions: EMPTY_PERMISSIONS,
    catalog: [],
    status: 'idle',
  });
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) {
      setState({ me: null, permissions: EMPTY_PERMISSIONS, catalog: [], status: 'idle' });
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    setState((current) => ({ ...current, status: 'loading' }));

    void Promise.all([fetchMe(controller.signal), fetchCommandCatalog(controller.signal)])
      .then(([me, catalog]) => {
        if (cancelled) {
          return;
        }
        setState({
          me,
          permissions: new Set(me.permissoes_efetivas),
          catalog: catalog.comandos,
          status: 'ready',
        });
      })
      .catch(() => {
        if (!cancelled) {
          // Falha de hidratação NÃO inventa permissão: o estado fica sem permissões
          // e a UI desabilita as ações que dependem delas.
          setState({ me: null, permissions: EMPTY_PERMISSIONS, catalog: [], status: 'error' });
        }
      });

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [enabled, nonce]);

  const value = useMemo<SessionMetaContextValue>(() => {
    const labelByCommand = new Map(state.catalog.map((entry) => [entry.nome, entry.label]));
    return {
      ...state,
      can: (permission: PermissionLabel) => state.permissions.has(permission),
      commandLabel: (command: CommandName) => labelByCommand.get(command) ?? command,
      reload,
    };
  }, [state, reload]);

  return <SessionMetaContext.Provider value={value}>{children}</SessionMetaContext.Provider>;
}

export function useSessionMeta(): SessionMetaContextValue {
  const context = useContext(SessionMetaContext);
  if (!context) {
    throw new Error('useSessionMeta must be used within SessionMetaProvider.');
  }
  return context;
}

/** Identidade e permissões efetivas do usuário autenticado. */
export function useMe(): SessionMetaState {
  return useSessionMeta();
}

/** Catálogo de comandos da state machine, hidratado uma vez. */
export function useCommandCatalog(): CommandCatalogEntry[] {
  return useSessionMeta().catalog;
}

/**
 * Helper de autorização de UI, derivado de `permissoes_efetivas`.
 *
 * NÃO substitui o backend: o servidor revalida toda ação. Serve para não oferecer
 * ao usuário um botão que será negado.
 */
export function useCan(): (permission: PermissionLabel) => boolean {
  return useSessionMeta().can;
}
