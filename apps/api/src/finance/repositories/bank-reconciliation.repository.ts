import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { BankReconciliationError } from '../domain/bank-reconciliation';
import type {
  BankStatementImportRow,
  BankStatementLineRow,
  BankStatementListRow,
  BankStatementRow,
  EligibleMovementRow,
  ReconciliationMatchRow,
  ReconciliationRow,
} from './bank-reconciliation.repository.types';

type Queryable = Pool | PoolClient;

const STATEMENT_RETURNING = `
  id, unit_id, financial_account_id, source_kind::text AS source_kind, source_reference,
  period_starts_on::text AS period_starts_on, period_ends_on::text AS period_ends_on,
  currency_code, status::text AS status, idempotency_key, file_checksum
`;
const LINE_RETURNING = `
  id, bank_statement_id, line_number, occurred_on::text AS occurred_on,
  direction::text AS direction, amount::text AS amount, description, source_line_key,
  match_status::text AS match_status, fingerprint, identity_kind::text AS identity_kind
`;
const IMPORT_RETURNING = `
  id, unit_id, financial_account_id, bank_statement_id, format::text AS format, file_name,
  file_checksum, byte_size, status::text AS status, rejection_code, line_count,
  imported_line_count, duplicate_line_count, idempotency_key
`;
const RECON_RETURNING = `
  id, unit_id, bank_statement_id, bank_statement_line_id, status::text AS status,
  match_method::text AS match_method, match_criteria, created_by_identity_id
`;
const MATCH_RETURNING = `
  m.id, m.reconciliation_id, m.bank_statement_line_id, m.target_kind::text AS target_kind,
  m.target_id, m.financial_transaction_id, m.amount::text AS amount, m.is_active
`;
const MATCH_RETURNING_PLAIN = `
  id, reconciliation_id, bank_statement_line_id, target_kind::text AS target_kind,
  target_id, financial_transaction_id, amount::text AS amount, is_active
`;

