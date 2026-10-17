import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  activateServiceDefinition,
  CatalogApiError,
  deactivateServiceDefinition,
  getServiceDefinition,
  listServiceDefinitionVersions,
  listServiceDefinitions,
  publishServiceDefinitionVersion,
} from '../api/service-catalog-api';
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
  VERSION_STATUSES,
  type CatalogLineageStatus,
  type ServiceDefinition,
  type ServiceDefinitionVersion,
} from '../types/service-catalog.types';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
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
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
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

/**
 * COMANDOS DE LINHAGEM DO CATÁLOGO — os três que o contrato publica.
 *
 * `publish` age sobre a VERSÃO em rascunho; `activate`/`deactivate` agem sobre a LINHAGEM. Por isso
 * cada um exige um campo diferente (`lineageVersion` sempre; `reason` só na inativação, e lá o
 * contrato o exige — `DeactivateDefinitionPayload.reason` é obrigatório).
 */
type CatalogCommand = 'publish' | 'deactivate' | 'activate';

const COMMAND_LABEL: Record<CatalogCommand, string> = {
  publish: 'Publicar rascunho',
  deactivate: 'Inativar',
  activate: 'Reativar',
};

const COMMAND_DONE_LABEL: Record<CatalogCommand, string> = {
  publish: 'Rascunho publicado.',
  deactivate: 'Definição inativada.',
  activate: 'Definição reativada.',
};

/**
 * COMANDOS CUJO MOTIVO O CONTRATO EXIGE.
 *
 * `DeactivateDefinitionPayload.reason` é obrigatório; publicar e reativar não pedem motivo. Onde o
 * contrato exige, a tela exige; onde não exige, a tela NÃO inventa texto de auditoria.
 */
const COMMANDS_REQUIRING_REASON: CatalogCommand[] = ['deactivate'];



