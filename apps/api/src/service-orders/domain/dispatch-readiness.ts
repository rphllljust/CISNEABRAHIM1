/**
 * DISPATCH READINESS — o backend decide se a ordem pode SAIR, e diz POR QUÊ.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Antes desta capability, "pode despachar?" não existia no sistema. O operador via
 * a OS em `RELEASED` e a única informação disponível era o status. As consequências
 * reais disso:
 *
 *   - o despacho era uma mudança de status, então a ordem saía sem que ninguém
 *     tivesse confirmado que o motorista tinha o MOPP válido;
 *   - quando a ordem saía errada, o motivo do bloqueio nunca tinha existido como
 *     dado, e a correção virava conversa;
 *   - o frontend, sem nada para mostrar, calculava sozinho o que faltava — uma
 *     segunda state machine que podia divergir da real.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A REGRA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada DIMENSÃO responde três perguntas, sempre na mesma ordem:
 *
 *   1. QUAL é o estado? (`READY` / `BLOCKED` / `WARNING` / `NOT_APPLICABLE`)
 *   2. POR QUE? (um código fechado, nunca um texto livre)
 *   3. O QUE FAZ DESTRAVAR? (`resolution.code`)
 *
 * A prontidão AGREGADA é BLOCKED se qualquer dimensão aplicável for BLOCKED.
 * `WARNING` não impede o despacho: é informação para o operador decidir de olho
 * aberto. Isso é deliberado — transformar aviso em bloqueio faria o sistema mentir
 * sobre o que é necessário, e bloquear por precaução genérica é como um gate perde
 * a credibilidade.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não conhece HTTP. Ele recebe FATOS
 * (`DispatchFacts`) coletados pela camada de aplicação e devolve a decisão. É
 * função pura: a mesma entrada produz sempre a mesma saída, e é por isso que ela é
 * testável sem infraestrutura.
 */

import type { ServiceOrderStatus } from './service-order';
import { SERVICE_ORDER_STATUSES } from './service-order';

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO FECHADO
// ═══════════════════════════════════════════════════════════════════════════════

/** Dimensões avaliadas. A ordem é a de leitura do operador: do processo ao risco. */
export const DISPATCH_READINESS_DIMENSIONS = [
  'PLANNING',
  'RESERVATION',
  'CREW',
  'DRIVER',
  'VEHICLE',
  'EQUIPMENT',
  'QUALIFICATION',
  'MAINTENANCE',
  'DOCUMENTS',
  'OPERATIONAL_WINDOW',
  'SLA',
  'EVIDENCE_REQUIREMENTS',
  'CONTRACT_RESTRICTIONS',
] as const;

export type DispatchReadinessDimension = (typeof DISPATCH_READINESS_DIMENSIONS)[number];

export const DISPATCH_READINESS_STATUSES = {
  Ready: 'READY',
  Blocked: 'BLOCKED',
  Warning: 'WARNING',
  NotApplicable: 'NOT_APPLICABLE',
} as const;

export type DispatchReadinessStatus =
  (typeof DISPATCH_READINESS_STATUSES)[keyof typeof DISPATCH_READINESS_STATUSES];

/**
 * Motivos de bloqueio. Fechados de propósito: um motivo novo é uma decisão de
 * domínio registrada, não uma string montada em tempo de execução.
 */
export const DISPATCH_BLOCK_REASONS = {
  /** Planejamento inexistente ou ainda não confirmado. */
  PLANNING_NOT_CONFIRMED: 'PLANNING_NOT_CONFIRMED',
  /** Requisito obrigatório do serviço sem recurso planejado suficiente. */
  MINIMUM_RESOURCES_NOT_PLANNED: 'MINIMUM_RESOURCES_NOT_PLANNED',
  /** Requisito de mão de obra obrigatório sem quantidade planejada. */
  MINIMUM_LABOR_NOT_PLANNED: 'MINIMUM_LABOR_NOT_PLANNED',
  /** Nenhuma alocação nominal ativa: existe plano, não existe gente/ativo. */
  RESERVATION_MISSING: 'RESERVATION_MISSING',
  /** Alocação ativa cobre janela diferente da acordada. */
  RESERVATION_WINDOW_MISMATCH: 'RESERVATION_WINDOW_MISMATCH',
  /** Alocação ativa aponta para recurso inativo. */
  RESERVATION_RESOURCE_INACTIVE: 'RESERVATION_RESOURCE_INACTIVE',
  /** Nenhuma pessoa escalada. */
  CREW_NOT_CONFIRMED: 'CREW_NOT_CONFIRMED',
  /** Nenhum condutor habilitado escalado onde o serviço exige. */
  DRIVER_NOT_ASSIGNED: 'DRIVER_NOT_ASSIGNED',
  /** Condutor escalado está inativo. */
  DRIVER_INACTIVE: 'DRIVER_INACTIVE',
  /** Habilitação do condutor vencida. */
  QUALIFICATION_EXPIRED: 'QUALIFICATION_EXPIRED',
  /** Habilitação exigida pelo serviço ausente para o condutor. */
  QUALIFICATION_MISSING: 'QUALIFICATION_MISSING',
  /** Nenhum veículo escalado onde o serviço exige. */
  VEHICLE_NOT_ASSIGNED: 'VEHICLE_NOT_ASSIGNED',
  /** Veículo escalado indisponível/inativo/maintenance. */
  VEHICLE_UNAVAILABLE: 'VEHICLE_UNAVAILABLE',
  /** Equipamento exigido pelo serviço não escalado. */
  EQUIPMENT_NOT_ASSIGNED: 'EQUIPMENT_NOT_ASSIGNED',
  /** Equipamento escalado indisponível. */
  EQUIPMENT_UNAVAILABLE: 'EQUIPMENT_UNAVAILABLE',
  /** Ativo escalado em manutenção aberta. */
  MAINTENANCE_OPEN: 'MAINTENANCE_OPEN',
  /** Documento obrigatório do contrato/cliente ausente. */
  REQUIRED_DOCUMENT_MISSING: 'REQUIRED_DOCUMENT_MISSING',
  /** Janela operacional não definida. */
  OPERATIONAL_WINDOW_MISSING: 'OPERATIONAL_WINDOW_MISSING',
  /** Janela operacional já encerrada. */
  OPERATIONAL_WINDOW_EXPIRED: 'OPERATIONAL_WINDOW_EXPIRED',
  /** Prazo de atendimento (SLA) já vencido antes do despacho. */
  SLA_ALREADY_BREACHED: 'SLA_ALREADY_BREACHED',
  /** Situação de bloqueio aberta sobre a ordem. */
  BLOCKING_SITUATION_OPEN: 'BLOCKING_SITUATION_OPEN',
  /** Restrição contratual que proíbe o despacho neste estado. */
  CONTRACT_RESTRICTION: 'CONTRACT_RESTRICTION',
} as const;

