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
import { FISCAL_STATUS_LABELS } from '../../financial-ui/labels';
import { renderQueryGate } from '../../financial-ui/BackofficeStates';
import { useBackofficeQuery } from '../../financial-ui/useBackofficeQuery';
import {
  cancelFiscalDocument,
  getFiscalDocument,
  listFiscalDocuments,
  submitFiscalDocument,
} from '../api/fiscal-api';
import { mapFiscalErrorToMessage } from '../api/fiscal-error-messages';
import { useFiscalUnits } from '../hooks/useFiscalUnits';
import { FinanceStatusBadge } from '../../finance/components/FinanceStatusBadge';
import { ActivityTimeline } from '../../operator';
import type { FiscalDocument, FiscalDocumentListItem } from '../types/fiscal.types';

const PAGE_SIZE = 20;
const STATUS_FILTERS = ['', 'DRAFT', 'READY', 'SUBMITTED', 'AUTHORIZED', 'REJECTED', 'CANCELLED'] as const;

type ListState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; items: FiscalDocumentListItem[]; total: number; page: number };

function FISCAL_STATUS_LABEL(status: string): string {
  return FISCAL_STATUS_LABELS[status] ?? status;
}

/**
 * Próxima ação derivada da situação do documento — sem interpretar regra tributária.
 * A transição em si permanece no backend (enviar/cancelar no detalhe).
 */
function NEXT_ACTION_FOR(status: string): string {
  switch (status) {
    case 'DRAFT':
      return 'Conferir e enviar';
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

export function FiscalDocumentsPage() {
  const { fiscalDocumentId } = useParams();
  return fiscalDocumentId ? (
    <FiscalDocumentDetail fiscalDocumentId={fiscalDocumentId} />
  ) : (
    <FiscalDocumentsList />
  );
}

/** Superficie de consulta: lista paginada por unidade com filtro de situacao. */
function FiscalDocumentsList() {
  const { units, unitId, setUnitId } = useFiscalUnits();
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(0);

  /**
   * A situação é semeada pelo URL e permanece refletida nele.
   *
   * É o transporte que faz o Ctrl+K e o drill-down funcionarem nesta tela sem
   * mecanismo novo: `?status=REJECTED` abre a fila já recortada. Somente valores
   * enumerados entram — nenhum identificador de registro vai para a URL.
   */
  const statusFromUrl = useMemo(() => {
    const raw = searchParams.get('status') ?? '';
    return (STATUS_FILTERS as readonly string[]).includes(raw) ? raw : '';
  }, [searchParams]);
  const [status, setStatus] = useState(statusFromUrl);

  useEffect(() => {
    setStatus(statusFromUrl);
    setPage(0);
  }, [statusFromUrl]);

  const [state, setState] = useState<ListState>({ phase: 'loading' });

  const applyStatus = useCallback(
    (next: string) => {
      setStatus(next);
      setPage(0);
      setSearchParams(
        (current) => {
          const params = new URLSearchParams(current);
          if (next) {
            params.set('status', next);
          } else {
            params.delete('status');
          }
          return params;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

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
    [page, status, unitId],
  );

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const hasMore = state.phase === 'ready' && (state.page + 1) * PAGE_SIZE < state.total;

  return (
    <ModulePage>
      <ModulePageHeader
        title="Documentos fiscais"
        description="Consulta e transições usam o documento oficial do servidor. Tributos da tela vêm do snapshot persistido."
      />

      <FilterCard>
        <div className="grid gap-5 sm:grid-cols-2">
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
            </select>
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
                applyStatus(event.target.value);
              }}
            >
              {STATUS_FILTERS.map((value) => (
                <option key={value || 'all'} value={value}>
                  {value === '' ? 'Todas' : FISCAL_STATUS_LABEL(value)}
                </option>
              ))}
            </select>
          </div>
        </div>
      </FilterCard>

      {state.phase === 'loading' ? <ModuleLoadingState title="Documentos fiscais" message="Carregando documentos…" /> : null}

      {state.phase === 'error' ? (
        <ModuleErrorState
          title="Documentos fiscais"
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void load()}
        />
      ) : null}

      {state.phase === 'ready' && state.items.length === 0 ? (
        <EmptyState
          title={
            status
              ? `Nenhum documento com situação ${FISCAL_STATUS_LABEL(status)}`
              : 'Nenhum documento fiscal'
          }
          description={
            units.length === 0
              ? 'Não há unidade operacional disponível para o seu acesso.'
              : status
                ? 'A unidade selecionada não tem documento fiscal nessa situação. Ajuste a situação para ver a fila completa.'
                : 'Não há documentos fiscais para a unidade selecionada.'
          }
        />
      ) : null}

      {state.phase === 'ready' && state.items.length > 0 ? (
        <>
          {/*
            Contador real: `total` vem do servidor. A tela não estima nem
            recalcula a quantidade da fila.
          */}
          <p className="mb-2 text-xs text-gray-500" aria-live="polite">
            {state.total} {state.total === 1 ? 'documento' : 'documentos'} na fila
            {status ? ` · situação: ${FISCAL_STATUS_LABEL(status)}` : ''}
          </p>
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
  const immutable = document.status === 'AUTHORIZED' || document.status === 'CANCELLED';

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
            { label: 'Origem', value: document.sourceKind },
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

      <div className="mb-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <MoneyActionForm
          title="Enviar documento"
          description="A submissão e a autorização são decididas pelo backend."
          confirmTitle="Enviar documento fiscal"
          confirmDescription="O servidor aplicará a transição e o gateway configurado."
          confirmLabel="Enviar"
          disabled={immutable}
          mapError={mapFiscalErrorToMessage}
          onReload={() => void onReload()}
          onSubmit={async () => {
            onReady(await submitFiscalDocument(document.id, { rowVersion: document.rowVersion }));
          }}
        />
        <MoneyActionForm
          title="Cancelar documento"
          description="O cancelamento oficial exige justificativa e versão atual."
          confirmTitle="Cancelar documento fiscal"
          confirmDescription="Somente o backend autoriza o cancelamento."
          confirmLabel="Cancelar documento"
          reasonLabel="Justificativa"
          disabled={document.status === 'CANCELLED'}
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
      </div>
    </>
  );
}
