/**
 * ACCEPTANCE POLICY — quando o aceite do cliente é REQUISITO de faturamento.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * `service-acceptance.ts` já sabia registrar um aceite: autorização, execução
 * concluída, resultado válido, motivo de rejeição obrigatório, pendência em
 * rejeição. O que ele NUNCA soube responder foi a pergunta anterior:
 *
 *     "o aceite é sequer aplicável a ESTA entrega?"
 *
 * A resposta estava ausente porque não havia fonte de política: nenhuma tabela,
 * nenhum snapshot, nenhuma regra. Sem ela, ou o aceite era exigido de todo
 * serviço (bloqueando faturamento de contrato que nunca previu aceite) ou não
 * era exigido de nenhum (liberando faturamento de entrega que o cliente recusou).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DE ONDE VEM A POLÍTICA — E POR QUE NÃO É INVENTADA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Precedência DECLARADA, da fonte mais específica para a mais genérica:
 *
 *   1. `contract_snapshot.acceptanceRequired`  — o contrato é a fonte comercial
 *   2. `service_snapshot.acceptancePolicy`     — o serviço declara se exige aceite
 *   3. `client.purchase_order_requirement`     — cliente que exige PO antes de
 *                                                 faturar também exige aceite
 *                                                 formal de entrega
 *   4. Nenhuma das três → `NOT_REQUIRED`
 *
 * O item 4 é uma DECISÃO REGISTRADA, não um esquecimento: exigir aceite sem
 * fonte bloquearia faturamento de serviço cujo contrato não o prevê, e o
 * sistema não pode inventar requisito comercial. A lacuna fica VISÍVEL no read
 * model (`policySource: 'DEFAULT'`), para que a ausência de fonte seja um dado e
 * não uma suposição.
 */

import {
  ACCEPTANCE_RESULTS,
  assertExecutionHistoryIntact,
  recordAcceptance,
  type AcceptancePendingIssue,
  type AcceptanceResult,
  type ServiceAcceptance,
} from '../../service-orders/domain/service-acceptance';
import {
  ServiceAcceptanceError,
  SERVICE_ACCEPTANCE_ERROR_CODES,
} from '../../service-orders/domain/service-acceptance-errors';

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

export const ACCEPTANCE_POLICIES = {
  /** O contrato/serviço não previu aceite. Faturamento não depende dele. */
  NotRequired: 'NOT_REQUIRED',
  /** Aceite requerido antes de faturar. */
  RequiredBeforeBilling: 'REQUIRED_BEFORE_BILLING',
  /** Aceite requerido E exigindo evidência/signatura anexada. */
  RequiredWithEvidence: 'REQUIRED_WITH_EVIDENCE',
} as const;

export type AcceptancePolicy = (typeof ACCEPTANCE_POLICIES)[keyof typeof ACCEPTANCE_POLICIES];

/**
 * Estado da DIMENSÃO de aceite. Não é status da medição — é um eixo próprio,
 * exatamente como o prompt exige (medição e aceite são estados independentes).
 */
export const ACCEPTANCE_STATES = {
  /** Política diz que não é aplicável. Não bloqueia. */
  NotRequired: 'NOT_REQUIRED',
  /** Aplicável e ainda sem decisão registrada. Bloqueia faturamento. */
  Pending: 'PENDING',
  /** Decisão ACCEPTED registrada. Não bloqueia. */
  Accepted: 'ACCEPTED',
  /** Decisão REJECTED registrada. Bloqueia até correção e novo ciclo. */
  Rejected: 'REJECTED',
} as const;

export type AcceptanceState = (typeof ACCEPTANCE_STATES)[keyof typeof ACCEPTANCE_STATES];

/** Origem da política aplicada — declarada para que a tela não adivinhe. */
export const ACCEPTANCE_POLICY_SOURCES = {
  Contract: 'CONTRACT',
  Service: 'SERVICE',
  ClientRequirement: 'CLIENT_REQUIREMENT',
  Default: 'DEFAULT',
} as const;

export type AcceptancePolicySource =
  (typeof ACCEPTANCE_POLICY_SOURCES)[keyof typeof ACCEPTANCE_POLICY_SOURCES];

// ═══════════════════════════════════════════════════════════════════════════════
// RESOLUÇÃO DA POLÍTICA
// ═══════════════════════════════════════════════════════════════════════════════

