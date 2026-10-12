#!/usr/bin/env node
import { Pool, type PoolClient } from 'pg';
import { hashPassword, validatePasswordStrength } from '@cisne/database';
import { AUTHZ_ACTIONS } from '../../../authorization/types/authz-actions';

const CONFIRM_VALUE = 'I_UNDERSTAND';

type ProductionProfile = {
  key: 'abrahim' | 'monica' | 'rafael' | 'empregado';
  login: string;
  password: string;
  fullAccess: boolean;
};

type EmployeeGrant = {
  action: string;
  resourceType: string;
  scopeType: 'GLOBAL' | 'ASSIGNED';
};

const EMPLOYEE_GRANTS: readonly EmployeeGrant[] = [
  { action: 'service-orders:service-order:read', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:service-order:list', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:execution:read', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:execution:start', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:execution:complete', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:execution:record', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'service-orders:resource-allocation:read', resourceType: 'service-orders:service-order', scopeType: 'ASSIGNED' },
  { action: 'documents:document:create', resourceType: 'documents:document', scopeType: 'GLOBAL' },
  { action: 'documents:document:read', resourceType: 'documents:document', scopeType: 'GLOBAL' },
  { action: 'resources:asset:read', resourceType: 'resources:asset', scopeType: 'GLOBAL' },
  { action: 'resources:resource-type:list', resourceType: 'resources:resource-type', scopeType: 'GLOBAL' },
] as const;

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`CONFIGURATION_ERROR: ${name} is required.`);
  }
  return value;
}

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

async function rollbackKeepingPrimaryCause(client: PoolClient): Promise<Error | undefined> {
  try {
    await client.query('ROLLBACK');
    return undefined;
  } catch (rollbackFailure) {
    return rollbackFailure instanceof Error
      ? rollbackFailure
      : new Error(String(rollbackFailure));
  }
}

function readProfiles(): ProductionProfile[] {
  if (requiredEnv('PROD_PROFILES_CONFIRM') !== CONFIRM_VALUE) {
    throw new Error('CONFIGURATION_ERROR: PROD_PROFILES_CONFIRM token mismatch.');
  }

  const profiles: ProductionProfile[] = [
    {
      key: 'abrahim',
      login: requiredEnv('PROD_PROFILE_ABRAHIM_LOGIN'),
      password: requiredEnv('PROD_PROFILE_ABRAHIM_PASSWORD'),
      fullAccess: true,
    },
    {
      key: 'monica',
      login: requiredEnv('PROD_PROFILE_MONICA_LOGIN'),
      password: requiredEnv('PROD_PROFILE_MONICA_PASSWORD'),
      fullAccess: true,
    },
    {
      key: 'rafael',
      login: requiredEnv('PROD_PROFILE_RAFAEL_LOGIN'),
      password: requiredEnv('PROD_PROFILE_RAFAEL_PASSWORD'),
      fullAccess: true,
    },
    {
      key: 'empregado',
      login: requiredEnv('PROD_PROFILE_EMPREGADO_LOGIN'),
      password: requiredEnv('PROD_PROFILE_EMPREGADO_PASSWORD'),
      fullAccess: false,
    },
  ];

  const uniqueLogins = new Set<string>();
  for (const profile of profiles) {
    profile.login = normalizeLogin(profile.login);
    if (profile.login.length < 3) {
      throw new Error(`CONFIGURATION_ERROR: invalid login for ${profile.key}.`);
    }
    if (uniqueLogins.has(profile.login)) {
      throw new Error('CONFIGURATION_ERROR: production profile logins must be unique.');
    }
    uniqueLogins.add(profile.login);

    const strength = validatePasswordStrength(profile.password);
    if (!strength.valid) {
      throw new Error(
        `CONFIGURATION_ERROR: password for ${profile.key} rejected: ${strength.reason ?? 'weak password'}`,
      );
    }
  }

  return profiles;
}

