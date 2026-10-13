import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mapAssetErrorToMessage } from '../api/asset-error-messages';
import {
  activatePhysicalAsset,
  AssetsApiError,
  deactivatePhysicalAsset,
  getPhysicalAsset,
  getPhysicalAssetSummary,
  listPhysicalAssets,
} from '../api/physical-assets-api';
import { AssetLifecycleStatusBadge } from '../components/AssetLifecycleStatusBadge';
import { AssetOperationalStatusCell } from '../components/AssetOperationalStatusCell';
import { AssetSummaryStrip } from '../components/AssetSummaryStrip';
import { useAssetCapabilities, useAssetResourceTypes } from '../hooks/useAssetCapabilities';
import {
  ASSET_LIFECYCLE_STATUSES,
  ASSET_OPERATIONAL_AVAILABILITIES,
  type AssetLifecycleStatus,
  type AssetOperationalAvailability,
  type PhysicalAsset,
  type PhysicalAssetListSummary,
} from '../types/physical-asset.types';
import { formatAssetPaginationRange } from '../utils/asset-operational-status';
import { DynamicContextDrawer, DynamicSavedViewsBar, useSavedViews } from '../../engine';
import { useOptionalIdentityId } from '../../auth/context/AuthProvider';
import { Button } from '../../ui/Button';
import { DateTime } from '../../ui';
import { Skeleton } from '../../ui/Skeleton';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
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
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

/**
 * COMANDOS DE ESTADO DO ATIVO — os dois que o contrato publica.
 *
 * `deactivatePhysicalAsset` / `activatePhysicalAsset` recebem apenas o `version` (concorrência
 * otimista). O contrato NÃO pede motivo: a tela não inventa texto de auditoria nem exige campo que
 * o backend não exige.
 */
type AssetCommand = 'deactivate' | 'activate';

const COMMAND_LABEL: Record<AssetCommand, string> = {
  deactivate: 'Inativar ativo',
  activate: 'Reativar ativo',
};

const COMMAND_DONE_LABEL: Record<AssetCommand, string> = {
  deactivate: 'Ativo inativado.',
  activate: 'Ativo reativado.',
};

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | {
      phase: 'ready';
      items: PhysicalAsset[];
      offset: number;
      total: number;
      hasMore: boolean;
    };

function hasActiveFilters(input: {
  lifecycleFilter: '' | AssetLifecycleStatus;
  availabilityFilter: '' | AssetOperationalAvailability;
  resourceTypeFilter: string;
  search: string;
}): boolean {
  return Boolean(
    input.lifecycleFilter ||
      input.availabilityFilter ||
      input.resourceTypeFilter ||
      input.search.trim(),
  );
}

