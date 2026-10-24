import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '../../ui';
import {
  WorklistHeader,
  WorklistStatePanel,
  WorklistField,
  worklistSelectClass,
} from '../../ui/enterprise-list';
import {
  WorkbenchQueue,
  WorkbenchQueueItem,
  workbenchPrimaryActionClass,
  workbenchSecondaryActionClass,
} from '../../ui/workbench';
import { WorkbenchFloorplan, ContextBlock, ContextFact } from '../../ui/workbench-floorplan';
import { StatusBadge } from '../../ui/StatusBadge';
import { OperationalUnitOptions, useOperationalUnits } from '../../shell/hooks/useOperationalUnits';
import { EconomicStatusStrip } from '../components/EconomicStatusStrip';
import {
  ECONOMIC_FINANCIAL_LABELS,
  ECONOMIC_STATE_LABELS,
  EconomicTraceApiError,
  fetchEconomicWorklist,
  fetchSettlementTrace,
  fetchPaymentTrace,
  retryEconomicPosting,
  type EconomicWorkItem,
  type EconomicWorklistView,
  type EconomicAccountingState,
} from '../api/economic-trace-api';

/**
 * F1.1 — ACCOUNTING EXCEPTION WORKBENCH.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * FLOORPLAN ESCOLHIDO: WORKBENCH (queue → active work → context)
 *
 * A pergunta que classifica a página é: o operador só precisa VER a fila, ou precisa
 * INVESTIGAR e RESOLVER? Uma divergência contábil exige entender causa, impacto e
 * consequência antes de agir — logo é Workbench, não Work Queue nem Control Tower.
 *
 *   ESQUERDA  — fila de resolução: o que exige ação agora, por gravidade real.
 *   CENTRO    — caso ativo: estado financeiro E contábil do fato escolhido.
 *   DIREITA   — contexto da decisão: causa, impacto, responsável, próxima ação e
 *               os comandos que o BACKEND autorizou.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * O QUE ESTA TELA NÃO FAZ
 *
 * Não decide nada: `situation`, `severity`, `reason`, `nextAction` e
 * `availableCommands` vêm do servidor. Não reimplementa fila (usa `WorkbenchQueue`),
 * não reimplementa badge (usa `StatusBadge`) e não escreve
 * `if (status === X && role === Y)`.
 */

const PAGE_LIMIT = 25;

type State =
  | { phase: 'loading' }
  | { phase: 'ready'; data: EconomicWorklistView }
  | { phase: 'error'; message: string; denied: boolean };

function failureCopy(reason: unknown): { message: string; denied: boolean } {
  if (reason instanceof EconomicTraceApiError) {
    if (reason.kind === 'denied') {
      return {
        message: 'Você não tem permissão para ler as exceções de contabilização desta unidade.',
        denied: true,
      };
    }
    if (reason.kind === 'network') {
      return {
        message:
          'Não foi possível falar com o servidor: a fila de exceções é desconhecida nesta leitura — não é zero.',
        denied: false,
      };
    }
    if (reason.kind === 'unauthenticated') {
      return { message: 'Sua sessão expirou. Entre novamente para ver a fila.', denied: false };
    }
  }
  return { message: 'Não foi possível ler as exceções de contabilização.', denied: false };
}

