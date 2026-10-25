import { Injectable } from '@nestjs/common';
import {
  loadProposalMeasurementPricing,
  loadPurchaseOrderMeasurementPricing,
} from '../../commercial/application/measurement-commercial-pricing';
import { normalizeMoneyAmount } from '../../commercial/domain/money';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { ServiceOrderServiceSnapshot } from '../../service-orders/domain/service-order-snapshot';
import type { ServiceOrderRow } from '../../service-orders/repositories/service-orders.repository.types';
import {
  MeasurementError,
  type CommercialPricingLineSnapshot,
  type MeasurementCommercialReferenceSnapshot,
} from '../domain/measurement';
import {
  assertBasisConsumable,
  deriveItemsFromBasis,
  parseMeasurementBasisActuals,
  parseMeasurementBasisLines,
  type PublishedMeasurementBasis,
} from '../domain/measurement-basis-consumption';
import { buildMeasurementCommercialLinkage } from '../domain/measurement-invariants';
import { computeLineAmount } from '../domain/measurement-quantity';
import { MeasurementCapabilityRepository } from '../repositories/measurement-capability.repository';
import { MeasurementsRepository } from '../repositories/measurements.repository';
import type { MeasurementItemPersistenceDraft } from '../repositories/measurements.repository.types';
import { mapMeasurementDomainError } from './measurements-access.errors';

/**
 * RESOLUÇÃO COMERCIAL DA MEDIÇÃO.
 *
 * ═════════════════════════════════════════════════════════════════════════════════
 * O DEFEITO QUE ESTA REESCRITA FECHA
 * ═════════════════════════════════════════════════════════════════════════════════
 *
 * `buildItemsFromExecution` derivava os itens de `so.execution_entries` — a
 * leitura INTERNA do domínio de execução. A vertical anterior publicou
 * `so.measurement_basis` no fechamento e ninguém a consumia.
 *
 * O efeito medido: a base dizia 46h de equipamento e a medição media 40h, porque
 * cada uma lia uma fonte diferente do mesmo fato. Reabrir a execução mudava a
 * medição sem que a base publicada mudasse. Eram DUAS verdades operacionais para
 * uma execução fechada — exatamente o que o handoff existia para eliminar.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * A ARQUITETURA AGORA
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   EXECUÇÃO → FECHAMENTO → ACTUALS → BASE PUBLICADA
 *                                          │ (rpt.read_measurement_basis)
 *                          ════════════════╪═══════════════ FRONTEIRA
 *                                          ▼
 *                                    MEDIÇÃO → ITENS
 *
 * A quantidade vem da BASE. O PREÇO continua vindo da resolução comercial
 * existente (proposta → ordem de compra → catálogo), porque preço é fonte
 * diferente de quantidade e a precedência dela já estava correta.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O CAMINHO HISTÓRICO NÃO FOI REMOVIDO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Medições criadas ANTES desta release têm itens apontando para
 * `execution_entries` e não têm `source_measurement_basis_id`. Regenerá-las a
 * partir da base trocaria a origem no meio da vida do registro e reescreveria
 * passado. `regenerate` usa o caminho histórico para elas e o caminho da base
 * para as novas — a decisão está no domínio (`canRegenerateFromBasis`), não num
 * `if` espalhado aqui.
 */
@Injectable()
export class MeasurementsCommercialResolutionService {
  constructor(
    private readonly measurementsRepository: MeasurementsRepository,
    private readonly capabilityRepository: MeasurementCapabilityRepository,
    private readonly databaseService: DatabaseService,
  ) {}

  async buildCommercialSnapshot(
    order: ServiceOrderRow,
  ): Promise<MeasurementCommercialReferenceSnapshot> {
    const serviceSnapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw mapMeasurementDomainError(new MeasurementError('COMMERCIAL_REFERENCE_MISSING'));
    }
    const pool = connection.pool;

