import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  EMPTY_SMART_LIST_CONFIG,
  isPersistableValue,
  type SmartListAllowedFilters,
  type SmartListConfig,
  type UseSavedViewsResult,
  useSavedViews,
  type BuiltInView,
} from './useSavedViews';

export type SmartListSort = {
  key: string | null;
  direction: 'asc' | 'desc';
};

export type UseSmartListOptions<Row> = {
  /** Identificador estavel da tela, usado como escopo de persistencia. */
  scope: string;
  builtInViews?: BuiltInView[];
  /** Filtros iniciais (valores enumerados). Nunca texto livre. */
  initialFilters?: Record<string, string>;
  initialSort?: SmartListSort;
  /** Acessores usados para ordenacao generica. */
  sortAccessors?: Record<string, (row: Row) => string | number | null | undefined>;
  /**
   * Sincroniza filtro/ordenacao com a query string.
   *
   * Necessario para o mecanismo de DRILL-DOWN e para o COMMAND CENTER: um KPI ou um
   * comando abre a lista ja filtrada por URL, sem o operador refazer o filtro.
   * A URL carrega apenas valores enumerados (mesmo alfabeto restrito das visoes).
   */
  urlSync?: boolean;
  /**
   * Allow-list das chaves/valores que ESTA tela pode persistir em visão salva.
   * Defesa principal contra gravar dado de negócio no browser: um valor que não
   * seja opção real de um filtro declarado é rejeitado na hora de salvar.
   */
  allowedFilters?: SmartListAllowedFilters;
};

export type UseSmartListResult<Row> = {
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
  sort: SmartListSort;
  toggleSort: (key: string) => void;
  /** Linhas ordenadas; a filtragem permanece responsabilidade da tela. */
  sortRows: (rows: Row[]) => Row[];
  /** Configuracao atual, pronta para salvar como visao. */
  currentConfig: SmartListConfig;
  savedViews: UseSavedViewsResult;
  activeViewId: string | null;
  /** Aplica uma visao (embutida ou salva). Nao altera autorizacao. */
  applyView: (view: { id: string; config: SmartListConfig }) => void;
  /** True quando ha algum criterio aplicado — usado no estado vazio humano. */
  isFiltered: boolean;
};

/**
 * SMART LIST — estado operacional de uma lista (filtro + ordenacao + visao).
 *
 * - Filtros sao valores enumerados por chave estavel: nunca texto livre, para que
 *   salvar visao nunca grave conteudo de negocio no browser.
 * - Ordenacao e generica e nao altera o payload: reordena apenas o que ja veio
 *   autorizado pelo servidor. Esta camada nao concede leitura de nada.
 */
export function useSmartList<Row>({
  scope,
  builtInViews = [],
  initialFilters = {},
  initialSort = { key: null, direction: 'asc' },
  sortAccessors = {},
  urlSync = false,
  allowedFilters,
}: UseSmartListOptions<Row>): UseSmartListResult<Row> {
  const [searchParams, setSearchParams] = useSearchParams();

  const seedFromUrl = useCallback((): Record<string, string> => {
    if (!urlSync) {
      return initialFilters;
    }
    const seeded: Record<string, string> = { ...initialFilters };
    for (const [key, value] of searchParams.entries()) {
      if (key === 'sort' || key === 'dir') {
        continue;
      }
      // Somente tokens enumerados entram pelo URL: nada de texto livre do operador.
      if (isPersistableValue(key) && isPersistableValue(value)) {
        seeded[key] = value;
      }
    }
    return seeded;
    // searchParams e lido apenas como semente inicial; mudanca depois disso e estado local.
  }, [initialFilters, searchParams, urlSync]);

  const seedSort = useCallback((): SmartListSort => {
    if (!urlSync) {
      return initialSort;
    }
    const key = searchParams.get('sort');
    const dir = searchParams.get('dir');
    if (key && isPersistableValue(key)) {
      return { key, direction: dir === 'desc' ? 'desc' : 'asc' };
    }
    return initialSort;
  }, [initialSort, searchParams, urlSync]);

  const [filters, setFilters] = useState<Record<string, string>>(seedFromUrl);
  const [sort, setSort] = useState<SmartListSort>(seedSort);
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const savedViews = useSavedViews(scope, builtInViews, allowedFilters);

  // Reflete o recorte atual na URL para o operador poder voltar/compartilhar.
  useEffect(() => {
    if (!urlSync) {
      return;
    }
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const key of [...next.keys()]) {
          if (key !== 'sort' && key !== 'dir') {
            next.delete(key);
          }
        }
        for (const [key, value] of Object.entries(filters)) {
          next.set(key, value);
        }
        if (sort.key) {
          next.set('sort', sort.key);
          next.set('dir', sort.direction);
        } else {
          next.delete('sort');
          next.delete('dir');
        }
        return next;
      },
      { replace: true },
    );
  }, [filters, sort, urlSync, setSearchParams]);

  const setFilter = useCallback((key: string, value: string) => {
    setActiveViewId(null);
    setFilters((current) => {
      const next = { ...current };
      if (value) {
        next[key] = value;
      } else {
        delete next[key];
      }
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setActiveViewId(null);
    setFilters({});
  }, []);

  const toggleSort = useCallback((key: string) => {
    setActiveViewId(null);
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    );
  }, []);

  const sortRows = useCallback(
    (rows: Row[]): Row[] => {
      const accessor = sort.key ? sortAccessors[sort.key] : undefined;
      if (!sort.key || !accessor) {
        return rows;
      }
      const decorated = rows.map((row, index) => ({ row, index, value: accessor(row) }));
      decorated.sort((left, right) => {
        const a = left.value;
        const b = right.value;
        // Nulos sempre ao fim: nao inventamos valor ausente.
        if (a === null || a === undefined) {
          return b === null || b === undefined ? left.index - right.index : 1;
        }
        if (b === null || b === undefined) {
          return -1;
        }
        let comparison: number;
        if (typeof a === 'number' && typeof b === 'number') {
          comparison = a - b;
        } else {
          comparison = String(a).localeCompare(String(b), 'pt-BR');
        }
        if (comparison === 0) {
          return left.index - right.index;
        }
        return sort.direction === 'asc' ? comparison : -comparison;
      });
      return decorated.map((entry) => entry.row);
    },
    [sort, sortAccessors],
  );

  const currentConfig = useMemo<SmartListConfig>(
    () => ({
      filters,
      sortKey: sort.key,
      sortDirection: sort.direction,
      groupKey: null,
    }),
    [filters, sort],
  );

  const applyView = useCallback((view: { id: string; config: SmartListConfig }) => {
    setFilters({ ...view.config.filters });
    setSort({ key: view.config.sortKey, direction: view.config.sortDirection });
    setActiveViewId(view.id);
  }, []);

  const isFiltered =
    Object.keys(filters).length > 0 ||
    (sort.key !== initialSort.key || sort.direction !== initialSort.direction);

  return {
    filters,
    setFilter,
    clearFilters,
    sort,
    toggleSort,
    sortRows,
    currentConfig: currentConfig ?? EMPTY_SMART_LIST_CONFIG,
    savedViews,
    activeViewId,
    applyView,
    isFiltered,
  };
}
