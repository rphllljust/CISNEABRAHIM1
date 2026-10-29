import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { OperationsApiError, checkInServiceOrder, createCommandKey, describeOperationsError, getServiceOrderOverview, listOperationUnitOptions } from '../api/operations-api';
import type { ServiceOrderOverview } from '../types/operations.types';
import { DispatchBoardPage } from './DispatchBoardPage';
import { ExecutionConsolePage } from './ExecutionConsolePage';
import { OperationalUnitGovernance } from '../components/OperationalUnitGovernance';

/**
 * Operations reads authorized units from its own directory contract.
 * An empty work queue does not make a registered unit disappear.
 * LIST/read authority governs the board; dispatch commands are checked separately.
 */
export function OperationsDispatchWorkspacePage({
  initialTab = 'dispatch',
}: {
  initialTab?: 'dispatch' | 'execution';
} = {}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'execution' ? 'execution' : searchParams.get('tab') === 'dispatch' ? 'dispatch' : initialTab;
  const selectedOrderId = searchParams.get('serviceOrderId');
  const [refreshToken, setRefreshToken] = useState(0);
  const commandFlight = useRef(false);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);
  const [commandBusy, setCommandBusy] = useState(false);
  const [queueRefresh, setQueueRefresh] = useState(0);
  const requestGeneration = useRef(0);
  const [selection, setSelection] = useState<
    | { phase: 'idle' | 'loading'; key?: string }
    | { phase: 'ready'; key: string; data: ServiceOrderOverview }
    | { phase: 'denied' | 'error'; key: string }
  >({ phase: 'idle' });
  const switchTab = (nextTab: 'dispatch' | 'execution') => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('tab', nextTab);
      return next;
    });
  };
  const selectOrder = (serviceOrderId: string) => {
    setSearchParams(previous => {
      const next = new URLSearchParams(previous);
      next.set('serviceOrderId', serviceOrderId);
      return next;
    });
  };
  const { options, unitId, setUnitId, status, error, reload } =
    useOperationalUnits(listOperationUnitOptions);

  const denied = error instanceof OperationsApiError && error.kind === 'denied';

  const selectionKey = unitId && selectedOrderId ? `${unitId}:${selectedOrderId}` : null;
  const refreshStation = useCallback(() => {
    setRefreshToken(value => value + 1);
    setQueueRefresh(value => value + 1);
  }, []);

  useEffect(() => {
    const generation = ++requestGeneration.current;
    if (!selectionKey || !selectedOrderId || status !== 'ready' || !unitId) {
      setSelection({ phase: 'idle' });
      return;
    }
    const controller = new AbortController();
    setSelection({ phase: 'loading', key: selectionKey });
    void getServiceOrderOverview(selectedOrderId, controller.signal)
      .then(data => {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setSelection(data.identity.serviceOrderId === selectedOrderId && data.identity.unitId === unitId
          ? { phase: 'ready', key: selectionKey, data }
          : { phase: 'denied', key: selectionKey });
      })
      .catch(error => {
        if (controller.signal.aborted || generation !== requestGeneration.current) return;
        setSelection({ phase: error instanceof OperationsApiError && error.kind === 'denied' ? 'denied' : 'error', key: selectionKey });
      });
    return () => {
      requestGeneration.current++;
      controller.abort();
    };
  }, [selectionKey, selectedOrderId, unitId, status, refreshToken]);

  const currentSelection = selection.phase === 'ready' && selection.key === selectionKey ? selection.data : null;
  const selectionPhase = currentSelection ? 'ready' : selectionKey && selection.key === selectionKey ? selection.phase : 'loading';

  // Commands never use a snapshot captured for another unit or OS.
  const checkIn = useCallback(async () => {
    if (commandFlight.current || !currentSelection || !selectionKey) return;
    const allowed = currentSelection.availableCommands.find(command => command.code === 'CHECK_IN');
    if (!allowed?.enabled) return;
    const intendedKey = selectionKey;
    const intendedGeneration = requestGeneration.current;
    commandFlight.current = true;
    setCommandBusy(true);
    setCommandFeedback(null);
    try {
      const updated = await checkInServiceOrder(currentSelection.identity.serviceOrderId, {
        rowVersion: currentSelection.identity.rowVersion,
        idempotencyKey: createCommandKey(),
      });
      if (intendedKey === selectionKey && intendedGeneration === requestGeneration.current &&
          updated.identity.unitId === unitId && updated.identity.serviceOrderId === selectedOrderId) {
        setSelection({ phase: 'ready', key: selectionKey, data: updated });
        setCommandFeedback('Chegada confirmada pelo servidor.');
      }
    } catch (error) {
      if (intendedKey === selectionKey) {
        const conflict = error instanceof OperationsApiError && error.kind === 'version_conflict';
        setCommandFeedback(conflict
          ? 'Conflito de versão: a OS será recarregada; o comando não foi repetido.'
          : error instanceof OperationsApiError && error.kind === 'network'
            ? 'Resultado indeterminado por falha de rede. Confira a OS antes de uma nova intenção.'
            : describeOperationsError(error));
      }
    } finally {
      commandFlight.current = false;
      setCommandBusy(false);
      refreshStation();
    }
  }, [currentSelection, selectionKey, unitId, selectedOrderId, refreshStation]);

  return (
    <ModulePage layout="workspace">
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Operações"
            count={null}
            context="Despacho e execução por unidade autorizada: prontidão, recursos, exceções, realizado e conclusão. Decisões e comandos pertencem ao servidor."
          />
          <nav aria-label="Seções de operação" className="mt-2 flex flex-wrap gap-1">
            <TabButton active={tab === 'dispatch'} onClick={() => switchTab('dispatch')}>
              Despacho
            </TabButton>
            <TabButton active={tab === 'execution'} onClick={() => switchTab('execution')}>
              Execução
            </TabButton>
          </nav>

          <OperationalUnitGovernance onChanged={reload} />

          {status === 'ready' && options.length > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <label htmlFor="operations-unit" className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Unidade
              </label>
              <select
                id="operations-unit"
                value={unitId}
                onChange={(event) => {
                  setUnitId(event.target.value);
                  setSearchParams(previous => {
                    const next = new URLSearchParams(previous);
                    next.delete('serviceOrderId');
                    return next;
                  });
                }}
                aria-label="Unidade operacional"
                className="min-h-10 max-w-full rounded border border-gray-300 bg-white px-2 py-1 text-xs"
              >
                {options.map((unit) => (
                  <option key={unit.value} value={unit.value}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div data-region="worklist-master">
          {status === 'loading' ? (
            <WorklistStatePanel
              title="Lendo unidades operacionais"
              description="Consultando o diretório no escopo de leitura da operação."
            />
          ) : null}

          {status === 'error' ? (
            <div role="alert" className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
              <p>{denied
                ? 'Acesso negado à consulta operacional. Permissão de criação ou despacho não autoriza automaticamente esta leitura.'
                : 'O diretório de unidades está indisponível. Nenhuma lista vazia foi presumida.'}</p>
              {!denied ? (
                <button type="button" className="mt-2 underline" onClick={reload}>Tentar novamente</button>
              ) : null}
            </div>
          ) : null}

          {status === 'ready' && options.length === 0 ? (
            <WorklistStatePanel
              title="Nenhuma unidade autorizada para consulta"
              description="Não há unidade habilitada para seu escopo de leitura. Isso não significa ausência de ordens de serviço."
            />
          ) : null}

          {status === 'ready' && unitId && options.length > 0 ? (
            tab === 'dispatch' ? <DispatchBoardPage key={`dispatch:${unitId}:${queueRefresh}`} unitId={unitId} onSelectOrder={selectOrder} onCommandSettled={refreshStation} /> :
              <ExecutionConsolePage key={`execution:${unitId}`} unitId={unitId} onSelectOrder={selectOrder} />
          ) : null}
        </div>
        {selectedOrderId && status === 'ready' ? (
          <aside aria-label="Contexto da OS selecionada" className="mt-3 border-t border-gray-200 p-3 lg:border-l lg:border-t-0">
            {selectionPhase === 'loading' ? <p role="status">Carregando contexto autorizado…</p> : null}
            {selectionPhase === 'denied' ? <p role="alert">A OS não pertence ao escopo autorizado desta unidade.</p> : null}
            {selectionPhase === 'error' ? <p role="alert">Não foi possível consultar a OS selecionada.</p> : null}
            {currentSelection ? (
              <div className="space-y-3">
                {commandFeedback ? <p role="status" className="text-xs">{commandFeedback}</p> : null}
                <h2 className="text-base font-semibold">{currentSelection.identity.orderNumber}</h2>
                <p className="text-xs">{currentSelection.identity.clientLabel} · {currentSelection.businessContext.contractReference ?? 'Contrato não publicado'}</p>
                <p className="text-xs">Estado: {currentSelection.statuses.operational} · Versão {currentSelection.identity.rowVersion}</p>
                <p className="text-xs">Próxima ação: {currentSelection.nextAction.label ?? 'Não publicada'}</p>
                {currentSelection.nextAction.explanation ? <p className="text-xs">{currentSelection.nextAction.explanation}</p> : null}
                <p className="text-xs">Despacho: {currentSelection.dispatch.readiness.summary}</p>
                {currentSelection.dispatch.readiness.blockingReasons.map(reason => (
                  <p key={reason.dimension} className="text-xs">{reason.dimension}: {reason.reason ?? reason.reasonCode}</p>
                ))}
                <p className="text-xs">Recursos planejados: {currentSelection.planning.plannedResourceCount}; alocações ativas: {currentSelection.planning.activeAllocationCount}</p>
                <div aria-label="Processamento da OS" className="space-y-2 border-t border-gray-200 pt-2">
                  <h3 className="text-sm font-semibold">Processamento autorizado</h3>
                  <ol aria-label="Etapas operacionais" className="space-y-1 text-xs">
                    {currentSelection.process.map(step => (
                      <li key={step.stage}>{step.label}: {step.state}{step.detail ? ` · ${step.detail}` : ''}</li>
                    ))}
                  </ol>
                  {currentSelection.availableCommands.filter(command => command.enabled && command.code === 'CHECK_IN').map(command => (
                    <button key={command.code} type="button" disabled={commandBusy}
                      onClick={() => void checkIn()} className="rounded bg-brand-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">
                      {commandBusy ? 'Registrando…' : command.label}
                    </button>
                  ))}
                  <p className="text-xs">Apontamentos persistidos: {currentSelection.actuals.comparison.recordCount}</p>
                  <p className="text-xs">Conclusão: {currentSelection.completionGate.summary}</p>
                  {currentSelection.completionGate.blockingReasons.map(reason => (
                    <p key={reason.reasonCode} className="text-xs">{reason.reason}</p>
                  ))}
                  <p className="text-xs">Custo previsto: {currentSelection.economics.plannedCost ?? 'Não publicado'} {currentSelection.economics.currencyCode ?? ''}</p>
                  <p className="text-xs">Receita prevista: {currentSelection.economics.plannedRevenue ?? 'Não publicada'} {currentSelection.economics.currencyCode ?? ''}</p>
                </div>
                <nav aria-label="Operar a OS" className="flex flex-wrap gap-3 text-sm">
                  <Link to={`/app/service-orders/${selectedOrderId}`}>OS 360</Link>
                  <Link to={`/app/service-orders/${selectedOrderId}/planning`}>Planejamento</Link>
                  <Link to={`/app/service-orders/${selectedOrderId}/execution`}>Execução</Link>
                  <Link to={`/app/service-orders/${selectedOrderId}/measurement`}>Medição</Link>
                </nav>
              </div>
            ) : null}
          </aside>
        ) : null}
      </div>
    </ModulePage>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded px-2.5 py-1 text-xs font-semibold transition-colors ${
        active ? 'bg-brand-700 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
      }`}
    >
      {children}
    </button>
  );
}
