/**
 * MEASUREMENT COMMAND SURFACE — o BACKEND diz quais comandos existem e quais
 * estão habilitados. O frontend apenas representa.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O CÓDIGO QUE ESTE ARQUIVO TORNA IMPOSSÍVEL
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O que existia na tela era exatamente isto:
 *
 *     const canSubmit  = capabilities.canSubmit  && status === 'DRAFT';
 *     const canApprove = capabilities.canApprove && status === 'UNDER_REVIEW';
 *
 * Duas regras empresariais implementadas em React. Elas parecem inofensivas e
 * são a origem de todos os desvios desta capability: uma SEGUNDA implementação
 * da regra de aprovação, em outra linguagem, que pode divergir da primeira sem
 * que nenhum teste falhe. Quando a variação passou a bloquear aprovação, a tela
 * continuou habilitando o botão — e o operador recebia 409 de um comando que a
 * própria tela disse que era possível.
 *
 * Aqui o backend declara, para CADA comando:
 *
 *   - `code`              o comando que o backend aceita;
 *   - `enabled`           se pode ser executado AGORA, pelo motivo do domínio;
 *   - `blockingReasons`   códigos de bloqueio, não uma frase solta;
 *   - `reasonLabels`      o rótulo de cada motivo, na mesma ordem;
 *   - `nextAction`        o comando que destrava este;
 *   - `requiredPermission` a permissão exigida (a tela não recalcula RBAC).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não executa, não consulta banco, não decide autorização. Ele DECLARA, a partir
 * de fatos que a aplicação já levantou. E a MESMA função governa o comando: a
 * aplicação recusa com os mesmos motivos que a superfície publica — não existe
 * caminho em que o botão esteja habilitado e o backend recuse por um motivo que
 * a tela não conhecia.
 */

import type { EligibilityDimensionResult } from './billing-eligibility';
import type { DetectedVariance } from './measurement-variance';

// ═══════════════════════════════════════════════════════════════════════════════
// CATÁLOGO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Comandos desta capability.
 *
 * Os nomes de transição (`SUBMIT`, `START_REVIEW`, `APPROVE`, `REJECT`,
 * `RESUBMIT`) são os que o domínio de medição já usa: NÃO foram renomeados. Os
 * comandos genuinamente novos são `CREATE_MEASUREMENT` (existia como POST sem
 * nome), `AUTHORIZE_ADJUSTMENT` (existia como ajuste sem decisão) e
 * `RECORD_ACCEPTANCE` (não existia como comando).
 */
export const MEASUREMENT_SURFACE_COMMANDS = {
  CreateMeasurement: 'CREATE_MEASUREMENT',
  RegenerateMeasurement: 'REGENERATE_MEASUREMENT',
  UpdateItemMeasuredQuantity: 'UPDATE_ITEM_MEASURED_QUANTITY',
  AuthorizeAdjustment: 'AUTHORIZE_ADJUSTMENT',
  Submit: 'SUBMIT',
  StartReview: 'START_REVIEW',
  Approve: 'APPROVE',
  Reject: 'REJECT',
  Resubmit: 'RESUBMIT',
  RecordAcceptance: 'RECORD_ACCEPTANCE',
  ObtainCustomerAcceptance: 'OBTAIN_CUSTOMER_ACCEPTANCE',
  PrepareBilling: 'PREPARE_BILLING',
} as const;

export type MeasurementSurfaceCommandCode =
  (typeof MEASUREMENT_SURFACE_COMMANDS)[keyof typeof MEASUREMENT_SURFACE_COMMANDS];

/** Rótulo humano. Vive no backend porque a tela não redige ação empresarial. */
const COMMAND_LABELS: Record<MeasurementSurfaceCommandCode, string> = {
  CREATE_MEASUREMENT: 'Gerar medição',
  REGENERATE_MEASUREMENT: 'Regerar itens da medição',
  UPDATE_ITEM_MEASURED_QUANTITY: 'Alterar quantidade medida',
  AUTHORIZE_ADJUSTMENT: 'Autorizar ajuste',
  SUBMIT: 'Submeter medição',
  START_REVIEW: 'Iniciar análise',
  APPROVE: 'Aprovar medição',
  REJECT: 'Rejeitar medição',
  RESUBMIT: 'Reenviar medição',
  RECORD_ACCEPTANCE: 'Registrar aceite do cliente',
  OBTAIN_CUSTOMER_ACCEPTANCE: 'Solicitar aceite do cliente',
  PREPARE_BILLING: 'Preparar faturamento',
};

