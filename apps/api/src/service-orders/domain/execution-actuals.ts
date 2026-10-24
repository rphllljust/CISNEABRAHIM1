/**
 * ACTUALS — PLANEJADO E REALIZADO NÃO SÃO A MESMA COISA.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * O sistema só sabia comparar QUANTIDADE MEDIDA (`so.execution_entries` do tipo
 * QUANTITY contra o planejado). Tudo o mais que uma operação real consome — horas
 * de mão de obra, quilometragem, combustível, horas de equipamento, material,
 * serviço de terceiro — não existia como realizado.
 *
 * O efeito medido: o custo real era uma ESTIMATIVA do planejado, e a variação
 * (o número que o gestor usa para decidir) não tinha como ser produzida.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PRINCÍPIO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   NUNCA SOBRESCREVER O PLANEJADO COM O REALIZADO.
 *
 * O plano vive em `so.planned_resources` / `res.resource_allocations`. O realizado
 * vive em `so.execution_actuals`. A comparação é uma PROJEÇÃO, calculada a cada
 * leitura — nunca persistida como se fosse um terceiro fato.
 *
 * `plannedValue` nesta projeção é o planejado NO MOMENTO da leitura. Se o plano for
 * alterado depois, a variação muda junto — e isso é correto: comparar realizado com
 * um plano antigo esconderia a mudança de escopo.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * VARIAÇÃO EXPLICÁVEL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Cada linha de variação carrega `explainable` e `explanation`:
 *
 *   - `explainable = true`  → existe um fato persistido que explica a diferença
 *                             (ex.: veículo executado ≠ veículo planejado).
 *   - `explainable = false` → a diferença existe e NÃO há justificativa registrada.
 *                             O sistema DIZ que não sabe, em vez de deixar um
 *                             número sem origem.
 *
 * Isso é o oposto de "fake analytics": um número sem causa é apresentado como
 * número sem causa.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE ARQUIVO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não consulta banco, não decide autorização, não conhece HTTP, não formata moeda.
 */

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO FECHADO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Tipos de realizado.
 *
 * Espelha exatamente `so.execution_actual_kind`. A duplicação é deliberada e
 * verificada por teste de contrato: o domínio não importa tipos de banco, e o
 * teste garante que os dois conjuntos não divergem.
 */
export const ACTUAL_KINDS = {
  LaborHours: 'LABOR_HOURS',
  DriverHours: 'DRIVER_HOURS',
  VehicleDistance: 'VEHICLE_DISTANCE',
  VehicleHours: 'VEHICLE_HOURS',
  EquipmentHours: 'EQUIPMENT_HOURS',
  FuelVolume: 'FUEL_VOLUME',
  MaterialQuantity: 'MATERIAL_QUANTITY',
  ThirdPartyAmount: 'THIRD_PARTY_AMOUNT',
  WaitingHours: 'WAITING_HOURS',
  DowntimeHours: 'DOWNTIME_HOURS',
} as const;

export type ActualKind = (typeof ACTUAL_KINDS)[keyof typeof ACTUAL_KINDS];

const ACTUAL_KIND_SET = new Set<string>(Object.values(ACTUAL_KINDS));

export function isActualKind(value: string): value is ActualKind {
  return ACTUAL_KIND_SET.has(value);
}

/** Linhas de comparação exibidas na object page, na ordem em que o operador lê. */
export const ACTUAL_COMPARISON_GROUPS = [
  { code: 'LABOR', label: 'Mão de obra', kinds: ['LABOR_HOURS', 'DRIVER_HOURS'] },
  { code: 'VEHICLE', label: 'Veículo', kinds: ['VEHICLE_HOURS'] },
  { code: 'DISTANCE', label: 'Distância', kinds: ['VEHICLE_DISTANCE'] },
  { code: 'FUEL', label: 'Combustível', kinds: ['FUEL_VOLUME'] },
  { code: 'EQUIPMENT', label: 'Equipamento', kinds: ['EQUIPMENT_HOURS'] },
  { code: 'MATERIAL', label: 'Material', kinds: ['MATERIAL_QUANTITY'] },
  { code: 'THIRD_PARTY', label: 'Terceiros', kinds: ['THIRD_PARTY_AMOUNT'] },
  { code: 'WAITING', label: 'Espera', kinds: ['WAITING_HOURS'] },
  { code: 'DOWNTIME', label: 'Parada', kinds: ['DOWNTIME_HOURS'] },
] as const;

export type ActualComparisonGroupCode = (typeof ACTUAL_COMPARISON_GROUPS)[number]['code'];

