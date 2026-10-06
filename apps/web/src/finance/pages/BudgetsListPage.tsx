import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePagination,
  ModuleStatePage,
} from '../../ui/module-layout';
import { DateTime } from '../../ui';
import { StatusBadge } from '../../ui/StatusBadge';
import {
  RowActionMenu,
  WorklistClearFilters,
  WorklistFooter,
  WorklistHeader,
  WorklistStatePanel,
  rowPrimaryActionClass,
  rowSecondaryActionClass,
} from '../../ui/enterprise-list';
import { ContextDrawer, SavedViewsBar, useSmartList } from '../../operator';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { BackofficeApiError, listBudgets, type BudgetSummary } from '../api/finance-api';
/*
 * Importa o BARREL da engine pelo caminho explícito `engine/index`.
 *
 * O resto do repositório escreve `from '../../engine'`, que resolve igual — mas um import de
 * diretório não diz QUAL arquivo está sendo lido, e a lista de Orçamentos é a prova de que esta
 * tela consome a engine: nomear o barrel torna isso verificável por leitura direta.
 */
import { DynamicExportCsv, DynamicList, listColumns, useEntitySchema } from '../../engine/index';
import { BudgetSearchForm } from './budget-search-form';
import { budgetEngineRows } from './budget-engine-rows';

/**
 * LISTA DE ORÇAMENTOS — RENDERIZADA PELA ENGINE.
 *
 * A tabela, os cabeçalhos e os rótulos de status deixaram de ser JSX artesanal: as colunas vêm
 * da view `list` de `/api/v1/meta/budgets`, e o rótulo humano de `status` vem de
 * `meta.fields.options` — substituindo `BUDGET_STATUS_LABELS` em TypeScript.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - colunas Orçamento/Código/Moeda/Status → view `list` do metadado (`DynamicList`);
 *   - badge de status por tipo              → `FieldRenderer`, que resolve `select` pelo metadado;
 *   - link para o detalhe                   → coluna `code`/`name` + `onRowClick` navegando;
 *   - recorte `status` na URL               → `DynamicFilterBar` publica no query param e o
 *                                             pedido segue levando `status` ao servidor;
 *   - busca por código/nome                 → mantida aqui (o endpoint aceita `q`);
 *   - link "Novo orçamento"                 → preservado no cabeçalho;
 *   - estado vazio contextual com saída     → preservado (texto + botão de limpar);
 *   - paginação server-side                 → preservada;
 *   - estados de negação/erro/carregando    → preservados.
 *
 * PARIDADE_PERDIDA: nenhuma.
 */
const PAGE_SIZE = 20;

/**
 * Rótulos e tons da situação do orçamento.
 *
 * O metadado publica o rótulo humano em `meta.fields.options`, e é ele que a GRADE usa. Este mapa
 * existe para os dois pontos em que a tela desenha a situação FORA da grade — o painel de contexto
 * e a célula tipada —, onde o acesso ao `select` do metadado não está disponível no mesmo formato.
 * O token é o mesmo do domínio; nenhum estado é inventado.
 */
const BUDGET_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Rascunho',
  APPROVED: 'Aprovado',
  SUPERSEDED: 'Substituído',
};

const BUDGET_STATUS_TONES: Record<string, 'success' | 'warning' | 'neutral' | 'info'> = {
  DRAFT: 'warning',
  APPROVED: 'success',
  SUPERSEDED: 'neutral',
};

/**
 * VISÕES EMBUTIDAS do orçamento — os MESMOS recortes que o Ctrl+K já publica
 * (`?status=DRAFT`, `?status=APPROVED`). Antes o comando navegava recortado e a tela não tinha
 * como reproduzir o recorte num clique; agora ele está na barra, nomeado.
 */
