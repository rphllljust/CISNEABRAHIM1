import { Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import {
  coerceOptionalUuid,
  redactAuditMetadata,
  sanitizeAuditText,
} from '../services/audit-redaction.service';
import type {
  RecordSecurityAuditInput,
  SecurityAuditEventRow,
} from '../types/security-audit.types';

export class SecurityAuditPersistenceError extends Error {
  constructor(message = 'security_audit_persistence_failed') {
    super(message);
  }
}

@Injectable()
export class SecurityAuditRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  async insert(input: RecordSecurityAuditInput, transaction?: PoolClient): Promise<string> {
    const pool = this.databaseService.getConnection()?.pool;
    if (!pool && !transaction) {
      throw new SecurityAuditPersistenceError('database_not_configured');
    }

    const metadata = redactAuditMetadata(input.metadata);
    const correlationId = input.correlationId
      ? sanitizeAuditText(input.correlationId).slice(0, 64)
      : null;

    const connection = transaction ?? pool;
    if (!connection) throw new SecurityAuditPersistenceError('database_not_configured');
    const result = await connection.query<{ id: string }>(
      `INSERT INTO audit.security_audit_events (
         actor_identity_id,
         actor_session_id,
         action,
         resource_type,
         resource_id,
         outcome,
         scope_type,
         correlation_id,
         reason_code,
         classification,
         metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING id`,
      [
        coerceOptionalUuid(input.actorIdentityId ?? null),
        coerceOptionalUuid(input.actorSessionId ?? null),
        sanitizeAuditText(input.action),
        sanitizeAuditText(input.resourceType),
        input.resourceId ? sanitizeAuditText(input.resourceId) : null,
        input.outcome,
        input.scopeType ? sanitizeAuditText(input.scopeType) : null,
        correlationId,
        input.reasonCode ? sanitizeAuditText(input.reasonCode) : null,
        input.classification,
        JSON.stringify(metadata),
      ],
    );

    const id = result.rows[0]?.id;
    if (!id) {
      throw new SecurityAuditPersistenceError();
    }
    return id;
  }

  async listRecent(limit = 50): Promise<SecurityAuditEventRow[]> {
    const pool = this.databaseService.getConnection()?.pool;
    if (!pool) {
      throw new SecurityAuditPersistenceError('database_not_configured');
    }

    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const result = await pool.query<SecurityAuditEventRow>(
      `SELECT
         id,
         occurred_at,
         actor_identity_id,
         actor_session_id,
         action,
         resource_type,
         resource_id,
         outcome,
         scope_type,
         correlation_id,
         reason_code,
         classification,
         metadata
       FROM audit.security_audit_events
       ORDER BY occurred_at DESC
       LIMIT $1`,
      [safeLimit],
    );

    return result.rows;
  }
}
