import { useSearchParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import {
  cancelServiceOrder,
  listServiceOrders,
  prepareServiceOrder,
  releaseServiceOrder,
  reopenServiceOrder,
  ServiceOrdersApiError,
  type ServiceOrderSummary,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { ServiceOrderStatusBadge } from '../components/ServiceOrderStatusBadge';
import {
  SERVICE_ORDER_ACTIVE_STATUS,
  SERVICE_ORDER_LIST_EVENTS,
  SERVICE_ORDER_LIST_FILTERS,
  SERVICE_ORDER_LIST_ORDERS,
} from '../types/service-order-list.types';
import { SERVICE_ORDER_STATUSES } from '../types/service-order.types';
import {
  buildServiceOrderListSearchParams,
  EMPTY_SERVICE_ORDER_LIST_PARAMS,
  parseServiceOrderListParams,
  type ServiceOrderListParams,
} from '../utils/service-order-list-params';
import {
  formatAssigneeLabel,
  formatClientLabel,
  formatDeadlineLabel,
  formatServiceOrderStatus,
} from '../utils/service-order-labels';
import {
  resolveServiceOrderAttention,
  serviceOrderAttentionClass,
} from '../utils/service-order-next-action';
import { ServiceOrderRowActions } from '../components/ServiceOrderRowActions';
import { ConfirmAction } from '../../ui/ConfirmAction';
import { HumanLookupField } from '../../financial-ui/HumanLookupField';
import { searchClientOptions } from '../../financial-ui/client-lookup';
import {
  EnterpriseMetric,
  PrimaryRecordCell,
  RecordStatusCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  enterpriseCellClass,
  enterpriseControlClass,
  enterpriseHeadCellClass,
  enterpriseNumericCellClass,
  enterpriseNumericHeadCellClass,
  enterpriseRowClass,
  enterpriseTableCardClass,
  enterpriseTableClass,
  rowSecondaryActionClass,
  worklistControlClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  filterLabelClass,
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: ServiceOrderSummary[]; offset: number; hasMore: boolean };

function resolveFilterDescription(params: ServiceOrderListParams): string | null {
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.Overdue) {
    return 'Mostrando ordens com prazo operacional vencido.';
  }
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.ApproachingDue) {
    return 'Mostrando ordens com prazo operacional nos próximos 7 dias.';
  }
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.Mine) {
    return 'Minhas ordens: atribuídas a você por alocação ativa de mão de obra.';
  }
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.Unassigned) {
    return 'Ordens em aberto sem empregado atribuído por alocação ativa.';
  }
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.Unscheduled) {
    return 'Ordens em aberto sem janela operacional ativa (nem planejada, nem alocada).';
  }
  if (params.filter === SERVICE_ORDER_LIST_FILTERS.ScheduledToday) {
    return 'Ordens com janela operacional ativa que cobre o dia corrente.';
  }
  if (params.from || params.to) {
    const from = params.from || '…';
    const to = params.to || '…';
    if (params.event === SERVICE_ORDER_LIST_EVENTS.Completed) {
      return `Período de conclusão: ${from} — ${to}.`;
    }
    return `Período de abertura: ${from} — ${to}.`;
  }
  return null;
}

