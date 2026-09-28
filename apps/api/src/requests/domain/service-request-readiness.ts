import {
  SERVICE_REQUEST_STATUSES,
  type ServiceRequestStatus,
  type ServiceRequestTransition,
} from './service-request';
import { canTransition } from './service-request.state-machine';

/**
 * Leitura de "onde esta" e "o que vem agora" derivada SOMENTE das regras que o backend ja aplica.
 *
 * Nada aqui cria transicao, estado ou prazo: `allowedTransitionsFrom` apenas consulta a mesma
 * tabela da maquina de estados usada por `assertTransition`, e `readinessBlockers` apenas repete a
 * pre-condicao que `validateSubmitReady` ja impoe ao envio.
 */

/** Ordem de leitura das transicoes quando mais de uma e possivel no mesmo estado. */
export const SERVICE_REQUEST_TRANSITION_ORDER: ServiceRequestTransition[] = [
  'submit',
  'startReview',
  'approve',
  'reject',
  'cancel',
  'convert',
];

export function allowedTransitionsFrom(status: ServiceRequestStatus): ServiceRequestTransition[] {
  return SERVICE_REQUEST_TRANSITION_ORDER.filter((transition) => canTransition(status, transition));
}

export const SERVICE_REQUEST_NEXT_STEP_CODES = {
  SubmitRequest: 'SUBMIT_REQUEST',
  StartReview: 'START_REVIEW',
  Decide: 'DECIDE',
  ConvertToServiceOrder: 'CONVERT_TO_SERVICE_ORDER',
  OpenServiceOrder: 'OPEN_SERVICE_ORDER',
  Closed: 'CLOSED',
} as const;

export type ServiceRequestNextStepCode =
  (typeof SERVICE_REQUEST_NEXT_STEP_CODES)[keyof typeof SERVICE_REQUEST_NEXT_STEP_CODES];

export type ServiceRequestNextStep = {
  step: ServiceRequestNextStepCode;
  transition: ServiceRequestTransition | null;
};

/**
 * Proximo passo por estado. `transition` e a acao da maquina de estados que avanca a solicitacao;
 * quando e `null` o passo e uma leitura (abrir a OS ja gerada) ou o encerramento do ciclo.
 */
export function nextStepForStatus(status: ServiceRequestStatus): ServiceRequestNextStep {
  switch (status) {
    case SERVICE_REQUEST_STATUSES.Draft:
      return { step: SERVICE_REQUEST_NEXT_STEP_CODES.SubmitRequest, transition: 'submit' };
    case SERVICE_REQUEST_STATUSES.Submitted:
      return { step: SERVICE_REQUEST_NEXT_STEP_CODES.StartReview, transition: 'startReview' };
    case SERVICE_REQUEST_STATUSES.UnderReview:
      return { step: SERVICE_REQUEST_NEXT_STEP_CODES.Decide, transition: 'approve' };
    case SERVICE_REQUEST_STATUSES.Approved:
      return { step: SERVICE_REQUEST_NEXT_STEP_CODES.ConvertToServiceOrder, transition: 'convert' };
    case SERVICE_REQUEST_STATUSES.Converted:
      return {
        step: SERVICE_REQUEST_NEXT_STEP_CODES.OpenServiceOrder,
        transition: null,
      };
    default:
      return { step: SERVICE_REQUEST_NEXT_STEP_CODES.Closed, transition: null };
  }
}

/**
 * Bloqueios reais de avanco. Hoje existe um unico bloqueio imposto pelo backend: rascunho sem
 * descricao e sem servico nao pode ser enviado (`DESCRIPTION_OR_SERVICE_REQUIRED`).
 */
export function readinessBlockers(input: {
  status: ServiceRequestStatus;
  description: string | null;
  serviceDefinitionId: string | null;
}): string[] {
  if (input.status !== SERVICE_REQUEST_STATUSES.Draft) {
    return [];
  }
  if (input.description?.trim() || input.serviceDefinitionId?.trim()) {
    return [];
  }
  return ['DESCRIPTION_OR_SERVICE_REQUIRED'];
}