/** Unidade canônica por tipo de realizado. Uma única unidade evita soma incoerente. */
const CANONICAL_UNIT: Record<ActualKind, string> = {
  [ACTUAL_KINDS.LaborHours]: 'H',
  [ACTUAL_KINDS.DriverHours]: 'H',
  [ACTUAL_KINDS.VehicleDistance]: 'KM',
  [ACTUAL_KINDS.VehicleHours]: 'H',
  [ACTUAL_KINDS.EquipmentHours]: 'H',
  [ACTUAL_KINDS.FuelVolume]: 'L',
  [ACTUAL_KINDS.MaterialQuantity]: 'UNIT',
  [ACTUAL_KINDS.ThirdPartyAmount]: 'BRL',
  [ACTUAL_KINDS.WaitingHours]: 'H',
  [ACTUAL_KINDS.DowntimeHours]: 'H',
};

export function canonicalUnitForActualKind(kind: ActualKind): string {
  return CANONICAL_UNIT[kind];
}

// ═══════════════════════════════════════════════════════════════════════════════
// ENTRADA — fatos persistidos
// ═══════════════════════════════════════════════════════════════════════════════

/** Uma linha de `so.execution_actuals`. */
export type ActualFact = {
  id: string;
  actualKind: string;
  physicalAssetId: string | null;
  workforceMemberId: string | null;
  resourceLabel: string | null;
  actualValue: string;
  unitOfMeasure: string;
  plannedValue: string | null;
  plannedUnitOfMeasure: string | null;
  source: string;
  occurredAt: string;
  notes: string | null;
};

/** Planejado por tipo de realizado, lido do plano vigente. */
export type PlannedActualFact = {
  kind: ActualKind;
  quantity: string;
  unitOfMeasure: string;
  /** De onde veio o planejado (para explicar a variação). */
  source: string;
};

/** Recurso realmente executado vs planejado — a variação que mais importa. */
export type ExecutedResourceFact = {
  role: 'DRIVER' | 'VEHICLE' | 'EQUIPMENT';
  resourceId: string;
  resourceCode: string;
  resourceLabel: string | null;
  /** `PLANNED` = o planejado; `ACTUAL` = o que executou de fato. */
  origin: 'PLANNED' | 'ACTUAL';
};

// ═══════════════════════════════════════════════════════════════════════════════
// SAÍDA — comparação explicável
// ═══════════════════════════════════════════════════════════════════════════════

export type VarianceDirection = 'OVER' | 'UNDER' | 'EQUAL' | 'UNKNOWN';

export type ActualComparisonLine = {
  group: ActualComparisonGroupCode;
  label: string;
  /** Realizado agregado, no formato de string decimal do banco. */
  actualValue: string | null;
  unitOfMeasure: string | null;
  /** Planejado agregado, quando o plano declara valor comparável. */
  plannedValue: string | null;
  /** `actual - planned`, ou `null` quando não há base de comparação. */
  variance: string | null;
  direction: VarianceDirection;
  /** A variação tem causa registrada? */
  explainable: boolean;
  /** Causa da variação, quando existe. Sem causa, `null` — nunca texto genérico. */
  explanation: string | null;
  /** Quantidade de registros que compõem o realizado. */
  recordCount: number;
};

export type ResourceSubstitution = {
  role: 'DRIVER' | 'VEHICLE' | 'EQUIPMENT';
  plannedCode: string | null;
  actualCode: string | null;
  changed: boolean;
};

export type ActualsComparison = {
  lines: ActualComparisonLine[];
  substitutions: ResourceSubstitution[];
  /** Total de registros de realizado considerados. */
  recordCount: number;
  /** Existe algum realizado? Sem isso a variação não é "zero", é "não medida". */
  hasActuals: boolean;
  /** Resumo humano, derivado — não inventado pela tela. */
  summary: string;
};

// ═══════════════════════════════════════════════════════════════════════════════
// CÁLCULO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Aritmética decimal SEM ponto flutuante, em micro-unidades (6 casas).
 *
 * `0.1 + 0.2` em `number` dá `0.30000000000000004`. Num sistema onde esse número
 * vira variação de custo, o erro deixa de ser cosmético: ele aparece na tela como
 * divergência que não existe. Por isso a soma é feita em inteiros.
 */
const DECIMALS = 6;
const SCALE = 1_000_000n;

