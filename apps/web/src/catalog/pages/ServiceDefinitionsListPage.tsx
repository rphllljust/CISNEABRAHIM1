import { useCallback, useEffect, useMemo, useState } from 'react';
import { CatalogApiError, listServiceDefinitions } from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import { ServiceDefinitionStatusBadge } from '../components/ServiceDefinitionStatusBadge';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';
import {
  CATALOG_LINEAGE_STATUSES,
  type CatalogLineageStatus,
  type ServiceDefinition,
} from '../types/service-catalog.types';
import {
  FilterCard,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModulePrimaryLink,
  ModuleTableCard,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

/**
 * PROXIMA ACAO derivada do estado REAL da definicao.
 *
 * Nao ha transicao nova aqui: a leitura usa apenas o que a listagem ja devolve
 * (versao publicada e rascunho corrente). Sem fato que sustente um proximo passo, a
 * celula fica vazia — nao se inventa tarefa para preencher coluna.
 */
export function resolveCatalogNextAction(definition: {
  latestPublishedVersion: number | null;
  currentDraftVersion: number | null;
}): string {
  if (definition.currentDraftVersion !== null) {
    return 'Concluir e publicar o rascunho';
  }
  if (definition.latestPublishedVersion === null) {
    return 'Criar a primeira versão';
  }
  return 'Revisar ou inativar';
}

type VersionFilter = '' | 'HAS_DRAFT' | 'HAS_PUBLISHED' | 'NO_PUBLISHED';

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: ServiceDefinition[]; offset: number; hasMore: boolean };

