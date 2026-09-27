import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/context/AuthProvider';

/**
 * SAVED VIEWS — configuracao de visualizacao salva por usuario/dispositivo.
 *
 * REGRA DE SEGURANCA (obrigatoria):
 * - Persistimos SOMENTE configuracao de visualizacao (valores enumerados de filtro,
 *   ordenacao e agrupamento). Nunca conteudo de registro, valor monetario, nome de
 *   cliente, texto livre de busca ou qualquer dado de negocio.
 * - Todo valor persistido passa por `assertPersistableValue`, que aceita apenas
 *   tokens curtos de um alfabeto restrito. Nome de cliente, CPF, e-mail, valor
 *   monetario e frase livre sao rejeitados e a chave e descartada.
 * - A chave de armazenamento inclui um hash do identificador de identidade (nao o
 *   identificador em claro), para nao gravar identidade no browser.
 *
 * Isto e preferencia local, nao dominio. Nada aqui autoriza leitura ou escrita.
 */

const STORAGE_PREFIX = 'cisne:operator:views:v1';
const MAX_VIEWS_PER_SCOPE = 24;
const MAX_FILTER_KEYS = 16;
const MAX_NAME_LENGTH = 48;
const MAX_FILTER_VALUE_LENGTH = 120;

/** Alfabeto restrito: tokens de enum/codigo. Sem espaco, `@`, acento, `/`, `.` ou `-`. */
const PERSISTABLE_VALUE = /^[A-Za-z0-9_]{1,64}$/;

export type SmartListConfig = {
  /** Valores enumerados de filtro, por chave estavel da tela. */
  filters: Record<string, string>;
  sortKey: string | null;
  sortDirection: 'asc' | 'desc';
  groupKey: string | null;
};

/**
 * Allow-list por tela. Chave de filtro so e persistida se a tela a declarar, e o
 * valor so e persistido se estiver na lista de opcoes REAIS daquela chave.
 *
 * Isto e a defesa principal: sem allow-list, um token como `Amaggi` passaria na
 * checagem de alfabeto (e alfabetico!). Com allow-list ele e rejeitado, porque
 * nao e um valor enumerado de nenhum filtro declarado.
 */
export type SmartListAllowedFilters = {
  /** Chave do filtro -> valores aceitos (os mesmos que a tela oferece). */
  filters: Record<string, readonly string[]>;
  /** Chaves de ordenacao que a tela realmente sabe ordenar. */
  sortKeys?: readonly string[];
};

export type SavedView = {
  id: string;
  name: string;
  config: SmartListConfig;
  createdAt: string;
};

export type SavedViewsStore = {
  version: 1;
  views: SavedView[];
};

export const EMPTY_SMART_LIST_CONFIG: SmartListConfig = {
  filters: {},
  sortKey: null,
  sortDirection: 'asc',
  groupKey: null,
};

export function isPersistableValue(value: string): boolean {
  return PERSISTABLE_VALUE.test(value);
}

/**
 * Reduz uma configuracao candidata ao subconjunto persistivel.
 *
 * @param allowedFilters allow-list da tela. Quando informada (o esperado em
 *   producao), chave desconhecida e valor fora da lista sao rejeitados.
 * @returns `null` quando nada sobra — nesse caso a visao nao e salva.
 */
export function sanitizeSmartListConfig(
  candidate: SmartListConfig,
  allowedFilters?: SmartListAllowedFilters,
): SmartListConfig | null {
  const filters: Record<string, string> = {};
  const entries = Object.entries(candidate.filters ?? {});
  if (entries.length > MAX_FILTER_KEYS) {
    return null;
  }
  for (const [key, value] of entries) {
    if (typeof value !== 'string' || value.length === 0) {
      continue;
    }
    if (!PERSISTABLE_VALUE.test(key)) {
      return null;
    }
    if (value.length > MAX_FILTER_VALUE_LENGTH || !isPersistableValue(value)) {
      return null;
    }
    if (allowedFilters) {
      const allowedValues = allowedFilters.filters[key];
      // Chave nao declarada pela tela, ou valor que nao e uma das opcoes reais.
      if (!allowedValues || !allowedValues.includes(value)) {
        return null;
      }
    }
    filters[key] = value;
  }

  const isAllowedSortKey = (key: string): boolean =>
    PERSISTABLE_VALUE.test(key) &&
    (!allowedFilters?.sortKeys || allowedFilters.sortKeys.includes(key));

  const sortKey = candidate.sortKey && isAllowedSortKey(candidate.sortKey) ? candidate.sortKey : null;
  const groupKey =
    candidate.groupKey && isAllowedSortKey(candidate.groupKey) ? candidate.groupKey : null;
  const sortDirection = candidate.sortDirection === 'desc' ? 'desc' : 'asc';

  if (Object.keys(filters).length === 0 && !sortKey && !groupKey) {
    return null;
  }
  return { filters, sortKey, sortDirection, groupKey };
}

