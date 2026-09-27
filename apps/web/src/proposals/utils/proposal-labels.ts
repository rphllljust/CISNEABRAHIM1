import {
  PROPOSAL_ACCEPTANCE_ORIGINS,
  PROPOSAL_PRICING_STRUCTURES,
  PROPOSAL_VERSION_STATUSES,
  type ProposalAcceptanceOrigin,
  type ProposalPricingStructure,
  type ProposalVersionStatus,
} from '../types/proposal.types';

const STATUS_LABELS: Record<ProposalVersionStatus, string> = {
  [PROPOSAL_VERSION_STATUSES.Draft]: 'Rascunho',
  [PROPOSAL_VERSION_STATUSES.Issued]: 'Emitida',
  [PROPOSAL_VERSION_STATUSES.Accepted]: 'Aceita',
  [PROPOSAL_VERSION_STATUSES.Rejected]: 'Rejeitada',
  [PROPOSAL_VERSION_STATUSES.Expired]: 'Expirada',
  [PROPOSAL_VERSION_STATUSES.Cancelled]: 'Cancelada',
};

const PRICING_LABELS: Record<ProposalPricingStructure, string> = {
  [PROPOSAL_PRICING_STRUCTURES.GlobalPrice]: 'Preço global',
  [PROPOSAL_PRICING_STRUCTURES.Itemized]: 'Itens detalhados',
};

const ACCEPTANCE_LABELS: Record<ProposalAcceptanceOrigin, string> = {
  [PROPOSAL_ACCEPTANCE_ORIGINS.ClientWrittenConfirmation]: 'Confirmação escrita do cliente',
  [PROPOSAL_ACCEPTANCE_ORIGINS.ClientPortal]: 'Portal do cliente',
  [PROPOSAL_ACCEPTANCE_ORIGINS.InternalApproval]: 'Aprovação interna',
};

export function formatProposalStatus(status: string): string {
  return STATUS_LABELS[status as ProposalVersionStatus] ?? status;
}

export function formatProposalPricingStructure(structure: string): string {
  return PRICING_LABELS[structure as ProposalPricingStructure] ?? structure;
}

export function formatAcceptanceOrigin(origin: string): string {
  return ACCEPTANCE_LABELS[origin as ProposalAcceptanceOrigin] ?? origin;
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return value;
  }
}

export function formatMoney(amount: string | null | undefined, currencyCode = 'BRL'): string {
  if (!amount) {
    return '—';
  }
  const numeric = Number.parseFloat(amount);
  if (Number.isNaN(numeric)) {
    return amount;
  }
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(numeric);
}

export function formatClientSnapshot(snapshot: Record<string, unknown> | null): string {
  if (!snapshot) {
    return '—';
  }
  const tradeName = snapshot['tradeName'];
  const legalName = snapshot['legalName'];
  if (typeof tradeName === 'string' && tradeName) {
    return tradeName;
  }
  if (typeof legalName === 'string' && legalName) {
    return legalName;
  }
  return '—';
}

/**
 * Identificacao do ator.
 *
 * O dominio NAO guarda nome de pessoa (`identity.identities` so tem id/status). A interface usa o
 * mesmo rotulo neutro ja adotado no modulo de solicitacoes: "Voce" quando o ator e o usuario
 * atual e "Usuario interno" caso contrario — nunca um nome inventado.
 *
 * O id tecnico do ator NAO entra no rotulo: identificador de identidade e dado de banco, e a
 * interface representa o negocio (contrato de interacao enterprise — nenhum uuid visivel).
 */
export function formatRegisteredBy(
  actorIdentityId: string,
  currentIdentityId: string | null | undefined,
): string {
  if (currentIdentityId && actorIdentityId === currentIdentityId) {
    return 'Você (usuário interno)';
  }
  return 'Usuário interno';
}
