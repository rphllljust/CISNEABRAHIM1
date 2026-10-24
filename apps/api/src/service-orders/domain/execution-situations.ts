/**
 * SITUATION ENGINE — o sistema DETECTA a exceção em vez de esperar que alguém a veja.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O console de operação dependia de o operador OLHAR a lista e perceber o problema.
 * "SLA em risco" era uma conta feita no olho; "pausada há muito tempo" não existia
 * em lugar nenhum; "realizado faltando" só aparecia quando a conclusão falhava.
 *
 * O resultado prático: a exceção era descoberta quando já tinha virado atraso — e
 * a conversa depois era sobre quem não olhou, não sobre o que aconteceu.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A CADEIA (igual à de qualquer domínio que produz trabalho)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   FATO PERSISTIDO
 *        ↓
 *   DETECÇÃO (função pura, este arquivo)
 *        ↓
 *   IMPACTO (exposição, severidade)
 *        ↓
 *   PRIORIDADE (derivada de severidade + atraso real, nunca de score inventado)
 *        ↓
 *   DONO (papel responsável)
 *        ↓
 *   PRÓXIMA MELHOR AÇÃO
 *        ↓
 *   WORK ITEM (a inbox de operações consome)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não notifica, não conhece HTTP.
 * Detectar não é agir: a detecção produz o item, a ação continua sendo um comando
 * do domínio, com autorização própria.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO FECHADO
// ═══════════════════════════════════════════════════════════════════════════════

export const EXECUTION_SITUATION_CODES = {
  /** Despacho avaliado e bloqueado. */
  DISPATCH_BLOCKED: 'DISPATCH_BLOCKED',
  /** Despachada e nunca iniciada além do limite tolerado. */
  EXECUTION_NOT_STARTED: 'EXECUTION_NOT_STARTED',
  /** Execução com progresso abaixo do esperado para o tempo decorrido. */
  EXECUTION_SLA_AT_RISK: 'EXECUTION_SLA_AT_RISK',
  /** Prazo de atendimento já vencido. */
  EXECUTION_OVERDUE: 'EXECUTION_OVERDUE',
  /** Pausa aberta por tempo acima do tolerado. */
  EXECUTION_PAUSED_TOO_LONG: 'EXECUTION_PAUSED_TOO_LONG',
  /** Recurso executado difere do reservado. */
  RESOURCE_CHANGED: 'RESOURCE_CHANGED',
  /** Realizado obrigatório ainda não capturado. */
  MISSING_ACTUALS: 'MISSING_ACTUALS',
  /** Evidência obrigatória ausente ou não verificada. */
  MISSING_EVIDENCE: 'MISSING_EVIDENCE',
  /** Leitura de medidor incoerente (regressiva, ausente ou fora do intervalo). */
  METER_ANOMALY: 'METER_ANOMALY',
  /** Consumo de combustível fora da faixa esperada. */
  FUEL_VARIANCE: 'FUEL_VARIANCE',
  /** Uso de recurso que não estava planejado. */
  UNPLANNED_RESOURCE_USAGE: 'UNPLANNED_RESOURCE_USAGE',
  /** A conclusão está bloqueada por dados faltantes. */
  EXECUTION_COMPLETION_BLOCKED: 'EXECUTION_COMPLETION_BLOCKED',
} as const;

export type ExecutionSituationCode =
  (typeof EXECUTION_SITUATION_CODES)[keyof typeof EXECUTION_SITUATION_CODES];

/** Severidade. `P1` é a mais grave. A escala é fechada e curta de propósito. */
export const SITUATION_SEVERITIES = ['P1', 'P2', 'P3', 'P4'] as const;
export type SituationSeverity = (typeof SITUATION_SEVERITIES)[number];

const SEVERITY_WEIGHT: Record<SituationSeverity, number> = {
  P1: 0,
  P2: 1,
  P3: 2,
  P4: 3,
};

/** Dono da situação. Um papel, nunca uma pessoa — não há atribuição automática. */
export const SITUATION_OWNER_ROLES = {
  OperationsSupervisor: 'SUPERVISOR_OPERACOES',
  ControlRoom: 'CENTRAL_CONTROLE',
  FleetCoordinator: 'COORDENADOR_FROTA',
  FieldSupervisor: 'SUPERVISOR_CAMPO',
  Commercial: 'COMERCIAL',
} as const;

export type SituationOwnerRole = (typeof SITUATION_OWNER_ROLES)[keyof typeof SITUATION_OWNER_ROLES];

