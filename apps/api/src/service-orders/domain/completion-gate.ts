/**
 * COMPLETION GATE — a conclusão da execução é um COMANDO, não um status.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Antes desta capability, "concluir" verificava uma coisa só: se as evidências
 * exigidas pelo snapshot do serviço estavam satisfeitas. Tudo o mais que uma
 * conclusão de execução precisa conferir não existia como dado:
 *
 *   - o odômetro final do veículo (sem ele não há distância real);
 *   - o combustível real (sem ele não há custo real, só estimativa);
 *   - as horas de mão de obra por pessoa (sem elas não há custo de mão de obra);
 *   - a assinatura do cliente quando o contrato exige;
 *   - situações de bloqueio abertas.
 *
 * Consequência medida: era possível concluir uma execução sem nenhum dado real, e
 * a medição e o custo eram produzidos sobre o planejado — sem que nada indicasse
 * que o realizado nunca foi capturado.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * O gate devolve, sempre:
 *
 *   - `canComplete`: a execução PODE ser concluída agora?
 *   - `blockingReasons`: TODOS os motivos (nunca só o primeiro), para que o
 *     operador resolva de uma vez em lugar de descobrir um por um;
 *   - `nextAction`: o comando que destrava;
 *   - `onCompletion`: o que VAI ACONTECER quando concluir.
 *
 * O último item não é enfeite: o operador está a um clique de congelar os
 * realizados e publicar a base de medição. Ele tem direito de saber disso ANTES, e
 * a explicação tem de vir do backend — não ser inventada na tela.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não conhece HTTP. Recebe fatos e
 * devolve a decisão. É função pura.
 */

import type { ServiceOrderStatus } from './service-order';
import { SERVICE_ORDER_STATUSES } from './service-order';
import {
  DISPATCH_BLOCK_REASONS,
  type DispatchBlockReason,
  type DispatchReadinessResource,
  type DispatchResolutionCode,
  DISPATCH_RESOLUTION_CODES,
  describeDispatchReason,
  describeDispatchResolution,
} from './dispatch-readiness';

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO FECHADO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Motivos de bloqueio da CONCLUSÃO.
 *
 * Prefixados com `COMPLETION_` quando existe o mesmo motivo no despacho, para que
 * dois códigos diferentes nunca sejam confundidos por quem lê log ou auditoria.
 */
export const COMPLETION_BLOCK_REASONS = {
  /** A execução não começou. */
  EXECUTION_NOT_STARTED: 'EXECUTION_NOT_STARTED',
  /** A ordem está cancelada. */
  EXECUTION_CANCELLED: 'EXECUTION_CANCELLED',
  /** Já concluída — a segunda conclusão é conflito, não sucesso silencioso. */
  EXECUTION_ALREADY_COMPLETED: 'EXECUTION_ALREADY_COMPLETED',
  /** Evidência exigida pelo serviço ausente. */
  REQUIRED_EVIDENCE_MISSING: 'REQUIRED_EVIDENCE_MISSING',
  /** Evidência anexada, mas não verificada por quem aceita. */
  EVIDENCE_NOT_VERIFIED: 'EVIDENCE_NOT_VERIFIED',
  /** Odômetro final do veículo não registrado. */
  FINAL_ODOMETER_REQUIRED: 'FINAL_ODOMETER_REQUIRED',
  /** Horímetro final do equipamento não registrado. */
  FINAL_HOUR_METER_REQUIRED: 'FINAL_HOUR_METER_REQUIRED',
  /** Combustível real não registrado. */
  FUEL_ACTUAL_REQUIRED: 'FUEL_ACTUAL_REQUIRED',
  /** Horas de mão de obra não registradas para toda a equipe escalada. */
  LABOR_ACTUAL_REQUIRED: 'LABOR_ACTUAL_REQUIRED',
  /** Horas de equipamento não registradas. */
  EQUIPMENT_ACTUAL_REQUIRED: 'EQUIPMENT_ACTUAL_REQUIRED',
  /** Material consumido não registrado onde o serviço exige. */
  MATERIAL_ACTUAL_REQUIRED: 'MATERIAL_ACTUAL_REQUIRED',
  /** Assinatura do cliente exigida pelo contrato e ausente. */
  CUSTOMER_SIGNATURE_REQUIRED: 'CUSTOMER_SIGNATURE_REQUIRED',
  /** Situação de bloqueio aberta. */
  BLOCKING_SITUATION_OPEN: 'BLOCKING_SITUATION_OPEN',
  /** Requisito de execução do catálogo não cumprido. */
  EXECUTION_REQUIREMENT_UNMET: 'EXECUTION_REQUIREMENT_UNMET',
  /** A ordem não está em execução (nem pausada). */
  NOT_IN_EXECUTION: 'NOT_IN_EXECUTION',
} as const;

