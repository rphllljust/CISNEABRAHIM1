import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderBalance,
  type PurchaseOrderStatus,
} from '../types/purchase-order.types';

/**
 * Leitura de produto da maquina de estados do pedido de compra.
 *
 * Nao cria estado nem transicao: nomeia o passo que o backend JA permite a partir do
 * status atual. As transicoes espelham o que `PurchaseOrderDetailPage` ja executa
 * (`registerPurchaseOrder` / `cancelPurchaseOrder`); nada e recalculado no frontend.
 */
const NEXT_ACTION_BY_STATUS: Record<PurchaseOrderStatus, string> = {
  [PURCHASE_ORDER_STATUSES.Draft]: 'Revisar e registrar',
  [PURCHASE_ORDER_STATUSES.Registered]: 'Acompanhar consumo',
  [PURCHASE_ORDER_STATUSES.Cancelled]: 'Consultar histórico',
};

export function purchaseOrderNextAction(status: PurchaseOrderStatus): string {
  return NEXT_ACTION_BY_STATUS[status] ?? 'Abrir pedido';
}

/**
 * Excecao operacional derivada apenas de campos que o backend JA entrega na listagem
 * (`status`, `registeredAt`, `cancelledAt`). Quando o dado nao existe, devolve `null`
 * e a celula nao renderiza excecao — a UI nunca inventa pendencia.
 */
export function purchaseOrderNotice(order: {
  status: PurchaseOrderStatus;
  registeredAt: string | null;
  cancelledAt: string | null;
}): string | null {
  if (order.status === PURCHASE_ORDER_STATUSES.Cancelled) {
    return order.cancelledAt ? 'Cancelado' : 'Cancelado sem data registrada';
  }
  if (order.status === PURCHASE_ORDER_STATUSES.Draft && !order.registeredAt) {
    return 'Ainda não registrado';
  }
  return null;
}

/**
 * ACOES POR LINHA — derivadas do ESTADO REAL e da capability efetiva.
 *
 * A lista levava ao objeto e parava ali: para registrar ou cancelar um pedido o operador tinha
 * de abrir a linha, achar a acao no detalhe e voltar. As transicoes existem no dominio e o
 * detalhe ja as executa (`registerPurchaseOrder` / `cancelPurchaseOrder`); aqui elas ficam
 * acessiveis de onde o trabalho realmente comeca.
 *
 * NENHUMA transicao nova e criada — a tabela abaixo espelha exatamente o que o detalhe permite
 * hoje. Uma acao so aparece quando as DUAS condicoes valem:
 *
 *   - o ESTADO admite a transicao (rascunho registra; pedido vivo cancela; cancelado nao transiciona);
 *   - a CAPABILITY do ator autoriza o verbo (`canRegister` / `canCancel`).
 *
 * Pedido cancelado continua navegavel: consultar historico e leitura que o ator ja provou ao
 * listar com sucesso.
 */
/**
 * LEITURA DO CONSUMO AUTORIZADO — apresentacao pura sobre o ledger que o dominio JA apurou.
 *
 * A lista publicava tres valores com o MESMO peso visual (`authorizedAmount`, `consumedAmount`,
 * `availableBalance`). O operador tinha de fazer a conta de cabeca para saber se o pedido estava
 * no inicio, no meio ou no fim do valor autorizado. Aqui a relacao `consumido / autorizado` vira
 * um percentual — e SO isso: nenhuma regra de negocio, nenhum status novo, nenhuma persistencia.
 *
 * `balance === null` significa que a regra de dominio RECUSOU apurar (valor autorizado
 * indisponivel, ou consumo acima do autorizado). Nesse caso nao existe percentual honesto a
 * exibir e a funcao devolve `null`; a interface declara a indisponibilidade em vez de inventar
 * numero. O mesmo vale para autorizado zero ou nao numerico: divisao indefinida nao vira "0%".
 */
export type PurchaseOrderUsage = {
  /** Consumo sobre o autorizado, em pontos percentuais (0 = nada consumido, 100 = esgotado). */
  percent: number;
  /** Verdadeiro quando o consumo passou do autorizado — fato do ledger, nao juizo de risco. */
  overAuthorized: boolean;
};

export function purchaseOrderUsage(
  balance: Pick<PurchaseOrderBalance, 'authorizedAmount' | 'consumedAmount'> | null,
): PurchaseOrderUsage | null {
  if (!balance) {
    return null;
  }
  const authorized = Number.parseFloat(balance.authorizedAmount);
  const consumed = Number.parseFloat(balance.consumedAmount);
  if (Number.isNaN(authorized) || Number.isNaN(consumed)) {
    return null;
  }
  if (authorized <= 0) {
    return null;
  }
  return {
    percent: Math.max(0, (consumed / authorized) * 100),
    overAuthorized: consumed > authorized,
  };
}

/**
 * VALOR DO PEDIDO — o autorizado quando a regra de dominio o publica.
 *
 * Em pedidos com precificacao por itens (`LINE_ITEMS`) o `totalAmount` do cabecalho e
 * legitimamente nulo: o valor do pedido e a soma das linhas, que ja chega pronta em
 * `balance.authorizedAmount`. Exibir o campo cru deixaria a coluna vazia ao lado de um saldo
 * preenchido.
 */
export function purchaseOrderAuthorizedAmount(order: {
  totalAmount: string | null;
  balance: Pick<PurchaseOrderBalance, 'authorizedAmount'> | null;
}): string | null {
  return order.balance ? order.balance.authorizedAmount : order.totalAmount;
}

export type PurchaseOrderRowAction = {
  /** Identificador estavel para teste e para o `key` da lista. */
  id: 'open' | 'register' | 'cancel';
  label: string;
  kind: 'primary' | 'secondary';
};

export function purchaseOrderRowActions(
  order: { status: PurchaseOrderStatus },
  capabilities: { canRead: boolean; canRegister: boolean; canCancel: boolean },
): PurchaseOrderRowAction[] {
  const actions: PurchaseOrderRowAction[] = [];

  // Registrar: rascunho + concessao de registro.
  if (order.status === PURCHASE_ORDER_STATUSES.Draft && capabilities.canRegister) {
    actions.push({ id: 'register', label: 'Registrar', kind: 'primary' });
  }

  // Cancelar: pedido vivo (nao cancelado) + concessao de cancelamento.
  if (order.status !== PURCHASE_ORDER_STATUSES.Cancelled && capabilities.canCancel) {
    actions.push({ id: 'cancel', label: 'Cancelar', kind: 'secondary' });
  }

  // Abrir: sempre que houver leitura — que a listagem bem-sucedida ja provou.
  if (capabilities.canRead) {
    actions.push({ id: 'open', label: 'Abrir pedido', kind: 'secondary' });
  }

  return actions;
}
