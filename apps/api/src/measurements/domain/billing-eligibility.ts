/**
 * BILLING ELIGIBILITY — o modelo de DECISÃO que transforma a cadeia em
 * `READY_TO_BILL`.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A elegibilidade de faturamento existia como FILTRO SQL dentro da worklist de
 * faturamento (`billing.repository.listWorklist`): `m.status = 'APPROVED'`,
 * totais de item, política do snapshot. Havia duas consequências medidas:
 *
 *   1. O operador via o bucket `measurement_pending` e NÃO via por quê. "Medição
 *      em SUBMITTED" é um fato; "falta o aceite do cliente" é o motivo, e o motivo
 *      não existia como dado.
 *   2. O ACEITE DO CLIENTE NÃO PARTICIPAVA. Um serviço que o cliente recusou
 *      podia aparecer como `ready` porque o filtro só olhava a medição.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A DECISÃO É UMA LISTA DE DIMENSÕES, NÃO UM BOOLEANO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada dimensão responde sozinha "por que ainda não pode faturar?", com um
 * status próprio. O resultado agregado é derivado das dimensões — nunca declarado
 * à parte — porque um result escrito à mão pode discordar das próprias dimensões.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não cria registro de faturamento, não emite documento, não abre recebível.
 * Ele PARAMETRIZA a worklist existente: `READY` aqui é o bucket `ready` de lá.
 * Uma segunda máquina de faturamento seria uma segunda verdade sobre dinheiro.
 */

import {
  BILLING_ENTITLEMENT_POLICIES,
  type BillingEntitlementPolicy,
} from '../../billing/domain/billing-entitlement';

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

export const ELIGIBILITY_DIMENSIONS = {
  ExecutionClosed: 'EXECUTION_CLOSED',
  MeasurementApproved: 'MEASUREMENT_APPROVED',
  CustomerAcceptance: 'CUSTOMER_ACCEPTANCE',
  PurchaseOrder: 'PURCHASE_ORDER',
  CommercialTerms: 'COMMERCIAL_TERMS',
  PricingBasis: 'PRICING_BASIS',
  VarianceCleared: 'VARIANCE_CLEARED',
  BillingRecordAbsent: 'BILLING_RECORD_ABSENT',
} as const;

export type EligibilityDimension =
  (typeof ELIGIBILITY_DIMENSIONS)[keyof typeof ELIGIBILITY_DIMENSIONS];

export const ELIGIBILITY_STATUSES = {
  Satisfied: 'SATISFIED',
  /** Depende de fato FUTURO (aceite do cliente ainda não registrado). */
  Pending: 'PENDING',
  /** Exige resolução de algo conhecido e resolvível agora. */
  Blocked: 'BLOCKED',
  NotApplicable: 'NOT_APPLICABLE',
} as const;

export type EligibilityStatus = (typeof ELIGIBILITY_STATUSES)[keyof typeof ELIGIBILITY_STATUSES];

export const ELIGIBILITY_RESULTS = {
  /** O único resultado que libera faturamento. É o `READY_TO_BILL`. */
  Ready: 'READY',
  /** Espera fato futuro. */
  Pending: 'PENDING',
  /** Bloqueado por algo que já existe. */
  Blocked: 'BLOCKED',
} as const;

export type EligibilityResult = (typeof ELIGIBILITY_RESULTS)[keyof typeof ELIGIBILITY_RESULTS];

/** Rótulo humano de cada dimensão. Vive no backend: a tela não redige regra. */
const DIMENSION_LABELS: Record<EligibilityDimension, string> = {
  EXECUTION_CLOSED: 'Execução fechada',
  MEASUREMENT_APPROVED: 'Medição aprovada',
  CUSTOMER_ACCEPTANCE: 'Aceite do cliente',
  PURCHASE_ORDER: 'Ordem de compra do cliente',
  COMMERCIAL_TERMS: 'Condições comerciais',
  PRICING_BASIS: 'Base de preço',
  VARIANCE_CLEARED: 'Variações decididas',
  BILLING_RECORD_ABSENT: 'Registro de faturamento não preparado',
};

