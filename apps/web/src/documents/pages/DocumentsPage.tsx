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
  WorklistClearFilters,
  WorklistException,
  WorklistField,
  WorklistFilterBar,
  worklistControlClass,
  worklistSelectClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { StatusBadge } from '../../ui/StatusBadge';
import {
  ContextFacts,
  ContextSection,
  WorkspaceBody,
  WorkspaceEmpty,
  WorkspaceHeader,
  WorkspacePane,
  WorkspacePaneHeader,
  WorkspaceStatusLine,
  workspaceCellRaisedClass,
  workspaceHeadCellClass,
  workspaceRowClass,
} from '../../ui/workspace-frame';
import { cn } from '../../ui/utils/cn';
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
    <ModulePage layout="workspace">
      {/*
        ═════════════════════════════════════════════════════════════════════════════════════════
        DOCUMENTOS — RECOMPOSTO NA GRAMATICA DE BANCADA.

        DEFEITO MEDIDO (1600x900, `getBoundingClientRect` sobre o DOM renderizado): a rota nao
        declarava NENHUMA regiao de trabalho. A sonda de camadas devolveu, no nivel do `<main>`:

            <h1> Documentos                  sem region
            <div> cisne-filter-surface       bg=rgb(255,255,255)  1336x44   <- faixa BRANCA de filtro
            <div> bg=oklab(.../0.7)          bg=cinza 70%         1336x43   <- OUTRA faixa de filtro
            <button>  bg=rgb(8,127,120)                            57x26    <- chip TEAL

        Tres consequencias, todas de COMPOSICAO:

        1. A tabela vivia num `worklistTableCardClass` solto no `main`, sem `WorkspaceBody`: nao
           existia divisao trabalho/contexto, e a pagina era uma COLUNA unica de largura total.
        2. As duas faixas de filtro empilhavam 87px de chrome ANTES do primeiro dado — e a barra de
           filtro pintava BRANCO cheio de ponta a ponta, virando uma segunda superficie de trabalho
           sem conteudo dentro.
        3. O chip de recorte ativo era TEAL (`rgb(8,127,120)`) — a cor de IDENTIDADE do CISNE usada
           como estado de filtro. Teal nao e estado: e apoio e contexto.

        Agora a rota usa a mesma gramatica de Clientes, Contratos e Financeiro: cabecalho com a
        linha de situacao, `WorkspaceBody` com a grade BRANCA no eixo e a coluna de CONTEXTO
        (320-380px, `#F5F7FA`) ao lado, e estado vazio dentro da estrutura.
        ═════════════════════════════════════════════════════════════════════════════════════════
      */}
      <WorkspaceHeader
        title="Documentos"
        identity="Acervo documental do escopo autorizado: tipo, classificação, versão corrente e vínculo com os fluxos que geraram o arquivo."
        scope={`${formatDocumentCount(total)} ${total === 1 ? 'documento' : 'documentos'} publicados`}
        status={
          total > 0 ? (
            <WorkspaceStatusLine
              items={[
                { value: formatDocumentCount(withVersionCount), label: 'com versão' },
                {
                  value: formatDocumentCount(items.length - withVersionCount),
                  label: 'sem versão',
                  tone: items.length - withVersionCount > 0 ? 'alert' : 'neutral',
                },
                {
                  value: formatDocumentCount(restrictedCount),
                  label: 'restritos',
                  tone: restrictedCount > 0 ? 'alert' : 'neutral',
                },
              ]}
            />
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

      {/*
        DIVISAO DE BANCADA — A GRADE NO EIXO, O RECORTE NO CONTEXTO.

        O estado vazio NAO desmonta a area de trabalho: os paineis de estado entram DENTRO do painel
        branco, e a coluna de contexto continua publicada ao lado. Antes eles empilhavam no `main` e
        a pagina colapsava para uma mensagem solta.
      */}
      <WorkspaceBody
        context={
          <WorkspacePane surface="support" className="h-full overflow-auto" data-region="context-region">
            <WorkspacePaneHeader title="Recorte e acervo" />
            <ContextSection title="Recorte lido">
              <ContextFacts
                facts={[
                  {
                    label: 'Documentos no recorte',
                    value: formatDocumentCount(total),
                  },
                  {
                    label: 'Nesta página',
                    value: String(items.length),
                  },
                  {
                    label: 'Tipo',
                    value: categoryCode
                      ? (DOCUMENT_CATEGORY_OPTIONS.find((option) => option.value === categoryCode)
                          ?.label ?? categoryCode)
                      : 'Todos os tipos',
                  },
                  {
                    label: 'Busca',
                    value: appliedSearch || 'Sem termo',
                  },
                ]}
              />
            </ContextSection>

            {/*
              IDENTIDADE E SITUACAO DO ACERVO — DADO EMPRESARIAL, NAO AJUDA DE INTERFACE.

              Uma secao "como usar" aqui seria tutorial, e o contrato proibe. O que a coluna publica
              e o que o acervo E: quantos documentos tem versao vigente, quantos estao restritos e o
              que cada estado significa em termos de acesso.
            */}
            <ContextSection title="Situação do acervo">
              <ContextFacts
                facts={[
                  {
                    label: 'Com versão vigente',
                    value: formatDocumentCount(withVersionCount),
                  },
                  {
                    label: 'Sem versão publicada',
                    value: formatDocumentCount(items.length - withVersionCount),
                  },
                  {
                    label: 'Classificação restrita',
                    value:
                      restrictedCount > 0
                        ? `${formatDocumentCount(restrictedCount)} — exige acesso autorizado`
                        : 'Nenhum no recorte',
                  },
                  {
                    label: 'Arquivados',
                    value: formatDocumentCount(
                      items.filter((item) => item.status === 'ARCHIVED').length,
                    ),
                  },
                ]}
              />
            </ContextSection>
          </WorkspacePane>
        }
      >
        <WorkspacePane className="h-full overflow-hidden" data-region="worklist-master">
          {isOutOfRange ? (
            <WorkspaceEmpty
              title="Esta página não existe mais para os filtros aplicados."
              description={`Existem ${formatDocumentCount(total)} ${total === 1 ? 'documento' : 'documentos'} no total, em ${formatDocumentCount(totalPages)} ${totalPages === 1 ? 'página' : 'páginas'}.`}
              action={<WorklistClearFilters visible label="Ir para a primeira página" onClick={() => setOffset(0)} />}
            />
          ) : null}

          {isCatalogueEmpty ? (
            <WorkspaceEmpty
              title="Nenhum documento disponível no seu escopo."
              description="Os documentos são anexados pelos fluxos de execução, medição, faturamento e pelas telas das entidades. Assim que o primeiro arquivo for vinculado, ele aparece aqui."
            />
          ) : null}

          {isNoResult ? (
            <WorkspaceEmpty
              title="Nenhum documento corresponde aos filtros aplicados."
              description="Ajuste a busca ou o tipo para ver os documentos disponíveis."
              action={<WorklistClearFilters visible label="Ver todos os documentos" onClick={clearAll} />}
            />
          ) : null}

          {items.length > 0 ? (
            <div className="min-h-0 flex-1 overflow-auto" aria-busy={isRefreshing}>
              <table className={worklistTableClass} aria-label="Lista de documentos">
                <thead>
                  <tr>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Documento
                    </th>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Situação
                    </th>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Versão
                    </th>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Unidade
                    </th>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Atualizado
                    </th>
                    <th scope="col" className={workspaceHeadCellClass}>
                      Arquivo
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={workspaceRowClass}>
                      <td className={workspaceCellRaisedClass}>
                        {/* IDENTIFICADOR PRIMARIO — texto primario em peso 600, conforme o contrato da grade. */}
                        <span
                          className="block max-w-[24rem] truncate text-[length:var(--type-primary-size)] font-semibold text-[color:var(--color-text-primary)]"
                          title={item.title}
                        >
                          {item.title}
                        </span>
                        <p className="m-0 text-[11px] text-[color:var(--color-text-muted)]">
                          {buildDocumentContextLabel(item.categoryCode, item.classificationCode)}
                        </p>
                      </td>
                      <td className={workspaceCellRaisedClass}>
                        <StatusBadge
                          label={formatDocumentStatus(item.status)}
                          tone={item.status === 'ARCHIVED' ? 'neutral' : 'success'}
                        />
                        {item.classificationCode === DOCUMENT_CLASSIFICATIONS.Restricted ? (
                          <WorklistException tone="critical">Restrito</WorklistException>
                        ) : null}
                      </td>
                      <td className={cn(workspaceCellRaisedClass, 'tabular-nums')}>
                        {formatDocumentVersion(item.currentVersionNumber)}
                      </td>
                      <td className={workspaceCellRaisedClass}>
                        <span className="cisne-type-meta">
                          {item.unitId ? 'No seu escopo autorizado' : 'Sem unidade informada'}
                        </span>
                      </td>
                      <td className={cn(workspaceCellRaisedClass, 'whitespace-nowrap tabular-nums')} title={item.updatedAt}>
                        {formatDateTimePtBr(item.updatedAt, { withSeconds: true })}
                      </td>
                      <td className={workspaceCellRaisedClass}>
                        {capabilities.canDownload && item.currentVersionNumber ? (
                          <DocumentDownloadAction
                            documentId={item.id}
                            versionNumber={item.currentVersionNumber}
                            filename={item.title}
                            variant="secondary"
                          />
                        ) : (
                          <span className="text-[color:var(--color-text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {/*
            "Existe proxima" vem do TOTAL informado pelo backend, e nao da heuristica "a pagina veio
            cheia" — que oferecia uma pagina fantasma quando o total era multiplo exato do tamanho da
            pagina.
          */}
          {total > 0 || offset > 0 ? (
            <div className="shrink-0 border-t border-[color:var(--color-border-default)] px-2.5 py-1.5">
              <ModulePagination
                pageNumber={pageNumber}
                rangeLabel={`Documentos ${formatDocumentRangeLabel(offset, items.length, total)}`}
                previousDisabled={offset === 0}
                nextDisabled={offset + items.length >= total}
                onPrevious={() => setOffset(Math.max(0, offset - DOCUMENT_LIST_PAGE_SIZE))}
                onNext={() => setOffset(offset + DOCUMENT_LIST_PAGE_SIZE)}
              />
            </div>
          ) : null}
        </WorkspacePane>
      </WorkspaceBody>
    </ModulePage>
  );
}
