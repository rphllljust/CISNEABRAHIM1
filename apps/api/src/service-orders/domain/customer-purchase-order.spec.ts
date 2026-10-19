import { describe, expect, it } from 'vitest';
import { validateUpdateServiceOrderInput } from './service-order.validation';

/**
 * CUSTOMER PURCHASE ORDER — campo próprio, separado do Purchase Order interno.
 *
 * DEFEITO QUE ESTE TESTE TRAVA (levantado em 2026-10-19):
 *
 * O CISNE modela o Purchase Order INTERNO (`purchase_order_id` + `purchase_order_snapshot`): a
 * compra que a CISNE faz de um fornecedor. O documento oposto — o pedido que o CLIENTE emite
 * contra a CISNE, onde a CISNE é fornecedora (ex.: pedido 41926266 da AMAGGI) — não tinha lugar
 * tipado. Sem ele, o número só caberia em `contract_reference` ou em notas, ambos com semântica
 * própria, e o número deixaria de participar do processo.
 *
 * Este teste garante que o campo é aceito e normalizado como referência EXTERNA, e que NÃO é
 * confundido com o PO interno: os dois coexistem como campos distintos na mesma OS.
 */
describe('customerPurchaseOrderNumber — referência do pedido do CLIENTE', () => {
  const base = {
    rowVersion: 1,
    description: 'Locação de caminhão-pipa',
  };

  it('aceita o número do pedido do cliente ao lado do RC, sem confundir os dois', () => {
    const result = validateUpdateServiceOrderInput({
      ...base,
      customerPurchaseOrderNumber: '41926266',
      rcNumber: '991487',
    });

    expect(result.customerPurchaseOrderNumber).toBe('41926266');
    expect(result.rcNumber).toBe('991487');
    // Referências distintas: o PO é do cliente, o RC é da requisição de compra.
    expect(result.customerPurchaseOrderNumber).not.toBe(result.rcNumber);
  });

  it('normaliza espaços em volta sem alterar o número', () => {
    const result = validateUpdateServiceOrderInput({
      ...base,
      customerPurchaseOrderNumber: '  41926266  ',
    });

    expect(result.customerPurchaseOrderNumber).toBe('41926266');
  });

  it('aceita null explícito para limpar a referência', () => {
    const result = validateUpdateServiceOrderInput({
      ...base,
      customerPurchaseOrderNumber: null,
    });

    expect(result.customerPurchaseOrderNumber).toBeNull();
  });

  it('deixa o campo ausente quando não informado — a OS sem pedido do cliente continua válida', () => {
    const result = validateUpdateServiceOrderInput({ ...base });

    expect(result.customerPurchaseOrderNumber).toBeUndefined();
  });
});
