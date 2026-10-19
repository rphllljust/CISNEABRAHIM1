import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { UnitOfMeasureStatus } from '../domain/unit-of-measure';
import type { UnitOfMeasureRow } from '../serializers/units-of-measure-response.serializer';

export type UnitReferenceValidation = 'OK' | 'INVALID_UNIT' | 'INACTIVE_UNIT';

@Injectable()
export class UnitsOfMeasureRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async findById(unitId: string): Promise<UnitOfMeasureRow | null> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `SELECT id, code, name, category, decimal_scale, status, version,
              created_at, updated_at, deactivated_at
       FROM cat.units_of_measure
       WHERE id = $1`,
      [unitId],
    );
    return result.rows[0] ?? null;
  }

  async findByCode(code: string): Promise<UnitOfMeasureRow | null> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `SELECT id, code, name, category, decimal_scale, status, version,
              created_at, updated_at, deactivated_at
       FROM cat.units_of_measure
       WHERE code = $1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async list(
    whereClause: string,
    params: unknown[],
    limit: number,
    offset: number,
  ): Promise<UnitOfMeasureRow[]> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `SELECT id, code, name, category, decimal_scale, status, version,
              created_at, updated_at, deactivated_at
       FROM cat.units_of_measure
       WHERE ${whereClause}
       ORDER BY code ASC
       LIMIT $${params.length + 1}
       OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );
    return result.rows;
  }

  async create(input: {
    code: string;
    name: string;
    category: string;
    decimalScale: number;
    actorIdentityId: string;
  }): Promise<UnitOfMeasureRow> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `INSERT INTO cat.units_of_measure (
         code, name, category, decimal_scale, created_by_identity_id, updated_by_identity_id
       ) VALUES ($1, $2, $3::cat.unit_of_measure_category, $4, $5, $5)
       RETURNING id, code, name, category, decimal_scale, status, version,
                 created_at, updated_at, deactivated_at`,
      [input.code, input.name, input.category, input.decimalScale, input.actorIdentityId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('Failed to create unit of measure.');
    }
    return row;
  }

  async updateName(
    unitId: string,
    expectedVersion: number,
    name: string,
    actorIdentityId: string,
  ): Promise<UnitOfMeasureRow | null | 'VERSION_CONFLICT'> {
    const result = await this.pool().query<UnitOfMeasureRow>(
      `UPDATE cat.units_of_measure
       SET name = $3,
           version = version + 1,
           updated_at = now(),
           updated_by_identity_id = $4
       WHERE id = $1
         AND version = $2
       RETURNING id, code, name, category, decimal_scale, status, version,
                 created_at, updated_at, deactivated_at`,
      [unitId, expectedVersion, name, actorIdentityId],
    );
    if ((result.rowCount ?? 0) === 0) {
      const exists = await this.findById(unitId);
      return exists ? 'VERSION_CONFLICT' : null;
    }
    return result.rows[0] ?? null;
  }

  async setStatus(
    unitId: string,
    expectedVersion: number,
    status: UnitOfMeasureStatus,
    actorIdentityId: string,
  ): Promise<UnitOfMeasureRow | null | 'VERSION_CONFLICT' | 'INVALID_STATE'> {
    const current = await this.findById(unitId);
    if (!current) {
      return null;
    }
    if (current.status === status) {
      return 'INVALID_STATE';
    }

    const result = await this.pool().query<UnitOfMeasureRow>(
      `UPDATE cat.units_of_measure
       SET status = $3::cat.unit_of_measure_status,
           version = version + 1,
           updated_at = now(),
           updated_by_identity_id = $4,
           deactivated_at = CASE WHEN $3::text = 'INACTIVE' THEN now() ELSE NULL END,
           deactivated_by_identity_id = CASE WHEN $3::text = 'INACTIVE' THEN $4::uuid ELSE NULL END
       WHERE id = $1
         AND version = $2
       RETURNING id, code, name, category, decimal_scale, status, version,
                 created_at, updated_at, deactivated_at`,
      [unitId, expectedVersion, status, actorIdentityId],
    );
    if ((result.rowCount ?? 0) === 0) {
      return 'VERSION_CONFLICT';
    }
    return result.rows[0] ?? null;
  }

  async validateUnitReferences(
    unitCodes: string[],
    defaultUnitCode: string | null | undefined,
    requireActive: boolean,
  ): Promise<UnitReferenceValidation> {
    /*
      O `defaultUnitCode` é uma unidade ENTRE as permitidas — não uma unidade extra.

      Esta função comparava `rowCount` do banco com o tamanho do array, e o array era montado
      como `[...new Set(unitCodes)]` seguido de `codes.push(defaultUnitCode)`. O push acontecia
      DEPOIS da deduplicação, então o caso normal — unidade padrão já presente em `allowedUnits`,
      que é justamente o que o domínio exige — virava `['DAY','DAY']`: dois elementos no array,
      uma única linha no banco, `rowCount !== length`, e a resposta era
      `CATALOG_INVALID_UNIT` para uma unidade registrada e ACTIVE.

      Efeito medido em produção: TODA definição de serviço com `defaultUnitCode` era recusada
      com "One or more unit codes are not registered in the catalog", enquanto a mesma definição
      sem `defaultUnitCode` era aceita. O erro ainda apontava para a unidade, escondendo a causa.

      A correção une as duas origens ANTES de deduplicar: o conjunto resultante é exatamente o
      que precisa existir no catálogo.
    */
    const codes = [...new Set([
      ...unitCodes,
      ...(defaultUnitCode ? [defaultUnitCode] : []),
    ])];
    if (codes.length === 0) {
      return 'INVALID_UNIT';
    }

    const result = await this.pool().query<{ code: string; status: UnitOfMeasureStatus }>(
      `SELECT code, status
       FROM cat.units_of_measure
       WHERE code = ANY($1::text[])`,
      [codes],
    );
    if (result.rowCount !== codes.length) {
      return 'INVALID_UNIT';
    }
    if (requireActive && result.rows.some((row) => row.status !== 'ACTIVE')) {
      return 'INACTIVE_UNIT';
    }
    return 'OK';
  }
}