const STATUS_LABELS: Record<EligibilityStatus, string> = {
  SATISFIED: 'Atendido',
  PENDING: 'Pendente',
  BLOCKED: 'Bloqueado',
  NOT_APPLICABLE: 'Não aplicável',
};

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fatos já observados. Este módulo NÃO lê nada — recebe e decide.
 *
 * Cada campo é `null` quando o fato não pôde ser lido, e `null` NUNCA é
 * interpretado como "atendido". A escolha é conservadora no ponto certo:
 * desconhecer uma condição não pode liberar faturamento.
 */
export type BillingEligibilityFacts = {
  serviceOrderId: string;
  measurementId: string | null;
  unitId: string;

  /** `so.execution_closures` existe para a ordem. */
  executionClosed: boolean;
  executionClosedAt: string | null;

  /** Medição: `null` quando não existe. */
  measurementStatus: string | null;
  measurementApprovedAt: string | null;
  /** Soma dos itens precificados. `null` quando algum item não tem valor. */
  measurementTotalAmount: string | null;
  measurementCurrencyCode: string | null;
  measurementItemCount: number;

  /** Aceite: estado já derivado pela política. */
  acceptanceRequired: boolean;
  acceptanceState: string;
  acceptanceBlockingReason: string | null;

  /** Variações que exigem decisão. */
  variancesRequiringDecision: number;
  varianceBlockingReason: string | null;

  /** Política comercial resolvida do snapshot. */
  policy: BillingEntitlementPolicy;

  /** Ordem de compra do cliente. */
  purchaseOrderRequired: boolean;
  purchaseOrderPresent: boolean;

  /** Condições comerciais: `null` quando não há fonte a comparar. */
  commercialTermsAuthoritative: string | null;
  commercialTermsDeclared: string | null;
  commercialTermsMismatch: boolean;

  /** Já existe registro de faturamento PREPARED para a medição? */
  billingRecordPrepared: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type EligibilityDimensionResult = {
  dimension: EligibilityDimension;
  label: string;
  status: EligibilityStatus;
  statusLabel: string;
  /** Código estável do motivo. `null` quando atendido ou não aplicável. */
  reasonCode: string | null;
  /** Explicação para o operador. Produzida aqui, nunca na tela. */
  detail: string;
  /** Comando que resolve esta dimensão. `null` quando não há o que fazer. */
  nextActionCode: string | null;
  nextActionLabel: string | null;
  /** `true` quando esta dimensão sozinha impede o faturamento. */
  blocking: boolean;
};

export type BillingEligibilityDecision = {
  result: EligibilityResult;
  dimensions: EligibilityDimensionResult[];
  /** Códigos das dimensões que impedem faturamento, na ordem de gravidade. */
  blockingReasons: string[];
  /** A PRIMEIRA ação que destrava. `null` quando `result === READY`. */
  nextAction: { code: string; label: string } | null;
  /** Valor apurado. `null` quando não há base completa de preço. */
  totalAmount: string | null;
  currencyCode: string | null;
  /** Resumo de uma frase para o painel de decisão. */
  summary: string;
  /** Explicação didática do que acontece ao faturar. */
  explanation: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// DIMENSÕES
// ═══════════════════════════════════════════════════════════════════════════════

function dimension(
  code: EligibilityDimension,
  status: EligibilityStatus,
  detail: string,
  extra: {
    reasonCode?: string | null;
    nextActionCode?: string | null;
    nextActionLabel?: string | null;
  } = {},
): EligibilityDimensionResult {
  return {
    dimension: code,
    label: DIMENSION_LABELS[code],
    status,
    statusLabel: STATUS_LABELS[status],
    reasonCode: extra.reasonCode ?? null,
    detail,
    nextActionCode: extra.nextActionCode ?? null,
    nextActionLabel: extra.nextActionLabel ?? null,
    blocking: status === ELIGIBILITY_STATUSES.Pending || status === ELIGIBILITY_STATUSES.Blocked,
  };
}

/**
 * EXECUÇÃO FECHADA.
 *
 * Pré-requisito de TODA a cadeia: sem fechamento não há base de medição
 * congelada, e medir sobre execução aberta mediria um alvo em movimento.
 */
function evaluateExecutionClosed(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (facts.executionClosed) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.ExecutionClosed,
      ELIGIBILITY_STATUSES.Satisfied,
      'A execução foi fechada e os realizados estão congelados.',
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.ExecutionClosed,
    ELIGIBILITY_STATUSES.Blocked,
    'A execução ainda não foi fechada; não existe base de medição congelada.',
    { reasonCode: 'EXECUTION_NOT_CLOSED', nextActionCode: 'CLOSE_EXECUTION', nextActionLabel: 'Fechar a execução' },
  );
}

/**
 * MEDIÇÃO APROVADA.
 *
 * A política `MEASUREMENT_APPROVED` é a única que exige aprovação. As políticas
 * `FIXED_PRICE`, `PERIODIC` e `MILESTONE` NÃO exigem: elas cobram por valor
 * contratado, e exigir aprovação delas bloquearia faturamento legítimo. Esta
 * distinção já existia em `billing-entitlement.ts` e é PRESERVADA aqui — o
 * modelo de decisão não cria uma segunda regra de entitlement.
 */
function evaluateMeasurementApproved(
  facts: BillingEligibilityFacts,
): EligibilityDimensionResult {
  const requiresApproval = facts.policy === BILLING_ENTITLEMENT_POLICIES.MeasurementApproved;

  if (!requiresApproval) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.MeasurementApproved,
      ELIGIBILITY_STATUSES.NotApplicable,
      `A política ${facts.policy} fatura por base contratada e não exige aprovação de medição.`,
    );
  }

  if (facts.measurementStatus === null) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.MeasurementApproved,
      ELIGIBILITY_STATUSES.Blocked,
      'A ordem concluída ainda não possui medição.',
      {
        reasonCode: 'MEASUREMENT_MISSING',
        nextActionCode: 'CREATE_MEASUREMENT',
        nextActionLabel: 'Gerar a medição a partir da execução',
      },
    );
  }

  if (facts.measurementStatus === 'APPROVED') {
    return dimension(
      ELIGIBILITY_DIMENSIONS.MeasurementApproved,
      ELIGIBILITY_STATUSES.Satisfied,
      'A medição está aprovada.',
    );
  }

  return dimension(
    ELIGIBILITY_DIMENSIONS.MeasurementApproved,
    ELIGIBILITY_STATUSES.Blocked,
    `A medição está em ${facts.measurementStatus}. A política exige aprovação antes do faturamento.`,
    {
      reasonCode: 'MEASUREMENT_NOT_APPROVED',
      nextActionCode: 'APPROVE_MEASUREMENT',
      nextActionLabel: 'Concluir a aprovação da medição',
    },
  );
}

