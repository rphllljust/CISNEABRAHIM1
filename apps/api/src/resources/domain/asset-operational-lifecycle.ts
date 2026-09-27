import type {
  AssetAllocationUsageRow,
  AssetOccurrenceRow,
} from '../repositories/physical-asset-operational-lifecycle.persistence';

/**
 * Vida operacional do recurso: derivacao pura a partir das alocacoes reais.
 *
 * `resources:asset:read` NAO autoriza ler a OS, o cliente nem a execucao. O elo negado e omitido em
 * silencio, e a derivacao abaixo so classifica o que ja passou pelo filtro de autorizacao.
 */

export type AssetOperationalUsage = {
  allocationId: string;
  serviceOrderId: string;
  orderNumber: string;
  orderStatus: string;
  operationalStart: string;
  operationalEnd: string;
  allocationStatus: string;
  /** Classificacao temporal derivada do relogio — nunca um estado paralelo persistido. */
  timing: 'CURRENT' | 'PAST' | 'FUTURE';
};

export type AssetOccurrence = {
  id: string;
  serviceOrderId: string;
  orderNumber: string;
  occurrenceCode: string;
  description: string;
  recordedAt: string;
};

export type AssetOperationalLifecycle = {
  currentUse: AssetOperationalUsage | null;
  nextUse: AssetOperationalUsage | null;
  history: AssetOperationalUsage[];
  occurrences: AssetOccurrence[];
};

function toUsage(row: AssetAllocationUsageRow, now: number): AssetOperationalUsage {
  const start = Date.parse(row.operational_start);
  const end = Date.parse(row.operational_end);
  const timing: AssetOperationalUsage['timing'] =
    start <= now && now < end ? 'CURRENT' : start > now ? 'FUTURE' : 'PAST';
  return {
    allocationId: row.allocation_id,
    serviceOrderId: row.service_order_id,
    orderNumber: row.order_number,
    orderStatus: row.order_status,
    operationalStart: row.operational_start,
    operationalEnd: row.operational_end,
    allocationStatus: row.allocation_status,
    timing,
  };
}

export function buildAssetOperationalLifecycle(input: {
  allocations: AssetAllocationUsageRow[];
  occurrences: AssetOccurrenceRow[];
  now?: Date;
}): AssetOperationalLifecycle {
  const now = (input.now ?? new Date()).getTime();
  const usages = input.allocations.map((row) => toUsage(row, now));

  const current = usages.find((usage) => usage.timing === 'CURRENT') ?? null;
  const next =
    usages
      .filter((usage) => usage.timing === 'FUTURE')
      .sort(
        (left, right) =>
          Date.parse(left.operationalStart) - Date.parse(right.operationalStart),
      )[0] ?? null;
  const history = usages
    .filter((usage) => usage.timing !== 'FUTURE')
    .sort((left, right) => Date.parse(right.operationalStart) - Date.parse(left.operationalStart));

  return {
    currentUse: current,
    nextUse: next,
    history,
    occurrences: input.occurrences.map((row) => ({
      id: row.id,
      serviceOrderId: row.service_order_id,
      orderNumber: row.order_number,
      occurrenceCode: row.occurrence_code,
      description: row.description,
      recordedAt: row.recorded_at,
    })),
  };
}