function resolveResourceType(action: string): string {
  if (action.startsWith('authz:probe:')) return 'authz:probe';
  if (action.startsWith('authz:grant:')) return 'authz:grant';
  if (action.startsWith('authz:approval-matrix:')) return 'authz:approval-matrix';
  if (action.startsWith('authz:scoped-record:')) return 'authz:scoped-record';
  if (action.startsWith('authz:access-admin:')) return 'authz:access-admin';
  if (action.startsWith('platform:')) return 'platform:system';
  if (action.startsWith('client:')) return 'client:client';
  if (action.startsWith('supplier:')) return 'supplier:supplier';
  if (action.startsWith('procurement:')) return 'procurement:procurement';
  if (action.startsWith('catalog:service:')) return 'catalog:service';
  if (action.startsWith('catalog:unit:')) return 'catalog:unit';
  if (action.startsWith('resources:resource-type:')) return 'resources:resource-type';
  if (action.startsWith('resources:labor-type:')) return 'resources:labor-type';
  if (action.startsWith('resources:asset:')) return 'resources:asset';
  if (action.startsWith('documents:document:')) return 'documents:document';
  if (action.startsWith('commercial:policy:')) return 'commercial:policy';
  if (action.startsWith('commercial:proposal:')) return 'commercial:proposal';
  if (action.startsWith('commercial:purchase-order:')) return 'commercial:purchase-order';
  if (action.startsWith('commercial:contract:')) return 'commercial:contract';
  if (action.startsWith('requests:service-request:')) return 'requests:service-request';
  if (action.startsWith('service-orders:')) return 'service-orders:service-order';
  if (action.startsWith('measurements:')) return 'service-orders:service-order';
  if (action.startsWith('billing:')) return 'service-orders:service-order';
  if (action.startsWith('people:')) return 'people:person';
  if (action.startsWith('issuer:legal-entity:')) return 'issuer:legal-entity';
  if (action.startsWith('issuer:establishment:')) return 'issuer:establishment';
  if (action.startsWith('issuer:tax-registration:')) return 'issuer:tax-registration';
  if (action.startsWith('issuer:certificate:')) return 'issuer:certificate';
  if (action.startsWith('finance:receivable:')) return 'finance:receivable';
  if (action.startsWith('finance:payable:')) return 'finance:payable';
  if (action.startsWith('finance:expense:')) return 'finance:payable';
  if (action.startsWith('finance:collection:')) return 'finance:receivable';
  if (action.startsWith('finance:treasury:')) return 'finance:treasury';
  if (action.startsWith('finance:budget:')) return 'finance:payable';
  if (action.startsWith('finance:cash-forecast:')) return 'finance:receivable';
  if (action.startsWith('accounting:')) return 'accounting:ledger';
  if (action.startsWith('fiscal:document:')) return 'fiscal:document';
  if (action.startsWith('fiscal:period:')) return 'fiscal:period';
  if (action.startsWith('fiscal:')) return 'fiscal:tax-engine';
  if (action.startsWith('inventory:')) return 'inventory:stock';
  if (action.startsWith('payroll:')) return 'payroll:ledger';
  return 'platform:system';
}

async function upsertIdentity(
  client: PoolClient,
  login: string,
  password: string,
): Promise<string> {
  const current = await client.query<{ identity_id: string }>(
    `SELECT c.identity_id
       FROM identity.credentials c
      WHERE c.login_identifier_normalized = $1
        AND c.revoked_at IS NULL
      LIMIT 1`,
    [login],
  );

  const passwordHash = await hashPassword(password);
  const identityId = current.rows[0]?.identity_id;

  if (identityId) {
    await client.query(
      `UPDATE identity.identities
          SET status = 'active',
              disabled_at = NULL,
              updated_at = NOW(),
              version = version + 1
        WHERE id = $1`,
      [identityId],
    );
    await client.query(
      `UPDATE identity.credentials
          SET password_hash = $2,
              updated_at = NOW()
        WHERE identity_id = $1
          AND login_identifier_normalized = $3
          AND revoked_at IS NULL`,
      [identityId, passwordHash, login],
    );
    return identityId;
  }

  const identity = await client.query<{ id: string }>(
    `INSERT INTO identity.identities (status)
     VALUES ('active')
     RETURNING id`,
  );
  const createdId = identity.rows[0]?.id;
  if (!createdId) {
    throw new Error(`PROFILE_BOOTSTRAP_FAILED: could not create identity for ${login}.`);
  }

  await client.query(
    `INSERT INTO identity.credentials
       (identity_id, login_identifier_normalized, password_hash)
     VALUES ($1, $2, $3)`,
    [createdId, login, passwordHash],
  );

  return createdId;
}