export function PhysicalAssetsListPage() {
  const { capabilities } = useAssetCapabilities();
  const { resourceTypes } = useAssetResourceTypes();
  /** De-para slug tecnico -> rotulo humano, do proprio catalogo autorizado de tipos. */
  const typeNameByCode = new Map(resourceTypes.map((type) => [type.code, type.name]));
  const [lifecycleFilter, setLifecycleFilter] = useState<'' | AssetLifecycleStatus>('');
  const [availabilityFilter, setAvailabilityFilter] = useState<'' | AssetOperationalAvailability>(
    '',
  );
  const [resourceTypeFilter, setResourceTypeFilter] = useState('');
  const [search, setSearch] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [summary, setSummary] = useState<PhysicalAssetListSummary | null>(null);
  /*
   * CONTEXTO AUTORITATIVO — a linha é projeção da listagem. O painel re-lê o ativo
   * (`getPhysicalAsset`) no momento da seleção, e é dessa leitura que saem os fatos exibidos, o
   * `version` usado nos comandos e a decisão de quais comandos oferecer.
   */
  const [selected, setSelected] = useState<PhysicalAsset | null>(null);
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; asset: PhysicalAsset }
  >({ phase: 'idle' });
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandDone, setCommandDone] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  /*
   * VISÕES SALVAS — agora usando a leitura OPCIONAL de identidade já consolidada no shell.
   *
   * Sem identidade, a engine não persiste nem lê visões; com identidade, o recorte operacional
   * completo (busca + cadastro + disponibilidade + tipo) pode ser retomado sem reconstrução manual.
   * Não existe namespace compartilhado "anonymous".
   */
  const savedViews = useSavedViews(useOptionalIdentityId(), 'physical-assets');
  const navigate = useNavigate();

  const loadPage = useCallback(
    async (offset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const scopedFilters = {
          resourceTypeId: resourceTypeFilter || undefined,
        };
        const [response, summaryResponse] = await Promise.all([
          listPhysicalAssets(
            {
              limit: PAGE_SIZE,
              offset,
              lifecycleStatus: lifecycleFilter || undefined,
              availability: availabilityFilter || undefined,
              resourceTypeId: resourceTypeFilter || undefined,
              q: search.trim() || undefined,
            },
            signal,
          ),
          getPhysicalAssetSummary(scopedFilters, signal),
        ]);
        setSummary(summaryResponse);
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          total: response.total,
          hasMore: response.offset + response.items.length < response.total,
        });
      } catch (error) {
        if (error instanceof AssetsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapAssetErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os ativos.',
          retryable: true,
        });
      }
    },
    [availabilityFilter, lifecycleFilter, resourceTypeFilter, search],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, controller.signal);
    return () => controller.abort();
  }, [loadPage, reloadToken]);

  const selectedId = selected?.id ?? null;

  /* CARREGAMENTO LOCALIZADO DO CONTEXTO — só o painel espera; a fila permanece montada. */
  useEffect(() => {
    if (!selectedId) {
      setDetailState({ phase: 'idle' });
      setCommandError(null);
      setCommandDone(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    setCommandDone(null);
    void getPhysicalAsset(selectedId, controller.signal)
      .then((asset) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', asset });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto do ativo.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId, reloadToken]);

  /**
   * COMANDOS DISPONÍVEIS — interseção entre o estado que o servidor publica e a capability do ator.
   *
   * O contrato não publica tabela de transições: a barreira da esquerda é o próprio
   * `lifecycleStatus` (o único estado de cadastro que o domínio nomeia), e a da direita é
   * `capabilities.can{Deactivate,Activate}`. Inativar um ativo já inativo, ou reativar um já ativo,
   * seria comando que o servidor recusaria.
   */
  const availableCommands = useMemo<AssetCommand[]>(() => {
    if (detailState.phase !== 'ready') {
      return [];
    }
    const commands: AssetCommand[] = [];
    if (
      detailState.asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Active &&
      capabilities.canDeactivate
    ) {
      commands.push('deactivate');
    }
    if (
      detailState.asset.lifecycleStatus === ASSET_LIFECYCLE_STATUSES.Inactive &&
      capabilities.canActivate
    ) {
      commands.push('activate');
    }
    return commands;
  }, [capabilities, detailState]);

  const runContextCommand = useCallback(
    async (command: AssetCommand) => {
      if (detailState.phase !== 'ready') {
        return;
      }
      const asset = detailState.asset;
      setCommandBusy(true);
      setCommandError(null);
      setCommandDone(null);
      try {
        const updated =
          command === 'deactivate'
            ? await deactivatePhysicalAsset(asset.id, asset.version)
            : await activatePhysicalAsset(asset.id, asset.version);
        setDetailState({ phase: 'ready', asset: updated });
        setCommandDone(COMMAND_DONE_LABEL[command]);
        /* A grade precisa refletir o novo estado: sem recarregar, a linha continuaria mentindo. */
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof AssetsApiError
            ? mapAssetErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [detailState],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  if (listState.phase === 'loading' && summary === null) {
    return (
      <ModuleStatePage title="Ativos físicos">
        <ModuleLoadingState message="Carregando ativos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Ativos físicos">
        <ModuleDeniedState message="Você não tem permissão para listar ativos físicos." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Ativos físicos">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0)}
        />
      </ModuleStatePage>
    );
  }

  const readyState =
    listState.phase === 'ready' ? listState : { items: [], offset: 0, total: 0, hasMore: false };
  const { items, offset, total, hasMore } = readyState;
  const filtersActive = hasActiveFilters({
    lifecycleFilter,
    availabilityFilter,
    resourceTypeFilter,
    search,
  });
  const isEmptyList = total === 0 && !filtersActive;
  const isEmptyFiltered = total === 0 && filtersActive;
  const rangeLabel = formatAssetPaginationRange(offset, PAGE_SIZE, items.length, total);

  return (
    <ModulePage layout="wide">
      {/*
        MESMA GRAMATICA DA FROTA. Ativos e Frota listam o mesmo agregado por recortes
        diferentes; enquanto esta tela usava `FilterCard` (cartao de respiro largo) + grade
        `px-6 py-3.5`, o operador trocava de tela e mudava de produto. Os indicadores clicaveis
        sobem para a faixa `metrics` do cabecalho, os filtros vao para UMA linha densa e a grade
        passa a ser a worklist compacta. Nenhum filtro, rota, capability ou contrato mudou.

        REGIOES DECLARADAS: OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE ->
        CONTEXT REGION. A contagem aqui é AUTORITATIVA (`PhysicalAssetListResponse.total`) e o
        resumo vem de endpoint proprio (`/physical-assets/summary`), então nenhum número desta tela
        é derivado da página carregada.
      */}
      <div data-region="operating-header">
      <WorklistHeader
        title="Ativos físicos"
        count={total}
        context="Cadastro operacional dos ativos físicos e sua disponibilidade para alocação em ordens de serviço."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/assets/new">Novo ativo</ModulePrimaryLink>
          ) : null
        }
        metrics={
          <AssetSummaryStrip
            summary={summary}
            sectionLabel="Indicadores de ativos físicos"
            activeAvailabilityFilter={availabilityFilter}
            onSelectAvailability={setAvailabilityFilter}
          />
        }
      />
      </div>

      <div data-region="saved-view-surface">
        <DynamicSavedViewsBar
          views={savedViews.views}
          persistedLocally={savedViews.persistedLocally}
          persistable={savedViews.persistable}
          onSave={(name) =>
            savedViews.save(
              name,
              {
                search,
                lifecycleFilter,
                availabilityFilter,
                resourceTypeFilter,
              },
              'list',
            )
          }
          onDelete={savedViews.remove}
          onApply={(view) => {
            const nextSearch = view.filters['search'] ?? '';
            setSearchInput(nextSearch);
            setSearch(nextSearch);
            setLifecycleFilter(
              (view.filters['lifecycleFilter'] ?? '') as '' | AssetLifecycleStatus,
            );
            setAvailabilityFilter(
              (view.filters['availabilityFilter'] ?? '') as '' | AssetOperationalAvailability,
            );
            setResourceTypeFilter(view.filters['resourceTypeFilter'] ?? '');
          }}
        />
      </div>

      <div data-region="command-filter-surface">
      <WorklistFilterBar>
        <WorklistField label="Buscar" htmlFor="asset-search" grow>
          <input
            id="asset-search"
            type="search"
            className={worklistSelectClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Código, nome ou placa"
          />
        </WorklistField>
        <WorklistField label="Cadastro" htmlFor="asset-lifecycle-filter">
          <select
            id="asset-lifecycle-filter"
            className={worklistSelectClass}
            value={lifecycleFilter}
            onChange={(event) => setLifecycleFilter(event.target.value as '' | AssetLifecycleStatus)}
          >
            <option value="">Todos</option>
            <option value={ASSET_LIFECYCLE_STATUSES.Active}>Ativo</option>
            <option value={ASSET_LIFECYCLE_STATUSES.Inactive}>Inativo</option>
          </select>
        </WorklistField>
        <WorklistField label="Disponibilidade" htmlFor="asset-availability-filter">
          <select
            id="asset-availability-filter"
            className={worklistSelectClass}
            value={availabilityFilter}
            onChange={(event) =>
              setAvailabilityFilter(event.target.value as '' | AssetOperationalAvailability)
            }
          >
            <option value="">Todas</option>
            <option value={ASSET_OPERATIONAL_AVAILABILITIES.Available}>Disponível</option>
            <option value={ASSET_OPERATIONAL_AVAILABILITIES.Allocated}>Alocado</option>
            <option value={ASSET_OPERATIONAL_AVAILABILITIES.Unavailable}>Indisponível</option>
          </select>
        </WorklistField>
        <WorklistField label="Tipo" htmlFor="asset-type-filter">
          <select
            id="asset-type-filter"
            className={worklistSelectClass}
            value={resourceTypeFilter}
            onChange={(event) => setResourceTypeFilter(event.target.value)}
          >
            <option value="">Todos</option>
            {resourceTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={filtersActive}
          onClick={() => {
            setSearchInput('');
            setLifecycleFilter('');
            setAvailabilityFilter('');
            setResourceTypeFilter('');
          }}
        />
      </WorklistFilterBar>
      </div>

      <div data-region="worklist-master">
      {listState.phase === 'loading' ? (
        <p className="text-sm text-gray-500" aria-busy="true" aria-live="polite">
          Atualizando listagem…
        </p>
      ) : null}

      {isEmptyList ? (
        <WorklistStatePanel
          title="Nenhum ativo cadastrado."
          description="Os ativos físicos são o cadastro operacional de veículos, máquinas e equipamentos e sua disponibilidade para alocação em ordens de serviço. Cadastre o primeiro ativo para começar."
          action={
            capabilities.canCreate ? (
              <ModulePrimaryLink to="/app/assets/new">Novo ativo</ModulePrimaryLink>
            ) : null
          }
        />
      ) : null}

      {isEmptyFiltered ? (
        <WorklistStatePanel
          title="Nenhum ativo encontrado para os filtros selecionados."
          description="Ajuste a busca, o cadastro, a disponibilidade ou o tipo — ou limpe os filtros para ver o cadastro completo."
          action={
            <WorklistClearFilters
              visible
              onClick={() => {
                setSearchInput('');
                setLifecycleFilter('');
                setAvailabilityFilter('');
                setResourceTypeFilter('');
              }}
            />
          }
        />
      ) : null}

      {items.length > 0 ? (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de ativos físicos">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Nome
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Tipo
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cadastro
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Disponibilidade
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((asset) => (
                <tr
                  key={asset.id}
                  className={cn(worklistRowClass, 'cursor-pointer')}
                  /*
                   * CONTEXTO SEM ABANDONAR A FILA. Clicar na linha abre o painel lateral com o
                   * estado autoritativo e os comandos reais; o código continua sendo um `<a>` de
                   * verdade (nova aba, teclado, leitor de tela) para a ficha.
                   *
                   * Cliques em elementos interativos internos (o link da OS, o próprio código)
                   * seguem o comportamento deles: o guarda abaixo impede que navegar abra o painel.
                   */
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest('a, button, select, input, textarea')) {
                      return;
                    }
                    setSelected(asset);
                  }}
                >
                  <td className={worklistCellClass}>
                    {/*
                      DRILLDOWN NA LINHA INTEIRA: antes o registro so abria por `onClick` no
                      `<tr>` mais um `tabIndex`, o que nao gera link real (sem "abrir em nova
                      aba", sem menu de contexto). Agora e um `<a>` de verdade com area
                      esticada por toda a linha — mesma solucao da Frota.
                    */}
                    <WorklistRowLink href={`/app/assets/${asset.id}`}>
                      {asset.assetCode}
                    </WorklistRowLink>
                    {asset.vehicle?.plate ? (
                      <p className="text-[11px] text-gray-500">Placa {asset.vehicle.plate}</p>
                    ) : null}
                  </td>
                  <td className={worklistCellRaisedClass}>{asset.name}</td>
                  {/*
                    LABEL HUMANO DO TIPO, nao o slug. `resourceTypeCode` e tecnico
                    (`EXCAVATOR`, `WATER_TRUCK`) e era o que a grade mostrava, enquanto o
                    filtro da MESMA tela ja oferecia o nome publicado pelo catalogo
                    ("Escavadeira", "Caminhão pipa"). O de-para vem do catalogo autorizado que
                    a pagina ja carrega; sem rotulo publicado, o codigo permanece como ultimo
                    recurso — nunca um texto fabricado.
                  */}
                  <td className={worklistCellRaisedClass}>
                    {typeNameByCode.get(asset.resourceTypeCode) ?? asset.resourceTypeCode}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <AssetLifecycleStatusBadge status={asset.lifecycleStatus} />
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <AssetOperationalStatusCell asset={asset} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {total > 0 ? (
        <WorklistFooter rangeLabel={rangeLabel}>
          <ModulePagination
            pageNumber={Math.floor(offset / PAGE_SIZE) + 1}
            previousDisabled={offset === 0 || listState.phase === 'loading'}
            nextDisabled={!hasMore || listState.phase === 'loading'}
            onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
            onNext={() => void loadPage(offset + PAGE_SIZE)}
          />
        </WorklistFooter>
      ) : null}
      </div>

      {/*
        CONTEXT REGION AUTORITATIVA — decidir sobre o ativo sem sair da fila.

        ANTES: cada linha carregava um menu `···` com TRÊS itens, e os três eram `navigate(...)`
        (`Visualizar detalhes`, `Editar`, `Histórico/Alocações`). Nenhum executava comando: era
        navegação vestida de ação, repetida em toda linha — e o drillback para a ficha já existia no
        código do ativo, como link real. Enquanto isso, os comandos que o contrato PUBLICA
        (`deactivate`/`activate`) não estavam em lugar nenhum desta tela.

        AGORA: selecionar re-lê o ativo (`getPhysicalAsset`) e o painel traz os fatos autoritativos,
        o comando real de cadastro e os drillbacks — UMA vez para o registro selecionado, não oito
        vezes na grade. Nenhuma capacidade foi perdida: ficha, edição e histórico continuam
        alcançáveis; o que saiu foi a repetição.

        A FILA NÃO DESMONTA: filtros, visões salvas, página e scroll permanecem; o único `loading`
        é o do painel.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={detailState.phase === 'ready' ? detailState.asset.assetCode : (selected?.assetCode ?? 'Ativo')}
        onClose={() => setSelected(null)}
        crossReferences={[]}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {selected.name}
              {selected.vehicle?.plate ? (
                <span className="cisne-type-helper"> · Placa {selected.vehicle.plate}</span>
              ) : null}
            </p>
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
                const asset = detailState.asset;
                return (
                  <>
                    <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                      <dt className="cisne-meta-label pt-0.5">Tipo</dt>
                      <dd className="cisne-meta-value m-0 truncate">
                        {typeNameByCode.get(asset.resourceTypeCode) ?? asset.resourceTypeCode}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Cadastro</dt>
                      <dd className="cisne-meta-value m-0">
                        <AssetLifecycleStatusBadge status={asset.lifecycleStatus} />
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Disponibilidade</dt>
                      <dd className="cisne-meta-value m-0">
                        <AssetOperationalStatusCell asset={asset} />
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Atualizado</dt>
                      <dd className="cisne-meta-value m-0">
                        <DateTime value={asset.updatedAt} />
                      </dd>
                      {asset.deactivatedAt ? (
                        <>
                          <dt className="cisne-meta-label pt-0.5">Inativado em</dt>
                          <dd className="cisne-meta-value m-0">
                            <DateTime value={asset.deactivatedAt} />
                          </dd>
                        </>
                      ) : null}
                    </dl>

                    <div className="cisne-divider--top mt-2 pt-2">
                      {availableCommands.length > 0 ? (
                        <div className="flex flex-wrap items-center gap-1.5">
                          {availableCommands.map((command) => (
                            <Button
                              key={command}
                              variant={command === 'activate' ? 'primary' : 'secondary'}
                              loading={commandBusy}
                              onClick={() => void runContextCommand(command)}
                            >
                              {COMMAND_LABEL[command]}
                            </Button>
                          ))}
                        </div>
                      ) : (
                        <p className="cisne-type-helper m-0">
                          Nenhum comando de cadastro disponível para o seu acesso neste ativo.
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

                    {/* DRILLBACKS — as capacidades que o menu de linha oferecia, agora UMA vez. */}
                    <div className="cisne-divider--top mt-2 flex flex-wrap items-center gap-1.5 pt-2">
                      <Button
                        variant="secondary"
                        onClick={() => void navigate(`/app/assets/${asset.id}`)}
                      >
                        Abrir ficha completa
                      </Button>
                      {capabilities.canUpdate ? (
                        <Button
                          variant="secondary"
                          onClick={() => void navigate(`/app/assets/${asset.id}/edit`)}
                        >
                          Editar ativo
                        </Button>
                      ) : null}
                      {asset.currentAllocation ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void navigate(
                              `/app/service-orders/${asset.currentAllocation!.serviceOrderId}/planning`,
                            )
                          }
                        >
                          Histórico e alocações
                        </Button>
                      ) : null}
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
