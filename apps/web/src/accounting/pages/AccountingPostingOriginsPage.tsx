import { useCallback, useEffect, useState } from 'react';
import { Button, DateTime, EmptyState, Money } from '../../ui';
import {
  FilterCard,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
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
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { listPostingRequests } from '../api/accounting-api';
import { mapAccountingErrorToMessage } from '../api/accounting-error-messages';
import { SavedViewsBar, useSmartList } from '../../operator';
import type { PostingRequestListItem, PostingRequestPage } from '../types/accounting.types';

const PAGE_SIZE = 25;
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Pendente',
  POSTED: 'Lançado',
  REJECTED: 'Rejeitado',
};

/**
 * Eventos de negocio que geram lancamento a partir de uma regra de lancamento publicada.
 * Vocabulario fechado do dominio (acc.posting_event_kind) — o filtro usa exatamente os
 * valores persistidos, sem lista inventada na tela.
 */
const EVENT_KINDS = [
  '',
  'RECEIVABLE_RECOGNIZED',
  'SETTLEMENT_CONFIRMED',
  'PAYABLE_RECOGNIZED',
  'PAYMENT_CONFIRMED',
  'FISCAL_DOCUMENT_AUTHORIZED',
  'FISCAL_DOCUMENT_CANCELLED',
  'TAX_CALCULATION_CONFIRMED',
  'INVENTORY_MOVEMENT_POSTED',
  'PAYROLL_CLOSED',
  'PAYROLL_REOPENED',
  'FIXED_ASSET_ACQUIRED',
  'FIXED_ASSET_DISPOSED',
  'FIXED_ASSET_TRANSFERRED',
  'FIXED_ASSET_DEPRECIATED',
] as const;

const EVENT_LABELS: Record<string, string> = {
  RECEIVABLE_RECOGNIZED: 'Título a receber reconhecido',
  SETTLEMENT_CONFIRMED: 'Recebimento confirmado',
  PAYABLE_RECOGNIZED: 'Título a pagar reconhecido',
  PAYMENT_CONFIRMED: 'Pagamento confirmado',
  FISCAL_DOCUMENT_AUTHORIZED: 'Documento fiscal autorizado',
  FISCAL_DOCUMENT_CANCELLED: 'Documento fiscal cancelado',
  TAX_CALCULATION_CONFIRMED: 'Apuração tributária confirmada',
  INVENTORY_MOVEMENT_POSTED: 'Movimento de estoque lançado',
  PAYROLL_CLOSED: 'Folha fechada',
  PAYROLL_REOPENED: 'Folha reaberta',
  FIXED_ASSET_ACQUIRED: 'Imobilizado adquirido',
  FIXED_ASSET_DISPOSED: 'Imobilizado baixado',
  FIXED_ASSET_TRANSFERRED: 'Imobilizado transferido',
  FIXED_ASSET_DEPRECIATED: 'Imobilizado depreciado',
};

const ORIGIN_LABELS: Record<string, string> = {
  FINANCE: 'Financeiro',
  FISCAL: 'Fiscal',
  INVENTORY: 'Estoque',
  PAYROLL: 'Folha',
  FIXED_ASSET: 'Imobilizado',
};

/** Escopo estavel de persistencia das visoes salvas desta tela. */
const SCOPE = 'accounting.posting-origins';

/** Allow-list: somente valores enumerados que a propria tela oferece. */
const POSTING_ORIGINS_ALLOWED_FILTERS = {
  filters: {
    status: ['POSTED', 'PENDING', 'REJECTED'],
    eventKind: EVENT_KINDS.filter((value) => value !== ''),
  },
} as const;

/**
 * Visoes embutidas derivadas do trabalho real da tela: evento confirmado que ainda nao
 * virou lancamento (pendente) e evento recusado pela regra publicada. Nenhuma regra
 * contabil e criada aqui — apenas recorte sobre o que o servidor ja devolveu.
 */
