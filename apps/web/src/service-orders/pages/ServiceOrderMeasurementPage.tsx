import { Link, useParams } from 'react-router-dom';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { getExecutionBundle } from '../api/service-order-execution-api';
import {
  approveMeasurement,
  createMeasurement,
  getMeasurement,
  rejectMeasurement,
  resubmitMeasurement,
  startMeasurementReview,
  submitMeasurement,
} from '../api/measurement-api';
import { mapMeasurementsErrorToMessage } from '../api/measurements-error-messages';
import { listPlannedResources } from '../api/service-order-planning-api';
import { getServiceOrder, ServiceOrdersApiError } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import { MeasurementApprovalDialog } from '../components/MeasurementApprovalDialog';
import { MeasurementComparisonCards } from '../components/MeasurementComparisonCards';
import { MeasurementComparisonTable } from '../components/MeasurementComparisonTable';
import { MeasurementStatusBadge } from '../components/MeasurementStatusBadge';
import { MeasurementSummaryPanel } from '../components/MeasurementSummaryPanel';
import { MeasurementTimeline } from '../components/MeasurementTimeline';
import { MeasurementVersionConflictBanner } from '../components/MeasurementVersionConflictBanner';
import { useMeasurementCapabilities } from '../hooks/useMeasurementCapabilities';
import {
  MEASUREMENT_STATUSES,
  MEASUREMENTS_ERROR_CODES,
  type MeasurementDetail,
} from '../types/measurement.types';
import type { PlannedResource } from '../types/resource-planning.types';
import { SERVICE_ORDER_STATUSES, type ServiceOrderDetail } from '../types/service-order.types';
import { buildMeasurementComparisonRows } from '../utils/measurement-comparison';
import { sumMoneyLines } from '../utils/measurement-format';
import { buildRequirementCoverage, collectSatisfiedEvidenceKinds, parseExecutionRequirements } from '../utils/execution-requirements';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      measurement: MeasurementDetail | null;
      planned: PlannedResource[];
      evidencePending: boolean;
    };

function readClientLabel(order: ServiceOrderDetail): string {
  if (!order.clientSnapshot) {
    return 'Cliente';
  }
  const tradeName = order.clientSnapshot.tradeName;
  const legalName = order.clientSnapshot.legalName;
  if (typeof tradeName === 'string' && tradeName.trim()) {
    return tradeName;
  }
  if (typeof legalName === 'string' && legalName.trim()) {
    return legalName;
  }
  return 'Cliente';
}