/** Permissão exigida, do vocabulário RBAC existente. Nenhuma permissão nova. */
const COMMAND_PERMISSIONS: Record<MeasurementSurfaceCommandCode, string> = {
  CREATE_MEASUREMENT: 'measurements:measurement:create',
  REGENERATE_MEASUREMENT: 'measurements:measurement:update',
  UPDATE_ITEM_MEASURED_QUANTITY: 'measurements:measurement:update',
  AUTHORIZE_ADJUSTMENT: 'measurements:measurement:update',
  SUBMIT: 'measurements:measurement:submit',
  START_REVIEW: 'measurements:measurement:review',
  APPROVE: 'measurements:measurement:approve',
  REJECT: 'measurements:measurement:reject',
  RESUBMIT: 'measurements:measurement:update',
  RECORD_ACCEPTANCE: 'measurements:measurement:accept',
  OBTAIN_CUSTOMER_ACCEPTANCE: 'measurements:measurement:accept',
  PREPARE_BILLING: 'billing:billing-record:prepare',
};

/**
 * Rótulo de cada código de bloqueio que esta capability produz.
 *
 * Vive no backend por um motivo operacional concreto: se a tela traduzisse os
 * códigos, um código NOVO apareceria como texto cru na tela do operador até
 * alguém lembrar de atualizar o frontend. Aqui o código desconhecido é o único
 * caso sem rótulo, e ele é visível.
 */
const REASON_LABELS: Record<string, string> = {
  // Medição e itens
  MEASUREMENT_NOT_EDITABLE: 'A medição não está mais em rascunho.',
  MEASUREMENT_ITEMS_REQUIRED: 'A medição não possui itens.',
  COMMERCIAL_REFERENCE_MISSING: 'Falta a referência comercial para precificar a medição.',
  SERVICE_ORDER_NOT_COMPLETED: 'A ordem de serviço não está concluída.',
  MEASUREMENT_LEGACY_ORIGIN: 'A medição foi criada antes da base publicada; a origem não pode ser trocada.',
  UNIT_NOT_ALLOWED: 'Unidade de medida não permitida pelo serviço.',
  ITEM_NOT_FOUND: 'Item de medição não encontrado.',

  // Base de medição
  MEASUREMENT_BASIS_NOT_PUBLISHED: 'A base de medição ainda não foi publicada pela execução.',
  MEASUREMENT_BASIS_NOT_READY: 'A base de medição publicada não está vigente.',
  MEASUREMENT_BASIS_EMPTY: 'A base de medição não possui linhas com realizado.',
  MEASUREMENT_BASIS_ORDER_MISMATCH: 'A base de medição pertence a outra ordem de serviço.',
  MEASUREMENT_BASIS_MALFORMED: 'A base de medição publicada está corrompida.',
  MEASUREMENT_BASIS_DUPLICATE_LINE: 'A base de medição possui linha duplicada.',
  EXECUTION_NOT_CLOSED: 'A execução ainda não foi fechada.',

  // Variação
  VARIANCE_REQUIRES_AUTHORIZATION: 'Existe variação acima da tolerância sem decisão registrada.',
  VARIANCE_ADJUSTMENT_NOT_APPLIED: 'O ajuste foi autorizado, mas ainda não foi aplicado ao item.',
  DUPLICATE_EXECUTION_ENTRY_SELECTION: 'A medição selecionou a mesma origem duas vezes.',
  EXECUTION_ENTRY_ALREADY_MEASURED: 'O realizado já foi medido em outra medição aprovada.',
  MEASUREMENT_DIVERGENCE_NOT_AUTHORIZED:
    'A quantidade medida excede o realizado sem ajuste autorizado.',
  INVALID_ADJUSTMENT_QUANTITY: 'A quantidade de ajuste é inválida.',
  QUANTITY_PRECISION_EXCEEDED: 'A quantidade excede a precisão da unidade de medida.',

  // Estados da medição
  INVALID_STATE: 'A medição não está no estado exigido para este comando.',
  ALREADY_RECORDED: 'A decisão já foi registrada.',

  // Aceite
  ACCEPTANCE_POLICY_NOT_APPLICABLE: 'A política comercial não exige aceite para esta entrega.',
  ACCEPTANCE_REJECTION_REASON_REQUIRED: 'A rejeição exige motivo declarado.',
  ACCEPTANCE_EVIDENCE_REQUIRED: 'A política exige evidência anexada ao aceite.',
  ACCEPTANCE_EXECUTION_NOT_COMPLETED: 'O aceite exige execução concluída.',
  CUSTOMER_ACCEPTANCE_PENDING: 'O aceite do cliente ainda não foi registrado.',
  CUSTOMER_ACCEPTANCE_REJECTED: 'O cliente recusou a entrega.',
  CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING: 'O aceite existe, mas falta a evidência que o sustenta.',

  // Faturamento
  MEASUREMENT_NOT_APPROVED: 'A medição precisa estar aprovada para faturar.',
  MEASUREMENT_MISSING: 'A ordem concluída ainda não possui medição.',
  PURCHASE_ORDER_REQUIRED: 'O cliente exige ordem de compra antes do faturamento.',
  COMMERCIAL_TERMS_DIVERGENCE: 'A condição de pagamento diverge da origem comercial.',
  BILLING_BASIS_MISSING: 'A medição não possui itens a faturar.',
  BILLING_BASIS_INCOMPLETE: 'Há item de medição sem preço apurado.',
  BILLING_ELIGIBILITY_BLOCKED: 'A elegibilidade de faturamento está bloqueada.',
  BILLING_ELIGIBILITY_NOT_EVALUATED:
    'A elegibilidade de faturamento ainda não foi avaliada para esta medição.',
};

