/**
 * OPERATIONS COMMAND SURFACE — o BACKEND diz quais comandos existem e quais estão
 * habilitados. O frontend apenas representa.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO IMPEDE
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O código proibido é este:
 *
 *     if (status === IN_EXECUTION && finalOdometer && fuel) enable(COMPLETE)
 *
 * Ele parece inofensivo e é a origem de todos os desvios desta capability: uma
 * segunda implementação da regra de conclusão, em outra linguagem, que pode
 * divergir da primeira sem que nenhum teste falhe. O operador então vê um botão
 * habilitado que o backend recusa — ou um botão desabilitado por um dado que o
 * backend nem usa.
 *
 * Aqui, cada comando declara:
 *
 *   - `code`: o comando que o backend aceita (vocabulário do domínio);
 *   - `enabled`: se pode ser executado AGORA, pelo MOTIVO do domínio;
 *   - `reasons`: os códigos de bloqueio, não uma mensagem solta;
 *   - `nextAction`: o comando que destrava este;
 *   - `route`: onde o comando é executado (decisão de navegação declarada aqui,
 *     para que a tela não invente um caminho).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SEMÂNTICA EXISTENTE É PRESERVADA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Onde o domínio já tinha um nome diferente, ele é mantido e o alias é declarado:
 * `RECORD_EXECUTION` / `RECORD_QUANTITY` / `RECORD_MILEAGE` / `RECORD_HOUR_METER` /
 * `RECORD_OCCURRENCE` / `RECORD_EVIDENCE` continuam existindo. `DISPATCH` é o
 * único comando GENUINAMENTE NOVO desta fase, porque não havia como despachar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não executa nada, não consulta banco, não decide autorização. Ele DECLARA o que
 * existe e o que está habilitado a partir dos fatos que a aplicação já levantou.
 */

import type { CompletionGate } from './completion-gate';
import type { DispatchReadiness } from './dispatch-readiness';
import { SERVICE_ORDER_STATUSES, type ServiceOrderStatus } from './service-order';
import { EXECUTION_COMMANDS } from './service-order-execution';

// ═══════════════════════════════════════════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Comandos desta capability.
 *
 * O `code` é o identificador que o backend aceita. Quando o comando já existia,
 * usa-se o nome existente (`START`, `PAUSE`, `RESUME`, `COMPLETE`, `CANCEL`,
 * `RECORD_*`) e só os inexistentes recebem nome novo.
 */
export const OPERATIONS_COMMANDS = {
  /** NOVO nesta fase: registra o FATO de despacho com janela e recursos confirmados. */
  Dispatch: 'DISPATCH',
  /** NOVO: confirma a chegada no local. */
  CheckIn: 'CHECK_IN',
  /** Existente. */
  Start: 'START',
  /** Existente. */
  Pause: 'PAUSE',
  /** Existente. */
  Resume: 'RESUME',
  /** Existente (`RECORD_EXECUTION` do domínio). */
  RecordProgress: 'REGISTER_PROGRESS',
  /** NOVO: realizado dimensionado. */
  RegisterActual: 'REGISTER_ACTUAL',
  /** NOVO: leitura de medidor (odômetro/horímetro). */
  RegisterMeter: 'REGISTER_METER',
  /** NOVO: combustível com procedência. */
  RegisterFuel: 'REGISTER_FUEL',
  /** `RECORD_QUANTITY` / horas de mão de obra por pessoa. */
  RegisterLabor: 'REGISTER_LABOR',
  /** `RECORD_HOUR_METER` para ativo. */
  RegisterEquipmentUsage: 'REGISTER_EQUIPMENT_USAGE',
  /** NOVO: material consumido. */
  RegisterMaterialUsage: 'REGISTER_MATERIAL_USAGE',
  /** Existente (`RECORD_EVIDENCE`). */
  AttachEvidence: 'ATTACH_EVIDENCE',
  /** NOVO: assinatura do cliente. */
  RegisterSignature: 'REGISTER_SIGNATURE',
  /** Existente (`RECORD_OCCURRENCE`). */
  ReportException: 'REPORT_EXCEPTION',
  /** NOVO: escalonamento com dono explícito. */
  Escalate: 'ESCALATE',
  /** Existente. */
  Complete: 'COMPLETE',
  /** Existente. */
  Cancel: 'CANCEL',
} as const;

