import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { DateTime, EmptyState, Money } from '../../ui';
import {
  FilterCard,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModulePageHeader,
  ModulePagination,
  ModuleTableCard,
  ModuleTableLink,
  filterControlClass,
  filterLabelClass,
  moduleTableCellClass,
  moduleTableClass,
  moduleTableHeadClass,
  moduleTableHeaderCellClass,
  moduleTableRowClass,
} from '../../ui/module-layout';
import { DefinitionList } from '../../financial-ui/DefinitionList';
import { MoneyActionForm } from '../../financial-ui/MoneyActionForm';
import { VersionedActionForm } from '../../financial-ui/VersionedActionForm';
import { FISCAL_STATUS_LABELS, PERIOD_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  cancelFiscalDocument,
  getFiscalDocument,
  listFiscalDocuments,
  listFiscalPeriods,
  markFiscalDocumentReady,
  submitFiscalDocument,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { ActivityTimeline, SavedViewsBar, useSmartList } from '../../operator';
import type {
  FiscalDocument,
  FiscalDocumentListItem,
  FiscalPeriodListItem,
} from '../types/fiscal.types';

const PAGE_SIZE = 20;
/** Tamanho da consulta de competências: a lista é curta (uma por mês aberto/fechado). */
const PERIOD_PAGE_SIZE = 24;

/** Escopo estável de persistência das visões salvas desta lista. */
const SCOPE = 'fiscal.documents';

/**
 * Situações aceitas pelo servidor no filtro da listagem.
 *
 * É exatamente `FISCAL_STATUSES` da API (`fiscal-document.validation.ts`): o servidor
 * rejeita qualquer outro valor. `FAILED` NÃO existe na enumeração persistida de
 * `fis.fiscal_documents` — por isso não é oferecido aqui.
 */
const STATUS_FILTERS = [
  'DRAFT',
  'READY',
  'SUBMITTED',
  'AUTHORIZED',
  'REJECTED',
  'CANCELLED',
] as const;

/** Valores de situação aceitos como visão/URL — os mesmos que a tela oferece. */
const FISCAL_DOCUMENTS_ALLOWED_FILTERS = {
  filters: { status: STATUS_FILTERS },
} as const;

/**
 * Visões embutidas derivadas do domínio real da tela: são os recortes que o Ctrl+K já
 * promete e que a Mesa de Fechamento aponta por URL (`?status=...`).
 */
const FISCAL_DOCUMENTS_BUILT_IN_VIEWS = [
  {
    id: 'builtin.fiscal.rejected',
    name: 'Rejeitados',
    description: 'Documentos recusados que precisam voltar para correção.',
    config: {
      filters: { status: 'REJECTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
  {
    id: 'builtin.fiscal.awaiting',
    name: 'Aguardando autorização',
    description: 'Documentos enviados e ainda sem desfecho do ambiente autorizador.',
    config: {
      filters: { status: 'SUBMITTED' },
      sortKey: null,
      sortDirection: 'asc' as const,
      groupKey: null,
    },
  },
];

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: FiscalDocumentListItem[]; total: number; page: number };

type PeriodsState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; items: FiscalPeriodListItem[] };

function FISCAL_STATUS_LABEL(status: string): string {
  return FISCAL_STATUS_LABELS[status] ?? status;
}

/** Referência humana da competência: `AAAA-MM` (periodKey do servidor) → `MM/AAAA`. */
function formatCompetence(periodKey: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey.trim());
  return match ? `${match[2]}/${match[1]}` : periodKey;
}

/**
 * Competência escolhida (`AAAA-MM`) → intervalo de emissão que a API já aceita.
 *
 * A listagem de documentos NÃO tem parâmetro `periodKey`; o que existe no servidor é
 * `issuedFrom`/`issuedTo`. A competência de um documento é derivada pelo PRÓPRIO servidor
 * da data de emissão (`to_char(issued_on, 'YYYY-MM')` no gatilho de período fechado, 0061,
 * e `fiscalPeriodKeyFromDate` na apuração) — logo o intervalo de calendário do mês da
 * competência é a mesma derivação do servidor, não uma regra fiscal criada na tela.
 *
 * @returns `null` quando a referência recebida não é uma competência válida; nesse caso
 *   nenhum recorte de emissão é enviado.
 */
function emissionBoundsFor(periodKey: string): { issuedFrom: string; issuedTo: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(periodKey.trim());
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!Number.isInteger(year) || month < 1 || month > 12) {
    return null;
  }
  // Dia 0 do mês seguinte = último dia do mês da competência (calendário, não regra fiscal).
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    issuedFrom: `${match[1]}-${match[2]}-01`,
    issuedTo: `${match[1]}-${match[2]}-${String(lastDay).padStart(2, '0')}`,
  };
}

