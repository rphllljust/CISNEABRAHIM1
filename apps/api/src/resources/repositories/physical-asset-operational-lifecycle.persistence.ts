import type { Pool } from 'pg';

/**
 * Vida operacional do recurso fisico — projecao derivada de dados existentes.
 *
 * Fonte unica: `res.resource_allocations` (a alocacao ja aponta para o ativo E para a OS), ligada a
 * `so.service_orders` para o numero humano e o status. Nenhuma tabela nova, nenhum odometro novo:
 * leituras (mileage/horimetro) NAO entram nesta rodada porque `so.execution_entries` nao referencia
 * o ativo — PARK.
 */
export type AssetAllocationUsageRow = {
  allocation_id: string;
  service_order_id: string;
  order_number: string;
  order_status: string;
  operational_start: string;
  operational_end: string;
  allocation_status: string;
  allocated_at: string;
};

export type AssetOccurrenceRow = {
  id: string;
  service_order_id: string;
  occurrence_code: string;
  description: string;
  recorded_at: string;
  order_number: string;
};

/**
 * Utilizacoes do ativo, mais recentes primeiro (janela limitada — historia infinita nao entra no
 * detalhe). Inclui passado, atual e futuro: a classificacao temporal e feita na derivacao.
 */
export async function queryAssetAllocationUsage(
  pool: Pool,
  physicalAssetId: string,
  limit: number,
): Promise<AssetAllocationUsageRow[]> {
  const result = await pool.query<AssetAllocationUsageRow>(
    `SELECT
       ra.id AS allocation_id,
       ra.service_order_id,
       so.order_number,
       so.status::text AS order_status,
       ra.operational_start,
       ra.operational_end,
       ra.status::text AS allocation_status,
       ra.allocated_at
     FROM res.resource_allocations ra
     INNER JOIN rpt.read_service_orders so ON so.id = ra.service_order_id
     WHERE ra.physical_asset_id = $1
     ORDER BY ra.operational_start DESC, ra.id DESC
     LIMIT $2`,
    [physicalAssetId, limit],
  );
  return result.rows;
}

/** Ocorrencias registradas nas OS em que o ativo foi alocado, mais recentes primeiro. */
export async function queryAssetOccurrences(
  pool: Pool,
  physicalAssetId: string,
  limit: number,
): Promise<AssetOccurrenceRow[]> {
  const result = await pool.query<AssetOccurrenceRow>(
    `SELECT
       eo.id,
       eo.service_order_id,
       eo.occurrence_code,
       eo.description,
       eo.recorded_at,
       so.order_number
     FROM so.execution_occurrences eo
     INNER JOIN rpt.read_service_orders so ON so.id = eo.service_order_id
     WHERE eo.service_order_id IN (
       SELECT ra.service_order_id
       FROM res.resource_allocations ra
       WHERE ra.physical_asset_id = $1
     )
     ORDER BY eo.recorded_at DESC, eo.id DESC
     LIMIT $2`,
    [physicalAssetId, limit],
  );
  return result.rows;
}
