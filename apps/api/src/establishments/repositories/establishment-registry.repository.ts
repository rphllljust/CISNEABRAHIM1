import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { LegalEstablishmentError } from '../domain/legal-establishment';
import type {
  CertificateRow,
  CreateCertificatePersistenceInput,
  CreateEstablishmentPersistenceInput,
  CreateLegalEntityPersistenceInput,
  CreateTaxRegistrationPersistenceInput,
  DefaultIssuerView,
  EstablishmentAggregate,
  EstablishmentRow,
  HistoryEventRow,
  LegalEntityRow,
  SetStatusPersistenceInput,
  TaxRegistrationRow,
  UpdateCertificatePersistenceInput,
  UpdateEstablishmentPersistenceInput,
  UpdateLegalEntityPersistenceInput,
  UpdateTaxRegistrationPersistenceInput,
} from './establishment-registry.repository.types';

const LEGAL_ENTITY_COLUMNS = `id, legal_name, trade_name, status::text AS status, version,
  created_at::text AS created_at, updated_at::text AS updated_at,
  deactivated_at::text AS deactivated_at, deactivated_by_identity_id, deactivation_reason`;

const ESTABLISHMENT_COLUMNS = `id, legal_entity_id, code, trade_name, status::text AS status,
  is_default_issuer, version, street, number, complement, district, city, state, postal_code, country,
  created_at::text AS created_at, updated_at::text AS updated_at,
  deactivated_at::text AS deactivated_at, deactivated_by_identity_id, deactivation_reason`;

const TAX_REGISTRATION_COLUMNS = `id, establishment_id, tax_kind::text AS tax_kind, normalized_number,
  state, regime::text AS regime, status::text AS status,
  valid_from::text AS valid_from, valid_to::text AS valid_to, authority, version,
  created_at::text AS created_at, updated_at::text AS updated_at,
  deactivated_at::text AS deactivated_at, deactivated_by_identity_id, deactivation_reason`;

const CERTIFICATE_COLUMNS = `id, establishment_id, certificate_kind::text AS certificate_kind, label,
  subject_ref, issuer_ref, valid_from::text AS valid_from, valid_to::text AS valid_to,
  status::text AS status, created_at::text AS created_at, updated_at::text AS updated_at`;

const HISTORY_COLUMNS = `id, event_kind, actor_identity_id, occurred_at::text AS occurred_at, payload`;

type MutateOutcome<T> = T | 'VERSION_CONFLICT' | null;

