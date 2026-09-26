import { createHash, randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

/** Synthetic bcrypt-shaped hash for constraint tests — not a real password. */
export const TEST_PASSWORD_HASH = '$2b$12$abcdefghijklmnopqrstuv012345678901234567890123456789012';

export function normalizeLoginIdentifier(login: string): string {
  return login.trim().toLowerCase();
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function futureIsoTimestamp(hoursFromNow = 1): string {
  return new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
}

export function pastIsoTimestamp(hoursAgo = 1): string {
  return new Date(Date.now() - hoursAgo * 60 * 60 * 1000).toISOString();
}

export function fictionalTestLogin(suffix: string): string {
  return `test-${suffix}-${randomUUID().slice(0, 8)}@cisne.invalid`;
}

export type BuiltIdentity = {
  identityId: string;
  credentialId: string;
  login: string;
};

export type BuiltSession = {
  sessionId: string;
  identityId: string;
  status: 'active' | 'revoked' | 'expired';
};

type DbClient = Pool | PoolClient;

/**
 * TEST_DATA_BUILDERS — isolated, fictional identity graph for integration tests.
 */
export class IdentityTestBuilders {
  constructor(private readonly client: DbClient) {}

  async activeIdentity(login?: string): Promise<BuiltIdentity> {
    const resolvedLogin = login ?? fictionalTestLogin('active');
    return this.insertIdentity(resolvedLogin, 'active');
  }

  async disabledIdentity(login?: string): Promise<BuiltIdentity> {
    const resolvedLogin = login ?? fictionalTestLogin('disabled');
    const identityId = randomUUID();
    const credentialId = randomUUID();
    const normalized = normalizeLoginIdentifier(resolvedLogin);
    const disabledAt = new Date().toISOString();

    await this.client.query(
      `INSERT INTO identity.identities (id, status, disabled_at)
       VALUES ($1, 'disabled', $2::timestamptz)`,
      [identityId, disabledAt],
    );

    await this.client.query(
      `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [credentialId, identityId, normalized, TEST_PASSWORD_HASH],
    );

    return { identityId, credentialId, login: normalized };
  }

  async validCredential(login?: string): Promise<BuiltIdentity> {
    return this.activeIdentity(login ?? fictionalTestLogin('credential'));
  }

  async validSession(identityId: string): Promise<BuiltSession> {
    const sessionId = randomUUID();
    await this.client.query(
      `INSERT INTO identity.sessions (id, identity_id, status, expires_at)
       VALUES ($1, $2, 'active', $3::timestamptz)`,
      [sessionId, identityId, futureIsoTimestamp(4)],
    );
    return { sessionId, identityId, status: 'active' };
  }

  async expiredSession(identityId: string): Promise<BuiltSession> {
    const sessionId = randomUUID();
    const createdAt = pastIsoTimestamp(2);
    const expiresAt = pastIsoTimestamp(1);

    await this.client.query(
      `INSERT INTO identity.sessions (id, identity_id, status, expires_at, created_at)
       VALUES ($1, $2, 'expired', $3::timestamptz, $4::timestamptz)`,
      [sessionId, identityId, expiresAt, createdAt],
    );

    return { sessionId, identityId, status: 'expired' };
  }

  async revokedSession(identityId: string): Promise<BuiltSession> {
    const sessionId = randomUUID();
    const revokedAt = new Date().toISOString();

    await this.client.query(
      `INSERT INTO identity.sessions (id, identity_id, status, expires_at, revoked_at)
       VALUES ($1, $2, 'revoked', $3::timestamptz, $4::timestamptz)`,
      [sessionId, identityId, futureIsoTimestamp(2), revokedAt],
    );

    return { sessionId, identityId, status: 'revoked' };
  }

  private async insertIdentity(login: string, status: 'active'): Promise<BuiltIdentity> {
    const identityId = randomUUID();
    const credentialId = randomUUID();
    const normalized = normalizeLoginIdentifier(login);

    await this.client.query(
      `INSERT INTO identity.identities (id, status)
       VALUES ($1, $2)`,
      [identityId, status],
    );

    await this.client.query(
      `INSERT INTO identity.credentials (id, identity_id, login_identifier_normalized, password_hash)
       VALUES ($1, $2, $3, $4)`,
      [credentialId, identityId, normalized, TEST_PASSWORD_HASH],
    );

    return { identityId, credentialId, login: normalized };
  }
}

// Backward-compatible helpers for Prompt 18 integration tests
export async function insertIdentity(
  client: DbClient,
  login: string,
  passwordHash: string = TEST_PASSWORD_HASH,
): Promise<{ identityId: string; credentialId: string }> {
  const identityId = randomUUID();
  const credentialId = randomUUID();
  const normalized = normalizeLoginIdentifier(login);

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

  return { identityId, credentialId };
}

export async function insertSession(
  client: DbClient,
  identityId: string,
  expiresAt: string,
): Promise<string> {
  const sessionId = randomUUID();

  await client.query(
    `INSERT INTO identity.sessions (id, identity_id, expires_at)
     VALUES ($1, $2, $3::timestamptz)`,
    [sessionId, identityId, expiresAt],
  );

  return sessionId;
}

/**
 * Reset do grafo de identidades para testes de integracao.
 *
 * As tabelas de autorizacao entram na lista de proposito (simetria setup/cleanup): o CASCADE de
 * `identity.identities` alcanca `approval_matrix_versions` e `approval_matrix_rules` (FK para
 * identidade), mas NAO alcanca `authorization.approval_matrices`, que por desenho nao tem FK
 * para identidade — a matriz vincula papel, capability, escopo e limite, nunca pessoa. Sem
 * `approval_matrices` na lista, cada truncate deixava uma matriz orfa, com zero versoes: estado
 * que nao ocorre por DELETE normal (a FK de versoes para identidades e NO ACTION) e que fazia o
 * proximo seed falhar em `approval_matrices_code_uidx` por a guarda olhar a regra publicada, nao
 * o `code`. Mesmo conjunto ja usado por `truncateAuthorizationTables` e
 * `truncateIdentityAndAuthorizationTables`.
 */
export async function truncateIdentityTables(client: DbClient): Promise<void> {
  await client.query(`
    TRUNCATE TABLE
      identity.refresh_tokens,
      identity.refresh_token_families,
      identity.sessions,
      identity.credentials,
      identity.identities,
      "authorization".approval_matrix_rules,
      "authorization".approval_matrix_versions,
      "authorization".approval_matrices
    RESTART IDENTITY CASCADE
  `);
}