/** Ação que a situação sugere. O comando real continua sendo do domínio. */
export const SITUATION_NEXT_BEST_ACTIONS = {
  RESOLVE_DISPATCH_BLOCK: 'RESOLVE_DISPATCH_BLOCK',
  START_EXECUTION: 'START_EXECUTION',
  PRIORITIZE_EXECUTION: 'PRIORITIZE_EXECUTION',
  ESCALATE: 'ESCALATE',
  RESUME_EXECUTION: 'RESUME_EXECUTION',
  REPLACE_RESOURCE: 'REPLACE_RESOURCE',
  REGISTER_MISSING_ACTUALS: 'REGISTER_MISSING_ACTUALS',
  ATTACH_EVIDENCE: 'ATTACH_EVIDENCE',
  REVIEW_METER: 'REVIEW_METER',
  REVIEW_FUEL: 'REVIEW_FUEL',
  JUSTIFY_RESOURCE_CHANGE: 'JUSTIFY_RESOURCE_CHANGE',
  REVIEW_REQUIREMENTS: 'REVIEW_REQUIREMENTS',
} as const;

export type SituationNextBestAction =
  (typeof SITUATION_NEXT_BEST_ACTIONS)[keyof typeof SITUATION_NEXT_BEST_ACTIONS];

// ═══════════════════════════════════════════════════════════════════════════════
// LIMIARES DECLARADOS
// ═══════════════════════════════════════════════════════════════════════════════
//
// Cada limiar é uma DECISÃO registrada aqui, em um lugar só, com o motivo. Nenhum
// limiar é derivado da média dos dados (isso esconderia o desvio no próprio
// desvio) e nenhum é configurável por request (o cliente não define o próprio
// critério de exceção).
export const SITUATION_THRESHOLDS = {
  /**
   * Minutos tolerados entre o despacho e o início. Um despacho esquecido é
   * operação parada: passou disso, o sistema pergunta.
   */
  NOT_STARTED_TOLERANCE_MINUTES: 45,
  /**
   * Fração mínima do tempo decorrido que precisa estar coberta pelo progresso
   * registrado. Abaixo disso a execução está atrás do próprio ritmo.
   */
  PROGRESS_PACE_MINIMUM: 0.8,
  /**
   * Minutos de pausa acima dos quais a pausa deixa de ser "espera normal" e passa
   * a ser exceção operacional.
   */
  PAUSE_TOLERANCE_MINUTES: 60,
  /**
   * Desvio relativo de combustível a partir do qual se investiga. 25% não é
   * tolerância contábil: é o ponto em que o número deixa de ser ruído de medição.
   */
  FUEL_VARIANCE_TOLERANCE: 0.25,
  /** Fração do planejado a partir da qual o progresso é considerado "em risco". */
  SLA_RISK_PROGRESS_FLOOR: 0.5,
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/** Situação já persistida, para deduplicação. */
export type PersistedSituationFacts = {
  id: string;
  code: string;
  detectedKey: string;
  status: string;
};

/** Fatos da execução observados no instante da detecção. */
export type ExecutionSituationFacts = {
  serviceOrderId: string;
  unitId: string;
  /** Referência humana: nunca exibir `serviceOrderId` ao operador. */
  orderNumber: string;
  clientLabel: string | null;
  status: string;

  /** Despacho. */
  dispatchedAt: string | null;
  checkedInAt: string | null;
  startedAt: string | null;
  pausedAt: string | null;
  completedAt: string | null;

  /** SLA — prazo de atendimento publicado. */
  slaDueAt: string | null;
  /** Fim da janela operacional acordada. */
  windowEndAt: string | null;

  /** Progresso. `null` quando não há meta declarada. */
  plannedQuantity: string | null;
  measuredQuantity: string | null;

  /** Bloqueios de despacho (códigos das dimensões). */
  dispatchBlockedReasons: string[];

  /** Realizado. */
  requiredActualsMissing: string[];
  requiredEvidenceMissing: string[];
  evidenceNotVerified: string[];

  /** Medidores e combustível. */
  meterAnomalyCode: string | null;
  fuelActualLiters: string | null;
  fuelPlannedLiters: string | null;

  /** Recursos. */
  unplannedResourceCodes: string[];
  changedResourceCodes: string[];

  /** Conclusão. */
  completionBlockedReasons: string[];

  /** Exposição financeira em risco, quando o domínio já a conhece. */
  financialExposure: string | null;

  /** Situações já persistidas da ordem. */
  persisted: PersistedSituationFacts[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type DetectedSituation = {
  code: ExecutionSituationCode;
  /** Chave lógica estável — a MESMA exceção nunca gera dois itens. */
  detectedKey: string;
  severity: SituationSeverity;
  title: string;
  detail: string;
  /** Impacto declarado: o que acontece se ninguém agir. */
  impact: string;
  ownerRole: SituationOwnerRole;
  nextBestAction: SituationNextBestAction;
  /** Instante do fato que originou a situação. */
  occurredAt: string;
  /** `true` quando a situação impede a conclusão. */
  blocking: boolean;
  financialExposure: string | null;
  /** Já existe situação aberta com a mesma chave? */
  alreadyOpen: boolean;
};

/** Resultado da detecção — determinístico e ordenado. */
export type SituationDetectionResult = {
  situations: DetectedSituation[];
  /** Situações NOVAS (sem correspondência aberta) — as que geram registro. */
  newSituations: DetectedSituation[];
  /** Situações abertas que deixaram de ser detectadas — devem ser resolvidas. */
  resolvableSituationIds: string[];
  /** Existe pelo menos uma situação bloqueante aberta? */
  hasBlocking: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS PUROS
// ═══════════════════════════════════════════════════════════════════════════════

function millis(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function minutesBetween(from: number, to: number): number {
  return Math.floor((to - from) / 60_000);
}

function toNumber(value: string | null): number {
  const parsed = Number(value ?? '');
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Horas restantes formatadas para o operador (`3h12`, `-0h18`). */
export function formatSlaRemaining(remainingMinutes: number): string {
  const sign = remainingMinutes < 0 ? '-' : '';
  const abs = Math.abs(remainingMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `${sign}${hours}h${String(minutes).padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detecta todas as situações da execução.
 *
 * `at` é o instante de referência, passado explicitamente. Isso mantém a função
 * pura e permite provar o comportamento em teste com um relógio fixo — ler o
 * relógio aqui dentro tornaria impossível testar "pausada há 2h".
 */
export function detectExecutionSituations(
  facts: ExecutionSituationFacts,
  at: string,
): SituationDetectionResult {
  const now = millis(at) ?? Date.now();
  const situations: DetectedSituation[] = [];

  const openKeys = new Set(
    facts.persisted.filter((item) => item.status === 'OPEN').map((item) => item.detectedKey),
  );

  const push = (input: Omit<DetectedSituation, 'alreadyOpen' | 'financialExposure'>) => {
    situations.push({
      ...input,
      financialExposure: facts.financialExposure,
      alreadyOpen: openKeys.has(input.detectedKey),
    });
  };

  const paused =
    facts.status === 'PAUSED' || (facts.pausedAt !== null && facts.completedAt === null);
  const executed = facts.startedAt !== null;

  // ── 1. DESPACHO BLOQUEADO ──────────────────────────────────────────────────
  if (facts.dispatchedAt === null && facts.dispatchBlockedReasons.length > 0) {
    push({
      code: EXECUTION_SITUATION_CODES.DISPATCH_BLOCKED,
      // A chave ordena os motivos: o mesmo conjunto de bloqueios é a mesma situação.
      detectedKey: [...facts.dispatchBlockedReasons].sort().join('|'),
      severity: 'P2',
      title: 'Despacho bloqueado',
      detail: `Motivos: ${facts.dispatchBlockedReasons.join(', ')}.`,
      impact: 'A ordem não pode sair até os bloqueios serem resolvidos.',
      ownerRole: SITUATION_OWNER_ROLES.ControlRoom,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.RESOLVE_DISPATCH_BLOCK,
      occurredAt: at,
      blocking: true,
    });
  }

  // ── 2. DESPACHADA E NÃO INICIADA ───────────────────────────────────────────
  const dispatchedAt = millis(facts.dispatchedAt);
  if (dispatchedAt !== null && !executed && facts.completedAt === null) {
    const elapsed = minutesBetween(dispatchedAt, now);
    if (elapsed > SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES) {
      push({
        code: EXECUTION_SITUATION_CODES.EXECUTION_NOT_STARTED,
        detectedKey: 'not-started',
        severity: elapsed > SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES * 2 ? 'P1' : 'P2',
        title: 'Execução não iniciada após o despacho',
        detail: `Despachada há ${elapsed} min e a execução não começou (tolerância: ${SITUATION_THRESHOLDS.NOT_STARTED_TOLERANCE_MINUTES} min).`,
        impact: 'Recurso reservado parado; o SLA corre sem trabalho executado.',
        ownerRole: SITUATION_OWNER_ROLES.ControlRoom,
        nextBestAction: SITUATION_NEXT_BEST_ACTIONS.START_EXECUTION,
        occurredAt: facts.dispatchedAt!,
        blocking: false,
      });
    }
  }

  // ── 3. SLA EM RISCO / VENCIDO ──────────────────────────────────────────────
  const due = millis(facts.slaDueAt);
  if (due !== null && executed && facts.completedAt === null) {
    const remainingMinutes = minutesBetween(now, due);

    if (remainingMinutes < 0) {
      push({
        code: EXECUTION_SITUATION_CODES.EXECUTION_OVERDUE,
        detectedKey: 'overdue',
        severity: 'P1',
        title: 'Execução atrasada',
        detail: `Prazo de atendimento vencido há ${formatSlaRemaining(remainingMinutes).replace('-', '')}.`,
        impact: 'Violação de SLA já consumada; exige escalonamento e comunicação.',
        ownerRole: SITUATION_OWNER_ROLES.OperationsSupervisor,
        nextBestAction: SITUATION_NEXT_BEST_ACTIONS.ESCALATE,
        occurredAt: facts.slaDueAt!,
        blocking: false,
      });
    } else if (facts.plannedQuantity !== null && facts.measuredQuantity !== null) {
      /**
       * RITMO: compara a fração MEDIDA com a fração de TEMPO já gasta na janela.
       *
       * A base de tempo é a janela operacional quando existe (é o que foi
       * combinado) e o SLA caso contrário. Sem nenhuma das duas não há ritmo a
       * julgar — e o sistema não inventa.
       */
      const windowStart = millis(facts.startedAt) ?? dispatchedAt;
      const windowEndMs = due;
      if (windowStart !== null && windowEndMs > windowStart) {
        const planned = toNumber(facts.plannedQuantity);
        const measured = toNumber(facts.measuredQuantity);
        if (planned > 0) {
          const timeElapsedRatio = Math.min(
            1,
            Math.max(0, (now - windowStart) / (windowEndMs - windowStart)),
          );
          const progressRatio = Math.min(1, Math.max(0, measured / planned));
          const expected = timeElapsedRatio;
          const atRisk =
            progressRatio < expected * SITUATION_THRESHOLDS.PROGRESS_PACE_MINIMUM &&
            progressRatio < SITUATION_THRESHOLDS.SLA_RISK_PROGRESS_FLOOR;

          if (atRisk) {
            const remainingToComplete = Math.max(0, planned - measured);
            push({
              code: EXECUTION_SITUATION_CODES.EXECUTION_SLA_AT_RISK,
              detectedKey: 'sla-risk',
              severity: remainingMinutes < 60 ? 'P1' : 'P2',
              title: 'SLA em risco',
              detail: `Execução atrás do ritmo: ${Math.round(progressRatio * 100)}% medido contra ${Math.round(expected * 100)}% de tempo decorrido; ${formatSlaRemaining(remainingMinutes)} restantes.`,
              impact: `Faltam ${remainingToComplete} unidade(s) para concluir dentro do prazo.`,
              ownerRole: SITUATION_OWNER_ROLES.OperationsSupervisor,
              nextBestAction: SITUATION_NEXT_BEST_ACTIONS.PRIORITIZE_EXECUTION,
              occurredAt: at,
              blocking: false,
            });
          }
        }
      }
    }
  }

  // ── 4. PAUSA PROLONGADA ────────────────────────────────────────────────────
  const pausedAt = millis(facts.pausedAt);
  if (paused && pausedAt !== null) {
    const pausedMinutes = minutesBetween(pausedAt, now);
    if (pausedMinutes > SITUATION_THRESHOLDS.PAUSE_TOLERANCE_MINUTES) {
      push({
        code: EXECUTION_SITUATION_CODES.EXECUTION_PAUSED_TOO_LONG,
        detectedKey: 'paused-too-long',
        severity: pausedMinutes > SITUATION_THRESHOLDS.PAUSE_TOLERANCE_MINUTES * 2 ? 'P1' : 'P2',
        title: 'Execução pausada por tempo excessivo',
        detail: `Pausada há ${pausedMinutes} min (tolerância: ${SITUATION_THRESHOLDS.PAUSE_TOLERANCE_MINUTES} min).`,
        impact: 'Recurso alocado sem produção e SLA consumindo.',
        ownerRole: SITUATION_OWNER_ROLES.FieldSupervisor,
        nextBestAction: SITUATION_NEXT_BEST_ACTIONS.RESUME_EXECUTION,
        occurredAt: facts.pausedAt!,
        blocking: false,
      });
    }
  }

  // ── 5. RECURSO TROCADO ─────────────────────────────────────────────────────
  for (const code of facts.changedResourceCodes) {
    push({
      code: EXECUTION_SITUATION_CODES.RESOURCE_CHANGED,
      detectedKey: `changed:${code}`,
      severity: 'P3',
      title: 'Recurso executado difere do planejado',
      detail: `${code} não é o recurso reservado para esta ordem.`,
      impact: 'Custo e medição serão calculados sobre um recurso diferente do contratado.',
      ownerRole: SITUATION_OWNER_ROLES.FleetCoordinator,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.JUSTIFY_RESOURCE_CHANGE,
      occurredAt: at,
      blocking: false,
    });
  }

  // ── 6. USO DE RECURSO NÃO PLANEJADO ────────────────────────────────────────
  for (const code of facts.unplannedResourceCodes) {
    push({
      code: EXECUTION_SITUATION_CODES.UNPLANNED_RESOURCE_USAGE,
      detectedKey: `unplanned:${code}`,
      severity: 'P3',
      title: 'Uso de recurso não planejado',
      detail: `${code} foi usado sem constar do planejamento desta ordem.`,
      impact: 'Custo real sem cobertura de planejamento nem de reserva.',
      ownerRole: SITUATION_OWNER_ROLES.OperationsSupervisor,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.REVIEW_REQUIREMENTS,
      occurredAt: at,
      blocking: false,
    });
  }

  // ── 7. REALIZADO FALTANDO ──────────────────────────────────────────────────
  if (executed && facts.completedAt === null && facts.requiredActualsMissing.length > 0) {
    push({
      code: EXECUTION_SITUATION_CODES.MISSING_ACTUALS,
      detectedKey: [...facts.requiredActualsMissing].sort().join('|'),
      severity: 'P2',
      title: 'Dados reais de execução pendentes',
      detail: `Faltam: ${facts.requiredActualsMissing.join(', ')}.`,
      impact: 'A conclusão fica bloqueada e o custo real não pode ser apurado.',
      ownerRole: SITUATION_OWNER_ROLES.FieldSupervisor,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.REGISTER_MISSING_ACTUALS,
      occurredAt: at,
      blocking: true,
    });
  }

  // ── 8. EVIDÊNCIA FALTANDO ──────────────────────────────────────────────────
  if (executed && facts.requiredEvidenceMissing.length > 0) {
    push({
      code: EXECUTION_SITUATION_CODES.MISSING_EVIDENCE,
      detectedKey: [...facts.requiredEvidenceMissing].sort().join('|'),
      severity: 'P2',
      title: 'Evidência obrigatória ausente',
      detail: `Faltam: ${facts.requiredEvidenceMissing.join(', ')}.`,
      impact: 'A conclusão fica bloqueada e o serviço realizado não está comprovado.',
      ownerRole: SITUATION_OWNER_ROLES.FieldSupervisor,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.ATTACH_EVIDENCE,
      occurredAt: at,
      blocking: true,
    });
  }

  // ── 9. EVIDÊNCIA ANEXADA, NÃO VERIFICADA ──────────────────────────────────
  /**
   * Anexar não é aceitar. Esta situação existe para que uma evidência enviada e
   * nunca conferida não trave a conclusão em silêncio — o dono é o supervisor
   * porque a decisão de aceitar é dele.
   */
  if (executed && facts.evidenceNotVerified.length > 0) {
    const key = [...facts.evidenceNotVerified].sort().join('|');
    const persistedKey = `verify:${key}`;
    if (!openKeys.has(persistedKey)) {
      push({
        code: EXECUTION_SITUATION_CODES.MISSING_EVIDENCE,
        detectedKey: persistedKey,
        severity: 'P3',
        title: 'Evidência anexada aguardando verificação',
        detail: `Aguardando verificação: ${facts.evidenceNotVerified.join(', ')}.`,
        impact: 'A evidência existe, mas nenhuma decisão foi tomada sobre ela.',
        ownerRole: SITUATION_OWNER_ROLES.OperationsSupervisor,
        nextBestAction: SITUATION_NEXT_BEST_ACTIONS.ATTACH_EVIDENCE,
        occurredAt: at,
        blocking: false,
      });
    }
  }

  // ── 10. ANOMALIA DE MEDIDOR ────────────────────────────────────────────────
  if (facts.meterAnomalyCode) {
    push({
      code: EXECUTION_SITUATION_CODES.METER_ANOMALY,
      detectedKey: facts.meterAnomalyCode,
      severity: 'P2',
      title: 'Leitura de medidor incoerente',
      detail: `Anomalia: ${facts.meterAnomalyCode}.`,
      impact: 'Distância/horas reais ficam sem base confiável.',
      ownerRole: SITUATION_OWNER_ROLES.FleetCoordinator,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.REVIEW_METER,
      occurredAt: at,
      blocking: true,
    });
  }

  // ── 11. VARIAÇÃO DE COMBUSTÍVEL ────────────────────────────────────────────
  const fuelActual = facts.fuelActualLiters === null ? null : toNumber(facts.fuelActualLiters);
  const fuelPlanned = facts.fuelPlannedLiters === null ? null : toNumber(facts.fuelPlannedLiters);
  if (fuelActual !== null && fuelPlanned !== null && fuelPlanned > 0) {
    const deviation = (fuelActual - fuelPlanned) / fuelPlanned;
    if (Math.abs(deviation) > SITUATION_THRESHOLDS.FUEL_VARIANCE_TOLERANCE) {
      push({
        code: EXECUTION_SITUATION_CODES.FUEL_VARIANCE,
        detectedKey: 'fuel-variance',
        severity:
          Math.abs(deviation) > SITUATION_THRESHOLDS.FUEL_VARIANCE_TOLERANCE * 2 ? 'P2' : 'P3',
        title: 'Consumo de combustível fora da faixa',
        detail: `${fuelActual.toFixed(0)} L realizados contra ${fuelPlanned.toFixed(0)} L planejados (${deviation > 0 ? '+' : ''}${Math.round(deviation * 100)}%).`,
        impact: 'Custo real de combustível divergente do orçado.',
        ownerRole: SITUATION_OWNER_ROLES.FleetCoordinator,
        nextBestAction: SITUATION_NEXT_BEST_ACTIONS.REVIEW_FUEL,
        occurredAt: at,
        blocking: false,
      });
    }
  }

  // ── 12. CONCLUSÃO BLOQUEADA ────────────────────────────────────────────────
  if (facts.completionBlockedReasons.length > 0 && executed && facts.completedAt === null) {
    push({
      code: EXECUTION_SITUATION_CODES.EXECUTION_COMPLETION_BLOCKED,
      detectedKey: [...facts.completionBlockedReasons].sort().join('|'),
      severity: 'P2',
      title: 'Conclusão bloqueada',
      detail: `Motivos: ${facts.completionBlockedReasons.join(', ')}.`,
      impact: 'A ordem não avança para medição enquanto os dados não forem completados.',
      ownerRole: SITUATION_OWNER_ROLES.OperationsSupervisor,
      nextBestAction: SITUATION_NEXT_BEST_ACTIONS.REGISTER_MISSING_ACTUALS,
      occurredAt: at,
      blocking: true,
    });
  }

  // ── ORDENAÇÃO E RESOLUÇÃO ──────────────────────────────────────────────────
  const sorted = [...situations].sort((left, right) => {
    const bySeverity = SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const byBlocking = Number(right.blocking) - Number(left.blocking);
    if (byBlocking !== 0) {
      return byBlocking;
    }
    const byCode = left.code.localeCompare(right.code);
    if (byCode !== 0) {
      return byCode;
    }
    return left.detectedKey.localeCompare(right.detectedKey);
  });

  const detectedKeys = new Set(sorted.map((item) => item.detectedKey));
  const resolvableSituationIds = facts.persisted
    .filter((item) => item.status === 'OPEN' && !detectedKeys.has(item.detectedKey))
    .map((item) => item.id);

  return {
    situations: sorted,
    newSituations: sorted.filter((item) => !item.alreadyOpen),
    resolvableSituationIds,
    hasBlocking: sorted.some((item) => item.blocking),
  };
}

/** Ordena situações para exibição: severidade, depois bloqueio, depois código. */
export function compareSituations(left: DetectedSituation, right: DetectedSituation): number {
  const bySeverity = SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity];
  if (bySeverity !== 0) {
    return bySeverity;
  }
  return left.code.localeCompare(right.code);
}