const POSTING_ORIGINS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.posting.pending',
    name: 'Pendentes de lançamento',
    description: 'Evento de negócio confirmado que ainda não gerou lançamento contábil.',
    config: { filters: { status: 'PENDING' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
  {
    id: 'builtin.posting.rejected',
    name: 'Recusados pela regra',
    description: 'Evento confirmado que a regra publicada recusou.',
    config: { filters: { status: 'REJECTED' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; page: PostingRequestPage };

export function AccountingPostingOriginsPage() {
  const { units, unitId, setUnitId } = useOperationalUnits();
  const [occurredFrom, setOccurredFrom] = useState('');
  const [occurredTo, setOccurredTo] = useState('');
  const [page, setPage] = useState(0);
  const [state, setState] = useState<ListState>({ phase: 'loading' });

  // ADOCAO DE MECANISMO: situacao e evento de origem passam a viver na URL e em visao
  // salva. A fila "Pendente" e trabalho real — evento de negocio confirmado que ainda
  // NAO gerou lancamento — e agora e um recorte compartilhavel, nao um clique manual.
  // A unidade continua no hook compartilhado de unidades operacionais.
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: POSTING_ORIGINS_BUILT_IN_VIEWS,
    allowedFilters: POSTING_ORIGINS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const status = smartList.filters.status ?? '';
  const eventKind = smartList.filters.eventKind ?? '';

  const clearPagingOnFilter = useCallback((key: string, value: string) => {
    smartList.setFilter(key, value);
    setPage(0);
  }, [smartList]);

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!unitId) {
        setState({
          phase: 'ready',
          page: {
            unitId: '',
            page: 0,
            pageSize: PAGE_SIZE,
            total: 0,
            totalPages: 0,
            statusCounts: {},
            items: [],
          },
        });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await listPostingRequests(
          {
            unitId,
            status: status || undefined,
            eventKind: eventKind || undefined,
            occurredFrom: occurredFrom || undefined,
            occurredTo: occurredTo || undefined,
            page,
            pageSize: PAGE_SIZE,
          },
          signal,
        );
        setState({ phase: 'ready', page: response });
      } catch (error) {
        setState({
          phase: 'error',
          message: mapAccountingErrorToMessage(
            (error as { code?: string }).code,
            (error as { status?: number }).status ?? 0,
          ),
          retryable: true,
        });
      }
    },
    [eventKind, occurredFrom, occurredTo, page, status, unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const data = state.phase === 'ready' ? state.page : null;
  const hasMore = data ? (data.page + 1) * PAGE_SIZE < data.total : false;
  const posted = data?.statusCounts.POSTED ?? 0;
  const pending = data?.statusCounts.PENDING ?? 0;
  const rejected = data?.statusCounts.REJECTED ?? 0;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Origem dos lançamentos"
        description="Cada linha liga um evento de negócio já confirmado ao lançamento contábil gerado pela regra publicada. Esta tela não cria nem altera lançamentos."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label className={filterLabelClass} htmlFor="posting-unit-filter">
              Unidade
            </label>
            <select
              id="posting-unit-filter"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setPage(0);
              }}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}

              {units.map((unit, index) => (

                <option key={unit} value={unit}>

                  Unidade {index + 1}

                </option>

              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="posting-status-filter">
              Situação
            </label>
            <select
              id="posting-status-filter"
              className={filterControlClass}
              value={status}
              onChange={(event) => clearPagingOnFilter('status', event.target.value)}
            >
              <option value="">Todas</option>
              <option value="POSTED">Lançado</option>
              <option value="PENDING">Pendente</option>
              <option value="REJECTED">Rejeitado</option>
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="posting-event-filter">
              Evento de origem
            </label>
            <select
              id="posting-event-filter"
              className={filterControlClass}
              value={eventKind}
              onChange={(event) => clearPagingOnFilter('eventKind', event.target.value)}
            >
              {EVENT_KINDS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value === '' ? 'Todos' : (EVENT_LABELS[value] ?? value)}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="posting-from-filter">
              Ocorrido de
            </label>
            <input
              id="posting-from-filter"
              type="date"
              className={filterControlClass}
              value={occurredFrom}
              onChange={(event) => {
                setOccurredFrom(event.target.value);
                setPage(0);
              }}
            />
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="posting-to-filter">
              Ocorrido até
            </label>
            <input
              id="posting-to-filter"
              type="date"
              className={filterControlClass}
              value={occurredTo}
              onChange={(event) => {
                setOccurredTo(event.target.value);
                setPage(0);
              }}
            />
          </div>
        </div>
      </FilterCard>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          smartList.applyView(view);
          setPage(0);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={Object.keys(smartList.filters).length > 0}
        allLabel="Todas"
        className="mb-4"
      />

      {data ? (
        <p className="mb-6 text-sm text-text-secondary">
          Lançados: <strong>{posted}</strong> · Pendentes: <strong>{pending}</strong> · Rejeitados:{' '}
          <strong>{rejected}</strong>
        </p>
      ) : null}

      {state.phase === 'loading' ? (
        <ModuleLoadingState title="Origem dos lançamentos" message="Carregando eventos lançados…" />
      ) : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Origem dos lançamentos"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {data && data.items.length === 0 ? (
        <>
          <EmptyState
            title={smartList.isFiltered ? 'Nenhum evento para o recorte atual' : 'Nenhum evento lançado'}
            description={
              smartList.isFiltered
                ? 'Os filtros aplicados não retornam evento de negócio nesta unidade. Limpe o recorte para ver a rastreabilidade completa.'
                : 'Não há eventos de negócio lançados para a unidade selecionada.'
            }
          />
          {smartList.isFiltered ? (
            <div className="mt-3">
              <Button
                variant="secondary"
                onClick={() => {
                  smartList.clearFilters();
                  setPage(0);
                }}
              >
                Limpar filtros
              </Button>
            </div>
          ) : null}
        </>
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Origem dos lançamentos contábeis">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Ocorrido em
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Origem
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Evento
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Referência
                  </th>
                  <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                    Valor
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Lançamento
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: PostingRequestListItem) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <DateTime value={item.occurredOn} mode="date" />
                    </td>
                    <td className={moduleTableCellClass}>
                      {ORIGIN_LABELS[item.originKind] ?? item.originKind}
                    </td>
                    <td className={`${moduleTableCellClass} whitespace-normal`}>
                      {EVENT_LABELS[item.eventKind] ?? item.eventKind}
                    </td>
                    <td className={`${moduleTableCellClass} whitespace-normal`}>
                      {item.sourceReference}
                    </td>
                    <td className={`${moduleTableCellClass} text-right`}>
                      <Money value={item.amount} currencyCode={item.currencyCode} />
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={STATUS_LABELS} />
                    </td>
                    <td className={moduleTableCellClass}>
                      {item.journalEntryId ? (
                        <ModuleTableLink to={`/app/accounting/journals/${item.journalEntryId}`}>
                          {item.journalEntryNumber ? `#${item.journalEntryNumber}` : 'Ver lançamento'}
                        </ModuleTableLink>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>

          <ModulePagination
            pageNumber={data.page + 1}
            previousDisabled={data.page === 0}
            nextDisabled={!hasMore}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </>
      ) : null}
    </ModulePage>
  );
}
