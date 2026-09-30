import { useCallback, useEffect, useState } from 'react';
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

export function FleetListPage() {
  const { capabilities } = useAssetCapabilities();
  const { resourceTypes } = useAssetResourceTypes();
  const vehicleTypes = resourceTypes.filter(
    (type) => type.classification === VEHICLE_CLASSIFICATION,
  );
  /**
   * De-para slug tecnico -> rotulo humano, montado do catalogo autorizado de tipos de recurso
   * que a API ja publica. Nao ha dicionario local: se o catalogo nao trouxer o rotulo, a grade
   * mantem o codigo em vez de inventar um nome.
   */
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
      <ModuleStatePage title="Frota">
        <ModuleLoadingState message="Carregando veículos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Frota">
        <ModuleDeniedState
        message="Você não tem permissão para listar veículos da frota."
      />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Frota">
        <ModuleErrorState
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(0)}
      />
      </ModuleStatePage>
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
      <WorklistHeader
        title="Frota"
        count={total}
        context="Disponibilidade operacional dos veículos cadastrados como ativos físicos, refletindo as alocações em ordens de serviço."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/assets/new">Novo veículo</ModulePrimaryLink>
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

      <WorklistFilterBar meta={rangeLabel}>
        <WorklistField label="Buscar" htmlFor="fleet-search" grow>
          <input
            id="fleet-search"
            type="search"
            className={worklistSelectClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Código, nome ou placa"
          />
        </WorklistField>
        <WorklistField label="Cadastro" htmlFor="fleet-lifecycle-filter">
          <select
            id="fleet-lifecycle-filter"
            className={worklistSelectClass}
            value={lifecycleFilter}
            onChange={(event) => setLifecycleFilter(event.target.value as '' | AssetLifecycleStatus)}
          >
            <option value="">Todos</option>
            <option value={ASSET_LIFECYCLE_STATUSES.Active}>Ativo</option>
            <option value={ASSET_LIFECYCLE_STATUSES.Inactive}>Inativo</option>
          </select>
        </WorklistField>
        <WorklistField label="Disponibilidade" htmlFor="fleet-availability-filter">
          <select
            id="fleet-availability-filter"
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
        <WorklistField label="Tipo" htmlFor="fleet-type-filter">
          <select
            id="fleet-type-filter"
            className={worklistSelectClass}
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

      {isEmptyList ? (
        <EmptyState title="Nenhum veículo cadastrado na frota." />
      ) : null}

      {isEmptyFiltered ? (
        <EmptyState title="Nenhum veículo encontrado para os filtros selecionados." />
      ) : null}

      {items.length > 0 ? (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista da frota">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Código
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Placa
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
                    <WorklistRowLink href={`/app/assets/${asset.id}`}>
                      {asset.assetCode}
                    </WorklistRowLink>
                    {asset.vehicle?.plate ? (
                      <p className="text-[11px] text-gray-500">Placa {asset.vehicle.plate}</p>
                    ) : null}
                  </td>
                  <td className={worklistCellRaisedClass}>{asset.name}</td>
                  <td className={worklistCellRaisedClass}>
                    {/*
                      LABEL HUMANO DO TIPO. `resourceTypeCode` e um slug tecnico
                      (`TRUCK`, `WATER_TRUCK`); a grade mostrava o slug. O catalogo autorizado
                      de tipos de recurso ja publicado pela API traz o `name`, entao a coluna
                      passa a falar a lingua do operador. Sem rotulo publicado, o codigo
                      continua como ultimo recurso — nunca um texto fabricado.
                    */}
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
