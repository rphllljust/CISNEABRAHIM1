import { Injectable } from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../../infrastructure/database/database.service';
import type { AuthzScopeType } from '../types/authz-scopes';

export type AccessRoleRow = {
  id: string;
  code: string;
  label: string;
  description: string;
  status: 'ACTIVE' | 'INACTIVE';
  version: number;
  created_by_identity_id: string;
  created_at: string;
  updated_at: string;
};

export type AccessRoleCapabilityRow = {
  id: string;
  role_id: string;
  capability: string;
  created_at: string;
};

export type CreateAccessRoleInput = {
  code: string;
  label: string;
  description: string;
  capabilities: string[];
  createdByIdentityId: string;
};

export type UpdateAccessRoleFields = {
  label?: string;
  description?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  updatedByIdentityId: string;
};

export type AccessAssignmentRow = {
  id: string;
  identity_id: string;
  identity_login: string | null;
  role_id: string;
  role_code: string;
  role_label: string;
  scope_type: AuthzScopeType;
  scope_anchor: string | null;
  version: number;
  assigned_by_identity_id: string;
  assigned_at: string;
  revoked_at: string | null;
};

export type InsertAssignmentInput = {
  roleId: string;
  identityId: string;
  scopeType: AuthzScopeType;
  scopeAnchor: string | null;
  assignedByIdentityId: string;
};

@Injectable()
export class AccessAdminRepository {
  constructor(private readonly databaseService: DatabaseService) {}

  private pool(): Pool {
    const connection = this.databaseService.getConnection();
    if (!connection) {
      throw new Error('DATABASE_URL is not configured.');
    }
    return connection.pool;
  }

  async listRoles(): Promise<AccessRoleRow[]> {
    const result = await this.pool().query<AccessRoleRow>(
      `SELECT id,
              code,
              label,
              description,
              status,
              version,
              created_by_identity_id,
              created_at,
              updated_at
       FROM "authorization".access_roles
       ORDER BY code`,
    );
    return result.rows;
  }

  async listRoleCapabilities(): Promise<AccessRoleCapabilityRow[]> {
    const result = await this.pool().query<AccessRoleCapabilityRow>(
      `SELECT id, role_id, capability, created_at
       FROM "authorization".access_role_capabilities
       ORDER BY role_id, capability`,
    );
    return result.rows;
  }

  async getRoleByCode(code: string): Promise<AccessRoleRow | null> {
    const result = await this.pool().query<AccessRoleRow>(
      `SELECT id,
              code,
              label,
              description,
              status,
              version,
              created_by_identity_id,
              created_at,
              updated_at
       FROM "authorization".access_roles
       WHERE code = $1`,
      [code],
    );
    return result.rows[0] ?? null;
  }

