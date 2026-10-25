/**
 * MEASUREMENT BASIS CONSUMPTION — a ÚNICA origem autoritativa dos itens.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTE MÓDULO ELIMINA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * Existiam DOIS caminhos para o mesmo item de medição:
 *
 *   A) `so.measurement_basis` — publicado pelo fechamento da execução (0107),
 *      com evento `MEASUREMENT_BASIS_READY`, view `rpt.read_measurement_basis` e
 *      a garantia de UMA base READY por ordem. NINGUÉM consumia.
 *
 *   B) `so.execution_entries` — a leitura INTERNA da execução, feita por
 *      `MeasurementsCommercialResolutionService.buildItemsFromExecution`.
 *      Este era o caminho que rodava.
 *
 * O resultado é o padrão que o prompt chama de "outra verdade": a vertical
 * anterior fechou o handoff e a vertical seguinte continuou lendo as entranhas
 * do domínio vizinho. Se o fechamento congelasse uma base e a medição lesse
 * `execution_entries`, uma reabertura de execução mudaria a medição sem que a
 * base publicada mudasse — e duas leituras da mesma OS discordariam.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ARQUITETURA FINAL
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   EXECUTION DOMAIN
 *        ↓ (fechamento)
 *   AUTHORITATIVE ACTUALS
 *        ↓
 *   MEASUREMENT BASIS (so.measurement_basis, publicado no MESMO commit)
 *        ↓
 *   PUBLISHED CONTRACT (rpt.read_measurement_basis)
 *   ═══════════════ DOMAIN BOUNDARY ═══════════════
 *        ↓
 *   MEASUREMENT DOMAIN
 *        ↓
 *   MEASUREMENT ITEMS
 *
 * A leitura de `execution_entries` permanece no código APENAS como caminho de
 * compatibilidade para medições criadas ANTES desta release, e ele está marcado
 * como tal. Novas medições SEMPRE nascem da base.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O QUE ESTE MÓDULO **NÃO** FAZ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Não precifica (a resolução comercial existente faz isso), não consulta banco
 * (o repositório entrega as linhas), não decide autorização.
 */

import { MeasurementError } from './measurement';

// ═══════════════════════════════════════════════════════════════════════════════
// VOCABULÁRIO
// ═══════════════════════════════════════════════════════════════════════════════

/** Origem do item. `BASIS` é o caminho novo; `LEGACY_EXECUTION_ENTRY` é história. */
export const MEASUREMENT_ITEM_ORIGINS = {
  Basis: 'BASIS',
  LegacyExecutionEntry: 'LEGACY_EXECUTION_ENTRY',
} as const;

export type MeasurementItemOrigin =
  (typeof MEASUREMENT_ITEM_ORIGINS)[keyof typeof MEASUREMENT_ITEM_ORIGINS];

/** Status da base publicada que a medição aceita consumir. */
export const CONSUMABLE_BASIS_STATUS = 'READY';

// ═══════════════════════════════════════════════════════════════════════════════
// LINHA DA BASE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Linha da base publicada, como o fechamento a produziu.
 *
 * O formato é o de `so.measurement_basis.lines` (ver
 * `buildExecutionClosureInput.measurementLines`): uma linha por unidade de
 * medida, com quantidade real e quantidade planejada de referência.
 *
 * `source` é declarado pelo produtor (`EXECUTION_ACTUALS`) e é preservado: a
 * medição não inventa procedência nem a regrava por cima.
 */
export type MeasurementBasisLine = {
  /** Chave estável da linha dentro da base. Usada para deduplicação. */
  lineKey: string;
  unitCode: string;
  actualQuantity: string;
  plannedQuantity: string | null;
  recordCount: number;
  source: string;
};

/**
 * Base publicada, no contrato que a medição consome.
 *
 * `lines` chega como `unknown` do JSONB: a coerção acontece AQUI, uma única vez,
 * com validação declarada. Espalhar essa coerção pelo repositório e pela tela é
 * como duas leituras do mesmo JSON passam a discordar.
 */
