import type { BillingWorkQueueItem } from '../types/billing.types';
import type { DynamicKanbanCardBadge, MetaField } from '../../engine';

/**
 * Linha de faturamento no formato que a engine consome.
 *
 * A engine indexa por NOME DE CAMPO do metadata store (`service_order_id`, `client_id`,
 * `total_amount`, …). Este adaptador é o único lugar onde a nomenclatura do DTO encontra a do
 * metadado — mesmo padrão de fornecedores e ordens de serviço.
 *
 * Os campos prefixados com `__` NÃO são colunas do metadado: são sinais que só as colunas
 * derivadas e os badges usam (balde do processo e id da OS de origem). O prefixo existe para
 * que não colidam com um campo real do metadata store.
 *
 * CAMPOS AUSENTES SÃO `null`, NÃO INVENTADOS: `BillingWorkQueueItem` não carrega `status`,
 * `currency_code`, `prepared_at` nem `measurement_id` no payload da fila. O cartão mostra
 * apenas o que a fila realmente trouxe.
 */
export type BillingEngineRow = Record<string, unknown> & { id: string };

export function billingEngineRows(items: BillingWorkQueueItem[]): BillingEngineRow[] {
  return items.map((item) => ({
    id: item.serviceOrderId,
    service_order_id: item.orderNumber,
    client_id: item.clientLabel,
    status: null,
    total_amount: item.totalAmount,
    currency_code: null,
    prepared_at: null,
    measurement_id: item.measurementId,
    __bucket: item.bucket,
    __serviceOrderId: item.serviceOrderId,
    __billingId: item.billingId,
    __hasDivergence: item.termsDivergence !== null,
  }));
}

/**
 * Badges de cross-reference do cartão.
 *
 * Só publica o que a fila JÁ carregou: divergência comercial, valor e existência de medição.
 * Não há chamada de rede por cartão — a engine não faz N+1, e a tela não inventa contagem.
 */
export function billingCardBadges(row: BillingEngineRow): DynamicKanbanCardBadge[] {
  const badges: DynamicKanbanCardBadge[] = [];
  if (row['__hasDivergence'] === true) {
    badges.push({ label: 'Divergência', value: 'comercial', tone: 'critical' });
  }
  if (row['measurement_id'] !== null && row['measurement_id'] !== undefined) {
    badges.push({ label: 'Medição', value: 'vinculada', tone: 'info' });
  }
  const amount = row['total_amount'];
  if (typeof amount === 'string' && amount.trim() !== '') {
    badges.push({ label: 'Valor', value: formatAmount(amount), tone: 'neutral' });
  }
  return badges;
}

function formatAmount(amount: string): string {
  const parsed = Number(amount.replace(',', '.'));
  return Number.isFinite(parsed)
    ? parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : amount;
}

/**
 * Campos do cartão, declarados pela TELA.
 *
 * Existe porque este quadro renderiza mesmo antes de o metadata store responder: as colunas
 * vêm da fila (derivadas), então o cartão não pode depender de `layout.cardFields`.
 *
 * `service_order_id` NÃO entra: o identificador já é o LINK do cabeçalho (`renderCardHeader`),
 * e repeti-lo aqui mostraria o mesmo número duas vezes no cartão. `client_id` sai do
 * cabeçalho do cartão artesanal que esta tela substituiu, que exibia cliente e valor abaixo
 * do número.
 */
export const BILLING_QUEUE_CARD_FIELDS: MetaField[] = [
  field('client_id', 'Cliente', 'text'),
  field('total_amount', 'Valor total', 'currency'),
];

function field(name: string, label: string, type: MetaField['type']): MetaField {
  return {
    name,
    label,
    type,
    required: false,
    readOnly: true,
    permLevel: 0,
    options: null,
    fieldOrder: 0,
    inForm: false,
    inList: true,
    listOrder: 0,
    inFilter: false,
    inSearch: false,
  };
}
