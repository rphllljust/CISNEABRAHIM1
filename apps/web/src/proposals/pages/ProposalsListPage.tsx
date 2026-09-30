import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import { listProposals, ProposalsApiError } from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import { ProposalStatusBadge } from '../components/ProposalStatusBadge';
import {
  PROPOSAL_LIST_SORTS,
  PROPOSAL_VERSION_STATUSES,
  type Proposal,
  type ProposalListDirection,
  type ProposalListSort,
} from '../types/proposal.types';
import { formatDateTime, formatMoney, formatProposalStatus } from '../utils/proposal-labels';
import {
  describeProposalAttention,
  describeValidityTiming,
  formatProposalNextStep,
  formatRelativePast,
} from '../utils/proposal-workbench';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  enterpriseRowClass,
  enterpriseTableCardClass,
  rowPrimaryActionClass,
  worklistControlClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
  ModulePrimaryLink,
  UnitScopeLabel,
} from '../../ui/module-layout';
import { cn } from '../../ui/utils/cn';

const PAGE_SIZE = 20;

const SORT_LABELS: Record<ProposalListSort, string> = {
  [PROPOSAL_LIST_SORTS.createdAt]: 'Criação',
  [PROPOSAL_LIST_SORTS.updatedAt]: 'Última atualização',
  [PROPOSAL_LIST_SORTS.validUntil]: 'Validade',
  [PROPOSAL_LIST_SORTS.value]: 'Valor comercial',
  [PROPOSAL_LIST_SORTS.revision]: 'Revisão',
};

/** Proximo passo por estado — mesma leitura que o backend deriva da maquina de estados. */
const NEXT_STEP_BY_STATUS: Record<string, string> = {
  [PROPOSAL_VERSION_STATUSES.Draft]: formatProposalNextStep('COMPLETE_AND_ISSUE'),
  [PROPOSAL_VERSION_STATUSES.Issued]: formatProposalNextStep('AWAIT_CLIENT_DECISION'),
  [PROPOSAL_VERSION_STATUSES.Accepted]: formatProposalNextStep('FOLLOW_COMMERCIAL_FLOW'),
  [PROPOSAL_VERSION_STATUSES.Rejected]: formatProposalNextStep('CREATE_NEW_REVISION'),
  [PROPOSAL_VERSION_STATUSES.Expired]: formatProposalNextStep('CREATE_NEW_REVISION'),
  [PROPOSAL_VERSION_STATUSES.Cancelled]: formatProposalNextStep('CREATE_NEW_REVISION'),
};

/**
 * ROTULO CURTO DA ACAO POR ESTADO — mesma maquina de estados, verbo de superficie.
 *
 * `NEXT_STEP_BY_STATUS` entrega a FRASE ("Aguardar decisão do cliente"); no botao da linha cabe
 * o VERBO. Nenhuma transicao nova: a tabela abaixo le a mesma maquina de estados, so encurtada
 * para o alvo de clique.
 */
const PROPOSAL_ACTION_LABEL: Record<string, string> = {
  [PROPOSAL_VERSION_STATUSES.Draft]: 'Completar',
  [PROPOSAL_VERSION_STATUSES.Issued]: 'Acompanhar',
  [PROPOSAL_VERSION_STATUSES.Accepted]: 'Abrir',
  [PROPOSAL_VERSION_STATUSES.Rejected]: 'Nova revisão',
  [PROPOSAL_VERSION_STATUSES.Expired]: 'Nova revisão',
  [PROPOSAL_VERSION_STATUSES.Cancelled]: 'Consultar',
};

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  info: 'bg-gray-100 text-gray-600 ring-gray-400/20',
};

type QueueFilters = {
  status: string;
  validFrom: string;
  validTo: string;
  createdFrom: string;
  search: string;
  sort: ProposalListSort;
  direction: ProposalListDirection;
};

const EMPTY_FILTERS: QueueFilters = {
  status: '',
  validFrom: '',
  validTo: '',
  createdFrom: '',
  search: '',
  sort: PROPOSAL_LIST_SORTS.createdAt,
  direction: 'desc',
};

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Proposal[]; offset: number; hasMore: boolean };

