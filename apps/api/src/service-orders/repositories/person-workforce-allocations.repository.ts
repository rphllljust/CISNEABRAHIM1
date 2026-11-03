import { Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import { ALLOCATION_SELECT } from './resource-planning-allocation-rows';
import type { ResourceAllocationRow } from './resource-planning.repository.types';

/**
 * Operations-owned read-only projection for recent workforce assignments.
 * Filtering of authorized OS records is mandatory in the calling service.
 * This repository never exposes its raw rows directly over HTTP.
 */
@Injectable()
export class PersonWorkforceAllocationsRepository {
  constructor(private readonly database: DatabaseService) {}

  private pool(): Pool {
    const connection = this.database.getConnection();
    if (!connection) throw new Error('DATABASE_URL is not configured.');
    return connection.pool;
  }

  async listWorkforceAllocations(
    workforceMemberId: string,
    limit: number,
    offset: number,
  ): Promise<ResourceAllocationRow[]> {
    const result = await this.pool().query<ResourceAllocationRow>(
      `${ALLOCATION_SELECT}
       WHERE workforce_member_id = $1
       ORDER BY allocated_at DESC, id DESC
       LIMIT $2 OFFSET $3`,
      [workforceMemberId, limit, offset],
    );
    return result.rows;
  }
}
