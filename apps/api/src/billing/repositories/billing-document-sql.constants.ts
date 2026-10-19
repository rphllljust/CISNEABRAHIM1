export const BILLING_DOCUMENT_RETURNING = `
  id, billing_record_id, service_order_id, measurement_id, client_id, unit_id,
  document_number, sequence_year, sequence_number::text AS sequence_number, version_number,
  replaces_document_id, status::text AS status, document_category,
  emitter_legal_name, emitter_tax_id, emitter_address_snapshot,
  client_legal_name_snapshot, client_tax_id_snapshot, billing_address_snapshot,
  commercial_reference_snapshot, proposal_id, purchase_order_id, purchase_order_number_snapshot, customer_purchase_order_number_snapshot,
  contract_reference, currency_code, payment_terms,
  due_date::text AS due_date, total_amount::text AS total_amount, issued_at,
  stored_document_id, artifact_sha256, artifact_byte_size::text AS artifact_byte_size,
  cancelled_at, cancelled_by_identity_id, cancel_reason, row_version,
  created_at, updated_at, created_by_identity_id, updated_by_identity_id
`;

export const BILLING_DOCUMENT_ITEM_RETURNING = `
  id, billing_document_id, line_number, billing_item_id, measurement_item_id,
  unit_code, quantity::text AS quantity, unit_price::text AS unit_price,
  line_amount::text AS line_amount, line_label, pricing_line_snapshot, created_at
`;
