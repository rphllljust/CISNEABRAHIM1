/**
 * MEASUREMENT PROCESS CONTEXT — em que estágio da cadeia Service-to-Cash a
 * medição está, com saúde do processo.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * POR QUE ISSO NÃO É UM BPM ENGINE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Um motor de processo genérico exigiria definir atividades, transições e
 * condição de guarda para domínios que ainda não têm fato. Nesta fase o que
 * existe é MENOS e mais útil: uma projeção sobre FATORES REAIS já persistidos
 * (contrato, planejamento, reserva, despacho, execução, realizado, medição,
 * aceite, faturamento, recebível, liquidação).
 *
 * A projeção responde cinco perguntas de operação:
 *
 *   Onde estou?           currentStage
 *   Há quanto tempo?      elapsed
 *   Qual era a meta?      target
 *   Quem é o dono agora?  owner
 *   O que me impede?      blocker
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO **NÃO** FAZ
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Não consulta banco, não estima prazo por média histórica (isso inventaria um
 * número que ninguém prometeu), não decide autorização.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

export const PROCESS_STAGES = {
  Contract: 'CONTRACT',
  Planning: 'PLANNING',
  Reservation: 'RESERVATION',
  Dispatch: 'DISPATCH',
  Execution: 'EXECUTION',
  Actuals: 'ACTUALS',
  Measurement: 'MEASUREMENT',
  Acceptance: 'ACCEPTANCE',
  Billing: 'BILLING',
  Receivable: 'RECEIVABLE',
  Settlement: 'SETTLEMENT',
} as const;

export type ProcessStage = (typeof PROCESS_STAGES)[keyof typeof PROCESS_STAGES];

/** A ordem da cadeia. Publicada para que o consumidor não a rededuza. */
export const PROCESS_STAGE_ORDER: readonly ProcessStage[] = [
  PROCESS_STAGES.Contract,
  PROCESS_STAGES.Planning,
  PROCESS_STAGES.Reservation,
  PROCESS_STAGES.Dispatch,
  PROCESS_STAGES.Execution,
  PROCESS_STAGES.Actuals,
  PROCESS_STAGES.Measurement,
  PROCESS_STAGES.Acceptance,
  PROCESS_STAGES.Billing,
  PROCESS_STAGES.Receivable,
  PROCESS_STAGES.Settlement,
];

export const PROCESS_STAGE_LABELS: Record<ProcessStage, string> = {
  CONTRACT: 'Contrato',
  PLANNING: 'Planejamento',
  RESERVATION: 'Reserva de recursos',
  DISPATCH: 'Despacho',
  EXECUTION: 'Execução',
  ACTUALS: 'Realizado',
  MEASUREMENT: 'Medição',
  ACCEPTANCE: 'Aceite do cliente',
  BILLING: 'Faturamento',
  RECEIVABLE: 'Recebível',
  SETTLEMENT: 'Liquidação',
};

/**
 * Estado de cada marco.
 *
 *   COMPLETED    — o fato existe.
 *   CURRENT      — o processo está aqui agora.
 *   FUTURE       — marco ainda não alcançado.
 *   NOT_APPLICABLE — a fonte comercial não previu este marco (ex.: aceite não
 *                    exigido). Distinto de FUTURE: um marco N/A nunca vai
 *                    acontecer, e mostrá-lo como "pendente" seria mentira.
 */
export const MILESTONE_STATES = {
  Completed: 'COMPLETED',
  Current: 'CURRENT',
  Future: 'FUTURE',
  NotApplicable: 'NOT_APPLICABLE',
} as const;

export type MilestoneState = (typeof MILESTONE_STATES)[keyof typeof MILESTONE_STATES];

export const PROCESS_RISKS = {
  /** Sem bloqueio e dentro da meta. */
  Low: 'LOW',
  /** Consumiu mais da metade da meta ou há dependência externa pendente. */
  Medium: 'MEDIUM',
  /** Passou da meta, ou bloqueado por dependência de terceiro. */
  High: 'HIGH',
  /** Não há meta declarada: o risco não é julgável. */
  Unknown: 'UNKNOWN',
} as const;

