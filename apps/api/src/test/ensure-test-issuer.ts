import type { Pool, PoolClient } from 'pg';

const ISSUER_CNPJ = '11897171000181';

/** Recria o emissor default depois de TRUNCATE em identity (CASCADE apaga o registry). */
export async function ensureTestDefaultIssuer(db: Pool | PoolClient): Promise<void> {
  const legal = await db.query<{ id: string }>(
    `SELECT id FROM pty.legal_entities WHERE legal_name = 'CISNE TEST ISSUER' LIMIT 1`,
  );
  let legalEntityId = legal.rows[0]?.id;
  if (!legalEntityId) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO pty.legal_entities (legal_name, trade_name)
       VALUES ('CISNE TEST ISSUER', 'CISNE TEST')
       RETURNING id`,
    );
    legalEntityId = inserted.rows[0]!.id;
  }

  const establishment = await db.query<{ id: string }>(
    `SELECT id FROM pty.establishments WHERE legal_entity_id = $1 AND code = 'MATRIZ' LIMIT 1`,
    [legalEntityId],
  );
  let establishmentId = establishment.rows[0]?.id;
  if (!establishmentId) {
    const inserted = await db.query<{ id: string }>(
      `INSERT INTO pty.establishments (
         legal_entity_id, code, trade_name, is_default_issuer,
         street, number, district, city, state, postal_code, country
       ) VALUES ($1, 'MATRIZ', 'CISNE TEST', true,
         'RUA TESTE', '100', 'CENTRO', 'PORTO VELHO', 'RO', '76801000', 'BR')
       RETURNING id`,
      [legalEntityId],
    );
    establishmentId = inserted.rows[0]!.id;
  } else {
    await db.query(
      `UPDATE pty.establishments
       SET is_default_issuer = true, status = 'ACTIVE', updated_at = NOW()
       WHERE id = $1`,
      [establishmentId],
    );
  }

  await db.query(
    `INSERT INTO pty.establishment_tax_registrations (establishment_id, tax_kind, normalized_number, status)
     SELECT $1, 'CNPJ', $2, 'ACTIVE'
     WHERE NOT EXISTS (
       SELECT 1 FROM pty.establishment_tax_registrations
       WHERE tax_kind = 'CNPJ' AND normalized_number = $2 AND status = 'ACTIVE'
     )`,
    [establishmentId, ISSUER_CNPJ],
  );
}
