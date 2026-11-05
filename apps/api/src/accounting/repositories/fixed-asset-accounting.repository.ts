import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { AccountingError } from '../domain/ledger';
import {
  FIXED_ASSET_MOVEMENT_KINDS,
  FIXED_ASSET_MOVEMENT_STATUSES,
  FIXED_ASSET_STATUSES,
} from '../domain/fixed-asset-accounting';
import type { FixedAssetMovementRow, FixedAssetRegisterRow } from './fixed-asset-accounting.repository.types';

const REGISTER_RETURNING = `
  id, unit_id, operational_asset_id, currency_code, useful_life_months, cost_center_code,
  status::text AS status, row_version, acquired_on, disposed_on, created_at, updated_at
`;

const MOVEMENT_RETURNING = `
  id, register_id, kind::text AS kind, status::text AS status, amount::text AS amount, currency_code,
  occurred_on, from_cost_center_code, to_cost_center_code, journal_entry_id, posting_request_id,
  reversed_movement_id, idempotency_key, created_at
`;

/**
 * Recorte unico da listagem de imobilizado.
 *
 * Listagem e contagem atravessam esta MESMA funcao, entao `total` nunca pode divergir do
 * conjunto paginado — o defeito de "12 resultados, total 3" nao tem como acontecer aqui.
 *
 * `search` casa `cost_center_code` (o unico campo textual de classificacao do registro) e o
 * fragmento de identificador. Nenhum nome de coluna e nenhum fragmento de SQL vem do cliente:
 * tudo e parametrizado.
 */
function buildFixedAssetFilter(input: {
  unitId: string;
  status?: string;
  search?: string;
}): { where: string; parameters: unknown[] } {
  const conditions: string[] = [];
  const parameters: unknown[] = [];

  parameters.push(input.unitId);
  conditions.push(`unit_id = $${parameters.length}`);

  if (input.status) {
    parameters.push(input.status);
    conditions.push(`status::text = $${parameters.length}`);
  }
  if (input.search) {
    parameters.push(`%${input.search}%`);
    conditions.push(
      `(cost_center_code ILIKE $${parameters.length} OR operational_asset_id::text ILIKE $${parameters.length})`,
    );
  }

  return { where: `WHERE ${conditions.join(' AND ')}`, parameters };
}

