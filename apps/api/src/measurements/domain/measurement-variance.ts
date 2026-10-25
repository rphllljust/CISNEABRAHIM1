/**
 * VARIANCE ENGINE — PLANEJADO × REALIZADO × MEDIDO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * A conferência de medição comparava as três quantidades NA TELA, em
 * `utils/measurement-variance.ts`, com uma regra que só respondia "igual ou
 * diferente". Ela não tinha tolerância, não tinha severidade, não sabia quanto a
 * diferença custa e não dizia ao operador o que fazer.
 *
 * Consequência medida: um desvio de 15% em horas de equipamento (R$ 7.200 de
 * exposição) aparecia com o MESMO peso visual de um arredondamento de 0,01, e a
 * aprovação podia seguir sem que ninguém tivesse DECIDIDO sobre o desvio. A
 * variação existia como pixels, não como fato de negócio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * AS TRÊS VERDADES SÃO DIFERENTES — E NUNCA SE IGUALAM POR CONVENIÊNCIA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   PLANEJADO  é a expectativa contratada  (so.planned_resources / service_snapshot)
 *   REALIZADO  é o que aconteceu           (so.execution_actuals, congelado no fechamento)
 *   MEDIDO     é o reconhecimento comercial (msr.measurement_items.measured_quantity)
 *
 * `actual = measured` é o atalho que apaga a decisão comercial. Ele é proibido
 * aqui: as três colunas existem separadamente, e a divergência entre MEDIDO e
 * REALIZADO é justamente a variação que precisa de autorização.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não conhece HTTP, não formata
 * texto. Recebe fatos observados e devolve a decisão. O repositório persiste; a
 * aplicação aplica.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO FECHADO
// ═══════════════════════════════════════════════════════════════════════════════

export const VARIANCE_DIMENSIONS = {
  Quantity: 'QUANTITY',
  LaborHours: 'LABOR_HOURS',
  EquipmentHours: 'EQUIPMENT_HOURS',
  VehicleDistance: 'VEHICLE_DISTANCE',
  FuelVolume: 'FUEL_VOLUME',
  MaterialQuantity: 'MATERIAL_QUANTITY',
  ThirdPartyAmount: 'THIRD_PARTY_AMOUNT',
  UnitPrice: 'UNIT_PRICE',
  LineAmount: 'LINE_AMOUNT',
} as const;

export type VarianceDimension = (typeof VARIANCE_DIMENSIONS)[keyof typeof VARIANCE_DIMENSIONS];

export const VARIANCE_SEVERITIES = {
  None: 'NONE',
  Low: 'LOW',
  Medium: 'MEDIUM',
  High: 'HIGH',
  Critical: 'CRITICAL',
} as const;

export type VarianceSeverity = (typeof VARIANCE_SEVERITIES)[keyof typeof VARIANCE_SEVERITIES];

const SEVERITY_WEIGHT: Record<VarianceSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  NONE: 4,
};

export const VARIANCE_DECISIONS = {
  None: 'NONE',
  Acknowledge: 'ACKNOWLEDGE',
  AuthorizeAdjustment: 'AUTHORIZE_ADJUSTMENT',
  RejectMeasurement: 'REJECT_MEASUREMENT',
} as const;

export type VarianceDecision = (typeof VARIANCE_DECISIONS)[keyof typeof VARIANCE_DECISIONS];

/**
 * Origem da tolerância aplicada. Declarada porque "tolerância de 5%" sem fonte é
 * um número inventado, e um número inventado não pode bloquear faturamento.
 */
export const TOLERANCE_SOURCES = {
  /** O contrato da OS declara `contract_snapshot.varianceTolerance`. */
  Contract: 'CONTRACT',
  /** O serviço declara `service_snapshot.varianceTolerance`. */
  Service: 'SERVICE',
  /** Nenhuma fonte declarou: aplica-se a tolerância padrão do domínio. */
  Default: 'DEFAULT',
} as const;

export type ToleranceSource = (typeof TOLERANCE_SOURCES)[keyof typeof TOLERANCE_SOURCES];

/**
 * TOLERÂNCIA PADRÃO — decisão registrada, não valor escolhido em runtime.
 *
 * 5% é o ponto em que uma diferença deixa de ser ruído de captura de campo
 * (arredondamento de odômetro, hora apontada por minuto) e passa a ser desvio de
 * execução. Ela NÃO substitui uma tolerância contratual: quando o contrato
 * declara, o contrato governa.
 *
 * A tolerância nunca é recebida por request: o cliente não define o próprio
 * critério de exceção.
 */
