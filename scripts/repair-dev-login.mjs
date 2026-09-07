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

const DEFAULT_LOGIN = 'dev-operator@cisne-rondonia.invalid';
const DEFAULT_PASSWORD = 'Dev-Only-1!Synthetic';
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

async function repairCredential(connectionString, login, password) {
  const pool = new Pool({ connectionString });
  const passwordHash = await hashPassword(password);

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
      const grantsAdded = await ensureDevelopmentGlobalGrants(pool, row.identity_id);
      await pool.query('COMMIT');
      return { outcome: 'updated', grantsAdded };
    }

    const identityId = randomUUID();
    const credentialId = randomUUID();

    await pool.query(`INSERT INTO identity.identities (id, status) VALUES ($1, 'active')`, [identityId]);
    await pool.query(
      `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [credentialId, identityId, login, passwordHash],
    );
    const grantsAdded = await ensureDevelopmentGlobalGrants(pool, identityId);
    await pool.query('COMMIT');
    return { outcome: 'created', grantsAdded };
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await pool.end();
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
  if (action.startsWith('resources:resource-type:')) return AUTHZ_RESOURCE_TYPES.ResourcesResourceType;
  if (action.startsWith('resources:labor-type:')) return AUTHZ_RESOURCE_TYPES.ResourcesLaborType;
  if (action.startsWith('resources:asset:')) return AUTHZ_RESOURCE_TYPES.ResourcesAsset;
  if (action.startsWith('documents:document:')) return AUTHZ_RESOURCE_TYPES.DocumentsDocument;
  if (action.startsWith('commercial:policy:')) return AUTHZ_RESOURCE_TYPES.CommercialPolicy;
  if (action.startsWith('commercial:proposal:')) return AUTHZ_RESOURCE_TYPES.CommercialProposal;
  if (action.startsWith('commercial:purchase-order:')) return AUTHZ_RESOURCE_TYPES.CommercialPurchaseOrder;
  if (action.startsWith('commercial:contract:')) return AUTHZ_RESOURCE_TYPES.CommercialContract;
  if (action.startsWith('requests:service-request:')) return AUTHZ_RESOURCE_TYPES.RequestsServiceRequest;
  if (action.startsWith('service-orders:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('measurements:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('billing:')) return AUTHZ_RESOURCE_TYPES.ServiceOrdersServiceOrder;
  if (action.startsWith('people:')) return AUTHZ_RESOURCE_TYPES.PeoplePerson;
  if (action.startsWith('issuer:legal-entity:')) return AUTHZ_RESOURCE_TYPES.IssuerLegalEntity;
  if (action.startsWith('issuer:establishment:')) return AUTHZ_RESOURCE_TYPES.IssuerEstablishment;
  if (action.startsWith('issuer:tax-registration:')) return AUTHZ_RESOURCE_TYPES.IssuerTaxRegistration;
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

  const login = normalizeLogin(process.env['DEV_OPERATOR_LOGIN'] ?? DEFAULT_LOGIN);
  const password = process.env['DEV_SEED_PASSWORD'] ?? DEFAULT_PASSWORD;
  const passwordSource = process.env['DEV_SEED_PASSWORD']
    ? 'DEV_SEED_PASSWORD'
    : 'fallback-default-dev-password';

  const results = [];
  for (const dbName of TARGET_DATABASES) {
    const targetUrl = withDatabase(databaseUrl, dbName);
    try {
      const result = await repairCredential(targetUrl, login, password);
      results.push({ database: dbName, outcome: result.outcome, grantsAdded: result.grantsAdded });
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown error';
      results.push({ database: dbName, outcome: 'skipped', reason });
    }
  }

  process.stdout.write(
    `${JSON.stringify({
      login,
      passwordSource,
      results,
    })}\n`,
  );
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