@Injectable()
export class FixedAssetAccountingRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(registerId: string): Promise<FixedAssetRegisterRow | null> {
    const result = await this.pool().query<FixedAssetRegisterRow>(
      `SELECT ${REGISTER_RETURNING} FROM acc.fixed_asset_registers WHERE id = $1`,
      [registerId],
    );
    return result.rows[0] ?? null;
  }

  /**
   * LISTAGEM de registros de ativo imobilizado.
   *
   * DEFEITO QUE ESTA FUNCAO FECHA: o `GET accounting/fixed-assets` existente e
   * `getByOperationalAsset`, que EXIGE `operationalAssetId` — e consulta por um ativo, nao
   * lista. Sem esta leitura o operador nao tinha como descobrir quais registros existem, e o
   * `PARK: HUMAN_LOOKUP_API_GAP` do imobilizado permanecia legitimo.
   *
   * O recorte e por UNIDADE porque `acc.fixed_asset_registers.unit_id` e o escopo real do
   * dado: nao se lista ativo imobilizado de outra unidade.
   */
  async list(input: {
    unitId: string;
    status?: string;
    search?: string;
    limit: number;
    offset: number;
  }): Promise<FixedAssetRegisterRow[]> {
    const { where, parameters } = buildFixedAssetFilter(input);
    const paged = [...parameters, input.limit, input.offset];

    const result = await this.pool().query<FixedAssetRegisterRow>(
      `SELECT ${REGISTER_RETURNING}
         FROM acc.fixed_asset_registers
         ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT $${paged.length - 1} OFFSET $${paged.length}`,
      paged,
    );
    return result.rows;
  }

  /** Total do MESMO recorte — mesma construcao de filtro, nenhuma contagem paralela. */
  async count(input: { unitId: string; status?: string; search?: string }): Promise<number> {
    const { where, parameters } = buildFixedAssetFilter(input);
    const result = await this.pool().query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM acc.fixed_asset_registers ${where}`,
      parameters,
    );
    return Number.parseInt(result.rows[0]?.total ?? '0', 10);
  }

  async findByOperationalAsset(unitId: string, operationalAssetId: string): Promise<FixedAssetRegisterRow | null> {
    const result = await this.pool().query<FixedAssetRegisterRow>(
      `SELECT ${REGISTER_RETURNING}
       FROM acc.fixed_asset_registers
       WHERE unit_id = $1 AND operational_asset_id = $2`,
      [unitId, operationalAssetId],
    );
    return result.rows[0] ?? null;
  }

  async listMovements(registerId: string): Promise<FixedAssetMovementRow[]> {
    const result = await this.pool().query<FixedAssetMovementRow>(
      `SELECT ${MOVEMENT_RETURNING}
       FROM acc.fixed_asset_movements
       WHERE register_id = $1
       ORDER BY created_at ASC`,
      [registerId],
    );
    return result.rows;
  }

  async register(input: {
    unitId: string;
    operationalAssetId: string;
    currencyCode: string;
    usefulLifeMonths: number;
    costCenterCode: string | null;
    actorIdentityId: string;
  }): Promise<{ register: FixedAssetRegisterRow; idempotent: boolean }> {
    const existing = await this.findByOperationalAsset(input.unitId, input.operationalAssetId);
    if (existing) {
      return { register: existing, idempotent: true };
    }
    try {
      const result = await this.pool().query<FixedAssetRegisterRow>(
        `INSERT INTO acc.fixed_asset_registers (
           unit_id, operational_asset_id, currency_code, useful_life_months, cost_center_code,
           created_by_identity_id, updated_by_identity_id
         ) VALUES ($1, $2, $3, $4, $5, $6, $6)
         RETURNING ${REGISTER_RETURNING}`,
        [
          input.unitId,
          input.operationalAssetId,
          input.currencyCode,
          input.usefulLifeMonths,
          input.costCenterCode,
          input.actorIdentityId,
        ],
      );
      return { register: result.rows[0]!, idempotent: false };
    } catch (error) {
      if (isUniqueViolation(error)) {
        const raced = await this.findByOperationalAsset(input.unitId, input.operationalAssetId);
        if (raced) {
          return { register: raced, idempotent: true };
        }
      }
      throw error;
    }
  }

  async withLockedRegister<T>(
    registerId: string,
    work: (client: PoolClient, register: FixedAssetRegisterRow) => Promise<T>,
  ): Promise<T> {
    const client = await this.pool().connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<FixedAssetRegisterRow>(
        `SELECT ${REGISTER_RETURNING} FROM acc.fixed_asset_registers WHERE id = $1 FOR UPDATE`,
        [registerId],
      );
      const register = locked.rows[0];
      if (!register) {
        throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_FOUND');
      }
      const result = await work(client, register);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* already rolled back */
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async insertPostedMovement(
    client: PoolClient,
    input: {
      id?: string;
      registerId: string;
      kind: string;
      amount: string;
      currencyCode: string;
      occurredOn: string;
      fromCostCenterCode?: string | null;
      toCostCenterCode?: string | null;
      journalEntryId: string;
      postingRequestId: string;
      idempotencyKey: string;
      actorIdentityId: string;
    },
  ): Promise<FixedAssetMovementRow> {
    const result = await client.query<FixedAssetMovementRow>(
      `INSERT INTO acc.fixed_asset_movements (
         id, register_id, kind, status, amount, currency_code, occurred_on,
         from_cost_center_code, to_cost_center_code, journal_entry_id, posting_request_id,
         idempotency_key, created_by_identity_id
       ) VALUES (
         $1, $2, $3::acc.fixed_asset_movement_kind, $4::acc.fixed_asset_movement_status,
         $5, $6, $7, $8, $9, $10, $11, $12, $13
       )
       RETURNING ${MOVEMENT_RETURNING}`,
      [
        input.id ?? randomUUID(),
        input.registerId,
        input.kind,
        FIXED_ASSET_MOVEMENT_STATUSES.Posted,
        input.amount,
        input.currencyCode,
        input.occurredOn,
        input.fromCostCenterCode ?? null,
        input.toCostCenterCode ?? null,
        input.journalEntryId,
        input.postingRequestId,
        input.idempotencyKey,
        input.actorIdentityId,
      ],
    );
    return result.rows[0]!;
  }

  async markCapitalized(
    client: PoolClient,
    input: { registerId: string; acquiredOn: string; actorIdentityId: string },
  ): Promise<FixedAssetRegisterRow> {
    const result = await client.query<FixedAssetRegisterRow>(
      `UPDATE acc.fixed_asset_registers
       SET status = $2,
           acquired_on = $3,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $4
       WHERE id = $1
       RETURNING ${REGISTER_RETURNING}`,
      [input.registerId, FIXED_ASSET_STATUSES.Capitalized, input.acquiredOn, input.actorIdentityId],
    );
    return result.rows[0]!;
  }

  async markDisposed(
    client: PoolClient,
    input: { registerId: string; disposedOn: string; actorIdentityId: string },
  ): Promise<FixedAssetRegisterRow> {
    const result = await client.query<FixedAssetRegisterRow>(
      `UPDATE acc.fixed_asset_registers
       SET status = $2,
           disposed_on = $3,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $4
       WHERE id = $1
       RETURNING ${REGISTER_RETURNING}`,
      [input.registerId, FIXED_ASSET_STATUSES.Disposed, input.disposedOn, input.actorIdentityId],
    );
    return result.rows[0]!;
  }

  async markTransferred(
    client: PoolClient,
    input: { registerId: string; costCenterCode: string; actorIdentityId: string },
  ): Promise<FixedAssetRegisterRow> {
    const result = await client.query<FixedAssetRegisterRow>(
      `UPDATE acc.fixed_asset_registers
       SET cost_center_code = $2,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $3
       WHERE id = $1
       RETURNING ${REGISTER_RETURNING}`,
      [input.registerId, input.costCenterCode, input.actorIdentityId],
    );
    return result.rows[0]!;
  }

  async reverseAcquisition(
    client: PoolClient,
    input: { registerId: string; actorIdentityId: string },
  ): Promise<{ register: FixedAssetRegisterRow; movement: FixedAssetMovementRow }> {
    const posted = await client.query<FixedAssetMovementRow>(
      `SELECT ${MOVEMENT_RETURNING}
       FROM acc.fixed_asset_movements
       WHERE register_id = $1 AND kind = $2 AND status = $3
       FOR UPDATE`,
      [input.registerId, FIXED_ASSET_MOVEMENT_KINDS.Acquisition, FIXED_ASSET_MOVEMENT_STATUSES.Posted],
    );
    const movement = posted.rows[0];
    if (!movement) {
      throw new AccountingError('ACCOUNTING_FIXED_ASSET_NOT_CAPITALIZED');
    }
    const reversed = await client.query<FixedAssetMovementRow>(
      `UPDATE acc.fixed_asset_movements
       SET status = $2
       WHERE id = $1
       RETURNING ${MOVEMENT_RETURNING}`,
      [movement.id, FIXED_ASSET_MOVEMENT_STATUSES.Reversed],
    );
    const register = await client.query<FixedAssetRegisterRow>(
      `UPDATE acc.fixed_asset_registers
       SET status = $2,
           acquired_on = NULL,
           disposed_on = NULL,
           row_version = row_version + 1,
           updated_at = NOW(),
           updated_by_identity_id = $3
       WHERE id = $1
       RETURNING ${REGISTER_RETURNING}`,
      [input.registerId, FIXED_ASSET_STATUSES.Registered, input.actorIdentityId],
    );
    return { register: register.rows[0]!, movement: reversed.rows[0]! };
  }

  async listPostedMovements(client: PoolClient, registerId: string): Promise<FixedAssetMovementRow[]> {
    const result = await client.query<FixedAssetMovementRow>(
      `SELECT ${MOVEMENT_RETURNING}
       FROM acc.fixed_asset_movements
       WHERE register_id = $1
       ORDER BY created_at ASC`,
      [registerId],
    );
    return result.rows;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