export type OperationsCommandCode = (typeof OPERATIONS_COMMANDS)[keyof typeof OPERATIONS_COMMANDS];

/** Rótulo humano de cada comando. Vive no backend porque a tela não deve inventar. */
const COMMAND_LABELS: Record<OperationsCommandCode, string> = {
  [OPERATIONS_COMMANDS.Dispatch]: 'Despachar',
  [OPERATIONS_COMMANDS.CheckIn]: 'Registrar chegada',
  [OPERATIONS_COMMANDS.Start]: 'Iniciar execução',
  [OPERATIONS_COMMANDS.Pause]: 'Pausar',
  [OPERATIONS_COMMANDS.Resume]: 'Retomar',
  [OPERATIONS_COMMANDS.RecordProgress]: 'Registrar progresso',
  [OPERATIONS_COMMANDS.RegisterActual]: 'Registrar realizado',
  [OPERATIONS_COMMANDS.RegisterMeter]: 'Registrar leitura',
  [OPERATIONS_COMMANDS.RegisterFuel]: 'Registrar combustível',
  [OPERATIONS_COMMANDS.RegisterLabor]: 'Registrar mão de obra',
  [OPERATIONS_COMMANDS.RegisterEquipmentUsage]: 'Registrar equipamento',
  [OPERATIONS_COMMANDS.RegisterMaterialUsage]: 'Registrar material',
  [OPERATIONS_COMMANDS.AttachEvidence]: 'Anexar evidência',
  [OPERATIONS_COMMANDS.RegisterSignature]: 'Registrar assinatura',
  [OPERATIONS_COMMANDS.ReportException]: 'Registrar ocorrência',
  [OPERATIONS_COMMANDS.Escalate]: 'Escalonar',
  [OPERATIONS_COMMANDS.Complete]: 'Concluir',
  [OPERATIONS_COMMANDS.Cancel]: 'Cancelar',
};

/** Permissão exigida, lida do vocabulário RBAC existente. */
const COMMAND_PERMISSIONS: Record<OperationsCommandCode, string> = {
  [OPERATIONS_COMMANDS.Dispatch]: 'service-orders:service-order:dispatch',
  [OPERATIONS_COMMANDS.CheckIn]: 'service-orders:execution:start',
  [OPERATIONS_COMMANDS.Start]: 'service-orders:execution:start',
  [OPERATIONS_COMMANDS.Pause]: 'service-orders:execution:pause',
  [OPERATIONS_COMMANDS.Resume]: 'service-orders:execution:resume',
  [OPERATIONS_COMMANDS.RecordProgress]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterActual]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterMeter]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterFuel]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterLabor]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterEquipmentUsage]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterMaterialUsage]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.AttachEvidence]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.RegisterSignature]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.ReportException]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.Escalate]: 'service-orders:execution:record',
  [OPERATIONS_COMMANDS.Complete]: 'service-orders:execution:complete',
  [OPERATIONS_COMMANDS.Cancel]: 'service-orders:service-order:cancel',
};

/** Um comando disponível, com a decisão já tomada pelo backend. */
export type AvailableCommand = {
  code: OperationsCommandCode;
  label: string;
  enabled: boolean;
  /** Códigos de bloqueio. Vazio quando `enabled`. */
  reasons: string[];
  /** Comando que destrava, quando bloqueado. */
  nextAction: OperationsCommandCode | null;
  /** Permissão exigida — o frontend não recalcula RBAC. */
  requiredPermission: string;
  /** Rota onde o comando é executado. Declarada aqui, não inventada na tela. */
  route: string;
  /** Rótulo humano dos motivos, na mesma ordem de `reasons`. */
  reasonLabels: string[];
};

/**
 * Fatos para decidir os comandos.
 *
 * Todos os campos são FATOS já observados; este módulo não lê nada.
 */
export type CommandSurfaceFacts = {
  serviceOrderId: string;
  status: ServiceOrderStatus;
  /** Prontidão de despacho (já avaliada). */
  dispatchReadiness: DispatchReadiness;
  /** Gate de conclusão (já avaliado). */
  completionGate: CompletionGate;
  /** Existe fato de despacho persistido. */
  dispatchedAt: string | null;
  /** Existe fato de chegada registrado. */
  checkedInAt: string | null;
  /** Existe situação de bloqueio aberta. */
  hasBlockingSituation: boolean;
  /** O ator tem a permissão? O backend já decidiu; aqui só se propaga. */
  hasPermission: (permission: string) => boolean;
};