export function labelForMeasurementReason(code: string): string {
  return REASON_LABELS[code] ?? code;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTRATO DE SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type MeasurementAvailableCommand = {
  code: MeasurementSurfaceCommandCode;
  label: string;
  enabled: boolean;
  /** Códigos de bloqueio. Vazio quando `enabled`. */
  blockingReasons: string[];
  /** Rótulo de cada motivo, na MESMA ordem de `blockingReasons`. */
  reasonLabels: string[];
  /** Comando que destrava este. `null` quando não há. */
  nextAction: MeasurementSurfaceCommandCode | null;
  requiredPermission: string;
};

export type MeasurementCommandSurface = {
  availableCommands: MeasurementAvailableCommand[];
  nextAction: { code: string; label: string; explanation: string } | null;
};

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE DECISÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Todo campo aqui é um FATO já observado. O módulo não lê nada.
 */
export type MeasurementCommandFacts = {
  serviceOrderId: string;
  measurementId: string | null;
  measurementStatus: string | null;

  /** A base publicada existe e está READY. */
  basisAvailable: boolean;
  /** A medição foi criada pelo caminho histórico (sem base). */
  measurementLegacyOrigin: boolean;

  /** Item count e se todos têm valor apurado. */
  itemCount: number;
  itemCountWithoutAmount: number;

  /** Variações que exigem decisão, já detectadas. */
  variancesRequiringDecision: DetectedVariance[];

  /** Aceite. */
  acceptanceRequired: boolean;
  acceptanceBlocked: boolean;
  acceptanceBlockingReason: string | null;
  acceptanceAlreadyRecordedForCycle: boolean;

  /** Elegibilidade de faturamento já avaliada. */
  eligibilityResult: string | null;
  eligibilityBlockingDimensions: EligibilityDimensionResult[];

  /** O ator tem a permissão? O backend já decidiu; aqui só se propaga. */
  hasPermission: (permission: string) => boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTRUÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

type CommandDecision =
  | { enabled: true }
  | {
      enabled: false;
      blockingReasons: string[];
      nextAction: MeasurementSurfaceCommandCode | null;
      reasonLabels?: string[];
    };

function buildCommand(
  facts: MeasurementCommandFacts,
  code: MeasurementSurfaceCommandCode,
  decision: CommandDecision,
): MeasurementAvailableCommand {
  const permission = COMMAND_PERMISSIONS[code];
  const authorised = facts.hasPermission(permission);

  /**
   * A autorização é um motivo como qualquer outro.
   *
   * Um comando sem permissão fica DESABILITADO, nunca OCULTO: ocultar faria o
   * operador concluir que o comando não existe, quando na verdade ele existe e
   * ele não pode executá-lo. As duas informações são diferentes.
   */
  if (!authorised) {
    return {
      code,
      label: COMMAND_LABELS[code],
      enabled: false,
      blockingReasons: ['NOT_AUTHORIZED'],
      reasonLabels: ['Sem permissão para este comando.'],
      nextAction: null,
      requiredPermission: permission,
    };
  }

  if (decision.enabled) {
    return {
      code,
      label: COMMAND_LABELS[code],
      enabled: true,
      blockingReasons: [],
      reasonLabels: [],
      nextAction: null,
      requiredPermission: permission,
    };
  }

  return {
    code,
    label: COMMAND_LABELS[code],
    enabled: false,
    blockingReasons: decision.blockingReasons,
    reasonLabels:
      decision.reasonLabels ?? decision.blockingReasons.map(labelForMeasurementReason),
    nextAction: decision.nextAction,
    requiredPermission: permission,
  };
}

/**
 * Constrói a superfície de comandos da medição.
 *
 * A REGRA DE HABILITAÇÃO VIVE AQUI, em UM lugar. A variação governa `APPROVE`;
 * a política de aceite governa `RECORD_ACCEPTANCE`; a elegibilidade governa
 * `PREPARE_BILLING`. Não existe segunda cópia.
 */
export function buildMeasurementCommandSurface(
  facts: MeasurementCommandFacts,
): MeasurementCommandSurface {
  const commands: MeasurementAvailableCommand[] = [];
  const status = facts.measurementStatus;
  const hasMeasurement = facts.measurementId !== null;

  // ── CRIAÇÃO ────────────────────────────────────────────────────────────────
  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement,
      hasMeasurement
        ? {
            enabled: false,
            blockingReasons: ['ALREADY_RECORDED'],
            nextAction: null,
            reasonLabels: ['Esta ordem já possui medição.'],
          }
        : !facts.basisAvailable
          ? {
              enabled: false,
              blockingReasons: ['MEASUREMENT_BASIS_NOT_PUBLISHED'],
              nextAction: null,
            }
          : { enabled: true },
    ),
  );

  // ── EDIÇÃO DE ITENS ────────────────────────────────────────────────────────
  //
  // `REGENERATE` e `UPDATE_ITEM` compartilham a MESMA condição: a medição precisa
  // estar em rascunho. Repetir a condição em dois lugares é como as duas
  // divergem depois.
  const editable = status === 'DRAFT';
  const editableDecision: CommandDecision = !hasMeasurement
    ? {
        enabled: false,
        blockingReasons: ['MEASUREMENT_MISSING'],
        nextAction: MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement,
      }
    : !editable
      ? {
          enabled: false,
          blockingReasons: ['MEASUREMENT_NOT_EDITABLE'],
          nextAction: status === 'REJECTED' ? MEASUREMENT_SURFACE_COMMANDS.Resubmit : null,
        }
      : facts.measurementLegacyOrigin
        ? {
            enabled: false,
            blockingReasons: ['MEASUREMENT_LEGACY_ORIGIN'],
            nextAction: null,
          }
        : { enabled: true };

  commands.push(
    buildCommand(facts, MEASUREMENT_SURFACE_COMMANDS.RegenerateMeasurement, editableDecision),
  );
  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.UpdateItemMeasuredQuantity,
      editableDecision,
    ),
  );

  // ── AJUSTE ─────────────────────────────────────────────────────────────────
  //
  // O ajuste só existe onde existe variação que o exige. Habilitá-lo "por via das
  // dúvidas" permitiria aumentar a quantidade medida sem desvio que o justifique —
  // e o ajuste é decisão com impacto financeiro, não campo livre.
  const needsAdjustment = facts.variancesRequiringDecision.length > 0;
  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment,
      !hasMeasurement
        ? { enabled: false, blockingReasons: ['MEASUREMENT_MISSING'], nextAction: null }
        : !editable
          ? {
              enabled: false,
              blockingReasons: ['MEASUREMENT_NOT_EDITABLE'],
              nextAction: null,
            }
          : !needsAdjustment
            ? {
                enabled: false,
                blockingReasons: ['VARIANCE_REQUIRES_AUTHORIZATION'],
                nextAction: null,
                reasonLabels: ['Nenhuma variação acima da tolerância aguarda ajuste.'],
              }
            : { enabled: true },
    ),
  );

  // ── TRÂNSITOS ──────────────────────────────────────────────────────────────
  const submitDecision: CommandDecision =
    status === 'DRAFT'
      ? facts.itemCount === 0
        ? {
            enabled: false,
            blockingReasons: ['MEASUREMENT_ITEMS_REQUIRED'],
            nextAction: MEASUREMENT_SURFACE_COMMANDS.RegenerateMeasurement,
          }
        : needsAdjustment
          ? {
              enabled: false,
              blockingReasons: facts.variancesRequiringDecision
                .map((item) => item.blockingReason)
                .filter((reason): reason is string => reason !== null),
              nextAction: MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment,
              reasonLabels: facts.variancesRequiringDecision
                .filter((item) => item.blockingReason !== null)
                .map((item) => item.explanation),
            }
          : { enabled: true }
      : {
          enabled: false,
          blockingReasons: [hasMeasurement ? 'INVALID_STATE' : 'MEASUREMENT_MISSING'],
          nextAction:
            status === 'REJECTED' ? MEASUREMENT_SURFACE_COMMANDS.Resubmit : null,
          reasonLabels: hasMeasurement
            ? ['Só uma medição em rascunho pode ser submetida.']
            : undefined,
        };
  commands.push(buildCommand(facts, MEASUREMENT_SURFACE_COMMANDS.Submit, submitDecision));

  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.StartReview,
      status === 'SUBMITTED'
        ? { enabled: true }
        : {
            enabled: false,
            blockingReasons: [hasMeasurement ? 'INVALID_STATE' : 'MEASUREMENT_MISSING'],
            nextAction: status === 'DRAFT' ? MEASUREMENT_SURFACE_COMMANDS.Submit : null,
            reasonLabels: hasMeasurement
              ? ['Só uma medição submetida pode entrar em análise.']
              : undefined,
          },
    ),
  );

  /**
   * APROVAÇÃO — o comando que a tela decidia sozinha.
   *
   * A variação é um motivo de bloqueio como qualquer outro, e o motivo vem do
   * DOMÍNIO da variação: o mesmo objeto que a providência recomendou. A tela não
   * recalcula nada.
   */
  const approvalBlockers = facts.variancesRequiringDecision
    .filter((item) => item.blockingReason !== null)
    .map((item) => item);
  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.Approve,
      status !== 'UNDER_REVIEW'
        ? {
            enabled: false,
            blockingReasons: [hasMeasurement ? 'INVALID_STATE' : 'MEASUREMENT_MISSING'],
            nextAction: status === 'SUBMITTED' ? MEASUREMENT_SURFACE_COMMANDS.StartReview : null,
            reasonLabels: hasMeasurement
              ? ['Só uma medição em análise pode ser aprovada.']
              : undefined,
          }
        : approvalBlockers.length > 0
          ? {
              enabled: false,
              blockingReasons: approvalBlockers.map(
                (item) => item.blockingReason ?? 'VARIANCE_REQUIRES_AUTHORIZATION',
              ),
              nextAction:
                approvalBlockers.every((item) => item.blockingReason === 'VARIANCE_ADJUSTMENT_NOT_APPLIED')
                  ? MEASUREMENT_SURFACE_COMMANDS.UpdateItemMeasuredQuantity
                  : MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment,
              reasonLabels: approvalBlockers.map((item) => item.explanation),
            }
          : facts.itemCountWithoutAmount > 0
            ? {
                enabled: false,
                blockingReasons: ['BILLING_BASIS_INCOMPLETE'],
                nextAction: MEASUREMENT_SURFACE_COMMANDS.UpdateItemMeasuredQuantity,
              }
            : { enabled: true },
    ),
  );

  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.Reject,
      status === 'UNDER_REVIEW'
        ? { enabled: true }
        : {
            enabled: false,
            blockingReasons: [hasMeasurement ? 'INVALID_STATE' : 'MEASUREMENT_MISSING'],
            nextAction: null,
            reasonLabels: hasMeasurement
              ? ['Só uma medição em análise pode ser rejeitada.']
              : undefined,
          },
    ),
  );

  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.Resubmit,
      status === 'REJECTED'
        ? { enabled: true }
        : {
            enabled: false,
            blockingReasons: [hasMeasurement ? 'INVALID_STATE' : 'MEASUREMENT_MISSING'],
            nextAction: null,
            reasonLabels: hasMeasurement
              ? ['Só uma medição rejeitada pode ser reenviada.']
              : undefined,
          },
    ),
  );

  // ── ACEITE ─────────────────────────────────────────────────────────────────
  //
  // O aceite exige medição APROVADA. Aceitar uma entrega sobre medição não
  // aprovada aceitaria um número que ainda pode mudar.
  const acceptanceEligible = status === 'APPROVED' && facts.acceptanceRequired;
  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance,
      !facts.acceptanceRequired
        ? {
            enabled: false,
            blockingReasons: ['ACCEPTANCE_POLICY_NOT_APPLICABLE'],
            nextAction: null,
          }
        : status !== 'APPROVED'
          ? {
              enabled: false,
              blockingReasons: ['MEASUREMENT_NOT_APPROVED'],
              nextAction: status === 'UNDER_REVIEW' ? MEASUREMENT_SURFACE_COMMANDS.Approve : null,
            }
          : facts.acceptanceAlreadyRecordedForCycle
            ? {
                enabled: false,
                blockingReasons: ['ALREADY_RECORDED'],
                nextAction: null,
                reasonLabels: ['A decisão de aceite deste ciclo já foi registrada.'],
              }
            : { enabled: true },
    ),
  );

  commands.push(
    buildCommand(
      facts,
      MEASUREMENT_SURFACE_COMMANDS.ObtainCustomerAcceptance,
      acceptanceEligible && facts.acceptanceBlocked
        ? { enabled: true }
        : {
            enabled: false,
            blockingReasons: facts.acceptanceRequired
              ? ['CUSTOMER_ACCEPTANCE_PENDING']
              : ['ACCEPTANCE_POLICY_NOT_APPLICABLE'],
            nextAction: facts.acceptanceRequired
              ? MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance
              : null,
            reasonLabels: facts.acceptanceRequired
              ? ['O aceite já está satisfeito ou depende da aprovação da medição.']
              : undefined,
          },
    ),
  );

  // ── FATURAMENTO ────────────────────────────────────────────────────────────
  //
  // Preparar faturamento é o comando que atravessa a fronteira desta capability.
  // Ele fica HABILITADO apenas quando a decisão de elegibilidade diz READY — e a
  // lista de motivos é literalmente a das dimensões bloqueantes já avaliadas.
  //
  // SEM AVALIAÇÃO NÃO EXISTE LISTA DE MOTIVOS. O primeiro rascunho publicava
  // `blockingReasons: []` quando a elegibilidade ainda não havia sido avaliada —
  // e um comando desabilitado SEM MOTIVO é indistinguível, para o operador, de
  // uma tela que não soube explicar. O motivo, nesse caso, é justamente a
  // ausência de avaliação, e ele passa a ser declarado.
  const eligibilityReady = facts.eligibilityResult === 'READY';
  const eligibilityBlockers = facts.eligibilityBlockingDimensions;
  const prepareBillingDecision: CommandDecision = eligibilityReady
    ? { enabled: true }
    : eligibilityBlockers.length > 0
      ? {
          enabled: false,
          blockingReasons: eligibilityBlockers.map((item) => item.reasonCode ?? item.dimension),
          nextAction: mapEligibilityActionToCommand(
            eligibilityBlockers.find((item) => item.nextActionCode !== null)?.nextActionCode ??
              null,
          ),
          reasonLabels: eligibilityBlockers.map((item) => item.detail),
        }
      : {
          enabled: false,
          blockingReasons: ['BILLING_ELIGIBILITY_NOT_EVALUATED'],
          nextAction: null,
          reasonLabels: [
            'A elegibilidade de faturamento ainda não foi avaliada para esta medição.',
          ],
        };

  commands.push(
    buildCommand(facts, MEASUREMENT_SURFACE_COMMANDS.PrepareBilling, prepareBillingDecision),
  );

  const nextAction = resolveNextAction(commands, facts);

  return { availableCommands: commands, nextAction };
}

