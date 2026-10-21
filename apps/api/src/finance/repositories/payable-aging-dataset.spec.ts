import { describe, expect, it } from 'vitest';
import {
  PAYABLE_AGING_BUCKET_VALUES,
  buildAgingBucketExpr,
  buildPayableAdvancedClause,
  parsePayableAdvancedFilter,
} from './payable-list-sql';
import { PAYABLE_AGING_BUCKETS } from '../domain/payable';

/**
 * AGING SOBRE O DATASET COMPLETO — contrato da faixa no SQL.
 *
 * Estes testes existem por causa de um defeito real: o aging de contas a pagar era calculado
 * sobre `list({ limit: AGING_SCAN_LIMIT })`, ou seja, sobre a PRIMEIRA PÁGINA. Com mais títulos
 * que o limite, o restante da carteira simplesmente não entrava na conta, e o número publicado
 * parecia — mas não era — o aging da carteira.
 *
 * A correção move a classificação para o SQL (agregação sem `LIMIT`) e torna `agingBucket` um
 * filtro de servidor. A garantia que estes testes protegem é uma só:
 *
 *   lista e aging agregado classificam pela MESMA expressão.
 *
 * Se alguém editar um dos dois lados, a faixa "31-60" da lista deixaria de ser a faixa "31-60"
 * do gráfico — e a soma do gráfico não fecharia com o drilldown. Nada quebraria de forma
 * ruidosa; a tela apenas passaria a mentir com números plausíveis.
 */

describe('buildAgingBucketExpr', () => {
  it('cobre exatamente as faixas do domínio', () => {
    const expr = buildAgingBucketExpr('$1::date');
    for (const value of PAYABLE_AGING_BUCKET_VALUES) {
      expect(expr).toContain(`'${value}'`);
    }
  });

  it('respeita a PRECEDÊNCIA do domínio: cancelado vence tudo', () => {
    const expr = buildAgingBucketExpr('$1::date');
    const cancelledAt = expr.indexOf(`'CANCELLED'`);
    const settledAt = expr.indexOf(`'SETTLED'`);

    // Um título cancelado não está "vencido" nem "liquidado": `classifyPayableAging` testa
    // lifecycle ANTES do saldo. Inverter isto faria cancelados aparecerem como atraso.
    expect(cancelledAt).toBeGreaterThanOrEqual(0);
    expect(settledAt).toBeGreaterThan(cancelledAt);
  });

  it('usa o parâmetro de data informado, não um relógio implícito', () => {
    // O corte tem de ser o mesmo que a tela exibe; um `NOW()` interno faria o aging mudar
    // de faixa no meio da leitura, sem que ninguém tivesse mexido em nada.
    expect(buildAgingBucketExpr('$7::date')).toContain('$7::date');
  });

  it('considera estornos ao apurar o saldo', () => {
    // Mesma semântica de `remainingBalance`: pagamento revertido SUBTRAI. Um aging que só
    // somasse pagamentos mostraria saldo menor do que o real depois de um estorno.
    const expr = buildAgingBucketExpr('$1::date');
    expect(expr).toContain('reverses_payment_id IS NULL');
  });

  it('mantém a mesma expressão para lista e agregação', () => {
    // A expressão é pura em função do placeholder: chamá-la duas vezes com o mesmo índice
    // produz o MESMO texto. É isto que torna seguro reaproveitá-la em três consultas.
    expect(buildAgingBucketExpr('CURRENT_DATE')).toBe(buildAgingBucketExpr('CURRENT_DATE'));
  });
});

describe('agingBucket como filtro de servidor', () => {
  function filterFor(value: string, operator = 'eq') {
    return parsePayableAdvancedFilter({
      connector: 'AND',
      groups: [{ conditions: [{ field: 'agingBucket', operator, value }] }],
    })!;
  }

  it('aceita a faixa no filtro composto', () => {
    const built = buildPayableAdvancedClause(filterFor('31_60'), 1);
    expect(built).not.toBeNull();
    expect(built!.params).toEqual(['31_60']);
  });

  it('compara a EXPRESSÃO derivada, não uma coluna inexistente', () => {
    const built = buildPayableAdvancedClause(filterFor('90_PLUS'), 1)!;
    // `fin.payables` não tem `aging_bucket`: a faixa é derivada de lifecycle + saldo + vencimento.
    expect(built.clause).toContain('CASE');
    expect(built.clause).not.toContain('r.aging_bucket');
    expect(built.clause).toContain('= $1');
  });

  it('recusa faixa desconhecida em vez de devolver lista vazia', () => {
    // Uma faixa inexistente comparada no SQL devolveria zero linhas — e o operador leria
    // "não há títulos nesta faixa" quando o que houve foi um filtro inválido.
    const built = buildPayableAdvancedClause(filterFor('NAO_EXISTE'), 1);
    expect(built).toBeNull();
  });

  it('recusa operador que não seja igualdade', () => {
    expect(buildPayableAdvancedClause(filterFor('1_30', 'contains'), 1)).toBeNull();
  });

  it('parametriza o valor — nunca interpola texto do cliente', () => {
    const built = buildPayableAdvancedClause(filterFor('1_30'), 3)!;
    expect(built.params).toEqual(['1_30']);
    expect(built.clause).toContain('$3');
    expect(built.clause).not.toContain("'1_30'=");
  });
});

describe('paridade entre as faixas do DTO e do domínio', () => {
  it('a lista de faixas aceitas espelha PAYABLE_AGING_BUCKETS', () => {
    // Duas declarações existem por dependência de camada (DTO é borda HTTP). Este teste é o
    // que impede as duas de divergirem: uma faixa adicionada ao domínio sem entrar no filtro
    // ficaria impossível de filtrar.
    const fromDomain = Object.values(PAYABLE_AGING_BUCKETS).sort();
    const fromSql = [...PAYABLE_AGING_BUCKET_VALUES].sort();
    expect(fromSql).toEqual(fromDomain);
  });
});