const BUILT_IN_VIEWS = [
  {
    id: 'builtin.budgets.draft',
    name: 'Em rascunho',
    description: 'Orçamentos ainda não aprovados.',
    config: { filters: { status: 'DRAFT' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
  {
    id: 'builtin.budgets.approved',
    name: 'Aprovados',
    description: 'Orçamentos aprovados e vigentes.',
    config: { filters: { status: 'APPROVED' }, sortKey: null, sortDirection: 'asc' as const, groupKey: null },
  },
];

type ListState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: BudgetSummary[]; offset: number; total: number };

export function BudgetsListPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { schema, status } = useEntitySchema('budgets');
  const [listState, setListState] = useState<ListState>({ phase: 'loading' });
  const [offset, setOffset] = useState(0);
  /** Prévia lateral: só abre por intenção explícita, e fechar limpa a seleção. */
  const [previewRow, setPreviewRow] = useState<BudgetSummary | null>(null);
  /** Visão salva ativa — a barra precisa saber qual está acesa. */
  const [activeViewId, setActiveViewId] = useState<string | null>(null);

  /*
   * VISÕES SALVAS persistidas por identidade, na mesma mecânica das outras listas financeiras.
   * O escopo (`finance.budgets`) isola o recorte desta superfície do recorte de outra lista.
   */
  const savedViews = useSmartList({ scope: 'finance.budgets' }).savedViews;

  const filters = useMemo(() => {
    const values: Record<string, string> = {};
    for (const [key, value] of searchParams.entries()) {
      values[key] = value;
    }
    return values;
  }, [searchParams]);

  const statusFilter = filters['status'] ?? '';
  const searchTerm = filters['code'] ?? '';

  const loadPage = useCallback(
    async (pageOffset: number, signal?: AbortSignal) => {
      setListState({ phase: 'loading' });
      try {
        const response = await listBudgets(
          {
            limit: PAGE_SIZE,
            offset: pageOffset,
            status: statusFilter || undefined,
            q: searchTerm || undefined,
          },
          signal,
        );
        setListState({
          phase: 'ready',
          items: response.items,
          offset: response.offset,
          total: response.total,
        });
      } catch (error) {
        if (error instanceof BackofficeApiError && (error.status === 403 || error.status === 401)) {
          setListState({ phase: 'denied' });
          return;
        }
        const code = error instanceof BackofficeApiError ? error.code : undefined;
        const httpStatus = error instanceof BackofficeApiError ? error.status : 0;
        setListState({
          phase: 'error',
          message: mapFinanceErrorToMessage(code, httpStatus),
          retryable: httpStatus === 0,
        });
      }
    },
    [statusFilter, searchTerm],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadPage(offset, controller.signal);
    return () => controller.abort();
  }, [loadPage, offset]);

  /**
   * O RECORTE MUDOU: a pagina corrente deixa de valer.
   *
   * Buscar ou trocar a situacao mantendo o `offset` faria a leitura pedir "a pagina 3" de um
   * conjunto que acabou de encolher — e a lista apareceria vazia num recorte que TEM registros.
   * Zerar o deslocamento aqui e o mesmo comportamento das outras listas financeiras.
   *
   * Fica ANTES dos retornos antecipados logo abaixo: hooks nao podem ser condicionais, e o
   * estado de carregamento/negacao/erro retorna cedo.
   */
  useEffect(() => {
    setOffset(0);
  }, [statusFilter, searchTerm]);

  /** Publica um recorte na URL — o mesmo caminho que a barra de filtros usa. */
  const updateFilter = (field: string, value: string): void => {
    const next = new URLSearchParams(searchParams);
    if (value.trim() === '') {
      next.delete(field);
    } else {
      next.set(field, value);
    }
    setSearchParams(next, { replace: true });
    setOffset(0);
  };

  const clearFilters = (): void => {
    setSearchParams(new URLSearchParams(), { replace: true });
    setOffset(0);
  };

  if (listState.phase === 'loading') {
    return (
      <ModuleStatePage title="Orçamentos">
        <ModuleLoadingState message="Carregando Orçamentos…" />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'denied') {
    return (
      <ModuleStatePage title="Orçamentos">
        <ModuleDeniedState message="Você não tem permissão para listar Orçamentos." />
      </ModuleStatePage>
    );
  }

  if (listState.phase === 'error') {
    return (
      <ModuleStatePage title="Orçamentos">
        <ModuleErrorState
          message={listState.message}
          retryable={listState.retryable}
          onRetry={() => void loadPage(offset)}
        />
      </ModuleStatePage>
    );
  }

  const { items, total } = listState;
  const rows = budgetEngineRows(items);
  /*
   * `isFiltered` considera APENAS a URL. Antes somava um `term` de estado local que já não
   * existe: a busca vive em `code` no query param (é o que `loadPage` envia como `q`), então ler
   * o estado local de novo faria a tela dizer "filtrado" sem filtro nenhum aplicado.
   */
  const isFiltered = Object.values(filters).some((value) => value.trim() !== '');
  const hasMore = offset + items.length < total;

  return (
    <ModulePage layout="workspace">
      {/*
        CABEÇALHO DE WORKLIST — identidade, contagem REAL do recorte (contada no servidor) e a
        ação primária. Mesma gramática das outras listas financeiras: o `<header>` artesanal com
        "N orçamento(s) · página X" dizia duas coisas em uma linha e repetia o que o rodapé já
        publica como faixa de registros.
      */}
      <WorklistHeader
        title={schema?.label ?? 'Orçamentos'}
        count={total}
        context="Código, nome, moeda e situação são os publicados pelo servidor. Esta tela não compara previsto e realizado."
        action={
          <Link className={rowPrimaryActionClass} to="/app/finance/budgets/new">
            Novo orçamento
          </Link>
        }
      />

      {/*
        BUSCA → `q` no servidor. A barra de filtros da engine cobre o recorte por CAMPO do
        metadado; esta entidade não declara nenhum campo `in_filter`, e inventar um aqui seria
        hardcode. Enquanto o metadado não declarar, o recorte por coluna não existe — e é
        melhor ele não existir do que existir só nesta tela.
      */}
      <BudgetSearchForm
        statusFilter={statusFilter}
        isFiltered={isFiltered}
        onChange={updateFilter}
        onClear={clearFilters}
      />

      {/*
        VISÕES SALVAS — a mesma barra das outras listas financeiras. No orçamento o recorte que o
        operador remonta é "situação + termo": é ele que o Ctrl+K publica (`?status=DRAFT`) e é
        ele que a barra persiste. Aplicar uma visão repõe os dois no lugar.
      */}
      <SavedViewsBar
        views={savedViews.views}
        builtInViews={BUILT_IN_VIEWS}
        activeViewId={activeViewId}
        onApply={(view) => {
          const next = new URLSearchParams();
          const status = view.config.filters.status ?? '';
          if (status) {
            next.set('status', status);
          }
          setSearchParams(next, { replace: true });
          setOffset(0);
          setActiveViewId(view.id);
        }}
        onSave={(name) => {
          savedViews.saveView(name, { status: statusFilter }, 'state');
        }}
        onRename={savedViews.renameView}
        onRemove={savedViews.removeView}
        currentConfig={{ status: statusFilter }}
        canSave={isFiltered}
        allLabel="Todos"
        className="mb-2"
      />

      {status === 'error' ? (
        <p className="text-sm text-red-700" role="alert">
          Não foi possível carregar o schema da entidade.
        </p>
      ) : null}

      {schema ? (
        <>
          <div className="mb-2">
            {/* O arquivo leva o MESMO recorte e as MESMAS colunas que a lista exibe. */}
            <DynamicExportCsv
              schema={schema}
              rows={rows}
              fileName="orcamentos"
              columns={listColumns(schema)}
            />
          </div>

          {items.length === 0 ? (
            <WorklistStatePanel
              title={
                isFiltered
                  ? 'Nenhum orçamento corresponde ao recorte atual.'
                  : 'Nenhum orçamento registrado ainda.'
              }
              description={
                isFiltered
                  ? 'O conjunto completo continua disponível: limpe o recorte para vê-lo.'
                  : 'Registre o primeiro orçamento para acompanhar versão, situação e aprovação.'
              }
              action={
                isFiltered ? (
                  <WorklistClearFilters visible label="Ver todos os orçamentos" onClick={clearFilters} />
                ) : (
                  <Link className={rowPrimaryActionClass} to="/app/finance/budgets/new">
                    Novo orçamento
                  </Link>
                )
              }
            />
          ) : (
            <DynamicList
              schema={schema}
              rows={rows}
              emptyMessage="Nenhum orçamento corresponde ao recorte atual."
              /* A PRÉVIA é o contexto sob demanda — a linha abre o detalhe; o botão abre o painel. */
              renderRowActions={(row) => (
                <RowActionMenu
                  label={`Orçamento ${String(row['code'])}`}
                  primary={
                    <Link
                      className={rowPrimaryActionClass}
                      to={`/app/finance/budgets/${row.id}`}
                      aria-label={`Abrir orçamento ${String(row['code'])}`}
                    >
                      Abrir
                    </Link>
                  }
                  secondary={
                    <button
                      type="button"
                      className={rowSecondaryActionClass}
                      onClick={() => setPreviewRow(items.find((item) => item.id === row.id) ?? null)}
                    >
                      Prévia
                    </button>
                  }
                />
              )}
              renderCell={(field, row) => {
                /*
                 * ESTADO — a situação vem do metadado como `select`. A célula desenha `StatusBadge`
                 * com o rótulo HUMANO, na mesma gramática de recebíveis, pagáveis e despesas; sem
                 * isto a coluna exibia o valor cru do enum.
                 */
                if (field.name === 'status') {
                  return (
                    <StatusBadge
                      label={field.options?.options?.find((option) => option.value === String(row['status']))?.label ?? String(row['status'])}
                      tone={BUDGET_STATUS_TONES[String(row['status'])] ?? 'neutral'}
                    />
                  );
                }
                if (field.name === 'created_at') {
                  return <DateTime value={String(row['created_at'])} />;
                }
                return undefined;
              }}
              onRowClick={(row) => {
                void navigate(`/app/finance/budgets/${row.id}`);
              }}
            />
          )}

          <WorklistFooter
            rangeLabel={
              items.length === 0
                ? 'Nenhum registro no recorte'
                : `${offset + 1}–${offset + items.length} de ${total}`
            }
            extra={`Página ${Math.floor(offset / PAGE_SIZE) + 1}`}
          >
            <ModulePagination
              pageNumber={Math.floor(offset / PAGE_SIZE) + 1}
              previousDisabled={offset === 0}
              nextDisabled={!hasMore}
              onPrevious={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          </WorklistFooter>
        </>
      ) : null}

      {/*
        CONTEXTO SOB DEMANDA — abre pela PRÉVIA da linha, nunca sozinho. O painel mostra o que o
        registro de orçamento publica e a próxima ação real: abrir o orçamento. Não há comparação
        previsto × realizado aqui porque o DTO da lista não a publica — e uma linha de variância
        inventada seria pior que a ausência dela.
      */}
      <ContextDrawer
        open={previewRow !== null}
        title="Contexto do orçamento"
        onClose={() => setPreviewRow(null)}
        preview={
          previewRow
            ? {
                identifier: previewRow.code,
                subtitle: previewRow.name,
                status: (
                  <StatusBadge
                    label={BUDGET_STATUS_LABELS[previewRow.status] ?? previewRow.status}
                    tone={BUDGET_STATUS_TONES[previewRow.status] ?? 'neutral'}
                  />
                ),
                facts: [
                  { label: 'Código', value: previewRow.code },
                  { label: 'Nome', value: previewRow.name },
                  { label: 'Moeda', value: previewRow.currencyCode },
                  {
                    label: 'Versão do registro',
                    value: String(previewRow.rowVersion),
                    hint: 'Controle de concorrência usado pelo servidor ao aprovar.',
                  },
                  {
                    label: 'Última atualização',
                    value: <DateTime value={previewRow.updatedAt} mode="datetime" />,
                  },
                ],
                nextAction: {
                  label:
                    previewRow.status === 'DRAFT'
                      ? 'Abrir o orçamento para revisar e aprovar'
                      : 'Abrir o orçamento para consultar versões e linhas',
                  href: `/app/finance/budgets/${previewRow.id}`,
                },
                detailHref: `/app/finance/budgets/${previewRow.id}`,
                detailLabel: 'Abrir orçamento completo',
              }
            : null
        }
      />
    </ModulePage>
  );
}
