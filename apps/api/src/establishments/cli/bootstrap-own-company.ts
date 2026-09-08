#!/usr/bin/env node
import { config } from 'dotenv';
import { resolve } from 'node:path';
import { findRepoRoot } from '../../ops/cd/cd-paths';
import { Pool } from 'pg';
import { buildOwnCompanyBootstrapConfig } from '../domain/own-company-bootstrap';
import type { OwnCompanyBootstrapError } from '../domain/own-company-bootstrap-errors';

/**
 * Bootstrap da própria empresa (seed do registry) a partir das variáveis de
 * ambiente OWN_COMPANY_* (fonte oficial SRC-005). Nenhum dado da Cisne é
 * hardcoded. Executa Legal Entity → Establishment (MATRIZ, default issuer) →
 * TaxRegistration CNPJ em uma única transação; idempotente (reutiliza o que já
 * existe); requer BOOTSTRAP_IDENTITY_ID (uuid válido em identity.identities).
 */
async function main(): Promise<void> {
  const repoRoot = findRepoRoot();
  config({ path: resolve(repoRoot, '.env') });

  const databaseUrl = process.env['DATABASE_URL'];
  const actorIdentityId = process.env['BOOTSTRAP_IDENTITY_ID']?.trim();
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required to bootstrap the own company.');
  }
  if (!actorIdentityId) {
    throw new Error('BOOTSTRAP_IDENTITY_ID is required (a valid identity in identity.identities).');
  }

  const cfg = buildOwnCompanyBootstrapConfig(process.env);

  const pool = new Pool({ connectionString: databaseUrl });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Legal entity (reutiliza se já existir com o mesmo nome).
    const legalResult = await client.query<{ id: string }>(
      `SELECT id FROM pty.legal_entities WHERE legal_name = $1 ORDER BY created_at ASC LIMIT 1`,
      [cfg.legalName],
    );
    let legalEntityId = legalResult.rows[0]?.id;
    if (!legalEntityId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pty.legal_entities (legal_name, trade_name)
         VALUES ($1, $2) RETURNING id`,
        [cfg.legalName, cfg.tradeName],
      );
      legalEntityId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO pty.legal_entity_history_events (legal_entity_id, event_kind, actor_identity_id, payload)
         VALUES ($1, 'CREATED', $2, $3)`,
        [legalEntityId, actorIdentityId, JSON.stringify({ source: 'OWN_COMPANY_BOOTSTRAP' })],
      );
    }

    // Establishment (idempotente por código).
    const establishmentResult = await client.query<{ id: string }>(
      `SELECT id FROM pty.establishments WHERE legal_entity_id = $1 AND code = $2 LIMIT 1`,
      [legalEntityId, cfg.establishmentCode],
    );
    let establishmentId = establishmentResult.rows[0]?.id;
    if (!establishmentId) {
      await client.query(
        `UPDATE pty.establishments SET is_default_issuer = false, updated_at = NOW()
         WHERE legal_entity_id = $1 AND is_default_issuer`,
        [legalEntityId],
      );
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pty.establishments (
           legal_entity_id, code, trade_name, is_default_issuer,
           street, number, complement, district, city, state, postal_code, country
         ) VALUES ($1, $2, $3, true, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          legalEntityId,
          cfg.establishmentCode,
          cfg.tradeName,
          cfg.address.street,
          cfg.address.number,
          cfg.address.complement,
          cfg.address.district,
          cfg.address.city,
          cfg.address.state,
          cfg.address.postalCode,
          cfg.address.country,
        ],
      );
      establishmentId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO pty.establishment_history_events (establishment_id, event_kind, actor_identity_id, payload)
         VALUES ($1, 'CREATED', $2, $3)`,
        [establishmentId, actorIdentityId, JSON.stringify({ source: 'OWN_COMPANY_BOOTSTRAP', code: cfg.establishmentCode })],
      );
    }

    // TaxRegistration CNPJ (idempotente por número).
    const cnpjResult = await client.query<{ id: string }>(
      `SELECT id FROM pty.establishment_tax_registrations
       WHERE normalized_number = $1 AND tax_kind = 'CNPJ' LIMIT 1`,
      [cfg.normalizedCnpj],
    );
    let cnpjId = cnpjResult.rows[0]?.id;
    if (!cnpjId) {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO pty.establishment_tax_registrations (establishment_id, tax_kind, normalized_number, status)
         VALUES ($1, 'CNPJ', $2, 'ACTIVE') RETURNING id`,
        [establishmentId, cfg.normalizedCnpj],
      );
      cnpjId = inserted.rows[0]!.id;
      await client.query(
        `INSERT INTO pty.establishment_tax_registration_history_events (tax_registration_id, event_kind, actor_identity_id, payload)
         VALUES ($1, 'CREATED', $2, $3)`,
        [cnpjId, actorIdentityId, JSON.stringify({ source: 'OWN_COMPANY_BOOTSTRAP', kind: 'CNPJ' })],
      );
    }

    await client.query('COMMIT');
    process.stdout.write(
      `${JSON.stringify({ ok: true, legalEntityId, establishmentId, cnpjId, dryRun: false }, null, 2)}\n`,
    );
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as OwnCompanyBootstrapError).code
      : undefined;
  console.error(`[bootstrap-own-company] failed${code ? ` (${code})` : ''}`, error);
  process.exitCode = 1;
});
