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
import { ContextDrawer } from '../../operator';
import { DateTime, Money } from '../../ui';
import {
  describeProposalAttention,
  describeValidityTiming,
  formatProposalNextStep,
} from '../utils/proposal-workbench';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  enterpriseRowClass,
  enterpriseTableCardClass,
  worklistControlClass,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { Button } from '../../ui/Button';
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
  /** Filtros de data, ordenação e sentido ficam atrás de "Mais filtros" — a barra abre compacta. */
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  /**
   * Proposta selecionada para o painel de contexto. Abre por clique na linha e NUNCA sozinho;
   * fechar limpa a seleção, para que o painel não continue afirmando um objeto que o operador
   * já deixou de olhar.
   */
  const [selected, setSelected] = useState<Proposal | null>(null);
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
        context="Decisão comercial pendente, valor e validade por proposta."
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
          ) : null
        }
      />

      {/*
        FILA DE DECISÃO — faixa COMPACTA, não card explicativo.

        A versão anterior ocupava ~180px de primeira dobra com dois cartões que explicavam a
        própria contagem ("Emitidas e ainda sem aceite, rejeição ou expiração"). O operador de ERP
        não precisa do manual: precisa do número e do recorte. Aqui cada fato é uma linha de
        ~28px — rótulo, contagem e clique que aplica o recorte real. A explicação vive no
        `title` (tooltip), disponível sem ocupar a dobra.

        Sem exceção publicada, a faixa NÃO é montada.
      */}
      {awaitingCount > 0 || expiringCount > 0 ? (
        <section
          aria-label="Fila de decisão"
          className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-gray-200 px-1 py-1.5"
        >
          <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            Fila de decisão
          </span>
          {awaitingCount > 0 ? (
            <button
              type="button"
              onClick={() => applyFilter('status', PROPOSAL_VERSION_STATUSES.Issued)}
              title="Propostas emitidas e ainda sem aceite, rejeição ou expiração."
              className="inline-flex items-baseline gap-1.5 text-[13px] text-gray-700 hover:text-brand-800"
            >
              <strong className="text-[15px] font-semibold tabular-nums text-gray-900">
                {awaitingCount}
              </strong>
              <span className="font-medium">aguardando decisão</span>
            </button>
          ) : null}
          {expiringCount > 0 ? (
            <button
              type="button"
              onClick={() => applyFilter('sort', PROPOSAL_LIST_SORTS.validUntil)}
              title="Validade comercial da revisão vigente vencida ou vencendo."
              className="inline-flex items-baseline gap-1.5 text-[13px] text-gray-700 hover:text-brand-800"
            >
              <strong className="text-[15px] font-semibold tabular-nums text-red-700">
                {expiringCount}
              </strong>
              <span className="font-medium">validade crítica</span>
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-gray-500 tabular-nums">
            {decidedCount} decididas no recorte
          </span>
        </section>
      ) : null}

      {/*
        TOOLBAR — busca + SITUAÇÃO em uma linha. Data, ordenação e sentido ficam sob "Mais
        filtros": eram cinco controles abertos ocupando metade da largura útil antes de o
        operador ver a primeira proposta. O recorte continua indo ao SERVIDOR, e nenhum filtro
        foi removido — só deixou de ser formulário permanente.
      */}
      <WorklistFilterBar
        meta={
          <>
            {items.length} nesta página
            {hasActiveFilters ? ' · recorte aplicado' : ''}
          </>
        }
      >
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            applyFilter('search', searchInput);
          }}
        >
          <WorklistField label="Busca" htmlFor="proposal-search" grow>
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
          <button type="submit" className="button-secondary">
            Buscar
          </button>
          <WorklistField label="&nbsp;" htmlFor="proposal-more-filters">
            <Button
              id="proposal-more-filters"
              type="button"
              variant="secondary"
              aria-expanded={showMoreFilters}
              onClick={() => setShowMoreFilters((current) => !current)}
            >
              {showMoreFilters ? 'Menos filtros' : 'Mais filtros'}
            </Button>
          </WorklistField>
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

        {showMoreFilters ? (
          <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-gray-100 pt-2">
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
          </div>
        ) : null}
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
            {/*
              HIERARQUIA DE COLUNA — cinco colunas com PESOS DIFERENTES, não sete iguais.

              "Revisão" deixou de ser coluna: ela não decide nada sozinha (Revisão 1 / Primeira
              revisão ocupavam 1.2fr de largura para dizer o mesmo em toda linha) e passou a
              qualificador do bloco principal, ao lado da origem. A coluna de ação também saiu: o
              botão repetido em toda linha gastava 9rem dizendo sempre a mesma coisa — agora a
              própria LINHA seleciona e abre o contexto.
            */}
            <div className="hidden grid-cols-[minmax(0,2.6fr)_7rem_minmax(0,1fr)_minmax(0,2.2fr)] gap-x-4 border-b border-gray-200 px-3 pb-1.5 lg:grid">
              {['Proposta e cliente', 'Valor', 'Validade', 'Situação e próxima ação'].map(
                (heading) => (
                  <span
                    key={heading}
                    className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase"
                  >
                    {heading}
                  </span>
                ),
              )}
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
                      'grid grid-cols-1 gap-3 px-3 py-2.5 lg:grid-cols-[minmax(0,2.6fr)_7rem_minmax(0,1fr)_minmax(0,2.2fr)] lg:items-start lg:gap-x-4',
                    )}
                    /*
                     * CLIQUE NA LINHA abre o CONTEXTO, sem sair da fila. O código da proposta
                     * continua sendo um link real (teclado, nova aba, leitor de tela) para a
                     * object page — profundidade. Cliques em elementos interativos internos
                     * seguem seu próprio comportamento.
                     */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button, select, input')) {
                        return;
                      }
                      setSelected(item);
                    }}
                  >
                    {/*
                      BLOCO PRINCIPAL — proposta, título, cliente e origem/revisão em UM bloco
                      hierárquico, em vez de três colunas de peso igual. O operador lê de cima
                      para baixo: o que é, para quem, de onde veio.
                    */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <Link
                          to={`/app/proposals/${item.id}`}
                          className="cisne-type-code text-[13px] font-semibold text-brand-700 no-underline hover:text-brand-800"
                        >
                          {item.proposalCode}
                        </Link>
                        <span className="truncate text-[13px] font-medium text-gray-900">
                          {item.clientName ?? (
                            <span className="font-normal text-gray-400">
                              Cliente não identificado
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-[13px] text-gray-700">{item.title}</p>
                      <p className="mt-0.5 text-[11px] text-gray-500">
                        {item.originRequests && item.originRequests.length > 0 ? (
                          <>
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
                          </>
                        ) : (
                          'Sem solicitação de origem'
                        )}
                        {item.revisionNumber !== null ? (
                          <>
                            {' · '}
                            {revisions > 1
                              ? `revisão ${item.revisionNumber}`
                              : 'primeira revisão'}
                          </>
                        ) : null}
                        {' · '}
                        <UnitScopeLabel unitId={item.unitId} />
                      </p>
                    </div>

                    <div className="min-w-0">
                      <span className="cisne-type-money text-[13px] font-semibold text-gray-900 tabular-nums">
                        {item.saleTotal
                          ? formatMoney(item.saleTotal, item.currencyCode ?? 'BRL')
                          : '—'}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <span className="text-[13px] text-gray-800 tabular-nums">
                        {item.validUntil ? formatDateTime(item.validUntil) : 'Sem validade'}
                      </span>
                      {/*
                        PRAZO só aparece quando é EXCEÇÃO real (vencida ou vencendo) — a data
                        "normal" não precisa de legenda. Antes toda linha carregava uma segunda
                        linha de texto de prazo, inclusive quando não havia nada a fazer.
                      */}
                      {timing ? (
                        <span
                          className={cn(
                            'mt-0.5 block text-[11px]',
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

                    {/*
                      ESTADO e PRÓXIMA AÇÃO com pesos DIFERENTES: o selo diz ONDE a proposta
                      está; a linha abaixo diz O QUE FAZER, com peso tipográfico próprio e
                      separada por um traço. Antes os dois eram dois parágrafos de texto de mesmo
                      tamanho, sem hierarquia — o operador não distinguia estado de ação.
                    */}
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        {item.currentVersionStatus ? (
                          <ProposalStatusBadge status={item.currentVersionStatus} />
                        ) : (
                          <span className="text-[13px] text-gray-500">Sem versão</span>
                        )}
                        <Link
                          to={`/app/proposals/${item.id}`}
                          className="text-[12px] font-medium text-brand-700 no-underline hover:text-brand-800"
                          aria-label={`Abrir proposta ${item.proposalCode}`}
                        >
                          Abrir
                        </Link>
                      </div>
                      <p className="mt-1 border-l-2 border-brand-200 pl-2 text-[12px] leading-snug font-medium text-gray-800">
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
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => void loadPage(Math.max(0, pageNumber - 1) * PAGE_SIZE, filters)}
        onNext={() => void loadPage(offset + PAGE_SIZE, filters)}
      />
      {/*
        CONTEXTO SOB DEMANDA — a linha seleciona e abre o painel lateral; o operador investiga
        SEM SAIR DA FILA. Fechar limpa a seleção.

        O painel NÃO duplica a object page: mostra o que decide a próxima ação (identidade,
        cliente, origem, valor, validade, situação e os fatos de atenção reais) e oferece o
        drillback para a profundidade. Nenhum dado novo é buscado — tudo já veio na linha.
      */}
      <ContextDrawer
        open={selected !== null}
        title="Contexto da proposta"
        onClose={() => setSelected(null)}
        preview={
          selected
            ? (() => {
                const attention = describeProposalAttention(
                  {
                    currentVersionStatus: selected.currentVersionStatus,
                    validUntil: selected.validUntil,
                    originRequestCount: selected.originRequests?.length ?? 0,
                    revisionCount: selected.revisionCount ?? 0,
                  },
                  now,
                );
                const timing = describeValidityTiming(selected.validUntil, now);
                return {
                  identifier: selected.proposalCode,
                  subtitle: selected.title,
                  status: selected.currentVersionStatus ? (
                    <ProposalStatusBadge status={selected.currentVersionStatus} />
                  ) : undefined,
                  facts: [
                    {
                      label: 'Cliente',
                      value: selected.clientName ?? 'Cliente não identificado',
                    },
                    {
                      label: 'Valor',
                      value: selected.saleTotal ? (
                        <Money
                          value={selected.saleTotal}
                          currencyCode={selected.currencyCode ?? 'BRL'}
                          emphasis
                        />
                      ) : (
                        '—'
                      ),
                      emphasis: true,
                    },
                    {
                      label: 'Validade',
                      value: selected.validUntil ? (
                        <DateTime value={selected.validUntil} mode="date" />
                      ) : (
                        'Sem validade'
                      ),
                    },
                    {
                      label: 'Revisão',
                      value:
                        selected.revisionNumber === null
                          ? 'Sem versão'
                          : `Revisão ${selected.revisionNumber}`,
                    },
                    {
                      label: 'Origem',
                      value:
                        selected.originRequests && selected.originRequests.length > 0
                          ? selected.originRequests.map((request) => request.requestCode).join(', ')
                          : 'Sem solicitação de origem',
                    },
                    ...(timing ? [{ label: 'Prazo', value: timing.text }] : []),
                    ...attention.map((fact) => ({ label: 'Atenção', value: fact.text })),
                  ],
                  relations:
                    selected.originRequests && selected.originRequests.length > 0
                      ? selected.originRequests.map((request) => ({
                          label: 'Solicitação de origem',
                          value: request.requestCode,
                          href: `/app/requests/${request.id}`,
                        }))
                      : undefined,
                  nextAction: {
                    label: selected.currentVersionStatus
                      ? (NEXT_STEP_BY_STATUS[selected.currentVersionStatus] ??
                        formatProposalNextStep('CLOSED'))
                      : formatProposalNextStep('COMPLETE_AND_ISSUE'),
                    href: `/app/proposals/${selected.id}`,
                  },
                  detailHref: `/app/proposals/${selected.id}`,
                  /*
                   * O rotulo do drillback e o VERBO do proximo passo da versao vigente — a mesma
                   * maquina de estados que a lista le, so encurtada para o alvo de clique. Dizer
                   * "Emitir" ou "Nova revisao" e mais util que um "Abrir" generico.
                   */
                  detailLabel: selected.currentVersionStatus
                    ? `${PROPOSAL_ACTION_LABEL[selected.currentVersionStatus] ?? 'Abrir'} — ficha completa`
                    : 'Completar e emitir — ficha completa',
                };
              })()
            : null
        }
      />
    </ModulePage>
  );
}
