import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  PeopleApiError,
  activatePerson,
  deactivatePerson,
  getPerson,
  listPeople,
} from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import { useAuth } from '../../auth/context/AuthProvider';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import { PERSON_STATUSES, type Person, type PersonStatus } from '../types/person.types';
import {
  DynamicContextDrawer,
  DynamicSavedViewsBar,
  useSavedViews,
} from '../../engine';
import { Button } from '../../ui/Button';
import { Skeleton } from '../../ui/Skeleton';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistControlClass,
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

const PAGE_SIZE = 20;

/**
 * WORKFORCE WORKLIST — a lista de Pessoas e a fila de trabalho da mao de obra.
 *
 * Antes era um filtro de status mais uma tabela: sem busca, sem recorte de funcao,
 * sem contexto de alocacao e sem contagem — o operador via 0 linhas e 6% da tela
 * ocupada. O contrato do backend JA aceitava `q` e `defaultLaborTypeCode`; o que
 * faltava era a superficie usar o que existe.
 *
 * Tudo aqui e server-side: a busca vai na consulta, o recorte de status vai na
 * consulta, a funcao vai na consulta. O navegador nao filtra lista grande.
 *
 * NAO se inventou disponibilidade: o contrato publica
 * `serviceOrderAllocationSupported` (a pessoa PODE ser alocada em OS) e nao publica
 * alocacao atual. O que nao existe no payload nao aparece na tela — a coluna de
 * disponibilidade fica PARK ate o backend publicar a alocacao vigente.
 */

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: Person[]; offset: number; hasMore: boolean; total: number | null };

/** Atraso da busca digitada: sem ele cada tecla vira requisicao. */
const SEARCH_DEBOUNCE_MS = 300;

