import {
  PROPOSAL_VERSION_STATUSES,
  canCreateRevision,
  canTransition,
  type ProposalVersionStatus,
} from './proposal';

/**
 * Leitura de "onde esta" e "o que vem agora" derivada SOMENTE do que o backend ja aplica.
 *
 * `allowedTransitionsFrom` consulta a mesma tabela `TRANSITIONS` usada por `assertTransition` e a
 * mesma regra de revisao (`canCreateRevision`). `readinessBlockers` repete as pre-condicoes que
 * `assertIssueReady` impoe a emissao. Nenhum estado, transicao ou prazo novo e criado aqui.
 */

export type ProposalTransition = 'issue' | 'accept' | 'reject' | 'expire' | 'cancel' | 'revise';

export const PROPOSAL_TRANSITION_ORDER: ProposalTransition[] = [
  'issue',
  'accept',
  'reject',
  'expire',
  'cancel',
  'revise',
];

const TRANSITION_TARGET: Record<ProposalTransition, ProposalVersionStatus> = {
  issue: PROPOSAL_VERSION_STATUSES.Issued,
  accept: PROPOSAL_VERSION_STATUSES.Accepted,
  reject: PROPOSAL_VERSION_STATUSES.Rejected,
  expire: PROPOSAL_VERSION_STATUSES.Expired,
  cancel: PROPOSAL_VERSION_STATUSES.Cancelled,
  revise: PROPOSAL_VERSION_STATUSES.Draft,
};

const MAJOR_TRANSITIONS: ProposalVersionStatus[] = [
  PROPOSAL_VERSION_STATUSES.Issued,
  PROPOSAL_VERSION_STATUSES.Accepted,
  PROPOSAL_VERSION_STATUSES.Rejected,
  PROPOSAL_VERSION_STATUSES.Expired,
  PROPOSAL_VERSION_STATUSES.Cancelled,
];

/** Usa a MESMA tabela de transicoes do dominio; `revise` usa a mesma regra de `canCreateRevision`. */
export function isTransitionAllowed(
  status: ProposalVersionStatus,
  transition: ProposalTransition,
): boolean {
  if (transition === 'revise') {
    return canCreateRevision(status);
  }
  return canTransition(status, TRANSITION_TARGET[transition]);
}

export function allowedTransitionsFrom(status: ProposalVersionStatus): ProposalTransition[] {
  return PROPOSAL_TRANSITION_ORDER.filter((transition) => isTransitionAllowed(status, transition));
}

export const PROPOSAL_NEXT_STEP_CODES = {
  CompleteAndIssue: 'COMPLETE_AND_ISSUE',
  AwaitDecision: 'AWAIT_CLIENT_DECISION',
  FollowCommercialFlow: 'FOLLOW_COMMERCIAL_FLOW',
  CreateNewRevision: 'CREATE_NEW_REVISION',
  Closed: 'CLOSED',
} as const;

export type ProposalNextStepCode =
  (typeof PROPOSAL_NEXT_STEP_CODES)[keyof typeof PROPOSAL_NEXT_STEP_CODES];

export type ProposalNextStep = {
  step: ProposalNextStepCode;
  transition: ProposalTransition | null;
};

/**
 * Proximo passo comercial por estado. `transition` e a acao REAL que avanca a proposta (ou `null`
 * quando o passo e observar/registrar algo que o modulo nao executa sozinho, como a decisao do
 * cliente ou o registro do pedido de compra no modulo COMPRAS).
 */
export function nextStepForStatus(status: ProposalVersionStatus): ProposalNextStep {
  switch (status) {
    case PROPOSAL_VERSION_STATUSES.Draft:
      return { step: PROPOSAL_NEXT_STEP_CODES.CompleteAndIssue, transition: 'issue' };
    case PROPOSAL_VERSION_STATUSES.Issued:
      return { step: PROPOSAL_NEXT_STEP_CODES.AwaitDecision, transition: 'accept' };
    case PROPOSAL_VERSION_STATUSES.Accepted:
      return { step: PROPOSAL_NEXT_STEP_CODES.FollowCommercialFlow, transition: null };
    default:
      return { step: PROPOSAL_NEXT_STEP_CODES.CreateNewRevision, transition: 'revise' };
  }
}

/**
 * Bloqueios reais de emissao, espelhando `ProposalsReferenceValidationService.assertIssueReady`:
 * preco global ausente ou estrutura por itens sem linha/valor.
 */
export function readinessBlockers(input: {
  status: ProposalVersionStatus;
  pricingStructure: string;
  globalSalePriceAmount: string | null;
  itemCount: number;
  itemsMissingLineAmount: number;
}): string[] {
  if (input.status !== PROPOSAL_VERSION_STATUSES.Draft) {
    return [];
  }
  if (input.pricingStructure === 'GLOBAL_PRICE') {
    return input.globalSalePriceAmount ? [] : ['GLOBAL_SALE_PRICE_REQUIRED'];
  }
  if (input.itemCount === 0) {
    return ['ITEMIZED_ITEMS_REQUIRED'];
  }
  if (input.itemsMissingLineAmount > 0) {
    return ['ITEM_LINE_AMOUNT_REQUIRED'];
  }
  return [];
}

export { MAJOR_TRANSITIONS };
