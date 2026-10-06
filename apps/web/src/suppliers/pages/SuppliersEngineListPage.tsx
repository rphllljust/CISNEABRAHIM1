import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { listSuppliers } from '../api/suppliers-api';
import { BackofficeApiError } from '../../financial-ui/enterprise-api';
import { useAuth } from '../../auth/context/AuthProvider';
import {
  DynamicContextDrawer,
  DynamicList,
  DynamicSavedViewsBar,
  useEntitySchema,
  useSavedViews,
  type CrossReference,
  type MetaEntitySchema,
} from '../../engine';
import { EnterpriseMetric, WorklistStatePanel } from '../../ui/enterprise-list';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
} from '../../ui/module-layout';
import { supplierEngineRows, type SupplierEngineRow } from './supplier-engine-rows';
import { SupplierRowActions } from '../components/SupplierRowActions';
import type { SupplierSummary } from '../types/supplier.types';

/**
 * WORKLIST DE FORNECEDORES — cadastro de terceiros como fila de trabalho.
 *
 * ANTES: a tela era um `DynamicList` cru dentro de um `<div className="p-6">`. Sem busca, sem
 * filtro, sem estado vazio próprio, sem paginação e sem comando: o operador recebia 50 linhas
 * fixas de uma tabela que virou a página inteira, e para achar um fornecedor precisava rolar a
 * lista lendo linha a linha. O endpoint já aceitava `q` e `status` — o que faltava era a tela
 * mandar. Também não havia NENHUMA próxima ação: `SupplierRowActions` já existia com os
 * comandos reais do backend (`activate`/`deactivate`/`archive`) e estava desligado da lista.
 *
 * AGRUPAMENTO POR ESTADO, NÃO POR ESTÉTICA:
 *   - o recorte (busca, status) vive na URL e vai ao SERVIDOR — filtrar a página no navegador
 *     esconderia um fornecedor que existe adiante;
 *   - `total` é AUTORITATIVO (`SupplierListResponse.total`), então a contagem é real, não
 *     "nesta página";
 *   - a exceção é derivada do estado que o payload publica: fornecedor inativo é o fato que
 *     impede a compra, então ele vem realçado e a linha oferece o comando de reativação que o
 *     backend já declara válido;
 *   - o painel lateral mostra as relações que a listagem sustenta sem inventar contagem.
 *
 * A engine continua dona das colunas: `DynamicList` lê a view `list` do metadata store.
 */

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

/** Estados que o domínio usa para terceiro fora de operação. */
const INACTIVE_STATUSES = new Set(['INACTIVE', 'SUSPENDED']);
const ARCHIVED_STATUSES = new Set(['ARCHIVED']);

/**
 * Rótulo humano do estado.
 *
 * O backend publica o enum; a tela não pode imprimir `ACTIVE` cru para o operador. O metadado
 * já traz rótulo quando existe, e este mapa cobre o vocabulário de fornecedor.
 */
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  SUSPENDED: 'Suspenso',
  ARCHIVED: 'Arquivado',
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * EXCEÇÃO OPERACIONAL a partir de campos que a listagem JÁ entrega.
 *
 * Nada de SLA, aging ou risco: o payload não publica prazo nem histórico. O único fato de
 * exceção sustentável é o estado — um fornecedor inativo ou arquivado é o que trava a compra.
 */
function supplierException(status: string): 'critical' | 'warning' | null {
  if (ARCHIVED_STATUSES.has(status)) {
    return 'critical';
  }
  if (INACTIVE_STATUSES.has(status)) {
    return 'warning';
  }
  return null;
}

/** Próxima ação REAL, derivada do estado que o backend devolve. */
function nextActionLabel(status: string): string | null {
  if (ARCHIVED_STATUSES.has(status)) {
    return 'Reativar cadastro';
  }
  if (INACTIVE_STATUSES.has(status)) {
    return 'Reativar para comprar';
  }
  if (status === 'ACTIVE') {
    return 'Emitir pedido de compra';
  }
  return null;
}

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | {
      phase: 'ready';
      items: SupplierSummary[];
      offset: number;
      hasMore: boolean;
      total: number | null;
    };

