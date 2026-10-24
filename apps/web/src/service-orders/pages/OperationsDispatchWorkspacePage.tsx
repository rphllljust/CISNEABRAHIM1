import { useEffect, useState } from 'react';
import { ModulePage } from '../../ui/module-layout';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import { DispatchBoardPage } from './DispatchBoardPage';
import { ExecutionConsolePage } from './ExecutionConsolePage';
import { listServiceOrders, ServiceOrdersApiError } from '../api/service-orders-api';

/**
 * WORKSPACE DE OPERAÇÕES — a estação de operação.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE A UNIDADE É A CHAVE DA PÁGINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Despacho e execução são recortados por UNIDADE OPERACIONAL. Sem ela não existe
 * escopo: uma tela que mistura unidades opera o que o operador não pediu e mostra
 * o que ele talvez não devesse ver.
 *
 * A unidade vem das ordens que o ator pode LER — a mesma leitura já autorizada pela
 * listagem. Não se inventa unidade "default": quando não há nenhuma, a tela diz
 * isso em vez de escolher por conta própria.
 */
export function OperationsDispatchWorkspacePage({
  initialTab = 'dispatch',
}: {
  initialTab?: 'dispatch' | 'execution';
} = {}) {
  const [unitId, setUnitId] = useState<string | null>(null);
  const [unitState, setUnitState] = useState<
    { phase: 'loading' } | { phase: 'ready'; units: string[] } | { phase: 'error'; message: string }
  >({ phase: 'loading' });
  const [tab, setTab] = useState<'dispatch' | 'execution'>(initialTab);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    async function run() {
      try {
        // A leitura de uma página de ordens é o caminho AUTORIZADO para descobrir
        // as unidades do ator — o mesmo `list` que aplica capability e escopo.
        const page = await listServiceOrders({ limit: 50 }, controller.signal);
        if (!active || controller.signal.aborted) {
          return;
        }
        const units = [...new Set(page.items.map((item) => item.unitId).filter(Boolean))].sort();
        setUnitState({ phase: 'ready', units });
        setUnitId((current) => current ?? units[0] ?? null);
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }
        setUnitState({
          phase: 'error',
          message:
            error instanceof ServiceOrdersApiError && error.kind === 'denied'
              ? 'Você não tem permissão para ler as ordens desta operação.'
              : 'Não foi possível determinar a unidade operacional.',
        });
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, []);

  return (
    <ModulePage layout="workspace">
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Operações"
            count={null}
            context="Despacho e execução sobre a mesma cadeia: prontidão, despacho, chegada, execução, realizado e conclusão. Toda decisão vem do servidor."
          />

          <nav aria-label="Seções de operação" className="mt-2 flex flex-wrap gap-1">
            <TabButton active={tab === 'dispatch'} onClick={() => setTab('dispatch')}>
              Despacho
            </TabButton>
            <TabButton active={tab === 'execution'} onClick={() => setTab('execution')}>
              Execução
            </TabButton>
          </nav>

          {unitState.phase === 'ready' && unitState.units.length > 1 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
                Unidade
              </span>
              <select
                value={unitId ?? ''}
                onChange={(event) => setUnitId(event.target.value || null)}
                aria-label="Unidade operacional"
                className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
              >
                {unitState.units.map((unit) => (
                  <option key={unit} value={unit}>
                    {unit}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
        </div>

        <div data-region="worklist-master">
          {unitState.phase === 'loading' ? (
            <WorklistStatePanel
              title="Lendo a operação"
              description="Unidades autorizadas sendo determinadas."
            />
          ) : null}

          {unitState.phase === 'error' ? (
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
            >
              {unitState.message}
            </div>
          ) : null}

          {unitState.phase === 'ready' && unitState.units.length === 0 ? (
            <WorklistStatePanel
              title="Nenhuma unidade operacional"
              description="Não há ordem visível para o seu escopo. Despacho e execução dependem de unidade operacional."
            />
          ) : null}

          {unitState.phase === 'ready' && unitState.units.length > 0 ? (
            tab === 'dispatch' ? (
              <DispatchBoardPage unitId={unitId} />
            ) : (
              <ExecutionConsolePage unitId={unitId} />
            )
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