export function ServiceOrderMeasurementPage() {
  const { serviceOrderId = '' } = useParams();
  const feedbackId = useId();
  const { capabilities } = useMeasurementCapabilities();
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  );
  const [submitting, setSubmitting] = useState(false);
  const [versionConflict, setVersionConflict] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const requestSeq = useRef(0);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    setVersionConflict(false);
    try {
      const [order, planned, measurement, execution] = await Promise.all([
        getServiceOrder(serviceOrderId),
        listPlannedResources(serviceOrderId),
        getMeasurement(serviceOrderId),
        getExecutionBundle(serviceOrderId).catch(() => null),
      ]);
      if (seq !== requestSeq.current) {
        return;
      }

      const requirements = parseExecutionRequirements(order.serviceSnapshot);
      const satisfied = execution ? collectSatisfiedEvidenceKinds(execution) : new Set<string>();
      const coverage = buildRequirementCoverage(requirements, satisfied);
      const evidencePending = coverage.some(
        (item) => item.requirementLevel === 'REQUIRED' && !item.satisfied,
      );

      setState({ phase: 'ready', order, measurement, planned, evidencePending });
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
            : 'Não foi possível carregar a medição.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreateMeasurement() {
    if (state.phase !== 'ready' || submitting) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const measurement = await createMeasurement(serviceOrderId);
      setState({ ...state, measurement });
      setFeedback({ tone: 'success', message: 'Medição criada a partir da execução.' });
    } catch (error) {
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapMeasurementsErrorToMessage(error.code, error.status)
            : 'Não foi possível criar a medição.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  async function runTransition(
    action: () => Promise<MeasurementDetail>,
    successMessage: string,
  ) {
    if (state.phase !== 'ready' || !state.measurement || submitting || versionConflict) {
      return;
    }
    setSubmitting(true);
    setFeedback(null);
    try {
      const measurement = await action();
      setState({ ...state, measurement });
      setFeedback({ tone: 'success', message: successMessage });
      setApproveOpen(false);
      setRejectOpen(false);
    } catch (error) {
      if (error instanceof ServiceOrdersApiError && error.kind === 'version_conflict') {
        setVersionConflict(true);
        setFeedback({
          tone: 'error',
          message: mapMeasurementsErrorToMessage(MEASUREMENTS_ERROR_CODES.VERSION_CONFLICT, error.status),
        });
        return;
      }
      setFeedback({
        tone: 'error',
        message:
          error instanceof ServiceOrdersApiError
            ? mapMeasurementsErrorToMessage(error.code, error.status)
            : 'Não foi possível concluir a operação.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  if (state.phase === 'loading') {
    return (
      <main id="main-content" className="shell-page measurement-page">
        <p aria-busy="true" aria-live="polite">
          Carregando medição…
        </p>
      </main>
    );
  }

  if (state.phase === 'denied') {
    return (
      <main id="main-content" className="shell-page measurement-page">
        <p role="alert">Você não tem permissão para conferir medições desta ordem de serviço.</p>
      </main>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <main id="main-content" className="shell-page measurement-page">
        <p role="alert">Ordem de serviço não encontrada.</p>
      </main>
    );
  }

  if (state.phase === 'error') {
    return (
      <main id="main-content" className="shell-page measurement-page">
        <p role="alert">{state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </main>
    );
  }

  const { order, measurement, planned, evidencePending } = state;
  const comparisonRows = measurement
    ? buildMeasurementComparisonRows({
        items: measurement.items,
        planned,
        serviceSnapshot: order.serviceSnapshot,
        evidencePending,
      })
    : [];
  const totalAmount = sumMoneyLines(measurement?.items.map((item) => item.lineAmount) ?? []);
  const status = measurement?.status ?? MEASUREMENT_STATUSES.Draft;
  const actionsBlocked = versionConflict || submitting;
  const canCreate =
    capabilities.canCreate &&
    !measurement &&
    order.status === SERVICE_ORDER_STATUSES.Completed &&
    !actionsBlocked;
  const canSubmit =
    capabilities.canSubmit && measurement?.status === MEASUREMENT_STATUSES.Draft;
  const canStartReview =
    capabilities.canReview && measurement?.status === MEASUREMENT_STATUSES.Submitted;
  const canApprove =
    capabilities.canApprove && measurement?.status === MEASUREMENT_STATUSES.UnderReview;
  const canReject =
    capabilities.canReject && measurement?.status === MEASUREMENT_STATUSES.UnderReview;
  const canResubmit =
    capabilities.canUpdate && measurement?.status === MEASUREMENT_STATUSES.Rejected;

  return (
    <main id="main-content" className="shell-page measurement-page">
      <header className="measurement-page__header">
        <p className="measurement-page__eyebrow">Conferência de medição</p>
        <div className="measurement-page__title-row">
          <h1>{order.orderNumber}</h1>
          {measurement ? <MeasurementStatusBadge status={status} /> : null}
        </div>
        <p className="measurement-page__meta">
          {order.serviceSnapshot.serviceName} · {readClientLabel(order)}
        </p>
        <nav className="measurement-page__links" aria-label="Atalhos da ordem de serviço">
          <Link to={`/app/service-orders/${serviceOrderId}/planning`}>Planejamento</Link>
          <Link to={`/app/service-orders/${serviceOrderId}/execution`}>Execução</Link>
          <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Faturamento</Link>
        </nav>
      </header>

      {versionConflict ? <MeasurementVersionConflictBanner onReload={() => void reload()} /> : null}

      <div
        id={feedbackId}
        className={
          feedback
            ? `measurement-feedback measurement-feedback--${feedback.tone}`
            : 'measurement-sr-only'
        }
        role={feedback ? 'status' : undefined}
        aria-live="polite"
      >
        {feedback?.message}
      </div>

      {!measurement ? (
        <section className="measurement-section" aria-labelledby="measurement-empty-title">
          <h2 id="measurement-empty-title">Medição ainda não gerada</h2>
          <p className="measurement-hint">
            A medição será derivada dos registros de execução (realizado) com referência comercial
            capturada no momento da criação.
          </p>
          {order.status !== SERVICE_ORDER_STATUSES.Completed ? (
            <p className="measurement-feedback measurement-feedback--info" role="status">
              A ordem de serviço precisa estar concluída para gerar medição.
            </p>
          ) : null}
          {canCreate ? (
            <button type="button" disabled={submitting} onClick={() => void handleCreateMeasurement()}>
              Gerar medição
            </button>
          ) : null}
        </section>
      ) : (
        <>
          <MeasurementSummaryPanel
            rows={comparisonRows}
            itemCount={measurement.items.length}
            totalAmount={totalAmount}
          />

          <section className="measurement-section" aria-labelledby="measurement-compare-title">
            <h2 id="measurement-compare-title">Planejado · Realizado · Medido</h2>
            <p className="measurement-hint measurement-legend" aria-hidden="true">
              <span className="measurement-legend__item measurement-legend__item--planned">Planejado</span>
              <span className="measurement-legend__item measurement-legend__item--actual">Realizado</span>
              <span className="measurement-legend__item measurement-legend__item--measured">Medido</span>
            </p>

            <div className="measurement-compare measurement-compare--desktop">
              <MeasurementComparisonTable rows={comparisonRows} />
            </div>
            <div className="measurement-compare measurement-compare--mobile">
              <MeasurementComparisonCards rows={comparisonRows} />
            </div>
          </section>

          <section className="measurement-section measurement-actions" aria-labelledby="measurement-actions-title">
            <h2 id="measurement-actions-title">Decisão</h2>
            <div className="measurement-actions__row">
              {canSubmit ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        submitMeasurement(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Medição submetida para análise.',
                    )
                  }
                >
                  Submeter medição
                </button>
              ) : null}
              {canStartReview ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        startMeasurementReview(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Análise iniciada.',
                    )
                  }
                >
                  Iniciar análise
                </button>
              ) : null}
              {canApprove ? (
                <button
                  type="button"
                  className="measurement-actions__approve"
                  disabled={actionsBlocked}
                  onClick={() => setApproveOpen(true)}
                >
                  Aprovar medição…
                </button>
              ) : null}
              {canReject ? (
                <button
                  type="button"
                  className="measurement-actions__reject"
                  disabled={actionsBlocked}
                  onClick={() => setRejectOpen(true)}
                >
                  Rejeitar…
                </button>
              ) : null}
              {canResubmit ? (
                <button
                  type="button"
                  disabled={actionsBlocked}
                  onClick={() =>
                    void runTransition(
                      () =>
                        resubmitMeasurement(serviceOrderId, measurement.id, {
                          rowVersion: measurement.rowVersion,
                        }),
                      'Medição reenviada. Revise os itens antes de submeter novamente.',
                    )
                  }
                >
                  Reenviar medição
                </button>
              ) : null}
            </div>
          </section>

          <section className="measurement-section" aria-labelledby="measurement-timeline-title">
            <h2 id="measurement-timeline-title">Trilha da medição</h2>
            <p className="measurement-hint">
              Registro das decisões da medição: geração, submissão, análise, aprovação, rejeição e
              ajustes autorizados. Somente leitura.
            </p>
            <MeasurementTimeline events={measurement.historyEvents} />
          </section>
        </>
      )}

      {measurement && measurement.status === MEASUREMENT_STATUSES.Approved ? (
        <section className="measurement-section" aria-labelledby="measurement-billing-next">
          <h2 id="measurement-billing-next">Preparação de faturamento</h2>
          <p className="measurement-hint">
            A medição foi aprovada. A preparação do faturamento usa esta medição como referência
            comercial.
          </p>
          <Link to={`/app/service-orders/${serviceOrderId}/billing`}>Abrir faturamento</Link>
        </section>
      ) : null}

      {measurement ? (
        <MeasurementApprovalDialog
          open={approveOpen}
          rows={comparisonRows}
          itemCount={measurement.items.length}
          totalAmount={totalAmount}
          submitting={submitting}
          onCancel={() => setApproveOpen(false)}
          onConfirm={() =>
            void runTransition(
              () =>
                approveMeasurement(serviceOrderId, measurement.id, {
                  rowVersion: measurement.rowVersion,
                }),
              'Medição aprovada.',
            )
          }
        />
      ) : null}

      <ConfirmDialog
        open={rejectOpen}
        title="Rejeitar medição"
        description="Informe o motivo da rejeição. A medição ficará registrada como rejeitada."
        confirmLabel={submitting ? 'Rejeitando…' : 'Confirmar rejeição'}
        cancelLabel="Cancelar"
        confirmDisabled={submitting || rejectReason.trim().length < 3 || versionConflict}
        onCancel={() => setRejectOpen(false)}
        onConfirm={() => {
          if (!measurement) {
            return;
          }
          void runTransition(
            () =>
              rejectMeasurement(serviceOrderId, measurement.id, {
                rowVersion: measurement.rowVersion,
                rejectionReason: rejectReason.trim(),
              }),
            'Medição rejeitada.',
          );
        }}
      >
        <label htmlFor="measurement-reject-reason">
          Motivo da rejeição
          <textarea
            id="measurement-reject-reason"
            className="measurement-textarea"
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            rows={4}
          />
        </label>
      </ConfirmDialog>
    </main>
  );
}