/** Superfície completa de comandos. */
export type CommandSurface = {
  availableCommands: AvailableCommand[];
  /** Próximo comando recomendado — o mesmo que a object page destaca. */
  nextCommand: OperationsCommandCode | null;
  /** Rótulo do próximo comando, para o painel de próxima ação. */
  nextCommandLabel: string | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

function routeFor(serviceOrderId: string, command: OperationsCommandCode): string {
  if (command === OPERATIONS_COMMANDS.Cancel) {
    return `/app/service-orders/${serviceOrderId}`;
  }
  return `/app/service-orders/${serviceOrderId}/execution`;
}

/** Decisão de habilitação de UM comando. */
type CommandDecision =
  | { enabled: true }
  | {
      enabled: false;
      reasons: string[];
      nextAction: OperationsCommandCode | null;
      reasonLabels?: string[];
    };

function buildCommand(
  facts: CommandSurfaceFacts,
  code: OperationsCommandCode,
  decision: CommandDecision,
): AvailableCommand {
  const permission = COMMAND_PERMISSIONS[code];
  const authorised = facts.hasPermission(permission);

  // A autorização é um motivo como qualquer outro: um comando sem permissão fica
  // DESABILITADO, e não OCULTO. Ocultar faria o operador achar que o comando não
  // existe quando na verdade ele existe e ele não pode.
  if (!authorised) {
    return {
      code,
      label: COMMAND_LABELS[code],
      enabled: false,
      reasons: ['NOT_AUTHORIZED'],
      nextAction: null,
      requiredPermission: permission,
      route: routeFor(facts.serviceOrderId, code),
      reasonLabels: ['Sem permissão para este comando.'],
    };
  }

  if (decision.enabled) {
    return {
      code,
      label: COMMAND_LABELS[code],
      enabled: true,
      reasons: [],
      nextAction: null,
      requiredPermission: permission,
      route: routeFor(facts.serviceOrderId, code),
      reasonLabels: [],
    };
  }

  return {
    code,
    label: COMMAND_LABELS[code],
    enabled: false,
    reasons: decision.reasons,
    nextAction: decision.nextAction,
    requiredPermission: permission,
    route: routeFor(facts.serviceOrderId, code),
    reasonLabels: decision.reasonLabels ?? decision.reasons.map(labelForReasonCode),
  };
}

/** Traduz um código de bloqueio em rótulo, sem depender da origem do código. */
function labelForReasonCode(code: string): string {
  const known: Record<string, string> = {
    EXECUTION_NOT_STARTED: 'A execução não foi iniciada.',
    EXECUTION_CANCELLED: 'A ordem está cancelada.',
    EXECUTION_ALREADY_COMPLETED: 'A execução já foi concluída.',
    NOT_IN_EXECUTION: 'A ordem não está em execução.',
    REQUIRED_EVIDENCE_MISSING: 'Evidência obrigatória ausente.',
    EVIDENCE_NOT_VERIFIED: 'Evidência anexada ainda não verificada.',
    FINAL_ODOMETER_REQUIRED: 'Falta a leitura final do odômetro.',
    FINAL_HOUR_METER_REQUIRED: 'Falta a leitura final do horímetro.',
    FUEL_ACTUAL_REQUIRED: 'Falta o combustível real.',
    LABOR_ACTUAL_REQUIRED: 'Faltam horas de mão de obra.',
    EQUIPMENT_ACTUAL_REQUIRED: 'Faltam horas de equipamento.',
    MATERIAL_ACTUAL_REQUIRED: 'Falta o material consumido.',
    CUSTOMER_SIGNATURE_REQUIRED: 'Falta a assinatura do cliente.',
    BLOCKING_SITUATION_OPEN: 'Existe situação de bloqueio aberta.',
    EXECUTION_REQUIREMENT_UNMET: 'Requisito de execução não cumprido.',
    PLANNING_NOT_CONFIRMED: 'O planejamento não está confirmado.',
    MINIMUM_RESOURCES_NOT_PLANNED: 'Recurso exigido sem quantidade planejada.',
    MINIMUM_LABOR_NOT_PLANNED: 'Mão de obra exigida sem quantidade planejada.',
    RESERVATION_MISSING: 'Sem recurso reservado.',
    RESERVATION_WINDOW_MISMATCH: 'A reserva não cobre a janela operacional.',
    RESERVATION_RESOURCE_INACTIVE: 'Recurso reservado inativo.',
    CREW_NOT_CONFIRMED: 'Nenhuma pessoa escalada.',
    DRIVER_NOT_ASSIGNED: 'Nenhum condutor escalado.',
    DRIVER_INACTIVE: 'Condutor escalado inativo.',
    QUALIFICATION_EXPIRED: 'Habilitação do condutor vencida.',
    QUALIFICATION_MISSING: 'Habilitação exigida ausente.',
    VEHICLE_NOT_ASSIGNED: 'Nenhum veículo escalado.',
    VEHICLE_UNAVAILABLE: 'Veículo escalado indisponível.',
    EQUIPMENT_NOT_ASSIGNED: 'Nenhum equipamento escalado.',
    EQUIPMENT_UNAVAILABLE: 'Equipamento escalado indisponível.',
    MAINTENANCE_OPEN: 'Recurso em manutenção.',
    REQUIRED_DOCUMENT_MISSING: 'Documento obrigatório ausente.',
    OPERATIONAL_WINDOW_MISSING: 'Janela operacional não definida.',
    OPERATIONAL_WINDOW_EXPIRED: 'Janela operacional encerrada.',
    SLA_ALREADY_BREACHED: 'Prazo de atendimento já vencido.',
    CONTRACT_RESTRICTION: 'Restrição contratual ativa.',
    NOT_AUTHORIZED: 'Sem permissão para este comando.',
    ALREADY_DISPATCHED: 'A ordem já foi despachada.',
    NOT_RELEASED: 'A ordem não está liberada para despacho.',
  };
  return known[code] ?? code;
}

/**
 * Constrói a superfície de comandos.
 *
 * A REGRA DE HABILITAÇÃO VIVE AQUI, em UM lugar, e é a mesma que o comando aplica
 * no backend: o gate de despacho governa `DISPATCH`; o gate de conclusão governa
 * `COMPLETE`. Não existe segunda cópia desta decisão — é exatamente o que impede a
 * divergência entre o botão e o comando.
 */
export function buildCommandSurface(facts: CommandSurfaceFacts): CommandSurface {
  const { status } = facts;
  const commands: AvailableCommand[] = [];

  const dispatched = facts.dispatchedAt !== null;
  const started =
    status === SERVICE_ORDER_STATUSES.InExecution || status === SERVICE_ORDER_STATUSES.Paused;
  const recordingAllowed =
    status === SERVICE_ORDER_STATUSES.InExecution || status === SERVICE_ORDER_STATUSES.Paused;
  const terminal =
    status === SERVICE_ORDER_STATUSES.Completed || status === SERVICE_ORDER_STATUSES.Cancelled;

  // ── DESPACHO ────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Dispatch,
      status !== SERVICE_ORDER_STATUSES.Released
        ? {
            enabled: false,
            reasons: dispatched ? ['ALREADY_DISPATCHED'] : ['NOT_RELEASED'],
            nextAction: null,
          }
        : !facts.dispatchReadiness.ready
          ? {
              enabled: false,
              reasons: facts.dispatchReadiness.blockingReasons.map(
                (item) => item.reasonCode ?? 'UNKNOWN',
              ),
              nextAction: stagesToCommand(facts.dispatchReadiness.nextAction),
              reasonLabels: facts.dispatchReadiness.blockingReasons.map(
                (item) => item.reason ?? item.reasonCode ?? 'Motivo não declarado',
              ),
            }
          : { enabled: true },
    ),
  );

  // ── CHEGADA ─────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.CheckIn,
      !dispatched
        ? { enabled: false, reasons: ['NOT_DISPATCHED'], nextAction: OPERATIONS_COMMANDS.Dispatch }
        : facts.checkedInAt !== null
          ? { enabled: false, reasons: ['ALREADY_CHECKED_IN'], nextAction: null }
          : started
            ? { enabled: false, reasons: ['ALREADY_STARTED'], nextAction: null }
            : { enabled: true },
    ),
  );

  // ── INÍCIO ──────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Start,
      status === SERVICE_ORDER_STATUSES.Released
        ? !dispatched
          ? {
              enabled: false,
              reasons: ['SERVICE_NOT_DISPATCHED'],
              nextAction: OPERATIONS_COMMANDS.Dispatch,
            }
          : !facts.dispatchReadiness.ready
            ? {
                enabled: false,
                reasons: facts.dispatchReadiness.blockingReasons.map(
                  (item) => item.reasonCode ?? 'UNKNOWN',
                ),
                nextAction: stagesToCommand(facts.dispatchReadiness.nextAction),
                reasonLabels: facts.dispatchReadiness.blockingReasons.map(
                  (item) => item.reason ?? item.reasonCode ?? 'Motivo não declarado',
                ),
              }
            : { enabled: true }
        : {
            enabled: false,
            reasons: [
              status === SERVICE_ORDER_STATUSES.InExecution
                ? 'ALREADY_STARTED'
                : status === SERVICE_ORDER_STATUSES.Paused
                  ? 'PAUSED'
                  : status === SERVICE_ORDER_STATUSES.Completed
                    ? 'EXECUTION_ALREADY_COMPLETED'
                    : status === SERVICE_ORDER_STATUSES.Cancelled
                      ? 'EXECUTION_CANCELLED'
                      : 'NOT_RELEASED',
            ],
            nextAction:
              status === SERVICE_ORDER_STATUSES.Paused ? OPERATIONS_COMMANDS.Resume : null,
          },
    ),
  );

  // ── PAUSA ───────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Pause,
      status === SERVICE_ORDER_STATUSES.InExecution
        ? { enabled: true }
        : {
            enabled: false,
            reasons: [
              status === SERVICE_ORDER_STATUSES.Paused ? 'ALREADY_PAUSED' : 'NOT_IN_EXECUTION',
            ],
            nextAction:
              status === SERVICE_ORDER_STATUSES.Paused ? OPERATIONS_COMMANDS.Resume : null,
          },
    ),
  );

  // ── RETOMADA ────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Resume,
      status === SERVICE_ORDER_STATUSES.Paused
        ? { enabled: true }
        : {
            enabled: false,
            reasons: [!terminal ? 'NOT_PAUSED' : 'EXECUTION_CLOSED'],
            nextAction: null,
          },
    ),
  );

  // ── REGISTRO DURANTE A EXECUÇÃO ─────────────────────────────────────────────
  //
  // Todos os comandos de captura compartilham a MESMA condição: a execução precisa
  // estar em andamento (ou pausada). Não há motivo para repetir a decisão sete
  // vezes — e repetir é como as sete divergem.
  const recordDecision: CommandDecision = recordingAllowed
    ? { enabled: true }
    : {
        enabled: false,
        reasons: [terminal ? 'EXECUTION_CLOSED' : 'NOT_IN_EXECUTION'],
        nextAction: status === SERVICE_ORDER_STATUSES.Released ? OPERATIONS_COMMANDS.Start : null,
      };

  for (const code of [
    OPERATIONS_COMMANDS.RecordProgress,
    OPERATIONS_COMMANDS.RegisterActual,
    OPERATIONS_COMMANDS.RegisterMeter,
    OPERATIONS_COMMANDS.RegisterFuel,
    OPERATIONS_COMMANDS.RegisterLabor,
    OPERATIONS_COMMANDS.RegisterEquipmentUsage,
    OPERATIONS_COMMANDS.RegisterMaterialUsage,
    OPERATIONS_COMMANDS.AttachEvidence,
    OPERATIONS_COMMANDS.ReportException,
    OPERATIONS_COMMANDS.Escalate,
  ] as const) {
    commands.push(buildCommand(facts, code, recordDecision));
  }

  // ── ASSINATURA ──────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.RegisterSignature,
      // A assinatura pode ser registrada durante a execução e também com a
      // execução concluída e ainda não fechada: no campo, o cliente assina depois.
      recordingAllowed || status === SERVICE_ORDER_STATUSES.Completed
        ? { enabled: true }
        : {
            enabled: false,
            reasons: [
              status === SERVICE_ORDER_STATUSES.Cancelled
                ? 'EXECUTION_CANCELLED'
                : 'NOT_IN_EXECUTION',
            ],
            nextAction: null,
          },
    ),
  );

  // ── CONCLUSÃO ───────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Complete,
      facts.completionGate.canComplete
        ? { enabled: true }
        : {
            enabled: false,
            reasons: facts.completionGate.blockingReasons.map((item) => item.reasonCode),
            nextAction: completionToCommand(facts.completionGate.nextAction),
            reasonLabels: facts.completionGate.blockingReasons.map((item) => item.reason),
          },
    ),
  );

  // ── CANCELAMENTO ────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      OPERATIONS_COMMANDS.Cancel,
      status === SERVICE_ORDER_STATUSES.Draft ||
        status === SERVICE_ORDER_STATUSES.Prepared ||
        status === SERVICE_ORDER_STATUSES.Released
        ? { enabled: true }
        : {
            enabled: false,
            reasons: [terminal ? 'EXECUTION_CLOSED' : 'EXECUTION_IN_PROGRESS'],
            nextAction: null,
          },
    ),
  );

  const nextCommand = resolveNextCommand(commands, facts);

  return {
    availableCommands: commands,
    nextCommand,
    nextCommandLabel: nextCommand ? COMMAND_LABELS[nextCommand] : null,
  };
}