/** Traduz a próxima ação de uma dimensão de elegibilidade em comando da superfície. */
function mapEligibilityActionToCommand(
  code: string | null,
): MeasurementSurfaceCommandCode | null {
  switch (code) {
    case 'CREATE_MEASUREMENT':
      return MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement;
    case 'APPROVE_MEASUREMENT':
      return MEASUREMENT_SURFACE_COMMANDS.Approve;
    case 'RESOLVE_VARIANCE':
      return MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment;
    case 'OBTAIN_CUSTOMER_ACCEPTANCE':
    case 'CORRECT_AND_REQUEST_ACCEPTANCE':
    case 'ATTACH_ACCEPTANCE_EVIDENCE':
      return MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance;
    case 'PREPARE_BILLING':
      return MEASUREMENT_SURFACE_COMMANDS.PrepareBilling;
    default:
      return null;
  }
}

/**
 * PRÓXIMA AÇÃO.
 *
 * A precedência segue o princípio operacional: o que DESTRAVA o processo vem
 * antes do que apenas o prolonga. Concretamente:
 *
 *   1. Se preparar faturamento está liberado, esse é o próximo trabalho.
 *   2. Se existe variação exigindo decisão, resolver a variação é o trabalho —
 *      e não submeter, que falharia.
 *   3. Se o aceite está pendente após aprovação, obtê-lo é o trabalho.
 *   4. Caso contrário, vale a cascata do ciclo da medição.
 *
 * A ORDEM IMPORTA e é declarada aqui, não na tela.
 */
