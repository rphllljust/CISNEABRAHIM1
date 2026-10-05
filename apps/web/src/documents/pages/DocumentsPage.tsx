import { useCallback, useEffect, useId, useState } from 'react';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
  ModulePagination,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  WorklistStatePanel,
  worklistControlClass,
  worklistSelectClass,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistRowClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { StatusBadge } from '../../ui/StatusBadge';
import {
  DOCUMENT_LIST_PAGE_SIZE,
  DocumentsApiError,
  listDocuments,
} from '../api/documents-api';
import { mapDocumentErrorToMessage } from '../api/document-error-messages';
import { DocumentDownloadAction } from '../components/DocumentDownloadAction';
import { useDocumentCapabilities } from '../hooks/useDocumentCapabilities';
import type { DocumentDetail } from '../types/document.types';
import { DOCUMENT_CATEGORIES, DOCUMENT_CLASSIFICATIONS } from '../types/document.types';
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
      <ModuleStatePage title="Documentos">
        <ModuleLoadingState message="Carregando documentos…" />
      </ModuleStatePage>
    );
  }

  if (phase === 'denied' || !capabilities.canList) {
    return (
      <ModuleStatePage title="Documentos">
        <ModuleDeniedState
          message="Você não tem permissão para listar documentos."
        />
      </ModuleStatePage>
    );
  }

  if (phase === 'error') {
    return (
      <ModuleStatePage title="Documentos">
        <ModuleErrorState
          message={message ?? 'Não foi possível carregar os documentos.'}
          retryable={retryable}
          onRetry={() => setReloadToken((current) => current + 1)}
        />
      </ModuleStatePage>
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

  // SUMMARY REAL — contagens sobre a PÁGINA carregada, a partir dos fatos que o contrato publica
  // (versão corrente e classificação). Nada é estimado nem inventado.
  const withVersionCount = items.filter((item) => item.currentVersionNumber !== null).length;
  const restrictedCount = items.filter(
    (item) => item.classificationCode === DOCUMENT_CLASSIFICATIONS.Restricted,
  ).length;

  const clearAll = () => {
    setSearchInput('');
    setAppliedSearch('');
    smartList.clearFilters();
    setOffset(0);
  };

  return (
    <ModulePage>
      <WorklistHeader
        title="Documentos"
        count={total}
        context="Acervo documental do escopo autorizado: tipo, classificação, versão corrente e vínculo com os fluxos que geraram o arquivo."
        metrics={
          total > 0 ? (
            <>
              <EnterpriseMetric
                value={withVersionCount}
                label="com versão"
                tone="neutral"
              />
              <EnterpriseMetric
                value={items.length - withVersionCount}
                label="sem versão"
                tone={items.length - withVersionCount > 0 ? 'warning' : 'neutral'}
              />
              <EnterpriseMetric
                value={restrictedCount}
                label="restritos"
                tone={restrictedCount > 0 ? 'critical' : 'neutral'}
              />
            </>
          ) : null
        }
      />

      <WorklistFilterBar meta={`${items.length} nesta página`}>
        <WorklistField label="Buscar" htmlFor={searchInputId} grow>
          <input
            id={searchInputId}
            type="search"
            className={worklistControlClass}
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Título do documento"
            autoComplete="off"
          />
        </WorklistField>
        <WorklistField label="Tipo" htmlFor={categoryFilterId}>
          <select
            id={categoryFilterId}
            className={worklistSelectClass}
            value={categoryCode}
            onChange={(event) => {
              smartList.setFilter('categoryCode', event.target.value);
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
        </WorklistField>
        {hasFilters || searchInput.trim() !== '' ? (
          <WorklistClearFilters visible label="Limpar filtros" onClick={clearAll} />
        ) : null}
        {isRefreshing ? (
          <p role="status" className="pb-1 text-xs text-gray-500">
            Atualizando…
          </p>
        ) : null}
      </WorklistFilterBar>

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
        <WorklistStatePanel
          title="Esta página não existe mais para os filtros aplicados."
          description={`Existem ${formatDocumentCount(total)} ${total === 1 ? 'documento' : 'documentos'} no total, em ${formatDocumentCount(totalPages)} ${totalPages === 1 ? 'página' : 'páginas'}.`}
          action={<WorklistClearFilters visible label="Ir para a primeira página" onClick={() => setOffset(0)} />}
        />
      ) : null}

      {isCatalogueEmpty ? (
        <WorklistStatePanel
          title="Nenhum documento disponível no seu escopo."
          description="Os documentos são anexados pelos fluxos de execução, medição, faturamento e pelas telas das entidades. Assim que o primeiro arquivo for vinculado, ele aparece aqui."
        />
      ) : null}

      {isNoResult ? (
        <WorklistStatePanel
          title="Nenhum documento corresponde aos filtros aplicados."
          description="Ajuste a busca ou o tipo para ver os documentos disponíveis."
          action={<WorklistClearFilters visible label="Ver todos os documentos" onClick={clearAll} />}
        />
      ) : null}

      {items.length > 0 ? (
        <div className={worklistTableCardClass} aria-busy={isRefreshing}>
          <table className={worklistTableClass} aria-label="Lista de documentos">
            <thead>
              <tr>
                <th scope="col" className={worklistHeadCellClass}>
                  Documento
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Situação
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Versão
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Unidade
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Atualizado
                </th>
                <th scope="col" className={worklistHeadCellClass}>
                  Arquivo
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={worklistRowClass}>
                  <td className={worklistCellClass}>
                    <span
                      className="max-w-[24rem] truncate text-sm font-semibold text-gray-900"
                      title={item.title}
                    >
                      {item.title}
                    </span>
                    <p className="text-[11px] text-gray-500">
                      {buildDocumentContextLabel(item.categoryCode, item.classificationCode)}
                    </p>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {/*
                      STATUS SEMÂNTICO — antes `formatDocumentStatus` renderizava texto puro.
                      "Restrito" é um fato de SEGURANÇA: documento confidencial exige saliência.
                      O status (Ativo/Arquivado) vira badge; a classificação RESTRICTED ganha
                      exceção própria, junto do status, porque é ela que o operador precisa
                      notar antes de abrir o arquivo.
                    */}
                    <StatusBadge
                      label={formatDocumentStatus(item.status)}
                      tone={item.status === 'ARCHIVED' ? 'neutral' : 'success'}
                    />
                    {item.classificationCode === DOCUMENT_CLASSIFICATIONS.Restricted ? (
                      <WorklistException tone="critical">Restrito</WorklistException>
                    ) : null}
                  </td>
                  <td className={worklistCellRaisedClass}>
                    <span className="tabular-nums text-gray-700">
                      {formatDocumentVersion(item.currentVersionNumber)}
                    </span>
                  </td>
                  <td className={worklistCellRaisedClass}>
                    {/*
                      UNIDADE — nenhum identificador tecnico vai para a superficie
                      operacional (PARK: nome humano da unidade no documento).
                    */}
                    <span className="text-xs text-gray-600">
                      {item.unitId ? 'No seu escopo autorizado' : 'Sem unidade informada'}
                    </span>
                  </td>
                  <td
                    className={worklistCellRaisedClass}
                    title={item.updatedAt}
                  >
                    <span className="whitespace-nowrap tabular-nums text-gray-700">
                      {formatDateTimePtBr(item.updatedAt, { withSeconds: true })}
                    </span>
                  </td>
                  <td className={worklistCellRaisedClass}>
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