function toMicros(value: string): bigint {
  const trimmed = String(value ?? '0').trim();
  if (trimmed === '' || trimmed === '-' || trimmed === '.') {
    return 0n;
  }
  const negative = trimmed.startsWith('-');
  const body = negative ? trimmed.slice(1) : trimmed;
  const [intRaw = '0', fracRaw = ''] = body.split('.');
  // A parte inteira pode conter separadores de milhar; só os dígitos importam.
  const intPart = intRaw.replace(/[^0-9]/g, '') || '0';
  const frac = fracRaw.replace(/[^0-9]/g, '');
  // Trunca em 6 casas: a precisão de um realizado de campo não passa disso, e
  // arredondar para cima inventaria consumo.
  const paddedFrac = (frac + '0'.repeat(DECIMALS)).slice(0, DECIMALS);
  const micros = BigInt(`${intPart}${paddedFrac}`);
  return negative ? -micros : micros;
}

function fromMicros(value: bigint): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const intPart = abs / SCALE;
  const frac = (abs % SCALE).toString().padStart(DECIMALS, '0');
  const trimmed = frac.replace(/0+$/, '');
  const text = trimmed.length > 0 ? `${intPart}.${trimmed}` : `${intPart}`;
  return negative ? `-${text}` : text;
}

/** Soma valores decimais em strings sem perder precisão. */
export function sumDecimal(values: Array<string | null | undefined>): string {
  let total = 0n;
  for (const value of values) {
    if (value === null || value === undefined) {
      continue;
    }
    total += toMicros(value);
  }
  return fromMicros(total);
}

function compare(value: string | null, planned: string | null): VarianceDirection {
  if (value === null || planned === null) {
    return 'UNKNOWN';
  }
  const a = toMicros(value);
  const b = toMicros(planned);
  if (a === b) {
    return 'EQUAL';
  }
  return a > b ? 'OVER' : 'UNDER';
}

function varianceOf(actual: string | null, planned: string | null): string | null {
  if (actual === null || planned === null) {
    return null;
  }
  return fromMicros(toMicros(actual) - toMicros(planned));
}

/**
 * Explica a variação de um grupo usando FATOS.
 *
 * `null` significa "não há explicação registrada" — e a projeção reporta isso
 * como tal. O que NÃO se faz aqui é produzir texto genérico do tipo "variação
 * normal": isso apagaria a diferença entre "explicado" e "não sei".
 */
function explainGroup(input: {
  group: ActualComparisonGroupCode;
  direction: VarianceDirection;
  substitutions: ResourceSubstitution[];
  actual: string | null;
  planned: string | null;
  unit: string | null;
}): string | null {
  if (input.direction === 'EQUAL' || input.direction === 'UNKNOWN') {
    return null;
  }

  if (input.group === 'VEHICLE' || input.group === 'DISTANCE' || input.group === 'FUEL') {
    const vehicle = input.substitutions.find((item) => item.role === 'VEHICLE' && item.changed);
    if (vehicle) {
      return `Veículo executado (${vehicle.actualCode ?? 'não registrado'}) difere do planejado (${vehicle.plannedCode ?? 'não planejado'}).`;
    }
  }

  if (input.group === 'LABOR') {
    const driver = input.substitutions.find((item) => item.role === 'DRIVER' && item.changed);
    if (driver) {
      return `Condutor executado (${driver.actualCode ?? 'não registrado'}) difere do planejado (${driver.plannedCode ?? 'não planejado'}).`;
    }
  }

  if (input.group === 'EQUIPMENT') {
    const equipment = input.substitutions.find((item) => item.role === 'EQUIPMENT' && item.changed);
    if (equipment) {
      return `Equipamento executado (${equipment.actualCode ?? 'não registrado'}) difere do planejado (${equipment.plannedCode ?? 'não planejado'}).`;
    }
  }

  return null;
}

const GROUP_DESCRIPTION: Record<ActualComparisonGroupCode, string> = {
  LABOR: 'mão de obra',
  VEHICLE: 'veículo',
  DISTANCE: 'distância',
  FUEL: 'combustível',
  EQUIPMENT: 'equipamento',
  MATERIAL: 'material',
  THIRD_PARTY: 'terceiros',
  WAITING: 'espera',
  DOWNTIME: 'parada',
};

/**
 * Monta a comparação planejado × realizado.
 *
 * Regra de honestidade: um grupo SEM realizado tem `actualValue = null`, não `0`.
 * Zero é um valor medido; ausência é outra coisa. Confundir os dois é como um
 * sistema reporta "consumiu nada" quando na verdade "ninguém registrou".
 */
