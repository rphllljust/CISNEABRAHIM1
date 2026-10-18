import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  archiveSupplier,
  activateSupplier,
  deactivateSupplier,
  getSupplier,
  listSuppliers,
} from '../api/suppliers-api';
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
import { Skeleton } from '../../ui/Skeleton';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
} from '../../ui/module-layout';
import { supplierEngineRows, type SupplierEngineRow } from './supplier-engine-rows';
import { useSupplierAvailableActions } from '../hooks/useSupplierAvailableActions';
import { mapSupplierErrorToMessage } from '../api/supplier-error-messages';
import type { SupplierDetail, SupplierSummary } from '../types/supplier.types';
import { formatCnpjDisplay } from '../../clients/utils/format-cnpj';

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
  /* SEM IDENTIDADE, NÃO PERSISTE: `null` em vez do namespace compartilhado `'anonymous'`. */
  const savedViews = useSavedViews(identityId ?? null, 'suppliers');

  const [offset, setOffset] = useState(0);
  const [statusFilter, setStatusFilter] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [selected, setSelected] = useState<SupplierSummary | null>(null);

  /**
   * CONTEXTO REAL DO FORNECEDOR — carregado do endpoint de detalhe.
   *
   * `GET /suppliers/:id` publica o que a listagem não traz: contatos, moeda, motivo de
   * desativação e a `version`. Sem isso o painel lateral só repetiria as colunas da grade.
   * Carregamento LOCALIZADO: só o painel espera; a fila continua utilizável.
   */
  const [detailState, setDetailState] = useState<
    | { phase: 'idle' }
    | { phase: 'loading' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; supplier: SupplierDetail }
  >({ phase: 'idle' });

  /*
   * MOTIVO DO COMANDO — informado pelo OPERADOR, nunca fabricado.
   *
   * `deactivate` e `archive` exigem `reason` no contrato. A versão anterior deste módulo enviava
   * `'Inativação a partir da lista.'` como texto fixo — ou seja, o FRONTEND INVENTAVA UM FATO
   * EMPRESARIAL para satisfazer o schema. O motivo é registro de auditoria: quem inativou e por
   * quê. Aqui ele é digitado, e o comando só fica disponível quando existe.
   */
  const [commandReason, setCommandReason] = useState('');
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);
  const [commandsRefresh, setCommandsRefresh] = useState(0);

  const selectedId = selected?.id ?? null;

  /*
   * RECARGA REAL DA FILA — declarada ANTES de quem a usa (o comando de contexto).
   *
   * A versão anterior era `setOffset((value) => value)`: uma atribuição de identidade, da qual o
   * React BAILA sem re-renderizar — ou seja, `onChanged={reload}` NUNCA recarregava nada e a grade
   * continuava mostrando o estado antigo depois de um comando de domínio. Um token monotônico
   * força o efeito de carga a rodar de novo.
   */
  const [reloadToken, setReloadToken] = useState(0);
  const reload = useCallback(() => setReloadToken((current) => current + 1), []);

  // COMANDOS VÁLIDOS vêm do BACKEND (`available-actions`), não de um mapa de status no frontend.
  const availableActions = useSupplierAvailableActions(selectedId, selectedId !== null, commandsRefresh);

  useEffect(() => {
    if (!selectedId) {
      setDetailState({ phase: 'idle' });
      setCommandError(null);
      setCommandReason('');
      return;
    }
    const controller = new AbortController();
    setDetailState({ phase: 'loading' });
    setCommandError(null);
    void getSupplier(selectedId, controller.signal)
      .then((supplier) => {
        if (!controller.signal.aborted) {
          setDetailState({ phase: 'ready', supplier });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setDetailState({
            phase: 'error',
            message: 'Não foi possível carregar o contexto do fornecedor.',
          });
        }
      });
    return () => controller.abort();
  }, [selectedId]);

  /**
   * Executa um COMANDO REAL do domínio a partir do contexto.
   * `reason` é enviado apenas quando o operador o informou — nunca preenchido pelo frontend.
   */
  const runCommand = useCallback(
    async (command: string, requiresReason: boolean) => {
      if (!selected) {
        return;
      }
      setCommandBusy(true);
      setCommandError(null);
      try {
        if (command === 'activate') {
          await activateSupplier(selected.id, { version: selected.version });
        } else if (command === 'deactivate') {
          await deactivateSupplier(selected.id, { version: selected.version, reason: commandReason });
        } else if (command === 'archive') {
          await archiveSupplier(selected.id, { version: selected.version, reason: commandReason });
        }
        if (requiresReason) {
          setCommandReason('');
        }
        setSelected(null);
        setCommandsRefresh((current) => current + 1);
        reload();
      } catch (error) {
        setCommandError(
          error instanceof BackofficeApiError
            ? mapSupplierErrorToMessage(error.code, error.status)
            : 'Não foi possível executar o comando.',
        );
      } finally {
        setCommandBusy(false);
      }
    },
    [commandReason, reload, selected],
  );

  // A busca vai ao SERVIDOR: filtrar a pagina atual esconderia um fornecedor que existe adiante.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

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
  }, [loadPage, offset, reloadToken]);

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
        SUPERFÍCIE DE TRABALHO FIXA — cabeçalho, visões salvas e filtros não rolam com a fila.
        O operador nunca perde "onde estou" nem "qual recorte estou vendo".
      */}
      <div className="sticky top-0 z-20 bg-white" data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title={schema?.label ?? 'Fornecedores'}
            context="Terceiros habilitados a receber pedidos de compra, com o estado de cada cadastro."
            action={
              <Button variant="primary" onClick={() => void navigate('/app/suppliers/new')}>
                Novo fornecedor
              </Button>
            }
          />
        </div>

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
          SAVED VIEWS — FAIXA PRÓPRIA DA WORK AREA, não link "Visões" escondido em menu.
          O recorte que o operador remonta todo dia é comando da superfície de trabalho.
        */}
        <div className="cisne-divider py-0.5" data-region="saved-view-surface">
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
        </div>

        <div data-region="command-filter-surface">
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
        </div>
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
        <div data-region="worklist-master">
          <DynamicList
          schema={schema}
          rows={rows}
          ariaLabel="Lista de fornecedores"
          emptyMessage="Nenhum fornecedor cadastrado."
          /*
            A LINHA INTEIRA ABRE O CONTEXTO — arquivo morto de botões por linha.

            Antes cada linha carregava os comandos `activate`/`deactivate`/`archive` como botões
            (`SupplierRowActions`), além de um "Abrir fornecedor" de fallback. Isso é o padrão CRUD
            que esta rodada elimina por três razões:
              1. repetição de ação idêntica em TODA linha;
              2. comandos apresentados SEM contexto do registro que será afetado;
              3. o motivo de inativação/arquivamento era TEXTO FIXO inventado pelo frontend.

            Agora a linha abre o CONTEXTO e os comandos reais vivem lá, dirigidos pelo backend
            (`available-actions`) e com o motivo informado pelo operador.
          */
          onRowClick={(row) => {
            const item = items.find((entry) => entry.id === row.id) ?? null;
            setSelected(item);
          }}
          renderCell={(field, row) => {
            const item = items.find((entry) => entry.id === row.id);
            if (!item) {
              return undefined;
            }
            /*
              IDENTIDADE É O DRILLBACK — link real na RAZÃO SOCIAL, que é o dado principal do
              terceiro (o nome fantasia é metadata subordinada e tem a própria coluna). Teclado,
              clique do meio, nova aba e leitor de tela levam à ficha completa; a linha abre o
              contexto. Nenhum "Abrir cadastro" repetido.
            */
            if (field.name === 'legal_name' || field.name === schema?.labelField) {
              return (
                <Link
                  to={`/app/suppliers/${item.id}`}
                  onClick={(event) => event.stopPropagation()}
                  title={item.legalName}
                  className="cisne-type-primary block truncate text-brand-800 no-underline hover:underline"
                >
                  {item.legalName}
                </Link>
              );
            }
            // EXCECAO VISIVEL na coluna de estado: e ela que explica por que o fornecedor
            // nao pode receber compra. O rotulo e humano — o enum cru nao aparece.
            //
            // DENSIDADE: a celula empilhava TRES linhas (estado, excecao e proxima acao), o que
            // dobrava a altura de TODA a grade — medido, a pagina tinha 1675px para 18 linhas e
            // apenas 5 registros cabiam na primeira dobra. Estado e excecao cabem na MESMA linha.
            if (field.name === 'normalized_tax_id') {
              return <span className="font-mono tabular-nums">{formatCnpjDisplay(item.taxId)}</span>;
            }
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
        </div>
      )}

      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto do fornecedor"
        onClose={() => setSelected(null)}
        crossReferences={crossReferences}
      >
        <div data-region="context-region">
          {selected ? (
            <p className="cisne-type-primary m-0 mb-2 truncate">
              {selected.tradeName ?? selected.legalName}
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
                <dt className="cisne-meta-label pt-0.5">Razão social</dt>
                <dd className="cisne-meta-value m-0">{detailState.supplier.legalName}</dd>
                <dt className="cisne-meta-label pt-0.5">CNPJ</dt>
                <dd className="cisne-meta-value m-0 font-mono">{detailState.supplier.taxId}</dd>
                {detailState.supplier.paymentTerms ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Pagamento</dt>
                    <dd className="cisne-meta-value m-0">{detailState.supplier.paymentTerms}</dd>
                  </>
                ) : null}
                <dt className="cisne-meta-label pt-0.5">Moeda</dt>
                <dd className="cisne-meta-value m-0">{detailState.supplier.currencyCode}</dd>
                <dt className="cisne-meta-label pt-0.5">Estado</dt>
                <dd className="cisne-meta-value m-0">{statusLabel(detailState.supplier.status)}</dd>
                {detailState.supplier.deactivationReason ? (
                  <>
                    <dt className="cisne-meta-label pt-0.5">Motivo</dt>
                    <dd className="cisne-meta-value m-0">
                      {detailState.supplier.deactivationReason}
                    </dd>
                  </>
                ) : null}
              </dl>

              {/* CONTATOS — dado exclusivo do detalhe, não da listagem. */}
              <div className="cisne-divider--top mt-2 pt-2">
                <h3 className="cisne-section-title m-0 mb-1">Contatos</h3>
                {detailState.supplier.contacts.length === 0 ? (
                  <p className="cisne-type-helper m-0">Nenhum contato cadastrado.</p>
                ) : (
                  <ul className="m-0 flex list-none flex-col gap-0 p-0">
                    {detailState.supplier.contacts.map((contact) => (
                      <li key={contact.id} className="cisne-type-meta truncate">
                        {contact.name}
                        {contact.email ? ` · ${contact.email}` : ''}
                        {contact.phone ? ` · ${contact.phone}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/*
                COMMAND LAYER — comandos REAIS, publicados pelo BACKEND em `available-actions`.
                O frontend não conhece mapa de status; ele apresenta o que o servidor declara
                válido e envia a INTENÇÃO. Comandos destrutivos exigem MOTIVO digitado aqui:
                o campo é do operador, porque motivo é registro de auditoria — nunca texto fixo
                inventado pela tela.
              */}
              <div className="cisne-divider--top mt-2 pt-2">
                {availableActions.status === 'ready' &&
                availableActions.data &&
                availableActions.data.comandos_validos.length > 0 ? (
                  <>
                    {availableActions.data.comandos_validos.some(
                      (action) => action.comando !== 'activate',
                    ) ? (
                      <label className="mb-1 block">
                        <span className="cisne-meta-label mb-0.5 block">
                          Motivo (obrigatório para desativar/arquivar)
                        </span>
                        <input
                          type="text"
                          className={worklistControlClass}
                          value={commandReason}
                          onChange={(event) => setCommandReason(event.target.value)}
                          placeholder="Informe o motivo real"
                        />
                      </label>
                    ) : null}

                    <div className="flex flex-wrap items-center gap-1.5">
                      {availableActions.data.comandos_validos.map((action) => {
                        const needsReason = action.comando !== 'activate';
                        const blocked =
                          !action.usuario_tem_permissao || (needsReason && commandReason.trim() === '');
                        return (
                          <Button
                            key={action.comando}
                            variant={action.comando === 'activate' ? 'primary' : 'secondary'}
                            disabled={blocked}
                            loading={commandBusy}
                            title={
                              !action.usuario_tem_permissao
                                ? 'Sem permissão para este comando'
                                : needsReason && commandReason.trim() === ''
                                  ? 'Informe o motivo para executar'
                                  : undefined
                            }
                            onClick={() => void runCommand(action.comando, needsReason)}
                          >
                            {action.label ?? action.comando}
                          </Button>
                        );
                      })}
                    </div>
                  </>
                ) : (
                  <p className="cisne-type-helper m-0">Nenhum comando disponível para este registro.</p>
                )}

                {commandError ? (
                  <p className="cisne-type-helper m-0 mt-1.5 text-red-700" role="alert">
                    {commandError}
                  </p>
                ) : null}

                {/*
                  DRILLBACK ÚNICO — vive AQUI, uma vez por registro selecionado. A grade não repete
                  "Abrir" em cada linha; a identidade é o drillback da linha e o painel oferece o
                  caminho para a ficha completa (histórico e edição).
                */}
                <div className="cisne-divider--top mt-2 pt-2">
                  <Button
                    variant="secondary"
                    onClick={() => void navigate(`/app/suppliers/${detailState.supplier.id}`)}
                  >
                    Abrir ficha completa
                  </Button>
                </div>
              </div>
            </>
          ) : null}
        </div>
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
