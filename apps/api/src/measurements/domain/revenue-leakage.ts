/**
 * REVENUE LEAKAGE — a MESMA cadeia vista por estágio.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE MÓDULO **É** E O QUE ELE **NÃO É**
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Ele NÃO é um segundo sistema de faturamento. Não cria registro, não emite
 * documento, não abre recebível, não calcula preço.
 *
 * Ele É uma PROJEÇÃO sobre a cadeia: para cada valor de serviço criado (a OS
 * concluída), em que estágio ele parou e quanto está parado ali. Um número sem
 * drill-down não tem valor; por isso a projeção carrega SEMPRE o estágio, a
 * idade, o dono, o impeditivo e a próxima ação — e não apenas o total.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ISSO NÃO PODE SER UMA CONTA NA TELA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Um total de "R$ 1.120.000 em risco" somado no navegador a partir de listas
 * paginadas seria FALSO por construção: a página não contém todos os registros.
 * A projeção é calculada sobre o conjunto inteiro, com escopo aplicado no SQL, e
 * o drill-down reconstrói exatamente a mesma soma.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não formata texto de duração (o
 * read model publica SEGUNDOS; a tela formata).
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO — OS ESTÁGIOS SÃO UMA CADEIA, NÃO UMA TAXONOMIA
// ═══════════════════════════════════════════════════════════════════════════════
//
// A ordem da lista É a ordem da cadeia. Isso importa: um valor só pode estar em
// UM estágio, e o estágio é sempre o MAIS ADIANTADO alcançado. Um valor medido
// que também foi executado está em MEASURED_NOT_APPROVED, nunca em
// EXECUTED_NOT_MEASURED — senão o mesmo dinheiro seria contado duas vezes.

export const LEAKAGE_STAGES = {
  /** Execução fechada, sem medição. */
  ExecutedNotMeasured: 'EXECUTED_NOT_MEASURED',
  /** Medição existente, não aprovada (DRAFT/SUBMITTED/UNDER_REVIEW/REJECTED). */
  MeasuredNotApproved: 'MEASURED_NOT_APPROVED',
  /** Medição aprovada, aceite do cliente pendente ou rejeitado. */
  ApprovedNotAccepted: 'APPROVED_NOT_ACCEPTED',
  /** Aceite satisfeito, mas a elegibilidade de faturamento está bloqueada. */
  AcceptedNotBillable: 'ACCEPTED_NOT_BILLABLE',
  /** Pronto para faturar, sem registro de faturamento preparado. */
  ReadyNotPrepared: 'READY_NOT_PREPARED',
} as const;

export type LeakageStage = (typeof LEAKAGE_STAGES)[keyof typeof LEAKAGE_STAGES];

/** Ordem da cadeia. Publicada como lista para que o consumidor não a rededuza. */
export const LEAKAGE_STAGE_ORDER: readonly LeakageStage[] = [
  LEAKAGE_STAGES.ExecutedNotMeasured,
  LEAKAGE_STAGES.MeasuredNotApproved,
  LEAKAGE_STAGES.ApprovedNotAccepted,
  LEAKAGE_STAGES.AcceptedNotBillable,
  LEAKAGE_STAGES.ReadyNotPrepared,
];

export const LEAKAGE_STAGE_LABELS: Record<LeakageStage, string> = {
  EXECUTED_NOT_MEASURED: 'Executado, não medido',
  MEASURED_NOT_APPROVED: 'Medido, não aprovado',
  APPROVED_NOT_ACCEPTED: 'Aprovado, aguardando aceite',
  ACCEPTED_NOT_BILLABLE: 'Aceito, mas bloqueado para faturar',
  READY_NOT_PREPARED: 'Pronto, não preparado',
};

/**
 * Dono de cada estágio. Um PAPEL, nunca uma pessoa: não há atribuição automática
 * de responsabilidade individual a partir de um número.
 */
const STAGE_OWNER_ROLES: Record<LeakageStage, string> = {
  EXECUTED_NOT_MEASURED: 'OPERACOES',
  MEASURED_NOT_APPROVED: 'OPERACOES',
  APPROVED_NOT_ACCEPTED: 'COMERCIAL',
  ACCEPTED_NOT_BILLABLE: 'FATURAMENTO',
  READY_NOT_PREPARED: 'FATURAMENTO',
};

