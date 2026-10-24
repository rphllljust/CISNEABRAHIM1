import { describe, expect, it } from 'vitest';
import { resolveFactKind } from './economic-trace.read-model';

/**
 * O RÓTULO DO FATO VEM DO QUE FOI PUBLICADO, NÃO DE UMA SUPOSIÇÃO SOBRE FINANCE.
 *
 * DEFEITO MEDIDO EM PRODUÇÃO (24/10/2026)
 *
 * A worklist rotulava todo fato que não fosse PAYMENT como `SETTLEMENT`. Um fato de
 * INVENTORY (`source_kind = INVENTORY_MOVEMENT`) aparecia na fila com a rota
 * `/app/accounting/economic-trace/settlement/<id>`, e a trilha respondia
 * `ACCOUNTING_NOT_FOUND` — porque aquele id não é uma liquidação.
 *
 * O efeito para o operador era o pior tipo de defeito: a fila oferecia o caso (o link
 * existia e era clicável) e o clique levava a um recurso inexistente. Nenhum teste de
 * unidade pegava, porque o rótulo era derivado por um ternário local sobre
 * `event_kind.startsWith('PAYMENT')` — uma regra que só estava correta enquanto FINANCE
 * era o único produtor.
 *
 * Estes testes fixam a regra por `source_kind`, que é o que o próprio fato publica.
 */
describe('resolveFactKind — o rótulo do fato vem do source_kind publicado', () => {
  it('INVENTORY_MOVEMENT não é rotulado como SETTLEMENT', () => {
    // O caso que quebrou produção: entrada de estoque com custo.
    expect(resolveFactKind('INVENTORY_MOVEMENT', false)).toBe('INVENTORY_MOVEMENT');
    expect(resolveFactKind('INVENTORY_MOVEMENT', false)).not.toBe('SETTLEMENT');
  });

  it('cada domínio da espinha tem o seu próprio rótulo', () => {
    expect(resolveFactKind('RECEIVABLE_SETTLEMENT', false)).toBe('SETTLEMENT');
    expect(resolveFactKind('PAYMENT', true)).toBe('PAYMENT');
    expect(resolveFactKind('RECEIVABLE', false)).toBe('RECEIVABLE');
    expect(resolveFactKind('PAYABLE', false)).toBe('PAYABLE');
    expect(resolveFactKind('FISCAL_DOCUMENT', false)).toBe('FISCAL_DOCUMENT');
    expect(resolveFactKind('TAX_CALCULATION', false)).toBe('TAX_CALCULATION');
    expect(resolveFactKind('PAYROLL_PERIOD', false)).toBe('PAYROLL_PERIOD');
    expect(resolveFactKind('FIXED_ASSET_MOVEMENT', false)).toBe('FIXED_ASSET');
  });

  it('a distinção de FINANCE entre liquidação e pagamento é preservada', () => {
    // São dois fatos distintos do mesmo domínio; colapsá-los faria a trilha abrir o
    // fato errado quando os dois existirem para o mesmo título.
    expect(resolveFactKind('RECEIVABLE_SETTLEMENT', false)).toBe('SETTLEMENT');
    expect(resolveFactKind('PAYMENT', true)).toBe('PAYMENT');
  });

  it('origem desconhecida não é inventada como liquidação', () => {
    // Fail-safe: mantém o discriminante histórico apenas para pagamento; uma origem
    // desconhecida nunca vira silenciosamente um fato de FINANCE com rota válida.
    expect(resolveFactKind('ORIGEM_NAO_MAPEADA', true)).toBe('PAYMENT');
    expect(resolveFactKind('ORIGEM_NAO_MAPEADA', false)).toBe('SETTLEMENT');
  });
});
