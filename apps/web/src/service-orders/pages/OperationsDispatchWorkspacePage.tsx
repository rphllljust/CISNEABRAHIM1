import { useState } from 'react';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import { useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { OperationsApiError, listOperationUnitOptions } from '../api/operations-api';
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
  const [tab, setTab] = useState<'dispatch' | 'execution'>(initialTab);
  const { options, unitId, setUnitId, status, error, reload } =
    useOperationalUnits(listOperationUnitOptions);

  const denied = error instanceof OperationsApiError && error.kind === 'denied';

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
            <TabButton active={tab === 'dispatch'} onClick={() => setTab('dispatch')}>
              Despacho
            </TabButton>
            <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>
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
                onChange={(event) => setUnitId(event.target.value)}
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
            tab === 'dispatch' ? <DispatchBoardPage unitId={unitId} /> :
              <ExecutionConsolePage unitId={unitId} />
          ) : null}
        </div>
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
