import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listRentalServiceOrders } from '../api/rentals-api';
import {
  DynamicContextDrawer,
  DynamicSavedViewsBar,
  useSavedViews,
  type CrossReference,
} from '../../engine';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import { ServiceOrderStatusBadge } from '../../service-orders/components/ServiceOrderStatusBadge';
import { formatClientLabel, formatDateTime, formatServiceOrderStatus } from '../../service-orders/utils/service-order-labels';
import type { ServiceOrderStatus } from '../../service-orders/types/service-order.types';
import {
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  rowPrimaryActionClass,
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
} from '../../ui/module-layout';

const PAGE_SIZE = 20;

/**
 * Proxima acao REAL da locacao, derivada do status que o backend ja devolve.
 *
 * Nao existe transicao nova aqui: cada frase nomeia a tela que ja executa aquele passo
 * (planejamento da OS). Status sem proximo passo operacional nao declara acao — a coluna some
 * em vez de inventar tarefa.
 */
const RENTAL_NEXT_ACTION: Record<string, string> = {
  DRAFT: 'Revisar e preparar',
  PREPARED: 'Liberar para execução',
  RELEASED: 'Iniciar execução',
  IN_EXECUTION: 'Acompanhar execução',
  PAUSED: 'Retomar execução',
  COMPLETED: 'Conferir medição',
};

/**
 * Excecao operacional de locacao a partir de campos que a listagem JA entrega.
 *
 * Sem prazo publicado no payload, o unico fato de excecao sustentavel e o estado real: uma OS
 * parada ou cancelada é o que trava o contrato. Nada e inferido por data ou por heuristica.
 */
function rentalException(status: string): 'critical' | 'warning' | null {
  if (status === 'CANCELLED') {
    return 'critical';
  }
  if (status === 'PAUSED') {
    return 'warning';
  }
  return null;
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Awaited<ReturnType<typeof listRentalServiceOrders>>['items']; offset: number; hasMore: boolean };