export type DispatchBlockReason =
  (typeof DISPATCH_BLOCK_REASONS)[keyof typeof DISPATCH_BLOCK_REASONS];

/** Ações de resolução. Cada bloqueio aponta UMA ação — a que realmente destrava. */
export const DISPATCH_RESOLUTION_CODES = {
  CONFIRM_PLANNING: 'CONFIRM_PLANNING',
  COMPLETE_PLANNED_RESOURCES: 'COMPLETE_PLANNED_RESOURCES',
  RESERVE_RESOURCES: 'RESERVE_RESOURCES',
  ADJUST_RESERVATION_WINDOW: 'ADJUST_RESERVATION_WINDOW',
  REPLACE_INACTIVE_RESOURCE: 'REPLACE_INACTIVE_RESOURCE',
  ASSIGN_CREW: 'ASSIGN_CREW',
  ASSIGN_DRIVER: 'ASSIGN_DRIVER',
  REASSIGN_DRIVER: 'REASSIGN_DRIVER',
  REGISTER_QUALIFICATION: 'REGISTER_QUALIFICATION',
  ASSIGN_VEHICLE: 'ASSIGN_VEHICLE',
  REASSIGN_VEHICLE: 'REASSIGN_VEHICLE',
  ASSIGN_EQUIPMENT: 'ASSIGN_EQUIPMENT',
  REASSIGN_EQUIPMENT: 'REASSIGN_EQUIPMENT',
  CLOSE_MAINTENANCE: 'CLOSE_MAINTENANCE',
  ATTACH_REQUIRED_DOCUMENT: 'ATTACH_REQUIRED_DOCUMENT',
  DEFINE_OPERATIONAL_WINDOW: 'DEFINE_OPERATIONAL_WINDOW',
  RESCHEDULE_WINDOW: 'RESCHEDULE_WINDOW',
  ESCALATE: 'ESCALATE',
  RESOLVE_SITUATION: 'RESOLVE_SITUATION',
  REVIEW_CONTRACT: 'REVIEW_CONTRACT',
} as const;

export type DispatchResolutionCode =
  (typeof DISPATCH_RESOLUTION_CODES)[keyof typeof DISPATCH_RESOLUTION_CODES];

/** Recurso concreto citado pela dimensão quando existe um. */
export type DispatchReadinessResource = {
  /** Identificador do objeto no domínio dono (ativo, pessoa, documento). */
  id: string;
  /** Código humano — placa, matrícula, número do documento. Nunca um uuid solto. */
  code: string;
  kind: 'PHYSICAL_ASSET' | 'WORKFORCE_MEMBER' | 'DOCUMENT' | 'QUALIFICATION';
  /** Rótulo para o operador quando `code` não basta. */
  label: string | null;
};

/** Uma dimensão avaliada, com o motivo e a saída já resolvidos. */
export type DispatchReadinessDimensionResult = {
  dimension: DispatchReadinessDimension;
  status: DispatchReadinessStatus;
  /** Código fechado do motivo. `null` quando `status` é READY/NOT_APPLICABLE. */
  reasonCode: DispatchBlockReason | null;
  /** Explicação legível derivada do motivo — nunca inventada por dimensão. */
  reason: string | null;
  /** Recurso culpado, quando a dimensão aponta um. */
  resource: DispatchReadinessResource | null;
  /** Qualificação envolvida (ex.: `MOPP`), quando aplicável. */
  qualificationCode: string | null;
  /** Data relevante (vencimento, fim de janela), quando aplicável. */
  dueAt: string | null;
  /** A ação que destrava. `null` só quando `status` é READY/NOT_APPLICABLE. */
  resolution: DispatchResolutionCode | null;
};

