import {
  emptyProductivityRawAggregates,
  type ProductivityRawAggregates,
} from './productivity-summary';

/**
 * Máscara de agregados de produtividade por capability (nenhuma regra no
 * frontend). Cada métrica só é exposta quando o ator tem a capability que lê
 * a sua fonte de dados:
 *
 * - completed / onTime / ciclo → leitura de OS (service-orders:service-order:list)
 * - utilization → leitura de alocação de recursos
 * - evidence → leitura de execução da OS
 * - rework / measurementAcceptance → leitura de medição
 *
 * As condições são independentes (não é um else-if): um ator sem grant de
 * recursos E sem grant de medição não pode inferir nenhum dos dois blocos.
 * Zeros aqui viram "indisponível/oculto" no serializer (denominadores 0).
 */
export function maskProductivityRawAggregatesForCapabilities(
  aggregates: ProductivityRawAggregates,
  capabilities: { serviceOrders: boolean; measurements: boolean; resources: boolean; execution: boolean },
): ProductivityRawAggregates {
  if (!capabilities.serviceOrders) {
    return emptyProductivityRawAggregates();
  }

  let masked: ProductivityRawAggregates = { ...aggregates };

  if (!capabilities.resources) {
    masked = {
      ...masked,
      utilizationNumeratorSeconds: 0,
      utilizationDenominatorSeconds: 0,
    };
  }

  if (!capabilities.measurements) {
    masked = {
      ...masked,
      reworkNumerator: 0,
      reworkDenominator: 0,
      measurementApproved: 0,
      measurementDecided: 0,
    };
  }

  if (!capabilities.execution) {
    masked = {
      ...masked,
      evidenceNumerator: 0,
      evidenceDenominator: 0,
    };
  }

  return masked;
}
