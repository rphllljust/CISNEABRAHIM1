import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getServiceOrder,
  prepareServiceOrder,
  releaseServiceOrder,
  ServiceOrdersApiError,
} from '../api/service-orders-api';
import { mapServiceOrdersErrorToMessage } from '../api/service-orders-error-messages';
import type { ServiceOrderDetail } from '../types/service-order.types';

type ContextState =
  | { phase: 'loading' }
  | { phase: 'denied' }
  | { phase: 'error' }
  | { phase: 'ready'; detail: ServiceOrderDetail };

/**
 * Shared operational context for RENTAL and TRANSPORT service-order archetypes.
 *
 * The OS owner supplies every status, blocker, next action, measurement and
 * billing value. No second dispatch/measurement/payment workflow is created.
 * LIST permission alone never authorizes a detail: this reads GET /service-orders/:id
 * with record-level authorization and never displays a previously selected record.
 */
export function OperationalArchetypeContext({
  serviceOrderId,
  onChanged,
}: {
  serviceOrderId: string;
  onChanged?: () => void;
}) {
  const [state, setState] = useState<ContextState>({ phase: 'loading' });
  const [retryNonce, setRetryNonce] = useState(0);
  const [busy, setBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  useEffect(() => {
    // Errors from a rejected command must survive a re-fetch after HTTP 409.
    // A new record is a different context and must not inherit an old error.
    setCommandError(null);
  }, [serviceOrderId]);

  useEffect(() => {
    const controller = new AbortController();
    setState({ phase: 'loading' });
    void getServiceOrder(serviceOrderId, controller.signal).then(
      (detail) => {
        if (!controller.signal.aborted) setState({ phase: 'ready', detail });
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        if (error instanceof ServiceOrdersApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
        } else {
          setState({ phase: 'error' });
        }
      },
    );
    return () => controller.abort();
  }, [serviceOrderId, retryNonce]);

  async function runCommand(transition: 'prepare' | 'release'): Promise<void> {
    if (busy || state.phase !== 'ready') return;
    const allowed = state.detail.controlCenter?.nextAction.availableTransitions ?? [];
    if (!allowed.includes(transition)) return;
    setBusy(true);
    setCommandError(null);
    try {
      if (transition === 'prepare') {
        await prepareServiceOrder(serviceOrderId, state.detail.rowVersion);
      } else {
        await releaseServiceOrder(serviceOrderId, state.detail.rowVersion);
      }
      setRetryNonce((previous) => previous + 1);
      onChanged?.();
    } catch (error) {
      setCommandError(error instanceof ServiceOrdersApiError
        ? mapServiceOrdersErrorToMessage(error.code, error.status)
        : 'Não foi possível concluir o comando. Consulte a OS e tente novamente.');
      // The next detail read must refresh version and capabilities after 409.
      setRetryNonce((previous) => previous + 1);
    } finally {
      setBusy(false);
    }
  }

  if (state.phase === 'loading') {
    return <p role="status" className="text-xs text-gray-600">Consultando o estado operacional da OS…</p>;
  }
  if (state.phase === 'denied') {
    return <p className="text-xs text-gray-600">Sem autorização para consultar o detalhe desta OS.</p>;
  }
  if (state.phase === 'error') {
    return (
      <div className="flex flex-col gap-2">
        <p role="alert" className="text-xs text-red-700">Não foi possível carregar o contexto operacional.</p>
        <button type="button" onClick={() => setRetryNonce((value) => value + 1)}
          className="text-left text-xs font-semibold text-brand-700">Tentar novamente</button>
      </div>
    );
  }

  const control = state.detail.controlCenter;
  const transitions = control?.nextAction.availableTransitions ?? [];
  const measurement = control?.downstream.measurement;
  const billing = control?.downstream.billing;

  return (
    <section aria-label="Operação vinculada à OS" className="flex flex-col gap-2 text-xs">
      <p className="m-0 font-semibold text-gray-900">Execução transacional</p>
      {!control ? (
        <p className="m-0 text-gray-600">A OS não publicou contexto operacional nesta leitura.</p>
      ) : (
        <>
          <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1">
            <dt className="text-gray-500">Próximo passo</dt>
            <dd className="m-0 text-gray-900">{control.nextAction.step}</dd>
            <dt className="text-gray-500">Recursos planejados</dt>
            <dd className="m-0 text-gray-900">{control.plannedVsActual.plannedResources}</dd>
            <dt className="text-gray-500">Alocações ativas</dt>
            <dd className="m-0 text-gray-900">{control.plannedVsActual.activeAllocations}</dd>
            <dt className="text-gray-500">Registros de execução</dt>
            <dd className="m-0 text-gray-900">{control.plannedVsActual.executionEntries}</dd>
            <dt className="text-gray-500">Medições</dt>
            <dd className="m-0 text-gray-900">{measurement?.count ?? 'Não disponível'}</dd>
            <dt className="text-gray-500">Faturamentos</dt>
            <dd className="m-0 text-gray-900">{billing?.count ?? 'Não disponível'}</dd>
          </dl>
          {billing?.totalAmount && billing.currencyCode ? (
            <p className="m-0 text-gray-700">Faturamento registrado: {billing.currencyCode} {billing.totalAmount}</p>
          ) : null}
          {control.nextAction.blockers.length ? (
            <div role="note" className="rounded border border-amber-200 bg-amber-50 p-2">
              <p className="m-0 font-semibold text-amber-900">Impedimentos do domínio</p>
              <ul className="mt-1 list-disc pl-4 text-amber-900">
                {control.nextAction.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}
              </ul>
            </div>
          ) : null}
          {transitions.includes('prepare') || transitions.includes('release') ? (
            <div className="flex flex-wrap gap-2">
              {transitions.includes('prepare') ? (
                <button type="button" disabled={busy} onClick={() => void runCommand('prepare')}
                  className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-50">
                  Preparar OS
                </button>
              ) : null}
              {transitions.includes('release') ? (
                <button type="button" disabled={busy} onClick={() => void runCommand('release')}
                  className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-50">
                  Liberar OS
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {commandError ? <p role="alert" className="m-0 text-red-700">{commandError}</p> : null}
      <div className="flex flex-wrap gap-3">
        <Link className="font-semibold text-brand-700" to={`/app/service-orders/${serviceOrderId}`}>
          Abrir OS 360
        </Link>
        <Link className="font-semibold text-brand-700" to={`/app/service-orders/${serviceOrderId}/planning`}>
          Planejamento e alocação
        </Link>
      </div>
    </section>
  );
}