    let pricingLines: CommercialPricingLineSnapshot[] | null = null;
    let source: MeasurementCommercialReferenceSnapshot['source'] = 'SERVICE_CATALOG';

    if (order.proposal_id) {
      const proposalPricing = await loadProposalMeasurementPricing(
        pool,
        order.proposal_id,
        serviceSnapshot.serviceDefinitionVersionId,
      );
      if (proposalPricing && proposalPricing.length > 0) {
        pricingLines = proposalPricing;
        source = 'PROPOSAL';
      }
    }

    if (!pricingLines && order.purchase_order_id) {
      const purchaseOrderPricing = await loadPurchaseOrderMeasurementPricing(
        pool,
        order.purchase_order_id,
        serviceSnapshot.serviceDefinitionVersionId,
      );
      if (purchaseOrderPricing && purchaseOrderPricing.length > 0) {
        pricingLines = purchaseOrderPricing;
        source = 'PURCHASE_ORDER';
      }
    }

    if (!pricingLines) {
      const catalogRows = await this.measurementsRepository.loadPricingModels(
        serviceSnapshot.serviceDefinitionVersionId,
      );
      if (catalogRows.length === 0) {
        throw mapMeasurementDomainError(new MeasurementError('COMMERCIAL_REFERENCE_MISSING'));
      }
      pricingLines = catalogRows.map((row) => ({
        modelCode: row.model_code,
        salePrice: row.sale_price,
        internalCost: row.internal_cost,
        currencyCode: row.currency_code,
      }));
      source = 'SERVICE_CATALOG';
    }

