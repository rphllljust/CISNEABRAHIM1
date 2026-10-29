import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ModulePage } from '../../ui/module-layout';
import { Button } from '../../ui';
import { WorklistHeader, WorklistStatePanel } from '../../ui/enterprise-list';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import {
  createCommandKey,
  describeOperationsError,
  dispatchServiceOrder,
  getDispatchBoard,
  OperationsApiError,
} from '../api/operations-api';
import type { DispatchBoardItem, DispatchBoardReadModel } from '../types/operations.types';

/**
 * DISPATCH BOARD — a superfície em que a ordem SAI.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTA TELA NÃO É UMA LISTA DE STATUS
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A pergunta da operação não é "quais ordens estão liberadas". É:
 *
 *   - quais podem SAIR agora?
 *   - quais estão bloqueadas?
 *   - POR QUE estão bloqueadas?
 *   - o que destrava cada uma?
 *
 * Um `status = RELEASED` não responde nenhuma delas. Por isso cada linha exibe a
 * PRONTIDÃO por dimensão (equipe, condutor, veículo, equipamento, habilitação,
 * manutenção, documentos, janela, SLA), já calculada pelo backend.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não decide se pode despachar: lê `readiness.ready` e `availableCommands`. Não
 * habilita botão por formulação local — o comando `DISPATCH` já chega com
 * `enabled` e `reasons` decididos pelo servidor. Não calcula SLA.
 */