/**
 * ACEITE DO CLIENTE.
 *
 * A dimensão lê o ESTADO já derivado pela política de aceite. Ela não reavalia a
 * política: duas avaliações da mesma regra divergiriam na primeira manutenção.
 */
function evaluateCustomerAcceptance(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (!facts.acceptanceRequired) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
      ELIGIBILITY_STATUSES.NotApplicable,
      'Nenhuma fonte comercial exige aceite formal de entrega para esta OS.',
    );
  }

  if (facts.acceptanceBlockingReason === null) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
      ELIGIBILITY_STATUSES.Satisfied,
      'O aceite do cliente foi registrado e sustenta o faturamento.',
    );
  }

  // PENDING é dependência de FATO FUTURO; BLOCKED é algo que já é conhecido e
  // precisa de ação. A distinção muda o tom do trabalho: esperar não é agir.
  const status =
    facts.acceptanceState === 'PENDING'
      ? ELIGIBILITY_STATUSES.Pending
      : ELIGIBILITY_STATUSES.Blocked;

  const nextActionByReason: Record<string, { code: string; label: string; detail: string }> = {
    CUSTOMER_ACCEPTANCE_PENDING: {
      code: 'OBTAIN_CUSTOMER_ACCEPTANCE',
      label: 'Registrar aceite do cliente',
      detail: 'A política comercial exige aceite do cliente e nenhuma decisão foi registrada.',
    },
    CUSTOMER_ACCEPTANCE_REJECTED: {
      code: 'CORRECT_AND_REQUEST_ACCEPTANCE',
      label: 'Corrigir a medição e solicitar novo aceite',
      detail: 'O cliente recusou a entrega. O faturamento permanece bloqueado até a correção e um novo aceite.',
    },
    CUSTOMER_ACCEPTANCE_EVIDENCE_MISSING: {
      code: 'ATTACH_ACCEPTANCE_EVIDENCE',
      label: 'Anexar evidência do aceite',
      detail: 'O aceite foi registrado, mas a política exige o documento que o sustenta.',
    },
  };

  const action = nextActionByReason[facts.acceptanceBlockingReason];
  return dimension(
    ELIGIBILITY_DIMENSIONS.CustomerAcceptance,
    status,
    action?.detail ?? 'O aceite do cliente não está satisfeito.',
    {
      reasonCode: facts.acceptanceBlockingReason,
      nextActionCode: action?.code ?? null,
      nextActionLabel: action?.label ?? null,
    },
  );
}