export const DEFAULT_VARIANCE_TOLERANCE_PERCENTAGE = 5;

/**
 * LIMIARES DE SEVERIDADE — múltiplos da tolerância aplicada.
 *
 * Um desvio dentro da tolerância é `LOW` (registro informativo). Acima dela a
 * gravidade cresce em relação ao PRÓPRIO critério aceito — não em relação a um
 * número fixo — porque "o dobro do tolerado" é a mesma pergunta em qualquer
 * contrato.
 */
export const SEVERITY_THRESHOLDS = {
  MEDIUM_MULTIPLE: 2,
  HIGH_MULTIPLE: 4,
  CRITICAL_MULTIPLE: 10,
} as const;

/**
 * Impacto financeiro acima do qual um desvio já ALTO vira CRÍTICO.
 *
 * Em reais: R$ 50.000 de exposição não é detalhe operacional em nenhum cenário
 * deste domínio (a maior ordem do portfólio sintético gira em torno de R$ 200
 * mil). O valor é um limiar de ESCALONAMENTO, não de aprovação: ele muda quem
 * precisa olhar, não se o faturamento para.
 */
export const CRITICAL_FINANCIAL_IMPACT = 50_000;

// ═══════════════════════════════════════════════════════════════════════════════
// FATOS DE ENTRADA
// ═══════════════════════════════════════════════════════════════════════════════

/** Uma dimensão observada da medição. Todos os valores são STRING decimal. */
export type VarianceObservation = {
  dimension: VarianceDimension;
  /** Chave lógica estável dentro da medição (unidade, item ou código). */
  dimensionKey: string;
  /** `null` quando o planejamento não declarou meta — nunca zero. */
  plannedValue: string | null;
  /** `null` quando a execução não registrou o realizado. */
  actualValue: string | null;
  /** `null` quando o item ainda não tem quantidade medida. */
  measuredValue: string | null;
  /** Unidade de medida do valor. `null` para dimensões monetárias. */
  unitOfMeasure: string | null;
  /** Preço unitário aplicado, para converter delta em impacto financeiro. */
  unitPrice: string | null;
  /** Moeda do impacto. `null` quando não há impacto monetário a declarar. */
  currencyCode: string | null;
  /** Item de medição relacionado, quando a observação vem de um item. */
  measurementItemId: string | null;
};

/** Tolerância resolvida, já com a fonte declarada. */
export type ResolvedTolerance = {
  percentage: number;
  source: ToleranceSource;
};

