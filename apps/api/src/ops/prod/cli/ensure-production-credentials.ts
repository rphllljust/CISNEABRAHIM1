#!/usr/bin/env node
import { Pool, type PoolClient } from 'pg';
import { hashPassword, validatePasswordStrength } from '@cisne/database';

type Profile = {
  loginEnv: string;
  passwordEnv: string;
};

const PROFILES: readonly Profile[] = [
  { loginEnv: 'PROD_PROFILE_ABRAHIM_LOGIN', passwordEnv: 'PROD_PROFILE_ABRAHIM_PASSWORD' },
  { loginEnv: 'PROD_PROFILE_MONICA_LOGIN', passwordEnv: 'PROD_PROFILE_MONICA_PASSWORD' },
  { loginEnv: 'PROD_PROFILE_RAFAEL_LOGIN', passwordEnv: 'PROD_PROFILE_RAFAEL_PASSWORD' },
  { loginEnv: 'PROD_PROFILE_EMPREGADO_LOGIN', passwordEnv: 'PROD_PROFILE_EMPREGADO_PASSWORD' },
];

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`CONFIGURATION_ERROR: ${name} is required`);
  return value;
}

async function upsertCredential(
  client: PoolClient,
  login: string,
  passwordHash: string,
): Promise<void> {
  const current = await client.query<{ identity_id: string }>(
    `SELECT identity_id
       FROM identity.credentials
      WHERE login_identifier_normalized = $1
        AND revoked_at IS NULL
      LIMIT 1`,
    [login],
  );

  const identityId = current.rows[0]?.identity_id;

  if (!identityId) {
    const created = await client.query<{ id: string }>(
      `INSERT INTO identity.identities (status)
       VALUES ('active')
       RETURNING id`,
    );
    const createdId = created.rows[0]?.id;
    if (!createdId) throw new Error(`failed to create identity for ${login}`);

    await client.query(
      `INSERT INTO identity.credentials
         (identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3)`,
      [createdId, login, passwordHash],
    );
    return;
  }

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

async function main(): Promise<void> {
  const databaseUrl = required('DATABASE_URL');
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const client = await pool.connect();
  let evictWith: Error | undefined;

  try {
    await client.query('BEGIN');

    const logins: string[] = [];
    for (const profile of PROFILES) {
      const login = required(profile.loginEnv).trim().toLowerCase();
      const password = required(profile.passwordEnv);

      const strength = validatePasswordStrength(password);
      if (!strength.valid) {
        throw new Error(`CONFIGURATION_ERROR: invalid password policy for ${login}`);
      }

      const passwordHash = await hashPassword(password);
      await upsertCredential(client, login, passwordHash);
      logins.push(login);
    }

    await client.query('COMMIT');
    console.log(JSON.stringify({ status: 'PRODUCTION_CREDENTIALS_READY', logins }));
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
    'PRODUCTION_CREDENTIAL_REPAIR_FAILED',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 1;
});
