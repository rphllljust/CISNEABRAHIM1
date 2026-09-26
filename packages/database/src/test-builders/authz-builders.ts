import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

type DbClient = Pool | PoolClient;

export type AuthzScopeTypeDb =
  | 'GLOBAL'
  | 'OWN'
  | 'ASSIGNED'
  | 'UNIT'
  | 'CLIENT'
  | 'CONTRACT'
  | 'DOCUMENT'
  | 'FINANCIAL'
  | 'PLATFORM';

export type InsertGrantInput = {
  identityId: string;
  action: string;
  resourceType: string;
  scopeType: AuthzScopeTypeDb;
  grantedByIdentityId: string;
  resourceId?: string;
  validFrom?: string;
  validUntil?: string;
  revokedAt?: string;
};

export type InsertScopeRefInput = {
  scopeType: Extract<AuthzScopeTypeDb, 'UNIT' | 'CLIENT' | 'CONTRACT' | 'DOCUMENT' | 'FINANCIAL'>;
  refId: string;
};

export type InsertScopedRecordInput = {
  ownerIdentityId: string;
  assignedIdentityId?: string;
  unitId: string;
  clientId: string;
  contractId: string;
  documentId: string;
  isFinancial?: boolean;
  label?: string;
};

export async function insertScopeRef(client: DbClient, input: InsertScopeRefInput): Promise<void> {
  await client.query(
    `INSERT INTO "authorization".scope_refs (scope_type, ref_id)
     VALUES ($1, $2)
     ON CONFLICT DO NOTHING`,
    [input.scopeType, input.refId],
  );
}

export async function insertScopedRecord(
  client: DbClient,
  input: InsertScopedRecordInput,
): Promise<string> {
  const recordId = randomUUID();
  await client.query(
    `INSERT INTO "authorization".scoped_records (
       id,
       owner_identity_id,
       assigned_identity_id,
       unit_id,
       client_id,
       contract_id,
       document_id,
       is_financial,
       label
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      recordId,
      input.ownerIdentityId,
      input.assignedIdentityId ?? null,
      input.unitId,
      input.clientId,
      input.contractId,
      input.documentId,
      input.isFinancial ?? false,
      input.label ?? '',
    ],
  );
  return recordId;
}

export async function insertGrant(client: DbClient, input: InsertGrantInput): Promise<string> {
  const grantId = randomUUID();
  await client.query(
    `INSERT INTO "authorization".grants (
       id,
       identity_id,
       action,
       resource_type,
       resource_id,
       scope_type,
       granted_by_identity_id,
       valid_from,
       valid_until,
       revoked_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9::timestamptz, $10::timestamptz)`,
    [
      grantId,
      input.identityId,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.scopeType,
      input.grantedByIdentityId,
      input.validFrom ?? null,
      input.validUntil ?? null,
      input.revokedAt ?? null,
    ],
  );
  return grantId;
}

/**
 * Garante a concessão sem duplicar: a tupla ativa
 * (identity_id, action, resource_type, scope_type, COALESCE(resource_id,'')) é única por
 * `grants_active_scope_unique_idx`. Diferente de `insertGrant`, tolera concessão já ativa
 * (ex.: capability já fornecida pelo perfil do ator) em vez de violar a unicidade.
 * Retorna o id da concessão ativa.
 */
export async function ensureGrant(client: DbClient, input: InsertGrantInput): Promise<string> {
  const existing = await client.query<{ id: string }>(
    `SELECT id
     FROM "authorization".grants
     WHERE identity_id = $1
       AND action = $2
       AND resource_type = $3
       AND scope_type = $4::"authorization".authz_scope_type
       AND COALESCE(resource_id, '') = COALESCE($5, '')
       AND revoked_at IS NULL
     LIMIT 1`,
    [input.identityId, input.action, input.resourceType, input.scopeType, input.resourceId ?? null],
  );
  const found = existing.rows[0]?.id;
  if (found) {
    return found;
  }
  try {
    return await insertGrant(client, input);
  } catch (error) {
    if ((error as { code?: string }).code !== '23505') {
      throw error;
    }
    const retried = await client.query<{ id: string }>(
      `SELECT id
       FROM "authorization".grants
       WHERE identity_id = $1
         AND action = $2
         AND resource_type = $3
         AND scope_type = $4::"authorization".authz_scope_type
         AND COALESCE(resource_id, '') = COALESCE($5, '')
         AND revoked_at IS NULL
       LIMIT 1`,
      [input.identityId, input.action, input.resourceType, input.scopeType, input.resourceId ?? null],
    );
    const concurrent = retried.rows[0]?.id;
    if (concurrent) {
      return concurrent;
    }
    throw error;
  }
}

export async function truncateAuthorizationTables(client: DbClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      "authorization".access_role_capabilities,
      "authorization".access_role_assignments,
      "authorization".access_roles,
      "authorization".approval_matrix_rules,
      "authorization".approval_matrix_versions,
      "authorization".approval_matrices,
      "authorization".approval_role_assignments,
      "authorization".decision_audits,
      "authorization".scoped_records,
      "authorization".grants,
      "authorization".scope_refs
    RESTART IDENTITY CASCADE
  `);
}

export async function truncateIdentityAndAuthorizationTables(client: DbClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      audit.security_audit_events,
      "authorization".access_role_capabilities,
      "authorization".access_role_assignments,
      "authorization".access_roles,
      "authorization".approval_matrix_rules,
      "authorization".approval_matrix_versions,
      "authorization".approval_matrices,
      "authorization".approval_role_assignments,
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
  // FK de establishments/legal_entities para identities faz o CASCADE apagar o emissor.
  await ensureIntegrationDefaultIssuer(client);
}

/** Emissor default só para testes. Não é fallback de produção. */
export async function ensureIntegrationDefaultIssuer(client: DbClient): Promise<void> {
  const existing = await client.query(
    `SELECT 1
     FROM pty.establishments est
     INNER JOIN pty.establishment_tax_registrations tr
       ON tr.establishment_id = est.id
      AND tr.tax_kind = 'CNPJ'
      AND tr.status = 'ACTIVE'
     WHERE est.status = 'ACTIVE'
       AND est.is_default_issuer
     LIMIT 1`,
  );
  if ((existing.rowCount ?? 0) > 0) {
    return;
  }

  const legal = await client.query<{ id: string }>(
    `INSERT INTO pty.legal_entities (legal_name, trade_name)
     VALUES ('CISNE TEST ISSUER', 'CISNE TEST')
     RETURNING id`,
  );
  const legalEntityId = legal.rows[0]!.id;
  const establishment = await client.query<{ id: string }>(
    `INSERT INTO pty.establishments (
       legal_entity_id, code, trade_name, is_default_issuer,
       street, number, district, city, state, postal_code, country
     ) VALUES ($1, 'MATRIZ', 'CISNE TEST', true,
       'RUA TESTE', '100', 'CENTRO', 'PORTO VELHO', 'RO', '76801000', 'BR')
     RETURNING id`,
    [legalEntityId],
  );
  await client.query(
    `INSERT INTO pty.establishment_tax_registrations (establishment_id, tax_kind, normalized_number, status)
     VALUES ($1, 'CNPJ', '11897171000181', 'ACTIVE')`,
    [establishment.rows[0]!.id],
  );
}