/** ORDEM DE COMPRA — preserva `assertPurchaseOrderRequirement` como fonte única. */
function evaluatePurchaseOrder(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (!facts.purchaseOrderRequired) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.PurchaseOrder,
      ELIGIBILITY_STATUSES.NotApplicable,
      'O cliente não exige ordem de compra antes do faturamento.',
    );
  }
  if (facts.purchaseOrderPresent) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.PurchaseOrder,
      ELIGIBILITY_STATUSES.Satisfied,
      'A ordem de compra exigida está registrada.',
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.PurchaseOrder,
    ELIGIBILITY_STATUSES.Blocked,
    'O cliente exige ordem de compra e ela não está registrada na OS.',
    {
      reasonCode: 'PURCHASE_ORDER_REQUIRED',
      nextActionCode: 'REGISTER_PURCHASE_ORDER',
      nextActionLabel: 'Registrar a ordem de compra do cliente',
    },
  );
}

/** CONDIÇÕES COMERCIAIS — divergência entre declarado e autoritativo. */
function evaluateCommercialTerms(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (facts.commercialTermsAuthoritative === null) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.CommercialTerms,
      ELIGIBILITY_STATUSES.NotApplicable,
      'Nenhuma fonte comercial declara condição de pagamento; não há divergência a detectar.',
    );
  }
  if (facts.commercialTermsMismatch) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.CommercialTerms,
      ELIGIBILITY_STATUSES.Blocked,
      'A condição de pagamento declarada diverge da condição comercial de origem.',
      {
        reasonCode: 'COMMERCIAL_TERMS_DIVERGENCE',
        nextActionCode: 'RESOLVE_COMMERCIAL_TERMS',
        nextActionLabel: 'Alinhar a condição de pagamento com a origem',
      },
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.CommercialTerms,
    ELIGIBILITY_STATUSES.Satisfied,
    'A condição de pagamento confere com a fonte comercial.',
  );
}

/**
 * BASE DE PREÇO.
 *
 * Sem ao menos um item precificado não existe valor a faturar. Este é o motivo
 * pelo qual o bucket `billing_basis_missing` da worklist existente existe — aqui
 * ele ganha nome e próxima ação.
 */
