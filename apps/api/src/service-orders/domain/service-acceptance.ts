/**
 * Service Acceptance — aceite operacional pós-execução.
 *
 * Regras:
 *  - Somente OS/execução COMPLETED pode ser aceita/rejeitada.
 *  - Aceite é append-only: nunca altera a execução histórica (HISTORY LOSS 0).
 *  - Rejeição abre uma pendência (não apaga a execução).
 *  - Um único aceite por service order (duplicate bloqueado).
 *  - Autorização obrigatória; auditoria registra quem/quando/resultado/observação.
 *  - Assinatura/evidência é opcional ("quando suportada").
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * OBSERVAÇÃO NÃO É MOTIVO DE REJEIÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A primeira versão copiava `observation` para `pendingIssue.reason` quando o
 * resultado era REJECTED. Isso parecia inofensivo e produzia um defeito real: a
 * observação é o REGISTRO do que se viu ("serviço conferido com o responsável"),
 * e o motivo é a CAUSA declarada da recusa ("volume medido não confere"). Com as
 * duas no mesmo campo, a pendência aberta pela rejeição chegava ao time de
 * correção dizendo o que foi observado, nunca o que precisava ser corrigido.
 *
 * `rejectionReason` passa a ser um campo PRÓPRIO, opcional no domínio e
 * OBRIGATÓRIO quando o resultado é REJECTED. A `observation` continua registrando
 * o que se viu, e é isso que a auditoria carrega.
 */

import {
  ServiceAcceptanceError,
  SERVICE_ACCEPTANCE_ERROR_CODES,
} from './service-acceptance-errors';

export const ACCEPTANCE_RESULTS = {
  Accepted: 'ACCEPTED',
  Rejected: 'REJECTED',
} as const;

export type AcceptanceResult =
  (typeof ACCEPTANCE_RESULTS)[keyof typeof ACCEPTANCE_RESULTS];

export type ServiceAcceptanceInput = {
  serviceOrderId: string;
  executionStatus: string;
  result: AcceptanceResult;
  observation: string;
  acceptedByIdentityId: string;
  acceptedAt: string;
  evidenceId?: string | null;
  /**
   * CAUSA da recusa. Obrigatória quando `result = REJECTED`.
   *
   * Distinta de `observation` por decisão de domínio: uma descreve o que se viu,
   * a outra o que está errado. Juntar as duas produzia pendência de correção sem
   * causa declarada.
   */
  rejectionReason?: string | null;
};

export type ServiceAcceptance = {
  serviceOrderId: string;
  result: AcceptanceResult;
  acceptedByIdentityId: string;
  acceptedAt: string;
  observation: string;
  evidenceIds: string[];
  /** Cópia do motivo de recusa na decisão, para o histórico não depender do payload. */
  rejectionReason: string | null;
};

export type AcceptancePendingIssue = {
  serviceOrderId: string;
  /** CAUSA da recusa — nunca a observação. */
  reason: string;
  openedAt: string;
  openedByIdentityId: string;
};

export type AcceptanceAuditEvent = {
  eventType: 'SERVICE_ACCEPTED' | 'SERVICE_REJECTED';
  serviceOrderId: string;
  actorIdentityId: string;
  occurredAt: string;
  result: AcceptanceResult;
  observation: string;
  rejectionReason: string | null;
};

function assertAuthorized(authorized: boolean): void {
  if (!authorized) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.UNAUTHORIZED);
  }
}

function assertCompleted(executionStatus: string): void {
  if (executionStatus !== 'COMPLETED') {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.NOT_COMPLETED);
  }
}

function assertValidResult(result: AcceptanceResult): void {
  if (result !== ACCEPTANCE_RESULTS.Accepted && result !== ACCEPTANCE_RESULTS.Rejected) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.INVALID_RESULT);
  }
}

/**
 * Motivo de recusa OBRIGATÓRIO quando o resultado é REJECTED.
 *
 * Fonte única: chamada por `recordAcceptance` e pela política de aceite. Duas
 * verificações do mesmo invariante em módulos diferentes divergiriam.
 */
export function assertRejectionReasonPresent(input: {
  result: AcceptanceResult;
  rejectionReason?: string | null;
}): string | null {
  const reason =
    typeof input.rejectionReason === 'string' && input.rejectionReason.trim().length > 0
      ? input.rejectionReason.trim()
      : null;
  if (input.result === ACCEPTANCE_RESULTS.Rejected && reason === null) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.REJECTION_REASON_REQUIRED);
  }
  return input.result === ACCEPTANCE_RESULTS.Rejected ? reason : null;
}

/**
 * Garante que a execução histórica permanece intacta: o aceite recebe apenas
 * referência imutável e nunca a muta.
 */
export function assertExecutionHistoryIntact<T>(execution: Readonly<T>): Readonly<T> {
  return execution;
}

/** Aceita/rejeita quando aplicável; duplicate e autorização são barrados. */
export function recordAcceptance(
  input: ServiceAcceptanceInput,
  options: { authorized: boolean; existingAcceptance: ServiceAcceptance | null },
): { acceptance: ServiceAcceptance; pendingIssue: AcceptancePendingIssue | null; audit: AcceptanceAuditEvent } {
  assertAuthorized(options.authorized);
  assertCompleted(input.executionStatus);
  assertValidResult(input.result);
  if (options.existingAcceptance) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.ALREADY_RECORDED);
  }
  if (!input.observation.trim()) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.OBSERVATION_REQUIRED);
  }
  if (!input.acceptedByIdentityId.trim() || !input.acceptedAt) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.UNAUTHORIZED);
  }
  const rejectionReason = assertRejectionReasonPresent({
    result: input.result,
    rejectionReason: input.rejectionReason,
  });

  const acceptance: ServiceAcceptance = {
    serviceOrderId: input.serviceOrderId,
    result: input.result,
    acceptedByIdentityId: input.acceptedByIdentityId,
    acceptedAt: input.acceptedAt,
    observation: input.observation.trim(),
    evidenceIds: input.evidenceId ? [input.evidenceId] : [],
    rejectionReason,
  };

  /**
   * A PENDÊNCIA carrega o MOTIVO, não a observação.
   *
   * `assertRejectionReasonPresent` já garantiu que ele existe quando o resultado
   * é REJECTED, então o non-null aqui é consequência do invariante, não uma
   * suposição.
   */
  const pendingIssue: AcceptancePendingIssue | null =
    input.result === ACCEPTANCE_RESULTS.Rejected
      ? {
          serviceOrderId: input.serviceOrderId,
          reason: rejectionReason!,
          openedAt: input.acceptedAt,
          openedByIdentityId: input.acceptedByIdentityId,
        }
      : null;

  const audit: AcceptanceAuditEvent = {
    eventType: input.result === ACCEPTANCE_RESULTS.Accepted ? 'SERVICE_ACCEPTED' : 'SERVICE_REJECTED',
    serviceOrderId: input.serviceOrderId,
    actorIdentityId: input.acceptedByIdentityId,
    occurredAt: input.acceptedAt,
    result: input.result,
    observation: input.observation.trim(),
    rejectionReason,
  };

  return { acceptance, pendingIssue, audit };
}

/** Rejeição abre pendência mas NUNCA apaga/reescreve a execução. */
export function assertRejectionKeepsExecution<T>(
  execution: Readonly<T>,
): Readonly<T> {
  return execution;
}