export function DispatchBoardPage({ unitId, onSelectOrder, onCommandSettled }: { unitId: string | null; onSelectOrder?: (serviceOrderId: string) => void; onCommandSettled?: () => void }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'denied' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; board: DispatchBoardReadModel }
  >({ phase: 'loading' });

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null,
  );
  const [reloadToken, setReloadToken] = useState(0);
  const pendingIntent = useRef<{
    unitId: string;
    orderId: string;
    body: { rowVersion: number; idempotencyKey: string };
    phase: 'submitting' | 'uncertain';
  } | null>(null);
  const [uncertainOrderId, setUncertainOrderId] = useState<string | null>(null);
  useEffect(() => {
    pendingIntent.current = null;
    setUncertainOrderId(null);
    setFeedback(null);
  }, [unitId]);

  useEffect(() => {
    if (!unitId) {
      setState({ phase: 'ready', board: emptyBoard() });
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      try {
        const board = await getDispatchBoard({ unitId: unitId! }, controller.signal);
        if (active && !controller.signal.aborted) {
          setState({ phase: 'ready', board });
        }
      } catch (error) {
        if (!active || controller.signal.aborted) {
          return;
        }
        if (error instanceof OperationsApiError && error.kind === 'denied') {
          setState({ phase: 'denied' });
          return;
        }
        setState({ phase: 'error', message: describeOperationsError(error) });
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [unitId, reloadToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  /**
   * One semantic dispatch intent owns one immutable idempotency key and rowVersion.
   * A transport failure is UNCERTAIN, not a rejected command. Only an explicit
   * retry may submit the identical payload; 409 never auto-retries.
   */
  const runDispatch = useCallback(async (item: DispatchBoardItem) => {
    if (!unitId || pendingIntent.current?.phase === 'submitting') return;
    const command = item.availableCommands.find(value => value.code === 'DISPATCH');
    const previous = pendingIntent.current;
    const retry = previous?.phase === 'uncertain' &&
      previous.unitId === unitId && previous.orderId === item.serviceOrderId;
    if (!retry && (!command?.enabled || previous?.phase === 'uncertain')) return;
    const body = retry && previous ? previous.body : {
      rowVersion: item.rowVersion,
      idempotencyKey: createCommandKey(),
    };
    pendingIntent.current = { unitId, orderId: item.serviceOrderId, body, phase: 'submitting' };
    setBusyOrderId(item.serviceOrderId);
    setUncertainOrderId(null);
    setFeedback(null);
    try {
      const overview = await dispatchServiceOrder(item.serviceOrderId, body);
      pendingIntent.current = null;
      setFeedback({ tone: 'success', message: `Ordem ${overview.identity.orderNumber} despachada.` });
    } catch (error) {
      if (error instanceof OperationsApiError && error.kind === 'network') {
        pendingIntent.current = { unitId, orderId: item.serviceOrderId, body, phase: 'uncertain' };
        setUncertainOrderId(item.serviceOrderId);
        setFeedback({ tone: 'error', message: 'Resultado do despacho indeterminado por falha de rede. Consulte a fila; se necessário, reenvie a mesma intenção sem mudar sua chave.' });
      } else {
        pendingIntent.current = null;
        const reasons = error instanceof OperationsApiError ? error.blockingReasons : [];
        setFeedback({ tone: 'error', message: reasons.length
          ? `Despacho bloqueado: ${reasons.map(reason => reason.message).join(' · ')}`
          : describeOperationsError(error) });
      }
    } finally {
      setBusyOrderId(null);
      reload();
      onCommandSettled?.();
    }
  }, [unitId, reload, onCommandSettled]);

  const board = state.phase === 'ready' ? state.board : null;
  const groups = useMemo(() => groupBoard(board), [board]);

  return (
    <ModulePage layout="workspace">
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Controle de despacho"
            count={board ? board.items.length : null}
            context="Prontidão calculada pelo servidor: só sai o que está confirmado. Cada bloqueio declara o motivo e a ação que destrava."
            action={
              <Button type="button" variant="secondary" onClick={reload}>
                Atualizar
              </Button>
            }
          />
        </div>

        {feedback ? (
          <div
            role={feedback.tone === 'error' ? 'alert' : 'status'}
            aria-live="polite"
            className={`mx-1 mb-2 rounded border px-3 py-2 text-xs ${
              feedback.tone === 'error'
                ? 'border-red-200 bg-red-50 text-red-800'
                : 'border-emerald-200 bg-emerald-50 text-emerald-800'
            }`}
          >
            {feedback.message}
          </div>
        ) : null}
        {uncertainOrderId ? (
          <div role="group" aria-label="Despacho com resultado indeterminado" className="mx-1 mb-2 flex gap-2">
            <button type="button" disabled={busyOrderId !== null} onClick={() => {
              const item = state.phase === 'ready'
                ? state.board.items.find(entry => entry.serviceOrderId === uncertainOrderId)
                : undefined;
              if (item) void runDispatch(item);
            }}>Reenviar a mesma intenção</button>
            <button type="button" onClick={() => {
              pendingIntent.current = null;
              setUncertainOrderId(null);
              setFeedback(null);
              reload();
            }}>Encerrar tentativa e atualizar</button>
          </div>
        ) : null}

        <div data-region="worklist-master">
          {state.phase === 'loading' ? (
            <WorklistStatePanel
              title="Lendo o painel de despacho"
              description="Prontidão das ordens liberadas sendo calculada pelo servidor."
            />
          ) : null}

          {state.phase === 'denied' ? (
            <WorklistStatePanel
              title="Acesso negado"
              description="Você não tem permissão para operar o despacho desta unidade."
            />
          ) : null}

          {state.phase === 'error' ? (
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
            >
              <p className="font-semibold">Não foi possível ler o painel</p>
              <p className="mt-1">{state.message}</p>
            </div>
          ) : null}

          {board ? (
            <>
              <BoardCounters board={board} />

              {!unitId ? (
                <WorklistStatePanel
                  title="Nenhuma unidade selecionada"
                  description="O painel de despacho opera por unidade. Selecione uma unidade no contexto do topo."
                />
              ) : null}

              <WorkbenchQueue
                title="Bloqueadas"
                regionLabel="Ordens bloqueadas para despacho"
                count={groups.blocked.length}
                description="Ordens que NÃO podem sair. O motivo e a ação que destrava vêm do servidor."
                emptyTitle="Nenhuma ordem bloqueada"
                emptyDescription="Todas as ordens liberadas estão prontas para sair ou já saíram."
              >
                {groups.blocked.map((item) => (
                  <BlockedRow key={item.serviceOrderId} item={item} onSelectOrder={onSelectOrder} />
                ))}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Prontas para despachar"
                regionLabel="Ordens prontas para despacho"
                count={groups.ready.length}
                description="Confirmadas pelo servidor: equipe, condutor, veículo, documentos, janela e SLA em ordem."
                emptyTitle="Nenhuma ordem pronta"
                emptyDescription="Não há ordem liberada com prontidão confirmada nesta unidade."
              >
                {groups.ready.map((item) => {
                  const dispatchCommand = item.availableCommands.find(
                    (command) => command.code === 'DISPATCH',
                  );
                  return (
                    <WorkbenchQueueItem
                      key={item.serviceOrderId}
                      severity={
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                          Pronta
                        </span>
                      }
                      severityTone="success"
                      title={item.serviceLabel ?? `Ordem ${item.orderNumber}`}
                      reason={item.readiness.summary}
                      context={
                        <>
                          <Link
                            className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                            to={`/app/service-orders/${item.serviceOrderId}`}
                          >
                            {item.orderNumber}
                          </Link>
                          {item.clientLabel ? (
                            <span className="ml-3">{item.clientLabel}</span>
                          ) : null}
                        </>
                      }
                      age={item.slaRemaining ? `SLA ${item.slaRemaining}` : 'sem prazo publicado'}
                      action={
                        dispatchCommand?.enabled ? (
                          <button
                            type="button"
                            className={workbenchPrimaryActionClass}
                            disabled={busyOrderId === item.serviceOrderId}
                            onClick={() => void runDispatch(item)}
                          >
                            {busyOrderId === item.serviceOrderId ? 'Despachando…' : 'Despachar'}
                          </button>
                        ) : (
                          <span className="text-xs text-gray-500">Comando indisponível</span>
                        )
                      }
                      drilldown={
                        <div className="flex flex-wrap gap-2">
                        {onSelectOrder ? <button type="button" className={workbenchSecondaryActionClass} onClick={() => onSelectOrder(item.serviceOrderId)}>Inspecionar na estação</button> : null}
                        <Link
                          className={workbenchSecondaryActionClass}
                          to={`/app/service-orders/${item.serviceOrderId}/execution`}
                        >
                          Abrir execução
                        </Link>
                        </div>
                      }
                    />
                  );
                })}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Despachadas"
                regionLabel="Ordens já despachadas"
                count={groups.dispatched.length}
                description="Ordens que já saíram. A próxima etapa é o registro de chegada e o início da execução."
                emptyTitle="Nenhuma ordem despachada"
                emptyDescription="Nenhuma ordem desta unidade foi despachada ainda."
              >
                {groups.dispatched.map((item) => (
                  <WorkbenchQueueItem
                    key={item.serviceOrderId}
                    severity={
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">
                        Despachada
                      </span>
                    }
                    severityTone="info"
                    title={item.serviceLabel ?? `Ordem ${item.orderNumber}`}
                    reason={
                      item.checkedInAt ? 'Chegada registrada' : 'Chegada ainda não registrada'
                    }
                    context={
                      <Link
                        className="text-xs font-semibold text-brand-700 hover:text-brand-800"
                        to={`/app/service-orders/${item.serviceOrderId}`}
                      >
                        {item.orderNumber}
                      </Link>
                    }
                    age={
                      item.windowStartAt
                        ? `janela ${formatDateTime(item.windowStartAt)}`
                        : 'sem janela'
                    }
                    action={
                      <Link
                        className={workbenchPrimaryActionClass}
                        to={`/app/service-orders/${item.serviceOrderId}/execution`}
                      >
                        Abrir execução
                      </Link>
                    }
                  />
                ))}
              </WorkbenchQueue>
            </>
          ) : null}
        </div>
      </div>
    </ModulePage>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// APRESENTAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function BoardCounters({ board }: { board: DispatchBoardReadModel }) {
  const counters = [
    { label: 'Prontas', value: board.readyCount, tone: 'text-emerald-700' },
    { label: 'Bloqueadas', value: board.blockedCount, tone: 'text-amber-700' },
    { label: 'Em risco', value: board.riskCount, tone: 'text-red-700' },
    { label: 'Despachadas', value: board.dispatchedCount, tone: 'text-brand-700' },
  ];

  return (
    <dl
      aria-label="Resumo do despacho"
      className="mb-2 flex flex-wrap gap-x-8 gap-y-1 px-1 text-xs"
    >
      {counters.map((counter) => (
        <div key={counter.label} className="flex items-baseline gap-2">
          <dt className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
            {counter.label}
          </dt>
          <dd className={`text-lg font-semibold tabular-nums ${counter.tone}`}>{counter.value}</dd>
        </div>
      ))}
      <div className="flex items-baseline gap-2 text-gray-400">
        <dt className="text-[10px] uppercase tracking-wider">Leitura</dt>
        <dd>{formatDateTime(board.freshness.readAt)}</dd>
      </div>
    </dl>
  );
}

function BlockedRow({ item, onSelectOrder }: { item: DispatchBoardItem; onSelectOrder?: (serviceOrderId: string) => void }) {
  const reasons = item.readiness.blockingReasons;

  return (
    <WorkbenchQueueItem
      severity={
        <span className="text-[10px] font-semibold uppercase tracking-wide text-amber-700">
          Bloqueada
        </span>
      }
      severityTone="warning"
      title={item.serviceLabel ?? `Ordem ${item.orderNumber}`}
      reason={reasons[0]?.reason ?? item.readiness.summary}
      context={
        <>
          <Link
            className="text-xs font-semibold text-brand-700 hover:text-brand-800"
            to={`/app/service-orders/${item.serviceOrderId}`}
          >
            {item.orderNumber}
          </Link>
          {item.clientLabel ? <span className="ml-3">{item.clientLabel}</span> : null}
        </>
      }
      age={item.dueAt ? `prazo ${formatDateTime(item.dueAt)}` : 'sem prazo publicado'}
      action={
        <Link
          className={workbenchPrimaryActionClass}
          to={`/app/service-orders/${item.serviceOrderId}/planning`}
        >
          Resolver
        </Link>
      }
      drilldown={
        <div className="flex flex-wrap gap-2">
          {onSelectOrder ? <button type="button" className={workbenchSecondaryActionClass} onClick={() => onSelectOrder(item.serviceOrderId)}>Inspecionar na estação</button> : null}
        <details className="text-xs">
          <summary className="cursor-pointer text-brand-700">
            Ver bloqueios ({reasons.length})
          </summary>
          <ul className="mt-1 space-y-1">
            {reasons.map((reason, index) => (
              <li key={`${reason.dimension}-${index}`} className="flex gap-2">
                <span className="font-semibold text-gray-700">
                  {dimensionLabel(reason.dimension)}
                </span>
                <span className="text-gray-600">{reason.reason ?? reason.reasonCode}</span>
                {reason.resourceCode ? (
                  <span className="text-gray-500">({reason.resourceCode})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </details>
        </div>
      }
    />
  );
}

function dimensionLabel(dimension: string): string {
  const labels: Record<string, string> = {
    PLANNING: 'Planejamento',
    RESERVATION: 'Reserva',
    CREW: 'Equipe',
    DRIVER: 'Condutor',
    VEHICLE: 'Veículo',
    EQUIPMENT: 'Equipamento',
    QUALIFICATION: 'Habilitação',
    MAINTENANCE: 'Manutenção',
    DOCUMENTS: 'Documentos',
    OPERATIONAL_WINDOW: 'Janela',
    SLA: 'SLA',
    EVIDENCE_REQUIREMENTS: 'Evidências',
    CONTRACT_RESTRICTIONS: 'Contrato',
  };
  return labels[dimension] ?? dimension;
}

function groupBoard(board: DispatchBoardReadModel | null) {
  const items = board?.items ?? [];
  return {
    blocked: items.filter((item) => !item.dispatchedAt && !item.readiness.ready),
    ready: items.filter((item) => !item.dispatchedAt && item.readiness.ready),
    dispatched: items.filter((item) => item.dispatchedAt !== null),
  };
}

function emptyBoard(): DispatchBoardReadModel {
  return {
    context: { unitId: '', at: new Date().toISOString() },
    readyCount: 0,
    blockedCount: 0,
    riskCount: 0,
    dispatchedCount: 0,
    items: [],
    freshness: { readAt: new Date().toISOString(), authority: 'SERVER' },
  };
}

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return parsed.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
