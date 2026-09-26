import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ConfirmDialog } from '../../clients/components/ConfirmDialog';
import { listAllocations } from '../api/service-order-planning-api';
import {
  completeExecution,
  getExecutionBundle,
  pauseExecution,
  recordEvidence,
  recordHourMeter,
  recordMileage,
  recordObservation,
  recordOccurrence,
  recordQuantity,
  resumeExecution,
  ServiceOrdersApiError,
  startExecution,
} from '../api/service-order-execution-api';
import { getServiceOrder } from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ActivitySubmitPayload } from '../components/ExecutionActivityPanel';
import { ExecutionActivityPanel } from '../components/ExecutionActivityPanel';
import { ExecutionHeader } from '../components/ExecutionHeader';
import { ExecutionTimeline } from '../components/ExecutionTimeline';
import { EvidenceUploader, type EvidenceUploadHandler } from '../components/EvidenceUploader';
import { OccurrenceForm } from '../components/OccurrenceForm';
import { OperationalActionBar } from '../components/OperationalActionBar';
import { PlannedVsActualPanel } from '../components/PlannedVsActualPanel';
import { RequirementChecklist } from '../components/RequirementChecklist';
import type { ResourceAllocation } from '../types/resource-planning.types';
import {
  EXECUTION_EVIDENCE_KINDS,
  type ExecutionBundle,
  type ExecutionEvidenceKind,
} from '../types/service-order-execution.types';
import { SERVICE_ORDER_STATUSES, type ServiceOrderDetail } from '../types/service-order.types';
import { createIdempotencyKey } from '../utils/create-idempotency-key';
import { resolvePrimaryAction } from '../utils/execution-primary-action';
import {
  allRequiredEvidenceSatisfied,
  buildRequirementCoverage,
  collectSatisfiedEvidenceKinds,
  isFileEvidenceKind,
  parseExecutionRequirements,
} from '../utils/execution-requirements';

type PageState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'not_found' }
  | { phase: 'error'; message: string }
  | {
      phase: 'ready';
      order: ServiceOrderDetail;
      bundle: ExecutionBundle;
      allocations: ResourceAllocation[];
    };

type ConfirmAction = 'complete' | 'pause' | null;

function readClientLabel(order: ServiceOrderDetail): string | null {
  if (!order.clientSnapshot) {
    return null;
  }
  const tradeName = order.clientSnapshot.tradeName;
  const legalName = order.clientSnapshot.legalName;
  if (typeof tradeName === 'string' && tradeName.trim()) {
    return tradeName;
  }
  if (typeof legalName === 'string' && legalName.trim()) {
    return legalName;
  }
  return null;
}

function readScheduleLabel(allocations: ResourceAllocation[]): string | null {
  const active = allocations.filter((item) => item.status === 'ACTIVE');
  if (active.length === 0) {
    return null;
  }
  const first = active[0]!;
  return `${new Date(first.operationalStart).toLocaleString()} – ${new Date(first.operationalEnd).toLocaleString()}`;
}

function readEquipmentLabel(allocations: ResourceAllocation[]): string | null {
  const codes = allocations
    .filter((item) => item.status === 'ACTIVE' && item.physicalAssetId)
    .map((item) => item.resourceTypeCode);
  return codes.length > 0 ? [...new Set(codes)].join(', ') : null;
}

function readRoleLabel(allocations: ResourceAllocation[]): string | null {
  const codes = allocations
    .filter((item) => item.status === 'ACTIVE' && item.workforceMemberId)
    .map((item) => item.resourceTypeCode);
  return codes.length > 0 ? [...new Set(codes)].join(', ') : null;
}

async function readFileAsBase64(file: File, onProgress: (progress: number) => void): Promise<string> {
  onProgress(10);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.min(90, Math.round((event.loaded / event.total) * 90)));
      }
    };
    reader.onload = () => {
      onProgress(95);
      const result = typeof reader.result === 'string' ? reader.result : '';
      const base64 = result.includes(',') ? result.split(',')[1]! : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Não foi possível ler o arquivo.'));
    reader.readAsDataURL(file);
  });
}

