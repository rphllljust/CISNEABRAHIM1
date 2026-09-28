import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from './service-order';
import type { ServiceOrderTransition } from './service-order.state-machine';
import type { ServiceOrderControlCenterFacts } from '../repositories/service-order-control-center.persistence';

/**
 * Projecao derivada do Operations Control Center.
 *
 * A progressao e VISUAL/DERIVADA: cada etapa declara o estado REAL do modulo dono (OS, medicao,
 * faturamento) e nunca substitui uma state machine por um status unico. Nao existe tabela, coluna
 * ou evento novo aqui — apenas leitura do que ja esta persistido.
 */

export type ControlCenterStepCode =
  | 'DEMAND'
  | 'PLANNING'
  | 'RELEASE'
  | 'EXECUTION'
  | 'COMPLETION'
  | 'MEASUREMENT'
  | 'BILLING';

export type ControlCenterStepState = 'DONE' | 'CURRENT' | 'PENDING' | 'ATTENTION';

export type ControlCenterStep = {
  code: ControlCenterStepCode;
  state: ControlCenterStepState;
  /** Fato real que sustenta a etapa (quando existir). */
  at: string | null;
  detail: string | null;
  /** Estado do modulo dono, quando a etapa pertence a outro agregado. */
  ownerStatus: string | null;
};

export type ControlCenterPlannedVsActual = {
  plannedResources: number;
  activeAllocations: number;
  executionEntries: number;
  executedQuantityTotal: string | null;
  divergences: string[];
};

export type ControlCenterControl = {
  progression: ControlCenterStep[];
  plannedVsActual: ControlCenterPlannedVsActual;
  downstream: {
    measurement: { count: number; status: string | null; createdAt: string | null };
    billing: {
      count: number;
      status: string | null;
      createdAt: string | null;
      /** Valor somente quando o modulo de faturamento autoriza; caso contrario `null`. */
      totalAmount: string | null;
      currencyCode: string | null;
    };
  };
  nextAction: {
    step: string;
    transition: ServiceOrderTransition | null;
    availableTransitions: ServiceOrderTransition[];
    blockers: string[];
  };
};

/** Acao de autorizacao exigida por cada transicao real da OS (espelha o service). */
export const CONTROL_CENTER_TRANSITION_ORDER: ServiceOrderTransition[] = [
  'prepare',
  'release',
  'start',
  'pause',
  'resume',
  'complete',
  'cancel',
];

function stepFor(status: ServiceOrderStatus): ControlCenterStepCode {
  switch (status) {
    case SERVICE_ORDER_STATUSES.Draft:
      return 'PLANNING';
    case SERVICE_ORDER_STATUSES.Prepared:
      return 'PLANNING';
    case SERVICE_ORDER_STATUSES.Released:
      return 'RELEASE';
    case SERVICE_ORDER_STATUSES.InExecution:
    case SERVICE_ORDER_STATUSES.Paused:
      return 'EXECUTION';
    case SERVICE_ORDER_STATUSES.Completed:
      return 'COMPLETION';
    default:
      return 'DEMAND';
  }
}

export function nextServiceOrderStep(
  status: ServiceOrderStatus,
): { step: string; transition: ServiceOrderTransition | null } {
  switch (status) {
    case SERVICE_ORDER_STATUSES.Draft:
      return { step: 'PREPARE', transition: 'prepare' };
    case SERVICE_ORDER_STATUSES.Prepared:
      return { step: 'RELEASE', transition: 'release' };
    case SERVICE_ORDER_STATUSES.Released:
      return { step: 'START_EXECUTION', transition: 'start' };
    case SERVICE_ORDER_STATUSES.InExecution:
      return { step: 'COMPLETE', transition: 'complete' };
    case SERVICE_ORDER_STATUSES.Paused:
      return { step: 'RESUME', transition: 'resume' };
    case SERVICE_ORDER_STATUSES.Completed:
      return { step: 'MEASURE', transition: null };
    default:
      return { step: 'CLOSED', transition: null };
  }
}

/**
 * Bloqueios reais e derivaveis: execucao sem recurso alocado e sem medicao apos conclusao.
 * Nao existe tolerancia, score ou regra nova — apenas fatos ja persistidos.
 */
export function controlCenterBlockers(input: {
  status: ServiceOrderStatus;
  facts: ServiceOrderControlCenterFacts;
}): string[] {
  const blockers: string[] = [];
  if (
    (input.status === SERVICE_ORDER_STATUSES.Released ||
      input.status === SERVICE_ORDER_STATUSES.InExecution) &&
    input.facts.active_allocation_count === 0
  ) {
    blockers.push('NO_ACTIVE_ALLOCATION');
  }
  if (input.facts.execution_occurrence_count > 0) {
    blockers.push('EXECUTION_OCCURRENCES_REGISTERED');
  }
  return blockers;
}