export type AcceptancePolicyFacts = {
  contractSnapshot: Record<string, unknown> | null;
  serviceSnapshot: Record<string, unknown> | null;
  /**
   * Exigência de PO do cliente, já lida de `pty.clients`. `null` significa
   * "não consultado" — e nesse caso a política NÃO é inferida por ele, porque
   * ausência de consulta não é ausência de requisito.
   */
  clientPurchaseOrderRequirement: string | null;
};

export type ResolvedAcceptancePolicy = {
  policy: AcceptancePolicy;
  source: AcceptancePolicySource;
  /** Por que esta política. Texto para o painel de decisão. */
  reason: string;
  /** Quando a política exige evidência além da decisão. */
  requiresEvidence: boolean;
};

function readBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Resolve a política de aceite a partir de fatos comerciais já observados.
 *
 * Função PURA. Não lê banco, não lê relógio.
 */
export function resolveAcceptancePolicy(
  facts: AcceptancePolicyFacts,
): ResolvedAcceptancePolicy {
  // 1. CONTRATO — a fonte comercial mais específica.
  const terms = facts.contractSnapshot?.['commercialTerms'];
  const commercialTerms = terms && typeof terms === 'object' && !Array.isArray(terms)
    ? terms as Record<string, unknown>
    : null;
  const contractRequired = readBoolean(facts.contractSnapshot?.['acceptanceRequired'] ??
    commercialTerms?.['acceptanceRequired']);
  if (contractRequired === true) {
    const evidenceRequired = readBoolean(facts.contractSnapshot?.['acceptanceEvidenceRequired'] ??
      commercialTerms?.['acceptanceEvidenceRequired']);
    return evidenceRequired === true
      ? {
          policy: ACCEPTANCE_POLICIES.RequiredWithEvidence,
          source: ACCEPTANCE_POLICY_SOURCES.Contract,
          reason: 'O contrato exige aceite formal de entrega com evidência anexada.',
          requiresEvidence: true,
        }
      : {
          policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
          source: ACCEPTANCE_POLICY_SOURCES.Contract,
          reason: 'O contrato exige aceite formal de entrega antes do faturamento.',
          requiresEvidence: false,
        };
  }
  if (contractRequired === false) {
    return {
      policy: ACCEPTANCE_POLICIES.NotRequired,
      source: ACCEPTANCE_POLICY_SOURCES.Contract,
      reason: 'O contrato declara expressamente que não há aceite formal de entrega.',
      requiresEvidence: false,
    };
  }

  // 2. SERVIÇO — declara a política do tipo de serviço.
  const servicePolicy = readString(facts.serviceSnapshot?.['acceptancePolicy']);
  if (servicePolicy === ACCEPTANCE_POLICIES.RequiredWithEvidence) {
    return {
      policy: ACCEPTANCE_POLICIES.RequiredWithEvidence,
      source: ACCEPTANCE_POLICY_SOURCES.Service,
      reason: 'O serviço exige aceite com evidência anexada antes do faturamento.',
      requiresEvidence: true,
    };
  }
  if (servicePolicy === ACCEPTANCE_POLICIES.RequiredBeforeBilling) {
    return {
      policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
      source: ACCEPTANCE_POLICY_SOURCES.Service,
      reason: 'O serviço exige aceite do cliente antes do faturamento.',
      requiresEvidence: false,
    };
  }
  if (servicePolicy === ACCEPTANCE_POLICIES.NotRequired) {
    return {
      policy: ACCEPTANCE_POLICIES.NotRequired,
      source: ACCEPTANCE_POLICY_SOURCES.Service,
      reason: 'O serviço declara que não há aceite formal de entrega.',
      requiresEvidence: false,
    };
  }

  // 3. EXIGÊNCIA DO CLIENTE — cliente que exige PO antes de faturar também exige
  // aceite formal: é o mesmo controle de liberação documental, visto no outro
  // lado do contrato.
  if (facts.clientPurchaseOrderRequirement === 'BEFORE_BILLING') {
    return {
      policy: ACCEPTANCE_POLICIES.RequiredBeforeBilling,
      source: ACCEPTANCE_POLICY_SOURCES.ClientRequirement,
      reason:
        'O cadastro do cliente exige ordem de compra antes do faturamento e, por consequência, aceite formal de entrega.',
      requiresEvidence: false,
    };
  }

  // 4. NENHUMA FONTE — decisão registrada de não exigir, com a lacuna declarada.
  return {
    policy: ACCEPTANCE_POLICIES.NotRequired,
    source: ACCEPTANCE_POLICY_SOURCES.Default,
    reason:
      'Nenhuma fonte comercial declarou exigência de aceite (contrato, serviço ou cadastro do cliente). O faturamento não é bloqueado por aceite.',
    requiresEvidence: false,
  };
}

