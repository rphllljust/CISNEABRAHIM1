export const MEASUREMENT_RETURNING = `
  id, service_order_id, unit_id, status::text AS status, commercial_reference_snapshot,
  submitted_at, submitted_by_identity_id, review_started_at, review_started_by_identity_id,
  decided_at, decided_by_identity_id, rejection_reason,
  row_version, created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

/**
 * Colunas do item de medição na leitura.
 *
 * `source_measurement_basis_id` e `source_basis_line_key` são a ORIGEM
 * AUTORITATIVA (a base publicada). `source_execution_entry_id` permanece como
 * origem HISTÓRICA, e é `null` em item novo — por isso não há `NOT NULL` aqui:
 * a constraint do banco exige UMA das duas origens, nunca as duas.
 *
 * `planned_quantity` e `planned_unit_of_measure` são a TERCEIRA verdade. Sem
 * elas a tela compararia contra o planejamento ATUAL, e um replanejamento
 * posterior reescreveria o passado da medição.
 */
export const MEASUREMENT_ITEM_RETURNING = `
  id, measurement_id, line_number,
  source_measurement_basis_id, source_basis_line_key, source_execution_entry_id, unit_code,
  planned_quantity::text AS planned_quantity,
  planned_unit_of_measure,
  actual_quantity::text AS actual_quantity,
  measured_quantity::text AS measured_quantity,
  unit_price::text AS unit_price,
  line_amount::text AS line_amount,
  pricing_line_snapshot, notes, created_at, updated_at
`;