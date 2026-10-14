import { describe, expect, it } from 'vitest';
import {
  FINANCE_DEFAULT_SORT,
  daysPastDue,
  daysUntilDue,
  dueLabel,
  overdueLabel,
  sortTitles,
  type FinanceSortableTitle,
} from './finance-aging';

/**
 * AGING E ORDENACAO FINANCEIRA — as duas regras que decidem a leitura da worklist.
 *
 * Estes testes prendem o que NAO pode regredir em silencio:
 *   - atraso e leitura de vencimento PERSISTIDO, por dia civil, e `null` quando nao ha atraso;
 *   - ausencia NUNCA ordena como zero (nem crescente, nem decrescente).
 */

/** Data civil no passado, em dias, para o calculo de atraso ser deterministico no teste. */
function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

function inDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function title(overrides: Partial<FinanceSortableTitle>): FinanceSortableTitle {
  return {
    dueDate: inDays(10),
    reference: 'AR-001',
    amount: 100,
    outstanding: 100,
    overdueDays: null,
    status: 'OPEN',
    ...overrides,
  };
}

describe('daysPastDue', () => {
  it('mede dias civis decorridos do vencimento ate hoje', () => {
    expect(daysPastDue(daysAgo(1))).toBe(1);
    expect(daysPastDue(daysAgo(30))).toBe(30);
  });

  it('devolve null quando o titulo ainda nao venceu — nao existe "zero dias de atraso"', () => {
    expect(daysPastDue(inDays(1))).toBeNull();
    expect(daysPastDue(inDays(45))).toBeNull();
  });

  it('devolve null para vencimento ausente ou ilegivel em vez de inventar atraso', () => {
    expect(daysPastDue(null)).toBeNull();
    expect(daysPastDue(undefined)).toBeNull();
    expect(daysPastDue('')).toBeNull();
    expect(daysPastDue('nao-e-data')).toBeNull();
  });

  it('conta o dia CIVIL, e nao a diferenca em horas', () => {
    /*
     * Um titulo que venceu ontem esta "1 dia em atraso" em qualquer hora de hoje. A versao por
     * instante devolveria 0 nas primeiras horas do dia — e "0 dias em atraso" nao existe.
     */
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(23, 30, 0, 0);
    expect(daysPastDue(yesterday.toISOString())).toBe(1);
  });
});

describe('daysUntilDue', () => {
  it('e o complemento exato de daysPastDue', () => {
    expect(daysUntilDue(inDays(7))).toBe(7);
    expect(daysUntilDue(daysAgo(3))).toBeNull();
  });
});

describe('rotulos humanos', () => {
  it('pluraliza o atraso sem "1 dias"', () => {
    expect(overdueLabel(daysAgo(1))).toBe('1 dia em atraso');
    expect(overdueLabel(daysAgo(12))).toBe('12 dias em atraso');
    expect(overdueLabel(inDays(3))).toBeNull();
  });

  it('distingue "vence hoje" de "em N dias" e de atraso', () => {
    expect(dueLabel(inDays(5))).toBe('em 5 dias');
    expect(dueLabel(inDays(1))).toBe('em 1 dia');
    expect(dueLabel(daysAgo(2))).toBe('2 dias em atraso');
    expect(dueLabel(null)).toBe('sem vencimento');
  });
});

describe('sortTitles', () => {
  it('ordena por atraso decrescente — quem esta pior primeiro', () => {
    const rows = [
      title({ reference: 'A', overdueDays: 3, dueDate: daysAgo(3) }),
      title({ reference: 'B', overdueDays: 40, dueDate: daysAgo(40) }),
      title({ reference: 'C', overdueDays: 12, dueDate: daysAgo(12) }),
    ];
    const sorted = sortTitles(rows, { key: 'overdue', direction: 'desc' });
    expect(sorted.map((row) => row.reference)).toEqual(['B', 'C', 'A']);
  });

  it('ordena por valor decrescente', () => {
    const rows = [
      title({ reference: 'A', amount: 10 }),
      title({ reference: 'B', amount: 900 }),
      title({ reference: 'C', amount: 250 }),
    ];
    expect(sortTitles(rows, { key: 'amount', direction: 'desc' }).map((r) => r.reference)).toEqual([
      'B',
      'C',
      'A',
    ]);
  });

  it('NAO trata ausencia como zero: sem saldo vai para o fim nas DUAS direcoes', () => {
    /*
     * Este e o defeito que o comparador existe para impedir. Se `null` fosse 0, ordenar por saldo
     * decrescente encheria o TOPO com titulos sem saldo publicado — e o operador leria isso como
     * "os maiores saldos da carteira". Ausencia vai para o fim, sempre.
     */
    const rows = [
      title({ reference: 'sem-saldo', outstanding: null }),
      title({ reference: 'grande', outstanding: 5000 }),
      title({ reference: 'pequeno', outstanding: 10 }),
    ];

    const desc = sortTitles(rows, { key: 'outstanding', direction: 'desc' });
    expect(desc.map((row) => row.reference)).toEqual(['grande', 'pequeno', 'sem-saldo']);

    const asc = sortTitles(rows, { key: 'outstanding', direction: 'asc' });
    expect(asc.map((row) => row.reference)).toEqual(['pequeno', 'grande', 'sem-saldo']);
  });

  it('manda titulos sem atraso para o fim ao ordenar por atraso', () => {
    const rows = [
      title({ reference: 'no-prazo', overdueDays: null }),
      title({ reference: 'atrasado', overdueDays: 5 }),
    ];
    expect(
      sortTitles(rows, { key: 'overdue', direction: 'desc' }).map((row) => row.reference),
    ).toEqual(['atrasado', 'no-prazo']);
  });

  it('nao muta o array recebido — a pagina do servidor permanece intacta', () => {
    const rows = [title({ reference: 'A', amount: 2 }), title({ reference: 'B', amount: 1 })];
    const before = rows.map((row) => row.reference);
    sortTitles(rows, { key: 'amount', direction: 'asc' });
    expect(rows.map((row) => row.reference)).toEqual(before);
  });

  it('ordena por vencimento, que e a ordem natural da carteira', () => {
    const rows = [
      title({ reference: 'depois', dueDate: inDays(20) }),
      title({ reference: 'antes', dueDate: inDays(2) }),
    ];
    expect(sortTitles(rows, FINANCE_DEFAULT_SORT).map((row) => row.reference)).toEqual([
      'antes',
      'depois',
    ]);
  });
});