/** Resultado completo da avaliação. */
export type DispatchReadiness = {
  /** Decisão agregada: o despacho PODE acontecer? */
  ready: boolean;
  /** Pior status entre as dimensões aplicáveis. */
  status: DispatchReadinessStatus;
  /** Dimensões BLOCKED, na ordem canônica. */
  blockingReasons: DispatchReadinessDimensionResult[];
  /** Dimensões WARNING: informam, não impedem. */
  warnings: DispatchReadinessDimensionResult[];
  /** Todas as dimensões avaliadas, incluindo as NÃO aplicáveis. */
  dimensions: DispatchReadinessDimensionResult[];
  /** Próxima ação derivada: a resolução do primeiro bloqueio, ou `null`. */
  nextAction: DispatchResolutionCode | null;
  /** Explicação curta e completa, pronta para o operador. */
  summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/** Requisito do serviço (do snapshot publicado no momento da criação da OS). */
export type DispatchRequirementFacts = {
  requirementKind: 'PHYSICAL_RESOURCE' | 'LABOR';
  /** Tipo exigido quando `PHYSICAL_RESOURCE`. */
  resourceTypeCode: string | null;
  /** Função exigida quando `LABOR`. */
  laborTypeCode: string | null;
  requirementLevel: 'REQUIRED' | 'DESIRED' | 'OPTIONAL';
  minQuantity: string;
};

/** Linha de recurso planejado (`so.planned_resources`). */
export type DispatchPlannedResourceFacts = {
  id: string;
  requirementKind: string;
  resourceTypeCode: string | null;
  laborTypeCode: string | null;
  plannedQuantity: string;
  operationalStart: string | null;
  operationalEnd: string | null;
  status: string;
};

/** Alocação nominal (`res.resource_allocations`), já enriquecida pelo repositório. */
export type DispatchAllocationFacts = {
  id: string;
  resourceTypeCode: string;
  operationalStart: string;
  operationalEnd: string;
  status: string;
  /** Natureza do recurso alocado. */
  resourceKind: 'PHYSICAL_ASSET' | 'WORKFORCE_MEMBER';
  /** Código humano do ativo/pessoa. */
  resourceCode: string;
  resourceLabel: string | null;
  /** `false` quando o ativo/pessoa está inativo ou indisponível. */
  resourceActive: boolean;
  /** `true` quando o ativo está em manutenção aberta. `null` = DESCONHECIDO. */
  underMaintenance: boolean | null;
  /** `true` quando o serviço exige condutor para este recurso. */
  requiresDriver: boolean;
  /** Habilitações do condutor (vazio para não-condutores). */
  qualifications: DispatchQualificationFacts[];
};

export type DispatchQualificationFacts = {
  code: string;
  expiresAt: string | null;
};

export type DispatchDocumentRequirementFacts = {
  code: string;
  label: string;
  satisfied: boolean;
  /** Documento encontrado, quando satisfeito. */
  documentId: string | null;
};

export type DispatchSituationFacts = {
  code: string;
  severity: string;
  title: string;
  /** `true` quando a situação IMPEDE o despacho. */
  blocking: boolean;
};

/** Avaliação de SLA no instante do despacho. */
export type DispatchSlaFacts = {
  /** Prazo de atendimento publicado. `null` quando o serviço não tem prazo. */
  dueAt: string | null;
  /** Instante de referência da avaliação (relógio da aplicação). */
  at: string;
};

/** Restrição contratual declarada e verificável. */
export type DispatchContractRestrictionFacts = {
  code: string;
  label: string;
  /** `true` quando a restrição AINDA se aplica e impede o despacho. */
  active: boolean;
};

/** Tudo o que a avaliação precisa. Coletado pela camada de aplicação. */
export type DispatchFacts = {
  serviceOrderId: string;
  status: ServiceOrderStatus;
  requirements: DispatchRequirementFacts[];
  plannedResources: DispatchPlannedResourceFacts[];
  allocations: DispatchAllocationFacts[];
  /** Janela operacional acordada. `null` quando não definida. */
  operationalWindow: { startAt: string; endAt: string } | null;
  sla: DispatchSlaFacts;
  documents: DispatchDocumentRequirementFacts[];
  situations: DispatchSituationFacts[];
  contractRestrictions: DispatchContractRestrictionFacts[];
  /**
   * O serviço exige deslocamento com condutor? Derivado do catálogo
   * (tipo de recurso veicular + requisito de condutor). Sem isso, a dimensão
   * DRIVER seria NÃO aplicável — e é assim que deve ser para serviço de balcão.
   */
  requiresDriver: boolean;
  /** O serviço exige veículo? */
  requiresVehicle: boolean;
  /** O serviço exige equipamento (além de veículo)? */
  requiresEquipment: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TEXTO DERIVADO DO MOTIVO — um mapa, não uma condição por dimensão
// ═══════════════════════════════════════════════════════════════════════════════

const REASON_TEXT: Record<DispatchBlockReason, string> = {
  [DISPATCH_BLOCK_REASONS.PLANNING_NOT_CONFIRMED]: 'O planejamento da ordem não está confirmado.',
  [DISPATCH_BLOCK_REASONS.MINIMUM_RESOURCES_NOT_PLANNED]:
    'Um recurso exigido pelo serviço não tem quantidade planejada suficiente.',
  [DISPATCH_BLOCK_REASONS.MINIMUM_LABOR_NOT_PLANNED]:
    'Uma função de mão de obra exigida pelo serviço não tem quantidade planejada suficiente.',
  [DISPATCH_BLOCK_REASONS.RESERVATION_MISSING]: 'Não há recurso nominal reservado para esta ordem.',
  [DISPATCH_BLOCK_REASONS.RESERVATION_WINDOW_MISMATCH]:
    'A reserva de recurso cobre uma janela diferente da acordada para a ordem.',
  [DISPATCH_BLOCK_REASONS.RESERVATION_RESOURCE_INACTIVE]: 'Um recurso reservado está inativo.',
  [DISPATCH_BLOCK_REASONS.CREW_NOT_CONFIRMED]: 'Nenhuma pessoa está escalada para esta ordem.',
  [DISPATCH_BLOCK_REASONS.DRIVER_NOT_ASSIGNED]:
    'O serviço exige condutor e nenhum condutor habilitado está escalado.',
  [DISPATCH_BLOCK_REASONS.DRIVER_INACTIVE]: 'O condutor escalado está inativo.',
  [DISPATCH_BLOCK_REASONS.QUALIFICATION_EXPIRED]: 'A habilitação do condutor está vencida.',
  [DISPATCH_BLOCK_REASONS.QUALIFICATION_MISSING]:
    'O condutor escalado não possui a habilitação exigida pelo serviço.',
  [DISPATCH_BLOCK_REASONS.VEHICLE_NOT_ASSIGNED]:
    'O serviço exige veículo e nenhum veículo está escalado.',
  [DISPATCH_BLOCK_REASONS.VEHICLE_UNAVAILABLE]: 'O veículo escalado está indisponível.',
  [DISPATCH_BLOCK_REASONS.EQUIPMENT_NOT_ASSIGNED]:
    'O serviço exige equipamento e nenhum equipamento está escalado.',
  [DISPATCH_BLOCK_REASONS.EQUIPMENT_UNAVAILABLE]: 'O equipamento escalado está indisponível.',
  [DISPATCH_BLOCK_REASONS.MAINTENANCE_OPEN]: 'Um recurso escalado está em manutenção aberta.',
  [DISPATCH_BLOCK_REASONS.REQUIRED_DOCUMENT_MISSING]:
    'Um documento obrigatório para o serviço não está anexado.',
  [DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_MISSING]:
    'A janela operacional da ordem não está definida.',
  [DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_EXPIRED]: 'A janela operacional já encerrou.',
  [DISPATCH_BLOCK_REASONS.SLA_ALREADY_BREACHED]:
    'O prazo de atendimento já venceu antes do despacho.',
  [DISPATCH_BLOCK_REASONS.BLOCKING_SITUATION_OPEN]:
    'Existe uma situação de bloqueio aberta sobre esta ordem.',
  [DISPATCH_BLOCK_REASONS.CONTRACT_RESTRICTION]:
    'Uma restrição do contrato impede o despacho nesta condição.',
};

const RESOLUTION_TEXT: Record<DispatchResolutionCode, string> = {
  [DISPATCH_RESOLUTION_CODES.CONFIRM_PLANNING]: 'Confirmar o planejamento',
  [DISPATCH_RESOLUTION_CODES.COMPLETE_PLANNED_RESOURCES]: 'Completar os recursos planejados',
  [DISPATCH_RESOLUTION_CODES.RESERVE_RESOURCES]: 'Reservar os recursos necessários',
  [DISPATCH_RESOLUTION_CODES.ADJUST_RESERVATION_WINDOW]: 'Ajustar a janela da reserva',
  [DISPATCH_RESOLUTION_CODES.REPLACE_INACTIVE_RESOURCE]: 'Substituir o recurso inativo',
  [DISPATCH_RESOLUTION_CODES.ASSIGN_CREW]: 'Escalar a equipe',
  [DISPATCH_RESOLUTION_CODES.ASSIGN_DRIVER]: 'Escalar um condutor',
  [DISPATCH_RESOLUTION_CODES.REASSIGN_DRIVER]: 'Trocar o condutor',
  [DISPATCH_RESOLUTION_CODES.REGISTER_QUALIFICATION]: 'Registrar a habilitação',
  [DISPATCH_RESOLUTION_CODES.ASSIGN_VEHICLE]: 'Escalar o veículo',
  [DISPATCH_RESOLUTION_CODES.REASSIGN_VEHICLE]: 'Trocar o veículo',
  [DISPATCH_RESOLUTION_CODES.ASSIGN_EQUIPMENT]: 'Escalar o equipamento',
  [DISPATCH_RESOLUTION_CODES.REASSIGN_EQUIPMENT]: 'Trocar o equipamento',
  [DISPATCH_RESOLUTION_CODES.CLOSE_MAINTENANCE]: 'Encerrar a manutenção do recurso',
  [DISPATCH_RESOLUTION_CODES.ATTACH_REQUIRED_DOCUMENT]: 'Anexar o documento obrigatório',
  [DISPATCH_RESOLUTION_CODES.DEFINE_OPERATIONAL_WINDOW]: 'Definir a janela operacional',
  [DISPATCH_RESOLUTION_CODES.RESCHEDULE_WINDOW]: 'Reagendar a janela operacional',
  [DISPATCH_RESOLUTION_CODES.ESCALATE]: 'Escalonar para a supervisão',
  [DISPATCH_RESOLUTION_CODES.RESOLVE_SITUATION]: 'Resolver a situação',
  [DISPATCH_RESOLUTION_CODES.REVIEW_CONTRACT]: 'Revisar a restrição contratual',
};

/** Texto humano do motivo. Exportado para que o frontend NÃO o reescreva. */
export function describeDispatchReason(reason: DispatchBlockReason): string {
  return REASON_TEXT[reason];
}

/** Texto humano da resolução. Exportado para que o frontend NÃO o reescreva. */
export function describeDispatchResolution(resolution: DispatchResolutionCode): string {
  return RESOLUTION_TEXT[resolution];
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITÁRIOS PUROS
// ═══════════════════════════════════════════════════════════════════════════════

function toNumber(value: string | null | undefined): number {
  const parsed = Number(value ?? '0');
  return Number.isFinite(parsed) ? parsed : 0;
}

function toMillis(value: string | null | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function makeDimension(
  dimension: DispatchReadinessDimension,
  status: DispatchReadinessStatus,
  detail: {
    reasonCode?: DispatchBlockReason;
    resource?: DispatchReadinessResource | null;
    qualificationCode?: string | null;
    dueAt?: string | null;
    resolution?: DispatchResolutionCode;
  } = {},
): DispatchReadinessDimensionResult {
  /**
   * `READY` e `NOT_APPLICABLE` NÃO carregam motivo.
   *
   * Um motivo em uma dimensão que não está bloqueando é informação contraditória:
   * a tela mostraria "pronto" ao lado de um motivo de falha. `WARNING` mantém
   * motivo e resolução de propósito — o aviso precisa dizer o que olhar mesmo
   * quando o sistema não impede.
   */
  const carriesReason =
    status === DISPATCH_READINESS_STATUSES.Blocked ||
    status === DISPATCH_READINESS_STATUSES.Warning;

  const reasonCode = carriesReason ? (detail.reasonCode ?? null) : null;

  return {
    dimension,
    status,
    reasonCode,
    reason: reasonCode ? describeDispatchReason(reasonCode) : null,
    resource: detail.resource ?? null,
    qualificationCode: detail.qualificationCode ?? null,
    dueAt: detail.dueAt ?? null,
    resolution: carriesReason ? (detail.resolution ?? null) : null,
  };
}

function ready(dimension: DispatchReadinessDimension): DispatchReadinessDimensionResult {
  return makeDimension(dimension, DISPATCH_READINESS_STATUSES.Ready);
}

function notApplicable(dimension: DispatchReadinessDimension): DispatchReadinessDimensionResult {
  return makeDimension(dimension, DISPATCH_READINESS_STATUSES.NotApplicable);
}

// ═══════════════════════════════════════════════════════════════════════════════
// AVALIAÇÃO POR DIMENSÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * PLANEJAMENTO — existe plano e ele cobre o mínimo exigido?
 *
 * O plano é a primeira coisa que precisa ser verdade: sem requisito planejado, não
 * há contra o que reservar, e o despacho sairia sem base.
 */
function evaluatePlanning(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const planned = facts.plannedResources.filter((item) => item.status === 'PLANNED');
  if (planned.length === 0) {
    return makeDimension('PLANNING', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.PLANNING_NOT_CONFIRMED,
      resolution: DISPATCH_RESOLUTION_CODES.CONFIRM_PLANNING,
    });
  }

  for (const requirement of facts.requirements) {
    if (requirement.requirementLevel !== 'REQUIRED') {
      continue;
    }
    const required = toNumber(requirement.minQuantity);
    if (required <= 0) {
      continue;
    }
    const covered = planned
      .filter((item) =>
        requirement.requirementKind === 'PHYSICAL_RESOURCE'
          ? item.requirementKind === 'PHYSICAL_RESOURCE' &&
            item.resourceTypeCode === requirement.resourceTypeCode
          : item.requirementKind === 'LABOR' && item.laborTypeCode === requirement.laborTypeCode,
      )
      .reduce((sum, item) => sum + toNumber(item.plannedQuantity), 0);

    if (covered < required) {
      const isLabor = requirement.requirementKind === 'LABOR';
      return makeDimension('PLANNING', DISPATCH_READINESS_STATUSES.Blocked, {
        reasonCode: isLabor
          ? DISPATCH_BLOCK_REASONS.MINIMUM_LABOR_NOT_PLANNED
          : DISPATCH_BLOCK_REASONS.MINIMUM_RESOURCES_NOT_PLANNED,
        resource: {
          id: (isLabor ? requirement.laborTypeCode : requirement.resourceTypeCode) ?? 'UNKNOWN',
          code: (isLabor ? requirement.laborTypeCode : requirement.resourceTypeCode) ?? 'UNKNOWN',
          kind: isLabor ? 'WORKFORCE_MEMBER' : 'PHYSICAL_ASSET',
          label: `Planejado ${covered} de ${required}`,
        },
        resolution: DISPATCH_RESOLUTION_CODES.COMPLETE_PLANNED_RESOURCES,
      });
    }
  }

  return ready('PLANNING');
}

/**
 * RESERVA — existe alocação nominal ativa, e ela cobre a janela?
 *
 * Distinção que importa: `planned_resources` diz "preciso de um caminhão"; a
 * reserva diz "é o VEH-027, das 8h às 17h". Despachar exige a segunda.
 */
function evaluateReservation(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const active = facts.allocations.filter((item) => item.status === 'ACTIVE');
  if (active.length === 0) {
    return makeDimension('RESERVATION', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.RESERVATION_MISSING,
      resolution: DISPATCH_RESOLUTION_CODES.RESERVE_RESOURCES,
    });
  }

  const inactive = active.find((item) => !item.resourceActive);
  if (inactive) {
    return makeDimension('RESERVATION', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.RESERVATION_RESOURCE_INACTIVE,
      resource: {
        id: inactive.id,
        code: inactive.resourceCode,
        kind: inactive.resourceKind,
        label: inactive.resourceLabel,
      },
      resolution: DISPATCH_RESOLUTION_CODES.REPLACE_INACTIVE_RESOURCE,
    });
  }

  const window = facts.operationalWindow;
  if (window) {
    const start = toMillis(window.startAt);
    const end = toMillis(window.endAt);
    if (start !== null && end !== null) {
      const outside = active.find((item) => {
        const itemStart = toMillis(item.operationalStart);
        const itemEnd = toMillis(item.operationalEnd);
        if (itemStart === null || itemEnd === null) {
          return true;
        }
        return itemStart > start || itemEnd < end;
      });
      if (outside) {
        return makeDimension('RESERVATION', DISPATCH_READINESS_STATUSES.Blocked, {
          reasonCode: DISPATCH_BLOCK_REASONS.RESERVATION_WINDOW_MISMATCH,
          resource: {
            id: outside.id,
            code: outside.resourceCode,
            kind: outside.resourceKind,
            label: outside.resourceLabel,
          },
          resolution: DISPATCH_RESOLUTION_CODES.ADJUST_RESERVATION_WINDOW,
        });
      }
    }
  }

  return ready('RESERVATION');
}

/** EQUIPE — existe pelo menos uma pessoa escalada. */
function evaluateCrew(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const people = facts.allocations.filter(
    (item) => item.status === 'ACTIVE' && item.resourceKind === 'WORKFORCE_MEMBER',
  );
  if (people.length === 0) {
    return makeDimension('CREW', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.CREW_NOT_CONFIRMED,
      resolution: DISPATCH_RESOLUTION_CODES.ASSIGN_CREW,
    });
  }
  return ready('CREW');
}

