import { PURCHASE_ORDER_REQUIREMENTS, type PurchaseOrderRequirement } from '../types/client.types';

/**
 * Rótulos de apresentação da listagem de Clientes.
 *
 * Ficam no módulo de Clientes, e não importados de outro módulo: a listagem de Clientes não deve
 * depender de utilitários de ordens de serviço para formatar suas próprias colunas.
 */

/** Rótulos curtos, para o seletor de filtro. */
const PURCHASE_ORDER_REQUIREMENT_LABELS: Record<PurchaseOrderRequirement, string> = {
  [PURCHASE_ORDER_REQUIREMENTS.NotRequired]: 'Não exige',
  [PURCHASE_ORDER_REQUIREMENTS.BeforeExecution]: 'Antes da execução',
  [PURCHASE_ORDER_REQUIREMENTS.BeforeBilling]: 'Antes do faturamento',
};

export function formatPurchaseOrderRequirement(
  requirement: PurchaseOrderRequirement,
): string {
  return PURCHASE_ORDER_REQUIREMENT_LABELS[requirement];
}

export function formatClientListDateTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(parsed);
}

const NUMBER_FORMAT = new Intl.NumberFormat('pt-BR');

export function formatClientCount(total: number): string {
  return NUMBER_FORMAT.format(total);
}

/** Faixa visível da página, para o rodapé de paginação (ex.: "21–40 de 137"). */
export function formatClientRangeLabel(offset: number, visible: number, total: number): string {
  if (total === 0) {
    return 'Nenhum Cliente';
  }
  const first = offset + 1;
  const last = offset + visible;
  return `${NUMBER_FORMAT.format(first)}–${NUMBER_FORMAT.format(last)} de ${NUMBER_FORMAT.format(total)}`;
}