/**
 * Próximo comando: o primeiro HABILITADO na ordem de precedência operacional.
 *
 * A ordem não é a de declaração: um comando habilitado de despacho vem antes de
 * conclusão mesmo que apareça depois na lista.
 */
const NEXT_COMMAND_PRECEDENCE: OperationsCommandCode[] = [
  OPERATIONS_COMMANDS.Dispatch,
  OPERATIONS_COMMANDS.CheckIn,
  OPERATIONS_COMMANDS.Start,
  OPERATIONS_COMMANDS.Resume,
  OPERATIONS_COMMANDS.RegisterActual,
  OPERATIONS_COMMANDS.RegisterMeter,
  OPERATIONS_COMMANDS.RegisterFuel,
  OPERATIONS_COMMANDS.RegisterLabor,
  OPERATIONS_COMMANDS.RegisterEquipmentUsage,
  OPERATIONS_COMMANDS.RegisterMaterialUsage,
  OPERATIONS_COMMANDS.AttachEvidence,
  OPERATIONS_COMMANDS.RegisterSignature,
  OPERATIONS_COMMANDS.Complete,
];

/**
 * PRÓXIMO COMANDO.
 *
 * A precedência NÃO é uma lista fixa de "captura antes de conclusão". Ela segue o
 * princípio operacional: o que DESTRAVA o processo vem antes do que apenas o
 * prolonga. Concretamente:
 *
 *   1. Se a conclusão está LIBERADA, concluir é o próximo trabalho — a ordem já
 *      terminou o que tinha de fazer e continuar capturando dado é atraso.
 *   2. Se a conclusão está BLOQUEADA, o próximo comando é EXATAMENTE aquele que o
 *      gate aponta como saída. Não se escolhe outra captura: o gate já identificou
 *      o que falta.
 *   3. Caso contrário, vale a cascata operacional (despachar → chegar → iniciar →
 *      retomar → capturar).
 *
 * Uma lista fixa de precedência fazia o inverso: com a conclusão liberada, ela
 * recomendava "registrar realizado" — empurrando o operador para trabalho que já
 * estava feito.
 */
