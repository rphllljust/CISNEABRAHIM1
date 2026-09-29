import { useCallback, useEffect, useId, useState } from 'react';
import { Button } from '../../ui/Button';
import {
  DataTable,
  DataTableBody,
  DataTableCell,
  DataTableHead,
  DataTableHeaderCell,
  DataTableRow,
} from '../../ui/DataTable';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  filterControlClass,
  filterLabelClass,
} from '../../ui/module-layout';
import {
  DOCUMENT_LIST_PAGE_SIZE,
  DocumentsApiError,
  listDocuments,
} from '../api/documents-api';
import { mapDocumentErrorToMessage } from '../api/document-error-messages';
import { DocumentDownloadAction } from '../components/DocumentDownloadAction';
import { useDocumentCapabilities } from '../hooks/useDocumentCapabilities';
import type { DocumentDetail } from '../types/document.types';
import { DOCUMENT_CATEGORIES } from '../types/document.types';
import { SavedViewsBar, useSmartList } from '../../operator';
import { formatDateTimePtBr } from '../utils/document-format';
import {
  buildDocumentContextLabel,
  DOCUMENT_CATEGORY_OPTIONS,
  formatDocumentCount,
  formatDocumentRangeLabel,
  formatDocumentStatus,
  formatDocumentVersion,
} from '../utils/document-list-labels';

/**
 * Atraso da busca digitada, igual ao das outras listagens da plataforma: a consulta continua
 * parecendo instantanea sem transformar digitacao em carga de rede.
 */
const SEARCH_DEBOUNCE_MS = 300;

/** Escopo estavel de persistencia das visoes salvas desta lista. */
const SCOPE = 'documents.list';

/** Allow-list: somente os valores enumerados que a propria tela oferece. */
const DOCUMENTS_ALLOWED_FILTERS = {
  filters: { categoryCode: Object.values(DOCUMENT_CATEGORIES) },
} as const;

/**
 * Visoes embutidas derivadas do dominio real do acervo: evidencia tecnica e documento de
 * faturamento. Nenhuma categoria e inventada — sao as tres que o proprio tipo declara.
 */