/**
 * CONDUTOR — quem vai dirigir existe, está ativo e é identificado.
 *
 * Quando o serviço não exige deslocamento, a dimensão é NÃO APLICÁVEL — não
 * "pronta". A diferença importa: uma dimensão vazia e verde finge que alguém
 * conferiu algo que nunca foi conferido.
 *
 * A exigência é declarada em `requiresDriver` (derivada do catálogo), e NÃO
 * inferida da existência de um ativo físico: um betoneira também é ativo físico e
 * não tem condutor. Inferir aqui fazia o serviço de equipamento exigir motorista.
 */
function evaluateDriver(facts: DispatchFacts): DispatchReadinessDimensionResult {
  if (!facts.requiresDriver) {
    return notApplicable('DRIVER');
  }

  const drivers = facts.allocations.filter(
    (item) => item.status === 'ACTIVE' && item.requiresDriver,
  );
  if (drivers.length === 0) {
    return makeDimension('DRIVER', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.DRIVER_NOT_ASSIGNED,
      resolution: DISPATCH_RESOLUTION_CODES.ASSIGN_DRIVER,
    });
  }

  const inactive = drivers.find((item) => !item.resourceActive);
  if (inactive) {
    return makeDimension('DRIVER', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.DRIVER_INACTIVE,
      resource: {
        id: inactive.id,
        code: inactive.resourceCode,
        kind: inactive.resourceKind,
        label: inactive.resourceLabel,
      },
      resolution: DISPATCH_RESOLUTION_CODES.REASSIGN_DRIVER,
    });
  }

  return ready('DRIVER');
}