export type CompletionBlockReason =
  (typeof COMPLETION_BLOCK_REASONS)[keyof typeof COMPLETION_BLOCK_REASONS];

/**
 * Ações de resolução da conclusão.
 *
 * Reaproveita o vocabulário do despacho onde a ação é literalmente a mesma
 * (`ATTACH_REQUIRED_DOCUMENT`, `RESOLVE_SITUATION`) e acrescenta o que é próprio
 * da conclusão. Duas listas livres seriam duas verdades.
 */
export const COMPLETION_RESOLUTION_CODES = {
  START_EXECUTION: 'START_EXECUTION',
  RESUME_EXECUTION: 'RESUME_EXECUTION',
  REGISTER_MISSING_ACTUALS: 'REGISTER_MISSING_ACTUALS',
  REGISTER_FINAL_METER: 'REGISTER_FINAL_METER',
  REGISTER_FUEL: 'REGISTER_FUEL',
  REGISTER_LABOR_HOURS: 'REGISTER_LABOR_HOURS',
  REGISTER_EQUIPMENT_HOURS: 'REGISTER_EQUIPMENT_HOURS',
  REGISTER_MATERIAL_USAGE: 'REGISTER_MATERIAL_USAGE',
  ATTACH_EVIDENCE: 'ATTACH_EVIDENCE',
  VERIFY_EVIDENCE: 'VERIFY_EVIDENCE',
  REGISTER_SIGNATURE: 'REGISTER_SIGNATURE',
  RESOLVE_SITUATION: 'RESOLVE_SITUATION',
  REVIEW_EXECUTION_REQUIREMENTS: 'REVIEW_EXECUTION_REQUIREMENTS',
  OPEN_SERVICE_ORDER: 'OPEN_SERVICE_ORDER',
} as const;

export type CompletionResolutionCode =
  (typeof COMPLETION_RESOLUTION_CODES)[keyof typeof COMPLETION_RESOLUTION_CODES];

/** Um bloqueio da conclusão, com motivo, recurso e saída. */
export type CompletionBlocker = {
  reasonCode: CompletionBlockReason;
  reason: string;
  /** Recurso específico que falta (veículo, pessoa, documento), quando aplicável. */
  resource: DispatchReadinessResource | null;
  /** O que exatamente falta, em termos do domínio (ex.: `MOPP`, `PHOTO`). */
  missingCode: string | null;
  resolution: CompletionResolutionCode;
  resolutionLabel: string;
};

/**
 * O que o comando COMPLETE PRODUZ.
 *
 * Derivado do domínio e devolvido ao frontend para ser MOSTRADO — não recalculado
 * na tela. Cada item é um efeito real e verificável do comando.
 */
export type CompletionConsequence = {
  code:
    | 'ACTUALS_FROZEN'
    | 'MEASUREMENT_BASIS_CREATED'
    | 'COSTING_FACTS_PUBLISHED'
    | 'RESOURCES_RELEASED'
    | 'SITUATIONS_RESOLVED'
    | 'PROCESS_ADVANCED_TO_MEASUREMENT';
  label: string;
};

