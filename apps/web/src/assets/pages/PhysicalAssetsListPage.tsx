import { useCallback, useEffect, useState } from 'react';
import { mapAssetErrorToMessage } from '../api/asset-error-messages';
import {
  AssetsApiError,
  getPhysicalAssetSummary,
  listPhysicalAssets,
} from '../api/physical-assets-api';
import { AssetLifecycleStatusBadge } from '../components/AssetLifecycleStatusBadge';
import { AssetOperationalStatusCell } from '../components/AssetOperationalStatusCell';
import { AssetRowActions } from '../components/AssetRowActions';
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
import { EmptyState } from '../../ui/EmptyState';
import {
  RowActionCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
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
  }, [loadPage]);

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
    <ModulePage>
      {/*
        MESMA GRAMATICA DA FROTA. Ativos e Frota listam o mesmo agregado por recortes
        diferentes; enquanto esta tela usava `FilterCard` (cartao de respiro largo) + grade
        `px-6 py-3.5`, o operador trocava de tela e mudava de produto. Os indicadores clicaveis
        sobem para a faixa `metrics` do cabecalho, os filtros vao para UMA linha densa e a grade
        passa a ser a worklist compacta. Nenhum filtro, rota, capability ou contrato mudou.
      */}
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
            activeAvailabilityFilter={availabilityFilter}
            onSelectAvailability={setAvailabilityFilter}
          />
        }
      />

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

      {listState.phase === 'loading' ? (
        <p className="text-sm text-gray-500" aria-busy="true" aria-live="polite">
          Atualizando listagem…
        </p>
      ) : null}

      {isEmptyList ? <EmptyState title="Nenhum ativo cadastrado." /> : null}

      {isEmptyFiltered ? (
        <EmptyState title="Nenhum ativo encontrado para os filtros selecionados." />
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
                <th scope="col" className={cn(worklistHeadCellClass, 'w-16 text-right')}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((asset) => (
                <tr key={asset.id} className={worklistRowClass}>
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
                  <RowActionCell className="w-16">
                    <AssetRowActions
                      asset={asset}
                      canRead={capabilities.canRead}
                      canUpdate={capabilities.canUpdate}
                    />
                  </RowActionCell>
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
    </ModulePage>
  );
}
