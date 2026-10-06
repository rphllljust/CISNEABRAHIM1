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

/**
 * Idade relativa do registro — o que o operador lê primeiro numa worklist.
 *
 * Deriva SOMENTE do timestamp que o contrato já publica (`updatedAt`). Não é um prazo, não é
 * SLA e não é aging de negócio: é há quanto tempo o cadastro foi tocado pela última vez, dito
 * de forma escaneável. A data absoluta continua disponível para quem precisa do instante exato.
 */
export function formatClientListRelative(value: string, now: Date = new Date()): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return '—';
  }
  const diff = now.getTime() - parsed.getTime();
  if (diff < 60_000) {
    return 'agora há pouco';
  }
  if (diff < 3_600_000) {
    return `há ${Math.floor(diff / 60_000)} min`;
  }
  if (diff < 86_400_000) {
    return `há ${Math.floor(diff / 3_600_000)} h`;
  }
  const days = Math.floor(diff / 86_400_000);
  return days === 1 ? 'há 1 dia' : `há ${days} dias`;
}

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