/** Resultado do gate. */
export type CompletionGate = {
  canComplete: boolean;
  /** Motivos na ordem de resolução: primeiro o que impede de começar a conferir. */
  blockingReasons: CompletionBlocker[];
  /** Comando que destrava. `null` quando `canComplete`. */
  nextAction: CompletionResolutionCode | null;
  nextActionLabel: string | null;
  /** Consequências REAIS da conclusão. */
  consequences: CompletionConsequence[];
  /** Explicação curta pronta para o operador. */
  summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEXTO DERIVADO DO MOTIVO
// ═══════════════════════════════════════════════════════════════════════════════

const COMPLETION_REASON_TEXT: Record<CompletionBlockReason, string> = {
  [COMPLETION_BLOCK_REASONS.EXECUTION_NOT_STARTED]:
    'A execução não foi iniciada; não há realizado para concluir.',
  [COMPLETION_BLOCK_REASONS.EXECUTION_CANCELLED]: 'A ordem está cancelada.',
  [COMPLETION_BLOCK_REASONS.EXECUTION_ALREADY_COMPLETED]: 'A execução já foi concluída.',
  [COMPLETION_BLOCK_REASONS.REQUIRED_EVIDENCE_MISSING]:
    'Uma evidência exigida pelo serviço não foi anexada.',
  [COMPLETION_BLOCK_REASONS.EVIDENCE_NOT_VERIFIED]:
    'Uma evidência anexada ainda não foi verificada.',
  [COMPLETION_BLOCK_REASONS.FINAL_ODOMETER_REQUIRED]:
    'A leitura final do odômetro do veículo não foi registrada.',
  [COMPLETION_BLOCK_REASONS.FINAL_HOUR_METER_REQUIRED]:
    'A leitura final do horímetro do equipamento não foi registrada.',
  [COMPLETION_BLOCK_REASONS.FUEL_ACTUAL_REQUIRED]:
    'O combustível real consumido não foi registrado.',
  [COMPLETION_BLOCK_REASONS.LABOR_ACTUAL_REQUIRED]:
    'As horas reais de mão de obra não foram registradas para toda a equipe.',
  [COMPLETION_BLOCK_REASONS.EQUIPMENT_ACTUAL_REQUIRED]:
    'As horas reais de equipamento não foram registradas.',
  [COMPLETION_BLOCK_REASONS.MATERIAL_ACTUAL_REQUIRED]: 'O material consumido não foi registrado.',
  [COMPLETION_BLOCK_REASONS.CUSTOMER_SIGNATURE_REQUIRED]:
    'A assinatura do cliente é exigida pelo contrato e não foi registrada.',
  [COMPLETION_BLOCK_REASONS.BLOCKING_SITUATION_OPEN]:
    'Existe uma situação de bloqueio aberta sobre a execução.',
  [COMPLETION_BLOCK_REASONS.EXECUTION_REQUIREMENT_UNMET]:
    'Um requisito de execução do catálogo não foi cumprido.',
  [COMPLETION_BLOCK_REASONS.NOT_IN_EXECUTION]: 'A ordem não está em execução nem pausada.',
};

const COMPLETION_RESOLUTION_TEXT: Record<CompletionResolutionCode, string> = {
  [COMPLETION_RESOLUTION_CODES.START_EXECUTION]: 'Iniciar a execução',
  [COMPLETION_RESOLUTION_CODES.RESUME_EXECUTION]: 'Retomar a execução',
  [COMPLETION_RESOLUTION_CODES.REGISTER_MISSING_ACTUALS]: 'Registrar os dados finais',
  [COMPLETION_RESOLUTION_CODES.REGISTER_FINAL_METER]: 'Registrar a leitura final do medidor',
  [COMPLETION_RESOLUTION_CODES.REGISTER_FUEL]: 'Registrar o combustível',
  [COMPLETION_RESOLUTION_CODES.REGISTER_LABOR_HOURS]: 'Registrar as horas de mão de obra',
  [COMPLETION_RESOLUTION_CODES.REGISTER_EQUIPMENT_HOURS]: 'Registrar as horas de equipamento',
  [COMPLETION_RESOLUTION_CODES.REGISTER_MATERIAL_USAGE]: 'Registrar o material consumido',
  [COMPLETION_RESOLUTION_CODES.ATTACH_EVIDENCE]: 'Anexar a evidência',
  [COMPLETION_RESOLUTION_CODES.VERIFY_EVIDENCE]: 'Verificar a evidência',
  [COMPLETION_RESOLUTION_CODES.REGISTER_SIGNATURE]: 'Registrar a assinatura do cliente',
  [COMPLETION_RESOLUTION_CODES.RESOLVE_SITUATION]: 'Resolver a situação',
  [COMPLETION_RESOLUTION_CODES.REVIEW_EXECUTION_REQUIREMENTS]: 'Revisar os requisitos de execução',
  [COMPLETION_RESOLUTION_CODES.OPEN_SERVICE_ORDER]: 'Abrir a ordem de serviço',
};

export function describeCompletionReason(reason: CompletionBlockReason): string {
  return COMPLETION_REASON_TEXT[reason];
}

export function describeCompletionResolution(resolution: CompletionResolutionCode): string {
  return COMPLETION_RESOLUTION_TEXT[resolution];
}

/**
 * CONSEQUÊNCIAS DA CONCLUSÃO.
 *
 * Exportado e usado tanto pelo gate quanto pelo read model da object page: a
 * explicação apresentada ao operador e o efeito executado pela transação são a
 * MESMA declaração. Se um dia a conclusão deixar de produzir um destes efeitos, a
 * lista muda aqui e as duas superfícies mudam juntas.
 */
export const COMPLETION_CONSEQUENCES: readonly CompletionConsequence[] = [
  { code: 'ACTUALS_FROZEN', label: 'Os dados reais de execução serão congelados.' },
  {
    code: 'MEASUREMENT_BASIS_CREATED',
    label: 'A base de medição será produzida a partir do realizado.',
  },
  { code: 'COSTING_FACTS_PUBLISHED', label: 'O custeio receberá os fatos reais de execução.' },
  { code: 'RESOURCES_RELEASED', label: 'Os recursos reservados serão liberados.' },
  { code: 'SITUATIONS_RESOLVED', label: 'As situações de execução serão encerradas.' },
  {
    code: 'PROCESS_ADVANCED_TO_MEASUREMENT',
    label: 'O processo avançará para medição.',
  },
] as const;

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/** Requisito de evidência declarado pelo serviço. */
export type CompletionEvidenceRequirementFacts = {
  evidenceKind: string;
  requirementLevel: 'REQUIRED' | 'DESIRED' | 'OPTIONAL';
  /** `true` quando existe evidência ANEXADA satisfazendo o tipo. */
  attached: boolean;
  /** `true` quando existe evidência VERIFICADA satisfazendo o tipo. */
  verified: boolean;
};

/** Realizado agregado por tipo, já persistido. */
export type CompletionActualsFacts = {
  /** Odômetro final registrado (qualquer veículo escalado). */
  finalOdometerRecorded: boolean;
  /** Horímetro final registrado. */
  finalHourMeterRecorded: boolean;
  /** Volume de combustível real registrado. */
  fuelRecorded: boolean;
  /** Horas de mão de obra registradas, por pessoa escalada. */
  laborHoursByMember: Array<{ workforceMemberId: string; hours: string | null }>;
  /** Horas de equipamento registradas. */
  equipmentHoursRecorded: boolean;
  /** Material consumido registrado. */
  materialRecorded: boolean;
  /** Quantidade medida registrada. */
  measuredQuantityRecorded: boolean;
};

export type CompletionSituationFacts = {
  code: string;
  title: string;
  blocking: boolean;
};

/** Exigências derivadas do snapshot/contrato — nunca inventadas pelo gate. */
export type CompletionRequirements = {
  /** O serviço exige leitura final de odômetro. */
  requiresFinalOdometer: boolean;
  /** O serviço exige leitura final de horímetro. */
  requiresFinalHourMeter: boolean;
  /** O serviço exige combustível real. */
  requiresFuel: boolean;
  /** O serviço exige horas de mão de obra por pessoa. */
  requiresLaborHours: boolean;
  /** O serviço exige horas de equipamento. */
  requiresEquipmentHours: boolean;
  /** O serviço exige material consumido. */
  requiresMaterial: boolean;
  /** O contrato exige assinatura do cliente. */
  requiresCustomerSignature: boolean;
  /** Quantidade medida é obrigatória (modelo de medição por quantidade). */
  requiresMeasuredQuantity: boolean;
};

export type CompletionSignatureFacts = {
  /** Existe assinatura registrada. */
  registered: boolean;
  signerName: string | null;
  signedAt: string | null;
};

export type CompletionFacts = {
  serviceOrderId: string;
  status: ServiceOrderStatus;
  requirements: CompletionRequirements;
  evidence: CompletionEvidenceRequirementFacts[];
  actuals: CompletionActualsFacts;
  signature: CompletionSignatureFacts;
  situations: CompletionSituationFacts[];
  /** Pessoas escaladas — para exigir horas de mão de obra de cada uma. */
  assignedWorkforceMemberIds: string[];
  /** Recursos escalados, para nomear o culpado no bloqueio. */
  resources: {
    vehicles: DispatchReadinessResource[];
    equipment: DispatchReadinessResource[];
  };
};

// ═══════════════════════════════════════════════════════════════════════════════
// AVALIAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function blocker(
  reasonCode: CompletionBlockReason,
  resolution: CompletionResolutionCode,
  extra: Partial<Pick<CompletionBlocker, 'resource' | 'missingCode'>> = {},
): CompletionBlocker {
  return {
    reasonCode,
    reason: describeCompletionReason(reasonCode),
    resource: extra.resource ?? null,
    missingCode: extra.missingCode ?? null,
    resolution,
    resolutionLabel: describeCompletionResolution(resolution),
  };
}

