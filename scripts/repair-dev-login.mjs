#!/usr/bin/env node
import { randomBytes, randomUUID, scrypt } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const requireFromApi = createRequire(resolve(process.cwd(), 'apps/api/package.json'));
const { Pool } = requireFromApi('pg');
const { AUTHZ_ACTIONS } = requireFromApi('./dist/authorization/types/authz-actions.js');
const { AUTHZ_RESOURCE_TYPES } = requireFromApi('./dist/authorization/types/authz-resources.js');
const { AUTHZ_SCOPES } = requireFromApi('./dist/authorization/types/authz-scopes.js');
const {
  ABRAHIM_OWNER_LOGIN,
  EMPREGADO_LOGIN,
  MONICA_OWNER_LOGIN,
  RAFAEL_DEVELOPER_LOGIN,
  runOperationalProfilesSeed,
} = requireFromApi('@cisne/database/seed');

/**
 * Logins estaticos de desenvolvimento.
 *
 * O identificador de cada perfil vem do modulo canonico (`@cisne/database/seed`) para que a
 * lista nao exista em dois lugares; a senha e estatica aqui e em
 * `packages/database/scripts/seed-profiles.mjs`.
 *
 * `broadDevAccess` controla quem recebe o conjunto GLOBAL completo (todas as 263 actions) —
 * tanto como capability do papel quanto como grant direto. Vale para os donos e para o
 * desenvolvedor, por decisao registrada em 2026-09-25.
 *
 * O empregado operacional NAO entra nesse conjunto. A regra registrada e "EMPREGADO: somente
 * ASSIGNED" (prompt-execution-log, "CORRECAO DE PERMISSOES — EMPREGADO SOBRE-PRIVILEGIADO —
 * 2026-09-25"). Para ele, este script NAO cria papel nem adiciona capability alguma: o papel
 * e o conjunto minimo dele sao propriedade do seed canonico, aplicado ao final de cada banco
 * por `applyCanonicalProfiles`.
 *
 * Historico (por que a guarda existe nos dois caminhos): a correcao de 2026-09-25 revogou os
 * 249 grants GLOBAL diretos do empregado, mas o PDP tambem concede por capability de papel
 * (`policy-decision-point.service.ts`, `findRoleDerivedActionRows`). Enquanto este script
 * atribuia as 263 actions ao papel do empregado, o sobre-privilegio continuava efetivo: em
 * 2026-09-25 o login do empregado respondia 200 em `/api/v1/authz/access-admin/*`.
 */
const STATIC_DEV_PROFILES = [
  {
    login: ABRAHIM_OWNER_LOGIN,
    password: 'Cisne-Abrahim-2026!',
    roleCode: 'OWNER',
    roleLabel: 'Dono',
    roleDescription: 'Dono estático do CISNE com acesso global de desenvolvimento.',
    broadDevAccess: true,
  },
  {
    login: MONICA_OWNER_LOGIN,
    password: 'Cisne-Monica-2026!',
    roleCode: 'OWNER',
    roleLabel: 'Dono',
    roleDescription: 'Dono estático do CISNE com acesso global de desenvolvimento.',
    broadDevAccess: true,
  },
  {
    login: RAFAEL_DEVELOPER_LOGIN,
    password: 'Cisne-Rafael-Dev-2026!',
    roleCode: 'DEVELOPER',
    roleLabel: 'Desenvolvedor',
    roleDescription: 'Desenvolvedor estático do CISNE com acesso global de desenvolvimento.',
    broadDevAccess: true,
  },
  {
    login: EMPREGADO_LOGIN,
    password: 'Cisne-Empregado-2026!',
    roleCode: null,
    roleLabel: null,
    roleDescription: null,
    broadDevAccess: false,
  },
];
const TARGET_DATABASES = ['cisne_local_dev', 'cisne_runtime'];

function normalizeLogin(login) {
  return login.trim().toLowerCase();
}