function resolveNextCommand(
  commands: AvailableCommand[],
  facts: CommandSurfaceFacts,
): OperationsCommandCode | null {
  const isEnabled = (code: OperationsCommandCode) =>
    commands.find((item) => item.code === code)?.enabled === true;

  // Um bloqueio ABERTO domina a próxima ação: resolver a exceção é o trabalho.
  if (facts.hasBlockingSituation) {
    const blockingNext = facts.completionGate.nextAction ?? facts.dispatchReadiness.nextAction;
    const mapped = completionToCommand(blockingNext) ?? stagesToCommand(blockingNext);
    if (mapped) {
      return mapped;
    }
  }

  // 1. Conclusão liberada: é o próximo trabalho.
  if (isEnabled(OPERATIONS_COMMANDS.Complete)) {
    return OPERATIONS_COMMANDS.Complete;
  }

  // 2. Conclusão bloqueada: a saída apontada pelo GATE é o próximo comando.
  if (
    facts.completionGate.blockingReasons.length > 0 &&
    (facts.status === SERVICE_ORDER_STATUSES.InExecution ||
      facts.status === SERVICE_ORDER_STATUSES.Paused)
  ) {
    const mapped = completionToCommand(facts.completionGate.nextAction);
    if (mapped && isEnabled(mapped)) {
      return mapped;
    }
    if (mapped) {
      return mapped;
    }
  }

  // 3. Cascata operacional.
  for (const code of NEXT_COMMAND_PRECEDENCE) {
    if (isEnabled(code)) {
      return code;
    }
  }
  return null;
}

