import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PeopleApiError, listPeople } from '../api/people-api';
import { mapPersonErrorToMessage } from '../api/person-error-messages';
import { PersonStatusBadge } from '../components/PersonStatusBadge';
import { usePersonCapabilities } from '../hooks/usePersonCapabilities';
import { listLaborTypes } from '../../catalog/api/catalog-reference-api';
import { PERSON_STATUSES, type Person, type PersonStatus } from '../types/person.types';
import {
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

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

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
      <ModulePage>
        <ModuleLoadingState title="Pessoas" message="Carregando Pessoas…" />
      </ModulePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModulePage>
        <ModuleDeniedState
          title="Pessoas"
          message="Você não tem permissão para listar Pessoas."
        />
      </ModulePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Pessoas"
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(offset)}
        />
      </ModulePage>
    );
  }

  const { items, hasMore } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const activeCount = items.filter((person) => person.status === PERSON_STATUSES.Active).length;
  const allocatableCount = items.filter((person) => person.serviceOrderAllocationSupported).length;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Pessoas"
        description={
          items.length > 0
            ? `Mão de obra no seu escopo autorizado${hasFilters ? ' para os filtros aplicados' : ''}.`
            : 'Cadastro de mão de obra do CISNE.'
        }
        action={
          capabilities.canCreate ? (
            <ModulePrimaryLink to="/app/people/new">Nova Pessoa</ModulePrimaryLink>
          ) : null
        }
      />

      {/*
        TOOLBAR OPERACIONAL — busca e filtros na mesma faixa da lista, nao num cartao
        que ocupa um terco da tela. Os indicadores sao contagens do conjunto visivel.
      */}
      <div
        role="search"
        aria-label="Busca e filtros de Pessoas"
        className="mb-3 flex flex-wrap items-end gap-2"
      >
        <div className="min-w-56 flex-1">
          <label className={filterLabelClass} htmlFor="person-search">
            Buscar
          </label>
          <input
            id="person-search"
            type="search"
            className={filterControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Nome ou código do membro"
            autoComplete="off"
          />
        </div>
        <div className="w-40">
          <label className={filterLabelClass} htmlFor="person-status-filter">
            Status
          </label>
          <select
            id="person-status-filter"
            className={filterControlClass}
            value={statusFilter}
            onChange={(event) => updateParam('status', event.target.value || null)}
          >
            <option value="">Todos</option>
            <option value={PERSON_STATUSES.Active}>Ativas</option>
            <option value={PERSON_STATUSES.Inactive}>Inativas</option>
          </select>
        </div>
        {laborTypes.length > 0 ? (
          <div className="w-48">
            <label className={filterLabelClass} htmlFor="person-labor-filter">
              Função
            </label>
            <select
              id="person-labor-filter"
              className={filterControlClass}
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
          </div>
        ) : null}
        {hasFilters ? (
          <button
            type="button"
            className="rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
            onClick={() => {
              setSearchInput('');
              setSearchParams(new URLSearchParams(), { replace: true });
            }}
          >
            Limpar
          </button>
        ) : null}
      </div>

      {items.length > 0 ? (
        <p className="mb-2 text-xs text-gray-500" aria-live="polite">
          {items.length} {items.length === 1 ? 'pessoa' : 'pessoas'} nesta página
          {' · '}
          {activeCount} ativa{activeCount === 1 ? '' : 's'}
          {' · '}
          {allocatableCount} apta{allocatableCount === 1 ? '' : 's'} a alocação em OS
          {statusFilter ? ` · status: ${statusFilter === PERSON_STATUSES.Active ? 'Ativas' : 'Inativas'}` : ''}
          {laborType ? ` · função: ${activeLaborTypeLabel}` : ''}
        </p>
      ) : null}

      {items.length === 0 ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          {hasFilters ? (
            <>
              <p className="font-semibold text-gray-900">
                Nenhuma Pessoa corresponde aos filtros aplicados.
              </p>
              <p className="mt-2">Ajuste o termo de busca ou limpe os filtros para ver o cadastro.</p>
            </>
          ) : (
            <>
              <p className="font-semibold text-gray-900">Nenhuma Pessoa cadastrada ainda.</p>
              <p className="mt-2">
                As Pessoas são a mão de obra alocada nas ordens de serviço. Cadastre a primeira
                para começar a planejar.
              </p>
              {capabilities.canCreate ? (
                <p className="mt-4">
                  <ModulePrimaryLink to="/app/people/new">Cadastrar Pessoa</ModulePrimaryLink>
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : (
        <ModuleTableCard>
          <table className={moduleTableClass} aria-label="Lista de Pessoas">
            <thead className={moduleTableHeadClass}>
              <tr>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Pessoa
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Função
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Status
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Alocação em OS
                </th>
                <th scope="col" className={moduleTableHeaderCellClass}>
                  Atualizado
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {items.map((person) => (
                <tr key={person.id} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>
                    <div className="flex flex-col">
                      <ModuleTableLink to={`/app/people/${person.id}`}>
                        {person.preferredName ?? person.legalName}
                      </ModuleTableLink>
                      <span className="text-xs text-gray-500">
                        {person.memberCode}
                        {person.preferredName ? ` · ${person.legalName}` : ''}
                      </span>
                    </div>
                  </td>
                  <td className={moduleTableCellClass}>
                    {person.defaultLaborTypeName ?? person.defaultLaborTypeCode ?? '—'}
                  </td>
                  <td className={moduleTableCellClass}>
                    <PersonStatusBadge status={person.status} />
                  </td>
                  <td className={moduleTableCellClass}>
                    {/*
                      O contrato publica se a pessoa PODE ser alocada, nao a alocacao
                      vigente. Declarar "disponivel"/"em OS" exigiria leitura de
                      alocacao que a listagem nao devolve — PARK registrado.
                    */}
                    {person.serviceOrderAllocationSupported ? (
                      <span className="text-xs text-gray-600">Apta a alocação</span>
                    ) : (
                      <span className="text-xs text-gray-400">Não alocável em OS</span>
                    )}
                  </td>
                  <td className={moduleTableCellClass}>
                    <span className="whitespace-nowrap text-xs text-gray-600">
                      {new Date(person.updatedAt).toLocaleDateString('pt-BR')}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ModuleTableCard>
      )}

      <ModulePagination
        pageNumber={pageNumber}
        previousDisabled={offset === 0}
        nextDisabled={!hasMore}
        onPrevious={() => updateParam('offset', String(Math.max(0, offset - PAGE_SIZE)) || null)}
        onNext={() => updateParam('offset', String(offset + PAGE_SIZE))}
      />
    </ModulePage>
  );
}