export type VarianceDetectionInput = {
  measurementId: string;
  serviceOrderId: string;
  unitId: string;
  /** Tolerância declarada pelo contrato ou pelo serviço, se existir. */
  declaredTolerancePercentage: number | null;
  declaredToleranceSource: ToleranceSource | null;
  observations: VarianceObservation[];
  /** Existe ajuste autorizado pendente de aplicação? Muda a decisão exigida. */
  hasAuthorizedAdjustment: boolean;
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA
// ═══════════════════════════════════════════════════════════════════════════════

export type DetectedVariance = {
  dimension: VarianceDimension;
  dimensionKey: string;
  measurementItemId: string | null;
  plannedValue: string | null;
  actualValue: string | null;
  measuredValue: string | null;
  unitOfMeasure: string | null;
  absoluteDelta: string;
  /** Percentual sobre a BASE DE REFERÊNCIA. `null` quando não há base. */
  percentageDelta: number | null;
  tolerancePercentage: number;
  toleranceSource: ToleranceSource;
  severity: VarianceSeverity;
  /** Impacto financeiro absoluto. `null` quando não há preço para converter. */
  financialImpact: string | null;
  currencyCode: string | null;
  requiresDecision: boolean;
  decisionKind: VarianceDecision;
  blockingReason: string | null;
  recommendedResolution: string | null;
  /** Frase que explica o desvio. Produzida AQUI, nunca na tela. */
  explanation: string;
};

export type VarianceDetectionResult = {
  variances: DetectedVariance[];
  /** Só as que exigem decisão — o que bloqueia aprovação. */
  decisionRequired: DetectedVariance[];
  /** Aprovação liberada do ponto de vista de variação? */
  approvalClearable: boolean;
  /** Maior severidade detectada. `NONE` quando não há desvio relevante. */
  highestSeverity: VarianceSeverity;
  /** Soma do impacto financeiro das variações que exigem decisão. */
  financialExposure: string | null;
  currencyCode: string | null;
  tolerance: ResolvedTolerance;
  /** Resumo de uma frase. Vai para o read model e para a trilha. */
  summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// APOIO PURO
// ═══════════════════════════════════════════════════════════════════════════════

/** Decimal em string. Devolve `null` para entrada ausente ou não numérica. */
function decimalOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function absOf(value: number): number {
  return value < 0 ? -value : value;
}

/** Formata um decimal com no máximo `scale` casas, sem notação científica. */
function formatDecimal(value: number, scale: number): string {
  const rounded = Math.round(value * 10 ** scale) / 10 ** scale;
  return rounded.toFixed(scale).replace(/\.?0+$/, '') || '0';
}

/**
 * Formata VALOR MONETÁRIO com as casas da coluna do banco (`numeric(18,4)`).
 *
 * POR QUE NÃO REUTILIZA `formatDecimal`
 *
 * `formatDecimal` remove zeros à direita porque quantidade `46.000` e `46` são a
 * MESMA grandeza, e exibir três casas de `Horas` seria ruído. Dinheiro é
 * diferente: `7200` e `7200.0000` são o mesmo montante, mas o read model publica
 * valor monetário com escala fixa para que o consumidor nunca precise adivinhar
 * as casas — e para que a soma na tela não dependa de formatação.
 */
function formatMoney(value: number): string {
  return value.toFixed(4);
}

/**
 * BASE DE REFERÊNCIA do percentual.
 *
 * A pergunta "15% acima de quê?" não tem resposta universal, e escolher a base
 * errada produz percentual com aparência de fato. A base é DECLARADA por
 * comparação, dentro de `detectMeasurementVariances`:
 *
 *   PLANEJADO ↔ reconhecido  — base é o PLANEJADO. Sem plano, base é `null` e o
 *                              percentual também (não se divide por zero nem se
 *                              inventa 100%).
 *   REALIZADO ↔ medido       — base é o REALIZADO. É sempre conhecida: a
 *                              comparação só existe quando há realizado.
 *
 * `tolerancePercentage === 0` FECHA a tolerância: qualquer diferença entra em
 * `MEDIUM` (ver `classifySeverity`). É o comportamento correto para um contrato
 * que declara tolerância zero — e é diferente de "sem tolerância declarada".
 */

export function resolveTolerance(input: {
  declaredPercentage: number | null;
  declaredSource: ToleranceSource | null;
}): ResolvedTolerance {
  if (
    input.declaredPercentage !== null &&
    Number.isFinite(input.declaredPercentage) &&
    input.declaredPercentage >= 0
  ) {
    return {
      percentage: input.declaredPercentage,
      source: input.declaredSource ?? TOLERANCE_SOURCES.Contract,
    };
  }
  return {
    percentage: DEFAULT_VARIANCE_TOLERANCE_PERCENTAGE,
    source: TOLERANCE_SOURCES.Default,
  };
}

/** Severidade a partir do desvio relativo e do impacto financeiro. */
export function classifySeverity(input: {
  percentageDelta: number | null;
  tolerancePercentage: number;
  financialImpact: number | null;
}): VarianceSeverity {
  const { percentageDelta, tolerancePercentage, financialImpact } = input;

  // Sem percentual calculável não há como graduar: toda diferença observável com
  // valores presentes é ao menos LOW. Um desvio sem graduação não pode virar
  // CRITICAL por ausência de dado.
  if (percentageDelta === null) {
    return VARIANCE_SEVERITIES.Low;
  }

  const ratio =
    tolerancePercentage > 0 ? percentageDelta / tolerancePercentage : Number.POSITIVE_INFINITY;

  let severity: VarianceSeverity;
  if (ratio <= 1) {
    severity = VARIANCE_SEVERITIES.Low;
  } else if (ratio <= SEVERITY_THRESHOLDS.MEDIUM_MULTIPLE) {
    severity = VARIANCE_SEVERITIES.Medium;
  } else if (ratio <= SEVERITY_THRESHOLDS.HIGH_MULTIPLE) {
    severity = VARIANCE_SEVERITIES.High;
  } else {
    severity = VARIANCE_SEVERITIES.Critical;
  }

  // Escalonamento por exposição: um desvio já ALTO com impacto acima do limiar
  // sobe para CRÍTICO. Um desvio LOW nunca sobe por valor — diferença pequena em
  // ordem grande continua pequena.
  if (
    financialImpact !== null &&
    absOf(financialImpact) >= CRITICAL_FINANCIAL_IMPACT &&
    (severity === VARIANCE_SEVERITIES.High || severity === VARIANCE_SEVERITIES.Medium)
  ) {
    return VARIANCE_SEVERITIES.Critical;
  }

  return severity;
}

/** Decisão exigida pela severidade. */
function decisionFor(severity: VarianceSeverity): VarianceDecision {
  switch (severity) {
    case VARIANCE_SEVERITIES.Critical:
    case VARIANCE_SEVERITIES.High:
      return VARIANCE_DECISIONS.AuthorizeAdjustment;
    case VARIANCE_SEVERITIES.Medium:
      return VARIANCE_DECISIONS.Acknowledge;
    default:
      return VARIANCE_DECISIONS.None;
  }
}

/** Por que a aprovação está bloqueada. `null` quando não bloqueia. */
function blockingReasonFor(input: {
  severity: VarianceSeverity;
  dimension: VarianceDimension;
  hasAuthorizedAdjustment: boolean;
}): string | null {
  if (input.severity !== VARIANCE_SEVERITIES.Critical && input.severity !== VARIANCE_SEVERITIES.High) {
    return null;
  }
  // Já existe ajuste autorizado: o bloqueio deixa de ser "ninguém decidiu" e passa
  // a ser "a decisão não foi aplicada ao item".
  return input.hasAuthorizedAdjustment
    ? 'VARIANCE_ADJUSTMENT_NOT_APPLIED'
    : 'VARIANCE_REQUIRES_AUTHORIZATION';
}

function recommendedResolutionFor(severity: VarianceSeverity): string | null {
  switch (severity) {
    case VARIANCE_SEVERITIES.Critical:
    case VARIANCE_SEVERITIES.High:
      return 'AUTHORIZE_ADJUSTMENT';
    case VARIANCE_SEVERITIES.Medium:
      return 'ACKNOWLEDGE_VARIANCE';
    default:
      return null;
  }
}

const DIMENSION_LABELS: Record<VarianceDimension, string> = {
  QUANTITY: 'Quantidade',
  LABOR_HOURS: 'Horas de mão de obra',
  EQUIPMENT_HOURS: 'Horas de equipamento',
  VEHICLE_DISTANCE: 'Distância de veículo',
  FUEL_VOLUME: 'Combustível',
  MATERIAL_QUANTITY: 'Material',
  THIRD_PARTY_AMOUNT: 'Serviço de terceiro',
  UNIT_PRICE: 'Preço unitário',
  LINE_AMOUNT: 'Valor de linha',
};

export function varianceDimensionLabel(dimension: VarianceDimension): string {
  return DIMENSION_LABELS[dimension];
}

/** Explicação do desvio, em uma frase. A tela não redige isto. */
function explainVariance(input: {
  dimension: VarianceDimension;
  planned: number | null;
  actual: number | null;
  measured: number | null;
  percentageDelta: number | null;
  tolerancePercentage: number;
  severity: VarianceSeverity;
  baseLabel: 'PLANNED' | 'ACTUAL' | null;
  financialImpact: number | null;
  currencyCode: string | null;
}): string {
  const label = DIMENSION_LABELS[input.dimension];
  const parts: string[] = [];

  const measured = input.measured;
  const planned = input.planned;
  const actual = input.actual;

  if (planned !== null && measured !== null) {
    parts.push(`${label}: planejado ${formatDecimal(planned, 3)}, medido ${formatDecimal(measured, 3)}`);
  } else if (actual !== null && measured !== null) {
    parts.push(`${label}: realizado ${formatDecimal(actual, 3)}, medido ${formatDecimal(measured, 3)}`);
  } else {
    parts.push(`${label}: comparação indisponível`);
  }

  if (actual !== null && measured !== null && absOf(actual - measured) > 0.000_001) {
    parts.push(`realizado ${formatDecimal(actual, 3)} difere do medido`);
  }

  if (input.percentageDelta !== null && input.baseLabel !== null) {
    const direction = input.percentageDelta >= 0 ? 'acima' : 'abaixo';
    parts.push(
      `${formatDecimal(absOf(input.percentageDelta), 2)}% ${direction} do ${
        input.baseLabel === 'PLANNED' ? 'planejado' : 'realizado'
      } (tolerância ${formatDecimal(input.tolerancePercentage, 2)}%)`,
    );
  } else {
    parts.push(`sem base para percentual (tolerância ${formatDecimal(input.tolerancePercentage, 2)}%)`);
  }

  if (input.financialImpact !== null && input.currencyCode) {
    parts.push(
      `impacto ${input.currencyCode} ${formatDecimal(absOf(input.financialImpact), 2)}`,
    );
  }

  parts.push(`severidade ${input.severity}`);
  return `${parts.join('; ')}.`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DETECÇÃO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Detecta as variações da medição.
 *
 * Função PURA: mesmo `input`, mesmo `output`. Isso é o que torna possível provar
 * em teste que a decisão é determinística e que a tela não participa dela.
 */
export function detectMeasurementVariances(
  input: VarianceDetectionInput,
): VarianceDetectionResult {
  const tolerance = resolveTolerance({
    declaredPercentage: input.declaredTolerancePercentage,
    declaredSource: input.declaredToleranceSource,
  });

  const variances: DetectedVariance[] = [];

  for (const observation of input.observations) {
    const planned = decimalOf(observation.plannedValue);
    const actual = decimalOf(observation.actualValue);
    const measured = decimalOf(observation.measuredValue);

    if (actual === null && measured === null) {
      continue;
    }

    /**
     * ─────────────────────────────────────────────────────────────────────────
     * TRÊS VERDADES, DUAS COMPARAÇÕES — E A PIOR DELAS GOVERNA
     * ─────────────────────────────────────────────────────────────────────────
     *
     * Um `measured` isolado contra o PLANO não basta. O caso real que importa é
     * outro: a execução fez 46h e o operador reconheceu 40h no comercial. Contra
     * o plano de 40h não há desvio NENHUM — e a medição esconderia 6h de serviço
     * executado que deixaram de ser cobrados.
     *
     * Comparar as DUAS distâncias fecha o buraco:
     *
     *   PLANEJADO ↔ o valor reconhecido   "cobrei o que combinei?"
     *   REALIZADO ↔ MEDIDO                "cobrei o que fiz?"
     *
     * O delta publicado é o de MAIOR magnitude. Uma linha de variação descreve
     * uma dimensão; declarar dois deltas na mesma linha faria a severidade (e o
     * bloqueio) depender de QUAL delta o leitor escolhesse.
     */
    const recognitionDelta =
      measured !== null ? (planned === null ? measured : measured - planned) : null;
    const billingDelta = measured !== null && actual !== null ? measured - actual : null;

    const candidates: Array<{
      delta: number;
      base: number | null;
      baseLabel: 'PLANNED' | 'ACTUAL' | null;
    }> = [];

    if (recognitionDelta !== null) {
      candidates.push({
        delta: recognitionDelta,
        base: planned,
        baseLabel: planned === null ? null : 'PLANNED',
      });
    }
    if (billingDelta !== null && absOf(billingDelta) > 0.000_001) {
      candidates.push({
        delta: billingDelta,
        base: actual,
        baseLabel: 'ACTUAL',
      });
    }

    if (candidates.length === 0) {
      continue;
    }

    // A comparação com MAIOR magnitude governa a severidade e o bloqueio.
    const governing = candidates.reduce((worst, current) =>
      absOf(current.delta) > absOf(worst.delta) ? current : worst,
    );

    // O delta publicado é o GOVERNADOR; quando a divergência de reconhecimento é
    // idêntica em módulo, o primeiro candidato (contra o PLANO) permanece.
    const delta = governing.delta;

    // Diferença zero não é variação: não gera linha nem bloqueia nada.
    if (absOf(delta) < 0.000_001) {
      continue;
    }

    const referenceValue = governing.base;
    const base = { value: referenceValue, label: governing.baseLabel };
    const percentageDelta = referenceValue === null ? null : (delta / referenceValue) * 100;

    const unitPrice = decimalOf(observation.unitPrice);
    const financialImpact =
      unitPrice === null ? null : absOf(delta) * unitPrice;

    const severity = classifySeverity({
      percentageDelta: percentageDelta === null ? null : absOf(percentageDelta),
      tolerancePercentage: tolerance.percentage,
      financialImpact,
    });

    const decisionKind = decisionFor(severity);
    const requiresDecision = decisionKind !== VARIANCE_DECISIONS.None;
    const blockingReason = blockingReasonFor({
      severity,
      dimension: observation.dimension,
      hasAuthorizedAdjustment: input.hasAuthorizedAdjustment,
    });

    variances.push({
      dimension: observation.dimension,
      dimensionKey: observation.dimensionKey,
      measurementItemId: observation.measurementItemId,
      plannedValue: observation.plannedValue,
      actualValue: observation.actualValue,
      measuredValue: observation.measuredValue,
      unitOfMeasure: observation.unitOfMeasure,
      absoluteDelta: formatDecimal(delta, 6),
      percentageDelta: percentageDelta === null ? null : Number(percentageDelta.toFixed(4)),
      tolerancePercentage: tolerance.percentage,
      toleranceSource: tolerance.source,
      severity,
      financialImpact: financialImpact === null ? null : formatMoney(financialImpact),
      currencyCode: financialImpact === null ? null : observation.currencyCode,
      requiresDecision,
      decisionKind,
      blockingReason,
      recommendedResolution: recommendedResolutionFor(severity),
      explanation: explainVariance({
        dimension: observation.dimension,
        planned,
        actual,
        measured,
        percentageDelta,
        tolerancePercentage: tolerance.percentage,
        severity,
        baseLabel: base?.label ?? null,
        financialImpact,
        currencyCode: observation.currencyCode,
      }),
    });
  }

  // Ordenação determinística: o operador vê a exposição maior primeiro, e a
  // mesma medição sempre produz a mesma ordem.
  const sorted = [...variances].sort((left, right) => {
    const bySeverity = SEVERITY_WEIGHT[left.severity] - SEVERITY_WEIGHT[right.severity];
    if (bySeverity !== 0) {
      return bySeverity;
    }
    const leftImpact = decimalOf(left.financialImpact) ?? 0;
    const rightImpact = decimalOf(right.financialImpact) ?? 0;
    if (rightImpact !== leftImpact) {
      return rightImpact - leftImpact;
    }
    const byDimension = left.dimension.localeCompare(right.dimension);
    if (byDimension !== 0) {
      return byDimension;
    }
    return left.dimensionKey.localeCompare(right.dimensionKey);
  });

  const decisionRequired = sorted.filter((item) => item.requiresDecision);
  const highestSeverity: VarianceSeverity =
    sorted.find((item) => item.severity === VARIANCE_SEVERITIES.Critical) !== undefined
      ? VARIANCE_SEVERITIES.Critical
      : (sorted.find((item) => item.severity === VARIANCE_SEVERITIES.High)?.severity ??
        sorted.find((item) => item.severity === VARIANCE_SEVERITIES.Medium)?.severity ??
        sorted.find((item) => item.severity === VARIANCE_SEVERITIES.Low)?.severity ??
        VARIANCE_SEVERITIES.None);

  const exposureValues = decisionRequired
    .map((item) => decimalOf(item.financialImpact))
    .filter((value): value is number => value !== null);
  const financialExposure =
    exposureValues.length === 0
      ? null
      : formatMoney(exposureValues.reduce((sum, value) => sum + value, 0));
  const currencyCode =
    decisionRequired.find((item) => item.currencyCode !== null)?.currencyCode ?? null;

  const blocking = decisionRequired.filter((item) => item.blockingReason !== null);

  return {
    variances: sorted,
    decisionRequired,
    approvalClearable: blocking.length === 0,
    highestSeverity,
    financialExposure,
    currencyCode,
    tolerance,
    summary: summarize(sorted, decisionRequired, tolerance, highestSeverity),
  };
}

function summarize(
  all: DetectedVariance[],
  decisionRequired: DetectedVariance[],
  tolerance: ResolvedTolerance,
  highestSeverity: VarianceSeverity,
): string {
  if (all.length === 0) {
    return `Nenhuma divergência entre planejado, realizado e medido (tolerância ${formatDecimal(
      tolerance.percentage,
      2,
    )}%, origem ${tolerance.source}).`;
  }
  const blocking = decisionRequired.filter((item) => item.blockingReason !== null);
  if (blocking.length === 0) {
    return `${all.length} divergência(s) dentro da tolerância aplicada (${formatDecimal(
      tolerance.percentage,
      2,
    )}%, origem ${tolerance.source}); nenhuma decisão pendente.`;
  }
  const dimensions = [...new Set(blocking.map((item) => varianceDimensionLabel(item.dimension)))];
  return `${blocking.length} divergência(s) exigem decisão (severidade máxima ${highestSeverity}): ${dimensions.join(
    ', ',
  )}.`;
}

/**
 * Converte severidade em peso de prioridade. Usado pelo work queue para ordenar
 * o trabalho por exposição — nunca para decidir autorização.
 */
export function varianceSeverityWeight(severity: VarianceSeverity): number {
  return SEVERITY_WEIGHT[severity];
}