/** Ação que tira o valor do estágio. */
const STAGE_NEXT_ACTIONS: Record<LeakageStage, { code: string; label: string }> = {
  EXECUTED_NOT_MEASURED: {
    code: 'CREATE_MEASUREMENT',
    label: 'Gerar a medição da execução fechada',
  },
  MEASURED_NOT_APPROVED: {
    code: 'APPROVE_MEASUREMENT',
    label: 'Concluir a aprovação da medição',
  },
  APPROVED_NOT_ACCEPTED: {
    code: 'OBTAIN_CUSTOMER_ACCEPTANCE',
    label: 'Registrar aceite do cliente',
  },
  ACCEPTED_NOT_BILLABLE: {
    code: 'RESOLVE_BILLING_BLOCKER',
    label: 'Resolver o impeditivo de faturamento',
  },
  READY_NOT_PREPARED: {
    code: 'PREPARE_BILLING',
    label: 'Preparar o faturamento',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA — UM POR ORDEM CONCLUÍDA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fatos de UMA ordem concluída, já lidos de contratos publicados e de tabelas de
 * fato. Este módulo não lê nada: classifica.
 */
export type LeakageOrderFacts = {
  serviceOrderId: string;
  orderNumber: string;
  unitId: string;
  clientId: string | null;
  clientLabel: string | null;
  completedAt: string | null;

  /** Execução: `so.execution_closures`. */
  executionClosedAt: string | null;

  /** Medição: último registro. */
  measurementId: string | null;
  measurementStatus: string | null;
  measurementUpdatedAt: string | null;

  /** Valor apurado da medição. `null` quando não há base de preço completa. */
  measurementAmount: string | null;
  /** Valor de referência quando ainda não há medição (do snapshot comercial). */
  contractualAmount: string | null;
  currencyCode: string | null;

  /** Aceite: estado derivado pela política. */
  acceptanceRequired: boolean;
  acceptanceBlocked: boolean;

  /** Elegibilidade: último resultado avaliado, `null` quando não avaliado. */
  eligibilityResult: string | null;
  eligibilityBlockingReason: string | null;
  /** Dimensão bloqueante já nomeada (a primeira). */
  eligibilityNextActionCode: string | null;

  /** Já existe registro de faturamento preparado? */
  billingPrepared: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type LeakagePosition = {
  serviceOrderId: string;
  orderNumber: string;
  unitId: string;
  clientId: string | null;
  clientLabel: string | null;
  stage: LeakageStage;
  stageLabel: string;
  amount: string | null;
  currencyCode: string | null;
  /** Idade no estágio, em SEGUNDOS. `null` quando não há fato de origem datado. */
  ageSeconds: number | null;
  ownerRole: string;
  blockerCode: string | null;
  nextAction: { code: string; label: string };
};

export type LeakageStageSummary = {
  stage: LeakageStage;
  label: string;
  count: number;
  /** Soma dos valores conhecidos. `null` quando NENHUM valor é conhecido. */
  amount: string | null;
  /** Quantas ordens neste estágio não têm valor apurado. */
  unknownAmountCount: number;
  currencyCode: string | null;
};

export type LeakageProjection = {
  stages: LeakageStageSummary[];
  total: {
    count: number;
    amount: string | null;
    unknownAmountCount: number;
    currencyCode: string | null;
  };
  positions: LeakagePosition[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// CLASSIFICAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function millis(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function secondsBetween(from: number, to: number): number {
  const diff = Math.floor((to - from) / 1000);
  return diff < 0 ? 0 : diff;
}

/**
 * Em que estágio o valor desta ordem parou.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ORDEM DE VERIFICAÇÃO É DO FIM DA CADEIA PARA O INÍCIO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Verificar de trás para frente garante que o estágio devolvido seja SEMPRE o
 * mais adiantado alcançado. Verificar da frente para trás classificaria uma ordem
 * aprovada como "executada não medida" porque ela já foi executada — e o número
 * do estágio mais antigo inflaria com valor que já avançou.
 *
 * Uma ordem que já tem faturamento preparado NÃO entra na projeção: ela saiu da
 * cadeia desta capability. Ela retorna `null`.
 */
export function classifyLeakageStage(facts: LeakageOrderFacts): LeakageStage | null {
  // Saiu da cadeia: faturamento já preparado.
  if (facts.billingPrepared) {
    return null;
  }

  // PRONTO e não preparado — o último estágio antes de faturar.
  if (facts.eligibilityResult === 'READY') {
    return LEAKAGE_STAGES.ReadyNotPrepared;
  }

  // Medição aprovada: a lacuna passa a ser de aceite ou de elegibilidade.
  if (facts.measurementStatus === 'APPROVED') {
    if (facts.acceptanceRequired && facts.acceptanceBlocked) {
      return LEAKAGE_STAGES.ApprovedNotAccepted;
    }
    // Aceite satisfeito (ou não aplicável) e a elegibilidade não é READY: o
    // bloqueio é de outra dimensão (PO, condições comerciais, base de preço).
    if (facts.eligibilityResult !== null && facts.eligibilityResult !== 'READY') {
      return LEAKAGE_STAGES.AcceptedNotBillable;
    }
    // Aprovada, sem avaliação de elegibilidade registrada: o valor está parado
    // antes de faturamento, e o estágio honesto é este — não inventar READY.
    return LEAKAGE_STAGES.AcceptedNotBillable;
  }

  // Medição existente e NÃO aprovada (DRAFT, SUBMITTED, UNDER_REVIEW, REJECTED).
  if (facts.measurementId !== null) {
    return LEAKAGE_STAGES.MeasuredNotApproved;
  }

  // Execução fechada e nenhuma medição.
  if (facts.executionClosedAt !== null) {
    return LEAKAGE_STAGES.ExecutedNotMeasured;
  }

  // Concluída sem fechamento de execução: NÃO é lacuna de receita desta
  // projeção — é falha da capability anterior, e classificá-la aqui somaria
  // valor executado que ainda não existe como base. Fora da projeção.
  return null;
}

/** Instante em que o valor ENTROU no estágio atual. Base da idade. */
function stageEnteredAt(facts: LeakageOrderFacts, stage: LeakageStage): string | null {
  switch (stage) {
    case 'EXECUTED_NOT_MEASURED':
      return facts.executionClosedAt ?? facts.completedAt;
    case 'MEASURED_NOT_APPROVED':
      return facts.measurementUpdatedAt ?? facts.completedAt;
    case 'APPROVED_NOT_ACCEPTED':
      return facts.measurementUpdatedAt ?? facts.completedAt;
    case 'ACCEPTED_NOT_BILLABLE':
      return facts.measurementUpdatedAt ?? facts.completedAt;
    case 'READY_NOT_PREPARED':
      return facts.measurementUpdatedAt ?? facts.completedAt;
    default:
      return facts.completedAt;
  }
}

/** Valor a declarar para o estágio. Medição quando existe; contratual como referência. */
function amountFor(facts: LeakageOrderFacts): string | null {
  return facts.measurementAmount ?? facts.contractualAmount;
}

/** Por que a ordem está parada neste estágio — em CÓDIGO, nunca em frase solta. */
function blockerFor(facts: LeakageOrderFacts, stage: LeakageStage): string | null {
  switch (stage) {
    case 'EXECUTED_NOT_MEASURED':
      return 'MEASUREMENT_MISSING';
    case 'MEASURED_NOT_APPROVED':
      return facts.measurementStatus === 'REJECTED'
        ? 'MEASUREMENT_REJECTED'
        : 'MEASUREMENT_NOT_APPROVED';
    case 'APPROVED_NOT_ACCEPTED':
      return 'CUSTOMER_ACCEPTANCE_PENDING';
    case 'ACCEPTED_NOT_BILLABLE':
      return facts.eligibilityBlockingReason ?? 'BILLING_ELIGIBILITY_BLOCKED';
    case 'READY_NOT_PREPARED':
      return 'BILLING_RECORD_NOT_PREPARED';
    default:
      return null;
  }
}

/**
 * Constrói a posição de lacuna de UMA ordem.
 *
 * `at` é passado explicitamente para que a idade seja determinística em teste —
 * ler o relógio aqui dentro tornaria impossível provar "parado há 6 dias".
 */
export function buildLeakagePosition(
  facts: LeakageOrderFacts,
  at: string,
): LeakagePosition | null {
  const stage = classifyLeakageStage(facts);
  if (stage === null) {
    return null;
  }

  const enteredAt = stageEnteredAt(facts, stage);
  const enteredMs = millis(enteredAt);
  const atMs = millis(at);
  const ageSeconds =
    enteredMs === null || atMs === null ? null : secondsBetween(enteredMs, atMs);

  return {
    serviceOrderId: facts.serviceOrderId,
    orderNumber: facts.orderNumber,
    unitId: facts.unitId,
    clientId: facts.clientId,
    clientLabel: facts.clientLabel,
    stage,
    stageLabel: LEAKAGE_STAGE_LABELS[stage],
    amount: amountFor(facts),
    currencyCode: facts.currencyCode,
    ageSeconds,
    ownerRole: STAGE_OWNER_ROLES[stage],
    blockerCode: blockerFor(facts, stage),
    nextAction: STAGE_NEXT_ACTIONS[stage],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJEÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function sumDecimal(values: string[]): string | null {
  if (values.length === 0) {
    return null;
  }
  const total = values.reduce((sum, value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? sum + parsed : sum;
  }, 0);
  return total.toFixed(4);
}

/**
 * Projeta a lacuna de receita.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O TOTAL É A SOMA DOS ESTÁGIOS, E O DRILL-DOWN RECONSTRÓI O TOTAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O total é derivado das posições — nunca de uma segunda consulta ao banco. Uma
 * segunda consulta poderia devolver outro número (escopo, filtro, instante), e o
 * operador veria um total que não fecha com o detalhe que ele abre. Os valores
 * desconhecidos são CONTADOS em separado, e não somados como zero: somar "sem
 * valor" como R$ 0,00 é afirmar que não há dinheiro parado.
 */
export function projectRevenueLeakage(input: {
  orders: LeakageOrderFacts[];
  at: string;
}): LeakageProjection {
  const positions: LeakagePosition[] = [];
  for (const facts of input.orders) {
    const position = buildLeakagePosition(facts, input.at);
    if (position) {
      positions.push(position);
    }
  }

  const stages: LeakageStageSummary[] = LEAKAGE_STAGE_ORDER.map((stage) => {
    const inStage = positions.filter((item) => item.stage === stage);
    const knownAmounts = inStage
      .map((item) => item.amount)
      .filter((value): value is string => value !== null);
    return {
      stage,
      label: LEAKAGE_STAGE_LABELS[stage],
      count: inStage.length,
      amount: sumDecimal(knownAmounts),
      unknownAmountCount: inStage.length - knownAmounts.length,
      currencyCode: inStage.find((item) => item.currencyCode !== null)?.currencyCode ?? null,
    };
  });

  const knownAmounts = positions
    .map((item) => item.amount)
    .filter((value): value is string => value !== null);

  return {
    stages,
    total: {
      count: positions.length,
      amount: sumDecimal(knownAmounts),
      unknownAmountCount: positions.length - knownAmounts.length,
      currencyCode: positions.find((item) => item.currencyCode !== null)?.currencyCode ?? null,
    },
    positions: sortPositions(positions),
  };
}

/**
 * Ordena por exposição: estágio mais adiantado primeiro (dinheiro mais perto de
 * ser recebido), depois idade, depois valor.
 *
 * A ordem é DECLARADA aqui para que o drill-down e o total usem exatamente o
 * mesmo critério — a tela não reordena.
 */
export function sortPositions(positions: LeakagePosition[]): LeakagePosition[] {
  const stageWeight = new Map<LeakageStage, number>(
    [...LEAKAGE_STAGE_ORDER].reverse().map((stage, index) => [stage, index]),
  );
  return [...positions].sort((left, right) => {
    const byStage = (stageWeight.get(left.stage) ?? 0) - (stageWeight.get(right.stage) ?? 0);
    if (byStage !== 0) {
      return byStage;
    }
    const leftAge = left.ageSeconds ?? 0;
    const rightAge = right.ageSeconds ?? 0;
    if (rightAge !== leftAge) {
      return rightAge - leftAge;
    }
    const leftAmount = Number(left.amount ?? 0);
    const rightAmount = Number(right.amount ?? 0);
    if (rightAmount !== leftAmount) {
      return rightAmount - leftAmount;
    }
    return left.orderNumber.localeCompare(right.orderNumber, 'pt-BR');
  });
}