export type PublishedMeasurementBasis = {
  id: string;
  serviceOrderId: string;
  closureId: string;
  unitId: string;
  status: string;
  preparedAt: string;
  /** `actuals` é o realizado por unidade — a referência do REALIZADO. */
  actuals: Record<string, string>;
  lines: MeasurementBasisLine[];
};

// ═══════════════════════════════════════════════════════════════════════════════
// PARSE DA BASE
// ═══════════════════════════════════════════════════════════════════════════════

function readString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDecimalString(value: unknown): string | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : null;
  }
  const text = readString(value);
  if (text === null) {
    return null;
  }
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

/**
 * Converte `so.measurement_basis.lines` (JSONB) em linhas tipadas.
 *
 * POR QUE A LINHA INVÁLIDA É RECUSADA E NÃO DESCARTADA
 *
 * Uma linha sem unidade ou sem quantidade é uma base corrompida. Descartá-la em
 * silêncio produziria uma medição MENOR que a execução — e o operador só
 * descobriria ao comparar o total com o realizado. Recusar aqui faz o comando
 * falhar com motivo declarado, e o problema aparece onde pode ser corrigido.
 */
export function parseMeasurementBasisLines(raw: unknown): MeasurementBasisLine[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const lines: MeasurementBasisLine[] = [];
  const seenKeys = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (!entry || typeof entry !== 'object') {
      throw new MeasurementError('MEASUREMENT_BASIS_MALFORMED');
    }
    const record = entry as Record<string, unknown>;

    const unitCode = readString(record['unitCode']);
    if (unitCode === null) {
      throw new MeasurementError('MEASUREMENT_BASIS_MALFORMED');
    }

    const actualQuantity = readDecimalString(record['actualQuantity']);
    if (actualQuantity === null) {
      throw new MeasurementError('MEASUREMENT_BASIS_MALFORMED');
    }

    // `recordCount` é a contagem de registros de realizado que sustentam a
    // quantidade. Sem ele a linha não tem procedência verificável.
    const recordCountRaw = record['recordCount'];
    const recordCount =
      typeof recordCountRaw === 'number' && Number.isInteger(recordCountRaw) && recordCountRaw >= 0
        ? recordCountRaw
        : null;
    if (recordCount === null) {
      throw new MeasurementError('MEASUREMENT_BASIS_MALFORMED');
    }

    /**
     * CHAVE DA LINHA.
     *
     * O produtor não grava `lineKey` hoje: a chave estável é a UNIDADE, que é
     * única por linha por construção (`byUnit` no fechamento). Quando o produtor
     * passar a declarar `lineKey`, ela é respeitada — e as duas formas convivem
     * sem ambiguidade porque a chave continua sendo única na base.
     */
    const declaredKey = readString(record['lineKey']) ?? readString(record['key']);
    const lineKey = declaredKey ?? unitCode;

    if (seenKeys.has(lineKey)) {
      // Duas linhas com a mesma chave tornariam a deduplicação impossível e o
      // item ambíguo. A base publicada não pode ter essa ambiguidade.
      throw new MeasurementError('MEASUREMENT_BASIS_DUPLICATE_LINE');
    }
    seenKeys.add(lineKey);

    lines.push({
      lineKey,
      unitCode,
      actualQuantity,
      plannedQuantity: readDecimalString(record['plannedQuantity']),
      recordCount,
      source: readString(record['source']) ?? 'UNKNOWN',
    });

    void index;
  }

  return lines;
}