export function sanitizeViewName(raw: string): string | null {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (trimmed.length === 0 || trimmed.length > MAX_NAME_LENGTH) {
    return null;
  }
  return trimmed;
}

/** Hash estavel e nao reversivel — usado apenas como sufixo de chave local. */
function hashScope(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function storageKeyFor(scope: string, identityId: string | null | undefined): string {
  const owner = identityId ? hashScope(identityId) : 'anon';
  return `${STORAGE_PREFIX}:${scope}:${owner}`;
}

function readStore(
  scope: string,
  identityId: string | null | undefined,
  allowedFilters?: SmartListAllowedFilters,
): SavedView[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(storageKeyFor(scope, identityId));
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as SavedViewsStore;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.views)) {
      return [];
    }
    // Revalida na leitura: conteudo manipulado no browser nao entra na aplicacao.
    return parsed.views
      .map((view) => {
        if (!view || typeof view.name !== 'string') {
          return null;
        }
        const name = sanitizeViewName(view.name);
        const config = sanitizeSmartListConfig(view.config, allowedFilters);
        if (!name || !config) {
          return null;
        }
        return {
          id: typeof view.id === 'string' ? view.id : createViewId(),
          name,
          config,
          createdAt: typeof view.createdAt === 'string' ? view.createdAt : new Date().toISOString(),
        } satisfies SavedView;
      })
      .filter((view): view is SavedView => view !== null)
      .slice(0, MAX_VIEWS_PER_SCOPE);
  } catch {
    return [];
  }
}

function writeStore(
  scope: string,
  identityId: string | null | undefined,
  views: SavedView[],
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    const payload: SavedViewsStore = { version: 1, views: views.slice(0, MAX_VIEWS_PER_SCOPE) };
    window.localStorage.setItem(storageKeyFor(scope, identityId), JSON.stringify(payload));
  } catch {
    // Armazenamento indisponivel (modo privado, cota): a lista segue sem persistencia.
  }
}

function createViewId(): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `view_${Date.now().toString(36)}_${random}`;
}

/** Visao embutida: existe sem persistencia e nao pode ser removida. */
export type BuiltInView = {
  id: string;
  name: string;
  description: string;
  config: SmartListConfig;
};

export type UseSavedViewsResult = {
  views: SavedView[];
  builtInViews: BuiltInView[];
  saveView: (name: string, config: SmartListConfig) => SavedView | null;
  renameView: (id: string, name: string) => boolean;
  removeView: (id: string) => void;
  getView: (id: string) => SavedView | undefined;
};

/**
 * @param scope identificador estavel da tela (ex.: `finance.receivables`).
 * @param builtInViews visoes de sistema derivadas do dominio real da tela.
 * @param allowedFilters allow-list das chaves/valores que esta tela pode persistir.
 */
export function useSavedViews(
  scope: string,
  builtInViews: BuiltInView[] = [],
  allowedFilters?: SmartListAllowedFilters,
): UseSavedViewsResult {
  const { identityId } = useAuth();
  const [views, setViews] = useState<SavedView[]>(() =>
    readStore(scope, identityId, allowedFilters),
  );

  useEffect(() => {
    setViews(readStore(scope, identityId, allowedFilters));
    // A allow-list e declarada estaticamente pela tela; nao muda entre renders.
  }, [scope, identityId, allowedFilters]);

  const saveView = useCallback(
    (name: string, config: SmartListConfig): SavedView | null => {
      const safeName = sanitizeViewName(name);
      const safeConfig = sanitizeSmartListConfig(config, allowedFilters);
      if (!safeName || !safeConfig) {
        return null;
      }
      const view: SavedView = {
        id: createViewId(),
        name: safeName,
        config: safeConfig,
        createdAt: new Date().toISOString(),
      };
      setViews((current) => {
        const next = [...current.filter((item) => item.name !== safeName), view].slice(
          -MAX_VIEWS_PER_SCOPE,
        );
        writeStore(scope, identityId, next);
        return next;
      });
      return view;
    },
    [scope, identityId, allowedFilters],
  );

  const renameView = useCallback(
    (id: string, name: string): boolean => {
      const safeName = sanitizeViewName(name);
      if (!safeName) {
        return false;
      }
      let renamed = false;
      setViews((current) => {
        if (!current.some((item) => item.id === id)) {
          return current;
        }
        renamed = true;
        const next = current.map((item) => (item.id === id ? { ...item, name: safeName } : item));
        writeStore(scope, identityId, next);
        return next;
      });
      return renamed;
    },
    [scope, identityId],
  );

  const removeView = useCallback(
    (id: string) => {
      setViews((current) => {
        const next = current.filter((item) => item.id !== id);
        writeStore(scope, identityId, next);
        return next;
      });
    },
    [scope, identityId],
  );

  const getView = useCallback(
    (id: string) => views.find((item) => item.id === id),
    [views],
  );

  return useMemo(
    () => ({ views, builtInViews, saveView, renameView, removeView, getView }),
    [views, builtInViews, saveView, renameView, removeView, getView],
  );
}
