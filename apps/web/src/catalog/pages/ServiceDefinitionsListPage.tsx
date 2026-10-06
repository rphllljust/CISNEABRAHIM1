import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CatalogApiError, listServiceDefinitions } from '../api/service-catalog-api';
import { mapCatalogErrorToMessage } from '../api/catalog-error-messages';
import { ServiceDefinitionStatusBadge } from '../components/ServiceDefinitionStatusBadge';
import { useCatalogCapabilities } from '../hooks/useCatalogCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  DynamicContextDrawer,
  DynamicSavedViewsBar,
  useSavedViews,
  type CrossReference,
} from '../../engine';
import {
  CATALOG_LINEAGE_STATUSES,
  type CatalogLineageStatus,
  type ServiceDefinition,
} from '../types/service-catalog.types';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  rowPrimaryActionClass,
  WorklistStatePanel,
  EnterpriseMetric,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
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
  const { identityId } = useAuth();
  /*
   * VISÕES SALVAS — o recorte (busca + status + versão) que o curador do catálogo remonta todo
   * dia: "ativos com rascunho em aberto" é a fila real de trabalho dele. `useSavedViews` já é a
   * capacidade da engine, persistida por identidade e DECLARADA como local enquanto não existe
   * endpoint de visões salvas.
   */
  const savedViews = useSavedViews(identityId ?? 'anonymous', 'catalog-service-definitions');
  const [selected, setSelected] = useState<ServiceDefinition | null>(null);
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
      <ModuleStatePage title="Catálogo de serviços">
        <ModuleLoadingState message="Carregando definições…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Catálogo de serviços">
        <ModuleDeniedState
        message="Você não tem permissão para listar o catálogo."
      />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Catálogo de serviços">
        <ModuleErrorState
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModuleStatePage>
    );
  }

  const { offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;

  /**
   * INDICADORES REAIS do portifolio — contados sobre a pagina carregada, nunca estimados.
   *
   * Os tres fatos vem dos campos que o contrato JA publica em cada definicao:
   *   `currentDraftVersion`  -> existe revisao em rascunho (trabalho em curso);
   *   `latestPublishedVersion` -> existe versao vigente publicada (contratavel);
   *   `status` -> a linhagem esta ativa.
   *
   *  Uma definicao com rascunho e SEM publicada e a que mais importa ao operador: ela ainda nao
   * e contratavel, e o rascunho explica por que. Por isso essa combinacao tem indicador proprio.
   *  Nenhum numero e derivado de regra nova — apenas contagem do que a listagem entrega.
   */
  const withDraftCount = listState.items.filter((item) => item.currentDraftVersion !== null).length;
  const publishedCount = listState.items.filter(
    (item) => item.latestPublishedVersion !== null,
  ).length;
  const notContractableCount = listState.items.filter(
    (item) => item.latestPublishedVersion === null,
  ).length;

  return (
    <ModulePage>
      <WorklistHeader
        title="Catálogo de serviços"
        count={listState.items.length}
        context="Portfólio de serviços contratáveis, com a versão vigente e o rascunho em aberto de cada um."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/catalog/new">Nova definição</ModulePrimaryLink>
          ) : null
        }
        metrics={
          listState.items.length > 0 ? (
            <>
              <EnterpriseMetric
                value={publishedCount}
                label="com versão publicada"
                tone={publishedCount > 0 ? 'info' : 'neutral'}
              />
              <EnterpriseMetric
                value={withDraftCount}
                label="com rascunho em aberto"
                tone={withDraftCount > 0 ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric
                value={notContractableCount}
                label="ainda não contratáveis"
                tone={notContractableCount > 0 ? 'warning' : 'neutral'}
              />
            </>
          ) : null
        }
      />

      <WorklistFilterBar
        meta={
          <>
            {filteredItems.length} de {listState.items.length} nesta página
            {versionFilter ? ' · recorte de versão vale só nesta página' : ''}
          </>
        }
      >
        <WorklistField label="Buscar" htmlFor="catalog-search" grow>
          <input
            id="catalog-search"
            type="search"
            className={worklistSelectClass}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Nome ou código"
          />
        </WorklistField>
        <WorklistField label="Status" htmlFor="catalog-status-filter">
          <select
            id="catalog-status-filter"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as '' | CatalogLineageStatus)}
          >
            <option value="">Todos</option>
            <option value={CATALOG_LINEAGE_STATUSES.Active}>Ativos</option>
            <option value={CATALOG_LINEAGE_STATUSES.Inactive}>Inativos</option>
          </select>
        </WorklistField>
        <WorklistField label="Versões" htmlFor="catalog-version-filter">
          <select
            id="catalog-version-filter"
            className={worklistSelectClass}
            value={versionFilter}
            onChange={(event) => setVersionFilter(event.target.value as VersionFilter)}
          >
            <option value="">Todas</option>
            <option value="HAS_DRAFT">Com rascunho</option>
            <option value="HAS_PUBLISHED">Com versão publicada</option>
            <option value="NO_PUBLISHED">Sem versão publicada</option>
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={Boolean(statusFilter || versionFilter || search.trim())}
          onClick={() => {
            setSearch('');
            setStatusFilter('');
            setVersionFilter('');
          }}
        />
      </WorklistFilterBar>

      {/*
        VISÕES SALVAS — a fila que o curador reconstrói todo dia ("ativos com rascunho em
        aberto" é o trabalho pendente real do catálogo). `persistedLocally` é declarado pela
        engine: sem endpoint de visões salvas, o armazenamento é local por identidade.
      */}
      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        onSave={(name) => savedViews.save(name, { search, statusFilter, versionFilter }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          setSearch(view.filters['search'] ?? '');
          setDebouncedSearch(view.filters['search'] ?? '');
          setStatusFilter((view.filters['statusFilter'] ?? '') as '' | CatalogLineageStatus);
          setVersionFilter((view.filters['versionFilter'] ?? '') as VersionFilter);
        }}
      />

      {/*
        RECORTE DE VERSAO E LOCAL, NAO DO SERVIDOR.
        O contrato de `/catalog/service-definitions` publica apenas `status` e `q`
        (ver `ListServiceDefinitionsParams`). Nao existe filtro de versao publicado, e
        recortar no navegador uma lista paginada no servidor mentiria: um servico com
        rascunho na proxima pagina apareceria como inexistente.
        A tela declara o escopo em vez de esconder a limitacao — PARK registrado:
        filtro de versao no servidor.
      */}
      {filteredItems.length === 0 ? (
        <WorklistStatePanel
          title={
            versionFilter
              ? 'Nenhuma definição nesta página corresponde ao recorte de versão.'
              : 'Nenhuma definição encontrada para os filtros selecionados.'
          }
          description={
            versionFilter
              ? 'O recorte de versão ainda não é resolvido pelo servidor — avance a página ou limpe o filtro.'
              : 'Ajuste a busca ou o status, ou limpe os filtros para ver o portfólio completo.'
          }
          action={
            <WorklistClearFilters
              visible
              onClick={() => {
                setSearch('');
                setStatusFilter('');
                setVersionFilter('');
              }}
            />
          }
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de definições de serviço">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Serviço
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Categoria
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Versões
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Próxima ação
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((definition) => (
                <tr
                  key={definition.id}
                  className={worklistRowClass}
                  /*
                   * CONTEXTO SEM ABANDONAR A LISTA — o operador do catálogo decide comparando
                   * definições. O painel lateral mostra os fatos da linha clicada (categoria,
                   * ciclo de versão e o que fazer agora) sem tirá-lo do recorte em que está
                   * trabalhando. O link da primeira coluna continua sendo o caminho para a ficha.
                   */
                  onClick={() => setSelected(definition)}
                >
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/catalog/${definition.id}`}>
                      {/* Identidade PRINCIPAL e o nome humano; o code fica como contexto. */}
                      {definition.name ?? definition.code}
                    </WorklistRowLink>
                    {definition.name ? (
                      <p className="text-[11px] text-gray-500">{definition.code}</p>
                    ) : null}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {definition.categoryName ?? (
                      <span className="text-[11px] text-gray-500">Sem categoria</span>
                    )}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <ServiceDefinitionStatusBadge status={definition.status} />
                  </td>
                  {/*
                    UMA COLUNA DE VERSAO, NAO DUAS.

                    Antes eram "Versao vigente" e "Rascunho" lado a lado: na esmagadora maioria
                    das linhas o rascunho nao existe e a coluna inteira virava um traco mudo,
                    gastando largura de desktop sem entregar informacao nenhuma. Agora a celula
                    declara o ciclo de vida em UMA leitura: a vigente sempre aparece ("v3 vigente"),
                    e o rascunho so ocupa espaco quando existe de fato ("v4 em edição").
                  */}
                  <td className={worklistCellRaisedClass}>
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      {definition.latestPublishedVersion !== null ? (
                        <span className="whitespace-nowrap text-gray-800">
                          v{definition.latestPublishedVersion}
                          <span className="ml-1 text-[11px] text-gray-500">vigente</span>
                        </span>
                      ) : (
                        <span className="whitespace-nowrap text-[11px] text-gray-500">
                          Sem versão publicada
                        </span>
                      )}
                      {definition.currentDraftVersion !== null ? (
                        <span className="whitespace-nowrap text-amber-800">
                          v{definition.currentDraftVersion}
                          <span className="ml-1 text-[11px] text-amber-700">em edição</span>
                        </span>
                      ) : null}
                    </div>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {/*
                      Proxima acao derivada do ESTADO REAL da definicao: sem versao publicada o
                      trabalho e publicar; com rascunho aberto o trabalho e concluir a edicao.
                    */}
                    <span className="text-[12px] text-gray-600">
                      {resolveCatalogNextAction(definition)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <WorklistFooter
        rangeLabel={`${offset + 1}–${offset + listState.items.length} nesta página`}
        extra={
          filteredItems.length !== listState.items.length
            ? `${filteredItems.length} após o recorte de versão`
            : undefined
        }
      >
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => void loadPage(offset + PAGE_SIZE)}
        />
      </WorklistFooter>

      {/*
        RELAÇÕES DA DEFINIÇÃO — montadas do que a LINHA já traz, sem chamada de rede nova.
        A contagem de versões publicadas NÃO é publicada pelo contrato, então não aparece: um
        número sem origem seria inventado. O que entra é o que o payload sustenta.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={selected?.name ?? selected?.code ?? 'Serviço'}
        onClose={() => setSelected(null)}
        crossReferences={selected ? catalogCrossReferences(selected) : []}
      >
        {selected ? (
          <div className="space-y-2 text-xs text-gray-600">
            <p className="font-medium text-gray-800">{selected.code}</p>
            <p>{resolveCatalogNextAction(selected)}</p>
            <Link
              to={`/app/catalog/${selected.id}`}
              className={rowPrimaryActionClass}
            >
              Abrir ficha
            </Link>
          </div>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * Referências cruzadas da definição, a partir do payload da listagem.
 *
 * Cada item entra só quando o campo existe. Ausência NÃO vira zero nem linha vazia: o painel
 * declara que não há referência em vez de afirmar um vínculo que o contrato não publica.
 */
function catalogCrossReferences(definition: ServiceDefinition): CrossReference[] {
  const references: CrossReference[] = [];
  if (definition.categoryName) {
    references.push({ label: 'Categoria', detail: definition.categoryName });
  }
  if (definition.latestPublishedVersion !== null) {
    references.push({
      label: 'Versão vigente',
      detail: `v${definition.latestPublishedVersion} publicada e contratável`,
    });
  } else {
    references.push({
      label: 'Versão vigente',
      detail: 'Nenhuma versão publicada — o serviço ainda não é contratável',
    });
  }
  if (definition.currentDraftVersion !== null) {
    references.push({
      label: 'Rascunho em edição',
      detail: `v${definition.currentDraftVersion} aguardando publicação`,
    });
  }
  return references;
}