const DOCUMENTS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.documents.evidence',
    name: 'Evidências',
    description: 'Evidência técnica vinculada à operação.',
    config: {
      filters: { categoryCode: DOCUMENT_CATEGORIES.Evidence },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
  {
    id: 'builtin.documents.billing',
    name: 'Faturamento',
    description: 'Documento vinculado a faturamento.',
    config: {
      filters: { categoryCode: DOCUMENT_CATEGORIES.BillingDocument },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
];

type ListPhase = 'loading' | 'ready' | 'error' | 'denied';

export function DocumentsPage() {
  const { capabilities, loading: capabilitiesLoading } = useDocumentCapabilities();
  const [phase, setPhase] = useState<ListPhase>('loading');
  const [items, setItems] = useState<DocumentDetail[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  // `total` e do CONJUNTO escopado e filtrado — nao da pagina. E o que permite dizer a pagina atual
  // e desabilitar "Próxima" sem a heuristica de "a pagina veio cheia".
  const [total, setTotal] = useState(0);

  // Busca e tipo sao resolvidos no SERVIDOR: a lista traz apenas uma pagina, entao filtrar no browser
  // mostraria um recorte como se fosse o cadastro inteiro.
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [offset, setOffset] = useState(0);
  // ADOCAO DE MECANISMO: o tipo do documento passa a viver na URL e em visao salva, com o
  // mesmo mecanismo das outras listas da plataforma. Antes ficava so em memoria: o acervo
  // nao podia ser aberto por link nem compartilhado com o recorte aplicado.
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: DOCUMENTS_BUILT_IN_VIEWS,
    allowedFilters: DOCUMENTS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const categoryCode = smartList.filters.categoryCode ?? '';
  // Recarga pedida pelo usuario percorre o mesmo ciclo de vida do efeito: assim tambem e cancelavel.
  const [reloadToken, setReloadToken] = useState(0);
  const searchInputId = useId();
  const categoryFilterId = useId();

  useEffect(() => {
    if (searchInput === appliedSearch) {
      return;
    }
    const timer = setTimeout(() => {
      setAppliedSearch(searchInput);
      // Mudar a consulta volta para a PRIMEIRA pagina: manter o offset anterior mostraria uma
      // pagina que nao existe mais para o novo conjunto.
      setOffset(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [appliedSearch, searchInput]);

  const load = useCallback(
    async (search: string, category: string, pageOffset: number, signal: AbortSignal) => {
      // Uma recarga preserva o resultado anterior: trocar a tela inteira por "Carregando…" faria a
      // tabela sumir a cada ajuste de filtro. So a primeira carga nao tem o que preservar.
      setPhase((current) => (current === 'ready' ? current : 'loading'));
      setIsRefreshing(true);
      try {
        const response = await listDocuments(signal, {
          q: search.trim() || undefined,
          categoryCode: category || undefined,
          offset: pageOffset,
        });
        // Requisicao superada (outro filtro ou pagina ja assumiu) nao escreve no estado.
        if (signal.aborted) {
          return;
        }
        setItems(response.items);
        setTotal(response.total);
        setPhase('ready');
      } catch (error) {
        // O cancelamento do proprio efeito nao e falha de carga.
        if (signal.aborted) {
          return;
        }
        if (error instanceof DocumentsApiError && error.kind === 'denied') {
          setPhase('denied');
          return;
        }
        setMessage(
          error instanceof DocumentsApiError
            ? mapDocumentErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar os documentos.',
        );
        setRetryable(
          !(error instanceof DocumentsApiError) ||
            error.kind === 'network' ||
            error.kind === 'unknown',
        );
        setPhase('error');
      } finally {
        if (!signal.aborted) {
          setIsRefreshing(false);
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(appliedSearch, categoryCode, offset, controller.signal);
    return () => controller.abort();
  }, [appliedSearch, categoryCode, load, offset, reloadToken]);

  if (phase === 'loading' || capabilitiesLoading) {
    return (
      <ModulePage>
        <ModuleLoadingState title="Documentos" message="Carregando documentos…" />
      </ModulePage>
    );
  }

  if (phase === 'denied' || !capabilities.canList) {
    return (
      <ModulePage>
        <ModuleDeniedState
          title="Documentos"
          message="Você não tem permissão para listar documentos."
        />
      </ModulePage>
    );
  }

  if (phase === 'error') {
    return (
      <ModulePage>
        <ModuleErrorState
          title="Documentos"
          message={message ?? 'Não foi possível carregar os documentos.'}
          retryable={retryable}
          onRetry={() => setReloadToken((current) => current + 1)}
        />
      </ModulePage>
    );
  }

  const hasFilters = appliedSearch.trim() !== '' || categoryCode !== '';
  // Com `total` real, os estados deixam de ser deduzidos do tamanho da pagina: "sem resultado" e o
  // conjunto vazio, "pagina inexistente" e o conjunto COM itens mas nenhum nesta pagina.
  const isCatalogueEmpty = total === 0 && !hasFilters;
  const isNoResult = total === 0 && hasFilters;
  const isOutOfRange = items.length === 0 && total > 0;
  const totalPages = Math.ceil(total / DOCUMENT_LIST_PAGE_SIZE);
  const pageNumber = Math.floor(offset / DOCUMENT_LIST_PAGE_SIZE) + 1;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Documentos"
        description="Arquivos já vinculados no sistema. O envio continua nas telas de execução e das entidades."
      />

      <div
        role="search"
        aria-label="Busca e filtros de documentos"
        className="mb-4 flex flex-wrap items-end gap-3"
      >
        <div className="min-w-64 flex-1">
          <label className={filterLabelClass} htmlFor={searchInputId}>
            Buscar
          </label>
          <input
            id={searchInputId}
            type="search"
            className={filterControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Título do documento"
            autoComplete="off"
          />
        </div>

        <div className="w-52">
          <label className={filterLabelClass} htmlFor={categoryFilterId}>
            Tipo
          </label>
          <select
            id={categoryFilterId}
            className={filterControlClass}
            value={categoryCode}
            onChange={(event) => {
              smartList.setFilter('categoryCode', event.target.value);
              // Mudar o filtro volta para a primeira pagina, pelo mesmo motivo da busca.
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            {DOCUMENT_CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {hasFilters || searchInput.trim() !== '' ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSearchInput('');
              setAppliedSearch('');
              smartList.clearFilters();
              setOffset(0);
            }}
          >
            Limpar
          </Button>
        ) : null}

        {isRefreshing ? (
          <p role="status" className="text-xs text-gray-500">
            Atualizando…
          </p>
        ) : null}
      </div>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          smartList.applyView(view);
          setOffset(0);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={categoryCode !== ''}
        allLabel="Todos"
        className="mb-4"
      />

      {isOutOfRange ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">
            Esta página não existe mais para os filtros aplicados.
          </p>
          <p className="mt-2">
            Existem {formatDocumentCount(total)} {total === 1 ? 'documento' : 'documentos'} no
            total, em {formatDocumentCount(totalPages)} {totalPages === 1 ? 'página' : 'páginas'}.
          </p>
          <p className="mt-4">
            <Button type="button" variant="secondary" onClick={() => setOffset(0)}>
              Ir para a primeira página
            </Button>
          </p>
        </div>
      ) : null}

      {isCatalogueEmpty ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">Nenhum documento disponível no seu escopo.</p>
          <p className="mt-2">
            Os documentos são anexados pelos fluxos de execução, medição, faturamento e pelas telas
            das entidades. Assim que o primeiro arquivo for vinculado, ele aparece aqui.
          </p>
        </div>
      ) : null}

      {isNoResult ? (
        <div
          className="rounded-xl bg-white p-6 text-sm text-gray-600 shadow-sm ring-1 ring-gray-900/5"
          role="status"
        >
          <p className="font-semibold text-gray-900">
            Nenhum documento corresponde aos filtros aplicados.
          </p>
          <p className="mt-2">Ajuste a busca ou o tipo para ver os documentos disponíveis.</p>
          <p className="mt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setSearchInput('');
                setAppliedSearch('');
                smartList.clearFilters();
                setOffset(0);
              }}
            >
              Limpar filtros
            </Button>
          </p>
        </div>
      ) : null}

      {items.length > 0 ? (
        // Mesmo cartao das outras listagens da plataforma. `DataTable` ja abre o proprio contêiner
        // de rolagem, entao a rolagem horizontal acontece DENTRO do cartao e a pagina nao estoura
        // em viewport estreito.
        <div
          className="mb-6 overflow-x-auto rounded-xl bg-white shadow-sm ring-1 ring-gray-900/5"
          aria-busy={isRefreshing}
        >
          <DataTable aria-label="Lista de documentos">
            <DataTableHead>
              <DataTableRow>
                <DataTableHeaderCell scope="col">Documento</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Situação</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Versão</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Unidade</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Atualizado</DataTableHeaderCell>
                <DataTableHeaderCell scope="col">Arquivo</DataTableHeaderCell>
              </DataTableRow>
            </DataTableHead>
            <DataTableBody>
              {items.map((item) => (
                <DataTableRow key={item.id}>
                  <DataTableCell>
                    <div className="flex min-w-0 flex-col">
                      {/* Nome truncado com o valor completo em `title`: a coluna principal nao pode
                          ser espremida pelas colunas de metadado. */}
                      <span
                        className="max-w-[24rem] truncate text-sm font-semibold text-gray-900"
                        title={item.title}
                      >
                        {item.title}
                      </span>
                      <span className="text-xs text-gray-500">
                        {buildDocumentContextLabel(item.categoryCode, item.classificationCode)}
                      </span>
                    </div>
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap text-gray-600">
                    {formatDocumentStatus(item.status)}
                  </DataTableCell>
                  <DataTableCell className="whitespace-nowrap text-gray-600 tabular-nums">
                    {formatDocumentVersion(item.currentVersionNumber)}
                  </DataTableCell>
                  <DataTableCell>
                    {/*
                      UNIDADE — nenhum identificador tecnico vai para a superficie
                      operacional. O payload de documentos expoe apenas `unitId`, e nao
                      existe lookup autorizado de nome de unidade publicado hoje; a
                      leitura do recorte aparece como ESCOPO, nao como codigo interno.
                      Quando o backend publicar o rotulo humano, e so trocar aqui.
                      PARK registrado: nome humano da unidade no documento.
                    */}
                    <span className="text-xs text-gray-600">
                      {item.unitId ? 'No seu escopo autorizado' : 'Sem unidade informada'}
                    </span>
                  </DataTableCell>
                  <DataTableCell
                    className="whitespace-nowrap text-gray-600 tabular-nums"
                    title={item.updatedAt}
                  >
                    {formatDateTimePtBr(item.updatedAt, { withSeconds: true })}
                  </DataTableCell>
                  <DataTableCell>
                    {capabilities.canDownload && item.currentVersionNumber ? (
                      <DocumentDownloadAction
                        documentId={item.id}
                        versionNumber={item.currentVersionNumber}
                        filename={item.title}
                        variant="secondary"
                      />
                    ) : (
                      '—'
                    )}
                  </DataTableCell>
                </DataTableRow>
              ))}
            </DataTableBody>
          </DataTable>
        </div>
      ) : null}

      {/* "Existe proxima" vem do TOTAL informado pelo backend, e nao da heuristica "a pagina veio
          cheia" — que oferecia uma pagina fantasma quando o total era multiplo exato do tamanho da
          pagina. */}
      {total > 0 || offset > 0 ? (
        <ModulePagination
          pageNumber={pageNumber}
          rangeLabel={`Documentos ${formatDocumentRangeLabel(offset, items.length, total)}`}
          previousDisabled={offset === 0}
          nextDisabled={offset + items.length >= total}
          onPrevious={() => setOffset(Math.max(0, offset - DOCUMENT_LIST_PAGE_SIZE))}
          onNext={() => setOffset(offset + DOCUMENT_LIST_PAGE_SIZE)}
        />
      ) : null}
    </ModulePage>
  );
}
