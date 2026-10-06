import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  cancelServiceOrder,
  listServiceOrders,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ServiceOrderStatus } from '../types/service-order.types';
import {
  CommandPalette,
  DynamicBulkActions,
  DynamicContextDrawer,
  DynamicCreateForm,
  DynamicExportCsv,
  DynamicFilterBar,
  DynamicKanban,
  DynamicKpiDrilldown,
  DynamicList,
  DynamicSavedViewsBar,
  DynamicViewHost,
  DynamicViewSwitcher,
  buildKpiMetrics,
  RENDERABLE_VIEW_TYPES,
  filtersToSearchParams,
  listColumns,
  paletteActionsFromSchema,
  useCommandPaletteShortcut,
  useEntitySchema,
  useSavedViews,
  toDisplayText,
  type CrossReference,
  type KpiSpec,
  type MetaEntitySchema,
} from '../../engine';
import { useAuth } from '../../auth/context/AuthProvider';
import { entityLabel, useLanguage } from '../../i18n';
import {
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistStatePanel,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { ModulePagination } from '../../ui/module-layout';
import { serviceOrderEngineRows, type ServiceOrderEngineRow } from './service-order-engine-rows';

/**
 * Lista de ordens de serviço RENDERIZADA PELA ENGINE — a tela de referência do ERP.
 *
 * Não há coluna, rótulo, ordem, filtro nem aba escritos em JSX. Tudo vem do metadata store:
 *   - colunas  → `meta.views['list'].layout.columns`
 *   - abas     → `meta.views` (qualquer `view_type` vira aba)
 *   - filtros  → `meta.fields.in_filter`
 *   - ações    → `meta.workflow_transitions`
 *
 * O que permanece é o ENCANAMENTO: qual endpoint alimenta a entidade e como cada comando
 * chega ao backend — conhecimento que a engine não tem como adivinhar.
 */
/*
 * Tipos com renderizador na engine.
 *
 * A lista vem do PRÓPRIO engine (`RENDERABLE_VIEW_TYPES`), não de uma constante local: era
 * exatamente a cópia local que obrigava a editar cada tela quando uma capacidade nova surgia.
 */
const SUPPORTED_VIEW_TYPES: readonly string[] = RENDERABLE_VIEW_TYPES;

/**
 * Tamanho da página.
 *
 * A tela pedia 50 linhas e parava ali, sem paginação: acima de 50 ordens a carteira era
 * truncada em silêncio. Com paginação explícita, o operador sabe onde está e alcança o resto.
 */
const PAGE_SIZE = 20;

const DEFAULT_DESTINATIONS = [
  { id: 'nav-suppliers', label: 'Fornecedores', path: '/app/suppliers', group: 'Navegar' },
  { id: 'nav-billing', label: 'Faturamento interno', path: '/app/billing', group: 'Navegar' },
  { id: 'nav-service-orders', label: 'Ordens de serviço', path: '/app/service-orders', group: 'Navegar' },
];

export function ServiceOrdersEngineListPage() {
  const navigate = useNavigate();
  const { identityId } = useAuth();
  const { schema, status } = useEntitySchema('service-orders');
  const [searchParams, setSearchParams] = useSearchParams();

  /*
   * ASSINATURA DE IDIOMA.
   *
   * `entityLabel()` é uma função livre e NÃO re-renderiza sozinha: quem dispara o
   * re-render é este hook. Sem esta linha, trocar o idioma no seletor atualizaria o
   * catálogo mas o `<h1>` só mudaria no próximo render por outro motivo — que é
   * exatamente o defeito que a prova de browser ("sem reload") existe para pegar.
   *
   * `language` é lido mas não usado diretamente: a dependência está no hook, não no valor.
   */
  useLanguage();

  const [rows, setRows] = useState<ServiceOrderEngineRow[]>([]);
  const [rowsStatus, setRowsStatus] = useState<'loading' | 'ready' | 'denied' | 'error'>('loading');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  /**
   * RECORTE SERVER-SIDE — busca e situação.
   *
   * O endpoint aceita `q` e `status` desde sempre; a tela carregava 50 linhas fixas e filtrava
   * `status`/`unit_id`/`origin` NO CLIENTE sobre essa página. Numa carteira maior que 50, a OS
   * procurada podia simplesmente não estar entre as carregadas, e a tela dizia "nenhum
   * resultado" para um registro que existe. Agora os dois recortes que o contrato suporta vão ao
   * SERVIDOR, e a paginação deixa de truncar silenciosamente a carteira.
   */
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [pageOffset, setPageOffset] = useState(0);
  /** Estado do formulário de criação — a engine fornece, a TELA decide como submeter. */
  const [createOpen, setCreateOpen] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  /** Linha que abriu o drawer de contexto. `null` = painel fechado. */
  const [contextRow, setContextRow] = useState<ServiceOrderEngineRow | null>(null);

  const activeViewType = searchParams.get('view') ?? 'list';
  const statusFilter = (searchParams.get('status') ?? '') as ServiceOrderStatus | '';

  // A busca digitada espera antes de virar requisição: sem o atraso, cada tecla é uma ida à rede.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPageOffset(0);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const filters = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      if (key !== 'view') {
        values[key] = value;
      }
    }
    return values;
  }, [searchParams]);

  const savedViews = useSavedViews(identityId ?? 'anonymous', 'service-orders');

  const loadRows = useCallback(
    async (signal?: AbortSignal) => {
      // Recarga preserva as linhas anteriores: trocar a grade por "Carregando…" a cada tecla
      // desmontaria a própria barra de busca durante a digitação.
      setRowsStatus((previous) => (previous === 'ready' ? previous : 'loading'));
      setErrorMessage(null);
      try {
        const response = await listServiceOrders(
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
        setRows(serviceOrderEngineRows(response.items));
        setRowsStatus('ready');
      } catch (error) {
        if (signal?.aborted) {
          return;
        }
        if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
          setRowsStatus('denied');
          return;
        }
        setErrorMessage(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar as ordens de serviço.',
        );
        setRowsStatus('error');
      }
    },
    [pageOffset, search, statusFilter],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadRows(controller.signal);
    return () => controller.abort();
  }, [loadRows]);

  /**
   * As linhas carregadas SÃO o resultado — não há recorte no cliente.
   *
   * O bloco anterior filtrava `status`/`unit_id`/`origin` sobre as 50 linhas da página e
   * declarava GAP_DE_CONTRATO. O gap era real para esses campos, mas `status` e `q` o endpoint
   * aceitava desde sempre: o que faltava era a tela mandar. O que o contrato NÃO suporta
   * continua sem aparecer como filtro — a barra lê `in_filter` do metadado e a busca cobre o
   * que `q` resolve no servidor.
   */
  const visibleRows = rows;

  const items = rows;
  const hasMore = items.length === PAGE_SIZE;
  const pageNumber = Math.floor(pageOffset / PAGE_SIZE) + 1;

  /**
   * INDICADORES DE DRILL-DOWN — derivados das linhas carregadas, com recortes DECLARADOS.
   *
   * `buildKpiMetrics` conta por `equals` sobre o campo do metadado; a engine não conhece os
   * estados, apenas conta o que a tela declara. O clique aplica o MESMO filtro que a barra usa,
   * então o número do card e a lista filtrada vêm do mesmo recorte.
   */
  const kpiSpecs = useMemo<KpiSpec[]>(
    () => [
      { id: 'execution', label: 'Em execução', field: 'status', equals: 'IN_EXECUTION', tone: 'info' },
      { id: 'paused', label: 'Pausadas', field: 'status', equals: 'PAUSED', tone: 'warning' },
      { id: 'completed', label: 'Concluídas', field: 'status', equals: 'COMPLETED', tone: 'success' },
      { id: 'cancelled', label: 'Canceladas', field: 'status', equals: 'CANCELLED', tone: 'critical' },
    ],
    [],
  );
  const kpiMetrics = useMemo(() => buildKpiMetrics(rows, kpiSpecs), [rows, kpiSpecs]);

  const updateFilter = (field: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value.trim() === '') {
      next.delete(field);
    } else {
      next.set(field, value);
    }
    setSearchParams(next, { replace: true });
    // MUDAR O RECORTE VOLTA PARA A PRIMEIRA PÁGINA. Sem este reset, quem estivesse na página 3
    // e filtrasse por situação veria uma página vazia — o recorte mudou, a posição não.
    setPageOffset(0);
  };

  const clearFilters = (): void => {
    const next = filtersToSearchParams({});
    if (activeViewType !== 'list') {
      next.set('view', activeViewType);
    }
    setSearchParams(next, { replace: true });
    setPageOffset(0);
  };

  const changeView = (viewType: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('view', viewType);
    setSearchParams(next, { replace: true });
  };

  const openRow = (row: Record<string, unknown> & { id: string }): void => {
    void navigate(`/app/service-orders/${row.id}`);
  };

  /**
   * Abre o painel de contexto para a linha clicada.
   *
   * Diferente de `openRow`, que NAVEGA: o drawer mantém o operador na lista e mostra as
   * referências cruzadas do registro sem tirá-lo do recorte em que ele está trabalhando.
   */
  const openContext = (row: ServiceOrderEngineRow): void => {
    setContextRow(row);
  };

  /**
   * Referências cruzadas da linha.
   *
   * Montadas do que o payload JÁ traz — nenhuma chamada de rede nova. Quando um vínculo não
   * veio, ele não é afirmado: a referência simplesmente não entra, e a lista fica vazia se
   * nenhuma existir (o drawer declara isso em vez de quebrar).
   */
  const crossReferencesFor = (row: ServiceOrderEngineRow): CrossReference[] => {
    const references: CrossReference[] = [];
    const status = toDisplayText(row['status']);
    if (status.trim() !== '') {
      references.push({ label: 'Situação', detail: status });
    }
    const client = toDisplayText(row['client_snapshot']);
    if (client.trim() !== '') {
      references.push({ label: 'Cliente', detail: client });
    }
    const unit = toDisplayText(row['unit_id']);
    if (unit.trim() !== '') {
      references.push({ label: 'Unidade', detail: unit });
    }
    const deadline = toDisplayText(row['deadline_at']);
    if (deadline.trim() !== '') {
      references.push({ label: 'Prazo', detail: deadline });
    }
    return references;
  };

  async function runCommand(command: string, ids: string[]): Promise<void> {
    setBulkBusy(true);
    setBulkMessage(null);
    const failures: string[] = [];
    for (const id of ids) {
      const row = rows.find((candidate) => candidate.id === id);
      const rowVersion = Number(row?.['row_version'] ?? 1);
      try {
        if (command === 'prepare') {
          await prepareServiceOrder(id, rowVersion);
        } else if (command === 'release') {
          await releaseServiceOrder(id, rowVersion);
        } else if (command === 'cancel') {
          await cancelServiceOrder(id, {
            rowVersion,
            cancellationReason: 'Cancelamento em lote solicitado na lista de ordens de serviço.',
          });
        }
      } catch (error) {
        failures.push(
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'erro',
        );
      }
    }
    setBulkBusy(false);
    setSelectedIds([]);
    if (failures.length > 0) {
      setBulkMessage(`${failures.length} de ${ids.length} não puderam ser concluídas.`);
    }
    await loadRows();
  }

  const stateLabel = useCallback(
    (state: string): string => {
      if (!schema) {
        return state;
      }
      return resolveStateLabel(schema, state);
    },
    [schema],
  );

  /*
   * As ações da palette derivam do workflow do metadado e despacham o MESMO `runCommand` da
   * barra de lote. As dependências incluem `rows` porque `runCommand` lê `row_version` das
   * linhas carregadas — mantê-las explícitas é mais honesto que silenciar a regra.
   */
  const paletteActions = useMemo(
    () => paletteActionsFromSchema(schema, (command) => void runCommand(command, selectedIds)),
    [schema, selectedIds, rows],
  );

  useCommandPaletteShortcut(useCallback(() => setPaletteOpen(true), []));

  return (
    <div className="p-6">
      <header className="mb-4 flex items-start justify-between gap-3">
        <div>
          {/*
            ENTITY TITLE — o rótulo da entidade, resolvido pelo i18n.

            O metadata store devolve o rótulo em português (`Ordens de serviço`). Aqui ele
            passa pelo catálogo: em pt-BR sai igual ao metadado, em en-US sai traduzido. O
            `data-testid` é o gancho da prova de browser — é este nó que precisa mudar quando
            o operador troca o idioma, SEM reload.
          */}
          <h1 className="text-xl font-semibold" data-testid="entity-title">
            {entityLabel('service-orders', schema?.label ?? 'Ordens de serviço')}
          </h1>
          <p className="mt-1 text-xs text-gray-500">
            Renderizado pela engine a partir de <code>/api/v1/meta/service-orders</code>.
          </p>
        </div>
        {/* Criação pela engine: os campos são os que o metadado declara como criáveis. */}
        <button
          type="button"
          data-testid="dynamic-create-open"
          className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
          onClick={() => {
            setCreateError(null);
            setCreateOpen((current) => !current);
          }}
        >
          Nova OS
        </button>
      </header>

      {status === 'loading' || rowsStatus === 'loading' ? (
        <p className="text-sm text-gray-600" aria-busy="true">
          Carregando…
        </p>
      ) : null}

      {status === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {rowsStatus === 'denied' ? (
        <p className="text-sm" role="alert">
          Você não tem permissão para listar ordens de serviço.
        </p>
      ) : null}

      {rowsStatus === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          {errorMessage ?? 'Não foi possível carregar as ordens de serviço.'}
        </p>
      ) : null}

      {schema && rowsStatus === 'ready' ? (
        <>
          {createOpen ? (
            <div className="mb-4" data-testid="dynamic-create-panel">
              <DynamicCreateForm
                schema={schema}
                busy={createBusy}
                errorMessage={createError}
                onCancel={() => setCreateOpen(false)}
                onSubmit={() => {
                  /*
                   * A ENGINE coleta; a TELA decide como gravar. O endpoint de criação de OS
                   * exige vínculo com solicitação/proposta aceita — criar uma OS "solta" não é
                   * operação do domínio. Enquanto essa tela não tiver o vínculo, o formulário
                   * DIZ isso em vez de enviar um POST que o backend recusaria.
                   */
                  setCreateError(
                    'A ordem de serviço nasce de uma solicitação aprovada ou proposta aceita. Abra a origem e converta.',
                  );
                  setCreateBusy(false);
                }}
              />
            </div>
          ) : null}

          <DynamicViewSwitcher
            schema={schema}
            activeViewType={activeViewType}
            onChange={changeView}
            supportedViewTypes={SUPPORTED_VIEW_TYPES}
          />

          <DynamicKpiDrilldown
            metrics={kpiMetrics}
            activeFilters={filters}
            onDrilldown={(field, value) => updateFilter(field, value)}
          />

          <div className="mb-2">
            <DynamicExportCsv
              schema={schema}
              rows={visibleRows}
              fileName="ordens-de-servico"
              columns={listColumns(schema)}
            />
          </div>

          <DynamicFilterBar
            schema={schema}
            values={filters}
            onChange={updateFilter}
            onClear={clearFilters}
          />

          {/*
            BUSCA E SITUAÇÃO — os dois recortes que o CONTRATO suporta, indo ao SERVIDOR.
            A barra acima é dirigida pelo metadado (`in_filter`) e alimenta a URL; esta faixa
            cobre o que o operador mais faz: procurar uma OS por número/cliente e recortar por
            situação. Ambos mudam a CONSULTA, não a página carregada.
          */}
          <WorklistFilterBar meta={`${items.length} nesta página`}>
            <WorklistField label="Buscar" htmlFor="so-engine-search" grow>
              <input
                id="so-engine-search"
                type="search"
                className={worklistSelectClass}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="Número da OS ou cliente"
                autoComplete="off"
              />
            </WorklistField>
            {/*
              NÃO há um segundo seletor de situação aqui.
              A `DynamicFilterBar` acima já publica um, dirigido pelo `in_filter` do metadado — e
              é ELE o filtro server-side, porque escreve `status` na URL, que `loadRows` manda à
              consulta. Dois controles para o mesmo recorte confundiriam o operador e poderiam
              divergir. A faixa cobre o que a barra do metadado NÃO tem: busca livre por `q`.
            */}
            <WorklistClearFilters
              visible={Boolean(statusFilter || search.trim() || Object.keys(filters).length > 0)}
              onClick={() => {
                setSearchInput('');
                setSearch('');
                clearFilters();
                setPageOffset(0);
              }}
            />
          </WorklistFilterBar>

          <DynamicSavedViewsBar
            views={savedViews.views}
            persistedLocally={savedViews.persistedLocally}
            onSave={(name) => savedViews.save(name, filters, activeViewType)}
            onDelete={savedViews.remove}
            onApply={(view) => {
              const next = filtersToSearchParams(view.filters);
              next.set('view', view.viewType);
              setSearchParams(next, { replace: true });
            }}
          />

          <DynamicBulkActions
            schema={schema}
            selectedIds={selectedIds}
            busy={bulkBusy}
            errorMessage={bulkMessage}
            onApply={(command, ids) => void runCommand(command, ids)}
            onClear={() => setSelectedIds([])}
          />

          {activeViewType === 'kanban' ? (
            <DynamicKanban
              schema={schema}
              rows={visibleRows}
              ownerField="client_snapshot"
              stateLabel={stateLabel}
              onCardClick={openRow}
            />
          ) : activeViewType === 'list' ? (
            <DynamicList
              schema={schema}
              rows={visibleRows}
              emptyMessage="Nenhuma ordem de serviço no seu escopo."
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
              ownerField="client_snapshot"
              showTotals
              /*
               * AGING NO EIXO REAL DA ENTIDADE: o prazo operacional (`deadline_at`), não a
               * data de criação — que a listagem nem recebe. É a distância até o PRAZO que
               * diz se uma OS está atrasada, e é isso que a cor comunica.
               */
              agingField="deadline_at"
              /*
               * A LINHA NAVEGA; o painel de contexto abre por um botão PRÓPRIO.
               *
               * Os dois gestos existiram na mesma linha em algum momento, e o clique ficou com
               * o drawer — o que apagou a ida ao detalhe: a lista deixou de abrir a OS e as
               * provas de browser (campo novo, transição nova, reordenação) passaram a falhar
               * por não haver detalhe para inspecionar. Um clique não pode significar duas
               * coisas: navegar é o que a linha promete desde que a lista existe, e o contexto
               * ganhou botão explícito, que também anuncia a ação a quem usa teclado.
               */
              onRowClick={openRow}
              renderRowActions={(row) => (
                <button
                  type="button"
                  data-testid="dynamic-open-context"
                  data-context-row={row.id}
                  className="rounded border border-slate-300 px-2 py-0.5 text-xs"
                  onClick={(event) => {
                    // Sem `stopPropagation` o botão também navegaria — o clique subiria ao `<tr>`.
                    event.stopPropagation();
                    openContext(row);
                  }}
                >
                  Contexto
                </button>
              )}
            />
          ) : (
            /*
             * AS DEMAIS VIEWS VÊM DO STORE, sem branch por tipo nesta tela.
             *
             * `calendar`, `pivot`, `tree` e `graph` já existem em `meta.views` de outras
             * entidades e são renderizadas por `DynamicViewHost`, que escolhe o renderizador
             * pelo `viewType` declarado. Antes, esta tela precisava conhecer cada tipo novo —
             * o oposto de views-como-dados. Tipo sem renderizador continua sendo dito em voz
             * alta pelo próprio host.
             */
            <DynamicViewHost
              schema={schema}
              rows={visibleRows}
              activeViewType={activeViewType}
              onRowClick={openRow}
              emptyMessage="Nenhuma ordem de serviço no seu escopo."
            />
          )}

          {/*
            PAGINAÇÃO SERVER-SIDE.
            O contrato NÃO publica `total` nesta listagem, então a faixa diz apenas o intervalo
            da página — "PÁGINA PAGINADA ≠ DATASET". Um total estimado a partir de `hasMore`
            seria um número inventado; a contagem por estado continua vindo do drill-down, que
            conta as linhas REALMENTE carregadas.
          */}
          <WorklistFooter
            rangeLabel={`${pageOffset + 1}–${pageOffset + items.length} nesta página`}
            extra={
              statusFilter || search.trim()
                ? `${items.length} nesta página${statusFilter ? ` · situação: ${stateLabel(statusFilter)}` : ''}`
                : undefined
            }
          >
            <ModulePagination
              pageNumber={pageNumber}
              previousDisabled={pageOffset === 0}
              nextDisabled={!hasMore}
              onPrevious={() => setPageOffset(Math.max(0, pageOffset - PAGE_SIZE))}
              onNext={() => setPageOffset(pageOffset + PAGE_SIZE)}
            />
          </WorklistFooter>
          {items.length === 0 ? (
            <WorklistStatePanel
              title={
                statusFilter || search.trim()
                  ? 'Nenhuma ordem de serviço corresponde aos filtros aplicados.'
                  : 'Nenhuma ordem de serviço no seu escopo.'
              }
              description={
                statusFilter || search.trim()
                  ? 'Ajuste a situação ou o termo de busca, ou limpe os filtros para ver a carteira completa.'
                  : 'As ordens de serviço nascem de solicitações aprovadas ou propostas aceitas; quando a primeira for aberta ela aparece aqui.'
              }
            />
          ) : null}
        </>
      ) : null}

      <DynamicContextDrawer
        open={contextRow !== null}
        title={contextRow ? toDisplayText(contextRow['order_number']) : ''}
        onClose={() => setContextRow(null)}
        crossReferences={contextRow ? crossReferencesFor(contextRow) : []}
      >
        {contextRow ? (
          <button
            type="button"
            className="rounded bg-slate-800 px-3 py-1.5 text-sm text-white"
            onClick={() => void navigate(`/app/service-orders/${contextRow.id}`)}
          >
            Abrir ordem
          </button>
        ) : null}
      </DynamicContextDrawer>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        destinations={DEFAULT_DESTINATIONS}
        actions={paletteActions}
        onNavigate={(path) => void navigate(path)}
      />
    </div>
  );
}

/** Rótulo humano de um estado, resolvido a partir do metadado. */
function resolveStateLabel(schema: MetaEntitySchema, state: string): string {
  const statusField = schema.fields.find(
    (field) => field.name === schema.workflow?.stateField,
  );
  const option = statusField?.options?.options?.find((candidate) => candidate.value === state);
  return option?.label ?? state;
}

export type { ServiceOrderEngineRow };
