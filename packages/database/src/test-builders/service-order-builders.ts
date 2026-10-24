import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

/**
 * CLEANUP DETERMINISTICO DE SERVICE ORDERS E SUAS DEPENDENCIAS.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * REGRA DE ORDEM — FILHOS ANTES DOS PAIS
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * A lista abaixo esta ordenada por profundidade no grafo de FKs reais: netos, filhos, pais.
 * A ordem NAO e estetica. `0025`, `0019` e `0073` declaram FKs sem `ON DELETE CASCADE`, logo o
 * Postgres RECUSA remover o pai enquanto existir filho apontando para ele.
 *
 * DEFEITOS MEDIDOS (run 39836194984, worker 2, `operational-dashboard.integration.spec.ts`):
 *
 *   update or delete on table "billing_records" violates foreign key constraint
 *   "billing_documents_billing_record_id_fkey"
 *
 * Bastava um teste anterior ter emitido documento fiscal para este helper falhar no `beforeEach`
 * do suite seguinte — DETERMINISTICAMENTE. Nao era concorrencia entre workers, nem LPT, nem clone:
 * era ordem de limpeza.
 *
 * VIOLACOES ENCONTRADAS NA AUDITORIA (cruzando helper x FKs de todas as migrations):
 *
 *   1. `bil.billing_documents` removida depois de `bil.billing_records`  (0025, sem CASCADE)
 *   2. `so.service_order_history_events` removida depois de `so.service_orders` (0019, RESTRICT)
 *   3. `bil.recurring_billing_schedules` removida depois de `so.service_orders` (0073, RESTRICT)
 *   4. `bil.billing_document_items` removida depois de `bil.billing_items` (0025, SET NULL)
 *
 * A #2 e a #4 nao apareciam em nenhum log ainda — foram encontradas por auditoria estatica antes
 * de virarem falha de CI. Corrigir so a #1 seria trocar um bug por tres.
 *
 * NAO HA ATALHO AQUI: nada de `TRUNCATE CASCADE`, `session_replication_role` ou desabilitar FK.
 * Esses recursos apagariam estado fora do contrato do helper e mascarariam ordem errada — a
 * fixture precisa respeitar o schema real, e essa e a garantia que protege as outras 35 suites.
 */
export async function truncateServiceOrderTables(client: DbClient): Promise<void> {
  // `service_requests` nao e removida: ela e DESVINCULADA da OS (a FK e `converted_service_order_id`).
  // Manter o pedido como CANCELLED preserva o historico de solicitacao que outros suites consultam.
  await client.query(
    `UPDATE sr.service_requests
     SET status = 'CANCELLED',
         cancellation_reason = 'integration test cleanup',
         converted_service_order_id = NULL
     WHERE converted_service_order_id IS NOT NULL`,
  );

  // ─── Nivel 1: netos de billing_documents ────────────────────────────────────────────────────
  await client.query('DELETE FROM bil.billing_document_command_idempotency');
  await client.query('DELETE FROM bil.billing_document_history_events');
  await client.query('DELETE FROM bil.billing_document_items');

  // ─── Nivel 2: filhos de billing_records ─────────────────────────────────────────────────────
  await client.query('DELETE FROM bil.billing_command_idempotency');
  await client.query('DELETE FROM bil.billing_history_events');
  // `billing_documents` precisa sair ANTES de `billing_records` (FK sem CASCADE em 0025) e ANTES
  // de `billing_items` (que `billing_document_items.billing_item_id` referencia com SET NULL).
  await client.query('DELETE FROM bil.billing_documents');
  await client.query('DELETE FROM bil.billing_items');
  // com.purchase_order_consumption_entries referencia bil.billing_records com ON DELETE RESTRICT
  // (0037): sem esta linha o DELETE de billing_records falha sempre que um teste anterior deixou
  // consumo de PO para tras.
  await client.query('DELETE FROM com.purchase_order_consumption_entries');

  // ─── Nivel 3: billing_records (pai de billing_*) ────────────────────────────────────────────
  await client.query('DELETE FROM bil.billing_records');

  // ─── Nivel 1: netos de measurements ─────────────────────────────────────────────────────────
  await client.query('DELETE FROM msr.measurement_command_idempotency');
  await client.query('DELETE FROM msr.measurement_history_events');
  await client.query('DELETE FROM msr.measurement_adjustments');
  await client.query('DELETE FROM msr.measurement_items');

  // ─── Nivel 2: measurements ──────────────────────────────────────────────────────────────────
  await client.query('DELETE FROM msr.measurements');

  // ─── Nivel 1: netos de service_orders ───────────────────────────────────────────────────────
  await client.query('DELETE FROM so.execution_entry_history_events');
  await client.query('DELETE FROM so.operational_cost_entries');
  await client.query('DELETE FROM so.execution_occurrences');
  await client.query('DELETE FROM so.execution_occurrences');
  /**
   * DISPATCH + EXECUTION + ACTUALS (0107) — filhos de `so.service_orders` que
   * chegaram depois e TODOS com FK RESTRICT.
   *
   * A ordem aqui é de dependência, não alfabética:
   *
   *   `measurement_basis`   → referencia `execution_closures`; sai primeiro
   *   `execution_closures`  → remove após a base de medição
   *   `execution_actuals`   → referencia `execution_evidence`
   *   `execution_meter_readings` / `execution_fuel_records` / `execution_signatures`
   *                         → referenciam `execution_evidence`
   *   `execution_evidence`  → por último, porque os três acima apontam para ela
   *
   * Sem esta limpeza, o `beforeEach` de QUALQUER suite que usa este helper falha ao
   * apagar `so.service_orders`, e a falha aparece num teste que não tem relação
   * nenhuma com a capability — exatamente o tipo de erro que já custou tempo neste
   * repositório (a regressão de ordem de `billing_documents` descrita no spec deste
   * próprio arquivo).
   */
  await client.query('DELETE FROM so.measurement_basis');
  await client.query('DELETE FROM so.execution_closures');
  await client.query('DELETE FROM so.execution_situations');
  await client.query('DELETE FROM so.execution_events');
  await client.query('DELETE FROM so.execution_actuals');
  await client.query('DELETE FROM so.execution_meter_readings');
  await client.query('DELETE FROM so.execution_fuel_records');
  await client.query('DELETE FROM so.execution_signatures');
  await client.query('DELETE FROM so.service_order_dispatches');
  await client.query('DELETE FROM so.execution_evidence');
  await client.query('DELETE FROM so.execution_entries');
  await client.query('DELETE FROM so.execution_command_idempotency');
  await client.query('DELETE FROM res.resource_allocation_history_events');
  await client.query('DELETE FROM res.resource_allocations');
  await client.query('DELETE FROM so.planned_resources');

  // RECURRING BILLING (0073): periodos -> schedules -> service_orders, ambas RESTRICT.
  await client.query('DELETE FROM bil.recurring_billing_periods');
  await client.query('DELETE FROM bil.recurring_billing_schedules');

  // ─── Nivel 2: service_orders — o ULTIMO ────────────────────────────────────────────────────
  // `service_order_history_events` referencia `service_orders` com ON DELETE RESTRICT (0019), logo
  // precisa sair antes. Estava depois — a auditoria pegou, nenhum log tinha reclamado ainda.
  await client.query('DELETE FROM so.service_order_history_events');
  await client.query('DELETE FROM so.service_orders');
}