export function EconomicPostingWorklistPage() {
  const { options: unitOptions, unitId, setUnitId } = useOperationalUnits();
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<EconomicAccountingState | null>(null);

  useEffect(() => {
    if (!unitId) {
      // Sem unidade não há fila — e isso NÃO é "zero exceções".
      setState({
        phase: 'error',
        message: 'Selecione uma unidade para ver as exceções de contabilização.',
        denied: false,
      });
      return;
    }
    const controller = new AbortController();
    let active = true;

    async function run() {
      setState({ phase: 'loading' });
      try {
        const data = await fetchEconomicWorklist(
          unitId,
          { limit: PAGE_LIMIT, offset: 0 },
          controller.signal,
        );
        if (active && !controller.signal.aborted) {
          setState({ phase: 'ready', data });
        }
      } catch (reason) {
        if (active && !controller.signal.aborted) {
          setState({ phase: 'error', ...failureCopy(reason) });
        }
      }
    }

    void run();
    return () => {
      active = false;
      controller.abort();
    };
  }, [unitId, reloadToken]);

  const reload = useCallback(() => {
    setActionError(null);
    setReloadToken((token) => token + 1);
  }, []);

  const items = state.phase === 'ready' ? state.data.items : [];

  /**
   * FILTRO DE STATUS — o drill-through da faixa de resumo.
   *
   * É filtro de APRESENTAÇÃO sobre o conjunto já autorizado e já recortado pelo
   * backend. Não decide contabilidade: só escolhe qual fatia da fila o operador
   * quer ver. Por isso pode viver no React sem violar a regra.
   */
  const filteredItems = useMemo(() => {
    if (!statusFilter) {
      return items;
    }
    return items.filter((item) => item.accountingState === statusFilter);
  }, [items, statusFilter]);

  // Caso ativo = o selecionado, ou o primeiro da fila (exceção primeiro, por gravidade).
  const activeItem = useMemo(() => {
    if (filteredItems.length === 0) {
      return null;
    }
    return (
      filteredItems.find((item) => `${item.factKind}:${item.factId}` === selectedId) ??
      filteredItems[0]!
    );
  }, [filteredItems, selectedId]);

  const resolve = useCallback(
    async (item: EconomicWorkItem) => {
      if (!item.availableCommands.includes('RETRY_POSTING')) {
        return;
      }
      setResolvingId(item.factId);
      setActionError(null);
      setLastResult(null);
      try {
        const trace =
          item.factKind === 'SETTLEMENT'
            ? await fetchSettlementTrace(item.factId)
            : await fetchPaymentTrace(item.factId);
        const outboxEventId = trace.economicEvent?.outboxEventId ?? null;
        if (!outboxEventId) {
          setActionError(
            'Este fato não possui evento de transporte identificado — a contabilização não pode ser reprocessada por aqui.',
          );
          return;
        }
        const result = await retryEconomicPosting(outboxEventId);
        setLastResult(
          `Contabilização reprocessada: ${result.outcome}. Lançamento ${result.journalEntryId}.`,
        );
        reload();
      } catch (reason) {
        setActionError(failureCopy(reason).message);
      } finally {
        setResolvingId(null);
      }
    },
    [reload],
  );

  const data = state.phase === 'ready' ? state.data : null;
  const openCount = data ? data.counts.pending + data.counts.failed : null;

  return (
    <div data-region="work-surface">
      <div data-region="operating-header">
        <WorklistHeader
          title="Contabilização pendente"
          count={openCount}
          context="Fatos econômicos reconhecidos pelo financeiro e ainda não registrados pela contabilidade. Selecione um caso para ler causa, impacto e a próxima ação."
          action={
            <Button type="button" variant="secondary" onClick={reload}>
              Atualizar
            </Button>
          }
        />
      </div>

      <div className="flex flex-wrap items-end gap-3 px-2 pb-2">
        <WorklistField label="Unidade" htmlFor="economic-trace-unit">
          <select
            id="economic-trace-unit"
            className={worklistSelectClass}
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
          >
            <OperationalUnitOptions options={unitOptions} includeAllLabel="Selecione a unidade" />
          </select>
        </WorklistField>
      </div>

      {lastResult ? (
        <p
          role="status"
          className="mx-2 mb-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-xs text-emerald-900"
        >
          {lastResult}
        </p>
      ) : null}

      {actionError ? (
        <p
          role="alert"
          className="mx-2 mb-2 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800"
        >
          {actionError}
        </p>
      ) : null}

      {state.phase === 'loading' ? (
        <WorklistStatePanel
          title="Lendo as exceções"
          description="Fatos econômicos e situação contábil estão sendo lidos do servidor."
        />
      ) : null}

      {state.phase === 'error' ? (
        <WorklistStatePanel
          title={state.denied ? 'Acesso negado' : 'Leitura indisponível'}
          description={state.message}
        />
      ) : null}

      {data ? (
        <EconomicStatusStrip
          counts={data.counts}
          activeFilter={statusFilter}
          onFilterChange={setStatusFilter}
          unitLabel={unitId}
        />
      ) : null}

      {data ? (
        <WorkbenchFloorplan
          queueLabel="Fila de resolução"
          activeLabel="Caso ativo"
          contextLabel="Contexto da decisão"
          queue={
            <WorkbenchQueue
              title="Exceções"
              regionLabel="Exceções de contabilização"
              count={filteredItems.length}
              description="Só entra o que exige ação."
              emptyTitle="Nenhuma exceção de contabilização"
              emptyDescription="Todos os fatos econômicos desta unidade estão contabilizados."
            >
              {filteredItems.map((item) => {
                const key = `${item.factKind}:${item.factId}`;
                const isActive =
                  activeItem !== null &&
                  `${activeItem.factKind}:${activeItem.factId}` === key;
                return (
                  <WorkbenchQueueItem
                    key={key}
                    severity={
                      <StatusBadge
                        label={ECONOMIC_STATE_LABELS[item.accountingState]}
                        tone={severityToStatusBadgeTone(item.severity)}
                      />
                    }
                    severityTone={severityToQueueTone(item.severity)}
                    title={`${item.factKind === 'SETTLEMENT' ? 'Liquidação' : 'Pagamento'} · ${formatMoney(item.amount, item.currencyCode)}`}
                    reason={item.reason}
                    context={
                      <button
                        type="button"
                        onClick={() => setSelectedId(key)}
                        className={
                          isActive
                            ? 'text-xs font-semibold text-brand-800 underline'
                            : 'text-xs font-semibold text-brand-700 hover:text-brand-800'
                        }
                        title="Abrir este caso no centro"
                      >
                        {item.factKind === 'SETTLEMENT' ? 'Liquidação' : 'Pagamento'}{' '}
                        {item.factId.slice(0, 8)}
                      </button>
                    }
                    age={item.firstFailedAt ? `desde ${formatDate(item.firstFailedAt)}` : 'sem data'}
                    action={
                      item.availableCommands.includes('RETRY_POSTING') ? (
                        <button
                          type="button"
                          className={workbenchPrimaryActionClass}
                          onClick={() => void resolve(item)}
                          disabled={resolvingId === item.factId}
                        >
                          {resolvingId === item.factId ? 'Reprocessando…' : item.nextAction.label}
                        </button>
                      ) : null
                    }
                    drilldown={
                      <Link
                        className={workbenchSecondaryActionClass}
                        to={item.route}
                      >
                        Trilha
                      </Link>
                    }
                  />
                );
              })}
            </WorkbenchQueue>
          }
          active={
            activeItem ? (
              <>
                <ContextBlock title="Estado do fato">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <ContextFact
                      label="Financeiro"
                      value={ECONOMIC_FINANCIAL_LABELS[activeItem.financialState]}
                    />
                    <ContextFact
                      label="Contabilidade"
                      value={ECONOMIC_STATE_LABELS[activeItem.accountingState]}
                    />
                    <ContextFact
                      label="Valor"
                      value={formatMoney(activeItem.amount, activeItem.currencyCode)}
                    />
                    <ContextFact label="Tentativas" value={String(activeItem.attempts)} />
                  </dl>
                </ContextBlock>

                <ContextBlock
                  title="Causa registrada"
                  tone={activeItem.severity === 'CRITICAL' ? 'critical' : 'warning'}
                >
                  <p className="m-0 text-xs">{activeItem.reason}</p>
                  {activeItem.firstFailedAt ? (
                    <p className="mt-1 mb-0 text-xs">
                      Falha observada desde {formatDate(activeItem.firstFailedAt)}.
                    </p>
                  ) : null}
                </ContextBlock>

                <ContextBlock title="Referência do fato">
                  <p className="m-0 text-xs">{activeItem.reference}</p>
                  <p className="mt-1 mb-0 text-xs">Unidade {activeItem.unitId}</p>
                </ContextBlock>

                {/*
                  ECONOMIC TRACE — a cadeia do fato, no próprio centro.

                  O plano diretor põe a rastreabilidade DENTRO do workbench, não só na
                  página de trilha: o operador precisa ver de onde o fato veio e onde
                  ele parou sem sair do caso. Os nós abaixo são os que o read model da
                  fila publica (fato → evento → posting). Journal só existe se o posting
                  tiver sido emitido — declaramos a ausência em vez de omitir o elo.
                */}
                <ContextBlock title="Trilha econômica">
                  <ol className="m-0 list-none p-0 text-xs">
                    <TraceStep
                      label={activeItem.factKind === 'SETTLEMENT' ? 'Recebível' : 'Título a pagar'}
                      detail="Origem financeira do fato"
                      state="done"
                    />
                    <TraceStep
                      label={activeItem.factKind === 'SETTLEMENT' ? 'Liquidação' : 'Pagamento'}
                      detail={formatMoney(activeItem.amount, activeItem.currencyCode)}
                      state="done"
                    />
                    <TraceStep
                      label="Evento econômico"
                      detail="Publicado na outbox transacional"
                      state="done"
                    />
                    <TraceStep
                      label="Posting"
                      detail={
                        activeItem.accountingState === 'POSTED'
                          ? 'Lançamento emitido'
                          : activeItem.accountingState === 'FAILED'
                            ? 'Falhou — sem lançamento'
                            : 'Aguardando decisão contábil'
                      }
                      state={activeItem.accountingState === 'FAILED' ? 'failed' : activeItem.accountingState === 'POSTED' ? 'done' : 'pending'}
                    />
                    <TraceStep
                      label="Lançamento"
                      detail={
                        activeItem.accountingState === 'POSTED'
                          ? 'Ver na trilha completa'
                          : 'Não gerado'
                      }
                      state={activeItem.accountingState === 'POSTED' ? 'done' : 'pending'}
                    />
                  </ol>
                  <Link
                    className="mt-2 inline-block text-xs font-semibold text-brand-700 underline"
                    to={activeItem.route}
                  >
                    Abrir a trilha completa até o lançamento
                  </Link>
                </ContextBlock>
              </>
            ) : (
              <ContextBlock title="Nenhum caso selecionado">
                <p className="m-0 text-xs">
                  A fila está vazia: não há fato econômico aguardando contabilização nesta unidade.
                </p>
              </ContextBlock>
            )
          }
          context={
            activeItem ? (
              <>
                <ContextBlock title="Próxima ação">
                  <p className="m-0 text-xs font-semibold">{activeItem.nextAction.label}</p>
                  <p className="mt-1 mb-0 text-xs">{activeItem.nextAction.reason}</p>
                  {activeItem.nextAction.owner ? (
                    <p className="mt-1 mb-0 text-xs">
                      Responsável: {activeItem.nextAction.owner}
                    </p>
                  ) : null}
                  {activeItem.availableCommands.includes('RETRY_POSTING') ? (
                    <button
                      type="button"
                      className={`${workbenchPrimaryActionClass} mt-2`}
                      onClick={() => void resolve(activeItem)}
                      disabled={resolvingId === activeItem.factId}
                    >
                      {resolvingId === activeItem.factId ? 'Reprocessando…' : 'Reprocessar contabilização'}
                    </button>
                  ) : null}
                </ContextBlock>

                <ContextBlock title="Contagens do recorte">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
                    <ContextFact label="Pendentes" value={String(data.counts.pending)} />
                    <ContextFact label="Falharam" value={String(data.counts.failed)} />
                    <ContextFact label="Estornados" value={String(data.counts.reversed)} />
                    <ContextFact label="Na página" value={String(data.items.length)} />
                  </dl>
                </ContextBlock>
              </>
            ) : null
          }
        />
      ) : null}
    </div>
  );
}