@Injectable()
export class BankReconciliationRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findStatementByIdempotency(
    unitId: string,
    idempotencyKey: string,
    client: Queryable = this.pool(),
  ): Promise<BankStatementRow | null> {
    const result = await client.query<BankStatementRow>(
      `SELECT ${STATEMENT_RETURNING}
       FROM fin.bank_statements
       WHERE unit_id = $1 AND idempotency_key = $2`,
      [unitId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async findStatementByFileChecksum(
    unitId: string,
    financialAccountId: string,
    fileChecksum: string,
    client: Queryable = this.pool(),
  ): Promise<BankStatementRow | null> {
    const result = await client.query<BankStatementRow>(
      `SELECT ${STATEMENT_RETURNING}
       FROM fin.bank_statements
       WHERE unit_id = $1 AND financial_account_id = $2 AND file_checksum = $3`,
      [unitId, financialAccountId, fileChecksum],
    );
    return result.rows[0] ?? null;
  }

  async findImportByChecksum(
    unitId: string,
    financialAccountId: string,
    fileChecksum: string,
    client: Queryable = this.pool(),
  ): Promise<BankStatementImportRow | null> {
    const result = await client.query<BankStatementImportRow>(
      `SELECT ${IMPORT_RETURNING}
       FROM fin.bank_statement_imports
       WHERE unit_id = $1 AND financial_account_id = $2 AND file_checksum = $3
         AND status = 'IMPORTED'`,
      [unitId, financialAccountId, fileChecksum],
    );
    return result.rows[0] ?? null;
  }

  async findImportByIdempotency(
    unitId: string,
    idempotencyKey: string,
    client: Queryable = this.pool(),
  ): Promise<BankStatementImportRow | null> {
    const result = await client.query<BankStatementImportRow>(
      `SELECT ${IMPORT_RETURNING}
       FROM fin.bank_statement_imports
       WHERE unit_id = $1 AND idempotency_key = $2`,
      [unitId, idempotencyKey],
    );
    return result.rows[0] ?? null;
  }

  async findLinesByFingerprints(
    fingerprints: string[],
    client: Queryable = this.pool(),
  ): Promise<BankStatementLineRow[]> {
    if (fingerprints.length === 0) {
      return [];
    }
    const result = await client.query<BankStatementLineRow>(
      `SELECT ${LINE_RETURNING}
       FROM fin.bank_statement_lines
       WHERE identity_kind = 'SUFFICIENT' AND fingerprint = ANY($1::text[])`,
      [fingerprints],
    );
    return result.rows;
  }

  async findStatementById(id: string): Promise<BankStatementRow | null> {
    const result = await this.pool().query<BankStatementRow>(
      `SELECT ${STATEMENT_RETURNING} FROM fin.bank_statements WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findLineById(id: string): Promise<BankStatementLineRow | null> {
    const result = await this.pool().query<BankStatementLineRow>(
      `SELECT ${LINE_RETURNING} FROM fin.bank_statement_lines WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async findActiveByLine(lineId: string): Promise<ReconciliationRow | null> {
    const result = await this.pool().query<ReconciliationRow>(
      `SELECT ${RECON_RETURNING}
       FROM fin.reconciliations
       WHERE bank_statement_line_id = $1 AND status IN ('DRAFT', 'CONFIRMED')
       ORDER BY created_at DESC
       LIMIT 1`,
      [lineId],
    );
    return result.rows[0] ?? null;
  }

  async findReconciliationById(id: string): Promise<ReconciliationRow | null> {
    const result = await this.pool().query<ReconciliationRow>(
      `SELECT ${RECON_RETURNING} FROM fin.reconciliations WHERE id = $1`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async listLines(statementId: string): Promise<BankStatementLineRow[]> {
    const result = await this.pool().query<BankStatementLineRow>(
      `SELECT ${LINE_RETURNING}
       FROM fin.bank_statement_lines
       WHERE bank_statement_id = $1
       ORDER BY line_number`,
      [statementId],
    );
    return result.rows;
  }

  async listActiveMatches(statementId: string): Promise<ReconciliationMatchRow[]> {
    const result = await this.pool().query<ReconciliationMatchRow>(
      `SELECT ${MATCH_RETURNING}
       FROM fin.reconciliation_matches m
       INNER JOIN fin.reconciliations r ON r.id = m.reconciliation_id
       WHERE r.bank_statement_id = $1 AND m.is_active`,
      [statementId],
    );
    return result.rows;
  }

  async countConfirmedMatchesForLine(lineId: string): Promise<number> {
    const result = await this.pool().query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM fin.reconciliations
       WHERE bank_statement_line_id = $1 AND status = 'CONFIRMED'`,
      [lineId],
    );
    return Number(result.rows[0]?.count ?? '0');
  }

  async insertStatement(
    input: {
      unitId: string;
      financialAccountId: string;
      sourceKind: string;
      sourceReference: string;
      periodStartsOn: string;
      periodEndsOn: string;
      currencyCode: string;
      idempotencyKey: string;
      actorIdentityId: string;
      fileChecksum?: string | null;
    },
    client: Queryable = this.pool(),
  ): Promise<BankStatementRow> {
    const result = await client.query<BankStatementRow>(
      `INSERT INTO fin.bank_statements (
         unit_id, financial_account_id, source_kind, source_reference,
         period_starts_on, period_ends_on, currency_code, idempotency_key,
         created_by_identity_id, file_checksum
       ) VALUES ($1, $2, $3::fin.bank_statement_source_kind, $4, $5::date, $6::date, $7, $8, $9, $10)
       RETURNING ${STATEMENT_RETURNING}`,
      [
        input.unitId,
        input.financialAccountId,
        input.sourceKind,
        input.sourceReference,
        input.periodStartsOn,
        input.periodEndsOn,
        input.currencyCode,
        input.idempotencyKey,
        input.actorIdentityId,
        input.fileChecksum ?? null,
      ],
    );
    return required(result.rows[0]);
  }

  async insertLine(
    input: {
      bankStatementId: string;
      lineNumber: number;
      occurredOn: string;
      direction: string;
      amount: string;
      description: string;
      sourceLineKey: string;
      externalReference: string | null;
      fingerprint?: string | null;
      identityKind?: string;
    },
    client: Queryable = this.pool(),
  ): Promise<{ row: BankStatementLineRow; duplicate: boolean }> {
    const inTransaction = isPoolClient(client);
    if (inTransaction) {
      await client.query('SAVEPOINT bank_line_insert');
    }
    try {
      const result = await client.query<BankStatementLineRow>(
        `INSERT INTO fin.bank_statement_lines (
           bank_statement_id, line_number, occurred_on, direction, amount,
           description, source_line_key, external_reference, fingerprint, identity_kind
         ) VALUES (
           $1, $2, $3::date, $4::fin.financial_direction, $5, $6, $7, $8, $9,
           COALESCE($10::fin.bank_line_identity_kind, 'FILE_LOCAL')
         )
         RETURNING ${LINE_RETURNING}`,
        [
          input.bankStatementId,
          input.lineNumber,
          input.occurredOn,
          input.direction,
          input.amount,
          input.description,
          input.sourceLineKey,
          input.externalReference,
          input.fingerprint ?? null,
          input.identityKind ?? 'FILE_LOCAL',
        ],
      );
      if (inTransaction) {
        await client.query('RELEASE SAVEPOINT bank_line_insert');
      }
      return { row: required(result.rows[0]), duplicate: false };
    } catch (error) {
      if (inTransaction) {
        await client.query('ROLLBACK TO SAVEPOINT bank_line_insert');
      }
      if (!isUniqueViolation(error)) {
        throw error;
      }
      const existing = await client.query<BankStatementLineRow>(
        `SELECT ${LINE_RETURNING}
         FROM fin.bank_statement_lines
         WHERE (bank_statement_id = $1 AND source_line_key = $2)
            OR (identity_kind = 'SUFFICIENT' AND fingerprint IS NOT NULL AND fingerprint = $3)
         ORDER BY CASE WHEN bank_statement_id = $1 THEN 0 ELSE 1 END
         LIMIT 1`,
        [input.bankStatementId, input.sourceLineKey, input.fingerprint ?? ''],
      );
      return { row: required(existing.rows[0]), duplicate: true };
    }
  }

  async insertImport(
    input: {
      unitId: string;
      financialAccountId: string;
      bankStatementId: string | null;
      format: string;
      fileName: string;
      fileChecksum: string;
      byteSize: number;
      status: string;
      rejectionCode?: string | null;
      lineCount: number;
      importedLineCount: number;
      duplicateLineCount: number;
      idempotencyKey: string;
      actorIdentityId: string;
    },
    client: Queryable = this.pool(),
  ): Promise<BankStatementImportRow> {
    const result = await client.query<BankStatementImportRow>(
      `INSERT INTO fin.bank_statement_imports (
         unit_id, financial_account_id, bank_statement_id, format, file_name, file_checksum,
         byte_size, status, rejection_code, line_count, imported_line_count, duplicate_line_count,
         idempotency_key, created_by_identity_id
       ) VALUES (
         $1, $2, $3, $4::fin.bank_import_format, $5, $6, $7, $8::fin.bank_import_status,
         $9, $10, $11, $12, $13, $14
       )
       RETURNING ${IMPORT_RETURNING}`,
      [
        input.unitId,
        input.financialAccountId,
        input.bankStatementId,
        input.format,
        input.fileName,
        input.fileChecksum,
        input.byteSize,
        input.status,
        input.rejectionCode ?? null,
        input.lineCount,
        input.importedLineCount,
        input.duplicateLineCount,
        input.idempotencyKey,
        input.actorIdentityId,
      ],
    );
    return required(result.rows[0]);
  }

  async withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Página de descoberta de extratos. Uma única consulta para a página (com a conta já junta) e
   * uma única consulta agregada para os totais das linhas daquela página — nunca uma consulta por
   * extrato.
   *
   * `scopeClause` é montado pela autorização a partir das concessões do ator: quem não enxerga a
   * unidade não enxerga a linha, então a existência de extrato não vaza por metadado.
   */
  async listStatementsPage(input: {
    scopeClause: string;
    scopeParams: unknown[];
    financialAccountId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
    limit: number;
    offset: number;
  }): Promise<BankStatementListRow[]> {
    const params: unknown[] = [...input.scopeParams];
    const filters: string[] = [];

    if (input.financialAccountId) {
      filters.push(`s.financial_account_id = $${params.length + 1}::uuid`);
      params.push(input.financialAccountId);
    }
    if (input.status) {
      filters.push(`s.status = $${params.length + 1}::fin.bank_statement_status`);
      params.push(input.status);
    }
    if (input.dateFrom) {
      filters.push(`s.period_ends_on >= $${params.length + 1}::date`);
      params.push(input.dateFrom);
    }
    if (input.dateTo) {
      filters.push(`s.period_starts_on <= $${params.length + 1}::date`);
      params.push(input.dateTo);
    }

    const where = [input.scopeClause, ...filters].join(' AND ');
    const limitParam = params.length + 1;
    const offsetParam = params.length + 2;

    const result = await this.pool().query<BankStatementListRow>(
      `SELECT s.id, s.unit_id, s.financial_account_id,
              a.code AS account_code, a.name AS account_name,
              s.source_kind::text AS source_kind, s.source_reference,
              s.period_starts_on::text AS period_starts_on,
              s.period_ends_on::text AS period_ends_on,
              s.currency_code, s.status::text AS status,
              COALESCE(lines.line_count, 0)::int AS line_count,
              COALESCE(lines.matched_line_count, 0)::int AS matched_line_count,
              COALESCE(lines.unreconciled_line_count, 0)::int AS unreconciled_line_count,
              COALESCE(lines.debit_total, '0')::text AS debit_total,
              COALESCE(lines.credit_total, '0')::text AS credit_total
       FROM fin.bank_statements s
       INNER JOIN fin.financial_accounts a ON a.id = s.financial_account_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS line_count,
                COUNT(*) FILTER (WHERE l.match_status = 'MATCHED') AS matched_line_count,
                COUNT(*) FILTER (WHERE l.match_status <> 'MATCHED') AS unreconciled_line_count,
                SUM(l.amount) FILTER (WHERE l.direction = 'DEBIT') AS debit_total,
                SUM(l.amount) FILTER (WHERE l.direction = 'CREDIT') AS credit_total
         FROM fin.bank_statement_lines l
         WHERE l.bank_statement_id = s.id
       ) lines ON TRUE
       WHERE ${where}
       ORDER BY s.period_ends_on DESC, s.created_at DESC, s.id DESC
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
      [...params, input.limit, input.offset],
    );
    return result.rows;
  }

  async countStatements(input: {
    scopeClause: string;
    scopeParams: unknown[];
    financialAccountId?: string;
    status?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<number> {
    const params: unknown[] = [...input.scopeParams];
    const filters: string[] = [];

    if (input.financialAccountId) {
      filters.push(`s.financial_account_id = $${params.length + 1}::uuid`);
      params.push(input.financialAccountId);
    }
    if (input.status) {
      filters.push(`s.status = $${params.length + 1}::fin.bank_statement_status`);
      params.push(input.status);
    }
    if (input.dateFrom) {
      filters.push(`s.period_ends_on >= $${params.length + 1}::date`);
      params.push(input.dateFrom);
    }
    if (input.dateTo) {
      filters.push(`s.period_starts_on <= $${params.length + 1}::date`);
      params.push(input.dateTo);
    }

    const where = [input.scopeClause, ...filters].join(' AND ');
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM fin.bank_statements s
       WHERE ${where}`,
      params,
    );
    return Number(result.rows[0]?.total ?? '0');
  }

  async listEligibleMovements(accountId: string): Promise<EligibleMovementRow[]> {    const result = await this.pool().query<EligibleMovementRow>(
      `SELECT t.id, t.account_id, t.direction::text AS direction, t.amount::text AS amount,
              (t.occurred_at AT TIME ZONE 'UTC')::date::text AS occurred_on,
              t.origin_kind::text AS origin_kind, t.origin_id, t.transfer_id
       FROM fin.financial_transactions t
       WHERE t.account_id = $1
         AND t.status = 'POSTED'
         AND NOT EXISTS (
           SELECT 1 FROM fin.reconciliation_matches m
           WHERE m.financial_transaction_id = t.id AND m.is_active
         )
       ORDER BY t.occurred_at, t.id`,
      [accountId],
    );
    return result.rows;
  }

  async findMovementById(id: string): Promise<EligibleMovementRow | null> {
    const result = await this.pool().query<EligibleMovementRow>(
      `SELECT t.id, t.account_id, t.direction::text AS direction, t.amount::text AS amount,
              (t.occurred_at AT TIME ZONE 'UTC')::date::text AS occurred_on,
              t.origin_kind::text AS origin_kind, t.origin_id, t.transfer_id
       FROM fin.financial_transactions t
       WHERE t.id = $1 AND t.status = 'POSTED'`,
      [id],
    );
    return result.rows[0] ?? null;
  }

  async withLockedLine<T>(
    lineId: string,
    run: (client: PoolClient, line: BankStatementLineRow) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<BankStatementLineRow>(
        `SELECT ${LINE_RETURNING}
         FROM fin.bank_statement_lines
         WHERE id = $1
         FOR UPDATE`,
        [lineId],
      );
      const line = locked.rows[0];
      if (!line) {
        throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
      }
      const result = await run(client, line);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async insertDraft(
    client: PoolClient,
    input: {
      unitId: string;
      bankStatementId: string;
      bankStatementLineId: string;
      matchMethod: string;
      matchCriteria: string;
      targetKind: string;
      targetId: string;
      financialTransactionId: string;
      amount: string;
      actorIdentityId: string;
    },
  ): Promise<{ reconciliation: ReconciliationRow; match: ReconciliationMatchRow }> {
    const recon = await client.query<ReconciliationRow>(
      `INSERT INTO fin.reconciliations (
         unit_id, bank_statement_id, bank_statement_line_id, match_method, match_criteria,
         created_by_identity_id
       ) VALUES ($1, $2, $3, $4::fin.reconciliation_match_method, $5, $6)
       RETURNING ${RECON_RETURNING}`,
      [
        input.unitId,
        input.bankStatementId,
        input.bankStatementLineId,
        input.matchMethod,
        input.matchCriteria,
        input.actorIdentityId,
      ],
    );
    const reconciliation = required(recon.rows[0]);
    const match = await client.query<ReconciliationMatchRow>(
      `INSERT INTO fin.reconciliation_matches (
         reconciliation_id, bank_statement_line_id, target_kind, target_id,
         financial_transaction_id, amount
       ) VALUES ($1, $2, $3::fin.reconciliation_target_kind, $4, $5, $6)
       RETURNING ${MATCH_RETURNING_PLAIN}`,
      [
        reconciliation.id,
        input.bankStatementLineId,
        input.targetKind,
        input.targetId,
        input.financialTransactionId,
        input.amount,
      ],
    );
    await client.query(
      `UPDATE fin.bank_statement_lines
       SET match_status = 'SUGGESTED'
       WHERE id = $1`,
      [input.bankStatementLineId],
    );
    return { reconciliation, match: required(match.rows[0]) };
  }

  async markReviewRequired(client: PoolClient, lineId: string): Promise<void> {
    await client.query(
      `UPDATE fin.bank_statement_lines
       SET match_status = 'REVIEW_REQUIRED'
       WHERE id = $1`,
      [lineId],
    );
  }

  async confirm(client: PoolClient, reconciliationId: string, actorIdentityId: string): Promise<ReconciliationRow> {
    const result = await client.query<ReconciliationRow>(
      `UPDATE fin.reconciliations
       SET status = 'CONFIRMED',
           confirmed_at = NOW(),
           confirmed_by_identity_id = $2
       WHERE id = $1 AND status = 'DRAFT'
       RETURNING ${RECON_RETURNING}`,
      [reconciliationId, actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new BankReconciliationError('BANK_RECON_NOT_DRAFT');
    }
    await client.query(
      `UPDATE fin.bank_statement_lines l
       SET match_status = 'MATCHED'
       FROM fin.reconciliations r
       WHERE r.id = $1 AND l.id = r.bank_statement_line_id`,
      [reconciliationId],
    );
    return row;
  }

  async unreconcile(
    client: PoolClient,
    reconciliationId: string,
    actorIdentityId: string,
  ): Promise<ReconciliationRow> {
    const result = await client.query<ReconciliationRow>(
      `UPDATE fin.reconciliations
       SET status = 'UNRECONCILED',
           unreconciled_at = NOW(),
           unreconciled_by_identity_id = $2
       WHERE id = $1 AND status = 'CONFIRMED'
       RETURNING ${RECON_RETURNING}`,
      [reconciliationId, actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new BankReconciliationError('BANK_RECON_NOT_CONFIRMED');
    }
    await client.query(
      `UPDATE fin.reconciliation_matches
       SET is_active = FALSE
       WHERE reconciliation_id = $1`,
      [reconciliationId],
    );
    await client.query(
      `UPDATE fin.bank_statement_lines l
       SET match_status = 'UNMATCHED'
       FROM fin.reconciliations r
       WHERE r.id = $1 AND l.id = r.bank_statement_line_id`,
      [reconciliationId],
    );
    return row;
  }
}

function required<T>(row: T | undefined): T {
  if (!row) {
    throw new BankReconciliationError('BANK_RECON_NOT_FOUND');
  }
  return row;
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

function isPoolClient(client: Queryable): client is PoolClient {
  return typeof (client as PoolClient).release === 'function';
}
