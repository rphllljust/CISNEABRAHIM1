import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { getBillingRecord } from '../api/billing-api';
import {
  downloadBillingDocumentPdf,
  issueBillingDocument,
  listBillingDocuments,
} from '../api/billing-document-api';
import { mapBillingErrorToMessage } from '../api/billing-error-messages';
import { BillingCommercialTermsMismatchPanel } from '../components/BillingCommercialTermsMismatchPanel';
import { BillingDocumentIssueDialog } from '../components/BillingDocumentIssueDialog';
import { BillingDocumentIssuedList } from '../components/BillingDocumentIssuedList';
import { BillingDocumentPreview } from '../components/BillingDocumentPreview';
import { BillingItemsCards } from '../components/BillingItemsCards';
import { BillingItemsTable } from '../components/BillingItemsTable';
import { BillingStatusBadge } from '../components/BillingStatusBadge';
import { BillingSummaryPanel } from '../components/BillingSummaryPanel';
import { useBillingCapabilities } from '../hooks/useBillingCapabilities';
import { BusinessChain, useBusinessChain } from '../../business-chain';
import {
  ModuleDeniedState,
  ModuleErrorState,
  ModuleLoadingState,
  ModulePage,
  ModuleStatePage,
} from '../../ui';
import {
  BILLING_ERROR_CODES,
  BILLING_RECORD_STATUSES,
  type BillingDocumentDetail,
  type BillingRecordDetail,
} from '../types/billing.types';
import {
  buildBillingDocumentPreview,
  hasActiveFinalizedDocument,
  resolveBillingRecordTermsDivergence,
} from '../utils/billing-document-preview';
import { formatDatePtBr, formatPaymentDueHint, formatTaxId } from '../utils/billing-format';
import { formatAddressLine } from '../utils/billing-document-format';
import {
  buildCommercialTermsDivergence,
  readCommercialReferenceLabel,
  resolveAuthoritativePaymentTerms,
} from '../utils/billing-process';
import { getServiceOrder, ServiceOrdersApiError } from '../../service-orders/api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../../service-orders/api/service-orders-error-messages';
import type { ServiceOrderDetail } from '../../service-orders/types/service-order.types';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      billing: BillingRecordDetail;
      documents: BillingDocumentDetail[];
    };