    return {
      source,
      serviceDefinitionVersionId: serviceSnapshot.serviceDefinitionVersionId,
      capturedAt: new Date().toISOString(),
      proposalId: order.proposal_id,
      purchaseOrderId: order.purchase_order_id,
      pricingLines,
      ...buildMeasurementCommercialLinkage(order),
    };
  }

  /**
   * Itens da medição derivados da BASE PUBLICADA — o caminho autoritativo.
   *
   * O preço é aplicado sobre a quantidade REALIZADA da base. A taxa de conversão
   * `actualQuantity → measuredQuantity` nasce `1:1` (ponto de partida da
   * conferência); a divergência entre as duas é o que o ajuste autorizado
   * registra depois.
   */
  async buildItemsFromBasis(
    order: ServiceOrderRow,
    commercialSnapshot: MeasurementCommercialReferenceSnapshot,
  ): Promise<MeasurementItemPersistenceDraft[]> {
    const basisRow = await this.capabilityRepository.findReadyBasis(order.id);
    const basis = toPublishedBasis(basisRow);
    const serviceSnapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;

    /**
     * ─────────────────────────────────────────────────────────────────────────────
     * UNIDADES CONTRATUAIS — a FRONTEIRA entre fato físico e quantidade comercial
     * ─────────────────────────────────────────────────────────────────────────────
     *
     * `so.execution_actuals` registra fatos físicos (`HOUR`, `KM`, `L`); o contrato
     * cobra em unidade comercial (`DAY`, `TRIP`, `M3`). Só a unidade que o contrato
     * declara pode virar quantidade medida; converter uma na outra seria inventar
     * uma taxa que nenhuma fonte declarou.
     */
    const contractUnits = new Set(serviceSnapshot.allowedUnits.map((unit) => unit.unitCode));

    /**
     * QUANTIDADE DE EXECUÇÃO — o realizado de um serviço de preço global.
     *
     * A base agrega `so.execution_actuals` (realizado POR RECURSO). Um serviço
     * `GLOBAL_COMPLETION` entregue na unidade de serviço não aponta recurso, então
     * a base publica `lines: []`. A quantidade entregue existe e está registrada
     * como entrada de execução; ela é lida AQUI e repassada ao domínio, que decide
     * se o fallback se aplica. Buscar sempre é barato (uma consulta por criação de
     * medição) e evita que o serviço tenha de adivinhar o modo de medição.
     */
    const executionQuantities = (await this.measurementsRepository.listExecutionQuantityEntries(order.id)).map(
      (entry) => ({ unitCode: entry.quantity_unit_code, quantity: entry.quantity_value }),
    );

    // A recusa é do DOMÍNIO: base ausente, substituída, de outra ordem ou vazia
    // cada uma tem o seu código de erro. Aqui só traduzimos.
    try {
      assertBasisConsumable({ basis, serviceOrderId: order.id, executionQuantities, contractUnits });
    } catch (error) {
      if (error instanceof MeasurementError) {
        throw mapMeasurementDomainError(error);
      }
      throw error;
    }

    const derived = deriveItemsFromBasis(basis!, executionQuantities, contractUnits);

    return derived.map((item) => {
      const primaryPricing = this.resolvePricingLine(
        commercialSnapshot.pricingLines,
        item.unitCode,
      );

      if (!serviceSnapshot.allowedUnits.some((unit) => unit.unitCode === item.unitCode)) {
        throw mapMeasurementDomainError(new MeasurementError('UNIT_NOT_ALLOWED'));
      }

      const unitPrice = isUnitPriced(primaryPricing.modelCode) ? primaryPricing.salePrice : null;
      const lineAmount = computeLineAmount({
        modelCode: primaryPricing.modelCode,
        measuredQuantity: item.measuredQuantity,
        unitPrice,
        salePrice: primaryPricing.salePrice,
      });

      return {
        sourceMeasurementBasisId: item.sourceMeasurementBasisId,
        sourceBasisLineKey: item.sourceBasisLineKey,
        // A origem histórica NÃO é preenchida em item novo.
        sourceExecutionEntryId: null,
        unitCode: item.unitCode,
        plannedQuantity: item.plannedQuantity,
        plannedUnitOfMeasure: item.plannedUnitOfMeasure,
        actualQuantity: item.actualQuantity,
        measuredQuantity: item.measuredQuantity,
        unitPrice: unitPrice ? normalizeMoneyAmount(unitPrice) : null,
        lineAmount: lineAmount ? normalizeMoneyAmount(lineAmount) : null,
        pricingLineSnapshot: primaryPricing,
      };
    });
  }

  /**
   * Itens derivados de `so.execution_entries` — CAMINHO HISTÓRICO.
   *
   * ─────────────────────────────────────────────────────────────────────────────
   * POR QUE ESTE CAMINHO AINDA EXISTE
   * ─────────────────────────────────────────────────────────────────────────────
   *
   * Medições criadas antes desta release têm itens apontando para a entrada de
   * execução. Regenerar uma delas a partir da base trocaria a origem no meio da
   * vida do registro, e o histórico passaria a descrever uma derivação que nunca
   * aconteceu.
   *
   * Ele NÃO é usado por medição nova: `buildItemsFromBasis` é o caminho da
   * criação, e `measurements-access.service` escolhe entre os dois por
   * `canRegenerateFromBasis`, que é regra de domínio. O teste de fitness reprova
   * uso deste método fora do caminho de regeneração histórica.
   *
   * O retorno é `MeasurementItemPersistenceDraft[]` — o MESMO tipo do caminho
   * autoritativo — para que só exista UM ponto de INSERT. Os campos de base vêm
   * `null`, e é isso que marca a origem: não existem dois formatos de item.
   */
  async buildItemsFromExecutionHistory(
    order: ServiceOrderRow,
    commercialSnapshot: MeasurementCommercialReferenceSnapshot,
  ): Promise<MeasurementItemPersistenceDraft[]> {
    const entries = await this.measurementsRepository.listExecutionQuantityEntries(order.id);
    if (entries.length === 0) {
      throw mapMeasurementDomainError(new MeasurementError('MEASUREMENT_ITEMS_REQUIRED'));
    }

    const serviceSnapshot = order.service_snapshot as unknown as ServiceOrderServiceSnapshot;

    return entries.map((entry) => {
      const primaryPricing = this.resolvePricingLine(
        commercialSnapshot.pricingLines,
        entry.quantity_unit_code,
      );
      const actualQuantity = entry.quantity_value;
      const measuredQuantity = actualQuantity;
      const unitPrice = isUnitPriced(primaryPricing.modelCode) ? primaryPricing.salePrice : null;
      const lineAmount = computeLineAmount({
        modelCode: primaryPricing.modelCode,
        measuredQuantity,
        unitPrice,
        salePrice: primaryPricing.salePrice,
      });

      if (!serviceSnapshot.allowedUnits.some((unit) => unit.unitCode === entry.quantity_unit_code)) {
        throw mapMeasurementDomainError(new MeasurementError('UNIT_NOT_ALLOWED'));
      }

      return {
        // Origem HISTÓRICA: base ausente por definição, entrada de execução
        // presente. É o registro do que a medição realmente consumia antes desta
        // capability, e ele não é reescrito.
        sourceMeasurementBasisId: null,
        sourceBasisLineKey: null,
        sourceExecutionEntryId: entry.id,
        unitCode: entry.quantity_unit_code,
        // Sem base publicada não há planejado congelado a herdar; o campo fica
        // `null` em vez de ser preenchido com o realizado, que seria uma
        // afirmação falsa sobre o que foi planejado.
        plannedQuantity: null,
        plannedUnitOfMeasure: null,
        actualQuantity,
        measuredQuantity,
        unitPrice: unitPrice ? normalizeMoneyAmount(unitPrice) : null,
        lineAmount: lineAmount ? normalizeMoneyAmount(lineAmount) : null,
        pricingLineSnapshot: primaryPricing,
      };
    });
  }

  /**
   * Quantidades REALIZADAS da base, por unidade.
   *
   * Usada para conferir que a medição cobre o realizado publicado — a prova de
   * que a medição não é MENOR que a execução.
   */
  async loadBasisActuals(serviceOrderId: string): Promise<Record<string, string>> {
    const basisRow = await this.capabilityRepository.findReadyBasis(serviceOrderId);
    return parseMeasurementBasisActuals(basisRow?.actuals ?? null);
  }

  private resolvePricingLine(
    pricingLines: CommercialPricingLineSnapshot[],
    unitCode: string,
  ): CommercialPricingLineSnapshot {
    const withUnit = pricingLines.find((line) => line.unitCode === unitCode);
    return withUnit ?? pricingLines[0]!;
  }
}