export type ProcessRisk = (typeof PROCESS_RISKS)[keyof typeof PROCESS_RISKS];

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fatos da cadeia de UMA ordem. Cada campo é `null` quando o fato não existe.
 *
 * `null` significa AUSÊNCIA DE FATO, e nunca é interpretado como cumprido.
 */
export type ProcessContextFacts = {
  serviceOrderId: string;
  orderNumber: string;
  unitId: string;

  /** Contrato comercial vinculado. */
  contractReference: string | null;
  contractDueAt: string | null;

  /** Planejamento: existe recurso planejado. */
  planningConfirmedAt: string | null;
  /** Reserva: existe alocação ativa. */
  reservationConfirmedAt: string | null;
  /** Despacho: fato persistido. */
  dispatchedAt: string | null;
  /** Execução iniciada. */
  startedAt: string | null;
  /** Execução concluída. */
  completedAt: string | null;
  /** Execução fechada (realizados congelados). */
  executionClosedAt: string | null;

  /** Medição: criada, aprovada. */
  measurementCreatedAt: string | null;
  measurementApprovedAt: string | null;

  /** Aceite: política e estado. */
  acceptanceRequired: boolean;
  acceptanceSatisfiedAt: string | null;

  /** Faturamento: registro preparado. */
  billingPreparedAt: string | null;
  /** Recebível aberto. */
  receivableOpenedAt: string | null;
  /** Recebível liquidado. */
  settledAt: string | null;

  /** O que bloqueia agora, em CÓDIGO. `null` quando nada bloqueia. */
  blockingReason: string | null;
  /** Dono do bloqueio, em PAPEL. `null` quando nada bloqueia. */
  blockingOwnerRole: string | null;
  /** Próximo marco a alcançar. `null` quando a cadeia terminou. */
  nextMilestoneLabel: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type ProcessMilestone = {
  stage: ProcessStage;
  label: string;
  state: MilestoneState;
  /** Instante em que o marco foi alcançado. `null` quando futuro/não aplicável. */
  reachedAt: string | null;
};

export type ProcessHealth = {
  currentStage: ProcessStage;
  currentStageLabel: string;
  /** Segundos desde o início do estágio atual. */
  elapsedSeconds: number | null;
  /** Prazo alvo da cadeia, em segundos. `null` quando o contrato não declara. */
  targetSeconds: number | null;
  /**
   * Estimativa de conclusão. Só é calculada quando existe meta E o estágio atual
   * está datado. Semanticamente é "no ritmo atual", nunca "promessa".
   */
  forecastSecondsRemaining: number | null;
  risk: ProcessRisk;
  riskReason: string;
  ownerRole: string;
  blockingReason: string | null;
  nextMilestone: string | null;
};

export type ProcessContext = {
  milestones: ProcessMilestone[];
  /** Marcos já cumpridos, na ordem da cadeia. */
  completedMilestones: ProcessStage[];
  /** Marcos ainda por vir (não inclui `NOT_APPLICABLE`). */
  pendingMilestones: ProcessStage[];
  health: ProcessHealth;
};

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO PURO
// ═══════════════════════════════════════════════════════════════════════════════

function millis(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function secondsBetween(from: number | null, to: number | null): number | null {
  if (from === null || to === null) {
    return null;
  }
  const diff = Math.floor((to - from) / 1000);
  return diff < 0 ? 0 : diff;
}

/** Instante em que cada marco foi alcançado. Ordem da cadeia. */
function milestoneTimes(facts: ProcessContextFacts): Record<ProcessStage, string | null> {
  return {
    CONTRACT: facts.contractReference !== null ? facts.contractDueAt : null,
    PLANNING: facts.planningConfirmedAt,
    RESERVATION: facts.reservationConfirmedAt,
    DISPATCH: facts.dispatchedAt,
    EXECUTION: facts.completedAt ?? facts.startedAt,
    ACTUALS: facts.executionClosedAt,
    MEASUREMENT: facts.measurementApprovedAt ?? facts.measurementCreatedAt,
    ACCEPTANCE: facts.acceptanceRequired ? facts.acceptanceSatisfiedAt : null,
    BILLING: facts.billingPreparedAt,
    RECEIVABLE: facts.receivableOpenedAt,
    SETTLEMENT: facts.settledAt,
  };
}

/**
 * ESTÁGIO ATUAL — o marco MAIS ADIANTADO alcançado.
 *
 * Percorrer de trás para frente garante que uma ordem com medição aprovada seja
 * reportada em MEDIÇÃO (ou adiante) e nunca em EXECUÇÃO por já ter executado.
 *
 * Quando o último marco alcançado é o próprio fato que reabre a cadeia (medição
 * REJECTED, por exemplo), o estágio continua sendo o mais adiantado alcançado —
 * porque o processo não retrocede no tempo, ele apenas não avança.
 */
/**
 * ESTÁGIO ATUAL — ONDE O PROCESSO ESTÁ ESPERANDO.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O DEFEITO QUE ESTA FUNÇÃO CORRIGE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * A primeira versão devolvia o ÚLTIMO marco que tinha instante — "o mais
 * adiantado alcançado". Isso parece certo e está errado no caso que mais importa:
 *
 *   medição APROVADA em 16/10, aceite PENDENTE, hoje 20/10
 *
 *   "mais adiantado alcançado" = MEDIÇÃO
 *   onde o processo ESPERA    = ACEITE
 *
 * O operador leria "estamos em Medição" enquanto o trabalho parado é o aceite do
 * cliente, com dono COMERCIAL. O estágio diria a verdade sobre o que já
 * aconteceu e mentiria sobre onde a organização está travada — e a idade do
 * estágio sairia do marco errado.
 *
 * A REGRA CERTA: o estágio é o PRIMEIRO marco NÃO alcançado — pulando os marcos
 * não aplicáveis — e, quando todos foram alcançados, o ÚLTIMO marco da cadeia
 * (a cadeia terminou, e é nele que ela terminou).
 */
function resolveCurrentStage(
  times: Record<ProcessStage, string | null>,
  facts: ProcessContextFacts,
): ProcessStage {
  for (const stage of PROCESS_STAGE_ORDER) {
    if (stage === PROCESS_STAGES.Acceptance && !facts.acceptanceRequired) {
      continue;
    }
    if (stage === PROCESS_STAGES.Contract) {
      // O contrato não tem instante de conclusão próprio: a referência contratual
      // é o que o torna alcançado. Sem contrato, segue para o planejamento.
      if (facts.contractReference === null) {
        continue;
      }
      continue;
    }
    if (times[stage] === null) {
      return stage;
    }
  }

  // Todos alcançados: a cadeia terminou no último marco aplicável.
  for (let index = PROCESS_STAGE_ORDER.length - 1; index >= 0; index -= 1) {
    const stage = PROCESS_STAGE_ORDER[index]!;
    if (stage === PROCESS_STAGES.Acceptance && !facts.acceptanceRequired) {
      continue;
    }
    return stage;
  }
  return PROCESS_STAGES.Planning;
}

/** Dono do estágio atual. Papel declarado, nunca pessoa. */
function ownerForStage(stage: ProcessStage): string {
  switch (stage) {
    case 'CONTRACT':
    case 'ACCEPTANCE':
      return 'COMERCIAL';
    case 'PLANNING':
    case 'RESERVATION':
    case 'DISPATCH':
    case 'EXECUTION':
    case 'ACTUALS':
      return 'OPERACOES';
    case 'MEASUREMENT':
      return 'OPERACOES';
    case 'BILLING':
    case 'RECEIVABLE':
    case 'SETTLEMENT':
      return 'FATURAMENTO';
    default:
      return 'OPERACOES';
  }
}

/** Início do estágio atual, usado como base da idade. */
function stageStartedAt(
  stage: ProcessStage,
  times: Record<ProcessStage, string | null>,
  facts: ProcessContextFacts,
): string | null {
  /**
   * A idade do estágio ESPERADO começa quando o marco ANTERIOR alcançado; é o
   * intervalo em que a organização está parada nele.
   *
   * Quando todos os marcos foram alcançados (cadeia concluída), o estágio atual é
   * o ÚLTIMO marco, que JÁ tem instante: a idade passa a ser o tempo desde a
   * conclusão daquele marco, não desde o anterior.
   */
  const currentReached = times[stage];
  if (currentReached !== null) {
    return currentReached;
  }

  const index = PROCESS_STAGE_ORDER.indexOf(stage);
  for (let cursor = index; cursor >= 1; cursor -= 1) {
    const previous = PROCESS_STAGE_ORDER[cursor - 1]!;
    if (previous === PROCESS_STAGES.Acceptance && !facts.acceptanceRequired) {
      continue;
    }
    const reached = previous === PROCESS_STAGES.Contract
      ? (facts.contractReference !== null ? facts.startedAt : null)
      : times[previous];
    if (reached !== null) {
      return reached;
    }
  }
  return facts.planningConfirmedAt ?? facts.contractDueAt;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROJEÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Projeta o contexto de processo.
 *
 * `at` explícito: o teste precisa poder afirmar "6 dias e 4 horas" com relógio
 * fixo.
 */
export function projectProcessContext(
  facts: ProcessContextFacts,
  at: string,
): ProcessContext {
  const times = milestoneTimes(facts);
  const currentStage = resolveCurrentStage(times, facts);
  const currentIndex = PROCESS_STAGE_ORDER.indexOf(currentStage);

  const milestones: ProcessMilestone[] = PROCESS_STAGE_ORDER.map((stage, index) => {
    const label = PROCESS_STAGE_LABELS[stage];
    if (stage === PROCESS_STAGES.Acceptance && !facts.acceptanceRequired) {
      return {
        stage,
        label,
        state: MILESTONE_STATES.NotApplicable,
        reachedAt: null,
      };
    }

    // O contrato é "alcançado" quando a OS tem referência contratual. O instante
    // de referência é o início da execução: o contrato carregado pela OS não traz
    // data de assinatura.
    const reachedAt =
      stage === PROCESS_STAGES.Contract
        ? facts.contractReference !== null
          ? facts.startedAt
          : null
        : times[stage];

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * CURRENT É O MARCO EM QUE SE ESPERA — E ELE PODE NÃO ESTAR ALCANÇADO
     * ─────────────────────────────────────────────────────────────────────────
     *
     * `currentStage` vem de `resolveCurrentStage`, que devolve o primeiro marco
     * NÃO alcançado (ou o último, se a cadeia terminou). Chamar de CURRENT o
     * marco alcançado faria a tela mostrar "Aceite do cliente — concluído" e, ao
     * lado, "estágio atual: Aceite do cliente". As duas frases seriam
     * contraditórias.
     *
     * Por isso o estado é derivado da POSIÇÃO, não do instante:
     *
     *   índice <  atual  → COMPLETED (já passou)
     *   índice == atual  → CURRENT   (é onde o processo está agora)
     *   índice >  atual  → FUTURE    (ainda por vir)
     */
    if (stage === currentStage) {
      return { stage, label, state: MILESTONE_STATES.Current, reachedAt };
    }
    if (index < currentIndex) {
      return { stage, label, state: MILESTONE_STATES.Completed, reachedAt };
    }
    return { stage, label, state: MILESTONE_STATES.Future, reachedAt };
  });

  const completedMilestones = milestones
    .filter((item) => item.state === MILESTONE_STATES.Completed)
    .map((item) => item.stage);
  const pendingMilestones = milestones
    .filter((item) => item.state === MILESTONE_STATES.Future || item.state === MILESTONE_STATES.Current)
    .map((item) => item.stage);

  const atMs = millis(at);
  const stageStart = millis(stageStartedAt(currentStage, times, facts));
  const elapsedSeconds = secondsBetween(stageStart, atMs);

  // A meta é o prazo do CONTRATO, quando ele o declara. Sem contrato com prazo,
  // `null`: o sistema não inventa SLA a partir da janela operacional — janela é
  // quando o trabalho acontece, prazo é quanto tempo o cliente deu.
  const dueAt = millis(facts.contractDueAt);
  const chainStart = millis(stageStartedAt(PROCESS_STAGES.Planning, times, facts));
  const targetSeconds =
    dueAt !== null && chainStart !== null ? Math.max(0, Math.floor((dueAt - chainStart) / 1000)) : null;

  const forecastSecondsRemaining =
    targetSeconds !== null && elapsedSeconds !== null
      ? Math.max(0, targetSeconds - elapsedSeconds)
      : null;

  const { risk, riskReason } = classifyProcessRisk({
    stage: currentStage,
    elapsedSeconds,
    targetSeconds,
    blockingReason: facts.blockingReason,
    pendingMilestones,
  });

  return {
    milestones,
    completedMilestones,
    pendingMilestones,
    health: {
      currentStage,
      currentStageLabel: PROCESS_STAGE_LABELS[currentStage],
      elapsedSeconds,
      targetSeconds,
      forecastSecondsRemaining,
      risk,
      riskReason,
      ownerRole: facts.blockingOwnerRole ?? ownerForStage(currentStage),
      blockingReason: facts.blockingReason,
      nextMilestone: facts.nextMilestoneLabel,
    },
  };
}

/**
 * RISCO DO PROCESSO.
 *
 * A classificação é por FATOS OBSERVÁVEIS, nunca por média histórica:
 *
 *   - bloqueio por dependência de TERCEIRO (aceite do cliente) é HIGH: a
 *     organização não controla o fator que a faz esperar;
 *   - bloqueio interno é MEDIUM: há ação disponível;
 *   - sem bloqueio mas acima da meta é HIGH: o prazo já foi consumido;
 *   - acima de 75% da meta é MEDIUM;
 *   - sem meta é UNKNOWN — e UNKNOWN não é LOW: não saber não é estar bem.
 */
function classifyProcessRisk(input: {
  stage: ProcessStage;
  elapsedSeconds: number | null;
  targetSeconds: number | null;
  blockingReason: string | null;
  pendingMilestones: ProcessStage[];
}): { risk: ProcessRisk; riskReason: string } {
  /**
   * DEPENDÊNCIA EXTERNA — a organização não controla o fator que a faz esperar.
   *
   * A fonte é o MOTIVO do bloqueio e a POSIÇÃO do estágio, não o nome do estágio:
   * estar em ACEITE sem bloqueio declarado é espera normal (o cliente tem prazo),
   * enquanto o bloqueio `CUSTOMER_ACCEPTANCE_*` é espera RECONHECIDA. Confundir os
   * dois faria toda ordem em aceite ser HIGH, e um alerta que sempre dispara não
   * é alerta.
   */
  const externalDependency =
    input.blockingReason === 'CUSTOMER_ACCEPTANCE_PENDING' ||
    input.blockingReason === 'CUSTOMER_ACCEPTANCE_REJECTED' ||
    input.blockingReason === 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING';

  if (input.blockingReason !== null) {
    return externalDependency
      ? {
          risk: PROCESS_RISKS.High,
          riskReason: `Aguardando decisão de terceiro: ${input.blockingReason}.`,
        }
      : {
          risk: PROCESS_RISKS.Medium,
          riskReason: `Condição interna a resolver: ${input.blockingReason}.`,
        };
  }

  if (input.pendingMilestones.length === 0) {
    return { risk: PROCESS_RISKS.Low, riskReason: 'Cadeia concluída; nenhum marco pendente.' };
  }

  if (input.targetSeconds === null || input.elapsedSeconds === null) {
    return {
      risk: PROCESS_RISKS.Unknown,
      riskReason: 'Sem meta declarada pela fonte comercial: o risco não é julgável.',
    };
  }

  const ratio = input.elapsedSeconds / input.targetSeconds;
  if (ratio >= 1) {
    return {
      risk: PROCESS_RISKS.High,
      riskReason: 'O tempo decorrido no estágio já consumiu a meta contratual.',
    };
  }
  if (ratio >= 0.5) {
    return {
      risk: PROCESS_RISKS.Medium,
      riskReason: 'Mais da metade da meta contratual já foi consumida neste estágio.',
    };
  }
  return { risk: PROCESS_RISKS.Low, riskReason: 'Dentro da meta contratual.' };
}
