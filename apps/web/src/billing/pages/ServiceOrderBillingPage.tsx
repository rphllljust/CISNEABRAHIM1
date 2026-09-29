import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { getBillingRecord, prepareBillingRecord, voidBillingRecord } from '../api/billing-api';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';
import { BillingCommercialTermsMismatchPanel } from '../components/BillingCommercialTermsMismatchPanel';
import { BillingItemsCards } from '../components/BillingItemsCards';
import { BillingItemsTable } from '../components/BillingItemsTable';
import { BillingPrepareDialog } from '../components/BillingPrepareDialog';
import { BillingStatusBadge } from '../components/BillingStatusBadge';
import { BillingSummaryPanel } from '../components/BillingSummaryPanel';
import { BillingVersionConflictBanner } from '../components/BillingVersionConflictBanner';
import { BillingVoidDialog } from '../components/BillingVoidDialog';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import {
  BILLING_ERROR_CODES,
  BILLING_RECORD_STATUSES,
  type BillingRecordDetail,
} from '../types/billing.types';
import {
  buildCommercialTermsDivergence,
  readClientLabel,
  readCommercialReferenceLabel,
  readDocumentLabels,
  resolveAuthoritativePaymentTerms,
  suggestDeclaredPaymentTerms,
} from '../utils/billing-process';
import { formatDateTimePtBr, formatTaxId, sumMoneyLines } from '../utils/billing-format';
import { getMeasurement } from '../../service-orders/api/measurement-api';
import { getServiceOrder, ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import { MEASUREMENT_STATUSES, type MeasurementDetail } from '../../service-orders/types/measurement.types';
import type { ServiceOrderDetail } from '../../service-orders/types/service-order.types';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
} from '../../ui';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      measurement: MeasurementDetail | null;
      billing: BillingRecordDetail | null;
    };