export function ServiceOrdersListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => parseServiceOrderListParams(searchParams), [searchParams]);
  const offset = Number(searchParams.get('offset') ?? '0');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<{
    tone: 'error' | 'success';
    message: string;
  } | null>(null);
  const [confirmDialog, setConfirmDialog] = useState<{
    kind: 'cancel' | 'reopen';
    order: ServiceOrderSummary;
  } | null>(null);
  const [dialogReason, setDialogReason] = useState('');
  const confirmReasonId = useId();

  const updateFilters = useCallback(
    (next: Partial<ServiceOrderListParams>) => {
      const merged = { ...filters, ...next };
      setSearchParams(buildServiceOrderListSearchParams(merged, 0), { replace: true });
    },
    [filters, setSearchParams],
  );

  const loadPage = useCallback(
    async (pageOffset: number, activeFilters: ServiceOrderListParams, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listServiceOrders(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            q: activeFilters.q.trim() || undefined,
            status: activeFilters.status === '' ? undefined : activeFilters.status,
            filter: activeFilters.filter || undefined,
            order: activeFilters.order || undefined,
            unitId: activeFilters.unitId.trim() || undefined,
            clientId: activeFilters.clientId.trim() || undefined,
            from: activeFilters.from.trim() || undefined,
            to: activeFilters.to.trim() || undefined,
            event: activeFilters.event || undefined,
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
        if (error instanceof ServiceOrdersApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapServiceOrdersErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as ordens de serviço.',
          retryable: true,
        });
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, filters, controller.signal);
    return () => controller.abort();
  }, [filters, loadPage, offset]);

  const runLifecycleAction = useCallback(
    async (order: ServiceOrderSummary, run: () => Promise<unknown>, successMessage: string) => {
      if (pendingOrderId) {
        return;
      }
      setPendingOrderId(order.id);
      setRowFeedback(null);
      try {
        await run();
        setRowFeedback({ tone: 'success', message: successMessage });
        await loadPage(offset, filters);
      } catch (error) {
        setRowFeedback({
          tone: 'error',
          message:
            error instanceof ServiceOrdersApiError
              ? mapServiceOrdersErrorToMessage(error.code, error.status)
              : 'Não foi possível concluir a operação.',
        });
      } finally {
        setPendingOrderId(null);
      }
    },
    [loadPage, offset, filters, pendingOrderId],
  );

  function openConfirmDialog(
    kind: 'cancel' | 'reopen',
    order: ServiceOrderSummary,
  ): void {
    setDialogReason('');
    setConfirmDialog({ kind, order });
  }

  function confirmLifecycleAction(): void {
    if (!confirmDialog) {
      return;
    }
    const reason = dialogReason.trim();
    const { kind, order } = confirmDialog;
    setConfirmDialog(null);
    setDialogReason('');
    const action =
      kind === 'cancel'
        ? cancelServiceOrder(order.id, { rowVersion: order.rowVersion, cancellationReason: reason })
        : reopenServiceOrder(order.id, { rowVersion: order.rowVersion, reopenReason: reason });
    const message =
      kind === 'cancel'
        ? `Ordem de serviço ${order.orderNumber} cancelada.`
        : `Ordem de serviço ${order.orderNumber} reaberta.`;
    void runLifecycleAction(order, () => action, message);
  }

  /**
   * Executa um comando de ciclo de vida declarado válido pelo BACKEND.
   *
   * Antes de B5, a própria lista decidia qual comando rodar a partir do status
   * (`nextAction.intent`). Agora ela recebe o nome do comando do backend e apenas o
   * despacha; `cancel` e `reopen` continuam exigindo justificativa, por isso passam pelo
   * diálogo em vez de executar direto.
   */
  function runBackendCommand(order: ServiceOrderSummary, command: string): void {
    if (command === 'cancel' || command === 'reopen') {
      openConfirmDialog(command, order);
      return;
    }
    if (command === 'prepare') {
      void runLifecycleAction(
        order,
        () => prepareServiceOrder(order.id, order.rowVersion),
        `Ordem de serviço ${order.orderNumber} preparada.`,
      );
      return;
    }
    if (command === 'release') {
      void runLifecycleAction(
        order,
        () => releaseServiceOrder(order.id, order.rowVersion),
        `Ordem de serviço ${order.orderNumber} liberada.`,
      );
    }
  }

  const filterDescription = resolveFilterDescription(filters);
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters =
    Boolean(
      filters.q.trim() ||
        filters.status ||
        filters.filter ||
        filters.order ||
        filters.unitId.trim() ||
        filters.clientId.trim() ||
        filters.from.trim() ||
        filters.to.trim() ||
        filters.event,
    );

  if (listState.phase === 'loading') {
    return (
      <ModulePage>
        <ModuleLoadingState
        title="Ordens de serviço"
        message="Carregando ordens de serviço…"
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
        title="Ordens de serviço"
        message="Você não tem permissão para listar ordens de serviço."
      />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
        title="Ordens de serviço"
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(offset, filters)}
      />
      </ModulePage>
    );
  }

  const { items, hasMore } = listState;
  // Contagens derivadas das linhas JA carregadas nesta pagina — rotuladas como tal para nao
  // sugerir um total global que a listagem nao recebe do backend.
  const attentionCount = items.filter((item) => resolveServiceOrderAttention(item) !== null).length;
  const unassignedCount = items.filter((item) => !item.assignedWorkforceMember).length;

  return (
    <ModulePage>
      {/*
        GRAMATICA APROVADA (Clientes) — `WorklistHeader`, nao `EnterpriseListHeader`.
        Sao pecas DIFERENTES: `EnterpriseListHeader` envolve a cabeca em card com borda;
        `WorklistHeader` publica titulo + contagem + contexto + acao + faixa de indicadores sem
        moldura. A mesma peca nas quatro telas da familia.
      */}
      <WorklistHeader
        title="Ordens de serviço"
        count={items.length}
        context={filterDescription ?? 'Consulta operacional das OS no seu escopo autorizado.'}
        metrics={
          <>
            <EnterpriseMetric
              value={attentionCount}
              label="com exceção"
              tone={attentionCount > 0 ? 'critical' : 'neutral'}
            />
            <EnterpriseMetric
              value={unassignedCount}
              label="sem responsável"
              tone={unassignedCount > 0 ? 'warning' : 'neutral'}
            />
          </>
        }
      />

      <div className={enterpriseTableCardClass}>
      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <WorklistField label="Busca" htmlFor="service-order-search" grow>
          <input
            id="service-order-search"
            type="search"
            className={worklistControlClass}
            value={filters.q}
            onChange={(event) => updateFilters({ q: event.target.value })}
            placeholder="Número, código interno ou descrição"
          />
        </WorklistField>

        <WorklistField label="Status" htmlFor="service-order-status-filter">
          <select
            id="service-order-status-filter"
            className={worklistSelectClass}
            value={filters.status}
            onChange={(event) =>
              updateFilters({ status: event.target.value as ServiceOrderListParams['status'] })
            }
          >
            <option value="">Todos</option>
            <option value={SERVICE_ORDER_ACTIVE_STATUS}>Ativas (exceto canceladas)</option>
            {Object.values(SERVICE_ORDER_STATUSES).map((status) => (
              <option key={status} value={status}>
                {formatServiceOrderStatus(status)}
              </option>
            ))}
          </select>
        </WorklistField>

        <WorklistField label="Filtro operacional" htmlFor="service-order-filter">
          <select
            id="service-order-filter"
            className={worklistSelectClass}
            value={filters.filter}
            onChange={(event) =>
              updateFilters({ filter: event.target.value as ServiceOrderListParams['filter'] })
            }
          >
            <option value="">Nenhum</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.Overdue}>Vencidas</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.ApproachingDue}>Vencendo em breve</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.Mine}>Minhas OS</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.Unassigned}>Não atribuídas</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.Unscheduled}>Não agendadas</option>
            <option value={SERVICE_ORDER_LIST_FILTERS.ScheduledToday}>Hoje</option>
          </select>
        </WorklistField>

        <WorklistField label="Ordenar por" htmlFor="service-order-order">
          <select
            id="service-order-order"
            className={worklistSelectClass}
            value={filters.order}
            onChange={(event) =>
              updateFilters({ order: event.target.value as ServiceOrderListParams['order'] })
            }
          >
            <option value="">Mais recentes</option>
            <option value={SERVICE_ORDER_LIST_ORDERS.Schedule}>Programação (prazo)</option>
          </select>
        </WorklistField>

        <WorklistField label="Cliente" htmlFor="service-order-client-search">
          <HumanLookupField
            variant="compact"
            label="Cliente"
            htmlFor="service-order-client-search"
            search={searchClientOptions}
            value={filters.clientId}
            onChange={(clientId) => updateFilters({ clientId })}
            emptyOptionLabel="Todos os clientes"
            emptyMessage="Nenhum cliente encontrado para a busca."
          />
        </WorklistField>

        <WorklistField label="Unidade" htmlFor="service-order-unit-filter">
          <input
            id="service-order-unit-filter"
            type="search"
            className={worklistControlClass}
            value={filters.unitId}
            onChange={(event) => updateFilters({ unitId: event.target.value })}
            placeholder="Filtrar por unidade"
          />
        </WorklistField>

        <WorklistField label="Período de" htmlFor="service-order-from-filter">
          <input
            id="service-order-from-filter"
            type="date"
            className={worklistControlClass}
            value={filters.from}
            onChange={(event) => updateFilters({ from: event.target.value })}
          />
        </WorklistField>

        <WorklistField label="Período até" htmlFor="service-order-to-filter">
          <input
            id="service-order-to-filter"
            type="date"
            className={worklistControlClass}
            value={filters.to}
            onChange={(event) => updateFilters({ to: event.target.value })}
          />
        </WorklistField>

        {hasActiveFilters ? (
          <WorklistClearFilters
            visible
            onClick={() =>
              setSearchParams(buildServiceOrderListSearchParams(EMPTY_SERVICE_ORDER_LIST_PARAMS))
            }
          />
        ) : null}
      </WorklistFilterBar>

      {rowFeedback ? (
        <p
          role={rowFeedback.tone === 'error' ? 'alert' : 'status'}
          className={
            rowFeedback.tone === 'error'
              ? 'mx-3 mt-3 rounded-md bg-red-50 px-3 py-2 text-[13px] text-red-700 ring-1 ring-red-500/20 ring-inset'
              : 'mx-3 mt-3 rounded-md bg-green-50 px-3 py-2 text-[13px] text-green-700 ring-1 ring-green-500/20 ring-inset'
          }
        >
          {rowFeedback.message}
        </p>
      ) : null}

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            hasActiveFilters
              ? 'Nenhuma ordem de serviço corresponde aos filtros selecionados.'
              : 'Nenhuma ordem de serviço no seu escopo.'
          }
          description={
            hasActiveFilters
              ? 'Ajuste a busca, o status ou o filtro operacional — ou limpe os filtros para ver a carteira completa.'
              : 'As OS nascem das solicitações aprovadas e das propostas aceitas; quando a primeira for aberta ela aparece aqui com prazo, responsável e próximo passo.'
          }
          action={
            hasActiveFilters ? (
              <WorklistClearFilters
                visible
                onClick={() =>
                  setSearchParams(
                    buildServiceOrderListSearchParams(EMPTY_SERVICE_ORDER_LIST_PARAMS),
                  )
                }
              />
            ) : null
          }
        />
      ) : (
        <table className={enterpriseTableClass} aria-label="Lista de ordens de serviço">
          <thead>
            <tr>
              <th scope="col" className={enterpriseHeadCellClass}>
                OS
              </th>
              <th scope="col" className={enterpriseHeadCellClass}>
                Situação
              </th>
              <th scope="col" className={enterpriseHeadCellClass}>
                Responsável
              </th>
              <th scope="col" className={enterpriseHeadCellClass}>
                Prazo
              </th>
              <th scope="col" className={enterpriseNumericHeadCellClass}>
                Próxima ação
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const attention = resolveServiceOrderAttention(item);
              const lifecyclePending = pendingOrderId === item.id;
              // A visão geral da OS (B5) concentra ações e histórico; o planejamento
              // continua acessível a partir dela.
              const openPath = `/app/service-orders/${item.id}`;
              return (
                <tr key={item.id} className={enterpriseRowClass}>
                  <td className={enterpriseCellClass}>
                    {/* Linha 1: identificador forte. Linha 2: cliente + servico. */}
                    <PrimaryRecordCell
                      href={openPath}
                      identifier={item.orderNumber}
                      context={[formatClientLabel(item.clientSnapshot, item.clientId), item.description]
                        .filter(Boolean)
                        .join(' · ')}
                    />
                  </td>
                  <td className={enterpriseCellClass}>
                    <RecordStatusCell
                      accent={
                        attention?.tone === 'critical'
                          ? 'critical'
                          : attention?.tone === 'warning'
                            ? 'warning'
                            : 'none'
                      }
                      badge={<ServiceOrderStatusBadge status={item.status} />}
                      context={
                        attention ? (
                          <span className={serviceOrderAttentionClass(attention.tone)}>
                            {attention.label}
                          </span>
                        ) : null
                      }
                    />
                  </td>
                  <td className={enterpriseCellClass}>
                    {formatAssigneeLabel(item.assignedWorkforceMember)}
                  </td>
                  <td className={enterpriseCellClass}>
                    <span className="tabular-nums">{formatDeadlineLabel(item.deadlineAt)}</span>
                  </td>
                  <td className={enterpriseNumericCellClass}>
                    <ServiceOrderRowActions
                      serviceOrderId={item.id}
                      orderNumber={item.orderNumber}
                      status={item.status}
                      openPath={openPath}
                      busy={lifecyclePending}
                      onCancel={() => openConfirmDialog('cancel', item)}
                      onReopen={() => openConfirmDialog('reopen', item)}
                      onCommand={(command) => runBackendCommand(item, command)}
                      primaryClassName="px-2.5 py-1 text-xs"
                      secondaryClassName={rowSecondaryActionClass}
                    />
                    {lifecyclePending ? (
                      <span className="mt-1 text-[11px] text-gray-500" role="status">
                        Processando…
                      </span>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      </div>

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() =>
          setSearchParams(buildServiceOrderListSearchParams(filters, Math.max(0, offset - PAGE_SIZE)))
        }
        onNext={() => setSearchParams(buildServiceOrderListSearchParams(filters, offset + PAGE_SIZE))}
      />

      <ConfirmAction
        open={confirmDialog !== null}
        title={
          confirmDialog?.kind === 'cancel'
            ? 'Cancelar ordem de serviço'
            : 'Reabrir ordem de serviço'
        }
        description={
          confirmDialog?.kind === 'cancel'
            ? `Informe o motivo para cancelar a OS ${confirmDialog?.order.orderNumber ?? ''}. A ordem poderá ser reaberta posteriormente com justificativa.`
            : `Informe o motivo para reabrir a OS ${confirmDialog?.order.orderNumber ?? ''}. A ordem voltará ao fluxo operacional.`
        }
        confirmLabel={
          confirmDialog?.kind === 'cancel' ? 'Confirmar cancelamento' : 'Confirmar reabertura'
        }
        confirmVariant={confirmDialog?.kind === 'cancel' ? 'danger' : 'primary'}
        confirmDisabled={
          !dialogReason.trim() || pendingOrderId === confirmDialog?.order.id
        }
        loading={pendingOrderId === confirmDialog?.order.id}
        onCancel={() => {
          setConfirmDialog(null);
          setDialogReason('');
        }}
        onConfirm={() => void confirmLifecycleAction()}
      >
        <div>
          <label className={filterLabelClass} htmlFor={confirmReasonId}>
            {confirmDialog?.kind === 'cancel' ? 'Motivo do cancelamento' : 'Motivo da reabertura'}
          </label>
          <textarea
            id={confirmReasonId}
            className={`${enterpriseControlClass} mt-1`}
            rows={3}
            value={dialogReason}
            onChange={(event) => setDialogReason(event.target.value)}
          />
        </div>
      </ConfirmAction>
    </ModulePage>
  );
}
