#!/usr/bin/env node
import { Pool, type PoolClient } from 'pg';
import { hashPassword, validatePasswordStrength } from '@cisne/database/seed';
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

  const logins = new Set<string>();
  for (const profile of profiles) {
    profile.login = normalizeLogin(profile.login);
    if (profile.login.length < 3) {
      throw new Error(`CONFIGURATION_ERROR: invalid login for ${profile.key}.`);
    }
    if (logins.has(profile.login)) {
      throw new Error('CONFIGURATION_ERROR: production profile logins must be unique.');
    }
    logins.add(profile.login);

    const passwordCheck = validatePasswordStrength(profile.password);
    if (!passwordCheck.valid) {
      throw new Error(
        `CONFIGURATION_ERROR: password for ${profile.key} rejected: ${passwordCheck.reason ?? 'weak password'}`,
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
    `SELECT identity_id
       FROM identity.credentials
      WHERE login_identifier_normalized = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [login],
  );

  const passwordHash = await hashPassword(password);
  const identityId = current.rows[0]?.identity_id;

  if (identityId) {
    await client.query(
      `UPDATE identity.credentials
          SET password_hash = $2,
              updated_at = NOW()
        WHERE identity_id = $1
          AND revoked_at IS NULL`,
      [identityId, passwordHash],
    );
    await client.query(
      `UPDATE identity.identities
          SET status = 'active',
              disabled_at = NULL,
              updated_at = NOW(),
              version = version + 1
        WHERE id = $1`,
      [identityId],
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

async function replaceRoleCapabilities(
  client: PoolClient,
  roleId: string,
  capabilities: readonly string[],
  actorIdentityId: string,
): Promise<void> {
  await client.query(
    `DELETE FROM "authorization".access_role_capabilities WHERE role_id = $1`,
    [roleId],
  );

  for (const capability of capabilities) {
    await client.query(
      `INSERT INTO "authorization".access_role_capabilities
         (role_id, capability, added_by_identity_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (role_id, capability) DO NOTHING`,
      [roleId, capability, actorIdentityId],
    );
  }
}

async function ensureAssignment(
  client: PoolClient,
  roleId: string,
  identityId: string,
  scopeType: 'GLOBAL' | 'ASSIGNED',
  actorIdentityId: string,
): Promise<void> {
  const current = await client.query(
    `SELECT 1
       FROM "authorization".access_role_assignments
      WHERE role_id = $1
        AND identity_id = $2
        AND scope_type = $3::"authorization".authz_scope_type
        AND scope_anchor IS NULL
        AND revoked_at IS NULL
      LIMIT 1`,
    [roleId, identityId, scopeType],
  );
  if (current.rowCount) {
    return;
  }

  await client.query(
    `INSERT INTO "authorization".access_role_assignments
       (role_id, identity_id, scope_type, assigned_by_identity_id)
     VALUES ($1, $2, $3::"authorization".authz_scope_type, $4)`,
    [roleId, identityId, scopeType, actorIdentityId],
  );
}

async function ensureGrant(
  client: PoolClient,
  identityId: string,
  action: string,
  resourceType: string,
  scopeType: 'GLOBAL' | 'ASSIGNED',
  actorIdentityId: string,
): Promise<void> {
  const current = await client.query(
    `SELECT 1
       FROM "authorization".grants
      WHERE identity_id = $1
        AND action = $2
        AND resource_type = $3
        AND scope_type = $4::"authorization".authz_scope_type
        AND resource_id IS NULL
        AND revoked_at IS NULL
      LIMIT 1`,
    [identityId, action, resourceType, scopeType],
  );
  if (current.rowCount) {
    return;
  }

  await client.query(
    `INSERT INTO "authorization".grants
       (identity_id, action, resource_type, scope_type, granted_by_identity_id)
     VALUES ($1, $2, $3, $4::"authorization".authz_scope_type, $5)`,
    [identityId, action, resourceType, scopeType, actorIdentityId],
  );
}

async function grantFullAccess(
  client: PoolClient,
  roleId: string,
  identityId: string,
  actorIdentityId: string,
  actions: readonly string[],
): Promise<void> {
  await ensureAssignment(client, roleId, identityId, 'GLOBAL', actorIdentityId);

  for (const action of actions) {
    await ensureGrant(
      client,
      identityId,
      action,
      resolveResourceType(action),
      'GLOBAL',
      actorIdentityId,
    );
  }
}

async function restrictEmployee(
  client: PoolClient,
  roleId: string,
  identityId: string,
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
    [identityId, actorIdentityId],
  );

  await client.query(
    `UPDATE "authorization".access_role_assignments
        SET revoked_at = NOW(),
            revoked_by_identity_id = $2,
            version = version + 1
      WHERE identity_id = $1
        AND revoked_at IS NULL`,
    [identityId, actorIdentityId],
  );

  await ensureAssignment(client, roleId, identityId, 'ASSIGNED', actorIdentityId);

  for (const grant of EMPLOYEE_GRANTS) {
    await ensureGrant(
      client,
      identityId,
      grant.action,
      grant.resourceType,
      grant.scopeType,
      actorIdentityId,
    );
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'production') {
    throw new Error('PROFILE_BOOTSTRAP_REJECTED: NODE_ENV must be production.');
  }

  const databaseUrl = requiredEnv('DATABASE_URL');
  const profiles = readProfiles();
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const identityIds = new Map<ProductionProfile['key'], string>();
    for (const profile of profiles) {
      identityIds.set(
        profile.key,
        await upsertIdentity(client, profile.login, profile.password),
      );
    }

    const actorIdentityId = identityIds.get('abrahim');
    if (!actorIdentityId) {
      throw new Error('PROFILE_BOOTSTRAP_FAILED: Abrahim identity missing.');
    }

    const allActions = Object.values(AUTHZ_ACTIONS);

    const fullAccessRoleId = await ensureRole(
      client,
      'FULL_ACCESS',
      'Acesso total',
      'Perfil de produção com acesso global completo ao catálogo de capacidades do CISNE.',
      actorIdentityId,
    );
    await replaceRoleCapabilities(client, fullAccessRoleId, allActions, actorIdentityId);

    for (const profile of profiles.filter((item) => item.fullAccess)) {
      const identityId = identityIds.get(profile.key);
      if (!identityId) {
        throw new Error(`PROFILE_BOOTSTRAP_FAILED: identity missing for ${profile.key}.`);
      }
      await grantFullAccess(
        client,
        fullAccessRoleId,
        identityId,
        actorIdentityId,
        allActions,
      );
    }

    const restrictedRoleId = await ensureRole(
      client,
      'EMPREGADO_RESTRITO',
      'Empregado restrito',
      'Perfil operacional restrito a ordens atribuídas, evidências e leitura operacional mínima.',
      actorIdentityId,
    );
    const assignedCapabilities = EMPLOYEE_GRANTS.filter(
      (grant) => grant.scopeType === 'ASSIGNED',
    ).map((grant) => grant.action);
    await replaceRoleCapabilities(
      client,
      restrictedRoleId,
      assignedCapabilities,
      actorIdentityId,
    );

    const employeeIdentityId = identityIds.get('empregado');
    if (!employeeIdentityId) {
      throw new Error('PROFILE_BOOTSTRAP_FAILED: employee identity missing.');
    }
    await restrictEmployee(
      client,
      restrictedRoleId,
      employeeIdentityId,
      actorIdentityId,
    );

    await client.query('COMMIT');

    console.log(
      JSON.stringify({
        status: 'PRODUCTION_PROFILES_READY',
        logins: profiles.map((profile) => profile.login),
        fullAccess: profiles.filter((profile) => profile.fullAccess).map((profile) => profile.login),
        restricted: profiles.filter((profile) => !profile.fullAccess).map((profile) => profile.login),
        fullAccessActions: allActions.length,
        employeeGrants: EMPLOYEE_GRANTS.length,
      }),
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
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
