import { useCallback, useEffect, useState } from 'react';
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
  describeOperationsError,
  getExecutionConsole,
  OperationsApiError,
} from '../api/operations-api';
import type { ExecutionConsoleItem, ExecutionConsoleReadModel } from '../types/operations.types';
import { SLA_TONE, severityTone, stateLabel } from '../types/operations.types';

/**
 * CONSOLE DE EXECUÇÃO — orientado a EXCEÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * A DECISÃO DE DESIGN QUE DEFINE ESTA TELA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A tela NÃO lista "todas as ordens em execução". Uma ordem no ritmo, sem exceção,
 * é o estado NORMAL — mostrá-la ocupa a atenção do operador com o que está bem.
 *
 * O que aparece, na ordem: ATRASADA → COM BLOQUEIO → EM RISCO DE SLA → PAUSADA.
 * O resto fica na contagem, não na lista. É a diferença entre um painel de
 * vigilância e um relatório.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não calcula SLA, não calcula progresso e não decide se uma ordem está "em risco".
 * `slaStatus` e `progress` chegam prontos do backend. Aqui só se desenha.
 */
export function ExecutionConsolePage({ unitId, onSelectOrder, refreshToken = 0 }: { unitId: string | null; onSelectOrder?: (serviceOrderId: string) => void; refreshToken?: number }) {
  const [state, setState] = useState<
    | { phase: 'loading' }
    | { phase: 'denied' }
    | { phase: 'error'; message: string }
    | { phase: 'ready'; console: ExecutionConsoleReadModel }
  >({ phase: 'loading' });

  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!unitId) {
      setState({ phase: 'ready', console: emptyConsole() });
      return;
    }

    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      try {
        const data = await getExecutionConsole({ unitId: unitId! }, controller.signal);
        if (active && !controller.signal.aborted) {
          setState({ phase: 'ready', console: data });
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
  }, [unitId, reloadToken, refreshToken]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const data = state.phase === 'ready' ? state.console : null;

  const groups = groupConsole(data);

  return (
    <ModulePage layout="workspace">
      <div data-region="work-surface">
        <div data-region="operating-header">
          <WorklistHeader
            title="Execução em curso"
            count={data ? data.items.length : null}
            context="Exceção primeiro: atrasadas, bloqueadas, em risco de SLA e pausadas. O ritmo e o SLA são calculados pelo servidor."
            action={
              <Button type="button" variant="secondary" onClick={reload}>
                Atualizar
              </Button>
            }
          />
        </div>

        <div data-region="worklist-master">
          {state.phase === 'loading' ? (
            <WorklistStatePanel
              title="Lendo a execução"
              description="Situações, SLA e progresso sendo calculados pelo servidor."
            />
          ) : null}

          {state.phase === 'denied' ? (
            <WorklistStatePanel
              title="Acesso negado"
              description="Você não tem permissão para operar a execução desta unidade."
            />
          ) : null}

          {state.phase === 'error' ? (
            <div
              role="alert"
              className="rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800"
            >
              <p className="font-semibold">Não foi possível ler a execução</p>
              <p className="mt-1">{state.message}</p>
            </div>
          ) : null}

          {data ? (
            <>
              <ConsoleSummary data={data} />

              {!unitId ? (
                <WorklistStatePanel
                  title="Nenhuma unidade selecionada"
                  description="O console opera por unidade. Selecione uma unidade no contexto do topo."
                />
              ) : null}

              <WorkbenchQueue
                title="Atrasadas"
                regionLabel="Execuções atrasadas"
                count={groups.late.length}
                description="Prazo de atendimento já vencido. Exige escalonamento."
                emptyTitle="Nenhuma execução atrasada"
                emptyDescription="Nenhuma ordem em execução ultrapassou o prazo publicado."
              >
                {groups.late.map((item) => (
                  <ConsoleRow key={item.serviceOrderId} item={item} onSelectOrder={onSelectOrder} />
                ))}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Bloqueadas"
                regionLabel="Execuções bloqueadas"
                count={groups.blocked.length}
                description="Situação de bloqueio aberta. O dono e a próxima melhor ação vêm do servidor."
                emptyTitle="Nenhuma execução bloqueada"
                emptyDescription="Nenhuma ordem em execução tem situação de bloqueio aberta."
              >
                {groups.blocked.map((item) => (
                  <ConsoleRow key={item.serviceOrderId} item={item} />
                ))}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Em risco de SLA"
                regionLabel="Execuções em risco de SLA"
                count={groups.atRisk.length}
                description="Ritmo abaixo do esperado para o tempo decorrido."
                emptyTitle="Nenhuma execução em risco"
                emptyDescription="Todas as execuções estão dentro do ritmo esperado."
              >
                {groups.atRisk.map((item) => (
                  <ConsoleRow key={item.serviceOrderId} item={item} />
                ))}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Pausadas"
                regionLabel="Execuções pausadas"
                count={groups.paused.length}
                description="Pausa consome SLA sem produzir. Retome ou registre a ocorrência."
                emptyTitle="Nenhuma execução pausada"
                emptyDescription="Não há ordem pausada nesta unidade."
              >
                {groups.paused.map((item) => (
                  <ConsoleRow key={item.serviceOrderId} item={item} />
                ))}
              </WorkbenchQueue>

              <WorkbenchQueue
                title="Em andamento dentro do ritmo"
                regionLabel="Execuções dentro do ritmo"
                count={groups.onTrack.length}
                description="Sem exceção detectada. Fica visível para consulta, não em primeiro plano."
                emptyTitle="Nenhuma execução no ritmo"
                emptyDescription="Nenhuma ordem em execução sem exceção."
              >
                {groups.onTrack.map((item) => (
                  <ConsoleRow key={item.serviceOrderId} item={item} />
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

function ConsoleSummary({ data }: { data: ExecutionConsoleReadModel }) {
  const counters = [
    { label: 'Em execução', value: data.summary.inProgress, tone: 'text-brand-700' },
    { label: 'Pausadas', value: data.summary.paused, tone: 'text-gray-700' },
    { label: 'Em risco', value: data.summary.atRisk, tone: 'text-amber-700' },
    { label: 'Atrasadas', value: data.summary.overdue, tone: 'text-red-700' },
    { label: 'Bloqueadas', value: data.summary.blocked, tone: 'text-red-700' },
  ];

  return (
    <dl
      aria-label="Resumo da execução"
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
        <dd>{formatDateTime(data.freshness.readAt)}</dd>
      </div>
    </dl>
  );
}

function ConsoleRow({ item, onSelectOrder }: { item: ExecutionConsoleItem; onSelectOrder?: (serviceOrderId: string) => void }) {
  const topSituation = item.situations[0];
  const severityToneClass = topSituation ? severityTone(topSituation.severity) : '';

  return (
    <WorkbenchQueueItem
      severity={
        topSituation ? (
          <span
            className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${severityToneClass}`}
          >
            {topSituation.severity} · {stateLabel(item.status)}
          </span>
        ) : (
          <span className="text-[10px] font-semibold uppercase tracking-wide text-brand-700">
            {stateLabel(item.status)}
          </span>
        )
      }
      severityTone={
        item.slaStatus === 'LATE' ? 'critical' : item.slaStatus === 'RISK' ? 'warning' : 'info'
      }
      title={item.serviceLabel ?? `Ordem ${item.orderNumber}`}
      reason={
        topSituation
          ? `${topSituation.title}: ${topSituation.detail}`
          : (item.exceptionReason ?? 'Sem exceção detectada')
      }
      context={
        <>
          <Link
            className="text-xs font-semibold text-brand-700 hover:text-brand-800"
            to={`/app/service-orders/${item.serviceOrderId}/execution`}
          >
            {item.orderNumber}
          </Link>
          {item.clientLabel ? <span className="ml-3">{item.clientLabel}</span> : null}
          {item.progress ? (
            <span className="ml-3 text-gray-600">
              {Math.round(item.progress.ratio * 100)}% de {item.progress.planned}
            </span>
          ) : null}
        </>
      }
      age={
        item.slaRemaining ? (
          <span className={SLA_TONE[item.slaStatus] ?? ''}>SLA {item.slaRemaining}</span>
        ) : (
          'sem prazo publicado'
        )
      }
      action={
        <Link
          className={workbenchPrimaryActionClass}
          to={`/app/service-orders/${item.serviceOrderId}/execution`}
        >
          {item.nextAction?.label ?? 'Abrir execução'}
        </Link>
      }
      drilldown={
        <div className="flex flex-wrap gap-2">
          {onSelectOrder ? <button type="button" className={workbenchSecondaryActionClass} onClick={() => onSelectOrder(item.serviceOrderId)}>Inspecionar na estação</button> : null}
        {topSituation ? (
          <details className="text-xs">
            <summary className="cursor-pointer text-brand-700">
              Ver situações ({item.situations.length})
            </summary>
            <ul className="mt-1 space-y-1">
              {item.situations.map((situation) => (
                <li key={situation.code} className="flex flex-wrap gap-1.5">
                  <span
                    className={`rounded border px-1 text-[10px] font-semibold ${severityTone(situation.severity)}`}
                  >
                    {situation.severity}
                  </span>
                  <span className="font-semibold text-gray-700">{situation.title}</span>
                  <span className="text-gray-500">dono: {ownerLabel(situation.ownerRole)}</span>
                  <span className="text-gray-500">
                    ação: {actionLabel(situation.nextBestAction)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        ) : (
          <Link
            className={workbenchSecondaryActionClass}
            to={`/app/service-orders/${item.serviceOrderId}`}
          >
            Ver ordem
          </Link>
        )}
        </div>
      }
    />
  );
}

function ownerLabel(role: string): string {
  const labels: Record<string, string> = {
    SUPERVISOR_OPERACOES: 'Supervisor de operações',
    CENTRAL_CONTROLE: 'Central de controle',
    COORDENADOR_FROTA: 'Coordenador de frota',
    SUPERVISOR_CAMPO: 'Supervisor de campo',
    COMERCIAL: 'Comercial',
  };
  return labels[role] ?? role;
}

function actionLabel(action: string): string {
  const labels: Record<string, string> = {
    RESOLVE_DISPATCH_BLOCK: 'Resolver bloqueio de despacho',
    START_EXECUTION: 'Iniciar execução',
    PRIORITIZE_EXECUTION: 'Priorizar execução',
    ESCALATE: 'Escalonar',
    RESUME_EXECUTION: 'Retomar execução',
    REPLACE_RESOURCE: 'Substituir recurso',
    REGISTER_MISSING_ACTUALS: 'Registrar dados reais',
    ATTACH_EVIDENCE: 'Anexar evidência',
    REVIEW_METER: 'Revisar leitura',
    REVIEW_FUEL: 'Revisar combustível',
    JUSTIFY_RESOURCE_CHANGE: 'Justificar troca de recurso',
    REVIEW_REQUIREMENTS: 'Revisar requisitos',
  };
  return labels[action] ?? action;
}

function groupConsole(data: ExecutionConsoleReadModel | null) {
  const items = data?.items ?? [];
  const used = new Set<string>();

  const take = (predicate: (item: ExecutionConsoleItem) => boolean) =>
    items.filter((item) => {
      if (used.has(item.serviceOrderId) || !predicate(item)) {
        return false;
      }
      used.add(item.serviceOrderId);
      return true;
    });

  return {
    late: take((item) => item.slaStatus === 'LATE'),
    blocked: take((item) => item.situations.some((situation) => situation.blocking)),
    atRisk: take((item) => item.slaStatus === 'RISK'),
    paused: take((item) => item.status === 'PAUSED'),
    onTrack: take(() => true),
  };
}

function emptyConsole(): ExecutionConsoleReadModel {
  return {
    context: { unitId: '', at: new Date().toISOString() },
    summary: { inProgress: 0, paused: 0, atRisk: 0, overdue: 0, blocked: 0 },
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