export function requiresCustomerAcceptance(policy: AcceptancePolicy): boolean {
  return policy !== ACCEPTANCE_POLICIES.NotRequired;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ESTADO DA DIMENSÃO
// ═══════════════════════════════════════════════════════════════════════════════

/** Decisão de aceite já persistida (linha de `msr.customer_acceptances`). */
export type PersistedAcceptance = {
  id: string;
  cycleNumber: number;
  result: string;
  observation: string;
  rejectionReason: string | null;
  evidenceId: string | null;
  signatureId: string | null;
  customerSignerName: string | null;
  acceptedByIdentityId: string;
  occurredAt: string;
};

/**
 * Estado da dimensão de aceite.
 *
 * A ÚLTIMA decisão do ciclo vigente governa. Uma rejeição seguida de correção e
 * novo aceite tem o segundo aceite como verdade — mas a rejeição permanece na
 * história, porque ela é o que justificou a correção.
 */
export function deriveAcceptanceState(input: {
  policy: AcceptancePolicy;
  latestAcceptance: PersistedAcceptance | null;
}): {
  state: AcceptanceState;
  blocksBilling: boolean;
  blockingReason: string | null;
  nextActionCode: string | null;
  nextActionLabel: string | null;
} {
  if (!requiresCustomerAcceptance(input.policy)) {
    return {
      state: ACCEPTANCE_STATES.NotRequired,
      blocksBilling: false,
      blockingReason: null,
      nextActionCode: null,
      nextActionLabel: null,
    };
  }

  const latest = input.latestAcceptance;
  if (!latest) {
    return {
      state: ACCEPTANCE_STATES.Pending,
      blocksBilling: true,
      blockingReason: 'CUSTOMER_ACCEPTANCE_PENDING',
      nextActionCode: 'OBTAIN_CUSTOMER_ACCEPTANCE',
      nextActionLabel: 'Registrar aceite do cliente',
    };
  }

  if (latest.result === 'ACCEPTED') {
    // Política com evidência: aceite sem evidência NÃO satisfaz. A decisão existe,
    // mas o documento que a sustenta não — e é o documento que o cliente questiona
    // depois.
    if (input.policy === ACCEPTANCE_POLICIES.RequiredWithEvidence && !latest.evidenceId) {
      return {
        state: ACCEPTANCE_STATES.Accepted,
        blocksBilling: true,
        blockingReason: 'CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING',
        nextActionCode: 'ATTACH_ACCEPTANCE_EVIDENCE',
        nextActionLabel: 'Anexar evidência do aceite',
      };
    }
    return {
      state: ACCEPTANCE_STATES.Accepted,
      blocksBilling: false,
      blockingReason: null,
      nextActionCode: null,
      nextActionLabel: null,
    };
  }

  return {
    state: ACCEPTANCE_STATES.Rejected,
    blocksBilling: true,
    blockingReason: 'CUSTOMER_ACCEPTANCE_REJECTED',
    nextActionCode: 'CORRECT_AND_REQUEST_ACCEPTANCE',
    nextActionLabel: 'Corrigir a medição e solicitar novo aceite',
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// REGISTRO DO ACEITE — REUTE O DOMÍNIO EXISTENTE
// ═══════════════════════════════════════════════════════════════════════════════

export type RecordAcceptanceCommandInput = {
  measurementId: string;
  serviceOrderId: string;
  executionStatus: string;
  policy: AcceptancePolicy;
  result: AcceptanceResult;
  observation: string;
  rejectionReason?: string | null;
  evidenceId?: string | null;
  signatureId?: string | null;
  customerSignerName?: string | null;
  actorIdentityId: string;
  occurredAt: string;
  currentCycle: number;
  existingDecisionForCycle: PersistedAcceptance | null;
};

export type RecordAcceptanceOutcome = {
  acceptance: ServiceAcceptance;
  pendingIssue: AcceptancePendingIssue | null;
  auditEventType: 'SERVICE_ACCEPTED' | 'SERVICE_REJECTED';
  cycleNumber: number;
  domainEventType: 'CUSTOMER_ACCEPTANCE_RECORDED' | 'CUSTOMER_REJECTION_RECORDED';
  rejectionReason: string | null;
};

/**
 * Aplica a regra de aceite REUSANDO `recordAcceptance`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE NÃO UMA SEGUNDA REGRA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `recordAcceptance` já implementa: autorização obrigatória, execução concluída,
 * resultado válido, duplicidade barrada, motivo de rejeição obrigatório e
 * pendência em rejeição. Reescrever isso aqui criaria duas verdades sobre a
 * MESMA entrega — o defeito exato que esta capability existe para eliminar.
 *
 * `policy` aplica um requisito ADICIONAL sobre a decisão (não substitui a regra
 * existente): uma política que exige evidência recusa aceite sem evidência.
 */
export function applyAcceptancePolicy(
  input: RecordAcceptanceCommandInput,
): RecordAcceptanceOutcome {
  if (!requiresCustomerAcceptance(input.policy)) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.POLICY_NOT_APPLICABLE);
  }

  if (input.result === ACCEPTANCE_RESULTS.Rejected) {
    const reason = readString(input.rejectionReason ?? null);
    if (!reason) {
      throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.REJECTION_REASON_REQUIRED);
    }
  }
  if (
    input.policy === ACCEPTANCE_POLICIES.RequiredWithEvidence &&
    input.result === ACCEPTANCE_RESULTS.Accepted &&
    !input.evidenceId
  ) {
    throw new ServiceAcceptanceError(SERVICE_ACCEPTANCE_ERROR_CODES.EVIDENCE_REQUIRED);
  }

  // Reuso literal do domínio existente. `existingAcceptance` é a decisão do
  // CICLO corrente: uma rejeição anterior não impede um novo aceite, mas uma
  // decisão já tomada neste ciclo impede a segunda.
  const outcome = recordAcceptance(
    {
      serviceOrderId: input.serviceOrderId,
      executionStatus: input.executionStatus,
      result: input.result,
      observation: input.observation,
      acceptedByIdentityId: input.actorIdentityId,
      acceptedAt: input.occurredAt,
      evidenceId: input.evidenceId ?? null,
      // O MOTIVO atravessa para o domínio: é ele que abre a pendência de
      // correção. Sem passar aqui, a pendência voltaria a carregar a observação.
      rejectionReason: input.rejectionReason ?? null,
    },
    {
      authorized: true,
      existingAcceptance: input.existingDecisionForCycle ? toServiceAcceptance(input.existingDecisionForCycle) : null,
    },
  );

  return {
    acceptance: outcome.acceptance,
    pendingIssue: outcome.pendingIssue,
    auditEventType: outcome.audit.eventType,
    cycleNumber: input.currentCycle,
    domainEventType:
      input.result === ACCEPTANCE_RESULTS.Accepted
        ? 'CUSTOMER_ACCEPTANCE_RECORDED'
        : 'CUSTOMER_REJECTION_RECORDED',
    rejectionReason:
      input.result === ACCEPTANCE_RESULTS.Rejected ? readString(input.rejectionReason ?? null) : null,
  };
}

function toServiceAcceptance(row: PersistedAcceptance): ServiceAcceptance {
  return {
    serviceOrderId: '',
    result: row.result as AcceptanceResult,
    acceptedByIdentityId: row.acceptedByIdentityId,
    acceptedAt: row.occurredAt,
    observation: row.observation,
    evidenceIds: row.evidenceId ? [row.evidenceId] : [],
    rejectionReason: row.rejectionReason,
  };
}

/**
 * Uma rejeição NUNCA altera o histórico da execução. Reexposto aqui para que o
 * teste desta capability declare a garantia no domínio de aceite, e não apenas
 * confie numa função de outro módulo.
 */
export function assertAcceptancePreservesExecution<T>(execution: Readonly<T>): Readonly<T> {
  return assertExecutionHistoryIntact(execution);
}
