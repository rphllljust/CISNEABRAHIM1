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
  ModuleCodeCell,
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
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
import type { DocumentCategory, DocumentDetail } from '../types/document.types';
import { formatDateTimePtBr } from '../utils/document-format';
import {
  buildDocumentContextLabel,
  DOCUMENT_CATEGORY_OPTIONS,
  formatDocumentStatus,
  formatDocumentVersion,
} from '../utils/document-list-labels';

/**
 * Atraso da busca digitada, igual ao das outras listagens da plataforma: a consulta continua
 * parecendo instantanea sem transformar digitacao em carga de rede.
 */
const SEARCH_DEBOUNCE_MS = 300;

type ListPhase = 'loading' | 'ready' | 'error' | 'denied';

export function DocumentsPage() {
  const { capabilities, loading: capabilitiesLoading } = useDocumentCapabilities();
  const [phase, setPhase] = useState<ListPhase>('loading');
  const [items, setItems] = useState<DocumentDetail[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [retryable, setRetryable] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Busca e tipo sao resolvidos no SERVIDOR: a lista traz apenas a primeira pagina, entao filtrar
  // no browser mostraria um recorte como se fosse o cadastro inteiro.
  const [searchInput, setSearchInput] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [categoryCode, setCategoryCode] = useState<'' | DocumentCategory>('');
  // Recarga pedida pelo usuario percorre o mesmo ciclo de vida do efeito: assim tambem e cancelavel.
  const [reloadToken, setReloadToken] = useState(0);
  const searchInputId = useId();
  const categoryFilterId = useId();

  useEffect(() => {
    if (searchInput === appliedSearch) {
      return;
    }
    const timer = setTimeout(() => setAppliedSearch(searchInput), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [appliedSearch, searchInput]);

  const load = useCallback(
    async (search: string, category: '' | DocumentCategory, signal: AbortSignal) => {
      // Uma recarga preserva o resultado anterior: trocar a tela inteira por "Carregando…" faria a
      // tabela sumir a cada ajuste de filtro. So a primeira carga nao tem o que preservar.
      setPhase((current) => (current === 'ready' ? current : 'loading'));
      setIsRefreshing(true);
      try {
        const documents = await listDocuments(signal, {
          q: search.trim() || undefined,
          categoryCode: category || undefined,
        });
        // Requisicao superada (outro filtro ja assumiu) nao escreve no estado.
        if (signal.aborted) {
          return;
        }
        setItems(documents);
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
    void load(appliedSearch, categoryCode, controller.signal);
    return () => controller.abort();
  }, [appliedSearch, categoryCode, load, reloadToken]);

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
  const isCatalogueEmpty = items.length === 0 && !hasFilters;
  const isNoResult = items.length === 0 && hasFilters;
  // O backend nao devolve `total`: a pagina cheia e a unica evidencia de que existem mais
  // documentos. Dizer isso e melhor do que apresentar um recorte como se fosse o acervo inteiro.
  const isTruncated = items.length >= DOCUMENT_LIST_PAGE_SIZE;

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
            onChange={(event) => setCategoryCode(event.target.value as '' | DocumentCategory)}
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
              setCategoryCode('');
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

      {isTruncated ? (
        <p role="status" className="mb-4 text-sm text-gray-500">
          Exibindo os {DOCUMENT_LIST_PAGE_SIZE} documentos mais recentes. Use a busca ou o filtro de
          tipo para localizar os demais.
        </p>
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
                setCategoryCode('');
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
                    {/* Identificador tecnico da unidade: exibido como codigo (e nao como nome) porque
                        nenhum nome humano existe no contrato. Ver registro de execucao — Fase 2. */}
                    <ModuleCodeCell>
                      <span title={item.unitId}>{item.unitId}</span>
                    </ModuleCodeCell>
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
    </ModulePage>
  );
}