/** Modelos cujo preço é POR UNIDADE. Os demais cobram valor fechado. */
function isUnitPriced(modelCode: string): boolean {
  return (
    modelCode === 'PER_UNIT' ||
    modelCode === 'UNIT_PRICE' ||
    modelCode === 'PER_KM' ||
    modelCode === 'PER_M3' ||
    modelCode === 'PER_TRIP' ||
    modelCode === 'PROPOSAL_ITEM' ||
    modelCode === 'PURCHASE_ORDER_ITEM'
  );
}

/**
 * Converte a linha do contrato publicado em `PublishedMeasurementBasis`.
 *
 * A coerção de JSONB acontece AQUI, uma única vez, para que o domínio receba
 * tipos — e para que duas leituras do mesmo JSON não possam discordar.
 */
function toPublishedBasis(
  row: {
    id: string;
    service_order_id: string;
    closure_id: string;
    unit_id: string;
    status: string;
    lines: unknown;
    actuals: unknown;
    prepared_at: string;
  } | null,
): PublishedMeasurementBasis | null {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    serviceOrderId: row.service_order_id,
    closureId: row.closure_id,
    unitId: row.unit_id,
    status: row.status,
    preparedAt: row.prepared_at,
    actuals: parseMeasurementBasisActuals(row.actuals),
    lines: parseMeasurementBasisLines(row.lines),
  };
}
