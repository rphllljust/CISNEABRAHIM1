/**
 * OPERATIONAL LIFECYCLE — a leitura do processo, derivada do que já é persistido.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE E POR QUE ELE **NÃO** CRIA STATUS NOVOS
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A capability precisa responder "em que ponto do processo esta ordem está?" com
 * mais precisão do que `status = IN_EXECUTION`. A primeira tentação — e a errada —
 * seria acrescentar valores ao enum `so.service_order_status`
 * (`READY_FOR_DISPATCH`, `DISPATCHED`, `MEASUREMENT_READY`, ...).
 *
 * Isso seria um erro por três motivos concretos:
 *
 *   1. `so.service_order_status` é a state machine do AGREGADO, consumida por
 *      metatados, RBAC, relatórios, medição e faturamento. Ampliá-la quebra todos.
 *   2. `DISPATCHED` não é consequência de `RELEASED`: é um FATO com autor, janela e
 *      recursos confirmados. Fato se persiste, status se sobrescreve.
 *   3. `MEASUREMENT_READY` não pertence à OS: pertence ao fechamento da execução.
 *
 * A solução: o ciclo operacional é uma PROJEÇÃO. Cada estágio é derivado de um
 * fato REAL e persisting (linha em tabela), nunca de uma inferência de status.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CADEIA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   PLANNED               há `planned_resources` PLANNED
 *   READY_FOR_DISPATCH    plano confirmado + reserva ativa + prontidão avaliada
 *   DISPATCHED            existe `service_order_dispatches`
 *   CHECKED_IN            `service_order_dispatches.checked_in_at` preenchido
 *   IN_EXECUTION          status IN_EXECUTION ou PAUSED (fato: `started_at`)
 *   ACTUALS_RECORDING     existe realizado capturado
 *   COMPLETION_PENDING    execução concluída e ainda sem fechamento
 *   EXECUTION_CLOSED      existe `execution_closures`
 *   MEASUREMENT_READY     existe `measurement_basis` READY
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não é state machine de comando: a autoridade das transições continua em
 * `service-order.state-machine.ts`. Aqui só se LÊ o que já aconteceu.
 */

import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from './service-order';

export const OPERATIONAL_STAGES = [
  'PLANNED',
  'READY_FOR_DISPATCH',
  'DISPATCHED',
  'CHECKED_IN',
  'IN_EXECUTION',
  'ACTUALS_RECORDING',
  'COMPLETION_PENDING',
  'EXECUTION_CLOSED',
  'MEASUREMENT_READY',
] as const;

export type OperationalStage = (typeof OPERATIONAL_STAGES)[number];

/** Situação do estágio na leitura: feito, atual, pendente ou com atenção. */
export const OPERATIONAL_STAGE_STATES = {
  Done: 'DONE',
  Current: 'CURRENT',
  Pending: 'PENDING',
  Attention: 'ATTENTION',
  NotApplicable: 'NOT_APPLICABLE',
} as const;

export type OperationalStageState =
  (typeof OPERATIONAL_STAGE_STATES)[keyof typeof OPERATIONAL_STAGE_STATES];

export type OperationalStageStep = {
  stage: OperationalStage;
  label: string;
  state: OperationalStageState;
  /** Fato que sustenta o estágio (instante persistido). */
  at: string | null;
  /** Rótulo do subestado real (ex.: `PAUSADA`, `REALIZADO PARCIAL`). */
  detail: string | null;
  /** Rota do objeto associado, quando ele existe. */
  href: string | null;
};

/** Fatos persistidos que sustentam a leitura. Cada um vem de UMA tabela real. */
export type OperationalLifecycleFacts = {
  serviceOrderId: string;
  /** `so.service_orders.status`. */
  status: ServiceOrderStatus;
  /** Quantidade de `so.planned_resources` com status PLANNED. */
  plannedResourceCount: number;
  /** Quantidade de `res.resource_allocations` com status ACTIVE. */
  activeAllocationCount: number;
  /** `so.service_order_dispatches` — `null` quando não despachada. */
  dispatchedAt: string | null;
  checkedInAt: string | null;
  /** `so.service_orders.started_at`. */
  startedAt: string | null;
  /** `so.service_orders.paused_at` — não nulo significa pausada agora. */
  pausedAt: string | null;
  /** `so.service_orders.completed_at`. */
  completedAt: string | null;
  /** Quantidade de `so.execution_actuals` da ordem. */
  actualCount: number;
  /** `so.execution_closures.closed_at` — `null` quando não fechada. */
  executionClosedAt: string | null;
  /** `so.measurement_basis` READY — `null` quando não publicada. */
  measurementBasisPreparedAt: string | null;
  /** Existe situação de bloqueio aberta. */
  hasBlockingSituation: boolean;
};