async function ensureRole(
  client: PoolClient,
  code: string,
  label: string,
  description: string,
  actorIdentityId: string,
): Promise<string> {
  const current = await client.query<{ id: string }>(
    `SELECT id FROM "authorization".access_roles WHERE code = $1`,
    [code],
  );

  const existingId = current.rows[0]?.id;
  if (existingId) {
    await client.query(
      `UPDATE "authorization".access_roles
          SET label = $2,
              description = $3,
              status = 'ACTIVE',
              updated_at = NOW(),
              version = version + 1
        WHERE id = $1`,
      [existingId, label, description],
    );
    return existingId;
  }

  const created = await client.query<{ id: string }>(
    `INSERT INTO "authorization".access_roles
       (code, label, description, status, created_by_identity_id)
     VALUES ($1, $2, $3, 'ACTIVE', $4)
     RETURNING id`,
    [code, label, description, actorIdentityId],
  );
  const id = created.rows[0]?.id;
  if (!id) {
    throw new Error(`PROFILE_BOOTSTRAP_FAILED: could not create role ${code}.`);
  }
  return id;
}

async function replaceRoleCapabilitiesBulk(
  client: PoolClient,
  roleId: string,
  capabilities: readonly string[],
  actorIdentityId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM "authorization".access_role_capabilities WHERE role_id = $1`,
    [roleId],
  );

  if (capabilities.length === 0) {
    return;
  }

  await client.query(
    `INSERT INTO "authorization".access_role_capabilities
       (role_id, capability, added_by_identity_id)
     SELECT $1, capability, $3
       FROM unnest($2::text[]) AS t(capability)
     ON CONFLICT (role_id, capability) DO NOTHING`,
    [roleId, capabilities, actorIdentityId],
  );
}

async function ensureFullAssignmentsBulk(
  client: PoolClient,
  roleId: string,
  identityIds: readonly string[],
  actorIdentityId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO "authorization".access_role_assignments
       (role_id, identity_id, scope_type, assigned_by_identity_id)
     SELECT $1,
            identity_id,
            'GLOBAL'::"authorization".authz_scope_type,
            $3
       FROM unnest($2::uuid[]) AS t(identity_id)
     ON CONFLICT DO NOTHING`,
    [roleId, identityIds, actorIdentityId],
  );
}

async function ensureFullGrantsBulk(
  client: PoolClient,
  identityIds: readonly string[],
  actions: readonly string[],
  actorIdentityId: string,
): Promise<void> {
  const actionRows = actions.map((action) => ({
    action,
    resource_type: resolveResourceType(action),
  }));

  await client.query(
    `WITH target_identities AS (
       SELECT unnest($1::uuid[]) AS identity_id
     ),
     target_actions AS (
       SELECT action, resource_type
         FROM jsonb_to_recordset($2::jsonb)
           AS x(action text, resource_type text)
     )
     INSERT INTO "authorization".grants
       (identity_id, action, resource_type, scope_type, granted_by_identity_id)
     SELECT ti.identity_id,
            ta.action,
            ta.resource_type,
            'GLOBAL'::"authorization".authz_scope_type,
            $3
       FROM target_identities ti
       CROSS JOIN target_actions ta
      WHERE NOT EXISTS (
        SELECT 1
          FROM "authorization".grants g
         WHERE g.identity_id = ti.identity_id
           AND g.action = ta.action
           AND g.resource_type = ta.resource_type
           AND g.scope_type = 'GLOBAL'::"authorization".authz_scope_type
           AND g.resource_id IS NULL
           AND g.revoked_at IS NULL
      )`,
    [identityIds, JSON.stringify(actionRows), actorIdentityId],
  );
}

