import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RELATION_SCOPE_KEYS, useRelationScope } from '../../enterprise-object';
import {
  acceptProposalVersion,
  cancelProposalVersion,
  expireProposalVersion,
  getProposal,
  issueProposalVersion,
  listProposals,
  ProposalsApiError,
  rejectProposalVersion,
} from '../api/proposals-api';
import { mapProposalErrorToMessage } from '../api/proposal-error-messages';
import { useProposalCapabilities } from '../hooks/useProposalCapabilities';
import { ProposalStatusBadge } from '../components/ProposalStatusBadge';
import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  PROPOSAL_LIST_SORTS,
  PROPOSAL_VERSION_STATUSES,
  type Proposal,
  type ProposalAcceptanceOrigin,
  type ProposalDetail,
  type ProposalListDirection,
  type ProposalListSort,
  type ProposalTransition,
} from '../types/proposal.types';
import {
  formatAcceptanceOrigin,
  formatDateTime,
  formatMoney,
  formatProposalStatus,
} from '../utils/proposal-labels';
import { useAuth } from '../../auth/context/AuthProvider';
import { DynamicContextDrawer, DynamicSavedViewsBar, useSavedViews } from '../../engine';
import { DateTime, Money } from '../../ui';
import { Skeleton } from '../../ui/Skeleton';
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

const ATTENTION_TONE_CLASS: Record<string, string> = {
  critical: 'bg-red-50 text-red-700 ring-red-600/20',
  warning: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  info: 'bg-gray-100 text-gray-600 ring-gray-400/20',
};

/**
 * `revise` cria uma NOVA versão — é um fluxo de formulário, não um comando de contexto. O backend
 * publica `revise` em `availableTransitions`, mas esta página não o oferece como botão de linha, e
 * por isso todo comando de contexto aqui é uma transição SEM `revise`.
 */
type ProposalContextCommand = Exclude<ProposalTransition, 'revise'>;

/**
 * VERBO DO COMANDO NO CONTEXTO — o rótulo do botão é a própria transição, não um "Executar".
 *
 * O botão só é montado quando o BACKEND publicou a transição em `availableTransitions`; o rótulo
 * aqui não autoriza nada, apenas nomeia o que o servidor já admitiu.
 */
const COMMAND_LABEL: Record<ProposalContextCommand, string> = {
  issue: 'Emitir revisão',
  accept: 'Registrar aceite',
  reject: 'Rejeitar',
  expire: 'Marcar como expirada',
  cancel: 'Cancelar',
};

const COMMAND_DONE_LABEL: Record<ProposalContextCommand, string> = {
  issue: 'Revisão emitida.',
  accept: 'Aceite registrado.',
  reject: 'Revisão rejeitada.',
  expire: 'Revisão marcada como expirada.',
  cancel: 'Revisão cancelada.',
};