function evaluatePricingBasis(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (facts.policy !== BILLING_ENTITLEMENT_POLICIES.MeasurementApproved) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.PricingBasis,
      ELIGIBILITY_STATUSES.NotApplicable,
      `A política ${facts.policy} resolve o valor da base contratada, não de itens medidos.`,
    );
  }
  if (facts.measurementItemCount === 0) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.PricingBasis,
      ELIGIBILITY_STATUSES.Blocked,
      'A medição não possui itens.',
      {
        reasonCode: 'BILLING_BASIS_MISSING',
        nextActionCode: 'REGENERATE_MEASUREMENT_ITEMS',
        nextActionLabel: 'Regerar os itens da medição',
      },
    );
  }
  if (facts.measurementTotalAmount === null) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.PricingBasis,
      ELIGIBILITY_STATUSES.Blocked,
      'Há item de medição sem preço apurado; não existe valor total a faturar.',
      {
        reasonCode: 'BILLING_BASIS_INCOMPLETE',
        nextActionCode: 'RESOLVE_MEASUREMENT_PRICING',
        nextActionLabel: 'Resolver o preço dos itens sem valor',
      },
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.PricingBasis,
    ELIGIBILITY_STATUSES.Satisfied,
    'Todos os itens possuem valor apurado.',
  );
}

/** VARIAÇÕES — decisão comercial pendente sobre desvio. */
function evaluateVarianceCleared(facts: BillingEligibilityFacts): EligibilityDimensionResult {
  if (facts.variancesRequiringDecision === 0) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.VarianceCleared,
      ELIGIBILITY_STATUSES.Satisfied,
      'Nenhuma variação exige decisão comercial.',
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.VarianceCleared,
    ELIGIBILITY_STATUSES.Blocked,
    `${facts.variancesRequiringDecision} variação(ões) acima da tolerância aguardam decisão comercial.`,
    {
      reasonCode: facts.varianceBlockingReason ?? 'VARIANCE_REQUIRES_AUTHORIZATION',
      nextActionCode: 'RESOLVE_VARIANCE',
      nextActionLabel: 'Resolver a variação',
    },
  );
}

/**
 * REGISTRO DE FATURAMENTO AINDA NÃO PREPARADO.
 *
 * Esta dimensão não bloqueia: ela apenas declara que o próximo passo é preparar.
 * Depois de preparado, a OS sai desta capability e entra no ciclo de faturamento,
 * que tem modelo próprio.
 */
