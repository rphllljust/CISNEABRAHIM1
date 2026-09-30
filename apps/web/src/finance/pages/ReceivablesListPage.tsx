import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime, EmptyState, Money, Select } from '../../ui';
import { ModulePage, ModulePagination } from '../../ui/module-layout';
import {
  RecordStatusCell,
  RowActionCell,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistFooter,
  WorklistHeader,
  WorklistRowLink,
  WorklistStatePanel,
  worklistCellClass,
  worklistCellRaisedClass,
  worklistHeadCellClass,
  worklistNumericCellClass,
  worklistNumericHeadCellClass,
  worklistRowClass,
  worklistSelectClass,
  worklistTableCardClass,
  worklistTableClass,
} from '../../ui/enterprise-list';
import { cn } from '../../ui/utils/cn';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { RECEIVABLE_STATUS_LABELS } from '../../financial-ui/labels';
import { BACKOFFICE_TABLE_PAGE_SIZE } from '../../financial-ui/table-slice';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
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
import { listReceivables, type FinanceTitlePage } from '../api/finance-api';
import { mapFinanceErrorToMessage } from '../api/finance-error-messages';
import { FinanceStatusBadge } from '../components/FinanceStatusBadge';
import { RECEIVABLES_ALLOWED_FILTERS, RECEIVABLES_BUILT_IN_VIEWS } from './finance-smart-list';
import type { ReceivableDetail } from '../types/finance.types';

const SCOPE = 'finance.receivables';

/**
 * Contas a receber — MESA DE TRABALHO.
 *
 * Responde o que está pendente, o que está atrasado, o que o operador pode fazer
 * e qual registro precisa dele. Todos os números vêm do payload já autorizado;
 * a tela não recalcula título, saldo nem aging.
 *
 * Bulk aqui é deliberadamente limitado: exportar selecionados e abrir registro.
 * Liquidar, baixar, cancelar ou reconciliar em massa estão PARK — exigem prova de
 * segregação de funções e idempotência por título.
 */
