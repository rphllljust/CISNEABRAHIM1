import { PROPOSAL_ITEM_KINDS } from '../types/proposal.types';
import { formatMoney } from './proposal-labels';

const ITEM_KIND_LABELS: Record<string, string> = {
  [PROPOSAL_ITEM_KINDS.Service]: 'Serviço',
  [PROPOSAL_ITEM_KINDS.Material]: 'Material',
  [PROPOSAL_ITEM_KINDS.Labor]: 'Mão de obra',
  [PROPOSAL_ITEM_KINDS.Equipment]: 'Equipamento',
  [PROPOSAL_ITEM_KINDS.Transport]: 'Transporte',
  [PROPOSAL_ITEM_KINDS.Other]: 'Outro',
};

export function formatProposalItemKind(kind: string | null): string {
  if (!kind) {
    return 'Outro';
  }
  return ITEM_KIND_LABELS[kind] ?? kind;
}

export function formatProposalAmount(
  amount: string | null,
  currencyCode: string | null,
): string {
  return formatMoney(amount, currencyCode ?? 'BRL');
}
