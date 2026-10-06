import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DateTime, EmptyState, Money } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  BulkActionBar,
  BusinessChain,
  ContextDrawer,
  DrilldownMetric,
  DrilldownRow,
  SavedViewsBar,
  exportSelectionToCsv,
  useSelection,
  useSmartList,
  type ChainLink,
  type ContextPreviewBody,
} from '../../operator';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import {
  WorklistHeader,
  worklistGroupClass,
} from '../../ui/enterprise-list';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import { DynamicList, useEntitySchema } from '../../engine';
import {
  DynamicFilterBuilder,
  emptyFilterGroup,
  isFilterGroupActive,
  matchesFilterGroup,
  type FilterGroup,
} from '../../engine/DynamicFilterBuilder';
import { listReceivables, type FinanceTitlePage } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { RECEIVABLES_ALLOWED_FILTERS, RECEIVABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import { receivableEngineRow } from '../utils/finance-engine-rows';
import type { ReceivableDetail } from '../types/finance.types';

const SCOPE = 'finance.receivables';

/**
 * CONTAS A RECEBER — MESA DE TRABALHO, renderizada pela engine.
 *
 * A tabela, os cabeçalhos e os rótulos de status deixaram de ser JSX artesanal: as colunas vêm da
 * view `list` de `/api/v1/meta/receivables`. Todos os números continuam vindo do payload já
 * autorizado — a tela não recalcula título, saldo nem aging.
 *
 * PARIDADE COM A VERSÃO ARTESANAL (cada feature do arquivo antigo → onde vive agora):
 *   - tabela de títulos (Título/Vencimento/Status/Principal/Saldo) → view `list` + `renderCell`
 *     para as células tipadas (moeda, data, badge);
 *   - ordenação por título/vencimento/status/principal/saldo → `useSmartList` + sortAccessors;
 *   - indicadores Vencidos/A vencer/Recebidos/Carteira em aberto → `DrilldownRow`, PRESERVADOS;
 *   - filtro de status em uma linha → PRESERVADO (segue indo ao SERVIDOR);
 *   - visões salvas (aplicar/salvar/renomear/remover) → `SavedViewsBar`, PRESERVADO;
 *   - CADEIA COMERCIAL do título → `BusinessChain` na prévia, PRESERVADA (só esta tela a tem);
 *   - barra de ações em lote (exportar CSV, abrir registro) + nota PARK → `BulkActionBar`;
 *   - seleção múltipla por linha → `DynamicList` + `useSelection`;
 *   - prévia lateral → `ContextDrawer` + `buildReceivablePreview`, PRESERVADO;
 *   - paginação server-side com faixa, totais e "atualizando…" → `ModulePagination`;
 *   - estados carteira-vazia vs. vazio-na-visão → PRESERVADOS, com o mesmo texto;
 *   - link da linha para o detalhe → `onRowClick`, PRESERVADO.
 *
 * PARIDADE_PERDIDA: nenhuma.
 *
 * Bulk aqui é deliberadamente limitado: exportar selecionados e abrir registro. Liquidar, baixar,
 * cancelar ou reconciliar em massa estão PARK — exigem prova de segregação de funções e
 * idempotência por título. A nota foi preservada literalmente.
 */
export function ReceivablesListPage() {
  const navigate = useNavigate();
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /**
   * O drawer só abre por intenção explícita ("Prévia"). A seleção automática do primeiro título
   * alimenta o painel de contexto INLINE (coluna ao lado), sem cobrir a fila na entrada.
   */
  const [drawerOpen, setDrawerOpen] = useState(false);
  /** Árvore do construtor visual de filtros. Estado da TELA — `useSmartList` não a comporta. */
  const [filterGroup, setFilterGroup] = useState<FilterGroup>(() => emptyFilterGroup());
  const { schema } = useEntitySchema('receivables');

  /*
   * PAGINACAO SERVER-SIDE. A tela pede UMA pagina ao servidor; `limit`/`offset` vao na consulta e
   * `total`/`totalPages` voltam contados sob o MESMO escopo e filtro. O filtro de status continua
   * dirigido pela URL pelo smart list, mas é enviado ao servidor — o recorte é do servidor, não uma
   * máscara sobre a pagina recebida.
   */
  const offset = (pageNumber - 1) * BACKOFFICE_TABLE_PAGE_SIZE;
  const [statusForQuery, setStatusForQuery] = useState('');
  const loader = useCallback(
    (signal?: AbortSignal) =>
      listReceivables(
        {
          limit: BACKOFFICE_TABLE_PAGE_SIZE,
          offset,
          status: statusForQuery || undefined,
          sortBy: 'due_date',
          sortDir: 'asc',
        },
        signal,
      ),
    [offset, statusForQuery],
  );
  const { state, reload, refreshing } = useBackofficeQuery<FinanceTitlePage<ReceivableDetail>>({
    loader,
    mapError: mapFinanceErrorToMessage,
  });

  const sortAccessors = useMemo(
    () => ({
      externalReference: (row: ReceivableDetail) => row.externalReference ?? row.id,
      dueDate: (row: ReceivableDetail) => new Date(row.dueDate).getTime(),
      status: (row: ReceivableDetail) => row.status,
      principal: (row: ReceivableDetail) => Number(row.principal),
      remainingBalance: (row: ReceivableDetail) => Number(row.remainingBalance),
    }),
    [],
  );

  const smartList = useSmartList<ReceivableDetail>({
    scope: SCOPE,
    builtInViews: RECEIVABLES_BUILT_IN_VIEWS,
    allowedFilters: RECEIVABLES_ALLOWED_FILTERS,
    urlSync: true,
    initialSort: { key: 'dueDate', direction: 'asc' },
    sortAccessors,
  });

  const selection = useSelection<ReceivableDetail>({ getId: (row) => row.id });

  /*
   * O recorte de status vai ao SERVIDOR: mudar o filtro reinicia a paginacao e recarrega. Este
   * efeito fica ANTES de qualquer retorno antecipado — hooks nao podem ser chamados
   * condicionalmente, e o gate de carregamento/negacao retorna cedo.
   */
  const statusFilter = smartList.filters.status ?? '';
  useEffect(() => {
    setPageNumber(1);
    setStatusForQuery(statusFilter);
  }, [statusFilter]);

  const readyItems = state.phase === 'ready' ? state.data.items : [];
  /*
   * SELEÇÃO EFETIVA — derivada, sem effect nem setState automático.
   *
   * A seleção explícita (`previewId`) prevalece enquanto ainda está no recorte; quando o item
   * selecionado deixa de existir no recorte, o primeiro item assume o contexto — sem loop, sem
   * sincronização redundante. Fila vazia = nenhum selecionado.
   */
  const effectiveSelectedId = previewId && readyItems.some((item) => item.id === previewId)
    ? previewId
    : readyItems[0]?.id ?? null;

  const gate = renderQueryGate(
    'Contas a receber',
    'Carregando contas a receber…',
    'Você não tem permissão para listar contas a receber.',
    state,
    () => void reload(),
  );
  if (gate) {
    return gate;
  }
  if (state.phase !== 'ready') {
    return null;
  }

  const page = state.data;
  const pageItems = page.items;
  const pageCount = Math.max(1, page.totalPages);
  const safePageNumber = Math.min(pageNumber, pageCount);

  // Contadores reais — derivados do payload carregado, nunca estimados.
  const inFlight = pageItems.filter((item) => !['PAID', 'CANCELLED'].includes(item.status));
  const overdue = inFlight.filter((item) => item.status === 'OVERDUE');
  const notOverdue = inFlight.filter((item) => item.status !== 'OVERDUE');
  const overdueTotal = overdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);
  const openTotal = notOverdue.reduce((sum, item) => sum + Number(item.remainingBalance), 0);

  /*
   * RECORTE DO CONSTRUTOR VISUAL — árvore AND/OR sobre os títulos da página. O caminho oficial de
   * recorte continua sendo `status` na consulta ao servidor; a árvore é o recorte COMPOSTO que o
   * endpoint não aceita como parâmetro.
   */
  const byBuilder = isFilterGroupActive(filterGroup)
    ? pageItems.filter((item) => matchesFilterGroup(filterGroup, receivableEngineRow(item)))
    : pageItems;

  const rows = byBuilder.map(receivableEngineRow);
  const selectedRows = selection.selectedRows(pageItems);
  const previewRow = pageItems.find((item) => item.id === effectiveSelectedId) ?? null;

  /**
   * CARTEIRA VAZIA — `200 + items=[]` e EMPTY DATA, nao negacao de acesso.
   *
   * O estado vazio e um ESTADO DA WORKLIST, nunca uma segunda estrutura de pagina. Um retorno
   * antecipado aqui apagaria a barra de filtros, as visoes salvas, os indicadores de drill-down, a
   * barra de acoes em lote e a paginacao — o operador ficaria sem os controles justamente quando
   * precisa deles para ENTENDER o recorte.
   *
   * `page.total` conta o recorte ATIVO; por isso o painel distingue "carteira sem titulos" de
   * "nada nesta visao" — o segundo caso ja tem o proprio estado humano dentro da tabela.
   */
  const portfolioEmpty = page.total === 0 && !smartList.isFiltered && statusForQuery === '';

  return (
    <ModulePage layout="workspace">
      {/*
        CABEÇALHO DE WORKLIST — a mesma gramática do workspace financeiro e das demais worklists
        do CISNE: identidade, contagem REAL do recorte (contada no servidor) e a leitura de
        procedência em uma linha. Antes era um `<header>` artesanal com o subtítulo explicativo
        que a baliza de ERP proíbe ("o operador lê número e estado, não manual").
      */}
      <WorklistHeader
        title="Contas a receber"
        count={page.total}
        context="Saldos, vencimentos e situação são os publicados pelo servidor. Nenhum título é recalculado nesta tela."
      />

      {/* DRILL-DOWN: todo indicador abre a lista filtrada que o originou. */}
      <DrilldownRow>
        <DrilldownMetric
          label="Vencidos"
          value={overdue.length}
          hint={`${formatCurrency(overdueTotal)} · ver lista filtrada`}
          tone={overdue.length > 0 ? 'critical' : 'neutral'}
          to="/app/finance/receivables?status=OVERDUE"
        />
        <DrilldownMetric
          label="A vencer"
          value={notOverdue.length}
          hint={`${formatCurrency(openTotal)} · ver lista filtrada`}
          tone="info"
          to="/app/finance/receivables?status=OPEN"
        />
        <DrilldownMetric
          label="Recebidos"
          value={pageItems.filter((item) => item.status === 'PAID').length}
          hint="ver lista filtrada"
          to="/app/finance/receivables?status=PAID"
        />
        <DrilldownMetric
          label="Carteira em aberto"
          value={inFlight.length}
          hint={`${formatCurrency(overdueTotal + openTotal)} sob acompanhamento`}
          to="/app/finance/receivables"
        />
      </DrilldownRow>

      {/*
        FILTRO VISUAL — o construtor AND/OR aninhável da engine, espelhando o domain de `ir.filters`
        do Odoo.
      */}
      {schema ? (
        <DynamicFilterBuilder schema={schema} value={filterGroup} onChange={setFilterGroup} />
      ) : null}

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          smartList.applyView(view);
          setPageNumber(1);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={smartList.isFiltered}
        allLabel="Tudo"
      />

      <BulkActionBar
        count={selection.count}
        visibleCount={byBuilder.length}
        onClear={selection.clear}
        onSelectAllVisible={() => selection.selectAll(pageItems)}
        parkedNote="Liquidação, baixa, cancelamento e reconciliação em lote continuam PARK: exigem prova de segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
        actions={[
          {
            id: 'export',
            label: 'Exportar selecionados (CSV)',
            run: () =>
              exportSelectionToCsv(
                'contas-a-receber-selecionadas.csv',
                ['Título', 'Vencimento', 'Status', 'Principal', 'Saldo', 'Moeda'],
                selectedRows.map((row) => [
                  row.externalReference ?? row.id,
                  row.dueDate,
                  RECEIVABLE_STATUS_LABELS[row.status] ?? row.status,
                  row.principal,
                  row.remainingBalance,
                  row.currencyCode,
                ]),
              ),
          },
          {
            id: 'preview-single',
            label: 'Abrir registro',
            disabled: selectedRows.length !== 1,
            disabledReason: 'Selecione exatamente um título para abrir a prévia.',
            run: () => {
              const [only] = selectedRows;
              if (only) {
                setPreviewId(only.id);
              }
            },
          },
        ]}
      />

      {/*
        CORPO DA WORKLIST — a tabela e o estado vazio ocupam o MESMO lugar. A pagina em volta
        (cabecalho, indicadores, filtros, visoes salvas, paginacao) e sempre a mesma.

        O painel de estado vazio e reservado para CARTEIRA VAZIA (nada existe) e para o recorte do
        smart list (que ja tem texto proprio). Quando e o CONSTRUTOR VISUAL que zera o conjunto, a
        TABELA CONTINUA MONTADA e mostra a mensagem dentro do proprio grid — apagar a tabela ali
        tiraria do operador a coluna que ele acabou de filtrar, e ele perderia a referencia do que
        esta recortando. E o comportamento de grid do Odoo/ERPNext: o filtro sem resultado mostra
        "nenhum registro" NA grade, nunca troca a grade por outra tela.
      */}
      {portfolioEmpty ? (
        <div className="rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
          <EmptyState
            title="Nenhum título a receber registrado."
            description="Os títulos nascem do faturamento: quando um documento é emitido, ele aparece aqui com vencimento, saldo e situação. Nada foi somado nem estimado nesta tela."
          />
          <Link
            to="/app/billing"
            className="mt-3 inline-block text-xs font-semibold text-brand-700 no-underline"
          >
            Ver faturamento
          </Link>
        </div>
      ) : byBuilder.length === 0 && smartList.isFiltered && !isFilterGroupActive(filterGroup) ? (
        <EmptyState
          title="Nenhum título nesta visão"
          description="Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver toda a carteira."
        />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
            <div className="min-w-0">
              <DynamicList
                schema={schema}
                rows={rows}
                emptyMessage="Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver toda a carteira."
                selectedIds={selection.selectedIds}
                /*
                 * RECONCILIAÇÃO com a API existente do `useSelection`, que expõe `toggle`/`clear`/
                 * `selectAll` — não um "defina esta lista". Reconciliar por diferença evita alterar
                 * `useSelection` (fora do escopo desta migração) e preserva o teto de seleção que só
                 * o hook conhece.
                 */
                onSelectionChange={(ids) => {
                  const next = new Set(ids);
                  if (next.size === 0) {
                    selection.clear();
                    return;
                  }
                  for (const row of rows) {
                    const id = String(row.id);
                    if (next.has(id) !== selection.isSelected(id)) {
                      selection.toggle(id);
                    }
                  }
                }}
                onRowClick={(row) => {
                  void navigate(`/app/finance/receivables/${row.id}`);
                }}
                renderRowActions={(row) => (
                  <button
                    type="button"
                    className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                    onClick={() => {
                      setPreviewId(String(row.id));
                      setDrawerOpen(true);
                    }}
                    aria-label={`Prévia de ${text(row['external_reference'])}`}
                  >
                    Prévia
                  </button>
                )}
                showTotals
                /* Células tipadas: a engine reserva a coluna, a TELA decide o controle. */
                renderCell={(field, row) => {
                  const currency = text(row['currency_code']);
                  if (field.name === 'lifecycle') {
                    return (
                      <FinanceStatusBadge
                        status={text(row['lifecycle'])}
                        labels={RECEIVABLE_STATUS_LABELS}
                      />
                    );
                  }
                  if (field.name === 'due_date') {
                    return <DateTime value={text(row['due_date'])} mode="date" />;
                  }
                  if (field.name === 'principal') {
                    return <Money value={text(row['principal'])} currencyCode={currency} />;
                  }
                  /*
                   * CLIENTE — o DTO publica apenas `clientId` (UUID). A célula não exibe o
                   * identificador cru nem inventa nome: declara o estado honesto e mantém o
                   * drilldown real para o cadastro, quando a rota existe.
                   */
                  if (field.name === 'client_id') {
                    const clientId = text(row['client_id']);
                    return clientId ? (
                      <span className="inline-flex items-center gap-1.5">
                        <span className="text-xs text-gray-500">Cliente não publicado</span>
                        <Link
                          to={`/app/clients/${clientId}`}
                          className="text-xs font-medium text-brand-700 no-underline hover:text-brand-800"
                        >
                          Abrir cliente
                        </Link>
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400">—</span>
                    );
                  }
                  return undefined;
                }}
              />

              <div className={`mt-3 flex items-center justify-between text-xs text-gray-500 ${worklistGroupClass}`}>
                <span aria-live="polite">
                  Página {safePageNumber} de {pageCount} · {byBuilder.length}{' '}
                  {byBuilder.length === 1 ? 'título' : 'títulos'} no recorte atual
                  {statusFilter
                    ? ` · status: ${RECEIVABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
                    : ''}
                  {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
                  {refreshing ? ' · atualizando…' : ''}
                </span>
                <ModulePagination
                  pageNumber={safePageNumber}
                  onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
                  onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
                  previousDisabled={safePageNumber <= 1}
                  nextDisabled={safePageNumber >= pageCount}
                />
              </div>
            </div>

            {/*
              CONTEXTO AO LADO — a cadeia comercial do título selecionado fica ao lado da fila no
              desktop (antes era um bloco abaixo, empurrado para fora da dobra). A seleção na fila
              atualiza este painel sem navegação.
            */}
            {previewRow ? (
              <aside
                className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-900/5 lg:sticky lg:top-4 lg:self-start"
                aria-label="Contexto do título selecionado"
              >
                <header className="border-b border-gray-100 pb-3">
                  <p className="text-sm font-semibold text-gray-900">
                    {previewRow.externalReference ?? 'Recebível'}
                  </p>
                  <div className="mt-1.5">
                    <FinanceStatusBadge
                      status={previewRow.status}
                      labels={RECEIVABLE_STATUS_LABELS}
                    />
                  </div>
                </header>
                <dl className="my-3 grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-x-3 gap-y-2">
                  <dt className="text-xs text-gray-500">Cliente</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    <span className="text-gray-500">Cliente não publicado · </span>
                    <Link
                      to={`/app/clients/${previewRow.clientId}`}
                      className="text-brand-700 no-underline hover:text-brand-800"
                    >
                      Abrir cliente
                    </Link>
                  </dd>
                  <dt className="text-xs text-gray-500">Valor original</dt>
                  <dd className="m-0 text-[13px] text-gray-800 tabular-nums">
                    <Money value={previewRow.principal} currencyCode={previewRow.currencyCode} />
                  </dd>
                  <dt className="text-xs text-gray-500">Saldo</dt>
                  <dd className="m-0 text-[13px] font-semibold text-gray-900 tabular-nums">
                    <Money value={previewRow.remainingBalance} currencyCode={previewRow.currencyCode} emphasis />
                  </dd>
                  <dt className="text-xs text-gray-500">Vencimento</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    <DateTime value={previewRow.dueDate} mode="date" />
                  </dd>
                  <dt className="text-xs text-gray-500">Recebimentos</dt>
                  <dd className="m-0 text-[13px] text-gray-800 tabular-nums">
                    {previewRow.settlements.length}
                  </dd>
                  <dt className="text-xs text-gray-500">Origem</dt>
                  <dd className="m-0 text-[13px] text-gray-800">
                    {formatOriginKind(previewRow.origin.kind)}
                  </dd>
                </dl>
                <div className="border-t border-gray-100 pt-3">
                  <ReceivableChain row={previewRow} />
                </div>
              </aside>
            ) : null}
          </div>
        </>
      )}

      <ContextDrawer
        open={drawerOpen && previewRow !== null}
        title="Contexto do título"
        preview={previewRow ? buildReceivablePreview(previewRow) : null}
        onClose={() => setDrawerOpen(false)}
      />
    </ModulePage>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

/** Origem humana do recebível — apresentação, não domínio (o token persiste intacto). */
const RECEIVABLE_ORIGIN_LABELS: Record<string, string> = {
  BILLING_DOCUMENT: 'Nota de Fatura',
  BILLING_RECORD: 'Faturamento',
  SERVICE_ORDER: 'Ordem de serviço',
  MEASUREMENT: 'Medição',
};

function formatOriginKind(kind: string): string {
  return RECEIVABLE_ORIGIN_LABELS[kind] ?? (kind || '—');
}

/**
 * Valor de célula como texto, nunca `String(valor)` direto.
 *
 * `String(undefined)` produziria a string `"undefined"` na tela — um dado que parece dado e não é.
 */
function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * Cadeia empresarial montada SOMENTE com vínculos que já existem no payload
 * (`origin.serviceOrderId`, `origin.measurementId`, `clientId`). Nenhum degrau é afirmado sem
 * lastro: se um id não vier, o degrau não aparece.
 */
export function receivableChainLinks(row: ReceivableDetail): ChainLink[] {
  const origin = row.origin;
  const links: ChainLink[] = [];
  if (row.clientId) {
    links.push({ step: 'CLIENTE', label: 'Cliente', href: `/app/clients/${row.clientId}` });
  }
  if (origin.serviceOrderId) {
    links.push({
      step: 'OS',
      label: 'Ordem de serviço',
      // A OS nao tem rota raiz publicada: o ponto de entrada real e o planejamento, que e a
      // object page mae do dominio. Sem o sufixo o link nao resolvia rota.
      href: `/app/service-orders/${origin.serviceOrderId}/planning`,
    });
  }
  if (origin.measurementId) {
    links.push({
      step: 'MEDICAO',
      label: 'Medição',
      href: `/app/service-orders/${origin.serviceOrderId}/measurement`,
    });
  }
  if (origin.billingRecordId) {
    links.push({
      step: 'FATURAMENTO',
      label: 'Faturamento',
      href: `/app/service-orders/${origin.serviceOrderId}/billing`,
    });
  }
  links.push({ step: 'RECEBIVEL', label: row.externalReference ?? 'Recebível' });
  return links;
}

/** Cadeia exibida onde o vínculo já está disponível. Feature exclusiva desta tela. */
export function ReceivableChain({ row }: { row: ReceivableDetail }) {
  return <BusinessChain current="RECEBIVEL" links={receivableChainLinks(row)} />;
}

/**
 * Prévia lateral montada SOMENTE com o payload já recebido pela lista.
 * Se o detalhe completo exigisse API nova, aqui não faríamos: oferecemos o atalho.
 */
export function buildReceivablePreview(row: ReceivableDetail): ContextPreviewBody {
  const origin = row.origin;

  return {
    identifier: row.externalReference ?? row.id,
    subtitle: `Origem: ${origin.kind}`,
    status: <FinanceStatusBadge status={row.status} labels={RECEIVABLE_STATUS_LABELS} />,
    facts: [
      { label: 'Vencimento', value: <DateTime value={row.dueDate} mode="date" /> },
      { label: 'Principal', value: <Money value={row.principal} currencyCode={row.currencyCode} /> },
      {
        label: 'Saldo',
        value: <Money value={row.remainingBalance} currencyCode={row.currencyCode} emphasis />,
        emphasis: true,
      },
      { label: 'Recebido', value: <Money value={row.settledAmount} currencyCode={row.currencyCode} /> },
      { label: 'Parcelas', value: String(row.installments.length) },
      { label: 'Liquidações', value: String(row.settlements.length) },
      { label: 'Condição de pagamento', value: row.paymentTerms },
      { label: 'Criado em', value: <DateTime value={row.createdAt} mode="datetime" /> },
      { label: 'Atualizado em', value: <DateTime value={row.updatedAt} mode="datetime" /> },
    ],
    relations: [
      /*
       * Relacao sem rotulo humano NAO exibe o identificador tecnico: o vinculo existe (e navega,
       * quando ha destino real), mas o valor mostrado e o nome do objeto.
       */
      { label: 'Cliente', value: 'Abrir cadastro do cliente', href: `/app/clients/${row.clientId}` },
      {
        label: 'Ordem de serviço',
        value: 'Abrir planejamento da ordem',
        href: `/app/service-orders/${origin.serviceOrderId}/planning`,
      },
      {
        label: 'Documento de faturamento',
        value: origin.billingRecordId ? 'Gerado pelo faturamento' : '',
      },
    ],
    nextAction: {
      label:
        row.status === 'OVERDUE'
          ? 'Abrir o título e tratar a cobrança'
          : 'Abrir o título para registrar recebimento',
      href: `/app/finance/receivables/${row.id}`,
    },
    detailHref: `/app/finance/receivables/${row.id}`,
    detailLabel: 'Abrir título completo',
  };
}
