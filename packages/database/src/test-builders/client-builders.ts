import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export async function truncateClientTables(client: DbClient): Promise<void> {
  // A ORDEM importa: `clients.parent_client_id` referencia `clients.id` e `client_groups`
  // referencia `clients`. Num único TRUNCATE ... CASCADE o PostgreSQL resolve as dependências
  // sozinho, então a lista pode declarar todas as tabelas do agregado de uma vez.
  await client.query(`
    TRUNCATE TABLE
      pty.client_addresses,
      pty.client_contacts,
      pty.client_units,
      pty.client_groups,
      pty.clients
    RESTART IDENTITY CASCADE
  `);
}

export async function truncateAllOperationalTables(client: DbClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      cat.service_evidence_requirements,
      cat.service_resource_requirements,
      cat.service_pricing_models,
      cat.service_allowed_units,
      cat.service_legal_classifications,
      cat.service_definition_versions,
      cat.service_definitions,
      cat.service_categories,
      ast.vehicle_profiles,
      ast.physical_assets,
      audit.security_audit_events,
      pty.client_addresses,
      pty.client_contacts,
      pty.client_units,
      pty.client_groups,
      pty.clients,
      pty.supplier_history_events,
      pty.supplier_addresses,
      pty.supplier_contacts,
      pty.suppliers,
      "authorization".decision_audits,
      "authorization".scoped_records,
      "authorization".grants,
      "authorization".scope_refs,
      identity.refresh_tokens,
      identity.refresh_token_families,
      identity.sessions,
      identity.credentials,
      identity.identities
    RESTART IDENTITY CASCADE
  `);
}