/** Comandos que o contrato aceita SEM motivo. O motivo é auditado pelo operador, não fabricado. */
const COMMANDS_WITH_REASON: ProposalContextCommand[] = ['reject', 'cancel'];

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
  const { identityId } = useAuth();
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
  /*
   * CONTEXTO AUTORITATIVO — a linha NÃO basta para agir.
   *
   * A linha da lista publica `currentVersionNumber` e o `rowVersion` da PROPOSTA, mas não o
   * `rowVersion` da VERSÃO — que é o que os comandos exigem. Sem buscar o detalhe, o painel só
   * poderia (a) exibir fatos que talvez não sejam os vigentes e (b) oferecer comandos que o
   * servidor recusaria. Por isso o painel busca `getProposal` e trata o detalhe como o que ele é:
   * a fonte da versão vigente, das transições disponíveis e dos bloqueios.
   */
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; detail: ProposalDetail }
  >({ phase: 'idle' });
  /** Motivo digitado pelo OPERADOR. Nos contratos de rejeição/cancelamento o campo é OPCIONAL. */
  const [commandReason, setCommandReason] = useState('');
  /** Origem da aceitação: enum do contrato, não texto livre. */
  const [acceptanceOrigin, setAcceptanceOrigin] = useState<ProposalAcceptanceOrigin>(
    PROPOSAL_ACCEPTANCE_ORIGINS.ClientWrittenConfirmation,
  );
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [commandDone, setCommandDone] = useState<string | null>(null);
  const navigate = useNavigate();
  const selectedId = selected?.id ?? null;

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
  }, [filters, loadPage, reloadToken]);

  /*
   * CARREGAMENTO LOCALIZADO DO CONTEXTO — só o painel espera. A fila permanece utilizável, e o
   * detalhe é buscado de novo a cada seleção para que o painel nunca afirme estado velho.
   */
  useEffect(() => {
    if (!selectedId) {
      setDetailState({ phase: 'idle' });
      setCommandReason('');
      setCommandError(null);
      setCommandDone(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    setCommandDone(null);
    void getProposal(selectedId, controller.signal)
      .then((detail) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', detail });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto da proposta.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId, reloadToken]);

  /*
   * COMANDO REAL A PARTIR DO CONTEXTO.
   *
   * DUAS BARREIRAS INDEPENDENTES, e é isso que torna o comando honesto:
   *   1. `readiness.availableTransitions` — o BACKEND decide quais transições a versão vigente
   *      admite. O frontend não conhece a máquina de estados e não a reimplementa.
   *   2. `capabilities.can*` — o BACKEND decide o que o ator pode fazer.
   * Um comando só aparece na interseção das duas. `rowVersion` vai no payload: concorrência
   * otimista é do domínio, e conflito de versão vira mensagem — não é mascarado.
   */
  const availableCommands = useMemo<ProposalContextCommand[]>(() => {
    if (detailState.phase !== 'ready') {
      return [];
    }
    const allowed: Record<ProposalTransition, boolean> = {
      issue: capabilities.canIssue,
      accept: capabilities.canAccept,
      reject: capabilities.canReject,
      expire: capabilities.canExpire,
      cancel: capabilities.canCancel,
      /*
       * `revise` cria uma NOVA versão — é um fluxo de formulário, não um comando de linha. Ele não
       * é oferecido aqui para não transformar criação de documento em clique de contexto.
       */
      revise: false,
    };
    return detailState.detail.readiness.availableTransitions.filter(
      (transition): transition is ProposalContextCommand =>
        transition !== 'revise' && allowed[transition],
    );
  }, [capabilities, detailState]);

  const runContextCommand = useCallback(
    async (command: ProposalContextCommand) => {
      if (detailState.phase !== 'ready') {
        return;
      }
      const version = detailState.detail.currentVersion;
      if (!version) {
        setCommandError('A proposta não tem versão vigente para receber comando.');
        return;
      }
      const reason = commandReason.trim();
      setCommandBusy(true);
      setCommandError(null);
      setCommandDone(null);
      try {
        if (command === 'issue') {
          await issueProposalVersion(detailState.detail.proposal.id, version.versionNumber, version.rowVersion);
        } else if (command === 'expire') {
          await expireProposalVersion(detailState.detail.proposal.id, version.versionNumber, version.rowVersion);
        } else if (command === 'accept') {
          await acceptProposalVersion(detailState.detail.proposal.id, version.versionNumber, {
            rowVersion: version.rowVersion,
            acceptanceOriginCode: acceptanceOrigin,
          });
        } else if (command === 'reject') {
          await rejectProposalVersion(detailState.detail.proposal.id, version.versionNumber, {
            rowVersion: version.rowVersion,
            ...(reason === '' ? {} : { rejectionReason: reason }),
          });
        } else {
          await cancelProposalVersion(detailState.detail.proposal.id, version.versionNumber, {
            rowVersion: version.rowVersion,
            ...(reason === '' ? {} : { cancellationReason: reason }),
          });
        }
        setCommandReason('');
        setCommandDone(COMMAND_DONE_LABEL[command]);
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof ProposalsApiError
            ? mapProposalErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [acceptanceOrigin, commandReason, detailState],
  );

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

  /*
   * VISÕES SALVAS — o recorte comercial que o operador remonta todo dia.
   *
   * A fila tem filtros PERSISTÍVEIS (busca, situação, validade) que vivem na URL e vão ao
   * SERVIDOR. Salvá-los é produtividade: sem isto o operador reconstrói o mesmo recorte a cada
   * sessão. O armazenamento é o mesmo das demais worklists (`useSavedViews`).
   */
  /* SEM IDENTIDADE, NÃO PERSISTE: `null` em vez do namespace compartilhado `'anonymous'`. */
  const savedViews = useSavedViews(identityId ?? null, 'proposals');

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
    <ModulePage layout="wide">
      {/*
        GRAMATICA APROVADA (Clientes) — `WorklistHeader`, nao `EnterpriseListHeader`.
        Sao componentes DIFERENTES: `EnterpriseListHeader` envolve a cabeca em um CARD com borda;
        `WorklistHeader` publica titulo + CONTAGEM DO SERVIDOR em badge + contexto + acao + faixa
        de indicadores, sem moldura. A familia usa a mesma peca para o operador reconhecer a tela
        pelo mesmo desenho em todas as worklists.
      */}
      <div data-region="operating-header">
      <WorklistHeader
        title="Propostas comerciais"
        /*
         * CONTAGEM = o que o contrato desta lista REALMENTE publica.
         *
         * VERIFICADO NO CONTRATO (nao presumido): `ProposalListResponse` e `{ items, limit, offset }`
         * — NAO existe `total`. Portanto o numero ao lado do titulo e a contagem DESTA PAGINA, e o
         * escopo precisa estar escrito: um numero solto ao lado do titulo de uma worklist le como
         * total do conjunto, e aqui isso seria amostra apresentada como dataset.
         *
         * O escopo vai no `context`, que o operador le, e nao so no `aria-label`. O `hasMore`
         * continua sendo a unica fonte do "tem mais".
         */
        count={items.length}
        context={`Página ${pageNumber} — decisão comercial por proposta. Esta lista não publica total; a contagem acima é desta página.`}
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/proposals/new">Nova proposta</ModulePrimaryLink>
          ) : null
        }
      />
      </div>

      {/*
        RECORTE DE DECISÃO — resumo LOCAL, declarado como local.

        O rótulo anterior era "Fila de decisão" e os números saíam da página carregada: um operador
        lia "3 aguardando decisão" como a fila inteira da empresa. A API desta lista nao publica
        agregado nenhum, entao a escolha honesta nao e inventar o numero nem apagar o recorte — e
        dizer de onde ele vem. "Nesta página" aparece no nome da faixa, no tooltip de cada contagem e
        no fecho; nao so na acessibilidade.

        Sem exceção publicada, a faixa NAO e montada.
      */}
      {awaitingCount > 0 || expiringCount > 0 ? (
        <section
          aria-label="Decisão nesta página"
          className="mb-2 flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-gray-200 px-1 py-1.5"
        >
          <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">
            Decisão nesta página
          </span>
          {awaitingCount > 0 ? (
            <button
              type="button"
              onClick={() => applyFilter('status', PROPOSAL_VERSION_STATUSES.Issued)}
              title="Nesta página: propostas emitidas e ainda sem aceite, rejeição ou expiração. A API desta lista não publica total do conjunto."
              className="inline-flex items-baseline gap-1.5 text-[13px] text-gray-700 hover:text-brand-800"
            >
              <strong className="text-[15px] font-semibold tabular-nums text-gray-900">
                {awaitingCount}
              </strong>
              <span className="font-medium">aguardando decisão nesta página</span>
            </button>
          ) : null}
          {expiringCount > 0 ? (
            <button
              type="button"
              onClick={() => applyFilter('sort', PROPOSAL_LIST_SORTS.validUntil)}
              title="Nesta página: validade comercial da revisão vigente vencida ou vencendo. A API desta lista não publica total do conjunto."
              className="inline-flex items-baseline gap-1.5 text-[13px] text-gray-700 hover:text-brand-800"
            >
              <strong className="text-[15px] font-semibold tabular-nums text-red-700">
                {expiringCount}
              </strong>
              <span className="font-medium">validade crítica nesta página</span>
            </button>
          ) : null}
          <span className="ml-auto text-[11px] text-gray-500 tabular-nums">
            {decidedCount} decididas nesta página
          </span>
        </section>
      ) : null}

      {/*
        TOOLBAR — busca + SITUAÇÃO em uma linha. Data, ordenação e sentido ficam sob "Mais
        filtros": eram cinco controles abertos ocupando metade da largura útil antes de o
        operador ver a primeira proposta. O recorte continua indo ao SERVIDOR, e nenhum filtro
        foi removido — só deixou de ser formulário permanente.
      */}
      {/*
        SAVED VIEWS — faixa própria da work area, ANTES da superfície de filtro.
        Gramática: OPERATING HEADER -> SAVED VIEWS -> COMMAND/FILTER -> WORK QUEUE.
      */}
      <div data-region="saved-view-surface">
        <DynamicSavedViewsBar
          views={savedViews.views}
          persistedLocally={savedViews.persistedLocally}
          onSave={(name) => savedViews.save(name, { ...filters }, 'list')}
          onDelete={savedViews.remove}
          onApply={(view) => {
            const restored: QueueFilters = {
              ...EMPTY_FILTERS,
              ...(view.filters as Partial<QueueFilters>),
            };
            setFilters(restored);
            setSearchInput(restored.search ?? '');
          }}
        />
      </div>

      <div data-region="command-filter-surface">
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
      </div>

      {/*
        WORK QUEUE — a fila é a ÁREA DE TRABALHO, não um card dentro dela.

        Antes: `enterpriseTableCardClass` (`rounded-md border bg-white shadow-[...]`) em volta da
        lista. Como a área de trabalho já é branca, a fila aparecia como "tabela dentro de card" —
        cardification de segundo nível. Agora a fila não tem caixa: é delimitada pelo divisor da
        superfície de filtro e pela largura da própria lista.
      */}
      <div data-region="worklist-master">
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
                      /*
                        DENSIDADE — `py-2.5` com `items-start` dava 106–131px por linha (medido:
                        apenas 4 de 14 propostas na primeira dobra). O padding cai para o valor de
                        token e o alinhamento passa a `items-center`, para que as colunas de valor e
                        validade (uma linha) não herdem a altura da coluna de identidade.
                      */
                      'grid grid-cols-1 gap-y-1 px-3 py-1.5 lg:grid-cols-[minmax(0,2.6fr)_7rem_minmax(0,1fr)_minmax(0,2.2fr)] lg:items-center lg:gap-x-4 lg:gap-y-0',
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
                      {/*
                        TÍTULO + METADADO SUBORDINADO NA MESMA LINHA.

                        O título ocupava linha própria e o metadado (origem, revisão, unidade)
                        ocupava outra — três linhas só no bloco de identidade, que era o que fixava
                        a altura da grade. O título é o dado que o operador lê; origem/revisão/
                        unidade são CONFIRMAÇÃO do registro e ficam ao lado, em tipografia
                        subordinada. Duas linhas, e nenhuma informação perdida.
                      */}
                      <p className="m-0 mt-0.5 flex items-baseline gap-x-2 truncate">
                        <span className="min-w-0 shrink truncate text-[length:var(--type-body-size)] text-gray-800">
                          {item.title}
                        </span>
                        <span className="cisne-type-helper min-w-0 truncate">
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
                        </span>
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
                      separada por um traço.

                      O link "Abrir" foi REMOVIDO: a IDENTIDADE da linha (`proposalCode`) já é o
                      drillback real para a ficha completa, e repetir a mesma ação em toda linha é
                      exatamente o padrão CRUD que esta wave elimina. Duas portas para o mesmo
                      destino não ajudam o operador — só duplicam o alvo de clique.
                    */}
                    <div className="min-w-0">
                      {/*
                        ESTADO + PRÓXIMA AÇÃO NA MESMA LINHA.

                        O selo e a frase do próximo passo empilhavam (selo, depois a frase com
                        `mt-1`, depois os chips de atenção), somando até três linhas só nesta
                        célula — e era ela que definia a altura de TODA a grade. Estado diz ONDE
                        está; a ação diz O QUE FAZER, e o operador compara os dois na HORIZONTAL
                        ao varrer a coluna. Os chips de atenção continuam em linha própria porque
                        são EXCEÇÃO, e exceção tem direito a espaço.
                      */}
                      {/*
                        UMA LINHA, SEM WRAP.

                        Medido: esta célula media 103px e era ELA que definia a altura da grade —
                        o selo somado à frase do próximo passo quebrava em três linhas (`flex-wrap`)
                        e os chips de atenção em mais duas. Agora selo e frase dividem UMA linha
                        truncada e os chips ocupam UMA linha truncada: o texto longo é cortado na
                        pintura, não empilhado, e continua íntegro no DOM (acessível por `title` e
                        ao leitor de tela).
                      */}
                      <div className="flex min-w-0 items-baseline gap-x-2">
                        <span className="shrink-0">
                          {item.currentVersionStatus ? (
                            <ProposalStatusBadge status={item.currentVersionStatus} />
                          ) : (
                            <span className="cisne-type-meta">Sem versão</span>
                          )}
                        </span>
                        <span
                          className="cisne-type-helper min-w-0 truncate font-medium text-gray-700"
                          title={
                            item.currentVersionStatus
                              ? (NEXT_STEP_BY_STATUS[item.currentVersionStatus] ??
                                formatProposalNextStep('CLOSED'))
                              : formatProposalNextStep('COMPLETE_AND_ISSUE')
                          }
                        >
                          {item.currentVersionStatus
                            ? (NEXT_STEP_BY_STATUS[item.currentVersionStatus] ??
                              formatProposalNextStep('CLOSED'))
                            : formatProposalNextStep('COMPLETE_AND_ISSUE')}
                        </span>
                      </div>
                      {attention.length > 0 ? (
                        <div className="mt-0.5 flex min-w-0 items-center gap-1 overflow-hidden">
                          {attention.map((fact) => (
                            <span
                              key={fact.code}
                              title={fact.text}
                              className={cn(
                                'inline-flex shrink-0 items-center truncate rounded px-1.5 py-0.5 text-[length:var(--type-micro-size)] font-medium ring-1 ring-inset',
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
        CONTEXT REGION AUTORITATIVA — decisão rápida na fila, sobre o dado do SERVIDOR.

        ANTES: o painel era alimentado pela LINHA da lista e não oferecia comando nenhum — o
        "próximo passo" era um link para a ficha. Dois defeitos: (a) a linha é um RESUMO, então o
        painel podia afirmar valor, validade e revisão diferentes dos da versão vigente real;
        (b) a ação prometida era NAVEGAÇÃO vestida de comando, porque agir exigia sair da fila.

        AGORA: selecionar busca `getProposal` e o painel lê o DETALHE — versão vigente
        (`versionNumber`, `rowVersion`, situação, valor, validade) e `readiness`, onde o BACKEND
        publica as transições admitidas e os bloqueios. O comando aparece na INTERSEÇÃO entre
        transição publicada e capability do ator; nenhuma das duas é inferida aqui.

        A FILA NÃO DESMONTA: filtros, ordenação, Saved View, página e scroll permanecem, porque o
        detalhe vive em estado próprio e o único `loading` é o do painel.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto da proposta"
        onClose={() => setSelected(null)}
        crossReferences={[]}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {selected.proposalCode}
              <span className="cisne-type-helper"> · {selected.title}</span>
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
                const detail = detailState.detail;
                const version = detail.currentVersion;
                /*
                 * VALOR DA VERSÃO VIGENTE — mesma expressão que a ficha usa
                 * (`globalSalePrice ?? itemsSaleTotal`). Não é regra nova: é a leitura que o módulo
                 * já adota, para que painel e ficha nunca publiquem números diferentes.
                 */
                const amount = version?.globalSalePrice ?? version?.itemsSaleTotal ?? null;
                return (
                  <>
                    <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                      <dt className="cisne-meta-label pt-0.5">Cliente</dt>
                      <dd className="cisne-meta-value m-0 truncate">
                        {detail.proposal.clientName ?? 'Não identificado neste acesso'}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Situação</dt>
                      <dd className="cisne-meta-value m-0">
                        {version ? (
                          <ProposalStatusBadge status={version.status} />
                        ) : (
                          'Sem versão vigente'
                        )}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Revisão</dt>
                      <dd className="cisne-meta-value m-0">
                        {version ? `Revisão ${version.versionNumber}` : '—'}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Valor</dt>
                      <dd className="cisne-meta-value m-0">
                        {amount ? (
                          <Money
                            value={amount}
                            currencyCode={version?.currencyCode ?? 'BRL'}
                            emphasis
                          />
                        ) : (
                          '—'
                        )}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Validade</dt>
                      <dd className="cisne-meta-value m-0">
                        {version?.validUntil ? (
                          <DateTime value={version.validUntil} mode="date" />
                        ) : (
                          'Sem validade'
                        )}
                      </dd>
                      <dt className="cisne-meta-label pt-0.5">Próximo passo</dt>
                      <dd className="cisne-meta-value m-0">
                        {formatProposalNextStep(detail.readiness.nextStep)}
                      </dd>
                    </dl>

                    {/* IMPEDIMENTOS PUBLICADOS — o que o BACKEND diz que trava o próximo passo. */}
                    {detail.readiness.blockers.length > 0 ? (
                      <div className="cisne-divider--top mb-2 mt-2 pt-2">
                        <h3 className="cisne-section-title m-0 mb-1">Impedimentos publicados</h3>
                        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                          {detail.readiness.blockers.map((blocker) => (
                            <li key={blocker} className="cisne-type-meta">
                              {blocker}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    {/* LINHAGEM REAL — só os degraus que o detalhe publica. */}
                    {detail.linkedChain.length > 0 ? (
                      <div className="cisne-divider--top mb-2 mt-2 pt-2">
                        <h3 className="cisne-section-title m-0 mb-1">Linhagem</h3>
                        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                          {detail.linkedChain.map((node) => (
                            <li key={`${node.kind}:${node.id}`} className="cisne-type-meta truncate">
                              {node.kind}
                              {node.label ? ` · ${node.label}` : ''}
                              {node.status ? ` · ${node.status}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}

                    <div className="cisne-divider--top mt-2 pt-2">
                      {availableCommands.length > 0 ? (
                        <>
                          {availableCommands.some((command) =>
                            COMMANDS_WITH_REASON.includes(command),
                          ) ? (
                            <label className="mb-1 block">
                              <span className="cisne-meta-label mb-0.5 block">
                                Motivo (opcional neste contrato; fica na auditoria do comando)
                              </span>
                              <textarea
                                rows={2}
                                className="w-full rounded-md border-0 bg-white px-1.5 py-1 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                                value={commandReason}
                                onChange={(event) => setCommandReason(event.target.value)}
                                placeholder="Descreva o motivo, se houver"
                              />
                            </label>
                          ) : null}

                          {availableCommands.includes('accept') ? (
                            <label className="mb-1 block">
                              <span className="cisne-meta-label mb-0.5 block">
                                Origem da aceitação
                              </span>
                              <select
                                className="min-h-[var(--control-height)] w-full rounded-md border-0 bg-white px-1.5 text-[length:var(--type-body-size)] text-gray-900 ring-1 ring-gray-300 ring-inset outline-none focus:ring-2 focus:ring-brand-500"
                                value={acceptanceOrigin}
                                onChange={(event) =>
                                  setAcceptanceOrigin(
                                    event.target.value as ProposalAcceptanceOrigin,
                                  )
                                }
                              >
                                {Object.values(PROPOSAL_ACCEPTANCE_ORIGINS).map((origin) => (
                                  <option key={origin} value={origin}>
                                    {formatAcceptanceOrigin(origin)}
                                  </option>
                                ))}
                              </select>
                            </label>
                          ) : null}

                          <div className="flex flex-wrap items-center gap-1.5">
                            {availableCommands.map((command) => (
                              <Button
                                key={command}
                                variant={
                                  command === 'issue' || command === 'accept'
                                    ? 'primary'
                                    : 'secondary'
                                }
                                loading={commandBusy}
                                onClick={() => void runContextCommand(command)}
                              >
                                {COMMAND_LABEL[command]}
                              </Button>
                            ))}
                          </div>
                        </>
                      ) : (
                        <p className="cisne-type-helper m-0">
                          {detail.readiness.nextStep === 'CREATE_NEW_REVISION'
                            ? 'Sem comando de contexto: o próximo passo é abrir uma nova revisão.'
                            : 'Nenhum comando disponível para o seu acesso nesta versão.'}
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

                    {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
                    <div className="cisne-divider--top mt-2 pt-2">
                      <Button
                        variant="secondary"
                        onClick={() => void navigate(`/app/proposals/${detail.proposal.id}`)}
                      >
                        Abrir ficha completa
                      </Button>
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