function resolveNextAction(
  commands: MeasurementAvailableCommand[],
  facts: MeasurementCommandFacts,
): MeasurementCommandSurface['nextAction'] {
  const isEnabled = (code: MeasurementSurfaceCommandCode): boolean =>
    commands.find((item) => item.code === code)?.enabled === true;

  if (isEnabled(MEASUREMENT_SURFACE_COMMANDS.PrepareBilling)) {
    return {
      code: MEASUREMENT_SURFACE_COMMANDS.PrepareBilling,
      label: COMMAND_LABELS.PREPARE_BILLING,
      explanation:
        'A elegibilidade de faturamento está liberada: todas as condições comerciais foram atendidas.',
    };
  }

  if (isEnabled(MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment)) {
    const worst = facts.variancesRequiringDecision[0];
    return {
      code: MEASUREMENT_SURFACE_COMMANDS.AuthorizeAdjustment,
      label: COMMAND_LABELS.AUTHORIZE_ADJUSTMENT,
      explanation: worst
        ? worst.explanation
        : 'Existe variação acima da tolerância aguardando decisão comercial.',
    };
  }

  if (isEnabled(MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance)) {
    return {
      code: MEASUREMENT_SURFACE_COMMANDS.RecordAcceptance,
      label: COMMAND_LABELS.RECORD_ACCEPTANCE,
      explanation:
        'A medição está aprovada e a política comercial exige aceite do cliente antes do faturamento.',
    };
  }

  const cascade: MeasurementSurfaceCommandCode[] = [
    MEASUREMENT_SURFACE_COMMANDS.CreateMeasurement,
    MEASUREMENT_SURFACE_COMMANDS.Resubmit,
    MEASUREMENT_SURFACE_COMMANDS.Submit,
    MEASUREMENT_SURFACE_COMMANDS.StartReview,
    MEASUREMENT_SURFACE_COMMANDS.Approve,
  ];

  for (const code of cascade) {
    if (isEnabled(code)) {
      return {
        code,
        label: COMMAND_LABELS[code],
        explanation: explanationFor(code, facts),
      };
    }
  }

  return null;
}

function explanationFor(
  code: MeasurementSurfaceCommandCode,
  facts: MeasurementCommandFacts,
): string {
  switch (code) {
    case 'CREATE_MEASUREMENT':
      return facts.basisAvailable
        ? 'A base de medição publicada pela execução está pronta e pode ser consumida.'
        : 'Ainda não há base de medição publicada.';
    case 'RESUBMIT':
      return 'A medição foi rejeitada na análise; reenviá-la devolve o ciclo de conferência.';
    case 'SUBMIT':
      return 'A medição está em rascunho e sem decisão comercial pendente; submetê-la inicia a análise.';
    case 'START_REVIEW':
      return 'A medição foi submetida e aguarda o início formal da análise.';
    case 'APPROVE':
      return 'A medição está em análise e não possui variação pendente de decisão.';
    default:
      return '';
  }
}