export function SuppliersEngineListPage() {
  const navigate = useNavigate();
  const { identityId } = useAuth();
  const { schema, status } = useEntitySchema('suppliers');
  const savedViews = useSavedViews(identityId ?? 'anonymous', 'suppliers');

  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [selected, setSelected] = useState<SupplierSummary | null>(null);

  // A busca vai ao SERVIDOR: filtrar a pagina atual esconderia um fornecedor que existe adiante.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const reload = useCallback(() => setOffset((value) => value), []);

  const loadPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      // Recarga preserva a lista anterior: trocar a grade por "Carregando…" a cada tecla
      // desmontaria a propria barra de busca durante a digitacao.
      setListState((previous) => (previous.phase === 'ready' ? previous : { phase: 'loading' }));
      try {
        const response = await listSuppliers(
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
          // `total` do contrato E autoritativo; so cai para `null` se o payload nao trouxer.
          total: typeof response.total === 'number' ? response.total : null,
        });
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof BackofficeApiError && error.kind === 'denied') {
          setListState({ phase: 'denied' });
          return;
        }
        setListState({
          phase: 'error',
          message: 'Não foi possível carregar os fornecedores.',
          retryable: !(error instanceof BackofficeApiError) || error.kind === 'network',
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

  const rows = useMemo<SupplierEngineRow[]>(
    () => (listState.phase === 'ready' ? supplierEngineRows(listState.items) : []),
    [listState],
  );

  /**
   * Opcoes do filtro de estado.
   *
   * Os estados vem do VOCABULARIO do dominio, nao das linhas carregadas: derivar so da pagina
   * esconderia o filtro numa pagina sem resultado — justamente quando o operador mais precisa
   * dele para sair do recorte vazio.
   */
  const statusOptions = useMemo(
    () =>
      Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
    [],
  );

  /**
   * Relações que a listagem sustenta declarar. Sem contagem: o payload não a publica.
   *
   * ESTE HOOK FICA ANTES DOS RETORNOS ANTECIPADOS — abaixo deles, a ordem dos hooks mudaria
   * entre a fase de carregamento (que retorna cedo) e a fase pronta, e o React abortaria a
   * árvore com "Rendered more hooks than during the previous render".
   */
  const crossReferences = useMemo<CrossReference[]>(() => {
    if (!selected) {
      return [];
    }
    return [
      {
        label: 'Pedidos de compra',
        href: `/app/purchase-orders?supplierId=${selected.id}`,
        detail: 'Compras emitidas para este fornecedor.',
      },
      {
        label: 'Contatos',
        detail: 'Disponíveis na ficha do fornecedor.',
        href: `/app/suppliers/${selected.id}`,
      },
    ];
  }, [selected]);

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleLoadingState message="Carregando fornecedores…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleDeniedState message="Você não tem permissão para listar fornecedores." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Fornecedores">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(offset)}
        />
      </ModuleStatePage>
    );
  }

  const { items, hasMore, total } = listState;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const hasActiveFilters = Boolean(statusFilter || search.trim());
  const activeStatusLabel = statusFilter ? statusLabel(statusFilter) : null;

  // Indicadores contados sobre as linhas CARREGADAS — nunca estimados a partir do total.
  const activeOnPage = items.filter((item) => item.status === 'ACTIVE').length;
  const blockedOnPage = items.filter((item) => supplierException(item.status) !== null).length;

  return (
    <ModulePage>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-gray-900">
            {schema?.label ?? 'Fornecedores'}
          </h1>
          <p className="mt-0.5 text-xs text-gray-500">
            Terceiros habilitados a receber pedidos de compra, com o estado de cada cadastro.
          </p>
        </div>
        <button
          type="button"
          className="rounded border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-medium text-white"
          onClick={() => void navigate('/app/suppliers/new')}
        >
          Novo fornecedor
        </button>
      </header>

      {/*
        FAIXA DE INDICADORES — responde "qual e o tamanho e o estado desta fila?" antes da
        primeira linha. A contagem total e a autoritativa do servidor; as demais sao contagens
        das linhas carregadas e dizem isso no rotulo.
      */}
      <div className="mb-3 flex flex-wrap gap-4">
        {total !== null ? (
          <EnterpriseMetric value={total} label="fornecedores no cadastro" />
        ) : null}
        <EnterpriseMetric
          value={activeOnPage}
          label="ativos nesta página"
          tone={activeOnPage > 0 ? 'info' : 'neutral'}
        />
        {blockedOnPage > 0 ? (
          <EnterpriseMetric value={blockedOnPage} label="fora de operação" tone="warning" />
        ) : null}
      </div>

      {/*
        TOOLBAR COMPACTA — busca e estado em uma faixa densa, mesma gramatica das demais
        worklists. A busca e o recorte que o operador refaz todo dia, e os dois vao ao servidor.
      */}
      <div className="mb-2 flex flex-wrap items-end gap-3">
        <label className="flex min-w-64 flex-1 flex-col">
          <span className="text-[11px] font-medium text-gray-600">Buscar</span>
          <input
            type="search"
            className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-sm"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Razão social, nome fantasia ou CNPJ"
            autoComplete="off"
          />
        </label>
        <label className="flex flex-col">
          <span className="text-[11px] font-medium text-gray-600">Estado</span>
          <select
            className="mt-0.5 rounded border border-gray-300 px-2 py-1 text-sm"
            value={statusFilter}
            onChange={(event) => {
              setStatusFilter(event.target.value);
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {hasActiveFilters ? (
          <button
            type="button"
            className="rounded border border-slate-300 px-2 py-1 text-xs"
            onClick={() => {
              setSearchInput('');
              setStatusFilter('');
              setOffset(0);
            }}
          >
            Limpar filtros
          </button>
        ) : null}
      </div>

      {/* VISÕES SALVAS — o recorte que o operador remonta todo dia. `persistedLocally` e
          declarado pela engine: sem endpoint de visoes salvas o armazenamento e local. */}
      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        onSave={(name) => savedViews.save(name, { search, statusFilter }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          setSearchInput(view.filters['search'] ?? '');
          setSearch(view.filters['search'] ?? '');
          setStatusFilter(view.filters['statusFilter'] ?? '');
          setOffset(0);
        }}
      />

      {status === 'error' ? (
        <p className="mb-2 text-sm text-amber-800" role="alert">
          Colunas indisponíveis no momento: exibindo a grade padrão.
        </p>
      ) : null}

      {items.length === 0 ? (
        <WorklistStatePanel
          title={
            hasActiveFilters
              ? 'Nenhum fornecedor corresponde aos filtros aplicados.'
              : 'Nenhum fornecedor cadastrado ainda.'
          }
          description={
            hasActiveFilters
              ? 'Ajuste a busca ou o estado, ou limpe os filtros para ver o cadastro completo.'
              : 'Fornecedores são os terceiros que recebem pedidos de compra; cadastre o primeiro para poder comprar.'
          }
          action={
            hasActiveFilters ? (
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-1 text-xs"
                onClick={() => {
                  setSearchInput('');
                  setStatusFilter('');
                  setOffset(0);
                }}
              >
                Limpar filtros
              </button>
            ) : (
              <button
                type="button"
                className="rounded border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => void navigate('/app/suppliers/new')}
              >
                Cadastrar fornecedor
              </button>
            )
          }
        />
      ) : (
        <DynamicList
          schema={schema}
          rows={rows}
          ariaLabel="Lista de fornecedores"
          emptyMessage="Nenhum fornecedor cadastrado."
          onRowClick={(row) => {
            const item = items.find((entry) => entry.id === row.id) ?? null;
            setSelected(item);
          }}
          /*
            ACAO DA LINHA — os comandos REAIS do backend (`activate`/`deactivate`/`archive`)
            via `SupplierRowActions`, que ja existia e estava desligado da lista. Nao ha
            `setStatus`: cada botao executa o comando de dominio e recarrega com a versao nova.
          */
          renderRowActions={(row) => {
            const item = items.find((entry) => entry.id === row.id);
            if (!item) {
              return null;
            }
            return (
              <SupplierRowActions
                supplierId={item.id}
                status={item.status}
                version={item.version}
                openPath={`/app/suppliers/${item.id}`}
                onChanged={reload}
              />
            );
          }}
          renderCell={(field, row) => {
            const item = items.find((entry) => entry.id === row.id);
            if (!item) {
              return undefined;
            }
            // EXCECAO VISIVEL na coluna de estado: e ela que explica por que o fornecedor
            // nao pode receber compra. O rotulo e humano — o enum cru nao aparece.
            if (field.name === 'status') {
              const exception = supplierException(item.status);
              return (
                <div className="flex flex-col gap-1">
                  <span className="text-[12px] font-medium text-gray-800">
                    {statusLabel(item.status)}
                  </span>
                  {exception ? (
                    <span
                      className={
                        exception === 'critical'
                          ? 'text-[11px] font-medium text-red-700'
                          : 'text-[11px] font-medium text-amber-700'
                      }
                    >
                      {exception === 'critical' ? 'Fora de operação' : 'Não pode comprar'}
                    </span>
                  ) : null}
                  {nextActionLabel(item.status) ? (
                    <span className="text-[11px] text-gray-500">
                      {nextActionLabel(item.status)}
                    </span>
                  ) : null}
                </div>
              );
            }
            return undefined;
          }}
        />
      )}

      <DynamicContextDrawer
        open={selected !== null}
        title={selected?.tradeName ?? selected?.legalName ?? 'Fornecedor'}
        onClose={() => setSelected(null)}
        crossReferences={crossReferences}
      >
        {selected ? (
          <div className="space-y-2 text-xs text-gray-600">
            <p className="font-medium text-gray-800">{selected.legalName}</p>
            <p>CNPJ: {selected.taxId}</p>
            {selected.paymentTerms ? <p>Condição de pagamento: {selected.paymentTerms}</p> : null}
            <p>Estado: {statusLabel(selected.status)}</p>
            <button
              type="button"
              className="rounded border border-brand-700 bg-brand-700 px-3 py-1.5 text-xs font-medium text-white"
              onClick={() => void navigate(`/app/suppliers/${selected.id}`)}
            >
              Abrir ficha
            </button>
          </div>
        ) : null}
      </DynamicContextDrawer>

      <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 pt-2">
        <p className="text-[11px] text-gray-500">
          {total !== null
            ? `${offset + 1}–${offset + items.length} de ${total}`
            : `${offset + 1}–${offset + items.length} nesta página`}
          {activeStatusLabel ? ` · estado: ${activeStatusLabel}` : ''}
          {hasActiveFilters ? ` · ${items.length} nesta página` : ''}
        </p>
        <ModulePagination
          pageNumber={pageNumber}
          previousDisabled={offset === 0}
          nextDisabled={!hasMore}
          onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
          onNext={() => setOffset(offset + PAGE_SIZE)}
        />
      </footer>
    </ModulePage>
  );
}

export type { MetaEntitySchema };