export function ServiceOrderBillingPage() {
  const { serviceOrderId = '' } = useParams();
  const feedbackId = useId();
  const { capabilities } = useBillingCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  );
  const [paymentTerms, setPaymentTerms] = useState('');
  const [prepareOpen, setPrepareOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    setVersionConflict(false);
    try {
      const [order, measurement, billing] = await Promise.all([
        getServiceOrder(serviceOrderId),
        getMeasurement(serviceOrderId),
        getBillingRecord(serviceOrderId),
      ]);
      if (seq !== requestSeq.current) {
        return;
      }
      setPaymentTerms(billing?.paymentTerms ?? suggestDeclaredPaymentTerms(order));
      setState({ phase: 'ready', order, measurement, billing });
    } catch (error) {
      if (seq !== requestSeq.current) {
        return;
      }
      if (error instanceof ServiceOrdersApiError) {
        if (error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        if (error.kind === 'not_found') {
          setState({ phase: 'not_found' });
          return;
        }
      }
      setState({
        phase: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapServiceOrdersErrorToMessage(error.code, error.status)
            : 'Não foi possível carregar o faturamento.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handlePrepare = async () => {
    if (state.phase !== 'ready' || !state.measurement) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const billing = await prepareBillingRecord(serviceOrderId, {
        measurementId: state.measurement.id,
        paymentTerms: paymentTerms.trim(),
      });
      setPrepareOpen(false);
      setFeedback({ tone: 'success', message: 'Preparação de faturamento concluída.' });
      setState({ ...state, billing });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError) {
        if (error.code === BILLING_ERROR_CODES.COMMERCIAL_TERMS_MISMATCH) {
          setFeedback({
            tone: 'error',
            message: mapBillingErrorToMessage(error.code, error.status),
          });
          setPrepareOpen(false);
          return;
        }
        if (error.code === BILLING_ERROR_CODES.BILLING_AMOUNT_MISMATCH) {
          setFeedback({
            tone: 'error',
            message: mapBillingErrorToMessage(error.code, error.status),
          });
          return;
        }
        if (error.kind === 'version_conflict') {
          setVersionConflict(true);
          return;
        }
        setFeedback({
          tone: 'error',
          message: mapBillingErrorToMessage(error.code, error.status),
        });
        return;
      }
      setFeedback({ tone: 'error', message: 'Não foi possível preparar o faturamento.' });
    } finally {
      setSubmitting(false);
    }
  };

  const handleVoid = async () => {
    if (state.phase !== 'ready' || !state.billing) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const billing = await voidBillingRecord(serviceOrderId, state.billing.id, {
        rowVersion: state.billing.rowVersion,
        voidReason: voidReason.trim() || undefined,
      });
      setVoidOpen(false);
      setVoidReason('');
      setFeedback({ tone: 'success', message: 'Preparação anulada.' });
      setState({ ...state, billing });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        return;
      }
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapBillingErrorToMessage(error.code, error.status)
            : 'Não foi possível anular a preparação.',
      });
    } finally {
      setSubmitting(false);
    }
  };

  /*
    ESTADOS PELA MOLDURA COMPARTILHADA.
    Cada um destes blocos abria o proprio `<main id="main-content" class="shell-page billing-page">`
    com um `<h1>` manual — o landmark era duplicado em toda pagina que exibia carga, negacao ou
    erro, e o titulo aparecia duas vezes. `ModuleStatePage` mantem o titulo da pagina e o bloco de
    estado na MESMA hierarquia das telas que ja carregaram.
  */
  if (state.phase === 'loading') {
    return (
      <ModuleStatePage title="Faturamento">
        <ModuleLoadingState message="Carregando faturamento…" />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModuleStatePage title="Faturamento">
        <ModuleDeniedState message="Você não tem permissão para acessar este faturamento." />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <ModuleStatePage title="Faturamento">
        <ModuleErrorState
          title="Faturamento"
          message="Ordem de serviço não encontrada."
          retryable={false}
        />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModuleStatePage title="Faturamento">
        <ModuleErrorState message={state.message} retryable onRetry={() => void reload()} />
      </ModuleStatePage>
    );
  }

  const { order, measurement, billing } = state;
  const authoritative = resolveAuthoritativePaymentTerms(order);
  const termsDivergence =
    authoritative && paymentTerms.trim()
      ? buildCommercialTermsDivergence(authoritative, paymentTerms)
      : null;
  const displayItems = billing?.items ?? measurement?.items ?? [];
  const currencyCode = billing?.currencyCode ?? 'BRL';
  const totalAmount =
    billing?.totalAmount ?? sumMoneyLines(displayItems.map((item) => ('lineAmount' in item ? item.lineAmount : null)));
  const commercialSnapshot =
    billing?.commercialReferenceSnapshot ?? measurement?.commercialReferenceSnapshot ?? null;
  const documentLabels = readDocumentLabels(commercialSnapshot);
  const canPrepare =
    capabilities.canPrepare &&
    !versionConflict &&
    measurement?.status === MEASUREMENT_STATUSES.Approved &&
    (!billing || billing.status === BILLING_RECORD_STATUSES.Voided);
  const canVoid =
    capabilities.canVoid && !versionConflict && billing?.status === BILLING_RECORD_STATUSES.Prepared;

  return (
    <ModulePage>
      <header className="billing-page__header">
        <p className="billing-page__eyebrow">Faturamento operacional</p>
        <div className="billing-page__title-row">
          <h1>{order.orderNumber}</h1>
          {billing ? <BillingStatusBadge status={billing.status} /> : null}
        </div>
        <p className="billing-page__meta">
          <span>{readClientLabel(order)}</span>
          <span>{order.serviceSnapshot.serviceName}</span>
        </p>
        <nav className="billing-page__nav" aria-label="Fluxo da ordem de serviço">
          <Link to={`/app/service-orders/${order.id}/measurement`}>Medição</Link>
          <Link to="/app/billing">Painel de faturamento</Link>
        </nav>
      </header>

      {versionConflict ? <BillingVersionConflictBanner onReload={() => void reload()} /> : null}

      {feedback ? (
        <p
          id={feedbackId}
          className={`billing-feedback billing-feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {feedback.message}
        </p>
      ) : null}

      {termsDivergence ? (
        <BillingCommercialTermsMismatchPanel
          divergence={termsDivergence}
          onUseAuthoritative={() => setPaymentTerms(authoritative!.value)}
        />
      ) : null}

      {canPrepare ? (
        <label className="billing-field">
          <span id="billing-payment-terms-label">Condição comercial para preparação</span>
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            aria-labelledby="billing-payment-terms-label"
            value={paymentTerms}
            onChange={(event) => setPaymentTerms(event.target.value)}
          />
        </label>
      ) : null}

      <section className="billing-section" aria-labelledby="billing-context-heading">
        <h2 id="billing-context-heading">Contexto</h2>
        <dl className="billing-context">
          <div>
            <dt>Cliente</dt>
            <dd>{billing?.clientLegalNameSnapshot ?? readClientLabel(order)}</dd>
          </div>
          <div>
            <dt>CNPJ</dt>
            <dd>{formatTaxId(billing?.clientTaxIdSnapshot ?? null)}</dd>
          </div>
          <div>
            <dt>Ordem de serviço</dt>
            <dd>{order.orderNumber}</dd>
          </div>
          <div>
            <dt>Medição</dt>
            <dd>{measurement ? `${measurement.status} · ${measurement.id.slice(0, 8)}…` : '—'}</dd>
          </div>
          <div>
            <dt>PO / Proposta</dt>
            <dd>{readCommercialReferenceLabel(commercialSnapshot)}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd>{billing ? <BillingStatusBadge status={billing.status} /> : 'Aguardando preparação'}</dd>
          </div>
          <div>
            <dt>Preparado em</dt>
            <dd>{formatDateTimePtBr(billing?.preparedAt ?? null)}</dd>
          </div>
        </dl>
      </section>

      <BillingSummaryPanel
        itemCount={displayItems.length}
        totalAmount={totalAmount}
        currencyCode={currencyCode}
        paymentTerms={billing?.paymentTerms ?? paymentTerms}
        preparedAt={billing?.preparedAt}
      />

      <section className="billing-section" aria-labelledby="billing-items-heading">
        <h2 id="billing-items-heading">Itens faturáveis</h2>
        <BillingItemsTable
          items={
            billing?.items ??
            measurement?.items.map((item, index) => ({
              id: item.id,
              lineNumber: item.lineNumber ?? index + 1,
              measurementItemId: item.id,
              sourceExecutionEntryId: item.sourceExecutionEntryId,
              unitCode: item.unitCode,
              quantity: item.measuredQuantity,
              unitPrice: item.unitPrice,
              lineAmount: item.lineAmount ?? '0',
              pricingLineSnapshot: item.pricingLineSnapshot,
              lineLabel: `Linha ${item.lineNumber ?? index + 1}`,
            })) ??
            []
          }
          currencyCode={currencyCode}
        />
        <BillingItemsCards
          items={
            billing?.items ??
            measurement?.items.map((item, index) => ({
              id: item.id,
              lineNumber: item.lineNumber ?? index + 1,
              measurementItemId: item.id,
              sourceExecutionEntryId: item.sourceExecutionEntryId,
              unitCode: item.unitCode,
              quantity: item.measuredQuantity,
              unitPrice: item.unitPrice,
              lineAmount: item.lineAmount ?? '0',
              pricingLineSnapshot: item.pricingLineSnapshot,
              lineLabel: `Linha ${item.lineNumber ?? index + 1}`,
            })) ??
            []
          }
          currencyCode={currencyCode}
        />
      </section>

      <section className="billing-section" aria-labelledby="billing-documents-heading">
        <h2 id="billing-documents-heading">Documentos</h2>
        {documentLabels.length > 0 ? (
          <ul className="billing-documents">
            {documentLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        ) : (
          <p className="billing-documents__empty">Nenhum documento vinculado nesta referência comercial.</p>
        )}
      </section>

      <footer className="billing-actions">
        {billing?.status === BILLING_RECORD_STATUSES.Prepared && capabilities.canIssueDocument ? (
          <Link
            to={`/app/service-orders/${order.id}/billing/document`}
            className="billing-button billing-button--primary"
          >
            Emitir Nota Fatura
          </Link>
        ) : null}
        {canPrepare ? (
          <button
            type="button"
            className="billing-button billing-button--primary"
            disabled={Boolean(termsDivergence) || submitting}
            onClick={() => setPrepareOpen(true)}
          >
            Preparar faturamento
          </button>
        ) : null}
        {canVoid ? (
          <button
            type="button"
            className="billing-button billing-button--danger"
            disabled={submitting}
            onClick={() => setVoidOpen(true)}
          >
            Anular preparação
          </button>
        ) : null}
      </footer>

      <BillingPrepareDialog
        open={prepareOpen}
        paymentTerms={paymentTerms}
        totalAmount={totalAmount}
        currencyCode={currencyCode}
        onPaymentTermsChange={setPaymentTerms}
        onClose={() => setPrepareOpen(false)}
        onConfirm={() => void handlePrepare()}
        confirming={submitting}
      />

      <BillingVoidDialog
        open={voidOpen}
        voidReason={voidReason}
        onVoidReasonChange={setVoidReason}
        onClose={() => setVoidOpen(false)}
        onConfirm={() => void handleVoid()}
        confirming={submitting}
      />
    </ModulePage>
  );
}
