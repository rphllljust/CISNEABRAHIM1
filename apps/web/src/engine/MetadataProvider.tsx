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
import { fetchEntitySchema, MetaApiError } from './meta-api';
import type { MetaEntitySchema } from './types';

/**
 * Provider de metadados da engine.
 *
 * Cacheia POR ENTIDADE: navegar entre telas da mesma entidade não refaz a chamada, e
 * entidades diferentes não competem pela mesma entrada. O cache vive em `useRef` (não em
 * estado) porque ele não deve provocar render — quem provoca render é o `schemas` state.
 *
 * `invalidate` existe para o caso que a engine não consegue prever: se um administrador
 * alterar o metadado enquanto a tela está aberta, o próximo mount refaz a leitura.
 */
export type MetadataContextValue = {
  /** Schema da entidade, ou `null` enquanto carrega / se falhou. */
  getSchema: (entity: string) => MetaEntitySchema | null;
  /** Estado por entidade, para a UI distinguir "carregando" de "não existe". */
  getStatus: (entity: string) => 'idle' | 'loading' | 'ready' | 'error';
  /** Descarta o cache de uma entidade (ou de todas, sem argumento). */
  invalidate: (entity?: string) => void;
};

const MetadataContext = createContext<MetadataContextValue | null>(null);

export function MetadataProvider({ children }: { children: ReactNode }) {
  const cache = useRef(new Map<string, MetaEntitySchema>());
  const inFlight = useRef(new Map<string, Promise<MetaEntitySchema>>());
  const [schemas, setSchemas] = useState<Map<string, MetaEntitySchema>>(new Map());
  const [statuses, setStatuses] = useState<Map<string, 'idle' | 'loading' | 'ready' | 'error'>>(
    new Map(),
  );

  const load = useCallback(async (entity: string): Promise<void> => {
    if (cache.current.has(entity)) {
      return;
    }
    // Deduplica chamadas concorrentes para a MESMA entidade: duas telas montando juntas
    // fazem uma única requisição.
    const existing = inFlight.current.get(entity);
    if (existing) {
      await existing.catch(() => undefined);
      return;
    }

    setStatuses((current) => new Map(current).set(entity, 'loading'));
    const request = fetchEntitySchema(entity);
    inFlight.current.set(entity, request);

    try {
      const schema = await request;
      cache.current.set(entity, schema);
      setSchemas((current) => new Map(current).set(entity, schema));
      setStatuses((current) => new Map(current).set(entity, 'ready'));
    } catch (error) {
      if (!(error instanceof MetaApiError)) {
        throw error;
      }
      setStatuses((current) => new Map(current).set(entity, 'error'));
    } finally {
      inFlight.current.delete(entity);
    }
  }, []);

  const invalidate = useCallback((entity?: string) => {
    if (entity) {
      cache.current.delete(entity);
      setSchemas((current) => {
        const next = new Map(current);
        next.delete(entity);
        return next;
      });
      return;
    }
    cache.current.clear();
    setSchemas(new Map());
  }, []);

  const value = useMemo<MetadataContextValue>(
    () => ({
      getSchema: (entity: string) => schemas.get(entity) ?? null,
      getStatus: (entity: string) => statuses.get(entity) ?? 'idle',
      invalidate,
    }),
    [schemas, statuses, invalidate],
  );

  return (
    <MetadataContext.Provider value={value}>
      <MetadataLoader load={load} schemas={schemas}>
        {children}
      </MetadataLoader>
    </MetadataContext.Provider>
  );
}

/**
 * Dispara a carga sob demanda.
 *
 * A engine não sabe de antemão quais entidades a árvore vai pedir — os componentes chamam
 * `useEntitySchema(entity)`, e é esse hook que registra a entidade aqui.
 */
const RequestContext = createContext<((entity: string) => void) | null>(null);

function MetadataLoader({
  load,
  schemas,
  children,
}: {
  load: (entity: string) => Promise<void>;
  schemas: Map<string, MetaEntitySchema>;
  children: ReactNode;
}) {
  const request = useCallback(
    (entity: string) => {
      void load(entity);
    },
    [load],
  );

  // `schemas` entra na memo apenas para o valor mudar quando o cache muda; a função em si
  // depende só de `load`.
  const value = useMemo(() => request, [request, schemas]);

  return <RequestContext.Provider value={value}>{children}</RequestContext.Provider>;
}

export function useMetadata(): MetadataContextValue {
  const context = useContext(MetadataContext);
  if (!context) {
    throw new Error('useMetadata must be used within MetadataProvider.');
  }
  return context;
}

/**
 * Schema de UMA entidade, com carga sob demanda.
 *
 * É o hook que todo componente da engine usa. Devolve `null` enquanto carrega para que o
 * chamador decida o que mostrar — a engine nunca inventa um schema vazio, porque um schema
 * vazio renderizaria uma tela em branco indistinguível de "entidade sem campos".
 */
export function useEntitySchema(entity: string): {
  schema: MetaEntitySchema | null;
  status: 'idle' | 'loading' | 'ready' | 'error';
} {
  const { getSchema, getStatus } = useMetadata();
  const request = useContext(RequestContext);
  const schema = getSchema(entity);
  const status = getStatus(entity);

  useEffect(() => {
    if (request) {
      request(entity);
    }
  }, [request, entity]);

  return { schema, status };
}