function evaluateBillingRecordAbsent(
  facts: BillingEligibilityFacts,
): EligibilityDimensionResult {
  if (facts.billingRecordPrepared) {
    return dimension(
      ELIGIBILITY_DIMENSIONS.BillingRecordAbsent,
      ELIGIBILITY_STATUSES.NotApplicable,
      'O registro de faturamento já foi preparado; a OS saiu desta capability.',
    );
  }
  return dimension(
    ELIGIBILITY_DIMENSIONS.BillingRecordAbsent,
    ELIGIBILITY_STATUSES.Satisfied,
    'Ainda não há registro de faturamento preparado.',
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Avalia a elegibilidade de faturamento.
 *
 * Função PURA e DETERMINÍSTICA. A ordem das dimensões é a ordem de GRAVIDADE
 * operacional: primeiro o que impede a cadeia inteira, depois o que depende de
 * decisão alheia, depois o que é contingência documental.
 */
export function evaluateBillingEligibility(
  facts: BillingEligibilityFacts,
): BillingEligibilityDecision {
  const dimensions: EligibilityDimensionResult[] = [
    evaluateExecutionClosed(facts),
    evaluateMeasurementApproved(facts),
    evaluateVarianceCleared(facts),
    evaluateCustomerAcceptance(facts),
    evaluatePurchaseOrder(facts),
    evaluateCommercialTerms(facts),
    evaluatePricingBasis(facts),
    evaluateBillingRecordAbsent(facts),
  ];

  const blocking = dimensions.filter((item) => item.blocking);

  /**
   * RESULTADO DERIVADO. Nunca declarado à parte.
   *
   *   há BLOQUEADO -> BLOCKED  (existe algo a resolver agora)
   *   só PENDENTE  -> PENDING  (existe algo a ESPERAR)
   *   nada         -> READY    (o único liberador)
   */
  const result: EligibilityResult =
    blocking.length === 0
      ? ELIGIBILITY_RESULTS.Ready
      : blocking.some((item) => item.status === ELIGIBILITY_STATUSES.Blocked)
        ? ELIGIBILITY_RESULTS.Blocked
        : ELIGIBILITY_RESULTS.Pending;

  // Próxima ação: a primeira dimensão bloqueante que declara um comando. Ordenar
  // por gravidade e devolver UMA evita a tela escolher qual dos motivos mostrar.
  const firstActionable = blocking.find((item) => item.nextActionCode !== null);

  const totalAmount =
    facts.policy === BILLING_ENTITLEMENT_POLICIES.MeasurementApproved
      ? facts.measurementTotalAmount
      : // Base contratada: o valor é resolvido no ato de preparar (`resolveContractualBillingLine`).
        // Declarar um número aqui seria uma SEGUNDA conta do mesmo dinheiro.
        null;

  return {
    result,
    dimensions,
    blockingReasons: blocking.map((item) => item.reasonCode ?? item.dimension),
    nextAction: firstActionable
      ? {
          code: firstActionable.nextActionCode!,
          label: firstActionable.nextActionLabel ?? firstActionable.nextActionCode!,
        }
      : null,
    totalAmount,
    currencyCode: totalAmount === null ? null : facts.measurementCurrencyCode,
    summary: summarize(result, blocking, totalAmount, facts.measurementCurrencyCode),
    explanation: explain(result, blocking),
  };
}

function summarize(
  result: EligibilityResult,
  blocking: EligibilityDimensionResult[],
  totalAmount: string | null,
  currencyCode: string | null,
): string {
  if (result === ELIGIBILITY_RESULTS.Ready) {
    const amount =
      totalAmount !== null && currencyCode !== null ? ` Valor ${currencyCode} ${totalAmount}.` : '';
    return `Pronto para faturar: todas as condições comerciais foram atendidas.${amount}`;
  }
  const first = blocking[0];
  const rest = blocking.length - 1;
  return `${blocking.length} condição(ões) impedem o faturamento. Primeiro impeditivo: ${
    first?.detail ?? 'não declarado'
  }${rest > 0 ? ` (+${rest} adicional(is))` : ''}`;
}

function explain(result: EligibilityResult, blocking: EligibilityDimensionResult[]): string {
  if (result === ELIGIBILITY_RESULTS.Ready) {
    return 'A OS pode entrar na fila de faturamento existente: execução fechada, medição aprovada, variações decididas, aceite satisfeito e condições comerciais conferidas. Preparar o faturamento consome esta medição como base e não a altera.';
  }
  if (result === ELIGIBILITY_RESULTS.Pending) {
    return `O faturamento depende de um fato que ainda não ocorreu: ${blocking
      .map((item) => item.label)
      .join(', ')}. Nenhuma ação interna resolve — é preciso a decisão do cliente.`;
  }
  return `O faturamento está bloqueado por condição conhecida: ${blocking
    .map((item) => item.label)
    .join(', ')}. Resolver o primeiro impeditivo é o próximo trabalho.`;
}

/**
 * A elegibilidade REBAIXOU de READY para outro resultado?
 *
 * O fato `BILLING_ELIGIBILITY_BLOCKED` só é publicado quando existe estado
 * anterior liberado: publicar bloqueio contínuo transformaria um impeditivo
 * estável em fluxo de eventos, e o consumidor passaria a tratar ruído como
 * mudança.
 */
export function transitionedAwayFromReady(
  previousResult: EligibilityResult | null,
  nextResult: EligibilityResult,
): boolean {
  return previousResult === ELIGIBILITY_RESULTS.Ready && nextResult !== ELIGIBILITY_RESULTS.Ready;
}

/** A elegibilidade passou a liberar faturamento? */
export function transitionedToReady(
  previousResult: EligibilityResult | null,
  nextResult: EligibilityResult,
): boolean {
  return nextResult === ELIGIBILITY_RESULTS.Ready && previousResult !== ELIGIBILITY_RESULTS.Ready;
}
