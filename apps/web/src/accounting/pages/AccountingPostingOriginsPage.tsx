import { useCallback, useEffect, useState } from 'react';
import { DateTime, Money } from '../../ui';
import {
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  ModuleTableLink,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistCellClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
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
  const { options: unitOptions, unitId, setUnitId } = useOperationalUnits();
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
      {/*
        MESMA GRAMÁTICA DAS DEMAIS SUPERFÍCIES DA FAMÍLIA 4 — esta tela já estava próxima do
        padrão, então a intervenção é MÍNIMA e aditiva: o cabeçalho solto passa a `WorklistHeader`
        (título + total do servidor + contexto + faixa de indicadores reais), o card de filtros
        passa à barra compacta e o estado vazio passa a `WorklistStatePanel`.

        Preservados integralmente: os cinco filtros e seus valores persistidos, o
        `SavedViewsBar` com as visões embutidas e o `useSmartList` com sincronização de URL, os
        rótulos dos vocabulários fechados, o drill-down real para o lançamento e a paginação do
        servidor. Nada de visões, eventos, estados ou contadores foi removido ou reescrito.
      */}
      <WorklistHeader
        title="Origem dos lançamentos"
        count={data ? data.total : null}
        context="Cada linha liga um evento de negócio já confirmado ao lançamento contábil gerado pela regra publicada. Esta tela não cria nem altera lançamentos."
        metrics={
          data ? (
            <>
              <EnterpriseMetric label="Lançados" value={posted} />
              <EnterpriseMetric
                label="Pendentes"
                value={pending}
                tone={pending > 0 ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric
                label="Rejeitados"
                value={rejected}
                tone={rejected > 0 ? 'critical' : 'neutral'}
              />
            </>
          ) : null
        }
      />

      <WorklistFilterBar
        meta={
          data
            ? `Página ${data.page + 1} de ${Math.max(data.totalPages, 1)} · ${data.total} evento(s)`
            : undefined
        }
      >
        <WorklistField label="Unidade" htmlFor="posting-unit-filter">
          <select
            id="posting-unit-filter"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => {
              setUnitId(event.target.value);
              setPage(0);
            }}
          >
            {/*
              ESCOPO DE UNIDADE pelo primitivo compartilhado — o `<option>` de ausencia e o rotulo
              humano sao os mesmos das demais superficies contabeis. O VALOR continua sendo a
              unidade autorizada enviada a API.
            */}
            <OperationalUnitOptions options={unitOptions} />
          </select>
        </WorklistField>
        <WorklistField label="Situação" htmlFor="posting-status-filter">
          <select
            id="posting-status-filter"
            className={worklistSelectClass}
            value={status}
            onChange={(event) => clearPagingOnFilter('status', event.target.value)}
          >
            <option value="">Todas</option>
            <option value="POSTED">Lançado</option>
            <option value="PENDING">Pendente</option>
            <option value="REJECTED">Rejeitado</option>
          </select>
        </WorklistField>
        <WorklistField label="Evento de origem" htmlFor="posting-event-filter">
          <select
            id="posting-event-filter"
            className={`${worklistSelectClass} w-full max-w-[18rem]`}
            value={eventKind}
            onChange={(event) => clearPagingOnFilter('eventKind', event.target.value)}
          >
            {EVENT_KINDS.map((value) => (
              <option key={value || 'all'} value={value}>
                {value === '' ? 'Todos' : (EVENT_LABELS[value] ?? value)}
              </option>
            ))}
          </select>
        </WorklistField>
        <WorklistField label="Ocorrido de" htmlFor="posting-from-filter">
          <input
            id="posting-from-filter"
            type="date"
            className={worklistSelectClass}
            value={occurredFrom}
            onChange={(event) => {
              setOccurredFrom(event.target.value);
              setPage(0);
            }}
          />
        </WorklistField>
        <WorklistField label="Ocorrido até" htmlFor="posting-to-filter">
          <input
            id="posting-to-filter"
            type="date"
            className={worklistSelectClass}
            value={occurredTo}
            onChange={(event) => {
              setOccurredTo(event.target.value);
              setPage(0);
            }}
          />
        </WorklistField>
        <WorklistClearFilters
          visible={smartList.isFiltered || occurredFrom !== '' || occurredTo !== ''}
          onClick={() => {
            smartList.clearFilters();
            setOccurredFrom('');
            setOccurredTo('');
            setPage(0);
          }}
        />
      </WorklistFilterBar>

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
        className="mb-2"
      />

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
        <WorklistStatePanel
          title={
            smartList.isFiltered ? 'Nenhum evento para o recorte atual' : 'Nenhum evento lançado'
          }
          description={
            smartList.isFiltered
              ? 'Os filtros aplicados não retornam evento de negócio nesta unidade. Limpe o recorte para ver a rastreabilidade completa.'
              : 'Não há eventos de negócio lançados para a unidade selecionada.'
          }
          action={
            <WorklistClearFilters
              visible={smartList.isFiltered}
              onClick={() => {
                smartList.clearFilters();
                setPage(0);
              }}
              label="Limpar filtros"
            />
          }
        />
      ) : null}

      {data && data.items.length > 0 ? (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Origem dos lançamentos contábeis">
              <thead>
                <tr>
                  <th scope="col" className={worklistHeadCellClass}>
                    Ocorrido em
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Origem
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Evento
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Referência
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Valor
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={worklistHeadCellClass}>
                    Lançamento
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item: PostingRequestListItem) => (
                  <tr key={item.id} className={worklistRowClass}>
                    <td className={worklistCellClass}>
                      <DateTime value={item.occurredOn} mode="date" />
                    </td>
                    <td className={worklistCellClass}>
                      {ORIGIN_LABELS[item.originKind] ?? item.originKind}
                    </td>
                    <td className={`${worklistCellClass} whitespace-normal`}>
                      {EVENT_LABELS[item.eventKind] ?? item.eventKind}
                    </td>
                    <td className={`${worklistCellClass} whitespace-normal`}>
                      {item.sourceReference}
                    </td>
                    <td className={worklistCellClass}>
                      <Money value={item.amount} currencyCode={item.currencyCode} />
                    </td>
                    <td className={worklistCellClass}>
                      <FinanceStatusBadge status={item.status} labels={STATUS_LABELS} />
                    </td>
                    <td className={worklistCellClass}>
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
          </div>

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