/** Tradução de resolução de DESPACHO para o comando que a executa. */
function stagesToCommand(resolution: string | null): OperationsCommandCode | null {
  switch (resolution) {
    case 'CONFIRM_PLANNING':
    case 'COMPLETE_PLANNED_RESOURCES':
    case 'RESERVE_RESOURCES':
    case 'ADJUST_RESERVATION_WINDOW':
    case 'REPLACE_INACTIVE_RESOURCE':
    case 'ASSIGN_CREW':
    case 'ASSIGN_DRIVER':
    case 'REASSIGN_DRIVER':
    case 'REGISTER_QUALIFICATION':
    case 'ASSIGN_VEHICLE':
    case 'REASSIGN_VEHICLE':
    case 'ASSIGN_EQUIPMENT':
    case 'REASSIGN_EQUIPMENT':
    case 'CLOSE_MAINTENANCE':
    case 'ATTACH_REQUIRED_DOCUMENT':
    case 'DEFINE_OPERATIONAL_WINDOW':
    case 'RESCHEDULE_WINDOW':
    case 'REVIEW_CONTRACT':
      // Nenhum destes é um comando de EXECUÇÃO: são ações do planejamento, que
      // vive em outra superfície. Apontar para um comando de execução seria mentir.
      return null;
    default:
      return null;
  }
}

