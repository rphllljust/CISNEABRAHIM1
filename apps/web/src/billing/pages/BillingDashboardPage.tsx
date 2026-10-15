import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/context/AuthProvider';
import { DynamicContextDrawer, DynamicSavedViewsBar, useSavedViews } from '../../engine';
import { ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import {
  ModulePagination,
  ModulePage,
  ModuleStatePage,
  ModuleLoadingState,
  ModuleDeniedState,
  ModuleErrorState,
} from '../../ui/module-layout';
import {
  EnterpriseMetric,
  WorklistClearFilters,
  WorklistField,
  WorklistFilterBar,
  WorklistHeader,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import { listBillingWorklist } from '../api/billing-api';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import {
  BILLING_FUTURE_PROCESS_STEPS,
  BILLING_PROCESS_STEPS,
  BILLING_RECEIVABLE_HREF,
} from '../utils/billing-process';
import { formatDateTimePtBr, formatMoneyBrl } from '../utils/billing-format';
import {
  BILLING_WORKLIST_BUCKETS,
  type BillingWorklistBucket,
  type BillingWorklistItem,
  type BillingWorklistResponse,
} from '../types/billing.types';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';

const PAGE_SIZE = 20;
const BUCKET_LABELS: Record<BillingWorklistBucket, string> = {
  cancelled_document: 'Documento cancelado',
  terms_divergence: 'Divergência comercial',
  measurement_pending: 'Medição pendente',
  billing_basis_missing: 'Base de faturamento ausente',
  document_state_unknown: 'Documento: situação restrita',
  ready: 'Pronto para faturar',
  prepared: 'Em preparação',
  issued: 'Documento emitido',
};

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error'; message: string; retryable: boolean }
  | { phase: 'ready'; result: BillingWorklistResponse };

function amountLabel(amount: string | null, currencyCode: string | null): string {
  return amount === null || currencyCode === null
    ? 'Não apurado'
    : formatMoneyBrl(amount, currencyCode);
}

export function BillingDashboardPage() {
  const { identityId } = useAuth();
  const savedViews = useSavedViews(identityId, 'billing-worklist');
  const { capabilities, loading: capabilitiesLoading } = useBillingCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [bucket, setBucket] = useState<BillingWorklistBucket | ''>('');
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<BillingWorklistItem | null>(null);

  const reload = useCallback(
    async (signal?: AbortSignal) => {
      setState({ phase: 'loading' });
      try {
        const result = await listBillingWorklist(
          { bucket: bucket || undefined, search, limit: PAGE_SIZE, offset },
          signal,
        );
        setState({ phase: 'ready', result });
      } catch (error) {
        if (signal?.aborted) return;
        if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        setState({
          phase: 'error',
          message:
            error instanceof ServiceOrdersApiError
              ? mapBillingErrorToMessage(error.code, error.status)
              : 'Não foi possível carregar a fila de faturamento.',
          retryable: true,
        });
      }
    },
    [bucket, offset, search],
  );

  useEffect(() => {
    if (capabilitiesLoading) return;
    if (!capabilities.canRead) {
      setState({ phase: 'denied' });
      return;
    }
    const controller = new AbortController();
    void reload(controller.signal);
    return () => controller.abort();
  }, [capabilities.canRead, capabilitiesLoading, reload]);

  const counts = state.phase === 'ready' ? state.result.summary.counts : null;
  const bucketOptions = useMemo(
    () => Object.entries(BILLING_WORKLIST_BUCKETS) as Array<[string, BillingWorklistBucket]>,
    [],
  );
  const rangeLabel =
    state.phase !== 'ready'
      ? 'Carregando fila…'
      : state.result.total === 0
        ? '0 no recorte'
        : state.result.page.count === 0
          ? `0 nesta página · ${state.result.total} no recorte`
          : `${state.result.page.offset + 1}–${state.result.page.offset + state.result.page.count} de ${state.result.total} no recorte`;

  if (capabilitiesLoading || state.phase === 'loading') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleLoadingState message="Carregando fila de faturamento…" />
      </ModuleStatePage>
    );
  }
  if (state.phase === 'denied') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleDeniedState message="Você não tem permissão para acessar o faturamento interno." />
      </ModuleStatePage>
    );
  }
  if (state.phase === 'error') {
    return (
      <ModuleStatePage title="Faturamento interno">
        <ModuleErrorState
          message={state.message}
          retryable={state.retryable}
          onRetry={() => void reload()}
        />
      </ModuleStatePage>
    );
  }

  const { result } = state;
  const crossReferences = selected
    ? [
        {
          label: 'Ordem de serviço',
          href: `/app/service-orders/${selected.serviceOrderId}`,
          detail: selected.orderNumber,
        },
        ...(selected.measurementId
          ? [
              {
                label: 'Medição',
                href: `/app/service-orders/${selected.serviceOrderId}/measurement`,
                detail: selected.measurementStatus ?? undefined,
              },
            ]
          : []),
        ...(selected.billingRecordId
          ? [
              {
                label: 'Preparação de faturamento',
                href: `/app/service-orders/${selected.serviceOrderId}/billing`,
                detail: selected.billingStatus ?? undefined,
              },
            ]
          : []),
        ...(selected.billingDocumentId
          ? [
              {
                label: 'Nota Fatura',
                href: `/app/service-orders/${selected.serviceOrderId}/billing/document`,
                detail:
                  selected.billingDocumentNumber ?? selected.billingDocumentStatus ?? undefined,
              },
            ]
          : []),
        ...(selected.receivableId
          ? [{ label: 'Recebível', href: `/app/finance/receivables/${selected.receivableId}` }]
          : []),
      ]
    : [];

  return (
    <ModulePage layout="workspace">
      <WorklistHeader
        title="Faturamento interno"
        count={result.total}
        context="Fila de trabalho de ordens concluídas: exceções e pendências primeiro, com origem e medição no mesmo registro. Nota Fatura é documento interno; não representa emissão fiscal oficial."
        metrics={
          <>
            <EnterpriseMetric
              value={counts?.cancelled_document ?? '—'}
              label="documentos cancelados no recorte"
              tone="warning"
            />
            <EnterpriseMetric
              value={counts?.terms_divergence ?? '—'}
              label="divergências comerciais no recorte"
              tone="warning"
            />
            <EnterpriseMetric
              value={counts?.measurement_pending ?? '—'}
              label="medições pendentes no recorte"
              tone="warning"
            />
            <EnterpriseMetric
              value={counts?.billing_basis_missing ?? '—'}
              label="bases comerciais ausentes no recorte"
              tone="warning"
            />
            <EnterpriseMetric
              value={counts?.document_state_unknown ?? '—'}
              label="documentos restritos no recorte"
            />
            <EnterpriseMetric
              value={counts?.ready ?? '—'}
              label="prontos para faturar no recorte"
              tone="info"
            />
            <EnterpriseMetric value={counts?.prepared ?? '—'} label="em preparação no recorte" />
            <EnterpriseMetric
              value={counts?.issued ?? '—'}
              label="documentos emitidos no recorte"
            />
          </>
        }
      />

      <DynamicSavedViewsBar
        views={savedViews.views}
        persistedLocally={savedViews.persistedLocally}
        persistable={Boolean(identityId)}
        onSave={(name) => savedViews.save(name, { bucket, search }, 'list')}
        onDelete={savedViews.remove}
        onApply={(view) => {
          const savedBucket = view.filters['bucket'] ?? '';
          setBucket(
            BUCKET_LABELS[savedBucket as BillingWorklistBucket]
              ? (savedBucket as BillingWorklistBucket)
              : '',
          );
          const savedSearch = view.filters['search'] ?? '';
          setSearch(savedSearch);
          setSearchDraft(savedSearch);
          setOffset(0);
        }}
      />

      <WorklistFilterBar meta={rangeLabel}>
        <WorklistField label="Situação" htmlFor="billing-worklist-bucket">
          <select
            id="billing-worklist-bucket"
            className={worklistSelectClass}
            value={bucket}
            onChange={(event) => {
              setBucket(event.target.value as BillingWorklistBucket | '');
              setOffset(0);
            }}
          >
            <option value="">Todas as situações</option>
            {bucketOptions.map(([_key, value]) => (
              <option key={value} value={value}>
                {BUCKET_LABELS[value]}
              </option>
            ))}
          </select>
        </WorklistField>
        <form
          className="flex items-end gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(searchDraft.trim());
            setOffset(0);
          }}
        >
          <WorklistField label="Buscar OS ou cliente" htmlFor="billing-worklist-search">
            <input
              id="billing-worklist-search"
              className={worklistSelectClass}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
            />
          </WorklistField>
          <button
            className="cisne-type-action min-h-[var(--control-height)] rounded-md bg-white px-2 ring-1 ring-gray-300 ring-inset"
            type="submit"
          >
            Buscar
          </button>
        </form>
        <WorklistClearFilters
          visible={Boolean(bucket || search)}
          onClick={() => {
            setBucket('');
            setSearch('');
            setSearchDraft('');
            setOffset(0);
          }}
        />
      </WorklistFilterBar>

      <section
        className="overflow-x-auto rounded-md border border-gray-200 bg-white"
        aria-label="Fila de faturamento"
      >
        <table className="w-full min-w-[920px] divide-y divide-gray-200 text-left text-sm">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-600">
            <tr>
              <th className="px-3 py-2">Situação / exceção</th>
              <th className="px-3 py-2">Ordem / cliente</th>
              <th className="px-3 py-2">Medição</th>
              <th className="px-3 py-2">Documento / origem</th>
              <th className="px-3 py-2 text-right">Valor</th>
              <th className="px-3 py-2">Concluída</th>
              <th className="px-3 py-2">Ação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {result.items.map((item) => (
              <tr
                key={item.serviceOrderId}
                tabIndex={0}
                className="cursor-pointer hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-brand-500"
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('a,button')) setSelected(item);
                }}
                onKeyDown={(event) => {
                  if (
                    event.target === event.currentTarget &&
                    (event.key === 'Enter' || event.key === ' ')
                  ) {
                    event.preventDefault();
                    setSelected(item);
                  }
                }}
              >
                <td className="px-3 py-2 align-top">
                  <button
                    type="button"
                    className="text-left font-medium text-gray-900 hover:text-brand-700"
                    onClick={() => setSelected(item)}
                  >
                    {BUCKET_LABELS[item.bucket]}
                  </button>
                  {item.exceptionDetail ? (
                    <p className="mt-0.5 max-w-xs text-xs text-amber-800">{item.exceptionDetail}</p>
                  ) : null}
                </td>
                <td className="px-3 py-2 align-top">
                  <div className="font-semibold tabular-nums">{item.orderNumber}</div>
                  <div className="text-xs text-gray-600">
                    {item.clientLabel ?? 'Cliente não identificado'}
                  </div>
                </td>
                <td className="px-3 py-2 align-top">
                  {item.measurementId ? (
                    <Link
                      className="text-brand-700 hover:underline"
                      to={`/app/service-orders/${item.serviceOrderId}/measurement`}
                    >
                      {item.measurementStatus ?? 'Vinculada'}
                    </Link>
                  ) : (
                    'Ausente'
                  )}
                </td>
                <td className="px-3 py-2 align-top">
                  {item.billingDocumentNumber ?? item.billingStatus ?? 'Sem preparação'}
                  <div className="text-xs text-gray-600">{item.origin}</div>
                </td>
                <td className="px-3 py-2 text-right align-top tabular-nums">
                  {amountLabel(item.amount, item.currencyCode)}
                </td>
                <td className="px-3 py-2 align-top tabular-nums">
                  {formatDateTimePtBr(item.completedAt)}
                </td>
                <td className="px-3 py-2 align-top">
                  <Link
                    className="font-medium text-brand-700 hover:underline"
                    to={`/app/service-orders/${item.serviceOrderId}/billing`}
                  >
                    {item.nextAction === 'prepare_billing'
                      ? 'Preparar faturamento'
                      : item.nextAction === 'issue_internal_document'
                        ? 'Revisar preparação'
                        : item.nextAction === 'complete_measurement'
                          ? 'Revisar medição'
                          : item.nextAction === 'review_receivable'
                            ? 'Abrir recebível'
                            : item.nextAction === 'review_issued_document'
                              ? 'Revisar documento'
                              : item.nextAction === 'resolve_billing_basis'
                                ? 'Resolver base comercial'
                                : item.nextAction === 'resolve_terms_divergence'
                                  ? 'Resolver divergência'
                                  : item.nextAction === 'review_billing_record'
                                    ? 'Abrir faturamento'
                                    : 'Analisar cancelamento'}
                  </Link>
                </td>
              </tr>
            ))}
            {result.items.length === 0 ? (
              <tr>
                <td className="px-3 py-8 text-center text-gray-600" colSpan={7}>
                  {bucket || search
                    ? 'Nenhum faturamento corresponde a este recorte.'
                    : 'Não há ordens concluídas no escopo de faturamento.'}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-200 py-2">
        <div
          className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600"
          aria-label="Totais agregados no recorte"
        >
          {result.summary.amountsByCurrency.map((amount) => (
            <span key={amount.currencyCode}>
              No recorte · {amount.currencyCode}:{' '}
              {amount.knownAmount === null
                ? 'não apurado'
                : formatMoneyBrl(amount.knownAmount, amount.currencyCode)}
              {amount.unknownAmountCount ? ` · ${amount.unknownAmountCount} não apurados` : ''}
            </span>
          ))}
        </div>
        <ModulePagination
          pageNumber={Math.floor(result.page.offset / result.page.limit) + 1}
          rangeLabel={rangeLabel}
          previousDisabled={result.page.offset === 0}
          nextDisabled={!result.page.hasMore}
          onPrevious={() => setOffset(Math.max(0, result.page.offset - result.page.limit))}
          onNext={() => setOffset(result.page.offset + result.page.limit)}
        />
      </div>

      <nav className="border-t border-gray-200 py-2" aria-label="Etapas do processo de faturamento">
        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600">
          {BILLING_PROCESS_STEPS.map((step, index) => (
            <li key={step.id}>
              {index ? '→ ' : ''}
              {step.id === 'receivable' ? (
                <Link className="text-brand-700 hover:underline" to={BILLING_RECEIVABLE_HREF}>
                  {step.label}
                </Link>
              ) : (
                step.label
              )}
            </li>
          ))}
        </ol>
        <p className="mt-1 text-xs text-gray-500">
          Fora deste fluxo: {BILLING_FUTURE_PROCESS_STEPS.map((step) => step.label).join(' · ')}
        </p>
      </nav>

      <DynamicContextDrawer
        open={selected !== null}
        title="Contexto do faturamento"
        onClose={() => setSelected(null)}
        crossReferences={crossReferences}
      >
        {selected ? (
          <div className="space-y-2 text-sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <dt className="text-gray-500">OS</dt>
              <dd>{selected.orderNumber}</dd>
              <dt className="text-gray-500">Cliente</dt>
              <dd>{selected.clientLabel ?? 'Não identificado'}</dd>
              <dt className="text-gray-500">Situação</dt>
              <dd>{BUCKET_LABELS[selected.bucket]}</dd>
              <dt className="text-gray-500">Valor</dt>
              <dd>{amountLabel(selected.amount, selected.currencyCode)}</dd>
              <dt className="text-gray-500">Origem</dt>
              <dd>{selected.origin}</dd>
              <dt className="text-gray-500">Última atualização</dt>
              <dd>{formatDateTimePtBr(selected.updatedAt)}</dd>
              {selected.exceptionDetail ? (
                <>
                  <dt className="text-gray-500">Exceção</dt>
                  <dd>{selected.exceptionDetail}</dd>
                </>
              ) : null}
            </dl>
            <Link
              className="inline-flex min-h-[var(--control-height)] items-center rounded-md bg-brand-700 px-3 font-medium text-white hover:bg-brand-800"
              to={`/app/service-orders/${selected.serviceOrderId}/billing`}
            >
              Abrir registro e comandos
            </Link>
          </div>
        ) : null}
      </DynamicContextDrawer>
    </ModulePage>
  );
}