/**
 * Próxima ação derivada da situação do documento — sem interpretar regra tributária.
 * A transição em si permanece no backend (enviar/cancelar no detalhe).
 */
function NEXT_ACTION_FOR(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Marcar como pronta';
    case 'READY':
      return 'Enviar para autorização';
    case 'SUBMITTED':
      return 'Aguardar autorização';
    case 'AUTHORIZED':
      return 'Nenhuma — documento vigente';
    case 'REJECTED':
      return 'Corrigir e reenviar';
    case 'CANCELLED':
      return 'Nenhuma — cancelado';
    default:
      return '—';
  }
}

/**
 * Ações oferecidas no detalhe = transições que o servidor realmente aceita a partir da
 * situação persistida (`ALLOWED_FISCAL_TRANSITIONS` em `fiscal-document.ts`, aplicada por
 * `assertTransition` no repositório fiscal):
 *
 * - `DRAFT → READY`     — `POST /fiscal/documents/:id/ready`
 * - `READY → SUBMITTED` — `POST /fiscal/documents/:id/submit`
 * - `SUBMITTED → SUBMITTED` (reenvio/idempotência) — mesmo endpoint
 * - `AUTHORIZED → CANCELLED` — `POST /fiscal/documents/:id/cancel`
 *
 * `REJECTED` e `CANCELLED` não aceitam nenhuma dessas transições; a tela não oferece
 * botão que o backend recusaria.
 */
function allowedDocumentActions(status: string): { ready: boolean; submit: boolean; cancel: boolean } {
  return {
    ready: status === 'DRAFT',
    submit: status === 'READY' || status === 'SUBMITTED',
    cancel: status === 'AUTHORIZED',
  };
}

export function FiscalDocumentsPage() {
  const { fiscalDocumentId } = useParams();
  return fiscalDocumentId ? (
    <FiscalDocumentDetail fiscalDocumentId={fiscalDocumentId} />
  ) : (
    <FiscalDocumentsList />
  );
}