export function ServiceOrderBillingDocumentPage() {
  const { serviceOrderId = '' } = useParams();
  const feedbackId = useId();
  const { capabilities } = useBillingCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  );
  const [dueDate, setDueDate] = useState('');
  const [issueOpen, setIssueOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string | null>(null);
  const requestSeq = useRef(0);
  const pendingIssueRef = useRef(false);
  const issueIdempotencyRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    try {
      const [order, billing] = await Promise.all([
        getServiceOrder(serviceOrderId),
        getBillingRecord(serviceOrderId),
      ]);
      if (!billing || billing.status !== BILLING_RECORD_STATUSES.Prepared) {
        if (seq !== requestSeq.current) {
          return;
        }
        setState({ phase: 'not_found' });
        return;
      }
      const documents = await listBillingDocuments(serviceOrderId, billing.id);
      if (seq !== requestSeq.current) {
        return;
      }
      setDueDate('');
      setState({ phase: 'ready', order, billing, documents });
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
            : 'Não foi possível carregar a emissão do documento.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const billing = state.phase === 'ready' ? state.billing : null;
  const order = state.phase === 'ready' ? state.order : null;
  const documents = state.phase === 'ready' ? state.documents : [];

  // Cadeia empresarial ancorada no REGISTRO de faturamento: mostra de onde veio
  // (medição/OS) e o que ele gerou (recebível), sem o front remontar linhagem.
  const businessChain = useBusinessChain('BILLING_DOCUMENT', billing?.id ?? '');

  const commercialReferenceLabel = useMemo(
    () => readCommercialReferenceLabel(billing?.commercialReferenceSnapshot ?? null),
    [billing],
  );

  const poNumber =
    billing?.purchaseOrderId && order?.purchaseOrderSnapshot
      ? ((order.purchaseOrderSnapshot as { poNumber?: string }).poNumber ?? billing.purchaseOrderId)
      : null;

  const termsDivergence = useMemo(() => {
    if (!billing || !order) {
      return null;
    }
    const recordDivergence = resolveBillingRecordTermsDivergence(billing);
    if (recordDivergence) {
      return buildCommercialTermsDivergence(
        {
          value: recordDivergence.authoritativeValue,
          label: 'Fonte autoritativa registrada',
          source: billing.paymentTermsSource,
        },
        recordDivergence.declaredValue,
      );
    }
    const authoritative = resolveAuthoritativePaymentTerms(order);
    if (authoritative) {
      return buildCommercialTermsDivergence(authoritative, billing.paymentTerms);
    }
    return null;
  }, [billing, order]);

  const activeDocument = documents.find((doc) => doc.status === 'FINALIZED');
  const preview = billing
    ? buildBillingDocumentPreview(billing, {
        dueDate: dueDate || null,
        documentNumber: activeDocument?.documentNumber ?? null,
        purchaseOrderNumber: poNumber,
        commercialReferenceLabel,
        // Emissor sempre do documento emitido (originado no registro backend);
        // sem documento emitido o preview não inventa identidade fiscal.
        emitter: activeDocument
          ? {
              legalName: activeDocument.emitterLegalName,
              taxId: activeDocument.emitterTaxId,
              addressLine: formatAddressLine(activeDocument.emitterAddressSnapshot ?? {}),
            }
          : null,
      })
    : null;

  const canIssue =
    capabilities.canIssueDocument &&
    billing?.status === BILLING_RECORD_STATUSES.Prepared &&
    !hasActiveFinalizedDocument(documents) &&
    !termsDivergence;

  const handleIssue = async () => {
    if (!billing || state.phase !== 'ready' || submitting || pendingIssueRef.current) {
      return;
    }
    pendingIssueRef.current = true;
    setSubmitting(true);
    setFeedback(null);
    const key = issueIdempotencyRef.current ?? idempotencyKey ?? crypto.randomUUID();
    issueIdempotencyRef.current = key;
    setIdempotencyKey(key);
    try {
      const issued = await issueBillingDocument(serviceOrderId, billing.id, {
        dueDate: dueDate.trim() || null,
        idempotencyKey: key,
      });
      setIssueOpen(false);
      setIdempotencyKey(null);
      issueIdempotencyRef.current = null;
      setFeedback({
        tone: 'success',
        message: `Nota Fatura ${issued.documentNumber} emitida com sucesso.`,
      });
      setState({
        ...state,
        documents: [issued, ...state.documents.filter((doc) => doc.id !== issued.id)],
      });
    } catch (error) {
      if (error instanceof ServiceOrdersApiError) {
        if (error.code === BILLING_ERROR_CODES.BILLING_DOCUMENT_ALREADY_EXISTS) {
          setFeedback({
            tone: 'error',
            message: mapBillingErrorToMessage(error.code, error.status),
          });
          void reload();
          return;
        }
        setFeedback({
          tone: 'error',
          message: mapBillingErrorToMessage(error.code, error.status),
        });
        return;
      }
      setFeedback({ tone: 'error', message: 'Não foi possível emitir a Nota Fatura.' });
    } finally {
      pendingIssueRef.current = false;
      setSubmitting(false);
    }
  };

  const handleDownload = async (billingDocument: BillingDocumentDetail) => {
    if (!billing) {
      return;
    }
    setDownloadingId(billingDocument.id);
    try {
      const { blob, filename } = await downloadBillingDocumentPdf(
        serviceOrderId,
        billing.id,
        billingDocument.id,
      );
      const url = URL.createObjectURL(blob);
      const anchor = window.document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapBillingErrorToMessage(error.code, error.status)
            : 'Não foi possível baixar o PDF.',
      });
    } finally {
      setDownloadingId(null);
    }
  };

  const handlePrintPreview = () => {
    window.print();
  };

  /*
    ESTADOS PELA MOLDURA COMPARTILHADA — mesmos motivos de `ServiceOrderBillingPage`: cada bloco
    abria o proprio `<main id="main-content">` com `<h1>` manual, duplicando o landmark e o titulo.
  */
  if (state.phase === 'loading') {
    return (
      <ModuleStatePage title="Nota Fatura digital">
        <ModuleLoadingState message="Carregando emissão…" />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'denied') {
    return (
      <ModuleStatePage title="Nota Fatura digital">
        <ModuleDeniedState message="Você não tem permissão para emitir documentos de faturamento." />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'not_found' || !billing || !order || !preview) {
    return (
      <ModuleStatePage title="Nota Fatura digital">
        <ModuleErrorState
          title="Nota Fatura digital"
          message="Preparação de faturamento não encontrada ou indisponível para emissão."
          retryable={false}
        />
      </ModuleStatePage>
    );
  }

  if (state.phase === 'error') {
    return (
      <ModuleStatePage title="Nota Fatura digital">
        <ModuleErrorState message={state.message} retryable onRetry={() => void reload()} />
      </ModuleStatePage>
    );
  }

  const dueHint = formatPaymentDueHint(billing.paymentTerms, billing.preparedAt);

  return (
    <ModulePage>
      <header className="billing-page__header billing-doc-page__header">
        <p className="billing-page__eyebrow">Nota Fatura digital</p>
        <div className="billing-page__title-row">
          <h1>{order.orderNumber}</h1>
          <BillingStatusBadge status={billing.status} />
        </div>
        <p className="billing-page__meta">
          Documento interno · PDF gerado pelo servidor
        </p>
        <nav className="billing-page__nav" aria-label="Fluxo de faturamento">
          <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Preparação</Link>
          <Link to="/app/billing">Painel</Link>
        </nav>
      </header>

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

      <nav className="billing-doc-workflow-nav" aria-label="Etapas do documento">
        <a href="#doc-summary">Resumo</a>
        <a href="#doc-client">Cliente</a>
        <a href="#doc-reference">Referências</a>
        <a href="#doc-items">Itens</a>
        <a href="#doc-payment">Pagamento</a>
        <a href="#doc-divergence">Divergências</a>
        <a href="#doc-preview">Pré-visualização</a>
      </nav>

      {/*
        LINHAGEM DO FATURAMENTO — a cadeia real do negócio ancorada no documento, vinda
        do read model do backend em UMA requisição: medição (o que foi executado),
        faturamento (esta preparação), recebível (o que o faturamento gerou) e o que
        vier depois dele. O servidor já omitiu todo nó não autorizado.
      */}
      <BusinessChain
        chain={businessChain.chain}
        phase={businessChain.phase}
        message={businessChain.message}
        onRetry={businessChain.retry}
        title="Cadeia de negócio do faturamento"
      />

      <div className="billing-doc-workflow">
        <section id="doc-summary" className="billing-section billing-doc-workflow__section">
          <h2>Resumo do faturamento</h2>
          <BillingSummaryPanel
            itemCount={billing.items.length}
            totalAmount={billing.totalAmount}
            currencyCode={billing.currencyCode}
            paymentTerms={billing.paymentTerms}
            preparedAt={billing.preparedAt}
          />
        </section>

        <section id="doc-client" className="billing-section billing-doc-workflow__section">
          <h2>Dados do cliente</h2>
          <dl className="billing-context">
            <div>
              <dt>Razão social</dt>
              <dd>{billing.clientLegalNameSnapshot}</dd>
            </div>
            <div>
              <dt>CNPJ / CPF</dt>
              <dd>{formatTaxId(billing.clientTaxIdSnapshot)}</dd>
            </div>
            <div>
              <dt>Endereço de faturamento</dt>
              <dd>{preview.billingAddressLine}</dd>
            </div>
          </dl>
          <p className="billing-doc-readonly-note">Dados derivados do snapshot da preparação (somente leitura).</p>
        </section>

        <section id="doc-reference" className="billing-section billing-doc-workflow__section">
          <h2>Referências comerciais</h2>
          <dl className="billing-context">
            <div>
              <dt>Referência</dt>
              <dd>{commercialReferenceLabel}</dd>
            </div>
            {poNumber ? (
              <div>
                <dt>PO / RC</dt>
                <dd>{poNumber}</dd>
              </div>
            ) : null}
            {billing.contractReference ? (
              <div>
                <dt>Contrato</dt>
                <dd>{billing.contractReference}</dd>
              </div>
            ) : null}
          </dl>
        </section>

        <section id="doc-items" className="billing-section billing-doc-workflow__section">
          <h2>Itens</h2>
          <BillingItemsTable items={billing.items} currencyCode={billing.currencyCode} />
          <BillingItemsCards items={billing.items} currencyCode={billing.currencyCode} />
        </section>

        <section id="doc-payment" className="billing-section billing-doc-workflow__section">
          <h2>Pagamento e vencimento</h2>
          <dl className="billing-context">
            <div>
              <dt>Condição de pagamento</dt>
              <dd>{billing.paymentTerms}</dd>
            </div>
            <div>
              <dt>Estimativa (DDL)</dt>
              <dd>{dueHint}</dd>
            </div>
          </dl>
          {canIssue ? (
            <label className="billing-field">
              <span id="billing-doc-due-date-label">Data de vencimento (opcional)</span>
              <input
                type="date"
                aria-labelledby="billing-doc-due-date-label"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
              <span className="billing-field__hint">
                Único campo editável nesta emissão. Demais valores vêm da preparação.
              </span>
            </label>
          ) : (
            <p className="billing-doc-readonly-note">
              Vencimento: {dueDate ? formatDatePtBr(dueDate) : dueHint}
            </p>
          )}
        </section>

        <section id="doc-divergence" className="billing-section billing-doc-workflow__section">
          <h2>Divergências</h2>
          {termsDivergence ? (
            <BillingCommercialTermsMismatchPanel divergence={termsDivergence} />
          ) : (
            <p className="billing-doc-readonly-note">Nenhuma divergência comercial bloqueante detectada.</p>
          )}
        </section>

        <section id="doc-preview" className="billing-section billing-doc-workflow__section">
          <div className="billing-doc-preview-toolbar">
            <h2>Pré-visualização</h2>
            <button type="button" className="billing-button billing-doc-preview__print" onClick={handlePrintPreview}>
              Imprimir pré-visualização
            </button>
          </div>
          <p className="billing-doc-readonly-note">
            Visualização fiel ao layout interno. O PDF persistido é gerado exclusivamente pelo backend.
          </p>
          <BillingDocumentPreview model={preview} />
        </section>

        <section className="billing-section billing-doc-workflow__section" aria-labelledby="doc-issued-heading">
          <h2 id="doc-issued-heading">Documentos emitidos</h2>
          <BillingDocumentIssuedList
            documents={documents}
            onDownload={(doc) => void handleDownload(doc)}
            downloadingId={downloadingId}
          />
        </section>
      </div>

      <footer className="billing-doc-sticky-actions">
        {canIssue ? (
          <button
            type="button"
            className="billing-button billing-button--primary"
            disabled={submitting || Boolean(termsDivergence)}
            onClick={() => setIssueOpen(true)}
          >
            Emitir Nota Fatura
          </button>
        ) : activeDocument ? (
          <p className="billing-doc-sticky-actions__note">
            Documento ativo: {activeDocument.documentNumber}
          </p>
        ) : (
          <p className="billing-doc-sticky-actions__note">
            Emissão indisponível no estado atual.
          </p>
        )}
      </footer>

      <BillingDocumentIssueDialog
        open={issueOpen}
        preview={preview}
        termsDivergence={termsDivergence}
        confirming={submitting}
        onClose={() => setIssueOpen(false)}
        onConfirm={() => void handleIssue()}
      />
    </ModulePage>
  );
}