/**
 * Traduções de SEVERIDADE (conceito de negócio, do backend) para os dois vocabulários
 * de apresentação que o design system já tem.
 *
 * Existem DOIS porque os dois componentes declaram tons diferentes — e unificá-los aqui
 * seria mudar contrato alheio sem necessidade. Ambos são APRESENTAÇÃO PURA: nenhum
 * decide severidade, apenas escolhe a cor do que veio do servidor.
 *
 * - `StatusBadge` fala `error|warning|info|success|neutral`.
 * - `WorkbenchQueueItem` fala `critical|warning|info|success|neutral` (a régua lateral).
 */
type EconomicSeverity = 'CRITICAL' | 'WARNING' | 'INFO' | 'NONE';

function severityToStatusBadgeTone(
  severity: EconomicSeverity,
): 'error' | 'warning' | 'info' | 'success' {
  switch (severity) {
    case 'CRITICAL':
      return 'error';
    case 'WARNING':
      return 'warning';
    case 'INFO':
      return 'info';
    case 'NONE':
      return 'success';
  }
}

function severityToQueueTone(
  severity: EconomicSeverity,
): 'critical' | 'warning' | 'info' | 'success' | 'neutral' {
  switch (severity) {
    case 'CRITICAL':
      return 'critical';
    case 'WARNING':
      return 'warning';
    case 'INFO':
      return 'info';
    case 'NONE':
      return 'success';
  }
}


