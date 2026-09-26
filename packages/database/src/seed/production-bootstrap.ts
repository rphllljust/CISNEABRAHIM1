import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTransaction } from '../transaction';
import { assertProductionBootstrapAllowed } from './environment';
import { hashPassword, validatePasswordStrength } from './password-policy';
import type { ProductionBootstrapInput, ProductionBootstrapResult } from './types';

function normalizeLogin(login: string): string {
  return login.trim().toLowerCase();
}

async function countIdentities(pool: Pool): Promise<number> {
  const result = await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM identity.identities`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function findIdentityByLogin(
  pool: Pool,
  login: string,
): Promise<{ identityId: string } | null> {
  const normalized = normalizeLogin(login);
  const result = await pool.query<{ identity_id: string }>(
    `SELECT identity_id
     FROM identity.credentials
     WHERE login_identifier_normalized = $1`,
    [normalized],
  );

  const identityId = result.rows[0]?.identity_id;
  return identityId ? { identityId } : null;
}

/**
 * PRODUCTION_BOOTSTRAP — manual first identity only.
 * Never runs on application startup. No default credentials.
 */
export async function runProductionBootstrap(
  pool: Pool,
  input: ProductionBootstrapInput,
): Promise<ProductionBootstrapResult> {
  assertProductionBootstrapAllowed('PRODUCTION_BOOTSTRAP');

  if (input.confirmToken !== 'I_UNDERSTAND') {
    return {
      outcome: 'rejected',
      login: normalizeLogin(input.login),
      message: 'Bootstrap rejected: BOOTSTRAP_CONFIRM token mismatch.',
    };
  }

  const passwordCheck = validatePasswordStrength(input.password);
  if (!passwordCheck.valid) {
    return {
      outcome: 'rejected',
      login: normalizeLogin(input.login),
      message: `Bootstrap rejected: ${passwordCheck.reason ?? 'weak password'}`,
    };
  }

  const normalized = normalizeLogin(input.login);
  if (!normalized || normalized.length < 5) {
    return {
      outcome: 'rejected',
      login: normalized,
      message: 'Bootstrap rejected: login identifier is required.',
    };
  }

  const existingLogin = await findIdentityByLogin(pool, normalized);
  if (existingLogin) {
    return {
      outcome: 'already_exists',
      login: normalized,
      identityId: existingLogin.identityId,
      message: 'Bootstrap rejected: login already registered (idempotent no-op).',
    };
  }

  const identityCount = await countIdentities(pool);
  if (identityCount > 0) {
    return {
      outcome: 'rejected',
      login: normalized,
      message:
        'Bootstrap rejected: database already initialized with identities. Manual intervention required.',
    };
  }

  const passwordHash = await hashPassword(input.password);
  const identityId = randomUUID();
  const credentialId = randomUUID();

  // Transacao real numa conexao dedicada: `pool.query('BEGIN')` nao abria transacao alguma
  // (cada `Pool.query` usa a propria conexao), de modo que a PRIMEIRA identidade do banco podia
  // ficar gravada sem credencial se o segundo INSERT falhasse — deixando a base "inicializada"
  // para o bootstrap e sem login utilizavel.
  await withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO identity.identities (id, status)
       VALUES ($1, 'active')`,
      [identityId],
    );

    await client.query(
      `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [credentialId, identityId, normalized, passwordHash],
    );
  });

  return {
    outcome: 'created',
    login: normalized,
    identityId,
    message: 'Production bootstrap identity created. No business roles assigned.',
  };
}