const STAGE_LABELS: Record<OperationalStage, string> = {
  PLANNED: 'Planejamento',
  READY_FOR_DISPATCH: 'Pronto para despacho',
  DISPATCHED: 'Despacho',
  CHECKED_IN: 'Chegada',
  IN_EXECUTION: 'Execução',
  ACTUALS_RECORDING: 'Realizado',
  COMPLETION_PENDING: 'Conclusão',
  EXECUTION_CLOSED: 'Execução fechada',
  MEASUREMENT_READY: 'Medição',
};

export function operationalStageLabel(stage: OperationalStage): string {
  return STAGE_LABELS[stage];
}

/**
 * Deriva o ciclo operacional.
 *
 * A regra de avanço é por FATO, não por posição: um estágio está DONE quando o
 * fato que o encerra existe. Isso significa que a leitura nunca "pula" um estágio
 * que não aconteceu — se o check-in não foi feito, `CHECKED_IN` fica pendente mesmo
 * que a execução já tenha começado. É o que permite ao operador ver que uma etapa
 * obrigatória foi saltada.
 */
export function deriveOperationalLifecycle(
  facts: OperationalLifecycleFacts,
): OperationalStageStep[] {
  const hrefBase = `/app/service-orders/${facts.serviceOrderId}`;

  const planned = facts.plannedResourceCount > 0;
  const reserved = facts.activeAllocationCount > 0;
  const dispatched = facts.dispatchedAt !== null;
  const checkedIn = facts.checkedInAt !== null;
  const started = facts.startedAt !== null;
  const paused = facts.pausedAt !== null && facts.completedAt === null;
  const completed = facts.completedAt !== null;
  const hasActuals = facts.actualCount > 0;
  const closed = facts.executionClosedAt !== null;
  const measurable = facts.measurementBasisPreparedAt !== null;

  /**
   * `READY_FOR_DISPATCH` não tem tabela própria porque não é fato: é a CONDIÇÃO
   * "planejado + reservado". Persistir essa condição criaria um dado que pode
   * ficar obsoleto em relação aos fatos que o originam. Derivar mantém a leitura
   * sempre verdadeira.
   */
  const readyForDispatch = planned && reserved && !dispatched;

  const cancelled = facts.status === SERVICE_ORDER_STATUSES.Cancelled;

  const steps: OperationalStageStep[] = [
    {
      stage: 'PLANNED',
      label: operationalStageLabel('PLANNED'),
      state: planned ? OPERATIONAL_STAGE_STATES.Done : OPERATIONAL_STAGE_STATES.Pending,
      at: null,
      detail: planned ? `${facts.plannedResourceCount} recurso(s) planejado(s)` : null,
      href: `${hrefBase}/planning`,
    },
    {
      stage: 'READY_FOR_DISPATCH',
      label: operationalStageLabel('READY_FOR_DISPATCH'),
      state: dispatched
        ? OPERATIONAL_STAGE_STATES.Done
        : readyForDispatch
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: null,
      detail: !planned
        ? 'Sem planejamento'
        : !reserved
          ? 'Sem reserva de recurso'
          : readyForDispatch
            ? 'Pronto para sair'
            : null,
      href: `${hrefBase}/planning`,
    },
    {
      stage: 'DISPATCHED',
      label: operationalStageLabel('DISPATCHED'),
      state: dispatched
        ? OPERATIONAL_STAGE_STATES.Done
        : readyForDispatch
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.dispatchedAt,
      detail: null,
      href: `${hrefBase}/execution`,
    },
    {
      /**
       * CHEGADA: o check-in pode ser legitimamente saltado quando o serviço não
       * exige deslocamento. Nesse caso ele é NÃO APLICÁVEL em vez de "pendente para
       * sempre" — uma etapa eternamente vermelha deixa de ser informação.
       */
      stage: 'CHECKED_IN',
      label: operationalStageLabel('CHECKED_IN'),
      state: checkedIn
        ? OPERATIONAL_STAGE_STATES.Done
        : dispatched
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.checkedInAt,
      detail: !dispatched ? 'Aguardando despacho' : checkedIn ? null : 'Check-in não realizado',
      href: `${hrefBase}/execution`,
    },
    {
      stage: 'IN_EXECUTION',
      label: operationalStageLabel('IN_EXECUTION'),
      state: started
        ? paused
          ? OPERATIONAL_STAGE_STATES.Attention
          : OPERATIONAL_STAGE_STATES.Done
        : dispatched
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.startedAt,
      detail: paused ? 'Pausada' : started ? 'Em andamento' : null,
      href: `${hrefBase}/execution`,
    },
    {
      stage: 'ACTUALS_RECORDING',
      label: operationalStageLabel('ACTUALS_RECORDING'),
      state: !started
        ? OPERATIONAL_STAGE_STATES.Pending
        : hasActuals && completed
          ? OPERATIONAL_STAGE_STATES.Done
          : hasActuals
            ? OPERATIONAL_STAGE_STATES.Current
            : OPERATIONAL_STAGE_STATES.Attention,
      at: null,
      detail: hasActuals
        ? `${facts.actualCount} realizado(s) registrado(s)`
        : started
          ? 'Nenhum realizado registrado'
          : null,
      href: `${hrefBase}/execution`,
    },
    {
      stage: 'COMPLETION_PENDING',
      label: operationalStageLabel('COMPLETION_PENDING'),
      state: completed
        ? closed
          ? OPERATIONAL_STAGE_STATES.Done
          : OPERATIONAL_STAGE_STATES.Attention
        : started
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.completedAt,
      detail: completed && !closed ? 'Concluída, execução não fechada' : null,
      href: `${hrefBase}/execution`,
    },
    {
      stage: 'EXECUTION_CLOSED',
      label: operationalStageLabel('EXECUTION_CLOSED'),
      state: closed
        ? OPERATIONAL_STAGE_STATES.Done
        : completed
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.executionClosedAt,
      detail: null,
      href: `${hrefBase}/execution`,
    },
    {
      stage: 'MEASUREMENT_READY',
      label: operationalStageLabel('MEASUREMENT_READY'),
      state: measurable
        ? OPERATIONAL_STAGE_STATES.Done
        : closed
          ? OPERATIONAL_STAGE_STATES.Current
          : OPERATIONAL_STAGE_STATES.Pending,
      at: facts.measurementBasisPreparedAt,
      detail: measurable ? 'Base de medição publicada' : closed ? 'Base de medição pendente' : null,
      href: `${hrefBase}/measurement`,
    },
  ];

  if (cancelled) {
    return steps.map((step) =>
      step.state === OPERATIONAL_STAGE_STATES.Done
        ? step
        : { ...step, state: OPERATIONAL_STAGE_STATES.NotApplicable },
    );
  }

  if (facts.hasBlockingSituation) {
    // A situação de bloqueio marca o estágio ATUAL como atenção, sem reescrever o
    // histórico: o que já aconteceu continua acontecido.
    return steps.map((step) =>
      step.state === OPERATIONAL_STAGE_STATES.Current
        ? { ...step, state: OPERATIONAL_STAGE_STATES.Attention }
        : step,
    );
  }

  return steps;
}

/**
 * Estágio ATUAL derivado: o primeiro `CURRENT` ou `ATTENTION`, ou o último `DONE`.
 * `null` só quando não há nada.
 */
export function currentOperationalStage(steps: OperationalStageStep[]): OperationalStage | null {
  const active = steps.find(
    (step) =>
      step.state === OPERATIONAL_STAGE_STATES.Current ||
      step.state === OPERATIONAL_STAGE_STATES.Attention,
  );
  if (active) {
    return active.stage;
  }
  const done = [...steps].reverse().find((step) => step.state === OPERATIONAL_STAGE_STATES.Done);
  return done?.stage ?? null;
}

/**
 * A EXECUÇÃO está ENCERRADA? Distinto de "OS concluída".
 *
 * `COMPLETED` é o estado do agregado; `EXECUTION_CLOSED` é o fato de que os
 * realizados foram congelados e a base de medição existe. A medição só pode
 * começar sobre a segunda.
 */
export function isExecutionClosed(facts: OperationalLifecycleFacts): boolean {
  return facts.executionClosedAt !== null;
}

/** A ordem está pronta para medição? */
export function isMeasurementReady(facts: OperationalLifecycleFacts): boolean {
  return facts.measurementBasisPreparedAt !== null;
}