export function ServiceDefinitionsListPage() {
  const { capabilities } = useCatalogCapabilities();
  const { identityId } = useAuth();
  /*
   * VISÕES SALVAS — o recorte (busca + status + versão) que o curador do catálogo remonta todo
   * dia: "ativos com rascunho em aberto" é a fila real de trabalho dele. `useSavedViews` já é a
   * capacidade da engine, persistida por identidade e DECLARADA como local enquanto não existe
   * endpoint de visões salvas.
   */
  /* SEM IDENTIDADE, NÃO PERSISTE: `null` em vez do namespace compartilhado `'anonymous'`. */
  const savedViews = useSavedViews(identityId ?? null, 'catalog-service-definitions');
  const [selected, setSelected] = useState<ServiceDefinition | null>(null);
  const [statusFilter, setStatusFilter] = useState<'' | CatalogLineageStatus>('');
  const [versionFilter, setVersionFilter] = useState<VersionFilter>('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  /*
   * CONTEXTO AUTORITATIVO — a LINHA é projeção da listagem; agir sobre ela é agir sobre estado
   * possivelmente velho. O painel re-lê a linhaça (`getServiceDefinition`) e as versões
   * (`listServiceDefinitionVersions`) no momento da seleção, e é dessa leitura que saem tanto os
   * fatos exibidos quanto os comandos oferecidos.
   */
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; definition: ServiceDefinition; versions: ServiceDefinitionVersion[] }
  >({ phase: 'idle' });
  /** Motivo da inativação: OBRIGATÓRIO no contrato deste domínio — digitado pelo operador. */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandDone, setCommandDone] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const navigate = useNavigate();
  const selectedId = selected?.id ?? null;


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
            version: versionFilter || undefined,
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
    [statusFilter, versionFilter, debouncedSearch],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage, reloadToken]);

  /* CARREGAMENTO LOCALIZADO DO CONTEXTO — só o painel espera; a fila permanece montada. */
  useEffect(() => {
    if (!selectedId) {
      setDetailState({ phase: 'idle' });
      setCommandReason('');
      setCommandError(null);
      setCommandDone(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    setCommandDone(null);
    void Promise.all([
      getServiceDefinition(selectedId, controller.signal),
      listServiceDefinitionVersions(selectedId, controller.signal),
    ])
      .then(([definition, versions]) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', definition, versions });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto da definição.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId, reloadToken]);

  /**
   * COMANDOS DISPONÍVEIS — derivados do ESTADO que o servidor publica, cruzado com a permissão.
   *
   * O catálogo NÃO publica tabela de transições (diferente de Propostas, que tem
   * `readiness.availableTransitions`). Então a barreira da esquerda é o próprio estado da linhaça
   * (`status`), mais o fato de existir versão em rascunho:
   *
   *   - `publish`    exige rascunho cuja SITUAÇÃO seja DRAFT — publicar o que não está em rascunho
   *                  seria comando que o servidor recusaria;
   *   - `deactivate` exige linhaça ATIVA; `activate` exige linhaça INATIVA.
   *
   * Não há máquina de estados inventada: são 2 estados de linhaça que o contrato já nomeia
   * (`CATALOG_LINEAGE_STATUSES`) e a presença/ausência de rascunho. A barreira da direita é a
   * capability do ator. Comando só aparece na INTERSEÇÃO.
   */
  const availableCommands = useMemo<CatalogCommand[]>(() => {
    if (detailState.phase !== 'ready') {
      return [];
    }
    const { definition, versions } = detailState;
    const draft = versions.find((version) => version.status === VERSION_STATUSES.Draft) ?? null;
    const commands: CatalogCommand[] = [];
    if (capabilities.canPublish && draft) {
      commands.push('publish');
    }
    if (definition.status === CATALOG_LINEAGE_STATUSES.Active && capabilities.canDeactivate) {
      commands.push('deactivate');
    }
    if (definition.status === CATALOG_LINEAGE_STATUSES.Inactive && capabilities.canActivate) {
      commands.push('activate');
    }
    return commands;
  }, [capabilities, detailState]);

  const reasonRequired = availableCommands.some((command) =>
    COMMANDS_REQUIRING_REASON.includes(command),
  );
  const reasonMissing = reasonRequired && commandReason.trim() === '';

  const runContextCommand = useCallback(
    async (command: CatalogCommand) => {
      if (detailState.phase !== 'ready') {
        return;
      }
      const { definition, versions } = detailState;
      const lineageVersion = definition.version;
      const reason = commandReason.trim();
      /* O contrato exige motivo na inativação: sem ele o comando não é enviado. */
      if (command === 'deactivate' && reason === '') {
        setCommandError('Informe o motivo da inativação.');
        return;
      }
      setCommandBusy(true);
      setCommandError(null);
      setCommandDone(null);
      try {
        if (command === 'publish') {
          const draft =
            versions.find((version) => version.status === VERSION_STATUSES.Draft) ?? null;
          if (!draft) {
            setCommandError('Não há rascunho para publicar.');
            return;
          }
          await publishServiceDefinitionVersion(definition.id, draft.version, { lineageVersion });
        } else if (command === 'deactivate') {
          await deactivateServiceDefinition(definition.id, { lineageVersion, reason });
        } else {
          await activateServiceDefinition(definition.id, { lineageVersion });
        }
        setCommandReason('');
        setCommandDone(COMMAND_DONE_LABEL[command]);
        /*
         * Recarrega a linhaça E a lista: a linha da grade precisa refletir o novo estado, senão a
         * fila continuaria afirmando o estado anterior ao comando bem-sucedido.
         */
        const [refreshed, refreshedVersions] = await Promise.all([
          getServiceDefinition(definition.id),
          listServiceDefinitionVersions(definition.id),
        ]);
        setDetailState({ phase: 'ready', definition: refreshed, versions: refreshedVersions });
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof CatalogApiError
            ? mapCatalogErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, detailState],
  );

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
      <div data-region="operating-header">
      <WorklistHeader
        title="Catálogo de serviços"
        /*
         * CONTAGEM = o que o contrato desta lista publica.
         *
         * VERIFICADO NO CONTRATO (não presumido): `ServiceDefinitionListResponse` é
         * `{ items, limit, offset }` — NÃO existe `total`. O número ao lado do título é a contagem
         * DESTA PÁGINA, e o escopo precisa estar escrito: número solto ao lado do título de uma
         * worklist lê como total do portfólio.
         */
        count={listState.items.length}
        context={`Página ${pageNumber} — portfólio contratável com a versão vigente e o rascunho de cada definição. Esta lista não publica total; a contagem acima e os indicadores abaixo são desta página.`}
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/catalog/new">Nova definição</ModulePrimaryLink>
          ) : null
        }
        metrics={
          listState.items.length > 0 ? (
            <>
              {/*
                ESCOPO DA FAIXA, declarado UMA vez para o conjunto: os três números saem da página
                carregada, e cada chip é lido junto do rótulo da faixa. É a diferença entre "resumo
                local declarado" e "amostra apresentada como portfólio".
              */}
              <span className="cisne-meta-label mr-2 self-center">Indicadores desta página</span>
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
      </div>

      {/*
        VISÕES SALVAS ANTES DA SUPERFÍCIE DE FILTRO.
        Gramática: OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE. A ordem estava
        invertida nesta tela (filtro antes de visões salvas), o que quebra a leitura da família de
        worklists: primeiro o RECORTE SALVO, depois o recorte ad-hoc.
      */}
      <div data-region="saved-view-surface">
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
      </div>

      <div data-region="command-filter-surface">
      <WorklistFilterBar
        meta={
          <>
            {listState.items.length} de {listState.items.length} nesta página
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
      </div>

      <div data-region="worklist-master">
      {/*
        RECORTE DE VERSAO NO SERVIDOR.
        O filtro viaja junto de status, busca, limit e offset; portanto a pagina recebida ja pertence
        ao dataset filtrado. Nenhuma definicao da pagina seguinte e escondida por filtro local.
      */}
      {listState.items.length === 0 ? (
        <WorklistStatePanel
          title={
            versionFilter
              ? 'Nenhuma definição corresponde ao recorte de versão.'
              : 'Nenhuma definição encontrada para os filtros selecionados.'
          }
          description={
            versionFilter
              ? 'O servidor não encontrou definições para este status de versão e os demais filtros.'
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
              {listState.items.map((definition) => (
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

      {listState.items.length > 0 ? (
        <WorklistFooter
          rangeLabel={`${offset + 1}–${offset + listState.items.length} nesta página`}
          extra={
            listState.items.length !== listState.items.length
              ? `${listState.items.length} após o recorte de versão`
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
      ) : null}
      </div>

      {/*
        CONTEXT REGION AUTORITATIVA — decidir sobre a definição sem sair da fila.

        ANTES: o painel era alimentado pela LINHA e oferecia apenas um link "Abrir ficha" — ou seja,
        nenhum comando. A linha é PROJEÇÃO da listagem: agir sobre ela seria agir sobre estado
        possivelmente velho, e o backend responderia conflito de versão sem o operador entender por quê.

        AGORA: selecionar re-lê a linhaça (`getServiceDefinition`) e as versões
        (`listServiceDefinitionVersions`). Os fatos exibidos e os comandos oferecidos saem DESSA
        leitura, e o comando só aparece na interseção entre o estado que o servidor publica e a
        capability do ator. A inativação exige motivo porque `DeactivateDefinitionPayload.reason` é
        obrigatório no contrato — e quem o escreve é o OPERADOR, nunca a tela.

        A FILA NÃO DESMONTA: filtros, recorte de versão, página e scroll permanecem; o único
        `loading` é o do painel.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={detailState.phase === 'ready'
          ? (detailState.definition.name ?? detailState.definition.code)
          : (selected?.name ?? selected?.code ?? 'Serviço')}
        onClose={() => setSelected(null)}
        crossReferences={
          detailState.phase === 'ready' ? catalogCrossReferences(detailState.definition) : []
        }
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">{selected.code}</p>
          ) : null}

          {detailState.phase === 'loading' ? (
            <div aria-busy="true" role="status" className="flex flex-col gap-1.5">
              <span className="cisne-type-helper">Carregando contexto…</span>
              <Skeleton lines={4} />
            </div>
          ) : null}

          {detailState.phase === 'error' ? (
            <p className="cisne-type-body m-0 text-red-700" role="alert">
              {detailState.message}
            </p>
          ) : null}

          {detailState.phase === 'ready'
            ? (() => {
                const { definition, versions } = detailState;
                const draft =
                  versions.find((version) => version.status === VERSION_STATUSES.Draft) ?? null;
                return (
                  <>
                    <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                      <dt className="cisne-meta-label pt-0.5">Linhaça</dt>
                      <dd className="cisne-meta-value m-0">
                        <ServiceDefinitionStatusBadge status={definition.status} />
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Categoria</dt>
                      <dd className="cisne-meta-value m-0 truncate">
                        {definition.categoryName ?? 'Sem categoria'}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Versão vigente</dt>
                      <dd className="cisne-meta-value m-0">
                        {definition.latestPublishedVersion !== null
                          ? `v${definition.latestPublishedVersion} publicada`
                          : 'Nenhuma publicada'}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Rascunho</dt>
                      <dd className="cisne-meta-value m-0">
                        {draft
                          ? `v${draft.version} em rascunho`
                          : definition.currentDraftVersion !== null
                            ? `v${definition.currentDraftVersion} (situação não publicável)`
                            : 'Sem rascunho'}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Próxima ação</dt>
                      <dd className="cisne-meta-value m-0">{resolveCatalogNextAction(definition)}</dd>
                    </dl>

                    <div className="cisne-divider--top mt-2 pt-2">
                      {availableCommands.length > 0 ? (
                        <>
                          {reasonRequired ? (
                            <label className="mb-1 block">
                              <span className="cisne-meta-label mb-0.5 block">
                                Motivo da inativação (obrigatório neste contrato)
                              </span>
                              <textarea
                                rows={2}
                                className="w-full rounded-md border-0 bg-white px-1.5 py-1 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                                value={commandReason}
                                onChange={(event) => setCommandReason(event.target.value)}
                                placeholder="Descreva o motivo da inativação"
                              />
                            </label>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-1.5">
                            {availableCommands.map((command) => (
                              <Button
                                key={command}
                                variant={command === 'publish' ? 'primary' : 'secondary'}
                                loading={commandBusy}
                                disabled={
                                  commandBusy ||
                                  (COMMANDS_REQUIRING_REASON.includes(command) && reasonMissing)
                                }
                                onClick={() => void runContextCommand(command)}
                              >
                                {COMMAND_LABEL[command]}
                              </Button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="cisne-type-helper m-0">
                          Nenhum comando disponível para o seu acesso nesta linhaça.
                        </p>
                      )}

                      {commandDone ? (
                        <p className="cisne-type-helper m-0 mt-1.5 text-emerald-700" role="status">
                          {commandDone}
                        </p>
                      ) : null}
                      {commandError ? (
                        <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                          {commandError}
                        </p>
                      ) : null}
                    </div>

                    {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
                    <div className="cisne-divider--top mt-2 pt-2">
                      <Button
                        variant="secondary"
                        onClick={() => void navigate(`/app/catalog/${definition.id}`)}
                      >
                        Abrir ficha completa
                      </Button>
                    </div>
                  </>
                );
              })()
            : null}
        </div>
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