  async roleCodeExists(code: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM "authorization".access_roles WHERE code = $1
       ) AS exists`,
      [code],
    );
    return result.rows[0]?.exists ?? false;
  }

  async identityExists(identityId: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM identity.identities WHERE id = $1
       ) AS exists`,
      [identityId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async createRoleWithCapabilities(
    client: PoolClient,
    input: CreateAccessRoleInput,
  ): Promise<AccessRoleRow> {
    const roleResult = await client.query<AccessRoleRow>(
      `INSERT INTO "authorization".access_roles (
         code, label, description, created_by_identity_id
       )
       VALUES ($1, $2, $3, $4)
       RETURNING id,
                 code,
                 label,
                 description,
                 status,
                 version,
                 created_by_identity_id,
                 created_at,
                 updated_at`,
      [input.code, input.label.trim(), input.description.trim(), input.createdByIdentityId],
    );
    const role = roleResult.rows[0];
    if (!role) {
      throw new Error('failed to create access role');
    }
    await this.insertCapabilities(client, role.id, input.capabilities, input.createdByIdentityId);
    return role;
  }

  async updateRoleFieldsAndBumpVersion(
    client: PoolClient,
    code: string,
    expectedVersion: number,
    fields: UpdateAccessRoleFields,
  ): Promise<AccessRoleRow | null> {
    const sets: string[] = ['version = version + 1', 'updated_at = NOW()'];
    const params: unknown[] = [];
    if (fields.label !== undefined) {
      params.push(fields.label.trim());
      sets.push(`label = $${params.length}`);
    }
    if (fields.description !== undefined) {
      params.push(fields.description.trim());
      sets.push(`description = $${params.length}`);
    }
    if (fields.status !== undefined) {
      params.push(fields.status);
      sets.push(`status = $${params.length}`);
    }
    params.push(expectedVersion, code);
    const result = await client.query<AccessRoleRow>(
      `UPDATE "authorization".access_roles
       SET ${sets.join(', ')}
       WHERE code = $${params.length}
         AND version = $${params.length - 1}
       RETURNING id,
                 code,
                 label,
                 description,
                 status,
                 version,
                 created_by_identity_id,
                 created_at,
                 updated_at`,
      params,
    );
    return result.rows[0] ?? null;
  }

  async replaceRoleCapabilities(
    client: PoolClient,
    roleId: string,
    capabilities: string[],
    addedByIdentityId: string,
  ): Promise<void> {
    await client.query(
      `DELETE FROM "authorization".access_role_capabilities WHERE role_id = $1`,
      [roleId],
    );
    await this.insertCapabilities(client, roleId, capabilities, addedByIdentityId);
  }

  private async insertCapabilities(
    client: PoolClient,
    roleId: string,
    capabilities: string[],
    addedByIdentityId: string,
  ): Promise<void> {
    for (const capability of capabilities) {
      await client.query(
        `INSERT INTO "authorization".access_role_capabilities (
           role_id, capability, added_by_identity_id
         )
         VALUES ($1, $2, $3)
         ON CONFLICT (role_id, capability) DO NOTHING`,
        [roleId, capability, addedByIdentityId],
      );
    }
  }

  async hasApprovedSodException(identityId: string, ruleId: string): Promise<boolean> {
    const result = await this.pool().query<{ exists: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM \"authorization\".sod_exceptions
         WHERE identity_id = $1 AND rule_id = $2
           AND status = 'APPROVED' AND revoked_at IS NULL
           AND (valid_until IS NULL OR valid_until > NOW())
       ) AS exists`,
      [identityId, ruleId],
    );
    return result.rows[0]?.exists ?? false;
  }

  async listActiveAssignments(identityId?: string): Promise<AccessAssignmentRow[]> {
    const where = ['a.revoked_at IS NULL'];
    const params: unknown[] = [];
    if (identityId) {
      params.push(identityId);
      where.push(`a.identity_id = $${params.length}`);
    }
    const result = await this.pool().query<AccessAssignmentRow>(
      `SELECT a.id,
              a.identity_id,
              c.login_identifier_normalized AS identity_login,
              a.role_id,
              r.code AS role_code,
              r.label AS role_label,
              a.scope_type,
              a.scope_anchor,
              a.version,
              a.assigned_by_identity_id,
              a.assigned_at,
              a.revoked_at
       FROM "authorization".access_role_assignments a
       INNER JOIN "authorization".access_roles r ON r.id = a.role_id
       INNER JOIN identity.credentials c ON c.identity_id = a.identity_id AND c.revoked_at IS NULL
       WHERE ${where.join(' AND ')}
       ORDER BY a.assigned_at, a.id`,
      params,
    );
    return result.rows;
  }

  async getActiveAssignment(
    identityId: string,
    roleId: string,
    scopeType: AuthzScopeType,
    scopeAnchor: string | null,
  ): Promise<AccessAssignmentRow | null> {
    const result = await this.pool().query<AccessAssignmentRow>(
      `SELECT a.id,
              a.identity_id,
              c.login_identifier_normalized AS identity_login,
              a.role_id,
              r.code AS role_code,
              r.label AS role_label,
              a.scope_type,
              a.scope_anchor,
              a.version,
              a.assigned_by_identity_id,
              a.assigned_at,
              a.revoked_at
       FROM "authorization".access_role_assignments a
       INNER JOIN "authorization".access_roles r ON r.id = a.role_id
       INNER JOIN identity.credentials c ON c.identity_id = a.identity_id AND c.revoked_at IS NULL
       WHERE a.revoked_at IS NULL
         AND a.identity_id = $1
         AND a.role_id = $2
         AND a.scope_type = $3
         AND COALESCE(a.scope_anchor, '') = COALESCE($4, '')`,
      [identityId, roleId, scopeType, scopeAnchor],
    );
    return result.rows[0] ?? null;
  }

  async insertAssignment(
    client: PoolClient,
    input: InsertAssignmentInput,
  ): Promise<AccessAssignmentRow> {
    const result = await client.query<AccessAssignmentRow>(
      `INSERT INTO "authorization".access_role_assignments (
         role_id, identity_id, scope_type, scope_anchor, assigned_by_identity_id
       )
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id,
                 identity_id,
                 role_id,
                 scope_type,
                 scope_anchor,
                 version,
                 assigned_by_identity_id,
                 assigned_at,
                 revoked_at`,
      [
        input.roleId,
        input.identityId,
        input.scopeType,
        input.scopeAnchor,
        input.assignedByIdentityId,
      ],
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error('failed to create access assignment');
    }
    return row;
  }

  async getAssignmentById(assignmentId: string): Promise<AccessAssignmentRow | null> {
    const result = await this.pool().query<AccessAssignmentRow>(
      `SELECT a.id,
              a.identity_id,
              c.login_identifier_normalized AS identity_login,
              a.role_id,
              r.code AS role_code,
              r.label AS role_label,
              a.scope_type,
              a.scope_anchor,
              a.version,
              a.assigned_by_identity_id,
              a.assigned_at,
              a.revoked_at
       FROM "authorization".access_role_assignments a
       INNER JOIN "authorization".access_roles r ON r.id = a.role_id
       INNER JOIN identity.credentials c ON c.identity_id = a.identity_id AND c.revoked_at IS NULL
       WHERE a.id = $1`,
      [assignmentId],
    );
    return result.rows[0] ?? null;
  }

  async revokeAssignment(
    client: PoolClient,
    assignmentId: string,
    revokedByIdentityId: string,
  ): Promise<boolean> {
    const result = await client.query(
      `UPDATE "authorization".access_role_assignments
       SET revoked_at = NOW(),
           revoked_by_identity_id = $2,
           version = version + 1
       WHERE id = $1
         AND revoked_at IS NULL
       RETURNING id`,
      [assignmentId, revokedByIdentityId],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