/** VEÍCULO — existe veículo ativo escalado onde o serviço exige. */
function evaluateVehicle(facts: DispatchFacts): DispatchReadinessDimensionResult {
  if (!facts.requiresVehicle) {
    return notApplicable('VEHICLE');
  }
  const vehicles = facts.allocations.filter(
    (item) =>
      item.status === 'ACTIVE' && item.resourceKind === 'PHYSICAL_ASSET' && item.requiresDriver,
  );
  if (vehicles.length === 0) {
    return makeDimension('VEHICLE', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.VEHICLE_NOT_ASSIGNED,
      resolution: DISPATCH_RESOLUTION_CODES.ASSIGN_VEHICLE,
    });
  }
  const unavailable = vehicles.find((item) => !item.resourceActive);
  if (unavailable) {
    return makeDimension('VEHICLE', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.VEHICLE_UNAVAILABLE,
      resource: {
        id: unavailable.id,
        code: unavailable.resourceCode,
        kind: unavailable.resourceKind,
        label: unavailable.resourceLabel,
      },
      resolution: DISPATCH_RESOLUTION_CODES.REASSIGN_VEHICLE,
    });
  }
  return ready('VEHICLE');
}

/** EQUIPAMENTO — existe ativo não-veicular escalado onde o serviço exige. */
function evaluateEquipment(facts: DispatchFacts): DispatchReadinessDimensionResult {
  if (!facts.requiresEquipment) {
    return notApplicable('EQUIPMENT');
  }
  const equipment = facts.allocations.filter(
    (item) =>
      item.status === 'ACTIVE' && item.resourceKind === 'PHYSICAL_ASSET' && !item.requiresDriver,
  );
  if (equipment.length === 0) {
    return makeDimension('EQUIPMENT', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.EQUIPMENT_NOT_ASSIGNED,
      resolution: DISPATCH_RESOLUTION_CODES.ASSIGN_EQUIPMENT,
    });
  }
  const unavailable = equipment.find((item) => !item.resourceActive);
  if (unavailable) {
    return makeDimension('EQUIPMENT', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.EQUIPMENT_UNAVAILABLE,
      resource: {
        id: unavailable.id,
        code: unavailable.resourceCode,
        kind: unavailable.resourceKind,
        label: unavailable.resourceLabel,
      },
      resolution: DISPATCH_RESOLUTION_CODES.REASSIGN_EQUIPMENT,
    });
  }
  return ready('EQUIPMENT');
}

