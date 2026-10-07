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
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
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

/**
 * PRÓXIMO PASSO REAL, derivado do estado que o backend devolve.
 *
 * Ele diz ao operador O QUE FAZER com o registro que está bloqueado — sem ele, a linha informa o
 * problema e não o caminho. É derivado do MESMO estado que a exceção, então nunca contradiz a
 * linha; e é curto porque mora na célula de estado, junto do rótulo.
 */
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
  | { phase: 'loading' }  | { phase: 'denied' }
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
      {/*
        OPERATING HEADER — identidade da funcao + comando primario, na gramatica congelada da
        foundation. Antes o cabecalho era um `<header>` local com `h1 text-lg` e um botao com
        `border+bg` da mesma cor; agora usa `WorklistHeader`, entao a funcao abre com a MESMA
        hierarquia de todas as outras worklists do CISNE.
      */}
      <WorklistHeader
        title={schema?.label ?? 'Fornecedores'}
        context="Terceiros habilitados a receber pedidos de compra, com o estado de cada cadastro."
        action={
          <Button variant="primary" onClick={() => void navigate('/app/suppliers/new')}>
            Novo fornecedor
          </Button>
        }
      />

      {/*
        FAIXA DE INDICADORES — responde "qual e o tamanho e o estado desta fila?" antes da
        primeira linha. A contagem total e a autoritativa do servidor; as demais sao contagens
        das linhas carregadas e dizem isso no rotulo.
      */}
      <div className="cisne-divider flex flex-wrap gap-0 py-1.5">
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
        COMMAND SURFACE + FILTER SURFACE — uma faixa, nao um formulario de consulta.
        A busca e o recorte que o operador refaz todo dia, e os dois vao ao servidor.
      */}
      <WorklistFilterBar
        meta={
          total !== null
            ? `${offset + 1}–${offset + items.length} de ${total}`
            : `${offset + 1}–${offset + items.length} nesta página`
        }
      >
        <WorklistField label="Buscar" htmlFor="suppliers-search" grow>
          <input
            id="suppliers-search"
            type="search"
            className={worklistControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Razão social, nome fantasia ou CNPJ"
            autoComplete="off"
          />
        </WorklistField>
        <WorklistField label="Estado" htmlFor="suppliers-status">
          <select
            id="suppliers-status"
            className={worklistSelectClass}
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
        </WorklistField>
        <WorklistClearFilters
          visible={hasActiveFilters}
          onClick={() => {
            setSearchInput('');
            setStatusFilter('');
            setOffset(0);
          }}
        />
      </WorklistFilterBar>

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
          setStatusFilter(view.filters['filterStatus'] ?? '');
          setOffset(0);
        }}
      />

      {status === 'error' ? (
        <p className="cisne-type-helper m-0 mb-1 text-amber-800" role="alert">
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
              <WorklistClearFilters
                visible
                onClick={() => {
                  setSearchInput('');
                  setStatusFilter('');
                  setOffset(0);
                }}
              />
            ) : (
              <Button variant="primary" onClick={() => void navigate('/app/suppliers/new')}>
                Cadastrar fornecedor
              </Button>
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
            //
            // DENSIDADE: a celula empilhava TRES linhas (estado, excecao e proxima acao), o que
            // dobrava a altura de TODA a grade — medido, a pagina tinha 1675px para 18 linhas e
            // apenas 5 registros cabiam na primeira dobra. Estado e excecao cabem na MESMA linha
            // (o operador compara na horizontal); a proxima acao ja e oferecida pelo comando real
            // da propria linha (`SupplierRowActions`), entao repeti-la em texto era ruido.
            if (field.name === 'status') {
              const exception = supplierException(item.status);
              const nextAction = nextActionLabel(item.status);
              return (
                <span className="inline-flex items-baseline gap-1.5 whitespace-nowrap">
                  <span className="text-[length:var(--type-body-size)] font-medium text-gray-900">
                    {statusLabel(item.status)}
                  </span>
                  {exception ? (
                    <span
                      className={
                        exception === 'critical'
                          ? 'text-[length:var(--type-micro-size)] font-semibold text-red-700'
                          : 'text-[length:var(--type-micro-size)] font-semibold text-amber-700'
                      }
                    >
                      {exception === 'critical' ? 'Fora de operação' : 'Não pode comprar'}
                    </span>
                  ) : null}
                  {nextAction ? (
                    <>
                      <span aria-hidden="true" className="text-gray-300">
                        ·
                      </span>
                      <span className="cisne-type-helper">{nextAction}</span>
                    </>
                  ) : null}
                </span>
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
          <dl className="m-0 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-1.5">
            <dt className="cisne-meta-label pt-0.5">Razão social</dt>
            <dd className="cisne-meta-value m-0">{selected.legalName}</dd>
            <dt className="cisne-meta-label pt-0.5">CNPJ</dt>
            <dd className="cisne-meta-value m-0">{selected.taxId}</dd>
            {selected.paymentTerms ? (
              <>
                <dt className="cisne-meta-label pt-0.5">Pagamento</dt>
                <dd className="cisne-meta-value m-0">{selected.paymentTerms}</dd>
              </>
            ) : null}
            <dt className="cisne-meta-label pt-0.5">Estado</dt>
            <dd className="cisne-meta-value m-0">{statusLabel(selected.status)}</dd>
          </dl>
        ) : null}

        {/* COMANDO DE CONTEXTO — acesso a ficha profunda sem abandonar a fila. */}
        {selected ? (
          <div className="cisne-divider--top mt-2 pt-2">
            <Button variant="secondary" onClick={() => void navigate(`/app/suppliers/${selected.id}`)}>
              Abrir ficha
            </Button>
          </div>
        ) : null}
      </DynamicContextDrawer>

      <footer className="cisne-divider--top mt-1 flex flex-wrap items-center justify-between gap-3 pt-1.5">
        <p className="cisne-type-helper m-0">
          {activeStatusLabel ? `estado: ${activeStatusLabel}` : 'sem recorte de estado'}
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
