/**
 * AGING DE TITULO — leitura OPERACIONAL do vencimento persistido.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * POR QUE ISTO NAO E CALCULO DE NEGOCIO
 *
 * O aging do dominio e um FATO PERSISTIDO: `agingBucket` e uma coluna do titulo, calculada e
 * congelada pela rotina do servidor, e e ela que aparece na coluna "Faixa" e nas visoes de sistema.
 * O servidor decide a faixa; o frontend nunca recalcula `31_60` a partir da data, porque a data de
 * referencia da faixa (virada do dia? fuso de qual unidade? momento do fechamento?) e decisao do
 * dominio, nao da tela.
 *
 * O que este modulo publica e OUTRA coisa, deliberadamente separada: a leitura HUMANA de "quanto
 * este titulo esta atrasado AGORA, em dias", usada para (i) a coluna de atraso relativo, (b) a
 * ordenacao por atraso e (c) o rotulo de prazo na linha.
 *
 * E a mesma excecao que a Central de trabalho ja afirma — item com vencimento PERSISTIDO no passado
 * — e nada mais. Nao existe score, nao existe criticidade, nao existe previsao: existe uma data
 * persistida, uma comparacao com hoje, e o numero de dias corridos entre as duas.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `null` SIGNIFICA UMA COISA SO
 *
 * "Nao esta atrasado" — seja porque o vencimento e futuro, seja porque ele nao foi publicado. Quem
 * precisa distinguir os dois casos le a data da coluna de vencimento; a coluna de atraso responde
 * apenas a pergunta que ela faz, e nao inventa "0 dias" para titulo sem vencimento.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Dias corridos desde o vencimento persistido. `null` = nao atrasado (ou sem vencimento legivel).
 *
 * A comparacao e por DIA CIVIL, nao por instante: um titulo que venceu ontem as 23h esta "1 dia em
 * atraso" as 08h de hoje, e nao "0 dias" — que seria o resultado de dividir a diferenca em horas.
 * Feriado e dia util nao entram: o dominio nao publicou calendario, e computar dia util aqui seria
 * inventar regra de cobranca.
 */
export function daysPastDue(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) {
    return null;
  }
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const elapsed = Math.floor((startOfDay(now) - startOfDay(due)) / MS_PER_DAY);
  return elapsed > 0 ? elapsed : null;
}

/**
 * Dias ATE o vencimento. `null` = ja venceu (ou sem vencimento legivel) — o complemento exato de
 * `daysPastDue`, para a coluna de prazo dizer "vence em 5 dias" sem repetir a logica.
 */
export function daysUntilDue(value: string | null | undefined, now: Date = new Date()): number | null {
  if (!value) {
    return null;
  }
  const due = new Date(value);
  if (Number.isNaN(due.getTime())) {
    return null;
  }
  const startOfDay = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const ahead = Math.floor((startOfDay(due) - startOfDay(now)) / MS_PER_DAY);
  return ahead > 0 ? ahead : null;
}

/** Rotulo humano do atraso. `null` = sem atraso: a linha nao afirma o que nao existe. */
export function overdueLabel(dueDate: string | null | undefined, now?: Date): string | null {
  const days = daysPastDue(dueDate, now);
  if (days === null) {
    return null;
  }
  return `${days} ${days === 1 ? 'dia' : 'dias'} em atraso`;
}

/**
 * PRAZO RELATIVO — a coluna de prazo, em linguagem de operacao.
 *
 * "vence hoje" / "em 5 dias" / "12 dias em atraso". A distincao entre os tres e o que faz a coluna
 * ser util: um titulo que vence hoje exige acao hoje, e a data absoluta sozinha nao diz isso sem o
 * operador fazer a conta de cabeca.
 */
export function dueLabel(dueDate: string | null | undefined, now: Date = new Date()): string {
  if (!dueDate) {
    return 'sem vencimento';
  }
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) {
    return 'sem vencimento';
  }
  const late = daysPastDue(dueDate, now);
  if (late !== null) {
    return `${late} ${late === 1 ? 'dia' : 'dias'} em atraso`;
  }
  const ahead = daysUntilDue(dueDate, now);
  if (ahead === null) {
    return 'vence hoje';
  }
  return `em ${ahead} ${ahead === 1 ? 'dia' : 'dias'}`;
}

/* ============================================================================
   ORDENACAO — leitura da pagina exibida
   ============================================================================ */