/**
 * Avalia se a execução pode ser concluída.
 *
 * A ordem dos motivos é a ordem em que o operador precisa agir: primeiro o estado
 * (não iniciada / cancelada / já concluída), depois quem está faltando, depois os
 * valores reais que faltam, depois evidência, assinatura e situações.
 *
 * TODOS os motivos são devolvidos. Devolver apenas o primeiro faria o operador
 * descobrir os bloqueios um por um, recarregando a tela a cada tentativa.
 */
export function evaluateCompletionGate(facts: CompletionFacts): CompletionGate {
  const reasons: CompletionBlocker[] = [];

  // ── 1. Estado da execução ───────────────────────────────────────────────────
  if (facts.status === SERVICE_ORDER_STATUSES.Cancelled) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.EXECUTION_CANCELLED,
        COMPLETION_RESOLUTION_CODES.OPEN_SERVICE_ORDER,
      ),
    );
    return {
      canComplete: false,
      blockingReasons: reasons,
      nextAction: reasons[0]!.resolution,
      nextActionLabel: reasons[0]!.resolutionLabel,
      consequences: [...COMPLETION_CONSEQUENCES],
      summary: reasons[0]!.reason,
    };
  }

  if (facts.status === SERVICE_ORDER_STATUSES.Completed) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.EXECUTION_ALREADY_COMPLETED,
        COMPLETION_RESOLUTION_CODES.OPEN_SERVICE_ORDER,
      ),
    );
    return {
      canComplete: false,
      blockingReasons: reasons,
      nextAction: reasons[0]!.resolution,
      nextActionLabel: reasons[0]!.resolutionLabel,
      consequences: [...COMPLETION_CONSEQUENCES],
      summary: reasons[0]!.reason,
    };
  }

  if (
    facts.status === SERVICE_ORDER_STATUSES.Draft ||
    facts.status === SERVICE_ORDER_STATUSES.Prepared ||
    facts.status === SERVICE_ORDER_STATUSES.Released
  ) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.EXECUTION_NOT_STARTED,
        facts.status === SERVICE_ORDER_STATUSES.Released
          ? COMPLETION_RESOLUTION_CODES.START_EXECUTION
          : COMPLETION_RESOLUTION_CODES.OPEN_SERVICE_ORDER,
      ),
    );
    // Não há mais nada a conferir: sem execução, não há realizado.
    return {
      canComplete: false,
      blockingReasons: reasons,
      nextAction: reasons[0]!.resolution,
      nextActionLabel: reasons[0]!.resolutionLabel,
      consequences: [...COMPLETION_CONSEQUENCES],
      summary: reasons[0]!.reason,
    };
  }

  if (facts.status !== SERVICE_ORDER_STATUSES.InExecution) {
    // `PAUSED`: é possível concluir? Não — concluir durante pausa esconderia tempo
    // que ninguém mediu. A saída é retomar.
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.NOT_IN_EXECUTION,
        COMPLETION_RESOLUTION_CODES.RESUME_EXECUTION,
      ),
    );
    return {
      canComplete: false,
      blockingReasons: reasons,
      nextAction: reasons[0]!.resolution,
      nextActionLabel: reasons[0]!.resolutionLabel,
      consequences: [...COMPLETION_CONSEQUENCES],
      summary: reasons[0]!.reason,
    };
  }

  // ── 2. Medidor final ────────────────────────────────────────────────────────
  if (facts.requirements.requiresFinalOdometer && !facts.actuals.finalOdometerRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.FINAL_ODOMETER_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_FINAL_METER,
        { missingCode: 'ODOMETER', resource: facts.resources.vehicles[0] ?? null },
      ),
    );
  }

  if (facts.requirements.requiresFinalHourMeter && !facts.actuals.finalHourMeterRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.FINAL_HOUR_METER_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_FINAL_METER,
        { missingCode: 'HOUR_METER', resource: facts.resources.equipment[0] ?? null },
      ),
    );
  }

  // ── 3. Combustível ──────────────────────────────────────────────────────────
  if (facts.requirements.requiresFuel && !facts.actuals.fuelRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.FUEL_ACTUAL_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_FUEL,
        { missingCode: 'FUEL_VOLUME', resource: facts.resources.vehicles[0] ?? null },
      ),
    );
  }

  // ── 4. Mão de obra por pessoa ───────────────────────────────────────────────
  if (facts.requirements.requiresLaborHours) {
    const registered = new Map<string, boolean>();
    for (const entry of facts.actuals.laborHoursByMember) {
      const hours = Number(entry.hours ?? '0');
      if (Number.isFinite(hours) && hours > 0) {
        registered.set(entry.workforceMemberId, true);
      }
    }
    const missing = facts.assignedWorkforceMemberIds.filter((id) => !registered.has(id));
    if (missing.length > 0) {
      reasons.push(
        blocker(
          COMPLETION_BLOCK_REASONS.LABOR_ACTUAL_REQUIRED,
          COMPLETION_RESOLUTION_CODES.REGISTER_LABOR_HOURS,
          { missingCode: 'LABOR_HOURS' },
        ),
      );
    }
  }

  // ── 5. Equipamento ──────────────────────────────────────────────────────────
  if (facts.requirements.requiresEquipmentHours && !facts.actuals.equipmentHoursRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.EQUIPMENT_ACTUAL_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_EQUIPMENT_HOURS,
        { missingCode: 'EQUIPMENT_HOURS', resource: facts.resources.equipment[0] ?? null },
      ),
    );
  }

  // ── 6. Material ─────────────────────────────────────────────────────────────
  if (facts.requirements.requiresMaterial && !facts.actuals.materialRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.MATERIAL_ACTUAL_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_MATERIAL_USAGE,
        { missingCode: 'MATERIAL_QUANTITY' },
      ),
    );
  }

  // ── 7. Quantidade medida ────────────────────────────────────────────────────
  if (facts.requirements.requiresMeasuredQuantity && !facts.actuals.measuredQuantityRecorded) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.EXECUTION_REQUIREMENT_UNMET,
        COMPLETION_RESOLUTION_CODES.REVIEW_EXECUTION_REQUIREMENTS,
        { missingCode: 'MEASURED_QUANTITY' },
      ),
    );
  }

  // ── 8. Evidência exigida ────────────────────────────────────────────────────
  for (const requirement of facts.evidence) {
    if (requirement.requirementLevel !== 'REQUIRED') {
      continue;
    }
    if (!requirement.attached) {
      reasons.push(
        blocker(
          COMPLETION_BLOCK_REASONS.REQUIRED_EVIDENCE_MISSING,
          COMPLETION_RESOLUTION_CODES.ATTACH_EVIDENCE,
          { missingCode: requirement.evidenceKind },
        ),
      );
    } else if (!requirement.verified) {
      reasons.push(
        blocker(
          COMPLETION_BLOCK_REASONS.EVIDENCE_NOT_VERIFIED,
          COMPLETION_RESOLUTION_CODES.VERIFY_EVIDENCE,
          { missingCode: requirement.evidenceKind },
        ),
      );
    }
  }

  // ── 9. Assinatura do cliente ────────────────────────────────────────────────
  if (facts.requirements.requiresCustomerSignature && !facts.signature.registered) {
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.CUSTOMER_SIGNATURE_REQUIRED,
        COMPLETION_RESOLUTION_CODES.REGISTER_SIGNATURE,
        { missingCode: 'CUSTOMER_SIGNATURE' },
      ),
    );
  }

  // ── 10. Situações abertas ───────────────────────────────────────────────────
  for (const situation of facts.situations) {
    if (!situation.blocking) {
      continue;
    }
    reasons.push(
      blocker(
        COMPLETION_BLOCK_REASONS.BLOCKING_SITUATION_OPEN,
        COMPLETION_RESOLUTION_CODES.RESOLVE_SITUATION,
        {
          missingCode: situation.code,
          resource: {
            id: situation.code,
            code: situation.code,
            kind: 'DOCUMENT',
            label: situation.title,
          },
        },
      ),
    );
  }

  const canComplete = reasons.length === 0;
  const first = reasons[0] ?? null;

  return {
    canComplete,
    blockingReasons: reasons,
    nextAction: first?.resolution ?? null,
    nextActionLabel: first?.resolutionLabel ?? null,
    consequences: [...COMPLETION_CONSEQUENCES],
    summary: canComplete
      ? 'Pronto para concluir: todos os requisitos de execução estão atendidos.'
      : reasons.length === 1
        ? `Conclusão bloqueada: ${first!.reason}`
        : `Conclusão bloqueada por ${reasons.length} motivos: ${reasons
            .map((item) => item.reasonCode)
            .join(', ')}`,
  };
}

/** Traduz um motivo de despacho para o motivo de conclusão equivalente. */
export function toCompletionReasonFromDispatch(
  reason: DispatchBlockReason,
): CompletionBlockReason | null {
  switch (reason) {
    case DISPATCH_BLOCK_REASONS.BLOCKING_SITUATION_OPEN:
      return COMPLETION_BLOCK_REASONS.BLOCKING_SITUATION_OPEN;
    case DISPATCH_BLOCK_REASONS.REQUIRED_DOCUMENT_MISSING:
      return COMPLETION_BLOCK_REASONS.REQUIRED_EVIDENCE_MISSING;
    default:
      return null;
  }
}

/** Reexportado para que o consumidor tenha UM ponto de leitura de rótulos. */
export { describeDispatchReason, describeDispatchResolution, DISPATCH_RESOLUTION_CODES };
export type { DispatchResolutionCode };
