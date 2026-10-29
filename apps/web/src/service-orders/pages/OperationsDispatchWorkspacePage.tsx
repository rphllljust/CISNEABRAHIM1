import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { OperationsApiError, getServiceOrderOverview, listOperationUnitOptions } from '../api/operations-api';
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
  const [selection, setSelection] = useState<
    | { phase: 'idle' | 'loading' }
    | { phase: 'ready'; data: ServiceOrderOverview }
    | { phase: 'denied' | 'error' }
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

  useEffect(() => {
    if (!selectedOrderId || status !== 'ready' || !unitId) {
      setSelection({ phase: 'idle' });
      return;
    }
    const controller = new AbortController();
    setSelection({ phase: 'loading' });
    void getServiceOrderOverview(selectedOrderId, controller.signal)
      .then(data => {
        if (controller.signal.aborted) return;
        setSelection(data.identity.unitId === unitId ? { phase: 'ready', data } : { phase: 'denied' });
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        setSelection({ phase: error instanceof OperationsApiError && error.kind === 'denied' ? 'denied' : 'error' });
      });
    return () => controller.abort();
  }, [selectedOrderId, unitId, status]);

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
            tab === 'dispatch' ? <DispatchBoardPage unitId={unitId} onSelectOrder={selectOrder} /> :
              <ExecutionConsolePage unitId={unitId} onSelectOrder={selectOrder} />
          ) : null}
        </div>
        {selectedOrderId && status === 'ready' ? (
          <aside aria-label="Contexto da OS selecionada" className="mt-3 border-t border-gray-200 p-3 lg:border-l lg:border-t-0">
            {selection.phase === 'loading' ? <p role="status">Carregando contexto autorizado…</p> : null}
            {selection.phase === 'denied' ? <p role="alert">A OS não pertence ao escopo autorizado desta unidade.</p> : null}
            {selection.phase === 'error' ? <p role="alert">Não foi possível consultar a OS selecionada.</p> : null}
            {selection.phase === 'ready' ? (
              <div className="space-y-3">
                <h2 className="text-base font-semibold">{selection.data.identity.orderNumber}</h2>
                <p className="text-xs">{selection.data.identity.clientLabel} · {selection.data.businessContext.contractReference ?? 'Contrato não publicado'}</p>
                <p className="text-xs">Estado: {selection.data.statuses.operational} · Versão {selection.data.identity.rowVersion}</p>
                <p className="text-xs">Próxima ação: {selection.data.nextAction.label ?? 'Não publicada'}</p>
                {selection.data.nextAction.explanation ? <p className="text-xs">{selection.data.nextAction.explanation}</p> : null}
                <p className="text-xs">Despacho: {selection.data.dispatch.readiness.summary}</p>
                {selection.data.dispatch.readiness.blockingReasons.map(reason => (
                  <p key={reason.dimension} className="text-xs">{reason.dimension}: {reason.reason ?? reason.reasonCode}</p>
                ))}
                <p className="text-xs">Recursos planejados: {selection.data.planning.plannedResourceCount}; alocações ativas: {selection.data.planning.activeAllocationCount}</p>
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