/**
 * CHAVES DE ORDENACAO DA WORKLIST FINANCEIRA.
 *
 * Todas ordenam a PAGINA carregada, no navegador, e a tela declara isso. A ordenacao do SERVIDOR
 * (`sortBy`/`sortDir`) e o caminho padrao e vem antes: `due_date asc` e o que o servidor entrega. O
 * que estas chaves fazem e permitir que o operador reordene o conjunto que ele ja tem na frente —
 * tipicamente "trazer o maior saldo para cima" — sem uma nova ida ao servidor.
 *
 * Por que nao mandar toda ordenacao ao servidor: `agingBucket` e campo da view de lista e
 * `daysPastDue` e leitura derivada de data; nenhum dos dois tem `sortBy` publicado no contrato de
 * `/finance/receivables`. Inventar o parametro faria a tela pedir algo que o servidor ignora — e o
 * operador acharia que ordenou.
 */
export type FinanceSortKey =
  | 'dueDate'
  | 'reference'
  | 'amount'
  | 'outstanding'
  | 'overdue'
  | 'status';

export type FinanceSortDirection = 'asc' | 'desc';

export type FinanceSortState = {
  key: FinanceSortKey;
  direction: FinanceSortDirection;
};

export const FINANCE_DEFAULT_SORT: FinanceSortState = { key: 'dueDate', direction: 'asc' };

/** Rotulo humano de cada chave. O operador ordena por PERGUNTA, e o rotulo e a pergunta. */
export const FINANCE_SORT_LABELS: Record<FinanceSortKey, string> = {
  dueDate: 'Vencimento',
  reference: 'Documento',
  amount: 'Valor',
  outstanding: 'Saldo',
  overdue: 'Atraso',
  status: 'Situação',
};

/**
 * Comparador generico. `null`/ausente SEMPRE vai para o fim, em qualquer direcao.
 *
 * Esta e a decisao que evita a ordenacao mentirosa: se "sem saldo" fosse tratado como 0, ordenar por
 * saldo decrescente encheria o topo da lista com titulos que nao tem saldo publicado — e o operador
 * leria isso como "os maiores saldos da carteira". Ausencia nao e zero, e o comparador respeita isso
 * nos dois sentidos.
 */
function compareNullable<T>(
  a: T | null | undefined,
  b: T | null | undefined,
  direction: FinanceSortDirection,
): number {
  const aMissing = a === null || a === undefined;
  const bMissing = b === null || b === undefined;
  if (aMissing && bMissing) {
    return 0;
  }
  if (aMissing) {
    return 1;
  }
  if (bMissing) {
    return -1;
  }
  const base = a < b ? -1 : a > b ? 1 : 0;
  return direction === 'asc' ? base : -base;
}

/** Interface minima que a ordenacao precisa. Nao acopla o modulo ao DTO do dominio. */
export type FinanceSortableTitle = {
  dueDate: string;
  reference: string | null;
  amount: number | null;
  outstanding: number | null;
  overdueDays: number | null;
  status: string;
};

/**
 * Acessor de ordenacao — UMA tabela de chave para valor.
 *
 * As duas listas (receber e pagar) chamam esta funcao em vez de repetir a leitura de campo. Sem isso,
 * Recebiveis e Pagaveis divergiriam na primeira mudanca de coluna — que e exatamente o defeito que
 * quatro worklists financeiras desenhadas separadamente produzem.
 */
export function sortValue(title: FinanceSortableTitle, key: FinanceSortKey): number | string | null {
  switch (key) {
    case 'dueDate': {
      const parsed = new Date(title.dueDate).getTime();
      return Number.isNaN(parsed) ? null : parsed;
    }
    case 'reference':
      return title.reference;
    case 'amount':
      return title.amount;
    case 'outstanding':
      return title.outstanding;
    case 'overdue':
      return title.overdueDays;
    case 'status':
      return title.status;
    default:
      return null;
  }
}

/**
 * ORDENA A PAGINA. Devolve um NOVO array — a pagina recebida nunca e mutada.
 *
 * `overdue` tem um cuidado proprio: ordenar por atraso DECRESCENTE e a pergunta "quem esta pior",
 * entao o titulo mais atrasado vem primeiro. Isso sai naturalmente do comparador, porque mais dias =
 * maior valor.
 */
export function sortTitles<T extends FinanceSortableTitle>(
  rows: readonly T[],
  sort: FinanceSortState,
): T[] {
  return [...rows].sort((a, b) =>
    compareNullable(sortValue(a, sort.key), sortValue(b, sort.key), sort.direction),
  );
}