export function ReceivablesListPage() {
  const [pageNumber, setPageNumber] = useState(1);
  const [previewId, setPreviewId] = useState<string | null>(null);
  /*
   * PAGINACAO SERVER-SIDE. A tela pede UMA pagina ao servidor; `limit`/`offset` vao na
   * consulta e `total`/`totalPages` voltam contados sob o MESMO escopo e filtro. Antes a
   * carteira inteira era carregada e fatiada no navegador.
   *
   * O filtro de status continua dirigido pela URL pelo smart list, mas passa a ser enviado
   * ao servidor — o recorte e do servidor, nao uma mascara sobre a pagina recebida.
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
   * O recorte de status vai ao SERVIDOR: mudar o filtro reinicia a paginacao e recarrega.
   * Este efeito fica ANTES de qualquer retorno antecipado — hooks nao podem ser chamados
   * condicionalmente, e o gate de carregamento/negacao retorna cedo.
   */
  const statusFilter = smartList.filters.status ?? '';
  useEffect(() => {
    setPageNumber(1);
    setStatusForQuery(statusFilter);
  }, [statusFilter]);

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

  const selectedRows = selection.selectedRows(pageItems);
  const previewRow = pageItems.find((item) => item.id === previewId) ?? null;

  /**
   * CARTEIRA VAZIA — `200 + items=[]` e EMPTY DATA, nao negacao de acesso.
   *
   * Sem este corte a tela renderizava QUATRO indicadores de drill-down e uma barra de filtros
   * inteira sobre uma carteira sem um unico titulo: "VENCIDOS 0 / R$ 0,00", "A VENCER 0 /
   * R$ 0,00", "RECEBIDOS 0", "CARTEIRA EM ABERTO 0" — nove zeros empilhados antes de qualquer
   * explicacao. O operador via numeros que nao informam nada, num painel que parece quebrado.
   *
   * A leitura e do SERVIDOR (`page.total`), nunca da pagina — MAS `page.total` conta o recorte
   * ATIVO, nao a carteira inteira. Por isso o estado compacto so entra quando NAO HA RECORTE:
   * com filtro ou visao aplicada, lista vazia significa "nada nesta visao", e esse caso ja tem
   * o proprio estado humano (`nenhum titulo nesta visao`), que explica o recorte em vez de
   * fazer a carteira parecer inexistente.
   *
   * Confundir os dois apagava o estado da visao filtrada: a tela inteira era substituida pelo
   * painel de carteira vazia e o operador perdia os filtros e a saida do recorte.
   */
  const portfolioEmpty = page.total === 0 && !smartList.isFiltered && statusForQuery === '';

  if (portfolioEmpty) {
    return (
      <ModulePage>
        <WorklistHeader
          title="Contas a receber"
          count={0}
          context="Saldos e status são os informados pelo servidor. Esta tela não recalcula títulos."
        />
        <WorklistStatePanel
          title="Nenhum título a receber registrado."
          description="Os títulos nascem do faturamento: quando uma medição é aprovada e o documento é emitido, a cobrança aparece aqui com vencimento, saldo e situação. Nada foi somado nem estimado nesta tela."
          action={
            <Link to="/app/billing" className="text-xs font-semibold text-brand-700 no-underline">
              Ver faturamento
            </Link>
          }
        />
      </ModulePage>
    );
  }

  return (
    <ModulePage>
      <WorklistHeader
        title="Contas a receber"
        count={page.total}
        context="Saldos e status são os informados pelo servidor. Esta tela não recalcula títulos."
      />

      {/*
        DRILL-DOWN: cada indicador leva à lista já filtrada que o produziu.
        Nenhum número importante fica órfão.
      */}
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
          value={page.total}
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
        FILTRO EM UMA LINHA. Era um `FilterCard` — cartao de respiro largo que empurrava a
        carteira para fora da primeira dobra. O mesmo recorte, a mesma consulta e o mesmo
        smart list, agora na gramatica densa das demais worklists.
      */}
      <WorklistFilterBar>
        <WorklistField label="Status" htmlFor="receivable-status-filter">
          <Select
            id="receivable-status-filter"
            className={cn(worklistSelectClass, 'cursor-pointer')}
            value={statusFilter}
            onChange={(event) => {
              smartList.setFilter('status', event.target.value);
              setPageNumber(1);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(RECEIVABLE_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </WorklistField>
        <WorklistClearFilters
          visible={smartList.isFiltered}
          onClick={() => {
            smartList.clearFilters();
            setPageNumber(1);
          }}
        />
      </WorklistFilterBar>

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
        visibleCount={pageItems.length}
        onClear={selection.clear}
        onSelectAllVisible={() => selection.selectAll(pageItems)}
        parkedNote="Liquidação, baixa e cancelamento em lote continuam PARK: exigem prova de segregação de funções e idempotência por título. A ação em lote daqui apenas organiza o trabalho."
        actions={[
          {
            id: 'export',
            label: 'Exportar selecionados (CSV)',
            run: () =>
              exportSelectionToCsv(
                'contas-a-receber-selecionadas.csv',
                ['Referência', 'Vencimento', 'Status', 'Principal', 'Saldo', 'Moeda'],
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
            label: 'Abrir prévia',
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

      {pageItems.length === 0 ? (
        <EmptyState
          title={smartList.isFiltered ? 'Nenhum título nesta visão' : 'Nenhum título a receber'}
          description={
            smartList.isFiltered
              ? 'Nenhum título corresponde ao recorte atual. Ajuste o filtro ou limpe a visão para ver a carteira completa.'
              : 'Não há contas a receber visíveis para o seu acesso.'
          }
        />
      ) : (
        <>
          <div className={worklistTableCardClass}>
            <table className={worklistTableClass} aria-label="Lista de contas a receber">
              <thead>
                <tr>
                  <th scope="col" className={cn(worklistHeadCellClass, 'w-8')}>
                    <span className="cisne-sr-only">Selecionar</span>
                  </th>
                  <SortableHead
                    label="Título"
                    sortKey="externalReference"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Vencimento"
                    sortKey="dueDate"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Status"
                    sortKey="status"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                  />
                  <SortableHead
                    label="Principal"
                    sortKey="principal"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                    numeric
                  />
                  <SortableHead
                    label="Saldo"
                    sortKey="remainingBalance"
                    sort={smartList.sort}
                    onToggle={smartList.toggleSort}
                    numeric
                  />
                  <th scope="col" className={cn(worklistHeadCellClass, 'w-16 text-right')}>
                    Ação
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((item) => (
                  <tr key={item.id} className={worklistRowClass}>
                    {/* Celula interativa FORA do alcance do link esticado da linha. */}
                    <td className={cn(worklistCellClass, 'z-[1] w-8')}>
                      <input
                        type="checkbox"
                        aria-label={`Selecionar ${item.externalReference ?? item.id}`}
                        checked={selection.isSelected(item.id)}
                        onChange={() => selection.toggle(item.id)}
                      />
                    </td>
                    <td className={worklistCellClass}>
                      <WorklistRowLink href={`/app/finance/receivables/${item.id}`}>
                        {item.externalReference ?? item.id}
                      </WorklistRowLink>
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <DateTime value={item.dueDate} mode="date" />
                    </td>
                    <td className={worklistCellRaisedClass}>
                      <RecordStatusCell
                        accent={item.status === 'OVERDUE' ? 'critical' : 'none'}
                        badge={
                          <FinanceStatusBadge status={item.status} labels={RECEIVABLE_STATUS_LABELS} />
                        }
                        context={item.status === 'OVERDUE' ? 'Requer cobrança' : null}
                      />
                    </td>
                    <td className={worklistNumericCellClass}>
                      <Money value={item.principal} currencyCode={item.currencyCode} />
                    </td>
                    <td className={worklistNumericCellClass}>
                      <Money
                        value={item.remainingBalance}
                        currencyCode={item.currencyCode}
                        emphasis
                      />
                    </td>
                    <RowActionCell className="w-16">
                      <button
                        type="button"
                        className="rounded border border-gray-300 bg-white px-2 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                        onClick={() => setPreviewId(item.id)}
                        aria-label={`Prévia de ${item.externalReference ?? item.id}`}
                      >
                        Prévia
                      </button>
                    </RowActionCell>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <WorklistFooter
            rangeLabel={
              <span aria-live="polite">
                Página {safePageNumber} de {pageCount} · {page.total}{' '}
                {page.total === 1 ? 'título' : 'títulos'} no recorte atual
              </span>
            }
            extra={
              <>
                {statusFilter
                  ? `filtro: ${RECEIVABLE_STATUS_LABELS[statusFilter] ?? statusFilter}`
                  : null}
                {overdue.length > 0 ? ` · ${overdue.length} vencido(s)` : ''}
                {refreshing ? ' · atualizando…' : ''}
              </>
            }
          >
            <ModulePagination
              pageNumber={safePageNumber}
              onPrevious={() => setPageNumber((current) => Math.max(1, current - 1))}
              onNext={() => setPageNumber((current) => Math.min(pageCount, current + 1))}
              previousDisabled={safePageNumber <= 1}
              nextDisabled={safePageNumber >= pageCount}
            />
          </WorklistFooter>
        </>
      )}

      <ContextDrawer
        open={previewRow !== null}
        title="Contexto do título"
        preview={previewRow ? buildReceivablePreview(previewRow) : null}
        onClose={() => setPreviewId(null)}
      />
    </ModulePage>
  );
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function sortIndicator(
  sort: { key: string | null; direction: 'asc' | 'desc' },
  key: string,
): string {
  if (sort.key !== key) {
    return '';
  }
  return sort.direction === 'asc' ? '▲' : '▼';
}

function SortableHead({
  label,
  sortKey,
  sort,
  onToggle,
  numeric = false,
}: {
  label: string;
  sortKey: string;
  sort: { key: string | null; direction: 'asc' | 'desc' };
  onToggle: (key: string) => void;
  numeric?: boolean;
}) {
  const active = sort.key === sortKey;
  return (
    <th
      scope="col"
      className={numeric ? worklistNumericHeadCellClass : worklistHeadCellClass}
      aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        className="font-semibold tracking-wider uppercase"
        onClick={() => onToggle(sortKey)}
      >
        {label} <span aria-hidden>{sortIndicator(sort, sortKey)}</span>
      </button>
    </th>
  );
}

/**
 * Cadeia empresarial montada SOMENTE com vínculos que já existem no payload
 * (`origin.serviceOrderId`, `origin.measurementId`, `clientId`). Nenhum degrau é
 * afirmado sem lastro: se um id não vier, o degrau não aparece.
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
      // A OS nao tem rota raiz publicada: o ponto de entrada real e o planejamento,
      // que e a object page mae do dominio. Sem o sufixo o link nao resolvia rota.
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

/** Cadeia exibida onde o vínculo já está disponível. */
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
       * Relacao sem rotulo humano NAO exibe o identificador tecnico: o vinculo existe
       * (e navega, quando ha destino real), mas o valor mostrado e o nome do objeto.
       * `externalReference` ja e a referencia humana do titulo.
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