export function PeopleListPage() {
  const navigate = useNavigate();
  const { identityId } = useAuth();
  const { capabilities } = usePersonCapabilities();
  const [searchParams, setSearchParams] = useSearchParams();

  // Recorte vive na URL: recarregar, voltar e compartilhar preservam a fila.
  const statusFilter = (searchParams.get('status') ?? '') as '' | PersonStatus;
  const laborType = searchParams.get('laborType') ?? '';
  const query = searchParams.get('q') ?? '';
  const offset = Math.max(0, Number(searchParams.get('offset') ?? '0') || 0);

  const [searchInput, setSearchInput] = useState(query);
  const [laborTypes, setLaborTypes] = useState<{ code: string; name: string }[]>([]);
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });

  /*
   * VISÕES SALVAS — faixa própria da work area.
   * O recorte de mão de obra (status + função) é reconstruído todo dia pelo planejador; salvá-lo
   * é produtividade, não configuração.
   */
  const savedViews = useSavedViews(identityId ?? 'anonymous', 'people');

  /*
   * CONTEXTO DA PESSOA — seleção da linha + detalhe REAL (`GET /people/:id`).
   *
   * A listagem é deliberadamente uma projeção magra. O detalhe publica `externalErpId`,
   * `deactivatedAt`, `deactivationReason` e a `version` — os fatos que permitem CONFERIR e AGIR
   * sem sair da fila. Carregamento é LOCALIZADO: só o painel espera.
   */
  const [selected, setSelected] = useState<Person | null>(null);
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; person: Person }
  >({ phase: 'idle' });

  /*
   * MOTIVO DO COMANDO — informado pelo OPERADOR, nunca fabricado.
   * `deactivatePerson` exige `reason`: o motivo é registro de auditoria. Um texto fixo de tela
   * seria o frontend inventando um fato empresarial.
   */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    const personId = selected?.id ?? null;
    if (!personId) {
      setDetailState({ phase: 'idle' });
      setCommandReason('');
      setCommandError(null);
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    void getPerson(personId, controller.signal)
      .then((person) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', person });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto da Pessoa.',
          });
        }
      });
    return () => controller.abort();
  }, [selected]);

  /** COMANDO REAL do domínio a partir do contexto. O motivo vai como o operador o escreveu. */
  const runCommand = useCallback(
    async (command: 'activate' | 'deactivate') => {
      if (!selected) {
        return;
      }
      setCommandBusy(true);
      setCommandError(null);
      try {
        if (command === 'activate') {
          await activatePerson(selected.id, selected.version);
        } else {
          await deactivatePerson(selected.id, selected.version, commandReason);
        }
        setSelected(null);
        setReloadToken((current) => current + 1);
      } catch (error) {
        setCommandError(
          error instanceof PeopleApiError
            ? mapPersonErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, selected],
  );

  const updateParam = useCallback(
    (key: string, value: string | null) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
          // Qualquer mudanca de recorte volta para a primeira pagina.
          if (key !== 'offset') {
            next.delete('offset');
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // O campo responde a digitacao localmente; a URL so muda depois do debounce.
  useEffect(() => {
    setSearchInput(query);
  }, [query]);

  useEffect(() => {
    if (searchInput === query) {
      return;
    }
    const timer = setTimeout(() => updateParam('q', searchInput.trim() || null), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput, query, updateParam]);

  const loadPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      // Recarga preserva o resultado anterior: trocar a tabela por "Carregando…"
      // desmontaria a propria barra de busca durante a digitacao.
      setListState((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }));
      try {
        const response = await listPeople(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            status: statusFilter || undefined,
            q: query.trim() || undefined,
            defaultLaborTypeCode: laborType || undefined,
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
          // O contrato nao publica `total`; o que nao existe nao e estimado.
          total: null,
        });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof PeopleApiError) {
          if (error.kind === 'denied') {
            setListState({ phase: 'denied' });
            return;
          }
          setListState({
            phase: 'error',
            message: mapPersonErrorToMessage(error.code, error.status),
            retryable: error.kind === 'network' || error.kind === 'unknown',
          });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar as Pessoas.',
          retryable: true,
        });
      }
    },
    [statusFilter, query, laborType],
  );

  /**
   * RECARGA REAL DA FILA — token monotônico.
   *
   * Sem ele, um comando de domínio que muda o estado do registro deixaria a grade mostrando o
   * estado antigo: o efeito de carga não roda de novo se nenhuma de suas dependências muda.
   */
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset, reloadToken]);

  /*
   * Opcoes de funcao vem do catalogo AUTORIZADO de tipos de mao de obra
   * (`/api/v1/resources/labor-types`, ja existente). Derivar apenas das linhas
   * carregadas esconderia o filtro numa pagina sem resultado — justamente quando o
   * operador mais precisa dele para sair do recorte vazio.
   */
  useEffect(() => {
    const controller = new AbortController();
    void listLaborTypes(controller.signal)
      .then((types) => {
        if (!controller.signal.aborted) {
          setLaborTypes(types.map((type) => ({ code: type.code, name: type.name })));
        }
      })
      .catch(() => {
        // Catalogo indisponivel nao inventa opcao: o filtro simplesmente nao aparece.
        if (!controller.signal.aborted) {
          setLaborTypes([]);
        }
      });
    return () => controller.abort();
  }, []);

  const hasFilters = statusFilter !== '' || laborType !== '' || query.trim() !== '';
  const activeLaborTypeLabel = useMemo(
    () => laborTypes.find((entry) => entry.code === laborType)?.name ?? laborType,
    [laborTypes, laborType],
  );

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Pessoas">
        <ModuleLoadingState message="Carregando Pessoas…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Pessoas">
        <ModuleDeniedState
          message="Você não tem permissão para listar Pessoas."
        />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Pessoas">
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
  const activeCount = items.filter((person) => person.status === PERSON_STATUSES.Active).length;
  const allocatableCount = items.filter((person) => person.serviceOrderAllocationSupported).length;

  return (
    <ModulePage>
      {/*
        SUPERFÍCIE DE TRABALHO FIXA — cabeçalho, visões salvas e filtros não rolam com a fila.
        O planejador nunca perde "onde estou" nem "qual recorte de mão de obra estou vendo".
      */}
      <div className="sticky top-0 z-20 bg-white" data-region="work-surface">
      <div data-region="operating-header">
      <WorklistHeader
        title="Pessoas"
        /*
          CONTAGEM — o cabecalho NAO publica tamanho de carteira.

          `listState.total` e sempre `null`: o contrato de listagem de Pessoas nao publica `total`,
          e o codigo ja declarava isso no load. Apesar disso o cabecalho renderizava
          `total ?? items.length`, ou seja imprimia o TAMANHO DA PAGINA como se fosse a populacao.
          Medido no DOM real com universo de 137 pessoas: o cabecalho anunciava "20" — exatamente
          o `limit` da pagina — enquanto o rodape dizia "1–20 nesta pagina". As duas frases se
          contradiziam na mesma tela.

          AUSENCIA != ZERO e PAGINA PAGINADA != DATASET. O chip de contagem some quando nao ha
          contagem autoritativa; o tamanho real da pagina continua declarado UMA vez, no rodape,
          junto do recorte que o produziu.
        */
        count={listState.total ?? undefined}
        context={
          items.length > 0
            ? `Mão de obra no seu escopo autorizado${hasFilters ? ' para os filtros aplicados' : ''}.`
            : 'Cadastro de mão de obra do CISNE.'
        }
        action={
          /*
            ACAO PRIMARIA — UMA UNICA EXPRESSAO, E SO.

            Medido no DOM real com a lista vazia: a tela renderizava DOIS links primarios de
            criacao ao mesmo tempo — "Nova Pessoa" no cabecalho e "Cadastrar Pessoa" dentro do
            painel de estado vazio (dois `ModulePrimaryLink`, ambos com peso de acao primaria).
            Duas CTAs primarias na mesma dobra e exatamente o que a regra de hierarquia proibe:
            o operador nao sabe qual e a acao.

            Sem carteira, a criacao desce para DENTRO do painel vazio, que ja explica o que uma
            Pessoa e. Havendo registro — ou havendo recorte aplicado — ela fica no cabecalho e o
            painel NAO a repete. As duas condicoes sao mutuamente exclusivas por construcao.
          */
          capabilities.canCreate && (items.length > 0 || hasFilters) ? (
            <ModulePrimaryLink to="/app/people/new">Nova Pessoa</ModulePrimaryLink>
          ) : null
        }
        metrics={
          items.length > 0 ? (
            <>
              {/*
                INDICADORES REAIS — contados sobre a pagina carregada, nunca estimados.
                `activeCount` e `allocatableCount` ja eram derivados no corpo da tela para o
                rodape; sobem para a cabeca, que e onde as demais worklists publicam o resumo.
                A alocabilidade e o fato que RESTRINGE a operacao: e ela que decide se a pessoa
                pode entrar numa OS.
              */}
              <EnterpriseMetric
                value={activeCount}
                label="ativas nesta página"
                tone={activeCount > 0 ? 'info' : 'neutral'}
              />
              <EnterpriseMetric
                value={allocatableCount}
                label="aptas a alocação"
                tone={allocatableCount < items.length ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric value={items.length - allocatableCount} label="não alocáveis" />
            </>
          ) : null
        }
      />
      </div>

      {/*
        SAVED VIEWS — FAIXA PRÓPRIA DA WORK AREA, não link escondido em menu.
        O recorte de mão de obra (status + função) é reconstruído todo dia pelo planejador.
      */}
      <div className="cisne-divider py-0.5" data-region="saved-view-surface">
        <DynamicSavedViewsBar
          views={savedViews.views}
          persistedLocally={savedViews.persistedLocally}
          onSave={(name) =>
            savedViews.save(name, { q: query, filterStatus: statusFilter, laborType }, 'list')
          }
          onDelete={savedViews.remove}
          onApply={(view) => {
            setSearchInput(view.filters['q'] ?? '');
            setSearchParams(
              (current) => {
                const next = new URLSearchParams(current);
                const nextQ = view.filters['q'] ?? '';
                const nextStatus = view.filters['filterStatus'] ?? '';
                const nextLabor = view.filters['laborType'] ?? '';
                for (const [key, value] of [
                  ['q', nextQ],
                  ['status', nextStatus],
                  ['laborType', nextLabor],
                ] as const) {
                  if (value) {
                    next.set(key, value);
                  } else {
                    next.delete(key);
                  }
                }
                next.delete('offset');
                return next;
              },
              { replace: true },
            );
          }}
        />
      </div>

      {/*
        COMMAND / FILTER SURFACE — busca e recortes frequentes numa faixa; nada de formulário web.
      */}
      <div data-region="command-filter-surface">
      <WorklistFilterBar>
        <WorklistField label="Buscar" htmlFor="person-search" grow>
          <input
            id="person-search"
            type="search"
            /*
              CONTROLE DE BUSCA — nao o `select` emprestado.
              O campo usava `worklistSelectClass`, que carrega `cursor-pointer`: um campo de texto
              com cursor de lista. Agora usa a classe de controle de texto, na mesma altura de token.
            */
            className={worklistControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome ou código do membro"
            autoComplete="off"
          />
        </WorklistField>
        <WorklistField label="Status" htmlFor="person-status-filter">
          <select
            id="person-status-filter"
            className={worklistSelectClass}
            value={statusFilter}
            onChange={(event) => updateParam('status', event.target.value || null)}
          >
            <option value="">Todos</option>
            <option value={PERSON_STATUSES.Active}>Ativas</option>
            <option value={PERSON_STATUSES.Inactive}>Inativas</option>
          </select>
        </WorklistField>
        {laborTypes.length > 0 ? (
          <WorklistField label="Função" htmlFor="person-labor-filter">
            <select
              id="person-labor-filter"
              className={worklistSelectClass}
              value={laborType}
              onChange={(event) => updateParam('laborType', event.target.value || null)}
            >
              <option value="">Todas</option>
              {laborTypes.map((entry) => (
                <option key={entry.code} value={entry.code}>
                  {entry.name}
                </option>
              ))}
            </select>
          </WorklistField>
        ) : null}
        <WorklistClearFilters
          visible={hasFilters}
          onClick={() => {
            setSearchInput('');
            setSearchParams(new URLSearchParams(), { replace: true });
          }}
        />
      </WorklistFilterBar>
      </div>
      </div>

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            hasFilters
              ? 'Nenhuma Pessoa corresponde aos filtros aplicados.'
              : 'Nenhuma Pessoa cadastrada ainda.'
          }
          description={
            hasFilters
              ? 'Ajuste o termo de busca ou limpe os filtros para ver o cadastro.'
              : 'As Pessoas são a mão de obra alocada nas ordens de serviço. Cadastre a primeira para começar a planejar.'
          }
          action={
            hasFilters ? (
              <WorklistClearFilters
                visible
                onClick={() => {
                  setSearchInput('');
                  setSearchParams(new URLSearchParams(), { replace: true });
                }}
              />
            ) : capabilities.canCreate ? (
              <ModulePrimaryLink to="/app/people/new">Cadastrar Pessoa</ModulePrimaryLink>
            ) : null
          }
        />
      ) : (
        <div className={worklistTableCardClass} data-region="worklist-master">
          <table className={worklistTableClass} aria-label="Lista de Pessoas">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Pessoa
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Função
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Status
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Alocação em OS
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((person) => {
                const isInactive = person.status !== PERSON_STATUSES.Active;
                return (
                  <tr
                    key={person.id}
                    className={worklistRowClass}
                    /*
                      A LINHA INTEIRA ABRE O CONTEXTO — sem botão "Abrir ficha" repetido.

                      Antes cada linha carregava um link primário "Abrir ficha": a MESMA ação em
                      todos os registros. Agora clicar a linha abre o contexto lateral (conferir
                      sem sair da fila) e a IDENTIDADE continua um link real — teclado, clique do
                      meio, nova aba e leitor de tela levam à ficha completa.
                    */
                    onClick={(event) => {
                      if ((event.target as HTMLElement).closest('a, button, select, input')) {
                        return;
                      }
                      setSelected(person);
                    }}
                  >
                  <td className={worklistCellClass}>
                    <WorklistRowLink href={`/app/people/${person.id}`}>
                      {person.preferredName ?? person.legalName}
                    </WorklistRowLink>
                    <p className="cisne-type-helper m-0">
                      {person.memberCode}
                      {person.preferredName ? ` · ${person.legalName}` : ''}
                    </p>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {person.defaultLaborTypeName ?? (
                      <span className="cisne-type-helper">
                        {person.defaultLaborTypeCode ? 'Função sem rótulo' : 'Função não informada'}
                      </span>
                    )}
                  </td>
                  {/*
                    EXCEPTION-FIRST — selo só na exceção.
                    Estado normal fica em texto de baixo ruído; a pessoa fora de operação recebe o
                    selo, porque é ela que muda o que o planejador pode fazer.
                  */}
                  <td className={worklistCellRaisedClass}>
                    {isInactive ? (
                      <PersonStatusBadge status={person.status} />
                    ) : (
                      <span className="cisne-type-meta">Ativa</span>
                    )}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {/*
                      O contrato publica se a pessoa PODE ser alocada, nao a alocacao vigente.
                      Declarar "disponivel"/"em OS" exigiria leitura de alocacao que a listagem
                      nao devolve — PARK registrado. A negativa e um fato que RESTRINGE a
                      operacao, entao vem realcada: e ela que explica por que a pessoa nao pode
                      entrar numa OS.
                    */}
                    {person.serviceOrderAllocationSupported ? (
                      <span className="cisne-type-meta">Apta a alocação</span>
                    ) : (
                      <WorklistException tone="warning">Não alocável em OS</WorklistException>
                    )}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="cisne-type-meta whitespace-nowrap">
                      {new Date(person.updatedAt).toLocaleDateString('pt-BR')}
                    </span>
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
        extra={
          items.length > 0 ? (
            <>
              {activeCount} ativa{activeCount === 1 ? '' : 's'} · {allocatableCount} apta
              {allocatableCount === 1 ? '' : 's'} a alocação em OS
              {statusFilter
                ? ` · status: ${statusFilter === PERSON_STATUSES.Active ? 'Ativas' : 'Inativas'}`
                : ''}
              {laborType ? ` · função: ${activeLaborTypeLabel}` : ''}
            </>
          ) : undefined
        }
      >
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => updateParam('offset', String(Math.max(0, offset - PAGE_SIZE)) || null)}
          onNext={() => updateParam('offset', String(offset + PAGE_SIZE))}
        />
      </WorklistFooter>

      {/*
        CONTEXT REGION — MASTER/DETAIL SEM ABANDONAR A FILA.

        Selecionar a linha abre o contexto REAL da pessoa (`GET /people/:id`): os fatos que a
        listagem não publica (`externalErpId`, desativação) e os COMANDOS reais do domínio.
        Fechar o painel devolve o operador exatamente onde estava — recorte, página e scroll
        intactos.

        O MOTIVO da inativação é digitado pelo operador: `deactivatePerson` exige `reason` e o
        motivo é registro de auditoria — texto fixo de tela seria o frontend inventando o fato.
      */}
      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto da pessoa"
        onClose={() => setSelected(null)}
        crossReferences={[]}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {selected.preferredName ?? selected.legalName}
            </p>
          ) : null}

          {detailState.phase === 'loading' ? (
            /* SKELETON LOCALIZADO — só o painel espera; a fila segue viva. */
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

          {detailState.phase === 'ready' ? (
            <>
              <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                <dt className="cisne-meta-label pt-0.5">Nome</dt>
                <dd className="cisne-meta-value m-0">{detailState.person.legalName}</dd>
                <dt className="cisne-meta-label pt-0.5">Código</dt>
                <dd className="cisne-meta-value m-0 font-mono">{detailState.person.memberCode}</dd>
                {detailState.person.defaultLaborTypeName ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Função</dt>
                    <dd className="cisne-meta-value m-0">{detailState.person.defaultLaborTypeName}</dd>
                  </>
                ) : null}
                <dt className="cisne-meta-label pt-0.5">Status</dt>
                <dd className="cisne-meta-value m-0">
                  {detailState.person.status === PERSON_STATUSES.Active ? 'Ativa' : 'Inativa'}
                </dd>
                {detailState.person.deactivatedAt ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Desativada em</dt>
                    <dd className="cisne-meta-value m-0">
                      {new Date(detailState.person.deactivatedAt).toLocaleDateString('pt-BR')}
                    </dd>
                  </>
                ) : null}
                {detailState.person.deactivationReason ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Motivo</dt>
                    <dd className="cisne-meta-value m-0">
                      {detailState.person.deactivationReason}
                    </dd>
                  </>
                ) : null}
              </dl>

              {/*
                COMMAND LAYER — comandos reais guardados pelas CAPABILITIES reais do backend.
                Inativar exige motivo digitado; o botão fica indisponível até existir.
              */}
              <div className="cisne-divider--top mt-2 pt-2">
                {detailState.person.status !== PERSON_STATUSES.Active &&
                capabilities.canActivate ? (
                  <Button
                    variant="primary"
                    loading={commandBusy}
                    loadingText="Reativando…"
                    onClick={() => void runCommand('activate')}
                  >
                    Reativar pessoa
                  </Button>
                ) : null}

                {detailState.person.status === PERSON_STATUSES.Active &&
                capabilities.canDeactivate ? (
                  <>
                    <label className="mb-1 block">
                      <span className="cisne-meta-label mb-0.5 block">
                        Motivo (obrigatório para inativar)
                      </span>
                      <input
                        type="text"
                        className={worklistControlClass}
                        value={commandReason}
                        onChange={(event) => setCommandReason(event.target.value)}
                        placeholder="Informe o motivo real"
                      />
                    </label>
                    <Button
                      variant="secondary"
                      disabled={commandReason.trim() === ''}
                      loading={commandBusy}
                      loadingText="Inativando…"
                      title={
                        commandReason.trim() === ''
                          ? 'Informe o motivo para executar'
                          : undefined
                      }
                      onClick={() => void runCommand('deactivate')}
                    >
                      Inativar pessoa
                    </Button>
                  </>
                ) : null}

                {!capabilities.canActivate && !capabilities.canDeactivate ? (
                  <p className="cisne-type-helper m-0">
                    Nenhum comando disponível para o seu acesso.
                  </p>
                ) : null}

                {commandError ? (
                  <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                    {commandError}
                  </p>
                ) : null}
              </div>

              {/* DRILLBACK ÚNICO — uma vez por registro selecionado, nunca por linha. */}
              {capabilities.canRead ? (
                <div className="cisne-divider--top mt-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => void navigate(`/app/people/${detailState.person.id}`)}
                  >
                    Abrir ficha completa
                  </Button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </DynamicContextDrawer>
    </ModulePage>
  );
}