async function replaceEmployeeAccess(
  client: PoolClient,
  roleId: string,
  employeeIdentityId: string,
  actorIdentityId: string,
): Promise<void> {
  await client.query(
    `UPDATE "authorization".grants
        SET revoked_at = NOW(),
            revoked_by_identity_id = $2,
            version = version + 1,
            updated_at = NOW()
      WHERE identity_id = $1
        AND revoked_at IS NULL`,
    [employeeIdentityId, actorIdentityId],
  );

  await client.query(
    `UPDATE "authorization".access_role_assignments
        SET revoked_at = NOW(),
            revoked_by_identity_id = $2,
            version = version + 1
      WHERE identity_id = $1
        AND revoked_at IS NULL`,
    [employeeIdentityId, actorIdentityId],
  );

  await client.query(
    `INSERT INTO "authorization".access_role_assignments
       (role_id, identity_id, scope_type, assigned_by_identity_id)
     VALUES (
       $1,
       $2,
       'ASSIGNED'::"authorization".authz_scope_type,
       $3
     )`,
    [roleId, employeeIdentityId, actorIdentityId],
  );

  await client.query(
    `INSERT INTO "authorization".grants
       (identity_id, action, resource_type, scope_type, granted_by_identity_id)
     SELECT $1,
            g.action,
            g.resource_type,
            g.scope_type::"authorization".authz_scope_type,
            $3
       FROM jsonb_to_recordset($2::jsonb)
         AS g(action text, resource_type text, scope_type text)`,
    [employeeIdentityId, JSON.stringify(EMPLOYEE_GRANTS.map((grant) => ({
      action: grant.action,
      resource_type: grant.resourceType,
      scope_type: grant.scopeType,
    }))), actorIdentityId],
  );
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('PROFILE_BOOTSTRAP_REJECTED: NODE_ENV must be production.');
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const profiles = readProfiles();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });

  const identityIds = new Map<ProductionProfile['key'], string>();

  // Credenciais sao materializadas e confirmadas primeiro. Assim, falhas posteriores
  // de RBAC nao deixam a autenticacao de producao presa a uma transacao longa.
  {
    const client = await pool.connect();
    let evictWith: Error | undefined;

    try {
      await client.query('BEGIN');

      for (const profile of profiles) {
        identityIds.set(
          profile.key,
          await upsertIdentity(client, profile.login, profile.password),
        );
      }

      await client.query('COMMIT');

      console.log(
        JSON.stringify({
          status: 'AUTH_CREDENTIALS_READY',
          logins: profiles.map((profile) => profile.login),
        }),
      );
    } catch (error) {
      evictWith = await rollbackKeepingPrimaryCause(client);
      throw error;
    } finally {
      client.release(evictWith);
    }
  }

  const actorIdentityId = identityIds.get('abrahim');
  const employeeIdentityId = identityIds.get('empregado');
  if (!actorIdentityId || !employeeIdentityId) {
    await pool.end();
    throw new Error('PROFILE_BOOTSTRAP_FAILED: required identities missing.');
  }

  const client = await pool.connect();
  let evictWith: Error | undefined;

  try {
    await client.query('BEGIN');

    const allActions = Object.values(AUTHZ_ACTIONS);

    const fullAccessRoleId = await ensureRole(
      client,
      'FULL_ACCESS',
      'Acesso total',
      'Perfil de producao com acesso global completo ao catalogo de capacidades do CISNE.',
      actorIdentityId,
    );

    await replaceRoleCapabilitiesBulk(
      client,
      fullAccessRoleId,
      allActions,
      actorIdentityId,
    );

    const fullAccessIdentityIds = profiles
      .filter((profile) => profile.fullAccess)
      .map((profile) => identityIds.get(profile.key))
      .filter((identityId): identityId is string => Boolean(identityId));

    await ensureFullAssignmentsBulk(
      client,
      fullAccessRoleId,
      fullAccessIdentityIds,
      actorIdentityId,
    );

    await ensureFullGrantsBulk(
      client,
      fullAccessIdentityIds,
      allActions,
      actorIdentityId,
    );

    const restrictedRoleId = await ensureRole(
      client,
      'EMPREGADO_RESTRITO',
      'Empregado restrito',
      'Perfil operacional restrito a ordens atribuidas, evidencias e leitura operacional minima.',
      actorIdentityId,
    );

    await replaceRoleCapabilitiesBulk(
      client,
      restrictedRoleId,
      EMPLOYEE_GRANTS.map((grant) => grant.action),
      actorIdentityId,
    );

    await replaceEmployeeAccess(
      client,
      restrictedRoleId,
      employeeIdentityId,
      actorIdentityId,
    );

    await client.query('COMMIT');

    console.log(
      JSON.stringify({
        status: 'PRODUCTION_PROFILES_READY',
        fullAccess: profiles
          .filter((profile) => profile.fullAccess)
          .map((profile) => profile.login),
        restricted: profiles
          .filter((profile) => !profile.fullAccess)
          .map((profile) => profile.login),
        fullAccessActions: allActions.length,
        employeeGrants: EMPLOYEE_GRANTS.length,
      }),
    );
  } catch (error) {
    evictWith = await rollbackKeepingPrimaryCause(client);
    throw error;
  } finally {
    client.release(evictWith);
    await pool.end();
  }
}

void main().catch((error) => {
  console.error(
    'PRODUCTION_PROFILE_BOOTSTRAP_FAILED',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