/**
 * HABILITAÇÃO — a qualificação exigida existe e está válida?
 *
 * A comparação de vencimento é feita contra `sla.at`, o MESMO instante usado no
 * resto da avaliação. Ler `new Date()` aqui dentro tornaria a função impura e o
 * resultado mudaria entre duas chamadas do mesmo request.
 */
function evaluateQualification(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const drivers = facts.allocations.filter(
    (item) => item.status === 'ACTIVE' && item.requiresDriver,
  );
  if (drivers.length === 0) {
    return notApplicable('QUALIFICATION');
  }

  const now = toMillis(facts.sla.at) ?? Date.now();

  for (const driver of drivers) {
    for (const qualification of driver.qualifications) {
      const expires = toMillis(qualification.expiresAt);
      if (expires !== null && expires < now) {
        return makeDimension('QUALIFICATION', DISPATCH_READINESS_STATUSES.Blocked, {
          reasonCode: DISPATCH_BLOCK_REASONS.QUALIFICATION_EXPIRED,
          resource: {
            id: driver.id,
            code: driver.resourceCode,
            kind: 'QUALIFICATION',
            label: driver.resourceLabel,
          },
          qualificationCode: qualification.code,
          dueAt: qualification.expiresAt,
          resolution: DISPATCH_RESOLUTION_CODES.REGISTER_QUALIFICATION,
        });
      }
    }
  }

  // Uma dimensão sem exigência de qualificação declarada não pode bloquear: o
  // catálogo é a fonte da exigência, e inventar exigência aqui seria criar regra.
  return ready('QUALIFICATION');
}