/** Superficie de consulta: lista paginada por unidade com recortes de competencia e situacao. */
function FiscalDocumentsList() {
  /**
   * A unidade é escolha humana: a mesma lista de unidades operacionais do shell usada por
   * fiscal, contabilidade e folha. Nenhum campo livre e nenhum identificador digitado.
   */
  const { units, unitId: defaultUnitId } = useOperationalUnits();
  const [searchParams] = useSearchParams();

  /**
   * Drill-down da Mesa de Fechamento: `/app/fiscal/documents?status=REJECTED&unitId=...`.
   *
   * `unitId` não é token enumerado curto (a camada de URL/visão salva só aceita
   * `^[A-Za-z0-9_]{1,64}$`, e identificador de unidade não é enum de domínio), então ele é
   * lido DIRETO da query string — mesmo padrão já usado pela folha (`PayrollPage`) — e
   * enviado à API. A autorização continua no servidor, por unidade.
   */
  const unitFromQuery = searchParams.get('unitId') ?? '';
  const [unitId, setUnitId] = useState(unitFromQuery);
  const [page, setPage] = useState(0);

  // Link profundo sem unidade não obriga o operador a digitar nada: a primeira unidade
  // visível para ele é selecionada, como já acontece nas demais listas de backoffice.
  useEffect(() => {
    if (!unitId && defaultUnitId) {
      setUnitId(defaultUnitId);
    }
  }, [defaultUnitId, unitId]);

  /**
   * A situação vive na URL e em visão salva (mecanismo compartilhado do operador): é o que
   * faz o Ctrl+K, a visão embutida e o drill-down abrirem a fila já recortada. Somente
   * valores enumerados entram — nenhum identificador de registro vai para a URL.
   */
  const smartList = useSmartList({
    scope: SCOPE,
    builtInViews: FISCAL_DOCUMENTS_BUILT_IN_VIEWS,
    allowedFilters: FISCAL_DOCUMENTS_ALLOWED_FILTERS,
    urlSync: true,
  });
  const statusFilter = smartList.filters.status ?? '';
  // Só valor que é uma opção real do domínio vira filtro: token desconhecido no URL não é
  // enviado à API nem permanece na consulta do operador.
  const status = (STATUS_FILTERS as readonly string[]).includes(statusFilter) ? statusFilter : '';
  const { setFilter } = smartList;

  useEffect(() => {
    if (statusFilter !== status) {
      setFilter('status', '');
    }
  }, [setFilter, status, statusFilter]);

  /**
   * Competência: escolha humana alimentada pela lista REAL de períodos fiscais da unidade
   * (`GET /api/v1/fiscal/periods?unitId=`). A referência exibida é `MM/AAAA`; o valor
   * carregado é o `periodKey` do servidor — nunca um identificador de registro.
   */
  const [competence, setCompetence] = useState('');
  const [periodsState, setPeriodsState] = useState<PeriodsState>({ phase: 'loading' });

  useEffect(() => {
    if (!unitId) {
      setPeriodsState({ phase: 'ready', items: [] });
      return;
    }
    const controller = new AbortController();
    setPeriodsState({ phase: 'loading' });
    void listFiscalPeriods({ unitId, page: 0, pageSize: PERIOD_PAGE_SIZE }, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) {
          return;
        }
        setPeriodsState({ phase: 'ready', items: response.items });
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setPeriodsState({ phase: 'error' });
        }
      });
    return () => controller.abort();
  }, [unitId]);

  // A competência pertence à unidade: trocar de unidade não mantém recorte de outra unidade.
  useEffect(() => {
    setCompetence('');
    setPage(0);
  }, [unitId]);

  const bounds = useMemo(() => emissionBoundsFor(competence), [competence]);

  const [state, setState] = useState<ListState>({ phase: 'loading' });

  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!unitId) {
        setState({ phase: 'ready', items: [], total: 0, page: 0 });
        return;
      }
      setState({ phase: 'loading' });
      try {
        const response = await listFiscalDocuments(
          {
            unitId,
            status: status || undefined,
            issuedFrom: bounds?.issuedFrom,
            issuedTo: bounds?.issuedTo,
            page,
            pageSize: PAGE_SIZE,
          },
          signal,
        );
        setState({ phase: 'ready', items: response.items, total: response.total, page: response.page });
      } catch (error) {
        setState({
          phase: 'error',
          message:
            error instanceof Error
              ? mapFiscalErrorToMessage(
                  (error as { code?: string }).code,
                  (error as { status?: number }).status ?? 0,
                )
              : 'Não foi possível carregar os documentos fiscais.',
          retryable: true,
        });
      }
    },
    [bounds, page, status, unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasMore = state.phase === 'ready' && (state.page + 1) * PAGE_SIZE < state.total;
  const hasFilters = Boolean(status) || Boolean(competence);
  const periods = periodsState.phase === 'ready' ? periodsState.items : [];

  const clearFilters = useCallback(() => {
    setFilter('status', '');
    setCompetence('');
    setPage(0);
  }, [setFilter]);

  return (
    <ModulePage>
      <ModulePageHeader
        title="Documentos fiscais"
        description="Consulta e transições usam o documento oficial do servidor. Tributos da tela vêm do snapshot persistido."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-3">
          <div>
            <label className={filterLabelClass} htmlFor="fiscal-unit-filter">
              Unidade
            </label>
            <select
              id="fiscal-unit-filter"
              className={filterControlClass}
              value={unitId}
              onChange={(event) => {
                setUnitId(event.target.value);
                setPage(0);
              }}
            >
              {units.length === 0 ? <option value="">Nenhuma unidade disponível</option> : null}
              {units.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
              {/* Unidade vinda de link (Mesa de Fechamento) que não está na lista visível:
                  sem esta opção o recorte chegaria à API sem o operador ver qual unidade é. */}
              {unitId && !units.includes(unitId) ? (
                <option key={`query-${unitId}`} value={unitId}>
                  {unitId}
                </option>
              ) : null}
            </select>
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fiscal-competence-filter">
              Competência
            </label>
            <select
              id="fiscal-competence-filter"
              className={filterControlClass}
              value={competence}
              onChange={(event) => {
                setCompetence(event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas as competências</option>
              {periods.map((period) => (
                <option key={period.periodKey} value={period.periodKey}>
                  {`${formatCompetence(period.periodKey)} · ${
                    PERIOD_STATUS_LABELS[period.status] ?? period.status
                  }`}
                </option>
              ))}
            </select>
            {periodsState.phase === 'error' ? (
              <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                Não foi possível carregar as competências desta unidade.
              </p>
            ) : null}
            {periodsState.phase === 'ready' && periods.length === 0 ? (
              <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                Esta unidade ainda não tem período fiscal aberto.
              </p>
            ) : null}
            {bounds ? (
              // O critério que VAI à API fica visível: a competência é recortada pela
              // emissão do documento, exatamente como o servidor deriva a competência.
              <p className="mt-1 text-xs text-gray-500" aria-live="polite">
                {`Emissão de ${bounds.issuedFrom} a ${bounds.issuedTo}`}
              </p>
            ) : null}
          </div>
          <div>
            <label className={filterLabelClass} htmlFor="fiscal-status-filter">
              Situação
            </label>
            <select
              id="fiscal-status-filter"
              className={filterControlClass}
              value={status}
              onChange={(event) => {
                setFilter('status', event.target.value);
                setPage(0);
              }}
            >
              <option value="">Todas</option>
              {STATUS_FILTERS.map((value) => (
                <option key={value} value={value}>
                  {FISCAL_STATUS_LABEL(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterCard>

      <SavedViewsBar
        views={smartList.savedViews.views}
        builtInViews={smartList.savedViews.builtInViews}
        activeViewId={smartList.activeViewId}
        onApply={(view) => {
          smartList.applyView(view);
          setPage(0);
        }}
        onSave={smartList.savedViews.saveView}
        onRename={smartList.savedViews.renameView}
        onRemove={smartList.savedViews.removeView}
        currentConfig={smartList.currentConfig}
        canSave={Object.keys(smartList.filters).length > 0}
        allLabel="Todas"
        className="mb-4"
      />

      {state.phase === 'loading' ? <ModuleLoadingState title="Documentos fiscais" message="Carregando documentos…" /> : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Documentos fiscais"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {/*
        Contador real: `total` vem do servidor em qualquer recorte — inclusive zero. A tela
        não estima, não soma página e não recalcula a fila.
      */}
      {state.phase === 'ready' ? (
        <p className="mb-2 text-xs text-gray-500" aria-live="polite">
          {state.total} {state.total === 1 ? 'documento' : 'documentos'} na fila
          {status ? ` · situação: ${FISCAL_STATUS_LABEL(status)}` : ''}
          {competence ? ` · competência: ${formatCompetence(competence)}` : ''}
        </p>
      ) : null}

      {/*
        Estado vazio em três situações distintas, para não confundir "não existe documento
        nenhum ainda" com "o recorte atual não devolveu nada":
        1. nenhuma unidade operacional visível para o acesso;
        2. recorte aplicado (situação/competência) sem resultado;
        3. unidade sem documento fiscal registrado.
      */}
      {state.phase === 'ready' && state.items.length === 0 ? (
        !unitId ? (
          <EmptyState
            title="Nenhuma unidade operacional"
            description="Não há unidade operacional disponível para o seu acesso."
          />
        ) : hasFilters ? (
          <EmptyState
            title="Nenhum documento para os filtros selecionados"
            description={`A unidade ${unitId} não tem documento fiscal com o recorte aplicado. Ajuste ou limpe os filtros para ver a fila completa desta unidade.`}
            action={
              <button
                type="button"
                className="text-xs font-semibold text-brand-600 hover:text-brand-700"
                onClick={clearFilters}
              >
                Limpar filtros
              </button>
            }
          />
        ) : (
          <EmptyState
            title="Nenhum documento fiscal registrado para esta unidade ainda"
            description={`A unidade ${unitId} ainda não possui documento fiscal registrado. A fila aparece assim que um documento for criado pela origem autorizada.`}
          />
        )
      ) : null}

      {state.phase === 'ready' && state.items.length > 0 ? (
        <>
          <ModuleTableCard>
            <table className={moduleTableClass} aria-label="Lista de documentos fiscais">
              <thead className={moduleTableHeadClass}>
                <tr>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Emissão
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Situação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Origem
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Descrição
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Protocolo
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Próxima ação
                  </th>
                  <th scope="col" className={moduleTableHeaderCellClass}>
                    Unidade
                  </th>
                </tr>
              </thead>
              <tbody>
                {state.items.map((item) => (
                  <tr key={item.id} className={moduleTableRowClass}>
                    <td className={moduleTableCellClass}>
                      <ModuleTableLink to={`/app/fiscal/documents/${item.id}`}>
                        <DateTime value={item.issuedOn} mode="date" />
                      </ModuleTableLink>
                    </td>
                    <td className={moduleTableCellClass}>
                      <FinanceStatusBadge status={item.status} labels={FISCAL_STATUS_LABELS} />
                    </td>
                    <td className={moduleTableCellClass}>{item.sourceKind}</td>
                    <td className={`${moduleTableCellClass} whitespace-normal`}>{item.description}</td>
                    <td className={moduleTableCellClass}>{item.lastProtocolCode ?? '—'}</td>
                    <td className={moduleTableCellClass}>{NEXT_ACTION_FOR(item.status)}</td>
                    <td className={moduleTableCellClass}>{item.unitId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ModuleTableCard>

          <ModulePagination
            pageNumber={state.page + 1}
            previousDisabled={state.page === 0}
            nextDisabled={!hasMore}
            onPrevious={() => setPage((current) => Math.max(0, current - 1))}
            onNext={() => setPage((current) => current + 1)}
          />
        </>
      ) : null}
    </ModulePage>
  );
}

function FiscalDocumentDetail({ fiscalDocumentId }: { fiscalDocumentId: string }) {
  const loader = useCallback(
    (signal?: AbortSignal) => getFiscalDocument(fiscalDocumentId, signal),
    [fiscalDocumentId],
  );
  const { state, reload, setReady } = useBackofficeQuery<FiscalDocument>({
    loader,
    mapError: mapFiscalErrorToMessage,
    enabled: true,
    autoLoad: true,
  });

  const gate = renderQueryGate(
    'Documento fiscal',
    'Carregando documento fiscal…',
    'Você não tem permissão para ver documentos fiscais.',
    state,
    () => void reload(),
  );

  return (
    <ModulePage>
      <ModulePageHeader
        title="Documento fiscal"
        description="Consulta e transições usam o documento oficial do servidor."
      />
      <p className="mb-6">
        <Link to="/app/fiscal/documents" className="text-sm font-medium text-brand-600 no-underline">
          ← Voltar para a lista
        </Link>
      </p>
      {gate}
      {state.phase === 'ready' ? (
        <FiscalDocumentView document={state.data} onReload={reload} onReady={setReady} />
      ) : null}
    </ModulePage>
  );
}

function FiscalDocumentView({
  document,
  onReload,
  onReady,
}: {
  document: FiscalDocument;
  onReload: () => Promise<void>;
  onReady: (next: FiscalDocument) => void;
}) {
  const actions = allowedDocumentActions(document.status);
  const hasAction = actions.ready || actions.submit || actions.cancel;

  return (
    <>
      <div className="mb-6 rounded-xl bg-white p-6 shadow-sm ring-1 ring-gray-900/5">
        <DefinitionList
          items={[
            {
              label: 'Status',
              value: <FinanceStatusBadge status={document.status} labels={FISCAL_STATUS_LABELS} />,
            },
            { label: 'Descrição', value: document.description },
            { label: 'Emissão', value: <DateTime value={document.issuedOn} mode="date" /> },
            { label: 'Versão', value: String(document.rowVersion) },
            /*
              Origem vem SOMENTE das colunas persistidas (source_kind/source_id/
              billing_document_id). A descrição do documento nunca é usada para inferir
              procedência — se o vínculo não foi gravado, aparece como ausente.
            */
            { label: 'Origem (tipo persistido)', value: document.sourceKind },
            { label: 'Registro de origem', value: document.sourceId ?? '—' },
            { label: 'Faturamento', value: document.billingDocumentId ?? '—' },
            { label: 'Validade fiscal', value: document.validityLegend || 'SEM VALIDADE FISCAL' },
            { label: 'DANFE oficial', value: document.officialDanfe === 'ALLOWED' ? 'Liberada' : 'Bloqueada' },
          ]}
        />
      </div>

      <ModuleTableCard>
        <table className={moduleTableClass} aria-label="Itens do documento fiscal">
          <thead className={moduleTableHeadClass}>
            <tr>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Item
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Descrição
              </th>
              <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                Quantidade
              </th>
              <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                Valor da linha
              </th>
            </tr>
          </thead>
          <tbody>
            {document.items.map((item) => (
              <tr key={item.lineNumber} className={moduleTableRowClass}>
                <td className={moduleTableCellClass}>{item.lineNumber}</td>
                <td className={`${moduleTableCellClass} whitespace-normal`}>{item.description}</td>
                <td className={`${moduleTableCellClass} text-right`}>{item.quantity}</td>
                <td className={`${moduleTableCellClass} text-right`}>
                  <Money value={item.lineAmount} currencyCode={document.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleTableCard>

      <ModuleTableCard>
        <table className={moduleTableClass} aria-label="Tributos persistidos no documento">
          <thead className={moduleTableHeadClass}>
            <tr>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Componente
              </th>
              <th scope="col" className={`${moduleTableHeaderCellClass} text-right`}>
                Valor
              </th>
            </tr>
          </thead>
          <tbody>
            {document.taxDetails.map((detail, index) => (
              <tr key={`${detail.lineNumber}-${detail.componentLabel}-${index}`} className={moduleTableRowClass}>
                <td className={moduleTableCellClass}>
                  {detail.componentLabel} · linha {detail.lineNumber}
                </td>
                <td className={`${moduleTableCellClass} text-right`}>
                  <Money value={detail.amount} currencyCode={document.currencyCode} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ModuleTableCard>

      <ModuleTableCard>
        {/*
          ADOCAO DE MECANISMO: os eventos do documento fiscal sao fatos persistidos
          (eventType + occurredAt). Antes eram uma tabela ad-hoc so desta tela; agora
          usam o ActivityTimeline compartilhado, com ordenacao decrescente e estado
          vazio padronizado. Nenhum ator e fabricado: o payload nao traz autor, entao
          `actor` fica ausente em vez de ser inventado.
        */}
        <ActivityTimeline
          title="Eventos do documento fiscal"
          emptyMessage="Nenhum evento registrado para este documento."
          facts={document.events.map((event) => ({
            at: event.occurredAt,
            event: event.eventType,
          }))}
        />
      </ModuleTableCard>

      <ModuleTableCard>
        <table className={moduleTableClass} aria-label="Tentativas de autorização do documento fiscal">
          <thead className={moduleTableHeadClass}>
            <tr>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Tentativa
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Provedor
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Resultado
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Protocolo
              </th>
              <th scope="col" className={moduleTableHeaderCellClass}>
                Mensagem
              </th>
            </tr>
          </thead>
          <tbody>
            {document.authorizations.length === 0 ? (
              <tr className={moduleTableRowClass}>
                <td className={moduleTableCellClass} colSpan={5}>
                  Nenhuma tentativa de autorização registrada.
                </td>
              </tr>
            ) : (
              document.authorizations.map((authorization) => (
                <tr key={authorization.attemptNumber} className={moduleTableRowClass}>
                  <td className={moduleTableCellClass}>{authorization.attemptNumber}</td>
                  <td className={moduleTableCellClass}>{authorization.gatewayId}</td>
                  <td className={moduleTableCellClass}>{authorization.outcome}</td>
                  <td className={moduleTableCellClass}>{authorization.protocolCode ?? '—'}</td>
                  <td className={`${moduleTableCellClass} whitespace-normal`}>
                    {authorization.message ?? '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ModuleTableCard>

      {/*
        Ações = transições que o servidor aceita nesta situação (`ALLOWED_FISCAL_TRANSITIONS`
        + `assertTransition` no repositório fiscal). A tela não oferece botão que o backend
        recusaria, e não esconde a razão quando não há ação disponível.
      */}
      {hasAction ? (
        <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          {actions.ready ? (
            <VersionedActionForm
              title="Marcar como pronta"
              description="Transição Rascunho → Pronto, aceita pelo servidor nesta situação."
              confirmTitle="Marcar documento fiscal como pronto"
              confirmDescription="O servidor aplica a transição e registra o evento."
              confirmLabel="Marcar como pronta"
              mapError={mapFiscalErrorToMessage}
              onReload={() => void onReload()}
              onSubmit={async () => {
                onReady(await markFiscalDocumentReady(document.id, { rowVersion: document.rowVersion }));
              }}
            />
          ) : null}
          {actions.submit ? (
            <MoneyActionForm
              title="Enviar documento"
              description="A submissão e a autorização são decididas pelo backend."
              confirmTitle="Enviar documento fiscal"
              confirmDescription="O servidor aplicará a transição e o gateway configurado."
              confirmLabel="Enviar"
              mapError={mapFiscalErrorToMessage}
              onReload={() => void onReload()}
              onSubmit={async () => {
                onReady(await submitFiscalDocument(document.id, { rowVersion: document.rowVersion }));
              }}
            />
          ) : null}
          {actions.cancel ? (
            <MoneyActionForm
              title="Cancelar documento"
              description="O cancelamento oficial exige justificativa e versão atual."
              confirmTitle="Cancelar documento fiscal"
              confirmDescription="Somente o backend autoriza o cancelamento."
              confirmLabel="Cancelar documento"
              reasonLabel="Justificativa"
              mapError={mapFiscalErrorToMessage}
              onReload={() => void onReload()}
              onSubmit={async ({ reason }) => {
                onReady(
                  await cancelFiscalDocument(document.id, {
                    rowVersion: document.rowVersion,
                    reason: reason ?? '',
                  }),
                );
              }}
            />
          ) : null}
        </div>
      ) : (
        <p className="mb-6 text-sm text-gray-500">
          Nenhuma ação disponível nesta situação: o servidor não aceita, a partir dela, nenhuma
          das transições expostas nesta tela.
        </p>
      )}
    </>
  );
}