/** Tradução de resolução de CONCLUSÃO para o comando que a executa. */
function completionToCommand(resolution: string | null): OperationsCommandCode | null {
  switch (resolution) {
    case 'START_EXECUTION':
      return OPERATIONS_COMMANDS.Start;
    case 'RESUME_EXECUTION':
      return OPERATIONS_COMMANDS.Resume;
    case 'REGISTER_FINAL_METER':
      return OPERATIONS_COMMANDS.RegisterMeter;
    case 'REGISTER_FUEL':
      return OPERATIONS_COMMANDS.RegisterFuel;
    case 'REGISTER_LABOR_HOURS':
      return OPERATIONS_COMMANDS.RegisterLabor;
    case 'REGISTER_EQUIPMENT_HOURS':
      return OPERATIONS_COMMANDS.RegisterEquipmentUsage;
    case 'REGISTER_MATERIAL_USAGE':
      return OPERATIONS_COMMANDS.RegisterMaterialUsage;
    case 'REGISTER_MISSING_ACTUALS':
      return OPERATIONS_COMMANDS.RegisterActual;
    case 'ATTACH_EVIDENCE':
      return OPERATIONS_COMMANDS.AttachEvidence;
    case 'VERIFY_EVIDENCE':
      return OPERATIONS_COMMANDS.AttachEvidence;
    case 'REGISTER_SIGNATURE':
      return OPERATIONS_COMMANDS.RegisterSignature;
    case 'RESOLVE_SITUATION':
      return OPERATIONS_COMMANDS.Escalate;
    default:
      return null;
  }
}

/**
 * Mapa entre o comando desta superfície e o comando do domínio de execução, onde
 * ambos existem. Serve à auditoria e ao roteamento — nunca a uma segunda regra.
 */
export const COMMAND_TO_EXECUTION_COMMAND: Partial<
  Record<OperationsCommandCode, (typeof EXECUTION_COMMANDS)[keyof typeof EXECUTION_COMMANDS]>
> = {
  [OPERATIONS_COMMANDS.Start]: EXECUTION_COMMANDS.Start,
  [OPERATIONS_COMMANDS.Pause]: EXECUTION_COMMANDS.Pause,
  [OPERATIONS_COMMANDS.Resume]: EXECUTION_COMMANDS.Resume,
  [OPERATIONS_COMMANDS.Complete]: EXECUTION_COMMANDS.Complete,
  [OPERATIONS_COMMANDS.RecordProgress]: EXECUTION_COMMANDS.RecordExecution,
  [OPERATIONS_COMMANDS.RegisterLabor]: EXECUTION_COMMANDS.RecordQuantity,
  [OPERATIONS_COMMANDS.AttachEvidence]: EXECUTION_COMMANDS.RecordEvidence,
  [OPERATIONS_COMMANDS.ReportException]: EXECUTION_COMMANDS.RecordOccurrence,
};