/** MANUTENÇÃO — nenhum ativo escalado com manutenção aberta. */
function evaluateMaintenance(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const physical = facts.allocations.filter(
    (item) => item.status === 'ACTIVE' && item.resourceKind === 'PHYSICAL_ASSET',
  );
  if (physical.length === 0) {
    return notApplicable('MAINTENANCE');
  }

  /**
   * `null` significa DESCONHECIDO, não "sem manutenção".
   *
   * O schema atual não possui tabela de ordem de manutenção. Se o fato chega
   * `null`, a dimensão é NÃO APLICÁVEL e o sistema NÃO afirma que o ativo está
   * livre — afirmar isso seria inventar um fato de manutenção que ninguém
   * registrou. O que existe de verdade (ativo inativo) já é capturado por
   * RESERVATION / VEHICLE / EQUIPMENT.
   */
  const known = physical.filter((item) => item.underMaintenance !== null);
  if (known.length === 0) {
    return notApplicable('MAINTENANCE');
  }

  const inMaintenance = known.find((item) => item.underMaintenance === true);
  if (inMaintenance) {
    return makeDimension('MAINTENANCE', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.MAINTENANCE_OPEN,
      resource: {
        id: inMaintenance.id,
        code: inMaintenance.resourceCode,
        kind: inMaintenance.resourceKind,
        label: inMaintenance.resourceLabel,
      },
      resolution: DISPATCH_RESOLUTION_CODES.CLOSE_MAINTENANCE,
    });
  }
  return ready('MAINTENANCE');
}

/** DOCUMENTOS — todo documento obrigatório está anexado. */
function evaluateDocuments(facts: DispatchFacts): DispatchReadinessDimensionResult {
  if (facts.documents.length === 0) {
    return notApplicable('DOCUMENTS');
  }
  const missing = facts.documents.find((item) => !item.satisfied);
  if (missing) {
    return makeDimension('DOCUMENTS', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.REQUIRED_DOCUMENT_MISSING,
      resource: {
        id: missing.code,
        code: missing.code,
        kind: 'DOCUMENT',
        label: missing.label,
      },
      resolution: DISPATCH_RESOLUTION_CODES.ATTACH_REQUIRED_DOCUMENT,
    });
  }
  return ready('DOCUMENTS');
}

/** JANELA OPERACIONAL — existe e ainda não encerrou. */
function evaluateOperationalWindow(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const window = facts.operationalWindow;
  if (!window) {
    return makeDimension('OPERATIONAL_WINDOW', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_MISSING,
      resolution: DISPATCH_RESOLUTION_CODES.DEFINE_OPERATIONAL_WINDOW,
    });
  }
  const end = toMillis(window.endAt);
  const now = toMillis(facts.sla.at) ?? Date.now();
  if (end !== null && end < now) {
    return makeDimension('OPERATIONAL_WINDOW', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.OPERATIONAL_WINDOW_EXPIRED,
      dueAt: window.endAt,
      resolution: DISPATCH_RESOLUTION_CODES.RESCHEDULE_WINDOW,
    });
  }
  return ready('OPERATIONAL_WINDOW');
}

/**
 * SLA — o prazo já venceu antes de sair?
 *
 * Despachar uma ordem cujo prazo já venceu é registrar a violação, não evitá-la.
 * Por isso é BLOCKED e a resolução é escalonar — não "seguir mesmo assim".
 */
function evaluateSla(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const due = toMillis(facts.sla.dueAt);
  if (due === null) {
    return notApplicable('SLA');
  }
  const now = toMillis(facts.sla.at) ?? Date.now();
  if (due < now) {
    return makeDimension('SLA', DISPATCH_READINESS_STATUSES.Blocked, {
      reasonCode: DISPATCH_BLOCK_REASONS.SLA_ALREADY_BREACHED,
      dueAt: facts.sla.dueAt,
      resolution: DISPATCH_RESOLUTION_CODES.ESCALATE,
    });
  }
  return ready('SLA');
}

/**
 * REQUISITOS DE EVIDÊNCIA — o plano de execução exige evidência que ainda não
 * pode ser produzida?
 *
 * A dimensão NÃO bloqueia por evidência faltante: evidência se produz DURANTE a
 * execução. O que ela faz é avisar quando o serviço exige assinatura do cliente ou
 * documento que depende de terceiro — informação que muda a preparação.
 */
function evaluateEvidenceRequirements(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const restrictions = facts.contractRestrictions.filter(
    (item) => item.active && item.code === 'REQUIRES_CUSTOMER_SIGNATURE',
  );
  if (restrictions.length === 0) {
    return notApplicable('EVIDENCE_REQUIREMENTS');
  }
  return makeDimension('EVIDENCE_REQUIREMENTS', DISPATCH_READINESS_STATUSES.Warning, {
    reasonCode: DISPATCH_BLOCK_REASONS.CONTRACT_RESTRICTION,
    resource: null,
    resolution: DISPATCH_RESOLUTION_CODES.REVIEW_CONTRACT,
  });
}