/** Converte `so.measurement_basis.actuals` (JSONB) em mapa unidade → quantidade. */
export function parseMeasurementBasisActuals(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const text = readDecimalString(value);
    if (text !== null) {
      result[key] = text;
    }
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSUMO
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A base pode ser consumida por uma medição nova?
 *
 * Três condições, todas estruturais:
 *
 *   1. a base existe e está `READY` (uma base substituída é passado);
 *   2. a base pertence à MESMA ordem que a medição;
 *   3. a base possui ao menos uma linha com quantidade real, OU o serviço é de
 *      preço global e existe quantidade registrada na execução.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE A CONDIÇÃO 3 ADMITE A QUANTIDADE DE EXECUÇÃO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `byUnit` no fechamento agrega `so.execution_actuals` — o realizado POR RECURSO.
 * Um serviço de preço global (`measurementBasis = GLOBAL_COMPLETION`) medido na
 * unidade de serviço não aponta recurso nenhum, então não há realizado a agregar e
 * a base publica `lines: []`.
 *
 * Exigir linha de base aí tornaria NÃO MEDÍVEL uma venda legítima: "serviço
 * concluído por 1 SERVICE" é exatamente o que esse modo de medição cobra. A
 * quantidade existe — foi registrada como entrada de execução (`recordQuantity`),
 * que é o apontamento operacional do que foi entregue.
 *
 * O fallback NÃO é a volta do caminho antigo: a ORIGEM continua sendo a base
 * publicada (o item nasce com `sourceMeasurementBasisId`), e a quantidade de
 * execução entra apenas como o REALIZADO quando a base não trouxe nenhum. Uma
 * medição com realizado na base nunca é substituída — o fallback só preenche o
 * que está vazio, e nunca sobrescreve fato congelado.
 */
export function assertBasisConsumable(input: {
  basis: PublishedMeasurementBasis | null;
  serviceOrderId: string;
  /** Quantidades registradas na execução, por unidade. Vazio quando não há. */
  executionQuantities?: ReadonlyArray<{ unitCode: string; quantity: string }>;
}): void {
  if (!input.basis) {
    throw new MeasurementError('MEASUREMENT_BASIS_NOT_PUBLISHED');
  }
  if (input.basis.status !== CONSUMABLE_BASIS_STATUS) {
    throw new MeasurementError('MEASUREMENT_BASIS_NOT_READY');
  }
  if (input.basis.serviceOrderId !== input.serviceOrderId) {
    throw new MeasurementError('MEASUREMENT_BASIS_ORDER_MISMATCH');
  }
  if (input.basis.lines.length === 0 && !hasExecutionQuantity(input.executionQuantities)) {
    throw new MeasurementError('MEASUREMENT_BASIS_EMPTY');
  }
}

/**
 * Há quantidade de execução utilizável como realizado?
 *
 * Zero é recusado de propósito: registrar "0 unidades entregues" e medi-lo daria
 * uma linha de valor zero que parece medição conferida. Sem quantidade positiva o
 * fechamento não tem realizado, e a base continua sendo recusada.
 */
function hasExecutionQuantity(
  quantities: ReadonlyArray<{ unitCode: string; quantity: string }> | undefined,
): boolean {
  if (!quantities || quantities.length === 0) {
    return false;
  }
  return quantities.some((item) => {
    const unitCode = readString(item.unitCode);
    if (unitCode === null) {
      return false;
    }
    const value = readDecimalString(item.quantity);
    return value !== null && Number(value) > 0;
  });
}

/**
 * Deriva os itens de medição da base publicada.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PLANEJADO, REALIZADO E MEDIDO SÃO TRÊS CAMPOS — NUNCA UM SÓ
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   plannedQuantity  vem da base (quando o fechamento tinha referência de plano)
 *   actualQuantity   vem da base (o realizado congelado no fechamento)
 *   measuredQuantity nasce IGUAL ao realizado — e é o único que a conferência
 *                    pode alterar, SEMPRE por ajuste autorizado.
 *
 * Nascer igual não é "actual = measured por conveniência": é o estado inicial de
 * uma conferência que ainda não aconteceu. A diferença aparece quando o operador
 * reconhece comercialmente uma quantidade diferente do realizado — e o ajuste
 * existe justamente para registrar essa decisão.
 *
 * A função NÃO precifica: `unitPrice`, `lineAmount` e `pricingLineSnapshot` são
 * resolvidos pelo serviço de resolução comercial existente, que conhece proposta,
 * ordem de compra e catálogo.
 */
export type BasisDerivedItem = {
  origin: MeasurementItemOrigin;
  /** Origem autoritativa: a base publicada. */
  sourceMeasurementBasisId: string;
  /** Chave da linha na base. */
  sourceBasisLineKey: string;
  /** Origem histórica. `null` para itens derivados da base. */
  sourceExecutionEntryId: null;
  unitCode: string;
  plannedQuantity: string | null;
  plannedUnitOfMeasure: string | null;
  actualQuantity: string;
  measuredQuantity: string;
};

/**
 * Deriva os itens quando a base publicou `lines: []`.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SERVIÇO DE PREÇO GLOBAL NÃO TEM REALIZADO POR RECURSO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * `GLOBAL_COMPLETION` cobra o serviço entregue, não uma quantidade por recurso —
 * então o fechamento não tem `execution_actuals` a agregar e publica base vazia.
 * Recusar aí tornaria não medível a venda que o próprio modo de medição descreve.
 *
 * A quantidade vem da ENTRADA DE EXECUÇÃO (`recordQuantity`), que é o apontamento
 * operacional do que foi entregue. A ORIGEM continua sendo a BASE: o item nasce
 * com `sourceMeasurementBasisId` e `sourceExecutionEntryId: null`, porque a
 * procedência do item é a base publicada — a quantidade de execução só supre o
 * REALIZADO que a base não trouxe.
 *
 * `plannedQuantity` fica `null`: sem linha na base não há planejado congelado, e
 * preencher com o realizado seria afirmar um plano que não existiu.
 */
function deriveItemsFromExecutionQuantity(
  basis: PublishedMeasurementBasis,
  executionQuantities: ReadonlyArray<{ unitCode: string; quantity: string }>,
): BasisDerivedItem[] {
  const byUnit = new Map<string, number>();

  for (const item of executionQuantities) {
    const unitCode = readString(item.unitCode);
    if (unitCode === null) {
      continue;
    }
    const value = readDecimalString(item.quantity);
    if (value === null) {
      continue;
    }
    byUnit.set(unitCode, (byUnit.get(unitCode) ?? 0) + Number(value));
  }

  const items: BasisDerivedItem[] = [];
  for (const [unitCode, quantity] of byUnit.entries()) {
    if (!(quantity > 0)) {
      continue;
    }
    const actualQuantity = String(quantity);
    items.push({
      origin: MEASUREMENT_ITEM_ORIGINS.Basis,
      sourceMeasurementBasisId: basis.id,
      // A chave da linha é a UNIDADE, a mesma convenção do produtor da base.
      sourceBasisLineKey: unitCode,
      sourceExecutionEntryId: null,
      unitCode,
      plannedQuantity: null,
      plannedUnitOfMeasure: null,
      actualQuantity,
      measuredQuantity: actualQuantity,
    });
  }

  return items;
}

export function deriveItemsFromBasis(
  basis: PublishedMeasurementBasis,
  executionQuantities?: ReadonlyArray<{ unitCode: string; quantity: string }>,
): BasisDerivedItem[] {
  /**
   * O fallback só entra quando a base NÃO publicou linha nenhuma. Uma base com
   * realizado nunca é substituída: o fato congelado no fechamento tem precedência
   * sobre a quantidade de execução, sempre.
   */
  if (basis.lines.length === 0 && executionQuantities && executionQuantities.length > 0) {
    return deriveItemsFromExecutionQuantity(basis, executionQuantities);
  }

  return basis.lines.map((line) => ({
    origin: MEASUREMENT_ITEM_ORIGINS.Basis,
    sourceMeasurementBasisId: basis.id,
    sourceBasisLineKey: line.lineKey,
    sourceExecutionEntryId: null,
    unitCode: line.unitCode,
    plannedQuantity: line.plannedQuantity,
    plannedUnitOfMeasure: line.plannedQuantity === null ? null : line.unitCode,
    actualQuantity: line.actualQuantity,
    // O MEDIDO nasce do REALIZADO congelado na base. Ver o comentário acima: é
    // ponto de partida de conferência, não identidade permanente.
    measuredQuantity: line.actualQuantity,
  }));
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPATIBILIDADE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Caminho de compatibilidade para medições criadas ANTES desta release.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUE ESTE CAMINHO EXISTE E POR QUE ELE ESTÁ MARCADO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Medições já gravadas têm itens apontando para `so.execution_entries` e NÃO têm
 * `source_measurement_basis_id`. Regenerar uma medição histórica a partir da
 * base criaria uma segunda derivação do mesmo fato, e o histórico mudaria de
 * origem no meio da vida do registro.
 *
 * A regra é explicitamente MONOTÔNICA: medição nova → base; medição histórica →
 * preserva a origem que já tem. O caminho histórico NÃO é oferecido a nada novo,
 * e o teste de fitness reprova o uso dele fora daqui.
 */
export function isLegacyMeasurementOrigin(input: {
  sourceMeasurementBasisId: string | null;
  sourceExecutionEntryId: string | null;
}): boolean {
  return input.sourceMeasurementBasisId === null && input.sourceExecutionEntryId !== null;
}

/**
 * A medição pode ser regenerada a partir da base?
 *
 * Uma medição histórica NÃO pode: regenerar trocaria a origem dos itens e
 * reescreveria passado. A resposta é declarada aqui, e não em condicional
 * espalhada pelo serviço.
 */
export function canRegenerateFromBasis(input: {
  hasBasis: boolean;
  measurementCreatedByLegacyPath: boolean;
}): { allowed: boolean; reason: string | null } {
  if (input.measurementCreatedByLegacyPath) {
    return {
      allowed: false,
      reason: 'MEASUREMENT_LEGACY_ORIGIN',
    };
  }
  if (!input.hasBasis) {
    return { allowed: false, reason: 'MEASUREMENT_BASIS_NOT_PUBLISHED' };
  }
  return { allowed: true, reason: null };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TOLERÂNCIA COMERCIAL
// ═══════════════════════════════════════════════════════════════════════════════

export type DeclaredTolerance = {
  percentage: number | null;
  source: 'CONTRACT' | 'SERVICE' | null;
};

function readPercentage(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
    return value;
  }
  const text = readString(value);
  if (text === null) {
    return null;
  }
  const normalized = text.replace('%', '').replace(',', '.').trim();
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Tolerância declarada pelas fontes comerciais.
 *
 * PRECEDÊNCIA: contrato sobre serviço. O contrato é a fonte que o cliente
 * assinou; o serviço é a política interna do catálogo. Quando as duas existem e
 * discordam, o contrato governa — e a divergência NÃO é silenciosa: ela aparece
 * na explicação da variação porque `toleranceSource` é publicado.
 *
 * A coerção de `"5%"` para `5` é DECLARADA. Um valor que não converte devolve
 * `null`, e o domínio aplica a tolerância padrão com a fonte `DEFAULT` — o
 * sistema não inventa um número a partir de texto inválido.
 */
export function resolveDeclaredVarianceTolerance(input: {
  contractSnapshot: Record<string, unknown> | null;
  serviceSnapshot: Record<string, unknown> | null;
}): DeclaredTolerance {
  const fromContract = readPercentage(input.contractSnapshot?.['varianceTolerance']);
  if (fromContract !== null) {
    return { percentage: fromContract, source: 'CONTRACT' };
  }
  const fromService = readPercentage(input.serviceSnapshot?.['varianceTolerance']);
  if (fromService !== null) {
    return { percentage: fromService, source: 'SERVICE' };
  }
  return { percentage: null, source: null };
}