@Injectable()
export class EstablishmentRegistryRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  // ---------- Legal entities ----------

  async createLegalEntity(
    input: CreateLegalEntityPersistenceInput,
  ): Promise<LegalEntityRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<LegalEntityRow>(
        `INSERT INTO pty.legal_entities (legal_name, trade_name)
         VALUES ($1, $2)
         RETURNING ${LEGAL_ENTITY_COLUMNS}`,
        [input.legalName.trim(), input.tradeName?.trim() ?? null],
      );
      const row = inserted.rows[0]!;
      await this.appendLegalEntityHistory(client, row.id, 'CREATED', input.actorIdentityId, {
        legalName: input.legalName,
      });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateLegalEntity(
    input: UpdateLegalEntityPersistenceInput,
  ): Promise<MutateOutcome<LegalEntityRow>> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const sets = ['version = version + 1', 'updated_at = NOW()'];
      const params: unknown[] = [input.legalEntityId, input.expectedVersion];
      let index = 3;
      if (input.legalName !== undefined) {
        sets.push(`legal_name = $${index++}`);
        params.push(input.legalName.trim());
      }
      if (input.tradeName !== undefined) {
        sets.push(`trade_name = $${index++}`);
        params.push(input.tradeName);
      }
      const updated = await client.query<LegalEntityRow>(
        `UPDATE pty.legal_entities
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING ${LEGAL_ENTITY_COLUMNS}`,
        params,
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        const exists = await client.query(`SELECT 1 FROM pty.legal_entities WHERE id = $1`, [
          input.legalEntityId,
        ]);
        return exists.rowCount === 0 ? null : 'VERSION_CONFLICT';
      }
      await this.appendLegalEntityHistory(
        client,
        row.id,
        'UPDATED',
        input.actorIdentityId,
        { changed: sets.filter((s) => s !== 'version = version + 1' && s !== 'updated_at = NOW()') },
      );
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setLegalEntityStatus(
    input: SetStatusPersistenceInput,
  ): Promise<MutateOutcome<LegalEntityRow>> {
    return this.setStatus<LegalEntityRow>({
      clientFactory: () => this.pool().connect(),
      table: 'pty.legal_entities',
      statusCast: 'pty.legal_entity_status',
      columns: LEGAL_ENTITY_COLUMNS,
      historyAppend: (client, id, kind, actor, payload) =>
        this.appendLegalEntityHistory(client, id, kind, actor, payload),
      input,
    });
  }

  async findLegalEntityById(id: string): Promise<LegalEntityRow | null> {
    const result = await this.pool().query<LegalEntityRow>(
      `SELECT ${LEGAL_ENTITY_COLUMNS} FROM pty.legal_entities WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listLegalEntities(): Promise<LegalEntityRow[]> {
    const result = await this.pool().query<LegalEntityRow>(
      `SELECT ${LEGAL_ENTITY_COLUMNS} FROM pty.legal_entities ORDER BY created_at ASC, id ASC`,
    );
    return result.rows;
  }

  async listLegalEntityHistory(legalEntityId: string): Promise<HistoryEventRow[]> {
    const result = await this.pool().query<HistoryEventRow>(
      `SELECT ${HISTORY_COLUMNS} FROM pty.legal_entity_history_events
       WHERE legal_entity_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [legalEntityId],
    );
    return result.rows;
  }

  // ---------- Establishments ----------

  async createEstablishment(
    input: CreateEstablishmentPersistenceInput,
  ): Promise<EstablishmentRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      if (input.isDefaultIssuer) {
        await client.query(
          `UPDATE pty.establishments SET is_default_issuer = false, updated_at = NOW()
           WHERE legal_entity_id = $1 AND is_default_issuer`,
          [input.legalEntityId],
        );
      }
      const inserted = await client.query<EstablishmentRow>(
        `INSERT INTO pty.establishments (
           legal_entity_id, code, trade_name, is_default_issuer,
           street, number, complement, district, city, state, postal_code, country
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         RETURNING ${ESTABLISHMENT_COLUMNS}`,
        [
          input.legalEntityId,
          input.code.trim().toUpperCase(),
          input.tradeName?.trim() ?? null,
          input.isDefaultIssuer === true,
          input.address.street?.trim() ?? null,
          input.address.number?.trim() ?? null,
          input.address.complement?.trim() ?? null,
          input.address.district?.trim() ?? null,
          input.address.city?.trim() ?? null,
          input.address.state?.trim()?.toUpperCase() ?? null,
          input.address.postalCode?.trim() ?? null,
          input.address.country?.trim()?.toUpperCase() ?? 'BR',
        ],
      );
      const row = inserted.rows[0]!;
      await this.appendEstablishmentHistory(client, row.id, 'CREATED', input.actorIdentityId, {
        legalEntityId: row.legal_entity_id,
        code: row.code,
      });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async updateEstablishment(
    input: UpdateEstablishmentPersistenceInput,
  ): Promise<MutateOutcome<EstablishmentRow>> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const current = await this.lockEstablishment(client, input.establishmentId);
      if (!current) {
        await client.query('ROLLBACK');
        return null;
      }
      if (current.version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (input.isDefaultIssuer === true && !current.is_default_issuer) {
        await client.query(
          `UPDATE pty.establishments SET is_default_issuer = false, updated_at = NOW()
           WHERE legal_entity_id = $1 AND is_default_issuer AND id <> $2`,
          [current.legal_entity_id, current.id],
        );
      }
      const sets = ['version = version + 1', 'updated_at = NOW()'];
      const params: unknown[] = [input.establishmentId, input.expectedVersion];
      let index = 3;
      const fieldMap: Array<[string, string | null | undefined]> = [
        ['trade_name', input.tradeName],
        ['is_default_issuer', input.isDefaultIssuer === true ? 'true' : input.isDefaultIssuer === false ? 'false' : undefined],
        ['street', input.address.street],
        ['number', input.address.number],
        ['complement', input.address.complement],
        ['district', input.address.district],
        ['city', input.address.city],
        ['state', input.address.state],
        ['postal_code', input.address.postalCode],
        ['country', input.address.country],
      ];
      for (const [column, value] of fieldMap) {
        if (value !== undefined) {
          if (column === 'state' && value !== null) {
            sets.push(`state = $${index++}`);
            params.push(value.trim().toUpperCase());
          } else if (column === 'country' && value !== null) {
            sets.push(`country = $${index++}`);
            params.push(value.trim().toUpperCase());
          } else if (column === 'is_default_issuer') {
            sets.push(`is_default_issuer = $${index++}::boolean`);
            params.push(value === 'true');
          } else {
            sets.push(`${column} = $${index++}`);
            params.push(value === null ? null : value.trim());
          }
        }
      }
      const updated = await client.query<EstablishmentRow>(
        `UPDATE pty.establishments
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING ${ESTABLISHMENT_COLUMNS}`,
        params,
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await this.appendEstablishmentHistory(client, row.id, 'UPDATED', input.actorIdentityId, {
        changed: true,
      });
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setEstablishmentStatus(
    input: SetStatusPersistenceInput,
  ): Promise<MutateOutcome<EstablishmentRow>> {
    return this.setStatus<EstablishmentRow>({
      clientFactory: () => this.pool().connect(),
      table: 'pty.establishments',
      statusCast: 'pty.establishment_status',
      columns: ESTABLISHMENT_COLUMNS,
      historyAppend: (client, id, kind, actor, payload) =>
        this.appendEstablishmentHistory(client, id, kind, actor, payload),
      input,
    });
  }

  async findEstablishmentById(id: string): Promise<EstablishmentAggregate | null> {
    const row = await this.findEstablishmentRowById(id);
    if (!row) {
      return null;
    }
    return this.loadAggregate(row);
  }

  async findEstablishmentRowById(id: string): Promise<EstablishmentRow | null> {
    const result = await this.pool().query<EstablishmentRow>(
      `SELECT ${ESTABLISHMENT_COLUMNS} FROM pty.establishments WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listEstablishments(legalEntityId: string): Promise<EstablishmentRow[]> {
    const result = await this.pool().query<EstablishmentRow>(
      `SELECT ${ESTABLISHMENT_COLUMNS} FROM pty.establishments
       WHERE legal_entity_id = $1 ORDER BY created_at ASC, id ASC`,
      [legalEntityId],
    );
    return result.rows;
  }

  async listEstablishmentHistory(establishmentId: string): Promise<HistoryEventRow[]> {
    const result = await this.pool().query<HistoryEventRow>(
      `SELECT ${HISTORY_COLUMNS} FROM pty.establishment_history_events
       WHERE establishment_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [establishmentId],
    );
    return result.rows;
  }

  // ---------- Tax registrations ----------

  async createTaxRegistration(
    input: CreateTaxRegistrationPersistenceInput,
  ): Promise<TaxRegistrationRow> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const inserted = await client.query<TaxRegistrationRow>(
        `INSERT INTO pty.establishment_tax_registrations (
           establishment_id, tax_kind, normalized_number, state, regime, valid_from, valid_to, authority
         ) VALUES ($1, $2::pty.tax_registration_kind, $3, $4, $5::pty.tax_regime, $6::date, $7::date, $8)
         RETURNING ${TAX_REGISTRATION_COLUMNS}`,
        [
          input.establishmentId,
          input.taxKind,
          input.normalizedNumber,
          input.state?.trim().toUpperCase() ?? null,
          input.regime ?? null,
          input.validFrom ?? null,
          input.validTo ?? null,
          input.authority?.trim() ?? null,
        ],
      );
      const row = inserted.rows[0]!;
      await this.appendTaxRegistrationHistory(
        client,
        row.id,
        'CREATED',
        input.actorIdentityId,
        { taxKind: row.tax_kind },
      );
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw this.mapDuplicateViolation(error, input.normalizedNumber);
    } finally {
      client.release();
    }
  }

  async updateTaxRegistration(
    input: UpdateTaxRegistrationPersistenceInput,
  ): Promise<MutateOutcome<TaxRegistrationRow>> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await this.lockTaxRegistration(client, input.taxRegistrationId);
      if (!locked) {
        await client.query('ROLLBACK');
        return null;
      }
      if (locked.version !== input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      const sets = ['version = version + 1', 'updated_at = NOW()'];
      const params: unknown[] = [input.taxRegistrationId, input.expectedVersion];
      let index = 3;
      const nullable = (value: string | null | undefined): boolean => value !== undefined;
      if (input.state !== undefined) {
        sets.push(`state = $${index++}`);
        params.push(input.state === null ? null : input.state.trim().toUpperCase());
      }
      if (input.regime !== undefined) {
        sets.push(`regime = $${index++}::pty.tax_regime`);
        params.push(input.regime);
      }
      if (nullable(input.validFrom)) {
        sets.push(`valid_from = $${index++}::date`);
        params.push(input.validFrom);
      }
      if (nullable(input.validTo)) {
        sets.push(`valid_to = $${index++}::date`);
        params.push(input.validTo);
      }
      if (nullable(input.authority)) {
        sets.push(`authority = $${index++}`);
        params.push(input.authority?.trim() ?? null);
      }
      const updated = await client.query<TaxRegistrationRow>(
        `UPDATE pty.establishment_tax_registrations
         SET ${sets.join(', ')}
         WHERE id = $1 AND version = $2
         RETURNING ${TAX_REGISTRATION_COLUMNS}`,
        params,
      );
      const row = updated.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await this.appendTaxRegistrationHistory(
        client,
        row.id,
        'UPDATED',
        input.actorIdentityId,
        { changed: true },
      );
      await client.query('COMMIT');
      return row;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setTaxRegistrationStatus(
    input: SetStatusPersistenceInput,
  ): Promise<MutateOutcome<TaxRegistrationRow>> {
    return this.setStatus<TaxRegistrationRow>({
      clientFactory: () => this.pool().connect(),
      table: 'pty.establishment_tax_registrations',
      statusCast: 'pty.tax_registration_status',
      columns: TAX_REGISTRATION_COLUMNS,
      historyAppend: (client, id, kind, actor, payload) =>
        this.appendTaxRegistrationHistory(client, id, kind, actor, payload),
      input,
    });
  }

  async listTaxRegistrations(establishmentId: string): Promise<TaxRegistrationRow[]> {
    const result = await this.pool().query<TaxRegistrationRow>(
      `SELECT ${TAX_REGISTRATION_COLUMNS} FROM pty.establishment_tax_registrations
       WHERE establishment_id = $1 ORDER BY created_at ASC, id ASC`,
      [establishmentId],
    );
    return result.rows;
  }

  async findTaxRegistrationById(id: string): Promise<TaxRegistrationRow | null> {
    const result = await this.pool().query<TaxRegistrationRow>(
      `SELECT ${TAX_REGISTRATION_COLUMNS} FROM pty.establishment_tax_registrations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listTaxRegistrationHistory(taxRegistrationId: string): Promise<HistoryEventRow[]> {
    const result = await this.pool().query<HistoryEventRow>(
      `SELECT ${HISTORY_COLUMNS} FROM pty.establishment_tax_registration_history_events
       WHERE tax_registration_id = $1 ORDER BY occurred_at ASC, id ASC`,
      [taxRegistrationId],
    );
    return result.rows;
  }

  // ---------- Certificates ----------

  async createCertificate(input: CreateCertificatePersistenceInput): Promise<CertificateRow> {
    const result = await this.pool().query<CertificateRow>(
      `INSERT INTO pty.establishment_certificates (
         establishment_id, certificate_kind, label, subject_ref, issuer_ref, valid_from, valid_to
       ) VALUES ($1, $2::pty.certificate_kind, $3, $4, $5, $6::date, $7::date)
       RETURNING ${CERTIFICATE_COLUMNS}`,
      [
        input.establishmentId,
        input.certificateKind,
        input.label.trim(),
        input.subjectRef?.trim() ?? null,
        input.issuerRef?.trim() ?? null,
        input.validFrom ?? null,
        input.validTo ?? null,
      ],
    );
    return result.rows[0]!;
  }

  async updateCertificate(
    input: UpdateCertificatePersistenceInput,
  ): Promise<CertificateRow | null> {
    const sets = ['updated_at = NOW()'];
    const params: unknown[] = [input.certificateId];
    let index = 2;
    const push = (column: string, value: unknown): void => {
      sets.push(`${column} = $${index++}`);
      params.push(value);
    };
    if (input.certificateKind !== undefined) {
      push('certificate_kind', input.certificateKind);
      sets[sets.length - 1] = `certificate_kind = $${index - 1}::pty.certificate_kind`;
    }
    if (input.label !== undefined) {
      push('label', input.label.trim());
    }
    if (input.subjectRef !== undefined) {
      push('subject_ref', input.subjectRef?.trim() ?? null);
    }
    if (input.issuerRef !== undefined) {
      push('issuer_ref', input.issuerRef?.trim() ?? null);
    }
    if (input.validFrom !== undefined) {
      push('valid_from', input.validFrom);
      sets[sets.length - 1] = `valid_from = $${index - 1}::date`;
    }
    if (input.validTo !== undefined) {
      push('valid_to', input.validTo);
      sets[sets.length - 1] = `valid_to = $${index - 1}::date`;
    }
    const updated = await this.pool().query<CertificateRow>(
      `UPDATE pty.establishment_certificates
       SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING ${CERTIFICATE_COLUMNS}`,
      params,
    );
    return updated.rows[0] ?? null;
  }

  async listCertificates(establishmentId: string): Promise<CertificateRow[]> {
    const result = await this.pool().query<CertificateRow>(
      `SELECT ${CERTIFICATE_COLUMNS} FROM pty.establishment_certificates
       WHERE establishment_id = $1 ORDER BY created_at ASC, id ASC`,
      [establishmentId],
    );
    return result.rows;
  }

  // ---------- Issuer resolution (used by fiscal/billing, never hardcoded) ----------

  async findDefaultIssuer(legalEntityId?: string): Promise<DefaultIssuerView | null> {
    const result = await this.pool().query<DefaultIssuerView>(
      `SELECT
         le.id AS "legalEntityId",
         est.id AS "establishmentId",
         est.code,
         le.legal_name AS "legalName",
         le.trade_name AS "tradeName",
         tr.normalized_number AS "normalizedCnpj",
         est.street, est.number, est.complement, est.district,
         est.city, est.state, est.postal_code AS "postalCode", est.country
       FROM pty.establishments est
       INNER JOIN pty.legal_entities le ON le.id = est.legal_entity_id
       LEFT JOIN pty.establishment_tax_registrations tr
         ON tr.establishment_id = est.id
        AND tr.tax_kind = 'CNPJ'
        AND tr.status = 'ACTIVE'
       WHERE est.status = 'ACTIVE'
         AND est.is_default_issuer
         AND ($1::uuid IS NULL OR le.id = $1::uuid)
       ORDER BY tr.normalized_number NULLS LAST
       LIMIT 1`,
      [legalEntityId ?? null],
    );
    return result.rows[0] ?? null;
  }

  /** Emissor de um estabelecimento específico (não necessariamente default). */
  async findEstablishmentIssuer(establishmentId: string): Promise<DefaultIssuerView | null> {
    const result = await this.pool().query<DefaultIssuerView>(
      `SELECT
         le.id AS "legalEntityId",
         est.id AS "establishmentId",
         est.code,
         le.legal_name AS "legalName",
         le.trade_name AS "tradeName",
         tr.normalized_number AS "normalizedCnpj",
         est.street, est.number, est.complement, est.district,
         est.city, est.state, est.postal_code AS "postalCode", est.country
       FROM pty.establishments est
       INNER JOIN pty.legal_entities le ON le.id = est.legal_entity_id
       LEFT JOIN pty.establishment_tax_registrations tr
         ON tr.establishment_id = est.id
        AND tr.tax_kind = 'CNPJ'
        AND tr.status = 'ACTIVE'
       WHERE est.id = $1
       LIMIT 1`,
      [establishmentId],
    );
    return result.rows[0] ?? null;
  }

  // ---------- Internals ----------

  private async loadAggregate(row: EstablishmentRow): Promise<EstablishmentAggregate> {
    const [taxRegistrations, certificates] = await Promise.all([
      this.listTaxRegistrations(row.id),
      this.listCertificates(row.id),
    ]);
    return { establishment: row, taxRegistrations, certificates };
  }

  private async lockEstablishment(
    client: PoolClient,
    id: string,
  ): Promise<EstablishmentRow | null> {
    const result = await client.query<EstablishmentRow>(
      `SELECT ${ESTABLISHMENT_COLUMNS} FROM pty.establishments WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async lockTaxRegistration(
    client: PoolClient,
    id: string,
  ): Promise<TaxRegistrationRow | null> {
    const result = await client.query<TaxRegistrationRow>(
      `SELECT ${TAX_REGISTRATION_COLUMNS} FROM pty.establishment_tax_registrations WHERE id = $1 FOR UPDATE`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  private async setStatus<T extends { id: string; status: string }>(options: {
    clientFactory: () => Promise<PoolClient>;
    table: string;
    statusCast: string;
    columns: string;
    input: SetStatusPersistenceInput;
    historyAppend: (
      client: PoolClient,
      id: string,
      kind: string,
      actorIdentityId: string,
      payload: Record<string, unknown>,
    ) => Promise<void>;
  }): Promise<MutateOutcome<T>> {
    const client = await options.clientFactory();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ status: string; version: number }>(
        `SELECT status, version FROM ${options.table} WHERE id = $1 FOR UPDATE`,
        [options.input.id],
      );
      const row = current.rows[0];
      if (!row) {
        await client.query('ROLLBACK');
        return null;
      }
      if (row.version !== options.input.expectedVersion) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      if (row.status === options.input.status) {
        await client.query('ROLLBACK');
        throw new LegalEstablishmentError('LEGAL_ESTABLISHMENT_SAME_STATUS');
      }
      const target = options.input.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE';
      const updated = await client.query<T>(
        `UPDATE ${options.table}
         SET status = $2::${options.statusCast}, version = version + 1, updated_at = NOW(),
             deactivated_at = CASE WHEN $2 = 'INACTIVE' THEN NOW() ELSE deactivated_at END,
             deactivated_by_identity_id = CASE WHEN $2 = 'INACTIVE' THEN $3 ELSE deactivated_by_identity_id END,
             deactivation_reason = CASE WHEN $2 = 'INACTIVE' THEN $4 ELSE deactivation_reason END
         WHERE id = $1 AND version = $5
         RETURNING ${options.columns}`,
        [options.input.id, target, options.input.actorIdentityId, options.input.reason ?? null, options.input.expectedVersion],
      );
      const updatedRow = updated.rows[0];
      if (!updatedRow) {
        await client.query('ROLLBACK');
        return 'VERSION_CONFLICT';
      }
      await options.historyAppend(
        client,
        options.input.id,
        options.input.status === 'INACTIVE' ? 'DEACTIVATED' : 'ACTIVATED',
        options.input.actorIdentityId,
        { reason: options.input.reason ?? null },
      );
      await client.query('COMMIT');
      return updatedRow;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async appendLegalEntityHistory(
    client: PoolClient,
    id: string,
    kind: string,
    actorIdentityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pty.legal_entity_history_events (legal_entity_id, event_kind, actor_identity_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [id, kind, actorIdentityId, JSON.stringify(payload)],
    );
  }

  private async appendEstablishmentHistory(
    client: PoolClient,
    id: string,
    kind: string,
    actorIdentityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pty.establishment_history_events (establishment_id, event_kind, actor_identity_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [id, kind, actorIdentityId, JSON.stringify(payload)],
    );
  }

  private async appendTaxRegistrationHistory(
    client: PoolClient,
    id: string,
    kind: string,
    actorIdentityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await client.query(
      `INSERT INTO pty.establishment_tax_registration_history_events (tax_registration_id, event_kind, actor_identity_id, payload)
       VALUES ($1, $2, $3, $4)`,
      [id, kind, actorIdentityId, JSON.stringify(payload)],
    );
  }

  private mapDuplicateViolation(error: unknown, _normalizedNumber: string): unknown {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') {
      return new LegalEstablishmentError('TAX_REGISTRATION_DUPLICATE');
    }
    return error;
  }
}