export function buildControlCenterProgression(input: {
  status: ServiceOrderStatus;
  createdAt: string;
  preparedAt: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  reopenedAt: string | null;
  serviceRequestId: string | null;
  facts: ServiceOrderControlCenterFacts;
}): ControlCenterStep[] {
  const current = stepFor(input.status);
  const order: ControlCenterStepCode[] = [
    'DEMAND',
    'PLANNING',
    'RELEASE',
    'EXECUTION',
    'COMPLETION',
    'MEASUREMENT',
    'BILLING',
  ];
  const currentIndex = order.indexOf(current);

  const known: Record<ControlCenterStepCode, { at: string | null; detail: string | null }> = {
    DEMAND: {
      at: input.createdAt,
      detail: input.serviceRequestId ? 'Ordem gerada a partir de solicitação' : 'Ordem criada diretamente',
    },
    PLANNING: {
      at: input.preparedAt,
      detail:
        input.facts.planned_resource_count === 0
          ? 'Nenhum recurso planejado'
          : `${input.facts.planned_resource_count} recurso(s) planejado(s)`,
    },
    RELEASE: {
      at: input.releasedAt,
      detail: input.reopenedAt ? 'Reaberta após liberação' : null,
    },
    EXECUTION: {
      at: input.startedAt,
      detail:
        input.status === SERVICE_ORDER_STATUSES.Paused
          ? `Pausada em ${input.pausedAt ?? '—'}`
          : input.facts.execution_entry_count === 0
            ? 'Nenhum apontamento registrado'
            : `${input.facts.execution_entry_count} apontamento(s)`,
    },
    COMPLETION: { at: input.completedAt, detail: null },
    MEASUREMENT: {
      at: input.facts.measurement_created_at,
      detail: null,
    },
    BILLING: {
      at: input.facts.billing_created_at,
      detail: null,
    },
  };

  return order.map((code, index) => {
    const entry = known[code];
    let state: ControlCenterStepState;
    if (code === 'MEASUREMENT') {
      state = input.facts.measurement_status
        ? input.facts.measurement_status === 'APPROVED'
          ? 'DONE'
          : 'CURRENT'
        : index < currentIndex
          ? 'PENDING'
          : 'PENDING';
      if (code === 'MEASUREMENT' && input.status === SERVICE_ORDER_STATUSES.Completed && !input.facts.measurement_status) {
        state = 'ATTENTION';
      }
    } else if (code === 'BILLING') {
      state = input.facts.billing_status
        ? input.facts.billing_status === 'PREPARED'
          ? 'DONE'
          : 'ATTENTION'
        : 'PENDING';
    } else if (entry.at) {
      state = 'DONE';
    } else {
      state = index === currentIndex ? 'CURRENT' : 'PENDING';
    }

    return {
      code,
      state,
      at: entry.at,
      detail: entry.detail,
      ownerStatus:
        code === 'MEASUREMENT'
          ? input.facts.measurement_status
          : code === 'BILLING'
            ? input.facts.billing_status
            : input.status,
    };
  });
}

export function buildControlCenter(input: {
  status: ServiceOrderStatus;
  createdAt: string;
  preparedAt: string | null;
  releasedAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;
  reopenedAt: string | null;
  serviceRequestId: string | null;
  facts: ServiceOrderControlCenterFacts;
  availableTransitions: ServiceOrderTransition[];
}): ControlCenterControl {
  const progression = buildControlCenterProgression(input);
  const next = nextServiceOrderStep(input.status);

  const divergences: string[] = [];
  if (input.facts.planned_resource_count > 0 && input.facts.active_allocation_count === 0) {
    divergences.push('PLANNED_WITHOUT_ACTIVE_ALLOCATION');
  }

  if (input.facts.planned_resource_count === 0 && input.facts.execution_entry_count > 0) {
    divergences.push('EXECUTED_WITHOUT_PLAN');
  }
  if (input.facts.execution_occurrence_count > 0) {
    divergences.push('EXECUTION_OCCURRENCES_REGISTERED');
  }

  return {
    progression,
    plannedVsActual: {
      plannedResources: input.facts.planned_resource_count,
      activeAllocations: input.facts.active_allocation_count,
      executionEntries: input.facts.execution_entry_count,
      executedQuantityTotal: input.facts.executed_quantity_total,
      divergences,
    },
    downstream: {
      measurement: {
        count: input.facts.measurement_count,
        status: input.facts.measurement_status,
        createdAt: input.facts.measurement_created_at,
      },
      billing: {
        count: input.facts.billing_count,
        status: input.facts.billing_status,
        createdAt: input.facts.billing_created_at,
        totalAmount: input.facts.billing_total_amount,
        currencyCode: input.facts.billing_currency_code,
      },
    },
    nextAction: {
      step: next.step,
      transition:
        next.transition && input.availableTransitions.includes(next.transition)
          ? next.transition
          : null,
      availableTransitions: input.availableTransitions,
      blockers: controlCenterBlockers({ status: input.status, facts: input.facts }),
    },
  };
}