export function buildActualsComparison(input: {
  actuals: ActualFact[];
  planned: Partial<Record<ActualKind, { quantity: string; unitOfMeasure: string }>>;
  substitutions: ResourceSubstitution[];
}): ActualsComparison {
  const substitutions = input.substitutions;

  const lines: ActualComparisonLine[] = ACTUAL_COMPARISON_GROUPS.map((group) => {
    const kinds = group.kinds as readonly ActualKind[];
    const rows = input.actuals.filter((actual) => kinds.includes(actual.actualKind as ActualKind));

    if (rows.length === 0) {
      const plannedValues = kinds
        .map((kind) => input.planned[kind])
        .filter((value): value is { quantity: string; unitOfMeasure: string } => Boolean(value));
      const plannedValue =
        plannedValues.length > 0 ? sumDecimal(plannedValues.map((item) => item.quantity)) : null;
      return {
        group: group.code,
        label: group.label,
        actualValue: null,
        unitOfMeasure: plannedValues[0]?.unitOfMeasure ?? null,
        plannedValue,
        variance: null,
        direction: 'UNKNOWN' as VarianceDirection,
        explainable: false,
        explanation: null,
        recordCount: 0,
      };
    }

    const unit = rows[0]!.unitOfMeasure;
    const actualValue = sumDecimal(rows.map((row) => row.actualValue));

    const plannedValues = kinds
      .map((kind) => input.planned[kind])
      .filter((value): value is { quantity: string; unitOfMeasure: string } => Boolean(value));
    const plannedValue =
      plannedValues.length > 0 ? sumDecimal(plannedValues.map((item) => item.quantity)) : null;

    const direction = compare(actualValue, plannedValue);
    const explanation = explainGroup({
      group: group.code,
      direction,
      substitutions,
      actual: actualValue,
      planned: plannedValue,
      unit,
    });

    return {
      group: group.code,
      label: group.label,
      actualValue,
      unitOfMeasure: unit,
      plannedValue,
      variance: varianceOf(actualValue, plannedValue),
      direction,
      // Variação ZERO ou SEM BASE não é "explicada nem não explicada": é ausência
      // de variação. Só uma variação real pode ser explicada ou não.
      explainable: direction === 'EQUAL' || direction === 'UNKNOWN' ? false : explanation !== null,
      explanation,
      recordCount: rows.length,
    };
  });

  const recordCount = input.actuals.length;
  const hasActuals = recordCount > 0;

  const overLines = lines.filter((line) => line.direction === 'OVER');
  const underLines = lines.filter((line) => line.direction === 'UNDER');
  const unexplained = lines.filter(
    (line) => line.direction !== 'EQUAL' && line.direction !== 'UNKNOWN' && !line.explainable,
  );

  const summary = !hasActuals
    ? 'Nenhum realizado registrado — a variação ainda não pode ser medida.'
    : overLines.length === 0 && underLines.length === 0
      ? `Realizado registrado em ${recordCount} lançamento(s), sem base de comparação declarada.`
      : [
          overLines.length > 0
            ? `Acima do planejado: ${overLines.map((line) => GROUP_DESCRIPTION[line.group]).join(', ')}.`
            : null,
          underLines.length > 0
            ? `Abaixo do planejado: ${underLines.map((line) => GROUP_DESCRIPTION[line.group]).join(', ')}.`
            : null,
          unexplained.length > 0
            ? `Sem causa registrada: ${unexplained.map((line) => GROUP_DESCRIPTION[line.group]).join(', ')}.`
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(' ');

  return { lines, substitutions, recordCount, hasActuals, summary };
}

/**
 * Comparação de recursos: quem FOI planejado e quem EXECUTOU.
 *
 * `changed` é o fato que explica a maior parte das variações de combustível,
 * distância e horas — e é justamente o que a tela mostrava como "planejado = real"
 * porque o realizado de recurso não existia.
 */
export function buildResourceSubstitutions(facts: ExecutedResourceFact[]): ResourceSubstitution[] {
  const roles: Array<'DRIVER' | 'VEHICLE' | 'EQUIPMENT'> = ['DRIVER', 'VEHICLE', 'EQUIPMENT'];
  const result: ResourceSubstitution[] = [];

  for (const role of roles) {
    const planned = facts.filter((item) => item.role === role && item.origin === 'PLANNED');
    const actual = facts.filter((item) => item.role === role && item.origin === 'ACTUAL');
    if (planned.length === 0 && actual.length === 0) {
      continue;
    }
    const plannedCodes = planned.map((item) => item.resourceCode).sort();
    const actualCodes = actual.map((item) => item.resourceCode).sort();
    const changed =
      plannedCodes.length > 0 &&
      actualCodes.length > 0 &&
      plannedCodes.join('|') !== actualCodes.join('|');

    result.push({
      role,
      plannedCode: plannedCodes.length > 0 ? plannedCodes.join(', ') : null,
      actualCode: actualCodes.length > 0 ? actualCodes.join(', ') : null,
      changed,
    });
  }

  return result;
}
