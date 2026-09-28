import { PROPOSAL_VERSION_STATUSES } from '../types/proposal.types';

/**
 * Apresentacao da lista de propostas.
 *
 * A proxima acao e derivada do STATUS REAL da versao corrente, vindo do backend, e espelha as
 * transicoes que a maquina de estados do dominio ja permite (`TRANSITIONS` em
 * `commercial/domain/proposal.ts`). Nao infere estado por `currentVersionNumber` nem cria
 * transicao nova.
 */
const NEXT_ACTION_BY_STATUS: Record<string, string> = {
  [PROPOSAL_VERSION_STATUSES.Draft]: 'Emitir proposta',
  [PROPOSAL_VERSION_STATUSES.Issued]: 'Registrar aceite',
  [PROPOSAL_VERSION_STATUSES.Accepted]: 'Abrir proposta',
  [PROPOSAL_VERSION_STATUSES.Rejected]: 'Abrir proposta',
  [PROPOSAL_VERSION_STATUSES.Expired]: 'Abrir proposta',
  [PROPOSAL_VERSION_STATUSES.Cancelled]: 'Abrir proposta',
};

/** Sem versao corrente nao ha estado: e ausencia, declarada como tal. */
export const PROPOSAL_NO_VERSION_LABEL = 'Sem versão';

export function proposalNextAction(currentVersionStatus: string | null): string {
  if (!currentVersionStatus) {
    return 'Criar versão';
  }
  return NEXT_ACTION_BY_STATUS[currentVersionStatus] ?? 'Abrir proposta';
}

/**
 * Validade da versao corrente.
 *
 * `null` quando a versao nao define validade — nunca uma data suposta.
 */
export function formatProposalValidity(validUntil: string | null): string {
  if (!validUntil) {
    return '—';
  }
  const parsed = new Date(validUntil);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(parsed);
}