/**
 * BLOQUEIO POR SITUAÇÃO ABERTA.
 *
 * Não é uma dimensão de vocabulário próprio: uma situação é consequência de outra
 * dimensão (SLA, manutenção, romance de doc), e criar uma décima quarta dimensão
 * para ela duplicaria a causa. O motivo carrega a situação real; a dimensão usada
 * é a primeira que já existe e cuja semântica é "o processo está travado".
 */
function evaluateBlockingSituations(facts: DispatchFacts): DispatchReadinessDimensionResult | null {
  const blocking = facts.situations.filter((item) => item.blocking);
  if (blocking.length === 0) {
    return null;
  }
  return makeDimension('SLA', DISPATCH_READINESS_STATUSES.Blocked, {
    reasonCode: DISPATCH_BLOCK_REASONS.BLOCKING_SITUATION_OPEN,
    resource: null,
    resolution: DISPATCH_RESOLUTION_CODES.RESOLVE_SITUATION,
  });
}

/**
 * RESTRIÇÕES CONTRATUAIS — a ordem viola uma regra do contrato?
 *
 * Só entram restrições DECLARADAS E VERIFICÁVEIS pelo domínio. `active` já vem
 * calculado pela camada que conhece o contrato; aqui não se interpreta texto
 * livre de contrato.
 */
function evaluateContractRestrictions(facts: DispatchFacts): DispatchReadinessDimensionResult {
  const active = facts.contractRestrictions.filter(
    (item) => item.active && item.code !== 'REQUIRES_CUSTOMER_SIGNATURE',
  );
  if (active.length === 0) {
    return notApplicable('CONTRACT_RESTRICTIONS');
  }
  const first = active[0]!;
  return makeDimension('CONTRACT_RESTRICTIONS', DISPATCH_READINESS_STATUSES.Blocked, {
    reasonCode: DISPATCH_BLOCK_REASONS.CONTRACT_RESTRICTION,
    resource: {
      id: first.code,
      code: first.code,
      kind: 'DOCUMENT',
      label: first.label,
    },
    resolution: DISPATCH_RESOLUTION_CODES.REVIEW_CONTRACT,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AGREGAÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Avalia a prontidão de despacho.
 *
 * A ordem das dimensões no resultado é a de `DISPATCH_READINESS_DIMENSIONS`, não a
 * de avaliação interna: o operador vê sempre a mesma sequência, e o frontend não
 * precisa ordenar.
 */
export function evaluateDispatchReadiness(facts: DispatchFacts): DispatchReadiness {
  const evaluated: Record<DispatchReadinessDimension, DispatchReadinessDimensionResult> = {
    PLANNING: evaluatePlanning(facts),
    RESERVATION: evaluateReservation(facts),
    CREW: evaluateCrew(facts),
    DRIVER: evaluateDriver(facts),
    VEHICLE: evaluateVehicle(facts),
    EQUIPMENT: evaluateEquipment(facts),
    QUALIFICATION: evaluateQualification(facts),
    MAINTENANCE: evaluateMaintenance(facts),
    DOCUMENTS: evaluateDocuments(facts),
    OPERATIONAL_WINDOW: evaluateOperationalWindow(facts),
    SLA: evaluateSla(facts),
    EVIDENCE_REQUIREMENTS: evaluateEvidenceRequirements(facts),
    CONTRACT_RESTRICTIONS: evaluateContractRestrictions(facts),
  };

  const dimensions = DISPATCH_READINESS_DIMENSIONS.map((dimension) => evaluated[dimension]);

  const blockingReasons = dimensions.filter(
    (item) => item.status === DISPATCH_READINESS_STATUSES.Blocked,
  );
  const warnings = dimensions.filter((item) => item.status === DISPATCH_READINESS_STATUSES.Warning);

  // Bloqueio por situação aberta é AVALIADO UMA VEZ e agregado aqui. A dimensão
  // exibida é a que já existe (`SLA`) porque uma situação sempre nasce de uma causa
  // real; criar uma dimensão "SITUAÇÃO" faria a causa aparecer duas vezes na tela.
  const situationBlock = evaluateBlockingSituations(facts);

  const allBlocking = situationBlock ? [...blockingReasons, situationBlock] : blockingReasons;
  const ready = allBlocking.length === 0;

  const status: DispatchReadinessStatus = !ready
    ? DISPATCH_READINESS_STATUSES.Blocked
    : warnings.length > 0
      ? DISPATCH_READINESS_STATUSES.Warning
      : DISPATCH_READINESS_STATUSES.Ready;

  const summary = !ready
    ? allBlocking.length === 1
      ? `Despacho bloqueado: ${allBlocking[0]!.reason ?? allBlocking[0]!.reasonCode}`
      : `Despacho bloqueado por ${allBlocking.length} motivos: ${allBlocking
          .map((item) => item.reasonCode)
          .join(', ')}`
    : warnings.length > 0
      ? `Pronto para despachar com ${warnings.length} aviso(s).`
      : 'Pronto para despachar.';

  return {
    ready,
    status,
    blockingReasons: allBlocking,
    warnings,
    dimensions,
    nextAction: allBlocking[0]?.resolution ?? null,
    summary,
  };
}

/**
 * A ordem está no estado em que o despacho é o próximo passo?
 *
 * O despacho só existe a partir de `RELEASED`. Antes disso a OS nem está pronta
 * para operação; depois, já saiu.
 */
export function isDispatchableStatus(status: ServiceOrderStatus): boolean {
  return status === SERVICE_ORDER_STATUSES.Released;
}