export function ServiceDefinitionsListPage() {
  const { capabilities } = useCatalogCapabilities();
  const [statusFilter, setStatusFilter] = useState<'' | CatalogLineageStatus>('');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  // A busca e resolvida no SERVIDOR (nome ou code): sem isso, filtrar so a pagina atual diria
  // "nenhum resultado" para um servico que existe na pagina seguinte.
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listServiceDefinitions(
          {
            limit: PAGE_SIZE,
            offset,
            status: statusFilter || undefined,
            search: debouncedSearch || undefined,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (error instanceof CatalogApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapCatalogErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar o catálogo.',
          retryable: true,
        });
      }
    },
    [statusFilter, debouncedSearch],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage]);

  const filteredItems = useMemo(() => {
    if (listState.phase !== 'ready') {
      return [];
    }
    return listState.items.filter((item) => {
      if (versionFilter === 'HAS_DRAFT' && item.currentDraftVersion === null) {
        return false;
      }
      if (versionFilter === 'HAS_PUBLISHED' && item.latestPublishedVersion === null) {
        return false;
      }
      if (versionFilter === 'NO_PUBLISHED' && item.latestPublishedVersion !== null) {
        return false;
      }
      return true;
    });
  }, [listState, versionFilter]);

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState title="Catálogo de serviços" message="Carregando definições…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Catálogo de serviços"
        message="Você não tem permissão para listar o catálogo."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Catálogo de serviços"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModulePage>
    );
  }

  const { offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Catálogo de serviços"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/catalog/new">Nova definição</ModulePrimaryLink>
          ) : null
        }
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className={filterLabelClass} htmlFor="catalog-search">
              Buscar serviços
            </label>
            <input
              id="catalog-search"
              type="search"
              className={filterControlClass}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Nome ou código"
            />
            <p className="mt-2 text-xs text-gray-400">
              A busca é resolvida no servidor, por nome do serviço ou código operacional.
            </p>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="catalog-status-filter">
              Status da definição
            </label>
            <select
              id="catalog-status-filter"
              className={filterControlClass}
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value as '' | CatalogLineageStatus)}
            >
              <option value="">Todos</option>
              <option value={CATALOG_LINEAGE_STATUSES.Active}>Ativos</option>
              <option value={CATALOG_LINEAGE_STATUSES.Inactive}>Inativos</option>
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="catalog-version-filter">
              Versões
            </label>
            <select
              id="catalog-version-filter"
              className={filterControlClass}
              value={versionFilter}
              onChange={(event) => setVersionFilter(event.target.value as VersionFilter)}
            >
              <option value="">Todas</option>
              <option value="HAS_DRAFT">Com rascunho</option>
              <option value="HAS_PUBLISHED">Com versão publicada</option>
              <option value="NO_PUBLISHED">Sem versão publicada</option>
            </select>
          </div>
        </div>
      </FilterCard>

      {/*
        RECORTE DE VERSAO E LOCAL, NAO DO SERVIDOR.
        O contrato de `/catalog/service-definitions` publica apenas `status` e `q`
        (ver `ListServiceDefinitionsParams`). Nao existe filtro de versao publicado, e
        recortar no navegador uma lista paginada no servidor mentiria: um servico com
        rascunho na proxima pagina apareceria como inexistente.
        A tela declara o escopo em vez de esconder a limitacao — PARK registrado:
        filtro de versao no servidor.
      */}
      {listState.phase === 'ready' && listState.items.length > 0 ? (
        <p className="mb-2 text-xs text-gray-500" role="status">
          {filteredItems.length} de {listState.items.length} nesta página
          {versionFilter ? ' · o recorte de versão vale apenas para esta página' : ''}
        </p>
      ) : null}

      {filteredItems.length === 0 ? (
        <p className="text-sm text-gray-500" role="status">
          {versionFilter
            ? 'Nenhuma definição nesta página corresponde ao recorte de versão. O recorte de versão ainda não é resolvido pelo servidor — avance a página ou limpe o filtro.'
            : 'Nenhuma definição encontrada para os filtros selecionados.'}
        </p>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de definições de serviço">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Serviço
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Categoria
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Versão publicada
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Rascunho
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Próxima ação
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((definition) => (
                <tr key={definition.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <ModuleTableLink to={`/app/catalog/${definition.id}`}>
                      {/* Identidade PRINCIPAL e o nome humano; o code fica como contexto. */}
                      {definition.name ?? definition.code}
                    </ModuleTableLink>
                    {definition.name ? (
                      <span className="mt-1 block text-xs text-gray-500">{definition.code}</span>
                    ) : null}
                  </td>
                  <td className={moduleTableCellClass}>
                    {definition.categoryName ?? '—'}
                  </td>
                  <td className={moduleTableCellClass}>
                    <ServiceDefinitionStatusBadge status={definition.status} />
                  </td>
                  <td className={moduleTableCellClass}>
                    {/*
                      Versao com CONTEXTO, nao um numero solto: "v3" e a versao vigente
                      publicada; ausencia e declarada como "Sem publicação", que e um
                      fato do ciclo de vida — nao um traco mudo repetido na coluna.
                    */}
                    {definition.latestPublishedVersion !== null ? (
                      <span className="text-sm text-gray-800">
                        v{definition.latestPublishedVersion}
                        <span className="ml-1 text-xs text-gray-500">vigente</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-500">Sem publicação</span>
                    )}
                  </td>
                  <td className={moduleTableCellClass}>
                    {definition.currentDraftVersion !== null ? (
                      <span className="text-sm text-amber-800">
                        v{definition.currentDraftVersion}
                        <span className="ml-1 text-xs text-amber-700">em edição</span>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    )}
                  </td>
                  <td className={moduleTableCellClass}>
                    {/*
                      Proxima acao derivada do ESTADO REAL da definicao: sem versao
                      publicada o trabalho e publicar; com rascunho aberto o trabalho e
                      concluir a edicao; publicado e estavel nao declara acao.
                    */}
                    <span className="text-xs text-gray-600">
                      {resolveCatalogNextAction(definition)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      )}

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
        onNext={() => void loadPage(offset + PAGE_SIZE)}
      />
    </ModulePage>
  );
}
