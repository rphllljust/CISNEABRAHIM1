import {
  SERVICE_ORDER_STATUSES,
  type ServiceOrderStatus,
} from './service-order';

export type ServiceOrderTransition =
  | 'prepare'
  | 'release'
  | 'cancel'
  | 'start'
  | 'pause'
  | 'resume'
  | 'complete';

export class ServiceOrderStateError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/**
 * Mapa canônico dos comandos da OS.
 *
 * B4: exportado APENAS para leitura (catálogo de comandos / metadados de UI).
 * Nenhum valor, assinatura ou regra foi alterado — a adição é a palavra `export`.
 * A state machine continua sendo a única fonte de verdade das transições:
 * consumidores devem LER este mapa, nunca reimplementá-lo.
 */
export const TRANSITIONS: Record<
  ServiceOrderTransition,
  { from: ServiceOrderStatus[]; to: ServiceOrderStatus }
> = {
  prepare: {
    from: [SERVICE_ORDER_STATUSES.Draft],
    to: SERVICE_ORDER_STATUSES.Prepared,
  },
  release: {
    from: [SERVICE_ORDER_STATUSES.Prepared],
    to: SERVICE_ORDER_STATUSES.Released,
  },
  cancel: {
    from: [
      SERVICE_ORDER_STATUSES.Draft,
      SERVICE_ORDER_STATUSES.Prepared,
      SERVICE_ORDER_STATUSES.Released,
    ],
    to: SERVICE_ORDER_STATUSES.Cancelled,
  },
  start: {
    from: [SERVICE_ORDER_STATUSES.Released],
    to: SERVICE_ORDER_STATUSES.InExecution,
  },
  pause: {
    from: [SERVICE_ORDER_STATUSES.InExecution],
    to: SERVICE_ORDER_STATUSES.Paused,
  },
  resume: {
    from: [SERVICE_ORDER_STATUSES.Paused],
    to: SERVICE_ORDER_STATUSES.InExecution,
  },
  complete: {
    from: [SERVICE_ORDER_STATUSES.InExecution],
    to: SERVICE_ORDER_STATUSES.Completed,
  },
};

export function assertTransition(
  currentStatus: ServiceOrderStatus,
  transition: ServiceOrderTransition,
): ServiceOrderStatus {
  const rule = TRANSITIONS[transition];
  if (!rule.from.includes(currentStatus)) {
    throw new ServiceOrderStateError('INVALID_STATE_TRANSITION');
  }
  return rule.to;
}

export function canTransition(
  currentStatus: ServiceOrderStatus,
  transition: ServiceOrderTransition,
): boolean {
  return TRANSITIONS[transition].from.includes(currentStatus);
}

export const TERMINAL_SERVICE_ORDER_STATUSES = new Set<ServiceOrderStatus>([
  SERVICE_ORDER_STATUSES.Completed,
  SERVICE_ORDER_STATUSES.Cancelled,
]);

export function isTerminalServiceOrderStatus(status: ServiceOrderStatus): boolean {
  return TERMINAL_SERVICE_ORDER_STATUSES.has(status);
}

export function assertReopenJustification(reason: string | undefined | null): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : '';
  if (trimmed.length === 0) {
    throw new ServiceOrderStateError('REOPEN_JUSTIFICATION_REQUIRED');
  }
  return trimmed;
}

export function resolveReopenStatus(input: {
  currentStatus: ServiceOrderStatus;
  statusBeforeCancel: ServiceOrderStatus | null;
}): ServiceOrderStatus {
  if (input.currentStatus === SERVICE_ORDER_STATUSES.Cancelled) {
    if (
      !input.statusBeforeCancel ||
      input.statusBeforeCancel === SERVICE_ORDER_STATUSES.Cancelled
    ) {
      throw new ServiceOrderStateError('INVALID_STATE_TRANSITION');
    }
    return input.statusBeforeCancel;
  }
  if (input.currentStatus === SERVICE_ORDER_STATUSES.Completed) {
    return SERVICE_ORDER_STATUSES.InExecution;
  }
  throw new ServiceOrderStateError('INVALID_STATE_TRANSITION');
}
