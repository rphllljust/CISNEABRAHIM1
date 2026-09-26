import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { mapAssetErrorToMessage } from '../../assets/api/asset-error-messages';
import { AssetsApiError } from '../../assets/api/physical-assets-api';
import { AssetLifecycleStatusBadge } from '../../assets/components/AssetLifecycleStatusBadge';
import { AssetOperationalStatusCell } from '../../assets/components/AssetOperationalStatusCell';
import { AssetRowActions } from '../../assets/components/AssetRowActions';
import { AssetSummaryStrip } from '../../assets/components/AssetSummaryStrip';
import { useAssetCapabilities, useAssetResourceTypes } from '../../assets/hooks/useAssetCapabilities';
import {
  ASSET_LIFECYCLE_STATUSES,
  ASSET_OPERATIONAL_AVAILABILITIES,
  VEHICLE_CLASSIFICATION,
  type AssetLifecycleStatus,
  type AssetOperationalAvailability,
  type PhysicalAsset,
  type PhysicalAssetListSummary,
} from '../../assets/types/physical-asset.types';
import { formatAssetPaginationRange } from '../../assets/utils/asset-operational-status';
import { getFleetSummary, listFleetVehicles } from '../api/fleet-api';
import { EmptyState } from '../../ui';
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

export function FleetListPage() {
  const navigate = useNavigate();
  const { capabilities } = useAssetCapabilities();
  const { resourceTypes } = useAssetResourceTypes();
  const vehicleTypes = resourceTypes.filter(
    (type) => type.classification === VEHICLE_CLASSIFICATION,
  );
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
          listFleetVehicles(
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
          getFleetSummary(scopedFilters, signal),
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
          message: 'Não foi possível carregar a frota.',
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
      <ModulePage>
        <ModuleLoadingState title="Frota" message="Carregando veículos…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Frota"
        message="Você não tem permissão para listar veículos da frota."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Frota"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModulePage>
    );
  }

  const readyState =
    listState.phase === 'ready'
      ? listState
      : { items: [], offset: 0, total: 0, hasMore: false };
  const { items, offset, total, hasMore } = readyState;
  const filtersActive = Boolean(
    lifecycleFilter || availabilityFilter || resourceTypeFilter || search.trim(),
  );
  const isEmptyList = total === 0 && !filtersActive;
  const isEmptyFiltered = total === 0 && filtersActive;
  const rangeLabel = formatAssetPaginationRange(offset, PAGE_SIZE, items.length, total).replace(
    'ativos',
    'veículos',
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Frota"
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/assets/new">Novo veículo</ModulePrimaryLink>
          ) : null
        }
      />

      <p className="mb-4 text-sm text-gray-600">
        Visão operacional dos veículos cadastrados como ativos físicos. Identificação, placa,
        situação cadastral e disponibilidade refletem alocações em ordens de serviço.
      </p>

      <AssetSummaryStrip
        summary={summary}
        activeAvailabilityFilter={availabilityFilter}
        onSelectAvailability={setAvailabilityFilter}
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2 lg:col-span-1">
            <label className={filterLabelClass} htmlFor="fleet-search">
              Buscar
            </label>
            <input
              id="fleet-search"
              type="search"
              className={filterControlClass}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Código, nome ou placa"
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fleet-lifecycle-filter">
              Status cadastral
            </label>
            <select
              id="fleet-lifecycle-filter"
              className={filterControlClass}
              value={lifecycleFilter}
              onChange={(event) =>
                setLifecycleFilter(event.target.value as '' | AssetLifecycleStatus)
              }
            >
              <option value="">Todos</option>
              <option value={ASSET_LIFECYCLE_STATUSES.Active}>Ativo</option>
              <option value={ASSET_LIFECYCLE_STATUSES.Inactive}>Inativo</option>
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fleet-availability-filter">
              Disponibilidade
            </label>
            <select
              id="fleet-availability-filter"
              className={filterControlClass}
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
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fleet-type-filter">
              Tipo de veículo
            </label>
            <select
              id="fleet-type-filter"
              className={filterControlClass}
              value={resourceTypeFilter}
              onChange={(event) => setResourceTypeFilter(event.target.value)}
            >
              <option value="">Todos</option>
              {vehicleTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterCard>

      {listState.phase === 'loading' ? (
        <p className="text-sm text-gray-500" aria-busy="true" aria-live="polite">
          Atualizando listagem…
        </p>
      ) : null}

      {isEmptyList ? (
        <EmptyState title="Nenhum veículo cadastrado na frota." />
      ) : null}

      {isEmptyFiltered ? (
        <EmptyState title="Nenhum veículo encontrado para os filtros selecionados." />
      ) : null}

      {items.length > 0 ? (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista da frota">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Código
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Placa
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Nome
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Tipo
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Cadastro
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Disponibilidade
                </th>
                <th scope="col" className={cn(moduleTableHeaderCellClass, 'w-16 text-right')}>
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((asset) => {
                const openDetail = () => {
                  void navigate(`/app/assets/${asset.id}`);
                };

                return (
                  <tr
                    key={asset.id}
                    className={cn(moduleTableRowClass, 'cursor-pointer')}
                    tabIndex={0}
                    onClick={openDetail}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openDetail();
                      }
                    }}
                  >
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink
                        to={`/app/assets/${asset.id}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {asset.assetCode}
                      </ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>{asset.vehicle?.plate ?? '—'}</td>
                    <td className={moduleTableCellClass}>{asset.name}</td>
                    <td className={moduleTableCellClass}>{asset.resourceTypeCode}</td>
                    <td className={moduleTableCellClass}>
                      <AssetLifecycleStatusBadge status={asset.lifecycleStatus} />
                    </td>
                    <td className={moduleTableCellClass}>
                      <AssetOperationalStatusCell asset={asset} />
                    </td>
                    <td
                      className={cn(moduleTableCellClass, 'text-right')}
                      onClick={(event) => event.stopPropagation()}
                      onKeyDown={(event) => event.stopPropagation()}
                    >
                      <AssetRowActions
                        asset={asset}
                        canRead={capabilities.canRead}
                        canUpdate={capabilities.canUpdate}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ModuleTableCard>
      ) : null}

      {total > 0 ? (
        <ModulePagination
          pageNumber={Math.floor(offset / PAGE_SIZE) + 1}
          rangeLabel={rangeLabel}
          previousDisabled={offset === 0 || listState.phase === 'loading'}
          nextDisabled={!hasMore || listState.phase === 'loading'}
          onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => void loadPage(offset + PAGE_SIZE)}
        />
      ) : null}
    </ModulePage>
  );
}