function withDatabase(connectionString, databaseName) {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

async function hashPassword(plain) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(plain, salt, 64);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function repairCredential(connectionString, profile) {
  const login = normalizeLogin(profile.login);
  const pool = new Pool({ connectionString });
  const passwordHash = await hashPassword(profile.password);

  try {
    await pool.query('BEGIN');
    const credential = await pool.query(
      `SELECT id, identity_id
       FROM identity.credentials
       WHERE login_identifier_normalized = $1
         AND revoked_at IS NULL
       LIMIT 1`,
      [login],
    );

    const row = credential.rows[0];
    if (row?.id && row?.identity_id) {
      await pool.query(
        `UPDATE identity.credentials
         SET password_hash = $2,
             updated_at = NOW()
         WHERE id = $1`,
        [row.id, passwordHash],
      );
      await pool.query(
        `UPDATE identity.identities
         SET status = 'active',
             disabled_at = NULL,
             updated_at = NOW(),
             version = version + 1
         WHERE id = $1`,
        [row.identity_id],
      );
      const grantsAdded = await applyBroadDevAccess(pool, row.identity_id, profile);
      await pool.query('COMMIT');
      return { outcome: 'updated', identityId: row.identity_id, grantsAdded };
    }

    const identityId = randomUUID();
    const credentialId = randomUUID();

    await pool.query(`INSERT INTO identity.identities (id, status) VALUES ($1, 'active')`, [
      identityId,
    ]);
    await pool.query(
      `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [credentialId, identityId, login, passwordHash],
    );
    const grantsAdded = await applyBroadDevAccess(pool, identityId, profile);
    await pool.query('COMMIT');
    return { outcome: 'created', identityId, grantsAdded };
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
  }
}

/**
 * Acesso GLOBAL amplo de desenvolvimento: grants diretos + papel com todas as 263 actions.
 *
 * Para `broadDevAccess: false` (empregado operacional) NADA e aplicado — nem grant, nem papel,
 * nem capability. A guarda cobre os DOIS caminhos de autorizacao de proposito: o PDP concede
 * por grant direto E por capability de papel (`policy-decision-point.service.ts`,
 * `findRoleDerivedActionRows`). Guardar apenas os grants deixava o sobre-privilegio efetivo:
 * em 2026-09-25 o login do empregado respondia 200 em `/api/v1/authz/access-admin/*` mesmo com
 * a tabela `grants` limpa.
 */
async function applyBroadDevAccess(pool, identityId, profile) {
  if (!profile.broadDevAccess) {
    return 0;
  }
  await ensureStaticRoleAssignment(pool, identityId, identityId, profile);
  return ensureDevelopmentGlobalGrants(pool, identityId);
}

async function ensureStaticRoleAssignment(pool, identityId, assignedBy, profile) {
  const roleId = await ensureStaticRole(pool, profile, assignedBy);
  await pool.query(
    `INSERT INTO "authorization".access_role_assignments
       (id, role_id, identity_id, scope_type, assigned_by_identity_id)
     VALUES ($1, $2, $3, 'GLOBAL', $4)
     ON CONFLICT DO NOTHING`,
    [randomUUID(), roleId, identityId, assignedBy],
  );
}

async function ensureStaticRole(pool, profile, createdBy) {
  const existing = await pool.query(`SELECT id FROM "authorization".access_roles WHERE code = $1`, [
    profile.roleCode,
  ]);
  const found = existing.rows[0]?.id;
  if (found) {
    await ensureRoleCapabilities(pool, found, createdBy);
    return found;
  }

  const roleId = randomUUID();
  await pool.query(
    `INSERT INTO "authorization".access_roles
       (id, code, label, description, status, created_by_identity_id)
     VALUES ($1, $2, $3, $4, 'ACTIVE', $5)`,
    [roleId, profile.roleCode, profile.roleLabel, profile.roleDescription, createdBy],
  );
  await ensureRoleCapabilities(pool, roleId, createdBy);
  return roleId;
}

async function ensureRoleCapabilities(pool, roleId, addedBy) {
  for (const capability of Object.values(AUTHZ_ACTIONS)) {
    await pool.query(
      `INSERT INTO "authorization".access_role_capabilities
         (id, role_id, capability, added_by_identity_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (role_id, capability) DO NOTHING`,
      [randomUUID(), roleId, capability, addedBy],
    );
  }
}

function resolveResourceType(action) {
  if (action.startsWith('authz:probe:')) return AUTHZ_RESOURCE_TYPES.Probe;
  if (action.startsWith('authz:grant:')) return AUTHZ_RESOURCE_TYPES.Grant;
  if (action.startsWith('authz:approval-matrix:')) return AUTHZ_RESOURCE_TYPES.ApprovalMatrix;
  if (action.startsWith('authz:scoped-record:')) return AUTHZ_RESOURCE_TYPES.ScopedRecord;
  if (action.startsWith('authz:access-admin:')) return AUTHZ_RESOURCE_TYPES.AccessAdmin;
  if (action.startsWith('platform:')) return AUTHZ_RESOURCE_TYPES.Platform;
  if (action.startsWith('client:')) return AUTHZ_RESOURCE_TYPES.Client;
  if (action.startsWith('supplier:')) return AUTHZ_RESOURCE_TYPES.Supplier;
  if (action.startsWith('procurement:')) return AUTHZ_RESOURCE_TYPES.Procurement;
  if (action.startsWith('catalog:service:')) return AUTHZ_RESOURCE_TYPES.CatalogService;
  if (action.startsWith('catalog:unit:')) return AUTHZ_RESOURCE_TYPES.CatalogUnit;
  if (action.startsWith('resources:resource-type:'))
    return AUTHZ_RESOURCE_TYPES.ResourcesResourceType;
  if (action.startsWith('resources:labor-type:')) return AUTHZ_RESOURCE_TYPES.ResourcesLaborType;
  if (action.startsWith('resources:asset:')) return AUTHZ_RESOURCE_TYPES.ResourcesAsset;
  if (action.startsWith('documents:document:')) return AUTHZ_RESOURCE_TYPES.DocumentsDocument;
  if (action.startsWith('commercial:policy:')) return AUTHZ_RESOURCE_TYPES.CommercialPolicy;
  if (action.startsWith('commercial:proposal:')) return AUTHZ_RESOURCE_TYPES.CommercialProposal;
  if (action.startsWith('commercial:purchase-order:'))
    return AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;
  if (action.startsWith('commercial:contract:')) return AUTHZ_RESOURCE_TYPES.CommercialContract;
  if (action.startsWith('requests:service-request:'))
    return AUTHZ_RESOURCE_TYPES.RequestsServiceRequest;
  if (action.startsWith('service-orders:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('measurements:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('billing:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('people:')) return AUTHZ_RESOURCE_TYPES.PeoplePerson;
  if (action.startsWith('issuer:legal-entity:')) return AUTHZ_RESOURCE_TYPES.IssuerLegalEntity;
  if (action.startsWith('issuer:establishment:')) return AUTHZ_RESOURCE_TYPES.IssuerEstablishment;
  if (action.startsWith('issuer:tax-registration:'))
    return AUTHZ_RESOURCE_TYPES.IssuerTaxRegistration;
  if (action.startsWith('issuer:certificate:')) return AUTHZ_RESOURCE_TYPES.IssuerCertificate;
  if (action.startsWith('finance:receivable:')) return AUTHZ_RESOURCE_TYPES.FinanceReceivable;
  if (action.startsWith('finance:payable:')) return AUTHZ_RESOURCE_TYPES.FinancePayable;
  if (action.startsWith('finance:expense:')) return AUTHZ_RESOURCE_TYPES.FinanceExpense;
  if (action.startsWith('finance:collection:')) return AUTHZ_RESOURCE_TYPES.FinanceCollection;
  if (action.startsWith('finance:treasury:')) return AUTHZ_RESOURCE_TYPES.FinanceTreasury;
  if (action.startsWith('finance:budget:')) return AUTHZ_RESOURCE_TYPES.FinanceBudget;
  if (action.startsWith('finance:cash-forecast:')) return AUTHZ_RESOURCE_TYPES.FinanceCashForecast;
  if (action.startsWith('accounting:')) return AUTHZ_RESOURCE_TYPES.AccountingLedger;
  if (action.startsWith('fiscal:document:')) return AUTHZ_RESOURCE_TYPES.FiscalDocument;
  if (action.startsWith('fiscal:period:')) return AUTHZ_RESOURCE_TYPES.FiscalPeriod;
  if (action.startsWith('fiscal:')) return AUTHZ_RESOURCE_TYPES.FiscalTaxEngine;
  if (action.startsWith('inventory:')) return AUTHZ_RESOURCE_TYPES.InventoryStock;
  if (action.startsWith('payroll:')) return AUTHZ_RESOURCE_TYPES.PayrollLedger;
  return AUTHZ_RESOURCE_TYPES.Platform;
}

async function ensureDevelopmentGlobalGrants(pool, identityId) {
  const existing = await pool.query(
    `SELECT action, resource_type
     FROM "authorization".grants
     WHERE identity_id = $1
       AND scope_type = 'GLOBAL'
       AND resource_id IS NULL
       AND revoked_at IS NULL
       AND valid_from <= NOW()
       AND (valid_until IS NULL OR valid_until > NOW())`,
    [identityId],
  );
  const existingPairs = new Set(existing.rows.map((row) => `${row.action}::${row.resource_type}`));

  let added = 0;
  for (const action of Object.values(AUTHZ_ACTIONS)) {
    const resourceType = resolveResourceType(action);
    const key = `${action}::${resourceType}`;
    if (existingPairs.has(key)) {
      continue;
    }

    await pool.query(
      `INSERT INTO "authorization".grants (
         id,
         identity_id,
         action,
         resource_type,
         resource_id,
         scope_type,
         granted_by_identity_id,
         valid_from
       )
       VALUES ($1, $2, $3, $4, NULL, $5, $2, NOW())`,
      [randomUUID(), identityId, action, resourceType, AUTHZ_SCOPES.Global],
    );
    existingPairs.add(key);
    added += 1;
  }
  return added;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), '.env'));

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required in .env');
  }

  const results = [];
  for (const dbName of TARGET_DATABASES) {
    const targetUrl = withDatabase(databaseUrl, dbName);
    for (const profile of STATIC_DEV_PROFILES) {
      const login = normalizeLogin(profile.login);
      try {
        const result = await repairCredential(targetUrl, profile);
        results.push({
          database: dbName,
          login,
          roleCode: profile.roleCode,
          outcome: result.outcome,
          identityId: result.identityId,
          grantsAdded: result.grantsAdded,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'unknown error';
        results.push({
          database: dbName,
          login,
          roleCode: profile.roleCode,
          outcome: 'skipped',
          reason,
        });
      }
    }

    // O seed canonico e quem garante papel e conjunto minimo de grants do empregado
    // operacional (login `empregado@`, papel EMPREGADO, escopo ASSIGNED). E aditivo e
    // idempotente: nunca revoga.
    try {
      const canonical = await applyCanonicalProfiles(targetUrl);
      results.push({
        database: dbName,
        login: '*',
        outcome: 'canonical-profiles-applied',
        ...canonical,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      results.push({ database: dbName, login: '*', outcome: 'canonical-profiles-skipped', reason });
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      logins: STATIC_DEV_PROFILES.map((profile) => normalizeLogin(profile.login)),
      broadDevAccessLogins: STATIC_DEV_PROFILES.filter((profile) => profile.broadDevAccess).map(
        (profile) => normalizeLogin(profile.login),
      ),
      passwordSource: 'static-development-profiles',
      results,
    })}\n`,
  );
}

function passwordForLogin(login) {
  const profile = STATIC_DEV_PROFILES.find(
    (candidate) => normalizeLogin(candidate.login) === normalizeLogin(login),
  );
  if (!profile) {
    throw new Error(`MISSING_STATIC_PROFILE_FOR_${normalizeLogin(login)}`);
  }
  return profile.password;
}

async function applyCanonicalProfiles(connectionString) {
  const pool = new Pool({ connectionString });
  try {
    const result = await runOperationalProfilesSeed(pool, {
      controlePassword: passwordForLogin(ABRAHIM_OWNER_LOGIN),
      controleFinanceiroPassword: passwordForLogin(MONICA_OWNER_LOGIN),
      empregadoPassword: passwordForLogin(EMPREGADO_LOGIN),
    });
    return {
      controleGrantsAdded: result.controleGrants,
      controleFinanceiroGrantsAdded: result.controleFinanceiroGrants,
      empregadoGrantsAdded: result.empregadoGrants,
    };
  } finally {
    await pool.end();
  }
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return;
  }

  const content = readFileSync(filePath, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    if (!key || process.env[key] !== undefined) {
      continue;
    }

    const value = trimmed.slice(separatorIndex + 1).trim();
    process.env[key] = value;
  }
}

main().catch((error) => {
  const reason = error instanceof Error ? error.message : 'unknown error';
  console.error(reason);
  process.exit(1);
});