/**
 * Um elo da cadeia econômica exibida no caso ativo.
 *
 * `state` é APRESENTAÇÃO (cor do marcador); o estado real vem do backend em
 * `accountingState`. Um elo `failed` significa que a cadeia PAROU ali — é isso que o
 * operador precisa enxergar sem abrir outra tela.
 */
function TraceStep({
  label,
  detail,
  state,
}: {
  label: string;
  detail: string;
  state: 'done' | 'pending' | 'failed';
}) {
  const marker = state === 'done' ? '✓' : state === 'failed' ? '✕' : '○';
  const tone =
    state === 'done'
      ? 'text-emerald-700'
      : state === 'failed'
        ? 'text-red-700'
        : 'text-[color:var(--color-text-secondary)]';
  return (
    <li className="flex items-baseline gap-2 border-b border-gray-100 py-1 last:border-b-0">
      <span className={`font-semibold ${tone}`} aria-hidden="true">
        {marker}
      </span>
      <span className="font-medium">{label}</span>
      <span className="text-[color:var(--color-text-secondary)]">{detail}</span>
    </li>
  );
}

function formatMoney(amount: string, currencyCode: string): string {
  const parsed = Number(amount);
  if (!Number.isFinite(parsed)) {
    return `${amount} ${currencyCode}`;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode || 'BRL',
  }).format(parsed);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('pt-BR');
}