export function ServiceOrderExecutionPage() {
  const { serviceOrderId = '' } = useParams();
  const feedbackId = useId();
  const requestSeq = useRef(0);
  const [state, setState] = useState<PageState>({ phase: 'loading' });
  const [feedback, setFeedback] = useState<{ tone: 'error' | 'success' | 'info'; message: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [activityOpen, setActivityOpen] = useState(false);
  const [occurrenceOpen, setOccurrenceOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);
  const pendingIdempotencyRef = useRef<string | null>(null);

  const reload = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState({ phase: 'loading' });
    try {
      const [order, bundle, allocations] = await Promise.all([
        getServiceOrder(serviceOrderId),
        getExecutionBundle(serviceOrderId),
        listAllocations(serviceOrderId),
      ]);
      if (seq !== requestSeq.current) {
        return;
      }
      setState({ phase: 'ready', order, bundle, allocations });
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
            : 'Não foi possível carregar a execução.',
      });
    }
  }, [serviceOrderId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const applyOrderUpdate = useCallback((order: ServiceOrderDetail, bundle?: ExecutionBundle) => {
    setState((current) => {
      if (current.phase !== 'ready') {
        return current;
      }
      return {
        phase: 'ready',
        order,
        bundle: bundle ?? { ...current.bundle, status: order.status },
        allocations: current.allocations,
      };
    });
  }, []);

  const runTransition = useCallback(
    async (action: 'start' | 'pause' | 'resume' | 'complete') => {
      if (state.phase !== 'ready' || busy) {
        return;
      }
      const order = state.order;
      const idempotencyKey = pendingIdempotencyRef.current ?? createIdempotencyKey();
      pendingIdempotencyRef.current = idempotencyKey;
      setBusy(true);
      setFeedback(null);
      try {
        const body = { rowVersion: order.rowVersion, idempotencyKey };
        const updated =
          action === 'start'
            ? await startExecution(serviceOrderId, body)
            : action === 'pause'
              ? await pauseExecution(serviceOrderId, body)
              : action === 'resume'
                ? await resumeExecution(serviceOrderId, body)
                : await completeExecution(serviceOrderId, body);
        pendingIdempotencyRef.current = null;
        const bundle = await getExecutionBundle(serviceOrderId);
        applyOrderUpdate(updated, bundle);
        setFeedback({
          tone: 'success',
          message:
            action === 'complete'
              ? 'Ordem de serviço concluída.'
              : action === 'start'
                ? 'Execução iniciada.'
                : action === 'pause'
                  ? 'Execução pausada.'
                  : 'Execução retomada.',
        });
        setActivityOpen(false);
        setOccurrenceOpen(false);
        setConfirmAction(null);
      } catch (error) {
        if (error instanceof ServiceOrdersApiError && error.kind === 'network') {
          setFeedback({
            tone: 'error',
            message: 'Falha de rede. Você pode tentar novamente com segurança.',
          });
        } else {
          pendingIdempotencyRef.current = null;
          setFeedback({
            tone: 'error',
            message:
              error instanceof ServiceOrdersApiError
                ? mapServiceOrdersErrorToMessage(error.code, error.status)
                : 'Não foi possível concluir a operação.',
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [applyOrderUpdate, busy, serviceOrderId, state],
  );

  const handleActivitySubmit = useCallback(
    async (payload: ActivitySubmitPayload) => {
      if (state.phase !== 'ready' || busy) {
        return;
      }
      setBusy(true);
      setFeedback(null);
      const rowVersion = state.order.rowVersion;
      const idempotencyKey = createIdempotencyKey();
      try {
        let nextRowVersion = rowVersion;
        if (payload.kind === EXECUTION_EVIDENCE_KINDS.Observation) {
          const result = await recordObservation(serviceOrderId, {
            rowVersion,
            text: payload.text,
            idempotencyKey,
          });
          if (result.rowVersion) {
            nextRowVersion = result.rowVersion;
          }
        } else if (payload.kind === EXECUTION_EVIDENCE_KINDS.Quantity) {
          const result = await recordQuantity(serviceOrderId, {
            rowVersion,
            quantityValue: payload.quantityValue,
            unitCode: payload.unitCode,
            idempotencyKey,
          });
          if (result.rowVersion) {
            nextRowVersion = result.rowVersion;
          }
        } else if (payload.kind === EXECUTION_EVIDENCE_KINDS.Mileage) {
          const result = await recordMileage(serviceOrderId, {
            rowVersion,
            value: payload.value,
            idempotencyKey,
          });
          if (result.rowVersion) {
            nextRowVersion = result.rowVersion;
          }
        } else {
          const result = await recordHourMeter(serviceOrderId, {
            rowVersion,
            value: payload.value,
            idempotencyKey,
          });
          if (result.rowVersion) {
            nextRowVersion = result.rowVersion;
          }
        }
        const [order, bundle] = await Promise.all([
          getServiceOrder(serviceOrderId),
          getExecutionBundle(serviceOrderId),
        ]);
        applyOrderUpdate({ ...order, rowVersion: nextRowVersion }, bundle);
        setActivityOpen(false);
        setFeedback({ tone: 'success', message: 'Registro salvo.' });
      } catch (error) {
        setFeedback({
          tone: 'error',
          message:
            error instanceof ServiceOrdersApiError
              ? mapServiceOrdersErrorToMessage(error.code, error.status)
              : 'Falha ao registrar atividade.',
        });
      } finally {
        setBusy(false);
      }
    },
    [applyOrderUpdate, busy, serviceOrderId, state],
  );

  const handleOccurrenceSubmit = useCallback(
    async (input: { occurrenceCode: string; description: string }) => {
      if (state.phase !== 'ready' || busy) {
        return;
      }
      setBusy(true);
      setFeedback(null);
      try {
        const result = await recordOccurrence(serviceOrderId, {
          rowVersion: state.order.rowVersion,
          occurrenceCode: input.occurrenceCode,
          description: input.description,
          idempotencyKey: createIdempotencyKey(),
        });
        const [order, bundle] = await Promise.all([
          getServiceOrder(serviceOrderId),
          getExecutionBundle(serviceOrderId),
        ]);
        applyOrderUpdate(
          result.rowVersion ? { ...order, rowVersion: result.rowVersion } : order,
          bundle,
        );
        setOccurrenceOpen(false);
        setFeedback({ tone: 'success', message: 'Ocorrência registrada.' });
      } catch (error) {
        setFeedback({
          tone: 'error',
          message:
            error instanceof ServiceOrdersApiError
              ? mapServiceOrdersErrorToMessage(error.code, error.status)
              : 'Falha ao registrar ocorrência.',
        });
      } finally {
        setBusy(false);
      }
    },
    [applyOrderUpdate, busy, serviceOrderId, state],
  );

  const handleEvidenceUpload: EvidenceUploadHandler = useCallback(
    async (item, file, onProgress) => {
      if (state.phase !== 'ready') {
        throw new Error('Execução não carregada.');
      }
      const contentBase64 = await readFileAsBase64(file, onProgress);
      const result = await recordEvidence(serviceOrderId, {
        rowVersion: state.order.rowVersion,
        evidenceKind: item.evidenceKind,
        idempotencyKey: item.idempotencyKey,
        payload: {
          fileName: file.name,
          contentType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          contentBase64,
        },
      });
      onProgress(100);
      const [order, bundle] = await Promise.all([
        getServiceOrder(serviceOrderId),
        getExecutionBundle(serviceOrderId),
      ]);
      applyOrderUpdate(
        result.rowVersion ? { ...order, rowVersion: result.rowVersion } : order,
        bundle,
      );
    },
    [applyOrderUpdate, serviceOrderId, state],
  );

  if (state.phase === 'loading') {
    return (
      <div className="execution-page shell-loading" aria-busy="true" aria-live="polite">
        <p>Carregando execução…</p>
      </div>
    );
  }

  if (state.phase === 'denied') {
    return (
      <div className="execution-page" role="alert">
        <h1>Acesso negado</h1>
        <p>Você não tem permissão para executar esta ordem de serviço.</p>
      </div>
    );
  }

  if (state.phase === 'not_found') {
    return (
      <div className="execution-page">
        <h1>Ordem não encontrada</h1>
        <p>Verifique o identificador e tente novamente.</p>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="execution-page" role="alert">
        <h1>Falha ao carregar</h1>
        <p>{state.message}</p>
        <button type="button" onClick={() => void reload()}>
          Tentar novamente
        </button>
      </div>
    );
  }

  const { order, bundle, allocations } = state;
  const requirements = parseExecutionRequirements(order.serviceSnapshot);
  const satisfiedKinds = collectSatisfiedEvidenceKinds(bundle);
  const coverage = buildRequirementCoverage(requirements, satisfiedKinds);
  const requirementsComplete = allRequiredEvidenceSatisfied(requirements, satisfiedKinds);
  const canMutate =
    order.status === SERVICE_ORDER_STATUSES.Released ||
    order.status === SERVICE_ORDER_STATUSES.InExecution ||
    order.status === SERVICE_ORDER_STATUSES.Paused;
  const primary = resolvePrimaryAction({
    status: order.status,
    requirementsComplete,
    canMutate,
  });
  const pendingActivityKinds = requirements
    .filter((requirement) => !satisfiedKinds.has(requirement.evidenceKind))
    .map((requirement) => requirement.evidenceKind)
    .filter(
      (kind): kind is ExecutionEvidenceKind =>
        kind === EXECUTION_EVIDENCE_KINDS.Observation ||
        kind === EXECUTION_EVIDENCE_KINDS.Quantity ||
        kind === EXECUTION_EVIDENCE_KINDS.Mileage ||
        kind === EXECUTION_EVIDENCE_KINDS.HourMeter,
    );
  const fileEvidenceKinds = requirements
    .map((requirement) => requirement.evidenceKind)
    .filter((kind): kind is ExecutionEvidenceKind => isFileEvidenceKind(kind));
  const allowedUnits =
    order.serviceSnapshot.allowedUnits?.map((unit) => unit.unitCode) ??
    (order.serviceSnapshot.measurementModel?.defaultUnitCode
      ? [order.serviceSnapshot.measurementModel.defaultUnitCode]
      : ['SERVICE']);

  const showOperationalActions =
    order.status === SERVICE_ORDER_STATUSES.InExecution ||
    order.status === SERVICE_ORDER_STATUSES.Paused;

  return (
    <div className="execution-page">
      <ExecutionHeader
        orderNumber={order.orderNumber}
        status={order.status}
        serviceName={order.serviceSnapshot.serviceName}
        clientLabel={readClientLabel(order)}
        locationLabel={order.description}
        scheduleLabel={readScheduleLabel(allocations)}
        equipmentLabel={readEquipmentLabel(allocations)}
        operatorLabel={readRoleLabel(allocations) ?? '—'}
      />

      {feedback ? (
        <div
          id={feedbackId}
          className={`execution-feedback execution-feedback--${feedback.tone}`}
          role={feedback.tone === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          <p>{feedback.message}</p>
        </div>
      ) : null}

      <RequirementChecklist items={coverage} instructions={order.description} />

      {order.status === SERVICE_ORDER_STATUSES.Completed ? (
        <section className="execution-section" aria-labelledby="execution-measurement-next">
          <h2 id="execution-measurement-next">Conferência de medição</h2>
          <p className="execution-hint">
            A execução foi concluída. Revise planejado, realizado e medido antes de aprovar para
            faturamento candidato.
          </p>
          <Link to={`/app/service-orders/${serviceOrderId}/measurement`}>Abrir conferência de medição</Link>
        </section>
      ) : null}

      {fileEvidenceKinds.length > 0 && showOperationalActions ? (
        <EvidenceUploader
          evidenceKinds={fileEvidenceKinds}
          disabled={busy || order.status === SERVICE_ORDER_STATUSES.Paused}
          onUpload={handleEvidenceUpload}
        />
      ) : null}

      <PlannedVsActualPanel comparison={bundle.comparison} />

      <ExecutionTimeline
        entries={bundle.entries}
        evidence={bundle.evidence}
        occurrences={bundle.occurrences}
      />

      <ExecutionActivityPanel
        open={activityOpen}
        pendingKinds={pendingActivityKinds}
        defaultUnitCode={order.serviceSnapshot.measurementModel?.defaultUnitCode ?? null}
        allowedUnits={allowedUnits}
        disabled={!showOperationalActions || order.status === SERVICE_ORDER_STATUSES.Paused}
        busy={busy}
        onClose={() => setActivityOpen(false)}
        onSubmit={(payload) => void handleActivitySubmit(payload)}
      />

      <OccurrenceForm
        open={occurrenceOpen}
        disabled={!showOperationalActions}
        busy={busy}
        onClose={() => setOccurrenceOpen(false)}
        onSubmit={(input) => void handleOccurrenceSubmit(input)}
      />

      <OperationalActionBar
        primary={primary}
        primaryBusy={busy}
        onPrimary={() => {
          if (primary.kind === 'start') {
            void runTransition('start');
            return;
          }
          if (primary.kind === 'resume') {
            void runTransition('resume');
            return;
          }
          if (primary.kind === 'complete') {
            setConfirmAction('complete');
            return;
          }
          if (primary.kind === 'record') {
            setActivityOpen(true);
            setOccurrenceOpen(false);
          }
        }}
        secondaryActions={
          showOperationalActions
            ? [
                {
                  id: 'pause',
                  label: 'Pausar',
                  disabled: order.status !== SERVICE_ORDER_STATUSES.InExecution,
                  onClick: () => setConfirmAction('pause'),
                },
                {
                  id: 'occurrence',
                  label: 'Ocorrência',
                  onClick: () => {
                    setOccurrenceOpen(true);
                    setActivityOpen(false);
                  },
                },
              ]
            : []
        }
      />

      <ConfirmDialog
        open={confirmAction === 'complete'}
        title="Concluir ordem de serviço?"
        description="Esta ação encerra a execução. Confirme apenas se todo o serviço foi realizado."
        confirmLabel="Concluir OS"
        confirmDisabled={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runTransition('complete')}
      />

      <ConfirmDialog
        open={confirmAction === 'pause'}
        title="Pausar execução?"
        description="A ordem ficará pausada até ser retomada. Registros já feitos serão preservados."
        confirmLabel="Confirmar pausa"
        confirmDisabled={busy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void runTransition('pause')}
      />
    </div>
  );
}