export function RentalsListPage() {
  const savedViews = useSavedViews('local-operator', 'rentals');
  const [selected, setSelected] = useState<
    Awaited<ReturnType<typeof listRentalServiceOrders>>['items'][number] | null
  >(null);
  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState<'' | ServiceOrderStatus>('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  // Busca vai ao servidor: filtrar so a pagina atual esconderia uma OS que existe adiante.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const loadPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      // Recarga preserva a lista anterior: trocar a grade por "Carregando…" a cada tecla
      // desmontaria a propria barra de busca durante a digitacao.
      setListState((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }));
      try {
        const response = await listRentalServiceOrders(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            status: statusFilter || undefined,
            q: search || undefined,
          },
          signal,
        );
        if (signal?.aborted) {
          return;
        }
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          hasMore: response.items.length === response.limit,
        });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
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
          message: 'Não foi possível carregar as locações.',
          retryable: true,
        });
      }
    },
    [search, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  /**
   * Opcoes do filtro de status, derivadas das linhas ja carregadas.
   *
   * O endpoint de ordens de servico JA publica `status` e `q`; o que faltava era a tela mandar.
   * Os rotulos vem do dominio (`formatServiceOrderStatus`), nunca do enum cru.
   *
   * HOOK ANTES DOS RETORNOS ANTECIPADOS: `useMemo` depois de um `return` condicional viola a
   * ordem de hooks do React (erro #310 na tela de carregamento/erro).
   */
  const statusOptions = useMemo(() => {
    const seen = new Map<string, string>();
    if (listState.phase === 'ready') {
      for (const order of listState.items) {
        if (!seen.has(order.status)) {
          seen.set(order.status, formatServiceOrderStatus(order.status));
        }
      }
    }
    return [...seen.entries()];
  }, [listState]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Locações">
        <ModuleLoadingState message="Carregando ordens de locação…" />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Locações">
        <ModuleDeniedState message="Você não tem permissão para listar locações." />
      </ModuleStatePage>
    );
  }
  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Locações">
        <ModuleErrorState
        message={listState.message}
        retryable={listState.retryable}
        onRetry={() => void loadPage(offset)}
      />
      </ModuleStatePage>
    );
  }

  const { items, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const activeFilters = Boolean(statusFilter || search.trim());
  const activeStatusLabel = statusFilter ? formatServiceOrderStatus(statusFilter) : null;

  return (
    <ModulePage>
      <WorklistHeader
        title="Locações"
        count={items.length}
        context="Ordens de serviço com arquétipo de locação, com o estágio de execução de cada contrato."
      />

      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <WorklistField label="Buscar" htmlFor="rental-search" grow>
          <input
            id="rental-search"
            type="search"
            className={worklistSelectClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Número da OS ou cliente"
          />
        </WorklistField>
        <WorklistField label="Status" htmlFor="rental-status-filter">
          <select
            id="rental-status-filter"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value as '' | ServiceOrderStatus);
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            {statusOptions.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </WorklistField>
        <WorklistClearFilters
          visible={activeFilters}
          onClick={() => {
            setSearchInput('');
            setStatusFilter('');
          }}
        />
      </WorklistFilterBar>

      {/*
        VISÕES SALVAS — a fila que o operador de locação remonta todo dia: "paradas" (execução
        travada) e "aguardando conferência de medição" são os dois recortes de trabalho reais.
        A barra elimina a remontagem manual do filtro a cada turno.
      */}
      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        onSave={(name) => savedViews.save(name, { search, statusFilter }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          setSearchInput(view.filters['search'] ?? '');
          setSearch(view.filters['search'] ?? '');
          setStatusFilter((view.filters['statusFilter'] ?? '') as '' | ServiceOrderStatus);
          setOffset(0);
        }}
      />

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            activeFilters
              ? 'Nenhuma locação corresponde aos filtros aplicados.'
              : 'Nenhuma locação encontrada.'
          }
          description={
            activeFilters
              ? 'Ajuste a busca ou o status, ou limpe os filtros para ver todas as ordens do arquétipo.'
              : 'As locações nascem das ordens de serviço com arquétipo RENTAL; quando a primeira for criada ela aparece aqui.'
          }
          action={
            activeFilters ? (
              <WorklistClearFilters
                visible
                onClick={() => {
                  setSearchInput('');
                  setStatusFilter('');
                }}
              />
            ) : null
          }
        />
      ) : (
        <div className={worklistTableCardClass}>
          <table className={worklistTableClass} aria-label="Lista de locações">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  OS
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Cliente
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Execução
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Responsável
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Próxima ação
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => {
                const exception = rentalException(order.status);
                const nextAction = RENTAL_NEXT_ACTION[order.status];
                return (
                  <tr
                    key={order.id}
                    className={worklistRowClass}
                    /*
                     * CONTEXTO SEM ABANDONAR A FILA — o locador acompanha vários contratos ao
                     * mesmo tempo. O painel lateral mostra a situação da locação clicada sem
                     * perder o recorte; o número da OS continua sendo o caminho ao planejamento.
                     */
                    onClick={() => setSelected(order)}
                  >
                    <td className={worklistCellClass}>
                      <WorklistRowLink href={`/app/service-orders/${order.id}/planning`}>
                        {order.orderNumber}
                      </WorklistRowLink>
                      {/* Descricao da OS e contexto REAL do contrato: identifica a locacao
                          melhor que o numero sozinho. Truncada para nao estourar a grade. */}
                      {order.description ? (
                        <p
                          className="max-w-[32ch] truncate text-[11px] text-gray-500"
                          title={order.description}
                        >
                          {order.description}
                        </p>
                      ) : null}
                    </td>
                    <td className={worklistCellRaisedClass}>
                      {formatClientLabel(order.clientSnapshot, order.clientId)}
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <ServiceOrderStatusBadge status={order.status} />
                      {exception ? (
                        <div className="mt-1">
                          <WorklistException tone={exception}>
                            {order.status === 'CANCELLED' ? 'Contrato cancelado' : 'Execução parada'}
                          </WorklistException>
                        </div>
                      ) : null}
                    </td>
                    <td className={worklistCellRaisedClass}>
                      {/*
                        Responsavel vem da projecao de despacho (`assignedWorkforceMember`), que o
                        backend JA publica na listagem. Sem alocacao ativa, a linha declara a
                        ausencia — nao inventa nome nem esconde a coluna.
                      */}
                      {order.assignedWorkforceMember ? (
                        <span className="text-[12px] text-gray-700">
                          {order.assignedWorkforceMember.displayName}
                        </span>
                      ) : (
                        <span className="text-[11px] text-gray-500">Sem alocação ativa</span>
                      )}
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <span className="whitespace-nowrap text-[12px] text-gray-600">
                        {formatDateTime(order.updatedAt)}
                      </span>
                    </td>
                    <td className={worklistCellRaisedClass}>
                      {nextAction ? (
                        <span className="text-[12px] text-gray-600">{nextAction}</span>
                      ) : (
                        <span className="text-[11px] text-gray-500">Sem ação pendente</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <WorklistFooter
        rangeLabel={`${offset + 1}–${offset + items.length} nesta página`}
        extra={activeStatusLabel ? `status: ${activeStatusLabel}` : undefined}
      >
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => setOffset(offset + PAGE_SIZE)}
        />
      </WorklistFooter>

      {/*
        RELAÇÕES DA LOCAÇÃO — montadas do que a LINHA já traz, sem chamada de rede nova. Não há
        contagem de medições nem de faturamento nesta listagem, então nenhuma é afirmada: número
        sem origem não entra.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title={selected ? selected.orderNumber : 'Locação'}
        onClose={() => setSelected(null)}
        crossReferences={selected ? rentalCrossReferences(selected) : []}
      >
        {selected ? (
          <Link
            to={`/app/service-orders/${selected.id}/planning`}
            className={rowPrimaryActionClass}
          >
            Abrir planejamento
          </Link>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}

/**
 * Referências cruzadas da locação, a partir do payload da listagem.
 *
 * Cada item entra só quando o campo existe. Sem responsável alocado, a ausência é DECLARADA —
 * não se fabrica nome nem se omite a linha em silêncio.
 */
function rentalCrossReferences(
  order: Awaited<ReturnType<typeof listRentalServiceOrders>>['items'][number],
): CrossReference[] {
  const references: CrossReference[] = [
    { label: 'Cliente', detail: formatClientLabel(order.clientSnapshot, order.clientId) },
    { label: 'Execução', detail: formatServiceOrderStatus(order.status) },
  ];
  references.push({
    label: 'Responsável',
    detail: order.assignedWorkforceMember?.displayName ?? 'Sem alocação ativa',
  });
  if (order.description) {
    references.push({ label: 'Descrição', detail: order.description });
  }
  return references;
}