export function ProposalsListPage() {
  const { capabilities } = useProposalCapabilities();
  const [filters, setFilters] = useState<QueueFilters>(EMPTY_FILTERS);
  // RELATION CONTRACT: o recorte que vem da URL (clique em "Propostas N" na object page do
  // cliente, por exemplo) precisa chegar ao servidor — um numero que abre lista sem filtro
  // afirma um recorte que nao existe.
  const relationScope = useRelationScope(RELATION_SCOPE_KEYS);
  const [searchInput, setSearchInput] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  const loadPage = useCallback(
    async (offset: number, active: QueueFilters, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listProposals(
          {
            limit: PAGE_SIZE,
            offset,
            status: active.status || undefined,
            validFrom: active.validFrom
              ? new Date(active.validFrom).toISOString()
              : undefined,
            validTo: active.validTo ? new Date(active.validTo).toISOString() : undefined,
            createdFrom: active.createdFrom
              ? new Date(active.createdFrom).toISOString()
              : undefined,
            search: active.search.trim() || undefined,
            sort: active.sort,
            direction: active.direction,
            clientId: relationScope.clientId,
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
        if (error instanceof ProposalsApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapProposalErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as propostas.',
          retryable: true,
        });
      }
    },
    [relationScope.clientId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(0, filters, controller.signal);
    return () => controller.abort();
  }, [filters, loadPage]);

  const applyFilter = useCallback(
    <K extends keyof QueueFilters>(key: K, value: QueueFilters[K]) => {
      setFilters((current) => ({ ...current, [key]: value }));
    },
    [],
  );

  const hasActiveFilters = useMemo(() => {
    const { sort, direction, ...rest } = filters;
    void sort;
    void direction;
    return Object.values(rest).some((value) => value !== '');
  }, [filters]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Propostas comerciais">
        <ModuleLoadingState message="Carregando propostas…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Propostas comerciais">
        <ModuleDeniedState
          message="Você não tem permissão para listar propostas."
        />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Propostas comerciais">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(0, filters)}
        />
      </ModuleStatePage>
    );
  }

  const { items, offset, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const now = new Date();

  const decidedCount = items.filter(
    (item) =>
      item.currentVersionStatus === PROPOSAL_VERSION_STATUSES.Accepted ||
      item.currentVersionStatus === PROPOSAL_VERSION_STATUSES.Rejected,
  ).length;
  const awaitingCount = items.filter(
    (item) => item.currentVersionStatus === PROPOSAL_VERSION_STATUSES.Issued,
  ).length;
  const expiringCount = items.filter((item) => {
    const timing = describeValidityTiming(item.validUntil, now);
    return (
      timing?.code === 'EXPIRES_SOON' ||
      timing?.code === 'EXPIRES_TODAY' ||
      timing?.code === 'EXPIRED'
    );
  }).length;

  return (
    <ModulePage>
      {/*
        GRAMATICA APROVADA (Clientes) — `WorklistHeader`, nao `EnterpriseListHeader`.
        Sao componentes DIFERENTES: `EnterpriseListHeader` envolve a cabeca em um CARD com borda;
        `WorklistHeader` publica titulo + CONTAGEM DO SERVIDOR em badge + contexto + acao + faixa
        de indicadores, sem moldura. A familia usa a mesma peca para o operador reconhecer a tela
        pelo mesmo desenho em todas as worklists.
      */}
      <WorklistHeader
        title="Propostas comerciais"
        /*
         * CONTAGEM = o que o contrato desta lista REALMENTE publica. Diferente de Clientes, a
         * listagem de propostas nao devolve `total` do servidor — so a pagina carregada e o
         * `hasMore`. Declarar um total aqui seria inventar numero; a cabeca mostra a contagem
         * da pagina e a paginacao continua sendo a fonte do "tem mais".
         */
        count={items.length}
        context="Fila comercial de decisão no seu escopo autorizado: origem, revisão, valor, validade e próximo passo."
        metrics={
          <>
            <EnterpriseMetric
              value={awaitingCount}
              label="aguardando decisão"
              tone={awaitingCount > 0 ? 'info' : 'neutral'}
              hint="emitidas sem aceite"
            />
            <EnterpriseMetric value={decidedCount} label="decididas" hint="aceitas ou rejeitadas" />
            <EnterpriseMetric
              value={expiringCount}
              label="validade próxima/vencida"
              tone={expiringCount > 0 ? 'critical' : 'neutral'}
              hint={expiringCount > 0 ? 'exigem ação comercial' : 'nenhuma'}
            />
          </>
        }
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
          ) : null
        }
      />

      {/*
        TOOLBAR DENSA — era `EnterpriseToolbar` DENTRO de um card (`enterpriseTableCardClass`),
        o que empurrava a primeira linha da fila para fora da dobra. Passa a `WorklistFilterBar`,
        a mesma peca das demais worklists: uma linha, densa, com os mesmos filtros e a mesma
        consulta. Nenhum filtro foi removido nem alterado.
      */}
      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilter('search', searchInput);
          }}
        >
          <WorklistField label="Busca" htmlFor="proposal-search">
            <input
              id="proposal-search"
              type="search"
              className={worklistControlClass}
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="PROP-2026…"
            />
          </WorklistField>
          <WorklistField label="Situação" htmlFor="proposal-status">
            <select
              id="proposal-status"
              className={worklistSelectClass}
              value={filters.status}
              onChange={(event) => applyFilter('status', event.target.value)}
            >
              <option value="">Todas</option>
              {Object.values(PROPOSAL_VERSION_STATUSES).map((status) => (
                <option key={status} value={status}>
                  {formatProposalStatus(status)}
                </option>
              ))}
            </select>
          </WorklistField>
          <WorklistField label="Validade de" htmlFor="proposal-valid-from">
            <input
              id="proposal-valid-from"
              type="date"
              className={worklistControlClass}
              value={filters.validFrom}
              onChange={(event) => applyFilter('validFrom', event.target.value)}
            />
          </WorklistField>
          <WorklistField label="até" htmlFor="proposal-valid-to">
            <input
              id="proposal-valid-to"
              type="date"
              className={worklistControlClass}
              value={filters.validTo}
              onChange={(event) => applyFilter('validTo', event.target.value)}
            />
          </WorklistField>
          <WorklistField label="Ordenar por" htmlFor="proposal-sort">
            <select
              id="proposal-sort"
              className={worklistSelectClass}
              value={filters.sort}
              onChange={(event) => applyFilter('sort', event.target.value as ProposalListSort)}
            >
              {Object.values(PROPOSAL_LIST_SORTS).map((sort) => (
                <option key={sort} value={sort}>
                  {SORT_LABELS[sort]}
                </option>
              ))}
            </select>
          </WorklistField>
          <WorklistField label="Sentido" htmlFor="proposal-direction">
            <select
              id="proposal-direction"
              className={worklistSelectClass}
              value={filters.direction}
              onChange={(event) =>
                applyFilter('direction', event.target.value as ProposalListDirection)
              }
            >
              <option value="desc">Decrescente</option>
              <option value="asc">Crescente</option>
            </select>
          </WorklistField>
          <button type="submit" className="button-secondary">
            Buscar
          </button>
          {hasActiveFilters ? (
            <WorklistClearFilters
              visible
              onClick={() => {
                setSearchInput('');
                setFilters(EMPTY_FILTERS);
              }}
            />
          ) : null}
        </form>
      </WorklistFilterBar>

      <div className={enterpriseTableCardClass}>
        {items.length === 0 ? (
          <WorklistStatePanel
            title={
              hasActiveFilters
                ? 'Nenhuma proposta corresponde aos filtros aplicados.'
                : 'Nenhuma proposta registrada.'
            }
            description={
              hasActiveFilters
                ? 'Ajuste a busca, a situação ou a validade — ou limpe os filtros para ver a fila comercial completa.'
                : 'As propostas nascem das solicitações aprovadas; quando a primeira for emitida ela aparece aqui com revisão, valor, validade e próximo passo.'
            }
            action={
              hasActiveFilters ? (
                <WorklistClearFilters
                  visible
                  onClick={() => {
                    setSearchInput('');
                    setFilters(EMPTY_FILTERS);
                  }}
                />
              ) : capabilities.canCreate ? (
                <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
              ) : null
            }
          />
        ) : (
          <section aria-label="Fila comercial de propostas">
            <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_9rem_minmax(0,1.2fr)_minmax(0,1.5fr)] gap-4 border-b border-gray-200 px-3 pb-2 lg:grid">
              {[
                'Proposta',
                'Cliente e origem',
                'Revisão',
                'Valor',
                'Validade',
                'Situação e próximo passo',
              ].map((heading) => (
                <span
                  key={heading}
                  className="text-[11px] font-semibold tracking-wide text-gray-500 uppercase"
                >
                  {heading}
                </span>
              ))}
            </div>
            <ul className="divide-y divide-gray-100">
              {items.map((item) => {
                const attention = describeProposalAttention(
                  {
                    currentVersionStatus: item.currentVersionStatus,
                    validUntil: item.validUntil,
                    originRequestCount: item.originRequests?.length ?? 0,
                    revisionCount: item.revisionCount ?? 0,
                  },
                  now,
                );
                const timing = describeValidityTiming(item.validUntil, now);
                const revisions = item.revisionCount ?? 0;
                return (
                  <li
                    key={item.id}
                    className={cn(
                      enterpriseRowClass,
                      'grid grid-cols-1 gap-3 px-3 py-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_minmax(0,1.2fr)_9rem_minmax(0,1.2fr)_minmax(0,1.5fr)_9rem] lg:items-start lg:gap-4',
                    )}
                  >
                    <div className="min-w-0">
                      <Link
                        to={`/app/proposals/${item.id}`}
                        className="cisne-type-code text-sm font-semibold text-brand-700 no-underline hover:text-brand-800"
                      >
                        {item.proposalCode}
                      </Link>
                      <p className="mt-1 line-clamp-2 text-sm text-gray-700">{item.title}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        <UnitScopeLabel unitId={item.unitId} /> · criada{' '}
                        {formatRelativePast(item.createdAt, now)}
                      </p>
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">
                        {item.clientName ?? (
                          <span className="text-gray-400">Cliente não identificado</span>
                        )}
                      </p>
                      {item.originRequests && item.originRequests.length > 0 ? (
                        <p className="mt-0.5 truncate text-xs text-gray-500">
                          De{' '}
                          <Link
                            to={`/app/requests/${item.originRequests[0]!.id}`}
                            className="text-brand-700 no-underline hover:text-brand-800"
                          >
                            {item.originRequests[0]!.requestCode}
                          </Link>
                          {item.originRequests.length > 1
                            ? ` +${item.originRequests.length - 1}`
                            : ''}
                        </p>
                      ) : (
                        <p className="mt-0.5 text-xs text-gray-400">
                          Sem solicitação de origem visível
                        </p>
                      )}
                    </div>

                    <div className="min-w-0">
                      {item.revisionNumber === null ? (
                        <span className="text-sm text-gray-500">Sem versão</span>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-gray-800">
                            Revisão {item.revisionNumber}
                          </span>
                          {revisions > 1 ? (
                            <span className="mt-0.5 block text-xs text-gray-500">
                              {revisions - 1} revisão(ões) anterior(es)
                            </span>
                          ) : (
                            <span className="mt-0.5 block text-xs text-gray-400">
                              Primeira revisão
                            </span>
                          )}
                        </>
                      )}
                    </div>

                    <div className="min-w-0">
                      <span className="cisne-type-money text-sm font-semibold text-gray-900 tabular-nums">
                        {item.saleTotal
                          ? formatMoney(item.saleTotal, item.currencyCode ?? 'BRL')
                          : '—'}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-gray-500">
                        {item.currencyCode ?? 'moeda não informada'}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <span className="text-sm text-gray-800">
                        {item.validUntil ? formatDateTime(item.validUntil) : 'Sem validade'}
                      </span>
                      {timing ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-xs',
                            timing.tone === 'critical'
                              ? 'font-medium text-red-600'
                              : timing.tone === 'warning'
                                ? 'font-medium text-amber-700'
                                : 'text-gray-500',
                          )}
                        >
                          {timing.text}
                        </span>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      {item.currentVersionStatus ? (
                        <ProposalStatusBadge status={item.currentVersionStatus} />
                      ) : (
                        <span className="text-sm text-gray-500">Sem versão</span>
                      )}
                      <p className="mt-1 text-sm font-medium text-gray-800">
                        {item.currentVersionStatus
                          ? (NEXT_STEP_BY_STATUS[item.currentVersionStatus] ??
                            formatProposalNextStep('CLOSED'))
                          : formatProposalNextStep('COMPLETE_AND_ISSUE')}
                      </p>
                      {attention.length > 0 ? (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {attention.map((fact) => (
                            <span
                              key={fact.code}
                              className={cn(
                                'inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset',
                                ATTENTION_TONE_CLASS[fact.tone],
                              )}
                            >
                              {fact.text}
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    {/*
                      ACAO DA LINHA — mesma gramatica de Pedidos (GOLD 1), Clientes, Solicitacoes
                      e Pessoas. A fila comercial so abria pelo codigo; o rotulo do botao e o
                      PROXIMO PASSO da versao vigente, o mesmo verbo que a coluna ao lado ja
                      declara — nenhuma transicao nova foi criada.
                    */}
                    <div className="flex items-start lg:justify-end">
                      <Link to={`/app/proposals/${item.id}`} className={rowPrimaryActionClass}>
                        {item.currentVersionStatus
                          ? PROPOSAL_ACTION_LABEL[item.currentVersionStatus] ?? 'Abrir'
                          : 'Completar'}
                      </Link>
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 px-3 text-xs text-gray-400">
              Validade é a data comercial registrada na revisão vigente — não é SLA nem prazo de
              execução.
            </p>
          </section>
        )}
      </div>

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, offset - PAGE_SIZE), filters)}
        onNext={() => void loadPage(offset + PAGE_SIZE, filters)}
      />
    </ModulePage>
  );
}
